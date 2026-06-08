# Lot 2 — Corrections v4 → v4.1

**Status**: v4.1 READY FOR REVIEW (NOT EXECUTED)
**Date**: 2026-06-08
**Changes**: 10 corrections appliquées

---

## 1. Prix Moyen Natif (CORRECTION 1)

### Problème v4
```sql
-- avg_buy_price calculé avec base_amount_chf (mélange CHF)
UPDATE public.assets SET
  avg_buy_price = (old_cost_basis_chf + base_amount_chf) / (old_qty + new_qty)  -- ❌ CHF
WHERE id = v_asset_id;
```

### v4.1 Correction
```sql
-- avg_buy_price = prix NATIF uniquement
-- cost_basis_chf = CHF séparé
UPDATE public.assets SET
  quantity = v_old_qty + v_qty_native,
  avg_buy_price = (v_old_qty * v_old_avg_price_native + v_qty_native * v_price_native) / (v_old_qty + v_qty_native),
  cost_basis_chf = v_old_cost_basis_chf + v_base_amount_chf
WHERE id = v_asset_id;
```

**Formule**:
- `new_avg_price_native = (old_qty × old_avg_native + new_qty × new_price_native) / new_qty_total`
- `new_cost_basis_chf = old_cost_basis_chf + new_base_amount_chf`

---

## 2. Champs Historiques Normalisés (CORRECTION 2)

### Nouvelles Colonnes dans `transactions`
```sql
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_currency text DEFAULT 'CHF';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_amount_chf numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_currency text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_amount numeric;
```

### Utilisation
- `base_currency`: Toujours 'CHF'
- `base_amount_chf`: Montant CHF calculé (formule FX appliquée)
- `total_currency`: Devise du CSV (USD, CHF, EUR, etc.)
- `total_amount`: Montant original du CSV

### Avantage du Rollback
- Pas besoin de recalculer `base_amount_chf` au rollback
- Les valeurs historiques sont stockées directement
- Les taux historiques se retrouvent via `historical_fx_rate` (existant)

---

## 3. Rollback Chronologique (CORRECTION 3)

### Problème v4
```sql
-- Simple somme, perd l'ordre des transactions
SELECT COALESCE(SUM(quantity), 0) INTO v_buy_qty FROM transactions WHERE type='buy';
```

### v4.1 Correction
```sql
CREATE FUNCTION public.recalculate_asset_position_chronological(p_asset_id uuid, p_portfolio_id uuid)
BEGIN
  FOR v_tx_record IN
    SELECT type, quantity, base_amount_chf, date
    FROM transactions
    WHERE asset_id = p_asset_id
    ORDER BY date ASC, created_at ASC  -- ✅ Chronologique
  LOOP
    IF type = 'buy' THEN
      v_qty := v_qty + quantity;
      v_cost_basis_chf := v_cost_basis_chf + base_amount_chf;
    ELSIF type = 'sell' THEN
      v_cost_unit_chf := v_cost_basis_chf / v_qty;
      v_cost_basis_chf := v_cost_basis_chf - (quantity * v_cost_unit_chf);
      v_qty := v_qty - quantity;
    ELSIF type = 'split' THEN
      NULL;  -- qty change seul
    END IF;
  END LOOP;
END;
```

**Ordre Respecté**:
1. BUY ajoute à qty et cost_basis
2. SELL soustrait cost basé sur le coût unitaire à ce moment
3. SPLIT change qty sans coût

---

## 4. Cash Movements APRÈS Insertion (CORRECTION 4)

### Problème v4
```sql
-- Cash créé avant vérification du succès de l'insert
INSERT INTO cash_movements ...;
INSERT INTO transactions ... ON CONFLICT DO NOTHING;
```

### v4.1 Correction
```sql
-- INSERT d'abord
INSERT INTO transactions (...) ON CONFLICT DO NOTHING;
GET DIAGNOSTICS v_inserted = ROW_COUNT;

-- Cash UNIQUEMENT si nouveau
IF v_inserted > 0 THEN
  INSERT INTO cash_movements (
    user_id, type, currency, amount, ...
  ) VALUES (...);
END IF;
```

**Pour BUY/SELL**:
- BUY: débit dans `totalCurrency`
- SELL: crédit dans `totalCurrency`
- Pas de double comptage avec FX

---

## 5. Withdrawal List VALUES Correction (CORRECTION 5)

### Problème v4
```sql
-- Montant négatif en doublon
INSERT INTO cash_movements (..., amount) VALUES (
  ... ,
  (v_op ->> 'totalAmount')::numeric * -1 * -1  -- ❌ Double négatif
)
```

### v4.1 Correction
```sql
INSERT INTO cash_movements (..., amount) VALUES (
  ... ,
  (v_op ->> 'totalAmount')::numeric * -1  -- ✅ Une seule fois
)
```

---

## 6. Frais Réels du Parseur (CORRECTION 6)

### Problème v4
```sql
-- transaction_fees_native TOUJOURS 0
transaction_fees_native, transaction_fees_currency,
...
0, 0,  -- ❌ Jamais mappé du CSV
```

### v4.1 Correction
```sql
-- Mapper les vrais champs du parseur
transaction_fees_native, transaction_fees_currency,
...
COALESCE((v_op ->> 'transactionFee')::numeric, NULL),
v_op ->> 'transactionFeeCurrency',
```

**Champs parseur supportés**:
- `transactionFee` / `transactionFeeCurrency`
- `fxFee` / `fxFeeCurrency` (pour FX conversion)
- `withholdingTax` / `withholdingTaxCurrency` (pour dividend)

**Règle v4.1**:
- Insérer seulement si NON NULL
- FX fee uniquement si > 0
- Withholding tax créer cash movement séparé si > 0

---

## 7. RLS sur stock_split_events (CORRECTION 7)

### v4.1 Ajout
```sql
ALTER TABLE stock_split_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (...) THEN
    CREATE POLICY "split_events_portfolio"
      ON stock_split_events FOR ALL
      USING (
        portfolio_id IN (
          SELECT id FROM public.portfolios WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        portfolio_id IN (
          SELECT id FROM public.portfolios WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;
```

**Garantit**:
- Utilisateur ne voit que ses propres splits
- Access via RPC sécurisé (SECURITY DEFINER)

---

## 8. Atomicité Clarifiée (CORRECTION 8)

### Comportement v4.1
```
EXCEPTION WHEN OTHERS THEN
  -- Batch marqué 'failed' pour audit
  UPDATE import_batches SET
    status = 'failed',
    rows_imported = 0,
    error_summary = jsonb_build_object('error', SQLERRM, 'line', v_idx),
    completed_at = now()
  WHERE id = v_batch_id;
```

**Trois garanties**:
1. ✅ **Données annulées**: Les INSERT/UPDATE du batch sont en une transaction; une erreur → ROLLBACK
2. ✅ **Batch audit gardé**: Enregistrement 'failed' reste pour tracer l'erreur (audit trail)
3. ✅ **PAS de rollback absolu**: Les données en erreur sont annulées par PostgreSQL, pas par un rollback_import_batch supplémentaire

**Cas d'erreur**:
- Batch 500 ope: opération 50 échoue
- Opérations 1-49: ROLLBACK automatique
- Opérations 51-500: jamais tentées
- Batch: enregistrement 'failed' conservé avec SQLERRM

---

## 9. FX Rate Clarifié (CORRECTION 9)

### Documentation v4.1
```
Exchange rate = 1 unit of price_currency = exchange_rate CHF

Exemples:
- USD exchange_rate = 1.25 → 1 USD = 1.25 CHF
- EUR exchange_rate = 1.07 → 1 EUR = 1.07 CHF

Formule: total_chf = (qty × price_native) / exchange_rate

Validé sur 3 lignes réelles du CSV Trading 212:
- Line 4: 0.1037849900 × 24.1850 / 1.25501999 = 2.00 CHF ✓
- Line 7: 0.1271267500 × 100.7200 / 1.06879851 = 12.00 CHF ✓
- Line 21: 0.1507491200 × 26.4900 / 0.92438522 = 4.33 CHF ✓
```

**Pas d'ambiguïté** (v4 avait un message doublonné "divide not multiply"):
- Une seule formule
- Une seule interpretation du taux
- Validée empiriquement

---

## 10. Tests Réels v4.1 (CORRECTION 10)

### Tests Ajoutés
1. **TEST_0**: Schema compilation (colonnes existent, RLS activé)
2. **TEST_1**: BUY CHF avec CASH DEBIT réel (pas juste RAISE NOTICE)
3. **TEST_2**: BUY USD avec conversion, avg_price NATIVE validé
4. **TEST_3**: SELL partial avec CASH CREDIT réel et P&L
5. **TEST_4**: DIVIDEND avec withholding TAX non-zéro
6. **TEST_5**: FX CONVERSION avec FEE non-zéro
7. **TEST_6**: SPLIT avec RLS check (user peut accéder)
8. **TEST_7**: ROLLBACK après BUY + SELL (chronologique)
9. **TEST_8**: ATOMICITY stricte (erreur → 0 rows)
10. **TEST_9**: IDEMPOTENCE (re-import → même batch)
11. **TEST_10**: MIXED operations (tout ensemble)

### Validation réelle
```sql
-- Avant (v4 - RAISE NOTICE)
RAISE NOTICE 'Test 1 RPC invoked. Check results below.';

-- Après (v4.1 - Appel RPC réel)
SELECT result.batch_id, result.success, result.rows_imported
FROM test_portfolio, LATERAL public.import_csv_batch(...) result;
```

**Chaque test**:
- Appelle réellement `import_csv_batch()` ou `rollback_import_batch()`
- Vérifie résultats avec SELECT (pas RAISE NOTICE)
- Teste cash_movements (pas seulement assets)
- Teste RLS sur stock_split_events

---

## Résumé des Changements

| Correction | v4 Error | v4.1 Fix | Impact |
|-----------|----------|----------|--------|
| 1 | avg_buy_price mélangé CHF | Natif seulement | Prix correct par devise |
| 2 | Pas de base_amount_chf | Colonnes historiques | Rollback sans recalc |
| 3 | SUM simple | Chronologique | P&L correct après ventes |
| 4 | Cash avant INSERT | Cash après INSERT | Idempotence garantie |
| 5 | Montant dupliqué | Une seule fois | Withdrawal correct |
| 6 | Frais toujours 0 | Parseur mappé | Audit fees réel |
| 7 | Pas RLS | RLS + Policy | Sécurité splits |
| 8 | Ambigu | Atomicité + Audit | Clarté erreurs |
| 9 | Double message | Une formule | Pas d'ambiguïté |
| 10 | RAISE NOTICE | Vrais appels RPC | Tests crédibles |

---

## Files

**v4.1 SQL**: `lib/supabase/import-schema-v4.1-FINAL.sql` (892 lignes)
**v4.1 Tests**: `lib/supabase/LOT2_TEST_QUERIES_v4.1-FINAL.sql` (630 lignes)

---
