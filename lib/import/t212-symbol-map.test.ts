import { describe, test, expect } from "vitest"
import { resolveQuoteSymbol, buildTickerAliases, T212_TICKER_TO_YAHOO } from "@/lib/import/t212-symbol-map"

// ---------------------------------------------------------------------------
// T212 symbol resolution — unit tests
//
// Root cause for wrong valuations: T212 EU uses bare tickers for European
// UCITS ETFs.  Without an alias, Yahoo Finance resolves "WSML" and "SMH" to
// unrelated US instruments with 3-5× the correct price.
//
//  WSML bare → some US micro-cap  (366 CHF in app vs 108 CHF in T212)
//  SMH  bare → US VanEck SMH ETF (~$200, not the European UCITS at ~$13)
// ---------------------------------------------------------------------------

describe("resolveQuoteSymbol", () => {
  // ── Critical European UCITS ETFs ─────────────────────────────────────────

  test("WSML → WSML.L (iShares World Small Cap on LSE, not a US ticker)", () => {
    expect(resolveQuoteSymbol("WSML")).toBe("WSML.L")
    expect(resolveQuoteSymbol("wsml")).toBe("WSML.L")   // case-insensitive
  })

  test("SMH → SMH.L (VanEck UCITS on LSE, not the US VanEck SMH at ~$200)", () => {
    expect(resolveQuoteSymbol("SMH")).toBe("SMH.L")
  })

  test("EUNL → EUNL.DE (iShares Core MSCI World on Xetra)", () => {
    expect(resolveQuoteSymbol("EUNL")).toBe("EUNL.DE")
  })

  test("EIMI → EIMI.L (iShares EM IMI on LSE)", () => {
    expect(resolveQuoteSymbol("EIMI")).toBe("EIMI.L")
  })

  test("VUAA → VUAA.L (Vanguard S&P 500 UCITS on LSE)", () => {
    expect(resolveQuoteSymbol("VUAA")).toBe("VUAA.L")
  })

  test("VHYL → VHYL.L (Vanguard All-World High Div on LSE)", () => {
    expect(resolveQuoteSymbol("VHYL")).toBe("VHYL.L")
  })

  test("VHY alias → VHYL.L (T212 export alias maps to same ETF)", () => {
    expect(resolveQuoteSymbol("VHY")).toBe("VHYL.L")
  })

  // ── Swiss stocks ────────────────────────────────────────────────────────

  test("UBS → UBSG.SW (SIX listing, not NYSE ADR)", () => {
    expect(resolveQuoteSymbol("UBS")).toBe("UBSG.SW")
  })

  test("UBSG → UBSG.SW (explicit SIX ticker also maps correctly)", () => {
    expect(resolveQuoteSymbol("UBSG")).toBe("UBSG.SW")
  })

  // ROG.SW was removed: Roche Holding restructured share classes Dec 2024,
  // ROG.SW returns HTTP 404 on Yahoo Finance.  Do NOT add it back without a
  // confirmed working symbol.
  test("ROG → undefined (ROG.SW returns HTTP 404 since Roche Dec-2024 restructuring)", () => {
    expect(resolveQuoteSymbol("ROG")).toBeUndefined()
  })

  // ── ROP = Roper Technologies (NYSE) — must NEVER map to Roche or ROG.SW ──
  //
  // Root cause of "Roche" being stored as name for ROP: T212 CSV uses a naïve
  // comma-split parser; "Roper Technologies, Inc." gets truncated at the comma
  // so only "Roper Technologies" reaches the Name field, or T212 itself had
  // stale/incorrect metadata for this position in a past CSV export.
  // ROP is a plain NYSE ticker — no exchange suffix needed for Yahoo Finance.

  test("ROP → undefined (Roper Technologies is a plain US ticker, no alias needed)", () => {
    expect(resolveQuoteSymbol("ROP")).toBeUndefined()
  })

  test("ROP must NOT resolve to ROG.SW (Roche Holding)", () => {
    expect(resolveQuoteSymbol("ROP")).not.toBe("ROG.SW")
  })

  test("ROP must NOT appear anywhere in T212_TICKER_TO_YAHOO values as Roche-related", () => {
    // Ensure no mapping accidentally routes ROP to a Roche symbol
    expect(T212_TICKER_TO_YAHOO["ROP"]).toBeUndefined()
    const values = Object.values(T212_TICKER_TO_YAHOO)
    // ROG.SW must not exist in the map (it's broken / returns 404)
    expect(values).not.toContain("ROG.SW")
  })

  // ── US stocks — no alias needed ──────────────────────────────────────────

  test("AAPL → undefined (US stock, no alias needed)", () => {
    expect(resolveQuoteSymbol("AAPL")).toBeUndefined()
  })

  test("NVDA → undefined (US stock, no alias needed)", () => {
    expect(resolveQuoteSymbol("NVDA")).toBeUndefined()
  })

  test("O → undefined (Realty Income, NYSE, no alias needed)", () => {
    expect(resolveQuoteSymbol("O")).toBeUndefined()
  })

  test("UNKNOWN_XYZ → undefined (no mapping)", () => {
    expect(resolveQuoteSymbol("UNKNOWN_XYZ")).toBeUndefined()
  })
})

describe("buildTickerAliases", () => {
  test("returns an object with WSML entry pointing to WSML.L", () => {
    const aliases = buildTickerAliases()
    expect(aliases["WSML"]).toEqual(["WSML.L"])
  })

  test("returns an object with SMH entry pointing to SMH.L", () => {
    const aliases = buildTickerAliases()
    expect(aliases["SMH"]).toEqual(["SMH.L"])
  })

  test("no alias for itself (all entries have broker !== yahoo)", () => {
    const aliases = buildTickerAliases()
    for (const [broker, candidates] of Object.entries(aliases)) {
      expect(candidates).not.toContain(broker)
    }
  })

  test("all T212 tickers with a different Yahoo symbol appear in aliases", () => {
    const aliases = buildTickerAliases()
    for (const [broker, yahoo] of Object.entries(T212_TICKER_TO_YAHOO)) {
      if (broker !== yahoo) {
        expect(aliases[broker]).toBeDefined()
        expect(aliases[broker][0]).toBe(yahoo)
      }
    }
  })
})
