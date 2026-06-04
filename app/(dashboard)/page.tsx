"use client"

import { useState, useEffect, useMemo } from "react"
import { Topbar } from "@/components/layout/topbar"
import { StatCard } from "@/components/ui/stat-card"
import { SectionHeader } from "@/components/ui/section-header"
import { AreaChart } from "@/components/charts/area-chart"
import { usePortfolioHistory } from "@/hooks/use-portfolio-history"
import type { PortfolioAsset } from "@/app/api/portfolio-history/route"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { DualPriceInline } from "@/components/ui/dual-price"
import { InsightsWidget } from "@/components/ui/insights-widget"
import { useAppData } from "@/hooks/use-app-data"
import { useLivePrices } from "@/hooks/use-live-prices"
import { useCurrency } from "@/hooks/use-currency"
import { calculatePortfolioPnL, convertPnL } from "@/lib/pnl"
import type { AppCurrency } from "@/lib/utils"
import {
  ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from "@/lib/types"
import { calculateAllocationByField, maxDrawdown, type AllocationEntry } from "@/lib/finance"
import {
  Wallet, TrendingUp, BarChart2, Activity,
  ArrowUpRight, Plus, Zap, ShieldAlert, Building2, Globe2, type LucideIcon,
  BadgeCheck,
} from "lucide-react"
import Link from "next/link"

// ─── Static helpers ───────────────────────────────────────────────────────────
const PERIODS = ["1S","1M","3M","6M","1A","Max"] as const
type Period = (typeof PERIODS)[number]

interface EarningsItem { ticker: string; earningsDate: string; epsAvg: number | null }

const DIVERSIFICATION_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#a78bfa", "#ef4444",
  "#14b8a6", "#f97316", "#64748b", "#eab308", "#06b6d4",
]

function normalizeGeography(country?: string) {
  const value = country?.trim()
  if (!value || value === "-" || value === "—") return "Global / Crypto"

  const upper = value.toUpperCase()
  const europe = new Set([
    "CH","CHE","SWITZERLAND","SUISSE","FR","FRA","FRANCE","DE","DEU","GERMANY","ALLEMAGNE",
    "NL","NLD","NETHERLANDS","PAYS-BAS","IE","IRL","IRELAND","IRLANDE","GB","UK","GBR",
    "UNITED KINGDOM","ROYAUME-UNI","ES","ESP","SPAIN","ESPAGNE","IT","ITA","ITALY","ITALIE",
    "BE","BEL","BELGIUM","BELGIQUE","SE","SWE","SWEDEN","SUEDE","DK","DNK","NO","NOR",
  ])
  const emerging = new Set([
    "CN","CHN","CHINA","CHINE","IN","IND","INDIA","INDE","BR","BRA","BRAZIL","BRESIL",
    "MX","MEX","MEXICO","ZA","ZAF","SOUTH AFRICA","AFRIQUE DU SUD","ID","IDN","INDONESIA",
    "VN","VNM","VIETNAM","TH","THA","THAILAND","THAILANDE",
  ])
  const asiaPacific = new Set([
    "JP","JPN","JAPAN","JAPON","KR","KOR","SOUTH KOREA","COREE DU SUD","AU","AUS",
    "AUSTRALIA","AUSTRALIE","SG","SGP","SINGAPORE","SINGAPOUR","HK","HKG","HONG KONG",
  ])

  if (["US","USA","UNITED STATES","ETATS-UNIS"].includes(upper)) return "US"
  if (europe.has(upper)) return "Europe"
  if (emerging.has(upper)) return "Emergents"
  if (asiaPacific.has(upper)) return "Asie-Pacifique"
  if (["WORLD","MONDE","GLOBAL"].includes(upper)) return "Global"
  return value
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { portfolios, transactions, revenus, loading, realizedPnLEvents } = useAppData()
  const { format, convert, fxRates, currency } = useCurrency()
  const [period, setPeriod]     = useState<Period>("1A")
  const [earnings, setEarnings] = useState<EarningsItem[]>([])

  // All assets from all portfolios
  const allAssets  = useMemo(() => portfolios.flatMap(p => p.assets), [portfolios])
  const allTickers = useMemo(() => allAssets.filter(a => a.assetClass !== "cash").map(a => a.ticker), [allAssets])
  const hasAssets  = allAssets.length > 0

  // Live prices
  const { prices: livePrices } = useLivePrices(allTickers, 30_000)

  // Map PERIODS to API codes + real portfolio history
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

  // ── P&L avec formule stricte (standardisation en CHF) ───────────────────────
  // Règle: tout en CHF, prix natifs pour coût ET valeur, même taux FX
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

  // Convertir résultat CHF → devise utilisateur
  const { cost: totalCost, value: totalValue, pnl: totalPnl, pct: totalPnlPct } =
    convertPnL(pnlResult, currency, fxRates)

  const totalCashConverted = useMemo(() => portfolios.reduce((sum, p) => {
    return sum + Object.entries(p.cashBalances ?? {}).reduce((cashSum, [cur, val]) => (
      cashSum + convert(Number(val ?? 0), cur as AppCurrency)
    ), 0)
  }, 0), [portfolios, convert])

  // Revenus annexes encaissés → comptent dans le patrimoine, PAS dans le P&L marché
  const totalRevenus = useMemo(
    () => revenus.reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0),
    [revenus, convert]
  )

  // Patrimoine net = positions + cash + revenus annexes encaissés
  const netWorthValue = totalValue + totalCashConverted + totalRevenus

  // Today P&L: sum of each asset's day change
  const todayPnl = useMemo(
    () => allAssets.reduce((s, a) => {
      const p = livePrices[a.ticker]
      if (!p) return s
      return s + (p.changePct / 100) * p.price * a.quantity
    }, 0),
    [allAssets, livePrices]
  )
  const todayPnlPct = totalValue > 0 ? (todayPnl / totalValue) * 100 : 0

  // Allocation by class
  const allocationEntries = useMemo(() => {
    const byClass: Record<string, number> = {}
    allAssets.forEach(a => {
      const price = a.assetClass === "cash"
        ? convert(a.currentPrice || a.avgBuyPrice || 1, a.currency as AppCurrency)
        : livePrices[a.ticker]?.price ?? a.currentPrice
      byClass[a.assetClass] = (byClass[a.assetClass] ?? 0) + price * a.quantity
    })
    if (totalCashConverted > 0) byClass.cash = (byClass.cash ?? 0) + totalCashConverted
    return Object.entries(byClass)
      .sort(([, a], [, b]) => b - a)
      .map(([cls, val]) => ({
        cls: cls as keyof typeof ASSET_CLASS_LABELS,
        val,
        pct: netWorthValue > 0 ? (val / netWorthValue) * 100 : 0,
      }))
  }, [allAssets, livePrices, totalCashConverted, netWorthValue])

  const assetsForAnalytics = useMemo(() =>
    allAssets.map(a => ({
      ticker:       a.ticker,
      quantity:     a.quantity,
      avgBuyPrice:  a.avgBuyPrice,
      currentPrice: a.assetClass === "cash"
        ? convert(a.currentPrice || a.avgBuyPrice || 1, a.currency as AppCurrency)
        : livePrices[a.ticker]?.price ?? a.currentPrice,
      assetClass:   a.assetClass,
      sector:       a.sector,
      country:      normalizeGeography(a.country),
    })),
    [allAssets, livePrices]
  )

  const sectorEntries = useMemo(
    () => calculateAllocationByField(assetsForAnalytics, "sector", "Non renseigne", totalValue),
    [assetsForAnalytics, totalValue]
  )

  const geoEntries = useMemo(
    () => calculateAllocationByField(assetsForAnalytics, "country", "Non renseigne", totalValue),
    [assetsForAnalytics, totalValue]
  )

  const portfolioMaxDrawdown = useMemo(
    () => maxDrawdown(portfolioHistory),
    [portfolioHistory]
  )

  const realizedPnl = useMemo(() =>
    realizedPnLEvents.reduce(
      (sum, event) => sum + convert(event.pnl, event.currency as AppCurrency),
      0
    ),
    [realizedPnLEvents, convert]
  )

  // Top 5 holdings
  const top5 = useMemo(() =>
    [...allAssets]
      .map(a => ({ ...a, currentPrice: a.assetClass === "cash" ? convert(a.currentPrice || a.avgBuyPrice || 1, a.currency as AppCurrency) : livePrices[a.ticker]?.price ?? a.currentPrice }))
      .sort((a, b) => (b.currentPrice * b.quantity) - (a.currentPrice * a.quantity))
      .slice(0, 5),
    [allAssets, livePrices]
  )

  // Recent transactions
  const recentTx = useMemo(() =>
    [...transactions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5),
    [transactions]
  )

  // Earnings calendar (only when we have stocks)
  useEffect(() => {
    if (!hasAssets) { setEarnings([]); return }
    const stockTickers = allAssets
      .filter(a => a.assetClass === "stock")
      .map(a => a.ticker)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 8)
    if (!stockTickers.length) return
    fetch(`/api/earnings?tickers=${stockTickers.join(",")}`)
      .then(r => r.json())
      .then(setEarnings)
      .catch(() => {})
  }, [hasAssets, allAssets])

  // ─── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col">
        <Topbar title="Dashboard" subtitle="Chargement…" />
        <div className="flex-1 p-4 sm:p-6 space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 rounded-xl animate-pulse" style={{ backgroundColor: "var(--bg-elevated)" }} />
          ))}
        </div>
      </div>
    )
  }

  // ─── Empty onboarding state ───────────────────────────────────────────────
  if (!loading && !hasAssets) {
    return (
      <div className="flex flex-col">
        <Topbar title="Dashboard" subtitle="Vue d'ensemble de votre patrimoine" />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl"
            style={{ background: "linear-gradient(135deg,#3b82f615,#6366f115)", border: "1px solid #3b82f630" }}>
            <Wallet className="h-10 w-10" style={{ color: "#3b82f6" }} />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
              Commencez à suivre votre patrimoine
            </h2>
            <p className="text-sm max-w-sm" style={{ color: "var(--text-secondary)" }}>
              Ajoutez vos premiers actifs pour voir votre valeur nette, P&amp;L et graphiques en temps réel.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/portfolios"
              className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 0 20px #3b82f630" }}>
              <Plus className="h-4 w-4" />
              Ajouter un actif
            </Link>
            <Link href="/transactions"
              className="flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-colors hover:bg-zinc-800"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
              Saisir une transaction
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Dashboard" subtitle="Vue d'ensemble de votre patrimoine" />

      <div className="flex-1 space-y-5 sm:space-y-8 p-4 sm:p-6">

        {/* ─── Hero ─── */}
        <section>
          <div className="relative overflow-hidden rounded-[18px] p-6 sm:p-8"
            style={{
              background: "linear-gradient(135deg, #0c0c14 0%, #0d0d12 50%, #0a0e0a 100%)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-md), inset 0 1px 0 rgba(255,255,255,0.03)",
            }}>
            {/* Mesh glows */}
            <div className="pointer-events-none absolute -top-20 -left-10 h-72 w-72 rounded-full opacity-30 blur-3xl"
              style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }} />
            <div className="pointer-events-none absolute -bottom-8 right-10 h-48 w-48 rounded-full opacity-15 blur-3xl"
              style={{ background: "radial-gradient(circle, #22c55e 0%, transparent 70%)" }} />
            {/* Top shimmer */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)" }} />

            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--text-tertiary)" }}>
                  Patrimoine net total
                </p>
                <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                  <span
                    className="font-bold tabular-nums"
                    style={{
                      color: "var(--text-primary)",
                      fontSize: "clamp(28px, 5vw, 44px)",
                      letterSpacing: "-0.03em",
                      lineHeight: 1,
                    }}
                  >
                    {format(netWorthValue)}
                  </span>
                  <ChangeBadge value={todayPnlPct} size="md" />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: todayPnl >= 0 ? "var(--gain)" : "var(--loss)", fontWeight: 600 }}>
                      {todayPnl >= 0 ? "+" : ""}{format(todayPnl)}
                    </span>{" "}
                    aujourd&apos;hui
                  </span>
                  <span className="h-1 w-1 rounded-full" style={{ backgroundColor: "var(--text-tertiary)" }} />
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {portfolios.length} portefeuille{portfolios.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              <Link href="/portfolios"
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200"
                style={{
                  background:  "linear-gradient(135deg, #6366f1, #818cf8)",
                  boxShadow:   "0 0 0 1px rgba(99,102,241,0.3), 0 4px 16px rgba(99,102,241,0.25)",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = "translateY(0)"}
              >
                Voir les portefeuilles <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* ─── KPIs ─── */}
        <section>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-7">
            <StatCard label="Valeur nette totale" value={format(netWorthValue)} change={totalPnlPct} changeLabel="P&L hors liquidités" icon={Wallet} iconColor="var(--accent)" index={0} />
            <StatCard label="P&L du jour" value={(todayPnl >= 0 ? "+" : "") + format(todayPnl)} change={todayPnlPct} changeLabel="aujourd'hui" icon={Activity} iconColor="#a78bfa" index={1} />
            <StatCard label="Plus-value latente" value={(totalPnl >= 0 ? "+" : "") + format(totalPnl)} change={totalPnlPct} changeLabel="depuis l'achat" icon={TrendingUp} iconColor="var(--gain)" index={2} />
            <StatCard label="Plus-value réalisée" value={(realizedPnl >= 0 ? "+" : "") + format(realizedPnl)} changeLabel="ventes clôturées" icon={BadgeCheck} iconColor="#22c55e" index={3} />
            <StatCard label="Nb. lignes" value={String(allAssets.filter(a => a.assetClass !== "cash").length)} changeLabel="positions ouvertes" icon={BarChart2} iconColor="#f59e0b" index={4} />
            {/* Cash disponible — toutes devises converties */}
            {(() => {
              const cashTotals: Record<string, number> = {}
              portfolios.forEach(p => {
                Object.entries(p.cashBalances ?? {}).forEach(([cur, val]) => {
                  if ((val as number) > 0) {
                    cashTotals[cur] = (cashTotals[cur] ?? 0) + (val as number)
                  }
                })
              })
              const totalCashConverted = Object.entries(cashTotals).reduce(
                (s, [cur, val]) => s + convert(val as number, cur as AppCurrency), 0
              )
              const cashLines = Object.entries(cashTotals)
                .filter(([, v]) => v > 0)
                .map(([cur, val]) => `${(val as number).toFixed(0)} ${cur}`)
                .join(" · ")
              return (
                <StatCard
                  label="Liquidités"
                  value={format(totalCashConverted)}
                  changeLabel={cashLines || "Aucun dépôt"}
                  icon={Wallet}
                  iconColor="#0ea5e9"
                  index={5}
                />
              )
            })()}
            {/* Revenus annexes */}
            {(() => {
              const revTotal = revenus.reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0)
              const thisMonthRevs = revenus.filter(r => new Date(r.date).getMonth() === new Date().getMonth())
              const monthTotal    = thisMonthRevs.reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0)
              return (
                <StatCard
                  label="Revenus annexes"
                  value={format(revTotal)}
                  changeLabel={`ce mois: +${format(monthTotal)}`}
                  icon={Zap}
                  iconColor="#a855f7"
                  index={6}
                />
              )
            })()}
            <StatCard
              label="Max Drawdown"
              value={historyLoading ? "..." : `${portfolioMaxDrawdown.toFixed(2)} %`}
              changeLabel="historique"
              icon={ShieldAlert}
              iconColor="#ef4444"
              index={6}
            />
          </div>
        </section>

        {/* ─── Chart + Allocation ─── */}
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
          {/* Chart */}
          <section className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <SectionHeader title="Évolution du patrimoine" description="Valeur nette historique" />
              <div className="flex gap-1">
                {PERIODS.map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: period === p ? "var(--accent)" : "transparent",
                      color: period === p ? "white" : "var(--text-tertiary)",
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              {/* Source indicator */}
              <div className="flex items-center gap-2 px-4 py-2 border-b"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-overlay)" }}>
                <span className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: isReal && !historyLoading ? "#22c55e" : "var(--text-tertiary)" }} />
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {historyLoading
                    ? "Calcul de l'historique réel…"
                    : isReal
                    ? "Valeurs calculées depuis vos positions réelles · prix Yahoo Finance"
                    : "Ajoutez des actifs pour voir votre évolution réelle"
                  }
                </span>
              </div>

              {hasAssets ? (
                historyLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2">
                    <div className="h-4 w-4 rounded-full border-2 border-t-blue-500 border-r-blue-500/30 border-b-blue-500/10 border-l-blue-500/30 animate-spin" />
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Chargement des prix historiques…
                    </span>
                  </div>
                ) : isReal ? (
                  <div className="p-3">
                    <AreaChart data={portfolioHistory} height={200} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <BarChart2 className="h-7 w-7" style={{ color: "var(--text-tertiary)" }} />
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Impossible de récupérer l&apos;historique des prix
                    </p>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-2 p-3">
                  <BarChart2 className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Ajoutez des actifs pour voir l&apos;évolution de votre portefeuille
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Allocation donut */}
          <section className="lg:col-span-2 space-y-3">
            <SectionHeader title="Répartition" description="Par classe d'actifs" />
            <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="mb-5 flex justify-center">
                <div className="relative h-28 w-28">
                  <DonutChart entries={allocationEntries} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{allocationEntries.length}</span>
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>classes</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2.5">
                {allocationEntries.map(({ cls, pct }) => (
                  <div key={cls} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }} />
                    <span className="flex-1 text-xs" style={{ color: "var(--text-secondary)" }}>{ASSET_CLASS_LABELS[cls]}</span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ─── Top holdings + Recent transactions ─── */}
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          <AllocationBreakdown
            title="Repartition sectorielle"
            description="Poids par secteur economique"
            entries={sectorEntries}
            icon={Building2}
            colors={DIVERSIFICATION_COLORS}
          />
          <AllocationBreakdown
            title="Repartition geographique"
            description="Exposition par zone"
            entries={geoEntries}
            icon={Globe2}
            colors={DIVERSIFICATION_COLORS}
          />
        </div>

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          {/* Top 5 */}
          <section className="space-y-3">
            <SectionHeader title="Top positions" description="5 plus grandes positions"
              action={<Link href="/portfolios" className="text-xs hover:text-white transition-colors" style={{ color: "var(--text-secondary)" }}>Tout voir →</Link>}
            />
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              {top5.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune position</p>
                </div>
              ) : top5.map((asset, i) => {
                const userRate = (fxRates as Record<string, number>)[currency] ?? 1
                const valueChf = (asset.currentPrice * asset.quantity) / userRate
                const costChf = asset.costBasisChf ?? valueChf
                const pnlPct = costChf > 0 ? ((valueChf - costChf) / costChf) * 100 : 0
                const color = ASSET_CLASS_COLORS[asset.assetClass]
                return (
                  <div key={asset.id} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/30 transition-colors"
                    style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: `${color}18`, color }}>
                      {asset.ticker.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{asset.name}</p>
                      <p className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
                        <span>{asset.quantity} ×</span>
                        <DualPriceInline
                          price={asset.currentPrice}
                          originalPrice={livePrices[asset.ticker]?.originalPrice}
                          originalCurrency={livePrices[asset.ticker]?.originalCurrency}
                        />
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {format(asset.currentPrice * asset.quantity)}
                      </p>
                      <ChangeBadge value={pnlPct} showIcon={false} />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Recent transactions */}
          <section className="space-y-3">
            <SectionHeader title="Dernières transactions" description="Activité récente"
              action={<Link href="/transactions" className="text-xs hover:text-white transition-colors" style={{ color: "var(--text-secondary)" }}>Tout voir →</Link>}
            />
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              {recentTx.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-2">
                  <Activity className="h-7 w-7" style={{ color: "var(--text-tertiary)" }} />
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune transaction</p>
                </div>
              ) : recentTx.map((tx, i) => {
                const isBuy   = tx.type === "buy"
                const isDiv   = tx.type === "dividend"
                const isSell  = tx.type === "sell"
                // Achat = bleu neutre (pas une perte), dividende = vert, vente = violet
                const color   = isBuy ? "#6366f1" : isDiv ? "#22c55e" : isSell ? "#a78bfa" : "#64748b"
                const label   = isBuy ? "Investi" : isDiv ? "Dividende" : isSell ? "Vente" : "Transfert"
                return (
                  <div key={tx.id} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/30 transition-colors"
                    style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: `${color}18`, color }}>
                      {tx.ticker.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{tx.assetName}</p>
                      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        {label} · {new Date(tx.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: isBuy ? "var(--text-secondary)" : color }}>
                        {isBuy ? "" : isDiv ? "+" : isSell ? "+" : ""}{format(tx.quantity * tx.price)}
                      </p>
                      {isBuy && (
                        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>capital investi</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        {/* ─── Earnings calendar ─── */}
        {earnings.length > 0 && (
          <section className="space-y-3">
            <SectionHeader title="Prochains résultats" description="Dates de publication pour vos positions" />
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              {earnings.slice(0, 6).map((e, i) => {
                const daysLeft = Math.ceil((new Date(e.earningsDate).getTime() - Date.now()) / 86400000)
                const isPast   = daysLeft < 0
                return (
                  <div key={e.ticker} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                    style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: "#3b82f622", color: "#3b82f6" }}>
                      {e.ticker.slice(0, 4)}
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{e.ticker}</p>
                      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {new Date(e.earningsDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                      </p>
                    </div>
                    {e.epsAvg != null && (
                      <p className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        EPS {e.epsAvg > 0 ? "+" : ""}{e.epsAvg.toFixed(2)}$
                      </p>
                    )}
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: isPast ? "var(--bg-muted)" : "#f59e0b18",
                        color: isPast ? "var(--text-tertiary)" : "#f59e0b",
                      }}>
                      {isPast ? `il y a ${Math.abs(daysLeft)}j` : daysLeft === 0 ? "Aujourd'hui" : `dans ${daysLeft}j`}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ─── Insights automatiques ─── */}
        {hasAssets && (
          <InsightsWidget assets={assetsForAnalytics} />
        )}
      </div>
    </div>
  )
}

// ─── Mini SVG Donut ───────────────────────────────────────────────────────────
function AllocationBreakdown({
  title,
  description,
  entries,
  icon: Icon,
  colors,
}: {
  title: string
  description: string
  entries: AllocationEntry[]
  icon: LucideIcon
  colors: string[]
}) {
  const visible = entries.slice(0, 7)

  return (
    <section className="space-y-3">
      <SectionHeader title={title} description={description} />
      <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        {visible.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune donnee</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${colors[0]}18`, border: `1px solid ${colors[0]}30` }}>
                <Icon className="h-4.5 w-4.5" style={{ color: colors[0] }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {visible[0]?.key}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  Premiere exposition: {visible[0]?.pct.toFixed(1)} %
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {visible.map((entry, i) => {
                const color = colors[i % colors.length]
                return (
                  <div key={entry.key} className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                        {entry.key}
                      </span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {entry.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, entry.pct)}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function DonutChart({ entries }: { entries: { cls: string; pct: number }[] }) {
  const r = 14, cx = 18, cy = 18, stroke = 3.5, circ = 2 * Math.PI * r
  let cumulative = 0
  return (
    <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      {entries.map(({ cls, pct }) => {
        const dash   = (pct / 100) * circ
        const offset = (1 - cumulative / 100) * circ
        cumulative  += pct
        return (
          <circle key={cls} cx={cx} cy={cy} r={r} fill="none"
            stroke={ASSET_CLASS_COLORS[cls as keyof typeof ASSET_CLASS_COLORS] ?? "#6b7280"}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-circ + offset}
          />
        )
      })}
    </svg>
  )
}
