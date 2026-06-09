-- =============================================================================
-- RPC Integration Tests — import_csv_batch / create_portfolio_and_import_trading212
-- Uses EXACT JSON field names from trading212-parser-client.ts
--
-- Parser → SQL field mapping confirmed:
--   buy/sell  : priceCurrency (not 'currency'), totalAmount (not qty*price*rate),
--               totalCurrency (not priceCurrency for cash_movement)
--   dividend  : totalAmount=net, withholdingTax=wht → gross=net+wht (no 'grossAmount')
--   interest  : totalAmount (not 'amount')
--   deposit/withdrawal : totalAmount + totalCurrency (not 'amount'/'currency')
--   fx_conversion : type='fx_conversion' (not 'currency_conversion')
--   stock_split : qty_before, qty_after, price_before, price_after,
--                 open_source_id, close_source_id  (all snake_case)
--
-- Dividend formula (from real CSV row):
--   CSV "Total"           → op.totalAmount     = 8.50 CHF (net received)
--   CSV "Withholding tax" → op.withholdingTax   = 1.50 CHF
--   gross stored          = 8.50 + 1.50        = 10.00 CHF
--   cash: +10.00 (revenue_credit) then -1.50 (fee) = net +8.50 ✓
-- =============================================================================

\set user_id '11111111-1111-1111-1111-111111111111'

SELECT set_config('request.jwt.claim.sub', :'user_id', false);

DO $$
BEGIN
  IF auth.uid() IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE EXCEPTION 'auth.uid() broken: got %', auth.uid();
  END IF;
  RAISE NOTICE '✅ AUTH uid() = %', auth.uid();
END $$;

-- =============================================================================
-- TEST 1: BUY — parser fields priceCurrency, totalAmount, totalCurrency
-- 5 AAPL @ $200 USD, rate=0.9, totalAmount=900 CHF
-- Expected asset: qty=5, avg_buy_price=200 (native USD), cost_basis_chf=900
-- Expected cash : type=buy_deduction, currency=CHF, amount=-900
-- =============================================================================
\echo ''
\echo '=== T1: BUY (priceCurrency, totalAmount, totalCurrency) ==='

SELECT portfolio_id, batch_id, success, rows_imported, error_message
FROM public.create_portfolio_and_import_trading212(
  'T1_BUY','CHF','trading_212','t1.csv','ck-t1',
  jsonb_build_array(jsonb_build_object(
    'type','buy','date','2025-01-10','sourceId','T1-001',
    'ticker','AAPL','name','Apple Inc.',
    'quantity',5,'price',200,
    'priceCurrency','USD','exchangeRate',0.9,
    'totalAmount',900,'totalCurrency','CHF'
  ))
);

DO $$
DECLARE
  v_pid  uuid;
  v_qty  numeric; v_avg numeric; v_cost numeric;
  v_cm_t text;    v_cm_c text;   v_cm_a numeric;
BEGIN
  SELECT id INTO v_pid FROM public.portfolios
  WHERE user_id = auth.uid() AND name = 'T1_BUY' LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'T1: portfolio not found'; END IF;

  SELECT quantity, avg_buy_price, cost_basis_chf INTO v_qty, v_avg, v_cost
  FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'AAPL';

  IF v_qty  != 5   THEN RAISE EXCEPTION 'T1 FAIL qty: exp=5 got=%',   v_qty;  END IF;
  IF v_avg  != 200 THEN RAISE EXCEPTION 'T1 FAIL avg: exp=200 got=%', v_avg;  END IF;
  IF v_cost != 900 THEN RAISE EXCEPTION 'T1 FAIL cost: exp=900 got=%',v_cost; END IF;

  SELECT type, currency, amount INTO v_cm_t, v_cm_c, v_cm_a
  FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T1-001';

  IF v_cm_t != 'buy_deduction' THEN RAISE EXCEPTION 'T1 FAIL cm.type: %', v_cm_t; END IF;
  IF v_cm_c != 'CHF'           THEN RAISE EXCEPTION 'T1 FAIL cm.currency: %', v_cm_c; END IF;
  IF v_cm_a != -900            THEN RAISE EXCEPTION 'T1 FAIL cm.amount: exp=-900 got=%', v_cm_a; END IF;

  RAISE NOTICE '✅ T1 BUY qty=% avg=% cost=% cash=%(% %)', v_qty, v_avg, v_cost, v_cm_a, v_cm_c, v_cm_t;
END $$;

-- =============================================================================
-- TEST 2: SELL — qty reduced, avg_buy_price unchanged, cash credit in CHF
-- Sell 3 AAPL @ $220 USD, totalAmount=594 CHF
-- After sell: qty=2, avg=200 (unchanged), cost=360 (= 2/5 × 900)
-- cash: type=sell_credit, currency=CHF, amount=+594
-- =============================================================================
\echo ''
\echo '=== T2: SELL (qty reduced, avg unchanged, cash in totalCurrency CHF) ==='

DO $$
DECLARE
  v_pid uuid;
  v_ok  boolean;
  v_err text;
BEGIN
  SELECT id INTO v_pid FROM public.portfolios
  WHERE user_id = auth.uid() AND name = 'T1_BUY' LIMIT 1;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t2.csv','ck-t2',
    jsonb_build_array(jsonb_build_object(
      'type','sell','date','2025-02-01','sourceId','T2-001',
      'ticker','AAPL','name','Apple Inc.',
      'quantity',3,'price',220,
      'priceCurrency','USD','exchangeRate',0.9,
      'totalAmount',594,'totalCurrency','CHF'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T2 import failed: %', v_err; END IF;

  DECLARE
    v_qty numeric; v_avg numeric; v_cost numeric;
    v_cm_a numeric; v_cm_c text; v_cm_t text;
  BEGIN
    SELECT quantity, avg_buy_price, cost_basis_chf INTO v_qty, v_avg, v_cost
    FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'AAPL';

    -- cost after selling 3 of 5: 900 - 3*(900/5) = 900 - 540 = 360
    IF v_qty  != 2   THEN RAISE EXCEPTION 'T2 FAIL qty: exp=2 got=%',   v_qty;  END IF;
    IF v_avg  != 200 THEN RAISE EXCEPTION 'T2 FAIL avg: exp=200 got=%', v_avg;  END IF;
    IF v_cost != 360 THEN RAISE EXCEPTION 'T2 FAIL cost: exp=360 got=%',v_cost; END IF;

    SELECT amount, currency, type INTO v_cm_a, v_cm_c, v_cm_t
    FROM public.cash_movements
    WHERE ref_portfolio_id = v_pid AND source_external_id = 'T2-001';

    IF v_cm_a != 594   THEN RAISE EXCEPTION 'T2 FAIL cm.amount: exp=594 got=%',  v_cm_a; END IF;
    IF v_cm_c != 'CHF' THEN RAISE EXCEPTION 'T2 FAIL cm.currency: exp=CHF got=%', v_cm_c; END IF;
    IF v_cm_t != 'sell_credit' THEN RAISE EXCEPTION 'T2 FAIL cm.type: %', v_cm_t; END IF;

    RAISE NOTICE '✅ T2 SELL qty=% avg=% cost=% cash=+%CHF', v_qty, v_avg, v_cost, v_cm_a;
  END;
END $$;

-- =============================================================================
-- TEST 3: DIVIDEND
-- net=totalAmount=8.50, wht=withholdingTax=1.50 → gross=10.00
-- tx: gross_amount_chf=10.00, withholding_tax_amount=1.50, currency=CHF
-- cash: revenue_credit +10.00 / fee -1.50
-- =============================================================================
\echo ''
\echo '=== T3: DIVIDEND (gross=totalAmount+withholdingTax) ==='

DO $$
DECLARE
  v_pid uuid;
  v_ok  boolean; v_err text;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T3_DIV', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t3.csv','ck-t3',
    jsonb_build_array(
      jsonb_build_object(
        'type','buy','date','2025-01-01','sourceId','T3-BUY',
        'ticker','MSFT','name','Microsoft',
        'quantity',10,'price',300,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',3000,'totalCurrency','CHF'
      ),
      jsonb_build_object(
        'type','dividend','date','2025-03-20','sourceId','T3-DIV',
        'ticker','MSFT','name','Microsoft',
        'totalAmount',8.50,'totalCurrency','CHF',
        'withholdingTax',1.50
      )
    )
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T3 import failed: %', v_err; END IF;

  DECLARE
    v_gross  numeric; v_wht    numeric; v_ccy   text;
    v_cm_rev numeric; v_cm_fee numeric;
  BEGIN
    -- Transaction stores gross=10.00, wht=1.50
    SELECT gross_amount_chf, withholding_tax_amount, currency
    INTO v_gross, v_wht, v_ccy
    FROM public.transactions
    WHERE portfolio_id = v_pid AND source_external_id = 'T3-DIV';

    IF v_gross != 10.00 THEN RAISE EXCEPTION 'T3 FAIL tx.gross: exp=10.00 got=%', v_gross; END IF;
    IF v_wht   != 1.50  THEN RAISE EXCEPTION 'T3 FAIL tx.wht: exp=1.50 got=%',   v_wht;   END IF;
    IF v_ccy   != 'CHF' THEN RAISE EXCEPTION 'T3 FAIL tx.currency: %', v_ccy;            END IF;

    -- Cash: +10.00 gross then -1.50 fee
    SELECT amount INTO v_cm_rev FROM public.cash_movements
    WHERE ref_portfolio_id = v_pid AND source_external_id = 'T3-DIV' AND type = 'revenue_credit';
    SELECT amount INTO v_cm_fee FROM public.cash_movements
    WHERE ref_portfolio_id = v_pid AND source_external_id = 'T3-DIV:wht' AND type = 'fee';

    IF v_cm_rev != 10.00 THEN RAISE EXCEPTION 'T3 FAIL cm.rev: exp=10.00 got=%', v_cm_rev; END IF;
    IF v_cm_fee != -1.50 THEN RAISE EXCEPTION 'T3 FAIL cm.fee: exp=-1.50 got=%', v_cm_fee; END IF;

    RAISE NOTICE '✅ T3 DIVIDEND gross=% wht=% cm_rev=% cm_fee=%', v_gross, v_wht, v_cm_rev, v_cm_fee;
  END;
END $$;

-- =============================================================================
-- TEST 4: INTEREST — field is totalAmount (not 'amount')
-- =============================================================================
\echo ''
\echo '=== T4: INTEREST (totalAmount, not amount) ==='

DO $$
DECLARE v_pid uuid; v_ok boolean; v_err text; v_amt numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T4_INT', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t4.csv','ck-t4',
    jsonb_build_array(jsonb_build_object(
      'type','interest','date','2025-02-01','sourceId','T4-INT',
      'totalAmount',3.75,'totalCurrency','CHF'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T4 import failed: %', v_err; END IF;

  SELECT amount INTO v_amt FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T4-INT';
  IF v_amt != 3.75 THEN RAISE EXCEPTION 'T4 FAIL: exp=3.75 got=%', v_amt; END IF;
  RAISE NOTICE '✅ T4 INTEREST amount=%', v_amt;
END $$;

-- =============================================================================
-- TEST 5: DEPOSIT — totalAmount + totalCurrency (not 'amount'/'currency')
-- =============================================================================
\echo ''
\echo '=== T5: DEPOSIT (totalAmount + totalCurrency) ==='

DO $$
DECLARE v_pid uuid; v_ok boolean; v_err text; v_amt numeric; v_ccy text;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T5_DEP', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t5.csv','ck-t5',
    jsonb_build_array(jsonb_build_object(
      'type','deposit','date','2025-01-01','sourceId','T5-DEP',
      'totalAmount',5000,'totalCurrency','CHF'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T5 import failed: %', v_err; END IF;

  SELECT amount, currency INTO v_amt, v_ccy FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T5-DEP';
  IF v_amt != 5000  THEN RAISE EXCEPTION 'T5 FAIL amount: exp=5000 got=%', v_amt; END IF;
  IF v_ccy != 'CHF' THEN RAISE EXCEPTION 'T5 FAIL currency: exp=CHF got=%', v_ccy; END IF;
  RAISE NOTICE '✅ T5 DEPOSIT amount=% currency=%', v_amt, v_ccy;
END $$;

-- =============================================================================
-- TEST 6: WITHDRAWAL — amount stored negative
-- =============================================================================
\echo ''
\echo '=== T6: WITHDRAWAL ==='

DO $$
DECLARE v_pid uuid; v_ok boolean; v_err text; v_amt numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T6_WDR', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t6.csv','ck-t6',
    jsonb_build_array(jsonb_build_object(
      'type','withdrawal','date','2025-02-01','sourceId','T6-WDR',
      'totalAmount',1000,'totalCurrency','CHF'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T6 import failed: %', v_err; END IF;

  SELECT amount INTO v_amt FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T6-WDR';
  IF v_amt != -1000 THEN RAISE EXCEPTION 'T6 FAIL: exp=-1000 got=%', v_amt; END IF;
  RAISE NOTICE '✅ T6 WITHDRAWAL amount=%', v_amt;
END $$;

-- =============================================================================
-- TEST 7: FX_CONVERSION — type='fx_conversion' (parser output, not 'currency_conversion')
-- =============================================================================
\echo ''
\echo '=== T7: FX_CONVERSION (type=fx_conversion) ==='

DO $$
DECLARE v_pid uuid; v_ok boolean; v_err text; v_from numeric; v_to numeric;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T7_FX', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t7.csv','ck-t7',
    jsonb_build_array(jsonb_build_object(
      'type','fx_conversion','date','2025-03-01','sourceId','T7-FX',
      'fromAmount',1000,'fromCurrency','CHF',
      'toAmount',1081.50,'toCurrency','USD'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T7 import failed: %', v_err; END IF;

  SELECT amount INTO v_from FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T7-FX:from';
  SELECT amount INTO v_to   FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T7-FX:to';

  IF v_from != -1000   THEN RAISE EXCEPTION 'T7 FAIL from: exp=-1000 got=%',    v_from; END IF;
  IF v_to   != 1081.50 THEN RAISE EXCEPTION 'T7 FAIL to: exp=1081.50 got=%',    v_to;   END IF;
  RAISE NOTICE '✅ T7 FX_CONVERSION from=%CHF to=%USD', v_from, v_to;
END $$;

-- =============================================================================
-- TEST 8: STOCK_SPLIT — snake_case fields: qty_before, qty_after, price_before,
--         price_after, open_source_id, close_source_id
-- After BUY 10 @ $200 then SPLIT 1:2 → qty=20, avg=100
-- =============================================================================
\echo ''
\echo '=== T8: STOCK_SPLIT (snake_case qty_before/after, price_before/after) ==='

DO $$
DECLARE v_pid uuid; v_ok boolean; v_err text;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T8_SPL', 'CHF') RETURNING id INTO v_pid;

  -- BUY first
  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t8a.csv','ck-t8a',
    jsonb_build_array(jsonb_build_object(
      'type','buy','date','2025-01-01','sourceId','T8-BUY',
      'ticker','TSLA','name','Tesla',
      'quantity',10,'price',200,
      'priceCurrency','USD','exchangeRate',1.0,
      'totalAmount',2000,'totalCurrency','CHF'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T8 BUY failed: %', v_err; END IF;

  -- SPLIT 1:2 with snake_case fields (exact parser output)
  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t8b.csv','ck-t8b',
    jsonb_build_array(jsonb_build_object(
      'type','stock_split','date','2025-06-01',
      'ticker','TSLA','name','Tesla',
      'sourceId','EOF_OPEN|EOF_CLOSE',
      'open_source_id','EOF_OPEN',
      'close_source_id','EOF_CLOSE',
      'qty_before',10,'qty_after',20,
      'price_before',200,'price_after',100
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T8 SPLIT failed: %', v_err; END IF;

  DECLARE
    v_qb numeric; v_qa numeric; v_pb numeric; v_pa numeric;
    v_oid text;   v_cid text;
    v_qty numeric; v_avg numeric;
  BEGIN
    SELECT qty_before, qty_after, price_before, price_after,
           open_source_id, close_source_id
    INTO v_qb, v_qa, v_pb, v_pa, v_oid, v_cid
    FROM public.stock_split_events WHERE portfolio_id = v_pid;

    IF v_qb  != 10          THEN RAISE EXCEPTION 'T8 FAIL qty_before: exp=10 got=%',     v_qb;  END IF;
    IF v_qa  != 20          THEN RAISE EXCEPTION 'T8 FAIL qty_after: exp=20 got=%',      v_qa;  END IF;
    IF v_pb  != 200         THEN RAISE EXCEPTION 'T8 FAIL price_before: exp=200 got=%',  v_pb;  END IF;
    IF v_pa  != 100         THEN RAISE EXCEPTION 'T8 FAIL price_after: exp=100 got=%',   v_pa;  END IF;
    IF v_oid != 'EOF_OPEN'  THEN RAISE EXCEPTION 'T8 FAIL open_source_id: %', v_oid;            END IF;
    IF v_cid != 'EOF_CLOSE' THEN RAISE EXCEPTION 'T8 FAIL close_source_id: %', v_cid;           END IF;

    SELECT quantity, avg_buy_price INTO v_qty, v_avg
    FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'TSLA';
    IF v_qty != 20  THEN RAISE EXCEPTION 'T8 FAIL asset.qty: exp=20 got=%',  v_qty; END IF;
    IF v_avg != 100 THEN RAISE EXCEPTION 'T8 FAIL asset.avg: exp=100 got=%', v_avg; END IF;

    RAISE NOTICE '✅ T8 SPLIT split_record(qb=%,qa=%,pb=%,pa=%,oid=%,cid=%) asset(qty=%,avg=%)',
      v_qb,v_qa,v_pb,v_pa,v_oid,v_cid,v_qty,v_avg;
  END;
END $$;

-- =============================================================================
-- TEST 9: CHRONOLOGICAL — BUY → SPLIT → BUY → SELL (single batch)
--
-- Arithmetic (recalculate_asset_position ORDER BY event_date ASC):
--   2025-01-01 BUY  8 @ $150, totalAmount=1200CHF → qty=8,  avg=150,  cost=1200
--   2025-06-01 SPLIT 1:2                          → qty=16, avg=75,   cost=1200
--   2025-09-01 BUY  4 @ $80,  totalAmount=320CHF  → avg=(16×75+4×80)/20=76, qty=20, cost=1520
--   2025-12-01 SELL 8 @ $90,  totalAmount=720CHF  → cost_per=1520/20=76, cost=1520-8×76=912, qty=12
--
-- Final: qty=12, avg_buy_price=76 USD, cost_basis_chf=912
-- Realized P&L: 720 - 8×76 = 720 - 608 = 112 CHF
-- =============================================================================
\echo ''
\echo '=== T9: CHRONOLOGICAL BUY→SPLIT→BUY→SELL (one batch, expect qty=12 avg=76 cost=912) ==='

DO $$
DECLARE
  v_pid uuid;
  v_ok  boolean; v_err text; v_ri integer;
  v_qty numeric; v_avg numeric; v_cost numeric;
  v_sell_amt numeric; v_sell_ccy text;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T9_CHRON', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message, rows_imported INTO v_ok, v_err, v_ri
  FROM public.import_csv_batch(
    v_pid,'trading_212','t9.csv','ck-t9',
    jsonb_build_array(
      -- BUY before split
      jsonb_build_object(
        'type','buy','date','2025-01-01','sourceId','T9-BUY1',
        'ticker','AAPL','name','Apple Inc.',
        'quantity',8,'price',150,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',1200,'totalCurrency','CHF'
      ),
      -- SPLIT 1:2 (snake_case as produced by pairStockSplits())
      jsonb_build_object(
        'type','stock_split','date','2025-06-01',
        'ticker','AAPL','name','Apple Inc.',
        'sourceId','SP_OPEN|SP_CLOSE',
        'open_source_id','SP_OPEN','close_source_id','SP_CLOSE',
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
        'type','sell','date','2025-12-01','sourceId','T9-SELL',
        'ticker','AAPL','name','Apple Inc.',
        'quantity',8,'price',90,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',720,'totalCurrency','CHF'
      )
    )
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T9 import failed: %', v_err; END IF;
  -- 4 logical events (BUY1 + SPLIT + BUY2 + SELL)
  IF v_ri != 4 THEN RAISE EXCEPTION 'T9 FAIL rows_imported: exp=4 got=%', v_ri; END IF;

  SELECT quantity, avg_buy_price, cost_basis_chf INTO v_qty, v_avg, v_cost
  FROM public.assets WHERE portfolio_id = v_pid AND ticker = 'AAPL';

  IF v_qty  != 12  THEN RAISE EXCEPTION 'T9 FAIL qty: exp=12 got=%',  v_qty;  END IF;
  IF v_avg  != 76  THEN RAISE EXCEPTION 'T9 FAIL avg: exp=76 got=%',  v_avg;  END IF;
  IF v_cost != 912 THEN RAISE EXCEPTION 'T9 FAIL cost: exp=912 got=%',v_cost; END IF;

  SELECT amount, currency INTO v_sell_amt, v_sell_ccy
  FROM public.cash_movements
  WHERE ref_portfolio_id = v_pid AND source_external_id = 'T9-SELL';
  IF v_sell_amt != 720   THEN RAISE EXCEPTION 'T9 FAIL sell_cm: exp=720 got=%',   v_sell_amt; END IF;
  IF v_sell_ccy != 'CHF' THEN RAISE EXCEPTION 'T9 FAIL sell_ccy: exp=CHF got=%',  v_sell_ccy; END IF;

  RAISE NOTICE '✅ T9 CHRON qty=% avg=%(USD) cost=%(CHF) realized_PnL=112CHF sell_cm=+%CHF',
    v_qty, v_avg, v_cost, v_sell_amt;
END $$;

-- =============================================================================
-- TEST 10: IDEMPOTENCE — same checksum returns same batch_id, no duplicates
-- =============================================================================
\echo ''
\echo '=== T10: IDEMPOTENCE ==='

DO $$
DECLARE
  v_pid uuid;
  v_b1 uuid; v_b2 uuid; v_ok boolean; v_err text;
  v_tx_count integer;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T10_IDEM', 'CHF') RETURNING id INTO v_pid;

  SELECT batch_id, success, error_message INTO v_b1, v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t10.csv','ck-t10',
    jsonb_build_array(jsonb_build_object(
      'type','buy','date','2025-01-01','sourceId','T10-BUY',
      'ticker','NVDA','name','Nvidia',
      'quantity',2,'price',500,
      'priceCurrency','USD','exchangeRate',1.0,
      'totalAmount',1000,'totalCurrency','CHF'
    ))
  );
  IF NOT v_ok THEN RAISE EXCEPTION 'T10 first import failed: %', v_err; END IF;

  SELECT batch_id, success, error_message INTO v_b2, v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t10.csv','ck-t10',   -- same checksum
    jsonb_build_array(jsonb_build_object(
      'type','buy','date','2025-01-01','sourceId','T10-BUY',
      'ticker','NVDA','name','Nvidia',
      'quantity',2,'price',500,
      'priceCurrency','USD','exchangeRate',1.0,
      'totalAmount',1000,'totalCurrency','CHF'
    ))
  );

  IF v_b1 IS DISTINCT FROM v_b2 THEN
    RAISE EXCEPTION 'T10 FAIL idempotence: first=% second=%', v_b1, v_b2;
  END IF;

  SELECT COUNT(*) INTO v_tx_count FROM public.transactions
  WHERE portfolio_id = v_pid AND ticker = 'NVDA';
  IF v_tx_count != 1 THEN
    RAISE EXCEPTION 'T10 FAIL duplicates: exp=1 tx got=%', v_tx_count;
  END IF;

  RAISE NOTICE '✅ T10 IDEMPOTENCE batch_id=% tx_count=%', v_b1, v_tx_count;
END $$;

-- =============================================================================
-- TEST 11: ROLLBACK — invalid type triggers EXCEPTION, no orphaned data
-- =============================================================================
\echo ''
\echo '=== T11: ROLLBACK (invalid type → no orphaned assets/transactions) ==='

DO $$
DECLARE
  v_pid    uuid;
  v_ok     boolean; v_err text;
  v_assets integer; v_txns integer;
BEGIN
  INSERT INTO public.portfolios (user_id, name, currency)
  VALUES (auth.uid(), 'T11_RB', 'CHF') RETURNING id INTO v_pid;

  SELECT success, error_message INTO v_ok, v_err
  FROM public.import_csv_batch(
    v_pid,'trading_212','t11.csv','ck-t11',
    jsonb_build_array(
      jsonb_build_object(
        'type','buy','date','2025-01-01','sourceId','T11-BUY',
        'ticker','IBM','name','IBM',
        'quantity',5,'price',100,
        'priceCurrency','USD','exchangeRate',1.0,
        'totalAmount',500,'totalCurrency','CHF'
      ),
      jsonb_build_object(
        'type','INVALID_TYPE_XYZ','date','2025-01-02','sourceId','T11-BAD',
        'totalAmount',100,'totalCurrency','CHF'
      )
    )
  );

  IF v_ok THEN
    RAISE EXCEPTION 'T11 FAIL: invalid type should have caused success=false';
  END IF;

  SELECT COUNT(*) INTO v_assets FROM public.assets WHERE portfolio_id = v_pid;
  SELECT COUNT(*) INTO v_txns   FROM public.transactions WHERE portfolio_id = v_pid;

  IF v_assets != 0 THEN RAISE EXCEPTION 'T11 FAIL orphaned assets: found %', v_assets; END IF;
  IF v_txns   != 0 THEN RAISE EXCEPTION 'T11 FAIL orphaned txns: found %',   v_txns;   END IF;

  RAISE NOTICE '✅ T11 ROLLBACK success=false error="%..." orphaned_assets=% orphaned_txns=%',
    LEFT(v_err, 60), v_assets, v_txns;
END $$;

-- =============================================================================
\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '✅ ALL 11 RPC INTEGRATION TESTS PASSED'
\echo '   T1  BUY  (priceCurrency, totalAmount, totalCurrency)'
\echo '   T2  SELL (qty reduced, avg unchanged, cash CHF)'
\echo '   T3  DIVIDEND (gross=net+wht: 8.50+1.50=10.00)'
\echo '   T4  INTEREST (totalAmount)'
\echo '   T5  DEPOSIT (totalAmount+totalCurrency)'
\echo '   T6  WITHDRAWAL'
\echo '   T7  FX_CONVERSION (type=fx_conversion)'
\echo '   T8  STOCK_SPLIT (snake_case fields + asset recalc)'
\echo '   T9  CHRONOLOGICAL BUY→SPLIT→BUY→SELL (qty=12 avg=76 cost=912)'
\echo '   T10 IDEMPOTENCE'
\echo '   T11 ROLLBACK (no orphaned data)'
\echo '════════════════════════════════════════════════════════════════'
