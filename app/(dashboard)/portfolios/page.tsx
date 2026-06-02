"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { AssetSearch } from "@/components/ui/asset-search"
import { useLivePrices } from "@/hooks/use-live-prices"
import type { SearchResult } from "@/hooks/use-asset-search"
import { MOCK_PORTFOLIOS } from "@/lib/mock-data"
import {
  portfolioTotalValue, portfolioTotalCost, portfolioPnl, portfolioPnlPct,
  assetValue, assetPnlPct,
  ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from "@/lib/types"
import type { Portfolio, Asset, AssetClass } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import { Plus, ChevronDown, ChevronUp, Briefcase, X, Check } from "lucide-react"

export default function PortfoliosPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(MOCK_PORTFOLIOS)
  const [expandedId, setExpandedId] = useState<string | null>(MOCK_PORTFOLIOS[0]?.id ?? null)
  const [showAddPortfolio, setShowAddPortfolio] = useState(false)
  const [showAddAsset, setShowAddAsset] = useState<string | null>(null)

  // Live prices for all held assets
  const allTickers = portfolios.flatMap(p => p.assets.map(a => a.ticker))
  const { prices: livePrices } = useLivePrices(allTickers, 90_000)

  // Pre-fill form from search result
  function handleSearchSelect(result: SearchResult, portfolioId: string) {
    setNewAsset(prev => ({
      ...prev,
      ticker: result.ticker,
      name: result.name,
      assetClass: result.type as AssetClass,
    }))
    setShowAddAsset(portfolioId)
  }
  const [newPortfolioName, setNewPortfolioName] = useState("")
  const [newPortfolioDesc, setNewPortfolioDesc] = useState("")
  const [newPortfolioColor, setNewPortfolioColor] = useState("#3b82f6")
  const [newAsset, setNewAsset] = useState({ ticker: "", name: "", assetClass: "stock" as AssetClass, quantity: "", avgBuyPrice: "", currentPrice: "" })

  const totalValue  = portfolios.reduce((s, p) => s + portfolioTotalValue(p), 0)
  const totalPnl    = portfolios.reduce((s, p) => s + portfolioPnl(p), 0)
  const totalCost   = portfolios.reduce((s, p) => s + portfolioTotalCost(p), 0)
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  function handleAddPortfolio() {
    if (!newPortfolioName.trim()) return
    const p: Portfolio = { id: `p${Date.now()}`, name: newPortfolioName.trim(), description: newPortfolioDesc.trim(), color: newPortfolioColor, currency: "EUR", createdAt: new Date().toISOString().slice(0, 10), assets: [] }
    setPortfolios(prev => [...prev, p])
    setNewPortfolioName(""); setNewPortfolioDesc(""); setShowAddPortfolio(false)
  }

  function handleAddAsset(portfolioId: string) {
    if (!newAsset.ticker || !newAsset.name || !newAsset.quantity || !newAsset.avgBuyPrice || !newAsset.currentPrice) return
    const asset: Asset = { id: `a${Date.now()}`, portfolioId, ticker: newAsset.ticker.toUpperCase(), name: newAsset.name, assetClass: newAsset.assetClass, quantity: parseFloat(newAsset.quantity), avgBuyPrice: parseFloat(newAsset.avgBuyPrice), currentPrice: parseFloat(newAsset.currentPrice), currency: "EUR" }
    setPortfolios(prev => prev.map(p => p.id === portfolioId ? { ...p, assets: [...p.assets, asset] } : p))
    setNewAsset({ ticker: "", name: "", assetClass: "stock", quantity: "", avgBuyPrice: "", currentPrice: "" })
    setShowAddAsset(null)
  }

  function handleDeleteAsset(portfolioId: string, assetId: string) {
    setPortfolios(prev => prev.map(p => p.id === portfolioId ? { ...p, assets: p.assets.filter(a => a.id !== assetId) } : p))
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Portefeuilles" subtitle={portfolios.length + " portefeuilles · " + formatCurrency(totalValue)} />
      <div className="flex-1 space-y-6 p-6">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Valeur totale", value: formatCurrency(totalValue), color: "#3b82f6" },
            { label: "P&L total", value: (totalPnl >= 0 ? "+" : "") + formatCurrency(totalPnl), color: totalPnl >= 0 ? "#22c55e" : "#ef4444" },
            { label: "Performance", value: (totalPnlPct >= 0 ? "+" : "") + totalPnlPct.toFixed(2) + "%", color: totalPnlPct >= 0 ? "#22c55e" : "#ef4444" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{s.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <SectionHeader title="Mes portefeuilles" description="Gérez vos actifs par portefeuille" />
          <button onClick={() => setShowAddPortfolio(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
            <Plus className="h-4 w-4" /> Nouveau portefeuille
          </button>
        </div>

        <div className="space-y-4">
          {portfolios.map((portfolio) => {
            const value  = portfolioTotalValue(portfolio)
            const pnl    = portfolioPnl(portfolio)
            const pnlPct = portfolioPnlPct(portfolio)
            const isOpen = expandedId === portfolio.id
            return (
              <motion.div key={portfolio.id} layout className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                <button className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-800/30 transition-colors" onClick={() => setExpandedId(isOpen ? null : portfolio.id)}>
                  <div className="h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center" style={{ backgroundColor: portfolio.color + "22" }}>
                    <Briefcase className="h-4 w-4" style={{ color: portfolio.color }} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{portfolio.name}</p>
                    <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{portfolio.assets.length} actif{portfolio.assets.length !== 1 ? "s" : ""}{portfolio.description ? " · " + portfolio.description : ""}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums" style={{ color: "var(--foreground)" }}>{formatCurrency(value)}</p>
                      <ChangeBadge value={pnlPct} showIcon={false} />
                    </div>
                    {isOpen ? <ChevronUp className="h-4 w-4" style={{ color: "var(--foreground-dim)" }} /> : <ChevronDown className="h-4 w-4" style={{ color: "var(--foreground-dim)" }} />}
                  </div>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
                      <div className="border-t" style={{ borderColor: "var(--border)" }}>
                        <div className="grid px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)", gridTemplateColumns: "1fr 70px 90px 90px 90px 90px 36px" }}>
                          <span>Actif</span><span className="text-right">Qté</span><span className="text-right">Px moy.</span><span className="text-right">Px actuel</span><span className="text-right">Valeur</span><span className="text-right">P&L</span><span />
                        </div>
                        {portfolio.assets.length === 0 && <div className="flex flex-col items-center py-8"><p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Aucun actif dans ce portefeuille</p></div>}
                        {portfolio.assets.map((asset) => {
                          // Use live price if available, fallback to mock
                          const livePrice = livePrices[asset.ticker]?.price
                          const effectiveAsset = livePrice ? { ...asset, currentPrice: livePrice } : asset
                          const aValue  = assetValue(effectiveAsset)
                          const aPnlPct = assetPnlPct(effectiveAsset)
                          const color   = ASSET_CLASS_COLORS[asset.assetClass]
                          return (
                            <div key={asset.id} className="grid items-center px-5 py-3 transition-colors hover:bg-zinc-800/20" style={{ gridTemplateColumns: "1fr 70px 90px 90px 90px 90px 36px", borderTop: "1px solid var(--border-subtle)" }}>
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>{asset.ticker.slice(0, 3)}</div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{asset.name}</p>
                                  <AssetClassBadge label={ASSET_CLASS_LABELS[asset.assetClass]} color={color} />
                                </div>
                              </div>
                              <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{asset.quantity}</p>
                              <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{formatCurrency(asset.avgBuyPrice)}</p>
                              <p className="text-right text-xs tabular-nums font-medium flex items-center justify-end gap-1" style={{ color: "var(--foreground)" }}>
                                {formatCurrency(effectiveAsset.currentPrice)}
                                {livePrice && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
                              </p>
                              <p className="text-right text-xs tabular-nums font-semibold" style={{ color: "var(--foreground)" }}>{formatCurrency(aValue)}</p>
                              <div className="flex justify-end"><ChangeBadge value={aPnlPct} showIcon={false} /></div>
                              <button onClick={() => handleDeleteAsset(portfolio.id, asset.id)} className="flex items-center justify-center h-7 w-7 rounded-md transition-colors hover:bg-red-500/20" style={{ color: "var(--foreground-dim)" }}><X className="h-3.5 w-3.5" /></button>
                            </div>
                          )
                        })}
                        {showAddAsset === portfolio.id ? (
                          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {[{ k: "ticker", ph: "Ticker (ex: AAPL)", t: "text" }, { k: "name", ph: "Nom complet", t: "text" }, { k: "quantity", ph: "Quantité", t: "number" }, { k: "avgBuyPrice", ph: "Prix achat (€)", t: "number" }, { k: "currentPrice", ph: "Prix actuel (€)", t: "number" }].map(f => (
                                <input key={f.k} type={f.t} placeholder={f.ph} value={newAsset[f.k as keyof typeof newAsset]} onChange={e => setNewAsset(prev => ({ ...prev, [f.k]: e.target.value }))} className="rounded-lg border px-3 py-2 text-xs outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                              ))}
                              <select value={newAsset.assetClass} onChange={e => setNewAsset(prev => ({ ...prev, assetClass: e.target.value as AssetClass }))} className="rounded-lg border px-3 py-2 text-xs outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                                {(Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button onClick={() => handleAddAsset(portfolio.id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: "#22c55e" }}><Check className="h-3.5 w-3.5" /> Ajouter</button>
                              <button onClick={() => setShowAddAsset(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-800 transition-colors" style={{ color: "var(--foreground-muted)" }}>Annuler</button>
                            </div>
                          </div>
                        ) : (
                          <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
                            <AssetSearch
                              onSelect={r => handleSearchSelect(r, portfolio.id)}
                              placeholder="Rechercher et ajouter un actif… (AAPL, BTC, CW8…)"
                              className="w-full max-w-sm"
                            />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {showAddPortfolio && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }} onClick={() => setShowAddPortfolio(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-md rounded-2xl border p-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Nouveau portefeuille</h3>
                <button onClick={() => setShowAddPortfolio(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors"><X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Nom *</label>
                  <input type="text" placeholder="Ex: Actions Long Terme" value={newPortfolioName} onChange={e => setNewPortfolioName(e.target.value)} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Description</label>
                  <input type="text" placeholder="Stratégie, objectif…" value={newPortfolioDesc} onChange={e => setNewPortfolioDesc(e.target.value)} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Couleur</label>
                  <div className="flex gap-2">{["#3b82f6","#22c55e","#a78bfa","#f59e0b","#ef4444","#ec4899","#14b8a6"].map(c => (
                    <button key={c} onClick={() => setNewPortfolioColor(c)} className="h-7 w-7 rounded-full transition-transform hover:scale-110" style={{ backgroundColor: c, outline: newPortfolioColor === c ? "2px solid white" : "none", outlineOffset: "2px" }} />
                  ))}</div>
                </div>
                <button onClick={handleAddPortfolio} className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>Créer le portefeuille</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
