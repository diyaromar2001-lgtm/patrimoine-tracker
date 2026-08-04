"use client"

import { useState, useEffect, useCallback } from "react"
import type { DividendEvent } from "@/lib/dividend-engine"

interface UseDividendHistoryResult {
  events:   DividendEvent[]
  loading:  boolean
  error:    string | null
  /** Tickers pour lesquels aucun versement n'a été trouvé. */
  missing:  string[]
  refresh:  () => void
}

/**
 * Récupère l'historique réel des dividendes (ex-date + montant par action)
 * pour les tickers fournis. Le croisement avec les transactions est fait
 * séparément par lib/dividend-engine.
 */
export function useDividendHistory(tickers: string[]): UseDividendHistoryResult {
  const [events, setEvents]   = useState<DividendEvent[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const key = [...tickers].sort().join(",")

  const load = useCallback(async () => {
    if (!tickers.length) {
      setEvents([]); setMissing([]); setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/dividend-history", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickers }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEvents(data.events ?? [])
      setMissing(data.missing ?? [])
    } catch (e) {
      setEvents([])
      setError("Historique des dividendes indisponible pour le moment.")
    } finally {
      setLoading(false)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  return { events, loading, error, missing, refresh: load }
}
