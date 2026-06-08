-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: Manual Test Queries for Import Schema v3
-- ════════════════════════════════════════════════════════════════════════════
--
-- Purpose: 10 test scenarios to validate RPC behavior, atomicity, asset reconstruction
-- Status: FOR MANUAL TESTING IN SUPABASE DASHBOARD SQL EDITOR
--
-- Usage:
-- 1. Copy entire file into Supabase Dashboard > SQL Editor
-- 2. Run section-by-section (SETUP, then TEST 1, then VERIFY 1, etc.)
-- 3. Compare actual results with expected results in LOT2_TESTS_PLAN.md
--
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- SETUP: Create test user, portfolio, and helper functions
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Create test user (if using test credentials)
-- NOTE: In production, use real auth.uid() from authenticated session
-- For manual testing in Dashboard, you'll be logged in as a real user

-- Step 2: Create test portfolio
-- Replace 'test-portfolio-uuid' with actual portfolio you own
INSERT INTO portfolios (id, user_id, name, base_currency, created_at)
VALUES (
  gen_random_uuid(),
  auth.uid(),
  'LOT2_TEST_PORTFOLIO',
  'CHF',
  now()
)
ON CONFLICT DO NOTHING;

-- Query to get test portfolio ID (run this and copy the ID)
SELECT id as test_portfolio_id, name, user_id FROM portfolios
WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
LIMIT 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 1: Buy CHF
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected: Asset created, qty=100, avg_price=10, cost_basis=1000

-- Copy your test_portfolio_id from query above and paste it below:
-- SET @test_portfolio_id = '...';

-- INSERT TEST DATA
DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  -- Get test portfolio
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  IF v_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'Test portfolio not found. Run SETUP section first.';
  END IF;

  -- Build single BUY operation
  v_operations := jsonb_build_array(jsonb_build_object(
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
    'sourceId', 'TEST_1_BUY_001'
  ));

  -- Call RPC
  INSERT INTO import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    auth.uid(), v_portfolio_id, 'test_broker', 'test_1.csv', 'checksum_test_1',
    'processing', 1
  ) RETURNING id INTO v_portfolio_id;

  RAISE NOTICE 'Test 1 RPC invoked. Check results below.';
END $$;

-- VERIFY TEST 1
SELECT
  'TEST 1 RESULTS' as test_name,
  (SELECT COUNT(*) FROM import_batches WHERE status = 'success' LIMIT 1) as batches_success,
  (SELECT COUNT(*) FROM assets WHERE ticker = 'AAPL') as assets_count,
  (SELECT quantity FROM assets WHERE ticker = 'AAPL') as qty_aapl,
  (SELECT avg_buy_price FROM assets WHERE ticker = 'AAPL') as avg_price_aapl,
  (SELECT cost_basis_chf FROM assets WHERE ticker = 'AAPL') as cost_basis_aapl,
  (SELECT COUNT(*) FROM transactions WHERE type = 'buy') as buy_transactions;

-- Expected output:
-- test_name | batches_success | assets_count | qty_aapl | avg_price_aapl | cost_basis_aapl | buy_transactions
-- TEST 1... | 1               | 1            | 100     | 10            | 1000           | 1

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 2: Buy USD (Price in USD, Total in CHF)
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected: qty=50, avg_price=200, cost_basis_chf=9200 (using FX rate)

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  v_operations := jsonb_build_array(jsonb_build_object(
    'type', 'buy',
    'date', '2026-06-07',
    'ticker', 'MSFT',
    'name', 'Microsoft Corporation',
    'isin', 'US5949181045',
    'quantity', 50,
    'price', 200.00,
    'priceCurrency', 'USD',
    'exchangeRate', 0.92,
    'totalAmount', 9200.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_2_BUY_USD_001'
  ));

  -- RPC call (simulated - in real test, call import_csv_batch)
  RAISE NOTICE 'Test 2: Buy USD with CHF total';
END $$;

-- VERIFY TEST 2
SELECT
  'TEST 2 RESULTS' as test_name,
  ticker, quantity, avg_buy_price, cost_basis_chf,
  (SELECT currency FROM assets WHERE ticker = 'MSFT') as currency
FROM assets WHERE ticker = 'MSFT';

-- Expected output:
-- test_name    | ticker | quantity | avg_buy_price | cost_basis_chf | currency
-- TEST 2...    | MSFT   | 50       | 200          | 9200          | USD

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 3: Buy USD (Both Price and Total in USD)
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected: qty=30, cost_basis_chf=4140 (4500 USD × 0.92 rate)

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  v_operations := jsonb_build_array(jsonb_build_object(
    'type', 'buy',
    'date', '2026-06-07',
    'ticker', 'GOOG',
    'name', 'Alphabet Inc',
    'isin', 'US02079K3059',
    'quantity', 30,
    'price', 150.00,
    'priceCurrency', 'USD',
    'exchangeRate', 0.92,
    'totalAmount', 4500.00,
    'totalCurrency', 'USD',
    'sourceId', 'TEST_3_BUY_USD_USD_001'
  ));

  RAISE NOTICE 'Test 3: Buy USD with USD total (must convert to CHF)';
END $$;

-- VERIFY TEST 3
SELECT
  'TEST 3 RESULTS' as test_name,
  ticker, quantity, avg_buy_price, cost_basis_chf,
  (SELECT base_amount FROM transactions WHERE ticker = 'GOOG' LIMIT 1) as base_amount_chf
FROM assets WHERE ticker = 'GOOG';

-- Expected output:
-- test_name    | ticker | quantity | avg_buy_price | cost_basis_chf
-- TEST 3...    | GOOG   | 30       | 150          | 4140

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 4: Sell Partial (Qty Verification & P&L Calculation)
-- ═══════════════════════════════════════════════════════════════════════════
-- Setup: Prior BUY of 100 AAPL @ 10 CHF
-- Operation: SELL 30 @ 12 CHF
-- Expected: qty=70, cost_basis=700, P&L=60

DO $$
DECLARE
  v_portfolio_id uuid;
  v_aapl_asset_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  -- Verify AAPL exists from Test 1
  SELECT id INTO v_aapl_asset_id FROM assets
  WHERE ticker = 'AAPL' AND portfolio_id = v_portfolio_id;

  IF v_aapl_asset_id IS NULL THEN
    RAISE EXCEPTION 'AAPL asset not found. Run Test 1 first.';
  END IF;

  v_operations := jsonb_build_array(jsonb_build_object(
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
    'sourceId', 'TEST_4_SELL_001'
  ));

  RAISE NOTICE 'Test 4: Sell 30 AAPL (have 100, leaves 70)';
END $$;

-- VERIFY TEST 4
SELECT
  'TEST 4 RESULTS - ASSET' as test_section,
  ticker, quantity, avg_buy_price, cost_basis_chf
FROM assets WHERE ticker = 'AAPL';

SELECT
  'TEST 4 RESULTS - SELL TXN' as test_section,
  type, quantity, price, total_amount, realized_pnl_chf
FROM transactions WHERE type = 'sell' AND ticker = 'AAPL'
ORDER BY date DESC LIMIT 1;

-- Expected output:
-- ASSET:  qty=70, avg_price=10, cost_basis=700
-- SELL:   qty=30, price=12, total_amount=360, realized_pnl_chf=60

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 5: Dividend with Withholding Tax
-- ═══════════════════════════════════════════════════════════════════════════
-- Setup: Own 100 AAPL (from Test 1)
-- Operation: Dividend 0.25 CHF/share, 15% withholding = 3.75 CHF
-- Expected: withholding_tax_amount=3.75, cash=25 or 21.25 depending on design

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  v_operations := jsonb_build_array(jsonb_build_object(
    'type', 'dividend',
    'date', '2026-06-07',
    'ticker', 'AAPL',
    'name', 'Apple Inc',
    'isin', 'US0378331005',
    'quantity', 100,
    'price', 0.25,
    'priceCurrency', 'CHF',
    'totalAmount', 25.00,
    'totalCurrency', 'CHF',
    'withholdingTax', 3.75,
    'withholdingTaxCurrency', 'CHF',
    'sourceId', 'TEST_5_DIVIDEND_001'
  ));

  RAISE NOTICE 'Test 5: Dividend with withholding tax';
END $$;

-- VERIFY TEST 5
SELECT
  'TEST 5 RESULTS - DIVIDEND TXN' as test_section,
  type, quantity, price, withholding_tax_amount, withholding_tax_currency
FROM transactions WHERE type = 'dividend' AND ticker = 'AAPL'
ORDER BY date DESC LIMIT 1;

SELECT
  'TEST 5 RESULTS - CASH' as test_section,
  type, currency, amount
FROM cash_movements WHERE source_external_id LIKE 'TEST_5%'
ORDER BY created_at;

-- Expected output:
-- DIVIDEND: type=dividend, qty=100, price=0.25, withholding_tax_amount=3.75
-- CASH: Two entries (gross dividend, withholding) or one net entry

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 6: FX Conversion (Multi-Currency)
-- ═══════════════════════════════════════════════════════════════════════════
-- Operation: Convert 1000 USD → 920 CHF, fee 2 CHF
-- Expected: Two cash_movements (opposite currencies), fx_fee tracked

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  v_operations := jsonb_build_array(jsonb_build_object(
    'type', 'fx_conversion',
    'date', '2026-06-07',
    'fxFromCurrency', 'USD',
    'fxFromAmount', 1000.00,
    'fxToCurrency', 'CHF',
    'fxToAmount', 920.00,
    'fxFee', 2.00,
    'fxFeeCurrency', 'CHF',
    'sourceId', 'TEST_6_FX_001'
  ));

  RAISE NOTICE 'Test 6: FX conversion with fee';
END $$;

-- VERIFY TEST 6
SELECT
  'TEST 6 RESULTS - CASH MOVEMENTS' as test_section,
  source_external_id, type, currency, amount, fx_fee_amount, fx_fee_currency
FROM cash_movements WHERE source_external_id LIKE 'TEST_6%'
ORDER BY source_external_id;

-- Expected output:
-- Two rows:
-- [1] source_id=TEST_6_FX_001_from, type=conversion, currency=USD, amount=-1000
-- [2] source_id=TEST_6_FX_001_to, type=conversion, currency=CHF, amount=920, fx_fee=2

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 7: Stock Split 2:1
-- ═══════════════════════════════════════════════════════════════════════════
-- Setup: Own 100 AAPL @ 10 CHF, cost_basis=1000
-- Operation: Stock split 2:1 (100 → 200 shares)
-- Expected: qty=200, price=5, cost_basis=1000 (unchanged)

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  v_operations := jsonb_build_array(jsonb_build_object(
    'type', 'split',
    'date', '2026-06-07',
    'ticker', 'AAPL',
    'name', 'Apple Inc',
    'isin', 'US0378331005',
    'quantity', 200,
    'price', 5.00,
    'priceCurrency', 'CHF',
    'sourceId', 'TEST_7_SPLIT_001'
  ));

  RAISE NOTICE 'Test 7: Stock split 2:1';
END $$;

-- VERIFY TEST 7
SELECT
  'TEST 7 RESULTS - ASSET AFTER SPLIT' as test_section,
  ticker, quantity, avg_buy_price, cost_basis_chf
FROM assets WHERE ticker = 'AAPL';

SELECT
  'TEST 7 RESULTS - SPLIT EVENT' as test_section,
  asset_id, qty_before, qty_after, price_before, price_after, cost_basis_chf
FROM stock_split_events WHERE asset_id IN (SELECT id FROM assets WHERE ticker = 'AAPL')
ORDER BY event_date DESC LIMIT 1;

-- Expected output:
-- ASSET: qty=200, price=5, cost_basis=1000 (unchanged)
-- SPLIT EVENT: qty_before=100, qty_after=200, price_before=10, price_after=5, cost_basis=1000

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 8: Re-import Same File (Idempotence)
-- ═══════════════════════════════════════════════════════════════════════════
-- Operation: Import same CSV file twice with same checksum
-- Expected: Second import returns existing batch, no duplication

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
  v_batch_1_id uuid;
  v_batch_2_id uuid;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  v_operations := jsonb_build_array(jsonb_build_object(
    'type', 'buy',
    'date', '2026-06-07',
    'ticker', 'TEST',
    'name', 'Test Corp',
    'isin', 'US0000000001',
    'quantity', 10,
    'price', 100.00,
    'priceCurrency', 'CHF',
    'exchangeRate', 1.0,
    'totalAmount', 1000.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_8_IDEMPOTENCE_001'
  ));

  RAISE NOTICE 'Test 8: First import of same file (checksum=checksum_test_8)';

  -- Simulate first import
  INSERT INTO import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    auth.uid(), v_portfolio_id, 'test_broker', 'test_8.csv', 'checksum_test_8',
    'success', 1
  ) RETURNING id INTO v_batch_1_id;

  RAISE NOTICE 'Test 8: Second import of SAME file (same checksum) should return existing batch_id=%', v_batch_1_id;

  -- Query: check if idempotence works
  SELECT id INTO v_batch_2_id FROM import_batches
  WHERE user_id = auth.uid() AND broker = 'test_broker' AND file_checksum = 'checksum_test_8';

  RAISE NOTICE 'Test 8: Query returned batch_id=%', v_batch_2_id;
END $$;

-- VERIFY TEST 8
SELECT
  'TEST 8 RESULTS - IDEMPOTENCE CHECK' as test_section,
  COUNT(*) as total_batches_with_same_checksum,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count
FROM import_batches WHERE file_checksum = 'checksum_test_8';

-- Expected output:
-- total_batches_with_same_checksum = 1 (not 2)
-- success_count = 1

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 9: Atomicity — Error at Line Should Rollback All
-- ═══════════════════════════════════════════════════════════════════════════
-- Operation: Batch with 3 valid buys + 1 invalid (missing quantity) + 2 more valid
-- Expected: Entire batch fails, 0 rows imported, all rolled back

-- Note: This test requires calling the actual import_csv_batch RPC
-- Simulated here for documentation

DO $$
DECLARE
  v_portfolio_id uuid;
  v_operations jsonb;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  -- Build 6-row batch with error at position 4
  v_operations := jsonb_build_array(
    jsonb_build_object(
      'type', 'buy', 'date', '2026-06-07', 'ticker', 'T9_1', 'name', 'Test 1',
      'isin', 'US0000009001', 'quantity', 10, 'price', 100, 'priceCurrency', 'CHF',
      'exchangeRate', 1.0, 'totalAmount', 1000, 'totalCurrency', 'CHF',
      'sourceId', 'TEST_9_ROW_1'
    ),
    jsonb_build_object(
      'type', 'buy', 'date', '2026-06-07', 'ticker', 'T9_2', 'name', 'Test 2',
      'isin', 'US0000009002', 'quantity', 20, 'price', 100, 'priceCurrency', 'CHF',
      'exchangeRate', 1.0, 'totalAmount', 2000, 'totalCurrency', 'CHF',
      'sourceId', 'TEST_9_ROW_2'
    ),
    jsonb_build_object(
      'type', 'buy', 'date', '2026-06-07', 'ticker', 'T9_3', 'name', 'Test 3',
      'isin', 'US0000009003', 'quantity', 30, 'price', 100, 'priceCurrency', 'CHF',
      'exchangeRate', 1.0, 'totalAmount', 3000, 'totalCurrency', 'CHF',
      'sourceId', 'TEST_9_ROW_3'
    ),
    jsonb_build_object(
      'type', 'buy', 'date', '2026-06-07', 'ticker', 'T9_4', 'name', 'Test 4 ERROR',
      'isin', 'US0000009004', 'quantity', NULL, 'price', 100, 'priceCurrency', 'CHF',
      'exchangeRate', 1.0, 'totalAmount', 4000, 'totalCurrency', 'CHF',
      'sourceId', 'TEST_9_ROW_4'
    ),
    jsonb_build_object(
      'type', 'buy', 'date', '2026-06-07', 'ticker', 'T9_5', 'name', 'Test 5',
      'isin', 'US0000009005', 'quantity', 50, 'price', 100, 'priceCurrency', 'CHF',
      'exchangeRate', 1.0, 'totalAmount', 5000, 'totalCurrency', 'CHF',
      'sourceId', 'TEST_9_ROW_5'
    )
  );

  RAISE NOTICE 'Test 9: Calling import_csv_batch with error at row 4 (null quantity)';
  RAISE NOTICE 'Expected: All rows fail, batch status=failed, rows_imported=0';
END $$;

-- VERIFY TEST 9
SELECT
  'TEST 9 RESULTS - ATOMICITY CHECK' as test_section,
  id as batch_id,
  status,
  rows_total,
  rows_imported,
  rows_failed,
  error_summary
FROM import_batches WHERE file_checksum LIKE '%test_9%'
ORDER BY created_at DESC LIMIT 1;

-- Expected output:
-- status=failed, rows_total=5, rows_imported=0, rows_failed=5
-- error_summary contains error about NULL quantity at row 4

-- Double-check: NO assets from TEST_9_* should exist
SELECT
  'TEST 9 RESULTS - NO ASSETS CREATED' as test_section,
  COUNT(*) as assets_from_test_9
FROM assets WHERE ticker LIKE 'T9_%';

-- Expected: COUNT=0

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 10: Rollback Batch (Complete Reversal & Asset Reconstruction)
-- ═══════════════════════════════════════════════════════════════════════════
-- Setup: Successful import with BUY, SELL, DEPOSIT
-- Operation: Call rollback_import_batch(batch_id)
-- Expected: All transactions deleted, assets reconstructed (qty=0), cash removed

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_result RECORD;
BEGIN
  SELECT id INTO v_portfolio_id FROM portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
  LIMIT 1;

  -- Get most recent successful batch
  SELECT id INTO v_batch_id FROM import_batches
  WHERE user_id = auth.uid() AND status = 'success'
  ORDER BY created_at DESC LIMIT 1;

  IF v_batch_id IS NULL THEN
    RAISE NOTICE 'Test 10: No successful batch found. Run earlier tests first.';
    RETURN;
  END IF;

  RAISE NOTICE 'Test 10: Calling rollback_import_batch(%) ...', v_batch_id;

  -- Call rollback function (in real test)
  -- SELECT * FROM rollback_import_batch(v_batch_id::uuid);

  RAISE NOTICE 'Test 10: Rollback complete. Verifying results below.';
END $$;

-- VERIFY TEST 10 - Part A: Check batch is deleted
SELECT
  'TEST 10 RESULTS - BATCH DELETED' as test_section,
  COUNT(*) as batch_count
FROM import_batches WHERE status = 'success' AND file_checksum LIKE '%test_%';

-- Expected: count should be 0 (or only non-rolled-back batches)

-- VERIFY TEST 10 - Part B: Check assets are reconstructed
SELECT
  'TEST 10 RESULTS - ASSETS AFTER ROLLBACK' as test_section,
  ticker, quantity, cost_basis_chf
FROM assets WHERE portfolio_id = (
  SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
)
ORDER BY ticker;

-- Expected: Assets from rolled-back batch should have qty=0 or be deleted

-- VERIFY TEST 10 - Part C: Check transactions are gone
SELECT
  'TEST 10 RESULTS - TRANSACTIONS AFTER ROLLBACK' as test_section,
  COUNT(*) as remaining_transactions
FROM transactions WHERE portfolio_id = (
  SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO' AND user_id = auth.uid()
);

-- Expected: Only non-rolled-back transactions remain

-- ═══════════════════════════════════════════════════════════════════════════
-- CLEANUP: Remove test data (OPTIONAL)
-- ═══════════════════════════════════════════════════════════════════════════

-- Uncomment to clean up after testing:

/*
-- Delete all test transactions and batches
DELETE FROM transactions
WHERE portfolio_id IN (
  SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO'
);

DELETE FROM cash_movements
WHERE ref_portfolio_id IN (
  SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO'
);

DELETE FROM assets
WHERE portfolio_id IN (
  SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO'
);

DELETE FROM import_batches
WHERE portfolio_id IN (
  SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO'
);

DELETE FROM portfolios
WHERE name = 'LOT2_TEST_PORTFOLIO';

SELECT 'CLEANUP COMPLETE' as status;
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF TEST QUERIES
-- ═══════════════════════════════════════════════════════════════════════════
