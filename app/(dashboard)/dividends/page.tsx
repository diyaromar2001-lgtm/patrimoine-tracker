"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { StatusBadge, AssetClassBadge } from "@/components/ui/badge"
import { MOCK_DIVIDENDS, MOCK_PORTFOLIOS } from "@/lib/mock-data"
import type { DividendEvent } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS, portfolioTotalValue } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import { CalendarDays, TrendingUp, Clock, CheckCircle2, Plus, X, Check, ChevronLeft, ChevronRight } from "lucide-react"

const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"]
const DAYS_FR   = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"]

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function firstDow(y: number, m: number) { return (new Date(y, m, 1).getDay() + 6) % 7 }

const PORTFOLIO_TICKERS = MOCK_PORTFOLIOS.flatMap(p => p.assets.map(a => a.ticker))

export default function DividendsPage() {
  const [dividends, setDividends] = useState<DividendEvent[]>(MOCK_DIVIDENDS)
  const [filter, setFilter] = useState<"all"|"upcoming"|"paid">("all")
  const [viewMode, setViewMode] = useState<"list"|"calendar">("list")
  const [showAdd, setShowAdd] = useState(false)
  const [liveData, setLiveData] = useState<Record<string, { rate: number; yield: number; exDate: string | null }>>({})
  const today = new Date()
  const [calYear, setCalYear]   = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [form, setForm] = useState({ ticker: "", assetName: "", amount: "", exDate: "", payDate: "", frequency: "quarterly" as DividendEvent["frequency"] })

  // Fetch live dividend yields
  useEffect(() => {
    const fetch_ = async () => {
      const results: Record<string, { rate: number; yield: number; exDate: string | null }> = {}
      for (const ticker of PORTFOLIO_TICKERS.slice(0, 5)) {
        try {
          const res  = await fetch("/api/dividends?ticker=" + encodeURIComponent(ticker))
          const data = await res.json()
          if (data?.dividendRate) {
            results[ticker] = { rate: data.dividendRate ?? 0, yield: data.dividendYield ?? 0, exDate: data.exDividendDate ?? null }
          }
        } catch { /* skip */ }
      }
      setLiveData(results)
    }
    fetch_()
  }, [])

  const totalValue  = MOCK_PORTFOLIOS.reduce((s, p) => s + portfolioTotalValue(p), 0)
  const totalAnnual = dividends.reduce((s, d) => {
    const mult = { annual: 1, "semi-annual": 2, quarterly: 4, monthly: 12 }[d.frequency] ?? 1
    return s + d.amount * mult
  }, 0)
  const nextDiv = [...dividends].filter(d => d.status === "upcoming")
    .sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())[0]
  const daysToNext = nextDiv ? Math.ceil((new Date(nextDiv.payDate).getTime() - Date.now()) / 86400000) : null

  const filtered = dividends
    .filter(d => filter === "all" || d.status === filter)
    .sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime())

  // Calendar dividend map
  const calDivMap: Record<string, DividendEvent[]> = {}
  dividends.forEach(d => {
    const key = d.payDate?.slice(0, 10)
    if (key) calDivMap[key] = [...(calDivMap[key] ?? []), d]
  })

  const numDays  = daysInMonth(calYear, calMonth)
  const startDow = firstDow(calYear, calMonth)

  function handleAdd() {
    if (!form.ticker || !form.assetName || !form.amount || !form.exDate || !form.payDate) return
    const d: DividendEvent = {
      id: `d${Date.now()}`, ticker: form.ticker.toUpperCase(), assetName: form.assetName,
      assetClass: "stock", exDate: form.exDate, payDate: form.payDate,
      amount: parseFloat(form.amount), frequency: form.frequency, currency: "EUR",
      status: new Date(form.payDate) > new Date() ? "upcoming" : "paid",
    }
    setDividends(prev => [d, ...prev])
    setForm({ ticker: "", assetName: "", amount: "", exDate: "", payDate: "", frequency: "quarterly" })
    setShowAdd(false)
  }

  const paidTotal = dividends.filter(d => d.status === "paid").reduce((s, d) => s + d.amount, 0)
  const paidCount = dividends.filter(d => d.status === "paid").length

  return (
    <div className="flex flex-col">
      <Topbar title="Dividendes" subtitle="Revenus passifs de vos placements" />
      <div className="flex-1 space-y-6 p-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Revenu annuel estimé", value: formatCurrency(totalAnnual), sub: totalValue > 0 ? ((totalAnnual / totalValue) * 100).toFixed(2) + "% yield" : "", icon: TrendingUp, color: "#22c55e" },
            { label: "Revenu mensuel moyen", value: formatCurrency(totalAnnual / 12), sub: formatCurrency(totalAnnual / 52) + "/sem.", icon: CalendarDays, color: "#3b82f6" },
            { label: "Prochain versement", value: nextDiv ? "+" + formatCurrency(nextDiv.amount) : "—", sub: daysToNext !== null ? "dans " + daysToNext + " jour" + (daysToNext > 1 ? "s" : "") : "", icon: Clock, color: "#f59e0b" },
            { label: "Reçus (année en cours)", value: formatCurrency(paidTotal), sub: paidCount + " versement" + (paidCount > 1 ? "s" : ""), icon: CheckCircle2, color: "#a78bfa" },
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

        {/* Live yields banner */}
        {Object.keys(liveData).length > 0 && (
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--foreground-muted)" }}>
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse inline-block" />
              Données en direct — Yahoo Finance
            </p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(liveData).map(([ticker, d]) => d.rate > 0 && (
                <div key={ticker} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
                  <span className="text-xs font-bold" style={{ color: "#22c55e" }}>{ticker}</span>
                  <span className="text-xs font-medium tabular-nums" style={{ color: "var(--foreground)" }}>{formatCurrency(d.rate)}/an</span>
                  <span className="text-xs rounded-md px-1.5 py-0.5" style={{ backgroundColor: "#22c55e18", color: "#22c55e" }}>{(d.yield * 100).toFixed(2)}%</span>
                  {d.exDate && (
                    <span className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>
                      Ex: {new Date(d.exDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between">
          <SectionHeader title="Calendrier des dividendes" description={filtered.length + " événement" + (filtered.length > 1 ? "s" : "")} />
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["list","calendar"] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)} className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: viewMode === v ? "var(--accent)" : "var(--background-card)", color: viewMode === v ? "white" : "var(--foreground-muted)" }}>
                  {v === "list" ? "Liste" : "Calendrier"}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["all","upcoming","paid"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: filter === f ? "var(--accent)" : "var(--background-card)", color: filter === f ? "white" : "var(--foreground-muted)" }}>
                  {f === "all" ? "Tous" : f === "upcoming" ? "À venir" : "Versés"}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-all"
              style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
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
              {DAYS_FR.map(d => (
                <div key={d} className="py-2 text-center text-[11px] font-medium" style={{ color: "var(--foreground-dim)" }}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: startDow }, (_, i) => (
                <div key={"empty-" + i} className="h-20 border-r border-b" style={{ borderColor: "var(--border-subtle)" }} />
              ))}
              {Array.from({ length: numDays }, (_, i) => {
                const day     = i + 1
                const dateKey = calYear + "-" + String(calMonth + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0")
                const divs    = calDivMap[dateKey] ?? []
                const isToday = today.getDate() === day && today.getMonth() === calMonth && today.getFullYear() === calYear
                const hasDivs = divs.length > 0
                return (
                  <div key={day} className="h-20 border-r border-b p-1.5"
                    style={{ borderColor: "var(--border-subtle)", backgroundColor: hasDivs ? "#22c55e08" : isToday ? "#3b82f608" : "transparent" }}>
                    <span className={"text-xs font-medium flex items-center justify-center rounded-full w-5 h-5" + (isToday ? " bg-blue-500 text-white" : "")}
                      style={{ color: isToday ? "white" : "var(--foreground-dim)" }}>
                      {day}
                    </span>
                    {divs.slice(0, 2).map((d, di) => {
                      const col = ASSET_CLASS_COLORS[d.assetClass]
                      return (
                        <div key={di} className="mt-0.5 rounded px-1 text-[9px] font-semibold truncate"
                          style={{ backgroundColor: col + "22", color: col }}>
                          {d.ticker} +{formatCurrency(d.amount)}
                        </div>
                      )
                    })}
                    {divs.length > 2 && <p className="text-[9px] pl-1" style={{ color: "var(--foreground-dim)" }}>+{divs.length - 2} autre{divs.length - 2 > 1 ? "s" : ""}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* List view */}
        {viewMode === "list" && (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)", gridTemplateColumns: "1fr 100px 100px 90px 80px 90px" }}>
              <span>Actif</span><span className="text-center">Ex-Date</span><span className="text-center">Paiement</span><span className="text-right">Montant</span><span className="text-center">Fréquence</span><span className="text-right">Statut</span>
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 gap-2">
                <CalendarDays className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
                <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Aucun dividende trouvé</p>
              </div>
            )}
            {filtered.map((d, i) => {
              const color    = ASSET_CLASS_COLORS[d.assetClass]
              const freqLabel = { annual: "Annuel", "semi-annual": "Semi-ann.", quarterly: "Trimestr.", monthly: "Mensuel" }[d.frequency]
              return (
                <motion.div key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                  className="grid items-center px-5 py-3.5 transition-colors hover:bg-zinc-800/20"
                  style={{ gridTemplateColumns: "1fr 100px 100px 90px 80px 90px", borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: color + "22", color }}>{d.ticker.slice(0, 3)}</div>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{d.assetName}</p>
                      <AssetClassBadge label={ASSET_CLASS_LABELS[d.assetClass]} color={color} />
                    </div>
                  </div>
                  <p className="text-center text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{new Date(d.exDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</p>
                  <p className="text-center text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{new Date(d.payDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}</p>
                  <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "#22c55e" }}>+{formatCurrency(d.amount)}</p>
                  <p className="text-center text-xs" style={{ color: "var(--foreground-muted)" }}>{freqLabel}</p>
                  <div className="flex justify-end"><StatusBadge status={d.status} /></div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
            onClick={() => setShowAdd(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border p-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Ajouter un dividende</h3>
                <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                  <X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
                </button>
              </div>
              <div className="space-y-3">
                {[
                  { k: "ticker",    ph: "MSFT",       t: "text",   label: "Ticker *" },
                  { k: "assetName", ph: "Microsoft",  t: "text",   label: "Nom *" },
                  { k: "amount",    ph: "7.50",       t: "number", label: "Montant (€) *" },
                  { k: "exDate",    ph: "",           t: "date",   label: "Ex-Date *" },
                  { k: "payDate",   ph: "",           t: "date",   label: "Date de paiement *" },
                ].map(f => (
                  <div key={f.k}>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>{f.label}</label>
                    <input type={f.t} placeholder={f.ph} value={form[f.k as keyof typeof form] as string}
                      onChange={e => setForm(prev => ({ ...prev, [f.k]: e.target.value }))}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                      style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Fréquence</label>
                  <select value={form.frequency} onChange={e => setForm(prev => ({ ...prev, frequency: e.target.value as DividendEvent["frequency"] }))}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                    <option value="monthly">Mensuel</option>
                    <option value="quarterly">Trimestriel</option>
                    <option value="semi-annual">Semi-annuel</option>
                    <option value="annual">Annuel</option>
                  </select>
                </div>
                <button onClick={handleAdd} className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all mt-2"
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
