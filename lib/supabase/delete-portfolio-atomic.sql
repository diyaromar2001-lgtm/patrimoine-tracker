-- ═══════════════════════════════════════════════════════════════════════
-- Atomic Portfolio Deletion RPC
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- Create a stored function that atomically deletes a portfolio and all its data
create or replace function delete_portfolio_atomic(portfolio_id_param uuid)
returns table (
  success boolean,
  transactions_deleted int,
  assets_deleted int,
  error_message text
) as $$
declare
  tx_count int;
  asset_count int;
  portfolio_owner uuid;
begin
  -- 1. Verify portfolio exists and get its owner
  select user_id into portfolio_owner from portfolios where id = portfolio_id_param;

  if not found then
    return query select false, 0, 0, 'Portfolio not found'::text;
    return;
  end if;

  -- 2. Count transactions to delete
  select count(*) into tx_count from transactions where portfolio_id = portfolio_id_param;

  -- 3. Count assets to delete
  select count(*) into asset_count from assets where portfolio_id = portfolio_id_param;

  -- 4. Begin atomic deletion (implicit transaction)
  -- PostgreSQL's foreign key cascades handle deletion order automatically
  delete from portfolios where id = portfolio_id_param;

  -- 5. Return success with counts
  return query select true, tx_count, asset_count, null::text;

exception when others then
  -- Automatic rollback on any error (implicit transaction)
  return query select false, 0, 0, sqlerrm::text;
end;
$$ language plpgsql security definer;

-- Grant execution to authenticated users
grant execute on function delete_portfolio_atomic(uuid) to authenticated, anon;

-- ─── Notes ──────────────────────────────────────────────────────────────
-- This function:
-- 1. Verifies portfolio exists
-- 2. Counts transactions and assets BEFORE deletion
-- 3. Deletes portfolio (cascades delete assets + transactions via FK)
-- 4. Returns counts in single atomic operation
-- 5. Auto-rollsback entire transaction if any step fails
-- 6. Works even without explicit user_id check (demo mode compatible)
