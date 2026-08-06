"use client"

import { useState, useEffect } from "react"
import type { FundamentalsEntry } from "@/app/api/fundamentals/route"

export type FundamentalsMap = Record<string, FundamentalsEntry>

interface UseFundamentalsResult {
  data:    FundamentalsMap
  loading: boolean
  /** Tickers pour lesquels Yahoo n'a rien renvoyé — affichés comme tels. */
  missing: string[]
}

/**
 * Secteur / pays / transparence sectorielle des ETF.
 *
 * Ces données ne bougent quasiment jamais : la route les garde 24 h en cache,
 * et on ne relance la requête que si la liste de tickers change vraiment.
 */
export function useFundamentals(tickers: string[]): UseFundamentalsResult {
  const [data, setData]       = useState<FundamentalsMap>({})
  const [loading, setLoading] = useState(false)

  const key = [...new Set(tickers)].sort().join(",")

  useEffect(() => {
    if (!key) { setData({}); return }
    let cancelled = false
    setLoading(true)

    fetch("/api/fundamentals", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tickers: key.split(",") }),
    })
      .then(r => r.ok ? r.json() : {})
      .then(d => { if (!cancelled) setData(d ?? {}) })
      .catch(() => { if (!cancelled) setData({}) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [key])

  const missing = key
    ? key.split(",").filter(t => !data[t] || data[t].kind === "unknown")
    : []

  return { data, loading, missing }
}

/**
 * Répartition sectorielle « par transparence ».
 *
 * Une action apporte sa valeur à son propre secteur ; un ETF répartit la
 * sienne selon les poids du fonds. Sans cette seconde règle, un portefeuille
 * majoritairement en ETF n'aurait aucun secteur — ce qui était le cas avant.
 *
 * Renvoie aussi la part de valeur qu'on n'a pas su classer, pour pouvoir
 * l'annoncer au lieu de la diluer silencieusement dans les pourcentages.
 */
export function sectorBreakdown(
  positions: Array<{ ticker: string; value: number }>,
  fundamentals: FundamentalsMap
): { rows: Array<{ label: string; value: number; pct: number }>; unclassified: number } {
  const bySector = new Map<string, number>()
  let classified = 0
  let unclassified = 0

  for (const p of positions) {
    const f = fundamentals[p.ticker]
    if (f?.kind === "etf" && f.sectorWeights) {
      const total = Object.values(f.sectorWeights).reduce((s, w) => s + w, 0)
      if (total > 0) {
        for (const [sector, weight] of Object.entries(f.sectorWeights)) {
          const share = (weight / total) * p.value
          bySector.set(sector, (bySector.get(sector) ?? 0) + share)
        }
        classified += p.value
        continue
      }
    }
    if (f?.kind === "stock" && f.sector) {
      bySector.set(f.sector, (bySector.get(f.sector) ?? 0) + p.value)
      classified += p.value
      continue
    }
    unclassified += p.value
  }

  const rows = [...bySector.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label, value,
      pct: classified > 0 ? (value / classified) * 100 : 0,
    }))

  return { rows, unclassified }
}

/** Répartition par pays — actions seulement : un ETF mondial n'a pas un pays. */
export function countryBreakdown(
  positions: Array<{ ticker: string; value: number }>,
  fundamentals: FundamentalsMap
): { rows: Array<{ label: string; value: number; pct: number }>; unclassified: number } {
  const byCountry = new Map<string, number>()
  let classified = 0
  let unclassified = 0

  for (const p of positions) {
    const country = fundamentals[p.ticker]?.country
    if (country) {
      byCountry.set(country, (byCountry.get(country) ?? 0) + p.value)
      classified += p.value
    } else {
      unclassified += p.value
    }
  }

  const rows = [...byCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label, value,
      pct: classified > 0 ? (value / classified) * 100 : 0,
    }))

  return { rows, unclassified }
}
