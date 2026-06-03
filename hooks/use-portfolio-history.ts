"use client"

import { useState, useEffect, useCallback } from "react"
import { useCurrency } from "@/hooks/use-currency"
import type { PortfolioAsset, PortfolioHistoryPoint } from "@/app/api/portfolio-history/route"

interface UsePortfolioHistoryResult {
  history:  PortfolioHistoryPoint[]
  loading:  boolean
  isReal:   boolean   // true = computed from real prices, false = no data
}

export function usePortfolioHistory(
  assets: PortfolioAsset[],
  period: string
): UsePortfolioHistoryResult {
  const { currency } = useCurrency()
  const [history, setHistory]  = useState<PortfolioHistoryPoint[]>([])
  const [loading, setLoading]  = useState(false)

  const fetch_ = useCallback(async () => {
    if (!assets.length) { setHistory([]); return }
    setLoading(true)
    try {
      const res = await fetch("/api/portfolio-history", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ assets, currency, period }),
      })
      const data: PortfolioHistoryPoint[] = await res.json()
      setHistory(data)
    } catch { setHistory([]) }
    finally  { setLoading(false) }
  }, [JSON.stringify(assets), currency, period]) // eslint-disable-line

  useEffect(() => { fetch_() }, [fetch_])

  return {
    history,
    loading,
    isReal: history.length > 0,
  }
}
