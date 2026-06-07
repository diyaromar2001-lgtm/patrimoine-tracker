-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: CSV Import Schema & Atomic RPC
-- Status: PLANNING (DO NOT EXECUTE WITHOUT APPROVAL)
--
-- This file contains:
-- 1. import_batches table (new)
-- 2. Alterations to assets, transactions, cash_movements
-- 3. Atomic RPC function for import_csv_batch
-- 4. Indexes and RLS policies
-- 5. Permissions
--
-- Execute in Supabase Dashboard > SQL Editor > New Query
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: NEW TABLE — import_batches
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL,  -- No FK to auth.users (demo mode OK)
  portfolio_id      uuid        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  broker            text        NOT NULL,  -- 'Trading 212' | 'Interactive Brokers' | etc.
  filename          text        NOT NULL,  -- Original filename from upload
  file_checksum     text        NOT NULL,  -- SHA-256 hash for deduplication
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'success', 'partial', 'failed')),

  rows_total        integer     NOT NULL DEFAULT 0,
  rows_imported     integer     NOT NULL DEFAULT 0,
  rows_skipped      integer     NOT NULL DEFAULT 0,
  rows_failed       integer     NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  error_summary     jsonb,  -- [{ "line": N, "field": "...", "error": "..." }]

  -- Prevent re-import of same file by same user for same broker
  UNIQUE(user_id, broker, file_checksum)
);

-- Indexes
CREATE INDEX IF NOT EXISTS import_batches_user_id ON import_batches(user_id);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_id ON import_batches(portfolio_id);
CREATE INDEX IF NOT EXISTS import_batches_status ON import_batches(status);
CREATE INDEX IF NOT EXISTS import_batches_created_at ON import_batches(created_at DESC);

-- RLS (will be enforced via SECURITY DEFINER RPC)
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'import_batches' AND policyname = 'users_own_batches'
  ) THEN
    CREATE POLICY "users_own_batches"
      ON import_batches FOR ALL
      USING  (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: ALTER EXISTING TABLE — assets (add ISIN)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE assets ADD COLUMN IF NOT EXISTS isin text UNIQUE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();

-- Index on ISIN for fast lookup
CREATE INDEX IF NOT EXISTS assets_isin ON assets(isin);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: ALTER EXISTING TABLE — transactions (CSV import fields)
-- ═══════════════════════════════════════════════════════════════════════════

-- Asset linking
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id);

-- Source tracking
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'
  CHECK (source IN ('manual', 'trading_212', 'interactive_brokers', 'other'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);

-- Multi-currency fields (from CSV parsing)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS native_currency text;  -- Currency of price/amount
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS native_amount numeric;  -- quantity × price in native
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS historical_fx_rate numeric;  -- Rate on transaction date
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_currency text;  -- CHF or USD from CSV
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_amount numeric;  -- Total in total_currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_currency text;  -- User's base currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_amount numeric;  -- Amount in base currency

-- Raw payload (full CSV row as JSON)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_payload jsonb;

-- Idempotence: Prevent duplicate imports by source_external_id
CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique_source_external_id
  ON transactions(portfolio_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS transactions_import_batch_id ON transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS transactions_source ON transactions(source);
CREATE INDEX IF NOT EXISTS transactions_asset_id ON transactions(asset_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: ALTER EXISTING TABLE — cash_movements (import tracking)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);

CREATE INDEX IF NOT EXISTS cash_movements_import_batch_id ON cash_movements(import_batch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: ATOMIC RPC FUNCTION — import_csv_batch
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION import_csv_batch(
  p_user_id uuid,
  p_portfolio_id uuid,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb  -- Array of parsed operations from CSV
)
RETURNS TABLE (
  batch_id uuid,
  success boolean,
  rows_total integer,
  rows_imported integer,
  rows_skipped integer,
  rows_failed integer,
  error_message text
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_rows_total integer;
  v_rows_imported integer := 0;
  v_rows_skipped integer := 0;
  v_rows_failed integer := 0;
  v_op jsonb;
  v_asset_id uuid;
  v_ticker text;
  v_name text;
  v_isin text;
  v_error_text text := '';
  v_idx integer := 0;
BEGIN
  -- ─── Step 1: Verify portfolio belongs to user ───────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM portfolios
    WHERE id = p_portfolio_id AND (user_id = p_user_id OR user_id IS NULL)
  ) THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Portfolio not found or not owned by user'::text;
    RETURN;
  END IF;

  -- ─── Step 2: Check if batch already imported (idempotence) ───────────────
  SELECT id INTO v_batch_id FROM import_batches
  WHERE user_id = p_user_id
    AND broker = p_broker
    AND file_checksum = p_file_checksum;

  IF v_batch_id IS NOT NULL THEN
    UPDATE import_batches SET completed_at = now() WHERE id = v_batch_id;
    RETURN QUERY SELECT
      v_batch_id, true, 0, 0, 0, 0, 'Already imported (same file/broker/checksum)'::text;
    RETURN;
  END IF;

  -- ─── Step 3: Create batch record ─────────────────────────────────────────
  INSERT INTO import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    p_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum,
    'processing', jsonb_array_length(p_operations)
  ) RETURNING import_batches.id INTO v_batch_id;

  v_rows_total := jsonb_array_length(p_operations);

  -- ─── Step 4: Transaction block (auto-rollback on error) ──────────────────
  BEGIN
    -- Process each operation from CSV
    FOR v_op IN SELECT jsonb_array_elements(p_operations)
    LOOP
      BEGIN
        v_idx := v_idx + 1;
        v_ticker := v_op ->> 'ticker';
        v_name := v_op ->> 'name';
        v_isin := v_op ->> 'isin';

        -- Route by operation type
        CASE (v_op ->> 'type')
          -- ─── BUY: Create asset (if needed) + insert transaction ───
          WHEN 'buy' THEN
            -- Resolve or create asset by ISIN
            SELECT id INTO v_asset_id FROM assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NULL THEN
              INSERT INTO assets (
                portfolio_id, ticker, name, asset_class, isin,
                quantity, avg_buy_price, currency
              ) VALUES (
                p_portfolio_id,
                v_ticker,
                v_name,
                'stock',
                v_isin,
                (v_op ->> 'quantity')::numeric,
                (v_op ->> 'price')::numeric,
                v_op ->> 'priceCurrency'
              ) RETURNING assets.id INTO v_asset_id;
            END IF;

            -- Insert transaction (with ON CONFLICT for idempotence)
            INSERT INTO transactions (
              portfolio_id, asset_id, ticker, asset_name, asset_class, type,
              quantity, price, currency,
              native_currency, native_amount, historical_fx_rate,
              total_currency, total_amount, base_currency, base_amount,
              source, source_external_id, import_batch_id,
              date, notes, raw_payload
            ) VALUES (
              p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'buy',
              (v_op ->> 'quantity')::numeric,
              (v_op ->> 'price')::numeric,
              v_op ->> 'priceCurrency',
              v_op ->> 'priceCurrency',
              (v_op ->> 'quantity')::numeric * (v_op ->> 'price')::numeric,
              (v_op ->> 'exchangeRate')::numeric,
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'CHF',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212',
              v_op ->> 'sourceId',
              v_batch_id,
              (v_op ->> 'date')::date,
              v_op ->> 'notes',
              v_op
            ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── SELL: Similar logic ────────────────────────────────
          WHEN 'sell' THEN
            SELECT id INTO v_asset_id FROM assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NOT NULL THEN
              INSERT INTO transactions (
                portfolio_id, asset_id, ticker, asset_name, asset_class, type,
                quantity, price, currency,
                native_currency, native_amount, historical_fx_rate,
                total_currency, total_amount, base_currency, base_amount,
                source, source_external_id, import_batch_id,
                date, notes, raw_payload
              ) VALUES (
                p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'sell',
                (v_op ->> 'quantity')::numeric,
                (v_op ->> 'price')::numeric,
                v_op ->> 'priceCurrency',
                v_op ->> 'priceCurrency',
                (v_op ->> 'quantity')::numeric * (v_op ->> 'price')::numeric,
                (v_op ->> 'exchangeRate')::numeric,
                v_op ->> 'totalCurrency',
                (v_op ->> 'totalAmount')::numeric,
                'CHF',
                (v_op ->> 'totalAmount')::numeric,
                'trading_212',
                v_op ->> 'sourceId',
                v_batch_id,
                (v_op ->> 'date')::date,
                v_op ->> 'notes',
                v_op
              ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

              v_rows_imported := v_rows_imported + 1;
            ELSE
              v_rows_skipped := v_rows_skipped + 1;
            END IF;

          -- ─── DEPOSIT: Cash movement ─────────────────────────────
          WHEN 'deposit' THEN
            INSERT INTO cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              ref_portfolio_id, date
            ) VALUES (
              p_user_id, 'deposit',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              p_portfolio_id, (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── WITHDRAWAL: Cash movement ──────────────────────────
          WHEN 'withdrawal' THEN
            INSERT INTO cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              ref_portfolio_id, date
            ) VALUES (
              p_user_id, 'withdrawal',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric * -1,  -- Negative for withdrawal
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              p_portfolio_id, (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── DIVIDEND ────────────────────────────────────────────
          WHEN 'dividend' THEN
            SELECT id INTO v_asset_id FROM assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NOT NULL THEN
              INSERT INTO transactions (
                portfolio_id, asset_id, ticker, asset_name, asset_class, type,
                quantity, price, currency,
                source, source_external_id, import_batch_id,
                date, raw_payload
              ) VALUES (
                p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'dividend',
                (v_op ->> 'quantity')::numeric,  -- Shares held
                (v_op ->> 'price')::numeric,      -- Per-share dividend
                v_op ->> 'priceCurrency',
                'trading_212', v_op ->> 'sourceId', v_batch_id,
                (v_op ->> 'date')::date, v_op
              ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

              v_rows_imported := v_rows_imported + 1;
            ELSE
              v_rows_skipped := v_rows_skipped + 1;
            END IF;

          -- ─── INTEREST ────────────────────────────────────────────
          WHEN 'interest' THEN
            INSERT INTO cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              date
            ) VALUES (
              p_user_id, 'revenue_credit',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── FX_CONVERSION ──────────────────────────────────────
          WHEN 'fx_conversion' THEN
            -- Record as two cash movements (out + in)
            INSERT INTO cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              date
            ) VALUES (
              p_user_id, 'conversion',
              v_op ->> 'fxFromCurrency',
              (v_op ->> 'fxFromAmount')::numeric * -1,  -- Negative (out)
              'trading_212', (v_op ->> 'sourceId') || '_from', v_batch_id,
              (v_op ->> 'date')::date
            ), (
              p_user_id, 'conversion',
              v_op ->> 'fxToCurrency',
              (v_op ->> 'fxToAmount')::numeric,  -- Positive (in)
              'trading_212', (v_op ->> 'sourceId') || '_to', v_batch_id,
              (v_op ->> 'date')::date
            );

            v_rows_imported := v_rows_imported + 1;

          -- ─── SPLIT ──────────────────────────────────────────────
          WHEN 'split' THEN
            -- Mark as transaction for audit trail (no buy/sell)
            SELECT id INTO v_asset_id FROM assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NOT NULL THEN
              INSERT INTO transactions (
                portfolio_id, asset_id, ticker, asset_name, asset_class, type,
                quantity, price, currency,
                source, source_external_id, import_batch_id,
                date, raw_payload
              ) VALUES (
                p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'transfer',  -- Use 'transfer' as proxy
                (v_op ->> 'quantity')::numeric,  -- New qty after split
                (v_op ->> 'price')::numeric,      -- New price after split
                v_op ->> 'priceCurrency',
                'trading_212', v_op ->> 'sourceId', v_batch_id,
                (v_op ->> 'date')::date, v_op
              ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

              v_rows_imported := v_rows_imported + 1;
            ELSE
              v_rows_skipped := v_rows_skipped + 1;
            END IF;

          -- ─── DIVIDEND_ADJUSTMENT ────────────────────────────────
          WHEN 'dividend_adjustment' THEN
            -- Similar to dividend
            INSERT INTO cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              date
            ) VALUES (
              p_user_id, 'revenue_credit',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── UNKNOWN ────────────────────────────────────────────
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        v_rows_failed := v_rows_failed + 1;
        v_error_text := COALESCE(v_error_text || '; ', '') || 'Line ' || v_idx || ': ' || SQLERRM;
      END;
    END LOOP;

    -- ─── Step 5: Update batch status ─────────────────────────────────────
    UPDATE import_batches SET
      status = CASE
        WHEN v_rows_failed = 0 THEN 'success'
        WHEN v_rows_failed > 0 AND v_rows_imported > 0 THEN 'partial'
        ELSE 'failed'
      END,
      rows_imported = v_rows_imported,
      rows_skipped = v_rows_skipped,
      rows_failed = v_rows_failed,
      error_summary = CASE
        WHEN v_error_text <> '' THEN jsonb_build_object('errors', v_error_text)
        ELSE NULL
      END,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id,
      (v_rows_failed = 0)::boolean,
      v_rows_total,
      v_rows_imported,
      v_rows_skipped,
      v_rows_failed,
      v_error_text;

  EXCEPTION WHEN OTHERS THEN
    -- Auto-rollback entire transaction
    RETURN QUERY SELECT
      v_batch_id,
      false::boolean,
      v_rows_total,
      0::integer,
      0::integer,
      v_rows_total::integer,
      'Transaction rollback: ' || SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

-- Permissions
GRANT EXECUTE ON FUNCTION import_csv_batch(uuid, uuid, text, text, text, jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run after deployment to verify schema)
-- ════════════════════════════════════════════════════════════════════════════

-- Verify import_batches table
-- SELECT * FROM import_batches LIMIT 1;

-- Verify assets has ISIN
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'isin';

-- Verify transactions has import fields
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions' AND column_name IN ('source_external_id', 'import_batch_id', 'native_currency');

-- Verify RPC exists
-- SELECT routine_name FROM information_schema.routines WHERE routine_name = 'import_csv_batch';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ════════════════════════════════════════════════════════════════════════════
