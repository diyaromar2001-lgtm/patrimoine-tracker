"use client"

import { useState, useEffect, useCallback } from "react"

export interface SwingIndicators {
  ticker:        string
  rsi14:         number | null
  ma20:          number | null
  ma50:          number | null
  distMa20Pct:   number | null
  volRatio:      number | null
  vol20:         number | null
  high4w:        number | null
  low4w:         number | null
  signal:        "BUY" | "HOLD" | "SELL" | null
  signalScore:   number
  signalReasons: string[]
}

export function useSwingIndicators(tickers: string[], intervalMs = 900_000) {
  const [data,    setData]    = useState<Record<string, SwingIndicators>>({})
  const [loading, setLoading] = useState(false)

  const key = tickers.join(",")

  const fetchData = useCallback(async () => {
    if (!tickers.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/swing-indicators", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickers }),
      })
      if (res.ok) setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [key]) // eslint-disable-line

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, intervalMs)
    return () => clearInterval(id)
  }, [fetchData, intervalMs])

  return { indicators: data, loading, refresh: fetchData }
}
