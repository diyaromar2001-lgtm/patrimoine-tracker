/**
 * POST /api/portfolio-history
 *
 * Calcule la valeur historique RÉELLE du portefeuille en CHF
 * en multipliant les quantités détenues par les prix historiques.
 *
 * Formule:
 *   portfolioValue(date) = Σ qty[ticker] × price[ticker][date]
 *
 * Note: utilise les quantités ACTUELLES (approximation correcte
 * si le portefeuille a été constitué progressivement sur une courte période).
 */

import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"
import { DEFAULT_FX_RATES } from "@/lib/utils"
import type { FXRates } from "@/lib/utils"
import { buildTickerAliases } from "@/lib/import/t212-symbol-map"
import { normalizeQuotePrice } from "@/lib/quote-currency"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

export interface PortfolioAsset {
  ticker:       string
  quantity:     number
  nativeCurrency: string   // "USD", "EUR", "CHF"
}

export interface PortfolioHistoryPoint {
  date:  string  // "YYYY-MM-DD"
  value: number  // in the requested currency
}

// T212 EU utilise des tickers bruts (EUNL, WSML, SMH…) que Yahoo ne résout
// pas : sans alias d'échange, chart() échoue et la courbe restait vide.
// Même table que /api/prices — l'alias est essayé AVANT le ticker brut.
const TICKER_ALIASES: Record<string, string[]> = {
  ...buildTickerAliases(),
  VUAA: ["VUAA.L", "VUAA.MI", "VUAA.DE"],
}

/**
 * Prix hebdomadaires de clôture, en devise NATIVE de la cotation retenue.
 * Retourne aussi la devise réelle renvoyée par Yahoo : elle peut différer de
 * celle stockée en base (ex. IDVY coté en GBp), et les pence sont normalisés.
 */
async function fetchWeeklyPrices(
  ticker: string,
  period1: string
): Promise<{ prices: Map<string, number>; currency: string | null }> {
  const map = new Map<string, number>()
  const aliases = TICKER_ALIASES[ticker.toUpperCase()] ?? []
  const candidates = aliases.length > 0 ? [...new Set([...aliases, ticker])] : [ticker]

  for (const candidate of candidates) {
    try {
      const raw = await yf.chart(candidate, {
        period1,
        period2: new Date().toISOString().slice(0, 10),
        interval: "1wk",
      }) as unknown as {
        quotes: Array<{ date: Date; close: number | null }>
        meta?: { currency?: string }
      }

      const rawCurrency = raw.meta?.currency ?? null
      for (const q of raw.quotes ?? []) {
        if (q.close != null) {
          // GBp/GBX (pence) → GBP, sinon inchangé
          const { price } = normalizeQuotePrice(q.close, rawCurrency)
          map.set(new Date(q.date).toISOString().slice(0, 10), price)
        }
      }
      if (map.size > 0) {
        const currency = rawCurrency
          ? normalizeQuotePrice(1, rawCurrency).currency
          : null
        return { prices: map, currency }
      }
    } catch { /* candidat suivant */ }
  }
  return { prices: map, currency: null }
}

// Get live FX rates — GBP inclus (ETF LSE cotés en GBp/GBP)
async function getFxRates(): Promise<FXRates> {
  const result = await cacheFetch("fx-for-history", async () => {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=CHF&to=USD,EUR,GBP")
      if (!res.ok) throw new Error("FX fetch failed")
      const d: { rates: { USD: number; EUR: number; GBP: number } } = await res.json()
      return { CHF: 1, USD: d.rates.USD, EUR: d.rates.EUR, GBP: d.rates.GBP }
    } catch { return { ...DEFAULT_FX_RATES, GBP: 0.9379 } }
  }, 3600)
  return result as unknown as FXRates
}

// Convert native price to CHF (or target currency)
function toUserCurrency(
  nativePrice:    number,
  nativeCurrency: string,
  rates:          FXRates,
  targetCurrency: string = "CHF"
): number {
  if (nativeCurrency === targetCurrency) return nativePrice
  const chf = nativePrice / ((rates as Record<string, number>)[nativeCurrency] ?? 1)
  return chf * ((rates as Record<string, number>)[targetCurrency] ?? 1)
}

export async function POST(req: NextRequest) {
  const body: { assets: PortfolioAsset[]; currency?: string; period?: string } = await req.json()
  const { assets = [], currency = "CHF", period = "1Y" } = body

  if (!assets.length) {
    return NextResponse.json({ history: [], coverage: { resolved: 0, total: 0, missing: [] } })
  }

  // Determine how far back to go
  const daysBack: Record<string, number> = {
    "1W": 7, "1M": 30, "3M": 90, "6M": 180,
    "1Y": 365, "2Y": 730, "5Y": 1825, "MAX": 1825,
  }
  const days = daysBack[period] ?? 365
  const period1 = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const rates = await getFxRates()

  // Prix hebdomadaires pour chaque ticker, en parallèle (cache 1 h)
  const priceData = new Map<string, { prices: Map<string, number>; currency: string | null }>()
  await Promise.all(
    assets.map(async (asset) => {
      const cacheKey = `port-history-v2:${asset.ticker}:${period}`
      const res = await cacheFetch(cacheKey, () => fetchWeeklyPrices(asset.ticker, period1), 3600)
      priceData.set(asset.ticker, res as { prices: Map<string, number>; currency: string | null })
    })
  )

  // Un ticker non résolu sur Yahoo est EXCLU de la série : l'inclure à 0
  // fausserait la courbe, et bloquer toute la courbe (ancien comportement
  // « tous les actifs ou rien ») la rendait vide dès qu'un seul ticker
  // échouait. On signale la couverture au client pour rester honnête.
  const resolved = assets.filter(a => (priceData.get(a.ticker)?.prices.size ?? 0) > 0)
  const missing  = assets.filter(a => (priceData.get(a.ticker)?.prices.size ?? 0) === 0).map(a => a.ticker)

  const coverage = { resolved: resolved.length, total: assets.length, missing }

  if (!resolved.length) {
    return NextResponse.json({ history: [], coverage })
  }

  // Toutes les dates disponibles, tous tickers résolus confondus
  const allDates = new Set<string>()
  for (const a of resolved) {
    for (const date of priceData.get(a.ticker)!.prices.keys()) allDates.add(date)
  }
  const sortedDates = [...allDates].sort()

  // Valeur du portefeuille à chaque date, en reportant le dernier prix connu.
  // Un point n'est émis que lorsque TOUS les actifs résolus ont déjà cotré au
  // moins une fois — sinon la courbe démarrerait par une marche artificielle.
  const lastKnownPrice = new Map<string, number>()
  const history: PortfolioHistoryPoint[] = []

  for (const date of sortedDates) {
    for (const asset of resolved) {
      const price = priceData.get(asset.ticker)!.prices.get(date)
      if (price != null) lastKnownPrice.set(asset.ticker, price)
    }

    if (!resolved.every(a => lastKnownPrice.has(a.ticker))) continue

    let totalValue = 0
    for (const asset of resolved) {
      const p = lastKnownPrice.get(asset.ticker)!
      // Devise réellement renvoyée par Yahoo si connue (plus fiable que celle
      // stockée en base, souvent 'CHF' par défaut à l'import).
      const curr = priceData.get(asset.ticker)!.currency ?? asset.nativeCurrency
      totalValue += toUserCurrency(p * asset.quantity, curr, rates, currency)
    }

    if (totalValue > 0) {
      history.push({ date, value: Math.round(totalValue * 100) / 100 })
    }
  }

  return NextResponse.json({ history, coverage })
}
