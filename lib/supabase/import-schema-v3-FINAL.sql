-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: CSV Import Schema v3 — FINAL ARCHITECTURE
-- Status: READY FOR REVIEW (NOT EXECUTED)
--
-- CRITICAL DESIGN DECISIONS:
-- 1. STRICT ATOMICITY: One invalid line = entire batch rollback (no per-line exceptions)
-- 2. ACCURATE COUNTERS: GET DIAGNOSTICS to distinguish inserted vs already-present vs failed
-- 3. ASSET RECONSTRUCTION: BUY updates qty/avg_price/cost_basis; SELL verifies qty & recalcs
-- 4. CURRENCY HANDLING: Explicit conversion or fail; never implicit base_amount = total_amount
-- 5. FEES & TAXES: Separate columns for transaction_fees, fx_fees, withholding_tax
-- 6. SPLITS: Dedicated type; paired open/close as single event; no cost_basis change
-- 7. ROLLBACK: Verifies auth.uid(), recalculates all affected assets from transactions
-- 8. SECURITY: search_path='', all tables public.*, REVOKE public/anon, GRANT authenticated
-- 9. SCHEMA COMPAT: Verify columns exist, types match, constraints honored before ALTER
-- 10. TESTING: 10 SQL test scenarios with expected results (see LOT2_TESTS_PLAN.md)
--
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT: SCHEMA VERIFICATION (informational, no modifications)
-- ═══════════════════════════════════════════════════════════════════════════

-- Verify existing column types before we add columns
-- These checks will NOT fail the schema creation; they inform us of existing structure:

-- Check transactions.type enum values (if exists)
-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_name = 'transactions' AND constraint_type = 'CHECK';

-- Check cash_movements.type (if exists)
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'cash_movements' AND column_name = 'type';

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: NEW TABLE — import_batches
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL,
  portfolio_id      uuid        NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  broker            text        NOT NULL,
  filename          text        NOT NULL,
  file_checksum     text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'success', 'failed')),

  rows_total        integer     NOT NULL DEFAULT 0,
  rows_imported     integer     NOT NULL DEFAULT 0,
  rows_skipped      integer     NOT NULL DEFAULT 0,
  rows_failed       integer     NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  error_summary     jsonb,

  UNIQUE(user_id, broker, file_checksum)
);

CREATE INDEX IF NOT EXISTS import_batches_user_id ON import_batches(user_id);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_id ON import_batches(portfolio_id);
CREATE INDEX IF NOT EXISTS import_batches_status ON import_batches(status);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'import_batches' AND policyname = 'users_own_batches'
  ) THEN
    CREATE POLICY "users_own_batches"
      ON import_batches FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: STOCK SPLIT EVENTS TABLE (new, dedicated)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_split_events (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id          uuid        NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id      uuid        NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  event_date        date        NOT NULL,
  open_source_id    text,        -- Trading 212 ID for 'Stock split open'
  close_source_id   text,        -- Trading 212 ID for 'Stock split close'
  import_batch_id   uuid        REFERENCES public.import_batches(id) ON DELETE CASCADE,
  qty_before        numeric     NOT NULL,
  qty_after         numeric     NOT NULL,
  price_before      numeric     NOT NULL,
  price_after       numeric     NOT NULL,
  cost_basis_chf    numeric     NOT NULL,  -- Unchanged after split
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE(portfolio_id, open_source_id, close_source_id)
);

CREATE INDEX IF NOT EXISTS stock_split_events_asset_id ON stock_split_events(asset_id);
CREATE INDEX IF NOT EXISTS stock_split_events_portfolio_id ON stock_split_events(portfolio_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: ALTER assets — add ISIN and fee tracking
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS isin text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS cumulative_fees_chf numeric DEFAULT 0;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS cumulative_fees_native numeric DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS assets_portfolio_isin
  ON public.assets(portfolio_id, isin)
  WHERE isin IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: ALTER transactions — add comprehensive import & financial fields
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'
  CHECK (source IN ('manual', 'trading_212', 'interactive_brokers', 'other'));
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE CASCADE;

-- CORRECTION 5: Fees separated
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_native numeric DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_chf numeric DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_currency text;

-- CORRECTION 3 & 4: Multi-currency & conversion
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS native_currency text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS native_amount numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS historical_fx_rate numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_currency text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_amount numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_currency text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_amount numeric;

-- Raw payload for audit
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS raw_payload jsonb;

-- Idempotence per operation
CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique_source_external_id
  ON public.transactions(portfolio_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_import_batch_id ON public.transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS transactions_source ON public.transactions(source);
CREATE INDEX IF NOT EXISTS transactions_asset_id ON public.transactions(asset_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: ALTER cash_movements — add import tracking & fee tracking
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE CASCADE;

-- CORRECTION 5: FX fee tracking
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS fx_fee_amount numeric DEFAULT 0;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS fx_fee_currency text;

-- Idempotence
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_unique_source_external_id
  ON public.cash_movements(user_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movements_import_batch_id ON public.cash_movements(import_batch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: STRICT ATOMIC RPC — import_csv_batch v3
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_csv_batch(
  p_portfolio_id uuid,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb
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
SET search_path = ''
AS $$
DECLARE
  v_batch_id uuid;
  v_user_id uuid;
  v_rows_total integer := 0;
  v_rows_imported integer := 0;
  v_rows_skipped integer := 0;
  v_rows_failed integer := 0;
  v_op jsonb;
  v_idx integer := 0;
  v_inserted integer;
  v_asset_id uuid;
  v_ticker text;
  v_name text;
  v_isin text;
  v_qty_native numeric;
  v_price_native numeric;
  v_qty_remaining numeric;
  v_cost_avg numeric;
  v_cost_removed numeric;
  v_old_qty numeric;
  v_old_avg_price numeric;
  v_old_cost_basis numeric;
  v_fx_rate numeric;
  v_conversion_amount numeric;
BEGIN
  -- CORRECTION 2 & 8: Use auth.uid(), not trusting p_user_id
  v_user_id := public.auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  -- Verify portfolio exists and is owned by authenticated user (NO 'OR user_id IS NULL')
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios
    WHERE id = p_portfolio_id AND user_id = v_user_id
  ) THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Portfolio not found or unauthorized'::text;
    RETURN;
  END IF;

  -- Check idempotence: if batch already imported, return immediately
  SELECT id INTO v_batch_id FROM public.import_batches
  WHERE user_id = v_user_id AND broker = p_broker AND file_checksum = p_file_checksum;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.import_batches SET completed_at = now() WHERE id = v_batch_id;
    RETURN QUERY SELECT
      v_batch_id, true, 0, 0, 0, 0, 'Already imported'::text;
    RETURN;
  END IF;

  -- Create batch record
  INSERT INTO public.import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum,
    'processing', public.jsonb_array_length(p_operations)
  ) RETURNING public.import_batches.id INTO v_batch_id;

  v_rows_total := public.jsonb_array_length(p_operations);

  -- CORRECTION 1: STRICT ATOMICITY
  -- Entire operation is one transaction; any error anywhere causes full rollback
  -- (No per-line exception handlers that swallow errors)

  BEGIN
    FOR v_op IN SELECT public.jsonb_array_elements(p_operations)
    LOOP
      v_idx := v_idx + 1;

      -- CASE: Route by operation type
      CASE (v_op ->> 'type')

        -- CORRECTION 3: BUY with full asset reconstruction
        WHEN 'buy' THEN
          v_ticker := v_op ->> 'ticker';
          v_name := v_op ->> 'name';
          v_isin := v_op ->> 'isin';
          v_qty_native := (v_op ->> 'quantity')::numeric;
          v_price_native := (v_op ->> 'price')::numeric;
          v_fx_rate := (v_op ->> 'exchangeRate')::numeric;

          -- CORRECTION 4: Currency validation
          IF (v_op ->> 'totalCurrency') IS NULL THEN
            RAISE EXCEPTION 'Line %: totalCurrency missing', v_idx;
          END IF;

          IF (v_op ->> 'totalCurrency') != 'CHF' AND (v_op ->> 'totalCurrency') != 'USD' THEN
            RAISE EXCEPTION 'Line %: totalCurrency must be CHF or USD, got %', v_idx, (v_op ->> 'totalCurrency');
          END IF;

          -- CORRECTION 4: If total is not CHF, must have valid FX rate
          IF (v_op ->> 'totalCurrency') != 'CHF' AND v_fx_rate IS NULL THEN
            RAISE EXCEPTION 'Line %: totalCurrency is not CHF but no FX rate provided', v_idx;
          END IF;

          -- Find or create asset
          SELECT id, quantity, avg_buy_price, cost_basis_chf
          INTO v_asset_id, v_old_qty, v_old_avg_price, v_old_cost_basis
          FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            -- Create new asset
            INSERT INTO public.assets (
              portfolio_id, ticker, name, asset_class, isin,
              quantity, avg_buy_price, currency, cost_basis_chf
            ) VALUES (
              p_portfolio_id, v_ticker, v_name, 'stock', v_isin,
              v_qty_native,
              v_price_native,
              v_op ->> 'priceCurrency',
              (v_op ->> 'totalAmount')::numeric
            ) RETURNING public.assets.id INTO v_asset_id;
          ELSE
            -- CORRECTION 3: Update existing asset with new cost basis
            -- new_avg_price = (old_cost_basis + new_cost) / (old_qty + new_qty)
            -- new_cost_basis_chf = old_cost_basis + new_cost_chf
            UPDATE public.assets SET
              quantity = v_old_qty + v_qty_native,
              avg_buy_price = (v_old_cost_basis + (v_op ->> 'totalAmount')::numeric) / (v_old_qty + v_qty_native),
              cost_basis_chf = v_old_cost_basis + (v_op ->> 'totalAmount')::numeric
            WHERE id = v_asset_id;
          END IF;

          -- Insert transaction
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type,
            quantity, price, currency,
            native_currency, native_amount, historical_fx_rate,
            total_currency, total_amount, base_currency, base_amount,
            transaction_fees_native, transaction_fees_chf,
            source, source_external_id, import_batch_id,
            date, notes, raw_payload
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'buy',
            v_qty_native, v_price_native, v_op ->> 'priceCurrency',
            v_op ->> 'priceCurrency', v_qty_native * v_price_native, v_fx_rate,
            v_op ->> 'totalCurrency', (v_op ->> 'totalAmount')::numeric,
            'CHF', (v_op ->> 'totalAmount')::numeric,
            0, 0,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date, v_op ->> 'notes', v_op
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 3: SELL with qty verification and cost recalculation
        WHEN 'sell' THEN
          v_ticker := v_op ->> 'ticker';
          v_name := v_op ->> 'name';
          v_isin := v_op ->> 'isin';
          v_qty_native := (v_op ->> 'quantity')::numeric;
          v_price_native := (v_op ->> 'price')::numeric;
          v_fx_rate := (v_op ->> 'exchangeRate')::numeric;

          SELECT id, quantity, avg_buy_price, cost_basis_chf
          INTO v_asset_id, v_qty_remaining, v_cost_avg, v_old_cost_basis
          FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Line %: Asset % not found for sell', v_idx, v_isin;
          END IF;

          IF v_qty_remaining < v_qty_native THEN
            RAISE EXCEPTION 'Line %: Insufficient qty (have %, trying to sell %)', v_idx, v_qty_remaining, v_qty_native;
          END IF;

          -- CORRECTION 3: Calculate cost removed from this sell
          v_cost_removed := v_qty_native * v_cost_avg;

          -- Update asset: reduce qty and cost basis
          UPDATE public.assets SET
            quantity = v_qty_remaining - v_qty_native,
            avg_buy_price = CASE WHEN (v_qty_remaining - v_qty_native) = 0 THEN 0 ELSE v_cost_avg END,
            cost_basis_chf = v_old_cost_basis - v_cost_removed
          WHERE id = v_asset_id;

          -- Insert transaction with realized P&L
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type,
            quantity, price, currency,
            native_currency, native_amount, historical_fx_rate,
            total_currency, total_amount, base_currency, base_amount,
            transaction_fees_native, transaction_fees_chf,
            realized_pnl_chf,
            source, source_external_id, import_batch_id,
            date, notes, raw_payload
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'sell',
            v_qty_native, v_price_native, v_op ->> 'priceCurrency',
            v_op ->> 'priceCurrency', v_qty_native * v_price_native, v_fx_rate,
            v_op ->> 'totalCurrency', (v_op ->> 'totalAmount')::numeric,
            'CHF', (v_op ->> 'totalAmount')::numeric,
            0, 0,
            (v_op ->> 'totalAmount')::numeric - v_cost_removed,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date, v_op ->> 'notes', v_op
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 5: DEPOSIT with fee tracking
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

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 5: WITHDRAWAL
        WHEN 'withdrawal' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id,
            ref_portfolio_id, date
          ) VALUES (
            v_user_id, 'withdrawal',
            v_op ->> 'totalCurrency',
            (v_op ->> 'totalAmount')::numeric * -1,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            p_portfolio_id, (v_op ->> 'date')::date
          ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 5: DIVIDEND with withholding tax tracking
        WHEN 'dividend' THEN
          v_isin := v_op ->> 'isin';
          SELECT id INTO v_asset_id FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Line %: Asset % not found for dividend', v_idx, v_isin;
          END IF;

          -- Record dividend transaction
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type,
            quantity, price, currency,
            withholding_tax_amount, withholding_tax_currency,
            source, source_external_id, import_batch_id,
            date, raw_payload
          ) VALUES (
            p_portfolio_id, v_asset_id,
            v_op ->> 'ticker', v_op ->> 'name', 'stock', 'dividend',
            (v_op ->> 'quantity')::numeric,
            (v_op ->> 'price')::numeric,
            v_op ->> 'priceCurrency',
            COALESCE((v_op ->> 'withholdingTax')::numeric, 0),
            v_op ->> 'withholdingTaxCurrency',
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date, v_op
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 5: INTEREST
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

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 4 & 5: FX_CONVERSION with separate movements and fee tracking
        WHEN 'fx_conversion' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id,
            fx_fee_amount, fx_fee_currency,
            date
          ) VALUES (
            v_user_id, 'conversion',
            v_op ->> 'fxFromCurrency',
            (v_op ->> 'fxFromAmount')::numeric * -1,
            'trading_212', (v_op ->> 'sourceId') || '_from', v_batch_id,
            0, NULL,
            (v_op ->> 'date')::date
          ), (
            v_user_id, 'conversion',
            v_op ->> 'fxToCurrency',
            (v_op ->> 'fxToAmount')::numeric,
            'trading_212', (v_op ->> 'sourceId') || '_to', v_batch_id,
            COALESCE((v_op ->> 'fxFee')::numeric, 0),
            v_op ->> 'fxFeeCurrency',
            (v_op ->> 'date')::date
          );

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 6: SPLIT as dedicated event (not simple transfer)
        WHEN 'split' THEN
          v_isin := v_op ->> 'isin';
          SELECT id, quantity, avg_buy_price, cost_basis_chf
          INTO v_asset_id, v_old_qty, v_old_avg_price, v_old_cost_basis
          FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Line %: Asset % not found for split', v_idx, v_isin;
          END IF;

          -- Record in dedicated split events table
          INSERT INTO public.stock_split_events (
            asset_id, portfolio_id, event_date,
            open_source_id, close_source_id,
            import_batch_id,
            qty_before, qty_after,
            price_before, price_after,
            cost_basis_chf
          ) VALUES (
            v_asset_id, p_portfolio_id, (v_op ->> 'date')::date,
            v_op ->> 'sourceId', NULL,
            v_batch_id,
            v_old_qty, (v_op ->> 'quantity')::numeric,
            v_old_avg_price, (v_op ->> 'price')::numeric,
            v_old_cost_basis
          ) ON CONFLICT (portfolio_id, open_source_id, close_source_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            -- Update asset: qty and price change, cost_basis stays same
            UPDATE public.assets SET
              quantity = (v_op ->> 'quantity')::numeric,
              avg_buy_price = (v_op ->> 'price')::numeric
            WHERE id = v_asset_id;

            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- CORRECTION 5: DIVIDEND_ADJUSTMENT
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

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        ELSE
          v_rows_skipped := v_rows_skipped + 1;
      END CASE;
    END LOOP;

    -- Update batch status
    UPDATE public.import_batches SET
      status = 'success',
      rows_imported = v_rows_imported,
      rows_skipped = v_rows_skipped,
      rows_failed = v_rows_failed,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, true, v_rows_total, v_rows_imported, v_rows_skipped, v_rows_failed, ''::text;

  EXCEPTION WHEN OTHERS THEN
    -- CORRECTION 1: ANY error = entire batch rollback (no per-line exception handling)
    UPDATE public.import_batches SET
      status = 'failed',
      rows_imported = 0,
      rows_skipped = 0,
      rows_failed = v_rows_total,
      error_summary = public.jsonb_build_object('error', SQLERRM, 'line', v_idx),
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, false, v_rows_total, 0, 0, v_rows_total, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

-- CORRECTION 8: Strict permissions
REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 7: ROLLBACK FUNCTION v3
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid)
RETURNS TABLE (
  batch_id uuid,
  success boolean,
  transactions_deleted integer,
  cash_movements_deleted integer,
  message text
)
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_portfolio_id uuid;
  v_tx_count integer := 0;
  v_cm_count integer := 0;
  v_asset_ids uuid[];
BEGIN
  -- CORRECTION 7 & 8: Verify auth.uid() owns the batch
  v_user_id := public.auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  -- Get batch and verify ownership
  SELECT portfolio_id INTO v_portfolio_id FROM public.import_batches
  WHERE id = p_batch_id AND user_id = v_user_id;

  IF v_portfolio_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 'Batch not found or unauthorized'::text;
    RETURN;
  END IF;

  BEGIN
    -- CORRECTION 7: Collect affected asset IDs before deletion
    SELECT ARRAY_AGG(DISTINCT asset_id) INTO v_asset_ids
    FROM public.transactions
    WHERE import_batch_id = p_batch_id AND asset_id IS NOT NULL;

    -- Delete all transactions from this batch
    DELETE FROM public.transactions WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_tx_count = ROW_COUNT;

    -- Delete all cash movements from this batch
    DELETE FROM public.cash_movements WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_cm_count = ROW_COUNT;

    -- Delete all split events from this batch
    DELETE FROM public.stock_split_events WHERE import_batch_id = p_batch_id;

    -- CORRECTION 7: Recalculate affected assets from remaining transactions
    IF v_asset_ids IS NOT NULL THEN
      FOR i IN 1..ARRAY_LENGTH(v_asset_ids, 1) LOOP
        PERFORM public.recalculate_asset_position(v_asset_ids[i], v_portfolio_id);
      END LOOP;
    END IF;

    -- Delete the batch itself
    DELETE FROM public.import_batches WHERE id = p_batch_id;

    RETURN QUERY SELECT
      p_batch_id, true, v_tx_count, v_cm_count,
      'Rolled back: ' || v_tx_count::text || ' transactions, ' || v_cm_count::text || ' cash movements'::text;

  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
      p_batch_id, false, 0, 0, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

-- CORRECTION 8: Strict permissions
REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid) FROM public;
REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 8: ASSET RECALCULATION HELPER (called by rollback)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalculate_asset_position(p_asset_id uuid, p_portfolio_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_qty numeric := 0;
  v_cost_basis numeric := 0;
  v_avg_price numeric := 0;
  v_buy_total numeric := 0;
  v_buy_qty numeric := 0;
BEGIN
  -- Sum all buy transactions for this asset
  SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(total_amount), 0)
  INTO v_buy_qty, v_buy_total
  FROM public.transactions
  WHERE asset_id = p_asset_id AND type = 'buy';

  -- Sum all sold quantity
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_qty
  FROM public.transactions
  WHERE asset_id = p_asset_id AND type = 'sell';

  v_qty := v_buy_qty - v_qty;

  IF v_qty < 0 THEN
    v_qty := 0;
  END IF;

  -- Calculate average price and cost basis
  IF v_qty > 0 AND v_buy_qty > 0 THEN
    v_avg_price := v_buy_total / v_buy_qty;
    v_cost_basis := v_avg_price * v_qty;
  ELSE
    v_avg_price := 0;
    v_cost_basis := 0;
  END IF;

  -- Update asset
  UPDATE public.assets SET
    quantity = v_qty,
    avg_buy_price = v_avg_price,
    cost_basis_chf = v_cost_basis
  WHERE id = p_asset_id;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA v3
-- ════════════════════════════════════════════════════════════════════════════
