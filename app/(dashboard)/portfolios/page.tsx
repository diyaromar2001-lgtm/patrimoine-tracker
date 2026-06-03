"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { DualPrice, DualPriceInline } from "@/components/ui/dual-price"
import { Tooltip, METRIC_TOOLTIPS } from "@/components/ui/tooltip"
import { InsightsWidget } from "@/components/ui/insights-widget"
import { AssetSearch } from "@/components/ui/asset-search"
import { TransactionModal, type TransactionFormData } from "@/components/ui/transaction-modal"
import { useLivePrices } from "@/hooks/use-live-prices"
import { useCurrency } from "@/hooks/use-currency"
import type { SearchResult } from "@/hooks/use-asset-search"
import { PORTFOLIO_HISTORY } from "@/lib/mock-data"
import { useAppData } from "@/hooks/use-app-data"
import type { Portfolio, Asset, AssetClass } from "@/lib/types"
import {
  portfolioTotalValue, portfolioTotalCost, portfolioPnl, portfolioPnlPct,
  assetValue, assetPnl, assetPnlPct, ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from "@/lib/types"
import { formatCurrency, cn } from "@/lib/utils"
import {
  Plus, Briefcase, ChevronDown, ChevronUp, X, Check,
  ArrowUpRight, ArrowDownRight, TrendingUp, BarChart2,
  Activity, Layers, Edit2, Trash2, Loader2, ArrowLeftRight,
  ArrowUp, ArrowDown, ChevronsUpDown, AlertCircle,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type SortKey = "name" | "qty" | "avgPrice" | "currentPrice" | "value" | "dayPnl" | "totalPnlPct" | "weight"
type SortDir = "asc" | "desc"
type Period  = "1W" | "1M" | "3M" | "6M" | "1Y" | "MAX"

// ─── Benchmark Chart (TradingView) ───────────────────────────────────────────
interface BenchmarkPoint { time: number; value: number }
interface BenchmarkData  { main: BenchmarkPoint[]; comparisons: Array<{ ticker: string; data: BenchmarkPoint[] }> }
const PERIODS: Period[] = ["1W","1M","3M","6M","1Y","MAX"]

function BenchmarkChart({
  ticker,
  name,
  portfolioData,
  height = 260,
  period,
}: {
  ticker:        string
  name:          string
  portfolioData?: Array<{ date: string; value: number }>
  height?:       number
  period:        Period
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<ReturnType<typeof import("lightweight-charts")["createChart"]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [perf,    setPerf]    = useState<{ pct: number; spyPct: number; alpha: number } | null>(null)

  const load = useCallback(async () => {
    if (!containerRef.current) return
    setLoading(true)
    try {
      const url = ticker === "__portfolio__"
        ? `/api/chart?ticker=SPY&period=${period}&compare=SPY,VWCE.DE`
        : `/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}&compare=SPY,VWCE.DE`

      const res  = await fetch(url)
      const data: BenchmarkData = await res.json()

      import("lightweight-charts").then(({ createChart, AreaSeries, LineSeries }) => {
        if (!containerRef.current) return
        chartRef.current?.remove()

        const chart = createChart(containerRef.current!, {
          width:  containerRef.current!.clientWidth,
          height,
          layout: { background: { color: "transparent" }, textColor: "#a1a1aa", fontSize: 11, fontFamily: "Inter, ui-sans-serif" },
          grid:   { vertLines: { color: "#1f1f23" }, horzLines: { color: "#1f1f23" } },
          crosshair: {
            vertLine: { color: "#3b82f680", width: 1, labelBackgroundColor: "#18181b" },
            horzLine: { color: "#3b82f680", width: 1, labelBackgroundColor: "#18181b" },
          },
          rightPriceScale: { borderColor: "#27272a", scaleMargins: { top: 0.08, bottom: 0.08 } },
          timeScale: { borderColor: "#27272a", timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
          handleScroll: true, handleScale: true,
        })

        // If we have portfolio history, use it as main series (normalized)
        const mainPts = portfolioData && portfolioData.length > 0
          ? (() => {
              const base = portfolioData[0].value
              return portfolioData.map(d => ({
                time:  Math.floor(new Date(d.date).getTime() / 1000) as unknown as `${number}-${number}-${number}`,
                value: Math.round((d.value / base) * 10000) / 100,
              }))
            })()
          : data.main.map(d => ({ time: (d.time as unknown) as `${number}-${number}-${number}`, value: d.value }))

        if (mainPts.length) {
          const lastPct = mainPts[mainPts.length - 1].value - 100
          const spyComp = data.comparisons?.find(c => c.ticker === "SPY")
          const spyPct  = spyComp?.data.length ? spyComp.data[spyComp.data.length - 1].value - 100 : 0
          setPerf({ pct: lastPct, spyPct, alpha: lastPct - spyPct })

          const isPos = lastPct >= 0
          const mainS = chart.addSeries(AreaSeries, {
            lineColor: isPos ? "#22c55e" : "#ef4444",
            topColor:  isPos ? "#22c55e33" : "#ef444433",
            bottomColor: isPos ? "#22c55e00" : "#ef444400",
            lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
            crosshairMarkerBackgroundColor: isPos ? "#22c55e" : "#ef4444",
          })
          mainS.setData(mainPts)
        }

        // Benchmark comparisons
        const colors = { "SPY": "#eab308", "VWCE.DE": "#22c55e" }
        for (const c of data.comparisons ?? []) {
          if (!c.data?.length) continue
          const clr = colors[c.ticker as keyof typeof colors] ?? "#64748b"
          const s   = chart.addSeries(LineSeries, {
            color: clr, lineWidth: 2, lineStyle: 2,
            priceLineVisible: false, lastValueVisible: false, title: c.ticker,
          })
          s.setData(c.data.map(d => ({ time: (d.time as unknown) as `${number}-${number}-${number}`, value: d.value })))
        }

        chart.timeScale().fitContent()
        chartRef.current = chart

        const ro = new ResizeObserver(() => containerRef.current && chart.applyOptions({ width: containerRef.current.clientWidth }))
        ro.observe(containerRef.current!)
      })
    } catch { /* fail silently */ }
    finally { setLoading(false) }
  }, [ticker, period, height, portfolioData]) // eslint-disable-line

  useEffect(() => { load() }, [load])
  useEffect(() => () => { chartRef.current?.remove(); chartRef.current = null }, [])

  return (
    <div>
      {/* Perf badge */}
      {perf && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background-hover)" }}>
            <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: perf.pct >= 0 ? "#22c55e" : "#ef4444" }} />
            <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{name}</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: perf.pct >= 0 ? "#22c55e" : "#ef4444" }}>
              {perf.pct >= 0 ? "+" : ""}{perf.pct.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background-hover)" }}>
            <span className="h-0.5 w-4 border-t-2 border-dashed inline-block" style={{ borderColor: "#eab308" }} />
            <span className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>S&P 500</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: "#eab308" }}>
              {perf.spyPct >= 0 ? "+" : ""}{perf.spyPct.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background-hover)" }}>
            <span className="h-0.5 w-4 border-t-2 border-dashed inline-block" style={{ borderColor: "#22c55e" }} />
            <span className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>MSCI World</span>
          </div>
          {Math.abs(perf.alpha) > 0.5 && (
            <div className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: perf.alpha > 0 ? "#22c55e18" : "#ef444418",
                color: perf.alpha > 0 ? "#22c55e" : "#ef4444",
              }}>
              {perf.alpha > 0 ? "Vous battez" : "Sous-performez"} le S&P 500 de {perf.alpha > 0 ? "+" : ""}{perf.alpha.toFixed(2)}%
            </div>
          )}
          <div className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
            style={{ backgroundColor: "var(--background-hover)", color: "var(--foreground-dim)" }}>
            <AlertCircle className="h-3 w-3" />
            Prix simulés
          </div>
        </div>
      )}
      <div className="relative rounded-xl border" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "#3b82f6" }} />
              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>Chargement des données Yahoo Finance…</span>
            </div>
          </div>
        )}
        <div ref={containerRef} className="p-2" style={{ width: "100%", height }} />
      </div>
    </div>
  )
}

// ─── Holdings Table (sortable) ────────────────────────────────────────────────
function SortHeader({
  label, sortKey, current, dir, onSort,
}: { label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onSort: (k: SortKey) => void }) {
  const active = current === sortKey
  return (
    <button onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 text-right w-full justify-end hover:text-zinc-200 transition-colors"
      style={{ color: active ? "var(--foreground)" : "var(--foreground-dim)" }}>
      <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      {active ? (dir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />) : <ChevronsUpDown className="h-2.5 w-2.5 opacity-40" />}
    </button>
  )
}

function HoldingsTable({
  portfolio,
  livePrices,
  onDeleteAsset,
  totalValue,
}: {
  portfolio:   Portfolio
  livePrices:  Record<string, { price: number; changePct: number; originalPrice?: number; originalCurrency?: string }>
  onDeleteAsset: (assetId: string) => void
  totalValue:  number
}) {
  const { format } = useCurrency()
  const [sortKey, setSortKey] = useState<SortKey>("value")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const sorted = useMemo(() => {
    return [...portfolio.assets].sort((a, b) => {
      const liveA = livePrices[a.ticker]?.price ?? a.currentPrice
      const liveB = livePrices[b.ticker]?.price ?? b.currentPrice
      const eA = { ...a, currentPrice: liveA }
      const eB = { ...b, currentPrice: liveB }

      let va = 0, vb = 0
      switch (sortKey) {
        case "name":        va = a.name.localeCompare(b.name); return sortDir === "asc" ? va : -va
        case "qty":         va = a.quantity;      vb = b.quantity;      break
        case "avgPrice":    va = a.avgBuyPrice;   vb = b.avgBuyPrice;   break
        case "currentPrice":va = liveA;           vb = liveB;           break
        case "value":       va = assetValue(eA);  vb = assetValue(eB);  break
        case "dayPnl":      va = livePrices[a.ticker]?.changePct ?? 0; vb = livePrices[b.ticker]?.changePct ?? 0; break
        case "totalPnlPct": va = assetPnlPct(eA); vb = assetPnlPct(eB); break
        case "weight":      va = assetValue(eA);  vb = assetValue(eB);  break
      }
      return sortDir === "asc" ? va - vb : vb - va
    })
  }, [portfolio.assets, sortKey, sortDir, livePrices])

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
      {/* Desktop header */}
      <div className="hidden md:grid px-5 py-3 border-b"
        style={{ borderColor: "var(--border)", gridTemplateColumns: "1fr 60px 90px 100px 100px 80px 80px 100px 36px" }}>
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)" }}>Actif</span>
        {([ ["Qté","qty"], ["Px moy.","avgPrice"], ["Prix actuel","currentPrice"], ["Valeur","value"], ["J. P&L","dayPnl"], ["P&L total","totalPnlPct"], ["Poids","weight"] ] as [string, SortKey][]).map(([l, k]) => (
          <SortHeader key={k} label={l} sortKey={k} current={sortKey} dir={sortDir} onSort={handleSort} />
        ))}
        <span />
      </div>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center py-10 gap-2">
          <BarChart2 className="h-7 w-7" style={{ color: "var(--foreground-dim)" }} />
          <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Aucun actif</p>
        </div>
      )}

      {sorted.map((asset, i) => {
        const liveData     = livePrices[asset.ticker]
        const livePrice    = liveData?.price
        const dayChangePct = liveData?.changePct ?? 0
        const origPrice    = liveData?.originalPrice
        const origCurrency = liveData?.originalCurrency
        const eff        = livePrice ? { ...asset, currentPrice: livePrice } : asset
        const val        = assetValue(eff)
        const pnlPct     = assetPnlPct(eff)
        const weight     = totalValue > 0 ? (val / totalValue) * 100 : 0
        const color      = ASSET_CLASS_COLORS[asset.assetClass]

        return (
          <div key={asset.id} style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
            {/* Mobile card */}
            <div className="md:hidden flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
              <div className="h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
                style={{ backgroundColor: color + "22", color }}>
                {asset.ticker.slice(0, 3)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{asset.name}</p>
                <div className="flex items-center gap-1">
                  <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{asset.quantity} ×</span>
                  <DualPriceInline price={eff.currentPrice} originalPrice={origPrice} originalCurrency={origCurrency} className="text-[11px]" showFlag />
                  {livePrice && <span className="h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0" />}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold tabular-nums" style={{ color: "var(--foreground)" }}>{format(val)}</p>
                <ChangeBadge value={pnlPct} showIcon={false} />
              </div>
              <button onClick={() => onDeleteAsset(asset.id)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-red-500/20 transition-colors flex-shrink-0" style={{ color: "var(--foreground-dim)" }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Desktop row */}
            <div className="hidden md:grid items-center px-5 py-3 hover:bg-zinc-800/20 transition-colors"
              style={{ gridTemplateColumns: "1fr 60px 90px 100px 100px 80px 80px 100px 36px" }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: color + "22", color }}>
                  {asset.ticker.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{asset.name}</p>
                  <AssetClassBadge label={ASSET_CLASS_LABELS[asset.assetClass]} color={color} />
                </div>
              </div>
              <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{asset.quantity}</p>
              {/* Avg buy price in user's currency */}
              <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>
                {format(asset.avgBuyPrice)}
              </p>
              {/* Current price: native currency PRIMARY + user currency small */}
              <div className="flex items-center justify-end gap-1">
                <DualPrice price={eff.currentPrice} originalPrice={origPrice} originalCurrency={origCurrency} size="sm" />
                {livePrice && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
              </div>
              {/* Total value in user's currency */}
              <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>
                {format(val)}
              </p>
              <div className="flex justify-end"><ChangeBadge value={dayChangePct} showIcon={false} /></div>
              <div className="flex justify-end"><ChangeBadge value={pnlPct} showIcon={false} /></div>
              {/* Weight bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(weight, 100)}%`, backgroundColor: color }} />
                </div>
                <span className="text-[11px] tabular-nums w-8 text-right" style={{ color: "var(--foreground-muted)" }}>
                  {weight.toFixed(0)}%
                </span>
              </div>
              <button onClick={() => onDeleteAsset(asset.id)} className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-500/20 transition-colors" style={{ color: "var(--foreground-dim)" }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PortfoliosPage() {
  const { format } = useCurrency()
  const {
    portfolios, loading: dbLoading,
    addPortfolio: dbAddPortfolio,
    removePortfolio: dbRemovePortfolio,
    addAsset: dbAddAsset,
    removeAsset: dbRemoveAsset,
    addTransaction,
  } = useAppData()
  // setPortfolios not available in AppData — mutations are reflected automatically
  const setPortfolios = (_: unknown) => {} // noop placeholder
  const [activeTab, setActiveTab] = useState("global")
  const [txModal, setTxModal]     = useState<{ defaultPortfolioId?: string } | null>(null)

  function openTxModal(portfolioId?: string) {
    setTxModal({ defaultPortfolioId: portfolioId ?? portfolios[0]?.id ?? "" })
  }

  async function handleSaveTx(form: TransactionFormData) {
    const res = await addTransaction({
      portfolioId: form.portfolioId,
      ticker:      form.ticker,
      assetName:   form.assetName,
      assetClass:  form.assetClass,
      type:        form.type,
      quantity:    parseFloat(form.quantity),
      price:       parseFloat(form.price),
      fees:        parseFloat(form.fees) || 0,
      currency:    "CHF",
      date:        form.date,
      notes:       form.notes || undefined,
    })
    if (!res.ok) throw new Error(res.error ?? "Erreur Supabase")
    setTxModal(null)
  }
  const [period,     setPeriod]     = useState<Period>("1Y")
  const [showNewPortfolio, setShowNewPortfolio] = useState(false)
  const [newName,    setNewName]    = useState("")
  const [newDesc,    setNewDesc]    = useState("")
  const [newColor,   setNewColor]   = useState("#3b82f6")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const allTickers = portfolios.flatMap(p => p.assets.map(a => a.ticker))
  const { prices: livePrices } = useLivePrices(allTickers, 30_000)

  // Enrich prices — include original currency for dual display
  const liveEnriched = useMemo(() => {
    const out: Record<string, { price: number; changePct: number; originalPrice?: number; originalCurrency?: string }> = {}
    for (const [t, p] of Object.entries(livePrices)) {
      out[t] = { price: p.price, changePct: p.changePct, originalPrice: p.originalPrice, originalCurrency: p.originalCurrency }
    }
    return out
  }, [livePrices])

  // Global totals
  const totalValue  = portfolios.reduce((s, p) => {
    return s + p.assets.reduce((ss, a) => {
      const lp = liveEnriched[a.ticker]?.price
      return ss + (lp ? lp * a.quantity : assetValue(a))
    }, 0)
  }, 0)
  const totalCost  = portfolios.reduce((s, p) => s + portfolioTotalCost(p), 0)
  const totalPnl   = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  const allAssets = portfolios.flatMap(p => p.assets)
  const allAssetsEnriched = allAssets.map(a => ({
    ...a,
    currentPrice: liveEnriched[a.ticker]?.price ?? a.currentPrice,
  }))

  // Top movers
  const moversData = allAssetsEnriched.map(a => ({
    ...a,
    dayChangePct: liveEnriched[a.ticker]?.changePct ?? 0,
  })).sort((a, b) => b.dayChangePct - a.dayChangePct)
  const topGainers = moversData.slice(0, 3)
  const topLosers  = [...moversData].reverse().slice(0, 3)

  // Asset allocation by class
  const byClass = allAssetsEnriched.reduce<Record<string, number>>((acc, a) => {
    acc[a.assetClass] = (acc[a.assetClass] ?? 0) + a.quantity * a.currentPrice
    return acc
  }, {})

  // Annual dividends (simplified)
  const annualDivs = 247.40

  // Best/worst
  const best  = moversData[0]
  const worst = moversData[moversData.length - 1]

  async function handleAddPortfolio() {
    if (!newName.trim()) return
    const id = await dbAddPortfolio({
      name: newName.trim(), description: newDesc.trim(),
      color: newColor, currency: "CHF", createdAt: new Date().toISOString().slice(0, 10),
    })
    if (id) setActiveTab(id)
    setNewName(""); setNewDesc(""); setShowNewPortfolio(false)
  }

  async function handleAddAsset(portfolioId: string, result: SearchResult) {
    try {
      const res       = await fetch("/api/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: [result.ticker] }) })
      const data      = await res.json()
      const livePrice = data[result.ticker]?.price ?? 0
      await dbAddAsset(portfolioId, {
        id: `a${Date.now()}`, portfolioId,
        ticker: result.ticker, name: result.name,
        assetClass: result.type as AssetClass,
        quantity: 1, avgBuyPrice: livePrice || 0,
        currency: "CHF",
      })
    } catch {
      await dbAddAsset(portfolioId, {
        id: `a${Date.now()}`, portfolioId,
        ticker: result.ticker, name: result.name,
        assetClass: result.type as AssetClass,
        quantity: 1, avgBuyPrice: 0, currency: "CHF",
      })
    }
  }

  function handleDeleteAsset(portfolioId: string, assetId: string) {
    dbRemoveAsset(portfolioId, assetId)
  }

  function handleDeletePortfolio(id: string) {
    dbRemovePortfolio(id)
    setActiveTab("global")
  }

  const activePortfolio = portfolios.find(p => p.id === activeTab)

  return (
    <div className="flex flex-col">
      <Topbar title="Portefeuilles" subtitle={`${portfolios.length} portefeuilles · ${format(totalValue)}`} />

      {/* ─── Tab bar ─── */}
      <div className="border-b overflow-x-auto" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
        <div className="flex min-w-max px-4 sm:px-6">
          {/* Global tab */}
          <button
            onClick={() => setActiveTab("global")}
            className={cn(
              "relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors",
              activeTab === "global" ? "text-white" : "text-zinc-500 hover:text-zinc-200"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            Vue Globale
            {activeTab === "global" && (
              <motion.div layoutId="tabIndicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-500" />
            )}
          </button>

          {/* Portfolio tabs */}
          {portfolios.map(p => (
            <button key={p.id}
              onClick={() => setActiveTab(p.id)}
              className={cn(
                "relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                activeTab === p.id ? "text-white" : "text-zinc-500 hover:text-zinc-200"
              )}
            >
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
              {p.name}
              {activeTab === p.id && (
                <motion.div layoutId="tabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ backgroundColor: p.color }} />
              )}
            </button>
          ))}

          {/* New portfolio */}
          <button
            onClick={() => setShowNewPortfolio(true)}
            className="flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium text-zinc-500 hover:text-zinc-200 transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> Nouveau
          </button>
        </div>
      </div>

      {/* ─── Content ─── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="flex-1 space-y-6 p-4 sm:p-6"
        >

          {/* ═══════════════ GLOBAL VIEW ═══════════════ */}
          {activeTab === "global" && (
            <>
              {/* Hero card */}
              <div className="relative overflow-hidden rounded-2xl border p-6"
                style={{ background: "linear-gradient(135deg,#0a1628 0%,#0d1117 50%,#0a1d0a 100%)", borderColor: "var(--border)" }}>
                <div className="pointer-events-none absolute -top-16 -left-12 h-48 w-48 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: "#3b82f6" }} />
                <div className="pointer-events-none absolute -bottom-8 right-12 h-32 w-32 rounded-full opacity-15 blur-2xl" style={{ backgroundColor: "#22c55e" }} />

                <div className="relative grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-zinc-600">Patrimoine net total</p>
                    <div className="mt-2 flex items-baseline gap-3 flex-wrap">
                      <span className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight text-white">
                        {format(totalValue)}
                      </span>
                      <ChangeBadge value={totalPnlPct} size="md" />
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {totalPnl >= 0 ? "+" : ""}{format(totalPnl)} depuis le début
                    </p>
                    {/* CTA button */}
                    <button
                      onClick={() => openTxModal()}
                      className="mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                      style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", boxShadow: "0 0 20px #22c55e30" }}
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                      Ajouter une transaction
                    </button>
                  </div>

                  {/* Mini stats */}
                  <div className="grid grid-cols-3 gap-3 self-center">
                    {[
                      { label: "Meilleur", value: best ? ("+" + ((liveEnriched[best.ticker]?.changePct ?? 0).toFixed(1)) + "%") : "--", sub: best?.ticker, color: "#22c55e" },
                      { label: "Pire", value: worst ? (((liveEnriched[worst.ticker]?.changePct ?? 0).toFixed(1)) + "%") : "--", sub: worst?.ticker, color: "#ef4444" },
                      { label: "Actifs", value: String(allAssets.length), sub: `${portfolios.length} portef.`, color: "#3b82f6" },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl border px-3 py-2.5" style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.04)" }}>
                        <p className="text-[11px] text-zinc-500">{s.label}</p>
                        <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[10px] text-zinc-600 truncate">{s.sub}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 3 stat cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Performance */}
                <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" style={{ color: "#22c55e" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Performance</p>
                  </div>
                  {[
                    { label: "Rendement total", value: (totalPnlPct >= 0 ? "+" : "") + totalPnlPct.toFixed(2) + " %", color: totalPnlPct >= 0 ? "#22c55e" : "#ef4444", tooltip: "" },
                    { label: "vs S&P 500 (YTD)", value: "+~8.00 %", color: "#eab308", tooltip: METRIC_TOOLTIPS.ytd },
                    { label: "Alpha généré", value: "+~" + Math.max(0, totalPnlPct - 8).toFixed(2) + " %", color: "#3b82f6", tooltip: METRIC_TOOLTIPS.alpha },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1" style={{ color: "var(--foreground-muted)" }}>
                        {r.label}
                        {r.tooltip && <Tooltip content={r.tooltip} icon />}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: r.color }}>{r.value}</span>
                    </div>
                  ))}
                </div>

                {/* Risk */}
                <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4" style={{ color: "#a78bfa" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Risque</p>
                  </div>
                  {[
                    { label: "Bêta (vs SPY)",    value: "~0.92",  tooltip: METRIC_TOOLTIPS.beta   },
                    { label: "Volatilité 30j",   value: "~14.20 %", tooltip: ""                    },
                    { label: "Ratio de Sharpe",  value: "~1.18",  tooltip: METRIC_TOOLTIPS.sharpe  },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1" style={{ color: "var(--foreground-muted)" }}>
                        {r.label}
                        {r.tooltip && <Tooltip content={r.tooltip} icon />}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>{r.value}</span>
                    </div>
                  ))}
                </div>

                {/* Income */}
                <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <BarChart2 className="h-4 w-4" style={{ color: "#f59e0b" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Revenus</p>
                  </div>
                  {[
                    { label: "Dividendes annuels",  value: format(annualDivs), color: "#22c55e", tooltip: "" },
                    { label: "Prochain versement",  value: "dans 38j",         color: "",         tooltip: "" },
                    { label: "Yield on cost",        value: ((annualDivs / totalCost) * 100).toFixed(2) + " %", color: "", tooltip: METRIC_TOOLTIPS.yieldOnCost },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1" style={{ color: "var(--foreground-muted)" }}>
                        {r.label}
                        {(r as {tooltip?: string}).tooltip && <Tooltip content={(r as {tooltip: string}).tooltip} icon />}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: (r as {color?: string}).color ?? "var(--foreground)" }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Benchmark chart with period selector */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Performance vs Benchmarks</p>
                    <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Normalisé à 100 · comparaison relative</p>
                  </div>
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    {PERIODS.map(p => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className="px-2.5 py-1 text-xs font-medium transition-colors"
                        style={{ backgroundColor: period === p ? "var(--accent)" : "transparent", color: period === p ? "white" : "var(--foreground-dim)" }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Only show benchmark chart when user has real assets */}
                {allAssets.length > 0 ? (
                  <BenchmarkChart
                    ticker="SPY"
                    name="Mon Portefeuille"
                    portfolioData={undefined}
                    height={280}
                    period={period}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-40 rounded-xl border"
                    style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", borderStyle: "dashed" }}>
                    <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
                      Ajoutez des actifs pour voir votre performance vs benchmarks
                    </p>
                  </div>
                )}
              </div>

              {/* Allocation + Top Movers */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Allocation */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Répartition par classe</p>
                  <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                    {Object.entries(byClass).sort(([,a],[,b]) => b - a).map(([cls, val]) => {
                      const pct   = totalValue > 0 ? (val / totalValue) * 100 : 0
                      const color = ASSET_CLASS_COLORS[cls as AssetClass] ?? "#6b7280"
                      return (
                        <div key={cls} className="mb-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{ASSET_CLASS_LABELS[cls as AssetClass] ?? cls}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs tabular-nums" style={{ color: "var(--foreground-dim)" }}>{format(val)}</span>
                              <span className="text-xs font-semibold tabular-nums w-10 text-right" style={{ color: "var(--foreground)" }}>{pct.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, ease: "easeOut" }}
                              className="h-full rounded-full"
                              style={{ backgroundColor: color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Top movers */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Top movers du jour</p>
                  <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                    <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)" }}>Meilleures performances</p>
                    </div>
                    {topGainers.map((a, i) => {
                      const pct = liveEnriched[a.ticker]?.changePct ?? 0
                      const color = ASSET_CLASS_COLORS[a.assetClass]
                      return (
                        <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                          style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                          <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>
                            {a.ticker.slice(0, 3)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{a.name}</p>
                            <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>{a.ticker}</p>
                          </div>
                          <div className="text-right">
                            <ChangeBadge value={pct} showIcon={false} />
                            <p className="text-[11px] tabular-nums mt-0.5" style={{ color: "#22c55e" }}>
                              +{format((liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity * pct / 100)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                    <div className="px-4 py-2 border-t border-b" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)" }}>Moins bonnes performances</p>
                    </div>
                    {topLosers.map((a, i) => {
                      const pct = liveEnriched[a.ticker]?.changePct ?? 0
                      const color = ASSET_CLASS_COLORS[a.assetClass]
                      return (
                        <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                          style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                          <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>
                            {a.ticker.slice(0, 3)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{a.name}</p>
                            <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>{a.ticker}</p>
                          </div>
                          <div className="text-right">
                            <ChangeBadge value={pct} showIcon={false} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Portfolios summary table */}
              <div className="space-y-3">
                <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Résumé des portefeuilles</p>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                  <div className="grid px-5 py-3 border-b text-[11px] font-medium uppercase tracking-wider"
                    style={{ borderColor: "var(--border)", color: "var(--foreground-dim)", gridTemplateColumns: "1fr 60px 120px 100px 100px 80px 100px" }}>
                    <span>Portefeuille</span>
                    <span className="text-center">Actifs</span>
                    <span className="text-right">Valeur</span>
                    <span className="text-right">P&L Jour</span>
                    <span className="text-right">P&L Total</span>
                    <span className="text-right">%</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {portfolios.map((p, i) => {
                    const val  = p.assets.reduce((s, a) => s + (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity, 0)
                    const cost = portfolioTotalCost(p)
                    const pnl  = val - cost
                    const pct  = cost > 0 ? (pnl / cost) * 100 : 0
                    const dayPnl = p.assets.reduce((s, a) => s + (liveEnriched[a.ticker]?.changePct ?? 0) * (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity / 100, 0)
                    const dayPct = val > 0 ? (dayPnl / val) * 100 : 0
                    const exp   = expandedRows.has(p.id)
                    return (
                      <div key={p.id} style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                        <div className="grid items-center px-5 py-3 hover:bg-zinc-800/20 transition-colors cursor-pointer"
                          style={{ gridTemplateColumns: "1fr 60px 120px 100px 100px 80px 100px" }}
                          onClick={() => setExpandedRows(s => { const n = new Set(s); exp ? n.delete(p.id) : n.add(p.id); return n })}>
                          <div className="flex items-center gap-3">
                            {exp ? <ChevronUp className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--foreground-dim)" }} />
                                 : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--foreground-dim)" }} />}
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                            <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{p.name}</span>
                          </div>
                          <p className="text-center text-xs" style={{ color: "var(--foreground-muted)" }}>{p.assets.length}</p>
                          <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>{format(val)}</p>
                          <div className="flex justify-end"><ChangeBadge value={dayPct} showIcon={false} /></div>
                          <p className="text-right text-xs tabular-nums" style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>{pnl >= 0 ? "+" : ""}{format(pnl)}</p>
                          <div className="flex justify-end"><ChangeBadge value={pct} showIcon={false} /></div>
                          <div className="flex justify-end gap-1">
                            <button onClick={e => { e.stopPropagation(); setActiveTab(p.id) }}
                              className="rounded-md px-2 py-1 text-[11px] font-medium hover:bg-zinc-700 transition-colors"
                              style={{ color: "var(--foreground-dim)" }}>Voir</button>
                          </div>
                        </div>
                        {exp && (
                          <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
                            <HoldingsTable
                              portfolio={p}
                              livePrices={liveEnriched}
                              onDeleteAsset={id => handleDeleteAsset(p.id, id)}
                              totalValue={val}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Insights automatiques */}
              {allAssets.length > 0 && (
                <InsightsWidget
                  assets={allAssetsEnriched.map(a => ({
                    ticker: a.ticker, quantity: a.quantity,
                    avgBuyPrice: a.avgBuyPrice, currentPrice: a.currentPrice,
                    assetClass: a.assetClass,
                  }))}
                />
              )}
            </>
          )}

          {/* ═══════════════ INDIVIDUAL PORTFOLIO VIEW ═══════════════ */}
          {activePortfolio && (
            <>
              {/* Portfolio header */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: activePortfolio.color + "22" }}>
                    <Briefcase className="h-6 w-6" style={{ color: activePortfolio.color }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold" style={{ color: "var(--foreground)" }}>{activePortfolio.name}</h2>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activePortfolio.color }} />
                    </div>
                    {activePortfolio.description && (
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{activePortfolio.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {(() => {
                    const val  = activePortfolio.assets.reduce((s, a) => s + (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity, 0)
                    const cost = portfolioTotalCost(activePortfolio)
                    const pnl  = val - cost
                    const pct  = cost > 0 ? (pnl / cost) * 100 : 0
                    return (
                      <>
                        <div className="text-right">
                          <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>{format(val)}</p>
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-xs tabular-nums" style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                              {pnl >= 0 ? "+" : ""}{format(pnl)}
                            </span>
                            <ChangeBadge value={pct} showIcon={false} />
                          </div>
                        </div>
                        <button
                          onClick={() => openTxModal(activePortfolio.id)}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-all hover:opacity-90"
                          style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>
                          <ArrowLeftRight className="h-3.5 w-3.5" /> Ajouter transaction
                        </button>
                        <button onClick={() => handleDeletePortfolio(activePortfolio.id)}
                          className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                          style={{ borderColor: "#ef444440" }}>
                          <Trash2 className="h-3.5 w-3.5" /> Supprimer
                        </button>
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Chart with period selector */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Performance vs S&P 500</p>
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    {PERIODS.map(p => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className="px-2.5 py-1 text-xs font-medium transition-colors"
                        style={{ backgroundColor: period === p ? "var(--accent)" : "transparent", color: period === p ? "white" : "var(--foreground-dim)" }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <BenchmarkChart
                  ticker="SPY"
                  name={activePortfolio.name}
                  portfolioData={PORTFOLIO_HISTORY}
                  height={260}
                  period={period}
                />
              </div>

              {/* Holdings table (sortable) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    Positions — {activePortfolio.assets.length} actif{activePortfolio.assets.length !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs" style={{ color: "var(--foreground-dim)" }}>
                    Cliquer sur une colonne pour trier
                  </p>
                </div>
                <HoldingsTable
                  portfolio={activePortfolio}
                  livePrices={liveEnriched}
                  onDeleteAsset={id => handleDeleteAsset(activePortfolio.id, id)}
                  totalValue={activePortfolio.assets.reduce((s, a) => s + (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity, 0)}
                />
              </div>

              {/* Add asset search bar */}
              <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", borderStyle: "dashed" }}>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--foreground-muted)" }}>Ajouter un actif</p>
                <AssetSearch
                  onSelect={r => handleAddAsset(activePortfolio.id, r)}
                  placeholder="Rechercher et ajouter… (AAPL, BTC, CW8, NVDA…)"
                />
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ─── Transaction modal ─── */}
      <AnimatePresence>
        {txModal && (
          <TransactionModal
            mode="add"
            initial={{
              portfolioId: txModal.defaultPortfolioId ?? portfolios[0]?.id ?? "",
              ticker: "", assetName: "", assetClass: "stock", type: "buy",
              quantity: "", price: "", fees: "1",
              date: new Date().toISOString().slice(0, 10), notes: "",
            }}
            portfolios={portfolios}
            onSave={handleSaveTx}
            onClose={() => setTxModal(null)}
          />
        )}
      </AnimatePresence>

      {/* ─── New portfolio modal ─── */}
      <AnimatePresence>
        {showNewPortfolio && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
            onClick={() => setShowNewPortfolio(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border p-6"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Nouveau portefeuille</h3>
                <button onClick={() => setShowNewPortfolio(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                  <X className="h-4 w-4 text-zinc-500" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Nom *</label>
                  <input type="text" placeholder="Ex: Actions Long Terme" value={newName} onChange={e => setNewName(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Description</label>
                  <input type="text" placeholder="Stratégie, objectif…" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Couleur</label>
                  <div className="flex gap-2">
                    {["#3b82f6","#22c55e","#a78bfa","#f59e0b","#ef4444","#ec4899","#14b8a6"].map(c => (
                      <button key={c} onClick={() => setNewColor(c)}
                        className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                        style={{ backgroundColor: c, outline: newColor === c ? "2px solid white" : "none", outlineOffset: "2px" }} />
                    ))}
                  </div>
                </div>
                <button onClick={handleAddPortfolio}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
                  style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                  Créer le portefeuille
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
