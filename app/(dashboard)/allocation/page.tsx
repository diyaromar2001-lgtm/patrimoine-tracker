"use client"

import { useState, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionCard } from "@/components/ui/section-card"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { useLivePrices } from "@/hooks/use-live-prices"
import {
  computePie, planContribution, planRebalance, targetsFromCurrent,
  type TargetAllocation, type ContributionMode, type PieInput,
} from "@/lib/pie"
import type { AppCurrency } from "@/lib/utils"
import {
  Target, Wand2, AlertTriangle, ArrowRight, Check, RotateCcw, Info,
} from "lucide-react"

const SLICE_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#0ea5e9",
  "#a855f7", "#14b8a6", "#ef4444", "#84cc16", "#f97316",
]

/**
 * Allocation cible — l'équivalent du « Pie » de Trading 212.
 *
 * L'écran répond dans l'ordre à trois questions : à quoi ressemble ma
 * répartition voulue, à quel point j'en suis loin, et où doit aller mon
 * prochain versement. La troisième est celle qui sert au quotidien.
 */
export default function AllocationPage() {
  const { portfolios, setTargetAllocation } = useAppData()
  const { format, convert, currency } = useCurrency()

  const [portfolioId, setPortfolioId] = useState<string>("")
  const [draft, setDraft] = useState<TargetAllocation>({})
  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [saving, setSaving] = useState(false)
  const [contribution, setContribution] = useState("500")
  const [mode, setMode] = useState<ContributionMode>("self-balancing")
  const [showRebalance, setShowRebalance] = useState(false)

  // Premier portefeuille par défaut
  useEffect(() => {
    if (!portfolioId && portfolios.length) setPortfolioId(portfolios[0].id)
  }, [portfolios, portfolioId])

  const portfolio = portfolios.find(p => p.id === portfolioId)

  const tickers = useMemo(
    () => portfolio?.assets.filter(a => a.assetClass !== "cash" && a.quantity > 0).map(a => a.ticker) ?? [],
    [portfolio]
  )
  const { prices } = useLivePrices(tickers, 60_000)

  const positions = useMemo<PieInput[]>(() => {
    if (!portfolio) return []
    return portfolio.assets
      .filter(a => a.assetClass !== "cash" && a.quantity > 0)
      .map(a => ({
        ticker: a.ticker,
        name:   a.name,
        value:  (prices[a.ticker]?.price ?? convert(a.currentPrice, (a.currency ?? "CHF") as AppCurrency)) * a.quantity,
      }))
  }, [portfolio, prices, convert])

  // Les cibles en cours d'édition priment sur celles enregistrées
  const targets = editing ? draft : (portfolio?.targetAllocation ?? {})
  const pie = useMemo(() => computePie(positions, targets), [positions, targets])

  const amount = Number(contribution.replace(",", ".")) || 0
  const plan = useMemo(() => planContribution(pie, amount, mode), [pie, amount, mode])
  const rebalance = useMemo(() => planRebalance(pie), [pie])

  const hasTargets = Object.keys(portfolio?.targetAllocation ?? {}).length > 0
  const draftSum = Object.values(draft).reduce((s, v) => s + v, 0)

  function startEditing(seed?: TargetAllocation) {
    setDraft(seed ?? portfolio?.targetAllocation ?? {})
    setSaveError("")
    setEditing(true)
  }

  async function save() {
    if (!portfolio) return
    setSaving(true)
    setSaveError("")
    const cleaned = Object.fromEntries(
      Object.entries(draft).filter(([, v]) => v > 0)
    )
    const res = await setTargetAllocation(portfolio.id, Object.keys(cleaned).length ? cleaned : null)
    setSaving(false)
    if (!res.ok) { setSaveError(res.error ?? "Enregistrement impossible."); return }
    setEditing(false)
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Allocation cible" subtitle="Définis ta répartition voulue et suis l'écart" />

      <div className="flex-1 space-y-6 p-4 sm:p-6 max-w-5xl mx-auto w-full">
        {/* Choix du portefeuille */}
        {portfolios.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {portfolios.map(p => (
              <button key={p.id}
                onClick={() => { setPortfolioId(p.id); setEditing(false) }}
                className="flex flex-shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all"
                style={p.id === portfolioId
                  ? { backgroundColor: "var(--accent, #6366f1)", borderColor: "var(--accent, #6366f1)", color: "#fff" }
                  : { backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                <span className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.id === portfolioId ? "rgba(255,255,255,.85)" : p.color }} />
                {p.name}
              </button>
            ))}
          </div>
        )}

        {!portfolio ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Crée un portefeuille pour définir une allocation cible.
          </p>
        ) : !hasTargets && !editing ? (
          <EmptyTargets
            onStartBlank={() => startEditing({})}
            onStartFromCurrent={() => startEditing(targetsFromCurrent(positions))}
            hasPositions={positions.length > 0}
          />
        ) : (
          <>
            {/* ── Camembert + score ── */}
            <SectionCard
              title="Répartition"
              description="Anneau extérieur : ta cible. Anneau intérieur : ta position réelle."
              action={
                <button onClick={() => editing ? setEditing(false) : startEditing()}
                  className="text-xs font-medium" style={{ color: "var(--accent, #6366f1)" }}>
                  {editing ? "Annuler" : "Modifier les cibles"}
                </button>
              }
            >
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                <DoubleDonut slices={pie.slices} />

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-baseline gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
                        Note d&apos;équilibre
                      </p>
                      <p className="text-3xl font-bold tabular-nums"
                        style={{ color: pie.score >= 8 ? "var(--gain)" : pie.score >= 5 ? "#f59e0b" : "var(--loss)" }}>
                        {pie.score > 0 ? `${pie.score.toFixed(1)}/10` : "—"}
                      </p>
                    </div>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {pie.score > 0
                        ? `${pie.totalDriftPct.toFixed(1)} % d'écart cumulé avec ta cible`
                        : "Les cibles doivent totaliser 100 % pour que la note ait un sens."}
                    </p>
                  </div>

                  {pie.untargeted.length > 0 && (
                    <div className="flex gap-2 rounded-lg border px-3 py-2"
                      style={{ backgroundColor: "#f59e0b12", borderColor: "#f59e0b40" }}>
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: "#f59e0b" }} />
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        <strong style={{ color: "var(--text-primary)" }}>{pie.untargeted.join(", ")}</strong>{" "}
                        {pie.untargeted.length > 1 ? "sont détenus" : "est détenu"} sans cible.
                        Ces lignes comptent dans le total, donc elles diluent toutes les autres.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* ── Édition des cibles ── */}
            <AnimatePresence>
              {editing && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <SectionCard
                    title="Cibles"
                    description="Le total doit faire 100 %."
                    action={
                      <button onClick={() => setDraft(targetsFromCurrent(positions))}
                        className="flex items-center gap-1.5 text-xs font-medium"
                        style={{ color: "var(--text-secondary)" }}>
                        <Wand2 className="h-3 w-3" /> Partir de l&apos;existant
                      </button>
                    }
                  >
                    <div className="space-y-2">
                      {pie.slices.map(s => (
                        <div key={s.ticker} className="flex items-center gap-3">
                          <span className="w-20 flex-shrink-0 truncate text-sm font-medium"
                            style={{ color: "var(--text-primary)" }}>{s.ticker}</span>
                          <input
                            type="range" min={0} max={100} step={0.5}
                            value={draft[s.ticker] ?? 0}
                            onChange={e => setDraft(d => ({ ...d, [s.ticker]: Number(e.target.value) }))}
                            className="flex-1 accent-indigo-500"
                          />
                          <div className="flex w-20 flex-shrink-0 items-center gap-1">
                            <input
                              type="number" min={0} max={100} step={0.5}
                              value={draft[s.ticker] ?? 0}
                              onChange={e => setDraft(d => ({ ...d, [s.ticker]: Number(e.target.value) }))}
                              className="w-14 rounded-lg border px-2 py-1 text-right text-xs tabular-nums outline-none"
                              style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                            />
                            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>%</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3"
                      style={{ borderColor: "var(--border-subtle)" }}>
                      <p className="text-sm tabular-nums"
                        style={{ color: Math.abs(draftSum - 100) < 0.5 ? "var(--gain)" : "#f59e0b" }}>
                        Total {draftSum.toFixed(1)} %
                        {Math.abs(draftSum - 100) >= 0.5 &&
                          ` · ${draftSum > 100 ? "retire" : "ajoute"} ${Math.abs(100 - draftSum).toFixed(1)} %`}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => setEditing(false)}
                          className="rounded-xl border px-3 py-2 text-sm font-medium"
                          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                          Annuler
                        </button>
                        <button onClick={save} disabled={saving}
                          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: "var(--accent, #6366f1)" }}>
                          <Check className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </div>
                    </div>

                    {saveError && (
                      <p className="mt-3 rounded-lg px-3 py-2 text-xs"
                        style={{ backgroundColor: "#ef444415", color: "#ef4444" }}>{saveError}</p>
                    )}
                  </SectionCard>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Prochain versement — le cœur de l'écran ── */}
            <SectionCard
              title="Mon prochain versement"
              description="Sans rien vendre : l'argent frais va d'abord aux lignes en retard."
            >
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Montant à investir
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0} step={50} value={contribution}
                      onChange={e => setContribution(e.target.value)}
                      className="w-32 rounded-xl border px-3 py-2.5 text-sm tabular-nums outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                    />
                    <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{currency}</span>
                  </div>
                </div>

                <div className="flex gap-1 rounded-xl border p-1"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-base)" }}>
                  {([
                    ["self-balancing", "Rééquilibrer"],
                    ["by-targets", "Selon les cibles"],
                  ] as const).map(([m, label]) => (
                    <button key={m} onClick={() => setMode(m)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      style={mode === m
                        ? { backgroundColor: "var(--accent, #6366f1)", color: "#fff" }
                        : { color: "var(--text-secondary)" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                {plan.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                    Saisis un montant et définis au moins une cible pour voir la répartition.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {plan.map((p, i) => (
                      <div key={p.ticker} className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                        style={{ backgroundColor: "var(--bg-base)" }}>
                        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            {p.ticker}
                          </p>
                          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                            {p.sharePct.toFixed(1)} % du versement · poids après : {p.resultingPct.toFixed(1)} %
                          </p>
                        </div>
                        <p className="flex-shrink-0 text-sm font-bold tabular-nums" style={{ color: "var(--gain)" }}>
                          {format(p.amount)}
                        </p>
                      </div>
                    ))}
                    <p className="pt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      Répartition calculée sur tes cibles. L&apos;application ne passe aucun ordre
                      et ne recommande aucun titre : elle mesure l&apos;écart avec ce que tu as décidé.
                    </p>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── Détail par ligne ── */}
            <SectionCard title="Écart par ligne" description="Positif = surpondéré par rapport à ta cible">
              <div className="space-y-2.5">
                {pie.slices.map((s, i) => (
                  <div key={s.ticker}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                        <span className="truncate font-medium" style={{ color: "var(--text-primary)" }}>{s.ticker}</span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-2 tabular-nums">
                        <span style={{ color: "var(--text-secondary)" }}>
                          {s.currentPct.toFixed(1)} % / {s.targetPct.toFixed(1)} %
                        </span>
                        <span className="w-16 text-right font-semibold"
                          style={{ color: Math.abs(s.driftPct) < 0.5 ? "var(--text-tertiary)"
                                        : s.driftPct > 0 ? "#f59e0b" : "var(--accent, #6366f1)" }}>
                          {s.driftPct >= 0 ? "+" : ""}{s.driftPct.toFixed(1)} pt
                        </span>
                      </span>
                    </div>
                    {/* Barre : réel plein, cible en repère */}
                    <div className="relative mt-1 h-1.5 overflow-hidden rounded-full"
                      style={{ backgroundColor: "var(--border)" }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${Math.min(s.currentPct, 100)}%`,
                                 backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                      {s.targetPct > 0 && (
                        <span className="absolute top-0 h-full w-0.5"
                          style={{ left: `${Math.min(s.targetPct, 100)}%`, backgroundColor: "var(--text-primary)" }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* ── Arbitrage avec vente — proposé en dernier, jamais par défaut ── */}
            {rebalance.length > 0 && (
              <SectionCard
                title="Rééquilibrer en arbitrant"
                description="Nécessite de vendre — donc de réaliser une plus-value imposable."
                action={
                  <button onClick={() => setShowRebalance(v => !v)}
                    className="text-xs font-medium" style={{ color: "var(--accent, #6366f1)" }}>
                    {showRebalance ? "Masquer" : "Afficher"}
                  </button>
                }
              >
                {showRebalance ? (
                  <div className="space-y-1.5">
                    {rebalance.map(m => (
                      <div key={m.ticker} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                        style={{ backgroundColor: "var(--bg-base)" }}>
                        <span className="flex items-center gap-2 text-sm">
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                            style={m.action === "buy"
                              ? { backgroundColor: "#22c55e18", color: "#22c55e" }
                              : { backgroundColor: "#ef444418", color: "#ef4444" }}>
                            {m.action === "buy" ? "Acheter" : "Vendre"}
                          </span>
                          <span style={{ color: "var(--text-primary)" }}>{m.ticker}</span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                          {format(m.amount)}
                        </span>
                      </div>
                    ))}
                    <p className="flex gap-1.5 pt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      <Info className="h-3.5 w-3.5 flex-shrink-0" />
                      Un versement suffit souvent à atteindre le même résultat sans vendre.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {rebalance.length} mouvement{rebalance.length > 1 ? "s" : ""} ramèneraient le portefeuille
                    exactement sur sa cible.
                  </p>
                )}
              </SectionCard>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Camembert double : cible à l'extérieur, réel à l'intérieur ─────────────

function DoubleDonut({ slices }: { slices: ReturnType<typeof computePie>["slices"] }) {
  const size = 176
  const cx = size / 2, cy = size / 2

  const arcs = (values: number[], rOuter: number, rInner: number) => {
    const total = values.reduce((s, v) => s + v, 0)
    if (total <= 0) return []
    let angle = -Math.PI / 2
    return values.map(v => {
      const sweep = (v / total) * Math.PI * 2
      const start = angle
      const end = angle + sweep
      angle = end
      if (v <= 0) return ""
      const large = sweep > Math.PI ? 1 : 0
      const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
      return [
        `M ${p(rOuter, start)}`,
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, end)}`,
        `L ${p(rInner, end)}`,
        `A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, start)}`,
        "Z",
      ].join(" ")
    })
  }

  const targetArcs  = arcs(slices.map(s => s.targetPct), 86, 66)
  const currentArcs = arcs(slices.map(s => s.value), 60, 38)

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      {targetArcs.map((d, i) => d && (
        <path key={`t${i}`} d={d} fill={SLICE_COLORS[i % SLICE_COLORS.length]} opacity={0.35} />
      ))}
      {currentArcs.map((d, i) => d && (
        <path key={`c${i}`} d={d} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
      ))}
    </svg>
  )
}

// ─── État initial ───────────────────────────────────────────────────────────

function EmptyTargets({ onStartBlank, onStartFromCurrent, hasPositions }: {
  onStartBlank: () => void
  onStartFromCurrent: () => void
  hasPositions: boolean
}) {
  return (
    <div className="rounded-2xl border p-8 text-center"
      style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
      <Target className="mx-auto h-8 w-8" style={{ color: "var(--accent, #6366f1)" }} />
      <p className="mt-3 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        Aucune allocation cible
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
        Fixe la répartition que tu veux atteindre. L&apos;application calculera l&apos;écart
        et te dira où placer tes prochains versements pour t&apos;en rapprocher — sans rien vendre.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {hasPositions && (
          <button onClick={onStartFromCurrent}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--accent, #6366f1)" }}>
            <Wand2 className="h-4 w-4" /> Partir de ma répartition actuelle
          </button>
        )}
        <button onClick={onStartBlank}
          className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
          <RotateCcw className="h-4 w-4" /> Partir de zéro
        </button>
      </div>
    </div>
  )
}
