"use client"

import { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { PageHero } from "@/components/ui/page-hero"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { useLivePrices } from "@/hooks/use-live-prices"
import { useDividendHistory } from "@/hooks/use-dividend-history"
import { safeCostBasisChf } from "@/lib/finance"
import type { AppCurrency } from "@/lib/utils"
import {
  computeReceivedDividends, groupByMonth, groupByYear, groupByTicker,
  summarizeReal, nextExpectedDividend,
  type DividendTxInput, type ReceivedDividendDetail,
} from "@/lib/dividend-engine"
import {
  CalendarDays, TrendingUp, Coins, X, Loader2, ArrowRight, Info,
} from "lucide-react"

const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"]

function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7))
  return `${MONTHS_FR[m - 1] ?? month.slice(5)} ${month.slice(0, 4)}`
}

// ─── Graphique mensuel (SVG maison, cohérent avec le reste de l'app) ────────
function MonthlyIncomeChart({
  months, selected, onSelect, format,
}: {
  months: Array<{ month: string; net: number }>
  selected: string | null
  onSelect: (m: string | null) => void
  format: (v: number) => string
}) {
  const max = Math.max(...months.map(m => m.net), 0.01)
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1.5" style={{ minWidth: months.length * 34 }}>
        {months.map(m => {
          const h = (m.net / max) * 132
          const isSel = selected === m.month
          return (
            <button key={m.month}
              onClick={() => onSelect(isSel ? null : m.month)}
              className="group flex flex-1 flex-col items-center gap-1.5 rounded-lg px-0.5 py-1 transition-colors"
              style={{ backgroundColor: isSel ? "var(--bg-muted)" : "transparent" }}
              title={`${monthLabel(m.month)} — ${format(m.net)}`}
            >
              <span className="text-[10px] font-semibold tabular-nums opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--text-secondary)" }}>
                {Math.round(m.net)}
              </span>
              <div className="flex w-full flex-col justify-end" style={{ height: 132 }}>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: Math.max(h, m.net > 0 ? 3 : 0) }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="w-full rounded-t-sm group-hover:opacity-80"
                  style={{ backgroundColor: isSel ? "var(--accent)" : "var(--gain)" }}
                />
              </div>
              <span className="whitespace-nowrap text-[10px] tabular-nums"
                style={{ color: isSel ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                {MONTHS_FR[Number(m.month.slice(5, 7)) - 1]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Détail d'un mois ───────────────────────────────────────────────────────
function MonthDetail({
  month, details, format, onClose,
}: {
  month: string
  details: ReceivedDividendDetail[]
  format: (v: number) => string
  onClose: () => void
}) {
  const totalNet = details.reduce((s, d) => s + d.net, 0)
  return (
    <SectionCard
      title={`Détail — ${monthLabel(month)}`}
      description={`${details.length} versement${details.length > 1 ? "s" : ""} · ${format(totalNet)} net`}
      padded={false}
      action={
        <button onClick={onClose} className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Fermer
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 720 }}>
          <thead>
            <tr style={{ color: "var(--text-tertiary)" }}>
              <th className="px-5 py-2.5 text-left font-medium">Société</th>
              <th className="px-3 py-2.5 text-left font-medium">Ex-date</th>
              <th className="px-3 py-2.5 text-right font-medium">Quantité détenue</th>
              <th className="px-3 py-2.5 text-right font-medium">Div. / action</th>
              <th className="px-3 py-2.5 text-right font-medium">Taux</th>
              <th className="px-3 py-2.5 text-right font-medium">Brut</th>
              <th className="px-3 py-2.5 text-right font-medium">Retenue</th>
              <th className="px-5 py-2.5 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {details.map((d, i) => (
              <tr key={`${d.ticker}-${d.exDate}-${i}`}
                style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                <td className="px-5 py-2.5 font-semibold" style={{ color: "var(--text-primary)" }}>{d.ticker}</td>
                <td className="px-3 py-2.5 tabular-nums">{d.exDate}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {Number(d.quantityHeld).toFixed(8).replace(/\.?0+$/, "")}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {d.amountPerShare.toFixed(4)} {d.nativeCurrency}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                  {d.fxRateUsed === 1 ? "—" : `×${d.fxRateUsed.toFixed(4)}`}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{format(d.gross)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {d.withholding != null ? `−${format(d.withholding)}` : "—"}
                </td>
                <td className="px-5 py-2.5 text-right font-bold tabular-nums" style={{ color: "var(--gain)" }}>
                  +{format(d.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {details.some(d => d.withholding == null) && (
        <p className="border-t px-5 py-3 text-xs" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
          « — » en retenue : l'impôt à la source n'est pas fourni par la source de données et n'est jamais estimé.
          Le net affiché égale alors le brut.
        </p>
      )}
    </SectionCard>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function DividendsPage() {
  const { portfolios, transactions } = useAppData()
  const { format, fxRates, currency } = useCurrency()

  const [tab, setTab] = useState<"overview" | "calendar" | "history">("overview")
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [portfolioFilter, setPortfolioFilter] = useState<string>("all")
  const [tickerFilter, setTickerFilter] = useState<string>("all")

  // Objectif de revenu passif mensuel (persisté localement)
  const [incomeGoal, setIncomeGoal] = useState("")
  useEffect(() => {
    try { setIncomeGoal(localStorage.getItem("dividend-income-goal") ?? "") } catch {}
  }, [])
  function saveIncomeGoal(v: string) {
    setIncomeGoal(v)
    try { localStorage.setItem("dividend-income-goal", v) } catch {}
  }

  // ── Transactions filtrées ────────────────────────────────────────────────
  const filteredTxs = useMemo<DividendTxInput[]>(() =>
    transactions
      .filter(t => portfolioFilter === "all" || t.portfolioId === portfolioFilter)
      .filter(t => tickerFilter === "all" || t.ticker === tickerFilter)
      .map(t => ({
        ticker: t.ticker,
        type: t.type,
        quantity: t.quantity,
        date: t.date,
        feesChf: t.feesChf,
        netAmountChf: t.netAmountChf,
        portfolioId: t.portfolioId,
      })),
    [transactions, portfolioFilter, tickerFilter]
  )

  // Tous les tickers ayant été détenus (pas seulement les positions actuelles) :
  // un titre revendu a pu verser des dividendes pendant la détention.
  const everHeldTickers = useMemo(() =>
    [...new Set(filteredTxs.filter(t => t.type === "buy").map(t => t.ticker))],
    [filteredTxs]
  )

  const { events, loading: histLoading, error: histError, missing } = useDividendHistory(everHeldTickers)

  // ── Croisement historique × détention ────────────────────────────────────
  const received = useMemo(
    () => computeReceivedDividends(filteredTxs, events, currency, fxRates as Record<string, number>),
    [filteredTxs, events, currency, fxRates]
  )

  const summary   = useMemo(() => summarizeReal(received), [received])
  const byMonth   = useMemo(() => groupByMonth(received), [received])
  const byYear    = useMemo(() => groupByYear(received), [received])
  const byTicker  = useMemo(() => groupByTicker(received), [received])
  const next      = useMemo(
    () => nextExpectedDividend(filteredTxs, events, currency, fxRates as Record<string, number>),
    [filteredTxs, events, currency, fxRates]
  )

  // ── Rendements : sur coût vs courant ─────────────────────────────────────
  const openAssets = useMemo(() =>
    portfolios
      .filter(p => portfolioFilter === "all" || p.id === portfolioFilter)
      .flatMap(p => p.assets)
      .filter(a => a.assetClass !== "cash" && a.quantity > 0)
      .filter(a => tickerFilter === "all" || a.ticker === tickerFilter),
    [portfolios, portfolioFilter, tickerFilter]
  )
  const { prices: livePrices } = useLivePrices(openAssets.map(a => a.ticker), 60_000)

  const userRate = (fxRates as Record<string, number>)[currency] ?? 1

  const { costBasis, marketValue } = useMemo(() => {
    let cost = 0, value = 0
    for (const a of openAssets) {
      const nativeCurr = livePrices[a.ticker]?.originalCurrency ?? a.currency ?? "CHF"
      cost += safeCostBasisChf(a.costBasisChf, a.quantity, a.avgBuyPrice, nativeCurr, fxRates as Record<string, number>) * userRate
      const px = livePrices[a.ticker]?.price ?? a.currentPrice
      value += px * a.quantity
    }
    return { costBasis: cost, marketValue: value }
  }, [openAssets, livePrices, fxRates, userRate])

  // Revenu annuel courant = somme des 12 derniers mois RÉELS (pas une estimation)
  const annualIncome = summary.last12mNet
  const yieldOnCost  = costBasis   > 0 ? (annualIncome / costBasis)   * 100 : null
  const currentYield = marketValue > 0 ? (annualIncome / marketValue) * 100 : null

  // 24 derniers mois pour le graphique, y compris les mois sans versement
  const chartMonths = useMemo(() => {
    const out: Array<{ month: string; net: number }> = []
    const d = new Date()
    d.setDate(1)
    for (let i = 23; i >= 0; i--) {
      const dd = new Date(d.getFullYear(), d.getMonth() - i, 1)
      const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}`
      out.push({ month: key, net: byMonth.find(m => m.month === key)?.net ?? 0 })
    }
    return out
  }, [byMonth])

  const selectedDetails = selectedMonth
    ? (byMonth.find(m => m.month === selectedMonth)?.details ?? [])
    : []

  const allTickers = useMemo(() =>
    [...new Set(transactions.filter(t => t.type === "buy").map(t => t.ticker))].sort(),
    [transactions]
  )

  const hasData = received.length > 0

  return (
    <div className="flex flex-col">
      <Topbar title="Dividendes" subtitle="Revenus passifs réellement encaissés" />
      <div className="flex-1 space-y-6 p-4 sm:p-6 max-w-7xl mx-auto w-full">

        {/* ─── Héro ─── */}
        <PageHero
          label="Dividendes encaissés cette année"
          value={format(summary.ytdNet)}
          glow="#22c55e"
          stats={[
            {
              label: "vs même période l'an dernier",
              value: summary.yoyPct != null
                ? `${summary.yoyPct >= 0 ? "+" : ""}${summary.yoyPct.toFixed(1)} %`
                : "—",
              color: summary.yoyPct == null ? undefined : summary.yoyPct >= 0 ? "var(--gain)" : "var(--loss)",
              title: summary.yoyPct == null
                ? "Aucun versement sur la même période l'an dernier — pas de base de comparaison"
                : `${format(summary.previousYearNet)} encaissés sur la même période en ${new Date().getFullYear() - 1}`,
            },
            {
              label: "Moyenne mensuelle",
              value: format(summary.monthlyAvg),
              title: "Sur les mois ayant effectivement reçu un versement",
            },
            {
              label: "Rendement sur coût",
              value: yieldOnCost != null ? `${yieldOnCost.toFixed(2)} %` : "—",
              title: "12 derniers mois encaissés ÷ coût d'acquisition des positions ouvertes",
            },
            {
              label: "Rendement courant",
              value: currentYield != null ? `${currentYield.toFixed(2)} %` : "—",
              title: "12 derniers mois encaissés ÷ valeur de marché actuelle",
            },
          ]}
        />

        {/* ─── Filtres + onglets ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Sections dividendes"
            className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--border)" }}>
            {([["overview", "Vue d'ensemble"], ["calendar", "Calendrier"], ["history", "Historique"]] as const).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className="rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: tab === t ? "var(--bg-subtle)" : "transparent",
                  color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={portfolioFilter} onChange={e => setPortfolioFilter(e.target.value)}
              aria-label="Filtrer par portefeuille"
              className="rounded-lg border px-3 py-1.5 text-xs outline-none"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
              <option value="all">Tous les portefeuilles</option>
              {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={tickerFilter} onChange={e => setTickerFilter(e.target.value)}
              aria-label="Filtrer par actif"
              className="rounded-lg border px-3 py-1.5 text-xs outline-none"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
              <option value="all">Tous les actifs</option>
              {allTickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* ─── États de chargement / erreur ─── */}
        {histLoading && (
          <div className="flex items-center gap-2 rounded-2xl border px-5 py-4"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Récupération de l'historique réel des versements…
            </span>
          </div>
        )}

        {histError && (
          <div className="rounded-2xl border px-5 py-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "#ef444440" }}>
            <p className="text-sm" style={{ color: "var(--loss)" }}>{histError}</p>
          </div>
        )}

        {!histLoading && !hasData && (
          <SectionCard padded={false}>
            <EmptyState
              icon={<Coins className="h-5 w-5" />}
              title="Aucun dividende encaissé"
              description="Les versements sont reconstitués en croisant le calendrier réel de vos titres avec vos dates d'achat. Aucun de vos titres n'a versé de dividende pendant votre période de détention."
            />
          </SectionCard>
        )}

        {hasData && (<>
          {/* ══ VUE D'ENSEMBLE ══ */}
          {tab === "overview" && (<>
            <SectionCard
              title="Revenus mensuels"
              description="24 derniers mois · cliquez sur un mois pour le détail"
            >
              <MonthlyIncomeChart
                months={chartMonths}
                selected={selectedMonth}
                onSelect={setSelectedMonth}
                format={format}
              />
            </SectionCard>

            <AnimatePresence>
              {selectedMonth && selectedDetails.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <MonthDetail month={selectedMonth} details={selectedDetails}
                    format={format} onClose={() => setSelectedMonth(null)} />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Par année */}
              <SectionCard title="Revenus par année" description="Progression d'un exercice à l'autre">
                {byYear.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Pas encore d'historique annuel.</p>
                ) : (
                  <div className="space-y-3">
                    {byYear.map(y => {
                      const max = Math.max(...byYear.map(x => x.net), 0.01)
                      return (
                        <div key={y.year} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{y.year}</span>
                            <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{format(y.net)}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
                            <div className="h-full rounded-full" style={{ width: `${(y.net / max) * 100}%`, backgroundColor: "var(--gain)" }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Top distributeurs */}
              <SectionCard title="Top distributeurs" description="Part de chaque actif dans vos revenus encaissés">
                <div className="space-y-3">
                  {byTicker.slice(0, 6).map(t => (
                    <div key={t.ticker} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{t.ticker}</span>
                        <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                          {format(t.net)} · <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{t.pct.toFixed(0)} %</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${Math.min(100, t.pct)}%`, backgroundColor: t.pct > 50 ? "#f59e0b" : "var(--gain)" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {byTicker[0] && byTicker[0].pct > 50 && byTicker.length > 1 && (
                  <p className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                    {byTicker[0].ticker} fournit {byTicker[0].pct.toFixed(0)} % de vos dividendes — revenus concentrés.
                  </p>
                )}
              </SectionCard>
            </div>

            {/* Objectif de revenu passif */}
            <SectionCard
              title="Objectif de revenu passif"
              description="Cible mensuelle comparée à vos encaissements réels"
              action={
                <div className="flex items-center gap-2">
                  <label htmlFor="div-goal" className="text-xs" style={{ color: "var(--text-secondary)" }}>Cible / mois</label>
                  <input id="div-goal" type="number" min="0" value={incomeGoal}
                    onChange={e => saveIncomeGoal(e.target.value)}
                    className="input w-24 !py-1.5 text-right text-xs" placeholder="100" />
                </div>
              }
            >
              {(() => {
                const goal = Number(incomeGoal)
                if (!Number.isFinite(goal) || goal <= 0) {
                  return <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Fixez une cible mensuelle pour suivre votre progression.
                  </p>
                }
                const monthly = summary.last12mNet / 12
                const progress = Math.min(100, (monthly / goal) * 100)
                const capital = currentYield && currentYield > 0 ? (goal * 12) / (currentYield / 100) : null
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold tabular-nums" style={{ color: progress >= 100 ? "var(--gain)" : "var(--text-primary)" }}>
                        {format(monthly)} / {format(goal)} · {progress.toFixed(0)} %
                      </span>
                      <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {capital != null ? `capital nécessaire ≈ ${format(capital)}` : "rendement indisponible"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${progress}%`, background: progress >= 100 ? "var(--gain)" : "linear-gradient(90deg, var(--accent), #818cf8)" }} />
                    </div>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      Revenu mensuel = 12 derniers mois réellement encaissés ÷ 12. Capital estimé au rendement
                      courant de {currentYield?.toFixed(2) ?? "—"} % — projection, pas une promesse.
                    </p>
                  </div>
                )
              })()}
            </SectionCard>
          </>)}

          {/* ══ CALENDRIER ══ */}
          {tab === "calendar" && (<>
            {next && (
              <SectionCard title="Prochain versement attendu" description="Estimation fondée sur le calendrier historique du titre">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--gain)" }}>
                      +{format(next.amount)}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {next.ticker} · date ex-dividende {next.exDate}
                      {next.daysAway >= 0 && ` · dans ${next.daysAway} j`}
                    </p>
                  </div>
                  <p className="max-w-sm text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Le montant suppose votre quantité actuelle conservée jusqu'à l'ex-date.
                    La date de paiement suit généralement l'ex-date de quelques semaines.
                  </p>
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="Versements par mois"
              description="Chaque barre est cliquable pour ouvrir le détail complet"
            >
              <MonthlyIncomeChart
                months={chartMonths}
                selected={selectedMonth}
                onSelect={setSelectedMonth}
                format={format}
              />
            </SectionCard>

            <AnimatePresence>
              {selectedMonth && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  {selectedDetails.length > 0 ? (
                    <MonthDetail month={selectedMonth} details={selectedDetails}
                      format={format} onClose={() => setSelectedMonth(null)} />
                  ) : (
                    <SectionCard
                      title={`Détail — ${monthLabel(selectedMonth)}`}
                      action={<button onClick={() => setSelectedMonth(null)} className="text-xs" style={{ color: "var(--text-tertiary)" }}>Fermer</button>}
                    >
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        Aucun versement encaissé ce mois-ci.
                      </p>
                    </SectionCard>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>)}

          {/* ══ HISTORIQUE ══ */}
          {tab === "history" && (
            <SectionCard
              title="Historique chronologique"
              description={`${received.length} versement${received.length > 1 ? "s" : ""} reconstitué${received.length > 1 ? "s" : ""} depuis vos transactions`}
              padded={false}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 720 }}>
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }}>
                      <th className="px-5 py-2.5 text-left font-medium">Ex-date</th>
                      <th className="px-3 py-2.5 text-left font-medium">Société</th>
                      <th className="px-3 py-2.5 text-right font-medium">Quantité</th>
                      <th className="px-3 py-2.5 text-right font-medium">Div. / action</th>
                      <th className="px-3 py-2.5 text-right font-medium">Brut</th>
                      <th className="px-3 py-2.5 text-right font-medium">Retenue</th>
                      <th className="px-5 py-2.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {received.map((d, i) => (
                      <tr key={`${d.ticker}-${d.exDate}-${i}`}
                        style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                        <td className="px-5 py-2.5 tabular-nums">{d.exDate}</td>
                        <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--text-primary)" }}>{d.ticker}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {Number(d.quantityHeld).toFixed(8).replace(/\.?0+$/, "")}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {d.amountPerShare.toFixed(4)} {d.nativeCurrency}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{format(d.gross)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {d.withholding != null ? `−${format(d.withholding)}` : "—"}
                        </td>
                        <td className="px-5 py-2.5 text-right font-bold tabular-nums" style={{ color: "var(--gain)" }}>
                          +{format(d.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </>)}

        {/* ─── Méthode de calcul (transparence) ─── */}
        <details className="rounded-2xl border overflow-hidden"
          style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
          <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3.5 list-none">
            <Info className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Comment ces montants sont calculés</span>
            <span className="ml-auto text-xs" style={{ color: "var(--text-tertiary)" }}>afficher</span>
          </summary>
          <div className="border-t px-5 py-4 space-y-2 text-xs leading-relaxed"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
            <p>
              Les versements ne sont pas estimés : on récupère le calendrier réel de chaque titre
              (date ex-dividende et montant par action effectivement versé), puis on le croise avec
              vos transactions pour connaître la quantité que vous déteniez à chaque date.
            </p>
            <p>
              <strong style={{ color: "var(--text-primary)" }}>Règle d'éligibilité :</strong> un titre acheté
              le jour de l'ex-date ou après ne donne pas droit au dividende correspondant. Les ventes
              réduisent la quantité pour les versements suivants.
            </p>
            <p>
              <strong style={{ color: "var(--text-primary)" }}>Retenue à la source :</strong> elle n'est jamais
              inventée. Elle apparaît uniquement lorsqu'une transaction de dividende en porte le montant,
              sinon « — » et le net est égal au brut.
            </p>
            {missing.length > 0 && (
              <p style={{ color: "#f59e0b" }}>
                Aucun historique de dividende trouvé pour : {missing.join(", ")} — ces titres n'en versent
                pas, ou leur symbole n'a pas pu être résolu.
              </p>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
