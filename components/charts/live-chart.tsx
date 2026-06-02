"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, BarChart2 } from "lucide-react"

interface ChartPoint { time: number; value: number }
interface ComparisonSeries { ticker: string; data: ChartPoint[] }
interface LiveChartData { main: ChartPoint[]; comparisons: ComparisonSeries[] }

const PERIODS = ["1W","1M","3M","6M","1Y","2Y","5Y"] as const
type Period = (typeof PERIODS)[number]

// Comparison options: none | SPY | SPY+VWCE
type CompareMode = "none" | "SPY" | "SPY,VWCE.DE"

const COMPARE_COLORS: Record<string, string> = {
  SPY:     "#f59e0b",
  "VWCE.DE": "#a78bfa",
}

interface LiveChartProps {
  ticker: string
  name?: string
  height?: number
  defaultCompare?: CompareMode
}

export function LiveChart({ ticker, name, height = 300, defaultCompare = "none" }: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<ReturnType<typeof import("lightweight-charts")["createChart"]> | null>(null)
  const [period, setPeriod]     = useState<Period>("1Y")
  const [compare, setCompare]   = useState<CompareMode>(defaultCompare)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [stats, setStats]       = useState<{ change: number; pct: number } | null>(null)

  const load = useCallback(async () => {
    if (!containerRef.current) return
    setLoading(true); setError(false)

    const url = `/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}${compare !== "none" ? `&compare=${compare}` : ""}`
    try {
      const res  = await fetch(url)
      const data: LiveChartData = await res.json()
      if (!data.main?.length) { setError(true); setLoading(false); return }

      const first = data.main[0].value, last = data.main[data.main.length - 1].value
      setStats({ change: last - first, pct: first > 0 ? ((last - first) / first) * 100 : 0 })

      import("lightweight-charts").then(({ createChart, AreaSeries, LineSeries }) => {
        if (!containerRef.current) return
        chartRef.current?.remove()

        const isPos   = (last - first) >= 0
        const mainClr = isPos ? "#22c55e" : "#ef4444"

        const chart = createChart(containerRef.current!, {
          width:  containerRef.current!.clientWidth,
          height,
          layout: { background: { color: "transparent" }, textColor: "#a1a1aa", fontSize: 11, fontFamily: "Inter, ui-sans-serif" },
          grid:   { vertLines: { color: "#27272a" }, horzLines: { color: "#27272a" } },
          crosshair: {
            vertLine: { color: "#3b82f660", width: 1, labelBackgroundColor: "#18181b" },
            horzLine: { color: "#3b82f660", width: 1, labelBackgroundColor: "#18181b" },
          },
          rightPriceScale: { borderColor: "#27272a", scaleMargins: { top: 0.08, bottom: 0.08 } },
          timeScale: { borderColor: "#27272a", timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
          handleScroll: true,
          handleScale:  true,
        })

        // Main area series
        const mainS = chart.addSeries(AreaSeries, {
          lineColor: mainClr, topColor: mainClr + "33", bottomColor: mainClr + "00",
          lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerBackgroundColor: mainClr, crosshairMarkerRadius: 4,
        })
        mainS.setData(data.main.map(d => ({ time: (d.time as unknown) as `${number}-${number}-${number}`, value: d.value })))

        // Comparison series
        for (const c of data.comparisons ?? []) {
          if (!c.data?.length) continue
          const clr = COMPARE_COLORS[c.ticker] ?? "#64748b"
          const s = chart.addSeries(LineSeries, {
            color: clr, lineWidth: 2, lineStyle: 2,
            priceLineVisible: false, lastValueVisible: true, title: c.ticker,
            crosshairMarkerVisible: true,
          })
          s.setData(c.data.map(d => ({ time: (d.time as unknown) as `${number}-${number}-${number}`, value: d.value })))
        }

        chart.timeScale().fitContent()
        chartRef.current = chart

        const ro = new ResizeObserver(() => {
          containerRef.current && chart.applyOptions({ width: containerRef.current.clientWidth })
        })
        ro.observe(containerRef.current!)
      })
    } catch { setError(true) }
    finally { setLoading(false) }
  }, [ticker, period, compare, height])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { chartRef.current?.remove(); chartRef.current = null }, [])

  const isPos = (stats?.pct ?? 0) >= 0

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{name ?? ticker}</p>
          {stats && !loading && (
            <p className="text-xs tabular-nums" style={{ color: isPos ? "var(--gain)" : "var(--loss)" }}>
              {isPos ? "▲" : "▼"} {Math.abs(stats.pct).toFixed(2)}%
              {compare !== "none" && <span className="ml-1.5 text-[11px]" style={{ color: "var(--foreground-dim)" }}>normalisé à 100</span>}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Compare selector */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
            {(["none","SPY","SPY,VWCE.DE"] as CompareMode[]).map(m => (
              <button key={m} onClick={() => setCompare(m)}
                className="px-2 py-1 text-[11px] font-medium transition-colors"
                style={{
                  backgroundColor: compare === m ? "var(--background-hover)" : "transparent",
                  color: compare === m ? "white" : "var(--foreground-dim)",
                }}>
                {m === "none" ? "Seul" : m === "SPY" ? "vs S&P500" : "+ MSCI World"}
              </button>
            ))}
          </div>

          {/* Period */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className="px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: period === p ? "var(--accent)" : "transparent",
                  color: period === p ? "white" : "var(--foreground-dim)",
                }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend for comparisons */}
      {compare !== "none" && !loading && (
        <div className="flex items-center gap-4 px-4 pt-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: isPos ? "#22c55e" : "#ef4444" }}>
            <span className="h-2 w-4 rounded-full inline-block" style={{ backgroundColor: isPos ? "#22c55e" : "#ef4444" }} />
            {ticker}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#f59e0b" }}>
            <span className="h-0.5 w-4 inline-block border-t-2 border-dashed" style={{ borderColor: "#f59e0b" }} />
            S&P 500
          </span>
          {compare === "SPY,VWCE.DE" && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#a78bfa" }}>
              <span className="h-0.5 w-4 inline-block border-t-2 border-dashed" style={{ borderColor: "#a78bfa" }} />
              MSCI World
            </span>
          )}
        </div>
      )}

      {/* Chart */}
      <div className="relative p-2" style={{ minHeight: height + 16 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#3b82f6" }} />
              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>Chargement des données…</span>
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <BarChart2 className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
            <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Données indisponibles pour {ticker}</p>
            <button onClick={load} className="text-xs underline" style={{ color: "var(--accent)" }}>Réessayer</button>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%", height }} />
      </div>
    </div>
  )
}
