-- ============================================================================
-- Cost basis CHF migration
-- Run in Supabase Dashboard -> SQL Editor.
--
-- Goal:
-- - Keep invested capital static in base currency (CHF).
-- - Stop recomputing historical cost basis with live FX rates.
-- - Backfill existing rows with an approximate current-rate conversion so the
--   app remains usable until old positions are manually corrected.
-- ============================================================================

alter table assets
  add column if not exists cost_basis_chf numeric not null default 0,
  add column if not exists cost_basis_source text not null default 'computed',
  add column if not exists cost_basis_updated_at timestamptz not null default now();

alter table transactions
  add column if not exists fx_rate_to_chf numeric not null default 1,
  add column if not exists gross_amount_chf numeric not null default 0,
  add column if not exists fees_chf numeric not null default 0,
  add column if not exists net_amount_chf numeric not null default 0,
  add column if not exists realized_pnl_chf numeric not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assets_cost_basis_source_check'
  ) then
    alter table assets
      add constraint assets_cost_basis_source_check
      check (cost_basis_source in ('computed', 'manual', 'backfill'));
  end if;
end $$;

-- Approximate current CHF value for 1 unit of each currency.
-- Replace these constants before running if you want a different backfill rate.
with fx(currency, rate_to_chf) as (
  values
    ('CHF', 1.000000),
    ('USD', 0.789400),
    ('EUR', 0.917000),
    ('GBP', 1.170000)
)
update transactions t
set
  fx_rate_to_chf = fx.rate_to_chf,
  gross_amount_chf = round((t.quantity * t.price * fx.rate_to_chf)::numeric, 8),
  fees_chf = round((t.fees * fx.rate_to_chf)::numeric, 8),
  net_amount_chf = round((
    case
      when t.type = 'buy' then (t.quantity * t.price + t.fees) * fx.rate_to_chf
      when t.type = 'sell' then (t.quantity * t.price - t.fees) * fx.rate_to_chf
      else (t.quantity * t.price) * fx.rate_to_chf
    end
  )::numeric, 8)
from fx
where upper(t.currency) = fx.currency
  and (
    t.fx_rate_to_chf = 1
    or t.gross_amount_chf = 0
    or t.net_amount_chf = 0
  );

-- Fallback for unknown currencies: treat as CHF-equivalent.
update transactions
set
  fx_rate_to_chf = 1,
  gross_amount_chf = round((quantity * price)::numeric, 8),
  fees_chf = round(fees::numeric, 8),
  net_amount_chf = round((
    case
      when type = 'buy' then quantity * price + fees
      when type = 'sell' then quantity * price - fees
      else quantity * price
    end
  )::numeric, 8)
where upper(currency) not in ('CHF', 'USD', 'EUR', 'GBP')
  and (gross_amount_chf = 0 or net_amount_chf = 0);

with fx(currency, rate_to_chf) as (
  values
    ('CHF', 1.000000),
    ('USD', 0.789400),
    ('EUR', 0.917000),
    ('GBP', 1.170000)
)
update assets a
set
  cost_basis_chf = round((a.quantity * a.avg_buy_price * fx.rate_to_chf)::numeric, 8),
  cost_basis_source = 'backfill',
  cost_basis_updated_at = now()
from fx
where upper(a.currency) = fx.currency
  and (a.cost_basis_chf = 0 or a.cost_basis_source = 'computed');

-- Fallback for unknown asset currencies.
update assets
set
  cost_basis_chf = round((quantity * avg_buy_price)::numeric, 8),
  cost_basis_source = 'backfill',
  cost_basis_updated_at = now()
where upper(currency) not in ('CHF', 'USD', 'EUR', 'GBP')
  and cost_basis_chf = 0;

create index if not exists assets_portfolio_ticker_idx
  on assets (portfolio_id, ticker);

create index if not exists transactions_portfolio_ticker_date_idx
  on transactions (portfolio_id, ticker, date);
