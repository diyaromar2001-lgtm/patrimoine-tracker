"use client"

import { useState, useEffect, useCallback, useRef } from "react"

export interface LivePrice {
  price:     number
  change:    number
  changePct: number
  currency:  string
}

export function useLivePrices(tickers: string[], intervalMs = 30_000) {
  const [prices, setPrices]         = useState<Record<string, LivePrice>>({})
  const [loading, setLoading]       = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const tickersKey = [...tickers].sort().join(",")

  const fetchPrices = useCallback(async () => {
    if (!tickers.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/prices", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickers }),
      })
      if (!res.ok) return
      const data: Record<string, LivePrice> = await res.json()
      setPrices(data)
      setLastUpdated(new Date())
      setSecondsAgo(0)
    } catch { /* keep stale */ }
    finally { setLoading(false) }
  }, [tickersKey]) // eslint-disable-line

  // Fetch on mount + on interval
  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, intervalMs)
    return () => clearInterval(id)
  }, [fetchPrices, intervalMs])

  // Countdown ticker (updates every second)
  useEffect(() => {
    if (!lastUpdated) return
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  const nextRefreshIn = Math.max(0, Math.round(intervalMs / 1000) - secondsAgo)

  return {
    prices,
    loading,
    lastUpdated,
    secondsAgo,
    nextRefreshIn,
    refresh: fetchPrices,
  }
}
