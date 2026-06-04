"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, Search, Loader2, AlertCircle, Wallet } from "lucide-react"
import { useAssetSearch, type SearchResult } from "@/hooks/use-asset-search"
import { useCurrency } from "@/hooks/use-currency"
import { formatCurrency } from "@/lib/utils"
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS, REVENU_TYPE_META } from "@/lib/types"
import type {
  AssetClass, TransactionType, Portfolio,
  RevenuType, ModalAssetClass, CashBalance,
} from "@/lib/types"
import type { AppCurrency } from "@/lib/utils"

// ─── Constants ────────────────────────────────────────────────────────────────

const TX_LABELS: Record<TransactionType, string> = {
  buy:        "Achat",
  sell:       "Vente",
  dividend:   "Dividende",
  transfer:   "Transfert",
  revenu:     "Revenu",
  deposit:    "Dépôt",
  withdrawal: "Retrait",
  conversion: "Conversion",
}

const TX_COLORS: Record<TransactionType, string> = {
  buy:        "#3b82f6",
  sell:       "#a78bfa",
  dividend:   "#22c55e",
  transfer:   "#64748b",
  revenu:     "#a855f7",
  deposit:    "#0ea5e9",
  withdrawal: "#ef4444",
  conversion: "#f59e0b",
}

const CLASS_LABELS: Record<ModalAssetClass, string> = {
  stock:  "Action",
  etf:    "ETF",
  crypto: "Crypto",
  cash:   "Liquidité",
}

const CLASS_ICONS: Record<ModalAssetClass, string> = {
  stock:  "📈",
  etf:    "🗂",
  crypto: "₿",
  cash:   "💵",
}

const CURRENCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", CHF: "🇨🇭", GBP: "🇬🇧",
}

// ─── Form data ────────────────────────────────────────────────────────────────

export interface TransactionFormData {
  id?:              string
  portfolioId:      string
  // Step 1 — class
  selectedClass:    ModalAssetClass
  // Step 2 — asset (non-cash)
  ticker:           string
  assetName:        string
  assetClass:       AssetClass
  type:             TransactionType
  quantity:         string
  price:            string
  nativeCurrency:   string
  fees:             string
  // Step 2 — cash deposit
  depositAmount?:   string
  depositCurrency?: keyof CashBalance
  // Common
  date:   string
  notes:  string
  // Revenu
  revenuType?: RevenuType
  platform?:   string
}

export const EMPTY_TX_FORM: TransactionFormData = {
  portfolioId:      "",
  selectedClass:    "stock",
  ticker:           "",
  assetName:        "",
  assetClass:       "stock",
  type:             "buy",
  quantity:         "",
  price:            "",
  nativeCurrency:   "CHF",
  fees:             "1",
  depositAmount:    "",
  depositCurrency:  "CHF",
  date:             new Date().toISOString().slice(0, 10),
  notes:            "",
}

// ─── Resolved price from API ──────────────────────────────────────────────────

interface ResolvedPrice {
  nativePrice:    number
  nativeCurrency: string
  chf: number; usd: number; eur: number
}

// ─── Asset selector (with class filter) ──────────────────────────────────────

interface AssetSelectorProps {
  ticker:          string
  assetName:       string
  nativeCurrency?: string
  filterClass:     ModalAssetClass
  onPick:          (r: SearchResult) => void
  onPrice:         (p: ResolvedPrice | null) => void
  onClear:         () => void
  priceFetching:   boolean
}

function AssetSelector({
  ticker, assetName, nativeCurrency, filterClass,
  onPick, onPrice, onClear, priceFetching,
}: AssetSelectorProps) {
  const { query, setQuery, results, loading, clear } = useAssetSearch(220)
  const [open, setOpen] = useState(false)

  // Filter results by selected class
  const filtered = results.filter(r =>
    filterClass === "stock" ? r.type === "stock" :
    filterClass === "etf"   ? r.type === "etf" :
    filterClass === "crypto"? r.type === "crypto" :
    true
  )

  useEffect(() => {
    if (!ticker) setOpen(filtered.length > 0 && query.length > 0)
  }, [filtered.length, query, ticker])

  async function pick(r: SearchResult) {
    clear(); setOpen(false)
    onPick(r)
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
      } else { onPrice(null) }
    } catch { onPrice(null) }
    finally { clearTimeout(timeout) }
  }

  // Selected chip
  if (ticker) {
    const flag = nativeCurrency ? (CURRENCY_FLAGS[nativeCurrency] ?? "") : ""
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
              {nativeCurrency && (
                <span className="ml-1.5" style={{ color: "var(--text-tertiary)" }}>{flag} {nativeCurrency}</span>
              )}
            </p>
          </div>
          {priceFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "#3b82f6" }} />}
        </div>
        <button onClick={onClear}
          className="flex h-10 w-10 items-center justify-center rounded-xl border hover:bg-zinc-800 transition-colors"
          style={{ borderColor: "var(--border)" }}>
          <X className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>
    )
  }

  // Search box
  return (
    <div className="relative">
      <div className="relative">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
        }
        <input type="text"
          placeholder={
            filterClass === "stock" ? "Chercher une action… AAPL, MSFT, NVDA…" :
            filterClass === "etf"   ? "Chercher un ETF… CW8, VWCE, SPY…" :
            filterClass === "crypto"? "Chercher une crypto… BTC, ETH, SOL…" :
            "Chercher un actif…"
          }
          value={query}
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => filtered.length > 0 && setOpen(true)}
          className="w-full rounded-xl border pl-9 pr-3 py-3 text-sm outline-none"
          style={{ backgroundColor: "var(--bg-base)", borderColor: open ? "var(--accent)" : "var(--border)", color: "var(--text-primary)" }}
          autoComplete="off" autoFocus
        />
      </div>
      <AnimatePresence>
        {open && filtered.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-y-auto rounded-xl border shadow-2xl"
            style={{ maxHeight: "280px" }}
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
            {filtered.slice(0, 20).map((r, i) => {
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
                  <span className="text-[11px] rounded-md px-2 py-0.5 font-medium"
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
  /** cashAvailable[portfolioId][currency] = solde disponible */
  cashAvailable?: Record<string, Record<string, number>>
  onSave:     (form: TransactionFormData) => Promise<void> | void
  onClose:    () => void
}

export function TransactionModal({
  mode, initial, portfolios, cashAvailable, onSave, onClose,
}: TransactionModalProps) {
  const [form, setForm]                   = useState<TransactionFormData>(initial)
  const [priceFetching, setPriceFetching] = useState(false)
  const [saving,  setSaving]              = useState(false)
  const [saveErr, setSaveErr]             = useState("")
  const { currency, format, convert }     = useCurrency()

  const set = (k: keyof TransactionFormData, v: string) =>
    setForm(p => ({ ...p, [k]: v }))

  // ── Class change: reset fields ──────────────────────────────────────────────
  function handleClassChange(cls: ModalAssetClass) {
    setForm(p => ({
      ...p,
      selectedClass:  cls,
      ticker:         "",
      assetName:      "",
      assetClass:     cls === "cash" ? "cash" : cls,
      type:           cls === "cash" ? "deposit" : "buy",
      price:          "",
      quantity:       cls === "cash" ? "1" : "",
      nativeCurrency: "CHF",
    }))
    setPriceFetching(false)
    setSaveErr("")
  }

  function handlePick(r: SearchResult) {
    setPriceFetching(true)
    setForm(p => ({
      ...p,
      ticker:     r.ticker,
      assetName:  r.name,
      assetClass: r.type as AssetClass,
      price:      "",
      nativeCurrency: "USD",
    }))
  }

  function handlePrice(p: ResolvedPrice | null) {
    setPriceFetching(false)
    if (p) setForm(prev => ({
      ...prev,
      price:          p.nativePrice.toFixed(2),
      nativeCurrency: p.nativeCurrency,
    }))
  }

  function clearAsset() {
    setForm(p => ({ ...p, ticker: "", assetName: "", price: "", nativeCurrency: "CHF" }))
    setPriceFetching(false)
  }

  // ── Cash validation ─────────────────────────────────────────────────────────
  const nativeCurr      = form.nativeCurrency || "CHF"
  const flag            = CURRENCY_FLAGS[nativeCurr] ?? ""
  const typeColor       = TX_COLORS[form.type] ?? "#6366f1"
  const isCashMode      = form.selectedClass === "cash"
  const isRevenu        = form.type === "revenu"
  const qty             = parseFloat(form.quantity || "0")
  const price           = parseFloat(form.price || "0")
  const fees            = parseFloat(form.fees || "0")
  const totalCost       = qty * price + fees
  const netProceeds     = qty * price - fees

  // Available cash for the selected portfolio
  const portfolioCash   = cashAvailable?.[form.portfolioId]?.[nativeCurr] ?? 0
  const hasCashSystem   = portfolioCash > 0
  // En mode édition, ne jamais bloquer sur le cash — la transaction existe déjà
  const insufficientCash =
    mode !== "edit" &&
    form.type === "buy" &&
    !isCashMode &&
    hasCashSystem &&
    totalCost > portfolioCash

  // ── Validation ──────────────────────────────────────────────────────────────
  const valid = (() => {
    if (isCashMode) return !!(parseFloat(form.depositAmount || "0") > 0 && form.date)
    if (!form.portfolioId) return false
    if (isRevenu) return !!(form.revenuType && form.ticker && price > 0 && form.date)
    return !!(form.ticker && form.assetName && qty > 0 && price > 0 && form.date && !insufficientCash)
  })()

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-8"
      style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
      onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-xl rounded-2xl border overflow-hidden mb-8"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b"
          style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {mode === "add" ? "Nouvelle transaction" : "Modifier la transaction"}
          </h3>
          {/* Transaction type pills — shown when not cash mode */}
          {!isCashMode && (
            <div className="flex gap-1.5">
              {(["buy","sell","dividend"] as TransactionType[]).map(t => (
                <button key={t} onClick={() => set("type", t)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
                  style={{
                    backgroundColor: form.type === t ? TX_COLORS[t] + "25" : "transparent",
                    color:           form.type === t ? TX_COLORS[t] : "var(--text-tertiary)",
                    border:          form.type === t ? `1px solid ${TX_COLORS[t]}60` : "1px solid transparent",
                  }}>
                  {TX_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* ── STEP 1: Class of asset ──────────────────────────────────── */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-tertiary)" }}>
              Classe d&apos;actif
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(Object.entries(CLASS_LABELS) as [ModalAssetClass, string][]).map(([cls, label]) => (
                <button key={cls}
                  onClick={() => handleClassChange(cls)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.selectedClass === cls ? "#6366f118" : "var(--bg-base)",
                    borderColor:     form.selectedClass === cls ? "var(--accent)" : "var(--border)",
                    color:           form.selectedClass === cls ? "var(--text-primary)" : "var(--text-secondary)",
                    boxShadow:       form.selectedClass === cls ? "0 0 0 1px #6366f130" : "none",
                  }}>
                  <span className="text-lg">{CLASS_ICONS[cls]}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Portfolio selector — caché en mode Liquidité ────────────── */}
          {!isCashMode && (
            <div>
              <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Portefeuille *
              </label>
              <div className="flex flex-wrap gap-2">
                {portfolios.map(p => {
                  const cash = cashAvailable?.[p.id]?.[nativeCurr]
                  return (
                    <button key={p.id} onClick={() => set("portfolioId", p.id)}
                      className="flex flex-col items-start rounded-xl border px-3 py-2 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: form.portfolioId === p.id ? p.color + "15" : "var(--bg-base)",
                        borderColor:     form.portfolioId === p.id ? p.color : "var(--border)",
                        color:           form.portfolioId === p.id ? "white" : "var(--text-secondary)",
                      }}>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                        {form.portfolioId === p.id && <Check className="h-3 w-3" style={{ color: p.color }} />}
                      </div>
                      {cash !== undefined && cash > 0 && (
                        <span className="mt-0.5 text-[10px]" style={{ color: "#0ea5e9" }}>
                          💵 {cash.toFixed(2)} {nativeCurr}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── En mode Liquidité: label "Liquidités globales" ─────────── */}
          {isCashMode && (
            <div className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{ backgroundColor: "#0ea5e908", borderColor: "#0ea5e930" }}>
              <Wallet className="h-5 w-5 flex-shrink-0" style={{ color: "#0ea5e9" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "#0ea5e9" }}>Liquidités globales</p>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  Le cash déposé est partagé entre tous vos portefeuilles
                </p>
              </div>
            </div>
          )}

          {/* ══ CASH MODE ═══════════════════════════════════════════════ */}
          {isCashMode ? (
            <>
              <div>
                <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Devise *
                </label>
                <div className="flex gap-2">
                  {(["CHF","USD","EUR"] as (keyof CashBalance)[]).map(c => (
                    <button key={c} onClick={() => set("depositCurrency", c)}
                      className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all"
                      style={{
                        backgroundColor: form.depositCurrency === c ? "#0ea5e918" : "var(--bg-base)",
                        borderColor:     form.depositCurrency === c ? "#0ea5e9" : "var(--border)",
                        color:           form.depositCurrency === c ? "#0ea5e9" : "var(--text-secondary)",
                      }}>
                      <span>{CURRENCY_FLAGS[c]}</span> {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Montant à déposer *
                </label>
                <input type="number" placeholder="1000.00"
                  value={form.depositAmount ?? ""}
                  onChange={e => set("depositAmount", e.target.value)}
                  className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Date *</label>
                <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
                  className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)", colorScheme: "dark" }} />
              </div>

              {/* Preview */}
              {parseFloat(form.depositAmount || "0") > 0 && (
                <div className="flex items-center justify-between rounded-xl border px-4 py-3"
                  style={{ backgroundColor: "#0ea5e908", borderColor: "#0ea5e930" }}>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Dépôt de liquidité</span>
                  <span className="text-sm font-bold" style={{ color: "#0ea5e9" }}>
                    + {parseFloat(form.depositAmount || "0").toFixed(2)} {form.depositCurrency}
                  </span>
                </div>
              )}
            </>
          ) : (
            /* ══ ASSET MODE ════════════════════════════════════════════ */
            <>
              {/* Asset selector */}
              <div>
                <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  {isRevenu ? "Description / Label *" : "Actif *"}
                </label>
                {!isRevenu ? (
                  <AssetSelector
                    ticker={form.ticker}
                    assetName={form.assetName}
                    nativeCurrency={form.nativeCurrency}
                    filterClass={form.selectedClass}
                    onPick={handlePick}
                    onPrice={handlePrice}
                    onClear={clearAsset}
                    priceFetching={priceFetching}
                  />
                ) : (
                  <input type="text" placeholder="Binance referral, Airdrop USDC…"
                    value={form.ticker}
                    onChange={e => { set("ticker", e.target.value); set("assetName", e.target.value) }}
                    className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                    style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                )}
              </div>

              {/* Revenu sub-type */}
              {isRevenu && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Type de revenu *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.entries(REVENU_TYPE_META) as [RevenuType, typeof REVENU_TYPE_META[RevenuType]][]).map(([key, meta]) => (
                        <button key={key} onClick={() => set("revenuType", key)}
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
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Plateforme</label>
                    <input type="text" placeholder="Binance, IBKR, Swissquote…"
                      value={form.platform ?? ""} onChange={e => set("platform", e.target.value)}
                      className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                  </div>
                </div>
              )}

              {/* Qty + Price + Fees */}
              <div className={`grid gap-3 ${isRevenu ? "grid-cols-2" : "grid-cols-3"}`}>
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
                    {isRevenu ? "Montant *" : `Prix unit.`}
                    {form.ticker && !isRevenu && (
                      <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: "var(--bg-muted)", color: "var(--text-tertiary)" }}>
                        {flag} {nativeCurr}
                      </span>
                    )}
                    {priceFetching && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#3b82f6" }} />}
                    {!priceFetching && form.price && form.ticker && !isRevenu && (
                      <span className="text-[10px]" style={{ color: "#22c55e" }}>● live</span>
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
                  {form.price && !priceFetching && nativeCurr !== currency && !isRevenu && (
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      ≈ {format(convert(parseFloat(form.price), nativeCurr as AppCurrency))}
                    </p>
                  )}
                </div>
                {!isRevenu && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Frais</label>
                    <input type="number" placeholder="1.00" value={form.fees}
                      onChange={e => set("fees", e.target.value)}
                      className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
                  </div>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Date *</label>
                <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
                  className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)", colorScheme: "dark" }} />
              </div>

              {/* ── Cash balance banner ────────────────────────────────── */}
              {form.type === "buy" && form.portfolioId && hasCashSystem && (
                <div className="flex items-center justify-between rounded-xl border px-4 py-2.5"
                  style={{
                    backgroundColor: insufficientCash ? "#ef444410" : "#0ea5e908",
                    borderColor:     insufficientCash ? "#ef444440" : "#0ea5e930",
                  }}>
                  <div className="flex items-center gap-2">
                    <Wallet className="h-3.5 w-3.5 flex-shrink-0" style={{ color: insufficientCash ? "#ef4444" : "#0ea5e9" }} />
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Liquidité disponible
                    </span>
                  </div>
                  <span className="text-xs font-bold tabular-nums"
                    style={{ color: insufficientCash ? "#ef4444" : "#0ea5e9" }}>
                    {portfolioCash.toFixed(2)} {nativeCurr}
                  </span>
                </div>
              )}

              {/* ── Insufficient cash alert ────────────────────────────── */}
              {insufficientCash && (
                <div className="flex items-start gap-2 rounded-xl border px-4 py-3"
                  style={{ backgroundColor: "#ef444410", borderColor: "#ef444440" }}>
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "#ef4444" }}>
                      Solde de liquidité insuffisant
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      Requis: {totalCost.toFixed(2)} {nativeCurr} — Disponible: {portfolioCash.toFixed(2)} {nativeCurr}.
                      Déposez des liquidités d&apos;abord.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Total preview ──────────────────────────────────────── */}
              {qty > 0 && price > 0 && !isRevenu && (
                <div className="flex items-center justify-between rounded-xl border px-4 py-3"
                  style={{ backgroundColor: typeColor + "08", borderColor: typeColor + "30" }}>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {!isRevenu && `${qty} × ${flag}${price.toFixed(2)}`}
                    {fees > 0 && <span style={{ color: "var(--text-tertiary)" }}> + {fees} frais</span>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums" style={{ color: typeColor }}>
                      {form.type === "buy" ? "−" : "+"} {flag}{(form.type === "sell" ? netProceeds : totalCost).toFixed(2)} {nativeCurr}
                    </p>
                    {nativeCurr !== currency && (
                      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        ≈ {form.type === "buy" ? "−" : "+"} {format(convert(form.type === "sell" ? netProceeds : totalCost, nativeCurr as AppCurrency))}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Notes</label>
            <input type="text" placeholder="Optionnel…" value={form.notes}
              onChange={e => set("notes", e.target.value)}
              className="w-full rounded-xl border px-3 py-3 text-sm outline-none"
              style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
        </div>

        {/* Error */}
        {saveErr && (
          <div className="mx-6 mb-2 flex items-start gap-2 rounded-lg border px-4 py-3 text-xs"
            style={{ backgroundColor: "#ef444415", borderColor: "#ef444440" }}>
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <span style={{ color: "#ef4444" }}>{saveErr}</span>
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
              : <><Check className="h-4 w-4" />{isCashMode ? "Déposer" : mode === "add" ? "Enregistrer" : "Sauvegarder"}</>
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
