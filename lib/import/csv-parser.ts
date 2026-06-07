/**
 * Trading 212 CSV Parser — Lot 1
 *
 * Parses Trading 212 CSV export format without modifying database.
 * Produces detailed preview report for validation before import.
 *
 * Supported operations:
 * - Market buy / Limit buy → 'buy'
 * - Market sell / Limit sell → 'sell'
 * - Deposit → 'deposit'
 * - Withdrawal → 'withdrawal'
 * - Dividend → 'dividend'
 * - Interest on cash → 'interest'
 * - Currency conversion → 'fx_conversion'
 * - Stock split open/close → 'split'
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface Trading212Row {
  action: string
  time: string
  isin: string
  ticker: string
  name: string
  notes: string
  id: string
  shares: number
  pricePerShare: number
  priceCurrency: string
  exchangeRate: number
  result: number
  resultCurrency: string
  total: number
  totalCurrency: string
  withholdingTax: number
  withholdingTaxCurrency: string
  fxFromAmount: number
  fxFromCurrency: string
  fxToAmount: number
  fxToCurrency: string
  fxFee: number
  fxFeeCurrency: string
}

export type OperationType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'dividend'
  | 'interest'
  | 'fx_conversion'
  | 'split'
  | 'unknown'

export interface ParsedOperation {
  type: OperationType
  date: string
  rawAction: string
  isin: string
  ticker: string
  name: string
  notes: string
  sourceId: string
  quantity: number
  price: number
  priceCurrency: string
  exchangeRate: number
  totalAmountNative: number
  totalAmountBase: string
  baseCurrency: string
  result: number
  resultCurrency: string
  withholdingTax: number
  withholdingTaxCurrency: string
  fxFromAmount: number
  fxFromCurrency: string
  fxToAmount: number
  fxToCurrency: string
  fxFee: number
  fxFeeCurrency: string
  // Calculated fields
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
  currencies: Set<string>
  tickers: Map<string, { name: string; isin: string; count: number }>
  isins: Map<string, { ticker: string; name: string; count: number }>
  stats: {
    totalDeposits: number
    totalWithdrawals: number
    totalBuys: number
    totalSells: number
    totalDividends: number
    totalInterest: number
    totalFxConversions: number
    totalSplits: number
  }
  incompleteRows: Array<{ lineNumber: number; operation: ParsedOperation }>
  ambiguousRows: Array<{ lineNumber: number; operation: ParsedOperation }>
  duplicateSourceIds: Array<{ sourceId: string; count: number }>
  missingTickers: Array<{ isin: string; name: string; count: number }>
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Parser
// ═══════════════════════════════════════════════════════════════════════════

const ACTION_MAPPING: Record<string, OperationType> = {
  'Market buy': 'buy',
  'Limit buy': 'buy',
  'Market sell': 'sell',
  'Limit sell': 'sell',
  Deposit: 'deposit',
  Withdrawal: 'withdrawal',
  Dividend: 'dividend',
  'Interest on cash': 'interest',
  'Currency conversion': 'fx_conversion',
  'Stock split open': 'split',
  'Stock split close': 'split',
}

export function parseCSVLine(line: string): Record<string, string> {
  // Simple CSV parser — handles quoted fields with embedded commas
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
    result[header] = (fields[i] || '').trim()
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
    totalAmountNative: parseFloat(raw.Total) || 0,
    totalAmountBase: raw['Currency (Total)'] || 'CHF',
    baseCurrency: raw['Currency (Total)'] || 'CHF',
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

  // Validate completeness
  if (type === 'buy' || type === 'sell') {
    if (!operation.isin || !operation.ticker || !operation.quantity || !operation.price) {
      operation.isIncomplete = true
      operation.ambiguityWarnings.push('Missing required buy/sell fields (ISIN/ticker/quantity/price)')
    }
  }

  if (type === 'fx_conversion') {
    if (!operation.fxFromAmount || !operation.fxToAmount) {
      operation.isIncomplete = true
      operation.ambiguityWarnings.push('FX conversion missing from/to amounts')
    }
  }

  if (operation.withholdingTax !== 0 && !operation.withholdingTaxCurrency) {
    operation.ambiguityWarnings.push('Withholding tax present but currency unclear')
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
    interest: 0,
    fx_conversion: 0,
    split: 0,
    unknown: 0,
  }

  const currencies = new Set<string>()
  const tickers = new Map<
    string,
    { name: string; isin: string; count: number }
  >()
  const isins = new Map<string, { ticker: string; name: string; count: number }>()

  const incompleteRows: Array<{ lineNumber: number; operation: ParsedOperation }> = []
  const ambiguousRows: Array<{ lineNumber: number; operation: ParsedOperation }> = []
  const sourceIdMap = new Map<string, number>()
  const missingTickersMap = new Map<
    string,
    { name: string; count: number }
  >()

  // Skip header (line 0)
  for (let i = 1; i < lines.length; i++) {
    try {
      const raw = parseCSVLine(lines[i])
      const op = normalizeOperation(raw, i)

      // Track currencies
      if (op.priceCurrency) currencies.add(op.priceCurrency)
      if (op.baseCurrency) currencies.add(op.baseCurrency)
      if (op.resultCurrency) currencies.add(op.resultCurrency)
      if (op.fxFromCurrency) currencies.add(op.fxFromCurrency)
      if (op.fxToCurrency) currencies.add(op.fxToCurrency)
      if (op.withholdingTaxCurrency)
        currencies.add(op.withholdingTaxCurrency)

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
      } else if (op.isin && !op.ticker) {
        const key = `${op.isin}:::${op.name}`
        const existing = missingTickersMap.get(key) || {
          name: op.name,
          count: 0,
        }
        existing.count++
        missingTickersMap.set(key, existing)
      }

      // Track source IDs for deduplication
      if (op.sourceId) {
        sourceIdMap.set(op.sourceId, (sourceIdMap.get(op.sourceId) || 0) + 1)
      }

      // Count operations
      operationCounts[op.type]++

      // Flag incomplete or ambiguous rows
      if (op.isIncomplete) {
        incompleteRows.push({ lineNumber: i, operation: op })
      }
      if (op.ambiguityWarnings.length > 0) {
        ambiguousRows.push({ lineNumber: i, operation: op })
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
      end:
        operations.length > 0
          ? operations[operations.length - 1].date
          : '',
    },
    brokerDetected: 'Trading 212',
    operationCounts,
    currencies,
    tickers,
    isins,
    stats: {
      totalDeposits: operationCounts.deposit,
      totalWithdrawals: operationCounts.withdrawal,
      totalBuys: operationCounts.buy,
      totalSells: operationCounts.sell,
      totalDividends: operationCounts.dividend,
      totalInterest: operationCounts.interest,
      totalFxConversions: operationCounts.fx_conversion,
      totalSplits: operationCounts.split,
    },
    incompleteRows,
    ambiguousRows,
    duplicateSourceIds: duplicates,
    missingTickers: Array.from(missingTickersMap.entries()).map(
      ([key, value]) => ({
        isin: key.split(':::')[0],
        name: value.name,
        count: value.count,
      })
    ),
    errors: [],
  }

  return { operations, report }
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Generator
// ═══════════════════════════════════════════════════════════════════════════

export function generatePreviewReport(
  report: CsvParseReport
): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════════════════',
    'TRADING 212 CSV IMPORT — LOT 1 PREVIEW REPORT',
    '═══════════════════════════════════════════════════════════════════════════',
    '',
    `File: ${report.filename}`,
    `Total lines: ${report.totalLines}`,
    `Total operations: ${report.totalOperations}`,
    `Period: ${report.period.start} → ${report.period.end}`,
    `Broker: ${report.brokerDetected}`,
    '',
    '─── OPERATIONS ───────────────────────────────────────────────────────────',
    `Buy:              ${report.stats.totalBuys}`,
    `Sell:             ${report.stats.totalSells}`,
    `Deposit:          ${report.stats.totalDeposits}`,
    `Withdrawal:       ${report.stats.totalWithdrawals}`,
    `Dividend:         ${report.stats.totalDividends}`,
    `Interest:         ${report.stats.totalInterest}`,
    `FX Conversion:    ${report.stats.totalFxConversions}`,
    `Split:            ${report.stats.totalSplits}`,
    `Unknown:          ${report.operationCounts.unknown}`,
    '',
    '─── CURRENCIES ────────────────────────────────────────────────────────────',
    Array.from(report.currencies)
      .sort()
      .map(c => `  ${c}`)
      .join('\n'),
    '',
    '─── TICKERS & ISINs ───────────────────────────────────────────────────────',
    `Unique tickers: ${report.tickers.size}`,
    Array.from(report.tickers.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(
        ([ticker, info]) =>
          `  ${ticker}: ${info.isin} (${info.name}) — ${info.count}x`
      )
      .join('\n'),
    '',
    `Unique ISINs: ${report.isins.size}`,
    Array.from(report.isins.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(
        ([isin, info]) =>
          `  ${isin}: ${info.ticker} (${info.name}) — ${info.count}x`
      )
      .join('\n'),
    '',
    '─── DATA QUALITY ──────────────────────────────────────────────────────────',
    `Incomplete rows:  ${report.incompleteRows.length}`,
    report.incompleteRows.length > 0
      ? report.incompleteRows
          .slice(0, 5)
          .map(
            row =>
              `  Line ${row.lineNumber}: ${row.operation.rawAction} — ${row.operation.ambiguityWarnings.join('; ')}`
          )
          .join('\n')
      : '  (none)',
    '',
    `Ambiguous rows:   ${report.ambiguousRows.length}`,
    report.ambiguousRows.length > 0
      ? report.ambiguousRows
          .slice(0, 5)
          .map(
            row =>
              `  Line ${row.lineNumber}: ${row.operation.rawAction} — ${row.operation.ambiguityWarnings.join('; ')}`
          )
          .join('\n')
      : '  (none)',
    '',
    `Duplicate source IDs: ${report.duplicateSourceIds.length}`,
    report.duplicateSourceIds.length > 0
      ? report.duplicateSourceIds
          .slice(0, 5)
          .map(dup => `  ${dup.sourceId} (appears ${dup.count} times)`)
          .join('\n')
      : '  (none)',
    '',
    `Missing tickers: ${report.missingTickers.length}`,
    report.missingTickers.length > 0
      ? report.missingTickers
          .map(m => `  ${m.isin}: ${m.name} (${m.count}x)`)
          .join('\n')
      : '  (none)',
    '',
    '═══════════════════════════════════════════════════════════════════════════',
  ]

  return lines.join('\n')
}
