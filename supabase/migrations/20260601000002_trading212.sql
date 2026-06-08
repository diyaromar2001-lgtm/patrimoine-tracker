-- ════════════════════════════════════════════════════════════════════════════════
-- LOT 2: TRADING 212 CSV IMPORT SCHEMA — IMPLÉMENTATION COMPLÈTE
--
-- Status: CODE ÉCRIT MAIS NON EXÉCUTÉ — DOCKER REQUIS POUR VALIDATION
-- Created: 2026-06-08
-- Git Hash: 5b6a96aff35cc77133f43de454eb75458fdfbd4e
--
-- Implémentation complète:
-- 1. ADD COLUMN pour colonnes manquantes (transactions, cash_movements)
-- 2. CREATE TABLE import_batches, stock_split_events
-- 3. RPC import_csv_batch() — gestion complète des splits appariés
-- 4. RPC recalculate_asset_position() — coût moyen pondéré correct
-- 5. RPC rollback_import_batch() — recalcul global_cash multi-devise
--
-- Limitations documentées:
-- - global_cash recalcul simplifié (pas d'historique des taux)
-- - Pas de support FIFO/LIFO explicite (coût moyen seulement)
-- ════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 0: PRECOMPILE CHECKS
-- ─────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_col_count integer;
BEGIN
  SELECT COUNT(*) INTO v_col_count FROM information_schema.columns
  WHERE table_name = 'portfolios' AND column_name = 'user_id';
  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: portfolios table missing or corrupted';
  END IF;

  SELECT COUNT(*) INTO v_col_count FROM information_schema.columns
  WHERE table_name = 'assets' AND column_name = 'portfolio_id';
  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: assets table missing or corrupted';
  END IF;

  SELECT COUNT(*) INTO v_col_count FROM information_schema.columns
  WHERE table_name = 'transactions' AND column_name = 'portfolio_id';
  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: transactions table missing or corrupted';
  END IF;

  SELECT COUNT(*) INTO v_col_count FROM information_schema.columns
  WHERE table_name = 'cash_movements' AND column_name = 'user_id';
  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: cash_movements table missing or corrupted';
  END IF;

  RAISE NOTICE '✅ PRECOMPILE: Schema base compatible';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 1: ADD MISSING COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS public.assets
  ADD COLUMN IF NOT EXISTS isin text,
  ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();

-- Unique constraint on ISIN per portfolio (allows multiple NULLs)
-- Note: partial unique index with WHERE clause, so ON CONFLICT won't work
-- We check manually in RPC if ISIN already exists
CREATE UNIQUE INDEX IF NOT EXISTS assets_isin_per_portfolio
  ON public.assets(portfolio_id, isin) WHERE isin IS NOT NULL;

ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id),
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS base_amount_chf numeric,
  ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withholding_tax_currency text,
  ADD COLUMN IF NOT EXISTS transaction_fees_native numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_fees_currency text,
  ADD COLUMN IF NOT EXISTS gross_amount_chf numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_chf numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS realized_pnl_chf numeric DEFAULT 0;

-- Add unique constraint for idempotence on transactions (must be without WHERE for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'transactions' AND constraint_name = 'transactions_portfolio_source_external_unique'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_portfolio_source_external_unique
      UNIQUE (portfolio_id, source, source_external_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS public.cash_movements
  ADD COLUMN IF NOT EXISTS portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

-- Add unique constraint for idempotence on cash_movements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cash_movements' AND constraint_name = 'cash_movements_portfolio_source_external_unique'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT cash_movements_portfolio_source_external_unique
      UNIQUE (portfolio_id, source, source_external_id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 2: CREATE NEW TABLES
-- ─────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.import_batches (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL,
  portfolio_id      uuid        NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  broker            text        NOT NULL DEFAULT 'trading_212',
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
  error_summary     text,
  UNIQUE(user_id, portfolio_id, broker, file_checksum)
);

CREATE INDEX IF NOT EXISTS import_batches_user_id ON public.import_batches(user_id);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_id ON public.import_batches(portfolio_id);
CREATE INDEX IF NOT EXISTS import_batches_status ON public.import_batches(status);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'import_batches' AND policyname = 'users_own_batches') THEN
    CREATE POLICY "users_own_batches" ON public.import_batches FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- CRITICAL: Replace allow_all policies with user-scoped policies for RLS enforcement
DO $$ BEGIN
  -- Drop permissive all-access policies
  DROP POLICY IF EXISTS "allow_all_portfolios" ON public.portfolios;
  DROP POLICY IF EXISTS "allow_all_assets" ON public.assets;
  DROP POLICY IF EXISTS "allow_all_transactions" ON public.transactions;

  -- Create restrictive policies that enforce user ownership
  CREATE POLICY "users_own_portfolios" ON public.portfolios FOR ALL
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

  CREATE POLICY "users_own_assets" ON public.assets FOR ALL
    USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()))
    WITH CHECK (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

  CREATE POLICY "users_own_transactions" ON public.transactions FOR ALL
    USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()))
    WITH CHECK (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));
END $$;

CREATE TABLE IF NOT EXISTS public.stock_split_events (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id          uuid        NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id      uuid        NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  event_date        date        NOT NULL,
  open_source_id    text        NOT NULL,
  close_source_id   text        NOT NULL,
  import_batch_id   uuid        REFERENCES public.import_batches(id) ON DELETE CASCADE,
  qty_before        numeric     NOT NULL,
  qty_after         numeric     NOT NULL,
  price_before      numeric     NOT NULL,
  price_after       numeric     NOT NULL,
  cost_basis_chf    numeric     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, open_source_id, close_source_id)
);

CREATE INDEX IF NOT EXISTS stock_split_events_asset_id ON public.stock_split_events(asset_id);
CREATE INDEX IF NOT EXISTS stock_split_events_batch_id ON public.stock_split_events(import_batch_id);

ALTER TABLE public.stock_split_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_split_events' AND policyname = 'split_portfolio_access') THEN
    CREATE POLICY "split_portfolio_access" ON public.stock_split_events FOR ALL
      USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()))
      WITH CHECK (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 3: FOREIGN KEY CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'transactions' AND constraint_name = 'fk_transactions_import_batch'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT fk_transactions_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cash_movements' AND constraint_name = 'fk_cash_movements_import_batch'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT fk_cash_movements_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 4: ROLLBACK FUNCTION (WITH GLOBAL_CASH RECALC)
-- ─────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid)
RETURNS TABLE(
  batch_id uuid,
  success boolean,
  rows_deleted_transactions integer,
  rows_deleted_cash integer,
  rows_deleted_splits integer,
  assets_cleaned integer,
  message text
)
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_portfolio_id uuid;
  v_asset_ids uuid[] := ARRAY[]::uuid[];
  v_idx integer;
  v_tx_count integer := 0;
  v_cm_count integer := 0;
  v_sp_count integer := 0;
  v_assets_cleaned integer := 0;
  v_affected_asset_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  SELECT portfolio_id INTO v_portfolio_id FROM public.import_batches
  WHERE id = p_batch_id AND user_id = v_user_id;

  IF v_portfolio_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 0, 0, 'Batch not found or unauthorized'::text;
    RETURN;
  END IF;

  BEGIN
    -- Collect affected asset IDs
    SELECT ARRAY_AGG(DISTINCT asset_id) INTO v_asset_ids FROM (
      SELECT asset_id FROM public.transactions WHERE import_batch_id = p_batch_id AND asset_id IS NOT NULL
      UNION
      SELECT asset_id FROM public.stock_split_events WHERE import_batch_id = p_batch_id
    ) t;

    -- Delete all operations related to batch
    DELETE FROM public.transactions WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_tx_count = ROW_COUNT;

    DELETE FROM public.cash_movements WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_cm_count = ROW_COUNT;

    DELETE FROM public.stock_split_events WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_sp_count = ROW_COUNT;

    -- Recalculate affected assets chronologically
    IF v_asset_ids IS NOT NULL AND ARRAY_LENGTH(v_asset_ids, 1) > 0 THEN
      FOR v_idx IN 1..ARRAY_LENGTH(v_asset_ids, 1) LOOP
        PERFORM public.recalculate_asset_position(v_asset_ids[v_idx], v_portfolio_id);
      END LOOP;
    END IF;

    -- Clean ghost assets
    DELETE FROM public.assets
    WHERE portfolio_id = v_portfolio_id
      AND quantity = 0
      AND id NOT IN (
        SELECT DISTINCT asset_id FROM public.transactions WHERE asset_id IS NOT NULL
      )
      AND id NOT IN (
        SELECT DISTINCT asset_id FROM public.stock_split_events WHERE asset_id IS NOT NULL
      );

    GET DIAGNOSTICS v_assets_cleaned = ROW_COUNT;

    -- IMPORTANT: Recalculate global_cash for this portfolio
    -- Sum all cash movements by currency
    -- NOTE: This is a simplified recalc; does not account for historical FX rates
    WITH cash_by_currency AS (
      SELECT currency, SUM(amount) as total_amount
      FROM public.cash_movements
      WHERE portfolio_id = v_portfolio_id
      GROUP BY currency
    )
    UPDATE public.global_cash SET
      chf = COALESCE((SELECT total_amount FROM cash_by_currency WHERE currency = 'CHF'), 0),
      usd = COALESCE((SELECT total_amount FROM cash_by_currency WHERE currency = 'USD'), 0),
      eur = COALESCE((SELECT total_amount FROM cash_by_currency WHERE currency = 'EUR'), 0),
      updated_at = now()
    WHERE user_id = v_user_id;

    -- Delete batch record for audit trail cleanup
    DELETE FROM public.import_batches WHERE id = p_batch_id;

    RETURN QUERY SELECT
      p_batch_id, true, v_tx_count, v_cm_count, v_sp_count, v_assets_cleaned,
      format('Rollback: %s txns, %s cash moves, %s splits, %s assets cleaned',
        v_tx_count, v_cm_count, v_sp_count, v_assets_cleaned)::text;

  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
      p_batch_id, false, 0, 0, 0, 0, format('Rollback failed: %s', SQLERRM)::text;
  END;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid) FROM public;
REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 5: ASSET RECALCULATION (WEIGHTED AVERAGE COST, FULL REPLAY)
-- ─────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recalculate_asset_position(p_asset_id uuid, p_portfolio_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_qty numeric := 0;
  v_cost_basis_chf numeric := 0;
  v_avg_buy_price_native numeric := 0;
  v_sum_cost_chf numeric := 0;
  v_event record;
  v_cost_per_unit numeric;
  v_split_ratio numeric;
BEGIN
  -- Chronological replay: BUY, SELL, SPLIT in order
  FOR v_event IN
    (
      -- BUY events
      SELECT
        1 AS sort_order,
        'BUY'::text as event_type,
        t.date,
        t.quantity,
        t.price AS price_native,
        t.base_amount_chf,
        NULL::numeric as split_ratio,
        t.created_at
      FROM public.transactions t
      WHERE t.asset_id = p_asset_id AND t.type = 'buy'
    )
    UNION ALL
    (
      -- SELL events
      SELECT
        2 AS sort_order,
        'SELL'::text,
        t.date,
        t.quantity,
        NULL::numeric,
        t.base_amount_chf,
        NULL::numeric,
        t.created_at
      FROM public.transactions t
      WHERE t.asset_id = p_asset_id AND t.type = 'sell'
    )
    UNION ALL
    (
      -- SPLIT events
      SELECT
        3 AS sort_order,
        'SPLIT'::text,
        s.event_date,
        NULL::numeric,
        NULL::numeric,
        NULL::numeric,
        (s.qty_after / s.qty_before),
        s.created_at
      FROM public.stock_split_events s
      WHERE s.asset_id = p_asset_id
    )
    ORDER BY date ASC, created_at ASC
  LOOP
    IF v_event.event_type = 'BUY' THEN
      -- Weighted average cost: recalc (old_qty*old_avg + new_qty*new_price) / total_qty
      IF v_qty > 0 THEN
        v_avg_buy_price_native := (v_qty * v_avg_buy_price_native + v_event.quantity * v_event.price_native) / (v_qty + v_event.quantity);
      ELSE
        v_avg_buy_price_native := v_event.price_native;
      END IF;

      v_qty := v_qty + v_event.quantity;
      v_cost_basis_chf := v_cost_basis_chf + COALESCE(v_event.base_amount_chf, 0);

    ELSIF v_event.event_type = 'SELL' THEN
      -- Reduce qty and cost basis proportionally
      IF v_qty > 0 THEN
        v_cost_per_unit := v_cost_basis_chf / v_qty;
        v_cost_basis_chf := v_cost_basis_chf - (v_event.quantity * v_cost_per_unit);
        v_qty := v_qty - v_event.quantity;
      END IF;
      -- avg_buy_price stays same for SELL (no change to historical purchases)

    ELSIF v_event.event_type = 'SPLIT' THEN
      -- SPLIT: adjust qty and price inversely, cost_basis unchanged
      v_split_ratio := v_event.split_ratio;
      v_qty := v_qty * v_split_ratio;
      IF v_split_ratio > 0 THEN
        v_avg_buy_price_native := v_avg_buy_price_native / v_split_ratio;
      END IF;
      -- cost_basis_chf is UNCHANGED by split

    END IF;
  END LOOP;

  -- Safety: no negative values
  IF v_qty < 0 THEN v_qty := 0; END IF;
  IF v_cost_basis_chf < 0 THEN v_cost_basis_chf := 0; END IF;

  -- Update asset with recalculated position
  UPDATE public.assets SET
    quantity = v_qty,
    avg_buy_price = CASE WHEN v_qty > 0 THEN v_avg_buy_price_native ELSE 0 END,
    cost_basis_chf = v_cost_basis_chf,
    cost_basis_updated_at = now()
  WHERE id = p_asset_id;

END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.recalculate_asset_position(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 6: MAIN RPC — IMPORT_CSV_BATCH (COMPLETE IMPLEMENTATION)
-- ─────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.import_csv_batch(
  p_portfolio_id uuid,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb
)
RETURNS TABLE(
  batch_id uuid,
  success boolean,
  rows_imported integer,
  rows_total integer,
  error_message text
)
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_batch_id uuid;
  v_batch_exists boolean := false;
  v_rows_imported integer := 0;
  v_rows_total integer := 0;
  v_idx integer;
  v_op jsonb;
  v_op_type text;
  v_date date;
  v_ticker text;
  v_isin text;
  v_name text;
  v_quantity numeric;
  v_price numeric;
  v_price_currency text;
  v_exchange_rate numeric;
  v_total_amount numeric;
  v_total_currency text;
  v_source_id text;
  v_asset_id uuid;
  v_inserted integer;
  v_old_qty numeric;
  v_old_cost_basis numeric;
  v_old_avg_price numeric;
  v_cost_unit_chf numeric;
  v_base_amount_chf numeric;
  v_dividend_gross_chf numeric;
  v_withholding_tax numeric;
  v_split_open_idx integer := -1;
  v_split_close_idx integer := -1;
  v_split_open_source text;
  v_split_close_source text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  PERFORM 1 FROM public.portfolios WHERE id = p_portfolio_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Portfolio not found or unauthorized'::text;
    RETURN;
  END IF;

  -- Check idempotence at batch level
  SELECT id, true INTO v_batch_id, v_batch_exists FROM public.import_batches
  WHERE user_id = v_user_id AND portfolio_id = p_portfolio_id
    AND broker = p_broker AND file_checksum = p_file_checksum
  LIMIT 1;

  IF v_batch_exists THEN
    SELECT public.import_batches.rows_imported INTO v_rows_imported FROM public.import_batches WHERE public.import_batches.id = v_batch_id;
    RETURN QUERY SELECT v_batch_id, true, v_rows_imported, v_rows_imported, 'Batch already imported (idempotent)'::text;
    RETURN;
  END IF;

  -- Create batch record
  INSERT INTO public.import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum, 'processing',
    jsonb_array_length(p_operations)
  ) RETURNING id INTO v_batch_id;

  v_rows_total := jsonb_array_length(p_operations);

  BEGIN
    -- FIRST PASS: Process all non-stock-split operations
    -- This ensures assets are created before stock splits are processed
    FOR v_idx IN 0..(v_rows_total - 1) LOOP
      v_op := p_operations -> v_idx;

      v_op_type := LOWER(COALESCE(v_op ->> 'type', ''));
      v_date := COALESCE((v_op ->> 'date')::date, CURRENT_DATE);
      v_ticker := COALESCE(v_op ->> 'ticker', '');
      v_isin := COALESCE(v_op ->> 'isin', '');
      v_name := COALESCE(v_op ->> 'name', '');
      v_source_id := COALESCE(v_op ->> 'sourceId', '');

      -- Skip stock_split in first pass (processed in second pass after assets are created)
      IF v_op_type = 'stock_split' THEN
        NULL;  -- Skip for now

      -- BUY: Increase qty and cost basis
      ELSIF v_op_type = 'buy' THEN
        v_quantity := (v_op ->> 'quantity')::numeric;
        v_price := (v_op ->> 'price')::numeric;
        v_price_currency := v_op ->> 'priceCurrency';
        v_exchange_rate := COALESCE((v_op ->> 'exchangeRate')::numeric, 1.0);
        v_total_amount := (v_op ->> 'totalAmount')::numeric;
        v_total_currency := v_op ->> 'totalCurrency';

        v_base_amount_chf := v_total_amount;  -- Total INCLUDES fees per CSV format

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND isin = v_isin LIMIT 1;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (
            portfolio_id, ticker, name, asset_class, isin, quantity,
            avg_buy_price, currency, cost_basis_chf
          ) VALUES (
            p_portfolio_id, v_ticker, v_name, 'stock', v_isin, 0, 0,
            v_price_currency, 0
          ) RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.transactions (
          portfolio_id, asset_id, ticker, asset_name, asset_class, type,
          quantity, price, currency, base_amount_chf, source, source_external_id,
          import_batch_id, date, transaction_fees_native, transaction_fees_currency,
          gross_amount_chf, net_amount_chf
        ) VALUES (
          p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'buy',
          v_quantity, v_price, v_price_currency, v_base_amount_chf, p_broker, v_source_id,
          v_batch_id, v_date, 0, v_price_currency,
          v_total_amount, v_total_amount
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          SELECT quantity, cost_basis_chf, avg_buy_price INTO v_old_qty, v_old_cost_basis, v_old_avg_price
          FROM public.assets WHERE id = v_asset_id;

          -- Weighted average: (old_qty*old_price + new_qty*new_price) / total_qty
          UPDATE public.assets SET
            quantity = v_old_qty + v_quantity,
            cost_basis_chf = v_old_cost_basis + v_base_amount_chf,
            avg_buy_price = CASE WHEN (v_old_qty + v_quantity) > 0
              THEN (COALESCE(v_old_qty, 0) * COALESCE(v_old_avg_price, 0) + v_quantity * v_price) / (v_old_qty + v_quantity)
              ELSE 0 END,
            currency = v_price_currency
          WHERE id = v_asset_id;

          INSERT INTO public.cash_movements (
            portfolio_id, user_id, type, currency, amount,
            source, source_external_id, import_batch_id, date
          ) VALUES (
            p_portfolio_id, v_user_id, 'buy', v_total_currency, -v_total_amount,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      -- SELL: Decrease qty and cost basis — strict validation
      ELSIF v_op_type = 'sell' THEN
        v_quantity := (v_op ->> 'quantity')::numeric;
        v_price := (v_op ->> 'price')::numeric;
        v_price_currency := v_op ->> 'priceCurrency';
        v_exchange_rate := COALESCE((v_op ->> 'exchangeRate')::numeric, 1.0);
        v_total_amount := (v_op ->> 'totalAmount')::numeric;
        v_total_currency := v_op ->> 'totalCurrency';

        SELECT id, quantity, cost_basis_chf, avg_buy_price INTO v_asset_id, v_old_qty, v_old_cost_basis, v_old_avg_price
        FROM public.assets WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

        IF v_asset_id IS NULL THEN
          RAISE EXCEPTION 'SELL operation failed: asset with ISIN % not found', v_isin;
        END IF;

        IF v_quantity > v_old_qty THEN
          RAISE EXCEPTION 'SELL operation failed: selling % but only % held', v_quantity, v_old_qty;
        END IF;

        v_cost_unit_chf := CASE WHEN v_old_qty > 0 THEN v_old_cost_basis / v_old_qty ELSE 0 END;

        INSERT INTO public.transactions (
          portfolio_id, asset_id, ticker, asset_name, asset_class, type,
          quantity, price, currency, base_amount_chf, source, source_external_id,
          import_batch_id, date, realized_pnl_chf,
          gross_amount_chf, net_amount_chf
        ) VALUES (
          p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'sell',
          v_quantity, v_price, v_price_currency, v_quantity * v_cost_unit_chf,
          p_broker, v_source_id, v_batch_id, v_date,
          v_total_amount - (v_quantity * v_cost_unit_chf),
          v_total_amount, v_total_amount
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          UPDATE public.assets SET
            quantity = v_old_qty - v_quantity,
            cost_basis_chf = v_old_cost_basis - (v_quantity * v_cost_unit_chf),
            avg_buy_price = CASE WHEN (v_old_qty - v_quantity) > 0
              THEN v_old_avg_price ELSE 0 END
          WHERE id = v_asset_id;

          INSERT INTO public.cash_movements (
            portfolio_id, user_id, type, currency, amount,
            source, source_external_id, import_batch_id, date
          ) VALUES (
            p_portfolio_id, v_user_id, 'sell', v_total_currency, v_total_amount,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      -- DIVIDEND: Cash income with withholding (all dividend types)
      ELSIF v_op_type IN ('dividend', 'dividend_tax_exempted', 'dividend_adjustment') THEN
        v_quantity := (v_op ->> 'quantity')::numeric;
        v_price := (v_op ->> 'price')::numeric;
        v_price_currency := v_op ->> 'priceCurrency';
        v_exchange_rate := COALESCE((v_op ->> 'exchangeRate')::numeric, 1.0);
        v_total_amount := (v_op ->> 'totalAmount')::numeric;
        v_withholding_tax := COALESCE((v_op ->> 'withholdingTax')::numeric, 0);
        v_dividend_gross_chf := v_total_amount;

        -- Handle dividend_adjustment differently: it's a cash-only operation (no asset required)
        IF v_op_type = 'dividend_adjustment' THEN
          -- Dividend adjustment is pure cash (tax adjustment, not asset-related)
          INSERT INTO public.cash_movements (
            portfolio_id, user_id, type, currency, amount,
            source, source_external_id, import_batch_id, date
          ) VALUES (
            p_portfolio_id, v_user_id, v_op_type, COALESCE(v_total_currency, 'CHF'), v_dividend_gross_chf,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          END IF;

        ELSE
          -- dividend and dividend_tax_exempted: asset-based operations
          SELECT id INTO v_asset_id FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          -- CRITICAL: Dividend without asset must FAIL the batch, not silently skip
          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Dividend operation failed: asset with ISIN % not found in portfolio. Ensure security was purchased before dividend date.', v_isin;
          END IF;

          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type,
            quantity, price, currency, base_amount_chf, source, source_external_id,
            import_batch_id, date, withholding_tax_amount, withholding_tax_currency,
            gross_amount_chf, net_amount_chf
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', v_op_type,
            v_quantity, v_price, v_price_currency, v_dividend_gross_chf,
            p_broker, v_source_id, v_batch_id, v_date,
            v_withholding_tax, v_price_currency,
            v_dividend_gross_chf, v_dividend_gross_chf - v_withholding_tax
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          IF v_inserted > 0 THEN
            INSERT INTO public.cash_movements (
              portfolio_id, user_id, type, currency, amount,
              source, source_external_id, import_batch_id, date
            ) VALUES (
              p_portfolio_id, v_user_id, v_op_type, 'CHF', v_dividend_gross_chf,
              p_broker, v_source_id, v_batch_id, v_date
            ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

            IF v_withholding_tax > 0 THEN
              INSERT INTO public.cash_movements (
                portfolio_id, user_id, type, currency, amount,
                source, source_external_id, import_batch_id, date
              ) VALUES (
                p_portfolio_id, v_user_id, 'withholding_tax', 'CHF', -v_withholding_tax,
                p_broker, v_source_id || ':wht', v_batch_id, v_date
              ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;
            END IF;

            v_rows_imported := v_rows_imported + 1;
          END IF;
        END IF;

      -- INTEREST, DEPOSIT, WITHDRAWAL
      ELSIF v_op_type IN ('interest', 'deposit', 'withdrawal') THEN
        v_total_amount := (v_op ->> 'totalAmount')::numeric;
        v_total_currency := COALESCE(v_op ->> 'totalCurrency', 'CHF');

        INSERT INTO public.cash_movements (
          portfolio_id, user_id, type, currency, amount,
          source, source_external_id, import_batch_id, date
        ) VALUES (
          p_portfolio_id, v_user_id, v_op_type, v_total_currency, v_total_amount,
          p_broker, v_source_id, v_batch_id, v_date
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
        END IF;

      -- FX CONVERSION
      ELSIF v_op_type IN ('fx_conversion', 'currency_conversion') THEN
        v_total_amount := (v_op ->> 'fromAmount')::numeric;
        v_total_currency := COALESCE(v_op ->> 'fromCurrency', 'CHF');

        -- Debit source currency
        INSERT INTO public.cash_movements (
          portfolio_id, user_id, type, currency, amount,
          source, source_external_id, import_batch_id, date
        ) VALUES (
          p_portfolio_id, v_user_id, 'conversion_out', v_total_currency, -v_total_amount,
          p_broker, v_source_id || ':from', v_batch_id, v_date
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

        -- Credit destination currency
        INSERT INTO public.cash_movements (
          portfolio_id, user_id, type, currency, amount,
          source, source_external_id, import_batch_id, date
        ) VALUES (
          p_portfolio_id, v_user_id, 'conversion_in',
          COALESCE(v_op ->> 'toCurrency', 'CHF'), (v_op ->> 'toAmount')::numeric,
          p_broker, v_source_id || ':to', v_batch_id, v_date
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

        v_rows_imported := v_rows_imported + 1;

      -- STOCK SPLIT: Already processed in first pass, skip in second pass
      ELSIF v_op_type = 'stock_split' THEN
        -- Splits are processed in FIRST PASS above, not here
        -- Skip in second pass to avoid double processing
        NULL;

      ELSE
        -- Unknown operation type: strict failure
        RAISE EXCEPTION 'Unknown operation type: %. Supported: buy, sell, dividend, dividend_tax_exempted, dividend_adjustment, interest, deposit, withdrawal, fx_conversion, stock_split', v_op_type;

      END IF;

    END LOOP;

    -- SECOND PASS: Process stock splits (now that all assets are created)
    FOR v_idx IN 0..(v_rows_total - 1) LOOP
      v_op := p_operations -> v_idx;
      v_op_type := LOWER(COALESCE(v_op ->> 'type', ''));

      IF v_op_type = 'stock_split' THEN
        v_date := COALESCE((v_op ->> 'date')::date, CURRENT_DATE);
        v_ticker := COALESCE(v_op ->> 'ticker', '');
        v_isin := COALESCE(v_op ->> 'isin', '');
        v_name := COALESCE(v_op ->> 'name', '');

        -- SPLIT PROCESSING: Create stock_split_events entry
        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND isin = v_isin LIMIT 1;

        -- CRITICAL: Stock split without asset must FAIL the batch (strict mode)
        IF v_asset_id IS NULL THEN
          RAISE EXCEPTION 'Stock split failed: asset with ISIN % not found. Splits require existing position.', v_isin;
        END IF;

        -- Insert split event (with idempotence on pair of source IDs)
        INSERT INTO public.stock_split_events (
          asset_id, portfolio_id, event_date,
          open_source_id, close_source_id, import_batch_id,
          qty_before, qty_after, price_before, price_after, cost_basis_chf
        ) VALUES (
          v_asset_id, p_portfolio_id, v_date,
          COALESCE(v_op ->> 'open_source_id', 'SPLIT_' || v_idx),
          COALESCE(v_op ->> 'close_source_id', 'SPLIT_' || v_idx || '_CLOSE'),
          v_batch_id,
          (v_op ->> 'qty_before')::numeric,
          (v_op ->> 'qty_after')::numeric,
          (v_op ->> 'price_before')::numeric,
          (v_op ->> 'price_after')::numeric,
          COALESCE((SELECT cost_basis_chf FROM public.assets WHERE id = v_asset_id), 0)
        ) ON CONFLICT (portfolio_id, open_source_id, close_source_id) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          -- Recalculate asset position (handles split transformation via chronological replay)
          PERFORM public.recalculate_asset_position(v_asset_id, p_portfolio_id);

          v_rows_imported := v_rows_imported + 1;
        END IF;
      END IF;
    END LOOP;

    -- CRITICAL: Verify all events were imported
    -- Mode STRICT: If expected != actual, raise exception to identify missing events
    IF v_rows_imported != v_rows_total THEN
      RAISE EXCEPTION 'Import incomplete: expected % logical events, but only % were persisted. Check that assets exist for all dividend operations and no UNIQUE constraint conflicts occurred.', v_rows_total, v_rows_imported;
    END IF;

    -- Mark batch as successful
    UPDATE public.import_batches SET
      status = 'success',
      rows_imported = v_rows_imported,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT v_batch_id, true, v_rows_imported, v_rows_total, 'Batch imported successfully'::text;

  EXCEPTION WHEN OTHERS THEN
    -- Strict atomicity: error annuls everything
    UPDATE public.import_batches SET
      status = 'failed',
      rows_imported = v_rows_imported,
      error_summary = SQLERRM,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT v_batch_id, false, v_rows_imported, v_rows_total, format('Import failed: %s', SQLERRM)::text;
  END;

END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '✅ MIGRATION COMPLETE: Trading 212 import schema (code written, not executed)';
END $$;
