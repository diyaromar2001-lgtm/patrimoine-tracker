"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { AreaChart } from "@/components/charts/area-chart"
import { formatCurrency } from "@/lib/utils"
import { Calculator, TrendingUp, PiggyBank, Percent, Calendar } from "lucide-react"
import type { PortfolioSnapshot } from "@/lib/types"

function computeDCA(monthly: number, years: number, annualReturn: number, startYear: number): PortfolioSnapshot[] {
  const months = years * 12
  const monthlyRate = annualReturn / 100 / 12
  const snapshots: PortfolioSnapshot[] = []
  let value = 0
  for (let m = 0; m <= months; m++) {
    if (m > 0) value = (value + monthly) * (1 + monthlyRate)
    const date = new Date(startYear, m % 12, 1)
    const year = startYear + Math.floor(m / 12)
    if (m === 0 || m % 3 === 0) {
      snapshots.push({ date: `${year}-${String((m % 12) + 1).padStart(2, "0")}-01`, value: Math.round(value) })
    }
  }
  return snapshots
}

export default function DCACalculatorPage() {
  const [monthly, setMonthly] = useState(500)
  const [years, setYears] = useState(10)
  const [annualReturn, setAnnualReturn] = useState(8)
  const [initialAmount, setInitialAmount] = useState(0)

  const startYear = new Date().getFullYear()

  const results = useMemo(() => {
    const monthlyRate = annualReturn / 100 / 12
    const months = years * 12

    // Future value of initial lump sum
    const fvInitial = initialAmount * Math.pow(1 + monthlyRate, months)

    // Future value of monthly contributions
    const fvMonthly = monthlyRate === 0
      ? monthly * months
      : monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)

    const totalValue     = fvInitial + fvMonthly
    const totalInvested  = initialAmount + monthly * months
    const profit         = totalValue - totalInvested
    const profitPct      = totalInvested > 0 ? (profit / totalInvested) * 100 : 0
    const cagr           = totalInvested > 0 ? (Math.pow(totalValue / totalInvested, 1 / years) - 1) * 100 : 0

    return { totalValue, totalInvested, profit, profitPct, cagr }
  }, [monthly, years, annualReturn, initialAmount])

  const chartData = useMemo(() => computeDCA(monthly, years, annualReturn, startYear), [monthly, years, annualReturn, startYear])
  const investedData = useMemo<PortfolioSnapshot[]>(() => {
    return Array.from({ length: years * 4 + 1 }, (_, i) => {
      const m = i * 3
      const yr = startYear + Math.floor(m / 12)
      const mo = m % 12
      return { date: `${yr}-${String(mo + 1).padStart(2, "0")}-01`, value: initialAmount + monthly * m }
    })
  }, [monthly, years, initialAmount, startYear])

  const sliders = [
    { label: "Investissement mensuel", key: "monthly", min: 50, max: 5000, step: 50, value: monthly, format: (v: number) => formatCurrency(v), setter: setMonthly },
    { label: "Durée", key: "years", min: 1, max: 40, step: 1, value: years, format: (v: number) => `${v} ans`, setter: setYears },
    { label: "Rendement annuel espéré", key: "annualReturn", min: 1, max: 20, step: 0.5, value: annualReturn, format: (v: number) => `${v}%`, setter: setAnnualReturn },
    { label: "Capital de départ", key: "initialAmount", min: 0, max: 50000, step: 500, value: initialAmount, format: (v: number) => formatCurrency(v), setter: setInitialAmount },
  ]

  return (
    <div className="flex flex-col">
      <Topbar title="Calculateur DCA" subtitle="Simulez votre stratégie d'investissement régulier" />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
          {/* Controls */}
          <div className="lg:col-span-2 space-y-5">
            <SectionHeader title="Paramètres" description="Ajustez votre simulation" />
            <div className="rounded-xl border p-5 space-y-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              {sliders.map(s => (
                <div key={s.key}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>{s.label}</label>
                    <span className="text-sm font-bold tabular-nums" style={{ color: "var(--foreground)" }}>{s.format(s.value)}</span>
                  </div>
                  <input type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                    onChange={e => s.setter(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: "#3b82f6", backgroundColor: "var(--border)" }} />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px]" style={{ color: "var(--foreground-dim)" }}>{s.format(s.min)}</span>
                    <span className="text-[10px]" style={{ color: "var(--foreground-dim)" }}>{s.format(s.max)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-3 space-y-5">
            <SectionHeader title="Résultats" description={`Dans ${years} ans à ${annualReturn}% de rendement annuel`} />

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Valeur finale estimée", value: formatCurrency(results.totalValue), icon: TrendingUp, color: "#22c55e", big: true },
                { label: "Total investi", value: formatCurrency(results.totalInvested), icon: PiggyBank, color: "#3b82f6", big: false },
                { label: "Plus-value", value: (results.profit >= 0 ? "+" : "") + formatCurrency(results.profit), icon: Calculator, color: results.profit >= 0 ? "#22c55e" : "#ef4444", big: false },
                { label: "Performance totale", value: (results.profitPct >= 0 ? "+" : "") + results.profitPct.toFixed(1) + "%", icon: Percent, color: results.profitPct >= 0 ? "#22c55e" : "#ef4444", big: false },
              ].map(({ label, value, icon: Icon, color, big }) => (
                <motion.div key={label} layout className={`rounded-xl border p-4 ${big ? "col-span-2" : ""}`} style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                    <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{label}</p>
                  </div>
                  <p className={big ? "text-3xl font-bold tabular-nums" : "text-lg font-bold tabular-nums"} style={{ color }}>{value}</p>
                  {big && <p className="text-xs mt-1" style={{ color: "var(--foreground-dim)" }}>CAGR effectif: {results.cagr.toFixed(2)}%</p>}
                </motion.div>
              ))}
            </div>

            {/* Chart */}
            <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <p className="text-xs font-medium mb-3" style={{ color: "var(--foreground-muted)" }}>Évolution de la valeur du portefeuille</p>
              <AreaChart data={chartData} height={200} />
            </div>

            {/* Summary table */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Projection par étape</p>
              </div>
              {[1, 2, 5, 10, 15, 20].filter(y => y <= years).map(y => {
                const m = y * 12
                const r = annualReturn / 100 / 12
                const fvInit = initialAmount * Math.pow(1 + r, m)
                const fvMo   = r === 0 ? monthly * m : monthly * ((Math.pow(1 + r, m) - 1) / r)
                const val    = fvInit + fvMo
                const inv    = initialAmount + monthly * m
                return (
                  <div key={y} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-zinc-800/20" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />
                      <span className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>An {y} ({new Date().getFullYear() + y})</span>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>Investi</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--foreground-muted)" }}>{formatCurrency(inv)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>Valeur</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: "#22c55e" }}>{formatCurrency(val)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}