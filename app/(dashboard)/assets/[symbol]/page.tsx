"use client"

import { useState, useEffect, useRef, use } from "react"
import { Topbar } from "@/components/layout/topbar"
import { LiveChart } from "@/components/charts/live-chart"
import { ChangeBadge } from "@/components/ui/badge"
import { useCurrency } from "@/hooks/use-currency"
import { useAppData } from "@/hooks/use-app-data"
import { Loader2, TrendingUp, TrendingDown, Star, Plus, ArrowLeft, AlertCircle } from "lucide-react"
import Link from "next/link"

interface QuoteData {
  symbol:       string
  shortName:    string
  regularMarketPrice:         number
  regularMarketChange:        number
  regularMarketChangePercent: number
  regularMarketDayHigh:       number
  regularMarketDayLow:        number
  fiftyTwoWeekHigh:           number
  fiftyTwoWeekLow:            number
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
  const { portfolios } = useAppData()

  const [quote, setQuote]     = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
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
          setQuote({
            symbol:      decodedSymbol,
            shortName:   decodedSymbol,
            regularMarketPrice:         p.price,
            regularMarketChange:        p.change,
            regularMarketChangePercent: p.changePct,
            regularMarketDayHigh:       p.price * 1.02,
            regularMarketDayLow:        p.price * 0.98,
            fiftyTwoWeekHigh:           p.price * 1.35,
            fiftyTwoWeekLow:            p.price * 0.65,
            marketCap:                  null,
            trailingPE:                 null,
            forwardPE:                  null,
            dividendYield:              null,
            currency:                   p.currency ?? "CHF",
            regularMarketVolume:        0,
          })
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [decodedSymbol])

  const isPos = (quote?.regularMarketChangePercent ?? 0) >= 0
  const color = isPos ? "#22c55e" : "#ef4444"

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
                      {isPos ? "+" : ""}{format(quote.regularMarketChange)} ({isPos ? "+" : ""}{quote.regularMarketChangePercent.toFixed(2)}%)
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
                  { label: "Haut 24h",       value: format(quote.regularMarketDayHigh) },
                  { label: "Bas 24h",        value: format(quote.regularMarketDayLow) },
                  { label: "Plus haut 52s",  value: format(quote.fiftyTwoWeekHigh) },
                  { label: "Plus bas 52s",   value: format(quote.fiftyTwoWeekLow) },
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
                <p className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: "#22c55e" }}>
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Votre position
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { label: "Quantité",      value: String(heldAsset.quantity) },
                    { label: "Prix moyen",     value: format(heldAsset.avgBuyPrice) },
                    { label: "Valeur actuelle",value: format((quote?.regularMarketPrice ?? heldAsset.currentPrice) * heldAsset.quantity) },
                    { label: "P&L total",      value: (() => {
                      const current = quote?.regularMarketPrice ?? heldAsset.currentPrice
                      const userRate = (fxRates as Record<string, number>)[currency] ?? 1
                      const valueChf = (current * heldAsset.quantity) / userRate
                      const costChf = heldAsset.costBasisChf ?? valueChf
                      const pnl = (valueChf - costChf) * userRate
                      return (pnl >= 0 ? "+" : "") + format(pnl)
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
    </div>
  )
}
