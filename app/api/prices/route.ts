import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"
import { convertCurrency, DEFAULT_FX_RATES } from "@/lib/utils"
import type { AppCurrency, FXRates } from "@/lib/utils"

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

const TICKER_ALIASES: Record<string, string[]> = {
  VUAA: ["VUAA.L", "VUAA.MI", "VUAA.DE"],
}

function isCrypto(t: string) { return t.replace(/-EUR$|-USD$|-CHF$|-GBP$/, "") in COINGECKO_IDS }
function baseTicker(t: string) { return t.replace(/-EUR$|-USD$|-CHF$|-GBP$/, "") }

// Fetch live FX rates — shared with /api/fx-rates
async function getLiveFxRates(): Promise<FXRates> {
  const result = await cacheFetch("fx-rates-for-prices", async () => {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=CHF&to=USD,EUR")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: { rates: { USD: number; EUR: number } } = await res.json()
      return { CHF: 1, USD: data.rates.USD, EUR: data.rates.EUR }
    } catch {
      return DEFAULT_FX_RATES
    }
  }, 3600)
  return result as unknown as FXRates
}

// Convert a native price to all 3 display currencies using LIVE rates
async function toAllCurrencies(price: number, from: AppCurrency) {
  const rates = await getLiveFxRates()
  return {
    chf: convertCurrency(price, from, "CHF", rates),
    usd: convertCurrency(price, from, "USD", rates),
    eur: convertCurrency(price, from, "EUR", rates),
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
        price: v.chf,
        chf: v.chf, usd: v.usd, eur: v.eur,
        changePct:       v.chf_24h_change ?? 0,
        originalPrice:   v.usd,           // BTC/ETH quoted in USD natively
        originalCurrency:"USD",
        resolvedSymbol: ticker,
      }
    }
    return out
  }, 15)
}

interface PriceResult {
  price?:           number  // legacy CHF display price for older callers
  chf:             number
  usd:             number
  eur:             number
  changePct:       number
  originalPrice:   number  // price in the asset's native currency
  originalCurrency:string  // e.g. "USD" for US stocks, "EUR" for FR stocks
  resolvedSymbol?: string
}

async function resolveYahooQuote(ticker: string): Promise<{ requested: string; quote: Record<string, unknown> } | null> {
  const candidates = [...new Set([ticker, ...(TICKER_ALIASES[ticker.toUpperCase()] ?? [])])]
  for (const candidate of candidates) {
    try {
      const quote = await yf.quote(candidate) as Record<string, unknown> | undefined
      if (quote?.symbol && quote.regularMarketPrice) {
        return { requested: ticker, quote }
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null
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
          return Promise.all(stockTickers.map(t => resolveYahooQuote(t)))
        },
        20
      ) as Array<{ requested: string; quote: Record<string, unknown> } | null>

      for (const item of cached) {
        if (!item) continue
        const q = item.quote
        if (!q?.symbol || !q.regularMarketPrice) continue
        const nativePrice    = q.regularMarketPrice as number
        const nativeCurrency = ((q.currency as string) ?? "USD") as AppCurrency
        // Convert to all 3 display currencies using live FX rates
        const converted = await toAllCurrencies(nativePrice, nativeCurrency)

        out[item.requested] = {
          price: converted.chf,
          ...converted,
          changePct:       (q.regularMarketChangePercent as number) ?? 0,
          originalPrice:   nativePrice,
          originalCurrency: nativeCurrency,
          resolvedSymbol:   q.symbol as string,
        }
      }
    } catch { /* Yahoo rate-limit — return empty */ }
  }

  // ── Crypto via CoinGecko ────────────────────────────────────────────
  if (cryptoTickers.length) {
    const prices = await fetchCryptoPrices(cryptoTickers) as Record<string, PriceResult>
    for (const t of cryptoTickers) {
      const p = prices[baseTicker(t)]
      out[t] = p ?? { price: 0, chf: 0, usd: 0, eur: 0, changePct: 0, originalPrice: 0, originalCurrency: "USD", resolvedSymbol: t }
    }
  }

  return NextResponse.json(out)
}
