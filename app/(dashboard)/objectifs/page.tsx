"use client"

import { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { useLivePrices } from "@/hooks/use-live-prices"
import { EmptyState } from "@/components/ui/empty-state"
import { aggregateCashflow } from "@/lib/cashflow"
import type { AppCurrency } from "@/lib/utils"
import { Target, Plus, Trash2, X, CalendarDays } from "lucide-react"

/**
 * Objectifs d'épargne/patrimoine — stockés en localStorage (aucune table DB
 * requise). Le progrès est mesuré contre le patrimoine net actuel (positions
 * valorisées en live + liquidités), en CHF pour rester stable quel que soit
 * l'affichage.
 */
interface Goal {
  id: string
  name: string
  icon: string
  /** Montant cible en CHF (référentiel stable). */
  targetChf: number
  /** Date cible ISO (YYYY-MM-DD), optionnelle. */
  targetDate?: string
  createdAt: string
}

const STORAGE_KEY = "patrimoine-goals"
const ICON_CHOICES = ["🎯", "🛡️", "🏠", "🚗", "✈️", "🎓", "💰", "📈"]

function loadGoals(): Goal[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") } catch { return [] }
}

export default function ObjectifsPage() {
  const { portfolios, globalCash, cashMovements } = useAppData()
  const { format, convert, fxRates, currency } = useCurrency()

  const [goals, setGoals] = useState<Goal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Formulaire de création
  const [fName, setFName] = useState("")
  const [fIcon, setFIcon] = useState(ICON_CHOICES[0])
  const [fAmount, setFAmount] = useState("")
  const [fDate, setFDate] = useState("")
  const [fError, setFError] = useState("")

  useEffect(() => { setGoals(loadGoals()); setLoaded(true) }, [])
  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(goals))
  }, [goals, loaded])

  // Patrimoine net actuel en CHF (positions live + cash)
  const allAssets = useMemo(() => portfolios.flatMap(p => p.assets).filter(a => a.assetClass !== "cash"), [portfolios])
  const tickers = useMemo(() => allAssets.map(a => a.ticker), [allAssets])
  const { prices: livePrices } = useLivePrices(tickers, 60_000)

  const netWorthChf = useMemo(() => {
    const userRate = (fxRates as Record<string, number>)[currency] ?? 1
    const positionsDisplay = allAssets.reduce((s, a) => {
      const price = livePrices[a.ticker]?.price ?? convert(a.currentPrice, (a.currency ?? "CHF") as AppCurrency)
      return s + price * a.quantity
    }, 0)
    const cashDisplay = Object.entries(globalCash).reduce(
      (s, [cur, val]) => s + convert(Number(val ?? 0), cur as AppCurrency), 0)
    // display → CHF
    return userRate > 0 ? (positionsDisplay + cashDisplay) / userRate : 0
  }, [allAssets, livePrices, globalCash, convert, fxRates, currency])

  const userRate = (fxRates as Record<string, number>)[currency] ?? 1

  // Rythme d'épargne réel : moyenne du cashflow net externe des 6 derniers mois
  // (en CHF pour rester cohérent avec le référentiel des objectifs).
  const avgMonthlySavingsChf = useMemo(() => {
    const from = new Date()
    from.setMonth(from.getMonth() - 5)
    const s = aggregateCashflow(
      cashMovements,
      (amt, cur) => convert(amt, cur as AppCurrency),
      { fromDate: from.toISOString().slice(0, 7) + "-01" }
    )
    const months = Math.max(1, s.months.length)
    return userRate > 0 ? (s.net / months) / userRate : 0
  }, [cashMovements, convert, userRate])

  function resetForm() {
    setFName(""); setFIcon(ICON_CHOICES[0]); setFAmount(""); setFDate(""); setFError("")
  }

  function createGoal() {
    const amountDisplay = Number(fAmount.replace(",", "."))
    if (!fName.trim()) { setFError("Donnez un nom à votre objectif."); return }
    if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) { setFError("Saisissez un montant cible positif."); return }
    if (fDate && fDate < new Date().toISOString().slice(0, 10)) { setFError("La date cible doit être dans le futur."); return }
    // Montant saisi en devise d'affichage → stocké en CHF
    const targetChf = userRate > 0 ? amountDisplay / userRate : amountDisplay
    setGoals(prev => [{
      id: `goal-${Date.now()}`,
      name: fName.trim(),
      icon: fIcon,
      targetChf,
      targetDate: fDate || undefined,
      createdAt: new Date().toISOString().slice(0, 10),
    }, ...prev])
    setShowModal(false)
    resetForm()
  }

  function deleteGoal(id: string) {
    setGoals(prev => prev.filter(g => g.id !== id))
    setConfirmDelete(null)
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Objectifs" subtitle="Vos jalons de patrimoine" />
      <div className="flex-1 space-y-6 p-4 sm:p-6 max-w-5xl mx-auto w-full">

        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Patrimoine net actuel : <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
              {format(netWorthChf * userRate)}
            </span>
          </p>
          <button onClick={() => { resetForm(); setShowModal(true) }} className="btn-primary">
            <Plus className="h-3.5 w-3.5" /> Nouvel objectif
          </button>
        </div>

        {goals.length === 0 ? (
          <div className="rounded-2xl border p-6 sm:p-8" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Fixez votre premier cap</p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Un objectif transforme votre patrimoine en progression mesurable : choisissez un modèle ou créez le vôtre.
            </p>
            {/* Modèles suggérés — préremplissent la modale, rien n'est créé sans validation */}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { name: "Épargne de sécurité", icon: "🛡️", amount: "10000", desc: "3 à 6 mois de dépenses disponibles en cas d'imprévu." },
                { name: "Achat immobilier", icon: "🏠", amount: "60000", desc: "Constituer l'apport pour un futur bien." },
                { name: "Indépendance financière", icon: "📈", amount: "500000", desc: "Le capital dont les revenus couvrent votre train de vie." },
              ].map(t => (
                <button key={t.name}
                  onClick={() => { resetForm(); setFName(t.name); setFIcon(t.icon); setFAmount(t.amount); setShowModal(true) }}
                  className="rounded-xl border p-4 text-left transition-all hover:border-[var(--accent)]"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
                  <span className="text-xl">{t.icon}</span>
                  <p className="mt-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t.name}</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{t.desc}</p>
                </button>
              ))}
            </div>
            <div className="mt-5">
              <button onClick={() => { resetForm(); setShowModal(true) }} className="btn-primary">
                <Plus className="h-3.5 w-3.5" /> Créer un objectif personnalisé
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {goals.map(g => {
              const progress = g.targetChf > 0 ? Math.min(100, (netWorthChf / g.targetChf) * 100) : 0
              const reached = progress >= 100
              const remaining = Math.max(0, g.targetChf - netWorthChf)
              return (
                <motion.div key={g.id} layout
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border p-5"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: reached ? "#22c55e40" : "var(--border)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
                        style={{ backgroundColor: "var(--bg-muted)" }}>{g.icon}</span>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{g.name}</p>
                        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                          Cible {format(g.targetChf * userRate)}
                          {g.targetDate && <> · <CalendarDays className="inline h-3 w-3 -mt-px" /> {g.targetDate}</>}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setConfirmDelete(g.id)}
                      aria-label={`Supprimer l'objectif ${g.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-red-500/15"
                      style={{ color: "var(--text-tertiary)" }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold tabular-nums" style={{ color: reached ? "var(--gain)" : "var(--text-primary)" }}>
                        {progress.toFixed(1)} %
                      </span>
                      <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {reached ? "🎉 Objectif atteint" : `reste ${format(remaining * userRate)}`}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="h-full rounded-full"
                        style={{ background: reached ? "var(--gain)" : "linear-gradient(90deg, var(--accent), #818cf8)" }} />
                    </div>

                    {/* Projection : rythme requis vs rythme réel */}
                    {!reached && (() => {
                      const lines: string[] = []
                      if (g.targetDate) {
                        const monthsLeft = Math.max(1, Math.ceil(
                          (new Date(g.targetDate).getTime() - Date.now()) / (30.44 * 86400000)))
                        lines.push(`Rythme requis : ${format((remaining / monthsLeft) * userRate)}/mois sur ${monthsLeft} mois`)
                      }
                      if (avgMonthlySavingsChf > 0 && remaining > 0) {
                        const monthsNeeded = Math.ceil(remaining / avgMonthlySavingsChf)
                        const eta = new Date()
                        eta.setMonth(eta.getMonth() + monthsNeeded)
                        lines.push(`Au rythme actuel (${format(avgMonthlySavingsChf * userRate)}/mois épargnés) : atteint vers ${eta.toISOString().slice(0, 7)}`)
                      }
                      return lines.length > 0 ? (
                        <div className="pt-1 space-y-0.5">
                          {lines.map(l => (
                            <p key={l} className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{l}</p>
                          ))}
                        </div>
                      ) : null
                    })()}
                    <p className="text-[10px] pt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      Mode de calcul : progression mesurée sur le patrimoine net total ;
                      rythme réel = cashflow net moyen des 6 derniers mois. Estimations.
                    </p>
                  </div>

                  {/* Confirmation de suppression inline */}
                  <AnimatePresence>
                    {confirmDelete === g.id && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden">
                        <div className="mt-3 flex items-center justify-between rounded-lg border px-3 py-2"
                          style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}>
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Supprimer cet objectif ?</span>
                          <div className="flex gap-2">
                            <button onClick={() => setConfirmDelete(null)} className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>
                              Annuler
                            </button>
                            <button onClick={() => deleteGoal(g.id)} className="text-xs font-semibold" style={{ color: "var(--loss)" }}>
                              Supprimer
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modale de création ── */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
              onClick={() => setShowModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.15 }}
              className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl"
              style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--border)" }}
              role="dialog" aria-modal="true" aria-label="Nouvel objectif">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Nouvel objectif</h2>
                <button onClick={() => setShowModal(false)} aria-label="Fermer"
                  className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-800 transition-colors"
                  style={{ color: "var(--text-secondary)" }}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="goal-name" className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nom</label>
                  <input id="goal-name" type="text" value={fName} onChange={e => setFName(e.target.value)}
                    placeholder="Ex. Apport immobilier" className="input" autoFocus />
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Icône</span>
                  <div className="flex flex-wrap gap-2">
                    {ICON_CHOICES.map(ic => (
                      <button key={ic} onClick={() => setFIcon(ic)} aria-label={`Icône ${ic}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border text-base transition-all"
                        style={{
                          borderColor: fIcon === ic ? "var(--accent)" : "var(--border)",
                          backgroundColor: fIcon === ic ? "var(--accent-glow)" : "var(--bg-elevated)",
                        }}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="goal-amount" className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Montant cible ({currency})
                    </label>
                    <input id="goal-amount" type="number" min="0" step="any" value={fAmount}
                      onChange={e => setFAmount(e.target.value)} placeholder="10000" className="input" />
                  </div>
                  <div>
                    <label htmlFor="goal-date" className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Date cible (optionnel)
                    </label>
                    <input id="goal-date" type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="input" />
                  </div>
                </div>

                {fError && <p className="text-xs" style={{ color: "var(--loss)" }}>{fError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowModal(false)} className="btn-ghost">Annuler</button>
                  <button onClick={createGoal} disabled={!fName.trim() || !fAmount} className="btn-primary disabled:opacity-50">
                    Créer l'objectif
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
