"use client"

import { useRef, useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, Loader2, TrendingUp } from "lucide-react"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import type { AssetClass } from "@/lib/types"

interface AssetSearchProps {
  onSelect: (result: SearchResult) => void
  placeholder?: string
  className?: string
}

const TYPE_ICON_MAP: Record<string, string> = {
  stock: "📈", etf: "🏦", crypto: "₿", bond: "📋", real_estate: "🏠", cash: "💵",
}

export function AssetSearch({ onSelect, placeholder = "Rechercher un actif… (AAPL, BTC, CW8…)", className }: AssetSearchProps) {
  const { query, setQuery, results, loading, clear } = useAssetSearch(250)
  const [open, setOpen]     = useState(false)
  const [cursor, setCursor] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(results.length > 0 && query.length > 0)
    setCursor(-1)
  }, [results, query])

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === "Enter" && cursor >= 0) { pick(results[cursor]); e.preventDefault() }
    if (e.key === "Escape") { setOpen(false); setCursor(-1) }
  }

  function pick(result: SearchResult) {
    onSelect(result)
    clear()
    setOpen(false)
  }

  const color = (type: string) => ASSET_CLASS_COLORS[type as AssetClass] ?? "#6b7280"

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* Input */}
      <div className="relative">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" style={{ color: "var(--text-tertiary)" }} />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        }
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm outline-none transition-all"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: open ? "var(--accent)" : "var(--border)",
            color: "var(--text-primary)",
            boxShadow: open ? "0 0 0 3px #3b82f620" : "none",
          }}
        />
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={listRef}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-y-auto rounded-xl border shadow-2xl"
            style={{
              maxHeight: "280px",
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
            }}
          >
            {results.map((r, i) => {
              const col = color(r.type)
              const isActive = cursor === i
              return (
                <button
                  key={r.ticker}
                  onMouseDown={() => pick(r)}
                  onMouseEnter={() => setCursor(i)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    backgroundColor: isActive ? "var(--bg-muted)" : "transparent",
                    borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                  }}
                >
                  {/* Colored circle */}
                  <div
                    className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: col + "22", color: col }}
                  >
                    {r.ticker.slice(0, 3)}
                  </div>

                  {/* Name + ticker */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{r.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono" style={{ color: col }}>{r.ticker}</span>
                      {r.exchange && <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{r.exchange}</span>}
                    </div>
                  </div>

                  {/* Type badge */}
                  <span
                    className="flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: col + "18", color: col }}
                  >
                    {ASSET_CLASS_LABELS[r.type as AssetClass] ?? r.type}
                  </span>
                </button>
              )
            })}

            {/* Footer hint */}
            <div className="flex items-center gap-1 px-4 py-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <TrendingUp className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                ↑↓ naviguer · Entrée sélectionner · Échap fermer
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
