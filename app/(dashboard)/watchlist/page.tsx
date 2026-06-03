"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { DualPrice } from "@/components/ui/dual-price"
import { Sparkline } from "@/components/ui/sparkline"
import { AssetSearch } from "@/components/ui/asset-search"
import { LiveChart } from "@/components/charts/live-chart"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import type { WatchlistItem } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import { useLivePrices } from "@/hooks/use-live-prices"
import type { SearchResult } from "@/hooks/use-asset-search"

import { X, Eye, RefreshCw } from "lucide-react"

export default function WatchlistPage() {
  // Start empty when Supabase is configured (real user account)
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string>("")
  const [search, setSearch] = useState("")

  const tickers = items.map(i => i.ticker)
  const { prices, loading: pricesLoading, secondsAgo, nextRefreshIn, refresh } = useLivePrices(tickers, 30_000)

  const filtered = items.filter(item =>
    item.ticker.toLowerCase().includes(search.toLowerCase()) ||
    item.name.toLowerCase().includes(search.toLowerCase())
  )

  function handleAddFromSearch(result: SearchResult) {
    if (items.find(i => i.ticker === result.ticker)) return
    const newItem: WatchlistItem = {
      id: Date.now().toString(),
      ticker: result.ticker,
      name: result.name,
      assetClass: result.type as WatchlistItem["assetClass"],
      currentPrice: 0,
      change24h: 0,
      changePct24h: 0,
      high24h: 0,
      low24h: 0,
      currency: "EUR",
      sparkline: [],
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

  const updatedLabel = secondsAgo > 0
    ? ` · Mis à jour il y a ${secondsAgo}s — prochain dans ${nextRefreshIn}s`
    : " · Chargement…"

  return (
    <div className="flex flex-col">
      <Topbar
        title="Watchlist"
        subtitle={items.length + " actif" + (items.length > 1 ? "s" : "") + " suivis" + updatedLabel}
      />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">

        {/* Search + refresh */}
        <div className="flex items-center gap-3">
          <AssetSearch onSelect={handleAddFromSearch} className="flex-1 max-w-md" />
          <button
            onClick={refresh}
            disabled={pricesLoading}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-800/50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <RefreshCw className={"h-3.5 w-3.5" + (pricesLoading ? " animate-spin" : "")} />
            Actualiser
          </button>
        </div>

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
          {/* Asset list */}
          <div className="lg:col-span-2 space-y-2">
            <SectionHeader title="Mes actifs" description="Cliquer pour voir le graphique" />
            <div className="space-y-1">
              {filtered.map((item, i) => {
                const live        = prices[item.ticker]
                const price       = live?.price ?? item.currentPrice
                const pct         = live?.changePct ?? item.changePct24h
                const origPrice   = live?.originalPrice
                const origCurrency= live?.originalCurrency
                const color = ASSET_CLASS_COLORS[item.assetClass]
                const isSelected = selectedTicker === item.ticker

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <button
                      onClick={() => { setSelectedTicker(item.ticker); setSelectedName(item.name) }}
                      className="w-full flex items-center gap-3 rounded-xl border px-4 py-3 transition-all text-left"
                      style={{
                        backgroundColor: isSelected ? "var(--bg-muted)" : "var(--bg-elevated)",
                        borderColor:     isSelected ? "var(--accent)" : "var(--border)",
                        boxShadow:       isSelected ? "0 0 0 1px var(--accent)" : "none",
                      }}
                    >
                      <div
                        className="h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center text-[11px] font-bold"
                        style={{ backgroundColor: color + "22", color }}
                      >
                        {item.ticker.replace("-EUR", "").slice(0, 3)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {item.name}
                        </p>
                        <AssetClassBadge label={ASSET_CLASS_LABELS[item.assetClass]} color={color} />
                      </div>

                      <div className="text-right">
                        {price > 0
                          ? <DualPrice price={price} originalPrice={origPrice} originalCurrency={origCurrency} size="sm" showFlag />
                          : <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>--</span>
                        }
                        <ChangeBadge value={pct} showIcon={false} />
                      </div>

                      <Sparkline
                        data={item.sparkline.length ? item.sparkline : [price * 0.98, price]}
                        positive={pct >= 0}
                        width={52}
                        height={24}
                      />

                      <button
                        onMouseDown={e => { e.stopPropagation(); handleRemove(item.id) }}
                        className="flex-shrink-0 h-6 w-6 rounded-md flex items-center justify-center hover:bg-red-500/20 transition-colors"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </button>
                  </motion.div>
                )
              })}

              {filtered.length === 0 && (
                <div className="flex flex-col items-center py-10 gap-2">
                  <Eye className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    Recherchez un actif pour l&apos;ajouter
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Chart panel */}
          <div className="lg:col-span-3">
            {selectedTicker ? (
              <LiveChart
                ticker={selectedTicker}
                name={selectedName}
                height={380}
                defaultCompare="SPY"
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center h-64 rounded-xl border"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
              >
                <Eye className="h-8 w-8 mb-2" style={{ color: "var(--text-tertiary)" }} />
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  Selectionnez un actif
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
