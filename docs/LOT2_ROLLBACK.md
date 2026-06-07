# Lot 2 — Rollback Strategy

**Status**: PLANNING (no SQL executed)
**Date**: 2026-06-08

---

## Overview

If the import schema needs to be rolled back, follow this procedure in reverse order.

**Important**: PostgreSQL provides automatic rollback for failed transactions. This guide is for intentional teardown only.

---

## Rollback Level 1: Complete Removal (Nuclear Option)

### Drop All Import-Related Objects

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- LEVEL 1: COMPLETE ROLLBACK
-- Removes ALL import-related infrastructure
-- ⚠️  WARNING: This will delete all import batch records and imported data
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Drop RPC function
DROP FUNCTION IF EXISTS import_csv_batch(uuid, uuid, text, text, text, jsonb) CASCADE;

-- Step 2: Drop import_batches table (cascades delete related transactions via FK)
DROP TABLE IF EXISTS import_batches CASCADE;

-- Step 3: Remove columns from transactions
ALTER TABLE transactions DROP COLUMN IF EXISTS asset_id CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS source CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS source_external_id CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS import_batch_id CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS native_currency CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS native_amount CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS historical_fx_rate CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS total_currency CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS total_amount CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS base_currency CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS base_amount CASCADE;
ALTER TABLE transactions DROP COLUMN IF EXISTS raw_payload CASCADE;

-- Step 4: Remove indexes from transactions
DROP INDEX IF EXISTS transactions_unique_source_external_id CASCADE;
DROP INDEX IF EXISTS transactions_import_batch_id CASCADE;
DROP INDEX IF EXISTS transactions_source CASCADE;
DROP INDEX IF EXISTS transactions_asset_id CASCADE;

-- Step 5: Remove columns from assets
ALTER TABLE assets DROP COLUMN IF EXISTS isin CASCADE;
ALTER TABLE assets DROP COLUMN IF EXISTS isin_updated_at CASCADE;

-- Step 6: Remove index from assets
DROP INDEX IF EXISTS assets_isin CASCADE;

-- Step 7: Remove columns from cash_movements
ALTER TABLE cash_movements DROP COLUMN IF EXISTS source_external_id CASCADE;
ALTER TABLE cash_movements DROP COLUMN IF EXISTS import_batch_id CASCADE;

-- Step 8: Remove index from cash_movements
DROP INDEX IF EXISTS cash_movements_import_batch_id CASCADE;

-- Verification
SELECT 'COMPLETE ROLLBACK DONE' AS status;
```

---

## Rollback Level 2: Soft Removal (Keep Historical Data)

Use this if you want to keep imported data but disable future imports.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- LEVEL 2: SOFT ROLLBACK
-- Keeps imported data, disables future imports
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Disable RPC (revoke permissions)
REVOKE EXECUTE ON FUNCTION import_csv_batch(uuid, uuid, text, text, text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION import_csv_batch(uuid, uuid, text, text, text, jsonb) FROM public;

-- Step 2: Disable future imports by setting import_batches to read-only
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- Remove insert/update permissions (keep select for audit)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'import_batches' AND policyname = 'users_own_batches'
  ) THEN
    DROP POLICY "users_own_batches" ON import_batches;
  END IF;
END $$;

CREATE POLICY "import_batches_read_only"
  ON import_batches FOR SELECT
  USING (user_id = auth.uid());

-- Step 3: Optionally archive import_batches to a history table
-- CREATE TABLE import_batches_archive AS SELECT * FROM import_batches;
-- TRUNCATE import_batches;

SELECT 'SOFT ROLLBACK DONE' AS status;
```

---

## Rollback Level 3: Undo Specific Batch

If only one import batch needs to be rolled back:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- LEVEL 3: ROLLBACK SPECIFIC BATCH
-- Undo a single import batch and all its data
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ 
DECLARE
  v_batch_id uuid := 'INSERT_BATCH_UUID_HERE';  -- Replace with actual batch ID
  v_portfolio_id uuid;
  v_user_id uuid;
BEGIN
  -- Verify batch exists
  SELECT portfolio_id, user_id INTO v_portfolio_id, v_user_id
  FROM import_batches WHERE id = v_batch_id;

  IF v_portfolio_id IS NULL THEN
    RAISE NOTICE 'Batch % not found', v_batch_id;
    RETURN;
  END IF;

  -- Step 1: Delete all transactions for this batch
  DELETE FROM transactions WHERE import_batch_id = v_batch_id;

  -- Step 2: Delete all cash movements for this batch
  DELETE FROM cash_movements WHERE import_batch_id = v_batch_id;

  -- Step 3: Delete the batch record itself
  DELETE FROM import_batches WHERE id = v_batch_id;

  -- Step 4: Delete assets that were created by this batch (if no other transactions reference them)
  DELETE FROM assets
  WHERE portfolio_id = v_portfolio_id
    AND quantity = 0  -- Only if no remaining quantity
    AND NOT EXISTS (
      SELECT 1 FROM transactions WHERE asset_id = assets.id
    );

  RAISE NOTICE 'Batch % rolled back successfully', v_batch_id;
END $$;
```

---

## Rollback Level 4: Clean Transaction References

If transactions exist but import metadata needs to be cleared:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- LEVEL 4: CLEAN IMPORT METADATA (Keep Transactions)
-- Removes source_external_id linking but keeps transaction data
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_batch_id uuid := 'INSERT_BATCH_UUID_HERE';
BEGIN
  -- Clear import metadata from transactions
  UPDATE transactions SET
    source = 'manual',
    source_external_id = NULL,
    import_batch_id = NULL,
    raw_payload = NULL
  WHERE import_batch_id = v_batch_id;

  -- Clear import metadata from cash_movements
  UPDATE cash_movements SET
    source_external_id = NULL,
    import_batch_id = NULL
  WHERE import_batch_id = v_batch_id;

  -- Mark batch as rolled back
  UPDATE import_batches SET
    status = 'failed',
    error_summary = jsonb_build_object('reason', 'Manually rolled back by user')
  WHERE id = v_batch_id;

  RAISE NOTICE 'Import metadata cleared for batch %', v_batch_id;
END $$;
```

---

## Rollback Triggers

Automatically trigger rollback if data is inconsistent:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- AUTOMATIC ROLLBACK TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- Trigger: If import_batches is deleted, cascade delete related data
CREATE TRIGGER trigger_import_batches_delete
  BEFORE DELETE ON import_batches
  FOR EACH ROW
EXECUTE FUNCTION fn_cascade_delete_batch();

CREATE FUNCTION fn_cascade_delete_batch() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM transactions WHERE import_batch_id = OLD.id;
  DELETE FROM cash_movements WHERE import_batch_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Prevent modification of completed batches
CREATE TRIGGER trigger_import_batches_immutable
  BEFORE UPDATE ON import_batches
  FOR EACH ROW
  WHEN (OLD.status = 'success')
EXECUTE FUNCTION fn_prevent_batch_modification();

CREATE FUNCTION fn_prevent_batch_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Cannot modify completed import batch %', OLD.id;
END;
$$ LANGUAGE plpgsql;
```

---

## Testing Rollback

### Verify Rollback Completeness

```sql
-- After rollback, verify schema is clean:

-- Check import_batches table exists (or doesn't)
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'import_batches'
) AS import_batches_exists;

-- Check transactions has required columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('source_external_id', 'import_batch_id', 'native_currency')
ORDER BY column_name;

-- Check RPC function exists (or doesn't)
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'import_csv_batch';

-- Verify assets table structure
SELECT column_name FROM information_schema.columns
WHERE table_name = 'assets'
  AND column_name IN ('isin', 'isin_updated_at')
ORDER BY column_name;
```

---

## Recovery Procedures

### If Rollback Fails

1. **Check PostgreSQL logs**: Supabase Dashboard → Logs
2. **Check constraints**: Are there FK dependencies blocking deletion?
3. **Manual intervention**: Use Supabase Dashboard SQL Editor to run rollback script in smaller chunks

### If Data Is Inconsistent After Import

1. **Option A**: Rollback entire batch (Level 3)
2. **Option B**: Clean metadata only (Level 4) and re-import after fixing
3. **Option C**: Manually reconcile via Dashboard

### If Need to Restart Fresh

1. Run **Level 1** (complete removal)
2. Wait 5 minutes for DB consistency
3. Re-run import schema deployment (`lib/supabase/import-schema.sql`)
4. Re-import CSV file

---

## Safety Checklist

Before running ANY rollback:

- [ ] Have backup of import_batches data (export via Dashboard)
- [ ] Know which batches to keep/remove
- [ ] Have user approval for data deletion
- [ ] Understand cascade delete implications
- [ ] Test on staging before production
- [ ] Have incident ticket for audit trail

---

## Rollback Timeline

| Action | Duration |
|--------|----------|
| Drop RPC | <1s |
| Drop table | <5s |
| Drop indexes | <1s |
| Drop columns | <5s per table |
| **Total** | **~20 seconds** |

---

## Verification Queries (Post-Rollback)

```sql
-- Confirm all import infrastructure is removed
SELECT
  (SELECT COUNT(*) FROM pg_tables WHERE tablename = 'import_batches') as import_batches_exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'source_external_id') as source_external_id_exists,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name = 'import_csv_batch') as rpc_exists;

-- Should return: 0, 0, 0 (all removed)
```

---

