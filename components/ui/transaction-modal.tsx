"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X, Check, Search, Loader2, RefreshCw,
} from "lucide-react"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import {
  ASSET_CLASS_COLORS, ASSET_CLASS_LABELS,
} from "@/lib/types"
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

export const EMPTY_TX_FORM: TransactionFormData = {
  portfolioId: "",
  ticker: "", assetName: "", assetClass: "stock", type: "buy",
  quantity: "", price: "", fees: "1",
  date: new Date().toISOString().slice(0, 10),
  notes: "",
}

// ─── Asset selector field ─────────────────────────────────────────────────────
// Shows a search box UNTIL user selects an asset.
// After selection: shows a chip with the asset + × to reset.
// This prevents the "double-ask" bug.

interface AssetSelectorProps {
  ticker:    string
  assetName: string
  /** Called immediately when user picks an asset */
  onPick:   (r: SearchResult) => void
  /** Called when live price fetch resolves (price="" if failed/timeout) */
  onPrice:  (price: string) => void
  onClear:  () => void
  priceFetching: boolean
}

function AssetSelector({ ticker, assetName, onPick, onPrice, onClear, priceFetching }: AssetSelectorProps) {
  const { query, setQuery, results, loading, clear } = useAssetSearch(220)
  const [open, setOpen] = useState(false)

  const isSelected = Boolean(ticker)

  useEffect(() => {
    if (!isSelected) setOpen(results.length > 0 && query.length > 0)
  }, [results, query, isSelected])

  async function pick(r: SearchResult) {
    clear(); setOpen(false)

    // 1. Show the chip immediately — no stale-state issue
    onPick(r)

    // 2. Fetch price in background (max 8s)
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 8000)
    try {
      const res  = await fetch("/api/prices", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickers: [r.ticker] }),
        signal:  controller.signal,
      })
      const data = await res.json()
      const p    = data[r.ticker]?.price
      onPrice(p && p > 0 ? String(p.toFixed(2)) : "")
    } catch {
      onPrice("") // timeout / network error → stop spinner
    } finally {
      clearTimeout(timeout)
    }
  }

  // ── Selected state — show chip ───────────────────────────────────────────────
  if (isSelected) {
    const color = ASSET_CLASS_COLORS[EMPTY_TX_FORM.assetClass as AssetClass] ?? "#3b82f6"
    return (
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-3 rounded-xl border px-4 py-3"
          style={{ backgroundColor: "var(--background)", borderColor: "#22c55e40" }}>
          <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[11px] font-bold"
            style={{ backgroundColor: "#22c55e22", color: "#22c55e" }}>
            {ticker.slice(0, 3)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{ticker}</p>
            <p className="text-xs truncate" style={{ color: "var(--foreground-muted)" }}>{assetName}</p>
          </div>
          {priceFetching && <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" style={{ color: "#3b82f6" }} />}
        </div>
        <button onClick={onClear}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors hover:bg-zinc-800"
          style={{ borderColor: "var(--border)" }}
          title="Changer d'actif">
          <X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
        </button>
      </div>
    )
  }

  // ── Search state ─────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <div className="relative">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "var(--foreground-dim)" }} />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--foreground-dim)" }} />
        }
        <input
          type="text"
          placeholder="Chercher un actif… AAPL, BTC, CW8, O…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full rounded-xl border pl-9 pr-3 py-3 text-sm outline-none"
          style={{ backgroundColor: "var(--background)", borderColor: open ? "var(--accent)" : "var(--border)", color: "var(--foreground)" }}
          autoComplete="off"
          autoFocus
        />
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-xl border shadow-2xl"
            style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
          >
            {results.map((r, i) => {
              const color = ASSET_CLASS_COLORS[r.type as AssetClass] ?? "#6b7280"
              return (
                <button key={r.ticker} onMouseDown={() => pick(r)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/60 transition-colors"
                  style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: color + "22", color }}>
                    {r.ticker.slice(0, 3)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{r.name}</p>
                    <p className="text-xs" style={{ color: "var(--foreground-dim)" }}>
                      <span className="font-semibold" style={{ color }}>{r.ticker}</span>
                      {r.exchange ? ` · ${r.exchange}` : ""}
                    </p>
                  </div>
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: color + "18", color }}>
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

// ─── Price field with currency context ───────────────────────────────────────
function PriceField({
  value,
  onChange,
  loading,
}: {
  value: string
  onChange: (v: string) => void
  loading: boolean
}) {
  return (
    <div className="relative">
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "#3b82f6" }} />
      )}
      <input
        type="number"
        placeholder={loading ? "Récupération…" : "0.00"}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
        style={{
          backgroundColor: "var(--background)",
          borderColor: value ? "#22c55e40" : "var(--border)",
          color: "var(--foreground)",
        }}
      />
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface TransactionModalProps {
  mode:       "add" | "edit"
  initial:    TransactionFormData
  portfolios: Portfolio[]
  onSave:     (form: TransactionFormData) => void
  onClose:    () => void
}

export function TransactionModal({ mode, initial, portfolios, onSave, onClose }: TransactionModalProps) {
  const [form, setForm]             = useState<TransactionFormData>(initial)
  const [priceFetching, setPriceFetching] = useState(false)

  const set = (k: keyof TransactionFormData, v: string) =>
    setForm(p => ({ ...p, [k]: v }))

  // Called IMMEDIATELY when user clicks an asset in the dropdown
  function handlePick(r: SearchResult) {
    setPriceFetching(true)  // start spinner — completely independent of form state
    setForm(p => ({
      ...p,
      ticker:    r.ticker,
      assetName: r.name,
      assetClass: r.type as AssetClass,
      price:     "",        // clear price until fetch resolves
    }))
  }

  // Called AFTER price fetch resolves (price="" on failure/timeout)
  function handlePrice(price: string) {
    setPriceFetching(false) // always stop spinner
    if (price) {
      setForm(p => ({ ...p, price }))
    }
  }

  function clearAsset() {
    setForm(p => ({ ...p, ticker: "", assetName: "", price: "" }))
    setPriceFetching(false)
  }

  const valid     = form.portfolioId && form.ticker && form.assetName && form.quantity && form.price && form.date
  const typeColor = TX_COLORS[form.type]
  const totalAmt  = form.quantity && form.price
    ? (parseFloat(form.quantity) * parseFloat(form.price)).toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12"
      style={{ backgroundColor: "rgba(0,0,0,0.82)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-lg rounded-2xl border overflow-hidden mb-12"
        style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {mode === "add" ? "Nouvelle transaction" : "Modifier la transaction"}
          </h3>
          {/* Type pills */}
          <div className="flex gap-1.5">
            {(Object.entries(TX_LABELS) as [TransactionType, string][]).map(([k, v]) => (
              <button key={k} onClick={() => set("type", k)}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: form.type === k ? TX_COLORS[k] + "25" : "transparent",
                  color:           form.type === k ? TX_COLORS[k] : "var(--foreground-dim)",
                  border:          form.type === k ? `1px solid ${TX_COLORS[k]}60` : "1px solid transparent",
                }}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Portfolio selector */}
          <div>
            <label className="mb-2 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
              Portefeuille *
            </label>
            <div className="flex flex-wrap gap-2">
              {portfolios.map(p => (
                <button key={p.id} onClick={() => set("portfolioId", p.id)}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.portfolioId === p.id ? p.color + "15" : "var(--background)",
                    borderColor:     form.portfolioId === p.id ? p.color : "var(--border)",
                    color:           form.portfolioId === p.id ? "white" : "var(--foreground-muted)",
                  }}>
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  {p.name}
                  {form.portfolioId === p.id && <Check className="h-3 w-3 flex-shrink-0" style={{ color: p.color }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Asset selector — no double-ask */}
          <div>
            <label className="mb-2 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
              Actif *
            </label>
            <AssetSelector
              ticker={form.ticker}
              assetName={form.assetName}
              onPick={handlePick}
              onPrice={handlePrice}
              onClear={clearAsset}
              priceFetching={priceFetching}
            />
          </div>

          {/* Qty + Price + Fees */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Quantité *</label>
              <input type="number" placeholder="10" value={form.quantity}
                onChange={e => set("quantity", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--foreground-muted)" }}>
                Prix unit. *
                {priceFetching && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#3b82f6" }} />}
                {!priceFetching && form.price && form.ticker && (
                  <span className="text-[10px] font-normal" style={{ color: "#22c55e" }}>● live</span>
                )}
              </label>
              <PriceField value={form.price} onChange={v => set("price", v)} loading={priceFetching} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Frais</label>
              <input type="number" placeholder="1.00" value={form.fees}
                onChange={e => set("fees", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
            </div>
          </div>

          {/* Date + Class */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Date *</label>
              <input type="date" value={form.date}
                onChange={e => set("date", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Classe</label>
              <select value={form.assetClass} onChange={e => set("assetClass", e.target.value as AssetClass)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
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
              className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>

          {/* Total preview */}
          {totalAmt && (
            <div className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{ backgroundColor: typeColor + "08", borderColor: typeColor + "30" }}>
              <div className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                {form.quantity} × {form.price}
                {parseFloat(form.fees || "0") > 0 && <span style={{ color: "var(--foreground-dim)" }}> + {form.fees} frais</span>}
              </div>
              <span className="text-sm font-bold tabular-nums" style={{ color: typeColor }}>
                {form.type === "buy" ? "−" : "+"} {totalAmt} CHF
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={() => valid && onSave(form)}
            disabled={!valid}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: valid ? `linear-gradient(135deg, ${typeColor}, ${typeColor}bb)` : "var(--border)" }}
          >
            <Check className="h-4 w-4" />
            {mode === "add" ? "Enregistrer" : "Sauvegarder"}
          </button>
          <button onClick={onClose}
            className="rounded-xl border px-5 py-3 text-sm font-medium hover:bg-zinc-800 transition-colors"
            style={{ color: "var(--foreground-muted)", borderColor: "var(--border)" }}>
            Annuler
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
