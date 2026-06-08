# Lot 2 — Test Plan for Import Schema v3

**Status**: DESIGN PHASE (NOT EXECUTED)
**Purpose**: 10 manual test scenarios to validate RPC behavior, atomicity, and asset reconstruction
**Execution**: Run test queries from `LOT2_TEST_QUERIES.sql` against v3 schema

---

## Test Scenarios Overview

| # | Test Name | Operation Type | Currency | Key Validation | Expected Result |
|---|-----------|---|---|---|---|
| 1 | Buy CHF | buy | CHF | Asset created, qty = 100, avg_price = 10 | ✅ 1 transaction, asset state correct |
| 2 | Buy USD (with CHF total) | buy | USD price / CHF total | Asset created, qty = 50, cost_basis_chf = 100 | ✅ FX rate used, cost_basis in CHF |
| 3 | Buy USD (with USD total) | buy | USD price / USD total | Convert to CHF with rate, asset qty = 50 | ✅ Conversion applied, cost_basis_chf calculated |
| 4 | Sell Partial | sell | CHF | Verify qty available, recalc avg_price | ✅ qty reduced, P&L realized calculated |
| 5 | Dividend with Withholding Tax | dividend | CHF | Record dividend, track withholding_tax separately | ✅ Cash movement + withholding stored |
| 6 | FX Conversion | fx_conversion | USD → CHF | Two cash movements, FX fee tracked | ✅ Two cash_movements with opposite currencies |
| 7 | Stock Split 2:1 | split | N/A | qty doubles, price halves, cost_basis unchanged | ✅ Asset updated, split_events record |
| 8 | Re-import Same File | all types | CHF/USD | Batch idempotence check (file_checksum) | ✅ Batch returns "Already imported", no duplication |
| 9 | Error at Line 200 | buy (invalid line) | CHF | Single error in batch should rollback entire batch | ✅ 0 rows imported, all or nothing |
| 10 | Rollback Batch | all types | CHF/USD | Delete batch, recalculate assets from remaining txns | ✅ Assets reconstructed, clean state |

---

## Test 1: Buy CHF

**Setup**: Empty portfolio, no prior transactions

**CSV Operation**:
```
date: 2026-06-07
action: Market buy
ticker: AAPL
isin: US0378331005
name: Apple Inc
quantity: 100
price: 10.00 CHF
total: 1000.00 CHF
```

**Expected Results**:
```
import_batches.status = 'success'
import_batches.rows_imported = 1
import_batches.rows_skipped = 0

assets (new record):
  portfolio_id = test_portfolio
  ticker = AAPL
  isin = US0378331005
  quantity = 100.00
  avg_buy_price = 10.00
  cost_basis_chf = 1000.00
  currency = CHF

transactions (new):
  type = 'buy'
  quantity = 100.00
  price = 10.00
  total_amount = 1000.00
  total_currency = 'CHF'
  base_amount = 1000.00
  source_external_id = (from CSV)
```

**Failure Modes**:
- ❌ Asset not created
- ❌ avg_buy_price calculated incorrectly
- ❌ cost_basis_chf not stored

---

## Test 2: Buy USD (Price Currency) with CHF Total

**Setup**: Empty portfolio

**CSV Operation**:
```
date: 2026-06-07
action: Market buy
ticker: MSFT
isin: US5949181045
name: Microsoft Corporation
quantity: 50
price: 200.00 USD (priceCurrency = USD)
exchangeRate: 0.92 (USD → CHF)
total: 9200.00 CHF (totalCurrency = CHF)
```

**Expected Results**:
```
assets (new):
  quantity = 50.00
  avg_buy_price = 200.00
  currency = USD
  cost_basis_chf = 9200.00

transactions (new):
  quantity = 50.00
  price = 200.00
  currency = USD
  native_amount = 10000.00 (50 × 200)
  historical_fx_rate = 0.92
  total_amount = 9200.00
  total_currency = CHF
  base_amount = 9200.00
```

**Failure Modes**:
- ❌ FX rate not applied
- ❌ cost_basis_chf = 10000.00 instead of 9200.00 (didn't use rate)
- ❌ total_amount ignored, used total_amount=10000 instead

---

## Test 3: Buy USD (Both Price and Total in USD)

**Setup**: Empty portfolio

**CSV Operation**:
```
date: 2026-06-07
action: Market buy
ticker: GOOG
isin: US02079K3059
quantity: 30
price: 150.00 USD
exchangeRate: 0.92
total: 4500.00 USD (totalCurrency = USD, NOT CHF)
```

**Expected Results**:
```
assets (new):
  quantity = 30.00
  avg_buy_price = 150.00
  currency = USD
  cost_basis_chf = 4140.00 (4500 × 0.92)

transactions (new):
  quantity = 30.00
  price = 150.00
  total_amount = 4500.00
  total_currency = USD
  base_amount = 4140.00 (converted)
  historical_fx_rate = 0.92
```

**Failure Modes**:
- ❌ base_amount = 4500.00 (implicit, no conversion)
- ❌ cost_basis_chf = 4500.00 (didn't multiply by 0.92)
- ❌ No FX rate applied

---

## Test 4: Sell Partial (Qty Verification & P&L)

**Setup**:
- Prior: Buy 100 AAPL @ 10.00 CHF = 1000.00 CHF cost basis
- Current asset state: qty=100, avg_buy_price=10.00, cost_basis_chf=1000.00

**CSV Operation**:
```
date: 2026-06-08
action: Market sell
ticker: AAPL
isin: US0378331005
quantity: 30
price: 12.00 CHF
total: 360.00 CHF
```

**Expected Results**:
```
assets (UPDATED):
  quantity = 70.00 (100 - 30)
  avg_buy_price = 10.00 (unchanged, FIFO cost not recalc'd yet)
  cost_basis_chf = 700.00 (1000 - 30×10)

transactions (new SELL):
  type = 'sell'
  quantity = 30.00
  price = 12.00
  total_amount = 360.00
  realized_pnl_chf = 60.00 (360 - 30×10 cost removed)

cash_movements (new):
  type = 'deposit' (proceeds)
  currency = CHF
  amount = 360.00
```

**Failure Modes**:
- ❌ Sell allowed even though qty insufficient
- ❌ Asset qty not reduced
- ❌ P&L not calculated (realized_pnl_chf = NULL)
- ❌ cost_basis_chf remains 1000.00

---

## Test 5: Dividend with Withholding Tax

**Setup**:
- Prior: Own 100 AAPL

**CSV Operation**:
```
date: 2026-06-07
action: Dividend (Tax exempted)
ticker: AAPL
isin: US0378331005
quantity: 100
price: 0.25 CHF (dividend per share)
total: 25.00 CHF (gross dividend)
withholdingTax: 3.75 CHF (15% withholding)
```

**Expected Results**:
```
transactions (new DIVIDEND):
  type = 'dividend'
  quantity = 100.00
  price = 0.25
  withholding_tax_amount = 3.75
  withholding_tax_currency = CHF

cash_movements (two):
  [1] type='dividend', currency=CHF, amount=25.00 (gross)
  [2] type='tax_withheld', currency=CHF, amount=-3.75 (net effect)
  OR combined: amount=21.25 (net)
```

**Failure Modes**:
- ❌ Withholding tax lost (raw_payload only)
- ❌ withholding_tax_amount = NULL
- ❌ Cash movement = 25.00 instead of 21.25 (gross not net)

---

## Test 6: FX Conversion (Multi-Currency)

**Setup**:
- Prior cash: 5000 USD, 0 CHF

**CSV Operation**:
```
date: 2026-06-07
action: Currency conversion
fxFromCurrency: USD
fxFromAmount: 1000.00
fxToCurrency: CHF
fxToAmount: 920.00
fxFee: 2.00 CHF
```

**Expected Results**:
```
cash_movements (two opposite):
  [1] type='conversion', currency=USD, amount=-1000.00, source_external_id=sourceId_from
  [2] type='conversion', currency=CHF, amount=920.00, source_external_id=sourceId_to
       fx_fee_amount=2.00, fx_fee_currency=CHF

import_batches:
  rows_imported = 1 (one FX operation = one row in CSV, two cash_movements)
```

**Failure Modes**:
- ❌ Only one cash movement created
- ❌ FX fee lost
- ❌ Duplicate on re-import (source_external_id not differentiated for _from/_to)

---

## Test 7: Stock Split 2:1

**Setup**:
- Prior: Own 100 AAPL @ avg_price=10.00, cost_basis=1000.00

**CSV Operations** (two rows in sequence):
```
[1] date: 2026-06-07, action: Stock split (open), isin: US0378331005, quantity: 100
[2] date: 2026-06-07, action: Stock split (close), isin: US0378331005, quantity: 200
```

**Expected Results**:
```
assets (UPDATED):
  quantity = 200.00 (was 100)
  avg_buy_price = 5.00 (was 10, halved)
  cost_basis_chf = 1000.00 (UNCHANGED)

stock_split_events (new):
  asset_id = (AAPL asset id)
  qty_before = 100.00
  qty_after = 200.00
  price_before = 10.00
  price_after = 5.00
  cost_basis_chf = 1000.00 (unchanged)

import_batches:
  rows_imported = 1 (split = 1 logical operation, even if 2 CSV rows)
```

**Failure Modes**:
- ❌ qty = 200 but price stays 10.00 (split not recognized)
- ❌ cost_basis_chf = 500.00 (incorrect, should be constant)
- ❌ Treated as two separate transactions (creates P&L)
- ❌ Not deduplicated on re-import

---

## Test 8: Re-import Same File (Idempotence)

**Setup**:
- Prior: Successfully imported file "trades_2026-06.csv" (file_checksum=abc123)
- import_batches: id=batch_1, status='success', rows_imported=5

**CSV Operation**:
```
Re-submit same file with same checksum
```

**Expected Results**:
```
import_batches:
  Query finds existing batch by (user_id, broker, file_checksum)
  Returns existing batch_id=batch_1
  status = 'success' (unchanged)
  rows_imported = 5 (unchanged)
  completed_at = now() (updated timestamp only)

RPC Response:
  success = true
  batch_id = batch_1
  error_message = 'Already imported' (or status code)
  rows_imported = 0 (no new rows added)

No duplicate transactions created
```

**Failure Modes**:
- ❌ New batch created, same data imported twice
- ❌ ON CONFLICT DO NOTHING not working (duplicates exist)
- ❌ source_external_id unique constraint violated

---

## Test 9: Atomicity — Error at Line 200 (Rollback All)

**Setup**:
- Import batch with 250 CSV rows, all valid except line 200 (invalid ISIN or qty)

**CSV Operations**:
```
[1-199]: All valid buy/sell operations
[200]: Invalid: quantity = NULL (missing required field)
[201-250]: Valid operations
```

**Expected Results**:
```
RPC Execution:
  Processes lines 1-199 successfully
  Line 200: RAISE EXCEPTION 'quantity missing'
  Entire batch ROLLED BACK (CORRECTION 1: STRICT ATOMICITY)

import_batches:
  status = 'failed'
  rows_imported = 0 (all rolled back)
  rows_failed = 250 (all lines failed)
  error_summary.error = 'quantity missing'
  error_summary.line = 200

assets: (empty, no creation from rollback batch)
transactions: (no new records)
cash_movements: (no new records)

RPC Response:
  success = false
  error_message = (contains SQLERRM from line 200)
```

**Failure Modes**:
- ❌ Rows 1-199 committed, only row 200+ rolled back (per-line exception, WRONG)
- ❌ rows_imported = 199 (should be 0)
- ❌ Partial data left in assets/transactions

---

## Test 10: Rollback Batch (Complete Reversal & Asset Reconstruction)

**Setup**:
- Prior: Successfully imported batch_1 with:
  - Buy 100 AAPL @ 10 CHF = 1000 CHF cost basis
  - Buy 50 MSFT @ 200 USD = 9200 CHF cost basis
  - Sell 30 AAPL @ 12 CHF (realized P&L = 60)
  - Deposit 5000 CHF

- Current assets:
  - AAPL: qty=70, cost_basis=700
  - MSFT: qty=50, cost_basis=9200

- Current cash: 5000 + 360 = 5360 CHF (includes sale proceeds)

**RPC Call**:
```sql
SELECT * FROM rollback_import_batch(batch_1::uuid);
```

**Expected Results**:
```
rollback_import_batch() Response:
  batch_id = batch_1
  success = true
  transactions_deleted = 4 (buy, buy, sell, (dividend if any))
  cash_movements_deleted = 2 (deposit, sale proceeds)
  message = 'Rolled back: 4 transactions, 2 cash movements'

assets (RECALCULATED):
  AAPL: qty=0, cost_basis=0, avg_buy_price=0 (no txns remain)
  MSFT: qty=0, cost_basis=0, avg_buy_price=0 (no txns remain)

import_batches:
  Batch deleted (id = batch_1 no longer exists)

cash_movements:
  Deposit REMOVED
  Sale proceeds REMOVED
  (user must verify cash balance externally)

[CORRECTION 7 VALIDATION]:
  Asset reconstruction from remaining txns: ✅ (were 0 since only 1 batch)
  auth.uid() verified in rollback function: ✅
  Cleanup of batch record: ✅
```

**Failure Modes**:
- ❌ Assets not recalculated (qty still 70 instead of 0)
- ❌ Only transactions deleted, cash_movements remain
- ❌ Batch record still exists
- ❌ auth.uid() not checked (unauthorized users could rollback)
- ❌ Assets created only by this batch not deleted (leftover records)

---

## Testing Checklist

Before marking tests as PASS:

- [ ] Schema v3 deployed (no errors)
- [ ] Auth.uid() returns valid UUID
- [ ] Test portfolio created and owned by test user
- [ ] Each test runs in isolation (separate transactions if needed)
- [ ] Verify results with SELECT queries (see `LOT2_TEST_QUERIES.sql`)
- [ ] Check import_batches.status for each test
- [ ] Check rows_imported vs rows_failed counts
- [ ] Verify idempotence: re-run test 8, confirm no duplicates
- [ ] Check RLS policies are enforced (try accessing another user's batch, should return 0 rows)

---

## Execution Notes

- **Timeframe**: ~10 minutes per test suite (5 minutes setup + 5 minutes validation)
- **Data cleanup**: After all tests, DELETE FROM import_batches, assets, transactions, cash_movements WHERE ... (created during test)
- **Automated testing**: Once manual tests pass, translate to SQL-only test suite in CI/CD pipeline

---

## Pass/Fail Criteria

**PASS**:
- ✅ All 10 tests complete without SQL errors
- ✅ All expected row counts match
- ✅ Asset quantities and cost_basis recalculated correctly
- ✅ Atomicity verified: Test 9 rolls back all rows
- ✅ Idempotence verified: Test 8 returns existing batch, no duplication
- ✅ Rollback verified: Test 10 cleanly removes batch and recalculates assets

**FAIL** if any:
- ❌ RPC crashes or timeout
- ❌ Transaction left in inconsistent state
- ❌ Rows imported in Test 9 (atomicity broken)
- ❌ Duplicates in Test 8 (idempotence broken)
- ❌ Assets not recalculated in Test 10 (rollback incomplete)

---
