-- ════════════════════════════════════════════════════════════════════════════
-- Global Cash — Liquidité globale multi-devises (indépendante des portfolios)
-- Coller dans Supabase > SQL Editor > New Query > Run
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Table global_cash : une ligne par utilisateur
CREATE TABLE IF NOT EXISTS global_cash (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users(id) NOT NULL UNIQUE,
  chf         decimal     NOT NULL DEFAULT 0,
  usd         decimal     NOT NULL DEFAULT 0,
  eur         decimal     NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE global_cash ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'global_cash' AND policyname = 'users_own_global_cash'
  ) THEN
    CREATE POLICY "users_own_global_cash"
      ON global_cash FOR ALL
      USING  (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- 2. Table cash_movements : historique des mouvements de cash
CREATE TABLE IF NOT EXISTS cash_movements (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users(id) NOT NULL,
  type        text        NOT NULL,
  -- 'deposit' | 'withdrawal' | 'conversion' | 'buy_deduction' | 'sell_credit'
  -- | 'dividend_credit' | 'revenue_credit'
  currency    text        NOT NULL DEFAULT 'CHF',
  amount      decimal     NOT NULL,            -- positif = entrée, négatif = sortie
  balance_after_chf decimal,                   -- solde CHF après mouvement
  balance_after_usd decimal,                   -- solde USD après mouvement
  balance_after_eur decimal,                   -- solde EUR après mouvement
  note        text,
  ref_ticker  text,                            -- ticker concerné (achat/vente)
  ref_portfolio_id uuid REFERENCES portfolios(id) ON DELETE SET NULL,
  date        timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cash_movements' AND policyname = 'users_own_cash_movements'
  ) THEN
    CREATE POLICY "users_own_cash_movements"
      ON cash_movements FOR ALL
      USING  (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- 3. Index
CREATE INDEX IF NOT EXISTS cash_movements_user_date
  ON cash_movements(user_id, date DESC);

SELECT 'GLOBAL CASH SCHEMA CREATED' AS status;
