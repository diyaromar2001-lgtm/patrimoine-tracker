import { NextRequest, NextResponse } from "next/server"
import yahooFinance from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

// CoinGecko ID map for common crypto tickers
const COINGECKO_IDS: Record<string, string> = {
  "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "BNB": "binancecoin",
  "XRP": "ripple", "ADA": "cardano", "AVAX": "avalanche-2", "DOT": "polkadot",
  "MATIC": "matic-network", "LINK": "chainlink", "DOGE": "dogecoin",
  "LTC": "litecoin", "UNI": "uniswap", "ATOM": "cosmos", "NEAR": "near",
  "FTM": "fantom", "ALGO": "algorand", "VET": "vechain", "SAND": "the-sandbox",
  "MANA": "decentraland", "APE": "apecoin",
}

async function fetchCryptoPrices(tickers: string[]): Promise<Record<string, number>> {
  const ids = tickers
    .map(t => COINGECKO_IDS[t.replace("-EUR", "").replace("-USD", "")])
    .filter(Boolean)
  if (!ids.length) return {}

  return cacheFetch(`crypto:${ids.join(",")}`, async () => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=eur,usd`
    const res = await fetch(url, { next: { revalidate: 60 } })
    if (!res.ok) return {}
    const data = await res.json()
    const out: Record<string, number> = {}
    for (const [id, prices] of Object.entries(data as Record<string, Record<string, number>>)) {
      const ticker = Object.entries(COINGECKO_IDS).find(([, v]) => v === id)?.[0]
      if (ticker) out[ticker] = prices.eur ?? prices.usd ?? 0
    }
    return out
  }, 60)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const tickers: string[] = body.tickers ?? []
  if (!tickers.length) return NextResponse.json({})

  const stockTickers = tickers.filter(t => !COINGECKO_IDS[t.replace("-EUR", "").replace("-USD", "")])
  const cryptoTickers = tickers.filter(t => !!COINGECKO_IDS[t.replace("-EUR", "").replace("-USD", "")])

  const results: Record<string, { price: number; change: number; changePct: number; currency: string }> = {}

  // Fetch stocks / ETFs via Yahoo Finance
  if (stockTickers.length) {
    const chunks = []
    for (let i = 0; i < stockTickers.length; i += 10)
      chunks.push(stockTickers.slice(i, i + 10))

    for (const chunk of chunks) {
      const quotes = await cacheFetch(
        `quotes:${chunk.join(",")}`,
        () => yahooFinance.quote(chunk),
        90  // 90s cache
      ) as Array<Record<string, unknown>>

      const arr = Array.isArray(quotes) ? quotes : [quotes]
      for (const q of arr) {
        if (!q || !q.symbol) continue
        results[q.symbol as string] = {
          price:     (q.regularMarketPrice as number)        ?? 0,
          change:    (q.regularMarketChange as number)       ?? 0,
          changePct: (q.regularMarketChangePercent as number) ?? 0,
          currency:  (q.currency as string)                  ?? "EUR",
        }
      }
    }
  }

  // Fetch crypto via CoinGecko
  if (cryptoTickers.length) {
    const prices = await fetchCryptoPrices(cryptoTickers)
    for (const [ticker, price] of Object.entries(prices)) {
      results[ticker] = { price, change: 0, changePct: 0, currency: "EUR" }
    }
  }

  return NextResponse.json(results)
}
