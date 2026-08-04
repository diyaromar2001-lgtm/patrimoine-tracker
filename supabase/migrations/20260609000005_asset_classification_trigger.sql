-- ─────────────────────────────────────────────────────────────────────────────────
-- 20260609000005_asset_classification_trigger.sql
-- ─────────────────────────────────────────────────────────────────────────────────
-- PROBLÈME CONSTATÉ (données réelles, août 2026)
--   L'import CSV (import_csv_batch) insère TOUS les actifs avec
--   asset_class = 'stock' en dur, et n'écrit ni broker_ticker ni quote_symbol.
--   Conséquences visibles dans l'app :
--     • EUNL, EIMI, WSML, IDVY, SMH, VHYL (des ETF) comptés comme « Action »
--       → « Action · 100 % » et une alerte de concentration trompeuse ;
--     • quote_symbol NULL → ROP se résout sur Yahoo vers « Roper Technologies »
--       (NYSE) au lieu de Roche « ROP.SW » (SIX).
--
--   Les migrations 000003/000004 avaient corrigé ces colonnes, mais un
--   réimport ultérieur a recréé des lignes vierges : corriger une seule fois
--   ne suffit pas. D'où un TRIGGER qui normalise à chaque insertion.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Fonction de classification ETF/action (liste T212 + heuristique de nom)
--   2. Trigger BEFORE INSERT sur assets : remplit asset_class, broker_ticker,
--      quote_symbol → tout import futur est correct sans toucher au RPC
--      d'import (900 lignes, trop risqué à réécrire).
--   3. Back-fill des lignes existantes.
--
-- SCOPE : colonnes descriptives uniquement. Aucune quantité, aucun prix moyen,
--         aucun cost basis, aucune transaction n'est modifié.
-- IDEMPOTENT : ré-exécutable sans risque.
-- ─────────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 1 : CLASSIFICATION ETF / ACTION
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.t212_classify_asset_class(p_ticker text, p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    -- Tickers ETF connus de l'export Trading 212 (aligné sur
    -- lib/import/t212-symbol-map.ts et t212_resolve_quote_symbol)
    WHEN upper(coalesce(p_ticker, '')) IN (
      'EUNL','EIMI','WSML','IDVY','IUSA','CSPX','ISAC','IUIT','IQQW','IGLN',
      'SMH','VUAA','VHYL','VHY','VUSA','VWRL','VWCE','SWRD','SPPW','LGGG',
      'LCWD','HMWO'
    ) THEN 'etf'
    -- Heuristique de repli sur le nom de l'instrument : couvre les ETF
    -- non listés ci-dessus lors de futurs imports.
    WHEN lower(coalesce(p_name, '')) ~ '(ishares|vanguard|xtrackers|amundi|lyxor|spdr|invesco|vaneck|ucits|\betf\b)'
      THEN 'etf'
    ELSE 'stock'
  END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 2 : TRIGGER DE NORMALISATION À L'INSERTION
-- ═════════════════════════════════════════════════════════════════════════════════
-- Corrige la cause racine : tout actif créé par l'import (ou manuellement)
-- reçoit automatiquement sa classe, son ticker broker et son symbole Yahoo.

CREATE OR REPLACE FUNCTION public.normalize_asset_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Classe d'actif : ne corrige que la valeur par défaut 'stock' laissée par
  -- l'import ; une classe explicite (crypto, bond, real_estate…) est respectée.
  IF NEW.asset_class IS NULL OR NEW.asset_class = 'stock' THEN
    NEW.asset_class := public.t212_classify_asset_class(NEW.ticker, NEW.name);
  END IF;

  -- Ticker d'origine du broker
  IF NEW.broker_ticker IS NULL THEN
    NEW.broker_ticker := NEW.ticker;
  END IF;

  -- Symbole Yahoo (NULL si aucun alias connu → le ticker brut sera utilisé)
  IF NEW.quote_symbol IS NULL THEN
    NEW.quote_symbol := public.t212_resolve_quote_symbol(NEW.ticker);
  END IF;

  -- Cas particulier ROP : chez Trading 212 « ROP » désigne Roche (SIX), pas
  -- Roper Technologies (NYSE). Sans ce mapping, Yahoo renvoie le mauvais titre.
  IF upper(coalesce(NEW.ticker, '')) = 'ROP' AND lower(coalesce(NEW.name, '')) LIKE '%roche%' THEN
    NEW.quote_symbol := 'ROP.SW';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_asset ON public.assets;
CREATE TRIGGER trg_normalize_asset
  BEFORE INSERT ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.normalize_asset_on_insert();

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 3 : BACK-FILL DES LIGNES EXISTANTES
-- ═════════════════════════════════════════════════════════════════════════════════

-- 3a. Classe d'actif : uniquement les lignes encore marquées 'stock' par défaut
UPDATE public.assets
SET asset_class = public.t212_classify_asset_class(ticker, name)
WHERE asset_class = 'stock'
  AND public.t212_classify_asset_class(ticker, name) <> 'stock';

-- 3b. Ticker broker
UPDATE public.assets
SET broker_ticker = ticker
WHERE broker_ticker IS NULL;

-- 3c. Symbole Yahoo depuis la table de correspondance T212
UPDATE public.assets
SET quote_symbol = public.t212_resolve_quote_symbol(ticker)
WHERE quote_symbol IS NULL
  AND public.t212_resolve_quote_symbol(ticker) IS NOT NULL;

-- 3d. ROP = Roche (SIX) et non Roper Technologies (NYSE)
UPDATE public.assets
SET quote_symbol = 'ROP.SW'
WHERE upper(ticker) = 'ROP'
  AND lower(coalesce(name, '')) LIKE '%roche%'
  AND quote_symbol IS DISTINCT FROM 'ROP.SW';

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 4 : VÉRIFICATION
-- ═════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF public.t212_classify_asset_class('EUNL', 'iShares Core MSCI World') <> 'etf' THEN
    RAISE EXCEPTION 'FAIL: EUNL devrait être classé etf';
  END IF;
  IF public.t212_classify_asset_class('ROP', 'Roche') <> 'stock' THEN
    RAISE EXCEPTION 'FAIL: ROP (Roche) devrait rester stock';
  END IF;
  IF public.t212_classify_asset_class('XYZ', 'iShares Whatever UCITS') <> 'etf' THEN
    RAISE EXCEPTION 'FAIL: heuristique de nom cassée';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_normalize_asset') THEN
    RAISE EXCEPTION 'FAIL: trigger trg_normalize_asset absent';
  END IF;
  RAISE NOTICE '✓ Migration 000005 vérifiée : classification + trigger + back-fill';
END $$;

-- Contrôle visuel du résultat
SELECT ticker, name, asset_class, broker_ticker, quote_symbol
FROM public.assets
WHERE quantity > 0
ORDER BY asset_class, ticker;
