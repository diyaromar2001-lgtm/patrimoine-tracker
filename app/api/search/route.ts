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

// Actions suisses SIX Exchange — toujours disponibles même si Yahoo rate-limit
const SWISS_STOCKS = [
  { ticker: "ROG.SW",  name: "Roche Holding AG",         type: "stock", exchange: "SIX" },
  { ticker: "NOVN.SW", name: "Novartis AG",               type: "stock", exchange: "SIX" },
  { ticker: "NESN.SW", name: "Nestlé SA",                 type: "stock", exchange: "SIX" },
  { ticker: "UBSG.SW", name: "UBS Group AG",              type: "stock", exchange: "SIX" },
  { ticker: "ABBN.SW", name: "ABB Ltd",                   type: "stock", exchange: "SIX" },
  { ticker: "SREN.SW", name: "Swiss Re AG",               type: "stock", exchange: "SIX" },
  { ticker: "SCMN.SW", name: "Swisscom AG",               type: "stock", exchange: "SIX" },
  { ticker: "ZURN.SW", name: "Zurich Insurance Group AG", type: "stock", exchange: "SIX" },
  { ticker: "GIVN.SW", name: "Givaudan SA",               type: "stock", exchange: "SIX" },
  { ticker: "CFR.SW",  name: "Compagnie Financière Richemont SA", type: "stock", exchange: "SIX" },
  { ticker: "SIKA.SW", name: "Sika AG",                   type: "stock", exchange: "SIX" },
  { ticker: "LONN.SW", name: "Lonza Group AG",            type: "stock", exchange: "SIX" },
  { ticker: "PGHN.SW", name: "Partners Group Holding AG", type: "stock", exchange: "SIX" },
  { ticker: "KNIN.SW", name: "Kühne + Nagel International AG", type: "stock", exchange: "SIX" },
  { ticker: "GEBN.SW", name: "Geberit AG",                type: "stock", exchange: "SIX" },
  { ticker: "BALN.SW", name: "Baloise Holding AG",        type: "stock", exchange: "SIX" },
  { ticker: "SLHN.SW", name: "Swiss Life Holding AG",     type: "stock", exchange: "SIX" },
  { ticker: "STMN.SW", name: "Straumann Holding AG",      type: "stock", exchange: "SIX" },
  { ticker: "ALC.SW",  name: "Alcon AG",                  type: "stock", exchange: "SIX" },
  { ticker: "LISN.SW", name: "Chocoladefabriken Lindt & Sprüngli AG", type: "stock", exchange: "SIX" },
  { ticker: "SMH.SW",  name: "The Swatch Group AG",       type: "stock", exchange: "SIX" },
  { ticker: "CSGN.SW", name: "Credit Suisse Group AG",    type: "stock", exchange: "SIX" },
  { ticker: "TEMN.SW", name: "Temenos AG",                type: "stock", exchange: "SIX" },
  { ticker: "VACN.SW", name: "VAT Group AG",              type: "stock", exchange: "SIX" },
  { ticker: "HELN.SW", name: "Helvetia Holding AG",       type: "stock", exchange: "SIX" },
]

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

  // Correspondances sur actions suisses (ticker sans .SW, nom, ou mot-clé "six"/"sw")
  const qNoSuffix = ql.replace(/\.sw$/, "").replace(/\s*(six|sw|swiss|swx)\s*/g, "").trim()
  const swissHits = SWISS_STOCKS.filter(s =>
    s.ticker.toLowerCase().replace(".sw", "").includes(qNoSuffix) ||
    s.name.toLowerCase().includes(qNoSuffix) ||
    s.ticker.toLowerCase().includes(ql.replace(/\s+/g, ""))
  ).slice(0, 5)

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
    [...swissHits, ...cryptoHits, ...yahooHits]
      .filter(r => { if (seen.has(r.ticker)) return false; seen.add(r.ticker); return true })
      .slice(0, 12)
  )
}
