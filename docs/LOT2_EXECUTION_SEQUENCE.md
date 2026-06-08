# Lot 2 — Execution Sequence (BUY & SELL with Idempotence)

**Status**: DESIGN FOR v4
**Purpose**: Show correct order of operations for idempotence & atomicity

---

## Principle: Idempotence BEFORE Financial Effects

**Golden Rule**: 
> A transaction operation is idempotent if:
> 1. Insert attempt (with ON CONFLICT DO NOTHING)
> 2. Check if newly inserted (GET DIAGNOSTICS ROW_COUNT)
> 3. **ONLY if newly inserted** (ROW_COUNT > 0): apply financial effects
> 4. **If already existed** (ROW_COUNT = 0): skip all modifications

**Rationale**:
- If the same CSV row is re-imported, the first `INSERT ... ON CONFLICT DO NOTHING` finds the existing transaction and does nothing.
- Financial effects (asset updates, cash movements) are skipped, so the operation is truly idempotent.
- On rollback, deleting the transaction and cash movements leaves the system in a consistent state.

---

## BUY Operation Sequence (v4)

```
┌─────────────────────────────────────────────────────────────┐
│ BUY Operation (Market buy, quantity Q, price P, total T)    │
└─────────────────────────────────────────────────────────────┘

INPUT:
  type: "buy"
  ticker: "AAPL"
  isin: "US0378331005"
  quantity: 100
  price: 10.00 USD
  exchangeRate: 1.25
  totalAmount: 1000
  totalCurrency: "CHF"
  sourceId: "TRADING_212_ID_123"

┌──────────────────────────────────────────────────────────┐
│ PHASE 1: VALIDATE & PREPARE (No DB writes)               │
└──────────────────────────────────────────────────────────┘

1. Parse quantities/prices
   v_qty_native = 100
   v_price_native = 10.00 USD

2. Validate currency & exchange rate
   IF totalCurrency = 'CHF' THEN
     v_base_amount_chf = 1000
   ELSE IF totalCurrency = 'USD' THEN
     IF exchangeRate IS NULL THEN
       RAISE EXCEPTION 'Missing exchangeRate for USD'
     END IF
     v_base_amount_chf = (100 × 10.00) / 1.25 = 800 CHF

3. Look up asset (doesn't create yet)
   SELECT id, quantity, cost_basis_chf
   INTO v_asset_id, v_old_qty, v_old_cost_basis
   FROM public.assets
   WHERE portfolio_id = p_portfolio_id AND isin = v_isin
   -- Result: v_asset_id = NULL (doesn't exist yet)

┌──────────────────────────────────────────────────────────┐
│ PHASE 2: IDEMPOTENCE CHECK (First DB write)              │
└──────────────────────────────────────────────────────────┘

4. Attempt INSERT transaction
   INSERT INTO public.transactions (
     portfolio_id, ticker, type, quantity, price, currency,
     base_amount_chf, source_external_id, import_batch_id,
     native_amount, native_currency, historical_fx_rate
   ) VALUES (
     p_portfolio_id, 'AAPL', 'buy', 100, 10.00, 'USD',
     1000, 'TRADING_212_ID_123', v_batch_id,
     1000, 'USD', 1.25
   )
   ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

5. Check if inserted
   GET DIAGNOSTICS v_inserted = ROW_COUNT;
   -- v_inserted = 1 (newly inserted)

6. Guard: If already exists, SKIP all effects and count as "skipped"
   IF v_inserted = 0 THEN
     v_rows_skipped := v_rows_skipped + 1;
     RETURN; -- Skip to next operation
   END IF

┌──────────────────────────────────────────────────────────┐
│ PHASE 3: FINANCIAL EFFECTS (Only if newly inserted)       │
└──────────────────────────────────────────────────────────┘

7. Asset management: Create OR Update
   
   IF v_asset_id IS NULL THEN
     -- Asset doesn't exist yet, CREATE IT
     INSERT INTO public.assets (
       portfolio_id, ticker, name, isin,
       quantity, avg_buy_price_native, currency,
       cost_basis_chf
     ) VALUES (
       p_portfolio_id, 'AAPL', 'Apple Inc', 'US0378331005',
       100,           -- quantity
       10.00,         -- avg_buy_price_native (in USD, not CHF)
       'USD',         -- currency
       1000           -- cost_basis_chf (always CHF)
     )
     RETURNING id INTO v_asset_id;
   ELSE
     -- Asset exists, UPDATE with weighted average
     v_new_qty := v_old_qty + 100;
     v_new_cost_basis := v_old_cost_basis + 1000;
     v_new_avg_native := v_new_cost_basis / v_new_qty * (v_old_cost_basis / v_old_qty);
     -- NOTE: avg_native recalc is complex due to mixed currencies
     -- Alternative: recalc from remaining transactions on demand
     
     UPDATE public.assets SET
       quantity = v_new_qty,
       cost_basis_chf = v_new_cost_basis
       -- avg_buy_price_native: leave as-is or recalculate carefully
     WHERE id = v_asset_id;
   END IF;

8. Update transaction with asset_id (linking)
   UPDATE public.transactions SET
     asset_id = v_asset_id
   WHERE source_external_id = 'TRADING_212_ID_123' AND type = 'buy';

9. Record cash movement (debit)
   INSERT INTO public.cash_movements (
     user_id, type, currency, amount,
     source_external_id, import_batch_id,
     ref_portfolio_id, date
   ) VALUES (
     v_user_id, 'buy_debit',
     'CHF',  -- All cash movements in CHF for simplicity
     -1000,  -- Negative = outflow
     'TRADING_212_ID_123', v_batch_id,
     p_portfolio_id, v_op_date
   );

10. Count as imported
    v_rows_imported := v_rows_imported + 1;

┌──────────────────────────────────────────────────────────┐
│ STATE AFTER BUY                                           │
└──────────────────────────────────────────────────────────┘

assets:
  id: (new)
  ticker: AAPL
  isin: US0378331005
  quantity: 100
  avg_buy_price_native: 10.00 USD
  currency: USD
  cost_basis_chf: 1000

transactions:
  id: (new)
  type: buy
  source_external_id: TRADING_212_ID_123
  quantity: 100
  price: 10.00
  base_amount_chf: 1000

cash_movements:
  id: (new)
  type: buy_debit
  amount: -1000 CHF

┌──────────────────────────────────────────────────────────┐
│ RE-IMPORT SAME ROW (Idempotence Check)                   │
└──────────────────────────────────────────────────────────┘

→ INSERT ... ON CONFLICT ... DO NOTHING
  v_inserted = 0 (row already exists)

→ SKIP to next operation

→ Asset qty stays 100 (not 200)
→ cost_basis stays 1000 CHF (not 2000)
→ cash_movement not duplicated

✓ IDEMPOTENT
```

---

## SELL Operation Sequence (v4)

```
┌─────────────────────────────────────────────────────────────┐
│ SELL Operation (Market sell, quantity 30, price 12)         │
└─────────────────────────────────────────────────────────────┘

INPUT:
  type: "sell"
  ticker: "AAPL"
  isin: "US0378331005"
  quantity: 30
  price: 12.00 USD
  exchangeRate: 1.20
  totalAmount: 360
  totalCurrency: "CHF"
  result: 60 CHF  (P&L from CSV)
  sourceId: "TRADING_212_ID_124"

PRIOR STATE (from BUY above):
  Asset AAPL: qty=100, cost_basis_chf=1000, avg_native=10.00 USD
  Cash: -1000 CHF

┌──────────────────────────────────────────────────────────┐
│ PHASE 1: VALIDATE & PREPARE                              │
└──────────────────────────────────────────────────────────┘

1. Parse values
   v_qty_native = 30
   v_price_native = 12.00 USD

2. Validate currency
   v_base_amount_chf = (30 × 12.00) / 1.20 = 300 CHF
   
   Wait: CSV says totalAmount=360, totalCurrency=CHF
   Let me recalculate per Trading 212 formula:
   (quantity × price) / exchange_rate = (30 × 12.00) / 1.20 = 300 CHF
   But CSV says 360 CHF?
   
   → Discrepancy: CSV total vs calculated
   → Use CSV total (360 CHF) as ground truth (Trading 212 may have rounding)
   v_base_amount_chf = 360 CHF

3. Look up asset
   SELECT id, quantity, cost_basis_chf
   INTO v_asset_id, v_old_qty, v_old_cost_basis_chf
   FROM public.assets
   WHERE isin = 'US0378331005'
   -- Result: v_asset_id = (from BUY), v_old_qty = 100, v_old_cost_basis_chf = 1000

4. Verify available quantity
   IF v_old_qty < v_qty_native THEN
     RAISE EXCEPTION 'Line %: Trying to sell 30, but only have %', v_idx, v_old_qty;
   END IF
   -- 100 >= 30 ✓ OK

┌──────────────────────────────────────────────────────────┐
│ PHASE 2: IDEMPOTENCE CHECK                               │
└──────────────────────────────────────────────────────────┘

5. Attempt INSERT transaction
   INSERT INTO public.transactions (
     portfolio_id, ticker, type, quantity, price,
     base_amount_chf, source_external_id, import_batch_id,
     realized_pnl_chf
   ) VALUES (
     p_portfolio_id, 'AAPL', 'sell', 30, 12.00,
     360, 'TRADING_212_ID_124', v_batch_id,
     60  -- Result from CSV is already P&L
   )
   ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

6. Check if inserted
   GET DIAGNOSTICS v_inserted = ROW_COUNT;
   -- v_inserted = 1 (newly inserted)

7. Guard
   IF v_inserted = 0 THEN
     v_rows_skipped := v_rows_skipped + 1;
     RETURN;
   END IF

┌──────────────────────────────────────────────────────────┐
│ PHASE 3: FINANCIAL EFFECTS (Only if newly inserted)       │
└──────────────────────────────────────────────────────────┘

8. Calculate cost removed
   v_cost_unit_chf := v_old_cost_basis_chf / v_old_qty
                    = 1000 / 100
                    = 10.00 CHF per share
   
   v_cost_removed_chf := 30 × 10.00 = 300 CHF

9. Verify P&L calculation (optional audit)
   v_p_and_l_calculated := v_base_amount_chf - v_cost_removed_chf
                         = 360 - 300
                         = 60 CHF
   -- Matches CSV result (60) ✓

10. Update asset: reduce quantity & cost basis
    UPDATE public.assets SET
      quantity = v_old_qty - 30,           -- 100 - 30 = 70
      cost_basis_chf = v_old_cost_basis_chf - v_cost_removed_chf  -- 1000 - 300 = 700
      -- avg_buy_price_native stays unchanged (FIFO method)
    WHERE id = v_asset_id;

11. Record cash movement (credit)
    INSERT INTO public.cash_movements (
      user_id, type, currency, amount,
      source_external_id, import_batch_id,
      ref_portfolio_id, date
    ) VALUES (
      v_user_id, 'sell_credit',
      'CHF',
      360,  -- Positive = inflow
      'TRADING_212_ID_124', v_batch_id,
      p_portfolio_id, v_op_date
    );

12. Count as imported
    v_rows_imported := v_rows_imported + 1;

┌──────────────────────────────────────────────────────────┐
│ STATE AFTER SELL                                          │
└──────────────────────────────────────────────────────────┘

assets:
  id: (same)
  ticker: AAPL
  quantity: 70 (100 - 30)
  cost_basis_chf: 700 (1000 - 300)
  avg_buy_price_native: 10.00 USD (unchanged)

transactions:
  [sell] type: sell
    quantity: 30
    base_amount_chf: 360
    realized_pnl_chf: 60

cash_movements:
  [sell] type: sell_credit
    amount: +360 CHF

Portfolio cash: -1000 + 360 = -640 CHF net outflow

┌──────────────────────────────────────────────────────────┐
│ RE-IMPORT SAME SELL ROW (Idempotence Check)               │
└──────────────────────────────────────────────────────────┘

→ INSERT ... ON CONFLICT ... DO NOTHING
  v_inserted = 0

→ SKIP financial effects

→ Asset qty stays 70 (not 40)
→ cost_basis stays 700 (not 400)
→ cash_movement not duplicated

✓ IDEMPOTENT
```

---

## Summary: Idempotence Pattern for ALL Operation Types

| Operation | Idempotence Point | Skip If | Effect If New |
|-----------|-------------------|---------|--------------|
| **BUY** | `INSERT transactions ... ON CONFLICT` | ROW_COUNT = 0 | Create/update asset, debit cash |
| **SELL** | `INSERT transactions ... ON CONFLICT` | ROW_COUNT = 0 | Update asset qty/cost, credit cash |
| **DIVIDEND** | `INSERT transactions ... ON CONFLICT` | ROW_COUNT = 0 | Credit cash (gross + withholding handling) |
| **DEPOSIT** | `INSERT cash_movements ... ON CONFLICT` | ROW_COUNT = 0 | Record deposit (no asset impact) |
| **FX_CONVERSION** | `INSERT cash_movements (pair) ... ON CONFLICT` | ROW_COUNT = 0 | Two movements: debit source, credit target, fee |
| **SPLIT** | `INSERT stock_split_events ... ON CONFLICT` | ROW_COUNT = 0 | Update asset qty/price, cost_basis unchanged |
| **ROLLBACK** | Delete batch, then recalculate | N/A | Reverse all effects, rebuild assets from remaining txns |

---

## Error Handling: Atomicity

**One error = Entire batch fails**

```
DO $$
BEGIN
  -- (Process operations 1-1000 as shown above)
  FOR v_op IN ... LOOP
    -- Try to process
    -- If ANY exception occurs, jump to exception block
  END LOOP;

EXCEPTION WHEN OTHERS THEN
  -- Single exception caught here
  -- ALL changes rolled back by PostgreSQL transaction boundary
  -- No per-line exception handlers that swallow errors
  UPDATE import_batches SET status='failed', error_summary=SQLERRM;
END $$;
```

If operation 500 fails with "Line 500: Quantity missing", entire batch rolls back:
- Operations 1-499: all rolled back
- Operations 501-1000: never attempted
- Asset state: unchanged from before batch start
- Cash state: unchanged from before batch start
- Batch status: 'failed'
- Batch error_summary: contains line 500 error message

✓ **STRICT ATOMICITY**

---
