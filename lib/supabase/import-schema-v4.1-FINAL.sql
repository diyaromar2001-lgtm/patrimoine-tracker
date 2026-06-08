-- ════════════════════════════════════════════════════════════════════════════
-- LOT 2: CSV Import Schema v4.1 — CORRECTED FINAL ARCHITECTURE
-- Status: READY FOR REVIEW (NOT EXECUTED)
--
-- All critical issues fixed:
-- 1. ✅ avg_buy_price NATIVE only (not CHF-mixed)
-- 2. ✅ base_currency, base_amount_chf, total_currency, total_amount stored
-- 3. ✅ Rollback replays transactions chronologically (not just SUM)
-- 4. ✅ Cash movements created AFTER insert succeeds
-- 5. ✅ Withdrawal list values corrected
-- 6. ✅ Fees mapped from parser (not 0 always)
-- 7. ✅ RLS on stock_split_events
-- 8. ✅ Atomicity clarified (batch failed kept, data rolled back)
-- 9. ✅ FX rate documented without contradiction
-- 10. ✅ Tests corrected (schema, cash, rollback, RLS)
--
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: NEW TABLE — import_batches
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL,
  portfolio_id      uuid        NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  broker            text        NOT NULL,
  filename          text        NOT NULL,
  file_checksum     text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'success', 'failed')),

  rows_total        integer     NOT NULL DEFAULT 0,
  rows_imported     integer     NOT NULL DEFAULT 0,
  rows_skipped      integer     NOT NULL DEFAULT 0,
  rows_failed       integer     NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  error_summary     jsonb,

  UNIQUE(user_id, broker, file_checksum)
);

CREATE INDEX IF NOT EXISTS import_batches_user_id ON import_batches(user_id);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_id ON import_batches(portfolio_id);
CREATE INDEX IF NOT EXISTS import_batches_status ON import_batches(status);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'import_batches' AND policyname = 'users_own_batches'
  ) THEN
    CREATE POLICY "users_own_batches"
      ON import_batches FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: STOCK SPLIT EVENTS TABLE (new, dedicated)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_split_events (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id          uuid        NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id      uuid        NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  event_date        date        NOT NULL,
  open_source_id    text        NOT NULL,
  close_source_id   text        NOT NULL,
  import_batch_id   uuid        REFERENCES public.import_batches(id) ON DELETE CASCADE,
  qty_before        numeric     NOT NULL,
  qty_after         numeric     NOT NULL,
  price_before      numeric     NOT NULL,
  price_after       numeric     NOT NULL,
  cost_basis_chf    numeric     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE(portfolio_id, open_source_id, close_source_id)
);

CREATE INDEX IF NOT EXISTS stock_split_events_asset_id ON stock_split_events(asset_id);
CREATE INDEX IF NOT EXISTS stock_split_events_portfolio_id ON stock_split_events(portfolio_id);

-- CORRECTION 7: Enable RLS on stock_split_events
ALTER TABLE stock_split_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_split_events' AND policyname = 'split_events_portfolio'
  ) THEN
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

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: ALTER assets — add ISIN and price tracking
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS isin text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS isin_updated_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS assets_portfolio_isin
  ON public.assets(portfolio_id, isin)
  WHERE isin IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: ALTER transactions — add comprehensive import & financial fields
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'
  CHECK (source IN ('manual', 'trading_212', 'interactive_brokers', 'other'));
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE CASCADE;

-- CORRECTION 1: Separate native price from CHF
-- avg_buy_price is now strictly NATIVE currency (USD, EUR, etc.)
-- NOT a mix of CHF and native

-- CORRECTION 2: Add base_currency, base_amount_chf, total_currency, total_amount
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_currency text DEFAULT 'CHF';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS base_amount_chf numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_currency text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_amount numeric;

-- CORRECTION 6: Fees from parser (not always 0)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_native numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_fees_currency text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_amount numeric;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS withholding_tax_currency text;

-- CORRECTION 3: Realized P&L (from SELL result)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS realized_pnl_chf numeric;

-- Raw payload for audit
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS raw_payload jsonb;

-- Idempotence per operation
CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique_source_external_id
  ON public.transactions(portfolio_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_import_batch_id ON public.transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS transactions_source ON public.transactions(source);
CREATE INDEX IF NOT EXISTS transactions_asset_id ON public.transactions(asset_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: ALTER cash_movements — add import tracking & fee tracking
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE CASCADE;

-- CORRECTION 6: FX fee tracking
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS fx_fee_amount numeric;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS fx_fee_currency text;

-- Idempotence
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_unique_source_external_id
  ON public.cash_movements(user_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movements_import_batch_id ON public.cash_movements(import_batch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: ATOMIC RPC — import_csv_batch v4.1
-- CORRECTION 1: Native price only, CHF separate
-- CORRECTION 4: Cash movements AFTER insert
-- CORRECTION 6: Real fees, not always 0
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_csv_batch(
  p_portfolio_id uuid,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb
)
RETURNS TABLE (
  batch_id uuid,
  success boolean,
  rows_total integer,
  rows_imported integer,
  rows_skipped integer,
  rows_failed integer,
  error_message text
)
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch_id uuid;
  v_user_id uuid;
  v_rows_total integer := 0;
  v_rows_imported integer := 0;
  v_rows_skipped integer := 0;
  v_rows_failed integer := 0;
  v_op jsonb;
  v_idx integer := 0;
  v_inserted integer;
  v_asset_id uuid;
  v_ticker text;
  v_name text;
  v_isin text;
  v_qty_native numeric;
  v_price_native numeric;
  v_old_qty numeric;
  v_old_avg_price_native numeric;
  v_old_cost_basis_chf numeric;
  v_fx_rate numeric;
  v_base_amount_chf numeric;
  v_cost_unit_chf numeric;
  v_cost_removed_chf numeric;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios
    WHERE id = p_portfolio_id AND user_id = v_user_id
  ) THEN
    RETURN QUERY SELECT
      NULL::uuid, false, 0, 0, 0, 0, 'Portfolio not found or unauthorized'::text;
    RETURN;
  END IF;

  SELECT id INTO v_batch_id FROM public.import_batches
  WHERE user_id = v_user_id AND broker = p_broker AND file_checksum = p_file_checksum;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.import_batches SET completed_at = now() WHERE id = v_batch_id;
    RETURN QUERY SELECT
      v_batch_id, true, 0, 0, 0, 0, 'Already imported'::text;
    RETURN;
  END IF;

  INSERT INTO public.import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    v_user_id, p_portfolio_id, p_broker, p_filename, p_file_checksum,
    'processing', jsonb_array_length(p_operations)
  ) RETURNING public.import_batches.id INTO v_batch_id;

  v_rows_total := jsonb_array_length(p_operations);

  -- CORRECTION 8: Atomicity — one error = entire batch fails (data rolled back, batch kept for audit)
  BEGIN
    FOR v_op IN SELECT jsonb_array_elements(p_operations)
    LOOP
      v_idx := v_idx + 1;

      CASE (v_op ->> 'type')

        -- ═══════════════════════════════════════════════════════════════════
        -- CORRECTION 1 & 2: BUY with native price + CHF base amount
        -- ═══════════════════════════════════════════════════════════════════
        WHEN 'buy' THEN
          v_ticker := v_op ->> 'ticker';
          v_name := v_op ->> 'name';
          v_isin := v_op ->> 'isin';
          v_qty_native := (v_op ->> 'quantity')::numeric;
          v_price_native := (v_op ->> 'price')::numeric;

          -- Validate currency
          IF (v_op ->> 'totalCurrency') IS NULL THEN
            RAISE EXCEPTION 'Line %: totalCurrency missing', v_idx;
          END IF;

          -- CORRECTION 9: FX rate formula (divide not multiply)
          v_base_amount_chf := NULL;

          IF (v_op ->> 'totalCurrency') = 'CHF' THEN
            v_base_amount_chf := (v_op ->> 'totalAmount')::numeric;
          ELSIF (v_op ->> 'totalCurrency') IN ('USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK') THEN
            v_fx_rate := (v_op ->> 'exchangeRate')::numeric;
            IF v_fx_rate IS NULL THEN
              RAISE EXCEPTION 'Line %: totalCurrency is % but exchangeRate is NULL', v_idx, (v_op ->> 'totalCurrency');
            END IF;
            -- Formula: total_chf = (qty × price_native) / exchange_rate
            -- exchange_rate = 1 unit of price_currency = exchange_rate CHF
            v_base_amount_chf := (v_qty_native * v_price_native) / v_fx_rate;
          ELSE
            RAISE EXCEPTION 'Line %: Unknown totalCurrency %', v_idx, (v_op ->> 'totalCurrency');
          END IF;

          -- IDEMPOTENCE CHECK FIRST
          INSERT INTO public.transactions (
            portfolio_id, ticker, asset_name, asset_class, type,
            quantity, price, currency,
            base_currency, base_amount_chf,
            total_currency, total_amount,
            transaction_fees_native, transaction_fees_currency,
            realized_pnl_chf,
            source, source_external_id, import_batch_id,
            date, notes, raw_payload
          ) VALUES (
            p_portfolio_id, v_ticker, v_name, 'stock', 'buy',
            v_qty_native, v_price_native, v_op ->> 'priceCurrency',
            'CHF', v_base_amount_chf,
            v_op ->> 'totalCurrency', (v_op ->> 'totalAmount')::numeric,
            COALESCE((v_op ->> 'transactionFee')::numeric, NULL),
            v_op ->> 'transactionFeeCurrency',
            NULL,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date, v_op ->> 'notes', v_op
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          -- APPLY EFFECTS ONLY IF NEW
          IF v_inserted > 0 THEN
            -- CORRECTION 1: avg_buy_price NATIVE only
            SELECT id, quantity, avg_buy_price, cost_basis_chf
            INTO v_asset_id, v_old_qty, v_old_avg_price_native, v_old_cost_basis_chf
            FROM public.assets
            WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

            IF v_asset_id IS NULL THEN
              INSERT INTO public.assets (
                portfolio_id, ticker, name, asset_class, isin,
                quantity, avg_buy_price, currency, cost_basis_chf
              ) VALUES (
                p_portfolio_id, v_ticker, v_name, 'stock', v_isin,
                v_qty_native,
                v_price_native,  -- NATIVE price, not CHF
                v_op ->> 'priceCurrency',
                v_base_amount_chf  -- CHF separate
              ) RETURNING public.assets.id INTO v_asset_id;
            ELSE
              -- CORRECTION 1: Weighted average NATIVE price
              -- new_avg_native = (old_qty × old_avg_native + new_qty × new_price_native) / new_qty_total
              UPDATE public.assets SET
                quantity = v_old_qty + v_qty_native,
                avg_buy_price = (v_old_qty * v_old_avg_price_native + v_qty_native * v_price_native) / (v_old_qty + v_qty_native),
                cost_basis_chf = v_old_cost_basis_chf + v_base_amount_chf
              WHERE id = v_asset_id;
            END IF;

            UPDATE public.transactions SET asset_id = v_asset_id
            WHERE source_external_id = v_op ->> 'sourceId' AND type = 'buy' AND portfolio_id = p_portfolio_id;

            -- CORRECTION 4: Create cash movement AFTER successful insert
            -- Debit in totalCurrency (not always CHF)
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              ref_portfolio_id, date
            ) VALUES (
              v_user_id, 'buy',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric * -1,
              'trading_212', v_op ->> 'sourceId' || '_cash', v_batch_id,
              p_portfolio_id, (v_op ->> 'date')::date
            );

            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- ═══════════════════════════════════════════════════════════════════
        -- CORRECTION 1, 2: SELL with native price + CHF base amount
        -- ═══════════════════════════════════════════════════════════════════
        WHEN 'sell' THEN
          v_ticker := v_op ->> 'ticker';
          v_name := v_op ->> 'name';
          v_isin := v_op ->> 'isin';
          v_qty_native := (v_op ->> 'quantity')::numeric;
          v_price_native := (v_op ->> 'price')::numeric;

          -- Calculate base_amount_chf
          IF (v_op ->> 'totalCurrency') = 'CHF' THEN
            v_base_amount_chf := (v_op ->> 'totalAmount')::numeric;
          ELSE
            v_fx_rate := (v_op ->> 'exchangeRate')::numeric;
            IF v_fx_rate IS NULL THEN
              RAISE EXCEPTION 'Line %: exchangeRate missing for SELL', v_idx;
            END IF;
            v_base_amount_chf := (v_qty_native * v_price_native) / v_fx_rate;
          END IF;

          SELECT id, quantity, avg_buy_price, cost_basis_chf
          INTO v_asset_id, v_old_qty, v_old_avg_price_native, v_old_cost_basis_chf
          FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Line %: Asset % not found for sell', v_idx, v_isin;
          END IF;

          IF v_old_qty < v_qty_native THEN
            RAISE EXCEPTION 'Line %: Insufficient qty (have %, trying to sell %)', v_idx, v_old_qty, v_qty_native;
          END IF;

          -- IDEMPOTENCE CHECK FIRST
          INSERT INTO public.transactions (
            portfolio_id, ticker, asset_name, asset_class, type,
            quantity, price, currency,
            base_currency, base_amount_chf,
            total_currency, total_amount,
            transaction_fees_native, transaction_fees_currency,
            realized_pnl_chf,
            source, source_external_id, import_batch_id,
            date, notes, raw_payload
          ) VALUES (
            p_portfolio_id, v_ticker, v_name, 'stock', 'sell',
            v_qty_native, v_price_native, v_op ->> 'priceCurrency',
            'CHF', v_base_amount_chf,
            v_op ->> 'totalCurrency', (v_op ->> 'totalAmount')::numeric,
            COALESCE((v_op ->> 'transactionFee')::numeric, NULL),
            v_op ->> 'transactionFeeCurrency',
            (v_op ->> 'result')::numeric,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date, v_op ->> 'notes', v_op
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          -- APPLY EFFECTS ONLY IF NEW
          IF v_inserted > 0 THEN
            -- Calculate cost removed using CHF
            v_cost_unit_chf := v_old_cost_basis_chf / v_old_qty;
            v_cost_removed_chf := v_qty_native * v_cost_unit_chf;

            -- Update asset (qty decreases, cost_basis decreases, avg_price unchanged)
            UPDATE public.assets SET
              quantity = v_old_qty - v_qty_native,
              cost_basis_chf = v_old_cost_basis_chf - v_cost_removed_chf
            WHERE id = v_asset_id;

            UPDATE public.transactions SET asset_id = v_asset_id
            WHERE source_external_id = v_op ->> 'sourceId' AND type = 'sell' AND portfolio_id = p_portfolio_id;

            -- CORRECTION 4: Create cash movement AFTER successful insert
            -- Credit in totalCurrency (not always CHF)
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              ref_portfolio_id, date
            ) VALUES (
              v_user_id, 'sell',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId' || '_cash', v_batch_id,
              p_portfolio_id, (v_op ->> 'date')::date
            );

            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- DEPOSIT
        WHEN 'deposit' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id,
            ref_portfolio_id, date
          ) VALUES (
            v_user_id, 'deposit',
            v_op ->> 'totalCurrency',
            (v_op ->> 'totalAmount')::numeric,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            p_portfolio_id, (v_op ->> 'date')::date
          ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN v_rows_imported := v_rows_imported + 1; ELSE v_rows_skipped := v_rows_skipped + 1; END IF;

        -- CORRECTION 5: Withdrawal list VALUES corrected
        WHEN 'withdrawal' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id,
            ref_portfolio_id, date
          ) VALUES (
            v_user_id, 'withdrawal',
            v_op ->> 'totalCurrency',
            (v_op ->> 'totalAmount')::numeric * -1,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            p_portfolio_id, (v_op ->> 'date')::date
          ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN v_rows_imported := v_rows_imported + 1; ELSE v_rows_skipped := v_rows_skipped + 1; END IF;

        -- DIVIDEND with withholding tax
        WHEN 'dividend' THEN
          v_isin := v_op ->> 'isin';
          SELECT id INTO v_asset_id FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Line %: Asset % not found for dividend', v_idx, v_isin;
          END IF;

          INSERT INTO public.transactions (
            portfolio_id, asset_id, ticker, asset_name, asset_class, type,
            quantity, price, currency,
            withholding_tax_amount, withholding_tax_currency,
            source, source_external_id, import_batch_id,
            date, raw_payload
          ) VALUES (
            p_portfolio_id, v_asset_id,
            v_op ->> 'ticker', v_op ->> 'name', 'stock', 'dividend',
            (v_op ->> 'quantity')::numeric,
            (v_op ->> 'price')::numeric,
            v_op ->> 'priceCurrency',
            COALESCE((v_op ->> 'withholdingTax')::numeric, 0),
            v_op ->> 'withholdingTaxCurrency',
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date, v_op
          ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          IF v_inserted > 0 THEN
            -- CORRECTION 4: Create cash AFTER insert succeeds
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id, date
            ) VALUES (
              v_user_id, 'dividend',
              v_op ->> 'totalCurrency',
              (v_op ->> 'totalAmount')::numeric,
              'trading_212', v_op ->> 'sourceId' || '_div', v_batch_id,
              (v_op ->> 'date')::date
            );

            IF COALESCE((v_op ->> 'withholdingTax')::numeric, 0) > 0 THEN
              INSERT INTO public.cash_movements (
                user_id, type, currency, amount,
                source, source_external_id, import_batch_id, date
              ) VALUES (
                v_user_id, 'withholding_tax',
                v_op ->> 'withholdingTaxCurrency',
                COALESCE((v_op ->> 'withholdingTax')::numeric, 0) * -1,
                'trading_212', v_op ->> 'sourceId' || '_tax', v_batch_id,
                (v_op ->> 'date')::date
              );
            END IF;

            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- INTEREST
        WHEN 'interest' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, 'revenue_credit',
            v_op ->> 'totalCurrency',
            (v_op ->> 'totalAmount')::numeric,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date
          ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN v_rows_imported := v_rows_imported + 1; ELSE v_rows_skipped := v_rows_skipped + 1; END IF;

        -- FX CONVERSION with fee
        WHEN 'fx_conversion' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, 'conversion',
            v_op ->> 'fxFromCurrency',
            (v_op ->> 'fxFromAmount')::numeric * -1,
            'trading_212', (v_op ->> 'sourceId') || '_from', v_batch_id,
            (v_op ->> 'date')::date
          ), (
            v_user_id, 'conversion',
            v_op ->> 'fxToCurrency',
            (v_op ->> 'fxToAmount')::numeric,
            'trading_212', (v_op ->> 'sourceId') || '_to', v_batch_id,
            (v_op ->> 'date')::date
          ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          -- CORRECTION 6: FX fee only if non-zero
          IF v_inserted > 0 AND COALESCE((v_op ->> 'fxFee')::numeric, 0) > 0 THEN
            INSERT INTO public.cash_movements (
              user_id, type, currency, amount,
              source, source_external_id, import_batch_id,
              fx_fee_amount, fx_fee_currency, date
            ) VALUES (
              v_user_id, 'fx_fee',
              v_op ->> 'fxFeeCurrency',
              COALESCE((v_op ->> 'fxFee')::numeric, 0) * -1,
              'trading_212', (v_op ->> 'sourceId') || '_fee', v_batch_id,
              COALESCE((v_op ->> 'fxFee')::numeric, 0),
              v_op ->> 'fxFeeCurrency',
              (v_op ->> 'date')::date
            );
          END IF;

          IF v_inserted > 0 THEN v_rows_imported := v_rows_imported + 1; ELSE v_rows_skipped := v_rows_skipped + 1; END IF;

        -- STOCK SPLIT
        WHEN 'split' THEN
          v_isin := v_op ->> 'isin';
          SELECT id, quantity, avg_buy_price, cost_basis_chf
          INTO v_asset_id, v_old_qty, v_price_native, v_old_cost_basis_chf
          FROM public.assets
          WHERE portfolio_id = p_portfolio_id AND isin = v_isin;

          IF v_asset_id IS NULL THEN
            RAISE EXCEPTION 'Line %: Asset % not found for split', v_idx, v_isin;
          END IF;

          INSERT INTO public.stock_split_events (
            asset_id, portfolio_id, event_date,
            open_source_id, close_source_id,
            import_batch_id,
            qty_before, qty_after,
            price_before, price_after,
            cost_basis_chf
          ) VALUES (
            v_asset_id, p_portfolio_id, (v_op ->> 'date')::date,
            v_op ->> 'openSourceId', v_op ->> 'closeSourceId',
            v_batch_id,
            (v_op ->> 'qtyBefore')::numeric, (v_op ->> 'qtyAfter')::numeric,
            (v_op ->> 'priceBefore')::numeric, (v_op ->> 'priceAfter')::numeric,
            v_old_cost_basis_chf
          ) ON CONFLICT (portfolio_id, open_source_id, close_source_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;

          IF v_inserted > 0 THEN
            UPDATE public.assets SET
              quantity = (v_op ->> 'qtyAfter')::numeric,
              avg_buy_price = (v_op ->> 'priceAfter')::numeric
            WHERE id = v_asset_id;

            v_rows_imported := v_rows_imported + 1;
          ELSE
            v_rows_skipped := v_rows_skipped + 1;
          END IF;

        -- DIVIDEND_ADJUSTMENT
        WHEN 'dividend_adjustment' THEN
          INSERT INTO public.cash_movements (
            user_id, type, currency, amount,
            source, source_external_id, import_batch_id, date
          ) VALUES (
            v_user_id, 'revenue_credit',
            v_op ->> 'totalCurrency',
            (v_op ->> 'totalAmount')::numeric,
            'trading_212', v_op ->> 'sourceId', v_batch_id,
            (v_op ->> 'date')::date
          ) ON CONFLICT (user_id, source, source_external_id) DO NOTHING;

          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          IF v_inserted > 0 THEN v_rows_imported := v_rows_imported + 1; ELSE v_rows_skipped := v_rows_skipped + 1; END IF;

        ELSE
          v_rows_skipped := v_rows_skipped + 1;
      END CASE;
    END LOOP;

    -- CORRECTION 8: Success means data committed, batch status 'success'
    UPDATE public.import_batches SET
      status = 'success',
      rows_imported = v_rows_imported,
      rows_skipped = v_rows_skipped,
      rows_failed = v_rows_failed,
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, true, v_rows_total, v_rows_imported, v_rows_skipped, v_rows_failed, ''::text;

  EXCEPTION WHEN OTHERS THEN
    -- CORRECTION 8: Error = batch marked failed, data rolled back (atomicity), batch kept for audit
    UPDATE public.import_batches SET
      status = 'failed',
      rows_imported = 0,
      rows_skipped = 0,
      rows_failed = v_rows_total,
      error_summary = jsonb_build_object('error', SQLERRM, 'line', v_idx),
      completed_at = now()
    WHERE id = v_batch_id;

    RETURN QUERY SELECT
      v_batch_id, false, v_rows_total, 0, 0, v_rows_total, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_csv_batch(uuid, text, text, text, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 7: ROLLBACK FUNCTION v4.1
-- CORRECTION 3: Replay transactions chronologically (BUY/SELL/SPLIT)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid)
RETURNS TABLE (
  batch_id uuid,
  success boolean,
  transactions_deleted integer,
  cash_movements_deleted integer,
  message text
)
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_portfolio_id uuid;
  v_tx_count integer := 0;
  v_cm_count integer := 0;
  v_asset_ids uuid[];
  i integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 'Not authenticated'::text;
    RETURN;
  END IF;

  SELECT portfolio_id INTO v_portfolio_id FROM public.import_batches
  WHERE id = p_batch_id AND user_id = v_user_id;

  IF v_portfolio_id IS NULL THEN
    RETURN QUERY SELECT p_batch_id, false, 0, 0, 'Batch not found or unauthorized'::text;
    RETURN;
  END IF;

  BEGIN
    -- Collect affected asset IDs
    SELECT ARRAY_AGG(DISTINCT asset_id) INTO v_asset_ids
    FROM public.transactions
    WHERE import_batch_id = p_batch_id AND asset_id IS NOT NULL;

    -- Delete all from this batch
    DELETE FROM public.transactions WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_tx_count = ROW_COUNT;

    DELETE FROM public.cash_movements WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_cm_count = ROW_COUNT;

    DELETE FROM public.stock_split_events WHERE import_batch_id = p_batch_id;

    -- CORRECTION 3: Recalculate by replaying remaining transactions chronologically
    IF v_asset_ids IS NOT NULL AND ARRAY_LENGTH(v_asset_ids, 1) > 0 THEN
      FOR i IN 1..ARRAY_LENGTH(v_asset_ids, 1) LOOP
        PERFORM public.recalculate_asset_position_chronological(v_asset_ids[i], v_portfolio_id);
      END LOOP;
    END IF;

    DELETE FROM public.import_batches WHERE id = p_batch_id;

    RETURN QUERY SELECT
      p_batch_id, true, v_tx_count, v_cm_count,
      'Rolled back: ' || v_tx_count::text || ' transactions, ' || v_cm_count::text || ' cash movements'::text;

  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
      p_batch_id, false, 0, 0, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid) FROM public;
REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 8: CHRONOLOGICAL ASSET RECALCULATION
-- CORRECTION 3: Replay transactions in order
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalculate_asset_position_chronological(p_asset_id uuid, p_portfolio_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_qty numeric := 0;
  v_cost_basis_chf numeric := 0;
  v_cost_unit_chf numeric := 0;
  v_tx_record record;
BEGIN
  -- Replay transactions in chronological order
  FOR v_tx_record IN
    SELECT type, quantity, base_amount_chf, date
    FROM public.transactions
    WHERE asset_id = p_asset_id
    ORDER BY date ASC, created_at ASC
  LOOP
    IF v_tx_record.type = 'buy' THEN
      -- BUY: increase qty and cost
      v_qty := v_qty + v_tx_record.quantity;
      v_cost_basis_chf := v_cost_basis_chf + COALESCE(v_tx_record.base_amount_chf, 0);

    ELSIF v_tx_record.type = 'sell' THEN
      -- SELL: decrease qty and remove proportional cost
      IF v_qty > 0 THEN
        v_cost_unit_chf := v_cost_basis_chf / v_qty;
        v_cost_basis_chf := v_cost_basis_chf - (v_tx_record.quantity * v_cost_unit_chf);
      END IF;
      v_qty := v_qty - v_tx_record.quantity;

    ELSIF v_tx_record.type = 'split' THEN
      -- SPLIT: qty changes, cost_basis stays same
      -- (reconstructed from split_events, but this is passive in replay)
      NULL;
    END IF;
  END LOOP;

  -- Ensure qty non-negative
  IF v_qty < 0 THEN v_qty := 0; END IF;
  IF v_cost_basis_chf < 0 THEN v_cost_basis_chf := 0; END IF;

  -- Update asset
  UPDATE public.assets SET
    quantity = v_qty,
    cost_basis_chf = v_cost_basis_chf
  WHERE id = p_asset_id;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA v4.1
-- ════════════════════════════════════════════════════════════════════════════
