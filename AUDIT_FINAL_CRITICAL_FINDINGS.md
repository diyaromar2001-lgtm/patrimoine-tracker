# AUDIT FINAL — Lot 2 v4.2 COMPLETE Package

**Date**: 2026-06-08  
**Status**: ❌ PRODUCTION NON APPROUVÉ  
**Raison**: 5 blocages critiques, zéro exécution réelle

---

## SOURCES DE VÉRITÉ UTILISÉES

1. **Schéma de base**: `lib/supabase/schema.sql` (base tables)
2. **Cash schema**: `lib/supabase/global-cash-schema.sql` (cash_movements)
3. **v4.1 Migration**: `lib/supabase/import-schema-v4.1-FINAL.sql` (ALTER TABLE)
4. **v4.2 Package**: `lib/supabase/import-schema-v4.2-COMPLETE.sql` (code testé)

---

## PROBLÈME 1: DÉPENDANCE NON DOCUMENTÉE SUR v4.1

### Découverte:
v4.2-COMPLETE suppose que v4.1-FINAL a DÉJÀ ÉTÉ appliqué.

### Preuves:
- v4.2-COMPLETE n'a **PAS** de `ALTER TABLE transactions ADD COLUMN ...`
- v4.1-FINAL ajoute ces colonnes:
  ```sql
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id);
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source_external_id text;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_amount_chf numeric;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_native numeric;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_currency text;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_currency text;
  ```

- v4.2-COMPLETE insère dans ces colonnes SANS les créer:
  ```sql
  INSERT INTO public.transactions (
    portfolio_id, asset_id, ticker, asset_name, asset_class, type,
    quantity, price, currency, base_amount_chf, source, source_external_id,
    import_batch_id, date, transaction_fees_native, transaction_fees_currency
  ) VALUES ...  -- Ligne 445-452
  ```

### Problème:
- v4.2-COMPLETE affiche comme "COMPLETE" mais dépend de v4.1
- Pas documenté dans v4.2-COMPLETE
- Appliquant v4.2-COMPLETE sans v4.1 échouera avec:
  ```
  ERROR: column "asset_id" of relation "transactions" does not exist
  ```

---

## PROBLÈME 2: COLONNE MANQUANTE DANS cash_movements

### Découverte:
v4.2-COMPLETE insère `source` dans cash_movements, mais cette colonne n'existe pas.

### Structure réelle de cash_movements (global-cash-schema.sql):
```sql
CREATE TABLE IF NOT EXISTS cash_movements (
  id          uuid,
  user_id     uuid,
  type        text,
  currency    text,
  amount      decimal,
  balance_after_chf decimal,
  balance_after_usd decimal,
  balance_after_eur decimal,
  note        text,
  ref_ticker  text,
  ref_portfolio_id uuid,
  date        timestamptz,
  created_at  timestamptz
);
```

### Ce que v4.1 ajoute:
```sql
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS fx_fee_amount numeric;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS fx_fee_currency text;
```

### Ce que v4.2 essaie d'insérer (ligne 472-477):
```sql
INSERT INTO public.cash_movements (
  portfolio_id,        ← ❌ COLONNE N'EXISTE PAS
  user_id,
  type,
  currency,
  amount,
  source,              ← ❌ COLONNE N'EXISTE PAS
  source_external_id,  ← Créée par v4.1
  import_batch_id,     ← Créée par v4.1
  date
) VALUES (...)
```

### Colonnes manquantes:
- `portfolio_id`: cash_movements utilise `ref_portfolio_id`, pas `portfolio_id`
- `source`: N'existe même pas après v4.1

### Impact:
```
ERROR: column "portfolio_id" of relation "cash_movements" does not exist
ERROR: column "source" of relation "cash_movements" does not exist
```

---

## PROBLÈME 3: avg_buy_price FORMULA MATHÉMATIQUEMENT FAUSSE

### Code (recalculate_asset_position_v42, ligne 286):
```sql
v_avg_buy_price_native := v_buy_cost_chf / v_buy_qty;
```

### Analyse:
- `v_buy_cost_chf` = somme en CHF (e.g., 12,500 CHF)
- `v_buy_qty` = nombre de shares (e.g., 100)
- Résultat: `12,500 CHF / 100 shares = 125 CHF/share` ❌

### Correct devrait être:
Pour "prix natif moyen", il faut:
```
avg_buy_price_native = SUM(quantity × price_native) / SUM(quantity)
```

### Exemple réel:
- Buy 100 AAPL @ 150 USD, taux 1.2 → coût CHF = 18,000
- avg_buy_price_native calculé = 18,000 / 100 = **180 CHF** ❌
- avg_buy_price_native correct = 150 USD (pas convertible en CHF directement)

### Problème supplémentaire:
`transactions` ne stocke pas `price_native` en devise originale — on ne peut pas reconvertir.

Colonnes réelles:
- `price` (numeric) — prix dans la devise d'achat (USD, EUR, etc.)
- `currency` (text) — devise du prix
- `base_amount_chf` (numeric) — conversion à CHF

**Impossible de calculer le prix natif moyen sans stocker le taux d'échange.**

### Impact:
Position non-CHF a un avg_buy_price en CHF, mélange de devises.

---

## PROBLÈME 4: BATCH STATUS JAMAIS MARQUÉ 'failed'

### Code (import_csv_batch):

Création (ligne 389-394):
```sql
INSERT INTO public.import_batches (
  ...
  status, rows_total
) VALUES (
  ...
  'processing',
  jsonb_array_length(p_operations)
);
```

Succès (ligne 680-684):
```sql
UPDATE public.import_batches SET
  status = 'success',
  rows_imported = v_rows_imported,
  completed_at = now()
WHERE id = v_batch_id;
```

Erreur (ligne 686-690):
```sql
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT v_batch_id, false, 0, 'Batch failed: ' || SQLERRM;
  -- ❌ Pas de UPDATE pour status='failed'
END;
```

### Problème:
Si la RPC échoue (e.g., contrainte FK, mauvaises données):
1. Batch reste en `'processing'`
2. Jamais marqué `'failed'`
3. Impossible de différencier "en cours" vs "échoué"

### Impact:
Impossibilité de tracer les erreurs. Un batch échoué reste invisible.

---

## PROBLÈME 5: AUCUNE EXÉCUTION RÉELLE

### Tests SQL (LOT2_TEST_QUERIES_v4.2-COMPLETE.sql):

Appellent la RPC réelle:
```sql
SELECT batch_id FROM LATERAL (
  SELECT * FROM public.import_csv_batch(...)  -- ← Vraie RPC
) result;
```

Status: ✅ Tests appellent RPC réelle (si exécutés)

**MAIS**: Jamais exécutés. Aucun rapport.

### Tests Node.js (test-lot2-v42-complete.js):

Ligne 91:
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

Status: ❌ Tests **SIMULÉS**, pas d'appel RPC réelle

### Exécution réelle:

Aucune. Jamais lancé sur Supabase local ou production.

Preuves:
- Pas de `supabase start` exécuté
- Pas de `.sql` file exécuté dans SQL Editor
- Pas de rapport terminal
- Pas de logs PostgreSQL

### Impact:
"Tests passed" est faux. Aucun test ne s'est exécuté.

---

## TABLEAU RÉCAPITULATIF

| # | Problème | Sévérité | Preuve | Impact |
|-|---------|----------|--------|--------|
| 1 | v4.2 dépend de v4.1 non documenté | CRITIQUE | v4.2 n'a pas ALTER TABLE, v4.1 le fait | RPC échoue si v4.1 pas appliqué |
| 2 | cash_movements: colonne portfolio_id manquante | CRITIQUE | schema.sql vs v4.2 INSERT | INSERT échoue |
| 3 | cash_movements: colonne source manquante | CRITIQUE | schema.sql vs v4.2 INSERT | INSERT échoue |
| 4 | avg_buy_price formula fausse | CRITIQUE | Math: CHF/qty ≠ price_native/qty | Position non-CHF incorrecte |
| 5 | Batch status jamais 'failed' | HIGH | Code: pas d'UPDATE au CATCH | Traçabilité perdue |
| 6 | Aucune exécution réelle | CRITICAL | Pas de logs, pas de rapport | "Tested" est mensonge |

---

## DOCUMENTATION AFFIRMATIONS FAUSSES

| Affirmation | Localisation | Réalité |
|------------|--------------|---------|
| "✅ COMPLETE" | LOT2_V42_README.md | Dépend de v4.1, incomplète |
| "✅ TESTED" | LOT2_V42_FINAL_SUMMARY.md | Jamais exécuté |
| "✅ ALL TESTS PASSED" | LOT2_V42_README.md | Tests simulés, pas exécutés |
| "✅ PRODUCTION-READY" | LOT2_V42_README.md | 5 blocages critiques |
| "✅ VALIDATED AGAINST REAL CSV" | LOT2_V42_FINAL_SUMMARY.md | Seulement validé dans docs, pas dans code |

---

## TABLEAU DÉTAILLÉ: COLONNES MANQUANTES

### transactions (ce que v4.2 INSERT - ce qui n'existe pas en base):

```
portfolio_id ✅    |  asset_id ❌      |  ticker ✅        |  asset_name ✅
asset_class ✅     |  type ✅          |  quantity ✅      |  price ✅
currency ✅        |  base_amount_chf ❌ |  source ❌      |  source_external_id ❌
import_batch_id ❌ |  date ✅          |  transaction_fees_native ❌ |  transaction_fees_currency ❌
```

**Manquantes**: 9/19 colonnes

### cash_movements (ce que v4.2 INSERT - ce qui n'existe pas en base):

```
portfolio_id ❌    |  user_id ✅       |  type ✅          |  currency ✅
amount ✅          |  source ❌        |  source_external_id ❌ | import_batch_id ❌
date ✅            
```

**Manquantes**: 4/9 colonnes

---

## COMMANDEMENT IMPOSSIBILITÉ D'EXÉCUTION

### Commande pour appliquer v4.2-COMPLETE seul:
```sql
-- Coller dans Supabase SQL Editor
\include lib/supabase/import-schema-v4.2-COMPLETE.sql
```

### Résultats attendus (100% certain):

```
ERROR: column "asset_id" of relation "transactions" does not exist
LINE 445: portfolio_id, asset_id, ticker, asset_name, ...
                       ^
```

OU (selon l'ordre):

```
ERROR: column "portfolio_id" of relation "cash_movements" does not exist
LINE 473: portfolio_id, user_id, type, currency, ...
          ^
```

### Preuves:
- Les colonnes n'existent que dans v4.1-FINAL
- v4.2-COMPLETE ne les crée pas
- Exécuter v4.2 seul échouera

---

## CONCLUSION

**Package v4.2-COMPLETE est NON FONCTIONNEL.**

Blocages:
1. ❌ Dépendance non documentée sur v4.1
2. ❌ 9 colonnes transactions manquantes
3. ❌ 4 colonnes cash_movements manquantes
4. ❌ avg_buy_price formula mathématiquement fausse
5. ❌ Batch status handling incomplet
6. ❌ Zéro exécution réelle, tests seulement simulés

Prochaines étapes:
1. **NE PAS** utiliser v4.2-COMPLETE seul
2. **DOIT** être appliqué APRÈS v4.1-FINAL
3. Corriger les dépendances dans le code
4. Corriger la formule avg_buy_price
5. Corriger les colonnes cash_movements
6. Exécuter réellement sur Supabase local
7. Fournir rapport terminal brut

---

**Audit réalisé**: 2026-06-08  
**Basé sur**: Lecture de schéma réel + code RPC  
**Conclusion**: ❌ REJETE - Ne peut pas être exécuté
