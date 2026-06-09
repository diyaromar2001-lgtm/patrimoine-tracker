import { describe, test, expect } from "vitest"
import { replayPosition, type ReplayEvent } from "./replay-position"
import { parseTrading212CSVContent } from "./parsers/trading212-parser-client"

// ---------------------------------------------------------------------------
// LCID — real T212 export rows (2025-08-21 .. 2025-09-10)
//
// Trading 212 shows ZERO open LCID position (sold out entirely). The app
// previously showed quantity = 32.12695689 (+956% latent P&L) because
// recalculate_asset_position() applied the split ratio inverted
// (qty_after / qty_before = 10) instead of (qty_before / qty_after = 0.1).
//
// With the corrected ratio, the 2025-09-02 "stock split" event converts the
// pre-split running position (3.24514713, the sum of the first 5 buys) down
// to 0.32451471 (10-for-1 reverse split). Adding the 5 post-split buys
// (0.52709868) gives 0.85161339 — which is then fully consumed by the
// 2025-09-10 sell of 0.85161339, leaving exactly 0.
// ---------------------------------------------------------------------------

const T212_HEADER =
  "Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share," +
  "Currency (Price / share),Exchange rate,Result,Currency (Result),Total," +
  "Currency (Total),Withholding tax,Currency (Withholding tax)," +
  "Currency conversion from amount,Currency (Currency conversion from amount)," +
  "Currency conversion to amount,Currency (Currency conversion to amount)," +
  "Currency conversion fee,Currency (Currency conversion fee)"

const LCID_ROWS = [
  'Market buy,2025-08-21 12:11:31,US5494982029,LCID,"Lucid",,EOF37509097633,0.4761904700,2.1000000000,USD,1.00000000,,,1.00,"USD",,,,,,,,',
  'Market buy,2025-08-25 08:08:25,US5494982029,LCID,"Lucid",,EOF37650798207,0.4830917800,2.0700000000,USD,1.00000000,,,1.00,"USD",,,,,,,,',
  'Market buy,2025-08-27 08:00:05,US5494982029,LCID,"Lucid",,EOF37810882241,0.4651162700,2.1500000000,USD,1.00000000,,,1.00,"USD",,,,,,,,',
  'Market buy,2025-08-28 19:28:23,US5494982029,LCID,"Lucid",,EOF37906392460,0.5998368400,2.0800000000,USD,1.24766062,,,1.00,"CHF",,,,,,,,',
  'Market buy,2025-08-29 12:03:53,US5494982029,LCID,"Lucid",,EOF37950640335,1.2209117700,2.0400000000,USD,1.24533000,,,2.00,"CHF",,,,,,,,',
  'Stock split open,2025-09-02 06:06:46,US5494982029,LCID,"Lucid",,EOF38105538117,0.3245147100,20.7694745200,USD,1.24354243,,,5.42,"CHF",,,,,,,,',
  'Stock split close,2025-09-02 06:06:46,US5494982029,LCID,"Lucid",,EOF38105538112,3.2451471300,2.0769474300,USD,1.24354243,0.00,"CHF",5.42,"CHF",,,,,,,,',
  'Market buy,2025-09-02 13:36:35,US5494982029,LCID,"Lucid",,EOF38158422333,0.1008722000,18.5000000000,USD,1.24409046,,,1.50,"CHF",,,,,,,,',
  'Market buy,2025-09-02 19:01:53,US5494982029,LCID,"Lucid",,EOF38162961737,0.2106151700,17.6900000000,USD,1.24192745,,,3.00,"CHF",,,,,,,,',
  'Market buy,2025-09-03 14:07:07,US5494982029,LCID,"Lucid",,EOF38204761718,0.0688998200,18.0700000000,USD,1.24501974,,,1.00,"CHF",,,,,,,,',
  'Market buy,2025-09-04 17:45:02,US5494982029,LCID,"Lucid",,EOF38254683516,0.0795136700,15.5900000000,USD,1.23961811,,,1.00,"CHF",,,,,,,,',
  'Market buy,2025-09-09 13:42:06,US5494982029,LCID,"Lucid",,EOF38504457077,0.0671978200,18.7400000000,USD,1.25928714,,,1.00,"CHF",,,,,,,,',
  'Market sell,2025-09-10 17:22:23,US5494982029,LCID,"Lucid",,EOF38557838784,0.8516133900,19.7900000000,USD,1.25211210,0.54,"CHF",13.44,"CHF",,,,,,,0.02,"CHF"',
]

describe("LCID replay — real T212 CSV operations", () => {
  test("parses 10 buys + 1 sell + 1 stock_split (13 raw rows)", async () => {
    const csv = T212_HEADER + "\n" + LCID_ROWS.join("\n") + "\n"
    const { operations } = await parseTrading212CSVContent(csv)

    const buys = operations.filter((o: any) => o.type === "buy")
    const sells = operations.filter((o: any) => o.type === "sell")
    const splits = operations.filter((o: any) => o.type === "stock_split")

    expect(buys).toHaveLength(10)
    expect(sells).toHaveLength(1)
    expect(splits).toHaveLength(1)

    const split = splits[0] as any
    expect(split.qty_before).toBeCloseTo(0.32451471, 8)   // "open" row (new scale)
    expect(split.qty_after).toBeCloseTo(3.24514713, 8)    // "close" row (old scale, == cum. buys so far)
  })

  test("corrected replay (qtyBefore/qtyAfter ratio) -> final quantity = 0, matching Trading 212", async () => {
    const csv = T212_HEADER + "\n" + LCID_ROWS.join("\n") + "\n"
    const { operations } = await parseTrading212CSVContent(csv)

    const events: ReplayEvent[] = operations.map((op: any, idx: number) => {
      if (op.type === "stock_split") {
        return { type: "split", date: op.date, order: idx, qtyBefore: op.qty_before, qtyAfter: op.qty_after }
      }
      if (op.type === "sell") {
        return { type: "sell", date: op.date, order: idx, quantity: op.quantity }
      }
      return { type: "buy", date: op.date, order: idx, quantity: op.quantity, price: op.price, baseAmountChf: op.totalCurrency === "CHF" ? op.totalAmount : 0 }
    })

    const result = replayPosition(events)

    // Trading 212 shows LCID as fully sold (absent from open positions).
    expect(result.quantity).toBeCloseTo(0, 8)
  })

  test("documents the bug: INVERTED ratio (qtyAfter/qtyBefore) gives the previously-observed wrong quantity ~32.127", async () => {
    const csv = T212_HEADER + "\n" + LCID_ROWS.join("\n") + "\n"
    const { operations } = await parseTrading212CSVContent(csv)

    // Replicate the OLD (buggy) SQL formula: ratio = qty_after / qty_before
    let qty = 0
    for (const op of operations as any[]) {
      if (op.type === "stock_split") {
        const ratio = op.qty_before > 0 ? op.qty_after / op.qty_before : 1
        qty *= ratio
      } else if (op.type === "buy") {
        qty += op.quantity
      } else if (op.type === "sell") {
        qty -= op.quantity
      }
    }

    expect(qty).toBeCloseTo(32.12695689, 6) // matches the app's previously-displayed (wrong) quantity
    expect(qty).not.toBeCloseTo(0, 2)
  })
})
