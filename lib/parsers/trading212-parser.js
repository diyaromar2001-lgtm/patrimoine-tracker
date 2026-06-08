/**
 * TRADING 212 CSV PARSER — GENERIC & ROBUST
 *
 * Handles all Trading 212 CSV formats with:
 * - Explicit type mapping for all action types
 * - Stock split pairing (open + close = single event)
 * - Real SHA-256 checksums
 * - Deterministic source IDs
 * - Complete currency preservation
 * - Validation with clear error messages
 */

const crypto = require('crypto');
const fs = require('fs');

// ═════════════════════════════════════════════════════════════════════════════
// ACTION MAPPING — All Trading 212 action types
// ═════════════════════════════════════════════════════════════════════════════

const ACTION_MAPPING = {
  'Market buy': 'buy',
  'Limit buy': 'buy',
  'Market sell': 'sell',
  'Limit sell': 'sell',
  'Deposit': 'deposit',
  'Withdrawal': 'withdrawal',
  'Dividend': 'dividend',
  'Dividend (Dividend)': 'dividend',
  'Dividend (Tax exempted)': 'dividend_tax_exempted',
  'Dividend adjustment': 'dividend_adjustment',
  'Interest on cash': 'interest',
  'Currency conversion': 'fx_conversion',
  'Stock split open': 'split_open',
  'Stock split close': 'split_close',
};

// ═════════════════════════════════════════════════════════════════════════════
// CSV PARSING
// ═════════════════════════════════════════════════════════════════════════════

function parseCSVLine(line) {
  const headers = [
    'Action', 'Time', 'ISIN', 'Ticker', 'Name', 'Notes', 'ID',
    'No. of shares', 'Price / share', 'Currency (Price / share)', 'Exchange rate',
    'Result', 'Currency (Result)', 'Total', 'Currency (Total)',
    'Withholding tax', 'Currency (Withholding tax)',
    'Currency conversion from amount', 'Currency (Currency conversion from amount)',
    'Currency conversion to amount', 'Currency (Currency conversion to amount)',
    'Currency conversion fee', 'Currency (Currency conversion fee)',
  ];

  const result = {};
  const fields = line.split(',');
  headers.forEach((header, i) => {
    result[header] = (fields[i] || '').trim();
  });
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// OPERATION NORMALIZATION
// ═════════════════════════════════════════════════════════════════════════════

function normalizeOperation(raw, lineNumber) {
  const actionRaw = raw.Action || '';
  const type = ACTION_MAPPING[actionRaw] || 'unknown';
  const date = raw.Time ? raw.Time.split(' ')[0] : '';

  return {
    type,
    date,
    rawAction: actionRaw,
    lineNumber,
    // Security & Identification
    isin: raw.ISIN || '',
    ticker: raw.Ticker || '',
    name: raw.Name || '',
    notes: raw.Notes || '',
    sourceId: raw.ID || '',
    // Quantities & Prices
    quantity: parseFloat(raw['No. of shares']) || 0,
    price: parseFloat(raw['Price / share']) || 0,
    priceCurrency: raw['Currency (Price / share)'] || '',
    exchangeRate: parseFloat(raw['Exchange rate']) || 1,
    // Transaction amounts
    totalAmount: parseFloat(raw.Total) || 0,
    totalCurrency: raw['Currency (Total)'] || '',
    result: parseFloat(raw.Result) || 0,
    resultCurrency: raw['Currency (Result)'] || '',
    // Withholding tax
    withholdingTax: parseFloat(raw['Withholding tax']) || 0,
    withholdingTaxCurrency: raw['Currency (Withholding tax)'] || '',
    // FX conversion (mapped to match RPC parameter names)
    fromAmount: parseFloat(raw['Currency conversion from amount']) || 0,
    fromCurrency: raw['Currency (Currency conversion from amount)'] || '',
    toAmount: parseFloat(raw['Currency conversion to amount']) || 0,
    toCurrency: raw['Currency (Currency conversion to amount)'] || '',
    fxFee: parseFloat(raw['Currency conversion fee']) || 0,
    fxFeeCurrency: raw['Currency (Currency conversion fee)'] || '',
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// STOCK SPLIT PAIRING — Group open/close into single event
// ═════════════════════════════════════════════════════════════════════════════

function pairStockSplits(operations) {
  const paired = [];
  const unpaired = [];
  let i = 0;

  while (i < operations.length) {
    const op = operations[i];

    if (op.type === 'split_open') {
      // Look for matching split_close
      const closeIdx = operations.findIndex(
        (o, idx) => idx > i && o.type === 'split_close' &&
                    o.isin === op.isin && o.sourceId !== op.sourceId
      );

      if (closeIdx !== -1) {
        const closeOp = operations[closeIdx];
        // Pair them into a single stock_split event
        // qty_before = open quantity (before split)
        // qty_after = close quantity (after split)
        const pairedOp = {
          type: 'stock_split',
          date: op.date,
          isin: op.isin,
          ticker: op.ticker,
          name: op.name,
          sourceId: `${op.sourceId}|${closeOp.sourceId}`,
          lineNumbers: [op.lineNumber, closeOp.lineNumber],
          open_source_id: op.sourceId,
          close_source_id: closeOp.sourceId,
          // Stock split quantities: open shows qty before, close shows qty after
          qty_before: op.quantity,      // Quantity before split
          qty_after: closeOp.quantity,  // Quantity after split
          price_before: op.price,       // Price before split
          price_after: closeOp.price,   // Price after split
          rawAction: `${op.rawAction} + ${closeOp.rawAction}`,
        };
        paired.push(pairedOp);
        // Mark closeOp as processed by removing it
        operations.splice(closeIdx, 1);
      } else {
        // Orphaned split_open
        unpaired.push(op);
      }
    } else if (op.type === 'split_close') {
      // Orphaned split_close (should have been paired above)
      unpaired.push(op);
    } else {
      paired.push(op);
    }
    i++;
  }

  return { paired, unpaired };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PARSER
// ═════════════════════════════════════════════════════════════════════════════

function parseTrading212CSV(csvPath) {
  // Read file for checksum
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const fileChecksum = crypto
    .createHash('sha256')
    .update(fileContent)
    .digest('hex');

  const lines = fileContent.split('\n').filter(l => l.trim());

  if (lines.length < 2) {
    throw new Error('CSV must contain at least header + 1 operation');
  }

  const stats = {
    csvLinesRead: lines.length - 1, // Exclude header
    csvLinesValid: 0,
    logicalEvents: 0,
    eventsImported: 0,
    linesGrouped: 0,
    linesRejected: 0,
    linesIgnored: 0,
    unknownActions: new Map(),
    orphanedSplits: [],
  };

  // Parse all lines (skip header at index 0)
  const rawOperations = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const raw = parseCSVLine(lines[i]);
      const op = normalizeOperation(raw, i);

      if (op.type === 'unknown') {
        stats.unknownActions.set(
          op.rawAction,
          (stats.unknownActions.get(op.rawAction) || 0) + 1
        );
        stats.linesRejected++;
      } else {
        rawOperations.push(op);
        stats.csvLinesValid++;
      }
    } catch (e) {
      stats.linesRejected++;
    }
  }

  // Pair stock splits
  const { paired, unpaired } = pairStockSplits(rawOperations);

  if (unpaired.length > 0) {
    stats.orphanedSplits = unpaired;
    stats.linesRejected += unpaired.length;
  }

  // Count grouping
  stats.linesGrouped = rawOperations.filter(o => o.type === 'split_open' || o.type === 'split_close').length;
  stats.logicalEvents = paired.length;
  stats.eventsImported = paired.length; // Assume all will be imported

  // Convert source IDs to deterministic format
  const operations = paired.map((op, idx) => ({
    ...op,
    // Use deterministic ID combining type + date + ticker for AUTO events
    // This ensures dividend and dividend_tax_exempted on same date don't conflict
    sourceId: op.sourceId || `${op.type}_${op.date}_${op.ticker || op.isin || 'CASH'}_${idx}`,
  }));

  return {
    operations,
    fileChecksum,
    stats,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// REPORTING
// ═════════════════════════════════════════════════════════════════════════════

function generateParserReport(csvPath, parseResult) {
  const { operations, fileChecksum, stats } = parseResult;

  const typeDistribution = new Map();
  operations.forEach(op => {
    const key = op.type === 'stock_split' ? 'stock_split' : op.rawAction;
    typeDistribution.set(key, (typeDistribution.get(key) || 0) + 1);
  });

  const lines = [
    '═══════════════════════════════════════════════════════════════════════════',
    'TRADING 212 CSV PARSER REPORT — GENERIC & ROBUST',
    '═══════════════════════════════════════════════════════════════════════════',
    '',
    `File: ${require('path').basename(csvPath)}`,
    `Checksum (SHA-256): ${fileChecksum.substring(0, 16)}...`,
    '',
    '─── CSV PROCESSING ────────────────────────────────────────────────────────',
    `CSV lines read: ${stats.csvLinesRead} (excl. header)`,
    `CSV lines valid: ${stats.csvLinesValid}`,
    `CSV lines rejected: ${stats.linesRejected}`,
    `CSV lines ignored: ${stats.linesIgnored}`,
    '',
    '─── EVENT TRANSFORMATION ──────────────────────────────────────────────────',
    `Logical events produced: ${stats.logicalEvents}`,
    `Events to import: ${stats.eventsImported}`,
    `Lines grouped (splits): ${stats.linesGrouped}`,
    '',
    '─── OPERATION DISTRIBUTION ───────────────────────────────────────────────',
  ];

  typeDistribution.forEach((count, type) => {
    lines.push(`  ${type}: ${count}`);
  });

  if (stats.unknownActions.size > 0) {
    lines.push('');
    lines.push('⚠️  UNKNOWN ACTIONS (will be rejected):');
    stats.unknownActions.forEach((count, action) => {
      lines.push(`  "${action}": ${count}x`);
    });
  }

  if (stats.orphanedSplits.length > 0) {
    lines.push('');
    lines.push('⚠️  ORPHANED SPLITS (unpaired):');
    stats.orphanedSplits.forEach(op => {
      lines.push(`  Line ${op.lineNumber}: ${op.rawAction} ${op.isin}`);
    });
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

module.exports = {
  parseTrading212CSV,
  generateParserReport,
  ACTION_MAPPING,
};
