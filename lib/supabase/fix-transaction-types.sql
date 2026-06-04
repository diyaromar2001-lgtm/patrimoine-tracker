-- ════════════════════════════════════════════════════════════════════════════
-- Fix: étendre les types de transactions autorisés
-- Coller dans Supabase > SQL Editor > New Query > Run
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Supprimer l'ancienne contrainte CHECK sur le type (si elle existe)
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_type_fkey;

-- Essayer tous les noms de contraintes possibles
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'transactions'
      AND constraint_type = 'CHECK'
  LOOP
    EXECUTE 'ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    RAISE NOTICE 'Dropped constraint: %', r.constraint_name;
  END LOOP;
END;
$$;

-- 2. Ajouter la nouvelle contrainte qui accepte TOUS les types
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'buy', 'sell', 'dividend', 'transfer',
    'revenu', 'deposit'
  ));

-- 3. Ajouter la colonne cash_balances aux portfolios si elle manque encore
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS cash_balances jsonb NOT NULL DEFAULT '{"CHF":0,"USD":0,"EUR":0}';

-- 4. Vérification
SELECT
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'transactions_type_check';

SELECT 'FIX APPLIED SUCCESSFULLY' AS status;
