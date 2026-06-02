import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey"] } as never
) as typeof YahooFinanceClass

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? ""
  const tickers = raw.split(",").map(t => t.trim()).filter(Boolean)
  if (!tickers.length) return NextResponse.json([])

  const results = await Promise.allSettled(
    tickers.map(ticker =>
      cacheFetch(`earnings:${ticker}`, async () => {
        const s = await yf.quoteSummary(ticker, {
          modules: ["calendarEvents"],
        }) as unknown as {
          calendarEvents?: {
            earnings?: {
              earningsDate?: Array<{ raw: number }> | Date[]
              earningsAverage?: number
              earningsLow?: number
              earningsHigh?: number
            }
          }
        }

        const earningsDates = s.calendarEvents?.earnings?.earningsDate
        const firstDate = Array.isArray(earningsDates) && earningsDates.length > 0
          ? (earningsDates[0] as { raw?: number } | Date)
          : null

        let dateStr: string | null = null
        if (firstDate) {
          const ts = (firstDate as { raw?: number }).raw
            ? (firstDate as { raw: number }).raw * 1000
            : new Date(firstDate as Date).getTime()
          if (!isNaN(ts)) dateStr = new Date(ts).toISOString().slice(0, 10)
        }

        return {
          ticker,
          earningsDate:    dateStr,
          epsAvg:          s.calendarEvents?.earnings?.earningsAverage ?? null,
          epsLow:          s.calendarEvents?.earnings?.earningsLow     ?? null,
          epsHigh:         s.calendarEvents?.earnings?.earningsHigh    ?? null,
        }
      }, 3600)
    )
  )

  type EItem = { ticker: string; earningsDate: string | null }
  const data = (results as PromiseSettledResult<EItem>[])
    .filter((r): r is PromiseFulfilledResult<EItem> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(d => d.earningsDate !== null)
    .sort((a, b) =>
      new Date(a.earningsDate!).getTime() - new Date(b.earningsDate!).getTime()
    )

  return NextResponse.json(data)
}
