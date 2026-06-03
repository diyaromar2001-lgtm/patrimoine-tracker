import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Currency ──────────────────────────────────────────────────────────────────
export type AppCurrency = "CHF" | "USD" | "EUR"

export const FX_RATES: Record<AppCurrency, number> = {
  CHF: 1,
  USD: 1.109,
  EUR: 1.042,
}

export function convertCurrency(value: number, from: AppCurrency, to: AppCurrency): number {
  if (from === to) return value
  const chf = value / FX_RATES[from]
  return chf * FX_RATES[to]
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
