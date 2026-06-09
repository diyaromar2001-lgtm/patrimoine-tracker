/**
 * POSITION REPLAY — pure TS mirror of public.recalculate_asset_position()
 * (supabase/migrations/20260609000002_upgrade_lot2_final.sql)
 * ─────────────────────────────────────────────────────────────────────────
 * Chronologically replays BUY / SELL / SPLIT events for one asset and
 * returns the resulting quantity, weighted-average native buy price, and
 * CHF cost basis. Used to unit-test the SQL replay logic against real T212
 * CSV data without needing a live database.
 *
 * SPLIT RATIO CONVENTION
 * ───────────────────────
 * A T212 "Stock split open"/"Stock split close" pair is parsed (see
 * lib/parsers/trading212-parser-shared.ts -> pairStockSplits) into:
 *   qty_before  = the "open" row's quantity   (NEW share-count scale)
 *   qty_after   = the "close" row's quantity  (OLD share-count scale —
 *                  matches the running position quantity accumulated from
 *                  prior BUYs at the moment the split occurs)
 *
 * To convert the running position from the OLD scale to the NEW scale:
 *   ratio = qty_before / qty_after
 *   qty  := qty * ratio
 *   avg  := avg / ratio
 *
 * Example (LCID, real CSV data, 2025-09-02):
 *   qty_before = 0.32451471 (open row,  price 20.7694745200 USD)
 *   qty_after  = 3.24514713 (close row, price  2.0769474300 USD)
 *   ratio = 0.32451471 / 3.24514713 = 0.1  (a 10-for-1 reverse split)
 *
 * NOTE: the SQL function currently computes ratio as
 * `qty_after / qty_before` (=10 for LCID), which is the INVERSE of the
 * correct ratio above and produces a 10x-too-large final quantity.
 */

export type ReplayEventType = "buy" | "sell" | "split"

export interface ReplayEvent {
  type: ReplayEventType
  /** ISO date string (YYYY-MM-DD); used for chronological ordering. */
  date: string
  /** Tie-breaker for events on the same date (e.g. CSV line number / created_at). */
  order?: number
  /** BUY/SELL: number of shares. */
  quantity?: number
  /** BUY: native price per share. */
  price?: number
  /** BUY/SELL: CHF amount affecting cost basis (positive for BUY, used for SELL proportional reduction). */
  baseAmountChf?: number
  /** SPLIT: "open" row quantity (new share-count scale). */
  qtyBefore?: number
  /** SPLIT: "close" row quantity (old share-count scale, == running qty pre-split). */
  qtyAfter?: number
}

export interface ReplayResult {
  quantity: number
  avgBuyPriceNative: number
  costBasisChf: number
}

/**
 * Replay BUY/SELL/SPLIT events in chronological order using the CORRECTED
 * split-ratio formula (qtyBefore / qtyAfter).
 */
export function replayPosition(events: ReplayEvent[]): ReplayResult {
  const sorted = [...events].sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    return (a.order ?? 0) - (b.order ?? 0)
  })

  let qty = 0
  let avg = 0
  let cost = 0

  for (const e of sorted) {
    if (e.type === "split") {
      const before = e.qtyBefore ?? 0
      const after = e.qtyAfter ?? 0
      const ratio = after > 0 ? before / after : 1
      qty *= ratio
      if (ratio > 0) avg /= ratio
    } else if (e.type === "buy") {
      const q = e.quantity ?? 0
      const p = e.price ?? 0
      if (qty > 0) {
        avg = (qty * avg + q * p) / (qty + q)
      } else {
        avg = p
      }
      qty += q
      cost += e.baseAmountChf ?? 0
    } else if (e.type === "sell") {
      const q = e.quantity ?? 0
      if (qty > 0) {
        const costPerUnit = cost / qty
        cost -= q * costPerUnit
        qty -= q
      }
    }
  }

  if (qty < 1e-9) qty = 0
  if (cost < 0) cost = 0

  return {
    quantity: qty,
    avgBuyPriceNative: qty > 0 ? avg : 0,
    costBasisChf: cost,
  }
}
