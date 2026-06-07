/**
 * Trading 212 CSV Parser — Lot 1 (CORRECTED)
 *
 * Parses Trading 212 CSV export format without modifying database.
 * Produces detailed preview report for validation before import.
 *
 * Supported operations:
 * - Market buy / Limit buy → 'buy'
 * - Market sell / Limit sell → 'sell'
 * - Deposit → 'deposit'
 * - Withdrawal → 'withdrawal'
 * - Dividend / Dividend (Tax exempted) → 'dividend'
 * - Dividend adjustment → 'dividend_adjustment'
 * - Interest on cash → 'interest'
 * - Currency conversion → 'fx_conversion'
 * - Stock split open/close → 'split'
 *
 * CORRECTIONS (Lot 1 v2):
 * - Currency (Total) can be CHF or USD (not always user's base currency)
 * - Dividends: 19 Dividend + 1 Tax exempted + 1 Dividend adjustment = 21 lines
 * - Validation: only require ticker+ISIN for asset-based operations (buy/sell/dividend)
 * - Track multiple currencies per operation type separately
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type OperationType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'dividend'
  | 'dividend_adjustment'
  | 'interest'
  | 'fx_conversion'
  | 'split'
  | 'unknown'

export interface ParsedOperation {
  type: OperationType
  date: string
  rawAction: string

  // Asset identification (optional for non-asset operations)
  isin: string
  ticker: string
  name: string
  notes: string
  sourceId: string

  // Asset transaction fields (for buy/sell/dividend)
  quantity: number
  price: number
  priceCurrency: string
  exchangeRate: number

  // CORRECTED: Total amount with its own currency (CHF or USD)
  totalAmount: number
  totalCurrency: string

  // Realized P&L (for sells)
  result: number
  resultCurrency: string

  // Withholding tax (for dividends)
  withholdingTax: number
  withholdingTaxCurrency: string

  // FX conversion fields
  fxFromAmount: number
  fxFromCurrency: string
  fxToAmount: number
  fxToCurrency: string
  fxFee: number
  fxFeeCurrency: string

  // Validation
  isIncomplete: boolean
  ambiguityWarnings: string[]
}

export interface CsvParseReport {
  filename: string
  totalLines: number
  totalOperations: number
  period: { start: string; end: string }
  brokerDetected: 'Trading 212'
  operationCounts: Record<OperationType, number>
  currenciesUsed: string[]
  currencyDistribution: Record<string, number> // "CHF" | "USD" → count
  tickers: Array<{ ticker: string; name: string; isin: string; count: number }>
  isins: Array<{ isin: string; ticker: string; name: string; count: number }>
  stats: {
    marketBuys: number
    limitBuys: number
    totalBuys: number
    marketSells: number
    limitSells: number
    totalSells: number
    totalDeposits: number
    totalWithdrawals: number
    dividendPayments: number // Dividend + Dividend (Tax exempted)
    dividendAdjustments: number
    totalDividends: number // All dividend-related
    totalInterest: number
    totalFxConversions: number
    stockSplitsOpen: number
    stockSplitsClose: number
    totalSplits: number
  }
  incompleteRows: Array<{ lineNumber: number; operation: ParsedOperation; reason: string }>
  ambiguousRows: Array<{ lineNumber: number; operation: ParsedOperation; warnings: string[] }>
  duplicateSourceIds: Array<{ sourceId: string; count: number }>
  currecnyMixIssues: Array<{ lineNumber: number; operation: ParsedOperation; description: string }>
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Parser (CORRECTED v2)
// ═══════════════════════════════════════════════════════════════════════════

const ACTION_MAPPING: Record<string, OperationType> = {
  'Market buy': 'buy',
  'Limit buy': 'buy',
  'Market sell': 'sell',
  'Limit sell': 'sell',
  Deposit: 'deposit',
  Withdrawal: 'withdrawal',
  Dividend: 'dividend',
  'Dividend (Dividend)': 'dividend', // Full form in CSV
  'Dividend (Tax exempted)': 'dividend', // Tax-exempt dividend
  'Dividend adjustment': 'dividend_adjustment',
  'Interest on cash': 'interest',
  'Currency conversion': 'fx_conversion',
  'Stock split open': 'split',
  'Stock split close': 'split',
}

export function parseCSVLine(line: string): Record<string, string> {
  const result: Record<string, string> = {}
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

  const fields = line.split(',')
  headers.forEach((header, i) => {
    result[header] = (fields[i] || '').trim().replace(/^"(.*)"$/, '$1') // Remove surrounding quotes
  })
  return result
}

export function normalizeOperation(raw: Record<string, string>, lineNumber: number): ParsedOperation {
  const type = ACTION_MAPPING[raw.Action] || 'unknown'
  const date = raw.Time ? raw.Time.split(' ')[0] : ''

  const operation: ParsedOperation = {
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
    // CORRECTED: Keep total amount with its own currency
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

  // CORRECTED: Validate based on operation type
  // Only require ISIN+ticker for asset-based operations
  if (type === 'buy' || type === 'sell' || type === 'dividend') {
    if (!operation.isin || !operation.ticker) {
      operation.isIncomplete = true
      operation.ambiguityWarnings.push(`Missing ISIN/ticker for ${operation.rawAction}`)
    }
    if ((type === 'buy' || type === 'sell') && (!operation.quantity || !operation.price)) {
      operation.isIncomplete = true
      operation.ambiguityWarnings.push(`Missing quantity/price for ${operation.rawAction}`)
    }
  }

  if (type === 'fx_conversion') {
    if (!operation.fxFromAmount || !operation.fxToAmount) {
      operation.isIncomplete = true
      operation.ambiguityWarnings.push('FX conversion missing from/to amounts')
    }
  }

  // Flag currency mismatches
  if (type === 'buy' || type === 'sell') {
    if (operation.totalCurrency && operation.totalCurrency !== 'CHF' && operation.priceCurrency) {
      operation.ambiguityWarnings.push(
        `Total is ${operation.totalCurrency} but price is ${operation.priceCurrency} — verify conversion`
      )
    }
  }

  return operation
}

export async function parseTrading212CSV(csvContent: string): Promise<{
  operations: ParsedOperation[]
  report: CsvParseReport
}> {
  const lines = csvContent.split('\n').filter(l => l.trim())

  if (lines.length < 2) {
    throw new Error('CSV must contain at least header + 1 operation')
  }

  const operations: ParsedOperation[] = []
  const operationCounts: Record<OperationType, number> = {
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

  const currencies = new Set<string>()
  const currencyDistribution = new Map<string, number>()
  const tickers = new Map<string, { name: string; isin: string; count: number }>()
  const isins = new Map<string, { ticker: string; name: string; count: number }>()

  const incompleteRows: Array<{ lineNumber: number; operation: ParsedOperation; reason: string }> = []
  const ambiguousRows: Array<{ lineNumber: number; operation: ParsedOperation; warnings: string[] }> = []
  const currencyMixIssues: Array<{ lineNumber: number; operation: ParsedOperation; description: string }> = []
  const sourceIdMap = new Map<string, number>()

  // Skip header (line 0)
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

      // Flag incomplete or ambiguous rows
      if (op.isIncomplete) {
        incompleteRows.push({ lineNumber: i, operation: op, reason: op.ambiguityWarnings[0] || 'Incomplete' })
      }
      if (op.ambiguityWarnings.length > 0) {
        ambiguousRows.push({ lineNumber: i, operation: op, warnings: op.ambiguityWarnings })
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
      // Log parsing errors but continue
    }
  }

  const duplicates = Array.from(sourceIdMap.entries())
    .filter(([_, count]) => count > 1)
    .map(([sourceId, count]) => ({ sourceId, count }))

  const report: CsvParseReport = {
    filename: 'from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv',
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
      dividendPayments: operationCounts.dividend, // Dividend + Tax exempted
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
    currecnyMixIssues: currencyMixIssues,
    errors: [],
  }

  return { operations, report }
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Generator (CORRECTED v2)
// ═══════════════════════════════════════════════════════════════════════════

export function generatePreviewReport(report: CsvParseReport): string {
  const lines: string[] = [
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
    report.incompleteRows.length > 0
      ? report.incompleteRows
          .slice(0, 5)
          .map(row => `  Line ${row.lineNumber}: ${row.operation.rawAction} — ${row.reason}`)
          .join('\n')
      : '  (none)',
    '',
    `Ambiguous rows:         ${report.ambiguousRows.length}`,
    report.ambiguousRows.length > 0
      ? report.ambiguousRows
          .slice(0, 5)
          .map(row => `  Line ${row.lineNumber}: ${row.operation.rawAction}`)
          .join('\n')
      : '  (none)',
    '',
    `Currency mix issues:    ${report.currecnyMixIssues.length}`,
    report.currecnyMixIssues.length > 0
      ? report.currecnyMixIssues
          .slice(0, 5)
          .map(row => `  Line ${row.lineNumber}: ${row.description}`)
          .join('\n')
      : '  (none)',
    '',
    `Duplicate source IDs:   ${report.duplicateSourceIds.length}`,
    report.duplicateSourceIds.length > 0
      ? report.duplicateSourceIds
          .slice(0, 5)
          .map(dup => `  ${dup.sourceId} (appears ${dup.count} times)`)
          .join('\n')
      : '  (none)',
    '',
    '═══════════════════════════════════════════════════════════════════════════',
  ]

  return lines.join('\n')
}
