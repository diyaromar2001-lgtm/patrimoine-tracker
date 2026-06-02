"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import type { AppCurrency } from "@/lib/utils"
import { formatCurrency as fmt, convertCurrency } from "@/lib/utils"

interface CurrencyContextValue {
  currency:       AppCurrency
  setCurrency:    (c: AppCurrency) => void
  format:         (value: number, fromCurrency?: AppCurrency) => string
  convert:        (value: number, from: AppCurrency) => number
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency:    "CHF",
  setCurrency: () => {},
  format:      (v) => fmt(v, "CHF"),
  convert:     (v) => v,
})

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency_] = useState<AppCurrency>("CHF")

  useEffect(() => {
    try {
      const stored = localStorage.getItem("preferred-currency") as AppCurrency | null
      if (stored && ["CHF","USD","EUR"].includes(stored)) setCurrency_(stored)
    } catch {}
  }, [])

  const setCurrency = (c: AppCurrency) => {
    setCurrency_(c)
    try {
      localStorage.setItem("preferred-currency", c)
      // Notify useLivePrices hooks to re-map prices immediately
      window.dispatchEvent(new CustomEvent("currency-changed", { detail: c }))
    } catch {}
  }

  const convert = (value: number, from: AppCurrency) => convertCurrency(value, from, currency)
  const format  = (value: number, fromCurrency?: AppCurrency) => {
    const converted = fromCurrency ? convert(value, fromCurrency) : value
    return fmt(converted, currency)
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, convert }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
