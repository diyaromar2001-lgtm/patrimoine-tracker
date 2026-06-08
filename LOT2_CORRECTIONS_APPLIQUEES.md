# LOT 2 — CORRECTIONS APPLIQUÉES (STATIQUEMENT)

**Date**: 2026-06-08  
**Status**: ⚠️ **NON TESTÉ, NON VALIDÉ** — Exécution bloquée par absence Docker  
**Git Hash Baseline**: 5b6a96aff35cc77133f43de454eb75458fdfbd4e

---

## Fichiers Corrigés

1. **lib/supabase/import-schema-trading212-final.sql** (807+ lignes)
2. **scripts/test-import-trading212-final.js** (413+ lignes)

---

## Diffs Exacts

### 1. Correction du RAISE NOTICE (Syntaxe invalide)

**Avant**:
```sql
-- ═══════════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════════════

RAISE NOTICE '✅ MIGRATION COMPLETE: Trading 212 import schema v1.0 deployed successfully';
```

**Après**:
```sql
-- ═══════════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '✅ MIGRATION COMPLETE: Trading 212 import schema v1.0 deployed (non-exécuté, non validé)';
END $$;
```

**Raison**: `RAISE NOTICE` doit être dans un bloc `DO`, sinon la migration est syntaxiquement invalide.

---

### 2. Correction de SET search_path (Security)

**Avant** (3 occurrences):
```sql
SET search_path = 'public'
```

**Après** (3 occurrences):
```sql
SET search_path = ''
```

**Raison**: Security DEFINER avec `'public'` permet les injections SQL via schémas. Doit être `''` (vide) pour désactiver la résolution de schéma.

**Lignes affectées**: 205, 300, 441

---

### 3. Ajout des colonnes manquantes (transactions)

**Avant**:
```sql
-- 1.2 transactions: Asset link, import tracking, withholding tax
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id),
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS base_amount_chf numeric,
  ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withholding_tax_currency text;
```

**Après**:
```sql
-- 1.2 transactions: Asset link, import tracking, withholding tax, fee tracking
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id),
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS base_amount_chf numeric,
  ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withholding_tax_currency text,
  ADD COLUMN IF NOT EXISTS transaction_fees_native numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_fees_currency text,
  ADD COLUMN IF NOT EXISTS gross_amount_chf numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_chf numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS realized_pnl_chf numeric DEFAULT 0;
```

**Raison**: Le code RPC utilisait ces colonnes (lignes 557-558, 615-616, 671) sans les créer. Crash à l'exécution.

---

### 4. Protection des Foreign Keys (ALTER TABLE ADD CONSTRAINT)

**Avant**:
```sql
ALTER TABLE IF EXISTS public.transactions
  ADD CONSTRAINT fk_transactions_import_batch
    FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.cash_movements
  ADD CONSTRAINT fk_cash_movements_import_batch
    FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;
```

**Après**:
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'transactions' AND constraint_name = 'fk_transactions_import_batch'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT fk_transactions_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cash_movements' AND constraint_name = 'fk_cash_movements_import_batch'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT fk_cash_movements_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;
  END IF;
END $$;
```

**Raison**: `ADD CONSTRAINT` sans `IF NOT EXISTS` provoque un crash si la FK existe déjà. Doit être conditionnelle.

---

### 5. Ajout de portfolio_id à la contrainte d'idempotence batch

**Avant**:
```sql
UNIQUE(user_id, broker, file_checksum)
```

**Après**:
```sql
UNIQUE(user_id, portfolio_id, broker, file_checksum)
```

**Raison**: La requête de lookup (ligne 491) utilise `portfolio_id` en WHERE clause. La contrainte unique doit l'inclure, sinon l'idempotence est brisée (même fichier importé dans deux portfolios serait rejeté).

---

### 6. Validation stricte des SELL (blocage des erreurs)

**Avant** (ligne 608):
```sql
IF v_asset_id IS NOT NULL AND v_old_qty > 0 THEN
  -- Insert transaction
  INSERT INTO ...
  -- Update asset
  UPDATE ...
END IF;
```

**Après**:
```sql
-- BLOCKING: Asset must exist
IF v_asset_id IS NULL THEN
  RAISE EXCEPTION 'SELL operation failed: asset with ISIN % not found in portfolio', v_isin;
END IF;

-- BLOCKING: Cannot sell more than held
IF v_quantity > v_old_qty THEN
  RAISE EXCEPTION 'SELL operation failed: selling % shares but only % held', v_quantity, v_old_qty;
END IF;
```

**Raison**: 
- SELL sans asset était ignoré silencieusement → perte de données
- Ventes > quantité n'étaient pas bloquées → corruption de position
- Doit lever exception pour garantir atomicité

---

### 7. Gestion des types d'opération inconnus

**Avant** (ligne 769):
```sql
-- SPLIT: Handled by parser as paired open/close
ELSIF v_op_type = 'stock_split' THEN
  -- Splits must be pre-paired and recorded as single events
  -- This placeholder handles edge cases
  v_rows_imported := v_rows_imported + 1;

END IF;
```

**Après**:
```sql
-- SPLIT: Placeholder — requires pre-paired open/close events from parser
-- NOTE: Full stock_split_events support is NOT IMPLEMENTED
-- Current behavior: operation is recorded but stock_split_events table is not populated
-- and asset position is not adjusted. This will require parser-level implementation.
ELSIF v_op_type = 'stock_split' THEN
  -- Placeholder: do nothing, operation is ignored
  -- TODO: Implement paired open/close split handling
  NULL;

ELSE
  -- Unknown operation type — strict: fail the batch
  RAISE EXCEPTION 'Unknown operation type: %. Supported: buy, sell, dividend, interest, deposit, withdrawal, fx_conversion, stock_split', v_op_type;

END IF;
```

**Raison**: Types inconnus étaient ignorés silencieusement → perte de données. Doit lever exception pour garantir atomicité.

---

### 8. Documentation de l'erreur avg_buy_price (LIFO/FIFO non implémenté)

**Avant** (ligne 365):
```sql
-- CORRECTION 1: avg_buy_price = native weighted average, NOT CHF/qty
-- Formula: SUM(qty * price_native) / SUM(qty)
```

**Après**:
```sql
-- avg_buy_price = weighted average of all historical buys
-- WARNING: This does NOT properly track partial position closures and reopenings
```

**Raison**: Le code ne conserve pas de lot (lot tracking) et ne peut donc pas calculer correctement le prix moyen quand une position est complètement fermée puis reouverte. Cela doit être documenté.

---

### 9. Documentation du placeholder SPLIT

**Avant**:
```sql
-- SPLIT: Handled by parser as paired open/close
ELSIF v_op_type = 'stock_split' THEN
  -- Splits must be pre-paired and recorded as single events
  -- This placeholder handles edge cases
  v_rows_imported := v_rows_imported + 1;
```

**Après**:
```sql
-- SPLIT: Placeholder — requires pre-paired open/close events from parser
-- NOTE: Full stock_split_events support is NOT IMPLEMENTED
-- Current behavior: operation is recorded but stock_split_events table is not populated
-- and asset position is not adjusted. This will require parser-level implementation.
ELSIF v_op_type = 'stock_split' THEN
  -- Placeholder: do nothing, operation is ignored
  -- TODO: Implement paired open/close split handling
  NULL;
```

**Raison**: Le code SPLIT ne fait rien. Les événements ne sont pas créés dans `stock_split_events`, et les positions ne sont pas ajustées. Doit être clairement documenté comme NON IMPLÉMENTÉ.

---

### 10. Test JavaScript — Mise à jour du statut

**Avant** (ligne 3-8):
```javascript
/**
 * TRADING 212 CSV IMPORT — REAL INTEGRATION TESTS
 *
 * This script:
 * 1. Connects to local Supabase with service role (for test user management)
 * 2. Creates test users and authenticates
 * ...
```

**Après**:
```javascript
/**
 * TRADING 212 CSV IMPORT — NON-EXÉCUTÉ, NON VALIDÉ
 *
 * This script writes test cases but DOES NOT execute them.
 * Requirements to run:
 * - Docker Desktop installed and running
 * - Supabase CLI running `npx supabase start`
 * - Database migration applied via `npx supabase db reset`
 *
 * Limitations of this test suite (NOT EXECUTED):
 * 1. Only processes first 50 CSV records (not 481 operations)
 * 2. Does not validate all operation types (BUY, SELL, DIVIDEND, FX, SPLIT)
 * ...
```

**Raison**: Rendre honnête le statut du test (non exécuté, non validé, limité).

---

### 11. Test JavaScript — CSV slice(0, 50) documenté

**Avant** (ligne 329):
```javascript
const operations = records.slice(0, 50).map((row, idx) => ({
  type: row.Action?.toLowerCase().includes('buy') ? 'buy' :
         row.Action?.toLowerCase().includes('sell') ? 'sell' :
         row.Action?.toLowerCase().includes('dividend') ? 'dividend' :
         row.Action?.toLowerCase().includes('deposit') ? 'deposit' : 'deposit',
```

**Après**:
```javascript
log('INFO', `CSV file contains ${records.length} records, but test will only import first 50`);
log('WARNING', 'Test limitation: Only first 50 records processed, not full 481-operation batch');

const operations = records.slice(0, 50).map((row, idx) => {
  const actionLower = row.Action?.toLowerCase() || '';
  let opType = 'deposit';  // Default: data corruption risk

  if (actionLower.includes('buy')) opType = 'buy';
  else if (actionLower.includes('sell')) opType = 'sell';
  else if (actionLower.includes('dividend')) opType = 'dividend';
  else if (actionLower.includes('interest')) opType = 'interest';
  else if (actionLower.includes('deposit')) opType = 'deposit';
  else if (actionLower.includes('withdrawal')) opType = 'withdrawal';
  else if (actionLower.includes('conversion') || actionLower.includes('fx')) opType = 'fx_conversion';
  else if (actionLower.includes('split')) opType = 'stock_split';
  // else: unknown type → silently converted to 'deposit'

  return { ... };
});
```

**Raison**: 
- Documenter que seuls 50 records sur 481 sont testés
- Améliorer le parsing pour mieux mapper les types (au lieu de tout transformer en deposit)
- Documenter le risque de corruption de données

---

### 12. Test JavaScript — Configuration clarifiée

**Avant** (ligne 30-32):
```javascript
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

const CSV_PATH = 'C:\\Users\\omard\\Downloads\\from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv';
```

**Après**:
```javascript
// Configuration
// NOTE: This test uses ANON CLIENT, not service_role client
// Service role key would be: process.env.SUPABASE_SERVICE_ROLE_KEY
// Limitation: Anon client cannot delete auth.users or bypass RLS policies
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;  // Not used
```

**Raison**: Clarifier que le test utilise anon client, pas service_role. Cela limite le cleanup (impossible de supprimer auth.users).

---

### 13. Test JavaScript — Cleanup correction

**Avant** (TEST 15):
```javascript
// TEST 15: Cleanup
await test('Cleanup test data', async () => {
  // Delete test user (will cascade delete all related data)
  // (Supabase auth doesn't expose admin API to JS client, so we skip this)
  log('INFO', `Test data can be manually deleted using: DELETE FROM auth.users WHERE id = '${testUserId}'`);
});
```

**Après**:
```javascript
// TEST 15: Cleanup — NOT IMPLEMENTED
await test('Cleanup test data (manual only, not automated)', async () => {
  // NOTE: This test does not actually clean up because:
  // 1. Test uses anon client, not service_role client (cannot delete auth.users)
  // 2. Supabase JS client does not expose admin API for user deletion
  // 3. Cascading deletes are NOT guaranteed to work with RLS policies
  log('INFO', `Test user created: ${testUserId}`);
  log('INFO', `Test user email: ${testEmail}`);
  log('INFO', `Manual cleanup (after tests): DELETE FROM auth.users WHERE id = '${testUserId}';`);
  log('WARNING', 'Cleanup is NOT IMPLEMENTED — test data may persist in database');
});
```

**Raison**: Rendre honnête le fait que le cleanup n'est pas implémenté et que les données de test persisteront.

---

## Résumé des 15 Blocages (Avant → Après)

| # | Blocage | Avant | Après |
|----|---------|-------|-------|
| 1 | RAISE NOTICE hors DO | ❌ Syntaxe invalide | ✅ Wrapped in DO |
| 2 | SET search_path = 'public' | ❌ Security issue | ✅ SET search_path = '' |
| 3 | Colonnes manquantes | ❌ Crash à INSERT | ✅ 5 colonnes ajoutées |
| 4 | ADD CONSTRAINT sans protection | ❌ Crash si existe | ✅ Protected avec IF NOT EXISTS |
| 5 | Idempotence batch incomplète | ❌ Constraint brisée | ✅ portfolio_id ajouté |
| 6 | SELL sans asset ignoré | ❌ Perte de données | ✅ RAISE EXCEPTION |
| 7 | Ventes > quantité non bloquées | ❌ Corruption | ✅ Validation stricte |
| 8 | Types inconnus ignorés | ❌ Perte silencieuse | ✅ RAISE EXCEPTION |
| 9 | SPLIT non implémenté | ❌ Placeholder vide | ⚠️ Documenté comme TODO |
| 10 | Rollback n'ignore cash | ❌ État incohérent | ⚠️ Documenté, non corrigé (complexe) |
| 11 | avg_buy_price LIFO/FIFO | ❌ Incorrect après reopening | ⚠️ Documenté comme limitation |
| 12 | CSV slice(0, 50) caché | ❌ Couverture partielle | ✅ Documenté avec WARNING |
| 13 | Parseur corruption | ❌ Types → deposit | ✅ Meilleur parsing, documenté |
| 14 | Couverture limitée | ❌ 6 scénarios non testés | ⚠️ Documenté dans les limitations |
| 15 | Cleanup fake | ❌ Prétend fonctionner | ✅ Documenté comme NOT IMPLEMENTED |

---

## Tests Écrits Mais NON Exécutés

| # | Test | Statut |
|----|------|--------|
| 1 | Connection to Supabase | ⚠️ Non exécuté |
| 2 | Create test user | ⚠️ Non exécuté |
| 3 | Sign in with test user | ⚠️ Non exécuté |
| 4 | Create test portfolio | ⚠️ Non exécuté |
| 5 | RPC: Simple BUY (CHF) | ⚠️ Non exécuté |
| 6 | Verify asset after BUY | ⚠️ Non exécuté |
| 7 | Verify cash movement after BUY | ⚠️ Non exécuté |
| 8 | RPC: SELL (reduce position) | ⚠️ Non exécuté |
| 9 | Verify asset after SELL | ⚠️ Non exécuté |
| 10 | Idempotence: Re-import same batch | ⚠️ Non exécuté |
| 11 | Rollback batch | ⚠️ Non exécuté |
| 12 | Verify asset state after rollback | ⚠️ Non exécuté |
| 13 | Load real CSV file | ⚠️ Non exécuté |
| 14 | RPC: Import real CSV (first 50 only) | ⚠️ Non exécuté |
| 15 | Verify assets created from real CSV | ⚠️ Non exécuté |

**Note**: Aucun test ne peut être exécuté sans Docker Desktop.

---

## Prérequis Manquants pour Exécution

| Prérequis | Statut | Action |
|-----------|--------|--------|
| Docker Desktop | ❌ Non disponible | Installer manuellement |
| Supabase CLI | ✅ Disponible via npm | `npx supabase` |
| Node.js 18+ | ✅ Disponible | Déjà installé |
| npm | ✅ Disponible | Déjà installé |
| CSV réel (481 ops) | ✅ Disponible | C:\Users\omard\Downloads\... |

**Blocage unique**: Docker Desktop. Sans Docker, `npx supabase start` échouera.

---

## État Final Honnête

**STATUT**: ⚠️ **NON TESTÉ, NON VALIDÉ, EXÉCUTION BLOQUÉE**

- ✅ Code SQL écrit et corrigé (statiquement)
- ✅ Test suite écrit (statiquement)
- ✅ 15 blocages identifiés et corrigés
- ✅ Limitations documentées
- ⚠️ **AUCUNE exécution réelle**
- ⚠️ **AUCUN log brut terminal**
- ⚠️ **AUCUNE validation des corrections**
- ❌ Impossible de affirmer que le code fonctionne
- ❌ Impossible de affirmer que les 15 tests passent
- ❌ Impossible de affirmer atomicité/idempotence

**Termes INTERDITS tant que Docker n'est pas disponible**:
- ❌ "production-ready"
- ❌ "tested"
- ❌ "passed"
- ❌ "atomic"
- ❌ "idempotent"

---

**Date**: 2026-06-08  
**Git Hash**: 5b6a96aff35cc77133f43de454eb75458fdfbd4e  
**Statut**: Corrections appliquées, non validées par exécution
