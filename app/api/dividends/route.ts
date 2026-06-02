import { NextRequest, NextResponse } from "next/server"
import yahooFinance from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")
  if (!ticker) return NextResponse.json(null)

  try {
    const data = await cacheFetch(
      `div:${ticker}`,
      async () => {
        const summary = await yahooFinance.quoteSummary(ticker, {
          modules: ["calendarEvents", "summaryDetail", "defaultKeyStatistics"],
        }) as unknown as {
          calendarEvents?: Record<string, unknown>
          summaryDetail?: Record<string, unknown>
          defaultKeyStatistics?: Record<string, unknown>
        }

        const cal      = summary.calendarEvents
        const detail   = summary.summaryDetail
        const keyStats = summary.defaultKeyStatistics

        return {
          ticker,
          dividendRate:       detail?.dividendRate         ?? null,
          dividendYield:      detail?.dividendYield        ?? null,
          exDividendDate:     detail?.exDividendDate       ?? null,
          payoutRatio:        detail?.payoutRatio          ?? null,
          fiveYearAvgReturn:  keyStats?.fiveYearAverageReturn ?? null,
          nextDividendDate:   cal?.dividendDate             ?? null,
          exDate:             cal?.exDividendDate           ?? null,
        }
      },
      3600  // 1 hour cache
    )

    return NextResponse.json(data)
  } catch (e) {
    console.error("Dividend fetch error:", e)
    return NextResponse.json(null)
  }
}
