"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { AreaChart } from "@/components/charts/area-chart"
import { usePortfolioHistory } from "@/hooks/use-portfolio-history"
import type { PortfolioAsset } from "@/app/api/portfolio-history/route"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { useAppData } from "@/hooks/use-app-data"
import { useLivePrices } from "@/hooks/use-live-prices"
import { useCurrency } from "@/hooks/use-currency"
import { calculatePortfolioPnL, convertPnL } from "@/lib/pnl"
import type { AppCurrency } from "@/lib/utils"
import { ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from "@/lib/types"
import { maxDrawdown, sumDividendsDisplay, computeAllocation } from "@/lib/finance"
import {
  TrendingUp, Wallet, Activity, BadgeCheck, ArrowRight, Plus,
  TrendingDown, ArrowUpRight, BarChart2, Eye, EyeOff,
  ShieldAlert,
} from "lucide-react"
import Link from "next/link"

const PERIODS = ["1S","1M","3M","6M","1A","Max"] as const
type Period = (typeof PERIODS)[number]

interface EarningsItem { ticker: string; earningsDate: string; epsAvg: number | null }

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { portfolios, transactions, revenus, globalCash, loading, realizedPnLEvents } = useAppData()
  const { format, convert, fxRates, currency } = useCurrency()
  const [period, setPeriod]     = useState<Period>("1A")
  const [earnings, setEarnings] = useState<EarningsItem[]>([])
  // Toggle pour cacher les graphiques (persiste en localStorage)
  const [showCharts, setShowCharts] = useState(true)
  useEffect(() => {
    const saved = localStorage.getItem("dashboard-show-charts")
    if (saved !== null) setShowCharts(saved === "true")
  }, [])
  function toggleCharts() {
    const next = !showCharts
    setShowCharts(next)
    localStorage.setItem("dashboard-show-charts", String(next))
  }

  const allAssets  = useMemo(() => portfolios.flatMap(p => p.assets), [portfolios])
  const allTickers = useMemo(() => allAssets.filter(a => a.assetClass !== "cash").map(a => a.ticker), [allAssets])
  const hasAssets  = allAssets.filter(a => a.assetClass !== "cash").length > 0

  const { prices: livePrices } = useLivePrices(allTickers, 30_000)

  const API_PERIOD: Record<Period, string> = {
    "1S": "1W", "1M": "1M", "3M": "3M", "6M": "6M", "1A": "1Y", "Max": "MAX"
  }
  const portfolioAssets = useMemo<PortfolioAsset[]>(() =>
    allAssets.filter(a => a.assetClass !== "cash").map(a => ({
      ticker:         a.ticker,
      quantity:       a.quantity,
      nativeCurrency: livePrices[a.ticker]?.originalCurrency ?? a.currency ?? "USD",
    })),
    [allAssets, livePrices]
  )
  const { history: portfolioHistory, loading: historyLoading, isReal } =
    usePortfolioHistory(portfolioAssets, API_PERIOD[period] ?? "1Y")

  // ── P&L standardisé CHF ─────────────────────────────────────────────────────
  const pnlResult = useMemo(() => {
    const assets = allAssets
      .filter(a => a.assetClass !== "cash")
      .map(a => ({
        ticker:               a.ticker,
        quantity:             a.quantity,
        avgBuyPrice:          a.avgBuyPrice,
        costBasisChf:         a.costBasisChf,
        nativeCurrency:       livePrices[a.ticker]?.originalCurrency ?? a.currency ?? "USD",
        currentPriceNative:   livePrices[a.ticker]?.originalPrice,
        currentPriceConverted: livePrices[a.ticker]?.price ?? a.currentPrice,
      }))
    return calculatePortfolioPnL(assets, fxRates)
  }, [allAssets, livePrices, fxRates]) // eslint-disable-line

  const { cost: totalCost, value: totalValue, pnl: totalPnl, pct: totalPnlPct } =
    convertPnL(pnlResult, currency, fxRates)

  const totalCashConverted = useMemo(() =>
    Object.entries(globalCash).reduce((sum, [cur, val]) =>
      sum + convert(Number(val ?? 0), cur as AppCurrency), 0
    ),
    [globalCash, convert]
  )

  // Patrimoine = positions + cash (PAS + revenus → déjà dans le cash)
  const netWorthValue = totalValue + totalCashConverted

  // Revenus annexes encaissés (parrainage, cashback, etc.)
  const totalRevenus = useMemo(
    () => revenus.reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0),
    [revenus, convert]
  )

  // Dividendes encaissés — une seule conversion (fix double FX)
  const totalDividends = useMemo(
    () => sumDividendsDisplay(transactions, currency, fxRates as Record<string, number>),
    [transactions, fxRates, currency]
  )

  // P&L global = P&L marché + P&L réalisé + dividendes + revenus annexes
  const globalPnl    = totalPnl + totalRevenus + totalDividends
  const globalPnlPct = totalCost > 0 ? (globalPnl / totalCost) * 100 : 0

  const todayPnl = useMemo(
    () => allAssets.reduce((s, a) => {
      const p = livePrices[a.ticker]
      if (!p) return s
      return s + (p.changePct / 100) * p.price * a.quantity
    }, 0),
    [allAssets, livePrices]
  )
  const todayPnlPct = totalValue > 0 ? (todayPnl / totalValue) * 100 : 0

  const realizedPnl = useMemo(() =>
    realizedPnLEvents.reduce(
      (sum, event) => sum + convert(event.pnl, event.currency as AppCurrency),
      0
    ),
    [realizedPnLEvents, convert]
  )

  // Frais totaux payés (achat + vente) — utilisés dans les KPI secondaires
  const totalFeesPaid = useMemo(() => {
    const ur = (fxRates as Record<string,number>)[currency] ?? 1
    return transactions.reduce((s, t) => s + ((t.feesChf ?? 0) * ur), 0)
  }, [transactions, fxRates, currency])

  // Allocation par classe — cash compté une seule fois, unités homogènes
  const allocationEntries = useMemo(() =>
    computeAllocation(
      allAssets,
      (ticker) => livePrices[ticker]?.price,
      totalCashConverted,
      currency,
      fxRates as Record<string, number>
    ),
    [allAssets, livePrices, totalCashConverted, currency, fxRates]
  )

  // Top 5 positions (par valeur)
  const top5 = useMemo(() =>
    allAssets
      .filter(a => a.assetClass !== "cash")
      .map(a => {
        const origPrice    = livePrices[a.ticker]?.originalPrice
        const origCurrency = livePrices[a.ticker]?.originalCurrency ?? a.currency ?? "USD"
        const livePrice    = livePrices[a.ticker]?.price ?? a.currentPrice
        const priceIsStale = livePrices[a.ticker] == null  // valorisé au coût, pas au marché
        const nativeAvg    = a.avgBuyPrice
        const pnlPct = (origPrice != null && nativeAvg > 0)
          ? ((origPrice - nativeAvg) / nativeAvg) * 100
          : 0
        return { ...a, livePrice, origPrice, origCurrency, nativeAvg, pnlPct, priceIsStale }
      })
      .sort((a, b) => (b.livePrice * b.quantity) - (a.livePrice * a.quantity))
      .slice(0, 5),
    [allAssets, livePrices]
  )

  // Activité récente (achats/ventes/dividendes en priorité, dépôts discrets)
  const recentInvestments = useMemo(() =>
    [...transactions]
      .filter(t => ["buy","sell","dividend"].includes(t.type))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 6),
    [transactions]
  )

  // Max drawdown
  const portfolioMaxDrawdown = useMemo(() => maxDrawdown(portfolioHistory), [portfolioHistory])

  // Variation sur la PÉRIODE sélectionnée (premier vs dernier point de
  // l'historique réel). null si l'historique est insuffisant — on n'invente rien.
  const periodChange = useMemo(() => {
    if (!isReal || portfolioHistory.length < 2) return null
    const first = portfolioHistory[0]?.value ?? 0
    const last  = portfolioHistory[portfolioHistory.length - 1]?.value ?? 0
    if (first <= 0) return null
    return { abs: last - first, pct: ((last - first) / first) * 100 }
  }, [portfolioHistory, isReal])

  // ── Risque & exposition (compact, données réelles uniquement) ──────────────
  const riskInfo = useMemo(() => {
    const positions = allAssets
      .filter(a => a.assetClass !== "cash")
      .map(a => ({
        ticker: a.ticker,
        value: (livePrices[a.ticker]?.price ?? convert(a.currentPrice, (a.currency ?? "CHF") as AppCurrency)) * a.quantity,
      }))
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value)
    const total = positions.reduce((s, p) => s + p.value, 0) + totalCashConverted
    if (total <= 0 || positions.length === 0) return null

    const top1Pct = (positions[0].value / total) * 100
    const top3Pct = (positions.slice(0, 3).reduce((s, p) => s + p.value, 0) / total) * 100
    const topClass = allocationEntries.filter(e => e.cls !== "cash")[0]

    const alerts: string[] = []
    if (top1Pct > 25) alerts.push(`${positions[0].ticker} pèse ${top1Pct.toFixed(0)} % du patrimoine — concentration élevée`)
    if (topClass && topClass.pct > 75) {
      alerts.push(`${ASSET_CLASS_LABELS[topClass.cls as keyof typeof ASSET_CLASS_LABELS] ?? topClass.cls} concentre ${topClass.pct.toFixed(0)} % du patrimoine`)
    }
    if (alerts.length === 0 && positions.length < 5) {
      alerts.push(`Seulement ${positions.length} position${positions.length > 1 ? "s" : ""} — diversification limitée`)
    }

    return {
      topTicker: positions[0].ticker,
      top1Pct,
      top3Pct,
      topClass,
      alerts: alerts.slice(0, 2),
      positionCount: positions.length,
    }
  }, [allAssets, livePrices, convert, totalCashConverted, allocationEntries])

  // Earnings
  useEffect(() => {
    if (!hasAssets) { setEarnings([]); return }
    const tickers = allAssets.filter(a => a.assetClass === "stock")
      .map(a => a.ticker).filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 8)
    if (!tickers.length) return
    fetch(`/api/earnings?tickers=${tickers.join(",")}`).then(r => r.json()).then(setEarnings).catch(() => {})
  }, [hasAssets, allAssets])

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex flex-col">
      <Topbar title="Dashboard" subtitle="Chargement…" />
      <div className="flex-1 p-6 space-y-4">
        {[1,2,3].map(i => (
          <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ backgroundColor: "var(--bg-elevated)" }} />
        ))}
      </div>
    </div>
  )

  // ─── Empty state ────────────────────────────────────────────────────────────
  if (!hasAssets) return (
    <div className="flex flex-col">
      <Topbar title="Dashboard" subtitle="Votre patrimoine" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl"
          style={{ background: "linear-gradient(135deg,#3b82f615,#6366f115)", border: "1px solid #3b82f630" }}>
          <Wallet className="h-10 w-10" style={{ color: "#3b82f6" }} />
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>Commencez à suivre votre patrimoine</h2>
          <p className="text-sm max-w-sm" style={{ color: "var(--text-secondary)" }}>
            Ajoutez vos premiers actifs pour voir votre valeur nette, P&L et graphiques en temps réel.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/portfolios"
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
            <Plus className="h-4 w-4" /> Ajouter un actif
          </Link>
          <Link href="/revenus"
            className="flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium hover:bg-zinc-800 transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            Déposer des liquidités
          </Link>
        </div>
      </div>
    </div>
  )

  const isUp = globalPnlPct >= 0
  const isToday = todayPnl >= 0

  return (
    <div className="flex flex-col">
      <Topbar title="Dashboard" subtitle="Vue d'ensemble de votre patrimoine" />

      <div className="flex-1 space-y-6 p-4 sm:p-6 max-w-7xl mx-auto w-full">

        {/* ══ HERO ════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-2xl border px-6 pt-7 pb-6"
          style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
          {/* Ambient glow */}
          <div className="pointer-events-none absolute inset-0" style={{
            background: `radial-gradient(ellipse 60% 50% at 80% 50%, ${isUp ? "#22c55e" : "#ef4444"}08, transparent)`,
          }} />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            {/* Left: value + P&L */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                Patrimoine net total
              </p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-4xl font-bold tabular-nums tracking-tight" style={{ color: "var(--text-primary)" }}>
                  {format(netWorthValue)}
                </span>
                <ChangeBadge value={globalPnlPct} size="md" />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span style={{ color: "var(--text-secondary)" }}
                  title={`Marché ${totalPnl >= 0 ? "+" : ""}${format(totalPnl)} · Dividendes +${format(totalDividends)} · Revenus +${format(totalRevenus)}`}>
                  <span className="text-xs mr-1" style={{ color: "var(--text-tertiary)" }}>P&L total</span>
                  <span className="font-semibold tabular-nums" style={{ color: isUp ? "var(--gain)" : "var(--loss)" }}>
                    {globalPnl >= 0 ? "+" : ""}{format(globalPnl)}
                  </span>
                </span>
                <span className="h-3 w-px" style={{ backgroundColor: "var(--border)" }} />
                <span style={{ color: "var(--text-secondary)" }}>
                  <span className="text-xs mr-1" style={{ color: "var(--text-tertiary)" }}>Aujourd'hui</span>
                  <span className="font-semibold tabular-nums" style={{ color: isToday ? "var(--gain)" : "var(--loss)" }}>
                    {todayPnl >= 0 ? "+" : ""}{format(todayPnl)}
                  </span>
                </span>
                {periodChange && (
                  <>
                    <span className="h-3 w-px" style={{ backgroundColor: "var(--border)" }} />
                    <span style={{ color: "var(--text-secondary)" }}>
                      <span className="text-xs mr-1" style={{ color: "var(--text-tertiary)" }}>Période {period}</span>
                      <span className="font-semibold tabular-nums" style={{ color: periodChange.abs >= 0 ? "var(--gain)" : "var(--loss)" }}>
                        {periodChange.abs >= 0 ? "+" : ""}{format(periodChange.abs)} ({periodChange.pct >= 0 ? "+" : ""}{periodChange.pct.toFixed(2)} %)
                      </span>
                    </span>
                  </>
                )}
                {totalCashConverted > 0 && (
                  <>
                    <span className="h-3 w-px" style={{ backgroundColor: "var(--border)" }} />
                    <span style={{ color: "var(--text-secondary)" }}>
                      <span className="text-xs mr-1" style={{ color: "var(--text-tertiary)" }}>Liquidités</span>
                      <span className="font-semibold tabular-nums" style={{ color: "#0ea5e9" }}>{format(totalCashConverted)}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex gap-2 shrink-0 items-center">
              <button onClick={toggleCharts}
                className="flex items-center justify-center h-10 w-10 rounded-xl border hover:bg-zinc-800 transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                title={showCharts ? "Cacher les graphiques" : "Afficher les graphiques"}>
                {showCharts ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <Link href="/portfolios"
                className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                Portefeuilles <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/portfolios"
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>
                <Plus className="h-3.5 w-3.5" /> Transaction
              </Link>
            </div>
          </div>
        </motion.div>

        {/* ══ KPI STRIP ═══════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
          {[
            {
              label: "P&L marché",
              value: (totalPnl >= 0 ? "+" : "") + format(totalPnl),
              sub:   (totalPnlPct >= 0 ? "+" : "") + totalPnlPct.toFixed(2) + "% positions ouvertes",
              icon:  TrendingUp,
              color: isUp ? "var(--gain)" : "var(--loss)",
            },
            {
              label: "P&L réalisé",
              value: (realizedPnl >= 0 ? "+" : "") + format(realizedPnl),
              sub:   totalFeesPaid > 0 ? `net de frais · −${format(totalFeesPaid)} frais` : "ventes clôturées",
              icon:  BadgeCheck,
              color: realizedPnl >= 0 ? "var(--gain)" : "var(--loss)",
            },
            {
              label: "Capital investi",
              value: format(totalCost),
              sub:   `${allAssets.filter(a => a.assetClass !== "cash").length} position${allAssets.length !== 1 ? "s" : ""}`,
              icon:  BarChart2,
              color: "#6366f1",
            },
            {
              label: "P&L du jour",
              value: (todayPnl >= 0 ? "+" : "") + format(todayPnl),
              sub:   (todayPnlPct >= 0 ? "+" : "") + todayPnlPct.toFixed(2) + "%",
              icon:  Activity,
              color: isToday ? "var(--gain)" : "var(--loss)",
            },
          ].map((kpi, i) => (
            <motion.div key={kpi.label}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className="rounded-xl border p-4 space-y-2"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>{kpi.label}</p>
                <div className="h-7 w-7 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: kpi.color + "18" }}>
                  <kpi.icon className="h-3.5 w-3.5" style={{ color: kpi.color }} />
                </div>
              </div>
              <p className="text-lg font-bold tabular-nums" style={{ color: kpi.color }}>{kpi.value}</p>
              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{kpi.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* ══ CHART + ALLOCATION ══════════════════════════════════════════════ */}
        {showCharts && (
        <div className="grid gap-6 lg:grid-cols-5">

          {/* Chart */}
          <div className="lg:col-span-3 rounded-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Valeur du patrimoine</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  Positions uniquement · hors dépôts et revenus · prix Yahoo Finance
                </p>
              </div>
              <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
                {PERIODS.map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition-all"
                    style={{
                      backgroundColor: period === p ? "var(--accent)" : "transparent",
                      color: period === p ? "white" : "var(--text-tertiary)",
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Source dot */}
            <div className="flex items-center gap-2 px-5 py-2 border-b"
              style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-overlay)" }}>
              <span className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: isReal && !historyLoading ? "#22c55e" : "var(--text-tertiary)" }} />
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                {historyLoading ? "Calcul…" : isReal ? "Données réelles" : "Aucune donnée"}
              </span>
              {!historyLoading && isReal && (
                <>
                  <span className="h-3 w-px mx-1" style={{ backgroundColor: "var(--border-subtle)" }} />
                  <span className="text-[10px] tabular-nums" style={{ color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                    {totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(2)}% sur la période
                  </span>
                  {portfolioMaxDrawdown !== 0 && (
                    <>
                      <span className="h-3 w-px mx-1" style={{ backgroundColor: "var(--border-subtle)" }} />
                      <span className="text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        Max drawdown {portfolioMaxDrawdown.toFixed(1)}%
                      </span>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Chart body */}
            <div className="p-4 pb-3">
              {historyLoading ? (
                <div className="h-44 flex items-center justify-center gap-2">
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-t-blue-500 animate-spin" />
                  <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Chargement historique…</span>
                </div>
              ) : isReal ? (
                <>
                  <AreaChart data={portfolioHistory} height={176} />
                  <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    Courbe approximative : quantités actuelles × prix historiques (les achats/ventes passés ne sont pas rejoués).
                  </p>
                </>
              ) : (
                <div className="h-44 flex flex-col items-center justify-center gap-2">
                  <BarChart2 className="h-6 w-6" style={{ color: "var(--text-tertiary)" }} />
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Historique indisponible</p>
                </div>
              )}
            </div>
          </div>

          {/* Allocation */}
          <div className="lg:col-span-2 rounded-2xl border"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Répartition</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Par classe d'actifs</p>
            </div>
            <div className="p-5 space-y-3">
              {allocationEntries.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>Aucune position</p>
              ) : allocationEntries.map(({ cls, val, pct }) => {
                const color = ASSET_CLASS_COLORS[cls as keyof typeof ASSET_CLASS_COLORS] ?? "#6b7280"
                const label = ASSET_CLASS_LABELS[cls as keyof typeof ASSET_CLASS_LABELS] ?? cls
                return (
                  <div key={cls} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                          {format(val)}
                        </span>
                        <span className="text-xs font-semibold tabular-nums w-12 text-right" style={{ color: "var(--text-primary)" }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-muted)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        )}

        {/* ══ RISQUE & EXPOSITION ═════════════════════════════════════════════ */}
        {riskInfo && (
          <div className="rounded-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" style={{ color: "#f59e0b" }} />
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Risque & exposition</p>
              </div>
              <Link href="/analyses" className="flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "var(--accent)" }}>
                Analyse détaillée <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ backgroundColor: "var(--border-subtle)" }}>
              {[
                { label: "Plus grosse position", value: `${riskInfo.topTicker} · ${riskInfo.top1Pct.toFixed(1)} %`, warn: riskInfo.top1Pct > 25 },
                { label: "Top 3 positions", value: `${riskInfo.top3Pct.toFixed(1)} %`, warn: riskInfo.top3Pct > 60 },
                {
                  label: "Classe dominante",
                  value: riskInfo.topClass
                    ? `${ASSET_CLASS_LABELS[riskInfo.topClass.cls as keyof typeof ASSET_CLASS_LABELS] ?? riskInfo.topClass.cls} · ${riskInfo.topClass.pct.toFixed(0)} %`
                    : "—",
                  warn: (riskInfo.topClass?.pct ?? 0) > 75,
                },
                { label: "Positions ouvertes", value: String(riskInfo.positionCount), warn: riskInfo.positionCount < 5 },
              ].map(s => (
                <div key={s.label} className="px-5 py-3.5" style={{ backgroundColor: "var(--bg-elevated)" }}>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{s.label}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums" style={{ color: s.warn ? "#f59e0b" : "var(--text-primary)" }}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>
            {riskInfo.alerts.length > 0 && (
              <div className="border-t px-5 py-3 space-y-1.5" style={{ borderColor: "var(--border-subtle)" }}>
                {riskInfo.alerts.map(a => (
                  <p key={a} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                    {a}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ TOP POSITIONS + ACTIVITÉ ════════════════════════════════════════ */}
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Top positions */}
          <div className="rounded-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Top positions</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Par valeur actuelle</p>
              </div>
              <Link href="/portfolios"
                className="text-[11px] flex items-center gap-1 hover:opacity-80 transition-opacity"
                style={{ color: "var(--accent)" }}>
                Tout voir <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div>
              {top5.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune position</p>
                </div>
              ) : top5.map((a, i) => {
                const value  = a.livePrice * a.quantity
                const isGain = a.pnlPct >= 0
                const color  = ASSET_CLASS_COLORS[a.assetClass as keyof typeof ASSET_CLASS_COLORS] ?? "#6b7280"
                return (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-800/30 transition-colors"
                    style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    {/* Rank + ticker chip */}
                    <div className="flex items-center gap-2.5 w-8 flex-shrink-0">
                      <span className="text-[11px] font-bold tabular-nums w-4" style={{ color: "var(--text-tertiary)" }}>{i + 1}</span>
                    </div>
                    <div className="h-9 w-9 flex-shrink-0 rounded-xl flex items-center justify-center text-[11px] font-bold"
                      style={{ backgroundColor: color + "18", color }}>
                      {a.ticker.slice(0, 3)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{a.ticker}</p>
                        {a.priceIsStale && (
                          <span
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: "#f59e0b" }}
                            title="Prix indisponible — valorisé au coût"
                          />
                        )}
                      </div>
                      <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                        {Number(a.quantity).toFixed(8).replace(/\.?0+$/, '')} × {a.livePrice.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{format(value)}</p>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        {isGain
                          ? <ArrowUpRight className="h-3 w-3" style={{ color: "var(--gain)" }} />
                          : <TrendingDown className="h-3 w-3" style={{ color: "var(--loss)" }} />
                        }
                        <span className="text-[11px] font-semibold tabular-nums"
                          style={{ color: isGain ? "var(--gain)" : "var(--loss)" }}>
                          {isGain ? "+" : ""}{a.pnlPct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Activité récente */}
          <div className="rounded-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Activité récente</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Achats · ventes · dividendes</p>
              </div>
              <Link href="/transactions"
                className="text-[11px] flex items-center gap-1 hover:opacity-80 transition-opacity"
                style={{ color: "var(--accent)" }}>
                Tout voir <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div>
              {recentInvestments.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune transaction</p>
                </div>
              ) : recentInvestments.map((tx, i) => {
                const TYPE = {
                  buy:      { label: "Achat",     color: "#6366f1", sign: "" },
                  sell:     { label: "Vente",     color: "#a78bfa", sign: "+" },
                  dividend: { label: "Dividende", color: "#22c55e", sign: "+" },
                } as Record<string, { label: string; color: string; sign: string }>
                const meta  = TYPE[tx.type] ?? { label: tx.type, color: "#64748b", sign: "" }
                const fxR   = (fxRates as Record<string,number>)[tx.currency ?? "CHF"] ?? 1
                const userRate = (fxRates as Record<string,number>)[currency] ?? 1
                const amtUser  = (tx.netAmountChf ?? tx.quantity * tx.price / fxR) * userRate
                return (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-800/30 transition-colors"
                    style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    <div className="h-9 w-9 flex-shrink-0 rounded-xl flex items-center justify-center text-[11px] font-bold"
                      style={{ backgroundColor: meta.color + "18", color: meta.color }}>
                      {tx.ticker.slice(0, 3)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {tx.assetName.length > 22 ? tx.ticker : tx.assetName}
                        </p>
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: meta.color + "18", color: meta.color }}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        {new Date(tx.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}
                        {tx.quantity > 0 && ` · ${Number(tx.quantity).toFixed(8).replace(/\.?0+$/, '')} × ${tx.price.toFixed(2)}`}
                      </p>
                    </div>
                    <p className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: meta.color }}>
                      {meta.sign}{format(amtUser)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ══ PROCHAINS RÉSULTATS ════════════════════════════════════════════ */}
        {earnings.filter(e => new Date(e.earningsDate).getTime() > Date.now() - 7 * 86400000).length > 0 && (
          <div className="rounded-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Prochains résultats</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Publications de résultats pour vos positions</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-zinc-800" style={{ backgroundColor: "var(--border)" }}>
              {earnings.filter(e => new Date(e.earningsDate).getTime() > Date.now() - 7 * 86400000)
                .slice(0, 6).map(e => {
                const daysLeft = Math.ceil((new Date(e.earningsDate).getTime() - Date.now()) / 86400000)
                const isPast   = daysLeft < 0
                const isClose  = daysLeft >= 0 && daysLeft <= 7
                return (
                  <div key={e.ticker} className="flex flex-col gap-1 px-4 py-4"
                    style={{ backgroundColor: "var(--bg-elevated)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{e.ticker}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: isPast ? "var(--bg-muted)" : isClose ? "#f59e0b18" : "#6366f118",
                          color: isPast ? "var(--text-tertiary)" : isClose ? "#f59e0b" : "var(--accent)",
                        }}>
                        {isPast ? `−${Math.abs(daysLeft)}j` : daysLeft === 0 ? "Auj." : `+${daysLeft}j`}
                      </span>
                    </div>
                    <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {new Date(e.earningsDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                    </p>
                    {e.epsAvg != null && (
                      <p className="text-[11px] tabular-nums font-medium" style={{ color: e.epsAvg >= 0 ? "var(--gain)" : "var(--loss)" }}>
                        EPS {e.epsAvg >= 0 ? "+" : ""}{e.epsAvg.toFixed(2)}$
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
