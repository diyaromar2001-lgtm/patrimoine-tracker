"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import type { AppCurrency, FXRates } from "@/lib/utils"
import { formatCurrency as fmt, DEFAULT_FX_RATES } from "@/lib/utils"
import type { FxRates } from "@/app/api/fx-rates/route"

interface CurrencyContextValue {
  currency:    AppCurrency
  setCurrency: (c: AppCurrency) => void
  fxRates:     FXRates
  ratesSource: "ecb" | "fallback" | "loading"
  ratesDate:   string
  format:      (value: number, fromCurrency?: AppCurrency) => string
  convert:     (value: number, from: AppCurrency) => number
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency:    "CHF",
  setCurrency: () => {},
  fxRates:     DEFAULT_FX_RATES,
  ratesSource: "loading",
  ratesDate:   "",
  format:      (v) => fmt(v, "CHF"),
  convert:     (v) => v,
})

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency,     setCurrency_]  = useState<AppCurrency>("CHF")
  const [fxRates,      setFxRates]    = useState<FXRates>(DEFAULT_FX_RATES)
  const [ratesSource,  setRatesSource] = useState<"ecb" | "fallback" | "loading">("loading")
  const [ratesDate,    setRatesDate]   = useState("")

  // Load stored currency preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem("preferred-currency") as AppCurrency | null
      if (stored && ["CHF","USD","EUR"].includes(stored)) setCurrency_(stored)
    } catch {}
  }, [])

  // Fetch live FX rates from BCE (via our /api/fx-rates proxy)
  useEffect(() => {
    fetch("/api/fx-rates")
      .then(r => r.json())
      .then((data: FxRates) => {
        setFxRates({ CHF: 1, USD: data.USD, EUR: data.EUR })
        setRatesSource(data.source)
        setRatesDate(data.updatedAt)
        // Notify live-price hooks to recalculate with new rates
        window.dispatchEvent(new CustomEvent("fx-rates-updated", { detail: { CHF: 1, USD: data.USD, EUR: data.EUR } }))
      })
      .catch(() => {
        setRatesSource("fallback")
        setRatesDate("—")
      })
  }, [])

  const setCurrency = (c: AppCurrency) => {
    setCurrency_(c)
    try {
      localStorage.setItem("preferred-currency", c)
      window.dispatchEvent(new CustomEvent("currency-changed", { detail: c }))
    } catch {}
  }

  // Convert using LIVE rates
  const convert = useCallback((value: number, from: AppCurrency): number => {
    if (from === currency) return value
    // to CHF first, then to target
    const chf = value / (fxRates[from] ?? 1)
    return chf * (fxRates[currency] ?? 1)
  }, [currency, fxRates])

  const format = useCallback((value: number, fromCurrency?: AppCurrency): string => {
    const converted = fromCurrency ? convert(value, fromCurrency) : value
    return fmt(converted, currency)
  }, [convert, currency])

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, fxRates, ratesSource, ratesDate, format, convert }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
