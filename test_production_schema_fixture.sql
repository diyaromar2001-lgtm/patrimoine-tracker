-- Production Schema Fixture pour CI
-- Reproduit l'état réel de votre Supabase avant upgrade

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Créer les tables de base (schéma existant)
CREATE TABLE IF NOT EXISTS public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  color text,
  currency text DEFAULT 'CHF',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id),
  ticker text NOT NULL,
  name text NOT NULL,
  asset_class text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  avg_buy_price numeric DEFAULT 0,
  currency text DEFAULT 'CHF',
  cost_basis_chf numeric NOT NULL DEFAULT 0,
  cost_basis_source text DEFAULT 'manual',
  cost_basis_updated_at timestamptz NOT NULL DEFAULT now(),
  sector text,
  country text,
  crypto_custody text,
  staking_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id),
  ticker text NOT NULL,
  asset_name text,
  asset_class text,
  type text NOT NULL CHECK (type IN ('buy', 'sell', 'dividend', 'transfer', 'revenu', 'deposit')),
  quantity numeric,
  price numeric,
  fees numeric DEFAULT 0,
  currency text DEFAULT 'CHF',
  fx_rate_to_chf numeric DEFAULT 1,
  total_chf numeric,
  transaction_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  asset_id uuid REFERENCES public.assets(id),
  gross_amount_chf numeric,
  fees_chf numeric,
  net_amount_chf numeric,
  realized_pnl_chf numeric
);

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'dividend', 'interest', 'tax', 'fee')),
  currency text NOT NULL DEFAULT 'CHF',
  amount numeric NOT NULL,
  balance_after_chf numeric,
  balance_after_usd numeric,
  balance_after_eur numeric,
  note text,
  ref_ticker text,
  ref_portfolio_id uuid REFERENCES public.portfolios(id),
  date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.global_cash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  chf numeric NOT NULL DEFAULT 0,
  usd numeric NOT NULL DEFAULT 0,
  eur numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  name text,
  asset_class text,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- Activer RLS sur les tables
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

-- Créer les policies permissives existantes (allow_all_*)
CREATE POLICY "allow_all_portfolios" ON public.portfolios FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_assets" ON public.assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_transactions" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cash_movements" ON public.cash_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_watchlist" ON public.watchlist FOR ALL USING (true) WITH CHECK (true);

-- Insérer des données historiques (53 avec ref_portfolio_id, 37 avec NULL)
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_portfolio_id uuid;
  v_asset_id uuid;
  i integer;
BEGIN
  -- Créer 1 portefeuille
  INSERT INTO public.portfolios (id, user_id, name, currency)
  VALUES (gen_random_uuid(), v_user_id, 'Historical Portfolio', 'CHF')
  RETURNING id INTO v_portfolio_id;

  -- Créer 5 assets historiques
  FOR i IN 1..5 LOOP
    INSERT INTO public.assets (id, portfolio_id, ticker, name, asset_class, quantity, cost_basis_chf, cost_basis_source)
    VALUES (gen_random_uuid(), v_portfolio_id, 'TICK' || i, 'Asset ' || i, 'stock', i * 10, i * 1000, 'manual')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Insérer 20 transactions historiques
  FOR i IN 1..20 LOOP
    INSERT INTO public.transactions (id, portfolio_id, asset_id, ticker, asset_name, type, quantity, price, gross_amount_chf, net_amount_chf, transaction_date)
    SELECT gen_random_uuid(), v_portfolio_id, id, 'TICK1', 'Asset 1', CASE WHEN i % 3 = 0 THEN 'buy' WHEN i % 3 = 1 THEN 'sell' ELSE 'dividend' END,
      i, 100, i * 100, i * 100, NOW()::date - (20 - i) * interval '1 day'
    FROM public.assets WHERE portfolio_id = v_portfolio_id AND ticker = 'TICK1'
    LIMIT 1;
  END LOOP;

  -- Insérer 90 cash_movements (53 avec ref_portfolio_id, 37 avec NULL)
  FOR i IN 1..90 LOOP
    INSERT INTO public.cash_movements (id, user_id, ref_portfolio_id, type, amount, date)
    VALUES (
      gen_random_uuid(),
      v_user_id,
      CASE WHEN i <= 53 THEN v_portfolio_id ELSE NULL END,
      CASE WHEN i % 4 = 0 THEN 'deposit' WHEN i % 4 = 1 THEN 'withdrawal' WHEN i % 4 = 2 THEN 'dividend' ELSE 'fee' END,
      CASE WHEN i % 4 = 1 THEN -(500 + i * 10) ELSE (500 + i * 10) END,
      NOW()::date - (90 - i) * interval '1 day'
    );
  END LOOP;

  -- Insérer global_cash pour l'utilisateur
  INSERT INTO public.global_cash (id, user_id, chf, usd, eur)
  VALUES (gen_random_uuid(), v_user_id, 5000, 2000, 1500)
  ON CONFLICT (user_id) DO UPDATE SET chf = 5000, usd = 2000, eur = 1500;

END $$;

-- Vérification
SELECT 'Fixture created' as status,
  (SELECT COUNT(*) FROM public.portfolios) as portfolios,
  (SELECT COUNT(*) FROM public.assets) as assets,
  (SELECT COUNT(*) FROM public.transactions) as transactions,
  (SELECT COUNT(*) FROM public.cash_movements) as cash_movements,
  (SELECT COUNT(*) FROM public.cash_movements WHERE ref_portfolio_id IS NOT NULL) as cash_with_portfolio,
  (SELECT COUNT(*) FROM public.cash_movements WHERE ref_portfolio_id IS NULL) as cash_without_portfolio;
