/**
 * lib/dividends.ts — Calculs purs des revenus de dividendes (source de vérité).
 *
 * RÈGLE CENTRALE : distinguer strictement
 *  - RÉEL    : transactions type "dividend" déjà encaissées (brut/impôt/net) ;
 *  - ESTIMÉ  : projections issues des taux Yahoo (dividendRate × quantité).
 * Jamais de date inventée, jamais de fusion silencieuse des deux.
 *
 * Convention FX : rates[X] = unités de X pour 1 CHF (comme lib/finance.ts).
 */

import type { FXRates } from "./finance"
import { convertCurrency } from "./finance"

export interface DividendTxLike {
  type: string
  ticker: string
  quantity: number
  price: number
  currency?: string
  date: string           // YYYY-MM-DD
  netAmountChf?: number | null
  grossAmountChf?: number | null
  feesChf?: number | null   // retenue à la source éventuelle mappée en frais
}

export interface ReceivedDividend {
  ticker: string
  date: string
  /** Montants en devise d'affichage — une seule conversion. */
  gross: number
  withholding: number
  net: number
  nativeCurrency: string
}

/** Convertit une transaction dividende en montants d'affichage (1 conversion). */
export function toReceivedDividend(
  t: DividendTxLike,
  displayCurrency: string,
  rates: FXRates
): ReceivedDividend {
  const userRate = rates[displayCurrency] ?? 1
  const gross = t.grossAmountChf != null
    ? t.grossAmountChf * userRate
    : convertCurrency(t.quantity * t.price, t.currency ?? "CHF", displayCurrency, rates)
  const withholding = (t.feesChf ?? 0) * userRate
  const net = t.netAmountChf != null ? t.netAmountChf * userRate : gross - withholding
  return { ticker: t.ticker, date: t.date, gross, withholding, net, nativeCurrency: t.currency ?? "CHF" }
}

export interface DividendSummary {
  receivedYtdNet: number
  receivedYtdGross: number
  withholdingYtd: number
  received12mNet: number
  monthlyAvg12m: number
  /** Historique trié du plus récent au plus ancien. */
  history: ReceivedDividend[]
  /** Net par ticker (12 derniers mois), trié décroissant. */
  byTicker: Array<{ ticker: string; net: number; pct: number }>
  /** Part du 1er distributeur dans les revenus 12 mois (0-100). */
  topConcentrationPct: number
}

export function summarizeDividends(
  transactions: DividendTxLike[],
  displayCurrency: string,
  rates: FXRates,
  today: Date = new Date()
): DividendSummary {
  const yearStart = `${today.getFullYear()}-01-01`
  const cutoff12m = new Date(today.getFullYear(), today.getMonth() - 11, 1).toISOString().slice(0, 10)

  const history = transactions
    .filter(t => t.type === "dividend")
    .map(t => toReceivedDividend(t, displayCurrency, rates))
    .sort((a, b) => b.date.localeCompare(a.date))

  const ytd = history.filter(d => d.date >= yearStart)
  const last12 = history.filter(d => d.date >= cutoff12m)

  const receivedYtdNet = ytd.reduce((s, d) => s + d.net, 0)
  const receivedYtdGross = ytd.reduce((s, d) => s + d.gross, 0)
  const withholdingYtd = ytd.reduce((s, d) => s + d.withholding, 0)
  const received12mNet = last12.reduce((s, d) => s + d.net, 0)
  const monthsWithData = Math.max(1, new Set(last12.map(d => d.date.slice(0, 7))).size)

  const byTickerMap: Record<string, number> = {}
  for (const d of last12) byTickerMap[d.ticker] = (byTickerMap[d.ticker] ?? 0) + d.net
  const byTicker = Object.entries(byTickerMap)
    .sort(([, a], [, b]) => b - a)
    .map(([ticker, net]) => ({ ticker, net, pct: received12mNet > 0 ? (net / received12mNet) * 100 : 0 }))

  return {
    receivedYtdNet,
    receivedYtdGross,
    withholdingYtd,
    received12mNet,
    monthlyAvg12m: received12mNet / monthsWithData,
    history,
    byTicker,
    topConcentrationPct: byTicker[0]?.pct ?? 0,
  }
}

// ─── Projections (ESTIMÉ — taux Yahoo) ──────────────────────────────────────

export interface HoldingLike {
  ticker: string
  quantity: number
}

export interface DividendRateInfo {
  ticker: string
  /** Dividende annuel par action, devise native de l'actif. */
  annualRatePerShare?: number | null
  currency?: string
}

/** Revenu annuel ESTIMÉ (devise d'affichage) depuis les taux Yahoo. */
export function estimateAnnualIncome(
  holdings: HoldingLike[],
  rates: DividendRateInfo[],
  displayCurrency: string,
  fxRates: FXRates
): number {
  const byTicker = new Map(rates.map(r => [r.ticker, r]))
  return holdings.reduce((s, h) => {
    const r = byTicker.get(h.ticker)
    if (!r?.annualRatePerShare || r.annualRatePerShare <= 0) return s
    return s + convertCurrency(h.quantity * r.annualRatePerShare, r.currency ?? "USD", displayCurrency, fxRates)
  }, 0)
}

/** Rendement courant (%) = revenu annuel estimé / valeur actuelle. */
export function currentYieldPct(annualIncome: number, portfolioValue: number): number {
  return portfolioValue > 0 ? (annualIncome / portfolioValue) * 100 : 0
}

/** Rendement sur coût (%) = revenu annuel estimé / coût d'acquisition. */
export function yieldOnCostPct(annualIncome: number, costBasis: number): number {
  return costBasis > 0 ? (annualIncome / costBasis) * 100 : 0
}

/**
 * Capital nécessaire pour un revenu mensuel cible au rendement courant.
 * Retourne null si le rendement est nul (hypothèse impossible — pas de chiffre inventé).
 */
export function capitalForMonthlyIncome(targetMonthly: number, currentYieldPercent: number): number | null {
  if (currentYieldPercent <= 0) return null
  return (targetMonthly * 12) / (currentYieldPercent / 100)
}
