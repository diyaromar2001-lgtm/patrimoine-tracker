"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { StatusBadge, AssetClassBadge } from "@/components/ui/badge"
import { MOCK_DIVIDENDS } from "@/lib/mock-data"
import type { DividendEvent } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import { CalendarDays, TrendingUp, Clock, CheckCircle2, Plus, X } from "lucide-react"
import { AnimatePresence } from "framer-motion"

export default function DividendsPage() {
  const [dividends, setDividends] = useState<DividendEvent[]>(MOCK_DIVIDENDS)
  const [filter, setFilter] = useState<"all" | "upcoming" | "paid">("all")
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ticker: "", assetName: "", amount: "", exDate: "", payDate: "", frequency: "quarterly" as DividendEvent["frequency"] })

  const filtered = dividends.filter(d => filter === "all" || d.status === filter)
  const upcoming = dividends.filter(d => d.status === "upcoming")
  const paid     = dividends.filter(d => d.status === "paid")
  const totalAnnual = dividends.reduce((s, d) => {
    const mult = d.frequency === "annual" ? 1 : d.frequency === "semi-annual" ? 2 : d.frequency === "quarterly" ? 4 : 12
    return s + d.amount * mult
  }, 0)
  const totalPaid = paid.reduce((s, d) => s + d.amount, 0)

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

  return (
    <div className="flex flex-col">
      <Topbar title="Dividendes" subtitle="Revenus passifs de vos placements" />
      <div className="flex-1 space-y-6 p-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Revenu annuel estimé", value: formatCurrency(totalAnnual), icon: TrendingUp, color: "#22c55e" },
            { label: "Revenu mensuel moyen", value: formatCurrency(totalAnnual / 12), icon: CalendarDays, color: "#3b82f6" },
            { label: "Versements à venir", value: upcoming.length.toString(), icon: Clock, color: "#f59e0b" },
            { label: "Versements reçus", value: formatCurrency(totalPaid), icon: CheckCircle2, color: "#a78bfa" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4" style={{ color }} />
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{label}</p>
              </div>
              <p className="text-lg font-bold tabular-nums" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Header + filters */}
        <div className="flex items-center justify-between">
          <SectionHeader title="Historique des dividendes" description={`${filtered.length} événement${filtered.length > 1 ? "s" : ""}`} />
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["all","upcoming","paid"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: filter === f ? "var(--accent)" : "var(--background-card)", color: filter === f ? "white" : "var(--foreground-muted)" }}>
                  {f === "all" ? "Tous" : f === "upcoming" ? "À venir" : "Versés"}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </button>
          </div>
        </div>

        {/* Table */}
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
            const color = ASSET_CLASS_COLORS[d.assetClass]
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
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-md rounded-2xl border p-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Ajouter un dividende</h3>
                <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors"><X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} /></button>
              </div>
              <div className="space-y-3">
                {[{ k: "ticker", ph: "Ticker (ex: MSFT)", t: "text", label: "Ticker *" }, { k: "assetName", ph: "Nom complet", t: "text", label: "Nom *" }, { k: "amount", ph: "Montant (€)", t: "number", label: "Montant *" }, { k: "exDate", ph: "", t: "date", label: "Ex-Date *" }, { k: "payDate", ph: "", t: "date", label: "Date de paiement *" }].map(f => (
                  <div key={f.k}>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>{f.label}</label>
                    <input type={f.t} placeholder={f.ph} value={form[f.k as keyof typeof form] as string} onChange={e => setForm(prev => ({ ...prev, [f.k]: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Fréquence</label>
                  <select value={form.frequency} onChange={e => setForm(prev => ({ ...prev, frequency: e.target.value as DividendEvent["frequency"] }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                    <option value="monthly">Mensuel</option><option value="quarterly">Trimestriel</option><option value="semi-annual">Semi-annuel</option><option value="annual">Annuel</option>
                  </select>
                </div>
                <button onClick={handleAdd} className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all mt-2" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>Ajouter</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}