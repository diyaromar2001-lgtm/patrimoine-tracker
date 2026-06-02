import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey"] } as never
) as typeof YahooFinanceClass

function mapType(type?: string) {
  if (!type) return "stock"
  const t = type.toLowerCase()
  if (t.includes("etf") || t.includes("fund")) return "etf"
  if (t.includes("crypto")) return "crypto"
  return "stock"
}

const POPULAR_CRYPTO = [
  { ticker: "BTC",  name: "Bitcoin",   type: "crypto", exchange: "CoinGecko" },
  { ticker: "ETH",  name: "Ethereum",  type: "crypto", exchange: "CoinGecko" },
  { ticker: "SOL",  name: "Solana",    type: "crypto", exchange: "CoinGecko" },
  { ticker: "BNB",  name: "BNB",       type: "crypto", exchange: "CoinGecko" },
  { ticker: "XRP",  name: "XRP",       type: "crypto", exchange: "CoinGecko" },
  { ticker: "ADA",  name: "Cardano",   type: "crypto", exchange: "CoinGecko" },
  { ticker: "AVAX", name: "Avalanche", type: "crypto", exchange: "CoinGecko" },
  { ticker: "MATIC",name: "Polygon",   type: "crypto", exchange: "CoinGecko" },
  { ticker: "LINK", name: "Chainlink", type: "crypto", exchange: "CoinGecko" },
  { ticker: "DOGE", name: "Dogecoin",  type: "crypto", exchange: "CoinGecko" },
  { ticker: "LTC",  name: "Litecoin",  type: "crypto", exchange: "CoinGecko" },
  { ticker: "DOT",  name: "Polkadot",  type: "crypto", exchange: "CoinGecko" },
  { ticker: "UNI",  name: "Uniswap",   type: "crypto", exchange: "CoinGecko" },
  { ticker: "ATOM", name: "Cosmos",    type: "crypto", exchange: "CoinGecko" },
  { ticker: "NEAR", name: "NEAR Protocol", type: "crypto", exchange: "CoinGecko" },
]

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json([])

  const ql = q.toLowerCase()

  const cryptoHits = POPULAR_CRYPTO.filter(
    c => c.ticker.toLowerCase().includes(ql) || c.name.toLowerCase().includes(ql)
  ).slice(0, 4)

  let yahooHits: Array<{ ticker: string; name: string; type: string; exchange: string }> = []
  try {
    const res = await cacheFetch(
      `search:${q}`,
      async () => {
        const r = await yf.search(q, { newsCount: 0, quotesCount: 12 })
        return (r as unknown as { quotes: Record<string, unknown>[] }).quotes ?? []
      },
      300
    ) as Record<string, unknown>[]

    yahooHits = res
      .filter(r => r.symbol && (r.shortname || r.longname))
      .slice(0, 8)
      .map(r => ({
        ticker:   r.symbol as string,
        name:     ((r.shortname ?? r.longname ?? r.symbol) as string),
        type:     mapType(r.typeDisp as string | undefined),
        exchange: (r.exchDisp ?? r.exchange ?? "") as string,
      }))
  } catch { /* Yahoo rate-limit — use crypto only */ }

  const seen = new Set<string>()
  return NextResponse.json(
    [...cryptoHits, ...yahooHits]
      .filter(r => { if (seen.has(r.ticker)) return false; seen.add(r.ticker); return true })
      .slice(0, 10)
  )
}
