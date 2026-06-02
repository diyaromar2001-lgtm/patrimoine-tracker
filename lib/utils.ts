import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Currency ──────────────────────────────────────────────────────────────────
export type AppCurrency = "CHF" | "USD" | "EUR"

// Approximate FX rates vs CHF (CHF = 1)
export const FX_RATES: Record<AppCurrency, number> = {
  CHF: 1,
  USD: 1.109,   // 1 CHF ≈ 1.109 USD
  EUR: 1.042,   // 1 CHF ≈ 1.042 EUR
}

/** Convert a value denominated in `from` to `to` currency */
export function convertCurrency(value: number, from: AppCurrency, to: AppCurrency): number {
  if (from === to) return value
  // to CHF first, then to target
  const chf = value / FX_RATES[from]
  return chf * FX_RATES[to]
}

export function formatCurrency(
  value: number,
  currency: AppCurrency = "CHF",
  locale = "fr-CH"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number, locale = "fr-CH"): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value / 100)
}

export function formatNumber(value: number, locale = "fr-CH"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
