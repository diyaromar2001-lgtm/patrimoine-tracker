"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { Sparkline } from "@/components/ui/sparkline"
import { MOCK_WATCHLIST } from "@/lib/mock-data"
import type { WatchlistItem } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import { Plus, Search, X, Star, Eye } from "lucide-react"
import { AnimatePresence } from "framer-motion"

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>(MOCK_WATCHLIST)
  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ticker: "", name: "", assetClass: "stock" as WatchlistItem["assetClass"], currentPrice: "", change24h: "", changePct24h: "" })

  const filtered = items.filter(item =>
    item.ticker.toLowerCase().includes(search.toLowerCase()) ||
    item.name.toLowerCase().includes(search.toLowerCase())
  )

  function handleAdd() {
    if (!form.ticker || !form.name || !form.currentPrice) return
    const item: WatchlistItem = {
      id: `w${Date.now()}`, ticker: form.ticker.toUpperCase(), name: form.name,
      assetClass: form.assetClass, currentPrice: parseFloat(form.currentPrice),
      change24h: parseFloat(form.change24h) || 0, changePct24h: parseFloat(form.changePct24h) || 0,
      high24h: parseFloat(form.currentPrice) * 1.02, low24h: parseFloat(form.currentPrice) * 0.98,
      currency: "EUR", sparkline: Array.from({ length: 14 }, (_, i) => parseFloat(form.currentPrice) * (1 + (i - 7) * 0.005)),
      addedAt: new Date().toISOString().slice(0, 10),
    }
    setItems(prev => [item, ...prev])
    setForm({ ticker: "", name: "", assetClass: "stock", currentPrice: "", change24h: "", changePct24h: "" })
    setShowAdd(false)
  }

  function handleRemove(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Watchlist" subtitle={`${items.length} actif${items.length > 1 ? "s" : ""} suivis`} />
      <div className="flex-1 space-y-6 p-6">

        {/* Search + Add */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />
            <input type="text" placeholder="Rechercher un actif…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm outline-none"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
          <div className="grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)", gridTemplateColumns: "1fr 100px 80px 80px 80px 100px 32px" }}>
            <span>Actif</span><span className="text-right">Prix</span><span className="text-right">24h</span><span className="text-right">Haut</span><span className="text-right">Bas</span><span className="text-right">Tendance</span><span />
          </div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-3">
              <Eye className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
              <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Aucun actif dans la watchlist</p>
            </div>
          )}

          {filtered.map((item, i) => {
            const color = ASSET_CLASS_COLORS[item.assetClass]
            return (
              <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                className="grid items-center px-5 py-3.5 transition-colors hover:bg-zinc-800/20"
                style={{ gridTemplateColumns: "1fr 100px 80px 80px 80px 100px 32px", borderTop: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>{item.ticker.slice(0, 3)}</div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{item.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>{item.ticker}</span>
                      <AssetClassBadge label={ASSET_CLASS_LABELS[item.assetClass]} color={color} />
                    </div>
                  </div>
                </div>
                <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>{formatCurrency(item.currentPrice)}</p>
                <div className="flex justify-end"><ChangeBadge value={item.changePct24h} showIcon={false} /></div>
                <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{formatCurrency(item.high24h)}</p>
                <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{formatCurrency(item.low24h)}</p>
                <div className="flex justify-end">
                  <Sparkline data={item.sparkline} positive={item.changePct24h >= 0} width={80} height={28} />
                </div>
                <button onClick={() => handleRemove(item.id)} className="flex items-center justify-center h-7 w-7 rounded-md transition-colors hover:bg-red-500/20 ml-auto" style={{ color: "var(--foreground-dim)" }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-md rounded-2xl border p-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Ajouter à la watchlist</h3>
                <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors"><X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} /></button>
              </div>
              <div className="space-y-3">
                {[{ k: "ticker", ph: "Ticker (ex: NVDA)", t: "text", label: "Ticker *" }, { k: "name", ph: "Nom complet", t: "text", label: "Nom *" }, { k: "currentPrice", ph: "Prix actuel (€)", t: "number", label: "Prix actuel *" }, { k: "change24h", ph: "Variation (€)", t: "number", label: "Variation 24h (€)" }, { k: "changePct24h", ph: "Variation (%)", t: "number", label: "Variation 24h (%)" }].map(f => (
                  <div key={f.k}>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>{f.label}</label>
                    <input type={f.t} placeholder={f.ph} value={form[f.k as keyof typeof form] as string} onChange={e => setForm(prev => ({ ...prev, [f.k]: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Classe</label>
                  <select value={form.assetClass} onChange={e => setForm(prev => ({ ...prev, assetClass: e.target.value as WatchlistItem["assetClass"] }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                    {(Object.entries(ASSET_CLASS_LABELS) as [WatchlistItem["assetClass"], string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <button onClick={handleAdd} className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all mt-2" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>Ajouter à la watchlist</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}