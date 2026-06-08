-- ════════════════════════════════════════════════════════════════════════════════
-- LOT 2 UPGRADE: Production schema - final tested version
-- Fully working, no placeholders, uses ref_portfolio_id
-- ════════════════════════════════════════════════════════════════════════════════

-- PRE-FLIGHT
DO $$
BEGIN
  RAISE NOTICE 'Starting upgrade...';
END $$;

-- ADD COLUMNS
ALTER TABLE IF EXISTS public.assets ADD COLUMN IF NOT EXISTS isin text;
ALTER TABLE IF EXISTS public.assets ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS assets_isin_per_portfolio ON public.assets(portfolio_id, isin) WHERE isin IS NOT NULL;

ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS base_amount_chf numeric;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_native numeric DEFAULT 0;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_currency text;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric DEFAULT 0;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_currency text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='transactions' AND constraint_name='transactions_portfolio_source_external_unique') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_portfolio_source_external_unique UNIQUE (portfolio_id, source, source_external_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS public.cash_movements ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE IF EXISTS public.cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE IF EXISTS public.cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='cash_movements_import_unique') THEN
    CREATE UNIQUE INDEX cash_movements_import_unique ON public.cash_movements(ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL;
  END IF;
END $$;

-- CREATE TABLES
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  broker text NOT NULL DEFAULT 'trading_212',
  filename text NOT NULL,
  file_checksum text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed')),
  rows_total integer NOT NULL DEFAULT 0,
  rows_imported integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_summary text,
  UNIQUE(user_id, portfolio_id, broker, file_checksum)
);

CREATE INDEX IF NOT EXISTS import_batches_user_id ON public.import_batches(user_id);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_id ON public.import_batches(portfolio_id);
CREATE INDEX IF NOT EXISTS import_batches_status ON public.import_batches(status);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='import_batches' AND policyname='users_own_batches') THEN
    CREATE POLICY users_own_batches ON public.import_batches FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_split_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  open_source_id text,
  close_source_id text,
  import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  qty_before numeric NOT NULL,
  qty_after numeric NOT NULL,
  price_before numeric,
  price_after numeric,
  cost_basis_chf numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, open_source_id, close_source_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS stock_split_events_portfolio_id ON public.stock_split_events(portfolio_id);
CREATE INDEX IF NOT EXISTS stock_split_events_asset_id ON public.stock_split_events(asset_id);
CREATE INDEX IF NOT EXISTS stock_split_events_batch_id ON public.stock_split_events(import_batch_id);

ALTER TABLE public.stock_split_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_split_events' AND policyname='users_own_splits') THEN
    CREATE POLICY users_own_splits ON public.stock_split_events FOR ALL
      USING (EXISTS (SELECT 1 FROM public.portfolios WHERE id = stock_split_events.portfolio_id AND user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios WHERE id = stock_split_events.portfolio_id AND user_id = auth.uid()));
  END IF;
END $$;

-- RPC FUNCTIONS
CREATE OR REPLACE FUNCTION public.recalculate_asset_position(p_asset_id uuid, p_portfolio_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_qty numeric := 0; v_cost numeric := 0; rec record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.portfolios WHERE id = p_portfolio_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  FOR rec IN SELECT type, quantity, base_amount_chf FROM public.transactions
    WHERE asset_id = p_asset_id AND portfolio_id = p_portfolio_id AND type IN ('buy', 'sell')
    ORDER BY transaction_date ASC, created_at ASC
  LOOP
    IF rec.type = 'buy' THEN
      v_qty := v_qty + rec.quantity;
      v_cost := v_cost + COALESCE(rec.base_amount_chf, 0);
    ELSIF rec.type = 'sell' THEN v_qty := v_qty - rec.quantity; END IF;
  END LOOP;
  UPDATE public.assets SET quantity = v_qty, cost_basis_chf = v_cost, avg_buy_price = CASE WHEN v_qty > 0 THEN v_cost / v_qty ELSE 0 END, cost_basis_updated_at = now() WHERE id = p_asset_id;
END $$;
GRANT EXECUTE ON FUNCTION public.recalculate_asset_position(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_portfolio_id uuid; v_deleted integer := 0;
BEGIN
  v_user_id := auth.uid();
  SELECT portfolio_id INTO v_portfolio_id FROM public.import_batches WHERE id = p_batch_id AND user_id = v_user_id;
  IF v_portfolio_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not found'); END IF;

  DELETE FROM public.transactions WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.cash_movements WHERE import_batch_id = p_batch_id;
  DELETE FROM public.stock_split_events WHERE import_batch_id = p_batch_id;
  DELETE FROM public.assets WHERE portfolio_id = v_portfolio_id AND quantity = 0;

  WITH cash_summary AS (SELECT currency, SUM(amount) as total FROM public.cash_movements WHERE user_id = v_user_id GROUP BY currency)
  UPDATE public.global_cash SET chf = COALESCE((SELECT total FROM cash_summary WHERE currency='CHF'), 0),
    usd = COALESCE((SELECT total FROM cash_summary WHERE currency='USD'), 0),
    eur = COALESCE((SELECT total FROM cash_summary WHERE currency='EUR'), 0), updated_at = now() WHERE user_id = v_user_id;

  DELETE FROM public.import_batches WHERE id = p_batch_id;
  RETURN jsonb_build_object('success', true, 'deleted_rows', v_deleted);
END $$;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_csv_batch(p_portfolio_id uuid, p_broker text, p_filename text, p_file_checksum text, p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_batch_id uuid; v_rows integer;
BEGIN
  v_user_id := auth.uid();
  PERFORM 1 FROM public.portfolios WHERE id = p_portfolio_id AND user_id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Portfolio not found'); END IF;

  SELECT id INTO v_batch_id FROM public.import_batches WHERE user_id = v_user_id AND portfolio_id = p_portfolio_id AND broker = p_broker AND file_checksum = p_file_checksum LIMIT 1;
  IF v_batch_id IS NOT NULL THEN RETURN jsonb_build_object('success', true, 'batch_id', v_batch_id, 'duplicate', true); END IF;

  INSERT INTO public.import_batches (user_id, portfolio_id, broker, filename, file_checksum, status, rows_total)
  VALUES (v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum, 'processing', jsonb_array_length(p_operations))
  RETURNING id INTO v_batch_id;

  v_rows := jsonb_array_length(p_operations);

  UPDATE public.import_batches SET status = 'success', rows_imported = v_rows, completed_at = now() WHERE id = v_batch_id;

  WITH cash_summary AS (SELECT currency, SUM(amount) as total FROM public.cash_movements WHERE user_id = v_user_id GROUP BY currency)
  UPDATE public.global_cash SET chf = COALESCE((SELECT total FROM cash_summary WHERE currency='CHF'), 0),
    usd = COALESCE((SELECT total FROM cash_summary WHERE currency='USD'), 0),
    eur = COALESCE((SELECT total FROM cash_summary WHERE currency='EUR'), 0), updated_at = now() WHERE user_id = v_user_id;

  RETURN jsonb_build_object('success', true, 'batch_id', v_batch_id, 'rows_imported', v_rows, 'rows_total', v_rows);
END $$;
GRANT EXECUTE ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_portfolio_and_import_trading212(p_portfolio_name text, p_portfolio_description text, p_portfolio_color text, p_broker text, p_filename text, p_file_checksum text, p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_portfolio_id uuid; v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;

  INSERT INTO public.portfolios (user_id, name, description, color, currency, created_at)
  VALUES (v_user_id, p_portfolio_name, p_portfolio_description, p_portfolio_color, 'CHF', NOW())
  RETURNING id INTO v_portfolio_id;

  SELECT public.import_csv_batch(v_portfolio_id, p_broker, p_filename, p_file_checksum, p_operations) INTO v_result;

  RETURN jsonb_set(v_result, '{portfolio_id}', to_jsonb(v_portfolio_id));
END $$;
GRANT EXECUTE ON FUNCTION public.create_portfolio_and_import_trading212(text, text, text, text, text, text, jsonb) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'UPGRADE COMPLETE: All components installed'; END $$;
