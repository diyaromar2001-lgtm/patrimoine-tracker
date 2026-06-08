/**
 * TRADING 212 CSV PARSER — SHARED PURE LOGIC
 *
 * Contains only logic that is environment-independent
 * (no fs, no node-specific modules)
 *
 * Used by both:
 * - trading212-parser.js (Node.js/CLI)
 * - trading212-parser-client.ts (Browser)
 */

// ─── ACTION MAPPING ────────────────────────────────────────────────────────
export const ACTION_MAPPING: Record<string, string> = {
  "Market buy": "buy",
  "Limit buy": "buy",
  "Market sell": "sell",
  "Limit sell": "sell",
  "Deposit": "deposit",
  "Withdrawal": "withdrawal",
  "Dividend": "dividend",
  "Dividend (Dividend)": "dividend",
  "Dividend (Tax exempted)": "dividend_tax_exempted",
  "Dividend adjustment": "dividend_adjustment",
  "Interest on cash": "interest",
  "Currency conversion": "fx_conversion",
  "Stock split open": "split_open",
  "Stock split close": "split_close",
}

// ─── CSV LINE PARSING ─────────────────────────────────────────────────────
export function parseCSVLine(line: string): Record<string, string> {
  const headers = [
    "Action", "Time", "ISIN", "Ticker", "Name", "Notes", "ID",
    "No. of shares", "Price / share", "Currency (Price / share)", "Exchange rate",
    "Result", "Currency (Result)", "Total", "Currency (Total)",
    "Withholding tax", "Currency (Withholding tax)",
    "Currency conversion from amount", "Currency (Currency conversion from amount)",
    "Currency conversion to amount", "Currency (Currency conversion to amount)",
    "Currency conversion fee", "Currency (Currency conversion fee)",
  ]

  const result: Record<string, string> = {}
  const fields = line.split(",")
  headers.forEach((header, i) => {
    result[header] = (fields[i] || "").trim()
  })
  return result
}

// ─── OPERATION NORMALIZATION ──────────────────────────────────────────────
export function normalizeOperation(raw: Record<string, string>, lineNumber: number) {
  const actionRaw = raw.Action || ""
  const type = ACTION_MAPPING[actionRaw] || "unknown"
  const date = raw.Time ? raw.Time.split(" ")[0] : ""

  return {
    type,
    date,
    rawAction: actionRaw,
    lineNumber,
    isin: raw.ISIN || "",
    ticker: raw.Ticker || "",
    name: raw.Name || "",
    notes: raw.Notes || "",
    sourceId: raw.ID || "",
    quantity: parseFloat(raw["No. of shares"]) || 0,
    price: parseFloat(raw["Price / share"]) || 0,
    priceCurrency: raw["Currency (Price / share)"] || "",
    exchangeRate: parseFloat(raw["Exchange rate"]) || 1,
    totalAmount: parseFloat(raw.Total) || 0,
    totalCurrency: raw["Currency (Total)"] || "",
    result: parseFloat(raw.Result) || 0,
    resultCurrency: raw["Currency (Result)"] || "",
    withholdingTax: parseFloat(raw["Withholding tax"]) || 0,
    withholdingTaxCurrency: raw["Currency (Withholding tax)"] || "",
    fromAmount: parseFloat(raw["Currency conversion from amount"]) || 0,
    fromCurrency: raw["Currency (Currency conversion from amount)"] || "",
    toAmount: parseFloat(raw["Currency conversion to amount"]) || 0,
    toCurrency: raw["Currency (Currency conversion to amount)"] || "",
    fxFee: parseFloat(raw["Currency conversion fee"]) || 0,
    fxFeeCurrency: raw["Currency (Currency conversion fee)"] || "",
  }
}

// ─── STOCK SPLIT PAIRING ───────────────────────────────────────────────────
export function pairStockSplits(operations: any[]) {
  const paired = []
  const unpaired = []
  let i = 0

  while (i < operations.length) {
    const op = operations[i]

    if (op.type === "split_open") {
      const closeIdx = operations.findIndex(
        (o: any, idx: number) =>
          idx > i &&
          o.type === "split_close" &&
          o.isin === op.isin &&
          o.sourceId !== op.sourceId
      )

      if (closeIdx !== -1) {
        const closeOp = operations[closeIdx]
        const pairedOp = {
          type: "stock_split",
          date: op.date,
          isin: op.isin,
          ticker: op.ticker,
          name: op.name,
          sourceId: `${op.sourceId}|${closeOp.sourceId}`,
          lineNumbers: [op.lineNumber, closeOp.lineNumber],
          open_source_id: op.sourceId,
          close_source_id: closeOp.sourceId,
          qty_before: op.quantity,
          qty_after: closeOp.quantity,
          price_before: op.price,
          price_after: closeOp.price,
          rawAction: `${op.rawAction} + ${closeOp.rawAction}`,
        }
        paired.push(pairedOp)
        operations.splice(closeIdx, 1)
      } else {
        unpaired.push(op)
      }
    } else if (op.type === "split_close") {
      unpaired.push(op)
    } else {
      paired.push(op)
    }
    i++
  }

  return { paired, unpaired }
}

// ─── PARSE CONTENT (Environment-agnostic) ──────────────────────────────────
/**
 * Core parsing logic - no fs, no crypto dependencies
 * Returns raw operations before checksum
 */
export function parseCSVLines(fileContent: string) {
  const lines = fileContent.split("\n").filter((l) => l.trim())

  if (lines.length < 2) {
    throw new Error("CSV must contain at least header + 1 operation")
  }

  const stats: any = {
    csvLinesRead: lines.length - 1,
    csvLinesValid: 0,
    logicalEvents: 0,
    eventsImported: 0,
    linesGrouped: 0,
    linesRejected: 0,
    linesIgnored: 0,
    unknownActions: new Map<string, number>(),
    orphanedSplits: [] as any[],
  }

  const rawOperations = []
  for (let i = 1; i < lines.length; i++) {
    try {
      const raw = parseCSVLine(lines[i])
      const op = normalizeOperation(raw, i)

      if (op.type === "unknown") {
        stats.unknownActions.set(op.rawAction, (stats.unknownActions.get(op.rawAction) || 0) + 1)
        stats.linesRejected++
      } else {
        rawOperations.push(op)
        stats.csvLinesValid++
      }
    } catch (e) {
      stats.linesRejected++
    }
  }

  const { paired, unpaired } = pairStockSplits(rawOperations)

  if (unpaired.length > 0) {
    stats.orphanedSplits = unpaired
    stats.linesRejected += unpaired.length
  }

  stats.linesGrouped = rawOperations.filter((o: any) => o.type === "split_open" || o.type === "split_close").length
  stats.logicalEvents = paired.length
  stats.eventsImported = paired.length

  const operations = paired.map((op: any, idx: number) => ({
    ...op,
    sourceId: op.sourceId || `${op.type}_${op.date}_${op.ticker || op.isin || "CASH"}_${idx}`,
  }))

  return { operations, stats, content: fileContent }
}
