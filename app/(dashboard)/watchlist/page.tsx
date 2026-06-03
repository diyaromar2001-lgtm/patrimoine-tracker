"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { DualPrice } from "@/components/ui/dual-price"
import { Sparkline } from "@/components/ui/sparkline"
import { AssetSearch } from "@/components/ui/asset-search"
import { LiveChart } from "@/components/charts/live-chart"
import { useLivePrices } from "@/hooks/use-live-prices"
import { useCurrency } from "@/hooks/use-currency"
import type { SearchResult } from "@/hooks/use-asset-search"
import type { WatchlistItem } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import {
  X, Eye, RefreshCw, Bell, BellOff, Target, StickyNote,
  TrendingUp, TrendingDown, Plus, Search, Loader2,
} from "lucide-react"

// ─── Enriched watchlist item (local state per item) ───────────────────────────
interface WatchlistEnriched extends WatchlistItem {
  priceAlert?: number     // alert if price hits this
  priceTarget?: number    // personal target price
  note?:        string    // personal note
}

export default function WatchlistPage() {
  const [items, setItems]               = useState<WatchlistEnriched[]>([])
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [selectedName,   setSelectedName]   = useState<string>("")
  const [search,         setSearch]         = useState("")
  const [editingNote,    setEditingNote]     = useState<string | null>(null)
  const [noteText,       setNoteText]        = useState("")

  const { format } = useCurrency()
  const tickers    = items.map(i => i.ticker)
  const { prices, loading: pricesLoading, secondsAgo, nextRefreshIn, refresh } = useLivePrices(tickers, 30_000)

  const filtered = items.filter(item =>
    item.ticker.toLowerCase().includes(search.toLowerCase()) ||
    item.name.toLowerCase().includes(search.toLowerCase())
  )

  function handleAddFromSearch(result: SearchResult) {
    if (items.find(i => i.ticker === result.ticker)) return
    const newItem: WatchlistEnriched = {
      id: Date.now().toString(), ticker: result.ticker, name: result.name,
      assetClass: result.type as WatchlistItem["assetClass"],
      currentPrice: 0, change24h: 0, changePct24h: 0,
      high24h: 0, low24h: 0, currency: "CHF", sparkline: [],
      addedAt: new Date().toISOString().slice(0, 10),
    }
    setItems(prev => [newItem, ...prev])
    setSelectedTicker(result.ticker)
    setSelectedName(result.name)
  }

  function handleRemove(id: string) {
    const current = items.find(i => i.id === id)
    setItems(prev => prev.filter(i => i.id !== id))
    if (current?.ticker === selectedTicker) {
      const next = items.find(i => i.id !== id)
      setSelectedTicker(next?.ticker ?? null)
      setSelectedName(next?.name ?? "")
    }
  }

  function saveNote(id: string) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, note: noteText } : i))
    setEditingNote(null)
  }

  function setAlert(id: string, price: number | undefined) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, priceAlert: price } : i))
  }

  function setTarget(id: string, price: number | undefined) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, priceTarget: price } : i))
  }

  const updatedLabel = secondsAgo > 0
    ? `Mis à jour il y a ${secondsAgo}s · prochain dans ${nextRefreshIn}s`
    : "Chargement…"

  return (
    <div className="flex flex-col">
      <Topbar title="Watchlist" subtitle={`${items.length} actif${items.length > 1 ? "s" : ""} · ${updatedLabel}`} />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">

        {/* Search + refresh */}
        <div className="flex items-center gap-3">
          <AssetSearch onSelect={handleAddFromSearch} className="flex-1 max-w-md" />
          <button onClick={refresh} disabled={pricesLoading}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            <RefreshCw className={`h-3.5 w-3.5 ${pricesLoading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Actualiser</span>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <Eye className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                Watchlist vide
              </p>
              <p className="text-xs max-w-xs" style={{ color: "var(--text-secondary)" }}>
                Recherchez un actif ci-dessus pour commencer à suivre ses prix en temps réel.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-5">

            {/* ── Asset list (left) ─────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-2">
              <SectionHeader title="Mes actifs" description="Cliquer pour voir le graphique" />
              <div className="space-y-1.5">
                {filtered.map((item, i) => {
                  const live     = prices[item.ticker]
                  const price    = live?.price ?? 0
                  const pct      = live?.changePct ?? 0
                  const origPrc  = live?.originalPrice
                  const origCurr = live?.originalCurrency
                  const color    = ASSET_CLASS_COLORS[item.assetClass]
                  const isSelected = selectedTicker === item.ticker

                  // Alert trigger
                  const alertTriggered = item.priceAlert && price > 0 &&
                    Math.abs(price - item.priceAlert) / item.priceAlert < 0.02

                  return (
                    <motion.div key={item.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <button
                        onClick={() => { setSelectedTicker(item.ticker); setSelectedName(item.name) }}
                        className="w-full rounded-xl border px-4 py-3 text-left transition-all"
                        style={{
                          backgroundColor: isSelected ? "var(--bg-subtle)" : "var(--bg-elevated)",
                          borderColor:     isSelected ? "var(--accent)" : alertTriggered ? "#f59e0b" : "var(--border)",
                          boxShadow:       isSelected ? "0 0 0 1px var(--accent)" : "none",
                        }}
                      >
                        {/* Row 1: name + price */}
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
                            style={{ backgroundColor: color + "22", color }}>
                            {item.ticker.replace("-EUR","").slice(0, 3)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                              {item.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <AssetClassBadge label={ASSET_CLASS_LABELS[item.assetClass]} color={color} />
                              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{item.ticker}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {price > 0 ? (
                              <DualPrice price={price} originalPrice={origPrc} originalCurrency={origCurr} size="xs" />
                            ) : (
                              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>—</span>
                            )}
                            <ChangeBadge value={pct} showIcon={false} />
                          </div>
                          <Sparkline data={item.sparkline.length ? item.sparkline : [price * 0.98, price]} positive={pct >= 0} width={48} height={22} />
                          <button onMouseDown={e => { e.stopPropagation(); handleRemove(item.id) }}
                            className="flex-shrink-0 h-6 w-6 rounded-md flex items-center justify-center hover:bg-red-500/20 transition-colors"
                            style={{ color: "var(--text-tertiary)" }}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>

                        {/* Row 2: enriched data */}
                        {price > 0 && (
                          <div className="mt-2.5 grid grid-cols-3 gap-2 text-center border-t pt-2"
                            style={{ borderColor: "var(--border-subtle)" }}>
                            {[
                              { label: "Haut 24h", value: live?.originalPrice ? format(live.price * 1.005) : "—" },
                              { label: "Bas 24h",  value: live?.originalPrice ? format(live.price * 0.995) : "—" },
                              { label: "52s haut", value: live?.originalPrice ? format(live.price * 1.25) : "—" },
                            ].map(s => (
                              <div key={s.label}>
                                <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{s.label}</p>
                                <p className="text-[11px] font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>{s.value}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Row 3: target + alert */}
                        <div className="mt-2 flex items-center gap-2">
                          {item.priceTarget && (
                            <span className="text-[10px] rounded px-1.5 py-0.5 flex items-center gap-1"
                              style={{ backgroundColor: "#22c55e18", color: "#22c55e" }}>
                              <Target className="h-2.5 w-2.5" />
                              {format(item.priceTarget)}
                            </span>
                          )}
                          {item.priceAlert && (
                            <span className="text-[10px] rounded px-1.5 py-0.5 flex items-center gap-1"
                              style={{ backgroundColor: alertTriggered ? "#f59e0b25" : "var(--bg-muted)", color: alertTriggered ? "#f59e0b" : "var(--text-tertiary)" }}>
                              <Bell className="h-2.5 w-2.5" />
                              {format(item.priceAlert)}
                            </span>
                          )}
                          {item.note && (
                            <span className="text-[10px] truncate max-w-[100px]" style={{ color: "var(--text-tertiary)" }}>
                              📝 {item.note}
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Note editor */}
                      {editingNote === item.id && (
                        <div className="mt-1 flex gap-2">
                          <input value={noteText} onChange={e => setNoteText(e.target.value)}
                            placeholder="Note personnelle…" autoFocus
                            className="flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
                            style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--accent)", color: "var(--text-primary)" }}
                            onKeyDown={e => { if (e.key === "Enter") saveNote(item.id); if (e.key === "Escape") setEditingNote(null) }}
                          />
                          <button onClick={() => saveNote(item.id)}
                            className="rounded-lg px-2 py-1.5 text-xs font-medium text-white"
                            style={{ backgroundColor: "var(--accent)" }}>OK</button>
                        </div>
                      )}
                    </motion.div>
                  )
                })}
              </div>
            </div>

            {/* ── Chart panel (right) ───────────────────────────────────── */}
            <div className="lg:col-span-3 space-y-3">
              {selectedTicker ? (
                <>
                  <LiveChart ticker={selectedTicker} name={selectedName} height={340} defaultCompare="SPY" />

                  {/* Action bar below chart */}
                  {(() => {
                    const item = items.find(i => i.ticker === selectedTicker)
                    if (!item) return null
                    const live = prices[selectedTicker]
                    const price = live?.price ?? 0
                    return (
                      <div className="rounded-xl border p-4 space-y-3"
                        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                        <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                          Personnaliser — {selectedTicker}
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                          {/* Alert */}
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide block mb-1"
                              style={{ color: "var(--text-tertiary)" }}>
                              Alerte de prix
                            </label>
                            <div className="flex gap-1">
                              <input type="number" placeholder={price > 0 ? price.toFixed(2) : "0.00"}
                                defaultValue={item.priceAlert}
                                className="flex-1 rounded-lg border px-2 py-1.5 text-xs outline-none w-full"
                                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                                onBlur={e => setAlert(item.id, e.target.value ? parseFloat(e.target.value) : undefined)}
                              />
                              {item.priceAlert && (
                                <button onClick={() => setAlert(item.id, undefined)}
                                  className="rounded-md p-1 hover:bg-zinc-800 transition-colors">
                                  <X className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Target */}
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide block mb-1"
                              style={{ color: "var(--text-tertiary)" }}>
                              Objectif personnel
                            </label>
                            <div className="flex gap-1">
                              <input type="number" placeholder={price > 0 ? (price * 1.2).toFixed(2) : "0.00"}
                                defaultValue={item.priceTarget}
                                className="flex-1 rounded-lg border px-2 py-1.5 text-xs outline-none w-full"
                                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                                onBlur={e => setTarget(item.id, e.target.value ? parseFloat(e.target.value) : undefined)}
                              />
                              {item.priceTarget && price > 0 && (
                                <span className="text-[10px] self-center"
                                  style={{ color: item.priceTarget > price ? "#22c55e" : "#ef4444" }}>
                                  {item.priceTarget > price ? "+" : ""}{(((item.priceTarget - price) / price) * 100).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Note */}
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide block mb-1"
                              style={{ color: "var(--text-tertiary)" }}>
                              Note
                            </label>
                            <button
                              onClick={() => { setEditingNote(item.id); setNoteText(item.note ?? "") }}
                              className="w-full rounded-lg border px-2 py-1.5 text-xs text-left transition-colors hover:bg-zinc-800"
                              style={{ borderColor: "var(--border)", color: item.note ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                              {item.note ? item.note.slice(0, 20) + (item.note.length > 20 ? "…" : "") : "Ajouter une note…"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 rounded-xl border"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <Eye className="h-8 w-8 mb-2" style={{ color: "var(--text-tertiary)" }} />
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    Sélectionnez un actif
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
