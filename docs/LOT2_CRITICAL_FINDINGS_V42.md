# Lot 2 — Critical Findings for v4.2

**Status**: ANALYSIS COMPLETE
**Date**: 2026-06-08

---

## 1. Rollback: avg_buy_price NOT Recalculated

**Problem v4.1**:
```sql
UPDATE public.assets SET
  quantity = v_qty,
  cost_basis_chf = v_cost_basis_chf
WHERE id = p_asset_id;
-- ❌ avg_buy_price NOT UPDATED
```

**v4.2 Fix**:
- Calculate weighted average NATIVE price while replaying
- Formula: `avg_buy_price = SUM(buy_qty × buy_price_native) / SUM(buy_qty)`
- For SELL: price unchanged
- For position = 0: avg_buy_price = 0

---

## 2. Rollback: Splits NOT Replayed

**Problem v4.1**:
```sql
FOR v_tx_record IN
  SELECT type, quantity, base_amount_chf, date
  FROM public.transactions  -- ❌ Ignores stock_split_events
```

**v4.2 Fix**:
- Unified chronological replay:
  - BUY: qty += quantity, cost += base_amount_chf, avg_price += weighted
  - SELL: qty -= quantity, cost -= unit_cost
  - SPLIT: qty adjusted, cost unchanged (from stock_split_events)
- Collect asset_id from BOTH tables:
  ```sql
  SELECT DISTINCT asset_id FROM transactions WHERE ... 
  UNION
  SELECT DISTINCT asset_id FROM stock_split_events WHERE import_batch_id = ...
  ```

---

## 3. Assets Cleanup After Rollback

**Problem v4.1**:
- Assets with qty=0 and no transactions left behind (ghosts)

**v4.2 Fix**:
```sql
-- After recalculation
DELETE FROM public.assets
WHERE id IN (
  SELECT DISTINCT asset_id FROM (
    SELECT asset_id FROM transactions GROUP BY asset_id HAVING COUNT(*)=0
    UNION
    SELECT asset_id FROM stock_split_events GROUP BY asset_id HAVING COUNT(*)=0
  )
) AND quantity = 0;
```

---

## 4. Fees Applied to Calculations

**Problem v4.1**:
- Fees stored in transaction_fees_native, but NOT added to cost_basis_chf
- Cash movement = total_amount, ignores fees

**v4.2 Semantics**:
- **BUY**:
  - CSV Total typically INCLUDES fees
  - cost_basis_chf = total_amount (if CHF) or (qty × price) / fx_rate (if USD/EUR)
  - Fees already in the total
  - Cash debit = Total (fees included)

- **SELL**:
  - CSV Total typically INCLUDES fees (deducted from proceeds)
  - Proceeds net = Total (after fees)
  - P&L = proceeds_net - cost_removed
  - Cash credit = Total (net)

**Verification needed from real CSV**:
- Line 4: Total = 2.00 CHF. Quantity × Price / FX = 2.00809. Difference = 0.00809 CHF
  - Is this a rounding error OR a fee?
  - If fee: need to know fee amount separately
- Line 8 (SELL): Result = -0.01 CHF. Is this net of fees?

**v4.2 Approach**:
- Assume CSV Total INCLUDES fees (typical for brokers)
- Store fees separately for audit
- Do NOT double-apply fees to cost_basis
- Document assumption clearly

---

## 5. Dividends: Brut vs Net

**Problem v4.1**:
- Assumption: Total = gross dividend
- But if Total = net (after withholding), this is wrong

**Verification needed from real CSV**:
- If Dividend line: quantity=70, price=0.25, withholding=2.62
- Total should be:
  - Gross: 70 × 0.25 = 17.50 CHF
  - Net: 17.50 - 2.62 = 14.88 CHF
- Check actual Total in CSV

**v4.2 Solution**:
```sql
-- Store all three:
dividend_gross_amount numeric,
dividend_gross_currency text,
withholding_tax_amount numeric,
withholding_tax_currency text,
dividend_net_amount numeric,
dividend_net_currency text,

-- Cash movement = net
INSERT INTO cash_movements (..., amount) VALUES (..., dividend_net_amount)
-- Withholding tracked separately for tax audit
```

---

## 6. FX Rate: Unambiguous Definition

**Problem v4.1**:
- Doc says "1 unit = rate CHF"
- Formula is division: CHF = native / rate
- Contradiction!

**Correct Statement for v4.2**:
```
Exchange rate from Trading 212 is defined as:
  rate = CHF_amount / native_amount

Example:
  - Buy 0.1037849900 AIAI @ 24.1850 USD
  - Total = 2.00 CHF
  - Calculation: (0.1037849900 × 24.1850 USD) / rate = 2.00 CHF
  - So: rate = 2.50809 / 2.00 = 1.25401999

This means: 1 USD (in this transaction) converted at rate 1.25401999 CHF

Note: Rate varies by transaction (not constant), reflecting real FX volatility.
```

**No ambiguity**: Always divide.

---

## 7. Precompile Checks

**v4.2 Must Verify**:
```sql
-- Check CHECK constraints on type columns
SELECT constraint_definition FROM information_schema.check_constraints
WHERE table_name IN ('transactions', 'cash_movements')
AND constraint_name LIKE '%type%';

-- Verify enums (if used)
SELECT enum_range(NULL::transaction_type);  -- If enum exists

-- Verify columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'transactions'
AND column_name IN ('base_amount_chf', 'realized_pnl_chf', 'withholding_tax_amount', ...);

-- Verify foreign keys
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'transactions' AND constraint_type = 'FOREIGN KEY';
```

**Allowed values for v4.2**:
- `transactions.type`: 'buy', 'sell', 'dividend', 'transfer'
- `cash_movements.type`: 'deposit', 'withdrawal', 'dividend', 'withholding_tax', 'conversion', 'interest', 'revenue_credit', 'fx_fee', 'buy', 'sell'
- Check if these are already allowed

---

## 8. Tests with Assertions

**Problem v4.1**:
```sql
SELECT 'TEST_1_VERIFY_ASSET' as section,
  qty, cost_basis_chf
FROM assets WHERE isin = ...;
-- User must manually check if qty = expected value
```

**v4.2 Approach**:
```sql
DO $$
DECLARE
  v_qty numeric;
  v_cost_basis_chf numeric;
BEGIN
  SELECT quantity, cost_basis_chf INTO v_qty, v_cost_basis_chf
  FROM assets WHERE isin = 'US0378331005';

  IF v_qty <> 70 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Expected qty=70, got %', v_qty;
  END IF;

  IF v_cost_basis_chf <> 700 THEN
    RAISE EXCEPTION 'TEST_1 FAILED: Expected cost_basis=700, got %', v_cost_basis_chf;
  END IF;

  RAISE NOTICE 'TEST_1 PASSED: qty=70, cost_basis=700';
END $$;
```

**Each test**:
- Uses DO $$ block with asserts
- Raises EXCEPTION if any value wrong
- NOTICE if PASSED
- Stops at first failure

---

## 9. Authenticated Test Context

**Problem v4.1**:
- Tests assume `auth.uid()` works in SQL Editor
- It doesn't without JWT

**v4.2 Solution**:

Option A: **Supabase Local (recommended)**
```bash
# Start Supabase locally
supabase start

# Get anon key from supabase/config.toml
# Create test user in Auth tab or use anon key

# Run tests from authenticated context (e.g., PostgREST client)
```

Option B: **Test RPC with simulated JWT (for CI/CD)**
```sql
-- Simulate JWT by setting claims before RPC call
-- (Not possible in standard SQL; requires PostgreSQL 10+ SECURITY DEFINER tricks)

-- Alternative: Use Supabase SDK from Node/Python test script
```

Option C: **Documentation + Manual Testing**
```
v4.2 includes:
1. SQL for local Supabase
2. Script for PostgREST client test
3. Node.js test harness using @supabase/supabase-js
```

---

## 10. Disposable Test Database

**Workflow for v4.2**:
1. **Local Supabase**: `supabase start` on staging branch
2. **Run precompile checks**: `LOT2_PRECOMPILE_CHECK.sql`
3. **Apply schema**: `import-schema-v4.2-FINAL.sql`
4. **Run tests**: `LOT2_TEST_QUERIES_v4.2-WITH-ASSERTIONS.sql`
5. **Verify all PASSED**
6. **Generate report**: CSV of test results
7. **Clean up**: `supabase stop` (disposable)
8. **Approve for production**: Only if 100% pass

**v4.2 deliverables**:
- SQL migration
- Test suite
- Test report template
- Deployment guide
- Rollback procedure

---

## Summary: v4.2 Blockers vs v4.1

| # | v4.1 Issue | v4.2 Fix | Blocker |
|---|-----------|----------|---------|
| 1 | avg_buy_price not recalced | Replay chronologically | YES |
| 2 | Splits ignored in rollback | Unified replay (txns + splits) | YES |
| 3 | Ghost assets left | Cleanup assets qty=0 | HIGH |
| 4 | Fees not applied | CSV semantics clarified | MEDIUM |
| 5 | Dividend brut/net unclear | Verify + store both | MEDIUM |
| 6 | FX rate contradictory | Single unambiguous formula | LOW |
| 7 | No precompile checks | Add constraint verification | HIGH |
| 8 | Tests no assertions | Real PL/pgSQL asserts | HIGH |
| 9 | Auth context unsure | Documented approach | MEDIUM |
| 10 | No test database | Local Supabase workflow | MEDIUM |

---
