"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, Search, Loader2 } from "lucide-react"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import { useCurrency } from "@/hooks/use-currency"
import { formatCurrency } from "@/lib/utils"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS, REVENU_TYPE_META } from "@/lib/types"
import type { AssetClass, TransactionType, Portfolio, RevenuType, CryptoCustodyType } from "@/lib/types"
import type { AppCurrency } from "@/lib/utils"

const TX_LABELS: Record<TransactionType, string> = {
  buy: "Achat", sell: "Vente", dividend: "Dividende", transfer: "Transfert", revenu: "Revenu",
}
const TX_COLORS: Record<TransactionType, string> = {
  buy:      "#3b82f6",
  sell:     "#a78bfa",
  dividend: "#22c55e",
  transfer: "#64748b",
  revenu:   "#a855f7",   // violet — revenus annexes
}

const CURRENCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", CHF: "🇨🇭", GBP: "🇬🇧",
}

const CRYPTO_CUSTODY_LABELS: Record<CryptoCustodyType, string> = {
  cold_wallet: "Cold Wallet",
  hot_wallet: "Hot Wallet",
  exchange: "Exchange",
}

export interface TransactionFormData {
  id?:              string
  portfolioId:      string
  // Revenu annexe fields
  revenuType?:  RevenuType
  platform?:    string
  ticker:           string
  assetName:        string
  assetClass:       AssetClass
  type:             TransactionType
  quantity:         string
  price:            string        // NATIVE price (in asset's currency, e.g. USD for GOOG)
  nativeCurrency:   string        // e.g. "USD" for GOOG, "CHF" for Swiss stocks
  fees:             string
  date:             string
  notes:            string
  cryptoCustody?:   CryptoCustodyType | ""
  stakingEnabled?:  boolean
}

export const EMPTY_TX_FORM: TransactionFormData = {
  portfolioId:    "",
  ticker:         "", assetName: "", assetClass: "stock", type: "buy",
  quantity:       "", price:     "", nativeCurrency: "CHF", fees: "1",
  date: new Date().toISOString().slice(0, 10),
  notes: "",
}

// ─── Resolved price data from the API ────────────────────────────────────────
interface ResolvedPrice {
  nativePrice:    number   // e.g. 358.39 USD
  nativeCurrency: string   // "USD"
  chf:            number
  usd:            number
  eur:            number
}

// ─── Asset selector ───────────────────────────────────────────────────────────

interface AssetSelectorProps {
  ticker:        string
  assetName:     string
  nativeCurrency?: string
  onPick:        (r: SearchResult) => void
  onPrice:       (p: ResolvedPrice | null) => void
  onClear:       () => void
  priceFetching: boolean
}

function AssetSelector({ ticker, assetName, nativeCurrency, onPick, onPrice, onClear, priceFetching }: AssetSelectorProps) {
  const { query, setQuery, results, loading, clear } = useAssetSearch(220)
  const [open, setOpen] = useState(false)

  const isSelected = Boolean(ticker)

  useEffect(() => {
    if (!isSelected) setOpen(results.length > 0 && query.length > 0)
  }, [results, query, isSelected])

  async function pick(r: SearchResult) {
    clear(); setOpen(false)
    onPick(r)  // show chip immediately

    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 8000)
    try {
      const res  = await fetch("/api/prices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [r.ticker] }), signal: controller.signal,
      })
      const data = await res.json()
      const d    = data[r.ticker]
      if (d && (d.originalPrice ?? d.usd ?? d.chf) > 0) {
        onPrice({
          nativePrice:    d.originalPrice ?? d.usd ?? d.chf,
          nativeCurrency: d.originalCurrency ?? "USD",
          chf: d.chf ?? 0, usd: d.usd ?? 0, eur: d.eur ?? 0,
        })
      } else {
        onPrice(null)
      }
    } catch { onPrice(null) }
    finally { clearTimeout(timeout) }
  }

  // ── Selected chip ─────────────────────────────────────────────────────────
  if (isSelected) {
    const flag = nativeCurrency ? CURRENCY_FLAGS[nativeCurrency] ?? "" : ""
    return (
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-3 rounded-xl border px-4 py-3"
          style={{ backgroundColor: "var(--bg-base)", borderColor: "#22c55e40" }}>
          <div className="h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center text-[11px] font-bold"
            style={{ backgroundColor: "#22c55e22", color: "#22c55e" }}>
            {ticker.slice(0, 3)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{ticker}</p>
            <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
              {assetName}
              {nativeCurrency && <span className="ml-1.5" style={{ color: "var(--text-tertiary)" }}>{flag} {nativeCurrency}</span>}
            </p>
          </div>
          {priceFetching && <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" style={{ color: "#3b82f6" }} />}
        </div>
        <button onClick={onClear}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors hover:bg-zinc-800"
          style={{ borderColor: "var(--border)" }}>
          <X className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>
    )
  }

  // ── Search box ────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <div className="relative">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
        }
        <input type="text" placeholder="Chercher… AAPL, BTC, CW8, GOOG…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full rounded-xl border pl-9 pr-3 py-3 text-sm outline-none"
          style={{ backgroundColor: "var(--bg-base)", borderColor: open ? "var(--accent)" : "var(--border)", color: "var(--text-primary)" }}
          autoComplete="off" autoFocus
        />
      </div>
      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-xl border shadow-2xl"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
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
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{r.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
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

// ─── Main modal ───────────────────────────────────────────────────────────────

interface TransactionModalProps {
  mode:       "add" | "edit"
  initial:    TransactionFormData
  portfolios: Portfolio[]
  onSave:     (form: TransactionFormData) => Promise<void> | void
  onClose:    () => void
}

export function TransactionModal({ mode, initial, portfolios, onSave, onClose }: TransactionModalProps) {
  const [form, setForm]                   = useState<TransactionFormData>(initial)
  const [priceFetching, setPriceFetching] = useState(false)
  const [saving,  setSaving]              = useState(false)
  const [saveErr, setSaveErr]             = useState("")
  const { currency, format, convert }     = useCurrency()

  const set = (k: keyof TransactionFormData, v: TransactionFormData[keyof TransactionFormData]) =>
    setForm(p => ({ ...p, [k]: v }))

  function handlePick(r: SearchResult) {
    setPriceFetching(true)
    setForm(p => ({
      ...p,
      ticker:         r.ticker,
      assetName:      r.name,
      assetClass:     r.type as AssetClass,
      cryptoCustody:  r.type === "crypto" ? p.cryptoCustody : "",
      stakingEnabled: r.type === "crypto" ? p.stakingEnabled : false,
      price:          "",
      nativeCurrency: "USD",  // default until price resolves
    }))
  }

  function handlePrice(p: ResolvedPrice | null) {
    setPriceFetching(false)
    if (p) {
      setForm(prev => ({
        ...prev,
        price:          p.nativePrice.toFixed(2),
        nativeCurrency: p.nativeCurrency,
      }))
    }
  }

  function clearAsset() {
    setForm(p => ({ ...p, ticker: "", assetName: "", price: "", nativeCurrency: "CHF" }))
    setPriceFetching(false)
  }

  // ── Total preview ─────────────────────────────────────────────────────────
  const qty        = parseFloat(form.quantity || "0")
  const unitPrice  = parseFloat(form.price    || "0")
  const fees       = parseFloat(form.fees     || "0")
  const nativeCurr = form.nativeCurrency || "CHF"
  const flag       = CURRENCY_FLAGS[nativeCurr] ?? ""

  // Total in native currency (e.g. USD)
  const totalNative = qty * unitPrice

  // Total converted to user's preferred currency
  const totalConverted = convert(totalNative, nativeCurr as AppCurrency)

  // Fees in user's currency
  const feesConverted  = convert(fees, nativeCurr as AppCurrency)

  const showTotal    = qty > 0 && unitPrice > 0
  const sameAsCurr   = nativeCurr === currency
  const typeColor    = TX_COLORS[form.type]
  const sign         = form.type === "buy" ? "−" : "+"

  const isRevenu = form.type === "revenu"
  // For "revenu": needs portfolio, revenuType, ticker=label, price (amount), date
  // For others: needs portfolio, ticker, assetName, quantity, price, date
  const valid = isRevenu
    ? form.portfolioId && form.revenuType && form.ticker && form.price && form.date
    : form.portfolioId && form.ticker && form.assetName && form.quantity && form.price && form.date

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12"
      style={{ backgroundColor: "rgba(0,0,0,0.82)" }}
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-lg rounded-2xl border overflow-hidden mb-12"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header + type pills */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {mode === "add" ? "Nouvelle transaction" : "Modifier la transaction"}
          </h3>
          <div className="flex gap-1.5">
            {(Object.entries(TX_LABELS) as [TransactionType, string][]).map(([k, v]) => (
              <button key={k} onClick={() => set("type", k)}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: form.type === k ? TX_COLORS[k] + "25" : "transparent",
                  color:           form.type === k ? TX_COLORS[k] : "var(--text-tertiary)",
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
          {/* Portfolio */}
          <div>
            <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Portefeuille *</label>
            <div className="flex flex-wrap gap-2">
              {portfolios.map(p => (
                <button key={p.id} onClick={() => set("portfolioId", p.id)}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.portfolioId === p.id ? p.color + "15" : "var(--bg-base)",
                    borderColor:     form.portfolioId === p.id ? p.color : "var(--border)",
                    color:           form.portfolioId === p.id ? "white" : "var(--text-secondary)",
                  }}>
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  {p.name}
                  {form.portfolioId === p.id && <Check className="h-3 w-3 flex-shrink-0" style={{ color: p.color }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Asset selector — hidden for revenu */}
          {!isRevenu ? (
            <div>
              <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Actif *</label>
              <AssetSelector
                ticker={form.ticker}
                assetName={form.assetName}
                nativeCurrency={form.nativeCurrency}
                onPick={handlePick}
                onPrice={handlePrice}
                onClear={clearAsset}
                priceFetching={priceFetching}
              />
              {!form.ticker && (
                <button
                  type="button"
                  onClick={() => setForm(p => ({
                    ...p,
                    ticker: "CASH",
                    assetName: "Liquidités / Cash",
                    assetClass: "cash",
                    price: "1",
                    nativeCurrency: currency,
                    fees: "0",
                  }))}
                  className="mt-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-800"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  Ajouter des liquidités / cash
                </button>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Description / Label *
              </label>
              <input type="text" placeholder="Binance referral, Airdrop USDC…"
                value={form.ticker}
                onChange={e => { set("ticker", e.target.value); set("assetName", e.target.value) }}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </div>
          )}

          {/* Qty + Price + Fees */}
          <div className="grid grid-cols-3 gap-3">
            {!isRevenu && (
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Quantité *</label>
              <input type="number" placeholder="10" value={form.quantity}
                onChange={e => set("quantity", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                {isRevenu ? "Montant reçu *" : "Prix unit."}
                {/* Show native currency badge */}
                {form.ticker && (
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: "var(--bg-muted)", color: "var(--text-tertiary)" }}>
                    {flag} {nativeCurr}
                  </span>
                )}
                {priceFetching && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#3b82f6" }} />}
                {!priceFetching && form.price && form.ticker && (
                  <span className="text-[10px] font-normal" style={{ color: "#22c55e" }}>● live</span>
                )}
              </label>
              <input type="number" placeholder="0.00" value={form.price}
                onChange={e => set("price", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{
                  backgroundColor: "var(--bg-base)",
                  borderColor: form.price ? "#22c55e40" : "var(--border)",
                  color: "var(--text-primary)",
                }} />
              {/* Show price in user's currency if different */}
              {form.price && !priceFetching && !sameAsCurr && (
                <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  ≈ {format(convert(parseFloat(form.price), nativeCurr as AppCurrency))}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Frais ({currency})
              </label>
              <input type="number" placeholder="1.00" value={form.fees}
                onChange={e => set("fees", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            </div>
          </div>

          {/* ── Extra fields for REVENU type ── */}
          {form.type === "revenu" && (
            <div className="space-y-3">
              {/* Sub-type */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Type de revenu *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(REVENU_TYPE_META) as [RevenuType, typeof REVENU_TYPE_META[RevenuType]][]).map(([key, meta]) => (
                    <button key={key}
                      onClick={() => set("revenuType", key)}
                      className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-left transition-all"
                      style={{
                        backgroundColor: form.revenuType === key ? meta.color + "18" : "var(--bg-base)",
                        borderColor:     form.revenuType === key ? meta.color + "60" : "var(--border)",
                        color:           form.revenuType === key ? meta.color : "var(--text-secondary)",
                      }}>
                      <span>{meta.icon}</span>
                      <span className="text-xs font-medium">{meta.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Platform */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Plateforme
                </label>
                <input type="text" placeholder="Binance, IBKR, Swissquote…"
                  value={form.platform ?? ""}
                  onChange={e => set("platform", e.target.value)}
                  className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
              </div>
            </div>
          )}

          {/* Date + Class (hidden for revenu) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Date *</label>
              <input type="date" value={form.date}
                onChange={e => set("date", e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)", colorScheme: "dark" }} />
            </div>
            {form.type !== "revenu" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Classe</label>
                <select value={form.assetClass} onChange={e => set("assetClass", e.target.value as AssetClass)}
                  className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                  {(Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]).map(([k, v]) =>
                    <option key={k} value={k}>{v}</option>
                  )}
                </select>
              </div>
            )}
          </div>

          {form.type !== "revenu" && form.assetClass === "crypto" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Détention crypto
                </label>
                <select
                  value={form.cryptoCustody ?? ""}
                  onChange={e => set("cryptoCustody", e.target.value as CryptoCustodyType | "")}
                  className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  <option value="">Non renseigné</option>
                  {(Object.entries(CRYPTO_CUSTODY_LABELS) as [CryptoCustodyType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 rounded-xl border px-3 py-3"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
                <input
                  type="checkbox"
                  checked={Boolean(form.stakingEnabled)}
                  onChange={e => set("stakingEnabled", e.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Revenus Staking/Lending
                </span>
              </label>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Notes</label>
            <input type="text" placeholder="Optionnel…" value={form.notes}
              onChange={e => set("notes", e.target.value)}
              className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
              style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>

          {/* ── Total preview ─────────────────────────────────────────────────── */}
          {showTotal && (
            <div className="rounded-xl border px-4 py-3"
              style={{ backgroundColor: typeColor + "08", borderColor: typeColor + "30" }}>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {qty} × {flag} {formatCurrency(unitPrice, nativeCurr as AppCurrency)}
                  {fees > 0 && (
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {" "}+ {format(feesConverted)} frais
                    </span>
                  )}
                </span>
                <div className="text-right">
                  {/* NATIVE total — primary */}
                  <p className="text-sm font-bold tabular-nums" style={{ color: typeColor }}>
                    {sign} {flag} {formatCurrency(totalNative, nativeCurr as AppCurrency)}
                  </p>
                  {/* Converted total — secondary, only if different */}
                  {!sameAsCurr && (
                    <p className="text-[11px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      ≈ {sign} {format(totalConverted)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {saveErr && (
          <div className="mx-6 mb-2 rounded-lg border px-4 py-3 text-xs"
            style={{ backgroundColor: "#ef444415", borderColor: "#ef444440", color: "#ef4444" }}>
            ❌ {saveErr}
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={async () => {
              if (!valid || saving) return
              setSaving(true); setSaveErr("")
              try { await onSave(form) }
              catch (e) { setSaveErr(String(e)) }
              finally { setSaving(false) }
            }}
            disabled={!valid || saving}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: valid ? `linear-gradient(135deg, ${typeColor}, ${typeColor}bb)` : "var(--border)" }}
          >
            {saving
              ? <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enregistrement…</>
              : <><Check className="h-4 w-4" />{mode === "add" ? "Enregistrer" : "Sauvegarder"}</>
            }
          </button>
          <button onClick={onClose}
            className="rounded-xl border px-5 py-3 text-sm font-medium hover:bg-zinc-800 transition-colors"
            style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
            Annuler
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
