"use client"

import { useState, useEffect, useCallback } from "react"
import type { AppCurrency } from "@/lib/utils"

export interface LivePrice {
  /** Price in the user's preferred currency */
  price:             number
  /** Price in CHF */
  chf:               number
  /** Price in USD */
  usd:               number
  /** Price in EUR */
  eur:               number
  /** Day change % */
  changePct:         number
  /** Original price in the asset's native currency (e.g. 445 for NVDA in USD) */
  originalPrice:     number
  /** Asset's native currency (e.g. "USD" for US stocks, "EUR" for EU stocks) */
  originalCurrency:  string
  /** Real Yahoo statistics, converted to the display currency. undefined = non fournies. */
  dayHigh?:          number
  dayLow?:           number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?:  number
  marketCap?:        number
  trailingPE?:       number
}

// Read currency preference from localStorage (SSR-safe)
function getStoredCurrency(): "CHF" | "USD" | "EUR" {
  if (typeof window === "undefined") return "CHF"
  try {
    const v = localStorage.getItem("preferred-currency")
    if (v === "USD" || v === "EUR") return v
  } catch {}
  return "CHF"
}

// Raw response from /api/prices (all 3 currencies + real quote statistics)
type RawPrice = {
  chf: number; usd: number; eur: number; changePct: number
  originalPrice: number; originalCurrency: string
  dayHigh?: number; dayLow?: number
  fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number
  marketCap?: number; trailingPE?: number
}

export function useLivePrices(tickers: string[], intervalMs = 30_000) {
  const [rawCache,    setRawCache]    = useState<Record<string, RawPrice>>({})
  const [prices,      setPrices]      = useState<Record<string, LivePrice>>({})
  const [loading,     setLoading]     = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo,  setSecondsAgo]  = useState(0)
  const tickersKey = [...tickers].sort().join(",")

  // Helper — build LivePrice map from raw data for a given currency
  function buildMapped(raw: Record<string, RawPrice>, currency: AppCurrency): Record<string, LivePrice> {
    const out: Record<string, LivePrice> = {}
    for (const [ticker, d] of Object.entries(raw)) {
      const price = d[currency.toLowerCase() as "chf"|"usd"|"eur"] ?? d.chf ?? 0
      // Facteur natif → devise d'affichage (identique à la conversion du prix)
      const toDisplay = d.originalPrice > 0 ? price / d.originalPrice : 1
      const aux = (v: number | undefined) => (typeof v === "number" ? v * toDisplay : undefined)
      out[ticker] = {
        price,
        chf: d.chf, usd: d.usd, eur: d.eur,
        changePct:        d.changePct,
        originalPrice:    d.originalPrice,
        originalCurrency: d.originalCurrency,
        dayHigh:          aux(d.dayHigh),
        dayLow:           aux(d.dayLow),
        fiftyTwoWeekHigh: aux(d.fiftyTwoWeekHigh),
        fiftyTwoWeekLow:  aux(d.fiftyTwoWeekLow),
        marketCap:        d.marketCap,
        trailingPE:       d.trailingPE,
      }
    }
    return out
  }

  // Re-map when raw cache updates
  useEffect(() => {
    if (!Object.keys(rawCache).length) return
    setPrices(buildMapped(rawCache, getStoredCurrency()))
  }, [rawCache]) // eslint-disable-line

  // Re-map instantly when user switches currency (no network call)
  useEffect(() => {
    const handler = (e: Event) => {
      const c = (e as CustomEvent<AppCurrency>).detail
      if (Object.keys(rawCache).length) {
        setPrices(buildMapped(rawCache, c))
      }
    }
    window.addEventListener("currency-changed", handler)
    return () => window.removeEventListener("currency-changed", handler)
  }, [rawCache]) // eslint-disable-line

  const fetchPrices = useCallback(async () => {
    if (!tickers.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      })
      if (!res.ok) return
      const raw: Record<string, { chf: number; usd: number; eur: number; changePct: number; originalPrice: number; originalCurrency: string }> = await res.json()

      // Always re-read from localStorage so currency switches apply instantly
      const currency = getStoredCurrency()
      setRawCache(raw)  // triggers the re-map effect above
      setLastUpdated(new Date())
      setSecondsAgo(0)
    } catch { /* keep stale */ }
    finally { setLoading(false) }
  }, [tickersKey]) // eslint-disable-line

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, intervalMs)
    return () => clearInterval(id)
  }, [fetchPrices, intervalMs])

  // Countdown ticker
  useEffect(() => {
    if (!lastUpdated) return
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  return {
    prices,
    loading,
    lastUpdated,
    secondsAgo,
    nextRefreshIn: Math.max(0, Math.round(intervalMs / 1000) - secondsAgo),
    refresh: fetchPrices,
  }
}
