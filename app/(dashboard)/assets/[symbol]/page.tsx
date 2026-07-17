"use client"

import { useState, useEffect, use } from "react"
import { Topbar } from "@/components/layout/topbar"
import { LiveChart } from "@/components/charts/live-chart"
import { useCurrency } from "@/hooks/use-currency"
import { useAppData } from "@/hooks/use-app-data"
import { Loader2, TrendingUp, TrendingDown, Star, Plus, ArrowLeft, Pencil, Save, X } from "lucide-react"
import Link from "next/link"

interface QuoteData {
  symbol:       string
  shortName:    string
  regularMarketPrice:         number
  regularMarketChange:        number
  regularMarketChangePercent: number
  regularMarketDayHigh:       number | null
  regularMarketDayLow:        number | null
  fiftyTwoWeekHigh:           number | null
  fiftyTwoWeekLow:            number | null
  marketCap:                  number | null
  trailingPE:                 number | null
  forwardPE:                  number | null
  dividendYield:              number | null
  currency:                   string
  regularMarketVolume:        number
}

function formatLargeNumber(n: number | null): string {
  if (!n) return "—"
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T"
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + "B"
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + "M"
  return n.toLocaleString()
}

export default function AssetDetailPage(props: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(props.params)
  const decodedSymbol = decodeURIComponent(symbol).toUpperCase()
  const { portfolios, updateAssetCostBasis } = useAppData()

  const [quote, setQuote]     = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [costModalOpen, setCostModalOpen] = useState(false)
  const [costDraft, setCostDraft] = useState("")
  const [costError, setCostError] = useState("")
  const [savingCost, setSavingCost] = useState(false)
  const { format, fxRates, currency } = useCurrency()

  // Find if this asset is in any of the user's real portfolios
  const heldAsset   = portfolios.flatMap(p => p.assets).find(a => a.ticker === decodedSymbol)
  const inWatchlist = false // watchlist persistence coming soon

  useEffect(() => {
    setLoading(true); setError(false)
    // Fetch live quote via our prices API
    fetch("/api/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [decodedSymbol] }),
    })
      .then(r => r.json())
      .then(data => {
        const p = data[decodedSymbol]
        if (p) {
          const displayPrice = p[currency.toLowerCase() as "chf" | "usd" | "eur"] ?? p.chf ?? p.originalPrice ?? 0
          // Facteur natif → devise d'affichage (même conversion que le prix).
          // Les statistiques (jour / 52 sem.) sont les VRAIES valeurs Yahoo —
          // null si absentes, jamais fabriquées à partir du prix.
          const toDisplay = p.originalPrice > 0 ? displayPrice / p.originalPrice : 1
          const aux = (v: number | undefined | null): number | null =>
            typeof v === "number" ? v * toDisplay : null
          setQuote({
            symbol:      decodedSymbol,
            shortName:   p.resolvedSymbol ? `${decodedSymbol} · ${p.resolvedSymbol}` : decodedSymbol,
            regularMarketPrice:         displayPrice,
            regularMarketChange:        displayPrice * ((p.changePct ?? 0) / 100),
            regularMarketChangePercent: p.changePct,
            regularMarketDayHigh:       aux(p.dayHigh),
            regularMarketDayLow:        aux(p.dayLow),
            fiftyTwoWeekHigh:           aux(p.fiftyTwoWeekHigh),
            fiftyTwoWeekLow:            aux(p.fiftyTwoWeekLow),
            marketCap:                  typeof p.marketCap === "number" ? p.marketCap : null,
            trailingPE:                 typeof p.trailingPE === "number" ? p.trailingPE : null,
            forwardPE:                  null,
            dividendYield:              null,
            currency:                   p.originalCurrency ?? "CHF",
            regularMarketVolume:        0,
          })
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [decodedSymbol, currency])

  const userRate = (fxRates as Record<string, number>)[currency] ?? 1
  const positionPrice = quote?.regularMarketPrice ?? heldAsset?.currentPrice ?? 0
  const positionValueChf = heldAsset ? (positionPrice * heldAsset.quantity) / userRate : 0
  const legacyCostChf = heldAsset
    ? (heldAsset.avgBuyPrice * heldAsset.quantity) / ((fxRates as Record<string, number>)[heldAsset.currency] ?? 1)
    : 0
  const positionCostChf = heldAsset ? (heldAsset.costBasisChf ?? legacyCostChf) : 0
  const positionPnlChf = positionValueChf - positionCostChf
  const positionPnlPct = positionCostChf > 0 ? (positionPnlChf / positionCostChf) * 100 : 0
  const positionCostDisplay = positionCostChf * userRate
  const positionPnlDisplay = positionPnlChf * userRate

  const isPos = heldAsset ? positionPnlChf >= 0 : (quote?.regularMarketChangePercent ?? 0) >= 0
  const color = isPos ? "#22c55e" : "#ef4444"

  function openCostBasisModal() {
    if (!heldAsset) return
    setCostDraft(String(Number(positionCostChf || 0).toFixed(2)))
    setCostError("")
    setCostModalOpen(true)
  }

  async function saveCostBasis() {
    if (!heldAsset) return
    const nextCost = Number(costDraft.replace(",", "."))
    if (!Number.isFinite(nextCost) || nextCost <= 0) {
      setCostError("Saisis un montant CHF positif.")
      return
    }

    setSavingCost(true)
    setCostError("")
    try {
      await updateAssetCostBasis(heldAsset.portfolioId, heldAsset.id, nextCost)
      setCostModalOpen(false)
    } catch {
      setCostError("Impossible d'enregistrer le coût historique.")
    } finally {
      setSavingCost(false)
    }
  }

  return (
    <div className="flex flex-col">
      <Topbar title={decodedSymbol} subtitle={quote?.shortName ?? "Chargement…"} />
      <div className="flex-1 space-y-6 p-4 sm:p-6">

        {/* Back */}
        <Link href="/watchlist"
          className="inline-flex items-center gap-1.5 text-xs transition-colors hover:text-white"
          style={{ color: "var(--text-secondary)" }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Retour
        </Link>

        {loading && (
          <div className="flex items-center gap-2 py-12 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#3b82f6" }} />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Chargement…</span>
          </div>
        )}

        {!loading && (
          <>
            {/* Hero */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                    {decodedSymbol.slice(0, 3)}
                  </div>
                  <div>
                    <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{decodedSymbol}</h1>
                    {quote && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{quote.shortName}</p>}
                  </div>
                </div>
              </div>

              {quote && (
                <div className="text-right">
                  <p className="text-3xl font-bold tabular-nums" style={{ color }}>
                    {format(quote.regularMarketPrice)}
                  </p>
                  <div className="flex items-center gap-2 justify-end mt-1">
                    {isPos ? <TrendingUp className="h-4 w-4" style={{ color }} /> : <TrendingDown className="h-4 w-4" style={{ color }} />}
                    <span className="text-sm tabular-nums font-medium" style={{ color }}>
                      {heldAsset
                        ? `${positionPnlDisplay >= 0 ? "+" : ""}${format(positionPnlDisplay)} (${positionPnlPct >= 0 ? "+" : ""}${positionPnlPct.toFixed(2)}%)`
                        : `${isPos ? "+" : ""}${format(quote.regularMarketChange)} (${isPos ? "+" : ""}${quote.regularMarketChangePercent.toFixed(2)}%)`
                      }
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Chart */}
            <LiveChart ticker={decodedSymbol} name={decodedSymbol} height={320} defaultCompare="SPY" />

            {/* Stats grid */}
            {quote && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Haut 24h",       value: quote.regularMarketDayHigh != null ? format(quote.regularMarketDayHigh) : "—" },
                  { label: "Bas 24h",        value: quote.regularMarketDayLow  != null ? format(quote.regularMarketDayLow)  : "—" },
                  { label: "Plus haut 52s",  value: quote.fiftyTwoWeekHigh     != null ? format(quote.fiftyTwoWeekHigh)     : "—" },
                  { label: "Plus bas 52s",   value: quote.fiftyTwoWeekLow      != null ? format(quote.fiftyTwoWeekLow)      : "—" },
                  { label: "Cap. boursière", value: formatLargeNumber(quote.marketCap) },
                  { label: "P/E (trail.)",   value: quote.trailingPE ? quote.trailingPE.toFixed(2) : "—" },
                  { label: "P/E (fwd.)",     value: quote.forwardPE  ? quote.forwardPE.toFixed(2)  : "—" },
                  { label: "Rendement div.", value: quote.dividendYield ? (quote.dividendYield * 100).toFixed(2) + "%" : "—" },
                ].map(s => (
                  <div key={s.label} className="rounded-xl border p-4"
                    style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                    <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                    <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Your position */}
            {heldAsset && (
              <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "#22c55e40" }}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold flex items-center gap-2" style={{ color: "#22c55e" }}>
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Votre position
                  </p>
                  <button
                    type="button"
                    onClick={openCostBasisModal}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-800"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Modifier le coût historique
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  {[
                    { label: "Quantité",      value: String(heldAsset.quantity) },
                    { label: "Prix moyen",     value: format(heldAsset.avgBuyPrice) },
                    { label: "Valeur actuelle",value: format((quote?.regularMarketPrice ?? heldAsset.currentPrice) * heldAsset.quantity) },
                    { label: "Investi",        value: format(positionCostDisplay) },
                    { label: "P&L total",      value: (() => {
                      return (positionPnlDisplay >= 0 ? "+" : "") + format(positionPnlDisplay)
                    })() },
                  ].map(s => (
                    <div key={s.label}>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                      <p className="text-sm font-semibold tabular-nums mt-0.5" style={{ color: "var(--text-primary)" }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
              <Link href="/portfolios"
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                <Plus className="h-4 w-4" />
                Ajouter au portefeuille
              </Link>
              <Link href="/watchlist"
                className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-800"
                style={{ borderColor: "var(--border)", color: inWatchlist ? "#f59e0b" : "var(--text-secondary)" }}>
                <Star className="h-4 w-4" fill={inWatchlist ? "#f59e0b" : "none"} />
                {inWatchlist ? "Dans la watchlist" : "Ajouter à la watchlist"}
              </Link>
            </div>
          </>
        )}
      </div>
      {costModalOpen && heldAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-sm rounded-xl border p-5 shadow-2xl"
            style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--border)" }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Modifier le coût historique
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Montant total réellement payé en CHF pour {heldAsset.ticker}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCostModalOpen(false)}
                className="rounded-lg p-1.5 transition-colors hover:bg-zinc-800"
                style={{ color: "var(--text-tertiary)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Coût historique total (CHF)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={costDraft}
              onChange={e => setCostDraft(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500"
              style={{ backgroundColor: "var(--bg-muted)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            />
            {costError && <p className="mt-2 text-xs text-red-400">{costError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCostModalOpen(false)}
                className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-800"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={saveCostBasis}
                disabled={savingCost}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ backgroundColor: "#2563eb" }}
              >
                {savingCost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
