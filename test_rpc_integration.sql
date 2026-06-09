-- RPC Integration Tests
-- Test the create_portfolio_and_import_trading212 RPC with minimal BUY operation

\set user_id '11111111-1111-1111-1111-111111111111'

-- Step 0: Verify auth.uid() context
SELECT set_config(
  'request.jwt.claim.sub',
  :'user_id',
  false
);

SELECT 'Auth context set' AS step,
  current_setting('request.jwt.claim.sub') AS jwt_sub;

-- Step 1: Verify auth.uid() function works
DO $$
BEGIN
  IF auth.uid() IS DISTINCT FROM
     '11111111-1111-1111-1111-111111111111'::uuid
  THEN
    RAISE EXCEPTION 'auth.uid() test context is not configured correctly';
  END IF;
  RAISE NOTICE 'auth.uid() context verified: %', auth.uid();
END $$;

-- Step 2: Display function signatures
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'import_csv_batch',
    'rollback_import_batch',
    'recalculate_asset_position',
    'create_portfolio_and_import_trading212'
  )
ORDER BY p.proname;

-- Step 2b: Inspect actual indexes and CHECK constraint on cash_movements
\echo '=== INDEX INSPECTION ==='
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'cash_movements')
ORDER BY tablename, indexname;

\echo '=== CHECK CONSTRAINT cash_movements ==='
SELECT
  conname,
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.cash_movements'::regclass
  AND contype = 'c';

-- Step 3: Test BUY minimal with create_portfolio_and_import_trading212
\echo '=== TEST 1: Create portfolio and import minimal BUY ==='

SELECT
  portfolio_id,
  batch_id,
  success,
  rows_imported,
  rows_total,
  error_message
FROM public.create_portfolio_and_import_trading212(
  'CI Trading212 Test',
  'CHF',
  'trading_212',
  'ci-buy-test.csv',
  'ci-checksum-buy-test',
  jsonb_build_array(
    jsonb_build_object(
      'type', 'buy',
      'date', '2026-01-10',
      'sourceId', 'ci-buy-001',
      'ticker', 'AAPL',
      'name', 'Apple Inc.',
      'quantity', 2,
      'price', 100,
      'currency', 'USD',
      'exchangeRate', 1.111111
    )
  )
) AS import_result;

-- Step 4: Verify BUY result
DO $$
DECLARE
  v_portfolio_id uuid;
  v_tx_count integer;
  v_cm_count integer;
  v_asset_count integer;
  v_asset_qty numeric;
BEGIN
  -- Get the portfolio created by auth.uid()
  SELECT id INTO v_portfolio_id
  FROM public.portfolios
  WHERE user_id = auth.uid()
    AND name = 'CI Trading212 Test'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'Portfolio was not created for auth.uid()=%', auth.uid();
  END IF;

  RAISE NOTICE '✓ Portfolio created: %', v_portfolio_id;

  -- Verify transaction
  SELECT COUNT(*) INTO v_tx_count
  FROM public.transactions
  WHERE portfolio_id = v_portfolio_id
    AND source_external_id = 'ci-buy-001'
    AND type = 'buy';

  IF v_tx_count = 0 THEN
    RAISE EXCEPTION 'BUY transaction was not created (portfolio_id=%, source=trading_212, source_external_id=ci-buy-001)',
      v_portfolio_id;
  END IF;

  RAISE NOTICE '✓ BUY transaction created: %d record(s)', v_tx_count;

  -- Verify cash movement
  SELECT COUNT(*) INTO v_cm_count
  FROM public.cash_movements
  WHERE ref_portfolio_id = v_portfolio_id
    AND source_external_id = 'ci-buy-001';

  IF v_cm_count = 0 THEN
    RAISE EXCEPTION 'BUY cash movement was not created (ref_portfolio_id=%, source=trading_212, source_external_id=ci-buy-001)',
      v_portfolio_id;
  END IF;

  RAISE NOTICE '✓ BUY cash movement created: %d record(s)', v_cm_count;

  -- Verify asset position
  SELECT COUNT(*), COALESCE(SUM(quantity), 0) INTO v_asset_count, v_asset_qty
  FROM public.assets
  WHERE portfolio_id = v_portfolio_id
    AND ticker = 'AAPL';

  IF v_asset_count = 0 OR v_asset_qty != 2 THEN
    RAISE EXCEPTION 'BUY asset position is incorrect (expected 2 AAPL shares, got %d shares from %d assets)',
      v_asset_qty, v_asset_count;
  END IF;

  RAISE NOTICE '✓ BUY asset position correct: AAPL qty=%d', v_asset_qty;

  RAISE NOTICE '=== BUY MINIMAL TEST PASSED ===';
END $$;

-- Step 5: Cleanup (optional - keep snapshot for debugging)
-- DROP TABLE IF EXISTS public._snapshot_portfolios;
-- DROP TABLE IF EXISTS public._snapshot_assets;
-- DROP TABLE IF EXISTS public._snapshot_transactions;
-- DROP TABLE IF EXISTS public._snapshot_cash_movements;
-- DROP TABLE IF EXISTS public._snapshot_global_cash;

\echo '=== ALL RPC INTEGRATION TESTS COMPLETED ==='
