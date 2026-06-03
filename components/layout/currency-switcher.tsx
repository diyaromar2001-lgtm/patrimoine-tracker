"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useCurrency } from "@/hooks/use-currency"
import type { AppCurrency } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

const FLAGS: Record<AppCurrency, string> = { CHF: "🇨🇭", USD: "🇺🇸", EUR: "🇪🇺" }

export function CurrencySwitcher() {
  const { currency, setCurrency, fxRates, ratesSource, ratesDate } = useCurrency()
  const [open, setOpen] = useState(false)

  const isLive = ratesSource === "ecb"

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
        style={{
          borderColor:     isLive ? "var(--border)" : "#f59e0b40",
          color:           "var(--text-secondary)",
          backgroundColor: "transparent",
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-muted)")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
        title={isLive ? `Taux BCE du ${ratesDate}` : "Taux de change approximatifs (fallback)"}
      >
        <span>{FLAGS[currency]}</span>
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{currency}</span>
        {/* Live dot */}
        <span
          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
          style={{
            backgroundColor: isLive ? "#22c55e" : "#f59e0b",
            boxShadow:       isLive ? "0 0 4px #22c55e" : "none",
          }}
          title={isLive ? `Taux BCE ${ratesDate}` : "Taux approximatifs"}
        />
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.1 }}
              className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border shadow-2xl"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor:     "var(--border)",
                boxShadow:       "0 12px 40px rgba(0,0,0,0.5)",
              }}
            >
              {/* Source header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <span
                  className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: isLive ? "#22c55e" : "#f59e0b" }}
                />
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {isLive
                    ? `Taux BCE — ${ratesDate}`
                    : "Taux approximatifs (offline)"
                  }
                </span>
              </div>

              {/* Currency options */}
              {(["CHF","USD","EUR"] as AppCurrency[]).map(c => (
                <button
                  key={c}
                  onClick={() => { setCurrency(c); setOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors"
                  style={{
                    color:           c === currency ? "white" : "var(--text-secondary)",
                    backgroundColor: c === currency ? "var(--bg-subtle)" : "transparent",
                    fontWeight:      c === currency ? 600 : 400,
                  }}
                  onMouseEnter={e => { if (c !== currency) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-muted)" }}
                  onMouseLeave={e => { if (c !== currency) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
                >
                  <span className="text-base w-6">{FLAGS[c]}</span>
                  <div className="flex-1 text-left">
                    <span>{c}</span>
                    {c !== "CHF" && (
                      <span className="ml-2 text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        1 CHF = {fxRates[c]?.toFixed(4)} {c}
                      </span>
                    )}
                  </div>
                  {c === currency && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
