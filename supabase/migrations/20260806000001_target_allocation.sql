-- ════════════════════════════════════════════════════════════════════════════
-- Allocation cible (« Pie ») par portefeuille
--
-- Stocke la répartition VOULUE par l'utilisateur : { "VWCE": 40, "NVDA": 20 }.
-- Une seule colonne JSON plutôt qu'une table dédiée : une cible n'a ni
-- historique ni cycle de vie propre, elle appartient au portefeuille et
-- disparaît avec lui.
--
-- Idempotent : peut être exécuté plusieurs fois sans risque.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS target_allocation jsonb;

COMMENT ON COLUMN public.portfolios.target_allocation IS
  'Allocation cible ticker -> pourcentage. NULL = aucune cible définie.';

-- Vérification : la colonne doit exister après exécution.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'portfolios'
      AND column_name  = 'target_allocation'
  ) THEN
    RAISE EXCEPTION 'La colonne target_allocation n''a pas été créée.';
  END IF;
  RAISE NOTICE 'OK : portfolios.target_allocation disponible.';
END $$;
