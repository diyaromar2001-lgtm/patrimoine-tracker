"use client"

import { useState, useEffect, useCallback, useSyncExternalStore } from "react"
import type { AppCurrency } from "@/lib/utils"
import {
  subscribe, getSnapshot, getLastUpdated, retain, fetchPrices,
  type RawPrice,
} from "@/lib/price-store"

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
  resolvedSymbol?:   string
}

// Read currency preference from localStorage (SSR-safe)
function getStoredCurrency(): AppCurrency {
  if (typeof window === "undefined") return "CHF"
  try {
    const v = localStorage.getItem("preferred-currency")
    if (v === "USD" || v === "EUR") return v
  } catch {}
  return "CHF"
}

/** Convertit les prix bruts (3 devises) vers la devise d'affichage. */
function buildMapped(raw: Record<string, RawPrice>, currency: AppCurrency): Record<string, LivePrice> {
  const out: Record<string, LivePrice> = {}
  for (const [ticker, d] of Object.entries(raw)) {
    const price = d[currency.toLowerCase() as "chf" | "usd" | "eur"] ?? d.chf ?? 0
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
      resolvedSymbol:   d.resolvedSymbol,
    }
  }
  return out
}

const EMPTY: Record<string, RawPrice> = {}

/**
 * Prix en direct, servis par un cache commun à toute l'application.
 *
 * L'API du hook est inchangée, mais les données sont désormais partagées :
 * deux pages affichent forcément le même prix au même instant, et passer de
 * l'une à l'autre n'attend plus une nouvelle requête.
 */
export function useLivePrices(tickers: string[], intervalMs = 30_000) {
  const tickersKey = [...new Set(tickers)].sort().join(",")

  // Abonnement au cache partagé
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
  const lastUpdated = useSyncExternalStore(subscribe, getLastUpdated, () => null)

  const [currency, setCurrency] = useState<AppCurrency>("CHF")
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [loading, setLoading] = useState(false)

  // La devise ne peut être lue qu'au montage (localStorage absent en SSR)
  useEffect(() => { setCurrency(getStoredCurrency()) }, [])

  // Changement de devise : re-conversion immédiate, sans appel réseau
  useEffect(() => {
    const handler = (e: Event) => setCurrency((e as CustomEvent<AppCurrency>).detail)
    window.addEventListener("currency-changed", handler)
    return () => window.removeEventListener("currency-changed", handler)
  }, [])

  // Déclare les tickers voulus, puis demande au cache de les servir
  useEffect(() => {
    if (!tickersKey) return
    const release = retain(tickersKey.split(","))
    let active = true
    setLoading(true)
    fetchPrices().finally(() => { if (active) setLoading(false) })

    const id = setInterval(() => { fetchPrices(true) }, intervalMs)
    return () => { active = false; release(); clearInterval(id) }
  }, [tickersKey, intervalMs])

  // Compteur « il y a N secondes »
  useEffect(() => {
    if (!lastUpdated) return
    const tick = () => setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  // On ne renvoie que les tickers demandés : une page ne doit pas voir passer
  // les positions d'une autre simplement parce qu'elles sont en cache.
  const prices = (() => {
    if (!tickersKey) return {}
    const wanted = new Set(tickersKey.split(","))
    const subset: Record<string, RawPrice> = {}
    for (const [t, v] of Object.entries(raw)) if (wanted.has(t)) subset[t] = v
    return buildMapped(subset, currency)
  })()

  const refresh = useCallback(() => fetchPrices(true), [])

  return {
    prices,
    loading,
    lastUpdated,
    secondsAgo,
    nextRefreshIn: Math.max(0, Math.round(intervalMs / 1000) - secondsAgo),
    refresh,
  }
}
