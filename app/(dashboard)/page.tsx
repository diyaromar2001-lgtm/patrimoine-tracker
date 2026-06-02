"use client"

import { useState } from "react"
import { Topbar } from "@/components/layout/topbar"
import { StatCard } from "@/components/ui/stat-card"
import { SectionHeader } from "@/components/ui/section-header"
import { AreaChart } from "@/components/charts/area-chart"
import { ChangeBadge, AssetClassBadge } from "@/components/ui/badge"
import { Sparkline } from "@/components/ui/sparkline"
import {
  MOCK_PORTFOLIOS,
  PORTFOLIO_HISTORY,
  MOCK_TRANSACTIONS,
} from "@/lib/mock-data"
import {
  portfolioTotalValue,
  portfolioTotalCost,
  portfolioPnl,
  portfolioPnlPct,
  assetValue,
  assetPnl,
  assetPnlPct,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_COLORS,
} from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import {
  Wallet,
  TrendingUp,
  BarChart2,
  Activity,
  ArrowUpRight,
  Layers,
} from "lucide-react"
import Link from "next/link"

// ─── Compute totals ───────────────────────────────────────────────────────────
const totalValue = MOCK_PORTFOLIOS.reduce((s, p) => s + portfolioTotalValue(p), 0)
const totalCost  = MOCK_PORTFOLIOS.reduce((s, p) => s + portfolioTotalCost(p), 0)
const totalPnl   = totalValue - totalCost
const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

const prev = PORTFOLIO_HISTORY[PORTFOLIO_HISTORY.length - 2]?.value ?? totalValue
const todayPnl    = totalValue - prev
const todayPnlPct = prev > 0 ? (todayPnl / prev) * 100 : 0

// All assets flattened
const allAssets = MOCK_PORTFOLIOS.flatMap((p) => p.assets)

// Allocation by class
const byClass = allAssets.reduce<Record<string, number>>((acc, a) => {
  acc[a.assetClass] = (acc[a.assetClass] ?? 0) + assetValue(a)
  return acc
}, {})
const allocationEntries = Object.entries(byClass)
  .sort(([, a], [, b]) => b - a)
  .map(([cls, val]) => ({
    cls: cls as keyof typeof ASSET_CLASS_LABELS,
    val,
    pct: totalValue > 0 ? (val / totalValue) * 100 : 0,
  }))

// Top 5 holdings
const top5 = [...allAssets]
  .sort((a, b) => assetValue(b) - assetValue(a))
  .slice(0, 5)

// Recent 5 transactions
const recentTx = [...MOCK_TRANSACTIONS]
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  .slice(0, 5)

const PERIODS = ["1S", "1M", "3M", "6M", "1A", "Max"] as const
type Period = (typeof PERIODS)[number]

const filterHistory = (period: Period) => {
  const now = new Date()
  const cutoff = new Date()
  if (period === "1S") cutoff.setDate(now.getDate() - 7)
  else if (period === "1M") cutoff.setMonth(now.getMonth() - 1)
  else if (period === "3M") cutoff.setMonth(now.getMonth() - 3)
  else if (period === "6M") cutoff.setMonth(now.getMonth() - 6)
  else if (period === "1A") cutoff.setFullYear(now.getFullYear() - 1)
  else return PORTFOLIO_HISTORY
  return PORTFOLIO_HISTORY.filter((s) => new Date(s.date) >= cutoff)
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("1A")
  const historySlice = filterHistory(period)

  return (
    <div className="flex flex-col">
      <Topbar title="Dashboard" subtitle="Vue d'ensemble de votre patrimoine" />

      <div className="flex-1 space-y-8 p-6">

        {/* ─── Hero ───────────────────────────────────────────── */}
        <section>
          <div
            className="relative overflow-hidden rounded-2xl border p-6"
            style={{
              background: "linear-gradient(135deg, #0f1729 0%, #111113 60%, #0d180d 100%)",
              borderColor: "var(--border)",
            }}
          >
            <div className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: "#3b82f6" }} />
            <div className="pointer-events-none absolute -bottom-10 right-16 h-40 w-40 rounded-full opacity-10 blur-2xl" style={{ backgroundColor: "#22c55e" }} />

            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--foreground-dim)" }}>
                  Patrimoine net total
                </p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="text-4xl font-bold tabular-nums tracking-tight" style={{ color: "var(--foreground)" }}>
                    {formatCurrency(totalValue)}
                  </span>
                  <ChangeBadge value={todayPnlPct} size="md" />
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                  {todayPnl >= 0 ? "+" : ""}{formatCurrency(todayPnl)} aujourd'hui · {MOCK_PORTFOLIOS.length} portefeuilles
                </p>
              </div>
              <Link
                href="/portfolios"
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-95"
                style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 0 24px #3b82f640" }}
              >
                Voir les portefeuilles
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ─── KPIs ───────────────────────────────────────────── */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Valeur nette totale" value={formatCurrency(totalValue)} change={totalPnlPct} changeLabel="depuis le début" icon={Wallet} iconColor="#3b82f6" index={0} />
            <StatCard label="P&L du jour" value={(todayPnl >= 0 ? "+" : "") + formatCurrency(todayPnl)} change={todayPnlPct} changeLabel="aujourd'hui" icon={Activity} iconColor="#a78bfa" index={1} />
            <StatCard label="P&L total" value={(totalPnl >= 0 ? "+" : "") + formatCurrency(totalPnl)} change={totalPnlPct} changeLabel="depuis le début" icon={TrendingUp} iconColor="#22c55e" index={2} />
            <StatCard label="Valeur du portefeuille" value={formatCurrency(totalValue)} change={todayPnlPct} changeLabel="vs hier" icon={BarChart2} iconColor="#f59e0b" index={3} />
          </div>
        </section>

        {/* ─── Chart + Allocation ─────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Performance chart */}
          <section className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <SectionHeader title="Évolution du patrimoine" description="Valeur nette historique" />
              <div className="flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150"
                    style={{
                      color: period === p ? "white" : "var(--foreground-dim)",
                      backgroundColor: period === p ? "var(--accent)" : "transparent",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
            >
              <AreaChart data={historySlice} height={220} />
            </div>
          </section>

          {/* Allocation */}
          <section className="lg:col-span-2 space-y-3">
            <SectionHeader title="Répartition" description="Par classe d'actifs" />
            <div
              className="rounded-xl border p-5"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
            >
              {/* Donut */}
              <div className="mb-5 flex justify-center">
                <div className="relative flex h-28 w-28 items-center justify-center">
                  <DonutChart entries={allocationEntries} />
                  <div className="absolute flex flex-col items-center text-center">
                    <span className="text-sm font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
                      {allocationEntries.length}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--foreground-dim)" }}>classes</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                {allocationEntries.map(({ cls, pct }) => (
                  <div key={cls} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }} />
                    <span className="flex-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                      {ASSET_CLASS_LABELS[cls]}
                    </span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ─── Top Holdings + Recent Tx ────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top 5 holdings */}
          <section className="space-y-3">
            <SectionHeader
              title="Top positions"
              description="5 plus grandes positions"
              action={<Link href="/portfolios" className="text-xs hover:text-white transition-colors" style={{ color: "var(--foreground-muted)" }}>Tout voir →</Link>}
            />
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              {top5.map((asset, i) => {
                const pnl = assetPnl(asset)
                const pnlPct = assetPnlPct(asset)
                return (
                  <div key={asset.id} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-zinc-800/30"
                    style={{ borderBottom: i < top5.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style={{ backgroundColor: ASSET_CLASS_COLORS[asset.assetClass] }}
                    >
                      {asset.ticker.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{asset.name}</p>
                      <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>
                        {asset.quantity} × {formatCurrency(asset.currentPrice)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>
                        {formatCurrency(assetValue(asset))}
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
            <SectionHeader
              title="Dernières transactions"
              description="Activité récente"
              action={<Link href="/transactions" className="text-xs hover:text-white transition-colors" style={{ color: "var(--foreground-muted)" }}>Tout voir →</Link>}
            />
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              {recentTx.map((tx, i) => {
                const isBuy = tx.type === "buy"
                const isDiv = tx.type === "dividend"
                const color = isBuy ? "#22c55e" : isDiv ? "#f59e0b" : "#ef4444"
                const label = isBuy ? "Achat" : isDiv ? "Dividende" : tx.type === "sell" ? "Vente" : "Transfert"
                return (
                  <div key={tx.id} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-zinc-800/30"
                    style={{ borderBottom: i < recentTx.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style={{ backgroundColor: `${color}18`, color }}
                    >
                      {tx.ticker.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{tx.assetName}</p>
                      <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>
                        {label} · {new Date(tx.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}
                      </p>
                    </div>
                    <p className="text-xs font-semibold tabular-nums" style={{ color }}>
                      {isBuy ? "-" : "+"}{formatCurrency(tx.quantity * tx.price)}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ─── Mini SVG Donut ──────────────────────────────────────────────────────────
function DonutChart({ entries }: { entries: { cls: string; pct: number }[] }) {
  const r = 14, cx = 18, cy = 18, stroke = 3.5
  let cumulative = 0
  const circumference = 2 * Math.PI * r

  return (
    <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      {entries.map(({ cls, pct }) => {
        const dash = (pct / 100) * circumference
        const offset = (1 - cumulative / 100) * circumference
        cumulative += pct
        return (
          <circle
            key={cls}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={ASSET_CLASS_COLORS[cls as keyof typeof ASSET_CLASS_COLORS] ?? "#6b7280"}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-circumference + offset}
            strokeLinecap="butt"
          />
        )
      })}
    </svg>
  )
}
