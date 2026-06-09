-- ─────────────────────────────────────────────────────────────────────────────────
-- 20260609000003_asset_quote_symbol.sql
-- ─────────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   1. Add broker_ticker + quote_symbol columns to assets so the frontend can
--      resolve the correct Yahoo Finance instrument for T212 EU tickers
--      (e.g. "WSML" → "WSML.L" on LSE; "SMH" → "SMH.L" on LSE, not the US ETF).
--   2. Fix existing imported asset names:
--        a. Strip surrounding double-quote characters (T212 CSV artefact).
--        b. Correct the ROP asset name: stored as "Roche" due to a T212 CSV
--           parse issue; correct value is "Roper Technologies".
--   3. Back-fill quote_symbol for all existing assets using the known T212 map.
--
-- SCOPE: DDL + data fixes only. No changes to import_csv_batch or any other RPC.
--        No transactions, quantities, or historical data are touched.
--
-- IDEMPOTENT: safe to re-run (IF NOT EXISTS / CREATE OR REPLACE / COALESCE guards).
-- ─────────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 1: ADD COLUMNS
-- ═════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS broker_ticker text,  -- original T212 CSV ticker (e.g. "WSML")
  ADD COLUMN IF NOT EXISTS quote_symbol  text;  -- Yahoo Finance symbol    (e.g. "WSML.L")

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 2: HELPER — T212 TICKER → YAHOO FINANCE SYMBOL
-- ═════════════════════════════════════════════════════════════════════════════════
-- Keep in sync with lib/import/t212-symbol-map.ts.

CREATE OR REPLACE FUNCTION public.t212_resolve_quote_symbol(p_ticker text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE upper(p_ticker)
    -- iShares UCITS ETFs
    WHEN 'EUNL' THEN 'EUNL.DE'
    WHEN 'EIMI' THEN 'EIMI.L'
    WHEN 'WSML' THEN 'WSML.L'
    WHEN 'IDVY' THEN 'IDVY.L'
    WHEN 'IUSA' THEN 'IUSA.L'
    WHEN 'CSPX' THEN 'CSPX.L'
    WHEN 'ISAC' THEN 'ISAC.L'
    WHEN 'IUIT' THEN 'IUIT.L'
    WHEN 'IQQW' THEN 'IQQW.DE'
    WHEN 'IGLN' THEN 'IGLN.L'
    -- VanEck UCITS: T212 EU "SMH" = IE00BMC38736 (LSE), NOT the US VanEck SMH
    WHEN 'SMH'  THEN 'SMH.L'
    -- Vanguard / SPDR / L&G / HSBC UCITS ETFs
    WHEN 'VUAA' THEN 'VUAA.L'
    WHEN 'VHYL' THEN 'VHYL.L'
    WHEN 'VHY'  THEN 'VHYL.L'
    WHEN 'VUSA' THEN 'VUSA.L'
    WHEN 'VWRL' THEN 'VWRL.L'
    WHEN 'SWRD' THEN 'SWRD.L'
    WHEN 'SPPW' THEN 'SPPW.DE'
    WHEN 'LGGG' THEN 'LGGG.L'
    WHEN 'LCWD' THEN 'LCWD.L'
    WHEN 'HMWO' THEN 'HMWO.L'
    -- Swiss stocks — SIX exchange
    WHEN 'UBS'  THEN 'UBSG.SW'
    WHEN 'UBSG' THEN 'UBSG.SW'
    -- ROG.SW excluded: returns HTTP 404 (Roche Holding restructured share classes Dec 2024)
    -- Do NOT add ROG here until a confirmed working Yahoo Finance symbol is available.
    WHEN 'NOVN' THEN 'NOVN.SW'
    WHEN 'NESN' THEN 'NESN.SW'
    WHEN 'ABBN' THEN 'ABBN.SW'
    WHEN 'ZURN' THEN 'ZURN.SW'
    WHEN 'SREN' THEN 'SREN.SW'
    WHEN 'GIVN' THEN 'GIVN.SW'
    -- ROP = Roper Technologies (NYSE) — no alias needed; plain US ticker resolves
    -- correctly on Yahoo Finance.  Explicitly excluded to prevent any accidental
    -- mapping to a Swiss/European symbol.
    ELSE NULL
  END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 3: FIX EXISTING IMPORTED ASSETS
-- ═════════════════════════════════════════════════════════════════════════════════

-- 3a. Strip surrounding double-quote characters from names imported via T212 CSV.
--     T212 wraps names containing commas in double quotes; those quote chars were
--     stored literally.  e.g. '"VanEck Semiconductor (Acc)"' → clean name.
UPDATE public.assets
SET name = REGEXP_REPLACE(name, '(^"|"$)', '', 'g')
WHERE name LIKE '"%' OR name LIKE '%"';

-- 3b. Fix ROP asset name: stored as "Roche" due to a T212 CSV parsing issue.
--     Root cause: naïve comma-split in the parser truncates "Roper Technologies, Inc."
--     at the comma, potentially associating the ticker with incorrect data from the
--     adjacent CSV field.  The correct company name is Roper Technologies.
--     Guard: only updates if the current name contains "roche" (case-insensitive)
--     so a re-run after a correct import is a no-op.
UPDATE public.assets
SET name = 'Roper Technologies'
WHERE ticker = 'ROP'
  AND name ILIKE '%roche%';

-- 3c. Back-fill broker_ticker for every asset that doesn't have one yet.
UPDATE public.assets
SET broker_ticker = ticker
WHERE broker_ticker IS NULL;

-- 3d. Back-fill quote_symbol for assets with a known T212 → Yahoo mapping.
--     Assets that already have quote_symbol set manually are left untouched.
UPDATE public.assets
SET quote_symbol = public.t212_resolve_quote_symbol(ticker)
WHERE quote_symbol IS NULL
  AND public.t212_resolve_quote_symbol(ticker) IS NOT NULL;

-- Show back-fill result for audit trail
SELECT ticker, name, broker_ticker, quote_symbol
FROM public.assets
WHERE quote_symbol IS NOT NULL
ORDER BY ticker;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 4: VERIFICATION
-- ═════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Verify new columns exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'broker_ticker') THEN
    RAISE EXCEPTION 'Missing column: assets.broker_ticker';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'quote_symbol') THEN
    RAISE EXCEPTION 'Missing column: assets.quote_symbol';
  END IF;
  -- Verify helper function
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 't212_resolve_quote_symbol') THEN
    RAISE EXCEPTION 'Missing function: t212_resolve_quote_symbol';
  END IF;
  -- Spot-check critical T212 → Yahoo mappings (5 validated via Yahoo Finance)
  IF public.t212_resolve_quote_symbol('WSML') IS DISTINCT FROM 'WSML.L' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(WSML) expected WSML.L, got %',
      public.t212_resolve_quote_symbol('WSML');
  END IF;
  IF public.t212_resolve_quote_symbol('SMH') IS DISTINCT FROM 'SMH.L' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(SMH) expected SMH.L, got %',
      public.t212_resolve_quote_symbol('SMH');
  END IF;
  IF public.t212_resolve_quote_symbol('EUNL') IS DISTINCT FROM 'EUNL.DE' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(EUNL) expected EUNL.DE, got %',
      public.t212_resolve_quote_symbol('EUNL');
  END IF;
  IF public.t212_resolve_quote_symbol('EIMI') IS DISTINCT FROM 'EIMI.L' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(EIMI) expected EIMI.L, got %',
      public.t212_resolve_quote_symbol('EIMI');
  END IF;
  IF public.t212_resolve_quote_symbol('UBS') IS DISTINCT FROM 'UBSG.SW' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(UBS) expected UBSG.SW, got %',
      public.t212_resolve_quote_symbol('UBS');
  END IF;
  -- ROP must NEVER resolve to anything (no alias for Roper Technologies)
  IF public.t212_resolve_quote_symbol('ROP') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(ROP) must be NULL, got %',
      public.t212_resolve_quote_symbol('ROP');
  END IF;
  -- ROG must NEVER resolve to ROG.SW (broken since Roche Dec-2024 restructuring)
  IF public.t212_resolve_quote_symbol('ROG') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(ROG) must be NULL (ROG.SW is 404), got %',
      public.t212_resolve_quote_symbol('ROG');
  END IF;
  -- AAPL must return NULL (plain US ticker, no alias)
  IF public.t212_resolve_quote_symbol('AAPL') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(AAPL) expected NULL, got %',
      public.t212_resolve_quote_symbol('AAPL');
  END IF;
  RAISE NOTICE '✓ Migration 000003 verified: columns, function, and spot-checks all passed';
END $$;
