"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { AssetClassBadge } from "@/components/ui/badge"
import { useTransactions, usePortfolios } from "@/hooks/use-supabase-data"
import type { Transaction, AssetClass, TransactionType } from "@/lib/types"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import {
  Plus, Search, X, Check, ArrowUpRight, ArrowDownLeft,
  Gift, ArrowLeftRight, Pencil, Loader2,
} from "lucide-react"

const TX_COLORS: Record<TransactionType, string> = {
  buy: "#22c55e", sell: "#ef4444", dividend: "#f59e0b", transfer: "#3b82f6",
}
const TX_LABELS: Record<TransactionType, string> = {
  buy: "Achat", sell: "Vente", dividend: "Dividende", transfer: "Transfert",
}
const TX_ICONS: Record<TransactionType, typeof ArrowUpRight> = {
  buy: ArrowDownLeft, sell: ArrowUpRight, dividend: Gift, transfer: ArrowLeftRight,
}

const EMPTY_FORM = {
  ticker: "", assetName: "", assetClass: "stock" as AssetClass,
  type: "buy" as TransactionType, quantity: "", price: "", fees: "1",
  date: new Date().toISOString().slice(0, 10), notes: "",
}

// ─── Inline autocomplete ticker field ────────────────────────────────────────
function TickerField({
  value,
  onChange,
  onSelectResult,
}: {
  value: string
  onChange: (v: string) => void
  onSelectResult: (r: SearchResult, price: string) => void
}) {
  const { query, setQuery, results, loading, clear } = useAssetSearch(200)
  const [open, setOpen]     = useState(false)
  const [fetching, setFetching] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value]) // eslint-disable-line

  useEffect(() => {
    setOpen(results.length > 0 && query.length > 0)
  }, [results, query])

  async function pick(r: SearchResult) {
    setFetching(true)
    clear()
    setOpen(false)
    try {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [r.ticker] }),
      })
      const data = await res.json()
      const price = data[r.ticker]?.price ?? ""
      onSelectResult(r, price ? String(price.toFixed(2)) : "")
    } catch {
      onSelectResult(r, "")
    } finally {
      setFetching(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        {fetching
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "var(--accent)" }} />
          : loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "var(--foreground-dim)" }} />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />
        }
        <input
          type="text"
          placeholder="AAPL, BTC, CW8…"
          value={value}
          onChange={e => { onChange(e.target.value); setQuery(e.target.value) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm outline-none"
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
          autoComplete="off"
        />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border shadow-2xl"
            style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,0.6)" }}
          >
            {results.map(r => {
              const color = ASSET_CLASS_COLORS[r.type as AssetClass] ?? "#6b7280"
              return (
                <button key={r.ticker} onMouseDown={() => pick(r)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-800/60 transition-colors"
                  style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: color + "22", color }}>
                    {r.ticker.slice(0, 3)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--foreground)" }}>{r.name}</p>
                    <p className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>
                      <span style={{ color }}>{r.ticker}</span>
                      {r.exchange ? ` · ${r.exchange}` : ""}
                    </p>
                  </div>
                  <span className="text-[11px] rounded px-1.5 py-0.5" style={{ backgroundColor: color + "18", color }}>
                    {ASSET_CLASS_LABELS[r.type as AssetClass] ?? r.type}
                  </span>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Transaction Modal ────────────────────────────────────────────────────────
function TxModal({
  mode,
  initial,
  onSave,
  onClose,
}: {
  mode: "add" | "edit"
  initial: typeof EMPTY_FORM & { id?: string }
  onSave: (form: typeof EMPTY_FORM & { id?: string }) => void
  onClose: () => void
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm(p => ({ ...p, [k]: v }))
  const valid = form.ticker && form.assetName && form.quantity && form.price && form.date

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-2xl border p-6"
        style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {mode === "add" ? "Nouvelle transaction" : "Modifier la transaction"}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Ticker — with autocomplete */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Ticker *</label>
            <TickerField
              value={form.ticker}
              onChange={v => set("ticker", v.toUpperCase())}
              onSelectResult={(r, price) => setForm(p => ({
                ...p,
                ticker:    r.ticker,
                assetName: r.name,
                assetClass: r.type as AssetClass,
                price:     price || p.price,
              }))}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Nom *</label>
            <input type="text" placeholder="Apple Inc." value={form.assetName}
              onChange={e => set("assetName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Quantité *</label>
            <input type="number" placeholder="10" value={form.quantity}
              onChange={e => set("quantity", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
              Prix unitaire (€) *
              {form.price && <span className="ml-1 text-[11px]" style={{ color: "#22c55e" }}>● Prix réel</span>}
            </label>
            <input type="number" placeholder="150.00" value={form.price}
              onChange={e => set("price", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Frais (€)</label>
            <input type="number" placeholder="1.00" value={form.fees}
              onChange={e => set("fees", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Date *</label>
            <input type="date" value={form.date}
              onChange={e => set("date", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Type *</label>
            <select value={form.type} onChange={e => set("type", e.target.value as TransactionType)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
              {(Object.entries(TX_LABELS) as [TransactionType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Classe</label>
            <select value={form.assetClass} onChange={e => set("assetClass", e.target.value as AssetClass)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
              {(Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Notes</label>
          <input type="text" placeholder="Optionnel…" value={form.notes}
            onChange={e => set("notes", e.target.value)}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={() => valid && onSave(form)} disabled={!valid}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
            <Check className="h-4 w-4" />
            {mode === "add" ? "Enregistrer" : "Sauvegarder"}
          </button>
          <button onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
            style={{ color: "var(--foreground-muted)", border: "1px solid var(--border)" }}>
            Annuler
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { transactions, addTransaction, editTransaction, removeTransaction } = useTransactions()
  const { portfolios } = usePortfolios()
  // Use the first real portfolio ID (Supabase UUID), not hardcoded "p1"
  const defaultPortfolioId = portfolios[0]?.id ?? "p1"

  const [search,     setSearch]     = useState("")
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all")
  const [modal,      setModal]      = useState<{ mode: "add" | "edit"; initial: typeof EMPTY_FORM & { id?: string } } | null>(null)

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

  function openAdd() {
    setModal({ mode: "add", initial: { ...EMPTY_FORM } })
  }

  function openEdit(tx: Transaction) {
    setModal({
      mode: "edit",
      initial: {
        id: tx.id, ticker: tx.ticker, assetName: tx.assetName,
        assetClass: tx.assetClass, type: tx.type,
        quantity: String(tx.quantity), price: String(tx.price),
        fees: String(tx.fees), date: tx.date, notes: tx.notes ?? "",
      },
    })
  }

  function handleSave(form: typeof EMPTY_FORM & { id?: string }) {
    if (modal?.mode === "edit" && form.id) {
      editTransaction(form.id, {
        ticker: form.ticker, assetName: form.assetName,
        assetClass: form.assetClass, type: form.type,
        quantity: parseFloat(form.quantity), price: parseFloat(form.price),
        fees: parseFloat(form.fees) || 0, date: form.date,
        notes: form.notes || undefined,
      })
    } else {
      const tx: Omit<Transaction, "id"> = {
        portfolioId: defaultPortfolioId,
        ticker: form.ticker.toUpperCase(), assetName: form.assetName,
        assetClass: form.assetClass, type: form.type,
        quantity: parseFloat(form.quantity), price: parseFloat(form.price),
        fees: parseFloat(form.fees) || 0, currency: "EUR",
        date: form.date, notes: form.notes || undefined,
      }
      addTransaction(tx)
    }
    setModal(null)
  }

  function handleDelete(id: string) {
    removeTransaction(id)
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Transactions" subtitle={`${transactions.length} transaction${transactions.length > 1 ? "s" : ""}`} />
      <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total achats",      value: formatCurrency(totalBuy),  color: "#ef4444" },
            { label: "Total ventes",      value: formatCurrency(totalSell), color: "#22c55e" },
            { label: "Dividendes reçus",  value: formatCurrency(totalDiv),  color: "#f59e0b" },
            { label: "Frais total",       value: formatCurrency(totalFees), color: "#6b7280" },
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
            <input type="text" placeholder="Rechercher…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-lg border pl-9 pr-3 py-2 text-sm outline-none"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {(["all","buy","sell","dividend","transfer"] as const).map(f => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: typeFilter === f ? "var(--accent)" : "var(--background-card)",
                  color: typeFilter === f ? "white" : "var(--foreground-muted)",
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
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
          <div className="hidden sm:grid px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--foreground-dim)", gridTemplateColumns: "1fr 80px 70px 90px 70px 80px 56px" }}>
            <span>Actif</span><span className="text-center">Type</span><span className="text-right">Qté</span>
            <span className="text-right">Prix unit.</span><span className="text-right">Frais</span>
            <span className="text-right">Date</span><span />
          </div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-2">
              <ArrowLeftRight className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
              <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Aucune transaction</p>
            </div>
          )}

          {filtered.map((tx, i) => {
            const color = TX_COLORS[tx.type]
            const Icon  = TX_ICONS[tx.type]
            const acCol = ASSET_CLASS_COLORS[tx.assetClass]
            return (
              <motion.div key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                style={{ borderTop: "1px solid var(--border-subtle)" }}>
                {/* Mobile */}
                <div className="sm:hidden flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                  <div className="h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
                    <Icon className="h-4 w-4" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{tx.assetName}</p>
                    <p className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>
                      <span className="rounded px-1.5 py-0.5 mr-1" style={{ backgroundColor: color + "18", color }}>{TX_LABELS[tx.type]}</span>
                      {new Date(tx.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                    </p>
                  </div>
                  <p className="text-xs font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
                    {formatCurrency(tx.price * tx.quantity)}
                  </p>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(tx)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-700 transition-colors" style={{ color: "var(--foreground-dim)" }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={() => handleDelete(tx.id)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-red-500/20 transition-colors" style={{ color: "var(--foreground-dim)" }}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {/* Desktop */}
                <div className="hidden sm:grid items-center px-5 py-3.5 hover:bg-zinc-800/20 transition-colors"
                  style={{ gridTemplateColumns: "1fr 80px 70px 90px 70px 80px 56px" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-7 w-7 flex-shrink-0 rounded-md flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
                      <Icon className="h-3.5 w-3.5" style={{ color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>{tx.assetName}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]" style={{ color: "var(--foreground-dim)" }}>{tx.ticker}</span>
                        <AssetClassBadge label={ASSET_CLASS_LABELS[tx.assetClass]} color={acCol} />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <span className="rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: color + "18", color }}>{TX_LABELS[tx.type]}</span>
                  </div>
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>{tx.quantity}</p>
                  <p className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>{formatCurrency(tx.price)}</p>
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-dim)" }}>{formatCurrency(tx.fees)}</p>
                  <p className="text-right text-xs tabular-nums" style={{ color: "var(--foreground-muted)" }}>
                    {new Date(tx.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
                  </p>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(tx)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-700 transition-colors" style={{ color: "var(--foreground-dim)" }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={() => handleDelete(tx.id)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-red-500/20 transition-colors" style={{ color: "var(--foreground-dim)" }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {modal && (
          <TxModal
            mode={modal.mode}
            initial={modal.initial}
            onSave={handleSave}
            onClose={() => setModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
