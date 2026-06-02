"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { AssetClassBadge } from "@/components/ui/badge"
import { MOCK_TRANSACTIONS } from "@/lib/mock-data"
import type { Transaction, AssetClass, TransactionType } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import { Plus, Search, X, Check, ArrowUpRight, ArrowDownLeft, Gift, ArrowLeftRight } from "lucide-react"

const TX_COLORS: Record<TransactionType, string> = { buy: "#22c55e", sell: "#ef4444", dividend: "#f59e0b", transfer: "#3b82f6" }
const TX_LABELS: Record<TransactionType, string> = { buy: "Achat", sell: "Vente", dividend: "Dividende", transfer: "Transfert" }
const TX_ICONS: Record<TransactionType, typeof ArrowUpRight> = { buy: ArrowDownLeft, sell: ArrowUpRight, dividend: Gift, transfer: ArrowLeftRight }

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all")
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ticker: "", assetName: "", assetClass: "stock" as AssetClass, type: "buy" as TransactionType, quantity: "", price: "", fees: "", date: new Date().toISOString().slice(0, 10), notes: "" })

  const filtered = transactions
    .filter(t => typeFilter === "all" || t.type === typeFilter)
    .filter(t => t.ticker.toLowerCase().includes(search.toLowerCase()) || t.assetName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const totalBuy  = transactions.filter(t => t.type === "buy").reduce((s, t) => s + t.quantity * t.price, 0)
  const totalSell = transactions.filter(t => t.type === "sell").reduce((s, t) => s + t.quantity * t.price, 0)
  const totalDiv  = transactions.filter(t => t.type === "dividend").reduce((s, t) => s + t.quantity * t.price, 0)
  const totalFees = transactions.reduce((s, t) => s + t.fees, 0)

  function handleAdd() {
    if (!form.ticker || !form.assetName || !form.quantity || !form.price || !form.date) return
    const tx: Transaction = {
      id: `t${Date.now()}`, portfolioId: "p1", ticker: form.ticker.toUpperCase(), assetName: form.assetName,
      assetClass: form.assetClass, type: form.type, quantity: parseFloat(form.quantity),
      price: parseFloat(form.price), fees: parseFloat(form.fees) || 0,
      currency: "EUR", date: form.date, notes: form.notes || undefined,
    }
    setTransactions(prev => [tx, ...prev])
    setForm({ ticker: "", assetName: "", assetClass: "stock", type: "buy", quantity: "", price: "", fees: "", date: new Date().toISOString().slice(0, 10), notes: "" })
    setShowAdd(false)
  }

  function handleDelete(id: string) {
    setTransactions(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Transactions" subtitle={`${transactions.length} transaction${transactions.length > 1 ? "s" : ""}`} />
      <div className="flex-1 space-y-6 p-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total achats", value: formatCurrency(totalBuy), color: "#ef4444" },
            { label: "Total ventes", value: formatCurrency(totalSell), color: "#22c55e" },
            { label: "Dividendes reçus", value: formatCurrency(totalDiv), color: "#f59e0b" },
            { label: "Frais total", value: formatCurrency(totalFees), color: "#6b7280" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{s.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />
            <input type="text" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
              className="rounded-lg border pl-9 pr-3 py-2 text-sm outline-none"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {(["all","buy","sell","dividend","transfer"] as const).map(f => (
              <button key={f} onClick={() => setTypeFilter(f)} className="px-3 py-1.5 text-xs font-medium transition-colors" style={{ backgroundColor: typeFilter === f ? "var(--accent)" : "var(--background-card)", color: typeFilter === f ? "white" : "var(--foreground-muted)" }}>
                {f === "all" ? "Tous" : TX_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
              <Plus className="h-4 w-4" /> Nouvelle transaction
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
          <div className="grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--foreground-dim)", gridTemplateColumns: "1fr 80px 70px 90px 70px 80px 32px" }}>
            <span>Actif</span><span className="text-center">Type</span><span className="text-right">Qté</span><span className="text-right">Prix unit.</span><span className="text-right">Frais</span><span className="text-right">Date</span><span />
          </div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-2">
              <ArrowLeftRight className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
              <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Aucune transaction trouvée</p>
            </div>
          )}

          {filtered.map((tx, i) => {
            const color   = TX_COLORS[tx.type]
            const Icon    = TX_ICONS[tx.type]
            const acColor = ASSET_CLASS_COLORS[tx.assetClass]
            return (
              <motion.div key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                className="grid items-center px-5 py-3.5 transition-colors hover:bg-zinc-800/20"
                style={{ gridTemplateColumns: "1fr 80px 70px 90px 70px 80px 32px", borderTop: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{tx.assetName}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>{tx.ticker}</span>
                      <AssetClassBadge label={ASSET_CLASS_LABELS[tx.assetClass]} color={acColor} />
                    </div>
                  </div>
                </div>
                <div className="flex justify-center">
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: color + "18", color }}>{TX_LABELS[tx.type]}</span>
                </div>
                <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{tx.quantity}</p>
                <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>{formatCurrency(tx.price)}</p>
                <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-dim)" }}>{formatCurrency(tx.fees)}</p>
                <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{new Date(tx.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}</p>
                <button onClick={() => handleDelete(tx.id)} className="flex items-center justify-center h-7 w-7 rounded-md transition-colors hover:bg-red-500/20 ml-auto" style={{ color: "var(--foreground-dim)" }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.75)" }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-lg rounded-2xl border p-6" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Nouvelle transaction</h3>
                <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors"><X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} /></button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[{ k: "ticker", ph: "AAPL", t: "text", label: "Ticker *" }, { k: "assetName", ph: "Apple Inc.", t: "text", label: "Nom *" }, { k: "quantity", ph: "10", t: "number", label: "Quantité *" }, { k: "price", ph: "150.00", t: "number", label: "Prix unitaire (€) *" }, { k: "fees", ph: "2.50", t: "number", label: "Frais (€)" }, { k: "date", ph: "", t: "date", label: "Date *" }].map(f => (
                  <div key={f.k}>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>{f.label}</label>
                    <input type={f.t} placeholder={f.ph} value={form[f.k as keyof typeof form] as string} onChange={e => setForm(prev => ({ ...prev, [f.k]: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Type *</label>
                  <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value as TransactionType }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                    {(Object.entries(TX_LABELS) as [TransactionType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Classe</label>
                  <select value={form.assetClass} onChange={e => setForm(prev => ({ ...prev, assetClass: e.target.value as AssetClass }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                    {(Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Notes</label>
                <input type="text" placeholder="Optionnel…" value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none" style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
              </div>
              <div className="mt-5 flex gap-3">
                <button onClick={handleAdd} className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                  <Check className="h-4 w-4" /> Enregistrer
                </button>
                <button onClick={() => setShowAdd(false)} className="rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors" style={{ color: "var(--foreground-muted)", border: "1px solid var(--border)" }}>Annuler</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}