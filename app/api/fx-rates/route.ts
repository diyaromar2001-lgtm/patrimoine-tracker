import { NextResponse } from "next/server"
import { cacheFetch } from "@/lib/cache"

export const runtime = "nodejs"

export interface FxRates {
  CHF: number   // = 1 (base)
  USD: number   // 1 CHF = x USD
  EUR: number   // 1 CHF = x EUR
  /** Nécessaire pour les titres cotés à Londres (VHYL, IDVY…) : sans lui,
   *  convertCurrency retombe sur 1 et n'applique aucune conversion. */
  GBP: number   // 1 CHF = x GBP
  updatedAt: string
  source: "ecb" | "fallback"
}

// Fallback rates (approximately correct as of 2026-06)
// Will ONLY be used if the API call fails
const FALLBACK: FxRates = {
  CHF: 1,
  USD: 1.2571,
  EUR: 1.0862,
  GBP: 0.9379,
  updatedAt: "fallback",
  source: "fallback",
}

async function fetchFromFrankfurter(): Promise<FxRates> {
  const res = await fetch(
    "https://api.frankfurter.app/latest?from=CHF&to=USD,EUR,GBP",
    { next: { revalidate: 3600 } }   // cache 1h on Vercel edge
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data: { rates: { USD: number; EUR: number; GBP: number }; date: string } = await res.json()
  return {
    CHF:       1,
    USD:       data.rates.USD,
    EUR:       data.rates.EUR,
    GBP:       data.rates.GBP,
    updatedAt: data.date,
    source:    "ecb",
  }
}

export async function GET() {
  const rates = await cacheFetch(
    "fx-rates",
    async () => {
      try {
        return await fetchFromFrankfurter()
      } catch (e) {
        console.error("[fx-rates] BCE fetch failed, using fallback:", e)
        return FALLBACK
      }
    },
    3600  // 1h server-side cache
  )
  return NextResponse.json(rates)
}
