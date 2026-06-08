-- ═══════════════════════════════════════════════════════════════════════
-- Patrimoine Tracker — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── Portfolios ──────────────────────────────────────────────────────────────
create table if not exists portfolios (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid,                         -- null = demo mode (no auth)
  name        text        not null,
  description text,
  color       text        not null default '#3b82f6',
  currency    text        not null default 'CHF',
  created_at  timestamptz not null default now()
);

-- ─── Assets (holdings) ───────────────────────────────────────────────────────
create table if not exists assets (
  id             uuid default gen_random_uuid() primary key,
  portfolio_id   uuid references portfolios(id) on delete cascade,
  ticker         text    not null,
  name           text    not null,
  asset_class    text    not null,  -- stock | etf | crypto | real_estate | bond | cash
  quantity       numeric not null,
  avg_buy_price  numeric not null,
  currency       text    not null default 'CHF',
  cost_basis_chf numeric not null default 0,
  cost_basis_source text not null default 'computed'
    check (cost_basis_source in ('computed', 'manual', 'backfill')),
  cost_basis_updated_at timestamptz not null default now(),
  sector         text,
  country        text,
  crypto_custody text,   -- cold_wallet | hot_wallet | exchange
  staking_enabled boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ─── Transactions ─────────────────────────────────────────────────────────────
create table if not exists transactions (
  id           uuid default gen_random_uuid() primary key,
  portfolio_id uuid references portfolios(id) on delete cascade,
  ticker       text    not null,
  asset_name   text    not null,
  asset_class  text    not null,
  type         text    not null,   -- buy | sell | dividend | transfer
  quantity     numeric not null,
  price        numeric not null,
  fees         numeric not null default 0,
  currency     text    not null default 'CHF',
  fx_rate_to_chf numeric not null default 1,
  gross_amount_chf numeric not null default 0,
  fees_chf numeric not null default 0,
  net_amount_chf numeric not null default 0,
  realized_pnl_chf numeric not null default 0,
  date         date    not null,
  notes        text,
  created_at   timestamptz not null default now()
);

-- ─── Watchlist ───────────────────────────────────────────────────────────────
create table if not exists watchlist (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid,
  ticker      text not null,
  name        text not null,
  asset_class text not null default 'stock',
  added_at    timestamptz not null default now(),
  unique(user_id, ticker)
);

-- ─── Row Level Security (basic — no auth for now) ─────────────────────────────
alter table portfolios  enable row level security;
alter table assets      enable row level security;
alter table transactions enable row level security;
alter table watchlist   enable row level security;

-- Allow all access (no auth) — change to user-scoped policies when auth is added
create policy "allow_all_portfolios"   on portfolios   for all using (true) with check (true);
create policy "allow_all_assets"       on assets       for all using (true) with check (true);
create policy "allow_all_transactions" on transactions  for all using (true) with check (true);
create policy "allow_all_watchlist"    on watchlist    for all using (true) with check (true);

-- ─── Seed with demo data (optional) ──────────────────────────────────────────
-- Run after tables are created to populate with sample portfolios.
-- Comment this out if you want to start fresh.

insert into portfolios (name, description, color, currency) values
  ('Actions & ETF', 'Portefeuille long terme', '#3b82f6', 'CHF'),
  ('Crypto', 'Actifs numériques', '#a78bfa', 'CHF')
on conflict do nothing;
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
