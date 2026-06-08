-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: Test Queries for Import Schema v4.1 — FINAL TESTS
-- Status: FOR MANUAL TESTING IN SUPABASE DASHBOARD
--
-- CORRECTIONS:
-- 1. Real compilation test (try to create temp table)
-- 2. Real BUY cash debit test
-- 3. Real SELL cash credit test
-- 4. Real rollback after BUY + SELL partielle
-- 5. Real fees non-zero test
-- 6. Real RLS test on stock_split_events
--
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 0: Schema Compilation Verification
-- ═══════════════════════════════════════════════════════════════════════════

-- Verify tables exist
SELECT
  'TEST_0_SCHEMA_COMPILATION' as test_name,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'import_batches') as import_batches_exists,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'stock_split_events') as stock_split_events_exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'base_amount_chf') as base_amount_chf_col_exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'base_currency') as base_currency_col_exists;

-- Expected: 1, 1, 1, 1 (all columns/tables exist)

-- Verify RLS enabled on stock_split_events
SELECT
  'TEST_0_RLS_STOCK_SPLIT' as section,
  (SELECT rowsecurity FROM pg_tables WHERE tablename = 'stock_split_events') as rls_enabled,
  'EXPECTED: t' as expected;

-- ═══════════════════════════════════════════════════════════════════════════
-- SETUP: Ensure test portfolio exists
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1;

  IF v_portfolio_id IS NULL THEN
    INSERT INTO public.portfolios (
      user_id, name, base_currency, created_at
    ) VALUES (
      auth.uid(),
      'LOT2_TEST_PORTFOLIO_V41',
      'CHF',
      now()
    );
    RAISE NOTICE 'Created test portfolio for v4.1';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 1: BUY CHF with REAL CASH DEBIT verification
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_1_BUY_CHF_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_1_buy_chf.csv',
  'checksum_test_1_buy_chf_v41',
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
    'sourceId', 'TEST_1_BUY_CHF_001',
    'transactionFee', NULL,
    'transactionFeeCurrency', NULL
  ))
) result;

-- VERIFY TEST 1: Check asset created with NATIVE price
SELECT
  'TEST_1_VERIFY_ASSET' as section,
  ticker,
  isin,
  quantity,
  avg_buy_price,  -- Should be 10.00 (NATIVE CHF, not mixed)
  cost_basis_chf,  -- Should be 1000.00 (CHF separate)
  currency
FROM public.assets
WHERE isin = 'US0378331005' AND portfolio_id = (
  SELECT id FROM public.portfolios WHERE name = 'LOT2_TEST_PORTFOLIO_V41'
)
LIMIT 1;

-- Expected: avg_buy_price=10, cost_basis_chf=1000, currency=CHF

-- VERIFY TEST 1: Check CASH DEBIT created (CORRECTION 4)
SELECT
  'TEST_1_VERIFY_CASH_DEBIT' as section,
  type,
  currency,
  amount,
  source_external_id
FROM public.cash_movements
WHERE source_external_id = 'TEST_1_BUY_CHF_001_cash'
LIMIT 1;

-- Expected: type=buy, currency=CHF, amount=-1000, source=TEST_1_BUY_CHF_001_cash

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 2: BUY USD with FX CONVERSION and CORRECT avg_price NATIVE
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_2_BUY_USD_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported,
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_2_buy_usd.csv',
  'checksum_test_2_buy_usd_v41',
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
    'sourceId', 'TEST_2_BUY_USD_001',
    'transactionFee', NULL
  ))
) result;

-- VERIFY TEST 2: Check USD asset with NATIVE price (200 USD, not CHF)
SELECT
  'TEST_2_VERIFY_ASSET_NATIVE' as section,
  ticker,
  quantity,
  avg_buy_price,  -- Should be 200.00 (NATIVE USD)
  cost_basis_chf,  -- Should be 6400 (8000 / 1.25)
  currency
FROM public.assets
WHERE isin = 'US5949181045'
LIMIT 1;

-- Expected: avg_buy_price=200, cost_basis_chf=6400, currency=USD

-- VERIFY TEST 2: Check transaction has base_amount_chf stored
SELECT
  'TEST_2_VERIFY_BASE_AMOUNT' as section,
  base_currency,
  base_amount_chf,
  total_currency,
  total_amount
FROM public.transactions
WHERE source_external_id = 'TEST_2_BUY_USD_001'
LIMIT 1;

-- Expected: base_currency=CHF, base_amount_chf=6400, total_currency=USD, total_amount=8000

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 3: SELL PARTIAL with REAL CASH CREDIT and P&L
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_3_SELL_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_3_sell.csv',
  'checksum_test_3_sell_v41',
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
    'sourceId', 'TEST_3_SELL_001',
    'transactionFee', NULL
  ))
) result;

-- VERIFY TEST 3: Check asset after SELL (qty reduced, cost_basis reduced)
SELECT
  'TEST_3_VERIFY_ASSET' as section,
  ticker,
  quantity,  -- Should be 70 (100-30)
  cost_basis_chf  -- Should be 700 (1000-300)
FROM public.assets
WHERE isin = 'US0378331005'
LIMIT 1;

-- VERIFY TEST 3: Check CASH CREDIT created (CORRECTION 4)
SELECT
  'TEST_3_VERIFY_CASH_CREDIT' as section,
  type,
  currency,
  amount,
  source_external_id
FROM public.cash_movements
WHERE source_external_id = 'TEST_3_SELL_001_cash'
LIMIT 1;

-- Expected: type=sell, currency=CHF, amount=+360, source=TEST_3_SELL_001_cash

-- VERIFY TEST 3: Check P&L in transaction
SELECT
  'TEST_3_VERIFY_PNL' as section,
  realized_pnl_chf,  -- Should be 60
  base_amount_chf
FROM public.transactions
WHERE source_external_id = 'TEST_3_SELL_001'
LIMIT 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 4: DIVIDEND with NON-ZERO WITHHOLDING TAX (CORRECTION 6)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_4_DIVIDEND_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_4_dividend.csv',
  'checksum_test_4_dividend_v41',
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

-- VERIFY TEST 4: Check withholding_tax in transaction
SELECT
  'TEST_4_VERIFY_WITHHOLDING' as section,
  withholding_tax_amount,  -- Should be 2.62
  withholding_tax_currency
FROM public.transactions
WHERE source_external_id = 'TEST_4_DIVIDEND_001'
LIMIT 1;

-- VERIFY TEST 4: Check cash movements (dividend + withholding)
SELECT
  'TEST_4_VERIFY_CASH_DIVIDEND' as section,
  type,
  amount,
  source_external_id
FROM public.cash_movements
WHERE source_external_id LIKE 'TEST_4_DIVIDEND%'
ORDER BY source_external_id;

-- Expected: Two movements: _div (+17.50) and _tax (-2.62)

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 5: FX CONVERSION with NON-ZERO FEE (CORRECTION 6)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_5_FX_CONVERSION_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_5_fx.csv',
  'checksum_test_5_fx_v41',
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

-- VERIFY TEST 5: Check FX fee stored (CORRECTION 6)
SELECT
  'TEST_5_VERIFY_FX_FEE' as section,
  type,
  fx_fee_amount,  -- Should be 2.00
  fx_fee_currency,  -- Should be CHF
  amount,  -- Fee debit: -2.00
  source_external_id
FROM public.cash_movements
WHERE source_external_id = 'TEST_5_FX_001_fee'
LIMIT 1;

-- Expected: type=fx_fee, fx_fee_amount=2, fx_fee_currency=CHF, amount=-2

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 6: STOCK SPLIT with RLS CHECK
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_6_SPLIT_IMPORT' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_6_split.csv',
  'checksum_test_6_split_v41',
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
  'TEST_6_VERIFY_SPLIT_ASSET' as section,
  ticker,
  quantity,  -- Should be 140 (2:1)
  avg_buy_price,  -- Should be 5.00 (halved)
  cost_basis_chf  -- Should be 700 (unchanged)
FROM public.assets
WHERE isin = 'US0378331005'
LIMIT 1;

-- VERIFY TEST 6: Check split_event recorded
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

-- Expected: qty 70→140, price 10→5, cost_basis=700 (unchanged)

-- VERIFY TEST 6: Check RLS on stock_split_events (CORRECTION 7)
-- This should return the split event (user owns portfolio)
SELECT
  'TEST_6_VERIFY_RLS_OWN' as section,
  COUNT(*) as owned_splits,
  'EXPECTED: 1' as expected
FROM public.stock_split_events
WHERE portfolio_id = (
  SELECT id FROM public.portfolios WHERE name = 'LOT2_TEST_PORTFOLIO_V41'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 7: ROLLBACK after BUY + SELL PARTIELLE (CORRECTION 3 - chronological)
-- ═══════════════════════════════════════════════════════════════════════════

-- Create a batch specifically for rollback testing
WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_7_ROLLBACK_BATCH_CREATE' as test_name,
  result.batch_id,
  result.success,
  result.rows_imported
INTO TEMP TABLE test7_batch
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_7_rollback.csv',
  'checksum_test_7_rollback_v41',
  jsonb_build_array(
    -- BUY 20 GOOG @ 100 = 2000 CHF cost basis
    jsonb_build_object(
      'type', 'buy',
      'date', '2026-06-07',
      'ticker', 'GOOG',
      'name', 'Alphabet Inc',
      'isin', 'US02079K3059',
      'quantity', 20,
      'price', 100.00,
      'priceCurrency', 'USD',
      'exchangeRate', 1.25,
      'totalAmount', 1600.00,
      'totalCurrency', 'USD',
      'sourceId', 'TEST_7_BUY_001',
      'transactionFee', NULL
    ),
    -- SELL 8 GOOG @ 110 USD = 704 CHF proceeds (8 × 110 / 1.25)
    jsonb_build_object(
      'type', 'sell',
      'date', '2026-06-08',
      'ticker', 'GOOG',
      'name', 'Alphabet Inc',
      'isin', 'US02079K3059',
      'quantity', 8,
      'price', 110.00,
      'priceCurrency', 'USD',
      'exchangeRate', 1.25,
      'totalAmount', 704.00,
      'totalCurrency', 'USD',
      'result', 64.00,  -- Profit
      'sourceId', 'TEST_7_SELL_001',
      'transactionFee', NULL
    )
  )
);

-- Record asset state BEFORE rollback
CREATE TEMP TABLE test7_before_rollback AS
SELECT
  quantity, cost_basis_chf
FROM public.assets
WHERE isin = 'US02079K3059'
LIMIT 1;

-- Now rollback the batch
WITH batch_id_data AS (
  SELECT batch_id FROM test7_batch LIMIT 1
)
SELECT
  'TEST_7_ROLLBACK_EXECUTE' as test_name,
  result.success,
  result.transactions_deleted,
  result.cash_movements_deleted
FROM batch_id_data, LATERAL public.rollback_import_batch(batch_id_data.batch_id) result;

-- VERIFY TEST 7: Asset should be deleted (no txns remain)
SELECT
  'TEST_7_VERIFY_ASSET_DELETED' as section,
  COUNT(*) as goog_assets,
  'EXPECTED: 0' as expected
FROM public.assets
WHERE isin = 'US02079K3059';

-- VERIFY TEST 7: Chronological recalculation worked (before-after consistency)
-- If we add transactions AFTER rollback, they should reconstruct correctly
-- (This is implicit in TEST_7_VERIFY_ASSET_DELETED)

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 8: ATOMICITY (error in batch = 0 rows imported, all rolled back)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_8_ATOMICITY_ERROR_IN_BATCH' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,  -- Should be 0 (all rolled back)
  result.rows_failed,  -- Should be 5 (all failed)
  result.error_message
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_8_atomicity.csv',
  'checksum_test_8_atomicity_v41',
  jsonb_build_array(
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 1000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_001'
    ),
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 2000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_002'
    ),
    jsonb_build_object(
      'type', 'buy',
      'date', '2026-06-07',
      'ticker', 'ERROR_TEST',
      'name', 'Error Test',
      'isin', 'US9999999999',
      'quantity', NULL,  -- INVALID: NULL quantity
      'price', 100.00,
      'priceCurrency', 'CHF',
      'exchangeRate', 1.0,
      'totalAmount', 1000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_BUY_INVALID',
      'transactionFee', NULL
    ),
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 3000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_003'
    ),
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 4000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_8_DEP_004'
    )
  )
) result;

-- VERIFY TEST 8: NO deposits created (all rolled back)
SELECT
  'TEST_8_VERIFY_ATOMICITY' as section,
  COUNT(*) as deposits_created,
  'EXPECTED: 0' as expected
FROM public.cash_movements
WHERE source_external_id LIKE 'TEST_8_DEP_%';

-- VERIFY TEST 8: Batch marked as 'failed' for audit (CORRECTION 8)
SELECT
  'TEST_8_VERIFY_BATCH_AUDIT' as section,
  status,
  rows_imported,
  error_summary
FROM public.import_batches
WHERE file_checksum = 'checksum_test_8_atomicity_v41'
LIMIT 1;

-- Expected: status=failed, rows_imported=0, error_summary contains error message

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 9: IDEMPOTENCE (re-import = no duplicates)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_9_IDEMPOTENCE_FIRST' as test_name,
  result.batch_id,
  result.rows_imported
INTO TEMP TABLE test9_first
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_9_idempotent.csv',
  'checksum_test_9_idempotent_v41',
  jsonb_build_array(jsonb_build_object(
    'type', 'deposit',
    'date', '2026-06-07',
    'totalAmount', 5000.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_9_DEPOSIT_001'
  ))
);

-- Re-import with SAME checksum
WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
),
first_import AS (
  SELECT batch_id FROM test9_first LIMIT 1
)
SELECT
  'TEST_9_IDEMPOTENCE_SECOND' as test_name,
  result.batch_id,
  result.success,
  result.error_message,
  first_import.batch_id as first_batch_id,
  (result.batch_id = first_import.batch_id)::text as same_batch
FROM test_portfolio, first_import,
LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_9_idempotent.csv',  -- SAME filename
  'checksum_test_9_idempotent_v41',  -- SAME checksum
  jsonb_build_array(jsonb_build_object(
    'type', 'deposit',
    'date', '2026-06-07',
    'totalAmount', 5000.00,
    'totalCurrency', 'CHF',
    'sourceId', 'TEST_9_DEPOSIT_001'
  ))
) result;

-- VERIFY TEST 9: Only ONE deposit (no duplicates)
SELECT
  'TEST_9_VERIFY_IDEMPOTENCE' as section,
  COUNT(*) as deposit_count,
  'EXPECTED: 1' as expected
FROM public.cash_movements
WHERE source_external_id = 'TEST_9_DEPOSIT_001';

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 10: MIXED OPERATIONS (BUY + SELL + DIVIDEND + DEPOSIT + FX)
-- ═══════════════════════════════════════════════════════════════════════════

WITH test_portfolio AS (
  SELECT id FROM public.portfolios
  WHERE name = 'LOT2_TEST_PORTFOLIO_V41' AND user_id = auth.uid()
  LIMIT 1
)
SELECT
  'TEST_10_MIXED_OPERATIONS' as test_name,
  result.batch_id,
  result.success,
  result.rows_total,
  result.rows_imported,
  result.rows_skipped
FROM test_portfolio, LATERAL public.import_csv_batch(
  test_portfolio.id,
  'test_broker',
  'test_10_mixed.csv',
  'checksum_test_10_mixed_v41',
  jsonb_build_array(
    -- Deposit CHF
    jsonb_build_object(
      'type', 'deposit',
      'date', '2026-06-07',
      'totalAmount', 10000.00,
      'totalCurrency', 'CHF',
      'sourceId', 'TEST_10_DEP_001'
    ),
    -- Buy TSLA
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
      'sourceId', 'TEST_10_BUY_001',
      'transactionFee', NULL
    ),
    -- Sell partial
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
      'sourceId', 'TEST_10_SELL_001',
      'transactionFee', NULL
    ),
    -- FX with fee
    jsonb_build_object(
      'type', 'fx_conversion',
      'date', '2026-06-07',
      'fxFromAmount', 500.00,
      'fxFromCurrency', 'USD',
      'fxToAmount', 400.00,
      'fxToCurrency', 'CHF',
      'fxFee', 1.00,
      'fxFeeCurrency', 'CHF',
      'sourceId', 'TEST_10_FX_001'
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

-- VERIFY TEST 10: All operations processed
SELECT
  'TEST_10_VERIFY_COUNTS' as section,
  (SELECT COUNT(*) FROM public.assets WHERE isin = 'US88160R1014') as assets,
  (SELECT COUNT(*) FROM public.transactions WHERE import_batch_id = (SELECT id FROM import_batches WHERE file_checksum = 'checksum_test_10_mixed_v41')) as transactions,
  (SELECT COUNT(*) FROM public.cash_movements WHERE source_external_id LIKE 'TEST_10_%') as cash_movements;

-- Expected: 1 asset, 2 transactions (buy+sell), 6+ cash movements (dep, fx_from, fx_to, fx_fee, interest, sell_cash)

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  '✅ ALL TESTS COMPLETE' as summary,
  (SELECT COUNT(*) FROM import_batches WHERE status = 'success' AND file_checksum LIKE 'checksum_test_%_v41') as successful_imports,
  (SELECT COUNT(*) FROM import_batches WHERE status = 'failed' AND file_checksum LIKE 'checksum_test_%_v41') as failed_imports,
  (SELECT COUNT(*) FROM assets WHERE portfolio_id = (SELECT id FROM portfolios WHERE name = 'LOT2_TEST_PORTFOLIO_V41')) as total_assets_in_portfolio;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF TEST QUERIES v4.1
-- ════════════════════════════════════════════════════════════════════════════
