import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"
import { convertCurrency, FX_RATES } from "@/lib/utils"
import type { AppCurrency } from "@/lib/utils"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",     ETH: "ethereum",     SOL: "solana",
  BNB: "binancecoin", XRP: "ripple",       ADA: "cardano",
  AVAX: "avalanche-2",DOT: "polkadot",     MATIC: "matic-network",
  LINK: "chainlink",  DOGE: "dogecoin",    LTC: "litecoin",
  UNI: "uniswap",     ATOM: "cosmos",      NEAR: "near",
}

function isCrypto(t: string) { return t.replace(/-EUR$|-USD$|-CHF$|-GBP$/, "") in COINGECKO_IDS }
function baseTicker(t: string) { return t.replace(/-EUR$|-USD$|-CHF$|-GBP$/, "") }

// Convert a native price to all 3 display currencies
function toAllCurrencies(price: number, from: AppCurrency) {
  return {
    chf: convertCurrency(price, from, "CHF"),
    usd: convertCurrency(price, from, "USD"),
    eur: convertCurrency(price, from, "EUR"),
  }
}

async function fetchCryptoPrices(tickers: string[]) {
  const ids = [...new Set(tickers.map(t => COINGECKO_IDS[baseTicker(t)]).filter(Boolean))]
  if (!ids.length) return {} as Record<string, PriceResult>

  return cacheFetch(`cg:${ids.join(",")}`, async () => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=chf,usd,eur&include_24hr_change=true`
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return {}
    const data: Record<string, { chf: number; usd: number; eur: number; chf_24h_change: number; usd_24h_change: number }> = await res.json()
    const out: Record<string, PriceResult> = {}
    for (const [id, v] of Object.entries(data)) {
      const ticker = Object.entries(COINGECKO_IDS).find(([, cid]) => cid === id)?.[0]
      if (ticker) out[ticker] = {
        chf: v.chf, usd: v.usd, eur: v.eur,
        changePct:       v.chf_24h_change ?? 0,
        originalPrice:   v.usd,           // BTC/ETH quoted in USD natively
        originalCurrency:"USD",
      }
    }
    return out
  }, 15)
}

interface PriceResult {
  chf:             number
  usd:             number
  eur:             number
  changePct:       number
  originalPrice:   number  // price in the asset's native currency
  originalCurrency:string  // e.g. "USD" for US stocks, "EUR" for FR stocks
}

export async function POST(req: NextRequest) {
  const { tickers }: { tickers: string[] } = await req.json()
  if (!tickers?.length) return NextResponse.json({})

  const stockTickers  = tickers.filter(t => !isCrypto(t))
  const cryptoTickers = tickers.filter(t => isCrypto(t))

  const out: Record<string, PriceResult> = {}

  // ── Stocks & ETFs via Yahoo Finance ──────────────────────────────────
  if (stockTickers.length) {
    try {
      const cached = await cacheFetch(
        `yf:quotes:${stockTickers.sort().join(",")}`,
        async () => {
          const result = await yf.quote(stockTickers)
          return Array.isArray(result) ? result : [result]
        },
        20
      ) as Array<Record<string, unknown>>

      for (const q of cached) {
        if (!q?.symbol || !q.regularMarketPrice) continue
        const nativePrice    = q.regularMarketPrice as number
        const nativeCurrency = ((q.currency as string) ?? "USD") as AppCurrency
        // Convert to all 3 display currencies
        const converted = (nativeCurrency in FX_RATES)
          ? toAllCurrencies(nativePrice, nativeCurrency)
          : { chf: nativePrice, usd: nativePrice, eur: nativePrice }  // fallback

        out[q.symbol as string] = {
          ...converted,
          changePct:       (q.regularMarketChangePercent as number) ?? 0,
          originalPrice:   nativePrice,
          originalCurrency: nativeCurrency,
        }
      }
    } catch { /* Yahoo rate-limit — return empty */ }
  }

  // ── Crypto via CoinGecko ────────────────────────────────────────────
  if (cryptoTickers.length) {
    const prices = await fetchCryptoPrices(cryptoTickers) as Record<string, PriceResult>
    for (const t of cryptoTickers) {
      const p = prices[baseTicker(t)]
      out[t] = p ?? { chf: 0, usd: 0, eur: 0, changePct: 0, originalPrice: 0, originalCurrency: "USD" }
    }
  }

  return NextResponse.json(out)
}
