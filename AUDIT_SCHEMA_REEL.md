# AUDIT COMPLET DU SCHÉMA RÉEL

**Date**: 2026-06-08  
**Source de vérité**: Fichiers SQL du dépôt réel  
**Git Hash**: 5b6a96aff35cc77133f43de454eb75458fdfbd4e  
**CSV**: 482 lignes (481 opérations + header)

---

## 1. TABLES EXISTANTES ET COLONNES

### 1.1 `public.portfolios` (SCHEMA.SQL)

| Colonne | Type | Null | Clé | Status |
|---------|------|------|-----|--------|
| id | uuid | NO | PK | ✅ |
| user_id | uuid | YES | - | ✅ |
| name | text | NO | - | ✅ |
| description | text | YES | - | ✅ |
| color | text | NO | - | ✅ |
| currency | text | NO | def 'CHF' | ✅ |
| created_at | timestamptz | NO | def now() | ✅ |

**Status**: ✅ OK - Aucune colonne manquante

---

### 1.2 `public.assets` (SCHEMA.SQL)

| Colonne | Type | Null | Clé | Status |
|---------|------|------|-----|--------|
| id | uuid | NO | PK | ✅ |
| portfolio_id | uuid | YES | FK(portfolios) | ✅ |
| ticker | text | NO | - | ✅ |
| name | text | NO | - | ✅ |
| asset_class | text | NO | - | ✅ |
| quantity | numeric | NO | - | ✅ |
| avg_buy_price | numeric | NO | - | ✅ |
| currency | text | NO | def 'CHF' | ✅ |
| cost_basis_chf | numeric | NO | def 0 | ✅ |
| cost_basis_source | text | NO | def 'computed' | ✅ |
| cost_basis_updated_at | timestamptz | NO | def now() | ✅ |
| sector | text | YES | - | ✅ |
| country | text | YES | - | ✅ |
| crypto_custody | text | YES | - | ✅ |
| staking_enabled | boolean | NO | def false | ✅ |
| created_at | timestamptz | NO | def now() | ✅ |

**MANQUANTES**:
- ❌ `isin` - CRITIQUE pour resolution des assets Trading 212
- ❌ `isin_updated_at`

**Status**: ⚠️ Incomplète - Manque isin

---

### 1.3 `public.transactions` (SCHEMA.SQL)

| Colonne | Type | Null | Clé | Status |
|---------|------|------|-----|--------|
| id | uuid | NO | PK | ✅ |
| portfolio_id | uuid | YES | FK(portfolios) | ✅ |
| ticker | text | NO | - | ✅ |
| asset_name | text | NO | - | ✅ |
| asset_class | text | NO | - | ✅ |
| type | text | NO | CHECK(...) | ⚠️ |
| quantity | numeric | NO | - | ✅ |
| price | numeric | NO | - | ✅ |
| fees | numeric | NO | def 0 | ✅ |
| currency | text | NO | def 'CHF' | ✅ |
| fx_rate_to_chf | numeric | NO | def 1 | ✅ |
| gross_amount_chf | numeric | NO | def 0 | ✅ |
| fees_chf | numeric | NO | def 0 | ✅ |
| net_amount_chf | numeric | NO | def 0 | ✅ |
| realized_pnl_chf | numeric | NO | def 0 | ✅ |
| date | date | NO | - | ✅ |
| notes | text | YES | - | ✅ |
| created_at | timestamptz | NO | def now() | ✅ |

**Type CHECK**: `buy | sell | dividend | transfer`

**MANQUANTES** (critiques pour import):
- ❌ `asset_id` - FK vers assets (CRITIQUE)
- ❌ `source` - Identifiant du broker/source
- ❌ `source_external_id` - ID unique de l'opération chez le broker
- ❌ `import_batch_id` - FK vers import_batches
- ❌ `base_amount_chf` - Montant CHF historique (distinct de gross_amount_chf)
- ❌ `withholding_tax_amount` - Pour dividends
- ❌ `withholding_tax_currency` - Devise de la retenue

**Status**: ❌ Incomplète - 7 colonnes manquantes

---

### 1.4 `public.cash_movements` (GLOBAL-CASH-SCHEMA.SQL)

| Colonne | Type | Null | Clé | Status |
|---------|------|------|-----|--------|
| id | uuid | NO | PK | ✅ |
| user_id | uuid | NO | FK(auth.users) | ✅ |
| type | text | NO | - | ✅ |
| currency | text | NO | def 'CHF' | ✅ |
| amount | decimal | NO | - | ✅ |
| balance_after_chf | decimal | YES | - | ✅ |
| balance_after_usd | decimal | YES | - | ✅ |
| balance_after_eur | decimal | YES | - | ✅ |
| note | text | YES | - | ✅ |
| ref_ticker | text | YES | - | ✅ |
| ref_portfolio_id | uuid | YES | FK(portfolios) | ✅ |
| date | timestamptz | NO | def now() | ✅ |
| created_at | timestamptz | NO | def now() | ✅ |

**Type possible**: 'deposit', 'withdrawal', 'conversion', 'buy_deduction', 'sell_credit', 'dividend_credit', 'revenue_credit'

**MANQUANTES** (pour import):
- ❌ `portfolio_id` - Explicitement nommé (à la place de ref_portfolio_id?)
- ❌ `source` - Identifiant du broker
- ❌ `source_external_id` - ID unique chez le broker
- ❌ `import_batch_id` - FK vers import_batches

**Status**: ⚠️ Existe mais incomplète - 4 colonnes manquantes, convention de nommage (ref_portfolio_id vs portfolio_id)

---

### 1.5 `public.global_cash` (GLOBAL-CASH-SCHEMA.SQL)

| Colonne | Type | Null | Clé | Status |
|---------|------|------|-----|--------|
| id | uuid | NO | PK | ✅ |
| user_id | uuid | NO | FK(auth.users) | ✅ |
| chf | decimal | NO | def 0 | ✅ |
| usd | decimal | NO | def 0 | ✅ |
| eur | decimal | NO | def 0 | ✅ |
| updated_at | timestamptz | YES | def now() | ✅ |

**Status**: ✅ OK

---

### 1.6 TABLES MANQUANTES

- ❌ `public.import_batches` - CRITIQUE - Doit exister
- ❌ `public.stock_split_events` - IMPORTANTE - Pour gestion des splits

---

## 2. TABLEAU DES INCOMPATIBILITÉS

| Schéma | Table | Colonne | Type Attendu | Existe? | Action |
|--------|-------|---------|--------------|---------|--------|
| portfolio | portfolios | * | - | ✅ | OK |
| asset | assets | isin | text | ❌ | ADD |
| asset | assets | isin_updated_at | timestamptz | ❌ | ADD |
| txn | transactions | asset_id | uuid FK | ❌ | ADD CRITICAL |
| txn | transactions | source | text | ❌ | ADD |
| txn | transactions | source_external_id | text | ❌ | ADD |
| txn | transactions | import_batch_id | uuid FK | ❌ | ADD |
| txn | transactions | base_amount_chf | numeric | ❌ | ADD |
| txn | transactions | withholding_tax_amount | numeric | ❌ | ADD |
| txn | transactions | withholding_tax_currency | text | ❌ | ADD |
| cash | cash_movements | portfolio_id | uuid FK | ❌ | ADD or RENAME ref_portfolio_id |
| cash | cash_movements | source | text | ❌ | ADD |
| cash | cash_movements | source_external_id | text | ❌ | ADD |
| cash | cash_movements | import_batch_id | uuid FK | ❌ | ADD |
| batch | import_batches | (entière) | - | ❌ | CREATE TABLE |
| split | stock_split_events | (entière) | - | ❌ | CREATE TABLE |

---

## 3. CONTRAINTES CHECK EXISTANTES

### transactions.type
```sql
CHECK (type IN ('buy', 'sell', 'dividend', 'transfer'))
```

**Status**: ⚠️ Restreint - Peut nécessiter extension pour certains types

### assets.cost_basis_source
```sql
CHECK (cost_basis_source IN ('computed', 'manual', 'backfill'))
```

**Status**: ✅ OK

---

## 4. COLONNES SIMILAIRES (CONFUSION POSSIBLE)

| Contexte | Colonne A | Colonne B | Décision |
|----------|-----------|-----------|----------|
| cash_movements | ref_portfolio_id | portfolio_id? | À clarifier - utiliser une seule convention |
| transactions | gross_amount_chf | base_amount_chf? | À clarifier - sens différent? |
| transactions | realized_pnl_chf | À calculer lors de SELL | À recalculer correctement |

---

## 5. DÉPENDANCES VERS auth.users

- global_cash.user_id → auth.users(id)
- cash_movements.user_id → auth.users(id)

**Status**: ✅ OK - Utilisées pour RLS

---

## 6. FICHIERS LOT 2 EXISTANTS

| Fichier | Taille | Version | Status |
|---------|--------|---------|--------|
| import-schema-v4-FINAL.sql | 44.1 KB | v4 | ❌ Ancien |
| import-schema-v4.1-FINAL.sql | 37.3 KB | v4.1 | ❌ Ancien (ALTER TABLE) |
| import-schema-v4.2-COMPLETE.sql | 30.4 KB | v4.2 | ❌ Incomplète (dépend v4.1) |
| import-schema-v4.2-FINAL.sql | 19.1 KB | v4.2 | ❌ Plus court = plus incomplet |
| LOT2_TEST_QUERIES_v4.2-COMPLETE.sql | 21.2 KB | Tests | ❌ Simulés |
| test-lot2-v42-complete.js | 9.3 KB | Node tests | ❌ Simulés |

**Conclusion**: Tous les fichiers Lot 2 sont incomplets ou dépassés. À remplacer entièrement.

---

## 7. CSV RÉEL

- **Chemin**: `C:\Users\omard\Downloads\from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv`
- **Lignes**: 482 (481 opérations + 1 header)
- **Devises**: CHF, USD, EUR, GBP
- **Opérations**: Buy, Sell, Dividend, Currency conversion, Interest, Deposit, Withdrawal, Stock split
- **Divisions**:
  - Market buy: 327
  - Limit buy: 5
  - Market sell: 35
  - Limit sell: 2
  - Interest: 54
  - Deposit: 28
  - Withdrawal: 2
  - Currency conversion: 5
  - Stock split (open/close): 2
  - Dividend: 19
  - Dividend tax exempted: 1
  - Dividend adjustment: 1

---

## 8. DÉCISION ARCHITECTURE

### Convention de nommage cash_movements
Utiliser: `portfolio_id` (pas `ref_portfolio_id`) pour cohérence avec `transactions.portfolio_id`

### Convention de clés idempotence
**Niveau 1 (Batch)**:
```sql
UNIQUE(user_id, broker, file_checksum)
```

**Niveau 2 (Opération)**:
```sql
UNIQUE(portfolio_id, source, source_external_id)
```

### Types de transactions à supporter
```
buy, sell, dividend, interest, transfer
```

### Types de cash_movements à supporter
```
buy, sell, deposit, withdrawal, dividend, withholding_tax, interest, conversion_out, conversion_in, fx_fee
```

---

## PROCHAINES ÉTAPES

1. ✅ Audit complété
2. ⏳ Créer migration unifiée (import-schema-trading212-final.sql)
3. ⏳ Créer tests réels (test-import-trading212-final.js)
4. ⏳ Lancer Supabase local
5. ⏳ Appliquer migrations
6. ⏳ Importer CSV réel
7. ⏳ Valider avec preuves brutes

