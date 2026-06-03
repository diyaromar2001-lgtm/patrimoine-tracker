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
  assetsByTicker: Record<string, { quantity: number; assetClass: string; portfolioId: string }>
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

    // Add the upcoming payment
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
      status:     payDate > today ? "upcoming" : "paid",
    })

    // Project next 3 future payments based on frequency
    const msPerPeriod = (365.25 / info.frequencyCount) * 24 * 3600 * 1000
    for (let i = 1; i <= 3; i++) {
      const futurePayDate = new Date(payDate.getTime() + i * msPerPeriod)
      const futureExDate  = exDate
        ? new Date(exDate.getTime() + i * msPerPeriod)
        : new Date(futurePayDate.getTime() - 14 * 24 * 3600 * 1000)

      if (futurePayDate.getFullYear() - today.getFullYear() > 1) break // max 1 year ahead

      events.push({
        id:         `live-${info.ticker}-future-${i}`,
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
    }
  }

  return events.sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())
}

export default function DividendsPage() {
  const { portfolios }  = useAppData()
  const { format }      = useCurrency()
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
    const map: Record<string, { quantity: number; assetClass: string; portfolioId: string }> = {}
    portfolios.flatMap(p => p.assets).forEach(a => {
      if (a.assetClass !== "crypto" && a.assetClass !== "cash") {
        map[a.ticker] = { quantity: a.quantity, assetClass: a.assetClass, portfolioId: a.portfolioId }
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
  const totalAnnual = useMemo(() =>
    liveInfos.filter(i => i.paysDiv).reduce((s, i) => {
      const pos = assetsByTicker[i.ticker]
      if (!pos) return s
      return s + i.dividendRate * pos.quantity
    }, 0), [liveInfos, assetsByTicker])

  const totalPortValue = portfolios.flatMap(p => p.assets).reduce((s, a) => s + a.currentPrice * a.quantity, 0)
  const nextDiv = filtered.find(d => d.status === "upcoming")
  const daysToNext = nextDiv ? Math.ceil((new Date(nextDiv.payDate).getTime() - Date.now()) / 86400000) : null
  const paidTotal  = allDividends.filter(d => d.status === "paid").reduce((s, d) => s + d.amount, 0)
  const paidCount  = allDividends.filter(d => d.status === "paid").length

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

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
          {[
            { label: "Revenu annuel estimé", value: format(totalAnnual), sub: totalPortValue > 0 ? ((totalAnnual / totalPortValue) * 100).toFixed(2) + "% yield" : "", icon: TrendingUp, color: "#22c55e" },
            { label: "Revenu mensuel moyen", value: format(totalAnnual / 12), sub: format(totalAnnual / 52) + "/sem.", icon: CalendarDays, color: "#3b82f6" },
            { label: "Prochain versement", value: nextDiv ? "+" + format(nextDiv.amount) : "—", sub: daysToNext !== null ? "dans " + daysToNext + "j" : "", icon: Clock, color: "#f59e0b" },
            { label: "Reçus (année en cours)", value: format(paidTotal), sub: paidCount + " versement" + (paidCount > 1 ? "s" : ""), icon: CheckCircle2, color: "#a78bfa" },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color + "18" }}>
                  <Icon className="h-3.5 w-3.5" style={{ color }} />
                </div>
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{label}</p>
              </div>
              <p className="text-xl font-bold tabular-nums" style={{ color }}>{value}</p>
              {sub && <p className="text-[11px] mt-0.5" style={{ color: "var(--foreground-dim)" }}>{sub}</p>}
            </div>
          ))}
        </div>

        {/* Live yield banner — per-position data */}
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#3b82f6" }} />
            <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>Vérification des dividendes de vos positions…</span>
          </div>
        ) : Object.keys(assetsByTicker).length === 0 ? (
          <div className="rounded-xl border p-4 text-center" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", borderStyle: "dashed" }}>
            <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
              Ajoutez des actions dans votre portefeuille pour voir les dividendes
            </p>
          </div>
        ) : (
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--foreground-muted)" }}>
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse inline-block" />
                Données Yahoo Finance — {Object.keys(assetsByTicker).length} position{Object.keys(assetsByTicker).length > 1 ? "s" : ""} analysée{Object.keys(assetsByTicker).length > 1 ? "s" : ""}
              </p>
              <button onClick={fetchDividends} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] hover:bg-zinc-800 transition-colors" style={{ color: "var(--foreground-muted)" }}>
                <RefreshCw className="h-3 w-3" /> Actualiser
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(assetsByTicker).map(ticker => {
                const info = divInfoByTicker[ticker]
                const pos  = assetsByTicker[ticker]
                if (!info) {
                  return (
                    <div key={ticker} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
                      <span className="text-xs font-bold" style={{ color: "var(--foreground-dim)" }}>{ticker}</span>
                      <span className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>Pas de dividende</span>
                    </div>
                  )
                }
                const totalPerPay = info.amountPerShare * pos.quantity
                return (
                  <div key={ticker} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "#22c55e40", backgroundColor: "#22c55e08" }}>
                    <span className="text-xs font-bold" style={{ color: "#22c55e" }}>{ticker}</span>
                    <span className="text-xs font-medium tabular-nums" style={{ color: "var(--foreground)" }}>
                      {format(totalPerPay)}/{FREQ_LABEL[info.frequency] ?? info.frequency}
                    </span>
                    <span className="text-xs rounded-md px-1.5 py-0.5" style={{ backgroundColor: "#22c55e18", color: "#22c55e" }}>
                      {(info.dividendYield * 100).toFixed(2)}%
                    </span>
                    {info.exDividendDate && (
                      <span className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>
                        Ex: {new Date(info.exDividendDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
                  style={{ backgroundColor: viewMode === v ? "var(--accent)" : "var(--background-card)", color: viewMode === v ? "white" : "var(--foreground-muted)" }}>
                  {v === "list" ? "Liste" : "Calendrier"}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["all","upcoming","paid"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: filter === f ? "var(--accent)" : "var(--background-card)", color: filter === f ? "white" : "var(--foreground-muted)" }}>
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
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1) }}
                className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                <ChevronLeft className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
              </button>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{MONTHS_FR[calMonth]} {calYear}</p>
              <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1) }}
                className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                <ChevronRight className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
              </button>
            </div>
            <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--border)" }}>
              {DAYS_FR.map(d => <div key={d} className="py-2 text-center text-[11px] font-medium" style={{ color: "var(--foreground-dim)" }}>{d}</div>)}
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
                      style={{ color: isToday ? "white" : "var(--foreground-dim)" }}>
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
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--foreground-dim)", gridTemplateColumns: "1fr 100px 100px 90px 80px 90px" }}>
              <span>Actif</span><span className="text-center">Ex-Date</span><span className="text-center">Paiement</span>
              <span className="text-right">Montant</span><span className="text-center">Fréquence</span><span className="text-right">Statut</span>
            </div>

            {filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 gap-2">
                <CalendarDays className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
                <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
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
                      <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{d.assetName}</p>
                      <div className="flex items-center gap-1">
                        <AssetClassBadge label={ASSET_CLASS_LABELS[d.assetClass]} color={color} />
                        <span className="text-[10px]" style={{ color: "var(--foreground-dim)" }}>{d.ticker}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>
                    {d.exDate ? new Date(d.exDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—"}
                  </p>
                  <p className="text-center text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>
                    {new Date(d.payDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                  </p>
                  <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "#22c55e" }}>
                    +{format(d.amount)}
                  </p>
                  <p className="text-center text-xs" style={{ color: "var(--foreground-muted)" }}>
                    {FREQ_LABEL[d.frequency] ?? d.frequency}
                  </p>
                  <div className="flex justify-end"><StatusBadge status={d.status} /></div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add manual dividend */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
            onClick={() => setShowAdd(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border p-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Ajouter un dividende manuellement</h3>
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
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>{f.label}</label>
                    <input type={f.t} placeholder={f.ph} value={form[f.k as keyof typeof form] as string}
                      onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                      style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Fréquence</label>
                  <select value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value as DividendEvent["frequency"] }))}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
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
