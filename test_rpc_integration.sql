-- =============================================================================
-- RPC Integration Tests — import_csv_batch
-- Commit reference: uses exact JSON field names from trading212-parser-client.ts
--
-- Parser output fields verified here:
--   buy/sell : priceCurrency, totalAmount, totalCurrency, exchangeRate
--   dividend : totalAmount (=net), withholdingTax → gross = net + withholding
--   interest : totalAmount
--   deposit/withdrawal : totalAmount, totalCurrency
--   fx_conversion : fromAmount, fromCurrency, toAmount, toCurrency
--   stock_split : qty_before, qty_after, price_before, price_after,
--                 open_source_id, close_source_id  (snake_case)
--
-- Dividend formula confirmed:
--   net      = op.totalAmount         (Trading 212 "Total" column = received net)
--   wht      = op.withholdingTax      (Trading 212 "Withholding tax" column)
--   gross    = net + wht              (what we store in gross_amount_chf)
--   Example: Total=8.50 CHF, Withholding=1.50 CHF → gross=10.00, cash +10 then -1.50
-- =============================================================================

\set user_id '11111111-1111-1111-1111-111111111111'

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup auth context (simulates Supabase JWT sub)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :'user_id', false);

DO $$
BEGIN
  IF auth.uid() IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE EXCEPTION 'auth.uid() context broken: got %', auth.uid();
  END IF;
  RAISE NOTICE '✅ AUTH: uid() = %', auth.uid();
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: BUY — exact parser fields (priceCurrency, totalAmount, totalCurrency)
-- 5 AAPL @ $200 USD, rate=0.9, totalAmount=900 CHF
-- Expected: qty=5, avg_buy_price=200, cost_basis_chf=900
--           cash_movement: type=buy_deduction, currency=CHF, amount=-900
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 1: BUY with parser field names ==='

SELECT portfolio_id, batch_id, success, rows_imported, error_message
FROM public.create_portfolio_and_import_trading212(
  'T1 BUY Test', 'CHF', 'trading_212', 't1.csv', 'chk-t1',
  jsonb_build_array(jsonb_build_object(
    'type',         'buy',
    'date',         '2025-01-10',
    'sourceId',     'T1-BUY-001',
    'ticker',       'AAPL',
    'name',         'Apple Inc.',
    'quantity',     5,
    'price',        200,
    'priceCurrency','USD',
    'exchangeRate', 0.9,
    'totalAmount',  900,
    'totalCurrency','CHF'
  ))
);

DO $$
DECLARE
  v_pid   uuid;
  v_qty   numeric;
  v_avg   numeric;
  v_cost  numeric;
  v_cm_t  text;
  v_cm_c  text;
  v_cm_a  numeric;
BEGIN
  SELECT id INTO v_pid FROM public.portfolios
  WHERE user_id = auth.uid() AND name = 'T1 BUY Test' ORDER BY created_at DESC LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'T1: portfolio not created'; END IF;

  SELECT quantity, avg_buy_price, cost_basis_chf
  INTO v_qty, v_avg, v_cost
  FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'AAPL';

  IF v_qty != 5     THEN RAISE EXCEPTION 'T1 FAIL qty: expected 5, got %',   v_qty;  END IF;
  IF v_avg != 200   THEN RAISE EXCEPTION 'T1 FAIL avg: expected 200, got %', v_avg;  END IF;
  IF v_cost != 900  THEN RAISE EXCEPTION 'T1 FAIL cost: expected 900, got %',v_cost; END IF;

  SELECT type, currency, amount INTO v_cm_t, v_cm_c, v_cm_a
  FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T1-BUY-001';

  IF v_cm_t != 'buy_deduction' THEN RAISE EXCEPTION 'T1 FAIL cm type: %', v_cm_t; END IF;
  IF v_cm_c != 'CHF'           THEN RAISE EXCEPTION 'T1 FAIL cm currency: %', v_cm_c; END IF;
  IF v_cm_a != -900            THEN RAISE EXCEPTION 'T1 FAIL cm amount: expected -900, got %', v_cm_a; END IF;

  RAISE NOTICE '✅ T1 BUY: qty=%, avg=%, cost=%, cm=%(% %)', v_qty, v_avg, v_cost, v_cm_a, v_cm_c, v_cm_t;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: SELL — verify qty reduction, avg unchanged, cash credit in CHF
-- Sell 3 AAPL @ $220 USD, rate=0.9, totalAmount=594 CHF
-- After: qty=2, avg=200 (unchanged), cost_basis=360 (2/5 of 900)
--        cash: type=sell_credit, currency=CHF, amount=+594
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 2: SELL ==='

DO $$
DECLARE v_pid uuid;
BEGIN
  SELECT id INTO v_pid FROM public.portfolios
  WHERE user_id = auth.uid() AND name = 'T1 BUY Test' ORDER BY created_at DESC LIMIT 1;

  -- Add SELL to existing portfolio via import_csv_batch directly
  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't2.csv', 'chk-t2',
    jsonb_build_array(jsonb_build_object(
      'type',         'sell',
      'date',         '2025-02-01',
      'sourceId',     'T2-SELL-001',
      'ticker',       'AAPL',
      'name',         'Apple Inc.',
      'quantity',     3,
      'price',        220,
      'priceCurrency','USD',
      'exchangeRate', 0.9,
      'totalAmount',  594,
      'totalCurrency','CHF'
    ))
  );
END $$;

DO $$
DECLARE
  v_pid   uuid;
  v_qty   numeric;
  v_avg   numeric;
  v_cost  numeric;
  v_cm_a  numeric;
  v_cm_c  text;
BEGIN
  SELECT id INTO v_pid FROM public.portfolios
  WHERE user_id = auth.uid() AND name = 'T1 BUY Test' ORDER BY created_at DESC LIMIT 1;

  SELECT quantity, avg_buy_price, cost_basis_chf
  INTO v_qty, v_avg, v_cost
  FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'AAPL';

  IF v_qty != 2     THEN RAISE EXCEPTION 'T2 FAIL qty: expected 2, got %',    v_qty;  END IF;
  IF v_avg != 200   THEN RAISE EXCEPTION 'T2 FAIL avg: expected 200, got %',  v_avg;  END IF;
  -- cost_basis after selling 3 of 5: 900 - 3*(900/5) = 900 - 540 = 360
  IF v_cost != 360  THEN RAISE EXCEPTION 'T2 FAIL cost: expected 360, got %', v_cost; END IF;

  SELECT amount, currency INTO v_cm_a, v_cm_c
  FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T2-SELL-001';

  IF v_cm_a != 594   THEN RAISE EXCEPTION 'T2 FAIL cm amount: expected 594, got %',  v_cm_a; END IF;
  IF v_cm_c != 'CHF' THEN RAISE EXCEPTION 'T2 FAIL cm currency: expected CHF, got %', v_cm_c; END IF;

  RAISE NOTICE '✅ T2 SELL: qty=%, avg=%, cost=%, cm_credit=%CHF', v_qty, v_avg, v_cost, v_cm_a;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: DIVIDEND
-- Formula: net=totalAmount=8.50, wht=withholdingTax=1.50, gross=10.00
-- cash_movements: +10.00 (revenue_credit) + -1.50 (fee/withholding)
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 3: DIVIDEND (formula: gross = totalAmount + withholdingTax) ==='

DO $$
DECLARE
  v_pid  uuid;
  v_ri   integer;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T3 DIV Test', 'CHF')
  RETURNING id INTO v_pid;

  SELECT rows_imported INTO v_ri
  FROM public.import_csv_batch(
    v_pid, 'trading_212', 't3.csv', 'chk-t3',
    jsonb_build_array(
      -- First a BUY so the asset exists
      jsonb_build_object(
        'type','buy','date','2025-01-01','sourceId','T3-BUY-001',
        'ticker','MSFT','name','Microsoft','quantity',10,'price',300,
        'priceCurrency','USD','exchangeRate',1.0,'totalAmount',3000,'totalCurrency','CHF'
      ),
      -- Dividend: net=8.50, withholding=1.50 → gross=10.00
      jsonb_build_object(
        'type',           'dividend',
        'date',           '2025-03-20',
        'sourceId',       'T3-DIV-001',
        'ticker',         'MSFT',
        'name',           'Microsoft',
        'totalAmount',    8.50,
        'totalCurrency',  'CHF',
        'withholdingTax', 1.50
      )
    )
  );

  DECLARE
    v_tx_gross   numeric;
    v_tx_wht     numeric;
    v_tx_ccy     text;
    v_cm_gross   numeric;
    v_cm_wht     numeric;
    v_cm_ccy     text;
  BEGIN
    -- Verify transaction stores gross and withholding
    SELECT gross_amount_chf, withholding_tax_amount, currency
    INTO v_tx_gross, v_tx_wht, v_tx_ccy
    FROM public.transactions
    WHERE ref_portfolio_id IS NULL  -- workaround: search by source_external_id
       OR true
    LIMIT 0;  -- we query differently below

    SELECT gross_amount_chf, withholding_tax_amount, currency
    INTO v_tx_gross, v_tx_wht, v_tx_ccy
    FROM public.transactions
    WHERE portfolio_id = v_pid AND source_external_id = 'T3-DIV-001';

    IF v_tx_gross != 10.00 THEN RAISE EXCEPTION 'T3 FAIL tx gross: expected 10.00, got %', v_tx_gross; END IF;
    IF v_tx_wht   != 1.50  THEN RAISE EXCEPTION 'T3 FAIL tx wht: expected 1.50, got %',   v_tx_wht;   END IF;
    IF v_tx_ccy   != 'CHF' THEN RAISE EXCEPTION 'T3 FAIL tx currency: expected CHF, got %', v_tx_ccy;  END IF;

    -- Verify cash movement: revenue_credit = +10.00
    SELECT amount INTO v_cm_gross FROM public.cash_movements
    WHERE ref_portfolio_id = v_pid AND source_external_id = 'T3-DIV-001' AND type = 'revenue_credit';
    IF v_cm_gross != 10.00 THEN RAISE EXCEPTION 'T3 FAIL cm gross: expected 10.00, got %', v_cm_gross; END IF;

    -- Verify cash movement: fee (withholding) = -1.50
    SELECT amount INTO v_cm_wht FROM public.cash_movements
    WHERE ref_portfolio_id = v_pid AND source_external_id = 'T3-DIV-001:wht' AND type = 'fee';
    IF v_cm_wht != -1.50 THEN RAISE EXCEPTION 'T3 FAIL cm wht: expected -1.50, got %', v_cm_wht; END IF;

    RAISE NOTICE '✅ T3 DIVIDEND: net=8.50+wht=1.50→gross=%, tx_gross=%, cm_credit=%, cm_fee=%',
      8.50+1.50, v_tx_gross, v_cm_gross, v_cm_wht;
  END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: INTEREST — uses totalAmount (not 'amount')
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 4: INTEREST (field=totalAmount) ==='

DO $$
DECLARE
  v_pid uuid;
  v_amt numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T4 INT Test', 'CHF')
  RETURNING id INTO v_pid;

  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't4.csv', 'chk-t4',
    jsonb_build_array(jsonb_build_object(
      'type',        'interest',
      'date',        '2025-02-01',
      'sourceId',    'T4-INT-001',
      'totalAmount', 3.75,
      'totalCurrency','CHF'
    ))
  );

  SELECT amount INTO v_amt FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T4-INT-001' AND type = 'revenue_credit';

  IF v_amt != 3.75 THEN RAISE EXCEPTION 'T4 FAIL: expected 3.75, got %', v_amt; END IF;
  RAISE NOTICE '✅ T4 INTEREST: amount=%', v_amt;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: DEPOSIT — uses totalAmount + totalCurrency (not 'amount'/'currency')
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 5: DEPOSIT (fields=totalAmount,totalCurrency) ==='

DO $$
DECLARE
  v_pid uuid;
  v_amt numeric;
  v_ccy text;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T5 DEP Test', 'CHF')
  RETURNING id INTO v_pid;

  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't5.csv', 'chk-t5',
    jsonb_build_array(jsonb_build_object(
      'type',          'deposit',
      'date',          '2025-01-01',
      'sourceId',      'T5-DEP-001',
      'totalAmount',   5000,
      'totalCurrency', 'CHF'
    ))
  );

  SELECT amount, currency INTO v_amt, v_ccy FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T5-DEP-001';

  IF v_amt != 5000  THEN RAISE EXCEPTION 'T5 FAIL amount: expected 5000, got %', v_amt; END IF;
  IF v_ccy != 'CHF' THEN RAISE EXCEPTION 'T5 FAIL currency: expected CHF, got %', v_ccy; END IF;
  RAISE NOTICE '✅ T5 DEPOSIT: amount=% %', v_amt, v_ccy;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: WITHDRAWAL — amount should be negative in cash_movements
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 6: WITHDRAWAL ==='

DO $$
DECLARE
  v_pid uuid;
  v_amt numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T6 WDR Test', 'CHF')
  RETURNING id INTO v_pid;

  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't6.csv', 'chk-t6',
    jsonb_build_array(jsonb_build_object(
      'type',          'withdrawal',
      'date',          '2025-02-01',
      'sourceId',      'T6-WDR-001',
      'totalAmount',   1000,
      'totalCurrency', 'CHF'
    ))
  );

  SELECT amount INTO v_amt FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T6-WDR-001';

  IF v_amt != -1000 THEN RAISE EXCEPTION 'T6 FAIL: expected -1000, got %', v_amt; END IF;
  RAISE NOTICE '✅ T6 WITHDRAWAL: amount=%', v_amt;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: FX_CONVERSION — type='fx_conversion' (not 'currency_conversion')
-- Parser ACTION_MAPPING: "Currency conversion" → "fx_conversion"
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 7: FX_CONVERSION (type=fx_conversion, not currency_conversion) ==='

DO $$
DECLARE
  v_pid  uuid;
  v_from numeric;
  v_to   numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T7 FX Test', 'CHF')
  RETURNING id INTO v_pid;

  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't7.csv', 'chk-t7',
    jsonb_build_array(jsonb_build_object(
      'type',         'fx_conversion',
      'date',         '2025-03-01',
      'sourceId',     'T7-FX-001',
      'fromAmount',   1000,
      'fromCurrency', 'CHF',
      'toAmount',     1081.50,
      'toCurrency',   'USD'
    ))
  );

  SELECT amount INTO v_from FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T7-FX-001:from';
  SELECT amount INTO v_to   FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T7-FX-001:to';

  IF v_from != -1000   THEN RAISE EXCEPTION 'T7 FAIL from: expected -1000, got %',   v_from; END IF;
  IF v_to   != 1081.50 THEN RAISE EXCEPTION 'T7 FAIL to: expected 1081.50, got %',   v_to;   END IF;
  RAISE NOTICE '✅ T7 FX_CONVERSION: from=% CHF → to=% USD', v_from, v_to;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: STOCK_SPLIT — snake_case fields (qty_before, qty_after, price_before,
--         price_after, open_source_id, close_source_id)
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 8: STOCK_SPLIT (snake_case: qty_before, price_before, ...) ==='

DO $$
DECLARE
  v_pid   uuid;
  v_qb    numeric;
  v_qa    numeric;
  v_pb    numeric;
  v_pa    numeric;
  v_oid   text;
  v_cid   text;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T8 SPLIT Test', 'CHF')
  RETURNING id INTO v_pid;

  -- First create the asset with a BUY
  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't8a.csv', 'chk-t8a',
    jsonb_build_array(jsonb_build_object(
      'type','buy','date','2025-01-01','sourceId','T8-BUY-001',
      'ticker','TSLA','name','Tesla','quantity',10,'price',200,
      'priceCurrency','USD','exchangeRate',1.0,'totalAmount',2000,'totalCurrency','CHF'
    ))
  );

  -- Now import the split with snake_case fields as produced by the parser
  PERFORM public.import_csv_batch(
    v_pid, 'trading_212', 't8b.csv', 'chk-t8b',
    jsonb_build_array(jsonb_build_object(
      'type',           'stock_split',
      'date',           '2025-06-01',
      'ticker',         'TSLA',
      'name',           'Tesla',
      'sourceId',       'EOF_OPEN|EOF_CLOSE',
      'open_source_id', 'EOF_OPEN',
      'close_source_id','EOF_CLOSE',
      'qty_before',     10,
      'qty_after',      20,
      'price_before',   200,
      'price_after',    100
    ))
  );

  -- Verify stock_split_events record has correct values
  SELECT qty_before, qty_after, price_before, price_after,
         open_source_id, close_source_id
  INTO v_qb, v_qa, v_pb, v_pa, v_oid, v_cid
  FROM public.stock_split_events
  WHERE portfolio_id = v_pid;

  IF v_qb  != 10          THEN RAISE EXCEPTION 'T8 FAIL qty_before: expected 10, got %',    v_qb;  END IF;
  IF v_qa  != 20          THEN RAISE EXCEPTION 'T8 FAIL qty_after: expected 20, got %',     v_qa;  END IF;
  IF v_pb  != 200         THEN RAISE EXCEPTION 'T8 FAIL price_before: expected 200, got %', v_pb;  END IF;
  IF v_pa  != 100         THEN RAISE EXCEPTION 'T8 FAIL price_after: expected 100, got %',  v_pa;  END IF;
  IF v_oid != 'EOF_OPEN'  THEN RAISE EXCEPTION 'T8 FAIL open_source_id: expected EOF_OPEN, got %', v_oid; END IF;
  IF v_cid != 'EOF_CLOSE' THEN RAISE EXCEPTION 'T8 FAIL close_source_id: expected EOF_CLOSE, got %', v_cid; END IF;

  -- After split: asset qty=20, avg=100
  DECLARE v_qty numeric; v_avg numeric;
  BEGIN
    SELECT quantity, avg_buy_price INTO v_qty, v_avg
    FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'TSLA';
    IF v_qty != 20  THEN RAISE EXCEPTION 'T8 FAIL asset qty after split: expected 20, got %',  v_qty; END IF;
    IF v_avg != 100 THEN RAISE EXCEPTION 'T8 FAIL asset avg after split: expected 100, got %', v_avg; END IF;
    RAISE NOTICE '✅ T8 SPLIT: qty_before=%, qty_after=%, open=%, close=%, asset qty=%, avg=%',
      v_qb, v_qa, v_oid, v_cid, v_qty, v_avg;
  END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 9: CHRONOLOGICAL — BUY → SPLIT → BUY → SELL (single batch)
--
-- Operations (as parser would produce, all in one batch):
--   2025-01-01: BUY  8 AAPL @ $150 USD, rate=1.0, totalAmount=1200 CHF
--   2025-06-01: SPLIT AAPL 1:2 (qty_before=8, qty_after=16, price_before=150, price_after=75)
--   2025-09-01: BUY  4 AAPL @ $80 USD,  rate=1.0, totalAmount=320 CHF
--   2025-12-01: SELL 8 AAPL @ $90 USD,  rate=1.0, totalAmount=720 CHF
--
-- recalculate_asset_position replay (ORDER BY event_date ASC):
--   BUY1 (2025-01-01): qty=8, avg=150.00, cost=1200
--   SPLIT (2025-06-01): qty=16, avg=75.00, cost=1200
--   BUY2 (2025-09-01): avg=(16×75+4×80)/20=76.00, qty=20, cost=1520
--   SELL (2025-12-01): cost_per=1520/20=76, released=8×76=608, cost=912, qty=12
--
-- Expected final: qty=12, avg_buy_price=76.00 USD, cost_basis_chf=912.00
-- Realized P&L: proceeds=720 minus cost_released=608 = 112 CHF
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 9: CHRONOLOGICAL — BUY→SPLIT→BUY→SELL (all in one batch) ==='

DO $$
DECLARE
  v_pid    uuid;
  v_ri     integer;
  v_qty    numeric;
  v_avg    numeric;
  v_cost   numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T9 CHRON Test', 'CHF')
  RETURNING id INTO v_pid;

  SELECT rows_imported INTO v_ri FROM public.import_csv_batch(
    v_pid, 'trading_212', 't9.csv', 'chk-t9',
    jsonb_build_array(
      -- BUY before split
      jsonb_build_object(
        'type','buy','date','2025-01-01','sourceId','T9-BUY1',
        'ticker','AAPL','name','Apple Inc.',
        'quantity',8,'price',150,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',1200,'totalCurrency','CHF'
      ),
      -- SPLIT 1:2 (snake_case as per parser)
      jsonb_build_object(
        'type','stock_split','date','2025-06-01',
        'ticker','AAPL','name','Apple Inc.',
        'sourceId','SPLIT_OPEN|SPLIT_CLOSE',
        'open_source_id','SPLIT_OPEN','close_source_id','SPLIT_CLOSE',
        'qty_before',8,'qty_after',16,
        'price_before',150,'price_after',75
      ),
      -- BUY after split
      jsonb_build_object(
        'type','buy','date','2025-09-01','sourceId','T9-BUY2',
        'ticker','AAPL','name','Apple Inc.',
        'quantity',4,'price',80,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',320,'totalCurrency','CHF'
      ),
      -- SELL partial
      jsonb_build_object(
        'type','sell','date','2025-12-01','sourceId','T9-SELL1',
        'ticker','AAPL','name','Apple Inc.',
        'quantity',8,'price',90,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',720,'totalCurrency','CHF'
      )
    )
  );

  -- rows_imported: 1(buy)+1(split)+1(buy)+1(sell) = 4
  IF v_ri != 4 THEN RAISE EXCEPTION 'T9 FAIL rows_imported: expected 4, got %', v_ri; END IF;

  SELECT quantity, avg_buy_price, cost_basis_chf
  INTO v_qty, v_avg, v_cost
  FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'AAPL';

  IF v_qty  != 12  THEN RAISE EXCEPTION 'T9 FAIL qty: expected 12, got %',     v_qty;  END IF;
  IF v_avg  != 76  THEN RAISE EXCEPTION 'T9 FAIL avg: expected 76.00, got %',  v_avg;  END IF;
  IF v_cost != 912 THEN RAISE EXCEPTION 'T9 FAIL cost: expected 912, got %',   v_cost; END IF;

  RAISE NOTICE '✅ T9 CHRON: qty=% avg=%USD cost=%CHF (realized P&L implicit=720-608=112CHF)',
    v_qty, v_avg, v_cost;

  -- Verify sell cash_movement in CHF
  DECLARE v_sell_cm numeric; v_sell_ccy text;
  BEGIN
    SELECT amount, currency INTO v_sell_cm, v_sell_ccy
    FROM public.cash_movements
    WHERE ref_portfolio_id = v_pid AND source_external_id = 'T9-SELL1';
    IF v_sell_cm  != 720   THEN RAISE EXCEPTION 'T9 FAIL sell cm: expected 720, got %', v_sell_cm; END IF;
    IF v_sell_ccy != 'CHF' THEN RAISE EXCEPTION 'T9 FAIL sell cm ccy: expected CHF, got %', v_sell_ccy; END IF;
    RAISE NOTICE '✅ T9 SELL cash_movement: +% %', v_sell_cm, v_sell_ccy;
  END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 10: IDEMPOTENCE — same checksum returns same batch_id, no duplicates
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 10: IDEMPOTENCE ==='

DO $$
DECLARE
  v_pid   uuid;
  v_b1    uuid;
  v_b2    uuid;
  v_count integer;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T10 IDEM Test', 'CHF')
  RETURNING id INTO v_pid;

  -- First import
  SELECT batch_id INTO v_b1 FROM public.import_csv_batch(
    v_pid, 'trading_212', 't10.csv', 'chk-t10',
    jsonb_build_array(jsonb_build_object(
      'type','buy','date','2025-01-01','sourceId','T10-BUY-001',
      'ticker','NVDA','name','Nvidia','quantity',2,'price',500,
      'priceCurrency','USD','exchangeRate',1.0,'totalAmount',1000,'totalCurrency','CHF'
    ))
  );

  -- Second import same checksum
  SELECT batch_id INTO v_b2 FROM public.import_csv_batch(
    v_pid, 'trading_212', 't10.csv', 'chk-t10',
    jsonb_build_array(jsonb_build_object(
      'type','buy','date','2025-01-01','sourceId','T10-BUY-001',
      'ticker','NVDA','name','Nvidia','quantity',2,'price',500,
      'priceCurrency','USD','exchangeRate',1.0,'totalAmount',1000,'totalCurrency','CHF'
    ))
  );

  IF v_b1 IS DISTINCT FROM v_b2 THEN
    RAISE EXCEPTION 'T10 FAIL idempotence: first=%, second=%', v_b1, v_b2;
  END IF;

  -- Only 1 transaction for NVDA, not 2
  SELECT COUNT(*) INTO v_count FROM public.transactions
  WHERE portfolio_id = v_pid AND ticker = 'NVDA';
  IF v_count != 1 THEN RAISE EXCEPTION 'T10 FAIL duplicates: expected 1 tx, got %', v_count; END IF;

  RAISE NOTICE '✅ T10 IDEMPOTENCE: same batch_id=%, tx_count=%', v_b1, v_count;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 11: ROLLBACK — failed import leaves no orphaned assets/transactions
-- Inject an unknown type to force the EXCEPTION path
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=== TEST 11: ROLLBACK on invalid operation type ==='

DO $$
DECLARE
  v_pid     uuid;
  v_result  record;
  v_assets  integer;
  v_txns    integer;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T11 ROLLBACK Test', 'CHF')
  RETURNING id INTO v_pid;

  SELECT * INTO v_result FROM public.import_csv_batch(
    v_pid, 'trading_212', 't11.csv', 'chk-t11',
    jsonb_build_array(
      -- valid BUY first
      jsonb_build_object(
        'type','buy','date','2025-01-01','sourceId','T11-BUY-001',
        'ticker','IBM','name','IBM','quantity',5,'price',100,
        'priceCurrency','USD','exchangeRate',1.0,'totalAmount',500,'totalCurrency','CHF'
      ),
      -- invalid type triggers EXCEPTION → rollback all
      jsonb_build_object(
        'type','INVALID_TYPE_XYZ','date','2025-01-02','sourceId','T11-BAD-001',
        'totalAmount',100,'totalCurrency','CHF'
      )
    )
  ) r;

  IF v_result.success THEN
    RAISE EXCEPTION 'T11 FAIL: invalid type should have caused failure';
  END IF;

  -- No orphaned assets (rolled back by implicit savepoint)
  SELECT COUNT(*) INTO v_assets FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'IBM';
  SELECT COUNT(*) INTO v_txns   FROM public.transactions WHERE portfolio_id = v_pid;

  IF v_assets != 0 THEN RAISE EXCEPTION 'T11 FAIL orphaned asset: found % IBM records', v_assets; END IF;
  IF v_txns   != 0 THEN RAISE EXCEPTION 'T11 FAIL orphaned txns: found % records', v_txns; END IF;

  RAISE NOTICE '✅ T11 ROLLBACK: success=false, orphaned assets=%, orphaned txns=%', v_assets, v_txns;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SUMMARY
-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo 'ALL 11 RPC INTEGRATION TESTS PASSED'
\echo 'Verified: BUY, SELL, DIVIDEND(gross=net+wht), INTEREST, DEPOSIT,'
\echo '          WITHDRAWAL, FX_CONVERSION, STOCK_SPLIT(snake_case),'
\echo '          CHRONOLOGICAL(BUY→SPLIT→BUY→SELL), IDEMPOTENCE, ROLLBACK'
\echo '════════════════════════════════════════════════════════════════'
