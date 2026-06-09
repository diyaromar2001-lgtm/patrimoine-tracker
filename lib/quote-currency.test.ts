import { describe, test, expect } from "vitest"
import {
  normalizeQuotePrice,
  convertExtended,
  DEFAULT_EXTENDED_FX_RATES,
} from "./quote-currency"

// ---------------------------------------------------------------------------
// normalizeQuotePrice — GBp/GBX (British pence) → GBP
//
// Many LSE-listed UCITS ETFs (IDVY.L, etc.) are quoted by Yahoo in pence
// ("GBp"/"GBX"), not pounds ("GBP"). 1 GBP = 100 GBp/GBX. Treating the raw
// pence value as GBP/USD/CHF inflates the position value by ~100x.
// ---------------------------------------------------------------------------

describe("normalizeQuotePrice", () => {
  test("591.01 GBp → 5.9101 GBP", () => {
    expect(normalizeQuotePrice(591.01, "GBp")).toEqual({ price: 5.9101, currency: "GBP" })
  })

  test("3428 GBp → 34.28 GBP", () => {
    const result = normalizeQuotePrice(3428, "GBp")
    expect(result.currency).toBe("GBP")
    expect(result.price).toBeCloseTo(34.28, 6)
  })

  test("591.01 GBX → 5.9101 GBP (GBX is an alternate spelling of GBp)", () => {
    expect(normalizeQuotePrice(591.01, "GBX")).toEqual({ price: 5.9101, currency: "GBP" })
  })

  test("2208.5 GBp → 22.085 GBP (IDVY.L example)", () => {
    const result = normalizeQuotePrice(2208.5, "GBp")
    expect(result.currency).toBe("GBP")
    expect(result.price).toBeCloseTo(22.085, 6)
  })

  test("66.845 GBP passes through unchanged (already pounds, e.g. VHYL.L)", () => {
    expect(normalizeQuotePrice(66.845, "GBP")).toEqual({ price: 66.845, currency: "GBP" })
  })

  test("106.88 USD passes through unchanged (SMH.L example)", () => {
    expect(normalizeQuotePrice(106.88, "USD")).toEqual({ price: 106.88, currency: "USD" })
  })

  test("never treats a GBp price as if it were already USD/GBP", () => {
    const result = normalizeQuotePrice(591.01, "GBp")
    expect(result.price).not.toBe(591.01)
    expect(result.currency).not.toBe("USD")
  })

  test("missing currency defaults to USD passthrough", () => {
    expect(normalizeQuotePrice(100, undefined)).toEqual({ price: 100, currency: "USD" })
    expect(normalizeQuotePrice(100, null)).toEqual({ price: 100, currency: "USD" })
  })
})

// ---------------------------------------------------------------------------
// convertExtended — CHF/USD/EUR/GBP conversion via CHF pivot
// ---------------------------------------------------------------------------

describe("convertExtended", () => {
  test("same currency is a no-op", () => {
    expect(convertExtended(100, "GBP", "GBP")).toBe(100)
  })

  test("GBP → CHF uses the GBP rate (units per 1 CHF)", () => {
    const rates = { ...DEFAULT_EXTENDED_FX_RATES, GBP: 0.9 }
    // 9 GBP / 0.9 (GBP per CHF) = 10 CHF
    expect(convertExtended(9, "GBP", "CHF", rates)).toBeCloseTo(10, 6)
  })

  test("CHF → GBP uses the GBP rate", () => {
    const rates = { ...DEFAULT_EXTENDED_FX_RATES, GBP: 0.9 }
    expect(convertExtended(10, "CHF", "GBP", rates)).toBeCloseTo(9, 6)
  })

  test("normalize then convert: 2208.5 GBp → 22.085 GBP → CHF", () => {
    const rates = { ...DEFAULT_EXTENDED_FX_RATES, GBP: 0.93787 } // live rate 2026-06-09
    const normalized = normalizeQuotePrice(2208.5, "GBp")
    const chf = convertExtended(normalized.price, normalized.currency as "GBP", "CHF", rates)
    // 22.085 / 0.93787 ≈ 23.55 CHF
    expect(chf).toBeCloseTo(23.547, 2)
  })
})
