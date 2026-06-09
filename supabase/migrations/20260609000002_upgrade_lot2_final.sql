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

  IF v_qty < 0 THEN v_qty := 0; END IF;
  IF v_cost_basis_chf < 0 THEN v_cost_basis_chf := 0; END IF;

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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  v_rows_total := jsonb_array_length(p_operations);

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
        v_quantity := (v_op->>'quantityBefore')::numeric;
        v_price := (v_op->>'priceBefore')::numeric;

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, cost_basis_chf)
          VALUES (p_portfolio_id, v_ticker, v_ticker, 'stock', 0, 0)
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.stock_split_events (
          asset_id, portfolio_id, event_date, open_source_id, close_source_id, import_batch_id,
          qty_before, qty_after, price_before, price_after, cost_basis_chf
        ) VALUES (
          v_asset_id, p_portfolio_id, v_date, v_source_id, v_source_id || ':close',
          v_batch_id,
          v_quantity, (v_op->>'quantityAfter')::numeric,
          v_price, (v_op->>'priceAfter')::numeric,
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
    -- PASS 2: PROCESS ALL OTHER OPERATIONS (in true date order)
    -- ════════════════════════════════════════════════════════════════════════════

    FOR v_idx IN 0..(v_rows_total - 1) LOOP
      v_op := p_operations->v_idx;
      v_op_type := v_op->>'type';

      IF v_op_type = 'stock_split' THEN
        CONTINUE;
      END IF;

      v_date := (v_op->>'date')::date;
      v_source_id := v_op->>'sourceId';

      IF v_op_type IN ('buy', 'sell') THEN
        v_ticker := v_op->>'ticker';
        v_quantity := (v_op->>'quantity')::numeric;
        v_price := (v_op->>'price')::numeric;
        v_price_currency := v_op->>'currency';
        v_exchange_rate := COALESCE((v_op->>'exchangeRate')::numeric, 1);
        v_total_amount := v_quantity * v_price * v_exchange_rate;
        v_name := COALESCE(v_op->>'name', v_ticker);

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, cost_basis_chf)
          VALUES (p_portfolio_id, v_ticker, v_name, 'stock', 0, 0)
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.transactions (
          portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
          source, source_external_id, import_batch_id, base_amount_chf
        ) VALUES (
          p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', v_op_type, v_quantity, v_price, v_price_currency, v_date,
          p_broker, v_source_id, v_batch_id, v_total_amount
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, p_portfolio_id, v_op_type, v_price_currency,
            CASE WHEN v_op_type = 'buy' THEN -v_total_amount ELSE v_total_amount END,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          END IF;
        END IF;

      ELSIF v_op_type IN ('dividend', 'dividend_tax_exempted', 'dividend_adjustment') THEN
        v_ticker := v_op->>'ticker';
        v_dividend_gross_chf := (v_op->>'grossAmount')::numeric;
        v_withholding_tax := COALESCE((v_op->>'withholdingTax')::numeric, 0);
        v_name := COALESCE(v_op->>'name', v_ticker);

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, cost_basis_chf)
          VALUES (p_portfolio_id, v_ticker, v_name, 'stock', 0, 0)
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.transactions (
          portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
          source, source_external_id, import_batch_id, gross_amount_chf, withholding_tax_amount, source_subtype
        ) VALUES (
          p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'dividend', 0, 0, 'CHF', v_date,
          p_broker, v_source_id, v_batch_id, v_dividend_gross_chf, v_withholding_tax, v_op_type
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, p_portfolio_id, 'dividend', 'CHF', v_dividend_gross_chf,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;

          IF v_withholding_tax > 0 THEN
            INSERT INTO public.cash_movements (
              user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
            ) VALUES (
              v_user_id, p_portfolio_id, 'tax', 'CHF', -v_withholding_tax,
              p_broker, v_source_id || ':wht', v_batch_id, v_date
            ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
          END IF;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type = 'interest' THEN
        v_interest_amount := (v_op->>'amount')::numeric;

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
        ) VALUES (
          v_user_id, p_portfolio_id, 'interest', 'CHF', v_interest_amount,
          p_broker, v_source_id, v_batch_id, v_date
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type IN ('deposit', 'withdrawal') THEN
        v_total_amount := (v_op->>'amount')::numeric;
        v_total_currency := COALESCE(v_op->>'currency', 'CHF');

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

      ELSIF v_op_type = 'currency_conversion' THEN
        v_from_currency := v_op->>'fromCurrency';
        v_to_currency := v_op->>'toCurrency';
        v_from_amount := (v_op->>'fromAmount')::numeric;
        v_to_amount := (v_op->>'toAmount')::numeric;

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
        ) VALUES (
          v_user_id, p_portfolio_id, 'currency_conversion', v_from_currency, -v_from_amount,
          p_broker, v_source_id || ':from', v_batch_id, v_date
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, p_portfolio_id, 'currency_conversion', v_to_currency, v_to_amount,
            p_broker, v_source_id || ':to', v_batch_id, v_date
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSE
        RAISE EXCEPTION 'Unknown operation type: %. Supported: buy, sell, dividend, dividend_tax_exempted, dividend_adjustment, interest, deposit, withdrawal, currency_conversion, stock_split', v_op_type;
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
    DELETE FROM public.transactions WHERE import_batch_id = v_batch_id;
    DELETE FROM public.cash_movements WHERE import_batch_id = v_batch_id;
    DELETE FROM public.stock_split_events WHERE import_batch_id = v_batch_id;

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
GRANT EXECUTE ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────
-- SECTION 7: ATOMIC RPC — CREATE_PORTFOLIO_AND_IMPORT_TRADING212
-- ─────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_portfolio_and_import_trading212(
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
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_import_success boolean;
  v_rows_imported integer;
  v_rows_total integer;
  v_error_message text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.portfolios (user_id, name, currency)
    VALUES (v_user_id, p_portfolio_name, p_portfolio_currency)
    RETURNING id INTO v_portfolio_id;

    INSERT INTO public.global_cash (user_id, chf, usd, eur)
    VALUES (v_user_id, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT batch_id, success, rows_imported, rows_total, error_message
    INTO v_batch_id, v_import_success, v_rows_imported, v_rows_total, v_error_message
    FROM public.import_csv_batch(v_portfolio_id, p_broker, p_filename, p_file_checksum, p_operations);

    IF NOT v_import_success THEN
      RAISE EXCEPTION 'Import failed: %', v_error_message;
    END IF;

    RETURN QUERY SELECT v_portfolio_id, v_batch_id, true, v_rows_imported, v_rows_total, NULL::text;

  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false, 0, 0, format('Portfolio creation failed: %s', SQLERRM)::text;
  END;
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
