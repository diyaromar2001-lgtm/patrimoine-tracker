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

// Fetch weekly close prices for a ticker
async function fetchWeeklyPrices(
  ticker: string,
  period1: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const raw = await yf.chart(ticker, {
      period1,
      period2: new Date().toISOString().slice(0, 10),
      interval: "1wk",
    }) as unknown as { quotes: Array<{ date: Date; close: number | null }> }

    for (const q of raw.quotes ?? []) {
      if (q.close != null) {
        const dateStr = new Date(q.date).toISOString().slice(0, 10)
        map.set(dateStr, q.close)
      }
    }
  } catch { /* skip ticker on error */ }
  return map
}

// Get live FX rates
async function getFxRates(): Promise<FXRates> {
  const result = await cacheFetch("fx-for-history", async () => {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=CHF&to=USD,EUR")
      if (!res.ok) throw new Error("FX fetch failed")
      const d: { rates: { USD: number; EUR: number } } = await res.json()
      return { CHF: 1, USD: d.rates.USD, EUR: d.rates.EUR }
    } catch { return DEFAULT_FX_RATES }
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
    return NextResponse.json([])
  }

  // Determine how far back to go
  const daysBack: Record<string, number> = {
    "1W": 7, "1M": 30, "3M": 90, "6M": 180,
    "1Y": 365, "2Y": 730, "5Y": 1825, "MAX": 1825,
  }
  const days = daysBack[period] ?? 365
  const period1 = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const rates = await getFxRates()

  // Fetch weekly prices for all tickers in parallel (cached 1h)
  const pricesByTicker = new Map<string, Map<string, number>>()
  await Promise.all(
    assets.map(async (asset) => {
      const cacheKey = `port-history-prices:${asset.ticker}:${period}`
      const prices = await cacheFetch(cacheKey, () => fetchWeeklyPrices(asset.ticker, period1), 3600)
      pricesByTicker.set(asset.ticker, prices as Map<string, number>)
    })
  )

  // Collect all unique dates across all tickers
  const allDates = new Set<string>()
  for (const prices of pricesByTicker.values()) {
    for (const date of (prices as Map<string, number>).keys()) {
      allDates.add(date)
    }
  }

  const sortedDates = [...allDates].sort()
  if (!sortedDates.length) return NextResponse.json([])

  // For each date, compute portfolio value
  // We carry forward the last known price for each ticker (fill gaps)
  const lastKnownPrice = new Map<string, number>()
  const history: PortfolioHistoryPoint[] = []

  for (const date of sortedDates) {
    let totalValue = 0
    let allPricesKnown = false

    for (const asset of assets) {
      const prices = pricesByTicker.get(asset.ticker) as Map<string, number> | undefined
      const price  = prices?.get(date)

      if (price != null) {
        lastKnownPrice.set(asset.ticker, price)
      }

      const p = lastKnownPrice.get(asset.ticker)
      if (p != null) {
        const valueInUserCurr = toUserCurrency(p * asset.quantity, asset.nativeCurrency, rates, currency)
        totalValue += valueInUserCurr
        allPricesKnown = true
      }
    }

    if (allPricesKnown && totalValue > 0) {
      history.push({ date, value: Math.round(totalValue * 100) / 100 })
    }
  }

  return NextResponse.json(history)
}
