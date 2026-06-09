-- ─────────────────────────────────────────────────────────────────────────────────
-- 20260609000003_asset_quote_symbol.sql
-- ─────────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   1. Add broker_ticker + quote_symbol columns to assets so the frontend can
--      resolve the correct Yahoo Finance instrument for T212 EU tickers
--      (e.g. "WSML" → "WSML.L" on LSE; "SMH" → "SMH.L" on LSE, not the US ETF).
--   2. Fix existing imported asset names by stripping surrounding double-quote
--      characters that T212 CSV wraps around names containing commas
--      (e.g. '"VanEck Semiconductor (Acc)"' → 'VanEck Semiconductor (Acc)').
--   3. Back-fill quote_symbol for all existing assets using the known T212 map.
--   4. Replace import_csv_batch() with a version that:
--        • Strips name quotes on every new import.
--        • Populates isin (was declared but unused in 000002).
--        • Stores broker_ticker and quote_symbol on every new asset INSERT.
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
    WHEN 'ROG'  THEN 'ROG.SW'
    WHEN 'NOVN' THEN 'NOVN.SW'
    WHEN 'NESN' THEN 'NESN.SW'
    WHEN 'ABBN' THEN 'ABBN.SW'
    WHEN 'ZURN' THEN 'ZURN.SW'
    WHEN 'SREN' THEN 'SREN.SW'
    WHEN 'GIVN' THEN 'GIVN.SW'
    ELSE NULL
  END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 3: FIX EXISTING IMPORTED ASSETS
-- ═════════════════════════════════════════════════════════════════════════════════

-- 3a. Strip surrounding double-quote characters from names imported via T212 CSV.
--     T212 wraps names that contain commas in double quotes; those quote chars were
--     stored literally.  e.g. '"VanEck Semiconductor (Acc)"' → clean name.
UPDATE public.assets
SET name = REGEXP_REPLACE(name, '(^"|"$)', '', 'g')
WHERE name LIKE '"%' OR name LIKE '%"';

-- 3b. Back-fill broker_ticker for every asset that doesn't have one yet.
UPDATE public.assets
SET broker_ticker = ticker
WHERE broker_ticker IS NULL;

-- 3c. Back-fill quote_symbol for assets with a known T212 → Yahoo mapping.
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
-- SECTION 4: UPDATED IMPORT_CSV_BATCH
-- ═════════════════════════════════════════════════════════════════════════════════
-- Changes vs migration 000002:
--   ★ Strips surrounding double-quotes from asset names after extraction.
--   ★ Populates isin from operation JSON (was declared but unused in 000002).
--   ★ Sets broker_ticker + quote_symbol on every new asset INSERT.
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_csv_batch(
  p_portfolio_id uuid,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb
)
RETURNS TABLE(
  batch_id uuid,
  success boolean,
  rows_imported integer,
  rows_total integer,
  error_message text
)
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_batch_id uuid;
  v_batch_exists boolean := false;
  v_rows_imported integer := 0;
  v_rows_total integer := 0;
  v_idx integer;
  v_op jsonb;
  v_op_type text;
  v_date date;
  v_ticker text;
  v_isin text;
  v_name text;
  v_quantity numeric;
  v_price numeric;
  v_price_currency text;
  v_exchange_rate numeric;
  v_total_amount numeric;
  v_total_currency text;
  v_source_id text;
  v_asset_id uuid;
  v_inserted integer;
  v_dividend_gross_chf numeric;
  v_withholding_tax numeric;
  v_interest_amount numeric;
  v_fee_amount numeric;
  v_from_currency text;
  v_to_currency text;
  v_from_amount numeric;
  v_to_amount numeric;
  -- ── Position tracking (oversell guard + realized P&L) ──────────────────────
  v_ticker_positions   jsonb    := '{}'; -- {ticker: {qty, cost, avg}} running state in PASS 2
  v_op_rec             record;           -- record variable for the chronological PASS 2 loop
  v_running_qty        numeric  := 0;
  v_running_cost_chf   numeric  := 0;
  v_running_avg_native numeric  := 0;
  v_cost_per_unit_chf  numeric  := 0;
  v_cost_sold_chf      numeric  := 0;
  v_realized_pnl_chf   numeric;
  v_base_amount_chf    numeric;
  v_wht_currency       text;
  v_split_ratio        numeric;  -- for in-memory split tracking in PASS 2
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  v_rows_total := jsonb_array_length(p_operations);

  -- Point 1: verify portfolio belongs to the calling user before any write
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios WHERE id = p_portfolio_id AND user_id = v_user_id
  ) THEN
    RETURN QUERY SELECT NULL::uuid, false, 0, 0, 'Portfolio not found or access denied'::text;
    RETURN;
  END IF;

  BEGIN
    SELECT id, (status != 'pending') INTO v_batch_id, v_batch_exists
    FROM public.import_batches
    WHERE user_id = v_user_id AND portfolio_id = p_portfolio_id
      AND broker = p_broker AND file_checksum = p_file_checksum;

    IF v_batch_exists THEN
      RETURN QUERY SELECT v_batch_id, false, 0, v_rows_total, 'Batch already imported'::text;
      RETURN;
    END IF;

    IF v_batch_id IS NULL THEN
      INSERT INTO public.import_batches (user_id, portfolio_id, broker, filename, file_checksum, rows_total)
      VALUES (v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum, v_rows_total)
      RETURNING id INTO v_batch_id;
    END IF;

    UPDATE public.import_batches SET status = 'processing' WHERE id = v_batch_id;

    -- ════════════════════════════════════════════════════════════════════════════
    -- PASS 1: PROCESS STOCK SPLITS FIRST (preserve chronological order in pass 2)
    -- ════════════════════════════════════════════════════════════════════════════

    FOR v_idx IN 0..(v_rows_total - 1) LOOP
      v_op := p_operations->v_idx;
      v_op_type := v_op->>'type';

      IF v_op_type = 'stock_split' THEN
        v_date := (v_op->>'date')::date;
        v_ticker := v_op->>'ticker';
        v_source_id := v_op->>'sourceId';
        -- B9 fix: parser uses snake_case (qty_before, price_before, etc.)
        v_quantity := (v_op->>'qty_before')::numeric;
        v_price    := (v_op->>'price_before')::numeric;

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, avg_buy_price, cost_basis_chf,
            broker_ticker, quote_symbol)                                                          -- ★ NEW
          VALUES (p_portfolio_id, v_ticker, v_ticker, 'stock', 0, 0, 0,
            v_ticker, public.t212_resolve_quote_symbol(v_ticker))                                -- ★ NEW
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.stock_split_events (
          asset_id, portfolio_id, event_date, open_source_id, close_source_id, import_batch_id,
          qty_before, qty_after, price_before, price_after, cost_basis_chf
        ) VALUES (
          v_asset_id, p_portfolio_id, v_date,
          COALESCE(v_op->>'open_source_id', v_source_id),
          COALESCE(v_op->>'close_source_id', v_source_id || ':close'),
          v_batch_id,
          v_quantity,
          (v_op->>'qty_after')::numeric,
          v_price,
          (v_op->>'price_after')::numeric,
          0
        ) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
          PERFORM public.recalculate_asset_position(v_asset_id, p_portfolio_id);
        END IF;
      END IF;
    END LOOP;

    -- ════════════════════════════════════════════════════════════════════════════
    -- PASS 2: PROCESS ALL OTHER OPERATIONS IN STRICT CHRONOLOGICAL ORDER
    --   Sorted oldest-first so oversell checks and P&L use the correct running
    --   position at each moment in time.
    -- ════════════════════════════════════════════════════════════════════════════

    FOR v_op_rec IN
      -- Include stock_splits in date order so in-memory position tracking reflects
      -- split ratio changes between buys and sells (prevents false oversell rejections).
      SELECT ops.value
      FROM jsonb_array_elements(p_operations) AS ops(value)
      ORDER BY (ops.value->>'date')::date ASC,
               COALESCE(ops.value->>'sourceId', '') ASC
    LOOP
      v_op        := v_op_rec.value;
      v_op_type   := v_op->>'type';
      v_date      := (v_op->>'date')::date;
      v_source_id := v_op->>'sourceId';

      -- stock_splits were already inserted in PASS 1; here we only update in-memory
      -- position tracking so subsequent oversell checks and P&L calculations are correct.
      IF v_op_type = 'stock_split' THEN
        v_ticker := v_op->>'ticker';
        IF v_ticker_positions ? v_ticker THEN
          v_running_qty        := (v_ticker_positions->v_ticker->>'qty')::numeric;
          v_running_cost_chf   := (v_ticker_positions->v_ticker->>'cost')::numeric;
          v_running_avg_native := (v_ticker_positions->v_ticker->>'avg')::numeric;
          v_split_ratio := CASE
            WHEN COALESCE((v_op->>'qty_before')::numeric, 0) > 0
            THEN (v_op->>'qty_after')::numeric / (v_op->>'qty_before')::numeric
            ELSE 1 END;
          v_running_qty        := v_running_qty * v_split_ratio;
          v_running_avg_native := CASE WHEN v_split_ratio > 0
            THEN v_running_avg_native / v_split_ratio ELSE v_running_avg_native END;
          -- cost_basis_chf is invariant under splits (same total CHF value)
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'qty'], to_jsonb(v_running_qty));
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'avg'], to_jsonb(v_running_avg_native));
        END IF;
        CONTINUE; -- no DB work needed here
      END IF;

      IF v_op_type IN ('buy', 'sell') THEN
        v_ticker         := v_op->>'ticker';
        v_quantity       := (v_op->>'quantity')::numeric;
        v_price          := (v_op->>'price')::numeric;
        v_price_currency := v_op->>'priceCurrency';                          -- B1 fix: was 'currency'
        v_exchange_rate  := COALESCE((v_op->>'exchangeRate')::numeric, 1);
        v_total_amount   := COALESCE((v_op->>'totalAmount')::numeric,        -- B2 fix: use CSV Total directly
                              v_quantity * v_price * v_exchange_rate);
        v_total_currency := COALESCE(v_op->>'totalCurrency', 'CHF');         -- B3/cash fix
        v_name           := COALESCE(v_op->>'name', v_ticker);
        -- ★ Strip surrounding double-quotes T212 adds to names containing commas
        v_name           := REGEXP_REPLACE(v_name, '(^"|"$)', '', 'g');
        -- ★ Extract ISIN (declared in 000002 but never stored; now persisted on asset)
        v_isin           := COALESCE(NULLIF(v_op->>'isin', ''), NULL);

        -- Point 6: base_amount_chf stores only CHF amounts; NULL for non-CHF accounts
        v_base_amount_chf := CASE WHEN v_total_currency = 'CHF' THEN v_total_amount ELSE NULL END;

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, avg_buy_price, cost_basis_chf,
            broker_ticker, quote_symbol, isin)                                                   -- ★ NEW
          VALUES (p_portfolio_id, v_ticker, v_name, 'stock', 0, 0, 0,
            v_ticker, public.t212_resolve_quote_symbol(v_ticker), v_isin)                        -- ★ NEW
          RETURNING id INTO v_asset_id;
        END IF;

        -- Initialize in-memory running position for this ticker on first encounter.
        -- Seed from the assets table which reflects pre-import state + PASS 1 splits.
        IF NOT (v_ticker_positions ? v_ticker) THEN
          v_running_qty := 0; v_running_cost_chf := 0; v_running_avg_native := 0;
          SELECT COALESCE(a.quantity, 0), COALESCE(a.cost_basis_chf, 0), COALESCE(a.avg_buy_price, 0)
          INTO v_running_qty, v_running_cost_chf, v_running_avg_native
          FROM public.assets a WHERE a.id = v_asset_id;
          v_ticker_positions := v_ticker_positions || jsonb_build_object(
            v_ticker, jsonb_build_object(
              'qty',  to_jsonb(v_running_qty),
              'cost', to_jsonb(v_running_cost_chf),
              'avg',  to_jsonb(v_running_avg_native)
            )
          );
        END IF;

        v_running_qty        := (v_ticker_positions->v_ticker->>'qty')::numeric;
        v_running_cost_chf   := (v_ticker_positions->v_ticker->>'cost')::numeric;
        v_running_avg_native := (v_ticker_positions->v_ticker->>'avg')::numeric;

        -- Point 4: refuse oversell – no silent clamping
        IF v_op_type = 'sell' AND v_quantity > v_running_qty THEN
          RAISE EXCEPTION 'OVERSELL rejected: ticker=%, attempting to sell % but only % currently held',
            v_ticker, v_quantity, v_running_qty;
        END IF;

        -- Fix 2: realized P&L is only meaningful when both proceeds AND cost basis are in CHF.
        -- Store NULL instead of a fabricated zero when conversion is impossible.
        IF v_op_type = 'sell' THEN
          v_cost_per_unit_chf := CASE WHEN v_running_qty > 0
            THEN v_running_cost_chf / v_running_qty ELSE 0 END;
          v_cost_sold_chf := v_quantity * v_cost_per_unit_chf;
          IF v_base_amount_chf IS NULL OR v_running_cost_chf = 0 THEN
            v_realized_pnl_chf := NULL;   -- non-CHF or no cost basis: cannot compute P&L
          ELSE
            v_realized_pnl_chf := v_base_amount_chf - v_cost_sold_chf;
          END IF;
        ELSE
          v_realized_pnl_chf := NULL;
        END IF;

        IF v_op_type = 'sell' THEN
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
            source, source_external_id, import_batch_id, base_amount_chf, realized_pnl_chf
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'sell', v_quantity, v_price, v_price_currency, v_date,
            p_broker, v_source_id, v_batch_id, v_base_amount_chf, v_realized_pnl_chf
          ) ON CONFLICT (portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        ELSE
          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
            source, source_external_id, import_batch_id, base_amount_chf
          ) VALUES (
            p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'buy', v_quantity, v_price, v_price_currency, v_date,
            p_broker, v_source_id, v_batch_id, v_base_amount_chf
          ) ON CONFLICT (portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        END IF;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          -- Update in-memory running position
          IF v_op_type = 'buy' THEN
            v_running_avg_native := CASE WHEN v_running_qty > 0
              THEN (v_running_qty * v_running_avg_native + v_quantity * v_price) / (v_running_qty + v_quantity)
              ELSE v_price END;
            v_running_qty      := v_running_qty + v_quantity;
            v_running_cost_chf := v_running_cost_chf + COALESCE(v_base_amount_chf, 0);
          ELSIF v_op_type = 'sell' THEN
            v_running_qty      := v_running_qty - v_quantity;
            v_running_cost_chf := GREATEST(0, v_running_cost_chf - v_cost_sold_chf);
          END IF;
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'qty'],  to_jsonb(v_running_qty));
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'cost'], to_jsonb(v_running_cost_chf));
          v_ticker_positions := jsonb_set(v_ticker_positions, ARRAY[v_ticker, 'avg'],  to_jsonb(v_running_avg_native));

          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, p_portfolio_id,
            CASE WHEN v_op_type = 'buy' THEN 'buy_deduction' ELSE 'sell_credit' END,
            v_total_currency,                                                -- B3 fix: account currency, not price currency
            CASE WHEN v_op_type = 'buy' THEN -v_total_amount ELSE v_total_amount END,
            p_broker, v_source_id, v_batch_id, v_date
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          IF v_inserted > 0 THEN
            v_rows_imported := v_rows_imported + 1;
          END IF;
        END IF;

      ELSIF v_op_type IN ('dividend', 'dividend_tax_exempted', 'dividend_adjustment') THEN
        v_ticker          := v_op->>'ticker';
        v_withholding_tax := COALESCE((v_op->>'withholdingTax')::numeric, 0);
        v_total_currency  := COALESCE(v_op->>'totalCurrency', 'CHF');         -- B5 fix: use real currency
        -- Point 5: withholding tax currency from parser field withholdingTaxCurrency
        v_wht_currency    := COALESCE(NULLIF(v_op->>'withholdingTaxCurrency', ''), v_total_currency);
        -- B4 fix: gross = net received (totalAmount) + withheld; stored in totalCurrency
        -- v_total_amount = native gross (any currency) — used for cash_movements amount
        v_total_amount    := COALESCE((v_op->>'totalAmount')::numeric, 0) + v_withholding_tax;
        -- Fix 3: gross_amount_chf column only stores CHF; NULL for non-CHF dividends
        v_dividend_gross_chf := CASE WHEN v_total_currency = 'CHF' THEN v_total_amount ELSE NULL END;
        v_name            := COALESCE(v_op->>'name', v_ticker);
        -- ★ Strip surrounding double-quotes
        v_name            := REGEXP_REPLACE(v_name, '(^"|"$)', '', 'g');
        -- ★ Extract ISIN
        v_isin            := COALESCE(NULLIF(v_op->>'isin', ''), NULL);

        SELECT id INTO v_asset_id FROM public.assets
        WHERE portfolio_id = p_portfolio_id AND ticker = v_ticker;

        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (portfolio_id, ticker, name, asset_class, quantity, avg_buy_price, cost_basis_chf,
            broker_ticker, quote_symbol, isin)                                                   -- ★ NEW
          VALUES (p_portfolio_id, v_ticker, v_name, 'stock', 0, 0, 0,
            v_ticker, public.t212_resolve_quote_symbol(v_ticker), v_isin)                        -- ★ NEW
          RETURNING id INTO v_asset_id;
        END IF;

        INSERT INTO public.transactions (
          portfolio_id, asset_id, ticker, asset_name, asset_class, type, quantity, price, currency, date,
          source, source_external_id, import_batch_id, gross_amount_chf, withholding_tax_amount,
          withholding_tax_currency, source_subtype
        ) VALUES (
          p_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'dividend', 0, 0, v_total_currency, v_date,
          p_broker, v_source_id, v_batch_id, v_dividend_gross_chf, v_withholding_tax,
          v_wht_currency, v_op_type
        ) ON CONFLICT (portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
          ) VALUES (
            -- Use v_total_amount (native gross in totalCurrency), not gross_amount_chf which may be NULL
            v_user_id, p_portfolio_id, 'revenue_credit', v_total_currency, v_total_amount,
            p_broker, v_source_id, v_batch_id, v_date, v_op_type
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;

          IF v_withholding_tax > 0 THEN
            INSERT INTO public.cash_movements (
              user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
            ) VALUES (
              -- Point 5: withholding deduction in the tax's actual currency (v_wht_currency)
              v_user_id, p_portfolio_id, 'fee', v_wht_currency, -v_withholding_tax,
              p_broker, v_source_id || ':wht', v_batch_id, v_date, 'withholding_tax'
            ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
          END IF;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type = 'interest' THEN
        v_interest_amount := COALESCE((v_op->>'totalAmount')::numeric, 0);   -- B6 fix: was 'amount'
        v_total_currency  := COALESCE(v_op->>'totalCurrency', 'CHF');         -- Point 5: actual currency, not hardcoded CHF

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
        ) VALUES (
          v_user_id, p_portfolio_id, 'revenue_credit', v_total_currency, v_interest_amount,
          p_broker, v_source_id, v_batch_id, v_date, 'interest'
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type IN ('deposit', 'withdrawal') THEN
        v_total_amount   := (v_op->>'totalAmount')::numeric;                 -- B7 fix: was 'amount'
        v_total_currency := COALESCE(v_op->>'totalCurrency', 'CHF');         -- B7 fix: was 'currency'

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date
        ) VALUES (
          v_user_id, p_portfolio_id, v_op_type, v_total_currency,
          CASE WHEN v_op_type = 'deposit' THEN v_total_amount ELSE -v_total_amount END,
          p_broker, v_source_id, v_batch_id, v_date
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSIF v_op_type IN ('currency_conversion', 'fx_conversion') THEN       -- B8 fix: parser outputs 'fx_conversion'
        v_from_currency := v_op->>'fromCurrency';
        v_to_currency   := v_op->>'toCurrency';
        v_from_amount   := (v_op->>'fromAmount')::numeric;
        v_to_amount     := (v_op->>'toAmount')::numeric;

        INSERT INTO public.cash_movements (
          user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
        ) VALUES (
          v_user_id, p_portfolio_id, 'conversion', v_from_currency, -v_from_amount,
          p_broker, v_source_id || ':from', v_batch_id, v_date, 'fx_from'
        ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted > 0 THEN
          INSERT INTO public.cash_movements (
            user_id, ref_portfolio_id, type, currency, amount, source, source_external_id, import_batch_id, date, note
          ) VALUES (
            v_user_id, p_portfolio_id, 'conversion', v_to_currency, v_to_amount,
            p_broker, v_source_id || ':to', v_batch_id, v_date, 'fx_to'
          ) ON CONFLICT (ref_portfolio_id, source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING;

          v_rows_imported := v_rows_imported + 1;
        END IF;

      ELSE
        RAISE EXCEPTION 'Unknown operation type: %. Supported: buy, sell, dividend, dividend_tax_exempted, dividend_adjustment, interest, deposit, withdrawal, currency_conversion, fx_conversion, stock_split', v_op_type;
      END IF;
    END LOOP;

    FOR v_asset_id IN
      SELECT DISTINCT asset_id FROM public.transactions WHERE portfolio_id = p_portfolio_id AND asset_id IS NOT NULL
    LOOP
      PERFORM public.recalculate_asset_position(v_asset_id, p_portfolio_id);
    END LOOP;

    WITH user_cash_by_currency AS (
      SELECT currency, SUM(amount) as total_amount
      FROM public.cash_movements
      WHERE user_id = v_user_id
      GROUP BY currency
    )
    INSERT INTO public.global_cash (user_id, chf, usd, eur)
    VALUES (
      v_user_id,
      COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'CHF'), 0),
      COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'USD'), 0),
      COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'EUR'), 0)
    )
    ON CONFLICT (user_id) DO UPDATE SET
      chf = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'CHF'), 0),
      usd = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'USD'), 0),
      eur = COALESCE((SELECT total_amount FROM user_cash_by_currency WHERE currency = 'EUR'), 0),
      updated_at = now();

    UPDATE public.import_batches SET
      status = 'success',
      rows_imported = v_rows_imported,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, true, v_rows_imported, v_rows_total, NULL::text;

  EXCEPTION WHEN OTHERS THEN
    -- Point 7: BEGIN...EXCEPTION creates an implicit SAVEPOINT at the top of the BEGIN block.
    -- On exception PostgreSQL automatically ROLLBACK TO that savepoint, undoing all DML.
    -- The DELETE statements below are defensive safety nets (normally no-ops after rollback).
    DELETE FROM public.transactions WHERE import_batch_id = v_batch_id;
    DELETE FROM public.cash_movements WHERE import_batch_id = v_batch_id;
    DELETE FROM public.stock_split_events WHERE import_batch_id = v_batch_id;

    UPDATE public.import_batches SET
      status = 'failed',
      error_summary = SQLERRM,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, false, 0, v_rows_total, format('Import failed: %s', SQLERRM)::text;
  END;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM public;

-- ═════════════════════════════════════════════════════════════════════════════════
-- SECTION 5: VERIFICATION
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
  -- Spot-check known mappings
  IF public.t212_resolve_quote_symbol('WSML') IS DISTINCT FROM 'WSML.L' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(WSML) expected WSML.L, got %', public.t212_resolve_quote_symbol('WSML');
  END IF;
  IF public.t212_resolve_quote_symbol('SMH') IS DISTINCT FROM 'SMH.L' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(SMH) expected SMH.L, got %', public.t212_resolve_quote_symbol('SMH');
  END IF;
  IF public.t212_resolve_quote_symbol('UBS') IS DISTINCT FROM 'UBSG.SW' THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(UBS) expected UBSG.SW, got %', public.t212_resolve_quote_symbol('UBS');
  END IF;
  IF public.t212_resolve_quote_symbol('AAPL') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: t212_resolve_quote_symbol(AAPL) expected NULL (no mapping), got %', public.t212_resolve_quote_symbol('AAPL');
  END IF;
  RAISE NOTICE '✓ Migration 000003 verified: columns, function, and spot-checks all passed';
END $$;
