/**
 * POST /api/dividend-history
 *
 * Historique RÉEL des versements de dividendes (date ex-dividende + montant
 * par action) pour une liste de tickers, via Yahoo Finance.
 *
 * C'est la source factuelle croisée ensuite, côté client, avec l'historique
 * de transactions de l'utilisateur (lib/dividend-engine.ts) pour déterminer
 * ce qui a réellement été perçu.
 *
 * Corps : { tickers: string[], from?: "YYYY-MM-DD" }
 * Réponse : { events: DividendEvent[], resolved: string[], missing: string[] }
 */

import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"
import { buildTickerAliases } from "@/lib/import/t212-symbol-map"
import { normalizeQuotePrice } from "@/lib/quote-currency"
import type { DividendEvent } from "@/lib/dividend-engine"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

// Mêmes alias que /api/prices : les tickers bruts T212 (EUNL, WSML…) ne
// résolvent pas sur Yahoo sans suffixe de place.
const TICKER_ALIASES: Record<string, string[]> = {
  ...buildTickerAliases(),
  VUAA: ["VUAA.L", "VUAA.MI", "VUAA.DE"],
}

async function fetchDividendEvents(ticker: string, period1: string): Promise<DividendEvent[]> {
  const aliases = TICKER_ALIASES[ticker.toUpperCase()] ?? []
  const candidates = aliases.length > 0 ? [...new Set([...aliases, ticker])] : [ticker]

  for (const candidate of candidates) {
    try {
      const raw = await yf.chart(candidate, {
        period1,
        period2: new Date().toISOString().slice(0, 10),
        interval: "1d",
        events: "dividends",
      }) as unknown as {
        meta?: { currency?: string }
        events?: { dividends?: Array<{ amount: number; date: Date | string }> }
      }

      const divs = raw.events?.dividends ?? []
      if (!divs.length) continue

      const rawCurrency = raw.meta?.currency ?? "USD"
      return divs
        .filter(d => d.amount > 0)
        .map(d => {
          // GBp/GBX (pence) → GBP, comme partout ailleurs dans l'app
          const { price, currency } = normalizeQuotePrice(d.amount, rawCurrency)
          return {
            ticker,                                   // on renvoie le ticker DEMANDÉ
            exDate: new Date(d.date).toISOString().slice(0, 10),
            amountPerShare: price,
            currency,
          }
        })
        .sort((a, b) => a.exDate.localeCompare(b.exDate))
    } catch { /* candidat suivant */ }
  }
  return []
}

export async function POST(req: NextRequest) {
  const body: { tickers?: string[]; from?: string } = await req.json()
  const tickers = [...new Set(body.tickers ?? [])].filter(Boolean)
  // Par défaut 6 ans : couvre largement l'historique d'un portefeuille récent
  const from = body.from ?? new Date(Date.now() - 6 * 365 * 86_400_000).toISOString().slice(0, 10)

  if (!tickers.length) {
    return NextResponse.json({ events: [], resolved: [], missing: [] })
  }

  const results = await Promise.all(
    tickers.map(async ticker => {
      const events = await cacheFetch(
        `div-history:${ticker}:${from}`,
        () => fetchDividendEvents(ticker, from),
        6 * 3600   // 6 h : un calendrier de dividendes bouge rarement
      ) as DividendEvent[]
      return { ticker, events }
    })
  )

  const events = results.flatMap(r => r.events)
  const resolved = results.filter(r => r.events.length > 0).map(r => r.ticker)
  // « missing » = aucun dividende trouvé : soit le titre n'en verse pas,
  // soit le symbole n'a pas pu être résolu. On ne tranche pas ici.
  const missing = results.filter(r => r.events.length === 0).map(r => r.ticker)

  return NextResponse.json({ events, resolved, missing })
}
