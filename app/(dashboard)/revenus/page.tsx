"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { ChangeBadge } from "@/components/ui/badge"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { TransactionModal, type TransactionFormData } from "@/components/ui/transaction-modal"
import {
  REVENU_TYPE_META,
  type RevenuType, type RevenuAnnexe,
} from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import type { AppCurrency } from "@/lib/utils"
import {
  Plus, Trash2, CalendarDays, TrendingUp, Zap, Award, BarChart2,
} from "lucide-react"

// ─── Simple monthly bar chart (SVG) ───────────────────────────────────────────
function MonthlyBarChart({
  data,
}: {
  data: Array<{ month: string; dividends: number; revenus: number }>
}) {
  const max = Math.max(...data.map(d => d.dividends + d.revenus), 1)
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => {
        const total  = d.dividends + d.revenus
        const pct    = (total / max) * 100
        const divPct = (d.dividends / max) * 100
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col justify-end" style={{ height: "112px" }}>
              <div className="w-full rounded-t-sm" style={{ height: `${(d.revenus / max) * 100}%`, backgroundColor: "#a855f7" }} />
              <div className="w-full" style={{ height: `${(d.dividends / max) * 100}%`, backgroundColor: "#22c55e" }} />
            </div>
            <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
              {d.month}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Donut chart for revenus by type ─────────────────────────────────────────
function RevenuDonut({ data }: { data: Array<{ type: RevenuType; amount: number; pct: number }> }) {
  const r = 14, cx = 18, cy = 18, stroke = 3.5, circ = 2 * Math.PI * r
  let cumulative = 0
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {data.map(({ type, pct }) => {
          const dash   = (pct / 100) * circ
          const offset = (1 - cumulative / 100) * circ
          cumulative  += pct
          return (
            <circle key={type} cx={cx} cy={cy} r={r} fill="none"
              stroke={REVENU_TYPE_META[type]?.color ?? "#a855f7"}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-circ + offset}
            />
          )
        })}
      </svg>
      <div className="space-y-1.5">
        {data.map(({ type, pct, amount }) => (
          <div key={type} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: REVENU_TYPE_META[type]?.color }} />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {REVENU_TYPE_META[type]?.icon} {REVENU_TYPE_META[type]?.label}
            </span>
            <span className="text-xs font-semibold tabular-nums ml-auto" style={{ color: "var(--text-primary)" }}>
              {pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function RevenusPage() {
  const { revenus, portfolios, globalCash, cashMovements, addRevenu, removeRevenu, depositGlobalCash, withdrawGlobalCash, convertGlobalCash } = useAppData()
  const { format, convert, fxRates, currency } = useCurrency()

  const [activeTab, setActiveTab] = useState<"liquidite" | "revenus" | "dividends">("liquidite")
  const [showModal, setShowModal] = useState(false)

  // ── États de l'onglet Liquidité (top-level — règle des hooks) ──────────────
  const [showDepositModal,  setShowDepositModal]  = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [showConvertModal,  setShowConvertModal]  = useState(false)
  const [actionAmount,      setActionAmount]      = useState("")
  const [actionCurrency,    setActionCurrency]    = useState<"CHF"|"USD"|"EUR">("CHF")
  const [actionToCurrency,  setActionToCurrency]  = useState<"CHF"|"USD"|"EUR">("USD")
  const [actionError,       setActionError]       = useState("")
  const [actionNote,        setActionNote]        = useState("")

  // Total in CHF
  const totalCHF = useMemo(() =>
    revenus.reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0),
    [revenus, convert]
  )

  const today      = new Date()
  const thisMonth  = revenus.filter(r => new Date(r.date).getMonth() === today.getMonth() && new Date(r.date).getFullYear() === today.getFullYear())
  const monthTotal = thisMonth.reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0)

  // Average monthly (over last 12 months)
  const monthlyAvg = revenus.length ? totalCHF / Math.max(
    new Set(revenus.map(r => r.date.slice(0, 7))).size, 1
  ) : 0

  // Best platform
  const byPlatform = revenus.reduce<Record<string, number>>((acc, r) => {
    const pl = r.platform ?? "Autre"
    acc[pl] = (acc[pl] ?? 0) + convert(r.amount, (r.currency || "CHF") as AppCurrency)
    return acc
  }, {})
  const bestPlatform = Object.entries(byPlatform).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "—"

  // By type for donut
  const byType = Object.entries(
    revenus.reduce<Record<string, number>>((acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + convert(r.amount, (r.currency || "CHF") as AppCurrency)
      return acc
    }, {})
  ).map(([type, amount]) => ({
    type: type as RevenuType,
    amount,
    pct: totalCHF > 0 ? (amount / totalCHF) * 100 : 0,
  })).sort((a, b) => b.amount - a.amount)

  // Monthly bar data (last 12 months)
  const MONTHS_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"]
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const d   = new Date(); d.setMonth(d.getMonth() - (11 - i))
    const key = d.toISOString().slice(0, 7)
    const rev = revenus.filter(r => r.date.startsWith(key))
      .reduce((s, r) => s + convert(r.amount, (r.currency || "CHF") as AppCurrency), 0)
    return { month: MONTHS_SHORT[d.getMonth()], dividends: 0, revenus: rev }
  })

  async function handleSave(form: TransactionFormData) {
    if (!form.revenuType) return
    await addRevenu({
      type:        form.revenuType,
      label:       form.ticker,
      amount:      parseFloat(form.price),
      currency:    form.nativeCurrency || "CHF",
      platform:    form.platform || undefined,
      portfolioId: form.portfolioId || undefined,
      date:        form.date,
      notes:       form.notes || undefined,
    })
    setShowModal(false)
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Revenus Passifs" subtitle="Liquidité · Dividendes · Revenus annexes" />
      <div className="flex-1 space-y-5 p-4 sm:p-6">

        {/* ─── Tabs ─── */}
        <div className="flex gap-1 rounded-xl border p-1" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-elevated)", width: "fit-content" }}>
          {([
            ["liquidite", "💵 Liquidité",      "#0ea5e9"],
            ["revenus",   "💜 Revenus annexes", "#a855f7"],
            ["dividends", "💚 Dividendes",      "#22c55e"],
          ] as const).map(([tab, label, color]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
              style={{
                backgroundColor: activeTab === tab ? color : "transparent",
                color:           activeTab === tab ? "white" : "var(--text-secondary)",
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* ══ ONGLET LIQUIDITÉ ══════════════════════════════════════════════ */}
        {activeTab === "liquidite" && (() => {
          const fxUsd = (fxRates as Record<string,number>)["USD"] ?? 1
          const fxEur = (fxRates as Record<string,number>)["EUR"] ?? 1
          const totalChf = globalCash.CHF + globalCash.USD / fxUsd + globalCash.EUR / fxEur
          const userRate = (fxRates as Record<string,number>)[currency] ?? 1
          const totalUser = totalChf * userRate

          const MOVEMENT_LABELS: Record<string, string> = {
            deposit:         "Dépôt",
            withdrawal:      "Retrait",
            conversion:      "Conversion",
            buy_deduction:   "Achat (déduction)",
            sell_credit:     "Vente (crédit)",
            dividend_credit: "Dividende reçu",
            revenue_credit:  "Revenu annexe",
          }
          const MOVEMENT_COLORS: Record<string, string> = {
            deposit:         "#0ea5e9",
            withdrawal:      "#ef4444",
            conversion:      "#f59e0b",
            buy_deduction:   "#a78bfa",
            sell_credit:     "#22c55e",
            dividend_credit: "#22c55e",
            revenue_credit:  "#a855f7",
          }


          return (
            <div className="space-y-5">
              {/* ── KPI Liquidités ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-4 rounded-xl border px-5 py-4 flex items-center justify-between"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: "#0ea5e930" }}>
                  <div>
                    <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: "#0ea5e9" }}>Total liquidités</p>
                    <p className="text-3xl font-bold tabular-nums mt-1" style={{ color: "var(--text-primary)" }}>{format(totalUser)}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                      Commune à tous les portefeuilles · hors positions
                    </p>
                  </div>
                  <div className="text-4xl">💵</div>
                </div>
                {(["CHF","USD","EUR"] as const).map(cur => {
                  const val = globalCash[cur]
                  const inUser = convert(val, cur)
                  return (
                    <div key={cur} className="rounded-xl border px-4 py-3"
                      style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                      <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{cur}</p>
                      <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: val > 0 ? "#0ea5e9" : "var(--text-tertiary)" }}>
                        {val.toFixed(2)}
                      </p>
                      {cur !== currency && val > 0 && (
                        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>≈ {format(inUser)}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ── Action buttons ── */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "＋ Déposer",   color: "#0ea5e9", onClick: () => { setShowDepositModal(true); setShowWithdrawModal(false); setShowConvertModal(false); setActionError("") } },
                  { label: "－ Retirer",   color: "#ef4444", onClick: () => { setShowWithdrawModal(true); setShowDepositModal(false); setShowConvertModal(false); setActionError("") } },
                  { label: "⇄ Convertir",  color: "#f59e0b", onClick: () => { setShowConvertModal(true); setShowDepositModal(false); setShowWithdrawModal(false); setActionError("") } },
                ].map(btn => (
                  <button key={btn.label} onClick={btn.onClick}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
                    style={{ backgroundColor: btn.color }}>
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* ── Mini forms ── */}
              <AnimatePresence>
                {(showDepositModal || showWithdrawModal || showConvertModal) && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className="rounded-xl border p-5 space-y-4"
                    style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {showDepositModal ? "Dépôt de liquidité" : showWithdrawModal ? "Retrait de liquidité" : "Conversion de devises"}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>
                          Montant {showConvertModal ? "à convertir" : ""}
                        </label>
                        <input type="number" placeholder="0.00" value={actionAmount}
                          onChange={e => { setActionAmount(e.target.value); setActionError("") }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                          style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                          autoFocus />
                      </div>
                      <div>
                        <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>
                          {showConvertModal ? "Devise source" : "Devise"}
                        </label>
                        <div className="flex gap-1.5">
                          {(["CHF","USD","EUR"] as const).map(c => (
                            <button key={c} onClick={() => setActionCurrency(c)}
                              className="flex-1 rounded-lg border py-2 text-xs font-semibold transition-all"
                              style={{
                                backgroundColor: actionCurrency === c ? "#0ea5e918" : "var(--bg-base)",
                                borderColor:     actionCurrency === c ? "#0ea5e9" : "var(--border)",
                                color:           actionCurrency === c ? "#0ea5e9" : "var(--text-secondary)",
                              }}>{c}</button>
                          ))}
                        </div>
                      </div>
                      {showConvertModal && (
                        <div className="col-span-2">
                          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Devise cible</label>
                          <div className="flex gap-1.5">
                            {(["CHF","USD","EUR"] as const).filter(c => c !== actionCurrency).map(c => (
                              <button key={c} onClick={() => setActionToCurrency(c)}
                                className="rounded-xl border px-4 py-2 text-sm font-semibold transition-all"
                                style={{
                                  backgroundColor: actionToCurrency === c ? "#f59e0b18" : "var(--bg-base)",
                                  borderColor:     actionToCurrency === c ? "#f59e0b" : "var(--border)",
                                  color:           actionToCurrency === c ? "#f59e0b" : "var(--text-secondary)",
                                }}>{c}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="col-span-2">
                        <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Note (optionnel)</label>
                        <input type="text" placeholder="Ex: virement BCV…" value={actionNote}
                          onChange={e => setActionNote(e.target.value)}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                          style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                      </div>
                    </div>
                    {actionError && (
                      <p className="text-xs rounded-lg px-3 py-2" style={{ backgroundColor: "#ef444415", color: "#ef4444" }}>{actionError}</p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        const amt = parseFloat(actionAmount)
                        if (!amt || amt <= 0) { setActionError("Montant invalide"); return }
                        if (showDepositModal) {
                          await depositGlobalCash(amt, actionCurrency, actionNote || undefined)
                          setShowDepositModal(false)
                        } else if (showWithdrawModal) {
                          const res = await withdrawGlobalCash(amt, actionCurrency, actionNote || undefined)
                          if (!res.ok) { setActionError(res.error ?? "Erreur"); return }
                          setShowWithdrawModal(false)
                        } else if (showConvertModal) {
                          const res = await convertGlobalCash(actionCurrency, actionToCurrency, amt)
                          if (!res.ok) { setActionError(res.error ?? "Erreur"); return }
                          setShowConvertModal(false)
                        }
                        setActionAmount(""); setActionNote("")
                      }}
                        className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-all"
                        style={{ backgroundColor: showDepositModal ? "#0ea5e9" : showWithdrawModal ? "#ef4444" : "#f59e0b" }}>
                        Confirmer
                      </button>
                      <button onClick={() => { setShowDepositModal(false); setShowWithdrawModal(false); setShowConvertModal(false); setActionError("") }}
                        className="rounded-xl border px-4 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
                        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                        Annuler
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Historique des mouvements ── */}
              <div className="space-y-2">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Historique des mouvements ({cashMovements.length})
                </p>
                {cashMovements.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 rounded-xl border"
                    style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucun mouvement enregistré</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>Déposez du cash pour commencer</p>
                  </div>
                ) : (
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    {cashMovements.map((mv, i) => {
                      const color = MOVEMENT_COLORS[mv.type] ?? "#6b7280"
                      const isPos = mv.amount > 0
                      return (
                        <div key={mv.id}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors"
                          style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                          <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-sm"
                            style={{ backgroundColor: color + "20", color }}>
                            {mv.type === "deposit" ? "↓" : mv.type === "withdrawal" ? "↑" : mv.type === "conversion" ? "⇄" : mv.type.includes("credit") ? "+" : "−"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                              {MOVEMENT_LABELS[mv.type] ?? mv.type}
                              {mv.refTicker ? ` · ${mv.refTicker}` : ""}
                            </p>
                            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                              {mv.date}
                              {mv.note ? ` · ${mv.note}` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold tabular-nums" style={{ color }}>
                              {isPos ? "+" : ""}{mv.amount.toFixed(2)} {mv.currency}
                            </p>
                            {mv.balanceAfterChf != null && (
                              <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                                solde CHF: {mv.balanceAfterChf.toFixed(2)}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {activeTab === "revenus" && (
          <>
            {/* ─── KPI cards ─── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Total reçu", value: format(totalCHF), icon: TrendingUp, color: "#a855f7" },
                { label: "Ce mois",    value: format(monthTotal), icon: CalendarDays, color: "#c084fc" },
                { label: "Moy. mensuelle", value: format(monthlyAvg), icon: BarChart2, color: "#9333ea" },
                { label: "Meilleure source", value: bestPlatform, icon: Award, color: "#7c3aed" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="kpi-card">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: color + "18" }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</p>
                  </div>
                  <p className="text-xl font-bold tabular-nums" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>

            {/* ─── Charts row ─── */}
            {revenus.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Donut */}
                <div className="rounded-xl border p-5 space-y-3"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <SectionHeader title="Répartition par type" description="% du total" />
                  {byType.length > 0
                    ? <RevenuDonut data={byType} />
                    : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune donnée</p>
                  }
                </div>
                {/* Monthly bars */}
                <div className="rounded-xl border p-5 space-y-3"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <SectionHeader title="Évolution mensuelle" description="12 derniers mois" />
                  <MonthlyBarChart data={monthlyData} />
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#a855f7" }}>
                      <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: "#a855f7" }} /> Revenus
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#22c55e" }}>
                      <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: "#22c55e" }} /> Dividendes
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ─── History table ─── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionHeader title="Historique" description={`${revenus.length} entrée${revenus.length > 1 ? "s" : ""}`} />
                <button onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)" }}>
                  <Plus className="h-4 w-4" /> Ajouter un revenu
                </button>
              </div>

              <div className="rounded-xl border overflow-hidden"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                {revenus.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl"
                      style={{ backgroundColor: "#a855f718", border: "1px solid #a855f730" }}>
                      💜
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                        Aucun revenu annexe
                      </p>
                      <p className="text-xs max-w-xs" style={{ color: "var(--text-secondary)" }}>
                        Ajoutez vos parrainages, bonus, airdrops, staking et autres revenus passifs.
                      </p>
                    </div>
                    <button onClick={() => setShowModal(true)}
                      className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white mt-2"
                      style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)" }}>
                      <Plus className="h-4 w-4" /> Premier revenu
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Table header */}
                    <div className="grid px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider border-b"
                      style={{ color: "var(--text-tertiary)", borderColor: "var(--border)", gridTemplateColumns: "1fr 100px 120px 100px 80px 36px" }}>
                      <span>Label / Type</span>
                      <span className="text-center">Plateforme</span>
                      <span className="text-right">Montant</span>
                      <span className="text-right">Devise</span>
                      <span className="text-right">Date</span>
                      <span />
                    </div>
                    {revenus.map((rev, i) => {
                      const meta  = REVENU_TYPE_META[rev.type]
                      const chfAmt = convert(rev.amount, (rev.currency || "CHF") as AppCurrency)
                      return (
                        <motion.div key={rev.id}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                          className="grid items-center px-5 py-3.5 hover:bg-zinc-800/20 transition-colors"
                          style={{ gridTemplateColumns: "1fr 100px 120px 100px 80px 36px", borderTop: "1px solid var(--border-subtle)" }}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-sm"
                              style={{ backgroundColor: (meta?.color ?? "#a855f7") + "18" }}>
                              {meta?.icon ?? "📦"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                                {rev.label}
                              </p>
                              <span className="text-[11px] rounded-md px-1.5 py-0.5"
                                style={{ backgroundColor: (meta?.color ?? "#a855f7") + "18", color: meta?.color ?? "#a855f7" }}>
                                {meta?.label}
                              </span>
                            </div>
                          </div>
                          <p className="text-center text-xs" style={{ color: "var(--text-secondary)" }}>
                            {rev.platform ?? "—"}
                          </p>
                          <div className="text-right">
                            <p className="text-xs font-bold tabular-nums" style={{ color: "#a855f7" }}>
                              +{format(chfAmt)}
                            </p>
                            {rev.currency !== "CHF" && (
                              <p className="text-[11px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                                {rev.amount.toFixed(2)} {rev.currency}
                              </p>
                            )}
                          </div>
                          <p className="text-right text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {rev.currency}
                          </p>
                          <p className="text-right text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {new Date(rev.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                          </p>
                          <button onClick={() => removeRevenu(rev.id)}
                            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-500/20 transition-colors"
                            style={{ color: "var(--text-tertiary)" }}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </motion.div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* ─── Dividendes tab — embedded ─── */}
        {activeTab === "dividends" && (
          <div className="rounded-xl border p-6 text-center"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Accédez aux dividendes depuis le menu Dividendes dans la sidebar.
            </p>
          </div>
        )}
      </div>

      {/* ─── Add Modal ─── */}
      <AnimatePresence>
        {showModal && (
          <TransactionModal
            mode="add"
            initial={{
              portfolioId:    portfolios[0]?.id ?? "",
              selectedClass:  "stock" as const,
              ticker:         "", assetName:      "",
              assetClass:     "stock", type:     "revenu",
              revenuType:     undefined, platform:  "",
              quantity:       "1", price:          "",
              nativeCurrency: "CHF", fees:          "0",
              date:           new Date().toISOString().slice(0, 10),
              notes:          "",
            }}
            portfolios={portfolios}
            onSave={handleSave}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
