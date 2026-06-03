import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey"] } as never
) as typeof YahooFinanceClass

export interface DividendInfo {
  ticker:          string
  name:            string
  paysDiv:         boolean
  dividendRate:    number        // annual per share (e.g. 3.00 USD)
  dividendYield:   number        // e.g. 0.0068 = 0.68%
  amountPerShare:  number        // per payment = rate / frequency_count
  frequency:       "monthly" | "quarterly" | "semi-annual" | "annual"
  frequencyCount:  number        // 12 | 4 | 2 | 1
  exDividendDate:  string | null // YYYY-MM-DD
  paymentDate:     string | null // YYYY-MM-DD
  currency:        string
}

function detectFrequency(rate: number, lastAmount: number | null): { freq: DividendInfo["frequency"]; count: number } {
  if (!lastAmount || lastAmount <= 0) return { freq: "quarterly", count: 4 }
  const ratio = rate / lastAmount
  if (ratio >= 10) return { freq: "monthly",     count: 12 }
  if (ratio >= 3)  return { freq: "quarterly",   count: 4  }
  if (ratio >= 1.5)return { freq: "semi-annual", count: 2  }
  return              { freq: "annual",        count: 1  }
}

async function fetchOneDividend(ticker: string): Promise<DividendInfo | null> {
  return cacheFetch(`divinfo:${ticker}`, async () => {
    try {
      const s = await yf.quoteSummary(ticker, {
        modules: ["calendarEvents", "summaryDetail", "defaultKeyStatistics", "price"],
      }) as unknown as Record<string, Record<string, unknown>>

      const detail   = s.summaryDetail ?? {}
      const cal      = s.calendarEvents ?? {}
      const keyStats = s.defaultKeyStatistics ?? {}
      const price    = s.price ?? {}

      const rate  = Number(detail.dividendRate  ?? 0)
      const yield_ = Number(detail.dividendYield ?? 0)

      if (!rate || rate <= 0) {
        return {
          ticker, name: String(price.shortName ?? price.longName ?? ticker),
          paysDiv: false, dividendRate: 0, dividendYield: 0,
          amountPerShare: 0, frequency: "quarterly" as const, frequencyCount: 4,
          exDividendDate: null, paymentDate: null,
          currency: String(price.currency ?? "USD"),
        } satisfies DividendInfo
      }

      // Detect frequency from last known payment
      const lastAmount = Number(keyStats.lastDividendValue ?? 0)
      const { freq, count } = detectFrequency(rate, lastAmount)
      const amountPerShare  = count > 0 ? rate / count : rate

      // Dates — try calendarEvents first, fall back to summaryDetail
      const exDateRaw  = cal.exDividendDate ?? detail.exDividendDate ?? null
      const payDateRaw = cal.dividendDate    ?? null

      function toDateStr(v: unknown): string | null {
        if (!v) return null
        try {
          const d = new Date(typeof v === "number" ? v * 1000 : String(v))
          if (isNaN(d.getTime())) return null
          return d.toISOString().slice(0, 10)
        } catch { return null }
      }

      return {
        ticker,
        name:           String(price.shortName ?? price.longName ?? ticker),
        paysDiv:        true,
        dividendRate:   rate,
        dividendYield:  yield_,
        amountPerShare,
        frequency:      freq,
        frequencyCount: count,
        exDividendDate: toDateStr(exDateRaw),
        paymentDate:    toDateStr(payDateRaw),
        currency:       String(price.currency ?? "USD"),
      } satisfies DividendInfo
    } catch (e) {
      console.error("[dividends] fetch error for", ticker, String(e))
      return null
    }
  }, 3600)
}

// GET /api/dividends?ticker=MSFT           (single)
// GET /api/dividends?tickers=MSFT,AAPL,O  (batch)
export async function GET(req: NextRequest) {
  const single   = req.nextUrl.searchParams.get("ticker")
  const batchRaw = req.nextUrl.searchParams.get("tickers")

  // Batch mode
  if (batchRaw) {
    const tickers = batchRaw.split(",").map(t => t.trim()).filter(Boolean)
    const results = await Promise.allSettled(tickers.map(fetchOneDividend))
    const data = results
      .map(r => r.status === "fulfilled" ? r.value : null)
      .filter(Boolean)
    return NextResponse.json(data)
  }

  // Single mode (backward compat)
  if (single) {
    const data = await fetchOneDividend(single)
    return NextResponse.json(data)
  }

  return NextResponse.json([])
}
