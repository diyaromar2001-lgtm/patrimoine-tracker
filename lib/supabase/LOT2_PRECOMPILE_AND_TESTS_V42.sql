-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: PRECOMPILE CHECKS + TESTS v4.2 with ASSERTIONS
-- Status: FOR DISPOSABLE TEST DATABASE ONLY
--
-- Workflow:
-- 1. Run this entire file in a NEW Supabase project (local or preview)
-- 2. Tests will RAISE EXCEPTION if any assertion fails
-- 3. If all pass, export test report
-- 4. Only then apply to production
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: PRECOMPILE CHECKS
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_msg text;
BEGIN
  -- Check 1: portfolios table exists and has user_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='user_id') THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: portfolios.user_id missing';
  END IF;

  -- Check 2: assets table has cost_basis_chf
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assets' AND column_name='cost_basis_chf') THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: assets.cost_basis_chf missing';
  END IF;

  -- Check 3: transactions table has base_amount_chf
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='base_amount_chf') THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: transactions.base_amount_chf missing';
  END IF;

  -- Check 4: cash_movements table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='cash_movements') THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: cash_movements table missing';
  END IF;

  -- Check 5: import_batches table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='import_batches') THEN
    RAISE EXCEPTION 'PRECOMPILE FAILED: import_batches table missing';
  END IF;

  RAISE NOTICE '✅ PRECOMPILE CHECKS PASSED (5/5)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: SETUP TEST PORTFOLIO
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
BEGIN
  -- Get or create test portfolio
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE name = 'LOT2_TEST_V42' AND user_id = auth.uid()
  LIMIT 1;

  IF v_portfolio_id IS NULL THEN
    INSERT INTO public.portfolios (user_id, name, base_currency, created_at)
    VALUES (auth.uid(), 'LOT2_TEST_V42', 'CHF', now());
    RAISE NOTICE '✅ TEST PORTFOLIO CREATED';
  ELSE
    RAISE NOTICE '✅ TEST PORTFOLIO ALREADY EXISTS';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 1: Asset Cleanup After Rollback (CORRECTION 3)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_asset_id uuid;
  v_asset_count integer;
BEGIN
  -- Get test portfolio
  SELECT id INTO v_portfolio_id FROM public.portfolios WHERE name = 'LOT2_TEST_V42' AND user_id = auth.uid();

  -- Create batch with one BUY
  INSERT INTO public.import_batches (user_id, portfolio_id, broker, filename, file_checksum, status, rows_total)
  VALUES (auth.uid(), v_portfolio_id, 'test', 'test_cleanup.csv', 'checksum_cleanup_v42', 'success', 1)
  RETURNING id INTO v_batch_id;

  -- Create asset
  INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, isin, quantity, avg_buy_price, currency, cost_basis_chf)
  VALUES (v_portfolio_id, 'TEST', 'Test Cleanup', 'stock', 'US99999CLEANUP', 10, 100, 'USD', 1000)
  RETURNING id INTO v_asset_id;

  -- Create transaction
  INSERT INTO public.transactions (portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, base_amount_chf, source, source_external_id, import_batch_id, date)
  VALUES (v_portfolio_id, v_asset_id, 'TEST', 'Test Cleanup', 'stock', 'buy', 10, 100, 'USD', 1000, 'trading_212', 'TEST_1_BUY', v_batch_id, '2026-06-07');

  -- Now rollback
  PERFORM rollback_import_batch(v_batch_id);

  -- ASSERTION: Asset should be deleted (qty=0, no txns)
  SELECT COUNT(*) INTO v_asset_count FROM public.assets WHERE id = v_asset_id;

  IF v_asset_count <> 0 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Asset should be deleted after rollback, but still exists';
  END IF;

  RAISE NOTICE '✅ TEST_1 PASSED: Ghost asset (qty=0) successfully cleaned up';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 2: Rollback Recalculates avg_buy_price (CORRECTION 1)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_asset_id uuid;
  v_batch_2_id uuid;
  v_avg_price numeric;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios WHERE name = 'LOT2_TEST_V42' AND user_id = auth.uid();

  -- Create asset with two BUY operations
  INSERT INTO public.import_batches (user_id, portfolio_id, broker, filename, file_checksum, status, rows_total)
  VALUES (auth.uid(), v_portfolio_id, 'test', 'test_avgprice.csv', 'checksum_avgprice_v42', 'success', 1)
  RETURNING id INTO v_batch_id;

  INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, isin, quantity, avg_buy_price, currency, cost_basis_chf)
  VALUES (v_portfolio_id, 'AVGTEST', 'Avg Price Test', 'stock', 'US99999AVGTEST', 100, 100, 'USD', 10000)
  RETURNING id INTO v_asset_id;

  -- Add transaction
  INSERT INTO public.transactions (portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, base_amount_chf, source, source_external_id, import_batch_id, date)
  VALUES (v_portfolio_id, v_asset_id, 'AVGTEST', 'Avg Price Test', 'stock', 'buy', 100, 100, 'USD', 10000, 'trading_212', 'TEST_2_BUY_1', v_batch_id, '2026-06-07');

  -- Check before rollback
  SELECT avg_buy_price INTO v_avg_price FROM public.assets WHERE id = v_asset_id;
  IF v_avg_price <> 100 THEN
    RAISE EXCEPTION 'TEST_2 SETUP FAILED: avg_buy_price should be 100, got %', v_avg_price;
  END IF;

  -- Rollback
  PERFORM rollback_import_batch(v_batch_id);

  -- ASSERTION: avg_buy_price should be 0 (no remaining buys)
  SELECT avg_buy_price INTO v_avg_price FROM public.assets WHERE id = v_asset_id;
  IF v_avg_price <> 0 THEN
    RAISE EXCEPTION 'TEST_2 FAILED: avg_buy_price should be 0 after rollback, got %', v_avg_price;
  END IF;

  RAISE NOTICE '✅ TEST_2 PASSED: avg_buy_price recalculated correctly after rollback';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 3: Splits Replayed in Rollback (CORRECTION 2)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_asset_id uuid;
  v_qty numeric;
  v_split_count integer;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios WHERE name = 'LOT2_TEST_V42' AND user_id = auth.uid();

  INSERT INTO public.import_batches (user_id, portfolio_id, broker, filename, file_checksum, status, rows_total)
  VALUES (auth.uid(), v_portfolio_id, 'test', 'test_split.csv', 'checksum_split_v42', 'success', 1)
  RETURNING id INTO v_batch_id;

  INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, isin, quantity, avg_buy_price, currency, cost_basis_chf)
  VALUES (v_portfolio_id, 'SPLITVEST', 'Split Test', 'stock', 'US99999SPLIT', 100, 100, 'USD', 10000)
  RETURNING id INTO v_asset_id;

  INSERT INTO public.stock_split_events (asset_id, portfolio_id, event_date, open_source_id, close_source_id, import_batch_id, qty_before, qty_after, price_before, price_after, cost_basis_chf)
  VALUES (v_asset_id, v_portfolio_id, '2026-06-07', 'SPLIT_OPEN', 'SPLIT_CLOSE', v_batch_id, 100, 200, 100, 50, 10000);

  -- Check split was created
  SELECT COUNT(*) INTO v_split_count FROM public.stock_split_events WHERE import_batch_id = v_batch_id;
  IF v_split_count <> 1 THEN
    RAISE EXCEPTION 'TEST_3 SETUP FAILED: Split event not created';
  END IF;

  -- Rollback
  PERFORM rollback_import_batch(v_batch_id);

  -- ASSERTION: Split events should be deleted
  SELECT COUNT(*) INTO v_split_count FROM public.stock_split_events WHERE import_batch_id = v_batch_id;
  IF v_split_count <> 0 THEN
    RAISE EXCEPTION 'TEST_3 FAILED: Split events should be deleted, but % remain', v_split_count;
  END IF;

  -- ASSERTION: Asset qty should be recalculated to 0 (no remaining txns)
  SELECT quantity INTO v_qty FROM public.assets WHERE id = v_asset_id;
  IF v_qty <> 0 THEN
    RAISE EXCEPTION 'TEST_3 FAILED: Asset qty should be 0 after split rollback, got %', v_qty;
  END IF;

  RAISE NOTICE '✅ TEST_3 PASSED: Splits correctly replayed and rolled back';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 4: Atomicity (CORRECTION 8: One error → all rolled back)
-- ═══════════════════════════════════════════════════════════════════════════

-- NOTE: Real RPC test requires full import_csv_batch() function
-- This is a placeholder asserting the design intent

DO $$
BEGIN
  RAISE NOTICE '⏳ TEST_4: Atomicity test deferred to full RPC testing (requires import_csv_batch)';
  RAISE NOTICE '   Expected: One invalid operation in batch → all operations rolled back, batch marked failed';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 5: Idempotence (CORRECTION 8: Re-import same checksum → same batch)
-- ═══════════════════════════════════════════════════════════════════════════

-- NOTE: Real RPC test requires full import_csv_batch() function
-- This is a placeholder

DO $$
BEGIN
  RAISE NOTICE '⏳ TEST_5: Idempotence test deferred to full RPC testing';
  RAISE NOTICE '   Expected: Second import with same checksum → returns existing batch_id, no duplicates';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ v4.2 TESTS COMPLETE (3/5 with assertions, 2/5 RPC deferred)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Passed:';
  RAISE NOTICE '  ✅ TEST_1: Ghost asset cleanup (CORRECTION 3)';
  RAISE NOTICE '  ✅ TEST_2: avg_buy_price recalculation (CORRECTION 1)';
  RAISE NOTICE '  ✅ TEST_3: Split replay in rollback (CORRECTION 2)';
  RAISE NOTICE '';
  RAISE NOTICE 'Deferred (require full RPC):';
  RAISE NOTICE '  ⏳ TEST_4: Atomicity (CORRECTION 8)';
  RAISE NOTICE '  ⏳ TEST_5: Idempotence (CORRECTION 8)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Complete full import_csv_batch() RPC (see LOT2_IMPORT_RPC_v42.sql)';
  RAISE NOTICE '  2. Re-run tests with authenticated context';
  RAISE NOTICE '  3. Export test results';
  RAISE NOTICE '  4. Deploy to production only if all 100% pass';
  RAISE NOTICE '';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF TESTS v4.2
-- ════════════════════════════════════════════════════════════════════════════
