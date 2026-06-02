"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, Search, Loader2 } from "lucide-react"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "@/lib/types"
import type { AssetClass, TransactionType, Portfolio } from "@/lib/types"

const TX_LABELS: Record<TransactionType, string> = {
  buy: "Achat", sell: "Vente", dividend: "Dividende", transfer: "Transfert",
}
const TX_COLORS: Record<TransactionType, string> = {
  buy: "#22c55e", sell: "#ef4444", dividend: "#f59e0b", transfer: "#3b82f6",
}

export interface TransactionFormData {
  id?:         string
  portfolioId: string
  ticker:      string
  assetName:   string
  assetClass:  AssetClass
  type:        TransactionType
  quantity:    string
  price:       string
  fees:        string
  date:        string
  notes:       string
}

const EMPTY: TransactionFormData = {
  portfolioId: "",
  ticker: "", assetName: "", assetClass: "stock", type: "buy",
  quantity: "", price: "", fees: "1",
  date: new Date().toISOString().slice(0, 10),
  notes: "",
}

// ─── Inline ticker autocomplete ───────────────────────────────────────────────
function TickerField({
  value,
  onChange,
  onSelect,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (r: SearchResult, price: string) => void
}) {
  const { query, setQuery, results, loading, clear } = useAssetSearch(220)
  const [open, setOpen]       = useState(false)
  const [fetching, setFetching] = useState(false)

  useEffect(() => { setQuery(value) }, [value]) // eslint-disable-line
  useEffect(() => { setOpen(results.length > 0 && query.length > 0) }, [results, query])

  async function pick(r: SearchResult) {
    setFetching(true); clear(); setOpen(false)
    try {
      const res  = await fetch("/api/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: [r.ticker] }) })
      const data = await res.json()
      onSelect(r, data[r.ticker]?.price ? String(data[r.ticker].price.toFixed(2)) : "")
    } catch { onSelect(r, "") }
    finally { setFetching(false) }
  }

  return (
    <div className="relative">
      <div className="relative">
        {fetching || loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "var(--accent)" }} />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />
        }
        <input
          type="text" placeholder="AAPL, BTC, CW8…" value={value}
          onChange={e => { onChange(e.target.value.toUpperCase()); setQuery(e.target.value) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm outline-none"
          style={{ backgroundColor: "var(--background)", borderColor: open ? "var(--accent)" : "var(--border)", color: "var(--foreground)" }}
          autoComplete="off"
        />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-xl border shadow-2xl"
            style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}>
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
                      <span style={{ color }}>{r.ticker}</span>{r.exchange ? ` · ${r.exchange}` : ""}
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

// ─── Main modal ───────────────────────────────────────────────────────────────
interface TransactionModalProps {
  mode:        "add" | "edit"
  initial:     TransactionFormData
  portfolios:  Portfolio[]
  onSave:      (form: TransactionFormData) => void
  onClose:     () => void
}

export function TransactionModal({ mode, initial, portfolios, onSave, onClose }: TransactionModalProps) {
  const [form, setForm] = useState<TransactionFormData>(initial)
  const set = (k: keyof TransactionFormData, v: string) =>
    setForm(p => ({ ...p, [k]: v }))

  const valid = form.portfolioId && form.ticker && form.assetName && form.quantity && form.price && form.date
  const typeColor = TX_COLORS[form.type]

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.8)" }}
      onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-2xl border overflow-hidden"
        style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header with type pill */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {mode === "add" ? "Nouvelle transaction" : "Modifier la transaction"}
            </h3>
            {/* Type selector as pills */}
            <div className="flex gap-1">
              {(Object.entries(TX_LABELS) as [TransactionType, string][]).map(([k, v]) => (
                <button key={k} onClick={() => set("type", k)}
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all"
                  style={{
                    backgroundColor: form.type === k ? TX_COLORS[k] + "25" : "var(--background-hover)",
                    color:           form.type === k ? TX_COLORS[k] : "var(--foreground-dim)",
                    border:          form.type === k ? `1px solid ${TX_COLORS[k]}60` : "1px solid transparent",
                  }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Portfolio selector — only for "buy" type */}
          {form.type === "buy" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                Portefeuille *
              </label>
              <div className="flex flex-wrap gap-2">
                {portfolios.map(p => (
                  <button key={p.id} onClick={() => set("portfolioId", p.id)}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all"
                    style={{
                      backgroundColor: form.portfolioId === p.id ? p.color + "18" : "var(--background)",
                      borderColor:     form.portfolioId === p.id ? p.color : "var(--border)",
                      color:           form.portfolioId === p.id ? "white" : "var(--foreground-muted)",
                    }}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                    {form.portfolioId === p.id && <Check className="h-3 w-3 ml-0.5" style={{ color: p.color }} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ticker search */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
              Actif *
              {form.price && <span className="ml-2 text-[11px]" style={{ color: "#22c55e" }}>● Prix récupéré</span>}
            </label>
            <TickerField
              value={form.ticker}
              onChange={v => set("ticker", v)}
              onSelect={(r, price) => setForm(p => ({
                ...p,
                ticker:    r.ticker,
                assetName: r.name,
                assetClass: r.type as AssetClass,
                price:     price || p.price,
              }))}
            />
          </div>

          {/* Name auto-filled but editable */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Nom *</label>
            <input type="text" placeholder="Apple Inc." value={form.assetName}
              onChange={e => set("assetName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          {/* Qty + Price + Fees */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Quantité *</label>
              <input type="number" placeholder="10" value={form.quantity}
                onChange={e => set("quantity", e.target.value)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Prix unit. *</label>
              <input type="number" placeholder="150.00" value={form.price}
                onChange={e => set("price", e.target.value)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Frais (CHF)</label>
              <input type="number" placeholder="1.00" value={form.fees}
                onChange={e => set("fees", e.target.value)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
            </div>
          </div>

          {/* Date + Class */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Date *</label>
              <input type="date" value={form.date}
                onChange={e => set("date", e.target.value)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Classe</label>
              <select value={form.assetClass} onChange={e => set("assetClass", e.target.value as AssetClass)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                {(Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]).map(([k, v]) =>
                  <option key={k} value={k}>{v}</option>
                )}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Notes</label>
            <input type="text" placeholder="Optionnel…" value={form.notes}
              onChange={e => set("notes", e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          {/* Total preview */}
          {form.quantity && form.price && (
            <div className="rounded-xl border px-4 py-3 flex items-center justify-between"
              style={{ backgroundColor: typeColor + "08", borderColor: typeColor + "30" }}>
              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>Total</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: typeColor }}>
                {form.type === "buy" ? "−" : "+"} {(parseFloat(form.quantity || "0") * parseFloat(form.price || "0")).toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={() => valid && onSave(form)} disabled={!valid}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: valid ? `linear-gradient(135deg, ${typeColor}, ${typeColor}cc)` : "var(--border)" }}>
            <Check className="h-4 w-4" />
            {mode === "add" ? "Enregistrer" : "Sauvegarder"}
          </button>
          <button onClick={onClose}
            className="rounded-xl border px-5 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
            style={{ color: "var(--foreground-muted)", borderColor: "var(--border)" }}>
            Annuler
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
