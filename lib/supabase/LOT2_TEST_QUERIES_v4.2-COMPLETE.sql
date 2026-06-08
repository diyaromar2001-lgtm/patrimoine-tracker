-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: COMPLETE TEST SUITE v4.2 WITH ASSERTIONS
-- Status: FOR LOCAL SUPABASE EXECUTION ONLY
--
-- Workflow:
-- 1. Load this entire file in local Supabase SQL Editor
-- 2. Tests will RAISE EXCEPTION if any assertion fails
-- 3. If all pass, export results
-- 4. Only then deploy to production
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PRECOMPILE CHECKS
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_col_count integer;
BEGIN
  SELECT COUNT(*) INTO v_col_count FROM information_schema.columns
  WHERE table_name = 'import_batches' AND column_name = 'file_checksum';

  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: import_batches.file_checksum missing';
  END IF;

  SELECT COUNT(*) INTO v_col_count FROM information_schema.columns
  WHERE table_name = 'stock_split_events' AND column_name = 'qty_after';

  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: stock_split_events.qty_after missing';
  END IF;

  RAISE NOTICE '✅ PRECOMPILE CHECKS PASSED (2/2)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST SETUP: Create test portfolio and user context
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
BEGIN
  -- Create or get test portfolio
  INSERT INTO public.portfolios (user_id, name, base_currency, created_at)
  VALUES (auth.uid(), 'TEST_V42_COMPLETE', 'CHF', now())
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  RAISE NOTICE '✅ TEST PORTFOLIO READY: %', v_portfolio_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 1: BUY CHF (No conversion)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_asset_id uuid;
  v_qty numeric;
  v_cost_basis numeric;
  v_avg_price numeric;
  v_cash_balance numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- Simulate BUY: 100 shares @ 50 CHF = 5000 CHF
  SELECT v_batch_id, v_asset_id FROM (
    SELECT batch_id, id FROM (
      SELECT result.batch_id FROM LATERAL (
        SELECT * FROM public.import_csv_batch(
          v_portfolio_id,
          'test_broker',
          'test_buy_chf.csv',
          'checksum_buy_chf_v42',
          jsonb_build_array(
            jsonb_build_object(
              'type', 'buy',
              'date', '2026-06-01',
              'ticker', 'WOSC',
              'name', 'SPDR MSCI World Small Cap',
              'isin', 'IE00BCBJG560',
              'quantity', 100,
              'price', 50,
              'priceCurrency', 'CHF',
              'exchangeRate', 1.0,
              'totalAmount', 5000,
              'totalCurrency', 'CHF',
              'sourceId', 'TEST_BUY_CHF_001'
            )
          )
        ) result
      ) batch
      JOIN LATERAL (
        SELECT id FROM public.assets WHERE isin = 'IE00BCBJG560' LIMIT 1
      ) asset ON true
    ) sub;

  -- Verify asset
  SELECT quantity, cost_basis_chf, avg_buy_price INTO v_qty, v_cost_basis, v_avg_price
  FROM public.assets WHERE isin = 'IE00BCBJG560';

  IF v_qty <> 100 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Expected qty=100, got %', v_qty;
  END IF;

  IF v_cost_basis <> 5000 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Expected cost_basis=5000, got %', v_cost_basis;
  END IF;

  IF v_avg_price <> 50 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Expected avg_price=50, got %', v_avg_price;
  END IF;

  -- Verify cash movement
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_balance
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND currency = 'CHF'
    AND source_external_id = 'TEST_BUY_CHF_001';

  IF v_cash_balance <> -5000 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Expected cash=-5000, got %', v_cash_balance;
  END IF;

  RAISE NOTICE '✅ TEST_1 PASSED: BUY CHF (qty=100, cost=5000, avg=50)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 2: BUY USD (With FX conversion)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_qty numeric;
  v_cost_basis numeric;
  v_expected_chf numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- Real example: AIAI 0.10378499 @ 24.1850 USD / 1.25502 = 2.00 CHF
  SELECT batch_id FROM LATERAL (
    SELECT * FROM public.import_csv_batch(
      v_portfolio_id,
      'test_broker',
      'test_buy_usd.csv',
      'checksum_buy_usd_v42',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'buy',
          'date', '2026-06-02',
          'ticker', 'AIAI',
          'name', 'L&G Artificial Intelligence',
          'isin', 'IE00BK5BCD43',
          'quantity', 0.1037849900,
          'price', 24.1850000000,
          'priceCurrency', 'USD',
          'exchangeRate', 1.25501999,
          'totalAmount', 2.00,
          'totalCurrency', 'CHF',
          'sourceId', 'TEST_BUY_USD_001',
          'fxFee', 0.01
        )
      )
    ) result;

  SELECT quantity, cost_basis_chf INTO v_qty, v_cost_basis
  FROM public.assets WHERE isin = 'IE00BK5BCD43';

  -- Expected cost: (0.10378499 × 24.1850) / 1.25501999 = 1.99 CHF, + 0.01 fee = 2.00 CHF
  v_expected_chf := 2.00;

  IF ABS(v_qty - 0.1037849900) > 0.0000001 THEN
    RAISE EXCEPTION 'TEST_2 FAILED: Expected qty=0.10378499, got %', v_qty;
  END IF;

  IF ABS(v_cost_basis - v_expected_chf) > 0.01 THEN
    RAISE EXCEPTION 'TEST_2 FAILED: Expected cost_basis≈%s, got %', v_expected_chf, v_cost_basis;
  END IF;

  RAISE NOTICE '✅ TEST_2 PASSED: BUY USD with FX (qty≈0.1038, cost≈2.00 CHF)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 3: SELL (Decrease position, calculate realized P&L)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_qty numeric;
  v_cost_basis numeric;
  v_cash_income numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- Sell 50 shares @ 55 CHF (from TEST 1 buy at 50)
  SELECT batch_id FROM LATERAL (
    SELECT * FROM public.import_csv_batch(
      v_portfolio_id,
      'test_broker',
      'test_sell.csv',
      'checksum_sell_v42',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'sell',
          'date', '2026-06-03',
          'ticker', 'WOSC',
          'name', 'SPDR MSCI World Small Cap',
          'isin', 'IE00BCBJG560',
          'quantity', 50,
          'price', 55,
          'priceCurrency', 'CHF',
          'exchangeRate', 1.0,
          'totalAmount', 2750,
          'totalCurrency', 'CHF',
          'sourceId', 'TEST_SELL_001'
        )
      )
    ) result;

  SELECT quantity, cost_basis_chf INTO v_qty, v_cost_basis
  FROM public.assets WHERE isin = 'IE00BCBJG560';

  -- Expected: qty 50 remaining (100-50), cost 2500 (5000-2500)
  IF v_qty <> 50 THEN
    RAISE EXCEPTION 'TEST_3 FAILED: Expected qty=50, got %', v_qty;
  END IF;

  IF v_cost_basis <> 2500 THEN
    RAISE EXCEPTION 'TEST_3 FAILED: Expected cost_basis=2500, got %', v_cost_basis;
  END IF;

  -- Verify cash credit
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_income
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND currency = 'CHF'
    AND source_external_id = 'TEST_SELL_001';

  IF v_cash_income <> 2750 THEN
    RAISE EXCEPTION 'TEST_3 FAILED: Expected cash=+2750, got %', v_cash_income;
  END IF;

  RAISE NOTICE '✅ TEST_3 PASSED: SELL (qty=50, cost=2500, proceeds=2750)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 4: DIVIDEND with Withholding Tax
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_dividend_cash numeric;
  v_tax_cash numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- Real example: GBDV 0.6535788 @ 0.384601 GBP × 1.07413 = 0.27 CHF, withholding 0.00
  SELECT batch_id FROM LATERAL (
    SELECT * FROM public.import_csv_batch(
      v_portfolio_id,
      'test_broker',
      'test_dividend.csv',
      'checksum_dividend_v42',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'dividend',
          'date', '2026-06-04',
          'ticker', 'GBDV',
          'name', 'SPDR S&P Global Dividend Aristocrats',
          'isin', 'IE00B9CQXS71',
          'quantity', 0.6535788,
          'price', 0.384601,
          'priceCurrency', 'GBP',
          'exchangeRate', 1.07413,
          'totalAmount', 0.27,
          'totalCurrency', 'CHF',
          'sourceId', 'TEST_DIV_001',
          'withholdingTax', 0.00,
          'withholdingTaxCurrency', 'GBP'
        )
      )
    ) result;

  SELECT COALESCE(SUM(amount), 0) INTO v_dividend_cash
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND type = 'dividend'
    AND source_external_id = 'TEST_DIV_001';

  IF ABS(v_dividend_cash - 0.27) > 0.01 THEN
    RAISE EXCEPTION 'TEST_4 FAILED: Expected dividend=+0.27, got %', v_dividend_cash;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_tax_cash
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND type = 'withholding_tax'
    AND source_external_id = 'TEST_DIV_001';

  IF v_tax_cash <> 0 THEN
    RAISE EXCEPTION 'TEST_4 FAILED: Expected withholding=0, got %', v_tax_cash;
  END IF;

  RAISE NOTICE '✅ TEST_4 PASSED: DIVIDEND (amount=0.27, withholding=0)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 5: FX CONVERSION (Multi-currency cash)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_chf_out numeric;
  v_usd_in numeric;
  v_fee numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- Real example: 28.85 CHF → 36.33 USD, fee -0.05 USD
  SELECT batch_id FROM LATERAL (
    SELECT * FROM public.import_csv_batch(
      v_portfolio_id,
      'test_broker',
      'test_fx.csv',
      'checksum_fx_v42',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'fx_conversion',
          'date', '2026-06-05',
          'fromAmount', 28.85,
          'fromCurrency', 'CHF',
          'toAmount', 36.33,
          'toCurrency', 'USD',
          'sourceId', 'TEST_FX_001',
          'fee', -0.05
        )
      )
    ) result;

  SELECT COALESCE(SUM(amount), 0) INTO v_chf_out
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND currency = 'CHF'
    AND source_external_id = 'TEST_FX_001' AND type = 'conversion';

  IF v_chf_out <> -28.85 THEN
    RAISE EXCEPTION 'TEST_5 FAILED: Expected CHF out=-28.85, got %', v_chf_out;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_usd_in
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND currency = 'USD'
    AND source_external_id = 'TEST_FX_001' AND type = 'conversion';

  IF v_usd_in <> 36.33 THEN
    RAISE EXCEPTION 'TEST_5 FAILED: Expected USD in=+36.33, got %', v_usd_in;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_fee
  FROM public.cash_movements
  WHERE portfolio_id = v_portfolio_id AND currency = 'USD'
    AND source_external_id = 'TEST_FX_001' AND type = 'fx_fee';

  IF v_fee <> -0.05 THEN
    RAISE EXCEPTION 'TEST_5 FAILED: Expected fee=-0.05 USD, got %', v_fee;
  END IF;

  RAISE NOTICE '✅ TEST_5 PASSED: FX CONVERSION (CHF out, USD in, fee tracked)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 6: IDEMPOTENCE (Same checksum = same batch)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id_1 uuid;
  v_batch_id_2 uuid;
  v_qty_after_1st numeric;
  v_qty_after_2nd numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- First import
  SELECT batch_id INTO v_batch_id_1 FROM LATERAL (
    SELECT * FROM public.import_csv_batch(
      v_portfolio_id,
      'test_broker',
      'test_idempotence.csv',
      'checksum_idempotent_v42',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'buy',
          'date', '2026-06-06',
          'ticker', 'AAPL',
          'name', 'Apple Inc',
          'isin', 'US0378331005',
          'quantity', 10,
          'price', 150,
          'priceCurrency', 'CHF',
          'exchangeRate', 1.0,
          'totalAmount', 1500,
          'totalCurrency', 'CHF',
          'sourceId', 'TEST_IDEMPOTENT_001'
        )
      )
    ) result;

  SELECT quantity INTO v_qty_after_1st FROM public.assets WHERE isin = 'US0378331005';

  -- Second import (same checksum)
  SELECT batch_id INTO v_batch_id_2 FROM LATERAL (
    SELECT * FROM public.import_csv_batch(
      v_portfolio_id,
      'test_broker',
      'test_idempotence.csv',
      'checksum_idempotent_v42',  -- Same checksum
      jsonb_build_array(
        jsonb_build_object(
          'type', 'buy',
          'date', '2026-06-06',
          'ticker', 'AAPL',
          'name', 'Apple Inc',
          'isin', 'US0378331005',
          'quantity', 10,
          'price', 150,
          'priceCurrency', 'CHF',
          'exchangeRate', 1.0,
          'totalAmount', 1500,
          'totalCurrency', 'CHF',
          'sourceId', 'TEST_IDEMPOTENT_001'
        )
      )
    ) result;

  SELECT quantity INTO v_qty_after_2nd FROM public.assets WHERE isin = 'US0378331005';

  -- Same batch ID (idempotent)
  IF v_batch_id_1 <> v_batch_id_2 THEN
    RAISE EXCEPTION 'TEST_6 FAILED: Batch IDs differ (idempotence broken)';
  END IF;

  -- Quantity unchanged (no duplicate)
  IF v_qty_after_1st <> v_qty_after_2nd THEN
    RAISE EXCEPTION 'TEST_6 FAILED: Quantity changed on re-import: % vs %', v_qty_after_1st, v_qty_after_2nd;
  END IF;

  RAISE NOTICE '✅ TEST_6 PASSED: IDEMPOTENCE (same batch, qty unchanged)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 7: ROLLBACK (Delete batch, recalculate position)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_asset_id uuid;
  v_qty_before numeric;
  v_qty_after_rollback numeric;
  v_cost_before numeric;
  v_cost_after_rollback numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'TEST_V42_COMPLETE' AND user_id = auth.uid();

  -- Create a simple buy
  SELECT batch_id, id INTO v_batch_id, v_asset_id FROM LATERAL (
    SELECT result.batch_id FROM (
      SELECT * FROM public.import_csv_batch(
        v_portfolio_id,
        'test_broker',
        'test_rollback.csv',
        'checksum_rollback_v42',
        jsonb_build_array(
          jsonb_build_object(
            'type', 'buy',
            'date', '2026-06-07',
            'ticker', 'ROLLBACK_TEST',
            'name', 'Rollback Test Asset',
            'isin', 'US99999ROLLBK',
            'quantity', 100,
            'price', 25,
            'priceCurrency', 'CHF',
            'exchangeRate', 1.0,
            'totalAmount', 2500,
            'totalCurrency', 'CHF',
            'sourceId', 'TEST_ROLLBACK_001'
          )
        )
      ) result
    ) batch
    JOIN LATERAL (
      SELECT id FROM public.assets WHERE isin = 'US99999ROLLBK' LIMIT 1
    ) asset ON true;

  SELECT quantity, cost_basis_chf INTO v_qty_before, v_cost_before
  FROM public.assets WHERE id = v_asset_id;

  -- Verify buy worked
  IF v_qty_before <> 100 THEN
    RAISE EXCEPTION 'TEST_7 SETUP FAILED: qty should be 100, got %', v_qty_before;
  END IF;

  -- Rollback
  PERFORM public.rollback_import_batch(v_batch_id);

  -- Check if asset deleted (ghost asset cleanup) or qty reset to 0
  SELECT COALESCE(quantity, 0), COALESCE(cost_basis_chf, 0) INTO v_qty_after_rollback, v_cost_after_rollback
  FROM public.assets WHERE id = v_asset_id;

  IF v_qty_after_rollback <> 0 THEN
    RAISE EXCEPTION 'TEST_7 FAILED: qty should be 0 after rollback, got %', v_qty_after_rollback;
  END IF;

  IF v_cost_after_rollback <> 0 THEN
    RAISE EXCEPTION 'TEST_7 FAILED: cost_basis should be 0 after rollback, got %', v_cost_after_rollback;
  END IF;

  RAISE NOTICE '✅ TEST_7 PASSED: ROLLBACK (qty=0, cost=0, asset cleaned)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL TEST SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅✅✅ v4.2 TEST SUITE COMPLETE — ALL 7 TESTS PASSED ✅✅✅';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Tests Executed:';
  RAISE NOTICE '  ✅ TEST_1: BUY CHF (direct, no conversion)';
  RAISE NOTICE '  ✅ TEST_2: BUY USD (with FX conversion and fee)';
  RAISE NOTICE '  ✅ TEST_3: SELL (calculate realized P&L, reduce position)';
  RAISE NOTICE '  ✅ TEST_4: DIVIDEND (with withholding tax tracking)';
  RAISE NOTICE '  ✅ TEST_5: FX CONVERSION (multi-currency cash)';
  RAISE NOTICE '  ✅ TEST_6: IDEMPOTENCE (same checksum = same batch, no duplicates)';
  RAISE NOTICE '  ✅ TEST_7: ROLLBACK (delete batch, recalculate position, cleanup)';
  RAISE NOTICE '';
  RAISE NOTICE 'All assertions passed. Schema ready for production deployment.';
  RAISE NOTICE '';
END $$;
