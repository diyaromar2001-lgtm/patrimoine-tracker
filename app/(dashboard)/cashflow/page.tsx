"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import type { AppCurrency } from "@/lib/utils"
import { PeriodSelector } from "@/components/ui/period-selector"
import { MetricCard } from "@/components/ui/metric-card"
import { SankeyCashflow, type SankeyNode } from "@/components/charts/sankey-cashflow"
import {
  aggregateCashflow, movementsForMonth,
  CASHFLOW_CATEGORY_LABELS,
  type CashflowCategory, type MonthlyCashflow,
} from "@/lib/cashflow"
import { classifyMovement } from "@/lib/cashflow"
import {
  ArrowDownUp, ArrowDownLeft, ArrowUpRight, PiggyBank, Percent,
  Landmark, TrendingUp, Coins, Wallet, Receipt, ShoppingCart, BadgeDollarSign,
} from "lucide-react"

// ─── Couleurs / icônes par catégorie ─────────────────────────────────────────
const CATEGORY_COLORS: Record<CashflowCategory, string> = {
  deposits:    "#3b82f6",
  withdrawals: "#f97316",
  dividends:   "#22c55e",
  interest:    "#06b6d4",
  revenus:     "#a855f7",
  buys:        "#64748b",
  sells:       "#eab308",
  fees:        "#ef4444",
}

const CATEGORY_ICONS: Record<CashflowCategory, React.ReactNode> = {
  deposits:    <Landmark className="h-3.5 w-3.5" />,
  withdrawals: <Wallet className="h-3.5 w-3.5" />,
  dividends:   <TrendingUp className="h-3.5 w-3.5" />,
  interest:    <Percent className="h-3.5 w-3.5" />,
  revenus:     <Coins className="h-3.5 w-3.5" />,
  buys:        <ShoppingCart className="h-3.5 w-3.5" />,
  sells:       <BadgeDollarSign className="h-3.5 w-3.5" />,
  fees:        <Receipt className="h-3.5 w-3.5" />,
}

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]

function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7))
  return `${MONTH_LABELS[m - 1] ?? month.slice(5)} ${month.slice(2, 4)}`
}

type Period = "ytd" | "12m" | "all"

// ─── Graphique barres mensuel bilatéral (entrées ↑ / sorties ↓ + net) ────────
function CashflowBarChart({
  months, selected, onSelect, format,
}: {
  months: MonthlyCashflow[]
  selected: string | null
  onSelect: (m: string | null) => void
  format: (v: number) => string
}) {
  const max = Math.max(...months.map(m => Math.max(m.totalIn, m.totalOut)), 1)
  const H = 88 // px par moitié
  return (
    <div className="overflow-x-auto">
      <div className="flex items-stretch gap-1.5" style={{ minWidth: months.length * 34 }}>
        {months.map(m => {
          const inH  = (m.totalIn  / max) * H
          const outH = (m.totalOut / max) * H
          const isSel = selected === m.month
          return (
            <button
              key={m.month}
              onClick={() => onSelect(isSel ? null : m.month)}
              className="group flex-1 flex flex-col items-center gap-1 rounded-lg px-0.5 py-1 transition-colors"
              style={{ backgroundColor: isSel ? "var(--bg-muted)" : "transparent" }}
              title={`${monthLabel(m.month)} — Entrées ${format(m.totalIn)} · Sorties ${format(m.totalOut)} · Net ${format(m.net)}`}
            >
              {/* Entrées (vers le haut) */}
              <div className="w-full flex flex-col justify-end" style={{ height: H }}>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: Math.max(inH, m.totalIn > 0 ? 2 : 0) }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="w-full rounded-t-sm group-hover:opacity-80"
                  style={{ backgroundColor: "var(--gain)" }}
                />
              </div>
              {/* Axe zéro */}
              <div className="w-full h-px" style={{ backgroundColor: "var(--border)" }} />
              {/* Sorties (vers le bas) */}
              <div className="w-full flex flex-col justify-start" style={{ height: H * 0.6 }}>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: Math.max(outH * 0.6, m.totalOut > 0 ? 2 : 0) }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="w-full rounded-b-sm group-hover:opacity-80"
                  style={{ backgroundColor: "var(--loss)" }}
                />
              </div>
              <span className="text-[9px] whitespace-nowrap tabular-nums"
                style={{ color: isSel ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                {monthLabel(m.month)}
              </span>
              {/* Net du mois */}
              <span className="text-[9px] font-semibold tabular-nums"
                style={{ color: m.net >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {m.net >= 0 ? "+" : ""}{Math.round(m.net)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Donut par catégorie ─────────────────────────────────────────────────────
function CategoryDonut({
  data, format,
}: {
  data: Array<{ cat: CashflowCategory; amount: number; pct: number }>
  format: (v: number) => string
}) {
  const r = 14, cx = 18, cy = 18, stroke = 3.5, circ = 2 * Math.PI * r
  let cumulative = 0
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90 flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {data.map(({ cat, pct }) => {
          const dash   = (pct / 100) * circ
          const offset = (1 - cumulative / 100) * circ
          cumulative  += pct
          return (
            <circle key={cat} cx={cx} cy={cy} r={r} fill="none"
              stroke={CATEGORY_COLORS[cat]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-circ + offset}
            />
          )
        })}
      </svg>
      <div className="space-y-1.5 w-full">
        {data.map(({ cat, pct, amount }) => (
          <div key={cat} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {CASHFLOW_CATEGORY_LABELS[cat]}
            </span>
            <span className="text-xs tabular-nums ml-auto" style={{ color: "var(--text-tertiary)" }}>
              {format(amount)}
            </span>
            <span className="text-xs font-semibold tabular-nums w-10 text-right" style={{ color: "var(--text-primary)" }}>
              {pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CashflowPage() {
  const { cashMovements, loading } = useAppData()
  const { format, convert, currency } = useCurrency()

  const [period, setPeriod] = useState<Period>("12m")
  const [includeInvestments, setIncludeInvestments] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  const fromDate = useMemo(() => {
    const now = new Date()
    if (period === "ytd") return `${now.getFullYear()}-01-01`
    if (period === "12m") {
      const d = new Date(now.getFullYear(), now.getMonth() - 11, 1)
      return d.toISOString().slice(0, 10)
    }
    return undefined
  }, [period])

  const summary = useMemo(() =>
    aggregateCashflow(
      cashMovements,
      (amt, cur) => convert(amt, cur as AppCurrency),
      { includeInvestments, fromDate }
    ),
    [cashMovements, convert, includeInvestments, fromDate]
  )

  const donutData = useMemo(() => {
    const total = Object.values(summary.byCategory).reduce((s, v) => s + (v ?? 0), 0)
    return (Object.entries(summary.byCategory) as Array<[CashflowCategory, number]>)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, amount]) => ({ cat, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
  }, [summary.byCategory])

  // ── Données du diagramme de Sankey (sources → flux → emplois → détail) ────
  const sankey = useMemo(() => {
    // Totaux entrées/sorties par catégorie sur la période
    const inflow: Partial<Record<CashflowCategory, number>> = {}
    const outflow: Partial<Record<CashflowCategory, number>> = {}
    for (const m of summary.months) {
      for (const [cat, v] of Object.entries(m.inflows)) inflow[cat as CashflowCategory] = (inflow[cat as CashflowCategory] ?? 0) + (v ?? 0)
      for (const [cat, v] of Object.entries(m.outflows)) outflow[cat as CashflowCategory] = (outflow[cat as CashflowCategory] ?? 0) + (v ?? 0)
    }

    const sources: SankeyNode[] = (Object.entries(inflow) as Array<[CashflowCategory, number]>)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, v]) => ({ id: cat, label: CASHFLOW_CATEGORY_LABELS[cat], value: v, color: CATEGORY_COLORS[cat] }))

    // Ventilation des achats par actif (détail 4e colonne, top 8 + Autres)
    const buysByTicker: Record<string, number> = {}
    for (const m of cashMovements) {
      if (m.type !== "buy_deduction") continue
      if (fromDate && m.date < fromDate) continue
      const v = Math.abs(convert(m.amount, (m.currency || "CHF") as AppCurrency))
      const key = m.refTicker || "Autres"
      buysByTicker[key] = (buysByTicker[key] ?? 0) + v
    }
    const buyEntries = Object.entries(buysByTicker).sort(([, a], [, b]) => b - a)
    const topBuys = buyEntries.slice(0, 8)
    const restBuys = buyEntries.slice(8).reduce((s, [, v]) => s + v, 0)
    const buyChildren = [
      ...topBuys.map(([t, v], i) => ({ label: t, value: v, color: ["#6366f1", "#818cf8", "#a855f7", "#0ea5e9", "#22c55e", "#eab308", "#f97316", "#64748b"][i % 8] })),
      ...(restBuys > 0 ? [{ label: "Autres", value: restBuys, color: "#64748b" }] : []),
    ]

    const uses: SankeyNode[] = (Object.entries(outflow) as Array<[CashflowCategory, number]>)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, v]) => ({
        id: cat, label: CASHFLOW_CATEGORY_LABELS[cat], value: v, color: CATEGORY_COLORS[cat],
        children: cat === "buys" && includeInvestments && buyChildren.length > 1 ? buyChildren : undefined,
      }))

    // Équilibre du diagramme : épargne nette à droite (ou puisée à gauche)
    if (summary.net > 0.005) {
      uses.push({ id: "savings", label: "Épargne nette", value: summary.net, color: "#22c55e" })
    } else if (summary.net < -0.005) {
      sources.push({ id: "drawdown", label: "Puisé sur l'épargne", value: -summary.net, color: "#f97316" })
    }

    return { sources, uses }
  }, [summary, cashMovements, fromDate, convert, includeInvestments])

  const drilldown = useMemo(() =>
    selectedMonth
      ? movementsForMonth(cashMovements, selectedMonth, { includeInvestments })
      : [],
    [cashMovements, selectedMonth, includeInvestments]
  )

  const savingsFormula = includeInvestments
    ? "Formule : (entrées − sorties) ÷ entrées, achats/ventes inclus (toggle actif). Les conversions internes entre devises sont toujours exclues."
    : "Formule : (entrées − sorties) ÷ entrées, sur les flux externes uniquement (dépôts, retraits, dividendes, intérêts, frais). Les achats/ventes de titres et les conversions internes sont exclus."

  const kpis = [
    { label: "Entrées",        value: format(summary.totalIn),  icon: <ArrowDownLeft className="h-4 w-4" />, color: "var(--gain)", title: undefined as string | undefined },
    { label: "Sorties",        value: format(summary.totalOut), icon: <ArrowUpRight className="h-4 w-4" />,  color: "var(--loss)", title: undefined },
    { label: "Net",            value: `${summary.net >= 0 ? "+" : ""}${format(summary.net)}`, icon: <ArrowDownUp className="h-4 w-4" />, color: summary.net >= 0 ? "var(--gain)" : "var(--loss)", title: undefined },
    { label: "Taux d'épargne", value: `${summary.savingsRatePct.toFixed(1)} %`, icon: <PiggyBank className="h-4 w-4" />, color: "var(--accent)", title: savingsFormula },
  ]

  return (
    <div className="flex flex-col">
      <Topbar title="Cashflow" subtitle="Flux de trésorerie mensuels" />
      <div className="flex-1 space-y-5 p-4 sm:p-6">

        {/* ─── Filtres ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodSelector
            size="md"
            options={[
              { value: "ytd", label: "YTD" },
              { value: "12m", label: "12 mois" },
              { value: "all", label: "Tout" },
            ]}
            value={period}
            onChange={(p) => { setPeriod(p); setSelectedMonth(null) }}
          />

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Inclure achats / ventes
            </span>
            <button
              role="switch"
              aria-checked={includeInvestments}
              onClick={() => setIncludeInvestments(v => !v)}
              className="relative h-5 w-9 rounded-full transition-colors"
              style={{ backgroundColor: includeInvestments ? "var(--accent)" : "var(--border)" }}
            >
              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                style={{ left: includeInvestments ? "18px" : "2px" }} />
            </button>
          </label>
        </div>

        {/* ─── KPIs ─── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map(k => (
            <div key={k.label} title={k.title}>
              <MetricCard label={k.label} value={k.value}
                icon={k.icon} iconColor={k.color} valueColor={k.color}
                sub={k.title ? "survolez pour la formule" : undefined} />
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Chargement…</p>
          </div>
        ) : summary.months.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <ArrowDownUp className="mx-auto mb-3 h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Aucun flux sur la période</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Les dépôts, retraits, dividendes et intérêts apparaissent ici automatiquement.
            </p>
          </div>
        ) : (
          <>
            {/* ─── Graphique mensuel ─── */}
            <div className="rounded-2xl border p-5"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Entrées / sorties par mois</h3>
                  <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    Cliquez sur un mois pour voir le détail · montants en {currency}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--gain)" }} /> Entrées</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--loss)" }} /> Sorties</span>
                </div>
              </div>
              <CashflowBarChart
                months={summary.months}
                selected={selectedMonth}
                onSelect={setSelectedMonth}
                format={format}
              />
            </div>

            {/* ─── Origine et destination des flux (Sankey, secondaire) ─── */}
            {(sankey.sources.length > 0 || sankey.uses.length > 0) && (
              <details className="rounded-2xl border overflow-hidden"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                <summary className="cursor-pointer select-none px-5 py-3.5 list-none">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Origine et destination des flux
                  </span>
                  <span className="ml-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
                    diagramme détaillé · cliquer pour afficher
                  </span>
                </summary>
                <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: "var(--border-subtle)" }}>
                  <p className="mb-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Sources → flux de la période → emplois
                    {includeInvestments ? " · achats ventilés par actif" : " · activez « inclure achats / ventes » pour le détail par actif"}
                  </p>
                  <SankeyCashflow
                    sources={sankey.sources}
                    hubLabel="Flux de la période"
                    uses={sankey.uses}
                    format={format}
                  />
                </div>
              </details>
            )}

            {/* ─── Drill-down mensuel ─── */}
            <AnimatePresence>
              {selectedMonth && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden rounded-2xl border"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      Détail — {monthLabel(selectedMonth)}
                    </h3>
                    <button onClick={() => setSelectedMonth(null)} className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      Fermer
                    </button>
                  </div>
                  <div>
                    {drilldown.map((m, i) => {
                      const cat = classifyMovement(m)
                      if (!cat) return null
                      const converted = convert(m.amount, (m.currency || "CHF") as AppCurrency)
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-5 py-3"
                          style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{ backgroundColor: CATEGORY_COLORS[cat] + "20", color: CATEGORY_COLORS[cat] }}>
                            {CATEGORY_ICONS[cat]}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                              {CASHFLOW_CATEGORY_LABELS[cat]}{m.refTicker ? ` · ${m.refTicker}` : ""}
                            </p>
                            <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                              {m.date}{m.note ? ` · ${m.note}` : ""}
                            </p>
                          </div>
                          <span className="text-sm font-semibold tabular-nums flex-shrink-0"
                            style={{ color: converted >= 0 ? "var(--gain)" : "var(--loss)" }}>
                            {converted >= 0 ? "+" : ""}{format(converted)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ─── Répartition par catégorie ─── */}
            <div className="rounded-2xl border p-5"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Répartition par catégorie
              </h3>
              <CategoryDonut data={donutData} format={format} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
