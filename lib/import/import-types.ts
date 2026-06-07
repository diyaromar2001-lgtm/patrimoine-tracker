/**
 * Trading 212 CSV Import — Type Definitions
 *
 * Extends lib/types.ts with import-specific interfaces.
 * Used throughout:
 * - Parser (lib/import/csv-parser.ts)
 * - RPC (supabase import-csv-batch function)
 * - Frontend (hooks/use-app-data.tsx)
 */

import type { AssetClass, Currency, TransactionType } from "@/lib/types"

// ═══════════════════════════════════════════════════════════════════════════
// Import Batch
// ═══════════════════════════════════════════════════════════════════════════

export type ImportBatchStatus = "pending" | "processing" | "success" | "partial" | "failed"

export interface ImportBatch {
  id: string
  userId: string
  portfolioId: string
  broker: string // "Trading 212" | "Interactive Brokers" | etc.
  filename: string
  fileChecksum: string
  status: ImportBatchStatus

  rowsTotal: number
  rowsImported: number
  rowsSkipped: number
  rowsFailed: number

  createdAt: string
  completedAt?: string
  errorSummary?: {
    errors?: string
    details?: Array<{ line: number; field: string; error: string }>
  }
}

export interface ImportBatchResponse {
  batchId: string
  success: boolean
  rowsTotal: number
  rowsImported: number
  rowsSkipped: number
  rowsFailed: number
  errorMessage?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Parsed Operation (from CSV Parser)
// ═══════════════════════════════════════════════════════════════════════════

export type OperationType =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "dividend_adjustment"
  | "interest"
  | "fx_conversion"
  | "split"
  | "unknown"

export interface ParsedOperation {
  // Metadata
  type: OperationType
  date: string // YYYY-MM-DD
  rawAction: string // "Market buy", "Dividend (Tax exempted)", etc.

  // Asset identification (optional for non-asset operations)
  isin: string
  ticker: string
  name: string
  notes: string
  sourceId: string // Trading 212 transaction ID

  // Asset transaction fields (for buy/sell/dividend)
  quantity: number
  price: number
  priceCurrency: string // Native currency of price
  exchangeRate: number // To CHF on transaction date

  // Total amount (CHF or USD from CSV)
  totalAmount: number
  totalCurrency: string // "CHF" or "USD"

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

// ═══════════════════════════════════════════════════════════════════════════
// Prepared Operation (for RPC)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Operation ready to send to import_csv_batch RPC.
 * Includes all fields needed for atomically importing one CSV row.
 */
export interface PreparedOperation extends ParsedOperation {
  // Additional computed fields
  nativeAmount?: number // quantity × price (computed)
  baseAmount?: number // Amount in user's base currency
}

// ═══════════════════════════════════════════════════════════════════════════
// Import Request/Response
// ═══════════════════════════════════════════════════════════════════════════

export interface ImportRequest {
  userId: string
  portfolioId: string
  broker: string
  filename: string
  fileChecksum: string
  operations: ParsedOperation[]
}

export interface ImportResponse {
  batchId: string
  success: boolean
  rowsTotal: number
  rowsImported: number
  rowsSkipped: number
  rowsFailed: number
  errors?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced DB Types (extensions to lib/types.ts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended Asset type with ISIN and import metadata.
 * Extends the Asset interface from lib/types.ts.
 */
export interface AssetWithImport {
  id: string
  portfolioId: string
  ticker: string
  name: string
  assetClass: AssetClass
  quantity: number
  avgBuyPrice: number
  currentPrice: number
  currency: Currency
  costBasisChf?: number

  // Import fields
  isin?: string
  isinUpdatedAt?: string
}

/**
 * Extended Transaction type with import tracking and multi-currency support.
 * Extends the Transaction interface from lib/types.ts.
 */
export interface TransactionWithImport {
  id: string
  portfolioId: string
  assetId?: string
  ticker: string
  assetName: string
  assetClass: AssetClass
  type: TransactionType
  quantity: number
  price: number
  fees: number
  currency: Currency
  fxRateToChf?: number
  grossAmountChf?: number
  feesChf?: number
  netAmountChf?: number
  realizedPnlChf?: number
  date: string
  notes?: string

  // Import tracking
  source?: string // "manual" | "trading_212" | etc.
  sourceExternalId?: string // Trading 212 ID
  importBatchId?: string

  // Multi-currency
  nativeCurrency?: Currency // Currency of price/amount in source
  nativeAmount?: number // quantity × price in native currency
  historicalFxRate?: number // Rate at transaction date
  totalCurrency?: string // "CHF" or "USD" from CSV
  totalAmount?: number // Total in total_currency
  baseCurrency?: string // User's base currency
  baseAmount?: number // Amount in base currency

  // Raw data
  rawPayload?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════
// UI State for Import Flow
// ═══════════════════════════════════════════════════════════════════════════

export interface ImportUIState {
  // Step 1: Upload
  uploadedFile?: File
  fileName?: string
  brokerDetected?: string

  // Step 2: Preview
  csvContent?: string
  parsedOperations?: ParsedOperation[]
  parseErrors?: string[]

  // Step 3: Validation
  missingAssets?: Array<{ isin: string; name: string; count: number }>
  ambiguousRows?: number
  estimatedRowsToImport?: number

  // Step 4: Import
  isImporting?: boolean
  importProgress?: { imported: number; total: number }
  batchId?: string

  // Final
  importResult?: ImportBatchResponse
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV Parser Report (from csv-parser.ts)
// ═══════════════════════════════════════════════════════════════════════════

export interface CsvParseReport {
  filename: string
  totalLines: number
  totalOperations: number
  period: { start: string; end: string }
  brokerDetected: string

  operationCounts: Record<OperationType, number>
  currenciesUsed: string[]
  currencyDistribution: Record<string, number>

  tickers: Array<{ ticker: string; isin: string; name: string; count: number }>
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
    dividendPayments: number
    dividendAdjustments: number
    totalDividends: number
    totalInterest: number
    totalFxConversions: number
    stockSplitsOpen: number
    stockSplitsClose: number
    totalSplits: number
  }

  incompleteRows: Array<{ lineNumber: number; reason: string }>
  ambiguousRows: number
  currencyMixIssues: Array<{ lineNumber: number; description: string }>
  duplicateSourceIds: number
}
