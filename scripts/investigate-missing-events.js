#!/usr/bin/env node

/**
 * INVESTIGATION: Which 2 events are missing?
 * Compare parsed events to persisted operations
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const os = require('os');
const { parseTrading212CSV } = require('../lib/parsers/trading212-parser');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const csvPath = path.join(os.homedir(), 'Downloads', 'from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv');

async function investigate() {
  console.log('═════════════════════════════════════════════════════════════════\n');
  console.log('INVESTIGATION: MISSING 2 EVENTS (478/480)\n');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Step 1: Parse CSV and collect all source_external_ids
  console.log('STEP 1: PARSE CSV\n');
  const parseResult = parseTrading212CSV(csvPath);
  const parsedEvents = parseResult.operations;

  const expectedSourceIds = new Map();
  parsedEvents.forEach((op, idx) => {
    const sourceId = op.sourceId || `AUTO_${idx}`;
    expectedSourceIds.set(sourceId, {
      index: idx,
      type: op.type,
      rawAction: op.rawAction,
      ticker: op.ticker,
      isin: op.isin,
      date: op.date,
      quantity: op.quantity,
      totalAmount: op.totalAmount,
      totalCurrency: op.totalCurrency,
      lineNumbers: op.lineNumbers || [idx + 1], // CSV line number (1-indexed)
    });
  });

  console.log(`Parsed events: ${parsedEvents.length}`);
  console.log(`Expected source_external_ids: ${expectedSourceIds.size}\n`);

  // Step 2: Connect to database and fetch all persisted operations
  console.log('STEP 2: FETCH PERSISTED OPERATIONS FROM DATABASE\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Get the portfolio ID from previous test (or create dummy connection)
  const { data: portfolios } = await supabase.from('portfolios').select('id').limit(1);

  if (!portfolios || portfolios.length === 0) {
    console.log('No portfolio found. Run import test first.\n');
    process.exit(1);
  }

  const portfolioId = portfolios[0].id;
  console.log(`Using portfolio: ${portfolioId}\n`);

  // Fetch all persisted source_external_ids
  const { data: transactions } = await supabase
    .from('transactions')
    .select('source_external_id, type, ticker, asset_id, created_at')
    .eq('source', 'trading_212');

  const { data: cashMovements } = await supabase
    .from('cash_movements')
    .select('source_external_id, type, created_at')
    .eq('source', 'trading_212');

  const { data: splits } = await supabase
    .from('stock_split_events')
    .select('open_source_id, close_source_id, created_at');

  const persistedSourceIds = new Set();

  console.log(`Transactions persisted: ${transactions?.length || 0}`);
  (transactions || []).forEach(t => {
    if (t.source_external_id) persistedSourceIds.add(t.source_external_id);
  });

  console.log(`Cash movements persisted: ${cashMovements?.length || 0}`);
  (cashMovements || []).forEach(cm => {
    if (cm.source_external_id) persistedSourceIds.add(cm.source_external_id);
  });

  console.log(`Stock split events persisted: ${splits?.length || 0}`);
  (splits || []).forEach(s => {
    if (s.open_source_id) persistedSourceIds.add(s.open_source_id);
    if (s.close_source_id) persistedSourceIds.add(s.close_source_id);
  });

  console.log(`Total persisted source_external_ids: ${persistedSourceIds.size}\n`);

  // Step 3: Compare
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('STEP 3: COMPARISON & ANALYSIS\n');

  const missing = [];
  expectedSourceIds.forEach((op, sourceId) => {
    if (!persistedSourceIds.has(sourceId)) {
      missing.push({ sourceId, ...op });
    }
  });

  console.log(`Missing events: ${missing.length}\n`);

  if (missing.length > 0) {
    console.log('EXPECTED EVENT BUT NOT PERSISTED:\n');
    missing.forEach((event, idx) => {
      console.log(`${idx + 1}. EVENT #${event.index + 1}`);
      console.log(`   source_external_id: ${event.sourceId}`);
      console.log(`   CSV line(s): ${event.lineNumbers.join(', ')}`);
      console.log(`   original Action: ${event.rawAction}`);
      console.log(`   normalized type: ${event.type}`);
      console.log(`   ticker: ${event.ticker || '(none)'}`);
      console.log(`   ISIN: ${event.isin || '(none)'}`);
      console.log(`   date: ${event.date}`);
      console.log(`   amount: ${event.totalAmount} ${event.totalCurrency}`);
      console.log(`   reason: UNKNOWN — requires RPC debugging\n`);
    });
  } else {
    console.log('✅ ALL EXPECTED EVENTS WERE PERSISTED!\n');
  }

  console.log('═════════════════════════════════════════════════════════════════\n');
  process.exit(missing.length > 0 ? 1 : 0);
}

investigate().catch(e => {
  console.error('Investigation error:', e.message);
  process.exit(1);
});
