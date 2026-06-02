"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useCurrency } from "@/hooks/use-currency"
import type { AppCurrency } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

const FLAGS: Record<AppCurrency, string> = { CHF: "🇨🇭", USD: "🇺🇸", EUR: "🇪🇺" }

export function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-800"
        style={{ borderColor: "var(--border)", color: "var(--foreground-muted)" }}
      >
        <span>{FLAGS[currency]}</span>
        <span className="font-semibold" style={{ color: "var(--foreground)" }}>{currency}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0,  scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.1 }}
              className="absolute right-0 top-full z-50 mt-1 w-32 overflow-hidden rounded-xl border shadow-2xl"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
            >
              {(["CHF","USD","EUR"] as AppCurrency[]).map(c => (
                <button
                  key={c}
                  onClick={() => { setCurrency(c); setOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-zinc-800"
                  style={{
                    color:           c === currency ? "white" : "var(--foreground-muted)",
                    backgroundColor: c === currency ? "var(--background-hover)" : "transparent",
                    fontWeight:      c === currency ? 600 : 400,
                  }}
                >
                  <span className="text-base">{FLAGS[c]}</span>
                  <span>{c}</span>
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
