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
import { PortfolioCreationModal } from "@/components/ui/portfolio-creation-modal"
import { usePortfolioImport } from "@/hooks/use-portfolio-import"
import { AreaChart } from "@/components/charts/area-chart"
import { useLivePrices } from "@/hooks/use-live-prices"
import { usePortfolioHistory } from "@/hooks/use-portfolio-history"
import type { PortfolioAsset } from "@/app/api/portfolio-history/route"
import { useCurrency } from "@/hooks/use-currency"
import type { SearchResult } from "@/hooks/use-asset-search"
import { useAppData } from "@/hooks/use-app-data"
import type { Portfolio, Asset, AssetClass } from "@/lib/types"
import Link from "next/link"
import { BROKERS, type BrokerId } from "@/lib/import/brokers"
import { UNASSIGNED_CASH, balancesInChf, normalizeBalances } from "@/lib/cash"
import {
  MobilePortfolio, MOBILE_PERIOD_TO_API,
  type MobilePeriod, type AnalyticsCard,
} from "@/components/portfolio/mobile-portfolio"
import { PortfolioChipBar, CHIP_BAR_HEIGHT } from "@/components/portfolio/portfolio-chip-bar"
import {
  ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from "@/lib/types"
import { benchmarkAlpha, calculatePortfolioMetrics, safeCostBasisChf, type PortfolioMetrics } from "@/lib/finance"
import { formatCurrency, cn } from "@/lib/utils"
import type { AppCurrency } from "@/lib/utils"
import {
  Plus, Briefcase, ChevronDown, ChevronUp, X, Check,
  ArrowUpRight, ArrowDownRight, TrendingUp, BarChart2,
  Activity, Layers, Edit2, Trash2, Loader2, ArrowLeftRight,
  ArrowUp, ArrowDown, ChevronsUpDown, AlertCircle, Search, Wallet,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type SortKey = "name" | "qty" | "avgPrice" | "currentPrice" | "value" | "dayPnl" | "totalPnlPct" | "weight"
type SortDir = "asc" | "desc"
type Period  = "1W" | "1M" | "3M" | "6M" | "1Y" | "MAX"

const CRYPTO_CUSTODY_LABELS: Record<string, string> = {
  cold_wallet: "Cold Wallet",
  hot_wallet: "Hot Wallet",
  exchange: "Exchange",
}

// ─── Benchmark Chart (TradingView) ───────────────────────────────────────────
interface BenchmarkPoint { time: number; value: number }
interface BenchmarkData  { main: BenchmarkPoint[]; comparisons: Array<{ ticker: string; data: BenchmarkPoint[] }> }
const PERIODS: Period[] = ["1W","1M","3M","6M","1Y","MAX"]

function BenchmarkChart({
  ticker,
  name,
  portfolioData,
  portfolioReturnPct,
  height = 260,
  period,
}: {
  ticker:        string
  name:          string
  portfolioData?: Array<{ date: string; value: number }>
  portfolioReturnPct?: number
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

        const benchmarkTimeline = data.comparisons?.find(c => c.ticker === "SPY")?.data ?? data.main
        const mainPts = portfolioData && portfolioData.length > 0
          ? (() => {
              const base = portfolioData[0].value
              return portfolioData.map(d => ({
                time:  Math.floor(new Date(d.date).getTime() / 1000) as unknown as `${number}-${number}-${number}`,
                value: Math.round((d.value / base) * 10000) / 100,
              }))
            })()
          : typeof portfolioReturnPct === "number"
            ? (() => {
                const timeline = benchmarkTimeline.length ? benchmarkTimeline : [
                  { time: Math.floor((Date.now() - 365 * 86400000) / 1000), value: 100 },
                  { time: Math.floor(Date.now() / 1000), value: 100 },
                ]
                const denom = Math.max(1, timeline.length - 1)
                return timeline.map((d, i) => ({
                  time: (d.time as unknown) as `${number}-${number}-${number}`,
                  value: Math.round((100 + portfolioReturnPct * (i / denom)) * 100) / 100,
                }))
              })()
          : data.main.map(d => ({ time: (d.time as unknown) as `${number}-${number}-${number}`, value: d.value }))

        if (mainPts.length) {
          const lastPct = typeof portfolioReturnPct === "number"
            ? portfolioReturnPct
            : mainPts[mainPts.length - 1].value - 100
          const spyComp = data.comparisons?.find(c => c.ticker === "SPY")
          const spyPct  = spyComp?.data.length ? spyComp.data[spyComp.data.length - 1].value - 100 : 0
          setPerf({ pct: lastPct, spyPct, alpha: benchmarkAlpha(lastPct, spyPct) })

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
  }, [ticker, period, height, portfolioData, portfolioReturnPct]) // eslint-disable-line

  useEffect(() => { load() }, [load])
  useEffect(() => () => { chartRef.current?.remove(); chartRef.current = null }, [])

  return (
    <div>
      {/* Perf badge */}
      {perf && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-muted)" }}>
            <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: perf.pct >= 0 ? "#22c55e" : "#ef4444" }} />
            <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: perf.pct >= 0 ? "#22c55e" : "#ef4444" }}>
              {perf.pct >= 0 ? "+" : ""}{perf.pct.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-muted)" }}>
            <span className="h-0.5 w-4 border-t-2 border-dashed inline-block" style={{ borderColor: "#eab308" }} />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>S&P 500</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: "#eab308" }}>
              {perf.spyPct >= 0 ? "+" : ""}{perf.spyPct.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-muted)" }}>
            <span className="h-0.5 w-4 border-t-2 border-dashed inline-block" style={{ borderColor: "#22c55e" }} />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>MSCI World</span>
          </div>
          {Math.abs(perf.alpha) > 0.5 && (
            <div className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{
                backgroundColor: perf.alpha > 0 ? "#22c55e12" : "#94a3b812",
                color: perf.alpha > 0 ? "#22c55e" : "var(--text-tertiary)",
              }}>
              Alpha {perf.alpha >= 0 ? "+" : ""}{perf.alpha.toFixed(2)}% vs S&P 500
            </div>
          )}
          <div className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
            style={{ backgroundColor: "var(--bg-muted)", color: "var(--text-tertiary)" }}>
            <AlertCircle className="h-3 w-3" />
            Rendement calé sur le P&L réel
          </div>
        </div>
      )}
      <div className="relative rounded-xl border" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "#3b82f6" }} />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Chargement des données Yahoo Finance…</span>
            </div>
          </div>
        )}
        <div ref={containerRef} className="p-2" style={{ width: "100%", height }} />
      </div>
    </div>
  )
}

/**
 * Rend la zone nom/logo d'une ligne cliquable vers la fiche de l'actif
 * (graphique TradingView, statistiques, position). Les liquidités n'ont pas
 * de cotation : la zone reste inerte plutôt que de mener à une page vide.
 */
function AssetLink({
  asset, className, children,
}: { asset: Asset; className?: string; children: React.ReactNode }) {
  if (asset.assetClass === "cash" || asset.assetClass === "real_estate") {
    return <div className={className}>{children}</div>
  }
  return (
    <Link
      href={`/assets/${encodeURIComponent(asset.ticker)}`}
      className={`${className ?? ""} group cursor-pointer`}
      title={`Voir la fiche et le graphique de ${asset.ticker}`}
    >
      {children}
    </Link>
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
      style={{ color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>
      <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      {active ? (dir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />) : <ChevronsUpDown className="h-2.5 w-2.5 opacity-40" />}
    </button>
  )
}

function HoldingsTable({
  portfolio,
  livePrices,
  onDeleteAsset,
  onSellAsset,
  onEditAsset,
  totalValue,
}: {
  portfolio:    Portfolio
  livePrices:   Record<string, { price: number; changePct: number; originalPrice?: number; originalCurrency?: string }>
  onDeleteAsset: (assetId: string) => void
  onSellAsset:  (asset: Asset, price: number, currency: string) => void
  onEditAsset:  (asset: Asset) => void
  totalValue:   number
}) {
  const { format, convert, fxRates, currency } = useCurrency()
  const [sortKey, setSortKey] = useState<SortKey>("value")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [filter, setFilter]   = useState("")
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Ferme le menu si clic hors
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])
  // JS-based responsive — avoids Tailwind v4 hidden/md:grid issues
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const sorted = useMemo(() => {
    // Only show open positions (qty > 0).  Closed/sold positions are kept in
    // the transactions history but should not clutter the holdings table.
    const q = filter.trim().toLowerCase()
    return [...portfolio.assets]
      .filter(a => a.quantity > 0)
      .filter(a => !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .sort((a, b) => {
      const liveA = livePrices[a.ticker]?.price ?? a.currentPrice
      const liveB = livePrices[b.ticker]?.price ?? b.currentPrice
      const eA = { ...a, currentPrice: liveA }
      const eB = { ...b, currentPrice: liveB }
      const pnlPctFor = (asset: Asset) => {
        const liveData = livePrices[asset.ticker]
        const nativeCurr = liveData?.originalCurrency ?? asset.currency ?? "CHF"
        const rate = ((fxRates as Record<string, number>)[nativeCurr] ?? 1)
        const valueCHF = ((liveData?.originalPrice ?? asset.currentPrice) * asset.quantity) / rate
        const legacyCostCHF = (asset.avgBuyPrice * asset.quantity) / rate
        const costCHF = asset.costBasisChf ?? legacyCostCHF
        return costCHF > 0 ? ((valueCHF - costCHF) / costCHF) * 100 : 0
      }

      let va = 0, vb = 0
      switch (sortKey) {
        case "name":        va = a.name.localeCompare(b.name); return sortDir === "asc" ? va : -va
        case "qty":         va = a.quantity;      vb = b.quantity;      break
        case "avgPrice":    va = a.avgBuyPrice;   vb = b.avgBuyPrice;   break
        case "currentPrice":va = liveA;           vb = liveB;           break
        // liveA/liveB = prix live en devise user (déjà converti par livePrices hook)
        case "value":       va = liveA * a.quantity; vb = liveB * b.quantity; break
        case "dayPnl":      va = livePrices[a.ticker]?.changePct ?? 0; vb = livePrices[b.ticker]?.changePct ?? 0; break
        case "totalPnlPct": va = pnlPctFor(a); vb = pnlPctFor(b); break
        case "weight":      va = liveA * a.quantity; vb = liveB * b.quantity; break
      }
      return sortDir === "asc" ? va - vb : vb - va
    })
  }, [portfolio.assets, sortKey, sortDir, livePrices, fxRates, filter])

  const COL = "minmax(160px,1fr) 44px 124px 134px 110px 72px 80px 96px 96px"

  // ── MOBILE layout: compact card per asset ─────────────────────────────────
  if (isMobile) {
    return (
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        {sorted.length === 0 && (
          <div className="flex flex-col items-center py-8 gap-2">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucun actif</p>
          </div>
        )}
        {sorted.map((asset, i) => {
          const liveData      = livePrices[asset.ticker]
          const livePrice     = liveData?.price ?? asset.currentPrice
          const dayChangePct  = liveData?.changePct ?? 0
          const origPrice     = liveData?.originalPrice   // prix natif (USD/EUR) — peut être undefined
          const origCurrency  = liveData?.originalCurrency ?? asset.currency
          const nativeAvg     = asset.avgBuyPrice
          // ⚠️ Ne jamais utiliser livePrice (déjà converti CHF) comme fallback de origPrice (natif USD)
          // Si origPrice indisponible → on ne peut pas calculer un % fiable → afficher 0
          const pnlPct = (origPrice != null && nativeAvg > 0)
            ? ((origPrice - nativeAvg) / nativeAvg) * 100
            : 0
          const val           = livePrice * asset.quantity
          const color         = ASSET_CLASS_COLORS[asset.assetClass]

          return (
            <div key={asset.id} style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                {/* Icon + nom : accès à la fiche de l'actif */}
                <AssetLink asset={asset} className="flex flex-1 items-center gap-3 min-w-0">
                <div className="h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: color + "22", color }}>
                  {asset.ticker.slice(0, 3)}
                </div>

                {/* Name + class */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {asset.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <AssetClassBadge label={ASSET_CLASS_LABELS[asset.assetClass]} color={color} />
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {Number(asset.quantity).toFixed(8).replace(/\.?0+$/, '')} ×
                    </span>
                    {/* Current price inline */}
                    {origPrice && origCurrency ? (
                      <span className="text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {origCurrency !== "CHF" ? `${origCurrency} ${origPrice.toFixed(2)}` : format(livePrice)}
                      </span>
                    ) : (
                      <span className="text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {format(livePrice)}
                      </span>
                    )}
                    {liveData?.price && <span className="h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0" />}
                  </div>
                </div>
                </AssetLink>

                {/* Right: value + P&L */}
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {format(val)}
                  </p>
                  <div className="flex items-center gap-1.5 justify-end mt-0.5">
                    <ChangeBadge value={dayChangePct} showIcon={false} />
                    <ChangeBadge value={pnlPct} showIcon={false} />
                  </div>
                </div>

                {/* Delete */}
                <button onClick={() => onSellAsset(asset, origPrice ?? livePrice, origCurrency)}
                  className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-green-500/20 transition-colors"
                  style={{ color: "var(--gain)" }}
                  title="Vendre">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onDeleteAsset(asset.id)}
                  className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-500/20 transition-colors"
                  style={{ color: "var(--text-tertiary)" }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Progress bar (weight) */}
              <div className="px-4 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(totalValue > 0 ? (val/totalValue)*100 : 0, 100)}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {totalValue > 0 ? ((val/totalValue)*100).toFixed(0) : 0}%
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── DESKTOP layout: full grid table ──────────────────────────────────────
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
      {/* Recherche dans les positions */}
      <div className="flex items-center gap-2 border-b px-5 py-2.5" style={{ borderColor: "var(--border)" }}>
        <Search className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtrer les positions (ticker ou nom)…"
          aria-label="Filtrer les positions"
          className="w-full bg-transparent text-xs outline-none"
          style={{ color: "var(--text-primary)" }}
        />
        {filter && (
          <button onClick={() => setFilter("")} aria-label="Effacer le filtre"
            className="text-[11px] font-medium flex-shrink-0" style={{ color: "var(--text-tertiary)" }}>
            Effacer
          </button>
        )}
      </div>
      {/* Scrollable wrapper for wide table */}
      <div className="overflow-x-auto">
      {/* Desktop header */}
      <div className="grid px-5 py-2.5 border-b"
        style={{ borderColor: "var(--border)", minWidth: "980px", gridTemplateColumns: COL }}>
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Actif</span>
        {([ ["Qté","qty"], ["Px moy.*","avgPrice"], ["Prix actuel","currentPrice"], ["Valeur","value"], ["J. P&L","dayPnl"], ["P&L latent","totalPnlPct"], ["Poids","weight"] ] as [string, SortKey][]).map(([l, k]) => (
          <SortHeader key={k} label={l} sortKey={k} current={sortKey} dir={sortDir} onSort={handleSort} />
        ))}
        {/* * = frais inclus dans le prix moyen */}
        <span />
      </div>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center py-10 gap-2">
          <BarChart2 className="h-7 w-7" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucun actif</p>
        </div>
      )}

      {sorted.map((asset, i) => {
        const liveData     = asset.assetClass === "cash" ? undefined : livePrices[asset.ticker]
        const dayChangePct = liveData?.changePct ?? 0

        // ─ Display currency (user preference) ──────────────────────────────
        const livePriceUserCurr = asset.assetClass === "cash"
          ? convert(asset.currentPrice || asset.avgBuyPrice || 1, asset.currency as AppCurrency)
          : liveData?.price ?? asset.currentPrice  // in user's currency
        const origPrice         = liveData?.originalPrice                 // native (USD/EUR/CHF)
        const origCurrency      = liveData?.originalCurrency ?? asset.currency ?? "USD"

        // ─ Value in user's currency ─────────────────────────────────────────
        const val = livePriceUserCurr * asset.quantity

        // ─ P&L : TOUJOURS comparer native vs native (pas CHF vs USD) ────────
        //
        //   RÈGLE: pnlPct = (origPrice_USD - avgBuyPrice_USD) / avgBuyPrice_USD
        //   Ne JAMAIS utiliser asset.currentPrice (déjà converti CHF) comme proxy
        //   de origPrice — ce serait comparer CHF avec USD.
        //
        //   Pour le montant CHF: utiliser costBasisChf (historique figé)
        //   et valeur convertie depuis le prix natif.

        const nativeAvg = asset.avgBuyPrice  // en devise native (USD/EUR/CHF)
        const rateToChf = ((fxRates as Record<string,number>)[origCurrency] ?? 1)

        // valueCHF = prix natif × qty / rateToChf
        const valueCHF = origPrice != null
          ? origPrice * asset.quantity / rateToChf
          : livePriceUserCurr * asset.quantity

        // costCHF : la valeur stockée (CHF historique figé) fait foi ; fallback
        // au taux courant uniquement si absente (via safeCostBasisChf canonique).
        const costCHF = safeCostBasisChf(
          asset.costBasisChf, asset.quantity, nativeAvg, origCurrency,
          fxRates as Record<string, number>
        )

        const userRate    = ((fxRates as Record<string,number>)[currency] ?? 1)
        const pnlUserCurr = (valueCHF - costCHF) * userRate

        // P&L % CHF-based : correspond au broker (inclut effet FX)
        const pnlPct = costCHF > 0 ? ((valueCHF - costCHF) / costCHF) * 100 : 0

        // ─ Avg price converted to user's currency (for display) ────────────
        const avgPriceUserCurr = convert(nativeAvg, origCurrency as AppCurrency)

        const weight = totalValue > 0 ? (val / totalValue) * 100 : 0
        const color  = ASSET_CLASS_COLORS[asset.assetClass]

        return (
          <div key={asset.id} style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
            {/* Mobile card */}
            {/* Desktop-only row (isMobile handled above, returns early) */}
            <div className="portfolio-table-row grid items-center px-5 py-3 transition-colors"
              style={{ minWidth: "980px", gridTemplateColumns: COL }}>
              <AssetLink asset={asset} className="flex items-center gap-3 min-w-0">
                <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: color + "22", color }}>
                  {asset.ticker.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {asset.name}
                    {livePrices[asset.ticker] == null && (
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }}
                        title="Prix indisponible — valorisé au coût" />
                    )}
                  </p>
                  <AssetClassBadge label={ASSET_CLASS_LABELS[asset.assetClass]} color={color} />
                  {asset.assetClass === "crypto" && (asset.cryptoCustody || asset.stakingEnabled) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {asset.cryptoCustody && (
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: "#a78bfa18", color: "#a78bfa" }}>
                          {CRYPTO_CUSTODY_LABELS[asset.cryptoCustody] ?? asset.cryptoCustody}
                        </span>
                      )}
                      {asset.stakingEnabled && (
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: "#22c55e18", color: "#22c55e" }}>
                          Staking/Lending
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </AssetLink>
              {/* Qty — centred, bold, rounded to avoid floating point errors */}
              <p className="text-center text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {Number(asset.quantity).toFixed(8).replace(/\.?0+$/, '')}
              </p>
              {/* Avg buy price — frais inclus dans avgBuyPrice */}
              <div className="flex flex-col items-end gap-0.5">
                <DualPrice price={avgPriceUserCurr} originalPrice={nativeAvg} originalCurrency={origCurrency} size="xs" />
                <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }} title="Le prix moyen inclut les frais d'achat">frais inclus</span>
              </div>
              {/* Current price — stacked dual price + live dot */}
              <div className="flex items-center justify-end gap-1.5">
                <DualPrice price={livePriceUserCurr} originalPrice={origPrice} originalCurrency={origCurrency} size="xs" />
                {liveData?.price && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
              </div>
              {/* Total value in user's currency */}
              <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {format(val)}
              </p>
              {/* Day P&L — % + montant journalier */}
              {(() => {
                const dayPnlAmt = dayChangePct / 100 * val
                return (
                  <div className="flex flex-col items-end gap-0.5">
                    <ChangeBadge value={dayChangePct} showIcon={false} />
                    {Math.abs(dayPnlAmt) > 0.005 && (
                      <span className="text-[10px] tabular-nums" style={{ color: dayPnlAmt >= 0 ? "var(--gain)" : "var(--loss)" }}>
                        {dayPnlAmt >= 0 ? "+" : ""}{format(dayPnlAmt)}
                      </span>
                    )}
                  </div>
                )
              })()}
              {/* P&L latent — montant EN DEVISE USER + % (formule: valeurCHF - costCHF × userRate) */}
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs font-bold tabular-nums" style={{ color: pnlPct > 0 ? "var(--gain)" : pnlPct < 0 ? "var(--loss)" : "var(--text-secondary)" }}>
                  {pnlUserCurr >= 0 ? "+" : ""}{format(pnlUserCurr)}
                </span>
                <ChangeBadge value={pnlPct} showIcon={false} />
              </div>
              {/* Weight bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(weight, 100)}%`, backgroundColor: color }} />
                </div>
                <span className="text-[11px] tabular-nums w-8 text-right" style={{ color: "var(--text-secondary)" }}>
                  {weight.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center justify-end gap-1" ref={openMenuId === asset.id ? menuRef : null}>
                {/* Bouton Vendre */}
                <button
                  onClick={() => onSellAsset(asset, origPrice ?? livePriceUserCurr, origCurrency)}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium hover:bg-green-500/20 transition-colors"
                  style={{ color: "var(--gain)" }}
                  title="Vendre"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Vendre
                </button>

                {/* Menu trois points */}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === asset.id ? null : asset.id) }}
                    className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-zinc-700 transition-colors"
                    style={{ color: "var(--text-tertiary)" }}
                    title="Options"
                  >
                    <span className="text-sm font-bold leading-none" style={{ letterSpacing: "0.05em" }}>···</span>
                  </button>

                  <AnimatePresence>
                    {openMenuId === asset.id && (
                      <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.1 }}
                        className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border overflow-hidden shadow-2xl"
                        style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,0.7)" }}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Modifier */}
                        <button
                          onClick={() => { setOpenMenuId(null); onEditAsset(asset) }}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-zinc-700/60 transition-colors"
                          style={{ color: "var(--text-primary)" }}
                        >
                          <Edit2 className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                          Modifier
                        </button>

                        {/* Separator */}
                        <div className="h-px mx-3" style={{ backgroundColor: "var(--border)" }} />

                        {/* Supprimer */}
                        <button
                          onClick={() => { setOpenMenuId(null); onDeleteAsset(asset.id) }}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-red-500/10 transition-colors"
                          style={{ color: "#ef4444" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        )
      })}
      </div>{/* /overflow-x-auto */}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PortfoliosPage() {
  const { format, convert, fxRates, currency } = useCurrency()
  const {
    portfolios, transactions, revenus, globalCash, realizedPnLEvents, editAsset: doEditAsset,
    loading: dbLoading,
    addPortfolio: dbAddPortfolio,
    removePortfolio: dbRemovePortfolio,
    addAsset: dbAddAsset,
    removeAsset: dbRemoveAsset,
    addTransaction,
    depositCash,
    getAvailableCash,
    refresh: refreshAppData,
  } = useAppData()
  // setPortfolios not available in AppData — mutations are reflected automatically
  const setPortfolios = (_: unknown) => {} // noop placeholder
  const { importBrokerCSV } = usePortfolioImport()
  const [activeTab, setActiveTab] = useState("global")
  const [txModal, setTxModal]     = useState<{ defaultPortfolioId?: string; initial?: TransactionFormData } | null>(null)
  const [showPortfolioCreation, setShowPortfolioCreation] = useState(false)

  function openTxModal(portfolioId?: string) {
    setTxModal({ defaultPortfolioId: portfolioId ?? portfolios[0]?.id ?? "" })
  }

  // Modale "Modifier la position" — formulaire complet
  const [editAssetModal, setEditAssetModal] = useState<{
    asset: Asset
    qty:        string
    avgPrice:   string
    fees:       string
    currency:   string
    date:       string
    notes:      string
  } | null>(null)

  // Confirmation before deletion
  const [deleteConfirm, setDeleteConfirm] = useState<{ portfolioId: string; assetId: string } | null>(null)
  const [deletePortfolioConfirm, setDeletePortfolioConfirm] = useState<string | null>(null) // portfolio ID to delete
  // Renommer un portefeuille n'existe nulle part dans l'application : plutôt
  // qu'un bouton qui ne fait rien, on le dit.
  const [editPortfolioNotice, setEditPortfolioNotice] = useState(false)

  function openEditModal(asset: Asset) {
    const lastBuy = [...transactions]
      .filter(t => t.portfolioId === asset.portfolioId && t.ticker === asset.ticker && t.type === "buy")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    setEditAssetModal({
      asset,
      qty:          String(asset.quantity),
      avgPrice:     String(Number(asset.avgBuyPrice).toFixed(4)),
      fees:         String(lastBuy?.fees ?? 0),
      currency:     asset.currency ?? "CHF",
      date:         lastBuy?.date ?? new Date().toISOString().slice(0, 10),
      notes:        "",
    })
  }

  function openSellModal(asset: Asset, price: number, currency: string) {
    setTxModal({
      defaultPortfolioId: asset.portfolioId,
      initial: {
        portfolioId: asset.portfolioId,
        ticker: asset.ticker,
        assetName: asset.name,
        assetClass: asset.assetClass,
        type: "sell",
        selectedClass: "stock" as const,
        quantity: String(asset.quantity),
        price: String(Number(price || asset.currentPrice || asset.avgBuyPrice || 0).toFixed(4)),
        nativeCurrency: currency || asset.currency || "CHF",
        fees: "1",
        date: new Date().toISOString().slice(0, 10),
        notes: "",
      },
    })
  }

  async function handleSaveTx(form: TransactionFormData) {
    // ── Dépôt de trésorerie ──────────────────────────────────────────────────
    if (form.selectedClass === "cash" || form.type === "deposit") {
      const amount   = parseFloat(form.depositAmount || "0")
      const currency = (form.depositCurrency || "CHF") as "CHF" | "USD" | "EUR"
      if (!amount || amount <= 0) throw new Error("Montant invalide")
      // Le dépôt va sur le portefeuille choisi ; sans portefeuille désigné il
      // rejoint la poche « Hors portefeuille » plutôt qu'un courtier au hasard.
      await depositCash(form.portfolioId || UNASSIGNED_CASH, amount, currency)
      setTxModal(null)
      return
    }
    // ── Transaction normale ──────────────────────────────────────────────────
    const res = await addTransaction({
      portfolioId: form.portfolioId,
      ticker:      form.ticker,
      assetName:   form.assetName,
      assetClass:  form.assetClass,
      type:        form.type,
      quantity:    parseFloat(form.quantity),
      price:       parseFloat(form.price),
      fees:        parseFloat(form.fees) || 0,
      currency:    (form.nativeCurrency || "CHF") as "CHF" | "EUR" | "USD" | "GBP",
      date:        form.date,
      notes:       form.notes || undefined,
    })
    if (!res.ok) throw new Error(res.error ?? "Erreur Supabase")
    setTxModal(null)
  }
  const [period,     setPeriod]     = useState<Period>("1Y")
  // Période propre à la vue mobile : elle a sa propre échelle (1J → Tout)
  // et ne doit pas perturber les graphiques de la vue bureau.
  const [mobilePeriod, setMobilePeriod] = useState<MobilePeriod>("1M")

  // Détection JS plutôt que classes Tailwind : le rendu mobile est une
  // arborescence différente, pas un simple masquage. Faux au premier rendu
  // pour que le serveur et le client produisent le même HTML.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])
  const [chartMode,  setChartMode]  = useState<"valeur" | "performance">("valeur")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Use quoteSymbol when available (e.g. "WSML.L" for T212 EU) so Yahoo Finance
  // resolves the correct instrument.  Prices come back keyed by quoteSymbol;
  // the liveEnriched memo below also indexes by broker ticker for backward compat.
  const allTickers = portfolios.flatMap(p =>
    p.assets.filter(a => a.assetClass !== "cash").map(a => a.quoteSymbol ?? a.ticker)
  )
  const { prices: livePrices } = useLivePrices(allTickers, 30_000)

  // Enrich prices — include original currency for dual display.
  // De-alias: when a price was fetched via quoteSymbol (e.g. "WSML.L"), also index
  // the entry under the broker ticker ("WSML") so all livePrices[a.ticker] lookups
  // in HoldingsTable and metric helpers continue to work transparently.
  const liveEnriched = useMemo(() => {
    const out: Record<string, { price: number; changePct: number; originalPrice?: number; originalCurrency?: string }> = {}
    for (const [t, p] of Object.entries(livePrices)) {
      out[t] = { price: p.price, changePct: p.changePct, originalPrice: p.originalPrice, originalCurrency: p.originalCurrency }
    }
    for (const p of portfolios) {
      for (const a of p.assets) {
        const qs = a.quoteSymbol
        if (qs && qs !== a.ticker && out[qs] && !out[a.ticker]) {
          out[a.ticker] = out[qs]
        }
      }
    }
    return out
  }, [livePrices, portfolios])

  const metricAssetsFor = useCallback((assets: Asset[]) => assets
    .filter(a => a.assetClass !== "cash")
    .map(a => {
      const nativeCurr = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "CHF"
      // La valeur stockée (CHF historique figé) fait foi ; fallback au taux
      // courant uniquement si absente (safeCostBasisChf canonique).
      const costBasisChf = safeCostBasisChf(
        a.costBasisChf, a.quantity, a.avgBuyPrice, nativeCurr,
        fxRates as Record<string, number>
      )
      return {
        ticker: a.ticker,
        quantity: a.quantity,
        currentPriceNative: liveEnriched[a.ticker]?.originalPrice ?? a.currentPrice,
        nativeCurrency: nativeCurr,
        costBasisChf,
        assetClass: a.assetClass,
      }
    }), [liveEnriched, fxRates])

  const portfolioMetricsById = useMemo(() => {
    const metrics = new Map<string, PortfolioMetrics>()
    // Les portfolios n'ont plus de cash propre — on passe {} (vide)
    portfolios.forEach(p => {
      metrics.set(p.id, calculatePortfolioMetrics(metricAssetsFor(p.assets), {}, fxRates))
    })
    return metrics
  }, [portfolios, metricAssetsFor, fxRates])

  const globalMetrics = useMemo(() =>
    // Trésorerie exclue : elle n'est plus affichée nulle part, elle ne doit
    // donc plus gonfler un total que personne ne peut recouper.
    calculatePortfolioMetrics(metricAssetsFor(portfolios.flatMap(p => p.assets)), {}, fxRates),
    [portfolios, metricAssetsFor, fxRates]
  )

  // ── Global totals — formule stricte CHF (spec) ───────────────────────────
  // Étape 1: tout en CHF via prix natifs, Étape 2: convertir vers devise user

  // cost_chf = Σ qty × avgBuyPrice_native / (fxRates as Record<string,number>)[native]
  const totalCostCHF = globalMetrics.investedChf

  // value_chf = Σ qty × currentPrice_native / (fxRates as Record<string,number>)[native]
  const totalNetWorthCHF = globalMetrics.portfolioValueChf

  // Convertir CHF → devise user
  const userRate    = (fxRates as Record<string,number>)[currency] ?? 1
  const totalCost   = totalCostCHF  * userRate
  const totalValue  = totalNetWorthCHF * userRate
  const totalPnl    = globalMetrics.totalPnlChf * userRate
  const totalPnlPct = globalMetrics.totalReturnPercent

  const allAssets = portfolios.flatMap(p => p.assets)
  const allAssetsEnriched = allAssets.map(a => ({
    ...a,
    currentPrice: a.assetClass === "cash"
      ? convert(a.currentPrice || a.avgBuyPrice || 1, a.currency as AppCurrency)
      : liveEnriched[a.ticker]?.price ?? a.currentPrice,
  }))

  // Top movers
  const moversData = allAssetsEnriched.map(a => ({
    ...a,
    dayChangePct: liveEnriched[a.ticker]?.changePct ?? 0,
  })).sort((a, b) => b.dayChangePct - a.dayChangePct)
  // Un actif en baisse n'a rien à faire dans « meilleures performances » (et
  // inversement) : on filtre par signe avant de prendre le top 3.
  const topGainers = moversData.filter(a => a.dayChangePct > 0).slice(0, 3)
  const topLosers  = moversData.filter(a => a.dayChangePct < 0).reverse().slice(0, 3)

  // Asset allocation by class
  const byClass = allAssetsEnriched.reduce<Record<string, number>>((acc, a) => {
    acc[a.assetClass] = (acc[a.assetClass] ?? 0) + a.quantity * a.currentPrice
    return acc
  }, {})
  if (globalMetrics.cashChf > 0) {
    byClass.cash = (byClass.cash ?? 0) + globalMetrics.cashChf * userRate
  }

  // Dividendes encaissés sur les 12 derniers mois (transactions réelles),
  // exprimés en devise d'affichage — plus de valeur codée en dur.
  const annualDivs = useMemo(() => {
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return transactions
      .filter(t => t.type === "dividend" && t.date >= cutoffStr)
      .reduce((s, t) => {
        if (t.netAmountChf != null) return s + t.netAmountChf * userRate
        const fxN = (fxRates as Record<string, number>)[t.currency ?? "CHF"] ?? 1
        return s + (t.quantity * t.price / fxN) * userRate
      }, 0)
  }, [transactions, fxRates, userRate])

  // Best/worst
  const best  = moversData[0]
  const worst = moversData[moversData.length - 1]

  async function handleAddPortfolioManual(name: string, desc: string, color: string) {
    const id = await dbAddPortfolio({
      name, description: desc,
      color, currency: "CHF", cashBalances: { CHF: 0, USD: 0, EUR: 0 }, createdAt: new Date().toISOString().slice(0, 10),
    })
    if (id) setActiveTab(id)
  }

  async function handleAddPortfolioWithImport(
    name: string,
    file: File,
    analysis: any,
    operations: any[],
    broker: BrokerId = "trading_212"
  ) {
    const result = await importBrokerCSV(name, file, operations, broker)

    // Le cash du relevé appartient à CE compte-titres, pas à une cagnotte
    // commune : il est crédité sur le portefeuille qui vient d'être créé.
    // La RPC journalise bien les mouvements (audit) mais n'incrémente aucun
    // solde — sans ce crédit, un compte IBKR arrivait avec 0 de liquidités
    // alors que le relevé en déclare (1 328 CHF dans le cas réel, un tiers du
    // compte). Le solde déclaré par le courtier fait foi : rejouer les flux
    // ne serait fiable que si l'export couvrait toute l'histoire du compte.
    const declared = analysis?.cashBalances as Record<string, number> | undefined
    if (declared) {
      for (const cur of ["CHF", "USD", "EUR"] as const) {
        const amount = declared[cur]
        if (amount > 0) {
          await depositCash(result.portfolioId, amount, cur, `Import ${BROKERS[broker].label}`)
        }
      }
    }

    // La RPC écrit directement en base, hors du state local d'useAppData :
    // sans ce refresh, le nouveau portefeuille n'apparaissait qu'au
    // rechargement manuel de la page.
    await refreshAppData()
    setActiveTab(result.portfolioId)
    return result
  }

  async function handleAddAsset(portfolioId: string, result: SearchResult) {
    try {
      const res       = await fetch("/api/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: [result.ticker] }) })
      const data      = await res.json()
      const live      = data[result.ticker]
      const livePrice = live?.originalPrice ?? live?.chf ?? live?.price ?? 0
      await dbAddAsset(portfolioId, {
        id: `a${Date.now()}`, portfolioId,
        ticker: result.ticker, name: result.name,
        assetClass: result.type as AssetClass,
        quantity: 1, avgBuyPrice: livePrice || 0,
        currency: live?.originalCurrency ?? "CHF",
        costBasisChf: live?.chf ?? livePrice,
        costBasisSource: "computed" as const,
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

  /**
   * Export CSV des positions ouvertes — remise en forme de ce qui est déjà à
   * l'écran, aucune valeur recalculée.
   */
  function exportPortfolioCsv(p: Portfolio) {
    const rows = p.assets
      .filter(a => a.assetClass !== "cash" && a.quantity > 0)
      .map(a => {
        const live = liveEnriched[a.ticker]
        return [
          a.ticker,
          a.name.replace(/"/g, '""'),
          ASSET_CLASS_LABELS[a.assetClass],
          a.quantity,
          a.avgBuyPrice,
          live?.originalPrice ?? a.currentPrice,
          live?.originalCurrency ?? a.currency ?? "CHF",
        ]
      })
    const header = ["Ticker", "Nom", "Classe", "Quantite", "PrixMoyen", "PrixActuel", "Devise"]
    const csv = [header, ...rows]
      .map(r => r.map(c => typeof c === "string" && c.includes(",") ? `"${c}"` : c).join(","))
      .join("\n")

    // BOM en tête : sans lui Excel lit le CSV en ANSI et casse les accents.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url
    a.download = `${p.name.replace(/[^\w-]+/g, "_")}_positions.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDeleteAsset(portfolioId: string, assetId: string) {
    // Show confirmation dialog instead of deleting immediately
    setDeleteConfirm({ portfolioId, assetId })
  }

  function confirmDeleteAsset() {
    if (!deleteConfirm) return
    dbRemoveAsset(deleteConfirm.portfolioId, deleteConfirm.assetId)
    setDeleteConfirm(null)
  }

  function handleDeletePortfolio(id: string) {
    // Show confirmation dialog instead of deleting immediately
    setDeletePortfolioConfirm(id)
  }

  function confirmDeletePortfolio() {
    if (!deletePortfolioConfirm) return
    dbRemovePortfolio(deletePortfolioConfirm)
    setDeletePortfolioConfirm(null)
    setActiveTab("global")
  }

  const activePortfolio = portfolios.find(p => p.id === activeTab)
  const activePortfolioMetrics = activePortfolio ? portfolioMetricsById.get(activePortfolio.id) : undefined

  // ── Historique réel pour les BenchmarkCharts ────────────────────────────────
  // Méthode: qty_actuelle × prix_historique — cashflows/dépôts/retraits exclus (positions only)
  // → Base 100 normalisée = vraie performance hors cashflows
  const API_PERIOD_MAP: Record<Period, string> = {
    "1W": "1W", "1M": "1M", "3M": "3M", "6M": "6M", "1Y": "1Y", "MAX": "MAX"
  }

  // Vue individuelle — portefeuille actif
  const activePortfolioHistoryAssets = useMemo<PortfolioAsset[]>(() => {
    if (!activePortfolio) return []
    return activePortfolio.assets
      .filter(a => a.assetClass !== "cash" && a.quantity > 0)  // positions ouvertes seulement
      .map(a => ({
        ticker:         a.ticker,
        quantity:       a.quantity,
        nativeCurrency: liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "USD",
      }))
  }, [activePortfolio, liveEnriched])

  const { history: activePortfolioHistory, loading: activeHistoryLoading } =
    usePortfolioHistory(activePortfolioHistoryAssets, API_PERIOD_MAP[period] ?? "1Y")

  // Vue globale — tous les portefeuilles agrégés
  const globalHistoryAssets = useMemo<PortfolioAsset[]>(() =>
    portfolios.flatMap(p =>
      p.assets
        .filter(a => a.assetClass !== "cash" && a.quantity > 0)  // positions ouvertes seulement
        .map(a => ({
          ticker:         a.ticker,
          quantity:       a.quantity,
          nativeCurrency: liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "USD",
        }))
    ),
    [portfolios, liveEnriched]
  )

  const { history: globalPortfolioHistory, loading: globalHistoryLoading } =
    usePortfolioHistory(globalHistoryAssets, API_PERIOD_MAP[period] ?? "1Y")

  // Historique de la vue mobile — même source, échelle de périodes propre.
  // La pastille « Tous » montre l'agrégat ; hors mobile on ne demande rien.
  const mobileHistoryAssets = useMemo<PortfolioAsset[]>(() => {
    if (!isMobile) return []
    return activeTab === "global" ? globalHistoryAssets : activePortfolioHistoryAssets
  }, [isMobile, activeTab, globalHistoryAssets, activePortfolioHistoryAssets])

  const { history: mobileHistory, loading: mobileHistoryLoading } =
    usePortfolioHistory(mobileHistoryAssets, MOBILE_PERIOD_TO_API[mobilePeriod] ?? "1M")

  // ── Cartes d'analyse de la vue mobile ────────────────────────────────────
  // Construites uniquement à partir de ce que l'application collecte
  // réellement. Une carte sans donnée le dit — elle n'affiche pas un zéro
  // qui passerait pour une mesure.
  const mobileAnalytics = useMemo<AnalyticsCard[]>(() => {
    // Même jeu de cartes pour un portefeuille ou pour l'agrégat : seul le
    // périmètre des positions change.
    const scopeAssets = activeTab === "global"
      ? portfolios.flatMap(p => p.assets)
      : activePortfolio?.assets
    if (!scopeAssets) return []
    const ur = (fxRates as Record<string, number>)[currency] ?? 1
    const open = scopeAssets.filter(a => a.assetClass !== "cash" && a.quantity > 0)

    const valued = open.map(a => ({
      asset: a,
      value: (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity,
      cur:   liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "CHF",
    }))
    const total = valued.reduce((s2, v) => s2 + v.value, 0)
    const share = (v: number) => total > 0 ? (v / total) * 100 : 0

    /** Regroupe les positions par clé et convertit chaque groupe en part du total. */
    const byKey = (
      pick: (v: typeof valued[number]) => string,
      colorOf?: (k: string) => string | undefined,
    ) => {
      const m = new Map<string, number>()
      for (const v of valued) {
        const k = pick(v)
        m.set(k, (m.get(k) ?? 0) + v.value)
      }
      return [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, v]) => ({
          label: key,
          value: `${share(v).toFixed(1)} %`,
          pct:   share(v),
          color: colorOf?.(key),
        }))
    }

    // On groupe sur la classe elle-même : la couleur en découle directement,
    // sans repasser par le libellé traduit.
    const classRows = byKey(v => v.asset.assetClass, k => ASSET_CLASS_COLORS[k as AssetClass])
      .map(r => ({ ...r, label: ASSET_CLASS_LABELS[r.label as AssetClass] }))
    const currencyRows = byKey(v => v.cur)

    const txs = activeTab === "global"
      ? transactions
      : transactions.filter(t => t.portfolioId === activePortfolio?.id)
    const feesChf = txs.reduce((s2, t) => s2 + (t.feesChf ?? 0), 0)

    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
    const divChf = txs
      .filter(t => t.type === "dividend" && String(t.date).slice(0, 10) >= since)
      .reduce((s2, t) => s2 + (t.netAmountChf ?? 0), 0)
    const yieldPct = total > 0 ? (divChf * ur / total) * 100 : 0

    const sorted = [...valued].sort((a, b) => b.value - a.value)
    const topShare = sorted.length ? share(sorted[0].value) : 0
    const hhi = valued.reduce((s2, v) => s2 + Math.pow(share(v.value), 2), 0)

    return [
      {
        key: "classes", label: "Répartition par classe",
        value: classRows[0] ? `${classRows[0].label} ${classRows[0].value}` : "—",
        hint: `${open.length} ligne${open.length > 1 ? "s" : ""}`,
        rows: classRows,
      },
      {
        key: "devises", label: "Répartition par devise",
        value: currencyRows[0] ? `${currencyRows[0].label} ${currencyRows[0].value}` : "—",
        hint: "Devise de cotation, pas de conversion",
        rows: currencyRows,
      },
      {
        key: "concentration", label: "Concentration",
        value: sorted.length ? `${topShare.toFixed(0)} % sur ${sorted[0].asset.ticker}` : "—",
        hint: hhi > 2500 ? "Portefeuille très concentré" : hhi > 1500 ? "Concentration modérée" : "Bien réparti",
        rows: sorted.slice(0, 5).map(v => ({
          label: v.asset.ticker, value: `${share(v.value).toFixed(1)} %`, pct: share(v.value),
        })),
      },
      {
        key: "frais", label: "Frais payés",
        value: format(feesChf * ur),
        hint: activeTab === "global" ? "Tous portefeuilles confondus" : "Cumul depuis l'origine",
        rows: feesChf > 0
          ? [{ label: "Total des frais de transaction", value: format(feesChf * ur) }]
          : [],
        empty: "Aucun frais enregistré sur les transactions de ce portefeuille.",
      },
      {
        key: "dividendes", label: "Rendement dividendes",
        value: divChf > 0 ? `${yieldPct.toFixed(2)} %` : "—",
        hint: "12 derniers mois / valeur actuelle",
        rows: divChf > 0
          ? [{ label: "Dividendes encaissés sur 12 mois", value: format(divChf * ur) }]
          : [],
        empty: "Aucun dividende encaissé sur les 12 derniers mois.",
      },
      {
        key: "secteurs", label: "Répartition sectorielle",
        value: "—",
        hint: "Donnée non collectée",
        rows: [],
        empty: "L'application ne récupère pas encore le secteur ni le pays des titres. Rien n'est affiché plutôt qu'une estimation.",
      },
    ]
  }, [activePortfolio, activeTab, portfolios, liveEnriched, transactions, fxRates, currency, format])

  return (
    <div className="flex flex-col">
      <Topbar title="Portefeuilles" subtitle={`${portfolios.length} portefeuille${portfolios.length > 1 ? "s" : ""} · ${format(totalValue)}`} />

      {/* ─── Barre de portefeuilles (mobile) ───
          Toujours visible en haut : le choix reste sous les yeux et à un seul
          appui, au lieu d'être caché derrière un menu à ouvrir. */}
      {isMobile && (
        <PortfolioChipBar
          portfolios={portfolios}
          activeId={activeTab}
          onSelect={setActiveTab}
          onCreate={() => setShowPortfolioCreation(true)}
        />
      )}

      {/* ─── Tab bar (bureau) ─── */}
      <div className={cn("border-b overflow-x-auto", isMobile && "hidden")} style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-base)" }}>
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
            onClick={() => setShowPortfolioCreation(true)}
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
          {activeTab === "global" && !isMobile && (
            <>
              {/* Hero card — même langage que le dashboard : fond sobre,
                  halo discret, plus de dégradé bleu/vert dominant */}
              <div className="relative overflow-hidden rounded-2xl border px-6 pt-7 pb-6"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                <div className="pointer-events-none absolute inset-0"
                  style={{ background: "radial-gradient(ellipse 60% 50% at 80% 50%, #6366f108, transparent)" }} />

                <div className="relative grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Patrimoine net total</p>
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
                      // Le signe vient du nombre lui-même : "+" n'est ajouté que
                      // s'il est positif (sinon on affichait « +-1.8% »).
                      ...(() => {
                        const bestPct  = best  ? (liveEnriched[best.ticker]?.changePct  ?? 0) : null
                        const worstPct = worst ? (liveEnriched[worst.ticker]?.changePct ?? 0) : null
                        const fmtPct = (v: number | null) =>
                          v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} %`
                        return [
                          { label: "Meilleur", value: fmtPct(bestPct),  sub: best?.ticker,  color: (bestPct  ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" },
                          { label: "Pire",     value: fmtPct(worstPct), sub: worst?.ticker, color: (worstPct ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" },
                        ]
                      })(),
                      { label: "Lignes", value: String(globalMetrics.positionLineCount), sub: `${globalMetrics.uniqueAssetCount} actif${globalMetrics.uniqueAssetCount > 1 ? "s" : ""} unique${globalMetrics.uniqueAssetCount > 1 ? "s" : ""}`, color: "var(--accent)" },
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
                {/* Vue rapide — 3 colonnes compactes */}
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--border)" }}>
                  {[
                    {
                      icon: TrendingUp, iconColor: "#22c55e", label: "Performance",
                      rows: [
                        { k: "Rendement", v: (totalPnlPct >= 0 ? "+" : "") + totalPnlPct.toFixed(2) + "%", c: totalPnlPct >= 0 ? "#22c55e" : "#ef4444" },
                        { k: "P&L latent", v: (totalPnl >= 0 ? "+" : "") + format(totalPnl), c: totalPnl >= 0 ? "#22c55e" : "#ef4444" },
                        { k: "Frais payés", v: "−" + format(transactions.reduce((s,t) => s + ((t.feesChf ?? 0) * userRate), 0)), c: "#f59e0b" },
                      ],
                    },
                    {
                      icon: Activity, iconColor: "#a78bfa", label: "Risque",
                      rows: [
                        // Valeurs réelles non calculées pour l'instant — afficher
                        // "—" plutôt que des chiffres inventés.
                        { k: "Bêta (SPY)", v: "—", c: "var(--text-tertiary)" },
                        { k: "Volatilité", v: "—", c: "var(--text-tertiary)" },
                        { k: "Sharpe",     v: "—", c: "var(--text-tertiary)" },
                      ],
                    },
                    {
                      icon: BarChart2, iconColor: "#f59e0b", label: "Revenus",
                      rows: [
                        { k: "Dividendes / an", v: format(annualDivs), c: "#22c55e" },
                        { k: "Yield on cost", v: totalCost > 0 ? ((annualDivs / totalCost) * 100).toFixed(2) + "%" : "—", c: "var(--text-primary)" },
                      ],
                    },
                  ].map(({ icon: Icon, iconColor, label, rows }) => (
                    <div key={label} className="px-4 py-3 space-y-2"
                      style={{ backgroundColor: "var(--bg-elevated)" }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Icon className="h-3.5 w-3.5" style={{ color: iconColor }} />
                        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{label}</span>
                      </div>
                      {rows.map(r => (
                        <div key={r.k} className="flex items-center justify-between gap-2">
                          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{r.k}</span>
                          <span className="text-[11px] font-semibold tabular-nums" style={{ color: r.c }}>{r.v}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* Graphique dual-mode : Valeur / Performance */}
              <div>
                {/* ── Graphique dual-mode : Valeur / Performance ── */}
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  {/* Header avec switch + période */}
                  <div className="flex items-center justify-between gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                    {/* Switch Valeur / Performance */}
                    <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
                      {([["valeur", "Valeur"], ["performance", "Performance"]] as const).map(([mode, label]) => (
                        <button key={mode} onClick={() => setChartMode(mode)}
                          className="rounded-md px-3 py-1 text-xs font-medium transition-all"
                          style={{
                            backgroundColor: chartMode === mode ? "var(--accent)" : "transparent",
                            color: chartMode === mode ? "white" : "var(--text-tertiary)",
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Période */}
                    <div className="flex gap-0.5">
                      {PERIODS.map(p => (
                        <button key={p} onClick={() => setPeriod(p)}
                          className="rounded-md px-2 py-1 text-xs font-medium transition-all"
                          style={{
                            backgroundColor: period === p ? "var(--bg-subtle)" : "transparent",
                            color: period === p ? "var(--text-primary)" : "var(--text-tertiary)",
                          }}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subtitle */}
                  <div className="px-5 py-2 border-b flex items-center gap-2" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-overlay)" }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: globalHistoryLoading ? "var(--text-tertiary)" : "#22c55e" }} />
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {chartMode === "valeur"
                        ? "Valeur des positions · hors dépôts/retraits · prix Yahoo Finance"
                        : "Base 100 = début de période · cashflows exclus · S&P 500 et MSCI World en pointillés"}
                    </span>
                  </div>

                  <div className="p-4">
                    {globalMetrics.positionLineCount === 0 ? (
                      <div className="flex items-center justify-center h-40">
                        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Ajoutez des actifs pour voir le graphique</p>
                      </div>
                    ) : chartMode === "valeur" ? (
                      globalHistoryLoading ? (
                        <div className="flex items-center justify-center h-44 gap-2">
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-t-blue-500 animate-spin" />
                          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Chargement…</span>
                        </div>
                      ) : globalPortfolioHistory.length > 1 ? (
                        <AreaChart data={globalPortfolioHistory} height={200} />
                      ) : (
                        <div className="flex items-center justify-center h-44">
                          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Historique indisponible pour cette période</p>
                        </div>
                      )
                    ) : (
                      <div className="relative">
                        {globalHistoryLoading && (
                          <div className="absolute top-1 right-1 flex items-center gap-1.5 z-10">
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                          </div>
                        )}
                        <BenchmarkChart
                          ticker="__portfolio__"
                          name="Mon Portefeuille"
                          portfolioData={globalPortfolioHistory.length > 1 ? globalPortfolioHistory : undefined}
                          portfolioReturnPct={totalPnlPct}
                          height={220}
                          period={period}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Allocation + Top Movers */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Allocation */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Répartition par classe</p>
                  <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                    {Object.entries(byClass).sort(([,a],[,b]) => b - a).map(([cls, val]) => {
                      const pct   = totalValue > 0 ? (val / totalValue) * 100 : 0
                      const color = ASSET_CLASS_COLORS[cls as AssetClass] ?? "#6b7280"
                      return (
                        <div key={cls} className="mb-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{ASSET_CLASS_LABELS[cls as AssetClass] ?? cls}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>{format(val)}</span>
                              <span className="text-xs font-semibold tabular-nums w-10 text-right" style={{ color: "var(--text-primary)" }}>{pct.toFixed(1)}%</span>
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
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Top movers du jour</p>
                  <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                    <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Meilleures performances</p>
                    </div>
                    {topGainers.length === 0 && (
                      <p className="px-4 py-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
                        Aucun actif en hausse aujourd'hui
                      </p>
                    )}
                    {topGainers.map((a, i) => {
                      const pct = liveEnriched[a.ticker]?.changePct ?? 0
                      const color = ASSET_CLASS_COLORS[a.assetClass]
                      return (
                        <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                          style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                          <AssetLink asset={a} className="flex flex-1 items-center gap-3 min-w-0">
                            <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>
                              {a.ticker.slice(0, 3)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{a.name}</p>
                              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{a.ticker}</p>
                            </div>
                          </AssetLink>
                          <div className="text-right">
                            <ChangeBadge value={pct} showIcon={false} />
                            {/* Le signe suit le montant : « + » seulement si gain
                                (on affichait « +-43.57 CHF » quand la valeur baissait). */}
                            {(() => {
                              const amount = (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity * pct / 100
                              return (
                                <p className="text-xs tabular-nums mt-0.5"
                                  style={{ color: amount >= 0 ? "var(--gain)" : "var(--loss)" }}>
                                  {amount > 0 ? "+" : ""}{format(amount)}
                                </p>
                              )
                            })()}
                          </div>
                        </div>
                      )
                    })}
                    <div className="px-4 py-2 border-t border-b" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Moins bonnes performances</p>
                    </div>
                    {topLosers.length === 0 && (
                      <p className="px-4 py-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
                        Aucun actif en baisse aujourd'hui
                      </p>
                    )}
                    {topLosers.map((a, i) => {
                      const pct = liveEnriched[a.ticker]?.changePct ?? 0
                      const color = ASSET_CLASS_COLORS[a.assetClass]
                      return (
                        <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                          style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                          <AssetLink asset={a} className="flex flex-1 items-center gap-3 min-w-0">
                            <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>
                              {a.ticker.slice(0, 3)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{a.name}</p>
                              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{a.ticker}</p>
                            </div>
                          </AssetLink>
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
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Résumé des portefeuilles</p>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="grid px-5 py-3 border-b text-[11px] font-medium uppercase tracking-wider"
                    style={{ borderColor: "var(--border)", color: "var(--text-tertiary)", gridTemplateColumns: "minmax(150px,1fr) 48px 110px 100px 90px 80px 90px" }}>
                    <span>Portefeuille</span>
                    <span className="text-center">Actifs</span>
                    <span className="text-right">Valeur</span>
                    <span className="text-right">P&L Jour</span>
                    <span className="text-right">P&L Total</span>
                    <span className="text-right">%</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {portfolios.map((p, i) => {
                    const metrics = portfolioMetricsById.get(p.id) ?? calculatePortfolioMetrics(metricAssetsFor(p.assets), {}, fxRates)
                    const ur  = (fxRates as Record<string,number>)[currency] ?? 1
                    const val = metrics.portfolioValueChf * ur
                    const pnl = metrics.totalPnlChf * ur
                    const pct = metrics.totalReturnPercent
                    const dayPnl = p.assets.reduce((s, a) => s + (liveEnriched[a.ticker]?.changePct ?? 0) * (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity / 100, 0)
                    const dayPct = val > 0 ? (dayPnl / val) * 100 : 0
                    const exp   = expandedRows.has(p.id)
                    return (
                      <div key={p.id} style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                        <div className="grid items-center px-5 py-3 hover:bg-zinc-800/20 transition-colors cursor-pointer"
                          style={{ gridTemplateColumns: "minmax(150px,1fr) 48px 110px 100px 90px 80px 90px" }}
                          onClick={() => setExpandedRows(s => { const n = new Set(s); exp ? n.delete(p.id) : n.add(p.id); return n })}>
                          <div className="flex items-center gap-3">
                            {exp ? <ChevronUp className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-tertiary)" }} />
                                 : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-tertiary)" }} />}
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</span>
                          </div>
                          <p className="text-center text-xs" style={{ color: "var(--text-secondary)" }}>{metrics.positionLineCount}</p>
                          <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{format(val)}</p>
                          <div className="flex justify-end"><ChangeBadge value={dayPct} showIcon={false} /></div>
                          <p className="text-right text-xs tabular-nums" style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>{pnl >= 0 ? "+" : ""}{format(pnl)}</p>
                          <div className="flex justify-end"><ChangeBadge value={pct} showIcon={false} /></div>
                          <div className="flex justify-end gap-1">
                            <button onClick={e => { e.stopPropagation(); setActiveTab(p.id) }}
                              className="rounded-md px-2 py-1 text-[11px] font-medium hover:bg-zinc-700 transition-colors"
                              style={{ color: "var(--text-tertiary)" }}>Voir</button>
                          </div>
                        </div>
                        {exp && (
                          <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
                            <HoldingsTable
                              portfolio={p}
                              livePrices={liveEnriched}
                              onDeleteAsset={id => handleDeleteAsset(p.id, id)}
                              onSellAsset={openSellModal}
                              onEditAsset={(a) => openEditModal(a)}
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
              {globalMetrics.positionLineCount > 0 && (
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

          {/* Vue agrégée sur mobile — même écran que pour un portefeuille,
              alimenté par le total. Sans cela, « Tous » retombait sur la mise
              en page bureau, illisible sur un écran étroit. */}
          {activeTab === "global" && isMobile && (() => {
            const ur = (fxRates as Record<string, number>)[currency] ?? 1
            const aggregate: Portfolio = {
              id: "global",
              name: "Tous les portefeuilles",
              description: "",
              color: "#6366f1",
              currency: "CHF",
              cashBalances: globalCash,
              createdAt: "",
              assets: portfolios.flatMap(p => p.assets),
            }
            return (
              <div className="-mx-4 -mt-4 sm:-mx-6">
                <MobilePortfolio
                  tabBarOffset={CHIP_BAR_HEIGHT}
                  aggregated
                  portfolio={aggregate}
                  history={mobileHistory}
                  historyLoading={mobileHistoryLoading}
                  period={mobilePeriod}
                  onPeriodChange={setMobilePeriod}
                  totalValue={globalMetrics.positionValueChf * ur}
                  investedValue={globalMetrics.investedChf * ur}
                  pnlValue={globalMetrics.totalPnlChf * ur}
                  pnlPct={globalMetrics.totalReturnPercent}
                  positionsCount={globalMetrics.positionLineCount}
                  livePrices={liveEnriched}
                  format={format}
                  currency={currency}
                  analytics={mobileAnalytics}
                  onAddTransaction={() => openTxModal()}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onImport={() => setShowPortfolioCreation(true)}
                  onExport={() => {}}
                  onSellAsset={openSellModal}
                />
              </div>
            )
          })()}

          {/* ═══════════════ INDIVIDUAL PORTFOLIO VIEW ═══════════════ */}
          {/* Sur mobile, le portefeuille devient une mini-application en
              quatre onglets : une page unique qui empile tout est illisible
              sur un écran étroit. La vue bureau reste inchangée. */}
          {activePortfolio && isMobile && (() => {
            const ur = (fxRates as Record<string, number>)[currency] ?? 1
            const m  = activePortfolioMetrics
              ?? calculatePortfolioMetrics(metricAssetsFor(activePortfolio.assets), {}, fxRates)
            const cashChf = balancesInChf(
              normalizeBalances(activePortfolio.cashBalances), fxRates as never
            )
            return (
              <div className="-mx-4 -mt-4 sm:-mx-6">
                <MobilePortfolio
                  tabBarOffset={CHIP_BAR_HEIGHT}
                  portfolio={activePortfolio}
                  history={mobileHistory}
                  historyLoading={mobileHistoryLoading}
                  period={mobilePeriod}
                  onPeriodChange={setMobilePeriod}
                  totalValue={m.portfolioValueChf * ur}
                  investedValue={m.investedChf * ur}
                  pnlValue={m.totalPnlChf * ur}
                  pnlPct={m.totalReturnPercent}
                  positionsCount={m.positionLineCount}
                  livePrices={liveEnriched}
                  format={format}
                  currency={currency}
                  analytics={mobileAnalytics}
                  onAddTransaction={() => openTxModal(activePortfolio.id)}
                  onEdit={() => setEditPortfolioNotice(true)}
                  onDelete={() => setDeletePortfolioConfirm(activePortfolio.id)}
                  onImport={() => setShowPortfolioCreation(true)}
                  onExport={() => exportPortfolioCsv(activePortfolio)}
                  onSellAsset={openSellModal}
                />
              </div>
            )
          })()}

          {activePortfolio && !isMobile && (
            <>
              {/* Portfolio header */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: activePortfolio.color + "22" }}>
                    <Briefcase className="h-6 w-6" style={{ color: activePortfolio.color }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{activePortfolio.name}</h2>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activePortfolio.color }} />
                    </div>
                    {activePortfolio.description && (
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{activePortfolio.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {(() => {
                    const metrics = activePortfolioMetrics ?? calculatePortfolioMetrics(metricAssetsFor(activePortfolio.assets), {}, fxRates)
                    const ur2  = (fxRates as Record<string,number>)[currency] ?? 1
                    const val  = metrics.portfolioValueChf * ur2
                    const pnlLatent  = metrics.totalPnlChf * ur2
                    const pnlRealized = transactions
                      .filter(t => t.portfolioId === activePortfolio.id && t.type === "sell")
                      .reduce((s,t) => s + ((t.realizedPnlChf ?? 0) * ur2), 0)
                    const pnlTotal = pnlLatent + pnlRealized
                    // Dénominateur = ALL historical capital invested (sum of all buy transactions)
                    // This is the total amount deployed, including positions already sold
                    // NOM: "Rendement sur capital cumulé investi" (not TWR, not broker return)
                    const historicalCapitalInvestedChf = transactions
                      .filter(t => t.portfolioId === activePortfolio.id && t.type === "buy")
                      .reduce((s, t) => s + (t.netAmountChf ?? 0), 0)
                    // Formula: (P&L latent + P&L réalisé) / capital cumulé × 100
                    const rendementCapitalCumulePct = historicalCapitalInvestedChf > 0
                      ? (pnlTotal / historicalCapitalInvestedChf) * 100
                      : 0
                    // Rendement latent = P&L non-réalisé seulement
                    const rendementLatentPct = historicalCapitalInvestedChf > 0
                      ? (pnlLatent / historicalCapitalInvestedChf) * 100
                      : 0
                    return (
                      <>
                        <div className="text-right">
                          <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{format(val)}</p>
                          <div className="flex flex-col gap-1 justify-end text-[11px]">
                            {/* P&L latent (unrealized) */}
                            <div className="flex items-center gap-2 justify-end">
                              <span style={{ color: "var(--text-tertiary)" }}>latent:</span>
                              <span className="tabular-nums font-semibold" style={{ color: pnlLatent >= 0 ? "#22c55e" : "#ef4444" }}>
                                {pnlLatent >= 0 ? "+" : ""}{format(pnlLatent)}
                              </span>
                              {historicalCapitalInvestedChf > 0 && (
                                <span className="text-[10px]" style={{ color: pnlLatent >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {rendementLatentPct >= 0 ? "+" : ""}{rendementLatentPct.toFixed(2)}%
                                </span>
                              )}
                            </div>
                            {/* P&L realized (from sales) */}
                            {pnlRealized !== 0 && (
                              <div className="flex items-center gap-2 justify-end">
                                <span style={{ color: "var(--text-tertiary)" }}>réalisé:</span>
                                <span className="tabular-nums font-semibold" style={{ color: pnlRealized >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {pnlRealized >= 0 ? "+" : ""}{format(pnlRealized)}
                                </span>
                              </div>
                            )}
                            {/* P&L total = latent + realized */}
                            <div className="flex items-center gap-2 justify-end pt-1 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                              <span style={{ color: "var(--text-secondary)" }}>total:</span>
                              <span className="tabular-nums font-bold" style={{ color: pnlTotal >= 0 ? "#22c55e" : "#ef4444" }}>
                                {pnlTotal >= 0 ? "+" : ""}{format(pnlTotal)}
                              </span>
                              {historicalCapitalInvestedChf > 0 && (
                                <span className="text-[10px] font-bold" style={{ color: pnlTotal >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {rendementCapitalCumulePct >= 0 ? "+" : ""}{rendementCapitalCumulePct.toFixed(2)}%
                                </span>
                              )}
                            </div>
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

              {/* Dual-mode chart: Valeur / Performance */}
              <div>
                {/* Dual-mode chart: Valeur / Performance */}
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                    <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
                      {([["valeur", "Valeur"], ["performance", "Performance"]] as const).map(([mode, label]) => (
                        <button key={mode} onClick={() => setChartMode(mode)}
                          className="rounded-md px-3 py-1 text-xs font-medium transition-all"
                          style={{
                            backgroundColor: chartMode === mode ? "var(--accent)" : "transparent",
                            color: chartMode === mode ? "white" : "var(--text-tertiary)",
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-0.5">
                      {PERIODS.map(p => (
                        <button key={p} onClick={() => setPeriod(p)}
                          className="rounded-md px-2 py-1 text-xs font-medium transition-all"
                          style={{
                            backgroundColor: period === p ? "var(--bg-subtle)" : "transparent",
                            color: period === p ? "var(--text-primary)" : "var(--text-tertiary)",
                          }}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-2 border-b flex items-center gap-2" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-overlay)" }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: activeHistoryLoading ? "var(--text-tertiary)" : "#22c55e" }} />
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {chartMode === "valeur"
                        ? "Valeur des positions · hors dépôts/retraits · prix Yahoo Finance"
                        : "Base 100 = début de période · cashflows exclus · benchmarks en pointillés"}
                    </span>
                  </div>
                  <div className="p-4">
                    {chartMode === "valeur" ? (
                      activeHistoryLoading ? (
                        <div className="flex items-center justify-center h-44 gap-2">
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-t-blue-500 animate-spin" />
                          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Chargement…</span>
                        </div>
                      ) : activePortfolioHistory.length > 1 ? (
                        <AreaChart data={activePortfolioHistory} height={200} />
                      ) : (
                        <div className="flex items-center justify-center h-44">
                          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Historique indisponible pour cette période</p>
                        </div>
                      )
                    ) : (
                      <div className="relative">
                        {activeHistoryLoading && (
                          <div className="absolute top-1 right-1 z-10">
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                          </div>
                        )}
                        <BenchmarkChart
                          ticker="__portfolio__"
                          name={activePortfolio.name}
                          portfolioData={activePortfolioHistory.length > 1 ? activePortfolioHistory : undefined}
                          portfolioReturnPct={activePortfolioMetrics?.totalReturnPercent ?? 0}
                          height={220}
                          period={period}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Détail du calcul ── */}
              {(() => {
                const m = activePortfolioMetrics
                if (!m) return null
                const ur = (fxRates as Record<string,number>)[currency] ?? 1
                const costUser     = m.investedChf * ur
                const valueUser    = m.positionValueChf * ur
                const pnlUser      = m.totalPnlChf * ur
                const cashUser     = m.cashChf * ur
                const feesUser     = transactions
                  .filter(t => t.portfolioId === activePortfolio.id)
                  .reduce((s,t) => s + ((t.feesChf ?? 0) * ur), 0)
                const feesBuyUser  = transactions
                  .filter(t => t.portfolioId === activePortfolio.id && t.type === "buy")
                  .reduce((s,t) => s + ((t.feesChf ?? 0) * ur), 0)
                const feesSellUser = transactions
                  .filter(t => t.portfolioId === activePortfolio.id && t.type === "sell")
                  .reduce((s,t) => s + ((t.feesChf ?? 0) * ur), 0)
                const divUser = transactions
                  .filter(t => t.portfolioId === activePortfolio.id && t.type === "dividend")
                  .reduce((s,t) => s + ((t.netAmountChf ?? 0) * ur), 0)
                const revUser = revenus
                  .filter(r => !r.portfolioId || r.portfolioId === activePortfolio.id)
                  .reduce((s,r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0)
                // RealizedPnLEvent n'a pas portfolioId — filtrer via transactions SELL du portfolio
                const realPnlUser = transactions
                  .filter(t => t.portfolioId === activePortfolio.id && t.type === "sell")
                  .reduce((s,t) => s + ((t.realizedPnlChf ?? 0) * ur), 0)
                const fxLine = Object.entries(fxRates as Record<string,number>)
                  .filter(([k]) => k !== "CHF")
                  .map(([k,v]) => `1 CHF = ${v.toFixed(4)} ${k}`)
                  .join(" · ")

                return (
                  <details className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 select-none hover:bg-zinc-800/40 transition-colors list-none"
                      style={{ backgroundColor: "var(--bg-elevated)" }}>
                      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Comprendre ces chiffres</span>
                      <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>afficher le détail des formules</span>
                    </summary>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-zinc-800" style={{ backgroundColor: "var(--border)" }}>
                      {[
                        { label: "Capital investi historique", value: format(costUser), note: "Coût d'achat CHF au taux du jour d'achat", color: "var(--text-primary)" },
                        { label: "Valeur actuelle positions", value: format(valueUser), note: "Prix Yahoo Finance × quantité", color: "var(--text-primary)" },
                        { label: "P&L marché (latent)", value: (pnlUser >= 0 ? "+" : "") + format(pnlUser) + "  /  " + (m.totalReturnPercent >= 0 ? "+" : "") + m.totalReturnPercent.toFixed(2) + "%", note: "Valeur − coût historique", color: pnlUser >= 0 ? "var(--gain)" : "var(--loss)" },
                        { label: "P&L réalisé (ventes)", value: (realPnlUser >= 0 ? "+" : "") + format(realPnlUser), note: "Gains/pertes sur ventes clôturées", color: realPnlUser >= 0 ? "var(--gain)" : "var(--loss)" },
                        { label: "Dividendes encaissés", value: "+" + format(divUser), note: "Transactions type dividende", color: "#22c55e" },
                        { label: "Revenus annexes", value: "+" + format(revUser), note: "Parrainage, cashback, bonus…", color: "#a855f7" },
                        { label: "Frais totaux payés", value: "−" + format(feesUser), note: `Achat: −${format(feesBuyUser)}  ·  Vente: −${format(feesSellUser)}  ·  Inclus dans P&L réalisé et P&L latent`, color: "#f59e0b" },
                        { label: "Taux FX (BCE)", value: fxLine || "CHF uniquement", note: "Source: Banque Centrale Européenne", color: "var(--text-secondary)" },
                        { label: "Source des prix", value: "Yahoo Finance", note: "Délai possible 15 min — différent du broker", color: "var(--text-tertiary)" },
                        { label: "Écart broker possible", value: "±0.5–2%", note: "FX broker ≠ FX BCE · prix temps réel ≠ Yahoo", color: "#f59e0b" },
                      ].map(row => (
                        <div key={row.label} className="flex flex-col gap-0.5 px-4 py-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
                          <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{row.label}</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: row.color }}>{row.value}</span>
                          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{row.note}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })()}

              {/* Holdings table (sortable) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Positions — {activePortfolioMetrics?.positionLineCount ?? 0} ligne{(activePortfolioMetrics?.positionLineCount ?? 0) !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Cliquer sur une colonne pour trier
                  </p>
                </div>
                <HoldingsTable
                  portfolio={activePortfolio}
                  livePrices={liveEnriched}
                  onDeleteAsset={id => handleDeleteAsset(activePortfolio.id, id)}
                  onSellAsset={openSellModal}
                  onEditAsset={(a) => openEditModal(a)}
                  totalValue={(activePortfolioMetrics?.positionValueChf ?? 0) * ((fxRates as Record<string,number>)[currency] ?? 1)}
                />
              </div>

              {/* Add asset search bar */}
              <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", borderStyle: "dashed" }}>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Ajouter un actif</p>
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
            initial={txModal.initial ?? {
              portfolioId: txModal.defaultPortfolioId ?? portfolios[0]?.id ?? "",
              ticker: "", assetName: "", assetClass: "stock",
              selectedClass: "stock" as const,
              type: "buy", quantity: "", price: "", nativeCurrency: "CHF", fees: "1",
              date: new Date().toISOString().slice(0, 10), notes: "",
            }}
            portfolios={portfolios}
            onSave={handleSaveTx}
            onClose={() => setTxModal(null)}
          />
        )}
      </AnimatePresence>

      {/* ─── Edit Asset Modal (Modifier la position) — formulaire complet ─── */}
      <AnimatePresence>
        {editAssetModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-10"
            style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
            onClick={() => setEditAssetModal(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border overflow-hidden mb-8"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    ✏️ Modifier — {editAssetModal.asset.ticker}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    {editAssetModal.asset.name} · Correction directe de la position
                  </p>
                </div>
                <button onClick={() => setEditAssetModal(null)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                  <X className="h-4 w-4 text-zinc-500" />
                </button>
              </div>

              {/* Form */}
              <div className="px-5 py-5 space-y-4">

                {/* Quantité + Prix moyen */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Quantité *
                    </label>
                    <input type="number" step="any" placeholder="0"
                      value={editAssetModal.qty}
                      onChange={e => setEditAssetModal(prev => prev ? { ...prev, qty: e.target.value } : null)}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                      autoFocus />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Prix moyen *
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                        ({editAssetModal.currency})
                      </span>
                    </label>
                    <input type="number" step="any" placeholder="0.00"
                      value={editAssetModal.avgPrice}
                      onChange={e => setEditAssetModal(prev => prev ? { ...prev, avgPrice: e.target.value } : null)}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                  </div>
                </div>

                {/* Frais + Devise */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Frais
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>inclus dans le prix moyen</span>
                    </label>
                    <input type="number" step="any" placeholder="0.00"
                      value={editAssetModal.fees}
                      onChange={e => setEditAssetModal(prev => prev ? { ...prev, fees: e.target.value } : null)}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Devise</label>
                    <div className="flex gap-1.5">
                      {(["CHF","USD","EUR"] as const).map(c => (
                        <button key={c} onClick={() => setEditAssetModal(prev => prev ? { ...prev, currency: c } : null)}
                          className="flex-1 rounded-lg border py-2.5 text-xs font-semibold transition-all"
                          style={{
                            backgroundColor: editAssetModal.currency === c ? "#6366f118" : "var(--bg-base)",
                            borderColor:     editAssetModal.currency === c ? "var(--accent)" : "var(--border)",
                            color:           editAssetModal.currency === c ? "var(--accent)" : "var(--text-secondary)",
                          }}>{c}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Date */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Date de référence
                  </label>
                  <input type="date" value={editAssetModal.date}
                    onChange={e => setEditAssetModal(prev => prev ? { ...prev, date: e.target.value } : null)}
                    className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)", colorScheme: "dark" }} />
                </div>

                {/* Notes */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Notes (optionnel)</label>
                  <input type="text" placeholder="Ex: correction import CSV…"
                    value={editAssetModal.notes}
                    onChange={e => setEditAssetModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
                    className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                </div>

                {/* Aperçu coût total auto */}
                {(() => {
                  const qty = parseFloat(editAssetModal.qty)
                  const avg = parseFloat(editAssetModal.avgPrice)
                  if (!qty || !avg) return null
                  return (
                    <div className="rounded-xl border px-4 py-3 flex items-center justify-between"
                      style={{ backgroundColor: "#6366f108", borderColor: "#6366f130" }}>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Coût total ({editAssetModal.currency})</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--accent)" }}>
                        {(qty * avg).toFixed(2)} {editAssetModal.currency}
                      </span>
                    </div>
                  )
                })()}
              </div>

              {/* Footer */}
              <div className="flex gap-3 px-5 pb-5">
                <button
                  onClick={async () => {
                    const qty = parseFloat(editAssetModal.qty)
                    const avg = parseFloat(editAssetModal.avgPrice)
                    if (!qty || qty <= 0 || !avg || avg <= 0) return
                    await doEditAsset(editAssetModal.asset.portfolioId, editAssetModal.asset.id, qty, avg)
                    setEditAssetModal(null)
                  }}
                  disabled={!parseFloat(editAssetModal.qty) || !parseFloat(editAssetModal.avgPrice)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}>
                  ✓ Enregistrer les modifications
                </button>
                <button onClick={() => setEditAssetModal(null)}
                  className="rounded-xl border px-5 py-3 text-sm font-medium hover:bg-zinc-800 transition-colors"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  Annuler
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Delete asset confirmation modal ─── */}
      <AnimatePresence>
        {deleteConfirm && (() => {
          const asset = activePortfolio?.assets.find(a => a.id === deleteConfirm.assetId)
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
              onClick={() => setDeleteConfirm(null)}>
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-sm rounded-2xl border overflow-hidden"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Supprimer la position</h3>
                  <button onClick={() => setDeleteConfirm(null)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                    <X className="h-4 w-4 text-zinc-500" />
                  </button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    Êtes-vous sûr de vouloir supprimer la position <strong>{asset?.name}</strong> ({asset?.ticker})?
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    ⚠️ Cette action supprimera la position entière de votre portefeuille. Les transactions historiques restent intactes.
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setDeleteConfirm(null)}
                      className="flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)", backgroundColor: "var(--bg-base)" }}>
                      Annuler
                    </button>
                    <button onClick={confirmDeleteAsset}
                      className="flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                      style={{ backgroundColor: "#ef4444" }}>
                      Supprimer
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* ─── Delete portfolio confirmation modal ─── */}
      <AnimatePresence>
        {deletePortfolioConfirm && (() => {
          const portfolio = portfolios.find(p => p.id === deletePortfolioConfirm)
          const txCount = transactions.filter(t => t.portfolioId === deletePortfolioConfirm).length
          const assetCount = portfolio?.assets.length ?? 0
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
              onClick={() => setDeletePortfolioConfirm(null)}>
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md rounded-2xl border overflow-hidden"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold text-red-400">Supprimer le portefeuille définitivement</h3>
                  <button onClick={() => setDeletePortfolioConfirm(null)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                    <X className="h-4 w-4 text-zinc-500" />
                  </button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {portfolio?.name}
                    </p>
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      Cette action supprimera définitivement le portefeuille et toutes ses données associées:
                    </p>
                    <ul className="text-xs space-y-1 ml-4" style={{ color: "var(--text-tertiary)" }}>
                      <li>• {assetCount} position{assetCount !== 1 ? 's' : ''} / actif{assetCount !== 1 ? 's' : ''}</li>
                      <li>• {txCount} transaction{txCount !== 1 ? 's' : ''} (achats, ventes, dividendes)</li>
                      <li>• Tous les P&L latent et réalisé de ce portefeuille</li>
                      <li>• Tous les graphiques et statistiques associés</li>
                    </ul>
                    <p className="text-xs font-semibold text-red-400 mt-3">
                      ⚠️ Cette action est irréversible. Les données supprimées ne peuvent pas être récupérées.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setDeletePortfolioConfirm(null)}
                      className="flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)", backgroundColor: "var(--bg-base)" }}>
                      Annuler
                    </button>
                    <button onClick={confirmDeletePortfolio}
                      className="flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                      style={{ backgroundColor: "#ef4444" }}>
                      Supprimer définitivement
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* ─── Portfolio Creation Modal (Manual + CSV Import) ─── */}
      <PortfolioCreationModal
        open={showPortfolioCreation}
        onClose={() => setShowPortfolioCreation(false)}
        onCreateManual={handleAddPortfolioManual}
        onCreateWithImport={handleAddPortfolioWithImport}
      />

      {/* Renommer/modifier un portefeuille n'est pas encore implémenté côté
          données : on le dit au lieu d'afficher un formulaire sans effet. */}
      {editPortfolioNotice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          onClick={() => setEditPortfolioNotice(false)}>
          <div className="w-full rounded-t-2xl border-t p-5 pb-8 sm:max-w-sm sm:rounded-2xl sm:border"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Modification indisponible
            </p>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Renommer un portefeuille ou changer sa couleur n&apos;est pas encore possible :
              l&apos;application ne sait pas mettre à jour un portefeuille existant. Tu peux en
              créer un nouveau et y réimporter ton relevé.
            </p>
            <button onClick={() => setEditPortfolioNotice(false)}
              className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--accent, #6366f1)" }}>
              Compris
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
