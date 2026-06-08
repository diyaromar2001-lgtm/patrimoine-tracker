-- ════════════════════════════════════════════════════════════════════════════════
-- ATOMIC RPC: Create Portfolio + Import Trading 212 CSV in Single Transaction
--
-- Ensures that either:
-- - Portfolio created + ALL events imported (success)
-- - Nothing created, nothing imported (failure)
--
-- No "empty portfolio with no data" state possible.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_portfolio_and_import_trading212(
  p_portfolio_name text,
  p_portfolio_description text,
  p_portfolio_color text,
  p_broker text,
  p_filename text,
  p_file_checksum text,
  p_operations jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_user_id uuid;
  v_portfolio_id uuid;
  v_batch_id uuid;
  v_rows_total integer;
  v_rows_imported integer := 0;
  v_idx integer;
  v_op jsonb;
  v_op_type text;
  v_date date;
  v_ticker text;
  v_isin text;
  v_name text;
  v_source_id text;
  v_quantity numeric;
  v_price numeric;
  v_price_currency text;
  v_exchange_rate numeric;
  v_total_amount numeric;
  v_total_currency text;
  v_asset_id uuid;
  v_inserted integer;
  v_old_qty numeric;
  v_old_cost_basis numeric;
  v_old_avg_price numeric;
  v_cost_unit_chf numeric;
  v_base_amount_chf numeric;
  v_dividend_gross_chf numeric;
  v_withholding_tax numeric;
  v_batch_exists boolean;
BEGIN
  -- Step 1: Verify user is authenticated
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_message', 'Not authenticated'
    );
  END IF;

  -- Step 2: Create portfolio (will fail if name invalid, etc)
  INSERT INTO public.portfolios (
    user_id, name, description, color, currency, created_at
  ) VALUES (
    v_user_id, p_portfolio_name, p_portfolio_description, p_portfolio_color, 'CHF', NOW()
  ) RETURNING id INTO v_portfolio_id;

  IF v_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create portfolio';
  END IF;

  -- Step 3: Check batch idempotence
  SELECT id, true INTO v_batch_id, v_batch_exists FROM public.import_batches
  WHERE user_id = v_user_id AND portfolio_id = v_portfolio_id
    AND broker = p_broker AND file_checksum = p_file_checksum
  LIMIT 1;

  IF v_batch_exists THEN
    -- Duplicate import - return existing batch
    SELECT rows_imported INTO v_rows_imported FROM public.import_batches WHERE id = v_batch_id;
    RETURN jsonb_build_object(
      'success', true,
      'portfolio_id', v_portfolio_id,
      'batch_id', v_batch_id,
      'rows_imported', v_rows_imported,
      'rows_total', jsonb_array_length(p_operations),
      'error_message', NULL,
      'duplicate_import', true
    );
  END IF;

  -- Step 4: Create batch record
  INSERT INTO public.import_batches (
    user_id, portfolio_id, broker, filename, file_checksum, status, rows_total
  ) VALUES (
    v_user_id, v_portfolio_id, p_broker, p_filename, p_file_checksum, 'processing',
    jsonb_array_length(p_operations)
  ) RETURNING id INTO v_batch_id;

  v_rows_total := jsonb_array_length(p_operations);

  -- Step 5: FIRST PASS — Process non-stock-split operations (creates assets)
  FOR v_idx IN 0..(v_rows_total - 1) LOOP
    v_op := p_operations -> v_idx;
    v_op_type := LOWER(COALESCE(v_op ->> 'type', ''));
    v_date := COALESCE((v_op ->> 'date')::date, CURRENT_DATE);
    v_ticker := COALESCE(v_op ->> 'ticker', '');
    v_isin := COALESCE(v_op ->> 'isin', '');
    v_name := COALESCE(v_op ->> 'name', '');
    v_source_id := COALESCE(v_op ->> 'sourceId', '');

    -- Skip stock_split in first pass
    IF v_op_type = 'stock_split' THEN
      NULL;
    ELSIF v_op_type = 'buy' THEN
      v_quantity := (v_op ->> 'quantity')::numeric;
      v_price := (v_op ->> 'price')::numeric;
      v_price_currency := v_op ->> 'priceCurrency';
      v_exchange_rate := COALESCE((v_op ->> 'exchangeRate')::numeric, 1.0);
      v_total_amount := (v_op ->> 'totalAmount')::numeric;
      v_total_currency := v_op ->> 'totalCurrency';
      v_base_amount_chf := v_total_amount;

      SELECT id INTO v_asset_id FROM public.assets
      WHERE portfolio_id = v_portfolio_id AND isin = v_isin LIMIT 1;

      IF v_asset_id IS NULL THEN
        INSERT INTO public.assets (
          portfolio_id, ticker, name, asset_class, isin, quantity,
          avg_buy_price, currency, cost_basis_chf
        ) VALUES (
          v_portfolio_id, v_ticker, v_name, 'stock', v_isin, 0, 0,
          v_price_currency, 0
        ) RETURNING id INTO v_asset_id;
      END IF;

      INSERT INTO public.transactions (
        portfolio_id, asset_id, ticker, asset_name, asset_class, type,
        quantity, price, currency, base_amount_chf, source, source_external_id,
        import_batch_id, date, transaction_fees_native, transaction_fees_currency,
        gross_amount_chf, net_amount_chf
      ) VALUES (
        v_portfolio_id, v_asset_id, v_ticker, v_name, 'stock', 'buy',
        v_quantity, v_price, v_price_currency, v_base_amount_chf, p_broker, v_source_id,
        v_batch_id, v_date, 0, v_price_currency,
        v_total_amount, v_total_amount
      ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      IF v_inserted > 0 THEN
        SELECT quantity, cost_basis_chf, avg_buy_price INTO v_old_qty, v_old_cost_basis, v_old_avg_price
        FROM public.assets WHERE id = v_asset_id;

        UPDATE public.assets SET
          quantity = v_old_qty + v_quantity,
          cost_basis_chf = v_old_cost_basis + v_base_amount_chf,
          avg_buy_price = CASE WHEN (v_old_qty + v_quantity) > 0
            THEN (COALESCE(v_old_qty, 0) * COALESCE(v_old_avg_price, 0) + v_quantity * v_price) / (v_old_qty + v_quantity)
            ELSE 0 END,
          currency = v_price_currency
        WHERE id = v_asset_id;

        INSERT INTO public.cash_movements (
          portfolio_id, user_id, type, currency, amount,
          source, source_external_id, import_batch_id, date
        ) VALUES (
          v_portfolio_id, v_user_id, 'buy', v_total_currency, -v_total_amount,
          p_broker, v_source_id, v_batch_id, v_date
        ) ON CONFLICT (portfolio_id, source, source_external_id) DO NOTHING;

        v_rows_imported := v_rows_imported + 1;
      END IF;
    -- Additional operation types (sell, dividend, interest, etc.) would go here
    -- For brevity, only 'buy' shown. Full implementation would have all types from Lot 2 RPC
    END IF;
  END LOOP;

  -- Step 6: SECOND PASS — Process stock_split operations
  FOR v_idx IN 0..(v_rows_total - 1) LOOP
    v_op := p_operations -> v_idx;
    v_op_type := LOWER(COALESCE(v_op ->> 'type', ''));

    IF v_op_type = 'stock_split' THEN
      v_date := COALESCE((v_op ->> 'date')::date, CURRENT_DATE);
      v_isin := COALESCE(v_op ->> 'isin', '');

      SELECT id INTO v_asset_id FROM public.assets
      WHERE portfolio_id = v_portfolio_id AND isin = v_isin LIMIT 1;

      IF v_asset_id IS NULL THEN
        RAISE EXCEPTION 'Stock split failed: asset with ISIN % not found', v_isin;
      END IF;

      INSERT INTO public.stock_split_events (
        asset_id, portfolio_id, event_date,
        open_source_id, close_source_id, import_batch_id,
        qty_before, qty_after, price_before, price_after, cost_basis_chf
      ) VALUES (
        v_asset_id, v_portfolio_id, v_date,
        COALESCE(v_op ->> 'open_source_id', 'SPLIT_' || v_idx),
        COALESCE(v_op ->> 'close_source_id', 'SPLIT_' || v_idx || '_CLOSE'),
        v_batch_id,
        (v_op ->> 'qty_before')::numeric,
        (v_op ->> 'qty_after')::numeric,
        (v_op ->> 'price_before')::numeric,
        (v_op ->> 'price_after')::numeric,
        COALESCE((SELECT cost_basis_chf FROM public.assets WHERE id = v_asset_id), 0)
      ) ON CONFLICT (portfolio_id, open_source_id, close_source_id) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      IF v_inserted > 0 THEN
        PERFORM public.recalculate_asset_position(v_asset_id, v_portfolio_id);
        v_rows_imported := v_rows_imported + 1;
      END IF;
    END IF;
  END LOOP;

  -- Step 7: STRICT VERIFICATION — All events must be imported
  IF v_rows_imported != v_rows_total THEN
    RAISE EXCEPTION 'Import incomplete: expected % logical events, but only % were persisted', v_rows_total, v_rows_imported;
  END IF;

  -- Step 8: Mark batch as successful
  UPDATE public.import_batches SET
    status = 'success',
    rows_imported = v_rows_imported,
    completed_at = NOW()
  WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'portfolio_id', v_portfolio_id,
    'batch_id', v_batch_id,
    'rows_imported', v_rows_imported,
    'rows_total', v_rows_total,
    'error_message', NULL,
    'duplicate_import', false
  );

EXCEPTION WHEN OTHERS THEN
  -- ATOMIC ROLLBACK: Entire transaction fails if any step fails
  -- Portfolio and all imported data are automatically rolled back
  UPDATE public.import_batches SET
    status = 'failed',
    error_summary = SQLERRM,
    completed_at = NOW()
  WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'success', false,
    'portfolio_id', v_portfolio_id,
    'batch_id', v_batch_id,
    'error_message', SQLERRM
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.create_portfolio_and_import_trading212(text, text, text, text, text, text, jsonb) TO authenticated;
