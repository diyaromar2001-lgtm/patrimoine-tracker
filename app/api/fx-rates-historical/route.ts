import { NextRequest, NextResponse } from "next/server"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

/**
 * GET /api/fx-rates-historical?date=2024-01-15&currency=EUR
 * Retourne le taux CHF/currency à la date donnée via Frankfurter (BCE).
 * Ex: { rate: 1.073, date: "2024-01-15", currency: "EUR", source: "frankfurter" }
 */
export async function GET(req: NextRequest) {
  const date     = req.nextUrl.searchParams.get("date")     // "YYYY-MM-DD"
  const currency = req.nextUrl.searchParams.get("currency") // "EUR" | "USD" | "GBP"

  if (!date || !currency || currency === "CHF") {
    return NextResponse.json({ rate: 1, date, currency: "CHF", source: "identity" })
  }

  // Ne pas appeler l'API pour des dates futures
  const today = new Date().toISOString().slice(0, 10)
  const queryDate = date > today ? today : date

  try {
    const result = await cacheFetch(
      `fx-hist:${queryDate}:${currency}`,
      async () => {
        const res = await fetch(
          `https://api.frankfurter.app/${queryDate}?from=CHF&to=${currency}`,
          { next: { revalidate: 86400 } } // 24h cache — taux historiques ne changent pas
        )
        if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
        const data: { rates: Record<string, number>; date: string } = await res.json()
        return { rate: data.rates[currency], date: data.date }
      },
      86400  // 24h dans le cache local
    ) as { rate: number; date: string }

    return NextResponse.json({
      rate:     result.rate,
      date:     result.date,
      currency,
      source:   "frankfurter",
    })
  } catch (e) {
    // Fallback: taux actuel
    const fallback: Record<string, number> = { USD: 1.267, EUR: 1.091, GBP: 1.165 }
    return NextResponse.json({
      rate:     fallback[currency] ?? 1,
      date:     queryDate,
      currency,
      source:   "fallback",
    })
  }
}
