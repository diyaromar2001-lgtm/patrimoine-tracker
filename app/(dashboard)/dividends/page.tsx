"use client"

import { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { StatusBadge, AssetClassBadge } from "@/components/ui/badge"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import type { DividendEvent } from "@/lib/types"
import type { DividendInfo } from "@/app/api/dividends/route"
import { estimatedAnnualDividend } from "@/lib/finance"
import { summarizeDividends } from "@/lib/dividends"
import { PageHero } from "@/components/ui/page-hero"
import {
  CalendarDays, TrendingUp, Clock, CheckCircle2,
  Plus, X, Check, ChevronLeft, ChevronRight, Loader2, RefreshCw,
} from "lucide-react"

const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"]
const DAYS_FR   = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"]
const FREQ_LABEL: Record<string, string> = { annual: "Annuel", "semi-annual": "Semi-ann.", quarterly: "Trimestr.", monthly: "Mensuel" }

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function firstDow(y: number, m: number) { return (new Date(y, m, 1).getDay() + 6) % 7 }

// Generate future dividend events from live Yahoo Finance data + user's positions
function buildDividendEvents(
  infos:       DividendInfo[],
  assetsByTicker: Record<string, { quantity: number; assetClass: string; portfolioId: string; avgBuyPrice: number; currentPrice: number }>
): DividendEvent[] {
  const events: DividendEvent[] = []
  const today = new Date()

  for (const info of infos) {
    if (!info.paysDiv || !info.paymentDate) continue
    const pos = assetsByTicker[info.ticker]
    if (!pos) continue

    const totalAmount = info.amountPerShare * pos.quantity
    const payDate     = new Date(info.paymentDate)
    const exDate      = info.exDividendDate ? new Date(info.exDividendDate) : null

    // SÉMANTIQUE : un événement généré depuis Yahoo est une ESTIMATION.
    // On n'affiche JAMAIS « Versé » sans transaction réelle correspondante —
    // les dividendes encaissés vivent dans l'onglet Historique (transactions).
    // Les dates passées générées sont donc ignorées.
    if (payDate > today) {
      events.push({
        id:         `live-${info.ticker}-next`,
        ticker:     info.ticker,
        assetName:  info.name,
        assetClass: pos.assetClass as DividendEvent["assetClass"],
        exDate:     exDate ? exDate.toISOString().slice(0, 10) : payDate.toISOString().slice(0, 10),
        payDate:    payDate.toISOString().slice(0, 10),
        amount:     Math.round(totalAmount * 100) / 100,
        frequency:  info.frequency,
        currency:   info.currency as "EUR" | "USD" | "CHF" | "GBP",
        status:     "upcoming",
      })
    }

    // Project next payments — advance until we have 3 FUTURE ones
    // FIX: status is checked against today (not hardcoded "upcoming")
    const msPerPeriod = (365.25 / info.frequencyCount) * 24 * 3600 * 1000
    let futureCount = 0
    for (let i = 1; futureCount < 3 && i <= 8; i++) {
      const futurePayDate = new Date(payDate.getTime() + i * msPerPeriod)
      const futureExDate  = exDate
        ? new Date(exDate.getTime() + i * msPerPeriod)
        : new Date(futurePayDate.getTime() - 14 * 24 * 3600 * 1000)

      // Stop at 2 years ahead
      if (futurePayDate.getTime() - today.getTime() > 2 * 365.25 * 24 * 3600 * 1000) break

      const isPast = futurePayDate <= today
      if (!isPast) {
        events.push({
          id:         `live-${info.ticker}-p${i}`,
          ticker:     info.ticker,
          assetName:  info.name,
          assetClass: pos.assetClass as DividendEvent["assetClass"],
          exDate:     futureExDate.toISOString().slice(0, 10),
          payDate:    futurePayDate.toISOString().slice(0, 10),
          amount:     Math.round(totalAmount * 100) / 100,
          frequency:  info.frequency,
          currency:   info.currency as "EUR" | "USD" | "CHF" | "GBP",
          status:     "upcoming",
        })
        futureCount++
      }
    }
  }

  return events.sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())
}

export default function DividendsPage() {
  const { portfolios, transactions }  = useAppData()
  const { format, fxRates, currency } = useCurrency()

  // ── RÉEL : dividendes effectivement encaissés (transactions type=dividend) ──
  const real = useMemo(
    () => summarizeDividends(transactions, currency, fxRates as Record<string, number>),
    [transactions, currency, fxRates]
  )

  // Onglets : Vue d'ensemble / Calendrier / Historique
  const [tab, setTab] = useState<"overview" | "calendar" | "history">("overview")

  // Objectif de revenu passif mensuel (persisté localement)
  const [incomeGoal, setIncomeGoal] = useState("")
  useEffect(() => {
    try { setIncomeGoal(localStorage.getItem("dividend-income-goal") ?? "") } catch {}
  }, [])
  function saveIncomeGoal(v: string) {
    setIncomeGoal(v)
    try { localStorage.setItem("dividend-income-goal", v) } catch {}
  }
  const today           = new Date()

  const [filter,    setFilter]    = useState<"all"|"upcoming"|"paid">("all")
  const [viewMode,  setViewMode]  = useState<"list"|"calendar">("list")
  const [calYear,   setCalYear]   = useState(today.getFullYear())
  const [calMonth,  setCalMonth]  = useState(today.getMonth())
  const [loading,   setLoading]   = useState(false)
  const [showAdd,   setShowAdd]   = useState(false)
  const [liveInfos, setLiveInfos] = useState<DividendInfo[]>([])
  const [manualDivs, setManualDivs] = useState<DividendEvent[]>([])
  const [form, setForm]           = useState({
    ticker: "", assetName: "", amount: "", exDate: "", payDate: "",
    frequency: "quarterly" as DividendEvent["frequency"],
  })

  // Assets indexed by ticker — only stocks & ETFs (not crypto)
  const assetsByTicker = useMemo(() => {
    const map: Record<string, { quantity: number; assetClass: string; portfolioId: string; avgBuyPrice: number; currentPrice: number }> = {}
    portfolios.flatMap(p => p.assets).forEach(a => {
      if (a.assetClass !== "crypto" && a.assetClass !== "cash") {
        map[a.ticker] = {
          quantity: a.quantity,
          assetClass: a.assetClass,
          portfolioId: a.portfolioId,
          avgBuyPrice: a.avgBuyPrice,
          currentPrice: a.currentPrice,
        }
      }
    })
    return map
  }, [portfolios])

  // Fetch dividend info for all held tickers
  const fetchDividends = async () => {
    const tickers = Object.keys(assetsByTicker)
    if (!tickers.length) { setLiveInfos([]); return }
    setLoading(true)
    try {
      const res  = await fetch(`/api/dividends?tickers=${tickers.join(",")}`)
      const data: DividendInfo[] = await res.json()
      setLiveInfos(data.filter(Boolean))
    } catch {/* ignore */}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchDividends() }, [JSON.stringify(Object.keys(assetsByTicker))])

  // Build dividend events from live data + manual entries
  const autoEvents   = useMemo(() => buildDividendEvents(liveInfos, assetsByTicker), [liveInfos, assetsByTicker])
  const allDividends = useMemo(() => {
    const seen = new Set<string>()
    return [...autoEvents, ...manualDivs].filter(d => {
      const key = `${d.ticker}-${d.payDate}`
      if (seen.has(key)) return false
      seen.add(key); return true
    }).sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())
  }, [autoEvents, manualDivs])

  const filtered = allDividends.filter(d => filter === "all" || d.status === filter)

  // Live yield banner data
  const divInfoByTicker = useMemo(() => {
    const m: Record<string, DividendInfo> = {}
    liveInfos.forEach(i => { if (i.paysDiv) m[i.ticker] = i })
    return m
  }, [liveInfos])

  // KPI totals — in user's currency (convert from asset currency)
  const totalAnnualChf = useMemo(() =>
    estimatedAnnualDividend(liveInfos.filter(i => i.paysDiv).map(i => {
      const pos = assetsByTicker[i.ticker]
      return {
        amount: i.dividendRate,
        currency: i.currency,
        frequency: "annual",
        quantity: pos?.quantity ?? 0,
      }
    }), fxRates), [liveInfos, assetsByTicker, fxRates])

  const totalPortValue = portfolios.flatMap(p => p.assets).reduce((s, a) => s + a.currentPrice * a.quantity, 0)
  const nextDiv = filtered.find(d => d.status === "upcoming")
  const daysToNext = nextDiv ? Math.ceil((new Date(nextDiv.payDate).getTime() - Date.now()) / 86400000) : null
  // (les « reçus » viennent désormais des transactions réelles via summarizeDividends)

  // Calendar map
  const calDivMap: Record<string, DividendEvent[]> = {}
  allDividends.forEach(d => {
    const key = d.payDate?.slice(0, 10)
    if (key) calDivMap[key] = [...(calDivMap[key] ?? []), d]
  })

  function handleAddManual() {
    if (!form.ticker || !form.assetName || !form.amount || !form.exDate || !form.payDate) return
    const d: DividendEvent = {
      id: `manual-${Date.now()}`, ticker: form.ticker.toUpperCase(), assetName: form.assetName,
      assetClass: "stock", exDate: form.exDate, payDate: form.payDate,
      amount: parseFloat(form.amount), frequency: form.frequency, currency: "CHF",
      status: new Date(form.payDate) > new Date() ? "upcoming" : "paid",
    }
    setManualDivs(prev => [d, ...prev])
    setForm({ ticker: "", assetName: "", amount: "", exDate: "", payDate: "", frequency: "quarterly" })
    setShowAdd(false)
  }

  const numDays  = daysInMonth(calYear, calMonth)
  const startDow = firstDow(calYear, calMonth)

  return (
    <div className="flex flex-col">
      <Topbar title="Dividendes" subtitle="Revenus passifs de vos placements" />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">

        {/* ─── Onglets ─── */}
        <div role="tablist" aria-label="Sections dividendes"
          className="inline-flex items-center gap-0.5 rounded-lg border p-0.5 self-start"
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

        {tab === "overview" && (<>
        {/* Héro : le revenu RÉEL encaissé domine ; l'estimé reste secondaire */}
        <PageHero
          label="Dividendes reçus cette année (net)"
          value={format(real.receivedYtdNet)}
          glow="#22c55e"
          stats={[
            ...(real.withholdingYtd > 0 ? [{
              label: "Brut / retenue",
              value: `${format(real.receivedYtdGross)} · −${format(real.withholdingYtd)}`,
            }] : []),
            {
              label: "Moyenne mensuelle (12 m réels)",
              value: format(real.monthlyAvg12m),
              title: `${format(real.received12mNet)} sur 12 mois glissants`,
            },
            {
              label: "Revenu annuel estimé",
              value: format(totalAnnualChf, "CHF"),
              title: totalPortValue > 0
                ? `${((totalAnnualChf / totalPortValue) * 100).toFixed(2)} % de rendement courant — estimation (taux Yahoo × positions)`
                : "Estimation (taux Yahoo × positions actuelles)",
            },
            {
              label: "Prochain versement (estimé)",
              value: nextDiv ? `+${format(nextDiv.amount)}` : "—",
              color: nextDiv ? "#f59e0b" : undefined,
              title: daysToNext !== null ? `dans ${daysToNext} j` : undefined,
            },
          ]}
        />

        {/* Qualité des estimations — diagnostic Yahoo replié (contenu secondaire) */}
        <details className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium list-none flex items-center gap-2"
            style={{ color: "var(--text-secondary)" }}>
            <RefreshCw className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
            Qualité des estimations — données Yahoo par position
            <span className="ml-auto text-[11px]" style={{ color: "var(--text-tertiary)" }}>afficher / masquer</span>
          </summary>
          <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--border-subtle)" }}>
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border p-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#3b82f6" }} />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Vérification des dividendes de vos positions…</span>
          </div>
        ) : Object.keys(assetsByTicker).length === 0 ? (
          <div className="rounded-xl border p-4 text-center" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", borderStyle: "dashed" }}>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Ajoutez des actions dans votre portefeuille pour voir les dividendes
            </p>
          </div>
        ) : (
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse inline-block" />
                Données Yahoo Finance — {Object.keys(assetsByTicker).length} position{Object.keys(assetsByTicker).length > 1 ? "s" : ""} analysée{Object.keys(assetsByTicker).length > 1 ? "s" : ""}
              </p>
              <button onClick={fetchDividends} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] hover:bg-zinc-800 transition-colors" style={{ color: "var(--text-secondary)" }}>
                <RefreshCw className="h-3 w-3" /> Actualiser
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(assetsByTicker).map(ticker => {
                const info = divInfoByTicker[ticker]
                const pos  = assetsByTicker[ticker]
                if (!info) {
                  return (
                    <div key={ticker} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-base)" }}>
                      <span className="text-xs font-bold" style={{ color: "var(--text-tertiary)" }}>{ticker}</span>
                      <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Pas de dividende</span>
                    </div>
                  )
                }
                const totalPerPay = info.amountPerShare * pos.quantity
                const yoc = pos.avgBuyPrice > 0 ? (info.dividendRate / pos.avgBuyPrice) * 100 : 0
                return (
                  <div key={ticker} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "#22c55e40", backgroundColor: "#22c55e08" }}>
                    <span className="text-xs font-bold" style={{ color: "#22c55e" }}>{ticker}</span>
                    <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {format(totalPerPay)}/{FREQ_LABEL[info.frequency] ?? info.frequency}
                    </span>
                    <span className="text-xs rounded-md px-1.5 py-0.5" style={{ backgroundColor: "#22c55e18", color: "#22c55e" }}>
                      Actuel {(info.dividendYield * 100).toFixed(2)}%
                    </span>
                    <span className="text-xs rounded-md px-1.5 py-0.5" style={{ backgroundColor: "#3b82f618", color: "#3b82f6" }}>
                      YOC {yoc.toFixed(2)}%
                    </span>
                    {info.exDividendDate && (
                      <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        Ex: {new Date(info.exDividendDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
          </div>
        </details>

        {/* ─── Top distributeurs (l'historique complet vit dans son onglet) ─── */}
        {real.history.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-1">
            {/* Top distributeurs + concentration */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Top distributeurs (12 mois)</p>
              <p className="text-[11px] mt-0.5 mb-4" style={{ color: "var(--text-tertiary)" }}>Part de chaque actif dans vos revenus réels</p>
              <div className="space-y-3">
                {real.byTicker.slice(0, 6).map(t => (
                  <div key={t.ticker} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{t.ticker}</span>
                      <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {format(t.net)} · <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{t.pct.toFixed(0)} %</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-muted)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, t.pct)}%`, backgroundColor: t.pct > 50 ? "#f59e0b" : "#22c55e" }} />
                    </div>
                  </div>
                ))}
              </div>
              {real.topConcentrationPct > 50 && real.byTicker.length > 1 && (
                <p className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                  {real.byTicker[0].ticker} fournit {real.topConcentrationPct.toFixed(0)} % de vos dividendes — revenus concentrés sur un seul actif.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ─── Objectif de revenu passif ─── */}
        <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Objectif de revenu passif</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Cible mensuelle vs revenus estimés actuels</p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="div-goal" className="text-xs" style={{ color: "var(--text-secondary)" }}>Cible / mois</label>
              <input id="div-goal" type="number" min="0" value={incomeGoal}
                onChange={e => saveIncomeGoal(e.target.value)}
                className="input w-24 !py-1.5 text-right text-xs" placeholder="100" />
            </div>
          </div>
          {(() => {
            const goal = Number(incomeGoal)
            if (!Number.isFinite(goal) || goal <= 0) return (
              <p className="mt-3 text-xs" style={{ color: "var(--text-tertiary)" }}>Fixez une cible mensuelle pour suivre votre progression.</p>
            )
            const currentMonthly = totalAnnualChf / 12
            const progress = Math.min(100, (currentMonthly / goal) * 100)
            const yieldPct = totalPortValue > 0 ? (totalAnnualChf / totalPortValue) * 100 : 0
            const capital = yieldPct > 0 ? (goal * 12) / (yieldPct / 100) : null
            return (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold tabular-nums" style={{ color: progress >= 100 ? "var(--gain)" : "var(--text-primary)" }}>
                    {format(currentMonthly)} / {format(goal)} · {progress.toFixed(0)} %
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {capital != null ? `capital nécessaire ≈ ${format(capital)}` : "rendement estimé indisponible"}
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-muted)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, background: progress >= 100 ? "var(--gain)" : "linear-gradient(90deg, var(--accent), #818cf8)" }} />
                </div>
                <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  Hypothèses : revenu mensuel = revenu annuel estimé ÷ 12 (taux Yahoo × positions actuelles) ;
                  capital nécessaire calculé au rendement courant de {yieldPct.toFixed(2)} % — estimations, pas des promesses.
                </p>
              </div>
            )
          })()}
        </div>

        {/* ─── Résumé mensuel ─── */}
        {allDividends.length > 0 && (
          <div className="space-y-2">
            <SectionHeader title="Prévision mensuelle" description="Versements attendus par mois" />
            <div className="overflow-x-auto">
              <div className="flex gap-2 pb-1" style={{ minWidth: "max-content" }}>
                {Array.from({ length: 12 }, (_, m) => {
                  const monthDivs = allDividends.filter(d => new Date(d.payDate).getMonth() === m)
                  const total = monthDivs.reduce((s, d) => s + d.amount, 0)
                  const isCurrentMonth = m === today.getMonth()
                  const monthName = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Aoû","Sep","Oct","Nov","Déc"][m]
                  return (
                    <div key={m}
                      className="flex flex-col items-center rounded-xl border px-3 py-2.5 min-w-[56px]"
                      style={{
                        backgroundColor: isCurrentMonth ? "var(--accent)" + "15" : "var(--bg-elevated)",
                        borderColor:     isCurrentMonth ? "var(--accent)" : "var(--border)",
                      }}>
                      <p className="text-[10px] font-medium" style={{ color: isCurrentMonth ? "var(--accent)" : "var(--text-tertiary)" }}>
                        {monthName}
                      </p>
                      <p className="text-xs font-bold tabular-nums mt-0.5" style={{ color: total > 0 ? "#22c55e" : "var(--text-tertiary)" }}>
                        {total > 0 ? format(total) : "—"}
                      </p>
                      {monthDivs.length > 0 && (
                        <p className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                          {monthDivs.length} versmt
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        </>)}

        {tab === "calendar" && (<>
        {/* Controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            title="Calendrier des dividendes"
            description={`${filtered.length} événement${filtered.length > 1 ? "s" : ""}${autoEvents.length > 0 ? " · généré automatiquement depuis vos positions" : ""}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["list","calendar"] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: viewMode === v ? "var(--accent)" : "var(--bg-elevated)", color: viewMode === v ? "white" : "var(--text-secondary)" }}>
                  {v === "list" ? "Liste" : "Calendrier"}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["all","upcoming","paid"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: filter === f ? "var(--accent)" : "var(--bg-elevated)", color: filter === f ? "white" : "var(--text-secondary)" }}>
                  {f === "all" ? "Tous" : f === "upcoming" ? "À venir" : "Versés"}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
              <Plus className="h-3.5 w-3.5" /> Ajouter manuellement
            </button>
          </div>
        </div>

        {/* Calendar view */}
        {viewMode === "calendar" && (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1) }}
                className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                <ChevronLeft className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
              </button>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{MONTHS_FR[calMonth]} {calYear}</p>
              <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1) }}
                className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                <ChevronRight className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>
            <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--border)" }}>
              {DAYS_FR.map(d => <div key={d} className="py-2 text-center text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: startDow }, (_, i) => (
                <div key={"e" + i} className="h-20 border-r border-b" style={{ borderColor: "var(--border-subtle)" }} />
              ))}
              {Array.from({ length: numDays }, (_, i) => {
                const day     = i + 1
                const dateKey = calYear + "-" + String(calMonth + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0")
                const divs    = calDivMap[dateKey] ?? []
                const isToday = today.getDate() === day && today.getMonth() === calMonth && today.getFullYear() === calYear
                return (
                  <div key={day} className="h-20 border-r border-b p-1.5"
                    style={{ borderColor: "var(--border-subtle)", backgroundColor: divs.length > 0 ? "#22c55e06" : isToday ? "#3b82f606" : "transparent" }}>
                    <span className={"text-xs font-medium flex items-center justify-center rounded-full w-5 h-5" + (isToday ? " bg-blue-500 text-white" : "")}
                      style={{ color: isToday ? "white" : "var(--text-tertiary)" }}>
                      {day}
                    </span>
                    {divs.slice(0, 2).map((d, di) => (
                      <div key={di} className="mt-0.5 rounded px-1 text-[9px] font-semibold truncate"
                        style={{ backgroundColor: "#22c55e22", color: "#22c55e" }}>
                        {d.ticker} +{format(d.amount)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* List view */}
        {viewMode === "list" && (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-tertiary)", gridTemplateColumns: "1fr 100px 100px 90px 80px 90px" }}>
              <span>Actif</span><span className="text-center">Ex-Date</span><span className="text-center">Paiement</span>
              <span className="text-right">Montant</span><span className="text-center">Fréquence</span><span className="text-right">Statut</span>
            </div>

            {filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 gap-2">
                <CalendarDays className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {Object.keys(assetsByTicker).length === 0
                    ? "Ajoutez des actifs pour voir vos dividendes"
                    : "Aucun dividende trouvé pour vos positions"}
                </p>
              </div>
            )}

            {filtered.map((d, i) => {
              const color = ASSET_CLASS_COLORS[d.assetClass]
              return (
                <motion.div key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="grid items-center px-5 py-3.5 transition-colors hover:bg-zinc-800/20"
                  style={{ gridTemplateColumns: "1fr 100px 100px 90px 80px 90px", borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>
                      {d.ticker.slice(0, 3)}
                    </div>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{d.assetName}</p>
                      <div className="flex items-center gap-1">
                        <AssetClassBadge label={ASSET_CLASS_LABELS[d.assetClass]} color={color} />
                        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{d.ticker}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {d.exDate ? new Date(d.exDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—"}
                  </p>
                  <p className="text-center text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {new Date(d.payDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                  </p>
                  <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "#22c55e" }}>
                    +{format(d.amount)}
                  </p>
                  <p className="text-center text-xs" style={{ color: "var(--text-secondary)" }}>
                    {FREQ_LABEL[d.frequency] ?? d.frequency}
                  </p>
                  <div className="flex justify-end"><StatusBadge status={d.status} /></div>
                </motion.div>
              )
            })}
          </div>
        )}
        </>)}

        {/* ─── Onglet Historique : transactions réelles uniquement ─── */}
        {tab === "history" && (
          real.history.length === 0 ? (
            <div className="rounded-2xl border p-10 text-center"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Aucun dividende encaissé</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Les dividendes importés ou saisis comme transactions apparaîtront ici avec brut, impôt et net.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border overflow-hidden"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="border-b px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Dividendes encaissés</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {real.history.length} versement(s) issus de vos transactions réelles
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 560 }}>
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }}>
                      <th className="px-5 py-2.5 text-left font-medium">Date</th>
                      <th className="px-3 py-2.5 text-left font-medium">Actif</th>
                      <th className="px-3 py-2.5 text-right font-medium">Brut</th>
                      <th className="px-3 py-2.5 text-right font-medium">Impôt</th>
                      <th className="px-3 py-2.5 text-right font-medium">Net</th>
                      <th className="px-3 py-2.5 text-left font-medium">Devise</th>
                      <th className="px-5 py-2.5 text-right font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {real.history.map((d, i) => (
                      <tr key={`${d.ticker}-${d.date}-${i}`}
                        style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                        <td className="px-5 py-2.5 tabular-nums">{d.date}</td>
                        <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--text-primary)" }}>{d.ticker}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{format(d.gross)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{d.withholding > 0 ? `−${format(d.withholding)}` : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: "var(--gain)" }}>+{format(d.net)}</td>
                        <td className="px-3 py-2.5">{d.nativeCurrency}</td>
                        <td className="px-5 py-2.5 text-right">
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: "#22c55e18", color: "#22c55e" }}>Confirmé</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>

      {/* Add manual dividend */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
            onClick={() => setShowAdd(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border p-6" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Ajouter un dividende manuellement</h3>
                <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-zinc-800"><X className="h-4 w-4 text-zinc-500" /></button>
              </div>
              <div className="space-y-3">
                {[
                  { k: "ticker", ph: "MSFT", t: "text", label: "Ticker *" },
                  { k: "assetName", ph: "Microsoft", t: "text", label: "Nom *" },
                  { k: "amount", ph: "7.50", t: "number", label: "Montant total (CHF) *" },
                  { k: "exDate", ph: "", t: "date", label: "Ex-Date *" },
                  { k: "payDate", ph: "", t: "date", label: "Date de paiement *" },
                ].map(f => (
                  <div key={f.k}>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{f.label}</label>
                    <input type={f.t} placeholder={f.ph} value={form[f.k as keyof typeof form] as string}
                      onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)", colorScheme: "dark" }} />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Fréquence</label>
                  <select value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value as DividendEvent["frequency"] }))}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    <option value="monthly">Mensuel</option>
                    <option value="quarterly">Trimestriel</option>
                    <option value="semi-annual">Semi-annuel</option>
                    <option value="annual">Annuel</option>
                  </select>
                </div>
                <button onClick={handleAddManual}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 mt-2"
                  style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                  <Check className="h-4 w-4" /> Ajouter
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
