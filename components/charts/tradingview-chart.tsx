"use client"

import { useEffect, useRef, useState, useId } from "react"
import { Loader2, ExternalLink, Maximize2, Minimize2 } from "lucide-react"
import { tradingViewChartUrl } from "@/lib/tradingview-symbol"

declare global {
  interface Window {
    TradingView?: { widget: new (config: Record<string, unknown>) => unknown }
  }
}

const TV_SCRIPT = "https://s3.tradingview.com/tv.js"

/** Charge tv.js une seule fois pour toute l'application. */
let scriptPromise: Promise<void> | null = null
function loadTradingView(): Promise<void> {
  if (window.TradingView) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = TV_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { scriptPromise = null; reject(new Error("tv.js")) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

interface TradingViewChartProps {
  /** Symbole TradingView déjà résolu, ex. "LSE:WSML". */
  symbol: string
  height?: number
  /** Intervalle par défaut : "D" (jour), "60" (1 h), "W"… */
  interval?: string
}

/**
 * Graphique TradingView complet — outils de dessin, indicateurs, comparaisons.
 *
 * Le widget est servi par TradingView : si le script est bloqué (bloqueur de
 * pubs, réseau restreint), on affiche un repli explicite avec un lien direct
 * plutôt qu'un cadre vide.
 */
export function TradingViewChart({ symbol, height = 560, interval = "D" }: TradingViewChartProps) {
  const containerId = "tv-" + useId().replace(/[^a-zA-Z0-9]/g, "")
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "blocked">("loading")
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStatus("loading")

    loadTradingView()
      .then(() => {
        if (cancelled || !hostRef.current || !window.TradingView) return
        hostRef.current.innerHTML = ""
        new window.TradingView.widget({
          container_id:       containerId,
          symbol,
          interval,
          autosize:           true,
          timezone:           "Europe/Zurich",
          theme:              "dark",
          style:              "1",          // chandeliers
          locale:             "fr",
          withdateranges:     true,
          allow_symbol_change: true,
          details:            true,
          hide_side_toolbar:  false,        // ← barre d'outils de dessin
          studies:            ["MASimple@tv-basicstudies"],
          enable_publishing:  false,
          backgroundColor:    "rgba(0,0,0,0)",
        })
        setStatus("ready")
      })
      .catch(() => { if (!cancelled) setStatus("blocked") })

    return () => {
      cancelled = true
      if (hostRef.current) hostRef.current.innerHTML = ""
    }
  }, [symbol, interval, containerId])

  const boxHeight = expanded ? Math.max(height, 780) : height

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {symbol}
          </span>
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>TradingView</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            title={expanded ? "Réduire" : "Agrandir"}
            className="rounded-lg p-1.5 transition-colors hover:bg-zinc-800"
            style={{ color: "var(--text-secondary)" }}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <a
            href={tradingViewChartUrl(symbol)}
            target="_blank"
            rel="noopener noreferrer"
            title="Ouvrir sur TradingView"
            className="rounded-lg p-1.5 transition-colors hover:bg-zinc-800"
            style={{ color: "var(--text-secondary)" }}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="relative" style={{ height: boxHeight }}>
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#3b82f6" }} />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Chargement du graphique…
            </span>
          </div>
        )}

        {status === "blocked" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              Le graphique TradingView n&apos;a pas pu se charger.
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Un bloqueur de publicités ou le réseau empêche le chargement de tradingview.com.
            </p>
            <a
              href={tradingViewChartUrl(symbol)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ color: "#3b82f6" }}
            >
              Ouvrir sur TradingView <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        <div id={containerId} ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  )
}
