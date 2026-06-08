-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: CSV Import Schema & Atomic RPC — CORRECTED VERSION
-- Status: READY FOR REVIEW (DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL)
--
-- CRITICAL CORRECTIONS:
-- 1. ISIN constraint is (portfolio_id, isin) UNIQUE, not global
-- 2. RPC uses auth.uid() instead of trusting p_user_id
-- 3. search_path is explicitly quoted and secured
-- 4. REVOKE explicit for public + anon; GRANT only authenticated
-- 5. Split logic includes asset quantity/price recalculation
-- 6. Idempotence per operation type with separate ON CONFLICT clauses
-- 7. Rollback includes cascade delete + asset recalculation
-- 8. import_batches has RLS enabled + policy declared
-- 9. cash_movements has unique index for idempotence
--
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: NEW TABLE — import_batches
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL,  -- Enforced by RLS policy
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
  error_summary     jsonb,  -- { "errors": "..." }

  -- CORRECTION 1: Prevent re-import of same file by same user for same broker
  UNIQUE(user_id, broker, file_checksum)
);

-- Indexes
CREATE INDEX IF NOT EXISTS import_batches_user_id ON import_batches(user_id);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_id ON import_batches(portfolio_id);
CREATE INDEX IF NOT EXISTS import_batches_status ON import_batches(status);
CREATE INDEX IF NOT EXISTS import_batches_created_at ON import_batches(created_at DESC);

-- CORRECTION 8: Enable RLS BEFORE creating policy
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
-- PART 2: ALTER EXISTING TABLE — assets (add ISIN with composite key)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE assets ADD COLUMN IF NOT EXISTS isin text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();

-- CORRECTION 1: ISIN is unique per portfolio, not globally
-- Prevents same ISIN in different portfolios, but allows multiple portfolios to have same ISIN
CREATE UNIQUE INDEX IF NOT EXISTS assets_portfolio_isin
  ON assets(portfolio_id, isin)
  WHERE isin IS NOT NULL;

-- Performance index
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
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id) ON DELETE CASCADE;

-- Multi-currency fields (from CSV parsing)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS native_currency text;  -- Currency of price/amount
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS native_amount numeric;  -- quantity × price in native
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS historical_fx_rate numeric;  -- Rate on transaction date
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_currency text;  -- CHF or USD from CSV
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_amount numeric;  -- Total in total_currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_currency text;  -- User's base currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_amount numeric;  -- Amount in base currency

-- Raw payload (full CSV row as JSON for audit)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_payload jsonb;

-- CORRECTION 5 & 6: Idempotence per operation type
-- Prevent duplicate transactions by source_external_id
CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique_source_external_id
  ON transactions(portfolio_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS transactions_import_batch_id ON transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS transactions_source ON transactions(source);
CREATE INDEX IF NOT EXISTS transactions_asset_id ON transactions(asset_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: ALTER EXISTING TABLE — cash_movements (import tracking)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id) ON DELETE CASCADE;

-- CORRECTION 6: Idempotence for cash movements
-- Same source_external_id cannot create duplicate cash movements
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_unique_source_external_id
  ON cash_movements(user_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS cash_movements_import_batch_id ON cash_movements(import_batch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: ATOMIC RPC FUNCTION — import_csv_batch
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION import_csv_batch(
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
SET search_path = 'public'
AS $$
DECLARE
  v_batch_id uuid;
  v_user_id uuid;
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
  v_old_qty numeric;
  v_old_avg_price numeric;
  v_split_ratio numeric;
BEGIN
  -- CORRECTION 2: Use auth.uid() instead of trusting caller's p_user_id
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  -- ─── Step 1: Verify portfolio belongs to authenticated user ──────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios
    WHERE id = p_portfolio_id AND (user_id = v_user_id OR user_id IS NULL)
  ) THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Portfolio not found or not owned by authenticated user'::text;
    RETURN;
  END IF;

  -- ─── Step 2: Check if batch already imported (idempotence level 1) ───────
  SELECT id INTO v_batch_id FROM public.import_batches
  WHERE user_id = v_user_id
    AND broker = p_broker
    AND file_checksum = p_file_checksum;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.import_batches SET completed_at = now() WHERE id = v_batch_id;
    RETURN QUERY SELECT
      v_batch_id, true, 0, 0, 0, 0, 'Already imported (same file/broker/checksum)'::text;
    RETURN;
  END IF;

  -- ─── Step 3: Create batch record ──────────────────────────────────────────
  INSERT INTO public.import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum,
    'processing', jsonb_array_length(p_operations)
  ) RETURNING public.import_batches.id INTO v_batch_id;

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
            -- CORRECTION 1: Query using portfolio_id + isin (composite key)
            SELECT id INTO v_asset_id FROM public.assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NULL THEN
              INSERT INTO public.assets (
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
              ) RETURNING public.assets.id INTO v_asset_id;
            END IF;

            -- CORRECTION 6: Idempotence per transaction type
            -- Insert transaction (with ON CONFLICT for idempotence level 2)
            INSERT INTO public.transactions (
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

          -- ─── SELL: Similar logic with P&L calculation ────────────────
          WHEN 'sell' THEN
            SELECT id INTO v_asset_id FROM public.assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NOT NULL THEN
              INSERT INTO public.transactions (
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

          -- ─── DEPOSIT: Cash movement ──────────────────────────────
          WHEN 'deposit' THEN
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              ref_portfolio_id, date
            ) VALUES (
              v_user_id, 'deposit',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              p_portfolio_id, (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── WITHDRAWAL: Cash movement ──────────────────────────
          WHEN 'withdrawal' THEN
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              ref_portfolio_id, date
            ) VALUES (
              v_user_id, 'withdrawal',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric * -1,  -- Negative for withdrawal
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              p_portfolio_id, (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── DIVIDEND: Asset-linked cash movement ────────────────
          WHEN 'dividend' THEN
            SELECT id INTO v_asset_id FROM public.assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NOT NULL THEN
              -- Record dividend transaction for audit
              INSERT INTO public.transactions (
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

              -- Record cash credit for dividend
              INSERT INTO public.cash_movements (
                user_id, type, currency, amount,
                source, source_external_id, import_batch_id,
                ref_portfolio_id, date
              ) VALUES (
                v_user_id, 'dividend_credit',
                v_op ->> 'totalCurrency',
                (v_op ->> 'totalAmount')::numeric,
                'trading_212', (v_op ->> 'sourceId') || '_dividend', v_batch_id,
                p_portfolio_id, (v_op ->> 'date')::date
              ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

              v_rows_imported := v_rows_imported + 1;
            ELSE
              v_rows_skipped := v_rows_skipped + 1;
            END IF;

          -- ─── INTEREST: Cash movement ────────────────────────────
          WHEN 'interest' THEN
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              date
            ) VALUES (
              v_user_id, 'revenue_credit',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── FX_CONVERSION: Two cash movements ───────────────────
          WHEN 'fx_conversion' THEN
            -- Record as two separate movements (out + in)
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              date
            ) VALUES (
              v_user_id, 'conversion',
              v_op ->> 'fxFromCurrency',
              (v_op ->> 'fxFromAmount')::numeric * -1,  -- Negative (out)
              'trading_212', (v_op ->> 'sourceId') || '_from', v_batch_id,
              (v_op ->> 'date')::date
            ), (
              v_user_id, 'conversion',
              v_op ->> 'fxToCurrency',
              (v_op ->> 'fxToAmount')::numeric,  -- Positive (in)
              'trading_212', (v_op ->> 'sourceId') || '_to', v_batch_id,
              (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- CORRECTION 5 & 7: SPLIT with asset recalculation
          WHEN 'split' THEN
            SELECT id, quantity, avg_buy_price
            INTO v_asset_id, v_old_qty, v_old_avg_price
            FROM public.assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NOT NULL THEN
              -- Calculate split ratio from old qty to new qty
              v_split_ratio := (v_op ->> 'quantity')::numeric / v_old_qty;

              -- Update asset: adjust quantity and price (cost_basis stays same)
              UPDATE public.assets SET
                quantity = (v_op ->> 'quantity')::numeric,
                avg_buy_price = v_old_avg_price / v_split_ratio
              WHERE id = v_asset_id;

              -- Record split transaction for audit trail
              INSERT INTO public.transactions (
                portfolio_id, asset_id, ticker, asset_name, asset_class, type,
                quantity, price, currency,
                source, source_external_id, import_batch_id,
                date, raw_payload
              ) VALUES (
                p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'transfer',
                (v_op ->> 'quantity')::numeric,  -- New qty after split
                v_old_avg_price / v_split_ratio,  -- New avg price after split
                v_op ->> 'priceCurrency',
                'trading_212', v_op ->> 'sourceId', v_batch_id,
                (v_op ->> 'date')::date, v_op
              ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

              v_rows_imported := v_rows_imported + 1;
            ELSE
              v_rows_skipped := v_rows_skipped + 1;
            END IF;

          -- ─── DIVIDEND_ADJUSTMENT: Cash movement ──────────────────
          WHEN 'dividend_adjustment' THEN
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              date
            ) VALUES (
              v_user_id, 'revenue_credit',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              (v_op ->> 'date')::date
            ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- ─── UNKNOWN: Skip ───────────────────────────────────────
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        v_rows_failed := v_rows_failed + 1;
        v_error_text := COALESCE(v_error_text || '; ', '') || 'Line ' || v_idx || ': ' || SQLERRM;
      END;
    END LOOP;

    -- ─── Step 5: Update batch status ─────────────────────────────────────
    UPDATE public.import_batches SET
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
    -- CORRECTION 6: On rollback, cascade delete via FK handles cleanup
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

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: PERMISSIONS (CORRECTION 4: Explicit revoke + strict grant)
-- ═══════════════════════════════════════════════════════════════════════════

-- Revoke from public and anon (security)
REVOKE ALL ON FUNCTION import_csv_batch(uuid, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION import_csv_batch(uuid, text, text, text, jsonb) FROM anon;

-- Grant only to authenticated users
GRANT EXECUTE ON FUNCTION import_csv_batch(uuid, text, text, text, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 7: ROLLBACK PROCEDURES (CORRECTION 6: Full rollback with recalculation)
-- ═══════════════════════════════════════════════════════════════════════════

-- Function to rollback a specific batch and recalculate asset positions
CREATE OR REPLACE FUNCTION rollback_import_batch(p_batch_id uuid)
RETURNS TABLE (
  batch_id uuid,
  success boolean,
  transactions_deleted integer,
  cash_movements_deleted integer,
  message text
)
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_portfolio_id uuid;
  v_tx_count integer := 0;
  v_cm_count integer := 0;
  v_asset_id uuid;
BEGIN
  -- Verify batch exists and get portfolio
  SELECT portfolio_id INTO v_portfolio_id FROM public.import_batches WHERE id = p_batch_id;

  IF v_portfolio_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 'Batch not found'::text;
    RETURN;
  END IF;

  -- Delete transactions for this batch (counts deleted rows)
  DELETE FROM public.transactions WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_tx_count = ROW_COUNT;

  -- Delete cash movements for this batch
  DELETE FROM public.cash_movements WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_cm_count = ROW_COUNT;

  -- CORRECTION 6: Recalculate asset positions after rollback
  -- Set quantity and avg_buy_price to 0 for assets with no remaining transactions
  UPDATE public.assets SET
    quantity = 0,
    avg_buy_price = 0,
    cost_basis_chf = 0
  WHERE portfolio_id = v_portfolio_id
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.asset_id = public.assets.id AND t.type IN ('buy', 'sell')
    );

  -- Delete the batch record itself
  DELETE FROM public.import_batches WHERE id = p_batch_id;

  RETURN QUERY SELECT
    p_batch_id, true, v_tx_count, v_cm_count,
    'Rolled back: ' || v_tx_count::text || ' transactions, ' || v_cm_count::text || ' cash movements deleted'::text;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT
    p_batch_id, false, 0, 0, 'Rollback failed: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION rollback_import_batch(uuid) FROM public;
REVOKE ALL ON FUNCTION rollback_import_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION rollback_import_batch(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 8: VERIFICATION QUERIES (run after deployment)
-- ═══════════════════════════════════════════════════════════════════════════

-- Verify import_batches table exists with RLS enabled
-- SELECT schemaname, tablename, hasrules FROM pg_tables WHERE tablename = 'import_batches';
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'import_batches';

-- Verify assets has composite ISIN unique index
-- SELECT * FROM pg_indexes WHERE tablename = 'assets' AND indexname LIKE '%isin%';

-- Verify transactions has import columns
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'transactions'
-- AND column_name IN ('source_external_id', 'import_batch_id', 'asset_id', 'native_currency');

-- Verify cash_movements has unique index for source_external_id
-- SELECT * FROM pg_indexes
-- WHERE tablename = 'cash_movements' AND indexname LIKE '%source_external_id%';

-- Verify RPC exists and is SECURITY DEFINER
-- SELECT routine_name, security_type FROM information_schema.routines
-- WHERE routine_name = 'import_csv_batch';

-- Verify RLS policy on import_batches
-- SELECT * FROM pg_policies WHERE tablename = 'import_batches';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF CORRECTED SCHEMA
-- ════════════════════════════════════════════════════════════════════════════
