"use client"

import { useState, useEffect, useCallback } from "react"

export interface LivePrice {
  price:     number
  change:    number
  changePct: number
  currency:  string
}

export function useLivePrices(tickers: string[], intervalMs = 60_000) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetch_ = useCallback(async () => {
    if (!tickers.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/prices", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickers }),
      })
      const data: Record<string, LivePrice> = await res.json()
      setPrices(data)
      setLastUpdated(new Date())
    } catch {
      // silent — keep stale prices
    } finally {
      setLoading(false)
    }
  }, [tickers.join(",")])  // eslint-disable-line

  useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, intervalMs)
    return () => clearInterval(id)
  }, [fetch_, intervalMs])

  return { prices, loading, lastUpdated, refresh: fetch_ }
}
