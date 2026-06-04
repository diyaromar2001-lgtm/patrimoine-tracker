-- ════════════════════════════════════════════════════════════════════════════
-- Fix: Ajouter les colonnes manquantes pour historique du cost basis
-- Coller dans Supabase > SQL Editor > New Query > Run
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Ajouter les colonnes cost_basis_chf, cost_basis_source, cost_basis_updated_at
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS cost_basis_chf decimal,
  ADD COLUMN IF NOT EXISTS cost_basis_source text DEFAULT 'backfill',
  ADD COLUMN IF NOT EXISTS cost_basis_updated_at timestamptz;

-- 2. Backfill cost_basis_chf pour les assets existants
-- (Note: On n'a pas les taux historiques, donc on utilise une approximation)
-- cost_basis_chf = quantity × avg_buy_price (on suppose currency CHF pour le backfill)
UPDATE assets
SET cost_basis_chf = quantity * avg_buy_price
WHERE cost_basis_chf IS NULL;

SELECT 'COST BASIS COLUMNS ADDED AND BACKFILLED' AS status;
