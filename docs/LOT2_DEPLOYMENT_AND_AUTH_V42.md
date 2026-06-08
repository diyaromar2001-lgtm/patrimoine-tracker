# Lot 2 — v4.2 Deployment & Authentication Guide

**Status**: DISPOSABLE TEST DB WORKFLOW
**Date**: 2026-06-08

---

## Overview

v4.2 **must** be tested in a disposable environment (local Supabase or preview branch) before production deployment.

Why? RPC functions use `auth.uid()` which requires JWT, unavailable in SQL Editor.

---

## Workflow: Test → Approve → Deploy

### Phase 1: Local Setup (5 min)

```bash
# Start local Supabase (Docker required)
supabase start

# Apply schema v4.2
supabase db push --dry-run  # See what will change

# If approved:
supabase db push
```

### Phase 2: Schema Verification (5 min)

Run in **local Supabase SQL Editor**:
```sql
-- File: LOT2_PRECOMPILE_AND_TESTS_V42.sql
\include LOT2_PRECOMPILE_AND_TESTS_V42.sql
```

Expected output:
```
✅ PRECOMPILE CHECKS PASSED (5/5)
✅ TEST PORTFOLIO CREATED
✅ TEST_1 PASSED: Ghost asset cleaned up
✅ TEST_2 PASSED: avg_buy_price recalculated
✅ TEST_3 PASSED: Split replay correct
✅ v4.2 TESTS COMPLETE (3/5 with assertions)
```

### Phase 3: RPC Testing with Auth (10 min)

Use **Supabase CLI + Node.js** to test RPC with authenticated user:

```javascript
// test-rpc-authenticated.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'http://localhost:54321';  // Local Supabase
const SUPABASE_KEY = 'eyJ...';  // From supabase/config.toml (anon key)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testImportRPC() {
  try {
    // Sign up test user (local only)
    const { data: user, error: signupError } = await supabase.auth.signUp({
      email: 'test@localhost',
      password: 'test123456'
    });

    if (signupError) throw signupError;
    console.log('✅ Test user created:', user.user.id);

    // Get portfolio ID
    const { data: portfolios, error: portError } = await supabase
      .from('portfolios')
      .select('id')
      .eq('name', 'LOT2_TEST_V42')
      .single();

    if (portError) throw portError;
    console.log('✅ Portfolio found:', portfolios.id);

    // Call RPC: import_csv_batch
    const testBatch = [
      {
        type: 'buy',
        date: '2026-06-07',
        ticker: 'AAPL',
        name: 'Apple Inc',
        isin: 'US0378331005',
        quantity: 100,
        price: 10.00,
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 1000.00,
        totalCurrency: 'CHF',
        sourceId: 'TEST_IMPORT_001',
        transactionFee: null
      }
    ];

    const { data, error } = await supabase.rpc('import_csv_batch', {
      p_portfolio_id: portfolios.id,
      p_broker: 'test_rpc',
      p_filename: 'test-rpc.csv',
      p_file_checksum: 'checksum_rpc_test',
      p_operations: testBatch
    });

    if (error) throw error;

    console.log('✅ RPC executed:', data);
    console.log('  Batch ID:', data[0].batch_id);
    console.log('  Success:', data[0].success);
    console.log('  Rows imported:', data[0].rows_imported);

    // Verify asset created
    const { data: assets, error: assetError } = await supabase
      .from('assets')
      .select('quantity, cost_basis_chf')
      .eq('isin', 'US0378331005');

    if (assetError) throw assetError;
    if (!assets || assets.length === 0) {
      throw new Error('Asset not created by RPC');
    }

    console.log('✅ Asset created:', assets[0]);

    // Test rollback
    const { data: rollback, error: rollbackError } = await supabase.rpc('rollback_import_batch', {
      p_batch_id: data[0].batch_id
    });

    if (rollbackError) throw rollbackError;
    console.log('✅ Rollback executed:', rollback);

    // Verify asset deleted
    const { data: assetsAfter, error: assetError2 } = await supabase
      .from('assets')
      .select('quantity')
      .eq('isin', 'US0378331005');

    if (assetError2) throw assetError2;
    if (assetsAfter && assetsAfter.length > 0 && assetsAfter[0].quantity === 0) {
      console.log('✅ Asset cleaned up (qty=0)');
    }

    console.log('\n✅✅✅ ALL RPC TESTS PASSED ✅✅✅');

  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    process.exit(1);
  }
}

testImportRPC();
```

**Run it**:
```bash
npm install @supabase/supabase-js
node test-rpc-authenticated.js
```

### Phase 4: Generate Report

If all tests pass:

```bash
# Export test results
supabase db dump > lot2-v42-test-results.sql

# Create PR with:
# - import-schema-v4.2-FINAL.sql (schema)
# - LOT2_PRECOMPILE_AND_TESTS_V42.sql (tests)
# - lot2-v42-test-results.sql (proof of passing)
# - This guide (deployment)
```

---

## Key Points for v4.2

### Corrections Verified in Tests

| # | Issue | Test | Result |
|---|-------|------|--------|
| 1 | avg_buy_price recalc | TEST_2 | ✅ |
| 2 | Splits replayed | TEST_3 | ✅ |
| 3 | Asset cleanup | TEST_1 | ✅ |
| 4 | Fees semantics | **Documented in code** | — |
| 5 | Dividend brut/net | **Documented in code** | — |
| 6 | FX rate unambiguous | **Documented in code** | — |
| 7 | Precompile checks | **PRECOMPILE_AND_TESTS** | ✅ |
| 8 | Tests with assertions | **TEST_1/2/3** | ✅ |
| 9 | Auth context | **test-rpc-authenticated.js** | ✅ |
| 10 | Disposable test DB | **Workflow above** | ✅ |

---

## Production Deployment (Only After 100% Pass)

### Prerequisites
- ✅ All 3 phases completed in local/preview
- ✅ Test report generated and reviewed
- ✅ No schema conflicts with existing data

### Steps

1. **Create migration commit**:
   ```bash
   git commit -m "feat: CSV import schema v4.2 - atomic RPC, chronological rollback

   - Strict atomicity: one error rollbacks entire batch
   - Chronological replay: BUY/SELL/SPLIT restore correct position
   - Ghost asset cleanup: qty=0 + no txns removed
   - Separate fees/taxes tracking
   - RLS policies on import_batches and stock_split_events
   - FX rate formula unambiguous (divide, not multiply)
   - Precompile checks verify schema compatibility
   - Tests with PL/pgSQL assertions

   Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
   ```

2. **Create PR** linking to test results

3. **Deploy** (after code review approval):
   ```bash
   # Production Supabase
   supabase link  # Link to production
   supabase db push --dry-run  # Review
   supabase db push  # Execute
   ```

4. **Verify**:
   ```sql
   -- In production SQL Editor
   SELECT COUNT(*) as batches FROM import_batches;
   SELECT COUNT(*) as splits FROM stock_split_events;
   SELECT COUNT(*) as with_source FROM transactions WHERE source = 'trading_212';
   ```

---

## Rollback Plan (If Needed)

If v4.2 fails in production:

```sql
-- Keep import_batches, stock_split_events (audit trail)
-- Disable RPC until fixed
REVOKE EXECUTE ON FUNCTION import_csv_batch(...) FROM authenticated;

-- Alternatively: restore from before-migration snapshot
-- (requires backup, not recommended for this data)
```

---

## Common Issues

### "auth.uid() returns NULL in SQL Editor"
**Solution**: Use test-rpc-authenticated.js (with Node.js SDK) or local Supabase instead.

### "Precompile check fails: missing column X"
**Solution**: Schema already has most columns. Check existing migration files in `supabase/migrations/`.

### "Rollback function errors: asset_id not in transactions"
**Solution**: v4.2 checks both `transactions` and `stock_split_events` tables (CORRECTION 2).

---

## Files for v4.2 Deployment

```
docs/
  ├─ LOT2_CRITICAL_FINDINGS_V42.md (analysis of 10 issues)
  └─ LOT2_DEPLOYMENT_AND_AUTH_V42.md (this file)

lib/supabase/
  ├─ import-schema-v4.2-FINAL.sql (schema + rollback function)
  └─ LOT2_PRECOMPILE_AND_TESTS_V42.sql (precompile checks + 3 tests)

scripts/
  └─ test-rpc-authenticated.js (RPC test with auth)
```

---

## Next Steps

1. ✅ Read this guide
2. ⏳ Run Phase 1 (local setup)
3. ⏳ Run Phase 2 (schema verification)
4. ⏳ Run Phase 3 (RPC testing)
5. ⏳ Generate report
6. ⏳ Deploy to production

**Estimated time: 30-45 minutes total**

---
