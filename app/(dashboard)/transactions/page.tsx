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
  Gift, ArrowLeftRight, Pencil, Zap, Wallet,
} from "lucide-react"

const TX_COLORS: Record<TransactionType, string> = {
  buy: "#3b82f6", sell: "#a78bfa", dividend: "#22c55e", transfer: "#64748b", revenu: "#a855f7", deposit: "#0ea5e9", withdrawal: "#ef4444", conversion: "#f59e0b",
}
const TX_LABELS: Record<TransactionType, string> = {
  buy: "Achat", sell: "Vente", dividend: "Dividende", transfer: "Transfert", revenu: "Revenu", deposit: "Dépôt", withdrawal: "Retrait", conversion: "Conversion",
}
const TX_ICONS: Record<TransactionType, typeof ArrowUpRight> = {
  buy: ArrowDownLeft, sell: ArrowUpRight, dividend: Gift, transfer: ArrowLeftRight, revenu: Zap, deposit: Wallet, withdrawal: Wallet, conversion: ArrowLeftRight,
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { transactions, portfolios, realizedPnLEvents, addTransaction, editTransaction, removeTransaction, depositCash } = useAppData()
  const { format, convert, fxRates, currency } = useCurrency()

  const [search,     setSearch]     = useState("")
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all")
  const [modal,      setModal]      = useState<{
    mode:    "add" | "edit"
    initial: TransactionFormData
  } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null) // transaction ID to delete

  const filtered = transactions
    .filter(t => typeFilter === "all" || t.type === typeFilter)
    .filter(t =>
      t.ticker.toLowerCase().includes(search.toLowerCase()) ||
      t.assetName.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // ── KPIs : utiliser netAmountChf (taux historique) sinon fallback convert() ──
  // Jamais additionner t.price directement — c'est en devise native (USD/EUR/CHF mélangés)
  const userRate  = (fxRates as Record<string, number>)[currency] ?? 1
  const toUser    = (chf: number) => chf * userRate

  const totalBuy  = transactions.filter(t => t.type === "buy")
    .reduce((s, t) => s + toUser(t.netAmountChf ?? (t.quantity * t.price * ((fxRates as Record<string,number>)[t.currency] ?? 1) / ((fxRates as Record<string,number>)["CHF"] ?? 1))), 0)
  const totalSell = transactions.filter(t => t.type === "sell")
    .reduce((s, t) => s + toUser(t.netAmountChf ?? (t.quantity * t.price * ((fxRates as Record<string,number>)[t.currency] ?? 1) / ((fxRates as Record<string,number>)["CHF"] ?? 1))), 0)
  const totalDiv  = transactions.filter(t => t.type === "dividend")
    .reduce((s, t) => s + toUser(t.netAmountChf ?? convert(t.quantity * t.price, t.currency as AppCurrency)), 0)
  const totalFees = transactions
    .reduce((s, t) => s + toUser(t.feesChf ?? convert(t.fees, t.currency as AppCurrency)), 0)

  // ── PnL latent : asset.currentPrice est déjà en devise user (depuis livePrices) ──
  // NE PAS appeler convert() dessus — ce serait une double-conversion
  const latentPnl = portfolios.flatMap(p => p.assets)
    .filter(a => a.assetClass !== "cash")
    .reduce((sum, asset) => {
      // currentPrice vient de livePrices.price → déjà converti en devise user
      const valueUser = asset.currentPrice * asset.quantity
      const costUser  = toUser(asset.costBasisChf ?? 0)
      return sum + valueUser - costUser
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
        type: "buy", quantity: "", price: "", nativeCurrency: "CHF", selectedClass: "stock", fees: "1",
        date: new Date().toISOString().slice(0, 10), notes: "",
              },
    })
  }

  function openEdit(tx: Transaction) {
    setModal({
      mode: "edit",
      initial: {
        id:            tx.id,
        portfolioId:   tx.portfolioId,
        selectedClass: "stock" as const,
        ticker:        tx.ticker,
        assetName:     tx.assetName,
        assetClass:    tx.assetClass,
        type:          tx.type,
        quantity:      String(tx.quantity),
        price:         String(tx.price),
        nativeCurrency: tx.currency ?? 'CHF',
        fees:          String(tx.fees),
        date:          tx.date,
        notes:       tx.notes ?? "",
              },
    })
  }

  async function handleSave(form: TransactionFormData) {
    // ── Dépôt de liquidité globale ───────────────────────────────────────────
    if (form.selectedClass === "cash" || form.type === "deposit") {
      const amount   = parseFloat(form.depositAmount || "0")
      const currency = (form.depositCurrency || "CHF") as "CHF" | "USD" | "EUR"
      if (!amount || amount <= 0) throw new Error("Montant invalide")
      const globalPid = portfolios[0]?.id
      if (!globalPid) throw new Error("Aucun portefeuille disponible")
      await depositCash(globalPid, amount, currency)
      setModal(null)
      return
    }
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
                    <button onClick={() => setDeleteConfirm(tx.id)}
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
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>{Number(tx.quantity).toFixed(8).replace(/\.?0+$/, '')}</p>
                  {/* Prix unit. + total net */}
                  <div className="text-right">
                    <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {format(tx.price)}
                    </p>
                    {(() => {
                      const ur = (fxRates as Record<string,number>)[currency] ?? 1
                      const net = tx.type === "buy"
                        ? toUser(tx.netAmountChf ?? (tx.quantity * tx.price + tx.fees))
                        : tx.type === "sell"
                        ? toUser(tx.netAmountChf ?? (tx.quantity * tx.price - tx.fees))
                        : null
                      if (!net) return null
                      return (
                        <p className="text-[10px] tabular-nums mt-0.5"
                          style={{ color: tx.type === "sell" ? "var(--gain)" : "var(--text-tertiary)" }}>
                          {tx.type === "sell" ? "+" : "−"}{format(net)}
                        </p>
                      )
                    })()}
                  </div>
                  {/* Frais */}
                  <div className="text-right">
                    <p className="text-xs tabular-nums" style={{ color: tx.fees > 0 ? "#f59e0b" : "var(--text-tertiary)" }}>
                      {tx.fees > 0 ? `−${format(toUser(tx.feesChf ?? tx.fees))}` : "—"}
                    </p>
                    {tx.type === "sell" && tx.realizedPnlChf != null && tx.realizedPnlChf !== 0 && (
                      <p className="text-[10px] tabular-nums mt-0.5 font-semibold"
                        style={{ color: tx.realizedPnlChf >= 0 ? "var(--gain)" : "var(--loss)" }}>
                        P&L {tx.realizedPnlChf >= 0 ? "+" : ""}{format(toUser(tx.realizedPnlChf))}
                      </p>
                    )}
                  </div>
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

      {/* Delete transaction confirmation modal */}
      <AnimatePresence>
        {deleteConfirm && (() => {
          const tx = transactions.find(t => t.id === deleteConfirm)
          if (!tx) return null
          const ur = (fxRates as Record<string,number>)[currency] ?? 1
          const net = tx.type === "buy"
            ? toUser(tx.netAmountChf ?? (tx.quantity * tx.price + tx.fees))
            : tx.type === "sell"
            ? toUser(tx.netAmountChf ?? (tx.quantity * tx.price - tx.fees))
            : 0
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
              onClick={() => setDeleteConfirm(null)}>
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-sm rounded-2xl border overflow-hidden"
                style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Supprimer la transaction</h3>
                  <button onClick={() => setDeleteConfirm(null)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                    <X className="h-4 w-4 text-zinc-500" />
                  </button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {TX_LABELS[tx.type]} — {tx.assetName}
                    </p>
                    <div className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <p>Ticker: <strong>{tx.ticker}</strong></p>
                      <p>Quantité: <strong>{Number(tx.quantity).toFixed(8).replace(/\.?0+$/, '')}</strong></p>
                      <p>Montant net: <strong>{tx.type === "sell" ? "+" : "−"}{format(net)}</strong></p>
                      {tx.feesChf && tx.feesChf > 0 && (
                        <p>Frais: <strong>−{format(toUser(tx.feesChf))}</strong></p>
                      )}
                      {tx.type === "sell" && tx.realizedPnlChf != null && (
                        <p>P&L réalisé: <strong style={{ color: tx.realizedPnlChf >= 0 ? "#22c55e" : "#ef4444" }}>
                          {tx.realizedPnlChf >= 0 ? "+" : ""}{format(toUser(tx.realizedPnlChf))}
                        </strong></p>
                      )}
                      <p>Date: <strong>{new Date(tx.date).toLocaleDateString("fr-FR")}</strong></p>
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    ⚠️ Cette action supprimera la transaction. Les positions et P&L seront recalculés automatiquement.
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setDeleteConfirm(null)}
                      className="flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)", backgroundColor: "var(--bg-base)" }}>
                      Annuler
                    </button>
                    <button onClick={() => { removeTransaction(deleteConfirm); setDeleteConfirm(null) }}
                      className="flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                      style={{ backgroundColor: "#ef4444" }}>
                      Supprimer
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

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
