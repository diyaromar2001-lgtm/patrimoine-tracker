// Singleton yahoo-finance2 v3 instance
// v3 exports the CLASS not an instance — must call `new YahooFinance()` once
import YahooFinanceClass from "yahoo-finance2"

// Suppress the survey notice in production
export const yf = new (YahooFinanceClass as unknown as new (opts?: Record<string, unknown>) => typeof YahooFinanceClass)({
  suppressNotices: ["yahooSurvey"],
} as never) as typeof YahooFinanceClass
