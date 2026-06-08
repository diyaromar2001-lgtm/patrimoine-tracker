-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: Test Queries for Import Schema v4 — REAL RPC CALLS
-- Status: FOR MANUAL TESTING IN SUPABASE DASHBOARD
--
-- IMPORTANT: These tests ACTUALLY CALL the RPC functions.
-- They do NOT use RAISE NOTICE or pseudo-code.
-- Each test calls import_csv_batch() or rollback_import_batch() and verifies results.
--
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- SETUP: Ensure test portfolio exists
-- ═══════════════════════════════════════════════════════════════════════════

-- Create test portfolio (one-time setup)
DO $$
DECLARE
  v_portfolio_id uuid;
BEGIN
  -- Check if test portfolio exists
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  -- If not, create it
  IF v_portfolio_id IS NULL THEN
    INSERT INTO public.portfolios (
      user_id, name, base_currency, created_at
    ) VALUES (
      auth.uid(),
      'LOT2_TEST_PORTFOLIO',
      'CHF',
      now()
    );
    RAISE NOTICE 'Created test portfolio';
  ELSE
    RAISE NOTICE 'Test portfolio already exists: %', v_portfolio_id;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 1: Buy CHF (Simple case)
-- ═══════════════════════════════════════════════════════════════════════════

-- Get test portfolio ID
WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1
)
-- TEST 1: Call RPC with single BUY
SELECT
  'TEST_1_BUY_CHF' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_1_buy_chf.csv',
  'checksum_test_1_buy_chf',
  jsonb_build_array(jsonb_build_object(
    'type', 'buy',
    'date', '2026-06-07',
    'ticker', 'AAPL',
    'name', 'Apple Inc',
    'isin', 'US0378331005',
    'quantity', 100,
    'price', 10.00,
    'priceCurrency', 'CHF',
    'exchangeRate', 1.0,
    'totalAmount', 1000.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_1_BUY_CHF_001'
  ))
) result;

-- VERIFY TEST 1: Check asset was created
SELECT
  'TEST_1_VERIFY_ASSET' as section,
  ticker,
  isin,
  quantity,
  avg_buy_price,
  cost_basis_chf,
  currency
FROM public.assets
WHERE isin = 'US0378331005' AND portfolio_id = (
  SELECT id FROM public.portfolios WHERE name = 'LOT2_TEST_PORTFOLIO'
)
LIMIT 1;

-- VERIFY TEST 1: Check transaction was created
SELECT
  'TEST_1_VERIFY_TRANSACTION' as section,
  type,
  quantity,
  price,
  currency,
  source,
  source_external_id
FROM public.transactions
WHERE source_external_id = 'TEST_1_BUY_CHF_001'
LIMIT 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 2: Buy USD (currency conversion)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_2_BUY_USD' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_2_buy_usd.csv',
  'checksum_test_2_buy_usd',
  jsonb_build_array(jsonb_build_object(
    'type', 'buy',
    'date', '2026-06-07',
    'ticker', 'MSFT',
    'name', 'Microsoft Corporation',
    'isin', 'US5949181045',
    'quantity', 50,
    'price', 200.00,
    'priceCurrency', 'USD',
    'exchangeRate', 1.25,
    'totalAmount', 8000.00,
    'totalCurrency', 'USD',
    'sourceId', 'TEST_2_BUY_USD_001'
  ))
) result;

-- VERIFY TEST 2: Check USD asset with CHF cost basis
SELECT
  'TEST_2_VERIFY_USD_ASSET' as section,
  ticker,
  quantity,
  avg_buy_price,
  cost_basis_chf,
  currency
FROM public.assets
WHERE isin = 'US5949181045'
LIMIT 1;

-- Expected: cost_basis_chf = 8000 / 1.25 = 6400 CHF

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 3: Sell partial (verify cost calculation and P&L)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_3_SELL_PARTIAL' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_3_sell.csv',
  'checksum_test_3_sell',
  jsonb_build_array(jsonb_build_object(
    'type', 'sell',
    'date', '2026-06-08',
    'ticker', 'AAPL',
    'name', 'Apple Inc',
    'isin', 'US0378331005',
    'quantity', 30,
    'price', 12.00,
    'priceCurrency', 'CHF',
    'exchangeRate', 1.0,
    'totalAmount', 360.00,
    'totalCurrency', 'CHF',
    'result', 60.00,
    'sourceId', 'TEST_3_SELL_001'
  ))
) result;

-- VERIFY TEST 3: Check asset qty and cost basis reduced
SELECT
  'TEST_3_VERIFY_ASSET_AFTER_SELL' as section,
  ticker,
  quantity,
  cost_basis_chf
FROM public.assets
WHERE isin = 'US0378331005'
LIMIT 1;

-- Expected: qty = 70 (100-30), cost_basis = 700 (1000 - 300)

-- VERIFY TEST 3: Check P&L in transaction
SELECT
  'TEST_3_VERIFY_SELL_PNL' as section,
  type,
  quantity,
  realized_pnl_chf
FROM public.transactions
WHERE source_external_id = 'TEST_3_SELL_001'
LIMIT 1;

-- Expected: realized_pnl_chf = 60 CHF

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 4: Dividend with withholding tax (fees tracking)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_4_DIVIDEND_WITH_TAX' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_4_dividend.csv',
  'checksum_test_4_dividend',
  jsonb_build_array(jsonb_build_object(
    'type', 'dividend',
    'date', '2026-06-07',
    'ticker', 'AAPL',
    'name', 'Apple Inc',
    'isin', 'US0378331005',
    'quantity', 70,
    'price', 0.25,
    'priceCurrency', 'CHF',
    'totalAmount', 17.50,
    'totalCurrency', 'CHF',
    'withholdingTax', 2.62,
    'withholdingTaxCurrency', 'CHF',
    'sourceId', 'TEST_4_DIVIDEND_001'
  ))
) result;

-- VERIFY TEST 4: Check dividend transaction with withholding
SELECT
  'TEST_4_VERIFY_DIVIDEND' as section,
  type,
  quantity,
  price,
  withholding_tax_amount,
  withholding_tax_currency
FROM public.transactions
WHERE source_external_id = 'TEST_4_DIVIDEND_001'
LIMIT 1;

-- VERIFY TEST 4: Check cash movements for dividend
SELECT
  'TEST_4_VERIFY_CASH' as section,
  type,
  amount,
  source_external_id
FROM public.cash_movements
WHERE source_external_id LIKE 'TEST_4_DIVIDEND%'
ORDER BY created_at;

-- Expected: Two movements: dividend_001_dividend (+17.50) and _withholding (-2.62)

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 5: FX Conversion with fee tracking
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_5_FX_CONVERSION' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_5_fx.csv',
  'checksum_test_5_fx',
  jsonb_build_array(jsonb_build_object(
    'type', 'fx_conversion',
    'date', '2026-06-07',
    'fxFromAmount', 1000.00,
    'fxFromCurrency', 'USD',
    'fxToAmount', 920.00,
    'fxToCurrency', 'CHF',
    'fxFee', 2.00,
    'fxFeeCurrency', 'CHF',
    'sourceId', 'TEST_5_FX_001'
  ))
) result;

-- VERIFY TEST 5: Check two cash movements for FX (debit USD, credit CHF)
SELECT
  'TEST_5_VERIFY_FX' as section,
  type,
  currency,
  amount,
  fx_fee_amount,
  source_external_id
FROM public.cash_movements
WHERE source_external_id LIKE 'TEST_5_FX%'
ORDER BY source_external_id;

-- Expected: _from (USD -1000), _to (CHF +920), _fee (CHF -2 with fx_fee_amount=2)

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 6: Stock split (cost basis unchanged, qty and price updated)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_6_STOCK_SPLIT' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_6_split.csv',
  'checksum_test_6_split',
  jsonb_build_array(jsonb_build_object(
    'type', 'split',
    'date', '2026-06-07',
    'isin', 'US0378331005',
    'openSourceId', 'TEST_6_SPLIT_OPEN',
    'closeSourceId', 'TEST_6_SPLIT_CLOSE',
    'qtyBefore', 70,
    'qtyAfter', 140,
    'priceBefore', 10.00,
    'priceAfter', 5.00
  ))
) result;

-- VERIFY TEST 6: Check asset after split
SELECT
  'TEST_6_VERIFY_ASSET' as section,
  ticker,
  quantity,
  avg_buy_price,
  cost_basis_chf
FROM public.assets
WHERE isin = 'US0378331005'
LIMIT 1;

-- Expected: qty=140, price=5, cost_basis=700 (unchanged)

-- VERIFY TEST 6: Check split event recorded
SELECT
  'TEST_6_VERIFY_SPLIT_EVENT' as section,
  qty_before,
  qty_after,
  price_before,
  price_after,
  cost_basis_chf
FROM public.stock_split_events
WHERE open_source_id = 'TEST_6_SPLIT_OPEN'
LIMIT 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 7: Idempotence (re-import same CSV produces no duplicates)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_7_IDEMPOTENCE_FIRST_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_7_idempotent.csv',
  'checksum_test_7_idempotent',
  jsonb_build_array(jsonb_build_object(
    'type', 'deposit',
    'date', '2026-06-07',
    'totalAmount', 5000.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_7_DEPOSIT_001'
  ))
) result;

-- Now re-import with SAME checksum
WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_7_IDEMPOTENCE_SECOND_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_7_idempotent.csv',  -- SAME filename
  'checksum_test_7_idempotent',  -- SAME checksum
  jsonb_build_array(jsonb_build_object(
    'type', 'deposit',
    'date', '2026-06-07',
    'totalAmount', 5000.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_7_DEPOSIT_001'
  ))
) result;

-- VERIFY TEST 7: Only ONE cash movement should exist
SELECT
  'TEST_7_VERIFY_NO_DUPLICATES' as section,
  COUNT(*) as deposit_count,
  'EXPECTED: 1' as expected
FROM public.cash_movements
WHERE source_external_id = 'TEST_7_DEPOSIT_001';

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 8: Atomicity (one error in batch = entire batch fails)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_8_ATOMICITY_ERROR_IN_BATCH' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_8_atomicity.csv',
  'checksum_test_8_atomicity',
  jsonb_build_array(
    -- Valid operation 1
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 1000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_001'
    ),
    -- Valid operation 2
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 2000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_002'
    ),
    -- INVALID operation 3: Missing totalCurrency
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 3000.00,
      'sourceId', 'TEST_8_DEP_003'
    ),
    -- Valid operation 4 (but will be rolled back)
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 4000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_004'
    )
  )
) result;

-- VERIFY TEST 8: NO deposits should be created (atomic rollback)
SELECT
  'TEST_8_VERIFY_ATOMICITY' as section,
  COUNT(*) as deposits_created,
  'EXPECTED: 0' as expected
FROM public.cash_movements
WHERE source_external_id LIKE 'TEST_8_DEP_%';

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 9: Rollback batch (undo all operations, recalculate assets)
-- ═══════════════════════════════════════════════════════════════════════════

-- First, create a batch with some operations
WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_9_CREATE_BATCH_FOR_ROLLBACK' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_9_rollback.csv',
  'checksum_test_9_rollback',
  jsonb_build_array(
    jsonb_build_object(
      'type', 'buy',
      'date', '2026-06-07',
      'ticker', 'GOOG',
      'name', 'Alphabet Inc',
      'isin', 'US02079K3059',
      'quantity', 10,
      'price', 100.00,
      'priceCurrency', 'USD',
      'exchangeRate', 1.25,
      'totalAmount', 1000.00,
      'totalCurrency', 'USD',
      'sourceId', 'TEST_9_BUY_001'
    )
  )
) result
INTO TEMP TABLE test9_batch_result;

-- Get the batch ID
WITH batch_data AS (
  SELECT batch_id FROM test9_batch_result LIMIT 1
)
-- Now rollback the batch
SELECT
  'TEST_9_ROLLBACK' as test_name,
  result.batch_id,
  result.success,
  result.transactions_deleted,
  result.cash_movements_deleted,
  result.message
FROM batch_data, LATERAL public.rollback_import_batch(batch_data.batch_id) result;

-- VERIFY TEST 9: Asset should be deleted (no transactions remain)
SELECT
  'TEST_9_VERIFY_ASSET_DELETED' as section,
  COUNT(*) as goog_assets,
  'EXPECTED: 0' as expected
FROM public.assets
WHERE isin = 'US02079K3059';

-- VERIFY TEST 9: Batch should be deleted
SELECT
  'TEST_9_VERIFY_BATCH_DELETED' as section,
  COUNT(*) as batches_with_checksum,
  'EXPECTED: 0' as expected
FROM public.import_batches
WHERE file_checksum = 'checksum_test_9_rollback';

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 10: Mixed operations (BUY + SELL + DIVIDEND + DEPOSIT)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
SELECT
  'TEST_10_MIXED_OPERATIONS' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped,
  result.rows_failed,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_10_mixed.csv',
  'checksum_test_10_mixed',
  jsonb_build_array(
    -- Buy
    jsonb_build_object(
      'type', 'buy',
      'date', '2026-06-07',
      'ticker', 'TSLA',
      'name', 'Tesla Inc',
      'isin', 'US88160R1014',
      'quantity', 5,
      'price', 250.00,
      'priceCurrency', 'USD',
      'exchangeRate', 1.25,
      'totalAmount', 1000.00,
      'totalCurrency', 'USD',
      'sourceId', 'TEST_10_BUY_001'
    ),
    -- Deposit
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 5000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_10_DEP_001'
    ),
    -- Sell
    jsonb_build_object(
      'type', 'sell',
      'date', '2026-06-08',
      'ticker', 'TSLA',
      'name', 'Tesla Inc',
      'isin', 'US88160R1014',
      'quantity', 2,
      'price', 260.00,
      'priceCurrency', 'USD',
      'exchangeRate', 1.25,
      'totalAmount', 416.00,
      'totalCurrency', 'USD',
      'result', 32.00,
      'sourceId', 'TEST_10_SELL_001'
    ),
    -- Interest
    jsonb_build_object(
      'type', 'interest',
      'date', '2026-06-07',
      'totalAmount', 10.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_10_INT_001'
    )
  )
) result;

-- VERIFY TEST 10: All operations should be present
SELECT
  'TEST_10_VERIFY_COUNTS' as section,
  (SELECT COUNT(*) FROM public.assets WHERE isin = 'US88160R1014') as assets_count,
  (SELECT COUNT(*) FROM public.transactions WHERE source = 'trading_212' AND source_external_id LIKE 'TEST_10_%') as transactions_count,
  (SELECT COUNT(*) FROM public.cash_movements WHERE source_external_id LIKE 'TEST_10_%') as cash_movements_count;

-- Expected: 1 asset (TSLA), 3 transactions (1 buy + 1 sell + 1 dividend), 3+ cash movements (deposit, interest)

-- ═══════════════════════════════════════════════════════════════════════════
-- SUMMARY: Test Status Check
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  '✅ TEST SUMMARY' as section,
  (SELECT COUNT(*) FROM import_batches WHERE status = 'success') as successful_batches,
  (SELECT COUNT(*) FROM import_batches WHERE status = 'failed') as failed_batches,
  (SELECT COUNT(*) FROM assets WHERE portfolio_id = (SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO')) as total_assets,
  (SELECT COUNT(*) FROM transactions WHERE portfolio_id = (SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO')) as total_transactions,
  (SELECT COUNT(*) FROM cash_movements WHERE user_id = auth.uid()) as total_cash_movements;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF TEST QUERIES v4
-- ════════════════════════════════════════════════════════════════════════════
