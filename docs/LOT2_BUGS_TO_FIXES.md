# Lot 2 — Bug → Correction Table (v3 → v4)

**Status**: ANALYSIS FOR v4 REDESIGN
**Date**: 2026-06-08

---

## Bug #1: Functions Incorrectly Qualified with `public.`

| Aspect | v3 Error | v4 Correction | Reason |
|--------|----------|---------------|--------|
| **auth.uid()** | `public.auth.uid()` | `auth.uid()` | Supabase auth is NOT in public schema; it's a built-in |
| **jsonb_array_length()** | `public.jsonb_array_length(p_operations)` | `jsonb_array_length(p_operations)` | Built-in PostgreSQL function, no schema needed |
| **jsonb_array_elements()** | `SELECT public.jsonb_array_elements(p_operations)` | `SELECT jsonb_array_elements(p_operations)` | Built-in PostgreSQL function |
| **jsonb_build_object()** | `public.jsonb_build_object(...)` | `jsonb_build_object(...)` | Built-in PostgreSQL function |
| **Tables** | Should stay as-is | `public.assets`, `public.transactions`, etc. | Only USER tables get `public.` prefix |

**Fix**: Remove `public.` prefix from all PostgreSQL built-in functions. Keep `public.` only for table/schema-qualified names.

---

## Bug #2: Idempotence AFTER Financial Effects (Logic Inversion)

| Phase | v3 Flow (WRONG) | v4 Flow (CORRECT) | Problem |
|-------|-----------------|------------------|---------|
| **BUY** | 1. Update asset qty+cost ❌ 2. INSERT ... ON CONFLICT DO NOTHING ❌ | 1. INSERT ... ON CONFLICT DO NOTHING 2. Check ROW_COUNT 3. If ROW_COUNT > 0, THEN update asset | v3: If row already exists, asset is modified twice (idempotence fails) |
| **SELL** | 1. Update asset qty-cost ❌ 2. INSERT ... ON CONFLICT DO NOTHING ❌ | 1. INSERT ... ON CONFLICT DO NOTHING 2. Check ROW_COUNT 3. If ROW_COUNT > 0, THEN verify qty & update asset | v3: Re-importing causes asset qty to be decremented again |
| **DIVIDEND** | 1. INSERT transaction ON CONFLICT 2. INSERT cash movement (may be duplicated) ❌ | 1. INSERT transaction ON CONFLICT 2. Only if transaction was new: INSERT cash movement | v3: Dividend cash movement created even if transaction already imported |
| **Atomicity** | Effects applied during CASE statement, error only after modifications ❌ | Effects applied ONLY after successful INSERT, errors prevent all modifications | v3: Partial financial state if error occurs |

**Fix**: Every operation type must follow this sequence:
```
ATTEMPT INSERT → CHECK ROW_COUNT → IF ROW_COUNT > 0 THEN apply_effects ELSE skip
```

---

## Bug #3: Currency Conversion Missing Validation & Calculation Error

| Scenario | v3 Error | v4 Correction | Validated By |
|----------|----------|---------------|--------------|
| **totalCurrency = CHF** | Assumed CHF implicitly | Explicitly check: `IF totalCurrency = 'CHF' THEN base_amount = totalAmount` | Not applicable (CHF is base) |
| **totalCurrency = USD/EUR/GBP** | `base_amount = totalAmount` (WRONG—no conversion) | `base_amount = (quantity × price_native) / exchange_rate` | LOT2_FX_VALIDATION.md (formula validated on 3 real lines) |
| **Missing exchange_rate** | Not validated, conversion silently fails ❌ | `IF totalCurrency != 'CHF' AND exchange_rate IS NULL THEN RAISE EXCEPTION` | Line-level error handling |
| **Wrong direction** | No validation of multiplication vs. division | Validated & documented: **DIVIDE by exchange_rate** (not multiply) | Real CSV: 0.1037849900 × 24.1850 / 1.25501999 = 2.00 CHF ✓ |

**Fix**: 
```sql
-- CORRECTION 4 (Currency Handling) — v4
v_base_amount_chf := NULL;

IF (v_op ->> 'totalCurrency') = 'CHF' THEN
  v_base_amount_chf := (v_op ->> 'totalAmount')::numeric;
ELSIF (v_op ->> 'totalCurrency') IN ('USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD') THEN
  IF (v_op ->> 'exchangeRate')::numeric IS NULL THEN
    RAISE EXCEPTION 'Line %: totalCurrency is % but exchangeRate is NULL', v_idx, (v_op ->> 'totalCurrency');
  END IF;
  -- Formula: total_chf = (qty × price_native) / exchange_rate
  v_base_amount_chf := ((v_op ->> 'quantity')::numeric * (v_op ->> 'price')::numeric) 
                     / (v_op ->> 'exchangeRate')::numeric;
ELSE
  RAISE EXCEPTION 'Line %: Unknown totalCurrency %', v_idx, (v_op ->> 'totalCurrency');
END IF;

-- Validate not NULL
IF v_base_amount_chf IS NULL THEN
  RAISE EXCEPTION 'Line %: base_amount_chf calculation failed', v_idx;
END IF;
```

---

## Bug #4: Price Average Mixing Native Currency with CHF

| Field | v3 Error | v4 Correction | Example |
|-------|----------|---------------|---------|
| **avg_buy_price** | Stored as-is (USD/EUR), then used in CHF context | Store as `avg_buy_price_native` (original currency); recalc on EVERY buy | BUY 1: 100 USD, BUY 2: 200 USD → avg = (100+200)/2 = 150 USD (not CHF) |
| **cost_basis_chf** | Mixed with avg_buy_price calculations ❌ | Stored separately in CHF; sum of all CHF purchases | BUY 1: 100 USD × 1.2 CHF = 120 CHF; BUY 2: 200 USD × 1.3 CHF = 260 CHF → cost_basis = 380 CHF |
| **New buy calculation** | `new_avg = (old_cost + new_cost_chf) / (old_qty + new_qty)` ❌ | **Native**: `new_avg_native = (old_cost_native + new_qty × new_price_native) / (old_qty + new_qty)` **CHF**: `new_cost_basis_chf = old_cost_basis_chf + new_total_chf` | BUY 1: 50 USD @ 100 cost_basis=5000 CHF; BUY 2: 25 USD @ 150 → new_avg=125 USD, cost_basis=8750 CHF |

**Fix**:
```sql
-- CORRECTION 3 & 4 (Asset Reconstruction) — v4

-- For BUY operation:
IF v_asset_id IS NULL THEN
  -- Create new asset
  INSERT INTO public.assets (
    portfolio_id, ticker, name, asset_class, isin,
    quantity, avg_buy_price_native, currency, cost_basis_chf
  ) VALUES (
    p_portfolio_id, v_ticker, v_name, 'stock', v_isin,
    v_qty_native,
    v_price_native,  -- Store native price, NOT CHF
    v_op ->> 'priceCurrency',
    v_base_amount_chf  -- Store CHF separately
  ) RETURNING public.assets.id INTO v_asset_id;
ELSE
  -- Update existing: recalc native avg, add CHF cost basis
  UPDATE public.assets SET
    quantity = v_old_qty + v_qty_native,
    avg_buy_price_native = (v_old_cost_basis_native + v_qty_native * v_price_native) / (v_old_qty + v_qty_native),
    cost_basis_chf = v_old_cost_basis_chf + v_base_amount_chf
  WHERE id = v_asset_id;
END IF;
```

---

## Bug #5: Sell Partial Quantity Calculation Wrong

| Step | v3 Error | v4 Correction | Formula |
|------|----------|---------------|---------|
| **Cost unit CHF** | Not calculated ❌ | `v_cost_unit_chf = v_old_cost_basis_chf / v_old_qty` | Example: 380 CHF / 75 qty = 5.067 CHF/unit |
| **Cost removed** | `v_cost_removed = qty_sold × avg_price_native` ❌ (wrong currency) | `v_cost_removed_chf = qty_sold × v_cost_unit_chf` | 25 × 5.067 = 126.67 CHF |
| **New cost basis** | Not recalculated ❌ | `v_new_cost_basis = v_old_cost_basis_chf - v_cost_removed_chf` | 380 - 126.67 = 253.33 CHF |
| **New avg price** | Not updated ❌ | `v_new_avg_native = v_new_cost_basis / v_new_qty × (old_avg / old_cost_basis)` ❌ | ACTUALLY LEAVE UNCHANGED: avg_buy_price_native stays constant (FIFO cost method); only cost_basis changes |
| **P&L realized** | `v_result × exchange_rate` ❌ (Result field is already in CHF) | Use Result field directly: `realized_pnl_chf = result_from_csv` | CSV shows "Result: -0.01 CHF" is already in CHF |

**Fix**:
```sql
-- CORRECTION 3 & 5 (Sell Partial) — v4

-- Get cost unit
v_cost_unit_chf := v_old_cost_basis_chf / v_old_qty;  -- CHF per share
v_cost_removed_chf := v_qty_native * v_cost_unit_chf;

-- Update asset: qty decreased, cost basis decreased, avg price unchanged
UPDATE public.assets SET
  quantity = v_old_qty - v_qty_native,
  cost_basis_chf = v_old_cost_basis_chf - v_cost_removed_chf
  -- avg_buy_price_native stays the same (FIFO method)
WHERE id = v_asset_id;

-- Insert transaction with P&L from CSV (already in CHF)
INSERT INTO public.transactions (
  realized_pnl_chf
) VALUES (
  (v_op ->> 'result')::numeric  -- CSV "Result" field is already CHF
);
```

---

## Bug #6: Fees Always Zero (No Real CSV Data Used)

| Fee Type | v3 Error | v4 Correction | CSV Source |
|----------|----------|---------------|-----------|
| **Transaction fee** | Always 0 ❌ | Parse from CSV & store in separate column | Trading 212 may include in "Total" or separate field ⚠️ |
| **FX conversion fee** | Always 0 ❌ | Parse `Currency conversion fee` column explicitly | CSV Line 5: `Currency (Currency conversion fee)=0.01 CHF` ✓ |
| **Withholding tax** | Parsed but rows created with 0 tax ❌ | Read `Withholding tax` + `Currency (Withholding tax)` columns | CSV has `Withholding tax` column (currently NULL in this dataset) |
| **Dividend gross/net** | No separation ❌ | Gross = Total; Net = Total - Withholding tax | Not visible in this CSV yet |

**Fix**:
```sql
-- CORRECTION 5 (Fees) — v4

-- For FX_CONVERSION:
INSERT INTO public.cash_movements (
  fx_fee_amount,
  fx_fee_currency
) VALUES (
  (v_op ->> 'fxFee')::numeric,
  v_op ->> 'fxFeeCurrency'
);

-- For DIVIDEND:
INSERT INTO public.transactions (
  withholding_tax_amount,
  withholding_tax_currency
) VALUES (
  (v_op ->> 'withholdingTax')::numeric,
  v_op ->> 'withholdingTaxCurrency'
);
```

---

## Bug #7: Cash Movements Missing or Duplicated

| Operation | v3 Error | v4 Correction | Impact |
|-----------|----------|---------------|--------|
| **BUY** | No cash debit created ❌ | INSERT into cash_movements: debit native currency OR debit CHF if totalCurrency=CHF | Cash balance not updated |
| **SELL** | No cash credit created ❌ | INSERT into cash_movements: credit CHF from sale proceeds | Sale proceeds not recorded |
| **DIVIDEND** | Cash created even if transaction ON CONFLICT skipped ❌ | Only INSERT cash IF transaction was new (ROW_COUNT > 0) | Double dividend cash on re-import |
| **FX_CONVERSION** | Created as single movement ❌ | Create TWO: one debit (from), one credit (to), with fee on (to) side | FX fee lost |
| **INTEREST** | Correct in concept, but fees not tracked ❌ | INSERT with source_external_id for idempotence | Rare but should be covered |

**Fix**: See sequence diagram below (Bug #8).

---

## Bug #8: Splits Not Paired Before RPC Call

| Aspect | v3 Error | v4 Correction | Responsibility |
|--------|----------|---------------|-----------------|
| **Parser** | Sends `split` as single operation ❌ | Parser pairs consecutive "Stock split open" + "Stock split close" into ONE jsonb object | lib/import/csv-parser.ts |
| **RPC** | Receives 2 separate split operations ❌ | RPC receives 1 operation with `open_source_id`, `close_source_id`, `qty_before`, `qty_after` | import-schema-v4.sql |
| **Deduplication** | Two source_external_ids (open + close) conflict with idempotence ❌ | UNIQUE index on (open_source_id, close_source_id) pair | Primary key of stock_split_events |
| **Cost basis** | May be recalculated incorrectly ❌ | cost_basis_chf stays constant, only qty and price change | Verified in LOT2_FX_VALIDATION |

**Fix**: Parser must pair splits BEFORE sending to RPC.
```json
// BEFORE (v3 - wrong)
[
  { "type": "split", "sourceId": "OPEN_123", "quantity": 200, "price": 5 },
  { "type": "split", "sourceId": "CLOSE_123", "quantity": 200, "price": 5 }
]

// AFTER (v4 - correct)
[
  {
    "type": "split",
    "openSourceId": "OPEN_123",
    "closeSourceId": "CLOSE_123",
    "qtyBefore": 100,
    "qtyAfter": 200,
    "priceBefore": 10,
    "priceAfter": 5
  }
]
```

---

## Bug #9: Rollback Uses Wrong Aggregation Method

| Aspect | v3 Error | v4 Correction | Reason |
|--------|----------|---------------|--------|
| **Sum totalAmount** | `SUM(total_amount)` ❌ | Must sum by currency, then convert separately or use base_amount | totalAmount can be USD, EUR, CHF mixed |
| **Recalc cost_basis** | Sums total_amount, assumes CHF ❌ | Recalc from remaining transactions: `SUM(base_amount_chf)` | Only base_amount is guaranteed CHF |
| **P&L realized** | Not recalculated ❌ | For remaining SELL transactions, recalc P&L from surviving BUY history | P&L depends on which BUY lots were sold |
| **Cash by currency** | Not handled ❌ | Recalculate cash balance per currency from remaining cash_movements | May have CAD, GBP, etc. |
| **Cleanup assets** | Doesn't delete ❌ | Delete assets where qty=0 AND no remaining transactions | Asset created only by deleted batch |

**Fix**: 
```sql
-- Rollback: recalculate from remaining txns in CHF
SELECT 
  SUM(base_amount_chf) INTO v_new_cost_basis_chf
FROM public.transactions
WHERE asset_id = v_asset_id AND type = 'buy';

-- Recalc qty from buys - sells
SELECT 
  (COALESCE(SUM(CASE WHEN type='buy' THEN quantity ELSE 0 END), 0) -
   COALESCE(SUM(CASE WHEN type='sell' THEN quantity ELSE 0 END), 0))
INTO v_new_qty
FROM public.transactions WHERE asset_id = v_asset_id;
```

---

## Bug #10: Tests Don't Actually Call RPC

| Issue | v3 Error | v4 Correction |
|-------|----------|---------------|
| **RAISE NOTICE only** | `RAISE NOTICE 'Test 1 ...'` doesn't test anything ❌ | Actually call: `SELECT * FROM public.import_csv_batch(...)` |
| **No assertions** | Results printed, but not validated ❌ | Use assertions or CASE to verify counts match expected |
| **auth.uid() not tested** | Tests assume Dashboard can access auth.uid() ❌ | Tests must run in authenticated context (e.g., via Supabase Client SDK) or use a test account |
| **Atomicity test** | Doesn't really insert error at line 200 ❌ | Build real jsonb array with NULL quantity at position 4, call RPC, verify 0 rows imported |
| **Rollback test** | Doesn't call rollback_import_batch() ❌ | Call function, then SELECT to verify batch deleted, assets recalculated |

**Fix**: See LOT2_TEST_QUERIES_v4.sql (section 10 will have real RPC calls).

---

## Summary Table: All 10 Bugs & Fixes

| Bug | Root Cause | v4 Fix | Severity |
|-----|-----------|--------|----------|
| 1. Functions with `public.` | Copy-paste error | Remove `public.` from built-ins, keep only on tables | CRITICAL |
| 2. Idempotence after effects | Logic inversion | INSERT first, check ROW_COUNT, apply effects only if new | CRITICAL (data corruption) |
| 3. Currency conversion validation | No validation or division | Validate exchange_rate present, divide not multiply | CRITICAL (wrong amounts) |
| 4. Mixing native + CHF prices | Schema confusion | Separate avg_buy_price_native from cost_basis_chf | HIGH (cost basis wrong) |
| 5. Sell cost calculation | Wrong currency | Use cost_unit_chf, not native price | HIGH (P&L wrong) |
| 6. Fees always zero | No CSV parsing | Parse fees columns, store in separate table columns | MEDIUM (audit trail incomplete) |
| 7. Missing/duplicate cash | No movement logic | Create movements only on successful INSERT, per currency | HIGH (cash balance wrong) |
| 8. Splits not paired | Parser doesn't pair | Parser pairs open+close before RPC | MEDIUM (split logic fragmented) |
| 9. Rollback sum errors | Wrong aggregation | Sum base_amount_chf only, by currency separately | HIGH (rollback incorrect) |
| 10. Tests are RAISE NOTICE | No actual RPC calls | Call import_csv_batch() and rollback_import_batch() with assertions | LOW (testing incomplete) |

---
