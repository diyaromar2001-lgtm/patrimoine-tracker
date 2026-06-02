import { NextRequest, NextResponse } from "next/server"
import yahooFinance from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const PERIOD_MAP: Record<string, { period1: string; interval: string; ttl: number }> = {
  "1W":  { period1: nDaysAgo(7),   interval: "1d",  ttl: 300  },
  "1M":  { period1: nDaysAgo(30),  interval: "1d",  ttl: 300  },
  "3M":  { period1: nDaysAgo(90),  interval: "1d",  ttl: 600  },
  "6M":  { period1: nDaysAgo(180), interval: "1d",  ttl: 600  },
  "1Y":  { period1: nDaysAgo(365), interval: "1wk", ttl: 1800 },
  "2Y":  { period1: nDaysAgo(730), interval: "1wk", ttl: 3600 },
  "5Y":  { period1: nDaysAgo(1825),"interval": "1mo", ttl: 3600 },
}

function nDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function fetchHistory(ticker: string, period1: string, interval: string) {
  try {
    const data = await yahooFinance.chart(ticker, {
      period1,
      interval: interval as "1d" | "1wk" | "1mo",
    }) as unknown as { quotes: Record<string, unknown>[] }
    return (data.quotes ?? []).map((q: Record<string, unknown>) => ({
      time:  Math.floor(new Date(q.date as string).getTime() / 1000),
      open:  q.open  as number,
      high:  q.high  as number,
      low:   q.low   as number,
      close: q.close as number,
      value: q.close as number,
    })).filter((q: { close: number }) => q.close != null)
  } catch {
    return []
  }
}

// Normalize a series so first value = 100
function normalize(data: Array<{ time: number; value: number }>) {
  if (!data.length) return data
  const base = data[0].value
  if (!base) return data
  return data.map(d => ({ ...d, value: (d.value / base) * 100 }))
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "AAPL"
  const period  = req.nextUrl.searchParams.get("period") ?? "1Y"
  const compare = req.nextUrl.searchParams.get("compare") === "true"

  const cfg = PERIOD_MAP[period] ?? PERIOD_MAP["1Y"]

  const [main, spy] = await Promise.all([
    cacheFetch(
      `chart:${ticker}:${period}`,
      () => fetchHistory(ticker, cfg.period1, cfg.interval),
      cfg.ttl
    ),
    compare
      ? cacheFetch(
          `chart:SPY:${period}`,
          () => fetchHistory("SPY", cfg.period1, cfg.interval),
          cfg.ttl
        )
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    main:    compare ? normalize(main as Array<{ time: number; value: number }>) : main,
    compare: compare ? normalize(spy  as Array<{ time: number; value: number }>) : [],
  })
}
