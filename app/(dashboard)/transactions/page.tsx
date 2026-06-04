"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { AssetClassBadge } from "@/components/ui/badge"
import { TransactionModal, type TransactionFormData } from "@/components/ui/transaction-modal"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import type { Transaction, AssetClass, TransactionType } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import type { AppCurrency } from "@/lib/utils"
import {
  Plus, Search, X, Check, ArrowUpRight, ArrowDownLeft,
  Gift, ArrowLeftRight, Pencil, Zap,
} from "lucide-react"

const TX_COLORS: Record<TransactionType, string> = {
  buy: "#3b82f6", sell: "#a78bfa", dividend: "#22c55e", transfer: "#64748b", revenu: "#a855f7",
}
const TX_LABELS: Record<TransactionType, string> = {
  buy: "Achat", sell: "Vente", dividend: "Dividende", transfer: "Transfert", revenu: "Revenu",
}
const TX_ICONS: Record<TransactionType, typeof ArrowUpRight> = {
  buy: ArrowDownLeft, sell: ArrowUpRight, dividend: Gift, transfer: ArrowLeftRight, revenu: Zap,
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { transactions, portfolios, realizedPnLEvents, addTransaction, editTransaction, removeTransaction } = useAppData()
  const { format, convert } = useCurrency()

  const [search,     setSearch]     = useState("")
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all")
  const [modal,      setModal]      = useState<{
    mode:    "add" | "edit"
    initial: TransactionFormData
  } | null>(null)

  const filtered = transactions
    .filter(t => typeFilter === "all" || t.type === typeFilter)
    .filter(t =>
      t.ticker.toLowerCase().includes(search.toLowerCase()) ||
      t.assetName.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const totalBuy  = transactions.filter(t => t.type === "buy").reduce((s, t) => s + t.quantity * t.price, 0)
  const totalSell = transactions.filter(t => t.type === "sell").reduce((s, t) => s + t.quantity * t.price, 0)
  const totalDiv  = transactions.filter(t => t.type === "dividend").reduce((s, t) => s + t.quantity * t.price, 0)
  const totalFees = transactions.reduce((s, t) => s + t.fees, 0)
  const latentPnl = portfolios.flatMap(p => p.assets).reduce((sum, asset) => {
    const pnl = (asset.currentPrice - asset.avgBuyPrice) * asset.quantity
    return sum + convert(pnl, asset.currency as AppCurrency)
  }, 0)
  const realizedPnl = useMemo(() =>
    realizedPnLEvents.reduce(
      (sum, event) => sum + convert(event.pnl, event.currency as AppCurrency),
      0
    ),
    [realizedPnLEvents, convert]
  )

  function openAdd() {
    setModal({
      mode: "add",
      initial: {
        portfolioId: portfolios[0]?.id ?? "",
        ticker: "", assetName: "", assetClass: "stock",
        type: "buy", quantity: "", price: "", nativeCurrency: "CHF", fees: "1",
        date: new Date().toISOString().slice(0, 10), notes: "",
        cryptoCustody: "", stakingEnabled: false,
      },
    })
  }

  function openEdit(tx: Transaction) {
    setModal({
      mode: "edit",
      initial: {
        id:          tx.id,
        portfolioId: tx.portfolioId,
        ticker:      tx.ticker,
        assetName:   tx.assetName,
        assetClass:  tx.assetClass,
        type:        tx.type,
        quantity:    String(tx.quantity),
        price:       String(tx.price),
        nativeCurrency: tx.currency ?? 'CHF',
        fees:        String(tx.fees),
        date:        tx.date,
        notes:       tx.notes ?? "",
        cryptoCustody: tx.cryptoCustody ?? "",
        stakingEnabled: tx.stakingEnabled ?? false,
      },
    })
  }

  async function handleSave(form: TransactionFormData) {
    if (modal?.mode === "edit" && form.id) {
      await editTransaction(form.id, {

        ticker:     form.ticker,
        assetName:  form.assetName,
        assetClass: form.assetClass,
        type:       form.type,
        quantity:   parseFloat(form.quantity),
        price:      parseFloat(form.price),
        fees:       parseFloat(form.fees) || 0,
        date:       form.date,
        notes:      form.notes || undefined,
        cryptoCustody: form.cryptoCustody || undefined,
        stakingEnabled: form.stakingEnabled,
      })
    } else {
      const res = await addTransaction({
        portfolioId: form.portfolioId,
        ticker:      form.ticker.toUpperCase(),
        assetName:   form.assetName,
        assetClass:  form.assetClass,
        type:        form.type,
        quantity:    parseFloat(form.quantity),
        price:       parseFloat(form.price),
        fees:        parseFloat(form.fees) || 0,
        currency:    "CHF",
        date:        form.date,
        notes:       form.notes || undefined,
        cryptoCustody: form.cryptoCustody || undefined,
        stakingEnabled: form.stakingEnabled,
      })
      if (!res.ok) throw new Error(res.error ?? "Erreur Supabase")
    }
    setModal(null)
  }

  return (
    <div className="flex flex-col">
      <Topbar
        title="Transactions"
        subtitle={`${transactions.length} transaction${transactions.length > 1 ? "s" : ""}`}
      />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {[
            { label: "Capital investi",   value: format(totalBuy),  color: "#3b82f6" },  // bleu neutre
            { label: "Total ventes",     value: format(totalSell), color: "#22c55e" },
            { label: "PV latente",       value: (latentPnl >= 0 ? "+" : "") + format(latentPnl), color: latentPnl >= 0 ? "#22c55e" : "#ef4444" },
            { label: "PV réalisée",      value: (realizedPnl >= 0 ? "+" : "") + format(realizedPnl), color: realizedPnl >= 0 ? "#22c55e" : "#ef4444" },
            { label: "Dividendes reçus", value: format(totalDiv),  color: "#f59e0b" },
            { label: "Frais total",      value: format(totalFees), color: "#6b7280" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
              style={{ color: "var(--text-tertiary)" }} />
            <input type="text" placeholder="Rechercher…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-lg border pl-9 pr-3 py-2 text-sm outline-none"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {(["all","buy","sell","dividend","revenu","transfer"] as const).map(f => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: typeFilter === f ? "var(--accent)" : "var(--bg-elevated)",
                  color:           typeFilter === f ? "white" : "var(--text-secondary)",
                }}>
                {f === "all" ? "Tous" : TX_LABELS[f]}
              </button>
            ))}
          </div>
          <button onClick={openAdd}
            className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
            <Plus className="h-4 w-4" /> Nouvelle transaction
          </button>
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
          <div className="hidden sm:grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)", gridTemplateColumns: "1fr 80px 70px 90px 70px 80px 56px" }}>
            <span>Actif</span>
            <span className="text-center">Type</span>
            <span className="text-right">Qté</span>
            <span className="text-right">Prix unit.</span>
            <span className="text-right">Frais</span>
            <span className="text-right">Date</span>
            <span />
          </div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-2">
              <ArrowLeftRight className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {transactions.length === 0 ? "Aucune transaction — ajoutez-en une !" : "Aucun résultat"}
              </p>
            </div>
          )}

          {filtered.map((tx, i) => {
            const color = TX_COLORS[tx.type]
            const Icon  = TX_ICONS[tx.type]
            const acCol = ASSET_CLASS_COLORS[tx.assetClass]
            return (
              <motion.div key={tx.id}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                style={{ borderTop: "1px solid var(--border-subtle)" }}>
                {/* Mobile */}
                <div className="sm:hidden flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                  <div className="h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: color + "18" }}>
                    <Icon className="h-4 w-4" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{tx.assetName}</p>
                    <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="rounded px-1.5 py-0.5 mr-1" style={{ backgroundColor: color + "18", color }}>
                        {TX_LABELS[tx.type]}
                      </span>
                      {new Date(tx.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                    </p>
                  </div>
                  <p className="text-xs font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {format(tx.price * tx.quantity)}
                  </p>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(tx)}
                      className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-700 transition-colors"
                      style={{ color: "var(--text-tertiary)" }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={() => removeTransaction(tx.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-red-500/20 transition-colors"
                      style={{ color: "var(--text-tertiary)" }}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {/* Desktop */}
                <div className="hidden sm:grid items-center px-5 py-3.5 hover:bg-zinc-800/20 transition-colors"
                  style={{ gridTemplateColumns: "1fr 80px 70px 90px 70px 80px 56px" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: color + "18" }}>
                      <Icon className="h-3.5 w-3.5" style={{ color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{tx.assetName}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{tx.ticker}</span>
                        <AssetClassBadge label={ASSET_CLASS_LABELS[tx.assetClass]} color={acCol} />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <span className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: color + "18", color }}>
                      {TX_LABELS[tx.type]}
                    </span>
                  </div>
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>{tx.quantity}</p>
                  <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {format(tx.price)}
                  </p>
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {format(tx.fees)}
                  </p>
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {new Date(tx.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                  </p>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(tx)}
                      className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-700 transition-colors"
                      style={{ color: "var(--text-tertiary)" }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={() => removeTransaction(tx.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-red-500/20 transition-colors"
                      style={{ color: "var(--text-tertiary)" }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Transaction modal — shared component with autocomplete + live price */}
      <AnimatePresence>
        {modal && (
          <TransactionModal
            mode={modal.mode}
            initial={modal.initial}
            portfolios={portfolios}
            onSave={handleSave}
            onClose={() => setModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
