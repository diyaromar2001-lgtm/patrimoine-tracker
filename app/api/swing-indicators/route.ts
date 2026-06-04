import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

/**
 * Indicateurs swing trading (horizon 1-4 semaines)
 *
 * Calculs:
 *  - rsi14:        RSI sur 14 jours
 *  - ma20:         moyenne mobile 20 jours (≈ 1 mois)
 *  - ma50:         moyenne mobile 50 jours
 *  - distMa20Pct:  écart du prix actuel vs MA20 (%)
 *  - volRatio:     volume actuel / volume moyen 20j
 *  - vol20:        volatilité (std des returns) sur 20 jours
 *  - high4w:       plus haut 28 jours
 *  - low4w:        plus bas 28 jours
 *  - signal:       BUY / HOLD / SELL (composite)
 */
export interface SwingIndicators {
  ticker:        string
  rsi14:         number | null
  ma20:          number | null
  ma50:          number | null
  distMa20Pct:   number | null
  volRatio:      number | null
  vol20:         number | null
  high4w:        number | null
  low4w:         number | null
  signal:        "BUY" | "HOLD" | "SELL" | null
  signalScore:   number   // -100 à +100
  signalReasons: string[]
}

function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) gains += d
    else losses -= d
  }
  let avgG = gains / period
  let avgL = losses / period
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    avgG = (avgG * (period - 1) + g) / period
    avgL = (avgL * (period - 1) + l) / period
  }
  if (avgL === 0) return 100
  const rs = avgG / avgL
  return 100 - 100 / (1 + rs)
}

function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  let s = 0
  for (let i = prices.length - period; i < prices.length; i++) s += prices[i]
  return s / period
}

function stdev(prices: number[]): number | null {
  if (prices.length < 2) return null
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const v = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  return Math.sqrt(v) * Math.sqrt(252) * 100   // annualisé en %
}

function computeSignal(ind: Omit<SwingIndicators, "ticker" | "signal" | "signalScore" | "signalReasons">):
  { signal: "BUY" | "HOLD" | "SELL"; score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // RSI
  if (ind.rsi14 != null) {
    if (ind.rsi14 < 30) { score += 25; reasons.push(`RSI ${ind.rsi14.toFixed(0)} (survendu)`) }
    else if (ind.rsi14 > 70) { score -= 25; reasons.push(`RSI ${ind.rsi14.toFixed(0)} (suracheté)`) }
    else if (ind.rsi14 >= 50 && ind.rsi14 < 65) { score += 8 }
  }

  // Tendance MA
  if (ind.ma20 != null && ind.ma50 != null) {
    if (ind.ma20 > ind.ma50) { score += 15; reasons.push("Tendance haussière (MA20>MA50)") }
    else                      { score -= 15; reasons.push("Tendance baissière (MA20<MA50)") }
  }

  // Position vs MA20
  if (ind.distMa20Pct != null) {
    if (ind.distMa20Pct < -3 && ind.distMa20Pct > -10) {
      score += 10; reasons.push(`-${Math.abs(ind.distMa20Pct).toFixed(1)}% sous MA20 (rebond possible)`)
    } else if (ind.distMa20Pct > 8) {
      score -= 10; reasons.push(`+${ind.distMa20Pct.toFixed(1)}% au-dessus MA20 (étiré)`)
    }
  }

  // Volume
  if (ind.volRatio != null && ind.volRatio > 1.5) {
    score += 10; reasons.push(`Vol ×${ind.volRatio.toFixed(1)} (activité forte)`)
  }

  if (score >= 25) return { signal: "BUY",  score, reasons }
  if (score <= -25) return { signal: "SELL", score, reasons }
  return { signal: "HOLD", score, reasons }
}

async function fetchTickerIndicators(ticker: string): Promise<SwingIndicators> {
  const empty: SwingIndicators = {
    ticker, rsi14: null, ma20: null, ma50: null, distMa20Pct: null,
    volRatio: null, vol20: null, high4w: null, low4w: null,
    signal: null, signalScore: 0, signalReasons: [],
  }

  try {
    // 60 jours de données pour avoir MA50 + 4 semaines de range
    const end = new Date()
    const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000)
    const period1 = start.toISOString().slice(0, 10)
    const period2 = end.toISOString().slice(0, 10)

    const raw = await yf.chart(ticker, {
      period1, period2, interval: "1d"
    }) as unknown as { quotes: Array<{ date: Date; close: number | null; volume: number | null }> }

    const quotes = (raw.quotes ?? []).filter(q => q.close != null && q.close > 0)
    if (quotes.length < 20) return empty

    const closes  = quotes.map(q => q.close as number)
    const volumes = quotes.map(q => q.volume ?? 0).filter(v => v > 0)
    const last    = closes[closes.length - 1]

    const ma20  = sma(closes, 20)
    const ma50  = sma(closes, 50)
    const r14   = rsi(closes.slice(-30), 14)
    const dist  = ma20 != null ? ((last - ma20) / ma20) * 100 : null
    const v20   = stdev(closes.slice(-21))

    // Range 4 semaines (28 jours)
    const last28 = closes.slice(-28)
    const high4w = last28.length > 0 ? Math.max(...last28) : null
    const low4w  = last28.length > 0 ? Math.min(...last28) : null

    // Volume ratio
    const lastVol = volumes[volumes.length - 1]
    const avgVol  = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / Math.max(1, volumes.length - 1)
    const volRatio = (lastVol && avgVol > 0) ? lastVol / avgVol : null

    const partial = { rsi14: r14, ma20, ma50, distMa20Pct: dist, volRatio, vol20: v20, high4w, low4w }
    const { signal, score, reasons } = computeSignal(partial)

    return {
      ticker,
      ...partial,
      signal,
      signalScore:   score,
      signalReasons: reasons,
    }
  } catch (e) {
    console.error(`[swing-indicators] ${ticker}:`, e)
    return empty
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { tickers: string[] }
  if (!body.tickers?.length) return NextResponse.json({})

  const results: Record<string, SwingIndicators> = {}
  await Promise.all(body.tickers.map(async t => {
    results[t] = await cacheFetch(
      `swing-ind:${t}`,
      () => fetchTickerIndicators(t),
      900  // 15min cache (swing = horizon long)
    ) as SwingIndicators
  }))

  return NextResponse.json(results)
}
