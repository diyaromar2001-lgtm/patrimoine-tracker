"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { formatCurrency } from "@/lib/utils"
import { Calculator, TrendingUp, PiggyBank, Percent, Calendar, ToggleLeft, ToggleRight } from "lucide-react"

// ─── Compute DCA value at each quarter ───────────────────────────────────────
function computePoints(monthly: number, years: number, rate: number, initial: number, brokerFee: number, inflation: number, startYear: number) {
  const months    = years * 12
  const mr        = rate / 100 / 12
  const infl      = inflation / 100 / 12
  const totalFees = (months * brokerFee)

  const dcaPts:  Array<{ date: string; value: number; invested: number }> = []
  const lumpPts: Array<{ date: string; value: number }> = []

  let dcaVal   = initial
  let lumpVal  = initial + monthly * months

  for (let m = 0; m <= months; m++) {
    if (m > 0) {
      dcaVal = (dcaVal + monthly) * (1 + mr)
      lumpVal = lumpVal * (1 + mr)
    }
    if (m % 3 === 0) {
      const yr  = startYear + Math.floor(m / 12)
      const mo  = m % 12 + 1
      const date = `${yr}-${String(mo).padStart(2, "0")}-01`
      const realDca  = infl > 0 ? dcaVal / Math.pow(1 + infl, m) : dcaVal
      const realLump = infl > 0 ? lumpVal / Math.pow(1 + infl, m) : lumpVal
      dcaPts.push({ date, value: Math.round(realDca), invested: initial + monthly * m })
      lumpPts.push({ date, value: Math.round(realLump) })
    }
  }

  const finalDca  = dcaPts[dcaPts.length - 1]?.value ?? 0
  const totalInv  = initial + monthly * months
  const finalLump = lumpPts[lumpPts.length - 1]?.value ?? 0

  return {
    dcaPts, lumpPts,
    finalDca:   finalDca - totalFees,
    finalLump,
    totalInvested: totalInv,
    totalFees,
    profit:    finalDca - totalFees - totalInv,
    profitPct: totalInv > 0 ? ((finalDca - totalFees - totalInv) / totalInv) * 100 : 0,
    cagr:      totalInv > 0 ? (Math.pow((finalDca - totalFees) / totalInv, 1 / years) - 1) * 100 : 0,
    lumpProfit: finalLump - totalInv,
  }
}

// ─── Lightweight-charts dual-line component ───────────────────────────────────
function DCAChart({ dcaData, lumpData, height = 200 }: {
  dcaData: Array<{ date: string; value: number }>
  lumpData: Array<{ date: string; value: number }>
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts")["createChart"]> | null>(null)

  useEffect(() => {
    if (!ref.current || !dcaData.length) return
    import("lightweight-charts").then(({ createChart, AreaSeries, LineSeries }) => {
      if (!ref.current) return
      chartRef.current?.remove()
      const chart = createChart(ref.current!, {
        width: ref.current!.clientWidth, height,
        layout: { background: { color: "transparent" }, textColor: "#a1a1aa", fontSize: 11, fontFamily: "Inter, ui-sans-serif" },
        grid: { vertLines: { color: "#27272a" }, horzLines: { color: "#27272a" } },
        crosshair: { vertLine: { color: "#3b82f660", width: 1, labelBackgroundColor: "#18181b" }, horzLine: { color: "#3b82f660", width: 1, labelBackgroundColor: "#18181b" } },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: { borderColor: "#27272a", timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
        handleScroll: false, handleScale: false,
      })
      const dcaSeries = chart.addSeries(AreaSeries, { lineColor: "#22c55e", topColor: "#22c55e33", bottomColor: "#22c55e00", lineWidth: 2, priceLineVisible: false, lastValueVisible: true })
      const lumpSeries = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: "Lump Sum" })
      dcaSeries.setData(dcaData.map(d => ({ time: d.date as `${number}-${number}-${number}`, value: d.value })))
      lumpSeries.setData(lumpData.map(d => ({ time: d.date as `${number}-${number}-${number}`, value: d.value })))
      chart.timeScale().fitContent()
      chartRef.current = chart
      const ro = new ResizeObserver(() => ref.current && chart.applyOptions({ width: ref.current.clientWidth }))
      ro.observe(ref.current!)
    })
    return () => { chartRef.current?.remove(); chartRef.current = null }
  }, [dcaData, lumpData, height])

  return <div ref={ref} style={{ width: "100%", height }} />
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DCACalculatorPage() {
  const [monthly,      setMonthly]      = useState(500)
  const [years,        setYears]        = useState(10)
  const [annualReturn, setAnnualReturn] = useState(8)
  const [initial,      setInitial]      = useState(0)
  const [brokerFee,    setBrokerFee]    = useState(1)
  const [inflation,    setInflation]    = useState(0)
  const [showInflation, setShowInflation] = useState(false)
  // Deux situations distinctes — comparer un épargnant mensuel à un
  // investisseur qui possède déjà tout le capital serait trompeur.
  const [mode, setMode] = useState<"save" | "capital">("save")
  const startYear = new Date().getFullYear()

  const res = useMemo(() =>
    computePoints(monthly, years, annualReturn, initial, brokerFee, showInflation ? inflation : 0, startYear),
    [monthly, years, annualReturn, initial, brokerFee, inflation, showInflation, startYear]
  )

  const sliders = [
    { label: "Investissement mensuel", min: 50,  max: 5000,  step: 50,  value: monthly,      fmt: (v: number) => formatCurrency(v), set: setMonthly },
    { label: "Durée",                  min: 1,   max: 40,    step: 1,   value: years,        fmt: (v: number) => `${v} ans`,        set: setYears },
    { label: "Rendement annuel (%)",   min: 1,   max: 20,    step: 0.5, value: annualReturn, fmt: (v: number) => `${v}%`,           set: setAnnualReturn },
    { label: "Capital initial",        min: 0,   max: 50000, step: 500, value: initial,      fmt: (v: number) => formatCurrency(v), set: setInitial },
    { label: "Frais courtier / ordre", min: 0,   max: 20,    step: 0.5, value: brokerFee,    fmt: (v: number) => `${v.toFixed(1)} €`, set: setBrokerFee },
  ]

  return (
    <div className="flex flex-col">
      <Topbar title="Calculateur DCA" subtitle="Simulez et comparez vos stratégies d'investissement" />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">

          {/* ─── Controls ─── */}
          <div className="lg:col-span-2 space-y-4">
            <SectionHeader title="Paramètres" description="Ajustez votre simulation" />

            {/* Choix du mode — détermine si la comparaison Lump Sum a du sens */}
            <div className="rounded-xl border p-1.5 grid grid-cols-1 gap-1"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              {([
                ["save", "J'épargne chaque mois", "Projection de versements réguliers — pas de comparaison trompeuse"],
                ["capital", "Je possède déjà le capital", "Comparer : tout investir maintenant vs étaler le même capital"],
              ] as const).map(([m, label, desc]) => (
                <button key={m} onClick={() => setMode(m)}
                  className="rounded-lg px-3.5 py-2.5 text-left transition-colors"
                  style={{
                    backgroundColor: mode === m ? "var(--bg-subtle)" : "transparent",
                    border: `1px solid ${mode === m ? "var(--accent)" : "transparent"}`,
                  }}>
                  <p className="text-sm font-semibold" style={{ color: mode === m ? "var(--text-primary)" : "var(--text-secondary)" }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                </button>
              ))}
            </div>
            <div className="rounded-xl border p-5 space-y-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              {sliders.map(s => (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{s.label}</label>
                    <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{s.fmt(s.value)}</span>
                  </div>
                  <input type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                    onChange={e => s.set(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: "#3b82f6" }} />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{s.fmt(s.min)}</span>
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{s.fmt(s.max)}</span>
                  </div>
                </div>
              ))}

              {/* Inflation toggle */}
              <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Ajustement inflation</p>
                    <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Affiche les rendements en valeur réelle</p>
                  </div>
                  <button onClick={() => setShowInflation(v => !v)} className="transition-colors">
                    {showInflation
                      ? <ToggleRight className="h-6 w-6" style={{ color: "var(--accent)" }} />
                      : <ToggleLeft  className="h-6 w-6" style={{ color: "var(--text-tertiary)" }} />
                    }
                  </button>
                </div>
                {showInflation && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Inflation annuelle</label>
                      <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{inflation}%</span>
                    </div>
                    <input type="range" min={0} max={10} step={0.5} value={inflation}
                      onChange={e => setInflation(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#ef4444" }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Results ─── */}
          <div className="lg:col-span-3 space-y-4">
            <SectionHeader title="Résultats" description={`${years} ans à ${annualReturn}% · frais ${brokerFee.toFixed(1)}€/ordre${showInflation ? ` · inflation ${inflation}%` : ""}`} />

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              <motion.div layout className="col-span-2 rounded-xl border p-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-3.5 w-3.5" style={{ color: "#22c55e" }} />
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Valeur finale DCA</p>
                </div>
                <p className="text-3xl font-bold tabular-nums" style={{ color: "#22c55e" }}>{formatCurrency(res.finalDca)}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                  CAGR {res.cagr.toFixed(2)}% · frais totaux {formatCurrency(res.totalFees)} {showInflation ? "· valeur réelle" : "· valeur nominale"}
                </p>
              </motion.div>

              {[
                { label: "Total investi", value: formatCurrency(res.totalInvested), icon: PiggyBank, color: "#3b82f6" },
                { label: "Plus-value nette", value: (res.profit >= 0 ? "+" : "") + formatCurrency(res.profit), icon: Calculator, color: res.profit >= 0 ? "#22c55e" : "#ef4444" },
                { label: "Performance", value: (res.profitPct >= 0 ? "+" : "") + res.profitPct.toFixed(1) + "%", icon: Percent, color: res.profitPct >= 0 ? "#22c55e" : "#ef4444" },
                // La comparaison Lump Sum n'a de sens que si le capital existe déjà
                ...(mode === "capital"
                  ? [{ label: "Tout investi immédiatement", value: formatCurrency(res.finalLump), icon: Calculator, color: "#f59e0b" }]
                  : []),
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</p>
                  </div>
                  <p className="text-lg font-bold tabular-nums" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Graphique — comparaison seulement en mode « capital disponible » */}
            <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {mode === "capital" ? "Étalement (DCA) vs tout investir immédiatement" : "Projection de votre épargne mensuelle"}
                </p>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#22c55e" }}>
                    <span className="h-2 w-4 rounded-full inline-block" style={{ backgroundColor: "#22c55e" }} /> DCA
                  </span>
                  {mode === "capital" && (
                    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#f59e0b" }}>
                      <span className="h-0.5 w-4 inline-block border-t-2 border-dashed" style={{ borderColor: "#f59e0b" }} /> Investissement immédiat
                    </span>
                  )}
                </div>
              </div>
              <DCAChart dcaData={res.dcaPts} lumpData={mode === "capital" ? res.lumpPts : []} height={200} />
            </div>

            {/* Hypothèses — affichées explicitement, projection non garantie */}
            <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Hypothèses de la simulation</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Rendement constant de {annualReturn} %/an (les marchés réels fluctuent) · frais de {brokerFee.toFixed(1)}/ordre ·
                {showInflation ? ` inflation ${inflation} %/an (valeurs réelles) ·` : " valeurs nominales ·"} fiscalité non incluse ·
                {mode === "capital" ? " « investissement immédiat » suppose que tout le capital est disponible dès aujourd'hui ·" : ""}
                {" "}projection indicative, non garantie.
              </p>
            </div>

            {/* Projection table */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Projection annuelle</p>
              </div>
              {[1, 2, 5, 10, 15, 20, 30].filter(y => y <= years).map(y => {
                const snap = res.dcaPts.find(p => p.date.startsWith((startYear + y).toString() + "-01"))
                  ?? res.dcaPts[res.dcaPts.length - 1]
                return (
                  <div key={y} className="flex items-center justify-between px-5 py-2.5 transition-colors hover:bg-zinc-800/20"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
                      <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>An {y} ({startYear + y})</span>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Investi</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>{formatCurrency(snap?.invested ?? 0)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Valeur DCA</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: "#22c55e" }}>{formatCurrency(snap?.value ?? 0)}</p>
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
