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
  assetValue, ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from "@/lib/types"
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
            <div className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: perf.alpha > 0 ? "#22c55e18" : "#ef444418",
                color: perf.alpha > 0 ? "#22c55e" : "#ef4444",
              }}>
              {perf.alpha > 0 ? "Vous battez" : "Sous-performez"} le S&P 500 de {perf.alpha > 0 ? "+" : ""}{perf.alpha.toFixed(2)}%
            </div>
          )}
          <div className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
            style={{ backgroundColor: "var(--bg-muted)", color: "var(--text-tertiary)" }}>
            <AlertCircle className="h-3 w-3" />
            Prix simulés
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
  totalValue,
}: {
  portfolio:   Portfolio
  livePrices:  Record<string, { price: number; changePct: number; originalPrice?: number; originalCurrency?: string }>
  onDeleteAsset: (assetId: string) => void
  onSellAsset: (asset: Asset, price: number, currency: string) => void
  totalValue:  number
}) {
  const { format, convert, fxRates, currency } = useCurrency()
  const [sortKey, setSortKey] = useState<SortKey>("value")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
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
        case "value":       va = assetValue(eA);  vb = assetValue(eB);  break
        case "dayPnl":      va = livePrices[a.ticker]?.changePct ?? 0; vb = livePrices[b.ticker]?.changePct ?? 0; break
        case "totalPnlPct": va = pnlPctFor(a); vb = pnlPctFor(b); break
        case "weight":      va = assetValue(eA);  vb = assetValue(eB);  break
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
          const origPrice     = liveData?.originalPrice
          const origCurrency  = liveData?.originalCurrency ?? asset.currency
          const nativeAvg     = asset.avgBuyPrice
          const pnlPct        = nativeAvg > 0 ? ((origPrice ?? livePrice) - nativeAvg) / nativeAvg * 100 : 0
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
        {([ ["Qté","qty"], ["Px moy.","avgPrice"], ["Prix actuel","currentPrice"], ["Valeur","value"], ["J. P&L","dayPnl"], ["P&L total","totalPnlPct"], ["Poids","weight"] ] as [string, SortKey][]).map(([l, k]) => (
          <SortHeader key={k} label={l} sortKey={k} current={sortKey} dir={sortDir} onSort={handleSort} />
        ))}
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

        // ─ P&L : formule stricte CHF (spec) ─────────────────────────────────
        //   cost_chf  = qty × avgBuyPrice_native / (fxRates as Record<string,number>)[native]
        //   value_chf = qty × currentPrice_native / (fxRates as Record<string,number>)[native]
        //   pnlPct    = (value_chf - cost_chf) / cost_chf × 100  (currency-independent)
        const nativeCurrent = origPrice ?? asset.currentPrice
        const nativeAvg     = asset.avgBuyPrice  // in native currency

        const rateToChf = ((fxRates as Record<string,number>)[origCurrency] ?? 1)
        const legacyCostCHF = nativeAvg * asset.quantity / rateToChf
        const costCHF   = asset.costBasisChf ?? legacyCostCHF
        const valueCHF  = nativeCurrent * asset.quantity / rateToChf

        const pnlPct      = costCHF > 0 ? ((valueCHF - costCHF) / costCHF) * 100 : 0
        const pnlUserCurr = (valueCHF - costCHF) * ((fxRates as Record<string,number>)[currency] ?? 1)

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
              {/* Avg buy price — stacked dual price */}
              <div className="flex justify-end">
                <DualPrice price={avgPriceUserCurr} originalPrice={nativeAvg} originalCurrency={origCurrency} size="xs" />
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
              {/* Day P&L % (from live API, already native) */}
              <div className="flex justify-end"><ChangeBadge value={dayChangePct} showIcon={false} /></div>
              {/* Total P&L % — native/native = currency-independent ✓ */}
              <div className="flex justify-end" title={`+${format(pnlUserCurr)}`}>
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
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => onSellAsset(asset, nativeCurrent, origCurrency)}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium hover:bg-green-500/20 transition-colors"
                  style={{ color: "var(--gain)" }}
                  title="Vendre"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Vendre
                </button>
                <button onClick={() => onDeleteAsset(asset.id)} className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-500/20 transition-colors" style={{ color: "var(--text-tertiary)" }} title="Supprimer">
                  <X className="h-3.5 w-3.5" />
                </button>
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
    portfolios, loading: dbLoading,
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

  // ── Global totals — formule stricte CHF (spec) ───────────────────────────
  // Étape 1: tout en CHF via prix natifs, Étape 2: convertir vers devise user

  // cost_chf = Σ qty × avgBuyPrice_native / (fxRates as Record<string,number>)[native]
  const totalCostCHF = portfolios.reduce((s, p) => {
    return s + p.assets
      .filter(a => a.assetClass !== "cash")
      .reduce((ss, a) => {
        const nativeCurr = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "USD"
        const rate = (fxRates as Record<string,number>)[nativeCurr] ?? 1
        return ss + (a.costBasisChf ?? (a.avgBuyPrice * a.quantity) / rate)
      }, 0)
  }, 0)

  // value_chf = Σ qty × currentPrice_native / (fxRates as Record<string,number>)[native]
  const totalValueCHF = portfolios.reduce((s, p) => {
    return s + p.assets
      .filter(a => a.assetClass !== "cash")
      .reduce((ss, a) => {
        const nativeCurr = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? "USD"
        const rate = (fxRates as Record<string,number>)[nativeCurr] ?? 1
        const nativePrice = liveEnriched[a.ticker]?.originalPrice ?? a.currentPrice
        return ss + (nativePrice * a.quantity) / rate
      }, 0)
  }, 0)

  // Convertir CHF → devise user
  const userRate    = (fxRates as Record<string,number>)[currency] ?? 1
  const totalCost   = totalCostCHF  * userRate
  const totalValue  = totalValueCHF * userRate
  const totalPnl    = totalValue - totalCost
  const totalPnlPct = totalCostCHF > 0 ? ((totalValueCHF - totalCostCHF) / totalCostCHF) * 100 : 0

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
                    {/* Cash balances summary across all portfolios */}
                    {(() => {
                      const totals: Record<string, number> = {}
                      portfolios.forEach(p => {
                        Object.entries(p.cashBalances ?? {}).forEach(([cur, val]) => {
                          if (val > 0) totals[cur] = (totals[cur] ?? 0) + (val as number)
                        })
                      })
                      const nonZero = Object.entries(totals).filter(([, v]) => v > 0)
                      if (!nonZero.length) return null
                      return (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {nonZero.map(([cur, val]) => (
                            <span key={cur}
                              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums"
                              style={{ backgroundColor: "#0ea5e918", color: "#0ea5e9", border: "1px solid #0ea5e930" }}>
                              💵 {val.toFixed(2)} {cur} en liquidité
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
                <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" style={{ color: "#22c55e" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Performance</p>
                  </div>
                  {[
                    { label: "Rendement total", value: (totalPnlPct >= 0 ? "+" : "") + totalPnlPct.toFixed(2) + " %", color: totalPnlPct >= 0 ? "#22c55e" : "#ef4444", tooltip: "" },
                    { label: "vs S&P 500 (YTD)", value: "+~8.00 %  (estimé)", color: "#eab308", tooltip: METRIC_TOOLTIPS.ytd },
                    { label: "Alpha généré", value: "+~" + Math.max(0, totalPnlPct - 8).toFixed(2) + " % (estimé)", color: "#3b82f6", tooltip: METRIC_TOOLTIPS.alpha },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        {r.label}
                        {r.tooltip && <Tooltip content={r.tooltip} icon />}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: r.color }}>{r.value}</span>
                    </div>
                  ))}
                </div>

                {/* Risk */}
                <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4" style={{ color: "#a78bfa" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Risque</p>
                  </div>
                  {[
                    { label: "Bêta (vs SPY)",    value: "~0.92  (estimé)",  tooltip: METRIC_TOOLTIPS.beta   },
                    { label: "Volatilité 30j",   value: "~14.20 %  (estimé)", tooltip: ""                    },
                    { label: "Ratio de Sharpe",  value: "~1.18  (estimé)",  tooltip: METRIC_TOOLTIPS.sharpe  },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        {r.label}
                        {r.tooltip && <Tooltip content={r.tooltip} icon />}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{r.value}</span>
                    </div>
                  ))}
                </div>

                {/* Income */}
                <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <BarChart2 className="h-4 w-4" style={{ color: "#f59e0b" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Revenus</p>
                  </div>
                  {[
                    { label: "Dividendes annuels",  value: format(annualDivs), color: "#22c55e", tooltip: "" },
                    { label: "Prochain versement",  value: "dans 38j",         color: "",         tooltip: "" },
                    { label: "Yield on cost",        value: ((annualDivs / totalCost) * 100).toFixed(2) + " %", color: "", tooltip: METRIC_TOOLTIPS.yieldOnCost },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        {r.label}
                        {(r as {tooltip?: string}).tooltip && <Tooltip content={(r as {tooltip: string}).tooltip} icon />}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: (r as {color?: string}).color ?? "var(--text-primary)" }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Benchmark chart with period selector */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Performance vs Benchmarks</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Normalisé à 100 · comparaison relative</p>
                  </div>
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    {PERIODS.map(p => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className="px-2.5 py-1 text-xs font-medium transition-colors"
                        style={{ backgroundColor: period === p ? "var(--accent)" : "transparent", color: period === p ? "white" : "var(--text-tertiary)" }}>
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
                    style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", borderStyle: "dashed" }}>
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      Ajoutez des actifs pour voir votre performance vs benchmarks
                    </p>
                  </div>
                )}
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
                    // Formule stricte CHF
                    const costC = p.assets.filter(a=>a.assetClass!=='cash').reduce((s,a)=>{
                      const nc = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? 'USD'
                      return s + (a.costBasisChf ?? (a.avgBuyPrice * a.quantity) / ((fxRates as Record<string,number>)[nc] ?? 1))
                    }, 0)
                    const valC = p.assets.filter(a=>a.assetClass!=='cash').reduce((s,a)=>{
                      const nc = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? 'USD'
                      const np = liveEnriched[a.ticker]?.originalPrice ?? a.currentPrice
                      return s + (np * a.quantity) / ((fxRates as Record<string,number>)[nc] ?? 1)
                    }, 0)
                    const ur  = (fxRates as Record<string,number>)[currency] ?? 1
                    const val = valC * ur
                    const cost = costC * ur
                    const pnl = val - cost
                    const pct = costC > 0 ? ((valC - costC) / costC) * 100 : 0
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
                          <p className="text-center text-xs" style={{ color: "var(--text-secondary)" }}>{p.assets.length}</p>
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
                      <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{activePortfolio.name}</h2>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activePortfolio.color }} />
                    </div>
                    {activePortfolio.description && (
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{activePortfolio.description}</p>
                    )}
                    {/* ── Cash balance row ─────────────────────────────── */}
                    {(() => {
                      const cash = activePortfolio.cashBalances ?? { CHF: 0, USD: 0, EUR: 0 }
                      const nonZero = Object.entries(cash).filter(([, v]) => v > 0)
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
                    const costC2 = activePortfolio.assets.filter(a=>a.assetClass!=='cash').reduce((s,a)=>{
                      const nc = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? 'USD'
                      return s + (a.costBasisChf ?? (a.avgBuyPrice * a.quantity) / ((fxRates as Record<string,number>)[nc] ?? 1))
                    }, 0)
                    const valC2 = activePortfolio.assets.filter(a=>a.assetClass!=='cash').reduce((s,a)=>{
                      const nc = liveEnriched[a.ticker]?.originalCurrency ?? a.currency ?? 'USD'
                      const np = liveEnriched[a.ticker]?.originalPrice ?? a.currentPrice
                      return s + (np * a.quantity) / ((fxRates as Record<string,number>)[nc] ?? 1)
                    }, 0)
                    const ur2  = (fxRates as Record<string,number>)[currency] ?? 1
                    const val  = valC2 * ur2
                    const cost = costC2 * ur2
                    const pnl  = val - cost
                    const pct  = costC2 > 0 ? ((valC2 - costC2) / costC2) * 100 : 0
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

              {/* Chart with period selector */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Performance vs S&P 500</p>
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    {PERIODS.map(p => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className="px-2.5 py-1 text-xs font-medium transition-colors"
                        style={{ backgroundColor: period === p ? "var(--accent)" : "transparent", color: period === p ? "white" : "var(--text-tertiary)" }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {/* portfolioData = PORTFOLIO_HISTORY (simulé) car pas de vraie série historique */}
                {/* La ligne verte représente une simulation — elle divergera de SPY par construction */}
                <BenchmarkChart
                  ticker="SPY"
                  name={activePortfolio.name}
                  portfolioData={allAssets.length > 0 ? PORTFOLIO_HISTORY : undefined}
                  height={260}
                  period={period}
                />
              </div>

              {/* Holdings table (sortable) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Positions — {activePortfolio.assets.length} actif{activePortfolio.assets.length !== 1 ? "s" : ""}
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
                  totalValue={activePortfolio.assets.reduce((s, a) => s + (liveEnriched[a.ticker]?.price ?? a.currentPrice) * a.quantity, 0)}
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
