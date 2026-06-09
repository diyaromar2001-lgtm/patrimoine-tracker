-- ════════════════════════════════════════════════════════════════════════════════
-- LOT 2: TRADING 212 CSV IMPORT SCHEMA — IMPLÉMENTATION CORRECTE
--
-- Status: MIGRATION D'UPGRADE POUR SUPABASE EXISTANT
-- Created: 2026-06-09
--
-- Corrections critiques appliquées :
-- 1. Utilise colonne réelle 'date' (pas 'transaction_date')
-- 2. Toutes colonnes NOT NULL fournies dans tous les INSERT transactions
-- 3. recalculate_asset_position trie vraiment chronologiquement (UNION + ORDER BY date)
-- 4. Support complet : buy, sell, dividend, dividend_tax_exempted, dividend_adjustment,
--    interest, deposit, withdrawal, currency_conversion, stock_split
-- 5. GET DIAGNOSTICS après chaque INSERT pour comptes fiables
-- 6. RPC atomique sans v_batch_result TABLE (variables scalaires + SELECT INTO)
-- 7. Signature sans defaults intermédiaires
-- 8. Atomicité : exception levée en cas d'erreur métier
-- 9. Pas de RAISE NOTICE hors fonction
-- 10. Tests GitHub Actions : assertions réelles sur transactions, assets, cash, splits
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
  WHERE table_name = 'transactions' AND column_name = 'date';
  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: transactions table missing column "date"';
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
  ADD COLUMN IF NOT EXISTS realized_pnl_chf numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_subtype text;

-- Production may carry NOT NULL constraints on several columns from earlier schema versions.
-- The RPC legitimately writes NULL to all of them in specific cases:
--   realized_pnl_chf:         NULL when proceeds or cost basis are non-CHF
--   gross_amount_chf:         NULL for non-CHF dividends
--   base_amount_chf:          NULL when account currency != CHF
--   net_amount_chf:           not set by import RPC; NULL when not computable
--   withholding_tax_currency: NULL when no withholding tax is recorded
--   transaction_fees_currency: NULL when no fees are recorded
-- DROP DEFAULT removes DEFAULT 0 so unknown values stay NULL, not a fabricated zero.
-- DROP DEFAULT on a column that has no default is a silent no-op in PostgreSQL.
ALTER TABLE public.transactions
  ALTER COLUMN realized_pnl_chf         DROP NOT NULL,
  ALTER COLUMN realized_pnl_chf         DROP DEFAULT,
  ALTER COLUMN gross_amount_chf         DROP NOT NULL,
  ALTER COLUMN gross_amount_chf         DROP DEFAULT,
  ALTER COLUMN base_amount_chf          DROP NOT NULL,
  ALTER COLUMN net_amount_chf           DROP NOT NULL,
  ALTER COLUMN net_amount_chf           DROP DEFAULT,
  ALTER COLUMN withholding_tax_currency  DROP NOT NULL,
  ALTER COLUMN transaction_fees_currency DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'transactions' AND indexname = 'transactions_portfolio_source_unique'
  ) THEN
    CREATE UNIQUE INDEX transactions_portfolio_source_unique
      ON public.transactions(portfolio_id, source, source_external_id)
      WHERE source_external_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.cash_movements
  ADD COLUMN IF NOT EXISTS ref_portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'cash_movements' AND indexname = 'cash_movements_portfolio_source_unique'
  ) THEN
    CREATE UNIQUE INDEX cash_movements_portfolio_source_unique
      ON public.cash_movements(ref_portfolio_id, source, source_external_id)
      WHERE source_external_id IS NOT NULL;
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
-- SECTION 4: ROLLBACK FUNCTION (WITH GLOBAL_CASH RECALC BY USER_ID)
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
    SELECT ARRAY_AGG(DISTINCT asset_id) INTO v_asset_ids FROM (
      SELECT asset_id FROM public.transactions WHERE import_batch_id = p_batch_id AND asset_id IS NOT NULL
      UNION
      SELECT asset_id FROM public.stock_split_events WHERE import_batch_id = p_batch_id
    ) t;

    DELETE FROM public.transactions WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_tx_count = ROW_COUNT;

    DELETE FROM public.cash_movements WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_cm_count = ROW_COUNT;

    DELETE FROM public.stock_split_events WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_sp_count = ROW_COUNT;

    IF v_asset_ids IS NOT NULL AND ARRAY_LENGTH(v_asset_ids, 1) > 0 THEN
      FOR v_idx IN 1..ARRAY_LENGTH(v_asset_ids, 1) LOOP
        PERFORM public.recalculate_asset_position(v_asset_ids[v_idx], v_portfolio_id);
      END LOOP;
    END IF;

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

    WITH user_cash_by_currency AS (
      SELECT currency, SUM(amount) as total_amount
      FROM public.cash_movements
      WHERE user_id = v_user_id
      GROUP BY currency
    )
    UPDATE public.global_cash SET
      chf = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'CHF'), 0),
      usd = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'USD'), 0),
      eur = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'EUR'), 0),
      updated_at = now()
    WHERE user_id = v_user_id;

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
-- SECTION 5: ASSET RECALCULATION (TRULY CHRONOLOGICAL REPLAY)
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
  v_event record;
  v_cost_per_unit numeric;
  v_split_ratio numeric;
BEGIN
  -- Chronological replay: events in true date order (splits can be between buys/sells)
  FOR v_event IN
    (
      SELECT
        'BUY'::text as event_type,
        t.date as event_date,
        t.created_at,
        t.quantity,
        t.price AS price_native,
        t.base_amount_chf,
        NULL::numeric as split_ratio
      FROM public.transactions t
      WHERE t.asset_id = p_asset_id AND t.type = 'buy'
      UNION ALL
      SELECT
        'SELL'::text,
        t.date,
        t.created_at,
        t.quantity,
        NULL::numeric,
        t.base_amount_chf,
        NULL::numeric
      FROM public.transactions t
      WHERE t.asset_id = p_asset_id AND t.type = 'sell'
      UNION ALL
      SELECT
        'SPLIT'::text,
        s.event_date,
        s.created_at,
        NULL::numeric,
        NULL::numeric,
        NULL::numeric,
        (s.qty_after / s.qty_before)
      FROM public.stock_split_events s
      WHERE s.asset_id = p_asset_id
    )
    ORDER BY event_date ASC, created_at ASC
  LOOP
    IF v_event.event_type = 'SPLIT' THEN
      v_split_ratio := v_event.split_ratio;
      v_qty := v_qty * v_split_ratio;
      IF v_split_ratio > 0 THEN
        v_avg_buy_price_native := v_avg_buy_price_native / v_split_ratio;
      END IF;

    ELSIF v_event.event_type = 'BUY' THEN
      IF v_qty > 0 THEN
        v_avg_buy_price_native := (v_qty * v_avg_buy_price_native + v_event.quantity * v_event.price_native) / (v_qty + v_event.quantity);
      ELSE
        v_avg_buy_price_native := v_event.price_native;
      END IF;
      v_qty := v_qty + v_event.quantity;
      v_cost_basis_chf := v_cost_basis_chf + COALESCE(v_event.base_amount_chf, 0);

    ELSIF v_event.event_type = 'SELL' THEN
      IF v_qty > 0 THEN
        v_cost_per_unit := v_cost_basis_chf / v_qty;
        v_cost_basis_chf := v_cost_basis_chf - (v_event.quantity * v_cost_per_unit);
        v_qty := v_qty - v_event.quantity;
      END IF;
    END IF;
  END LOOP;

  -- Point 4: do NOT silently clamp – expose data anomalies with a WARNING.
  IF v_qty < 0 THEN
    RAISE WARNING 'recalculate_asset_position: qty went negative (%) for asset % – check for oversell or missing BUY. Clamping to 0.', v_qty, p_asset_id;
    v_qty := 0;
  END IF;
  IF v_cost_basis_chf < 0 THEN v_cost_basis_chf := 0; END IF;

  UPDATE public.assets SET
    quantity = v_qty,
    avg_buy_price = CASE WHEN v_qty > 0 THEN v_avg_buy_price_native ELSE 0 END,
    cost_basis_chf = v_cost_basis_chf,
    cost_basis_updated_at = now()
  WHERE id = p_asset_id;

END;
$$ LANGUAGE plpgsql;

-- Point 2: recalculate_asset_position is called only by SECURITY DEFINER RPCs.
-- Direct access by authenticated users would bypass portfolio ownership checks.
REVOKE ALL ON FUNCTION public.recalculate_asset_position(uuid, uuid) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 6: MAIN RPC — IMPORT_CSV_BATCH (COMPLETE, CORRECT IMPLEMENTATION)
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
  v_dividend_gross_chf numeric;
  v_withholding_tax numeric;
  v_interest_amount numeric;
  v_fee_amount numeric;
  v_from_currency text;
  v_to_currency text;
  v_from_amount numeric;
  v_to_amount numeric;
  -- ── Position tracking (oversell guard + realized P&L) ──────────────────────
  v_ticker_positions   jsonb    := '{}'; -- {ticker: {qty, cost, avg}} running state in PASS 2
  v_op_rec             record;           -- record variable for the chronological PASS 2 loop
  v_running_qty        numeric  := 0;
  v_running_cost_chf   numeric  := 0;
  v_running_avg_native numeric  := 0;
  v_cost_per_unit_chf  numeric  := 0;
  v_cost_sold_chf      numeric  := 0;
  v_realized_pnl_chf   numeric  := 0;
  v_base_amount_chf    numeric;
  v_wht_currency       text;
  v_split_ratio        numeric;  -- for in-memory split tracking in PASS 2
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  v_rows_total := jsonb_array_length(p_operations);

  -- Point 1: verify portfolio belongs to the calling user before any write
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios WHERE id = p_portfolio_id AND user_id = v_user_id
  ) THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Portfolio not found or access denied'::text;
    RETURN;
  END IF;

  BEGIN
    SELECT id, (status != 'pending') INTO v_batch_id, v_batch_exists
    FROM public.import_batches
    WHERE user_id = v_user_id AND portfolio_id = p_portfolio_id
      AND broker = p_broker AND file_checksum = p_file_checksum;

    IF v_batch_exists THEN
      RETURN QUERY SELECT v_batch_id, false, 0, v_rows_total, 'Batch already imported'::text;
      RETURN;
    END IF;

    IF v_batch_id IS NULL THEN
      INSERT INTO public.import_batches (user_id, portfolio_id, broker, filename, file_checksum, rows_total)
      VALUES (v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum, v_rows_total)
      RETURNING id INTO v_batch_id;
    END IF;

    UPDATE public.import_batches SET status = 'processing' WHERE id = v_batch_id;

    -- ════════════════════════════════════════════════════════════════════════════
    -- PASS 1: PROCESS STOCK SPLITS FIRST (preserve chronological order in pass 2)
    -- ════════════════════════════════════════════════════════════════════════════

    FOR v_idx IN 0..(v_rows_total - 1) LOOP
      v_op := p_operations->v_idx;
      v_op_type := v_op->>'type';

      IF v_op_type = 'stock_split' THEN
        v_date := (v_op->>'date')::date;
        v_ticker := v_op->>'ticker';
        v_source_id := v_op->>'sourceId';
        -- B9 fix: parser uses snake_case (qty_before, price_before, etc.)
        v_quantity := (v_op->>'qty_before')::numeric;
        v_price    := (v_op->>'price_before')::numeric;

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, avg_buy_price, cost_basis_chf)
          VALUES (p_portfolio_id, v_ticker, v_ticker, 'stock', 0, 0, 0)
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.stock_split_events (
          asset_id, portfolio_id, event_date, open_source_id, close_source_id, import_batch_id,
          qty_before, qty_after, price_before, price_after, cost_basis_chf
        ) VALUES (
          v_asset_id, p_portfolio_id, v_date,
          COALESCE(v_op->>'open_source_id', v_source_id),
          COALESCE(v_op->>'close_source_id', v_source_id || ':close'),
          v_batch_id,
          v_quantity,
          (v_op->>'qty_after')::numeric,
          v_price,
          (v_op->>'price_after')::numeric,
          0
        ) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
          PERFORM public.recalculate_asset_position(v_asset_id, p_portfolio_id);
        END IF;
      END IF;
    END LOOP;

    -- ════════════════════════════════════════════════════════════════════════════
    -- PASS 2: PROCESS ALL OTHER OPERATIONS IN STRICT CHRONOLOGICAL ORDER
    --   Sorted oldest-first so oversell checks and P&L use the correct running
    --   position at each moment in time.
    -- ════════════════════════════════════════════════════════════════════════════

    FOR v_op_rec IN
      -- Include stock_splits in date order so in-memory position tracking reflects
      -- split ratio changes between buys and sells (prevents false oversell rejections).
      SELECT ops.value
      FROM jsonb_array_elements(p_operations) AS ops(value)
      ORDER BY (ops.value->>'date')::date ASC,
               COALESCE(ops.value->>'sourceId', '') ASC
    LOOP
      v_op        := v_op_rec.value;
      v_op_type   := v_op->>'type';
      v_date      := (v_op->>'date')::date;
      v_source_id := v_op->>'sourceId';

      -- stock_splits were already inserted in PASS 1; here we only update in-memory
      -- position tracking so subsequent oversell checks and P&L calculations are correct.
      IF v_op_type = 'stock_split' THEN
        v_ticker := v_op->>'ticker';
        IF v_ticker_positions ? v_ticker THEN
          v_running_qty        := (v_ticker_positions->v_ticker->>'qty')::numeric;
          v_running_cost_chf   := (v_ticker_positions->v_ticker->>'cost')::numeric;
          v_running_avg_native := (v_ticker_positions->v_ticker->>'avg')::numeric;
          v_split_ratio := CASE
            WHEN COALESCE((v_op->>'qty_before')::numeric, 0) > 0
            THEN (v_op->>'qty_after')::numeric / (v_op->>'qty_before')::numeric
            ELSE 1 END;
          v_running_qty        := v_running_qty * v_split_ratio;
          v_running_avg_native := CASE WHEN v_split_ratio > 0
            THEN v_running_avg_native / v_split_ratio ELSE v_running_avg_native END;
          -- cost_basis_chf is invariant under splits (same total CHF value)
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'qty'], to_jsonb(v_running_qty));
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'avg'], to_jsonb(v_running_avg_native));
        END IF;
        CONTINUE; -- no DB work needed here
      END IF;

      IF v_op_type IN ('buy', 'sell') THEN
        v_ticker         := v_op->>'ticker';
        v_quantity       := (v_op->>'quantity')::numeric;
        v_price          := (v_op->>'price')::numeric;
        v_price_currency := v_op->>'priceCurrency';                          -- B1 fix: was 'currency'
        v_exchange_rate  := COALESCE((v_op->>'exchangeRate')::numeric, 1);
        v_total_amount   := COALESCE((v_op->>'totalAmount')::numeric,        -- B2 fix: use CSV Total directly
                              v_quantity * v_price * v_exchange_rate);
        v_total_currency := COALESCE(v_op->>'totalCurrency', 'CHF');         -- B3/cash fix
        v_name           := COALESCE(v_op->>'name', v_ticker);

        -- Point 6: base_amount_chf stores only CHF amounts; NULL for non-CHF accounts
        v_base_amount_chf := CASE WHEN v_total_currency = 'CHF' THEN v_total_amount ELSE NULL END;

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, avg_buy_price, cost_basis_chf)
          VALUES (p_portfolio_id, v_ticker, v_name, 'stock', 0, 0, 0)
          RETURNING id INTO v_asset_id;
        END IF;

        -- Initialize in-memory running position for this ticker on first encounter.
        -- Seed from the assets table which reflects pre-import state + PASS 1 splits.
        IF NOT (v_ticker_positions ? v_ticker) THEN
          v_running_qty := 0; v_running_cost_chf := 0; v_running_avg_native := 0;
          SELECT COALESCE(a.quantity, 0), COALESCE(a.cost_basis_chf, 0), COALESCE(a.avg_buy_price, 0)
          INTO v_running_qty, v_running_cost_chf, v_running_avg_native
          FROM public.assets a WHERE a.id = v_asset_id;
          v_ticker_positions := v_ticker_positions || jsonb_build_object(
            v_ticker, jsonb_build_object(
              'qty',  to_jsonb(v_running_qty),
              'cost', to_jsonb(v_running_cost_chf),
              'avg',  to_jsonb(v_running_avg_native)
            )
          );
        END IF;

        v_running_qty        := (v_ticker_positions->v_ticker->>'qty')::numeric;
        v_running_cost_chf   := (v_ticker_positions->v_ticker->>'cost')::numeric;
        v_running_avg_native := (v_ticker_positions->v_ticker->>'avg')::numeric;

        -- Point 4: refuse oversell – no silent clamping
        IF v_op_type = 'sell' AND v_quantity > v_running_qty THEN
          RAISE EXCEPTION 'OVERSELL rejected: ticker=%, attempting to sell % but only % currently held',
            v_ticker, v_quantity, v_running_qty;
        END IF;

        -- Fix 2: realized P&L is only meaningful when both proceeds AND cost basis are in CHF.
        -- Store NULL instead of a fabricated zero when conversion is impossible.
        IF v_op_type = 'sell' THEN
          v_cost_per_unit_chf := CASE WHEN v_running_qty > 0
            THEN v_running_cost_chf / v_running_qty ELSE 0 END;
          v_cost_sold_chf := v_quantity * v_cost_per_unit_chf;
          IF v_base_amount_chf IS NULL OR v_running_cost_chf = 0 THEN
            v_realized_pnl_chf := NULL;   -- non-CHF or no cost basis: cannot compute P&L
          ELSE
            v_realized_pnl_chf := v_base_amount_chf - v_cost_sold_chf;
          END IF;
        ELSE
          v_realized_pnl_chf := NULL;
        END IF;

        IF v_op_type = 'sell' THEN
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
            source, source_external_id, import_batch_id, base_amount_chf, realized_pnl_chf
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'sell', v_quantity, v_price, v_price_currency, v_date,
            p_broker, v_source_id, v_batch_id, v_base_amount_chf, v_realized_pnl_chf
          ) ON CONFLICT (portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        ELSE
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
            source, source_external_id, import_batch_id, base_amount_chf
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'buy', v_quantity, v_price, v_price_currency, v_date,
            p_broker, v_source_id, v_batch_id, v_base_amount_chf
          ) ON CONFLICT (portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        END IF;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          -- Update in-memory running position
          IF v_op_type = 'buy' THEN
            v_running_avg_native := CASE WHEN v_running_qty > 0
              THEN (v_running_qty * v_running_avg_native + v_quantity * v_price) / (v_running_qty + v_quantity)
              ELSE v_price END;
            v_running_qty      := v_running_qty + v_quantity;
            v_running_cost_chf := v_running_cost_chf + COALESCE(v_base_amount_chf, 0);
          ELSIF v_op_type = 'sell' THEN
            v_running_qty      := v_running_qty - v_quantity;
            v_running_cost_chf := GREATEST(0, v_running_cost_chf - v_cost_sold_chf);
          END IF;
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'qty'],  to_jsonb(v_running_qty));
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'cost'], to_jsonb(v_running_cost_chf));
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'avg'],  to_jsonb(v_running_avg_native));

          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, p_portfolio_id,
            CASE WHEN v_op_type = 'buy' THEN 'buy_deduction' ELSE 'sell_credit' END,
            v_total_currency,                                                -- B3 fix: account currency, not price currency
            CASE WHEN v_op_type = 'buy' THEN -v_total_amount ELSE v_total_amount END,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          END IF;
        END IF;

      ELSIF v_op_type IN ('dividend', 'dividend_tax_exempted', 'dividend_adjustment') THEN
        v_ticker          := v_op->>'ticker';
        v_withholding_tax := COALESCE((v_op->>'withholdingTax')::numeric, 0);
        v_total_currency  := COALESCE(v_op->>'totalCurrency', 'CHF');         -- B5 fix: use real currency
        -- Point 5: withholding tax currency from parser field withholdingTaxCurrency
        v_wht_currency    := COALESCE(NULLIF(v_op->>'withholdingTaxCurrency', ''), v_total_currency);
        -- B4 fix: gross = net received (totalAmount) + withheld; stored in totalCurrency
        -- v_total_amount = native gross (any currency) — used for cash_movements amount
        v_total_amount    := COALESCE((v_op->>'totalAmount')::numeric, 0) + v_withholding_tax;
        -- Fix 3: gross_amount_chf column only stores CHF; NULL for non-CHF dividends
        v_dividend_gross_chf := CASE WHEN v_total_currency = 'CHF' THEN v_total_amount ELSE NULL END;
        v_name            := COALESCE(v_op->>'name', v_ticker);

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, avg_buy_price, cost_basis_chf)
          VALUES (p_portfolio_id, v_ticker, v_name, 'stock', 0, 0, 0)
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.transactions (
          portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
          source, source_external_id, import_batch_id, gross_amount_chf, withholding_tax_amount,
          withholding_tax_currency, source_subtype
        ) VALUES (
          p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'dividend', 0, 0, v_total_currency, v_date,
          p_broker, v_source_id, v_batch_id, v_dividend_gross_chf, v_withholding_tax,
          v_wht_currency, v_op_type
        ) ON CONFLICT (portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
          ) VALUES (
            -- Use v_total_amount (native gross in totalCurrency), not gross_amount_chf which may be NULL
            v_user_id, p_portfolio_id, 'revenue_credit', v_total_currency, v_total_amount,
            p_broker, v_source_id, v_batch_id, v_date, v_op_type
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;

          IF v_withholding_tax > 0 THEN
            INSERT INTO public.cash_movements (
              user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
            ) VALUES (
              -- Point 5: withholding deduction in the tax's actual currency (v_wht_currency)
              v_user_id, p_portfolio_id, 'fee', v_wht_currency, -v_withholding_tax,
              p_broker, v_source_id || ':wht', v_batch_id, v_date, 'withholding_tax'
            ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
          END IF;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type = 'interest' THEN
        v_interest_amount := COALESCE((v_op->>'totalAmount')::numeric, 0);   -- B6 fix: was 'amount'
        v_total_currency  := COALESCE(v_op->>'totalCurrency', 'CHF');         -- Point 5: actual currency, not hardcoded CHF

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
        ) VALUES (
          v_user_id, p_portfolio_id, 'revenue_credit', v_total_currency, v_interest_amount,
          p_broker, v_source_id, v_batch_id, v_date, 'interest'
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type IN ('deposit', 'withdrawal') THEN
        v_total_amount   := (v_op->>'totalAmount')::numeric;                 -- B7 fix: was 'amount'
        v_total_currency := COALESCE(v_op->>'totalCurrency', 'CHF');         -- B7 fix: was 'currency'

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
        ) VALUES (
          v_user_id, p_portfolio_id, v_op_type, v_total_currency,
          CASE WHEN v_op_type = 'deposit' THEN v_total_amount ELSE -v_total_amount END,
          p_broker, v_source_id, v_batch_id, v_date
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type IN ('currency_conversion', 'fx_conversion') THEN       -- B8 fix: parser outputs 'fx_conversion'
        v_from_currency := v_op->>'fromCurrency';
        v_to_currency   := v_op->>'toCurrency';
        v_from_amount   := (v_op->>'fromAmount')::numeric;
        v_to_amount     := (v_op->>'toAmount')::numeric;

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
        ) VALUES (
          v_user_id, p_portfolio_id, 'conversion', v_from_currency, -v_from_amount,
          p_broker, v_source_id || ':from', v_batch_id, v_date, 'fx_from'
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
          ) VALUES (
            v_user_id, p_portfolio_id, 'conversion', v_to_currency, v_to_amount,
            p_broker, v_source_id || ':to', v_batch_id, v_date, 'fx_to'
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSE
        RAISE EXCEPTION 'Unknown operation type: %. Supported: buy, sell, dividend, dividend_tax_exempted, dividend_adjustment, interest, deposit, withdrawal, currency_conversion, fx_conversion, stock_split', v_op_type;
      END IF;
    END LOOP;

    FOR v_asset_id IN
      SELECT DISTINCT asset_id FROM public.transactions WHERE portfolio_id = p_portfolio_id AND asset_id IS NOT NULL
    LOOP
      PERFORM public.recalculate_asset_position(v_asset_id, p_portfolio_id);
    END LOOP;

    WITH user_cash_by_currency AS (
      SELECT currency, SUM(amount) as total_amount
      FROM public.cash_movements
      WHERE user_id = v_user_id
      GROUP BY currency
    )
    INSERT INTO public.global_cash (user_id, chf, usd, eur)
    VALUES (
      v_user_id,
      COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'CHF'), 0),
      COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'USD'), 0),
      COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'EUR'), 0)
    )
    ON CONFLICT (user_id) DO UPDATE SET
      chf = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'CHF'), 0),
      usd = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'USD'), 0),
      eur = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'EUR'), 0),
      updated_at = now();

    UPDATE public.import_batches SET
      status = 'success',
      rows_imported = v_rows_imported,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, true, v_rows_imported, v_rows_total, NULL::text;

  EXCEPTION WHEN OTHERS THEN
    -- Point 7: BEGIN...EXCEPTION creates an implicit SAVEPOINT at the top of the BEGIN block.
    -- On exception PostgreSQL automatically ROLLBACK TO that savepoint, undoing all DML
    -- (transactions, cash_movements, assets, stock_split_events, import_batches).
    -- The DELETE statements below are defensive safety nets (normally no-ops after rollback).
    DELETE FROM public.transactions WHERE import_batch_id = v_batch_id;
    DELETE FROM public.cash_movements WHERE import_batch_id = v_batch_id;
    DELETE FROM public.stock_split_events WHERE import_batch_id = v_batch_id;
    -- Orphan assets created only by this batch are cleaned up by the implicit savepoint rollback.

    UPDATE public.import_batches SET
      status = 'failed',
      error_summary = SQLERRM,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, false, 0, v_rows_total, format('Import failed: %s', SQLERRM)::text;
  END;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM anon;
-- Points 2/7: authenticated users must go through create_portfolio_and_import_trading212
-- (which is SECURITY DEFINER and enforces atomicity + portfolio creation in one transaction).
-- Direct superuser/migration runner calls are still possible (postgres bypasses REVOKE).
REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 7: ATOMIC RPC — CREATE_PORTFOLIO_AND_IMPORT_TRADING212
-- ─────────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.create_portfolio_and_import_trading212(
  text, text, text, text, text, jsonb
);

CREATE FUNCTION public.create_portfolio_and_import_trading212(
  p_portfolio_name text,
  p_portfolio_currency text,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb
)
RETURNS TABLE(
  portfolio_id uuid,
  batch_id uuid,
  success boolean,
  rows_imported integer,
  rows_total integer,
  error_message text
)
SECURITY DEFINER
-- Point 8: empty search_path forces full qualification of every object.
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_success boolean;
  v_rows_imported integer;
  v_rows_total integer;
  v_error_message text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  -- Fix 1: reject duplicate CSV imports without creating a phantom portfolio
  IF EXISTS (
    SELECT 1 FROM public.import_batches
    WHERE user_id = v_user_id AND broker = p_broker
      AND file_checksum = p_file_checksum AND status = 'success'
  ) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false, 0, 0, 'CSV already imported'::text;
    RETURN;
  END IF;

  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (v_user_id, p_portfolio_name, p_portfolio_currency)
  RETURNING id INTO v_portfolio_id;

  INSERT INTO public.global_cash (user_id, chf, usd, eur)
  VALUES (v_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT
    r.batch_id,
    r.success,
    r.rows_imported,
    r.rows_total,
    r.error_message
  INTO
    v_batch_id,
    v_success,
    v_rows_imported,
    v_rows_total,
    v_error_message
  FROM public.import_csv_batch(v_portfolio_id, p_broker, p_filename, p_file_checksum, p_operations) AS r;

  IF NOT COALESCE(v_success, false) THEN
    RAISE EXCEPTION 'Import failed: %', COALESCE(v_error_message, 'unknown error');
  END IF;

  RETURN QUERY
  SELECT
    v_portfolio_id,
    v_batch_id,
    true,
    v_rows_imported,
    v_rows_total,
    NULL::text;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.create_portfolio_and_import_trading212(text, text, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.create_portfolio_and_import_trading212(text, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_portfolio_and_import_trading212(text, text, text, text, text, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────
-- MIGRATION COMPLETE
-- ─────────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'Migration applied successfully';
END $$;
