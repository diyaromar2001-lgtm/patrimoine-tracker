"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, TrendingUp, BarChart2 } from "lucide-react"

interface ChartPoint { time: number; value: number; open?: number; high?: number; low?: number; close?: number }
interface LiveChartData { main: ChartPoint[]; compare: ChartPoint[] }

const PERIODS = ["1W","1M","3M","6M","1Y","2Y","5Y"] as const
type Period = (typeof PERIODS)[number]

interface LiveChartProps {
  ticker: string
  name?: string
  height?: number
  showCompareSP500?: boolean
}

export function LiveChart({ ticker, name, height = 300, showCompareSP500 = true }: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<ReturnType<typeof import("lightweight-charts")["createChart"]> | null>(null)
  const [period, setPeriod]   = useState<Period>("1Y")
  const [compare, setCompare] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [stats, setStats]     = useState<{ change: number; changePct: number } | null>(null)

  const loadChart = useCallback(async () => {
    if (!containerRef.current) return
    setLoading(true); setError(false)

    try {
      const url = `/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}&compare=${compare}`
      const res = await fetch(url)
      const data: LiveChartData = await res.json()
      if (!data.main?.length) { setError(true); setLoading(false); return }

      // Compute stats
      const first = data.main[0]?.value ?? 0
      const last  = data.main[data.main.length - 1]?.value ?? 0
      const chg   = last - first
      const pct   = first > 0 ? (chg / first) * 100 : 0
      setStats({ change: chg, changePct: pct })

      import("lightweight-charts").then(({ createChart, LineSeries, AreaSeries }) => {
        if (!containerRef.current) return
        chartRef.current?.remove()

        const isPositive = pct >= 0
        const mainColor  = isPositive ? "#22c55e" : "#ef4444"

        const chart = createChart(containerRef.current!, {
          width:  containerRef.current!.clientWidth,
          height,
          layout: {
            background: { color: "transparent" },
            textColor:  "#a1a1aa",
            fontSize:   11,
            fontFamily: "Inter, ui-sans-serif",
          },
          grid: {
            vertLines: { color: "#27272a" },
            horzLines: { color: "#27272a" },
          },
          crosshair: {
            vertLine: { color: "#3b82f660", width: 1, labelBackgroundColor: "#18181b" },
            horzLine: { color: "#3b82f660", width: 1, labelBackgroundColor: "#18181b" },
          },
          rightPriceScale: {
            borderColor: "#27272a",
            scaleMargins: { top: 0.08, bottom: 0.08 },
          },
          timeScale: {
            borderColor:    "#27272a",
            timeVisible:    true,
            fixLeftEdge:    true,
            fixRightEdge:   true,
            barSpacing:     8,
          },
          handleScroll: true,
          handleScale:  true,
        })

        // Main series
        const mainSeries = chart.addSeries(AreaSeries, {
          lineColor:   mainColor,
          topColor:    mainColor + "33",
          bottomColor: mainColor + "00",
          lineWidth:   2,
          priceLineVisible:  false,
          lastValueVisible:  true,
          crosshairMarkerVisible:         true,
          crosshairMarkerRadius:          4,
          crosshairMarkerBackgroundColor: mainColor,
        })
        mainSeries.setData(
          data.main.map(d => ({
            time:  (d.time as unknown) as `${number}-${number}-${number}`,
            value: d.value,
          }))
        )

        // S&P 500 comparison
        if (compare && data.compare?.length) {
          const spSeries = chart.addSeries(LineSeries, {
            color:     "#f59e0b",
            lineWidth: 2,
            lineStyle: 2, // dashed
            priceLineVisible:  false,
            lastValueVisible:  true,
            title:             "S&P 500",
            crosshairMarkerVisible: true,
          })
          spSeries.setData(
            data.compare.map(d => ({
              time:  (d.time as unknown) as `${number}-${number}-${number}`,
              value: d.value,
            }))
          )
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

  useEffect(() => { loadChart() }, [loadChart])
  useEffect(() => () => { chartRef.current?.remove(); chartRef.current = null }, [])

  const isPos = (stats?.changePct ?? 0) >= 0

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{name ?? ticker}</p>
            {stats && (
              <p className="text-xs tabular-nums" style={{ color: isPos ? "var(--gain)" : "var(--loss)" }}>
                {isPos ? "▲" : "▼"} {Math.abs(stats.changePct).toFixed(2)}%
                {compare && <span className="ml-2 text-[11px]" style={{ color: "var(--foreground-dim)" }}>vs 100 normalisé</span>}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* S&P 500 toggle */}
          {showCompareSP500 && (
            <button
              onClick={() => setCompare(c => !c)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                backgroundColor: compare ? "#f59e0b18" : "var(--background-hover)",
                color: compare ? "#f59e0b" : "var(--foreground-muted)",
                border: "1px solid " + (compare ? "#f59e0b40" : "var(--border)"),
              }}
            >
              <TrendingUp className="h-3 w-3" /> vs S&P 500
            </button>
          )}

          {/* Period selector */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className="px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: period === p ? "var(--accent)" : "var(--background-hover)",
                  color: period === p ? "white" : "var(--foreground-dim)",
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative p-2" style={{ minHeight: height + 16 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/20 backdrop-blur-sm rounded-xl">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#3b82f6" }} />
              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>Chargement…</span>
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <BarChart2 className="h-8 w-8" style={{ color: "var(--foreground-dim)" }} />
            <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Données indisponibles</p>
          </div>
        )}
        {compare && (
          <div className="absolute top-4 left-4 z-10 flex items-center gap-3 rounded-lg border px-3 py-1.5"
            style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#22c55e" }}>
              <span className="h-2 w-4 rounded-full inline-block" style={{ backgroundColor: "#22c55e" }} />
              {ticker}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#f59e0b" }}>
              <span className="h-0.5 w-4 inline-block border-t-2 border-dashed" style={{ borderColor: "#f59e0b" }} />
              S&P 500
            </span>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%", height }} />
      </div>
    </div>
  )
}
