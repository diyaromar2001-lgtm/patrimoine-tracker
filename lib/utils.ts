import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Currency ──────────────────────────────────────────────────────────────────
export type AppCurrency = "CHF" | "USD" | "EUR"
export type FXRates = Record<AppCurrency, number>

// Default FX rates (BCE approximation) — replaced at runtime by /api/fx-rates
// 1 CHF = x USD/EUR. TABLE UNIQUE : lib/finance.ts et lib/quote-currency.ts
// dérivent leurs fallbacks de celle-ci — ne pas dupliquer de littéraux ailleurs.
export const DEFAULT_FX_RATES: FXRates = {
  CHF: 1,
  USD: 1.2571,  // BCE 2026-06
  EUR: 1.0862,  // BCE 2026-06
}

/** Fallback GBP (unités par CHF) pour les tables étendues (finance, quote-currency). */
export const DEFAULT_GBP_PER_CHF = 0.9379  // BCE 2026-06

// Keep FX_RATES as alias for backward compat
export const FX_RATES = DEFAULT_FX_RATES

export function convertCurrency(
  value:  number,
  from:   AppCurrency,
  to:     AppCurrency,
  rates:  FXRates = DEFAULT_FX_RATES
): number {
  if (from === to) return value
  const chf = value / (rates[from] ?? 1)
  return chf * (rates[to] ?? 1)
}

/**
 * Formate un montant financier.
 * - Utilise fr-CH comme locale (espace = séparateur milliers, . = décimale)
 * - Remplace "$US" par "USD" (comportement natif de fr-CH pour le dollar)
 */
export function formatCurrency(
  value:    number,
  currency: AppCurrency = "CHF",
  locale    = "fr-CH"
): string {
  const raw = new Intl.NumberFormat(locale, {
    style:                 "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

  // fr-CH affiche le dollar US comme "$US" → on normalise en "USD"
  return raw.replace(/\$US\s?/g, "USD ").replace(/\s?\$US/g, " USD").trim()
}

/** Formate un % avec signe explicite : +8.99 % ou -0.25 % */
export function formatPercent(value: number, locale = "fr-CH"): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)} %`
}

export function formatNumber(value: number, locale = "fr-CH"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
