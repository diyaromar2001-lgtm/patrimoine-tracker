"use client"

import { useEffect, useRef } from "react"
import type { PortfolioSnapshot } from "@/lib/types"

interface AreaChartProps {
  data: PortfolioSnapshot[]
  height?: number
}

export function AreaChart({ data, height = 240 }: AreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts")["createChart"]> | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    // lightweight-charts v5: addSeries(AreaSeries, options) replaces addAreaSeries()
    import("lightweight-charts").then(({ createChart, AreaSeries }) => {
      if (!containerRef.current) return

      // Remove previous chart
      chartRef.current?.remove()

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height,
        layout: {
          background: { color: "transparent" },
          textColor:  "#84849a",
          fontSize:   11,
          fontFamily: "Inter, ui-sans-serif, system-ui",
        },
        grid: {
          vertLines: { color: "#1e1e28", style: 1 },  // dotted, very subtle
          horzLines: { color: "#1e1e28", style: 1 },
        },
        crosshair: {
          vertLine: { color: "#6366f160", width: 1, labelBackgroundColor: "#111117" },
          horzLine: { color: "#6366f160", width: 1, labelBackgroundColor: "#111117" },
        },
        rightPriceScale: {
          borderColor: "#1e1e28",
          textColor:   "#84849a",
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
          borderColor: "#1e1e28",
          timeVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        handleScroll: false,
        handleScale: false,
      })

      // v5 API: chart.addSeries(SeriesType, options)
      const series = chart.addSeries(AreaSeries, {
        lineColor:   "#6366f1",
        topColor:    "#6366f128",
        bottomColor: "#6366f100",
        lineWidth:   2,
        crosshairMarkerVisible:         true,
        crosshairMarkerRadius:          4,
        crosshairMarkerBackgroundColor: "#6366f1",
        priceLineVisible:  false,
        lastValueVisible:  false,
      })

      const chartData = data.map((s) => ({
        time: s.date as `${number}-${number}-${number}`,
        value: s.value,
      }))
      series.setData(chartData)
      chart.timeScale().fitContent()
      chartRef.current = chart

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth })
        }
      })
      ro.observe(containerRef.current)
      return () => ro.disconnect()
    })

    return () => {
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [data, height])

  return <div ref={containerRef} style={{ width: "100%", height }} />
}
