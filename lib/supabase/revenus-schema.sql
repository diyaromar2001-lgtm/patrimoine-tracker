-- ════════════════════════════════════════════════════════════════════════════
-- Patrimoine Tracker — Revenus Annexes
-- Coller dans Supabase > SQL Editor > New Query > Run
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists revenus_annexes (
  id           uuid        default gen_random_uuid() primary key,
  portfolio_id uuid        references portfolios(id) on delete cascade,
  user_id      uuid        references auth.users(id) not null,
  type         text        not null,
  -- 'parrainage' | 'bonus_bienvenue' | 'airdrop' | 'interets'
  -- 'cashback' | 'staking' | 'autre'
  label        text        not null,
  amount       decimal     not null,
  currency     text        not null default 'CHF',
  platform     text,
  date         timestamptz not null default now(),
  notes        text,
  created_at   timestamptz not null default now()
);

-- RLS
alter table revenus_annexes enable row level security;

create policy "users_own_revenus"
  on revenus_annexes for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Also add 'revenu' to transactions type constraint (if you have one)
-- If not, just run this to confirm:
select 'REVENUS ANNEXES TABLE CREATED' as status;

-- ─── Cash / Liquidités ────────────────────────────────────────────────────────
-- Ajouter la colonne cash_balances aux portfolios (JSON)
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS cash_balances jsonb NOT NULL DEFAULT '{"CHF":0,"USD":0,"EUR":0}';

SELECT 'CASH BALANCES COLUMN ADDED' AS status;
