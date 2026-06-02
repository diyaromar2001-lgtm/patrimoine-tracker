import { NextRequest, NextResponse } from "next/server"
import yahooFinance from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

// Map Yahoo Finance type strings to our asset classes
function mapType(type: string | undefined): string {
  if (!type) return "stock"
  const t = type.toLowerCase()
  if (t.includes("etf") || t.includes("fund")) return "etf"
  if (t.includes("crypto") || t.includes("currency")) return "crypto"
  if (t.includes("bond") || t.includes("future")) return "bond"
  return "stock"
}

// Popular crypto list for instant local suggestions
const POPULAR_CRYPTO = [
  { ticker: "BTC-EUR", name: "Bitcoin", type: "crypto", exchange: "CoinGecko" },
  { ticker: "ETH-EUR", name: "Ethereum", type: "crypto", exchange: "CoinGecko" },
  { ticker: "SOL-EUR", name: "Solana", type: "crypto", exchange: "CoinGecko" },
  { ticker: "BNB-EUR", name: "BNB", type: "crypto", exchange: "CoinGecko" },
  { ticker: "XRP-EUR", name: "XRP", type: "crypto", exchange: "CoinGecko" },
  { ticker: "ADA-EUR", name: "Cardano", type: "crypto", exchange: "CoinGecko" },
  { ticker: "AVAX-EUR", name: "Avalanche", type: "crypto", exchange: "CoinGecko" },
  { ticker: "DOT-EUR", name: "Polkadot", type: "crypto", exchange: "CoinGecko" },
  { ticker: "MATIC-EUR", name: "Polygon", type: "crypto", exchange: "CoinGecko" },
  { ticker: "LINK-EUR", name: "Chainlink", type: "crypto", exchange: "CoinGecko" },
  { ticker: "DOGE-EUR", name: "Dogecoin", type: "crypto", exchange: "CoinGecko" },
  { ticker: "LTC-EUR", name: "Litecoin", type: "crypto", exchange: "CoinGecko" },
]

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (!q || q.length < 1) return NextResponse.json([])

  const ql = q.toLowerCase()

  try {
    // 1. Local crypto suggestions (instant, no network)
    const cryptoMatches = POPULAR_CRYPTO.filter(
      c =>
        c.ticker.toLowerCase().includes(ql) ||
        c.name.toLowerCase().includes(ql)
    ).slice(0, 4)

    // 2. Yahoo Finance search (cached 5 min)
    const yahooResults = await cacheFetch(
      `search:${q}`,
      async () => {
        const res = await yahooFinance.search(q, { newsCount: 0, quotesCount: 10 })
        return (res as unknown as { quotes: Record<string, unknown>[] }).quotes ?? []
      },
      300
    ) as Record<string, unknown>[]

    const yahooMapped = yahooResults
      .filter((r) => r.symbol && r.shortname)
      .slice(0, 8)
      .map((r: Record<string, unknown>) => ({
        ticker: r.symbol as string,
        name:   (r.shortname ?? r.longname ?? r.symbol) as string,
        type:   mapType(r.typeDisp as string | undefined),
        exchange: (r.exchDisp ?? r.exchange ?? "") as string,
      }))

    // Merge: crypto first if it matches, then Yahoo
    const seen = new Set<string>()
    const merged = [...cryptoMatches, ...yahooMapped].filter(r => {
      if (seen.has(r.ticker)) return false
      seen.add(r.ticker)
      return true
    }).slice(0, 10)

    return NextResponse.json(merged)
  } catch (e) {
    console.error("Search error:", e)
    return NextResponse.json([])
  }
}
