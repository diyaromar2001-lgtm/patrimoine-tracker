/**
 * QUOTE CURRENCY NORMALIZATION
 * ─────────────────────────────────────────────────────────────────────────
 * Yahoo Finance quotes many London Stock Exchange instruments (UCITS ETFs,
 * FTSE constituents, ...) in GBX / GBp ("pence sterling") rather than GBP
 * ("pounds sterling"). 1 GBP = 100 GBp = 100 GBX.
 *
 * If this is not corrected, a price of "2208.5 GBp" gets treated as
 * "2208.5 GBP/USD/CHF", inflating the position value by ~100x.
 *
 *   591.01 GBp  → 5.9101 GBP
 *   3428    GBp → 34.28  GBP
 *
 * This module is intentionally side-effect free (no Yahoo client, no fetch)
 * so it can be imported and unit-tested without pulling in `yahoo-finance2`.
 */

/** Currency codes Yahoo returns that represent 1/100 of their "real" unit. */
const PENCE_CURRENCIES = new Set(["GBp", "GBX", "GBX.L"])

export interface NormalizedQuote {
  /** Price expressed in `currency` (already divided by 100 if it was pence). */
  price: number
  /** Normalized ISO-4217-ish currency code. "GBp"/"GBX" become "GBP". */
  currency: string
}

/**
 * Normalize a raw Yahoo Finance (price, currency) pair.
 *
 * - "GBp" / "GBX" (British pence, sometimes "GBX.L") → price / 100, "GBP"
 * - everything else passes through unchanged
 *
 * Never treat a pence-denominated price as if it were already GBP/USD/CHF.
 */
export function normalizeQuotePrice(price: number, currency: string | null | undefined): NormalizedQuote {
  if (currency && PENCE_CURRENCIES.has(currency)) {
    return { price: price / 100, currency: "GBP" }
  }
  return { price, currency: currency ?? "USD" }
}

// ─────────────────────────────────────────────────────────────────────────
// Extended FX conversion (adds GBP on top of the app's CHF/USD/EUR display
// currencies) — used only for converting *native* quote prices to the app's
// display currencies. Does NOT touch lib/utils.ts's AppCurrency, which stays
// CHF | USD | EUR for the UI currency switcher.
// ─────────────────────────────────────────────────────────────────────────

export type ExtendedCurrency = "CHF" | "USD" | "EUR" | "GBP"
export type ExtendedFXRates = Record<ExtendedCurrency, number>

/** Fallback rates (units per 1 CHF) used if the live FX fetch fails. */
export const DEFAULT_EXTENDED_FX_RATES: ExtendedFXRates = {
  CHF: 1,
  USD: 1.267,
  EUR: 1.091,
  GBP: 0.93,
}

/**
 * Convert `value` (in currency `from`) to currency `to`, pivoting through CHF.
 * `rates[X]` = "X units per 1 CHF" (same convention as lib/utils.ts).
 */
export function convertExtended(
  value: number,
  from: ExtendedCurrency,
  to: ExtendedCurrency,
  rates: ExtendedFXRates = DEFAULT_EXTENDED_FX_RATES
): number {
  if (from === to) return value
  const chf = value / (rates[from] ?? 1)
  return chf * (rates[to] ?? 1)
}
