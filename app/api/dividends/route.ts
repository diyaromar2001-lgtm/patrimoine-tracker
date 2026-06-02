import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey"] } as never
) as typeof YahooFinanceClass

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")
  if (!ticker) return NextResponse.json(null)

  try {
    const data = await cacheFetch(
      `div:${ticker}`,
      async () => {
        const s = await yf.quoteSummary(ticker, {
          modules: ["calendarEvents", "summaryDetail", "defaultKeyStatistics"],
        }) as unknown as Record<string, Record<string, unknown>>

        return {
          ticker,
          dividendRate:    s.summaryDetail?.dividendRate       ?? null,
          dividendYield:   s.summaryDetail?.dividendYield      ?? null,
          exDividendDate:  s.summaryDetail?.exDividendDate     ?? null,
          payoutRatio:     s.summaryDetail?.payoutRatio        ?? null,
          nextDividendDate: s.calendarEvents?.dividendDate     ?? null,
          earningsDate:    (s.calendarEvents?.earnings as Record<string, unknown>)?.earningsDate ?? null,
        }
      },
      3600
    )
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(null)
  }
}
