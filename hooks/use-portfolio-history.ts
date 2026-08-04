"use client"

import { useState, useEffect, useCallback } from "react"
import { useCurrency } from "@/hooks/use-currency"
import type { PortfolioAsset, PortfolioHistoryPoint } from "@/app/api/portfolio-history/route"

export interface HistoryCoverage {
  /** Nombre de positions dont Yahoo a fourni un historique. */
  resolved: number
  total:    number
  /** Tickers sans historique disponible — exclus de la courbe. */
  missing:  string[]
}

interface UsePortfolioHistoryResult {
  history:  PortfolioHistoryPoint[]
  loading:  boolean
  isReal:   boolean   // true = computed from real prices, false = no data
  /** Permet d'afficher « courbe basée sur 8 positions sur 9 ». */
  coverage: HistoryCoverage
}

export function usePortfolioHistory(
  assets: PortfolioAsset[],
  period: string
): UsePortfolioHistoryResult {
  const { currency } = useCurrency()
  const [history, setHistory]   = useState<PortfolioHistoryPoint[]>([])
  const [coverage, setCoverage] = useState<HistoryCoverage>({ resolved: 0, total: 0, missing: [] })
  const [loading, setLoading]   = useState(false)

  const fetch_ = useCallback(async () => {
    if (!assets.length) {
      setHistory([])
      setCoverage({ resolved: 0, total: 0, missing: [] })
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/portfolio-history", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ assets, currency, period }),
      })
      const data = await res.json()
      // Tolère l'ancien format (tableau nu) au cas où une réponse serait
      // servie depuis un cache CDN antérieur au changement de contrat.
      if (Array.isArray(data)) {
        setHistory(data)
        setCoverage({ resolved: assets.length, total: assets.length, missing: [] })
      } else {
        setHistory(data.history ?? [])
        setCoverage(data.coverage ?? { resolved: 0, total: assets.length, missing: [] })
      }
    } catch {
      setHistory([])
      setCoverage({ resolved: 0, total: assets.length, missing: [] })
    }
    finally  { setLoading(false) }
  }, [JSON.stringify(assets), currency, period]) // eslint-disable-line

  useEffect(() => { fetch_() }, [fetch_])

  return {
    history,
    loading,
    isReal: history.length > 0,
    coverage,
  }
}
