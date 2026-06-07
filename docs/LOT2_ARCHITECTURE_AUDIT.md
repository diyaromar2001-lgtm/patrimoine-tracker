# Lot 2 — Architecture Audit & Design

**Date**: 2026-06-08
**Status**: PLANNING (no SQL executed)

---

## AUDIT 1: Existing Tables

### `portfolios` (✓ Exists)
```sql
CREATE TABLE portfolios (
  id              uuid PRIMARY KEY
  user_id         uuid (nullable — demo mode OK)
  name            text NOT NULL
  description     text
  color           text DEFAULT '#3b82f6'
  currency        text DEFAULT 'CHF'
  cash_balances   jsonb DEFAULT '{"CHF":0,"USD":0,"EUR":0}' (added in revenus-schema)
  created_at      timestamptz
)
```
**RLS**: `allow_all_portfolios` (no auth yet)
**FK**: None (it's the root table)

---

### `assets` (✓ Exists — MISSING ISIN)
```sql
CREATE TABLE assets (
  id                  uuid PRIMARY KEY
  portfolio_id        uuid REFERENCES portfolios(id) ON DELETE CASCADE
  ticker              text NOT NULL
  name                text NOT NULL
  asset_class         text CHECK (asset_class IN ('stock','etf','crypto','real_estate','bond','cash'))
  quantity            numeric NOT NULL
  avg_buy_price       numeric NOT NULL
  currency            text DEFAULT 'CHF'
  cost_basis_chf      numeric DEFAULT 0
  cost_basis_source   text CHECK (cost_basis_source IN ('computed','manual','backfill'))
  cost_basis_updated_at timestamptz DEFAULT now()
  sector              text
  country             text
  crypto_custody      text
  staking_enabled     boolean DEFAULT false
  created_at          timestamptz
)
```
**RLS**: `allow_all_assets`
**Missing**: `isin` (REQUIRED for CSV import)

---

### `transactions` (✓ Exists — NEEDS ENHANCEMENT)
```sql
CREATE TABLE transactions (
  id                 uuid PRIMARY KEY
  portfolio_id       uuid REFERENCES portfolios(id) ON DELETE CASCADE
  ticker             text NOT NULL
  asset_name         text NOT NULL
  asset_class        text NOT NULL
  type               text NOT NULL  -- buy|sell|dividend|transfer
  quantity           numeric NOT NULL
  price              numeric NOT NULL
  fees               numeric DEFAULT 0
  currency           text DEFAULT 'CHF'
  fx_rate_to_chf     numeric DEFAULT 1
  gross_amount_chf   numeric DEFAULT 0
  fees_chf           numeric DEFAULT 0
  net_amount_chf     numeric DEFAULT 0
  realized_pnl_chf   numeric DEFAULT 0
  date               date NOT NULL
  notes              text
  created_at         timestamptz
)
```
**RLS**: `allow_all_transactions`
**Missing**: 
- `asset_id` (FK to assets)
- `source` (broker name)
- `source_external_id` (Trading 212 ID)
- `import_batch_id` (FK to import_batches)
- `native_currency` (price currency)
- `native_amount` (quantity × price in native currency)
- `historical_fx_rate` (separate from fx_rate_to_chf)
- `total_currency` (CHF or USD)
- `total_amount` (final amount in total_currency)
- `base_currency` (user's base currency)
- `base_amount` (amount in base currency)
- `raw_payload` (full JSON from CSV)

---

### `cash_movements` (✓ Exists)
```sql
CREATE TABLE cash_movements (
  id                 uuid PRIMARY KEY
  user_id            uuid REFERENCES auth.users(id) NOT NULL
  type               text NOT NULL  -- deposit|withdrawal|conversion|buy_deduction|sell_credit|dividend_credit|revenue_credit
  currency           text DEFAULT 'CHF'
  amount             decimal NOT NULL
  balance_after_chf  decimal
  balance_after_usd  decimal
  balance_after_eur  decimal
  note               text
  ref_ticker         text
  ref_portfolio_id   uuid REFERENCES portfolios(id) ON DELETE SET NULL
  date               timestamptz DEFAULT now()
  created_at         timestamptz
)
```
**RLS**: `users_own_cash_movements`
**Missing**:
- `import_batch_id` (link to batch)
- `source_external_id` (trading ID)

---

### `global_cash` (✓ Exists)
```sql
CREATE TABLE global_cash (
  id        uuid PRIMARY KEY
  user_id   uuid REFERENCES auth.users(id) UNIQUE NOT NULL
  chf       decimal DEFAULT 0
  usd       decimal DEFAULT 0
  eur       decimal DEFAULT 0
  updated_at timestamptz DEFAULT now()
)
```
**RLS**: `users_own_global_cash`

---

### `revenus_annexes` (✓ Exists)
```sql
CREATE TABLE revenus_annexes (
  id           uuid PRIMARY KEY
  portfolio_id uuid REFERENCES portfolios(id) ON DELETE CASCADE
  user_id      uuid REFERENCES auth.users(id) NOT NULL
  type         text NOT NULL  -- parrainage|bonus_bienvenue|airdrop|interets|cashback|staking|autre
  label        text NOT NULL
  amount       decimal NOT NULL
  currency     text DEFAULT 'CHF'
  platform     text
  date         timestamptz DEFAULT now()
  notes        text
  created_at   timestamptz
)
```
**RLS**: `users_own_revenus`

---

## AUDIT 2: Missing Tables for CSV Import

### 🔴 REQUIRED: `import_batches` (NEW)

Purpose: Track batch imports, enable idempotence, provide audit trail

```sql
CREATE TABLE import_batches (
  id                uuid PRIMARY KEY
  user_id           uuid NOT NULL
  portfolio_id      uuid NOT NULL
  broker            text NOT NULL  -- 'Trading 212' | 'Interactive Brokers' | etc.
  filename          text NOT NULL  -- original filename
  file_checksum     text NOT NULL  -- SHA-256 hash
  status            text NOT NULL CHECK (status IN ('pending','processing','success','partial','failed'))
  rows_total        integer NOT NULL
  rows_imported     integer DEFAULT 0
  rows_skipped      integer DEFAULT 0
  rows_failed       integer DEFAULT 0
  created_at        timestamptz DEFAULT now()
  completed_at      timestamptz
  error_summary     jsonb  -- { "line": N, "field": "...", "error": "..." }
  
  UNIQUE (user_id, broker, file_checksum)  -- Prevent re-import of same file
)
```

**RLS**:
```sql
CREATE POLICY "users_own_batches"
  ON import_batches FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

**Indexes**:
```sql
CREATE INDEX import_batches_user_id ON import_batches(user_id);
CREATE INDEX import_batches_portfolio_id ON import_batches(portfolio_id);
CREATE INDEX import_batches_status ON import_batches(status);
```

---

## AUDIT 3: Column Additions to Existing Tables

### `assets` → Add `isin`

```sql
ALTER TABLE assets ADD COLUMN IF NOT EXISTS isin text UNIQUE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();
```

**Why Unique**: One ISIN per portfolio (same instrument can't be imported twice under different names)

---

### `transactions` → Add Import Tracking & Multi-Currency Support

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';  -- 'manual' | 'trading_212' | 'ib' | etc.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_external_id text;  -- Trading 212 ID, IB ID, etc.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);

-- CSV Import: Multi-currency fields
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS native_currency text;  -- currency of price/amount in source
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS native_amount numeric;  -- quantity × price in native_currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS historical_fx_rate numeric;  -- rate at transaction date
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_currency text;  -- CHF or USD (from CSV Total column)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_amount numeric;  -- final amount in total_currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_currency text;  -- user's base currency
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_amount numeric;  -- amount converted to base

-- Raw data preservation
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_payload jsonb;  -- full Trading 212 row as JSON

-- Idempotence
CREATE UNIQUE INDEX IF NOT EXISTS transactions_source_external_id
  ON transactions(portfolio_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;
```

---

### `cash_movements` → Add Import Tracking

```sql
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);
```

---

## AUDIT 4: TypeScript Types (lib/types.ts)

**Existing**:
```typescript
export interface Transaction {
  id: string
  portfolioId: string
  assetId?: string  // Already present but DB doesn't use it
  ticker: string
  assetName: string
  assetClass: AssetClass
  type: TransactionType  // buy|sell|dividend|transfer|revenu|deposit|withdrawal|conversion
  quantity: number
  price: number
  fees: number
  currency: Currency  // ⚠️ Used as "native currency" but unclear
  fxRateToChf?: number
  grossAmountChf?: number
  feesChf?: number
  netAmountChf?: number
  realizedPnlChf?: number
  date: string
  notes?: string
}

export interface Asset {
  id: string
  portfolioId: string
  ticker: string
  name: string
  assetClass: AssetClass
  quantity: number
  avgBuyPrice: number
  currentPrice: number
  currency: Currency
  costBasisChf?: number
  costBasisSource?: CostBasisSource
}
```

**Need to Add**:
```typescript
export interface ImportBatch {
  id: string
  userId: string
  portfolioId: string
  broker: string
  filename: string
  fileChecksum: string
  status: 'pending' | 'processing' | 'success' | 'partial' | 'failed'
  rowsTotal: number
  rowsImported: number
  rowsSkipped: number
  rowsFailed: number
  createdAt: string
  completedAt?: string
  errorSummary?: Record<string, unknown>
}

// Update Asset to include ISIN
export interface Asset {
  // ... existing ...
  isin?: string
  isinUpdatedAt?: string
}

// Update Transaction for CSV import
export interface Transaction {
  // ... existing ...
  source?: string
  sourceExternalId?: string
  importBatchId?: string
  nativeCurrency?: Currency
  nativeAmount?: number
  historicalFxRate?: number
  totalCurrency?: Currency
  totalAmount?: number
  baseCurrency?: Currency
  baseAmount?: number
  rawPayload?: Record<string, unknown>
}
```

---

## DESIGN 1: Idempotence Strategy

### Level 1: Batch Deduplication
**Prevention**: File cannot be imported twice
```sql
-- Unique constraint on (user_id, broker, file_checksum)
UNIQUE(user_id, broker, file_checksum)
```

**Behavior**:
```
First import:   import_batches.id = '123'
                create rows
                status = 'success'

Second import (same file):
                Query: SELECT id FROM import_batches 
                       WHERE user_id = ? AND broker = ? AND file_checksum = ?
                Result: '123' exists
                Action: Return existing batch, show "Already imported"
                        Don't create new rows
```

---

### Level 2: Transaction Idempotence
**Prevention**: Same source_external_id cannot create duplicate transactions

```sql
-- Unique index on (portfolio_id, source, source_external_id)
-- Prevents same Trading 212 ID from creating 2+ rows
UNIQUE INDEX (portfolio_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;
```

**Behavior**:
```
Transaction 1: portfolio_id=123, source='trading_212', source_external_id='EOF35311986184'
               INSERT succeeds

Transaction 2 (same file re-import, same ID):
               INSERT CONFLICT on unique index
               Action: ON CONFLICT DO NOTHING
               Result: 0 rows inserted, no error, silent skip
```

---

### Level 3: Cash Movement Idempotence
Similar approach: `source_external_id + import_batch_id`

---

## DESIGN 2: RPC for Atomic Import

### Function Signature

```sql
CREATE OR REPLACE FUNCTION import_csv_batch(
  p_user_id uuid,
  p_portfolio_id uuid,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb  -- Array of parsed operations from CSV
)
RETURNS TABLE (
  batch_id uuid,
  success boolean,
  rows_total integer,
  rows_imported integer,
  rows_skipped integer,
  rows_failed integer,
  error_message text
)
AS $$
DECLARE
  v_batch_id uuid;
  v_rows_total integer;
  v_rows_imported integer := 0;
  v_rows_skipped integer := 0;
  v_rows_failed integer := 0;
  v_op jsonb;
  v_asset_id uuid;
  v_error_text text;
BEGIN
  -- 1. Verify portfolio belongs to user
  IF NOT EXISTS (
    SELECT 1 FROM portfolios WHERE id = p_portfolio_id AND (user_id = p_user_id OR user_id IS NULL)
  ) THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Portfolio not found or not owned by user'::text;
    RETURN;
  END IF;

  -- 2. Check if batch already imported
  SELECT id INTO v_batch_id FROM import_batches
  WHERE user_id = p_user_id AND broker = p_broker AND file_checksum = p_file_checksum;
  
  IF v_batch_id IS NOT NULL THEN
    -- Already imported
    UPDATE import_batches SET completed_at = now() WHERE id = v_batch_id;
    RETURN QUERY SELECT
      v_batch_id, true, 0, 0, 0, 0, 'Already imported'::text;
    RETURN;
  END IF;

  -- 3. Create batch record
  INSERT INTO import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    p_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum, 'processing', jsonb_array_length(p_operations)
  ) RETURNING import_batches.id INTO v_batch_id;

  v_rows_total := jsonb_array_length(p_operations);

  -- 4. BEGIN transaction block
  BEGIN
    -- Process each operation
    FOR v_op IN SELECT jsonb_array_elements(p_operations)
    LOOP
      BEGIN
        -- Route by operation type
        CASE (v_op ->> 'type')
          WHEN 'buy' THEN
            -- Resolve or create asset
            SELECT id INTO v_asset_id FROM assets
            WHERE portfolio_id = p_portfolio_id AND isin = (v_op ->> 'isin');
            
            IF v_asset_id IS NULL THEN
              INSERT INTO assets (
                portfolio_id, ticker, name, asset_class, isin, quantity, avg_buy_price, currency
              ) VALUES (
                p_portfolio_id,
                v_op ->> 'ticker',
                v_op ->> 'name',
                'stock',
                v_op ->> 'isin',
                (v_op ->> 'quantity')::numeric,
                (v_op ->> 'price')::numeric,
                v_op ->> 'priceCurrency'
              ) RETURNING assets.id INTO v_asset_id;
            END IF;

            -- Insert transaction
            INSERT INTO transactions (
              portfolio_id, asset_id, ticker, asset_name, asset_class, type,
              quantity, price, currency,
              native_currency, native_amount, historical_fx_rate,
              total_currency, total_amount, base_currency, base_amount,
              source, source_external_id, import_batch_id,
              date, notes, raw_payload
            ) VALUES (
              p_portfolio_id, v_asset_id, v_op ->> 'ticker', v_op ->> 'name', 'stock', 'buy',
              (v_op ->> 'quantity')::numeric, (v_op ->> 'price')::numeric,
              v_op ->> 'priceCurrency',
              v_op ->> 'priceCurrency', (v_op ->> 'quantity')::numeric * (v_op ->> 'price')::numeric,
              (v_op ->> 'exchangeRate')::numeric,
              v_op ->> 'totalCurrency', (v_op ->> 'totalAmount')::numeric,
              'CHF', (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId', v_batch_id,
              (v_op ->> 'date')::date, v_op ->> 'notes', v_op
            ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

            v_rows_imported := v_rows_imported + 1;

          -- Handle other types (sell, deposit, dividend, etc.) similarly
          WHEN 'sell' THEN
            -- Similar logic
            v_rows_imported := v_rows_imported + 1;
          
          -- ... more WHEN clauses ...

          ELSE
            v_rows_skipped := v_rows_skipped + 1;
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        v_rows_failed := v_rows_failed + 1;
        v_error_text := SQLERRM;
      END;
    END LOOP;

    -- 5. Update batch status
    UPDATE import_batches SET
      status = CASE WHEN v_rows_failed = 0 THEN 'success' ELSE 'partial' END,
      rows_imported = v_rows_imported,
      rows_skipped = v_rows_skipped,
      rows_failed = v_rows_failed,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, (v_rows_failed = 0), v_rows_total, v_rows_imported, v_rows_skipped, v_rows_failed, v_error_text;
  EXCEPTION WHEN OTHERS THEN
    -- Rollback entire transaction
    RETURN QUERY SELECT
      v_batch_id, false, v_rows_total, 0, 0, v_rows_total, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION import_csv_batch TO authenticated;
```

---

## DESIGN 3: Rollback Strategy

### Database Level

1. **On Import Failure**: PostgreSQL transaction automatically ROLLBACK
   - No rows inserted
   - No batch created
   - No side effects

2. **File-Level Re-import Prevention**: 
   - `import_batches` unique constraint prevents duplicate batches
   - `transactions` unique index prevents duplicate rows
   - Safe to retry without manual cleanup

### Frontend Level

1. **If RPC fails**: Show error, user can retry
2. **If user deletes batch**: Cascade deletes all related transactions via `ON DELETE CASCADE`
3. **If user cancels during import**: All pending changes remain in transaction, auto-ROLLBACK when connection closes

### Manual Cleanup (if needed)

```sql
-- Delete a failed import and all its transactions
DELETE FROM import_batches WHERE id = '...';
-- Cascading deletes handle transactions via import_batch_id (but no FK cascade by default)

-- Manual cleanup (if no cascade):
DELETE FROM transactions WHERE import_batch_id = '...' AND source = 'trading_212';
DELETE FROM import_batches WHERE id = '...';
```

---

## FILES TO CREATE/MODIFY (Lot 2)

### New Files
- `lib/supabase/import-batches-migration.sql` — Table + indexes + RLS
- `lib/supabase/import-csv-rpc.sql` — Atomic RPC function
- `lib/import/import-types.ts` — TypeScript types for Import*
- `docs/LOT2_SCHEMA.sql` — Complete SQL (non-executed)
- `docs/LOT2_ROLLBACK.sql` — Rollback procedures

### Modified Files
- `lib/types.ts` — Add ImportBatch, update Transaction, update Asset
- `lib/supabase/queries.ts` — Add importCsvBatch() function
- `hooks/use-app-data.tsx` — Add importPortfolioFromCSV() hook

---

## NEXT STEPS

1. ✅ Audit complete
2. ⏳ Generate complete SQL (non-executed)
3. ⏳ TypeScript types
4. ⏳ Frontend integration skeleton
5. ❌ DO NOT execute SQL yet (await user approval)

---

