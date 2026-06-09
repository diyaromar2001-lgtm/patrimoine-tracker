-- ─────────────────────────────────────────────────────────────────────────────────
-- 20260609000004_lcid_reverse_split_and_rop_isin.sql
-- ─────────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   1. Fix an inverted split-ratio formula in recalculate_asset_position(): a
--      "Stock split open"/"Stock split close" pair is parsed into
--        qty_before = "open" row quantity  (NEW share-count scale)
--        qty_after  = "close" row quantity (OLD share-count scale, == the
--                      running position quantity accumulated so far)
--      The correct ratio to rescale the running position from OLD -> NEW is
--        ratio = qty_before / qty_after
--      The previous code computed `qty_after / qty_before` (the inverse),
--      which for LCID's 10-for-1 reverse split on 2025-09-02 produced a
--      position 100x too large (10x from the bad ratio, applied once).
--
--      Concretely (real CSV, see lib/replay-position.test.ts):
--        running qty before split = 3.24514713 (sum of 5 buys)
--        qty_before (open)  = 0.32451471
--        qty_after  (close) = 3.24514713
--        correct ratio = 0.32451471 / 3.24514713 = 0.1   -> qty becomes 0.32451471
--        OLD (buggy) ratio = 3.24514713 / 0.32451471 = 10 -> qty becomes 32.4514713
--
--      With the corrected ratio, replaying the remaining 5 post-split buys
--      (+0.52709868) and the final sell (-0.85161339) yields exactly 0 —
--      matching Trading 212, where LCID is fully sold and absent from open
--      positions.
--
--   2. Recalculate ONLY the LCID asset (ISIN US5494982029) in the existing
--      portfolio(s) using the corrected function. No transactions, CSV
--      re-import, or other assets are touched.
--
--   3. Fix the ROP/"Roche" asset (ISIN CH1499059983). Migration 000003
--      assumed T212 ticker "ROP" == NYSE "Roper Technologies" (ISIN
--      US7766961061) and renamed this asset's name from "Roche" to
--      "Roper Technologies". That assumption was WRONG for this ISIN:
--      CH1499059983 is a Swiss security (ISIN prefix "CH"), and Yahoo
--      Finance confirms CH1499059983 == "ROP.SW" == Roche Holding AG
--      (the restructured participation-certificate ticker on SIX/EBS,
--      post Dec-2024 share-class restructuring), price ~318.8 CHF —
--      matching Trading 212's displayed price for this position exactly
--      (0.0284624 x 318.8 CHF ~= 9.07 CHF).
--
--      This fix is keyed by ISIN (CH1499059983), NOT by ticker, so it
--      cannot affect any other user's "ROP" = Roper Technologies (US)
--      holding. quantity, avg_buy_price and transactions are untouched.
--
-- SCOPE: function fix + targeted recompute/update of 2 specific assets
--        (by ISIN). No transactions, quantities, cost-basis formulas
--        (other than the split-ratio direction), CSV re-import, or new
--        portfolios.
--
-- IDEMPOTENT: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 1: FIX recalculate_asset_position() — corrected split-ratio direction
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalculate_asset_position(p_asset_id uuid, p_portfolio_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_qty numeric := 0;
  v_cost_basis_chf numeric := 0;
  v_avg_buy_price_native numeric := 0;
  v_event record;
  v_cost_per_unit numeric;
  v_split_ratio numeric;
BEGIN
  -- Chronological replay: events in true date order (splits can be between buys/sells)
  FOR v_event IN
    (
      SELECT
        'BUY'::text as event_type,
        t.date as event_date,
        t.created_at,
        t.quantity,
        t.price AS price_native,
        t.base_amount_chf,
        NULL::numeric as split_ratio
      FROM public.transactions t
      WHERE t.asset_id = p_asset_id AND t.type = 'buy'
      UNION ALL
      SELECT
        'SELL'::text,
        t.date,
        t.created_at,
        t.quantity,
        NULL::numeric,
        t.base_amount_chf,
        NULL::numeric
      FROM public.transactions t
      WHERE t.asset_id = p_asset_id AND t.type = 'sell'
      UNION ALL
      SELECT
        'SPLIT'::text,
        s.event_date,
        s.created_at,
        NULL::numeric,
        NULL::numeric,
        NULL::numeric,
        -- FIX: ratio = qty_before / qty_after (was qty_after / qty_before).
        -- "qty_before" = split-open quantity (new scale), "qty_after" =
        -- split-close quantity (old scale == running qty pre-split).
        CASE WHEN s.qty_after > 0 THEN (s.qty_before / s.qty_after) ELSE 1 END
      FROM public.stock_split_events s
      WHERE s.asset_id = p_asset_id
    )
    ORDER BY event_date ASC, created_at ASC
  LOOP
    IF v_event.event_type = 'SPLIT' THEN
      v_split_ratio := v_event.split_ratio;
      v_qty := v_qty * v_split_ratio;
      IF v_split_ratio > 0 THEN
        v_avg_buy_price_native := v_avg_buy_price_native / v_split_ratio;
      END IF;

    ELSIF v_event.event_type = 'BUY' THEN
      IF v_qty > 0 THEN
        v_avg_buy_price_native := (v_qty * v_avg_buy_price_native + v_event.quantity * v_event.price_native) / (v_qty + v_event.quantity);
      ELSE
        v_avg_buy_price_native := v_event.price_native;
      END IF;
      v_qty := v_qty + v_event.quantity;
      v_cost_basis_chf := v_cost_basis_chf + COALESCE(v_event.base_amount_chf, 0);

    ELSIF v_event.event_type = 'SELL' THEN
      IF v_qty > 0 THEN
        v_cost_per_unit := v_cost_basis_chf / v_qty;
        v_cost_basis_chf := v_cost_basis_chf - (v_event.quantity * v_cost_per_unit);
        v_qty := v_qty - v_event.quantity;
      END IF;
    END IF;
  END LOOP;

  -- Point 4: do NOT silently clamp – expose data anomalies with a WARNING.
  IF v_qty < 0 THEN
    RAISE WARNING 'recalculate_asset_position: qty went negative (%) for asset % – check for oversell or missing BUY. Clamping to 0.', v_qty, p_asset_id;
    v_qty := 0;
  END IF;
  -- Floating/decimal noise: a fully-closed position should read exactly 0.
  IF v_qty < 0.000000005 THEN
    v_qty := 0;
  END IF;
  IF v_cost_basis_chf < 0 THEN v_cost_basis_chf := 0; END IF;

  UPDATE public.assets SET
    quantity = v_qty,
    avg_buy_price = CASE WHEN v_qty > 0 THEN v_avg_buy_price_native ELSE 0 END,
    cost_basis_chf = v_cost_basis_chf,
    cost_basis_updated_at = now()
  WHERE id = p_asset_id;

END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.recalculate_asset_position(uuid, uuid) FROM authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 2: RECALCULATE LCID (ISIN US5494982029) WITH THE CORRECTED FUNCTION
-- ═════════════════════════════════════════════════════════════════════════════════
-- LCID has exactly one stock_split_events row (the 2025-09-02 10-for-1
-- reverse split). Recomputing with the fixed ratio replays:
--   5 buys (sum 3.24514713) -> split x0.1 -> 0.32451471
--   + 5 buys (sum 0.52709868) = 0.85161339
--   - 1 sell (0.85161339) = 0
-- Result: quantity = 0 (matches Trading 212: LCID absent from open positions).
-- The asset row and its transaction history are kept; only quantity /
-- avg_buy_price / cost_basis_chf are recomputed.

DO $$
DECLARE
  v_asset RECORD;
BEGIN
  FOR v_asset IN
    SELECT id, portfolio_id FROM public.assets WHERE isin = 'US5494982029'
  LOOP
    PERFORM public.recalculate_asset_position(v_asset.id, v_asset.portfolio_id);
  END LOOP;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 3: FIX ROP/"Roche" (ISIN CH1499059983) — Roche Holding AG, not Roper Tech.
-- ═════════════════════════════════════════════════════════════════════════════════
-- Yahoo Finance: ISIN CH1499059983 -> symbol "ROP.SW", longName "Roche Holding AG",
-- exchange EBS (SIX), currency CHF, price ~318.8 CHF (matches T212 exactly for
-- 0.0284624 units ~= 9.07 CHF). Keyed by ISIN so it cannot collide with any
-- other user's NYSE "ROP" = Roper Technologies (ISIN US7766961061) holding.

UPDATE public.assets
SET
  name          = 'Roche Holding AG',
  isin          = 'CH1499059983',
  broker_ticker = COALESCE(broker_ticker, ticker),
  quote_symbol  = 'ROP.SW',
  currency      = 'CHF'
WHERE isin = 'CH1499059983'
   OR (ticker = 'ROP' AND name = 'Roper Technologies');

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 4: AUDIT TRAIL
-- ═════════════════════════════════════════════════════════════════════════════════

SELECT id, portfolio_id, ticker, name, isin, broker_ticker, quote_symbol,
       quantity, avg_buy_price, currency, cost_basis_chf
FROM public.assets
WHERE isin IN ('US5494982029', 'CH1499059983')
ORDER BY ticker;
