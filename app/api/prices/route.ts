import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

// v3: must instantiate — default export is the CLASS not an instance
const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

// CoinGecko ID map
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",     ETH: "ethereum",     SOL: "solana",
  BNB: "binancecoin", XRP: "ripple",       ADA: "cardano",
  AVAX: "avalanche-2",DOT: "polkadot",     MATIC: "matic-network",
  LINK: "chainlink",  DOGE: "dogecoin",    LTC: "litecoin",
  UNI: "uniswap",     ATOM: "cosmos",      NEAR: "near",
}

function isCrypto(ticker: string) {
  return ticker.replace(/-EUR$|-USD$|-GBP$/, "") in COINGECKO_IDS
}

function baseTicker(ticker: string) {
  return ticker.replace(/-EUR$|-USD$|-GBP$/, "")
}

async function fetchCryptoPrice(tickers: string[]): Promise<Record<string, { price: number; changePct: number }>> {
  const ids = [...new Set(tickers.map(t => COINGECKO_IDS[baseTicker(t)]).filter(Boolean))]
  if (!ids.length) return {}

  return cacheFetch(`cg:${ids.join(",")}`, async () => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=eur&include_24hr_change=true`
    const res = await fetch(url, { next: { revalidate: 30 } })
    if (!res.ok) return {}
    const data: Record<string, { eur: number; eur_24h_change: number }> = await res.json()
    const out: Record<string, { price: number; changePct: number }> = {}
    for (const [id, v] of Object.entries(data)) {
      const ticker = Object.entries(COINGECKO_IDS).find(([, cid]) => cid === id)?.[0]
      if (ticker) out[ticker] = { price: v.eur, changePct: v.eur_24h_change ?? 0 }
    }
    return out
  }, 30)
}

export async function POST(req: NextRequest) {
  const { tickers }: { tickers: string[] } = await req.json()
  if (!tickers?.length) return NextResponse.json({})

  const stockTickers  = tickers.filter(t => !isCrypto(t))
  const cryptoTickers = tickers.filter(t => isCrypto(t))

  const out: Record<string, { price: number; change: number; changePct: number; currency: string }> = {}

  // ── Stocks & ETFs via Yahoo Finance ──────────────────────────────
  if (stockTickers.length) {
    const cached = await cacheFetch(
      `yf:quotes:${stockTickers.sort().join(",")}`,
      async () => {
        // yahoo-finance2 v3: quote() accepts single symbol or array
        const result = await yf.quote(stockTickers)
        return Array.isArray(result) ? result : [result]
      },
      30  // 30s cache = "live" for most use-cases
    ) as Array<Record<string, unknown>>

    for (const q of cached) {
      if (!q?.symbol) continue
      out[q.symbol as string] = {
        price:     (q.regularMarketPrice    as number) ?? 0,
        change:    (q.regularMarketChange   as number) ?? 0,
        changePct: (q.regularMarketChangePercent as number) ?? 0,
        currency:  (q.currency as string)  ?? "USD",
      }
    }
  }

  // ── Crypto via CoinGecko ──────────────────────────────────────────
  if (cryptoTickers.length) {
    const prices = await fetchCryptoPrice(cryptoTickers)
    for (const t of cryptoTickers) {
      const base = baseTicker(t)
      const p = prices[base]
      if (p) out[t] = { price: p.price, change: 0, changePct: p.changePct, currency: "EUR" }
      else    out[t] = { price: 0, change: 0, changePct: 0, currency: "EUR" }
    }
  }

  return NextResponse.json(out)
}
