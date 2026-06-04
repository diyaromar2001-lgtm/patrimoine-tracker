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
import { AreaChart } from "@/components/charts/area-chart"
import { useLivePrices } from "@/hooks/use-live-prices"
import { usePortfolioHistory } from "@/hooks/use-portfolio-history"
import type { PortfolioAsset } from "@/app/api/portfolio-history/route"
import { useCurrency } from "@/hooks/use-currency"
import type { SearchResult } from "@/hooks/use-asset-search"
import { useAppData } from "@/hooks/use-app-data"
import type { Portfolio, Asset, AssetClass } from "@/lib/types"
import {
  ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from "@/lib/types"
import { benchmarkAlpha, calculatePortfolioMetrics, type PortfolioMetrics } from "@/lib/finance"
import { formatCurrency, cn } from "@/lib/utils"
import type { AppCurrency } from "@/lib/utils"
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
    return [...portfolio.assets].sort((a, b) => {
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
  }, [portfolio.assets, sortKey, sortDir, livePrices, fxRates])

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
                {/* Icon */}
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
                      {asset.quantity} ×
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

        // Montant P&L : valueCHF vs costCHF en devise de base (CHF)
        const valueCHF = origPrice != null
          ? origPrice * asset.quantity / rateToChf
          : livePriceUserCurr * asset.quantity

        // costCHF : costBasisChf (taux historique) si valide, sinon taux actuel
        const legacyCostCHF = nativeAvg * asset.quantity / rateToChf
        const costCHFRaw    = asset.costBasisChf
        const isCorrupted   = costCHFRaw != null && Math.abs(costCHFRaw / (nativeAvg * asset.quantity) - 1.0) < 0.03
        const hasValidCost  = costCHFRaw != null && costCHFRaw > 0 && !isCorrupted
        const costCHF       = hasValidCost ? costCHFRaw! : legacyCostCHF

        const userRate    = ((fxRates as Record<string,number>)[currency] ?? 1)
        const pnlUserCurr = (valueCHF - costCHF) * userRate

        // P&L % :
        //   Si costBasisChf valide → % en CHF (correspond au broker : inclut effet FX)
        //   Sinon → % natif native/native (currency-independent)
        const pnlPct = hasValidCost
          ? (costCHF > 0 ? ((valueCHF - costCHF) / costCHF) * 100 : 0)
          : (origPrice != null && nativeAvg > 0
              ? ((origPrice - nativeAvg) / nativeAvg) * 100
              : 0)

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
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: color + "22", color }}>
                  {asset.ticker.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{asset.name}</p>
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
              </div>
              {/* Qty — centred, bold */}
              <p className="text-center text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {asset.quantity}
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
  } = useAppData()
  // setPortfolios not available in AppData — mutations are reflected automatically
  const setPortfolios = (_: unknown) => {} // noop placeholder
  const [activeTab, setActiveTab] = useState("global")
  const [txModal, setTxModal]     = useState<{ defaultPortfolioId?: string; initial?: TransactionFormData } | null>(null)

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
    costBasisChf: string   // CHF réel payé (taux historique) — override le calcul
  } | null>(null)

  function openEditModal(asset: Asset) {
    const lastBuy = [...transactions]
      .filter(t => t.portfolioId === asset.portfolioId && t.ticker === asset.ticker && t.type === "buy")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    // Pré-rempli avec costBasisChf existant (le vrai CHF historique si disponible)
    const existingCostChf = asset.costBasisChf
    const nativeTotal = asset.quantity * asset.avgBuyPrice
    const isCorrupted = existingCostChf != null && Math.abs(existingCostChf / nativeTotal - 1.0) < 0.03
    setEditAssetModal({
      asset,
      qty:          String(asset.quantity),
      avgPrice:     String(Number(asset.avgBuyPrice).toFixed(4)),
      fees:         String(lastBuy?.fees ?? 0),
      currency:     asset.currency ?? "CHF",
      date:         lastBuy?.date ?? new Date().toISOString().slice(0, 10),
      notes:        "",
      costBasisChf: (!isCorrupted && existingCostChf && existingCostChf > 0)
        ? String(existingCostChf.toFixed(2))
        : "",
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
    // ── Dépôt de liquidité globale ───────────────────────────────────────────
    // La liquidité est globale : elle va dans le 1er portefeuille
    // mais l'affichage agrège tous les portefeuilles (poche commune).
    if (form.selectedClass === "cash" || form.type === "deposit") {
      const amount   = parseFloat(form.depositAmount || "0")
      const currency = (form.depositCurrency || "CHF") as "CHF" | "USD" | "EUR"
      if (!amount || amount <= 0) throw new Error("Montant invalide")
      // Utilise le 1er portefeuille comme réservoir de cash global
      const globalPid = portfolios[0]?.id
      if (!globalPid) throw new Error("Aucun portefeuille disponible")
      await depositCash(globalPid, amount, currency)
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
  const [chartMode,  setChartMode]  = useState<"valeur" | "performance">("valeur")
  const [showNewPortfolio, setShowNewPortfolio] = useState(false)
  const [newName,    setNewName]    = useState("")
  const [newDesc,    setNewDesc]    = useState("")
  const [newColor,   setNewColor]   = useState("#3b82f6")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const allTickers = portfolios.flatMap(p => p.assets.filter(a => a.assetClass !== "cash").map(a => a.ticker))
  const { prices: livePrices } = useLivePrices(allTickers, 30_000)

  // Enrich prices — include original currency for dual display
  const liveEnriched = useMemo(() => {
    const out: Record<string, { price: number; changePct: number; originalPrice?: number; originalCurrency?: string }> = {}
    for (const [t, p] of Object.entries(livePrices)) {
      out[t] = { price: p.price, changePct: p.changePct, originalPrice: p.originalPrice, originalCurrency: p.originalCurrency }
    }
    return out
  }, [livePrices])

  const metricAssetsFor = useCallback((assets: Asset[]) => assets
    .filter(a => a.assetClass !== "cash")
    .map(a => ({
      ticker: a.ticker,
      quantity: a.quantity,
      currentPriceNative: liveEnriched[a.ticker]?.originalPrice ?? a.currentPrice,
      nativeCurrency: liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "CHF",
      costBasisChf: a.costBasisChf,
      assetClass: a.assetClass,
    })), [liveEnriched])

    // Liquidité globale — depuis AppData.globalCash (source unique, indépendante des portfolios)
  const globalCashBalances = useMemo(() => ({
    CHF: globalCash.CHF, USD: globalCash.USD, EUR: globalCash.EUR
  }), [globalCash])

  const portfolioMetricsById = useMemo(() => {
    const metrics = new Map<string, PortfolioMetrics>()
    // Les portfolios n'ont plus de cash propre — on passe {} (vide)
    portfolios.forEach(p => {
      metrics.set(p.id, calculatePortfolioMetrics(metricAssetsFor(p.assets), {}, fxRates))
    })
    return metrics
  }, [portfolios, metricAssetsFor, fxRates])

  const globalMetrics = useMemo(() =>
    calculatePortfolioMetrics(metricAssetsFor(portfolios.flatMap(p => p.assets)), globalCashBalances, fxRates),
    [portfolios, metricAssetsFor, globalCashBalances, fxRates]
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
  const topGainers = moversData.slice(0, 3)
  const topLosers  = [...moversData].reverse().slice(0, 3)

  // Asset allocation by class
  const byClass = allAssetsEnriched.reduce<Record<string, number>>((acc, a) => {
    acc[a.assetClass] = (acc[a.assetClass] ?? 0) + a.quantity * a.currentPrice
    return acc
  }, {})
  if (globalMetrics.cashChf > 0) {
    byClass.cash = (byClass.cash ?? 0) + globalMetrics.cashChf * userRate
  }

  // Annual dividends (simplified)
  // Dividendes annuels calculés depuis les positions réelles (via useLiveDividends en production)
  // Pour l'instant : 0 si aucune position, sinon approximation from asset class
  const annualDivs = 0  // TODO: hook useLiveDividends → lib/finance.ts totalAnnualDividend()

  // Best/worst
  const best  = moversData[0]
  const worst = moversData[moversData.length - 1]

  async function handleAddPortfolio() {
    if (!newName.trim()) return
    const id = await dbAddPortfolio({
      name: newName.trim(), description: newDesc.trim(),
      color: newColor, currency: "CHF", cashBalances: { CHF: 0, USD: 0, EUR: 0 }, createdAt: new Date().toISOString().slice(0, 10),
    })
    if (id) setActiveTab(id)
    setNewName(""); setNewDesc(""); setShowNewPortfolio(false)
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

  function handleDeleteAsset(portfolioId: string, assetId: string) {
    dbRemoveAsset(portfolioId, assetId)
  }

  function handleDeletePortfolio(id: string) {
    dbRemovePortfolio(id)
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
      .filter(a => a.assetClass !== "cash")
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
        .filter(a => a.assetClass !== "cash")
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

  return (
    <div className="flex flex-col">
      <Topbar title="Portefeuilles" subtitle={`${portfolios.length} portefeuilles · ${format(totalValue)}`} />

      {/* ─── Tab bar ─── */}
      <div className="border-b overflow-x-auto" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-base)" }}>
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
                    {/* Liquidité globale — depuis globalCash (source unique) */}
                    {(() => {
                      const nonZero = Object.entries(globalCash).filter(([, v]) => (v as number) > 0)
                      if (!nonZero.length) return null
                      return (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {nonZero.map(([cur, val]) => (
                            <span key={cur}
                              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums"
                              style={{ backgroundColor: "#0ea5e918", color: "#0ea5e9", border: "1px solid #0ea5e930" }}>
                              💵 {(val as number).toFixed(2)} {cur} en liquidité
                            </span>
                          ))}
                        </div>
                      )
                    })()}
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
                      { label: "Lignes", value: String(globalMetrics.positionLineCount), sub: `${globalMetrics.uniqueAssetCount} uniques`, color: "#3b82f6" },
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
                        { k: "Bêta (SPY)", v: "~0.92", c: "var(--text-primary)" },
                        { k: "Volatilité", v: "~14.2%", c: "var(--text-primary)" },
                        { k: "Sharpe",     v: "~1.18",  c: "var(--text-primary)" },
                      ],
                    },
                    {
                      icon: BarChart2, iconColor: "#f59e0b", label: "Revenus",
                      rows: [
                        { k: "Dividendes / an", v: format(annualDivs), c: "#22c55e" },
                        { k: "Yield on cost", v: totalCost > 0 ? ((annualDivs / totalCost) * 100).toFixed(2) + "%" : "—", c: "var(--text-primary)" },
                        { k: "Liquidités", v: format(globalMetrics.cashChf * userRate), c: "#0ea5e9" },
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
                      <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Meilleures performances</p>
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
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{a.name}</p>
                            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{a.ticker}</p>
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
                      <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Moins bonnes performances</p>
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
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{a.name}</p>
                            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{a.ticker}</p>
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
                      <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{activePortfolio.name}</h2>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activePortfolio.color }} />
                    </div>
                    {activePortfolio.description && (
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{activePortfolio.description}</p>
                    )}
                    {/* ── Liquidité globale (commune à tous les portfolios) ── */}
                    {(() => {
                      const nonZero = Object.entries(globalCash).filter(([, v]) => (v as number) > 0)
                      if (!nonZero.length) return (
                        <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
                          💵 Aucune liquidité — déposez du cash pour acheter
                        </p>
                      )
                      return (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {nonZero.map(([cur, val]) => (
                            <span key={cur}
                              className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                              style={{ backgroundColor: "#0ea5e918", color: "#0ea5e9", border: "1px solid #0ea5e930" }}>
                              💵 {(val as number).toFixed(2)} {cur} disponible
                            </span>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {(() => {
                    const metrics = activePortfolioMetrics ?? calculatePortfolioMetrics(metricAssetsFor(activePortfolio.assets), {}, fxRates)
                    const ur2  = (fxRates as Record<string,number>)[currency] ?? 1
                    const val  = metrics.portfolioValueChf * ur2
                    const pnl  = metrics.totalPnlChf * ur2
                    const pct  = metrics.totalReturnPercent
                    return (
                      <>
                        <div className="text-right">
                          <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{format(val)}</p>
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
                    <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-wide select-none hover:bg-zinc-800/40 transition-colors"
                      style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-elevated)" }}>
                      <span>🔍 Détail du calcul</span>
                      <span style={{ color: "var(--text-tertiary)" }}>cliquer pour afficher / masquer</span>
                    </summary>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-zinc-800" style={{ backgroundColor: "var(--border)" }}>
                      {[
                        { label: "Capital investi historique", value: format(costUser), note: "Coût d'achat CHF au taux du jour d'achat", color: "var(--text-primary)" },
                        { label: "Valeur actuelle positions", value: format(valueUser), note: "Prix Yahoo Finance × quantité", color: "var(--text-primary)" },
                        { label: "P&L marché (latent)", value: (pnlUser >= 0 ? "+" : "") + format(pnlUser) + "  /  " + (m.totalReturnPercent >= 0 ? "+" : "") + m.totalReturnPercent.toFixed(2) + "%", note: "Valeur − coût historique", color: pnlUser >= 0 ? "var(--gain)" : "var(--loss)" },
                        { label: "P&L réalisé (ventes)", value: (realPnlUser >= 0 ? "+" : "") + format(realPnlUser), note: "Gains/pertes sur ventes clôturées", color: realPnlUser >= 0 ? "var(--gain)" : "var(--loss)" },
                        { label: "Liquidités (cash)", value: format(cashUser), note: "Cash disponible dans ce portefeuille", color: "#0ea5e9" },
                        { label: "Dividendes encaissés", value: "+" + format(divUser), note: "Transactions type dividende", color: "#22c55e" },
                        { label: "Revenus annexes", value: "+" + format(revUser), note: "Parrainage, cashback, bonus…", color: "#a855f7" },
                        { label: "Frais totaux payés", value: "−" + format(feesUser), note: `Achat: −${format(feesBuyUser)}  ·  Vente: −${format(feesSellUser)}  ·  Inclus dans P&L réalisé et P&L latent`, color: "#f59e0b" },
                        { label: "Taux FX (BCE)", value: fxLine || "CHF uniquement", note: "Source: Banque Centrale Européenne", color: "var(--text-secondary)" },
                        { label: "Source des prix", value: "Yahoo Finance", note: "Délai possible 15 min — différent du broker", color: "var(--text-tertiary)" },
                        { label: "Écart broker possible", value: "±0.5–2%", note: "FX broker ≠ FX BCE · prix temps réel ≠ Yahoo", color: "#f59e0b" },
                        { label: "Patrimoine total portfolio", value: format(valueUser + cashUser), note: "Positions + liquidités propres", color: "var(--accent)" },
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

                {/* Coût CHF historique — override pour correspondre au broker */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Coût total réel en CHF
                    <span className="ml-2 text-[10px]" style={{ color: "#0ea5e9" }}>
                      ← pour correspondre à ton broker (Trading212, IBKR…)
                    </span>
                  </label>
                  <input type="number" step="any" placeholder={`Ex: ${(parseFloat(editAssetModal.avgPrice || "0") * parseFloat(editAssetModal.qty || "0") * 0.93).toFixed(2)} CHF`}
                    value={editAssetModal.costBasisChf}
                    onChange={e => setEditAssetModal(prev => prev ? { ...prev, costBasisChf: e.target.value } : null)}
                    className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: editAssetModal.costBasisChf ? "#0ea5e9" : "var(--border)", color: "var(--text-primary)" }} />
                  <p className="mt-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    Laisse vide = calcul automatique. Remplis si ton broker affiche un coût CHF différent.
                  </p>
                </div>

                {/* Aperçu coût */}
                {(() => {
                  const qty = parseFloat(editAssetModal.qty)
                  const avg = parseFloat(editAssetModal.avgPrice)
                  const chfOverride = parseFloat(editAssetModal.costBasisChf || "0")
                  if (!qty || !avg) return null
                  const displayed = chfOverride > 0 ? chfOverride : qty * avg
                  return (
                    <div className="rounded-xl border px-4 py-3 flex items-center justify-between"
                      style={{ backgroundColor: chfOverride > 0 ? "#0ea5e908" : "#6366f108", borderColor: chfOverride > 0 ? "#0ea5e930" : "#6366f130" }}>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {chfOverride > 0 ? "Coût CHF (broker)" : "Coût calculé (auto)"}
                      </span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: chfOverride > 0 ? "#0ea5e9" : "var(--accent)" }}>
                        {displayed.toFixed(2)} CHF
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
                    // Si l'utilisateur a renseigné le coût CHF broker → on l'utilise
                    const chfOverride = parseFloat(editAssetModal.costBasisChf || "0")
                    const costBasisToSave = chfOverride > 0 ? chfOverride : undefined
                    await doEditAsset(editAssetModal.asset.portfolioId, editAssetModal.asset.id, qty, avg, costBasisToSave)
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

      {/* ─── New portfolio modal ─── */}
      <AnimatePresence>
        {showNewPortfolio && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
            onClick={() => setShowNewPortfolio(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border p-6"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Nouveau portefeuille</h3>
                <button onClick={() => setShowNewPortfolio(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                  <X className="h-4 w-4 text-zinc-500" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nom *</label>
                  <input type="text" placeholder="Ex: Actions Long Terme" value={newName} onChange={e => setNewName(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Description</label>
                  <input type="text" placeholder="Stratégie, objectif…" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Couleur</label>
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
