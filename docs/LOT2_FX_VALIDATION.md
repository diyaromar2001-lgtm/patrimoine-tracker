# Lot 2 — FX Rate Validation (From Real CSV)

**Status**: ANALYSIS COMPLETE
**Purpose**: Validate the exact formula for converting quantity × price to CHF total

---

## 3 Real CSV Examples

### Example 1: Market Buy (USD)
**CSV Line 4** (2025-07-08):
```
Action: Market buy
Ticker: AIAI
No. of shares: 0.1037849900
Price / share: 24.1850000000 USD
Exchange rate: 1.25501999
Total: 2.00 CHF
```

**Validation**:
```
quantity × price = 0.1037849900 × 24.1850000000 = 2.50800... USD

Option A (DIVIDE by rate): 2.50800 / 1.25501999 = 1.99869... CHF ≈ 2.00 ✓ CORRECT
Option B (MULTIPLY by rate): 2.50800 × 1.25501999 = 3.14836... CHF ≠ 2.00 ✗ WRONG

CONFIRMED: total_chf = (quantity × price_native) / exchange_rate
```

### Example 2: Market Buy (EUR)
**CSV Line 7** (2025-07-09):
```
Action: Market buy
Ticker: EUNL
No. of shares: 0.1271267500
Price / share: 100.7200000000 EUR
Exchange rate: 1.06879851
Total: 12.00 CHF
```

**Validation**:
```
quantity × price = 0.1271267500 × 100.7200000000 = 12.80468... EUR

Option A (DIVIDE by rate): 12.80468 / 1.06879851 = 11.97920... CHF ≈ 12.00 ✓ CORRECT
Option B (MULTIPLY by rate): 12.80468 × 1.06879851 = 13.69669... CHF ≠ 12.00 ✗ WRONG

CONFIRMED: total_chf = (quantity × price_native) / exchange_rate
```

### Example 3: Market Buy (GBP)
**CSV Line 21** (2025-07-10):
```
Action: Market buy
Ticker: GBDV
No. of shares: 0.1507491200
Price / share: 26.4900000000 GBP
Exchange rate: 0.92438522
Total: 4.33 CHF
```

**Validation**:
```
quantity × price = 0.1507491200 × 26.4900000000 = 3.99321... GBP

Option A (DIVIDE by rate): 3.99321 / 0.92438522 = 4.32189... CHF ≈ 4.33 ✓ CORRECT
Option B (MULTIPLY by rate): 3.99321 × 0.92438522 = 3.68816... CHF ≠ 4.33 ✗ WRONG

CONFIRMED: total_chf = (quantity × price_native) / exchange_rate
```

---

## Formula Definition

**Trading 212 Convention**:

```
total_amount_chf = (quantity × price_native) / exchange_rate

Where:
  quantity = number of shares
  price_native = price in original currency (USD, EUR, GBP, etc.)
  exchange_rate = rate published by Trading 212 for that date/time
  total_amount_chf = final amount in CHF
```

**Interpretation**:
- `exchange_rate` is **1 unit of price_currency = exchange_rate CHF**
- Example: EUR exchange_rate = 1.06879851 means 1 EUR = 1.06879851 CHF

---

## Edge Case: CHF Buy (Line 19, 38)

**CSV Line 19** (CHF pricing):
```
No. of shares: 0.0232583100
Price / share: 92.8700000000 CHF
Exchange rate: 1.00000000
Total: 2.16 CHF
```

**Calculation**:
```
quantity × price = 0.0232583100 × 92.8700000000 = 2.16084... CHF
exchange_rate = 1.00000000

total_chf = 2.16084 / 1.00000000 = 2.16084 CHF ≈ 2.16 ✓
```

**Implication**: When base_currency (CHF) = price_currency, exchange_rate = 1.0 exactly.

---

## P&L Calculation (SELL)

**CSV Line 8** (Market sell):
```
Ticker: AIAI
No. of shares: 0.1037849900
Price / share: 24.0350000000 USD
Exchange rate: 1.25350363
Result: -0.01 CHF
Total: 1.99 CHF
```

**Calculation**:
```
Sale proceeds CHF = (0.1037849900 × 24.0350000000) / 1.25350363
                  = 2.49336... / 1.25350363
                  = 1.98905... CHF ≈ 1.99 CHF

P&L (Result) = Sale proceeds - Cost basis
             = 1.99 - (2.00 from Example 1)
             = -0.01 CHF ✓
```

---

## Summary

| Aspect | Value | Note |
|--------|-------|------|
| Exchange rate formula | `total_chf = (qty × price_native) / rate` | Divide, not multiply |
| Rate interpretation | 1 unit_native = rate CHF | Standard FX convention |
| CHF buys | rate = 1.0 | No conversion needed |
| P&L calculation | sale_proceeds_chf - cost_basis_chf | Both in CHF |

---

## Implementation Impact

**v4 Schema**:
1. All `base_amount_chf` = `(quantity × price_native) / exchange_rate`
2. All cost_basis_chf stored in CHF
3. P&L calculations use CHF values only
4. No mixing of native currency prices with CHF amounts
