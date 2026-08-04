/**
 * lib/dividend-engine.ts — Reconstruction des dividendes RÉELLEMENT perçus.
 *
 * POURQUOI CE MODULE
 *   L'import CSV crée bien des transactions `dividend` aux bonnes dates, mais
 *   avec quantity = 0, price = 0 et net_amount_chf = 0 : les montants sont
 *   perdus. Impossible donc de calculer les revenus depuis les seules
 *   transactions.
 *
 * PRINCIPE
 *   On croise deux sources fiables :
 *     1. l'historique de dividendes de Yahoo (date ex-dividende + montant par
 *        action réellement versé) ;
 *     2. VOTRE historique de transactions, rejoué chronologiquement pour
 *        connaître la quantité détenue à CHAQUE date ex-dividende.
 *
 *   Règle d'éligibilité : on ne perçoit un dividende que si l'action était
 *   détenue AVANT la date ex-dividende. Un achat le jour de l'ex-date ou
 *   après ne donne aucun droit — c'est la règle de marché, et c'est ce qui
 *   évite de surestimer les revenus.
 *
 * HONNÊTETÉ
 *   La retenue à la source n'est pas fournie par Yahoo. Elle n'est donc
 *   JAMAIS inventée : elle vaut `null` sauf si une transaction dividende
 *   réelle porte des frais/impôts, auquel cas on l'utilise.
 */

import type { FXRates } from "./finance"
import { convertCurrency } from "./finance"

// ─── Entrées ────────────────────────────────────────────────────────────────

export interface DividendTxInput {
  ticker: string
  type: string
  quantity: number
  date: string           // YYYY-MM-DD
  /** Retenue à la source réellement facturée, si connue. */
  feesChf?: number | null
  netAmountChf?: number | null
  portfolioId?: string
}

/** Un versement historique tel que publié par Yahoo. */
export interface DividendEvent {
  ticker: string
  /** Date ex-dividende (YYYY-MM-DD). */
  exDate: string
  /** Montant par action, en devise native de la cotation. */
  amountPerShare: number
  currency: string
}

// ─── Sorties ────────────────────────────────────────────────────────────────

export interface ReceivedDividendDetail {
  ticker: string
  exDate: string
  /** Mois de rattachement "YYYY-MM". */
  month: string
  /** Quantité détenue à la veille de l'ex-date. */
  quantityHeld: number
  amountPerShare: number
  nativeCurrency: string
  /** Brut en devise d'affichage. */
  gross: number
  /** Retenue à la source — null si inconnue (jamais estimée). */
  withholding: number | null
  /** Net = brut − retenue connue ; égal au brut si retenue inconnue. */
  net: number
  /** Taux appliqué : 1 unité native = X devise d'affichage. */
  fxRateUsed: number
}

/**
 * Quantité détenue à une date donnée, par rejeu chronologique des
 * achats/ventes. `strictlyBefore` exclut les opérations du jour même —
 * indispensable pour l'éligibilité au dividende (règle de l'ex-date).
 */
export function quantityHeldAt(
  transactions: DividendTxInput[],
  ticker: string,
  date: string,
  strictlyBefore = true
): number {
  let qty = 0
  for (const t of transactions) {
    if (t.ticker !== ticker) continue
    const cmp = t.date.localeCompare(date)
    if (strictlyBefore ? cmp >= 0 : cmp > 0) continue
    if (t.type === "buy") qty += t.quantity
    else if (t.type === "sell") qty -= t.quantity
  }
  return qty > 1e-9 ? qty : 0
}

/**
 * Croise les versements historiques avec la détention réelle.
 * Ne retourne que les lignes effectivement perçues (quantité > 0 à l'ex-date).
 */
export function computeReceivedDividends(
  transactions: DividendTxInput[],
  events: DividendEvent[],
  displayCurrency: string,
  rates: FXRates,
  today: string = new Date().toISOString().slice(0, 10)
): ReceivedDividendDetail[] {
  const out: ReceivedDividendDetail[] = []

  for (const ev of events) {
    // Un versement futur n'est pas encore perçu.
    if (ev.exDate > today) continue

    const quantityHeld = quantityHeldAt(transactions, ev.ticker, ev.exDate)
    if (quantityHeld <= 0) continue

    const grossNative = quantityHeld * ev.amountPerShare
    const gross = convertCurrency(grossNative, ev.currency, displayCurrency, rates)
    const fxRateUsed = grossNative !== 0 ? gross / grossNative : 1

    // Retenue : uniquement si une transaction dividende réelle la porte.
    const userRate = rates[displayCurrency] ?? 1
    const matching = transactions.find(t =>
      t.type === "dividend" &&
      t.ticker === ev.ticker &&
      Math.abs(daysBetween(t.date, ev.exDate)) <= 45 &&
      (t.feesChf ?? 0) > 0
    )
    const withholding = matching ? (matching.feesChf as number) * userRate : null

    out.push({
      ticker: ev.ticker,
      exDate: ev.exDate,
      month: ev.exDate.slice(0, 7),
      quantityHeld,
      amountPerShare: ev.amountPerShare,
      nativeCurrency: ev.currency,
      gross,
      withholding,
      net: gross - (withholding ?? 0),
      fxRateUsed,
    })
  }

  return out.sort((a, b) => b.exDate.localeCompare(a.exDate))
}

function daysBetween(a: string, b: string): number {
  return (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000
}

// ─── Agrégations ────────────────────────────────────────────────────────────

export interface MonthlyDividend {
  month: string          // "YYYY-MM"
  net: number
  gross: number
  details: ReceivedDividendDetail[]
}

export function groupByMonth(details: ReceivedDividendDetail[]): MonthlyDividend[] {
  const map = new Map<string, MonthlyDividend>()
  for (const d of details) {
    let m = map.get(d.month)
    if (!m) { m = { month: d.month, net: 0, gross: 0, details: [] }; map.set(d.month, m) }
    m.net += d.net
    m.gross += d.gross
    m.details.push(d)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export function groupByYear(details: ReceivedDividendDetail[]): Array<{ year: string; net: number }> {
  const map = new Map<string, number>()
  for (const d of details) {
    const y = d.exDate.slice(0, 4)
    map.set(y, (map.get(y) ?? 0) + d.net)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, net]) => ({ year, net }))
}

export function groupByTicker(details: ReceivedDividendDetail[]): Array<{ ticker: string; net: number; pct: number }> {
  const map = new Map<string, number>()
  for (const d of details) map.set(d.ticker, (map.get(d.ticker) ?? 0) + d.net)
  const total = [...map.values()].reduce((s, v) => s + v, 0)
  return [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([ticker, net]) => ({ ticker, net, pct: total > 0 ? (net / total) * 100 : 0 }))
}

export interface DividendSummaryReal {
  /** Net encaissé sur l'année civile en cours. */
  ytdNet: number
  ytdGross: number
  /** Net encaissé sur l'année civile précédente (même période, pour comparaison). */
  previousYearNet: number
  /** Progression YTD vs même période l'an dernier, en % (null si pas de base). */
  yoyPct: number | null
  /** Net encaissé sur les 12 derniers mois glissants. */
  last12mNet: number
  /** Moyenne mensuelle sur les mois réellement couverts. */
  monthlyAvg: number
  totalNet: number
}

export function summarizeReal(
  details: ReceivedDividendDetail[],
  today: string = new Date().toISOString().slice(0, 10)
): DividendSummaryReal {
  const year = today.slice(0, 4)
  const prevYear = String(Number(year) - 1)
  const monthDay = today.slice(4)           // "-MM-DD"
  const cutoff12m = shiftMonths(today, -12)

  const ytd = details.filter(d => d.exDate.startsWith(year))
  // Même fenêtre l'an dernier (1er janvier → même jour) pour une comparaison juste
  const prev = details.filter(d => d.exDate.startsWith(prevYear) && d.exDate <= prevYear + monthDay)
  const last12 = details.filter(d => d.exDate > cutoff12m)

  const ytdNet = sum(ytd.map(d => d.net))
  const previousYearNet = sum(prev.map(d => d.net))
  const monthsCovered = new Set(details.map(d => d.month)).size

  return {
    ytdNet,
    ytdGross: sum(ytd.map(d => d.gross)),
    previousYearNet,
    yoyPct: previousYearNet > 0 ? ((ytdNet - previousYearNet) / previousYearNet) * 100 : null,
    last12mNet: sum(last12.map(d => d.net)),
    monthlyAvg: monthsCovered > 0 ? sum(details.map(d => d.net)) / monthsCovered : 0,
    totalNet: sum(details.map(d => d.net)),
  }
}

/** Prochain versement attendu : premier événement futur sur une ligne détenue. */
export function nextExpectedDividend(
  transactions: DividendTxInput[],
  events: DividendEvent[],
  displayCurrency: string,
  rates: FXRates,
  today: string = new Date().toISOString().slice(0, 10)
): { ticker: string; exDate: string; amount: number; daysAway: number } | null {
  const future = events
    .filter(e => e.exDate > today)
    .sort((a, b) => a.exDate.localeCompare(b.exDate))

  for (const ev of future) {
    // Quantité actuellement détenue (l'ex-date étant future, « aujourd'hui » suffit)
    const qty = quantityHeldAt(transactions, ev.ticker, today, false)
    if (qty <= 0) continue
    return {
      ticker: ev.ticker,
      exDate: ev.exDate,
      amount: convertCurrency(qty * ev.amountPerShare, ev.currency, displayCurrency, rates),
      daysAway: Math.ceil(daysBetween(ev.exDate, today)),
    }
  }
  return null
}

function sum(xs: number[]): number { return xs.reduce((s, v) => s + v, 0) }

function shiftMonths(date: string, delta: number): string {
  const d = new Date(date + "T00:00:00Z")
  d.setUTCMonth(d.getUTCMonth() + delta)
  return d.toISOString().slice(0, 10)
}
