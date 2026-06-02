import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

function nDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function today() { return new Date().toISOString().slice(0, 10) }

const PERIOD_CFG: Record<string, { period1: () => string; interval: "1d"|"1wk"|"1mo"; ttl: number }> = {
  "1W": { period1: () => nDaysAgo(7),   interval: "1d",  ttl: 120  },
  "1M": { period1: () => nDaysAgo(30),  interval: "1d",  ttl: 300  },
  "3M": { period1: () => nDaysAgo(90),  interval: "1d",  ttl: 600  },
  "6M": { period1: () => nDaysAgo(180), interval: "1d",  ttl: 900  },
  "1Y": { period1: () => nDaysAgo(365), interval: "1wk", ttl: 1800 },
  "2Y": { period1: () => nDaysAgo(730), interval: "1wk", ttl: 3600 },
  "5Y": { period1: () => nDaysAgo(1825),"interval": "1mo", ttl: 3600 },
}

interface ChartPoint { time: number; value: number }

async function fetchChartData(ticker: string, period1: string, interval: "1d"|"1wk"|"1mo"): Promise<ChartPoint[]> {
  try {
    const raw = await yf.chart(ticker, {
      period1,
      period2: today(),
      interval,
    }) as unknown as { quotes: Array<{ date: Date; close: number | null }> }

    return (raw.quotes ?? [])
      .filter(q => q.close != null)
      .map(q => ({
        time:  Math.floor(new Date(q.date).getTime() / 1000),
        value: q.close as number,
      }))
  } catch {
    return []
  }
}

function normalize(data: ChartPoint[]): ChartPoint[] {
  if (!data.length) return data
  const base = data[0].value
  if (!base) return data
  return data.map(d => ({ ...d, value: Math.round((d.value / base) * 10000) / 100 }))
}

export async function GET(req: NextRequest) {
  const ticker  = req.nextUrl.searchParams.get("ticker")  ?? "SPY"
  const period  = req.nextUrl.searchParams.get("period")  ?? "1Y"
  const compare = req.nextUrl.searchParams.get("compare") ?? ""   // "SPY,VWCE.DE"

  const cfg = PERIOD_CFG[period] ?? PERIOD_CFG["1Y"]

  // Main series + optional comparisons in parallel
  const compareList = compare ? compare.split(",").filter(Boolean) : []

  const [main, ...comparisons] = await Promise.all([
    cacheFetch(
      `chart:${ticker}:${period}`,
      () => fetchChartData(ticker, cfg.period1(), cfg.interval),
      cfg.ttl
    ),
    ...compareList.map(ct =>
      cacheFetch(
        `chart:${ct}:${period}`,
        () => fetchChartData(ct, cfg.period1(), cfg.interval),
        cfg.ttl
      )
    ),
  ])

  const hasCompare = compareList.length > 0

  return NextResponse.json({
    main:        hasCompare ? normalize(main as ChartPoint[]) : main,
    comparisons: compareList.map((ct, i) => ({
      ticker: ct,
      data:   normalize(comparisons[i] as ChartPoint[]),
    })),
  })
}
