"use client"

import { useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import { Search, X, TrendingUp, Loader2, Command, CornerDownLeft } from "lucide-react"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import type { AssetClass } from "@/lib/types"

const QUICK_LINKS = [
  { label: "Dashboard",      href: "/",            icon: "📊" },
  { label: "Portefeuilles",  href: "/portfolios",  icon: "💼" },
  { label: "Watchlist",      href: "/watchlist",   icon: "👁" },
  { label: "Transactions",   href: "/transactions",icon: "↔" },
  { label: "Dividendes",     href: "/dividends",   icon: "💰" },
  { label: "DCA Calculator", href: "/dca-calculator",icon: "📈" },
]

interface GlobalSearchProps {
  onSelectAsset?: (result: SearchResult) => void
}

export function GlobalSearch({ onSelectAsset }: GlobalSearchProps) {
  const [open, setOpen]   = useState(false)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const { query, setQuery, results, loading, clear } = useAssetSearch(200)
  const [cursor, setCursor] = useState(-1)

  useEffect(() => { setMounted(true) }, [])

  // CMD+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50) }
    else { clear(); setCursor(-1) }
  }, [open]) // eslint-disable-line

  function handleKey(e: React.KeyboardEvent) {
    const total = results.length + QUICK_LINKS.length
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => (c + 1) % total) }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => (c - 1 + total) % total) }
    if (e.key === "Enter") {
      if (cursor >= 0 && cursor < results.length) pickAsset(results[cursor])
      else if (cursor >= results.length) {
        const link = QUICK_LINKS[cursor - results.length]
        if (link) { router.push(link.href); setOpen(false) }
      }
    }
  }

  function pickAsset(r: SearchResult) {
    onSelectAsset?.(r)
    router.push(`/watchlist`)
    setOpen(false)
  }

  if (!mounted) return (
    <button
      className="hidden sm:flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800"
      style={{ borderColor: "var(--border)", color: "var(--foreground-muted)" }}
      onClick={() => setOpen(true)}
    >
      <Search className="h-3.5 w-3.5" />
      <span>Rechercher…</span>
      <span className="ml-2 flex items-center gap-0.5 rounded px-1 text-[10px]"
        style={{ backgroundColor: "var(--background-hover)", color: "var(--foreground-dim)" }}>
        <Command className="h-2.5 w-2.5" />K
      </span>
    </button>
  )

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800"
        style={{ borderColor: "var(--border)", color: "var(--foreground-muted)" }}
        aria-label="Recherche globale (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Rechercher…</span>
        <kbd className="ml-2 flex items-center gap-0.5 rounded px-1 text-[10px]"
          style={{ backgroundColor: "var(--background-hover)", color: "var(--foreground-dim)" }}>
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      {/* Modal via portal */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[100]"
                style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
                onClick={() => setOpen(false)}
              />

              {/* Panel */}
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1,    y: 0 }}
                exit={{ opacity: 0,  scale: 0.96, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="fixed left-1/2 top-24 z-[101] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-2xl shadow-2xl"
                style={{
                  backgroundColor: "var(--background-card)",
                  border: "1px solid var(--border)",
                  boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)",
                }}
              >
                {/* Input */}
                <div className="flex items-center gap-3 border-b px-4 py-3.5"
                  style={{ borderColor: "var(--border)" }}>
                  {loading
                    ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" style={{ color: "var(--accent)" }} />
                    : <Search className="h-4 w-4 flex-shrink-0" style={{ color: "var(--foreground-muted)" }} />
                  }
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={e => { setQuery(e.target.value); setCursor(-1) }}
                    onKeyDown={handleKey}
                    placeholder="Chercher un actif, une page… (AAPL, BTC, dashboard)"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                    style={{ color: "var(--foreground)" }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {query && (
                    <button onClick={clear} className="rounded p-0.5 hover:bg-zinc-800 transition-colors">
                      <X className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} />
                    </button>
                  )}
                  <button onClick={() => setOpen(false)} className="rounded-md border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-zinc-800"
                    style={{ borderColor: "var(--border)", color: "var(--foreground-dim)" }}>
                    Échap
                  </button>
                </div>

                {/* Results */}
                <div className="max-h-80 overflow-y-auto">
                  {/* Asset results */}
                  {results.length > 0 && (
                    <div>
                      <p className="px-4 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: "var(--foreground-dim)" }}>
                        Actifs financiers
                      </p>
                      {results.map((r, i) => {
                        const color = ASSET_CLASS_COLORS[r.type as AssetClass] ?? "#6b7280"
                        const isActive = cursor === i
                        return (
                          <button key={r.ticker} onMouseDown={() => pickAsset(r)}
                            onMouseEnter={() => setCursor(i)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                            style={{ backgroundColor: isActive ? "var(--background-hover)" : "transparent" }}>
                            <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
                              style={{ backgroundColor: color + "22", color }}>
                              {r.ticker.slice(0, 3)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{r.name}</p>
                              <p className="text-xs" style={{ color: "var(--foreground-dim)" }}>
                                <span style={{ color }}>{r.ticker}</span>
                                {r.exchange ? ` · ${r.exchange}` : ""}
                              </p>
                            </div>
                            <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
                              style={{ backgroundColor: color + "18", color }}>
                              {ASSET_CLASS_LABELS[r.type as AssetClass] ?? r.type}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Quick navigation */}
                  <div>
                    <p className="px-4 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider"
                      style={{ color: "var(--foreground-dim)" }}>
                      Navigation rapide
                    </p>
                    {QUICK_LINKS.filter(l =>
                      !query || l.label.toLowerCase().includes(query.toLowerCase())
                    ).map((link, i) => {
                      const idx = results.length + i
                      const isActive = cursor === idx
                      return (
                        <button key={link.href}
                          onMouseDown={() => { router.push(link.href); setOpen(false) }}
                          onMouseEnter={() => setCursor(idx)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                          style={{ backgroundColor: isActive ? "var(--background-hover)" : "transparent" }}>
                          <span className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-base"
                            style={{ backgroundColor: "var(--background-hover)" }}>
                            {link.icon}
                          </span>
                          <span className="text-sm" style={{ color: "var(--foreground)" }}>{link.label}</span>
                          {isActive && <CornerDownLeft className="ml-auto h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-4 border-t px-4 py-2"
                  style={{ borderColor: "var(--border)" }}>
                  {[["↑↓", "naviguer"], ["↵", "sélectionner"], ["Échap", "fermer"]].map(([k, l]) => (
                    <span key={k} className="flex items-center gap-1 text-[11px]" style={{ color: "var(--foreground-dim)" }}>
                      <kbd className="rounded border px-1 py-0.5 text-[10px]"
                        style={{ borderColor: "var(--border)", backgroundColor: "var(--background-hover)" }}>{k}</kbd>
                      {l}
                    </span>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
