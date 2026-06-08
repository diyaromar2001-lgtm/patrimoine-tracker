# AUDIT EXHAUSTIF - Lot 2 v4.2 COMPLETE Package

**Date**: 2026-06-08  
**Statut**: ❌ REJETE - Nombreux problèmes détectés  
**Scope**: Vérification réelle du code créé vs schéma existant

---

## 1. COLONNES UTILISÉES PAR LA RPC - AUDIT COMPLET

### 1.1 Table: `transactions`

| Colonne | Utilisée par | Existe dans schéma? | Type attendu | Problème |
|---------|--------------|-------------------|--------------|---------|
| portfolio_id | INSERT (BUY, SELL, DIVIDEND) | ✅ | uuid | - |
| asset_id | INSERT (ligne 446, 446, 524) | ❌ | uuid | **MANQUANTE** - la table n'a pas cette FK |
| ticker | INSERT | ✅ | text | - |
| asset_name | INSERT | ✅ | text | - |
| asset_class | INSERT | ✅ | text | - |
| type | INSERT | ✅ | text | - |
| quantity | INSERT | ✅ | numeric | - |
| price | INSERT | ✅ | numeric | - |
| currency | INSERT | ✅ | text | - |
| base_amount_chf | INSERT (ligne 447) | ❌ | numeric | **MANQUANTE** - utilisée pour cost basis |
| source | INSERT (ligne 447) | ❌ | text | **MANQUANTE** - pas dans schéma |
| source_external_id | INSERT (ligne 447) | ❌ | text | **MANQUANTE** - pour idempotence |
| import_batch_id | INSERT (ligne 448) | ❌ | uuid | **MANQUANTE** - FK vers import_batches |
| date | INSERT | ✅ | date | - |
| transaction_fees_native | INSERT (ligne 448) | ❌ | numeric | **MANQUANTE** |
| transaction_fees_currency | INSERT (ligne 448) | ❌ | text | **MANQUANTE** |
| withholding_tax_amount | INSERT (ligne 548) | ❌ | numeric | **MANQUANTE** |
| withholding_tax_currency | INSERT (ligne 548) | ❌ | text | **MANQUANTE** |
| realized_pnl_chf | UPDATE (ligne 519) | ✅ | numeric | - |

**Colonnes que la RPC utilise mais qui N'EXISTENT PAS**: 9
- asset_id
- base_amount_chf
- source
- source_external_id
- import_batch_id
- transaction_fees_native
- transaction_fees_currency
- withholding_tax_amount
- withholding_tax_currency

---

### 1.2 Table: `cash_movements`

| Colonne | Utilisée par | Existe dans schéma? | Type | Problème |
|---------|--------------|-------------------|------|---------|
| portfolio_id | INSERT (ligne 472) | ❌ TABLE N'EXISTE PAS | uuid | **TABLE ENTIÈRE MANQUANTE** |
| user_id | INSERT (ligne 473) | ❌ TABLE N'EXISTE PAS | uuid | **TABLE ENTIÈRE MANQUANTE** |
| type | INSERT (ligne 473) | ❌ TABLE N'EXISTE PAS | text | **TABLE ENTIÈRE MANQUANTE** |
| currency | INSERT (ligne 473) | ❌ TABLE N'EXISTE PAS | text | **TABLE ENTIÈRE MANQUANTE** |
| amount | INSERT (ligne 474) | ❌ TABLE N'EXISTE PAS | numeric | **TABLE ENTIÈRE MANQUANTE** |
| source | INSERT (ligne 475) | ❌ TABLE N'EXISTE PAS | text | **TABLE ENTIÈRE MANQUANTE** |
| source_external_id | INSERT (ligne 475) | ❌ TABLE N'EXISTE PAS | text | **TABLE ENTIÈRE MANQUANTE** |
| import_batch_id | INSERT (ligne 476) | ❌ TABLE N'EXISTE PAS | uuid | **TABLE ENTIÈRE MANQUANTE** |
| date | INSERT (ligne 477) | ❌ TABLE N'EXISTE PAS | date | **TABLE ENTIÈRE MANQUANTE** |

**Status**: ❌ Entièrement manquante. La RPC INSERT dans une table qui n'existe pas.

---

### 1.3 Table: `assets`

| Colonne | Utilisée par | Existe? | Problème |
|---------|--------------|---------|---------|
| id | SELECT, UPDATE | ✅ | - |
| portfolio_id | INSERT | ✅ | - |
| ticker | INSERT | ✅ | - |
| name | INSERT | ✅ | - |
| asset_class | INSERT | ✅ | - |
| quantity | SELECT, UPDATE | ✅ | - |
| avg_buy_price | SELECT, UPDATE | ✅ | ⚠️ Voir section 2 |
| currency | INSERT | ✅ | - |
| cost_basis_chf | SELECT, UPDATE, INSERT | ✅ | - |

**Status**: ✅ Tous les champs existent MAIS avg_buy_price est mal utilisé (voir section 2)

---

### 1.4 Table: `import_batches` (à créer)

Créée par le package v4.2 via CREATE TABLE. Dépend de:
- `portfolios(id)` - existe ✅

**Status**: ✅ Créée correctement

---

### 1.5 Table: `stock_split_events` (à créer)

Créée par le package v4.2. Dépend de:
- `assets(id)` - existe ✅
- `portfolios(id)` - existe ✅
- `import_batches(id)` - créée dans le même package ✅

**Status**: ✅ Créée correctement

---

## 2. PROBLÈME CRITIQUE: avg_buy_price Recalculation

### Code actuel (ligne 286-287):
```sql
v_buy_cost_chf := v_buy_cost_chf + COALESCE(v_event.base_amount_chf, 0);
IF v_buy_qty > 0 THEN
  v_avg_buy_price_native := v_buy_cost_chf / v_buy_qty;  -- LIGNE 286
END IF;
```

### Problème:
- `v_buy_cost_chf` = somme en CHF
- `v_buy_qty` = nombre de shares
- Formule: CHF / shares = **CHF par share, PAS prix natif**

### Exemple:
- BUY 100 AAPL @ 150 USD, taux 1.2 → coût CHF = 12,500
- avg_buy_price_native = 12,500 / 100 = 125 CHF ❌ (devrait être 150 USD)

### Correction nécessaire:
Pour calculer le prix natif moyen, il faudrait:
```sql
SUM(quantity * price_native) / SUM(quantity)
```

Mais `price_native` n'existe pas directement dans `transactions` !

On a:
- `base_amount_chf` (CHF)
- `currency` (devise native)
- Mais pas le taux d'échange pour reconvertir

**Status**: ❌ La formule est **MATHÉMATIQUEMENT FAUSSE** pour devise non-CHF

---

## 3. TYPES: transactions.type et cash_movements.type

### Contraintes CHECK actuelles (schéma existant):

**transactions.type**: 
```sql
CHECK (type IN ('buy', 'sell', 'dividend', 'transfer'))
```

Utilisé dans RPC: `'buy'`, `'sell'`, `'dividend'` - **OK**

**cash_movements.type**: 
N'existe pas (table manquante)

Types que la RPC essaie d'insérer:
- `'buy'` (ligne 476)
- `'sell'` (ligne 506)
- `'dividend'` (ligne 553)
- `'withholding_tax'` (ligne 563)
- `'conversion'` (ligne 579)
- `'fx_fee'` (ligne 586)
- `'deposit'` (ligne 596)
- `'withdrawal'` (ligne 596)
- `'interest'` (ligne 604)

**Status**: ❌ Pas de contrainte CHECK pour cash_movements (table inexistante)

---

## 4. FONCTIONS APPELÉES ET LEUR EXISTENCE

### Fonction: `rollback_import_batch(uuid)`

Créée par: v4.2 COMPLETE (ligne 127)  
Appelée par: Test (ligne 99 du test file)  
Status: ✅ Créée

Appelle:
- `public.recalculate_asset_position_v42()` (ligne 178) → à vérifier ci-dessous

---

### Fonction: `recalculate_asset_position_v42(uuid, uuid)`

Créée par: v4.2 COMPLETE (ligne 218)  
Appelée par: 
- `rollback_import_batch()` (ligne 178)
- RPC test (implicite via rollback)

Status: ✅ Créée

**Problème interne**: Voir section 2 (avg_buy_price mal calculé)

---

### Fonction: `import_csv_batch(...)`

Créée par: v4.2 COMPLETE (ligne 325)  
Appelée par: Test (ligne 84 du test file via RPC call)

Status: ✅ Créée

**Problèmes**:
- Insère dans `transactions` avec colonnes manquantes (asset_id, base_amount_chf, etc.)
- Insère dans `cash_movements` qui n'existe pas
- Le batch reste en `'processing'` (ligne 392) s'il y a une erreur (jamais mis à `'failed'`)

---

## 5. STATUS DU BATCH EN CAS D'ERREUR

### Ligne 392:
```sql
INSERT INTO public.import_batches (
  ...
  status, rows_total
) VALUES (
  ...
  'processing',   -- ← État initial
  jsonb_array_length(p_operations)
);
```

### En cas d'erreur (ligne 203):
```sql
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT
    p_batch_id, false, 0, 0, 0, 'Rollback failed: ' || SQLERRM;
  -- ❌ Pas de UPDATE pour changer status à 'failed'
END;
```

### Ligne 680 (fin de RPC):
```sql
-- Mark batch as successful
UPDATE public.import_batches SET
  status = 'success',
  ...
WHERE id = v_batch_id;

RETURN QUERY SELECT v_batch_id, true, v_rows_imported, 'Batch imported successfully'::text;

EXCEPTION WHEN OTHERS THEN
  -- Atomicity: entire transaction rolled back on any error
  -- (PostgreSQL handles this automatically)
  RETURN QUERY SELECT v_batch_id, false, 0, 'Batch failed: ' || SQLERRM;
  -- ❌ Pas de UPDATE pour status
END;
```

**Status**: ❌ Si la RPC échoue, le batch reste en `'processing'` (nunca marqué `'failed'`)

---

## 6. TESTS: RPC réelle vs. simulée

### TEST_1 (ligne 43):
```sql
SELECT v_batch_id, v_asset_id FROM (
  SELECT batch_id, id FROM (
    SELECT result.batch_id FROM LATERAL (
      SELECT * FROM public.import_csv_batch(  -- ← APPEL RPC RÉELLE
        ...
      ) result
    ) ...
  )
) sub;
```

**Type**: ✅ Appel RPC réelle

---

### TEST_2, TEST_3, TEST_4, TEST_5:
Identiques - ✅ Appels RPC réelles

---

### TEST_6 (Idempotence):
Appelle deux fois `import_csv_batch()` - ✅ RPC réelle

---

### TEST_7 (Rollback):
```sql
-- Create test asset
INSERT INTO public.assets (...);  -- Direct INSERT, pas via RPC
PERFORM public.rollback_import_batch(v_batch_id);  -- Appel function
```

**Type**: ⚠️ Hybrid - création d'asset directe (pas RPC), puis rollback via function

---

## 7. EXÉCUTION RÉELLE DE TESTS?

### Node.js Script (`test-lot2-v42-complete.js`):

```javascript
async function testBUYCHF() {
  // This test would normally call the RPC, but without proper auth context in a test,
  // we document the expected behavior based on the SQL tests above.
  
  // Verify calculation
  await assertEquals(
    testData.quantity * testData.price,
    testData.totalAmount,
    'BUY CHF calculation'
  );
}
```

**Status**: ❌ Pas d'appel RPC réelle - tests simulés uniquement (commentaire explicite ligne 91)

---

## 8. AFFIRMATIONS FAUSSES DANS LES DOCS

Document: `LOT2_V42_README.md`

| Affirmation | Réalité | Problème |
|-------------|---------|---------|
| "✅ import_csv_batch() RPC COMPLETE" | Incomplète (colonnes manquantes) | Faux |
| "✅ TESTED" | Jamais exécuté localement | Faux |
| "✅ PASSED" | Pas de rapport d'exécution | Faux |
| "✅ PRODUCTION-READY" | Plusieurs blocages critiques | Faux |
| "Test with REAL assertions" | Tests directs simulés, RPC test pas exécuté | Partiellement faux |

---

## 9. PROBLÈMES CRITIQUES RÉSUMÉ

### 🔴 BLOCKER 1: Colonnes manquantes dans `transactions`
- asset_id: FK obligatoire pour lier transaction à asset
- base_amount_chf: Utilisée pour cost_basis_chf
- source, source_external_id: Pour idempotence
- import_batch_id: FK vers batch
- transaction_fees_native, transaction_fees_currency: Pour audit
- withholding_tax_amount, withholding_tax_currency: Pour dividend

**Impact**: INSERT échouera (colonnes non-existent)

---

### 🔴 BLOCKER 2: Table `cash_movements` n'existe pas
**Impact**: INSERT échouera (table inexistante)

---

### 🔴 BLOCKER 3: avg_buy_price mal calculé
- Formule: `CHF / shares` = CHF par share
- Devrait: `native_price_weighted` 
- Impact: Position non-CHF a un prix moyen en CHF (faux)

---

### 🔴 BLOCKER 4: Batch status jamais mis à 'failed'
- Reste 'processing' après erreur
- Jamais marqué 'failed'
- Impact: Impossible de savoir si import a échoué

---

### 🔴 BLOCKER 5: Pas d'exécution réelle
- Tests Node.js simulés (pas de RPC)
- Tests SQL directs (pas via RPC authentifiée)
- Jamais exécuté sur Supabase local
- Impact: Aucune preuve de fonctionnalité

---

## 10. VÉRIFICATION: COLONNES ATTENDUES VS RÉELLES

### transactions (INSERT dans RPC):

```sql
INSERT INTO public.transactions (
  portfolio_id,                   ← ✅ existe
  asset_id,                       ← ❌ MANQUANTE
  ticker,                         ← ✅ existe
  asset_name,                     ← ✅ existe
  asset_class,                    ← ✅ existe
  type,                           ← ✅ existe
  quantity,                       ← ✅ existe
  price,                          ← ✅ existe
  currency,                       ← ✅ existe
  base_amount_chf,                ← ❌ MANQUANTE
  source,                         ← ❌ MANQUANTE
  source_external_id,             ← ❌ MANQUANTE
  import_batch_id,                ← ❌ MANQUANTE
  date,                           ← ✅ existe
  transaction_fees_native,        ← ❌ MANQUANTE
  transaction_fees_currency       ← ❌ MANQUANTE
)
```

**Résultat**: 7 colonnes manquantes sur 16 utilisées

---

## CONCLUSION

**Status**: ❌ **PACKAGE REJETÉ**

Raisons:

1. ❌ RPC incomplète - 9 colonnes manquantes dans transactions
2. ❌ Table cash_movements n'existe pas
3. ❌ Formule avg_buy_price fausse (CHF/qty au lieu de price_native/qty)
4. ❌ Batch status jamais marqué 'failed' 
5. ❌ Pas d'exécution réelle (tests seulement simulés)
6. ❌ Documentation affirme "tested" et "production-ready" sans preuve

**Prochaines étapes**:

Avant de continuer:
1. Audit du schéma existant complet (trouver quelles colonnes existent vraiment)
2. Identifier les migrations antérieures qui ont pu ajouter les colonnes manquantes
3. Vérifier si cash_movements existe ailleurs
4. Établir la base de vérité (read-only de Supabase réel ou fichier de migration)

---

Generated: 2026-06-08  
Auditor: Automated schema audit
