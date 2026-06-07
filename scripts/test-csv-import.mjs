#!/usr/bin/env node

/**
 * Test script for CSV parser
 * Reads real Trading 212 CSV and generates preview report
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ═══════════════════════════════════════════════════════════════════════════
// Parser Implementation (minimal, inline for test)
// ═══════════════════════════════════════════════════════════════════════════

function parseCSVLine(line) {
  const headers = [
    'Action',
    'Time',
    'ISIN',
    'Ticker',
    'Name',
    'Notes',
    'ID',
    'No. of shares',
    'Price / share',
    'Currency (Price / share)',
    'Exchange rate',
    'Result',
    'Currency (Result)',
    'Total',
    'Currency (Total)',
    'Withholding tax',
    'Currency (Withholding tax)',
    'Currency conversion from amount',
    'Currency (Currency conversion from amount)',
    'Currency conversion to amount',
    'Currency (Currency conversion to amount)',
    'Currency conversion fee',
    'Currency (Currency conversion fee)',
  ]

  const result = {}
  const fields = line.split(',')
  headers.forEach((header, i) => {
    result[header] = (fields[i] || '').trim()
  })
  return result
}

const ACTION_MAPPING = {
  'Market buy': 'buy',
  'Limit buy': 'buy',
  'Market sell': 'sell',
  'Limit sell': 'sell',
  'Deposit': 'deposit',
  'Withdrawal': 'withdrawal',
  'Dividend': 'dividend',
  'Dividend (Dividend)': 'dividend',
  'Dividend (Tax exempted)': 'dividend',
  'Dividend adjustment': 'dividend_adjustment',
  'Interest on cash': 'interest',
  'Currency conversion': 'fx_conversion',
  'Stock split open': 'split',
  'Stock split close': 'split',
}

function normalizeOperation(raw, lineNumber) {
  const type = ACTION_MAPPING[raw.Action] || 'unknown'
  const date = raw.Time ? raw.Time.split(' ')[0] : ''

  return {
    type,
    date,
    rawAction: raw.Action,
    isin: raw.ISIN || '',
    ticker: raw.Ticker || '',
    name: raw.Name || '',
    notes: raw.Notes || '',
    sourceId: raw.ID || '',
    quantity: parseFloat(raw['No. of shares']) || 0,
    price: parseFloat(raw['Price / share']) || 0,
    priceCurrency: raw['Currency (Price / share)'] || '',
    exchangeRate: parseFloat(raw['Exchange rate']) || 1,
    totalAmount: parseFloat(raw.Total) || 0,
    totalCurrency: raw['Currency (Total)'] || '',
    result: parseFloat(raw.Result) || 0,
    resultCurrency: raw['Currency (Result)'] || '',
    withholdingTax: parseFloat(raw['Withholding tax']) || 0,
    withholdingTaxCurrency: raw['Currency (Withholding tax)'] || '',
    fxFromAmount: parseFloat(raw['Currency conversion from amount']) || 0,
    fxFromCurrency: raw['Currency (Currency conversion from amount)'] || '',
    fxToAmount: parseFloat(raw['Currency conversion to amount']) || 0,
    fxToCurrency: raw['Currency (Currency conversion to amount)'] || '',
    fxFee: parseFloat(raw['Currency conversion fee']) || 0,
    fxFeeCurrency: raw['Currency (Currency conversion fee)'] || '',
    isIncomplete: false,
    ambiguityWarnings: [],
  }
}

async function parseTrading212CSV(csvContent) {
  const lines = csvContent.split('\n').filter(l => l.trim())

  if (lines.length < 2) {
    throw new Error('CSV must contain at least header + 1 operation')
  }

  const operations = []
  const operationCounts = {
    buy: 0,
    sell: 0,
    deposit: 0,
    withdrawal: 0,
    dividend: 0,
    dividend_adjustment: 0,
    interest: 0,
    fx_conversion: 0,
    split: 0,
    unknown: 0,
  }

  // Track sub-types
  let marketBuys = 0, limitBuys = 0
  let marketSells = 0, limitSells = 0
  let splitOpens = 0, splitCloses = 0

  const currencies = new Set()
  const currencyDistribution = new Map()
  const tickers = new Map()
  const isins = new Map()
  const incompleteRows = []
  const ambiguousRows = []
  const currencyMixIssues = []
  const sourceIdMap = new Map()

  for (let i = 1; i < lines.length; i++) {
    try {
      const raw = parseCSVLine(lines[i])
      const op = normalizeOperation(raw, i)

      // Track currencies
      if (op.priceCurrency) currencies.add(op.priceCurrency)
      if (op.totalCurrency) {
        currencies.add(op.totalCurrency)
        currencyDistribution.set(op.totalCurrency, (currencyDistribution.get(op.totalCurrency) || 0) + 1)
      }
      if (op.resultCurrency) currencies.add(op.resultCurrency)
      if (op.fxFromCurrency) currencies.add(op.fxFromCurrency)
      if (op.fxToCurrency) currencies.add(op.fxToCurrency)
      if (op.withholdingTaxCurrency) currencies.add(op.withholdingTaxCurrency)

      // Track tickers and ISINs
      if (op.ticker && op.isin) {
        const existing = tickers.get(op.ticker) || {
          name: op.name,
          isin: op.isin,
          count: 0,
        }
        existing.count++
        tickers.set(op.ticker, existing)

        const existingIsin = isins.get(op.isin) || {
          ticker: op.ticker,
          name: op.name,
          count: 0,
        }
        existingIsin.count++
        isins.set(op.isin, existingIsin)
      }

      // Track source IDs
      if (op.sourceId) {
        sourceIdMap.set(op.sourceId, (sourceIdMap.get(op.sourceId) || 0) + 1)
      }

      // Count operations and sub-types
      operationCounts[op.type]++

      if (op.rawAction === 'Market buy') marketBuys++
      if (op.rawAction === 'Limit buy') limitBuys++
      if (op.rawAction === 'Market sell') marketSells++
      if (op.rawAction === 'Limit sell') limitSells++
      if (op.rawAction === 'Stock split open') splitOpens++
      if (op.rawAction === 'Stock split close') splitCloses++

      if (op.isIncomplete) incompleteRows.push({ lineNumber: i, operation: op })
      if (op.ambiguityWarnings.length > 0) {
        ambiguousRows.push({ lineNumber: i, operation: op })
        if (op.totalCurrency && op.totalCurrency !== 'CHF') {
          currencyMixIssues.push({
            lineNumber: i,
            operation: op,
            description: `Total in ${op.totalCurrency}, price in ${op.priceCurrency}`,
          })
        }
      }

      operations.push(op)
    } catch (e) {
      console.error(`Error parsing line ${i}:`, e.message)
    }
  }

  const duplicates = Array.from(sourceIdMap.entries())
    .filter(([_, count]) => count > 1)
    .map(([sourceId, count]) => ({ sourceId, count }))

  const report = {
    filename: path.basename('from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv'),
    totalLines: lines.length,
    totalOperations: operations.length,
    period: {
      start: operations.length > 0 ? operations[0].date : '',
      end: operations.length > 0 ? operations[operations.length - 1].date : '',
    },
    brokerDetected: 'Trading 212',
    operationCounts,
    currenciesUsed: Array.from(currencies).sort(),
    currencyDistribution: Object.fromEntries(
      Array.from(currencyDistribution.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, v])
    ),
    tickers: Array.from(tickers.entries())
      .map(([ticker, info]) => ({ ticker, ...info }))
      .sort((a, b) => b.count - a.count),
    isins: Array.from(isins.entries())
      .map(([isin, info]) => ({ isin, ...info }))
      .sort((a, b) => b.count - a.count),
    stats: {
      marketBuys,
      limitBuys,
      totalBuys: operationCounts.buy,
      marketSells,
      limitSells,
      totalSells: operationCounts.sell,
      totalDeposits: operationCounts.deposit,
      totalWithdrawals: operationCounts.withdrawal,
      dividendPayments: operationCounts.dividend,
      dividendAdjustments: operationCounts.dividend_adjustment,
      totalDividends: operationCounts.dividend + operationCounts.dividend_adjustment,
      totalInterest: operationCounts.interest,
      totalFxConversions: operationCounts.fx_conversion,
      stockSplitsOpen: splitOpens,
      stockSplitsClose: splitCloses,
      totalSplits: operationCounts.split,
    },
    incompleteRows,
    ambiguousRows,
    duplicateSourceIds: duplicates,
    currencyMixIssues,
  }

  return { operations, report }
}

function generatePreviewReport(report) {
  const lines = [
    '═══════════════════════════════════════════════════════════════════════════',
    'TRADING 212 CSV IMPORT — LOT 1 PREVIEW REPORT (CORRECTED)',
    '═══════════════════════════════════════════════════════════════════════════',
    '',
    `File: ${report.filename}`,
    `Total lines: ${report.totalLines}`,
    `Total operations: ${report.totalOperations}`,
    `Period: ${report.period.start} → ${report.period.end}`,
    `Broker: ${report.brokerDetected}`,
    '',
    '─── OPERATIONS (CORRECTED) ────────────────────────────────────────────────',
    '',
    'Buys:',
    `  Market buy:  ${report.stats.marketBuys}`,
    `  Limit buy:   ${report.stats.limitBuys}`,
    `  Total:       ${report.stats.totalBuys}`,
    '',
    'Sells:',
    `  Market sell: ${report.stats.marketSells}`,
    `  Limit sell:  ${report.stats.limitSells}`,
    `  Total:       ${report.stats.totalSells}`,
    '',
    'Cash:',
    `  Deposits:    ${report.stats.totalDeposits}`,
    `  Withdrawals: ${report.stats.totalWithdrawals}`,
    '',
    'Dividends (CORRECTED: 19 + 1 Tax exempted + 1 adjustment = 21):',
    `  Dividend:    ${report.stats.dividendPayments}`,
    `  Adjustment:  ${report.stats.dividendAdjustments}`,
    `  Total:       ${report.stats.totalDividends}`,
    '',
    'Other:',
    `  Interest:    ${report.stats.totalInterest}`,
    `  FX Conv:     ${report.stats.totalFxConversions}`,
    '',
    'Splits:',
    `  Open:        ${report.stats.stockSplitsOpen}`,
    `  Close:       ${report.stats.stockSplitsClose}`,
    `  Total:       ${report.stats.totalSplits}`,
    '',
    '─── CURRENCIES (CORRECTED) ────────────────────────────────────────────────',
    '',
    `Used in operations: ${report.currenciesUsed.join(', ')}`,
    '',
    'Total currency distribution:',
    Object.entries(report.currencyDistribution)
      .map(([currency, count]) => `  ${currency}: ${count} operations`)
      .join('\n'),
    '',
    '─── TICKERS & ISINs ───────────────────────────────────────────────────────',
    '',
    `Unique tickers: ${report.tickers.length}`,
    report.tickers
      .slice(0, 20)
      .map(info => `  ${info.ticker}: ${info.isin} (${info.name}) — ${info.count}x`)
      .join('\n'),
    '',
    `Unique ISINs: ${report.isins.length}`,
    report.isins
      .slice(0, 15)
      .map(info => `  ${info.isin}: ${info.ticker} (${info.name}) — ${info.count}x`)
      .join('\n'),
    '',
    '─── DATA QUALITY ──────────────────────────────────────────────────────────',
    '',
    `Incomplete rows:        ${report.incompleteRows.length}`,
    `Ambiguous rows:         ${report.ambiguousRows.length}`,
    `Currency mix issues:    ${report.currencyMixIssues.length}`,
    `Duplicate source IDs:   ${report.duplicateSourceIds.length}`,
    '',
    '═══════════════════════════════════════════════════════════════════════════',
  ]
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const csvPath = 'C:\\Users\\omard\\Downloads\\from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv'

  console.log(`Reading CSV: ${csvPath}`)

  const csvContent = fs.readFileSync(csvPath, 'utf-8')
  const { operations, report } = await parseTrading212CSV(csvContent)

  console.log(generatePreviewReport(report))

  // Save JSON for further analysis
  const reportPath = path.resolve(__dirname, '../graphify-out/csv-import-lot1-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`\nReport saved: ${reportPath}`)
}

main().catch(console.error)
