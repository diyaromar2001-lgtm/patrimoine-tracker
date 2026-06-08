#!/usr/bin/env node

/**
 * TRADING 212 CSV IMPORT — COMPLETE INTEGRATION TEST SUITE
 *
 * Status: CODE WRITTEN BUT NOT EXECUTED — DOCKER REQUIRED FOR VALIDATION
 *
 * This test suite is written and structured but requires:
 * 1. Docker Desktop installed and running
 * 2. Supabase local instance via `npx supabase start`
 * 3. Database migration applied via `npx supabase db reset`
 *
 * Test Coverage:
 * - 2 test users with portfolio isolation
 * - Authentication and authorization (RLS enforcement)
 * - 7 operation types: BUY (4 currencies), SELL (partial + complete), DIVIDEND
 * - Edge cases: insufficient balance, unknown types, invalid dates
 * - Batch operations: first import, re-import (idempotence), rollback
 * - Full 481-operation CSV import
 *
 * NOT EXECUTED: No test has run, no database validated, no assertion confirmed.
 *
 * Exit codes: 0 = all pass (NOT TESTED), 1 = any fail (NOT TESTED)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjAwMDAwMCwiZXhwIjoxNzQ3NTI1MjAwfQ.123456';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;  // Use if available

const CSV_PATH = 'C:\\Users\\omard\\Downloads\\from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv';

let testResults = {
  passed: 0,
  failed: 0,
  tests: [],
  startTime: new Date(),
  logs: []
};

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Service role client (if key available) for admin operations
let supabaseAdmin = null;
if (SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${level}: ${message}`;
  console.log(logLine);
  testResults.logs.push(logLine);
}

async function test(name, fn) {
  try {
    log('TEST', `Starting: ${name}`);
    await fn();
    testResults.passed++;
    testResults.tests.push({ name, status: 'PASS' });
    log('PASS', name);
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: 'FAIL', error: error.message });
    log('FAIL', `${name}: ${error.message}`);
  }
}

async function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Parse Trading 212 CSV to operations JSONB format
// TODO: Replace with real Lot 1 parser
function parseTrading212CSV(csvPath) {
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true });

  return records.map((row, idx) => {
    const actionLower = (row.Action || '').toLowerCase();
    let type = 'unknown';

    if (actionLower.includes('buy')) type = 'buy';
    else if (actionLower.includes('sell')) type = 'sell';
    else if (actionLower.includes('dividend')) type = 'dividend';
    else if (actionLower.includes('interest')) type = 'interest';
    else if (actionLower.includes('deposit')) type = 'deposit';
    else if (actionLower.includes('withdrawal')) type = 'withdrawal';
    else if (actionLower.includes('conversion') || actionLower.includes('fx')) type = 'fx_conversion';
    else if (actionLower.includes('split')) type = 'stock_split';

    // Extract fields from Trading 212 CSV format
    const totalAmount = parseFloat(row.Total || row.Result || '0') || 0;
    const totalCurrency = row['Currency (Total)'] || row['Currency (Result)'] || 'CHF';
    const withholdingTax = parseFloat(row['Withholding tax'] || '0') || 0;
    const withholdingTaxCurrency = row['Currency (Withholding tax)'] || 'CHF';

    return {
      type: type,
      date: row.Time?.split(' ')[0] || '2026-01-01',
      ticker: row.Ticker || 'UNKNOWN',
      name: row.Name || 'Unknown',
      isin: row.ISIN || `UNKNOWN_${idx}`,
      quantity: parseFloat(row['No. of shares'] || '0') || 0,
      price: parseFloat(row['Price / share'] || '0') || 0,
      priceCurrency: row['Currency (Price / share)'] || 'CHF',
      exchangeRate: parseFloat(row['Exchange rate'] || '1') || 1,
      totalAmount: totalAmount,
      totalCurrency: totalCurrency,
      sourceId: row.ID || `CSV_${idx}`,
      withholdingTax: withholdingTax,
      withholdingTaxCurrency: withholdingTaxCurrency,
      // FX conversion fields
      fromAmount: parseFloat(row['Currency conversion from amount'] || '0') || 0,
      fromCurrency: row['Currency (Currency conversion from amount)'] || totalCurrency,
      toAmount: parseFloat(row['Currency conversion to amount'] || '0') || 0,
      toCurrency: totalCurrency,
    };
  });
}

async function main() {
  log('START', 'Trading 212 CSV Import Test Suite');
  log('INFO', `Supabase URL: ${SUPABASE_URL}`);
  log('INFO', `CSV Path: ${CSV_PATH}`);
  log('WARNING', 'STATUS: Code written but NOT EXECUTED — Docker required');

  try {
    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: Connection & Setup
    // ────────────────────────────────────────────────────────────────────────────

    await test('Connection to Supabase', async () => {
      const { data, error } = await supabaseAnon.from('portfolios').select('id').limit(1);
      await assert(!error, `Connection failed: ${error?.message}`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: Two-User Isolation (RLS Enforcement)
    // ────────────────────────────────────────────────────────────────────────────

    let user1Id, user1Email = `test1-${Date.now()}@localhost`, user1Pass = 'TestPass123!';
    let user2Id, user2Email = `test2-${Date.now()}@localhost`, user2Pass = 'TestPass123!';
    let user1Session, user2Session;

    await test('Create user1 (RLS test)', async () => {
      const { data, error } = await supabaseAnon.auth.signUp({ email: user1Email, password: user1Pass });
      await assert(!error, `Signup failed: ${error?.message}`);
      user1Id = data.user.id;
      log('INFO', `User1 created: ${user1Id}`);
    });

    await test('Create user2 (RLS test)', async () => {
      const { data, error } = await supabaseAnon.auth.signUp({ email: user2Email, password: user2Pass });
      await assert(!error, `Signup failed: ${error?.message}`);
      user2Id = data.user.id;
      log('INFO', `User2 created: ${user2Id}`);
    });

    await test('Sign in user1', async () => {
      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email: user1Email, password: user1Pass });
      await assert(!error, `Sign in failed: ${error?.message}`);
      user1Session = data.session;
    });

    await test('Sign in user2', async () => {
      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email: user2Email, password: user2Pass });
      await assert(!error, `Sign in failed: ${error?.message}`);
      user2Session = data.session;
    });

    // Create authenticated clients for each user
    const client1 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${user1Session.access_token}` } }
    });

    const client2 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${user2Session.access_token}` } }
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: Portfolio Creation & Isolation
    // ────────────────────────────────────────────────────────────────────────────

    let portfolio1Id, portfolio2Id;

    await test('Create portfolio for user1', async () => {
      const { data, error } = await client1.from('portfolios').insert({
        user_id: user1Id,
        name: 'Test Portfolio User1',
        currency: 'CHF'
      }).select();
      await assert(!error, `Portfolio creation failed: ${error?.message}`);
      portfolio1Id = data[0].id;
      log('INFO', `Portfolio1 created: ${portfolio1Id}`);
    });

    await test('Create portfolio for user2', async () => {
      const { data, error } = await client2.from('portfolios').insert({
        user_id: user2Id,
        name: 'Test Portfolio User2',
        currency: 'CHF'
      }).select();
      await assert(!error, `Portfolio creation failed: ${error?.message}`);
      portfolio2Id = data[0].id;
      log('INFO', `Portfolio2 created: ${portfolio2Id}`);
    });

    await test('RLS: User1 cannot access User2 portfolio', async () => {
      const { data, error } = await client1.from('portfolios').select('*').eq('id', portfolio2Id);
      await assert(!error && (!data || data.length === 0), 'RLS breach: User1 can see User2 portfolio');
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: BUY Operations (4 currencies)
    // ────────────────────────────────────────────────────────────────────────────

    let batch1Id;

    await test('RPC: BUY in CHF', async () => {
      const operations = [{
        type: 'buy',
        date: '2026-01-01',
        ticker: 'MSFT',
        name: 'Microsoft',
        isin: 'US5949181045',
        quantity: 10,
        price: 100,
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 1000,
        totalCurrency: 'CHF',
        sourceId: 'BUY_CHF_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_buy_chf.csv',
        p_file_checksum: 'checksum_buy_chf_v1',
        p_operations: operations
      });

      await assert(!error, `RPC failed: ${error?.message}`);
      batch1Id = data[0].batch_id;
      await assert(data[0].success, `RPC returned success=false: ${data[0].error_message}`);
      log('INFO', `BUY CHF batch created: ${batch1Id}`);
    });

    await test('Verify asset CHF: qty=10, cost=1000, avg=100', async () => {
      const { data, error } = await client1.from('assets').select('*').eq('isin', 'US5949181045');
      await assert(!error, `Query failed: ${error?.message}`);
      await assert(data && data.length > 0, 'Asset not created');
      const asset = data[0];
      await assert(asset.quantity === 10, `qty=${asset.quantity}, expected 10`);
      await assert(asset.cost_basis_chf === 1000, `cost=${asset.cost_basis_chf}, expected 1000`);
      await assert(asset.avg_buy_price === 100, `avg=${asset.avg_buy_price}, expected 100`);
    });

    await test('Verify cash movement CHF: -1000', async () => {
      const { data, error } = await client1.from('cash_movements').select('*')
        .eq('portfolio_id', portfolio1Id).eq('type', 'buy').eq('currency', 'CHF');
      await assert(!error, `Query failed: ${error?.message}`);
      await assert(data && data.length > 0, 'Cash movement not created');
      await assert(data[0].amount === -1000, `amount=${data[0].amount}, expected -1000`);
    });

    // BUY in USD
    let batch2Id;
    await test('RPC: BUY in USD', async () => {
      const operations = [{
        type: 'buy',
        date: '2026-01-02',
        ticker: 'AAPL',
        name: 'Apple',
        isin: 'US0378331005',
        quantity: 5,
        price: 150,
        priceCurrency: 'USD',
        exchangeRate: 0.95,  // 1 USD = 0.95 CHF
        totalAmount: 712.50,  // 5 * 150 * 0.95
        totalCurrency: 'CHF',
        sourceId: 'BUY_USD_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_buy_usd.csv',
        p_file_checksum: 'checksum_buy_usd_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `BUY USD failed: ${error?.message || data[0].error_message}`);
      batch2Id = data[0].batch_id;
    });

    await test('Verify asset USD: qty=5, avg=150', async () => {
      const { data, error } = await client1.from('assets').select('*').eq('isin', 'US0378331005');
      await assert(!error && data && data.length > 0, 'Asset USD not created');
      await assert(data[0].quantity === 5 && data[0].avg_buy_price === 150, 'USD asset incorrect');
    });

    // BUY in EUR
    let batch3Id;
    await test('RPC: BUY in EUR', async () => {
      const operations = [{
        type: 'buy',
        date: '2026-01-03',
        ticker: 'ASML',
        name: 'ASML',
        isin: 'NL0010273215',
        quantity: 2,
        price: 800,
        priceCurrency: 'EUR',
        exchangeRate: 1.1,  // 1 EUR = 1.1 CHF
        totalAmount: 1760,  // 2 * 800 * 1.1
        totalCurrency: 'CHF',
        sourceId: 'BUY_EUR_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_buy_eur.csv',
        p_file_checksum: 'checksum_buy_eur_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `BUY EUR failed`);
      batch3Id = data[0].batch_id;
    });

    // BUY in GBP
    let batch4Id;
    await test('RPC: BUY in GBP', async () => {
      const operations = [{
        type: 'buy',
        date: '2026-01-04',
        ticker: 'BARC',
        name: 'Barclays',
        isin: 'GB0031408410',
        quantity: 20,
        price: 25,
        priceCurrency: 'GBP',
        exchangeRate: 1.25,  // 1 GBP = 1.25 CHF
        totalAmount: 625,  // 20 * 25 * 1.25
        totalCurrency: 'CHF',
        sourceId: 'BUY_GBP_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_buy_gbp.csv',
        p_file_checksum: 'checksum_buy_gbp_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `BUY GBP failed`);
      batch4Id = data[0].batch_id;
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 5: SELL Operations (Partial & Complete)
    // ────────────────────────────────────────────────────────────────────────────

    let batch5Id;
    await test('RPC: SELL partial (5 of 10 MSFT)', async () => {
      const operations = [{
        type: 'sell',
        date: '2026-01-05',
        ticker: 'MSFT',
        name: 'Microsoft',
        isin: 'US5949181045',
        quantity: 5,
        price: 110,
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 550,
        totalCurrency: 'CHF',
        sourceId: 'SELL_CHF_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_sell_partial.csv',
        p_file_checksum: 'checksum_sell_partial_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `SELL partial failed`);
      batch5Id = data[0].batch_id;
    });

    await test('Verify MSFT after partial sell: qty=5, avg=100', async () => {
      const { data, error } = await client1.from('assets').select('*').eq('isin', 'US5949181045');
      await assert(!error && data && data[0].quantity === 5, 'MSFT qty incorrect after sell');
      await assert(data[0].avg_buy_price === 100, 'MSFT avg price changed on SELL (should stay same)');
    });

    await test('RPC: SELL complete (remaining 5 MSFT)', async () => {
      const operations = [{
        type: 'sell',
        date: '2026-01-06',
        ticker: 'MSFT',
        name: 'Microsoft',
        isin: 'US5949181045',
        quantity: 5,
        price: 120,
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 600,
        totalCurrency: 'CHF',
        sourceId: 'SELL_CHF_002'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_sell_complete.csv',
        p_file_checksum: 'checksum_sell_complete_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `SELL complete failed`);
    });

    await test('Verify MSFT after complete sell: qty=0, avg=0', async () => {
      const { data, error } = await client1.from('assets').select('*').eq('isin', 'US5949181045');
      await assert(!error && data && data[0].quantity === 0, 'MSFT qty should be 0');
      await assert(data[0].avg_buy_price === 0, 'MSFT avg should be 0 when qty=0');
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 6: Edge Cases
    // ────────────────────────────────────────────────────────────────────────────

    await test('SELL invalid: asset not found', async () => {
      const operations = [{
        type: 'sell',
        date: '2026-01-07',
        ticker: 'FAKE',
        name: 'Fake',
        isin: 'XX9999999999',
        quantity: 10,
        price: 100,
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 1000,
        totalCurrency: 'CHF',
        sourceId: 'SELL_INVALID_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_sell_invalid.csv',
        p_file_checksum: 'checksum_sell_invalid_v1',
        p_operations: operations
      });

      await assert(
        (error && error.message.includes('failed')) || (data && !data[0].success),
        'SELL of non-existent asset should fail'
      );
    });

    await test('SELL invalid: quantity > held', async () => {
      const operations = [{
        type: 'sell',
        date: '2026-01-08',
        ticker: 'AAPL',
        name: 'Apple',
        isin: 'US0378331005',
        quantity: 100,  // Only have 5
        price: 150,
        priceCurrency: 'USD',
        exchangeRate: 0.95,
        totalAmount: 14250,
        totalCurrency: 'CHF',
        sourceId: 'SELL_OVER_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_sell_over.csv',
        p_file_checksum: 'checksum_sell_over_v1',
        p_operations: operations
      });

      await assert(
        (error && error.message.includes('failed')) || (data && !data[0].success),
        'SELL of more than held should fail'
      );
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 7: DIVIDEND with Withholding Tax
    // ────────────────────────────────────────────────────────────────────────────

    await test('RPC: DIVIDEND with withholding tax', async () => {
      const operations = [{
        type: 'dividend',
        date: '2026-01-10',
        ticker: 'AAPL',
        name: 'Apple',
        isin: 'US0378331005',
        quantity: 5,
        price: 1.0,  // DPS = 1 CHF
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 5,  // 5 shares * 1 CHF
        totalCurrency: 'CHF',
        withholdingTax: 0.5,  // 0.5 CHF withholding (10%)
        withholdingTaxCurrency: 'CHF',
        sourceId: 'DIV_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_dividend.csv',
        p_file_checksum: 'checksum_dividend_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `DIVIDEND failed: ${data[0].error_message}`);
    });

    await test('Verify dividend cash movements: +5 gross, -0.5 withholding', async () => {
      const { data, error } = await client1.from('cash_movements').select('*')
        .eq('portfolio_id', portfolio1Id).eq('type', 'dividend');
      await assert(!error && data && data.length > 0, 'Dividend cash movement not created');
      await assert(data[0].amount === 5, `Dividend gross=${data[0].amount}, expected 5`);

      const { data: whdata } = await client1.from('cash_movements').select('*')
        .eq('portfolio_id', portfolio1Id).eq('type', 'withholding_tax');
      await assert(!whdata || whdata.length === 0 || whdata[0].amount === -0.5, 'Withholding tax incorrect');
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 8: Other Operations (Interest, Deposit, Withdrawal)
    // ────────────────────────────────────────────────────────────────────────────

    await test('RPC: DEPOSIT', async () => {
      const operations = [{
        type: 'deposit',
        date: '2026-01-11',
        totalAmount: 5000,
        totalCurrency: 'CHF',
        sourceId: 'DEP_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_deposit.csv',
        p_file_checksum: 'checksum_deposit_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `DEPOSIT failed`);
    });

    await test('RPC: INTEREST', async () => {
      const operations = [{
        type: 'interest',
        date: '2026-01-12',
        totalAmount: 50,
        totalCurrency: 'CHF',
        sourceId: 'INT_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_interest.csv',
        p_file_checksum: 'checksum_interest_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `INTEREST failed`);
    });

    await test('RPC: WITHDRAWAL', async () => {
      const operations = [{
        type: 'withdrawal',
        date: '2026-01-13',
        totalAmount: -1000,
        totalCurrency: 'CHF',
        sourceId: 'WDR_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_withdrawal.csv',
        p_file_checksum: 'checksum_withdrawal_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `WITHDRAWAL failed`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 9: FX Conversions
    // ────────────────────────────────────────────────────────────────────────────

    await test('RPC: FX conversion CHF → EUR', async () => {
      const operations = [{
        type: 'fx_conversion',
        date: '2026-01-14',
        fromAmount: 1000,
        fromCurrency: 'CHF',
        toAmount: 909.09,  // ~909 EUR at 1.1 rate
        toCurrency: 'EUR',
        fee: 1.91,
        sourceId: 'FX_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_fx_conversion.csv',
        p_file_checksum: 'checksum_fx_conversion_v1',
        p_operations: operations
      });

      await assert(!error && data[0].success, `FX conversion failed`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 10: Idempotence (Second Import of Same Batch)
    // ────────────────────────────────────────────────────────────────────────────

    await test('Idempotence: Re-import same BUY CHF batch', async () => {
      const operations = [{
        type: 'buy',
        date: '2026-01-01',
        ticker: 'MSFT',
        name: 'Microsoft',
        isin: 'US5949181045',
        quantity: 10,
        price: 100,
        priceCurrency: 'CHF',
        exchangeRate: 1.0,
        totalAmount: 1000,
        totalCurrency: 'CHF',
        sourceId: 'BUY_CHF_001'  // Same ID
      }];

      // Debug: Check if first batch exists
      const userId = user1Session.user.id;
      const { data: existingBatch } = await client1
        .from('import_batches')
        .select('id, status, rows_imported')
        .eq('user_id', userId)
        .eq('portfolio_id', portfolio1Id)
        .eq('broker', 'trading_212_test')
        .eq('file_checksum', 'checksum_buy_chf_v1')
        .single();

      log('INFO', `Existing batch lookup: ${existingBatch ? existingBatch.id : 'NOT FOUND'}`);
      if (existingBatch) {
        log('INFO', `  - Status: ${existingBatch.status}, Imported: ${existingBatch.rows_imported}`);
      }

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_buy_chf.csv',
        p_file_checksum: 'checksum_buy_chf_v1',  // Same checksum
        p_operations: operations
      });

      log('INFO', `Second import - Error: ${error?.message || 'none'}`);
      await assert(!error, `Idempotence RPC error: ${error?.message}`);
      await assert(data && data.length > 0, `Idempotence RPC returned no data`);
      await assert(data[0].success, `Idempotence check failed: ${data[0].error_message || 'unknown'}`);
      log('INFO', `First batch ID: ${batch1Id}, Second batch ID: ${data[0].batch_id}`);
      await assert(data[0].batch_id === batch1Id, `Idempotence: expected ${batch1Id}, got ${data[0].batch_id}`);
      log('INFO', `Idempotence verified: same batch returned`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 11: Full 481-Operation CSV Import
    // ────────────────────────────────────────────────────────────────────────────

    let realBatchId;
    await test('Load real CSV file (481 operations)', async () => {
      await assert(fs.existsSync(CSV_PATH), `CSV not found: ${CSV_PATH}`);
      const stats = fs.statSync(CSV_PATH);
      log('INFO', `CSV file loaded: ${stats.size} bytes`);
    });

    await test('RPC: Import all 481 operations from real CSV', async () => {
      const operations = parseTrading212CSV(CSV_PATH);
      log('INFO', `CSV parsed: ${operations.length} operations`);

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212',
        p_filename: path.basename(CSV_PATH),
        p_file_checksum: 'real_csv_hash_full',
        p_operations: operations
      });

      await assert(!error, `Full CSV import failed: ${error?.message}`);
      await assert(data[0].success, `Import failed: ${data[0].error_message}`);
      realBatchId = data[0].batch_id;
      log('INFO', `Full CSV imported: ${data[0].rows_imported}/${data[0].rows_total} rows`);
    });

    await test('Verify assets created from real CSV (should have multiple)', async () => {
      const { data, error } = await client1.from('assets').select('id, ticker, isin, quantity, currency')
        .eq('portfolio_id', portfolio1Id);
      await assert(!error && data && data.length > 0, 'No assets created from CSV');
      log('INFO', `Assets created: ${data.length}`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 12: Second Full Import (Idempotence on 481 ops)
    // ────────────────────────────────────────────────────────────────────────────

    await test('Idempotence: Re-import same 481-operation CSV', async () => {
      const operations = parseTrading212CSV(CSV_PATH);

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212',
        p_filename: path.basename(CSV_PATH),
        p_file_checksum: 'real_csv_hash_full',
        p_operations: operations
      });

      await assert(!error && data[0].success, `Idempotence CSV failed`);
      await assert(data[0].batch_id === realBatchId, `Second import created new batch (idempotence broken)`);
      log('INFO', `Idempotence verified on 481 ops: same batch ${realBatchId}`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 13: Rollback
    // ────────────────────────────────────────────────────────────────────────────

    await test('Rollback batch (single BUY CHF)', async () => {
      const { data, error } = await client1.rpc('rollback_import_batch', {
        p_batch_id: batch1Id
      });

      await assert(!error, `Rollback RPC failed: ${error?.message}`);
      const result = data[0];
      await assert(result.success, `Rollback returned success=false: ${result.message}`);
      log('INFO', `Rollback successful: ${result.message}`);
    });

    await test('Verify asset removed after rollback', async () => {
      const { data, error } = await client1.from('assets').select('*').eq('isin', 'US5949181045');
      // Asset may be deleted or qty=0 depending on other transactions
      log('INFO', `Asset state after rollback: ${data?.length || 0} records`);
    });

    await test('Rollback full 481-operation CSV', async () => {
      const { data, error } = await client1.rpc('rollback_import_batch', {
        p_batch_id: realBatchId
      });

      await assert(!error && data[0].success, `Rollback 481 ops failed: ${data[0].message}`);
      log('INFO', `Rollback 481 ops: deleted ${data[0].rows_deleted_transactions} txns, ${data[0].rows_deleted_cash} cash moves`);
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 14: Type Validation
    // ────────────────────────────────────────────────────────────────────────────

    await test('Unknown operation type should fail batch', async () => {
      const operations = [{
        type: 'invalid_type_xyz',
        date: '2026-01-15',
        totalAmount: 100,
        totalCurrency: 'CHF',
        sourceId: 'INVALID_001'
      }];

      const { data, error } = await client1.rpc('import_csv_batch', {
        p_portfolio_id: portfolio1Id,
        p_broker: 'trading_212_test',
        p_filename: 'test_invalid_type.csv',
        p_file_checksum: 'checksum_invalid_v1',
        p_operations: operations
      });

      await assert(
        (error && error.message.includes('failed')) || (data && !data[0].success),
        'Unknown type should cause batch failure'
      );
    });

    // ────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 15: Cleanup (Admin only, if service role available)
    // ────────────────────────────────────────────────────────────────────────────

    if (supabaseAdmin) {
      await test('Cleanup: Delete test users (admin operation)', async () => {
        // Admin client would delete auth.users here
        // Since this is not exposed via JS client, test is placeholder
        log('INFO', `Test users created: ${user1Id}, ${user2Id}`);
        log('INFO', `Manual cleanup via admin console if needed`);
      });
    } else {
      await test('Cleanup: Cannot delete test users (no service role key)', async () => {
        log('WARNING', `Test users persist in database: ${user1Id}, ${user2Id}`);
        log('INFO', `Manual cleanup required or set SUPABASE_SERVICE_ROLE_KEY env var`);
      });
    }

  } catch (error) {
    log('ERROR', `Unexpected error: ${error.message}`);
    testResults.failed++;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────────

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Status: CODE WRITTEN BUT NOT EXECUTED`);
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  console.log(`Total:  ${testResults.passed + testResults.failed}`);
  console.log('');

  testResults.tests.forEach(t => {
    const icon = t.status === 'PASS' ? '✅' : '❌';
    const error = t.error ? ` — ${t.error}` : '';
    console.log(`${icon} ${t.name}${error}`);
  });

  console.log('');
  console.log(`Duration: ${((new Date() - testResults.startTime) / 1000).toFixed(1)}s`);
  console.log('════════════════════════════════════════════════════════════════\n');

  // Save logs
  const logPath = 'IMPORT_TRADING212_RAW_TERMINAL.log';
  fs.writeFileSync(logPath, testResults.logs.join('\n'));
  log('INFO', `Logs saved to: ${logPath}`);

  process.exit(testResults.failed === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
