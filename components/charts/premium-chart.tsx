"use client"

import { useMemo, useRef, useState, useEffect, useId } from "react"

export interface PremiumChartPoint {
  date:  string   // "YYYY-MM-DD"
  value: number
}

interface PremiumChartProps {
  data:    PremiumChartPoint[]
  height?: number
  /** Vert/rouge dérivés de la tendance quand non fourni. */
  color?:  string
  loading?: boolean
  /**
   * Remonte le point survolé (ou null au relâchement) : l'en-tête affiche
   * alors la valeur à cette date, comme sur un graphique de courtier.
   */
  onScrub?: (point: PremiumChartPoint | null) => void
  formatValue?: (v: number) => string
}

const GAIN = "#22c55e"
const LOSS = "#ef4444"

/**
 * Courbe lissée en SVG pur.
 *
 * Écrit à la main plutôt qu'avec une librairie : on a besoin d'un contrôle
 * total sur le tracé animé, le halo du dernier point et le suivi tactile,
 * et ça évite de charger un moteur de graphique sur une page mobile.
 *
 * Le lissage est un Catmull-Rom converti en courbes de Bézier : il passe
 * exactement par chaque point (contrairement à un simple lissage qui
 * inventerait des valeurs), tout en supprimant les angles.
 */
export function PremiumChart({
  data, height = 220, color, loading = false, onScrub, formatValue,
}: PremiumChartProps) {
  const gradientId = "grad-" + useId().replace(/[^a-zA-Z0-9]/g, "")
  const glowId     = "glow-" + useId().replace(/[^a-zA-Z0-9]/g, "")
  const wrapRef    = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const PAD_X = 4
  const PAD_TOP = 18      // laisse respirer le halo du dernier point
  const PAD_BOTTOM = 10

  const geometry = useMemo(() => {
    if (data.length < 2) return null

    const values = data.map(d => d.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    // Une courbe parfaitement plate ne doit pas diviser par zéro : on lui
    // donne une amplitude arbitraire pour la centrer.
    const span = max - min || Math.abs(max) || 1

    const innerW = Math.max(width - PAD_X * 2, 1)
    const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 1)

    const pts = data.map((d, i) => ({
      x: PAD_X + (i / (data.length - 1)) * innerW,
      y: PAD_TOP + innerH - ((d.value - min) / span) * innerH,
    }))

    // Catmull-Rom → Bézier cubique.
    let line = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2] ?? p2
      const c1x = p1.x + (p2.x - p0.x) / 6
      const c1y = p1.y + (p2.y - p0.y) / 6
      const c2x = p2.x - (p3.x - p1.x) / 6
      const c2y = p2.y - (p3.y - p1.y) / 6
      line += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
    }
    const area = `${line} L ${pts[pts.length - 1].x} ${height} L ${pts[0].x} ${height} Z`

    return { pts, line, area, min, max, last: pts[pts.length - 1] }
  }, [data, width, height])

  const trendColor = color ?? (
    data.length >= 2 && data[data.length - 1].value >= data[0].value ? GAIN : LOSS
  )

  // Redessine la courbe à chaque changement de série (période, devise).
  const seriesKey = `${data.length}:${data[0]?.date ?? ""}:${data[data.length - 1]?.date ?? ""}`

  function pick(clientX: number) {
    if (!geometry || !wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    let best = 0
    let bestDist = Infinity
    geometry.pts.forEach((p, i) => {
      const d = Math.abs(p.x - x)
      if (d < bestDist) { bestDist = d; best = i }
    })
    setHoverIdx(best)
    onScrub?.(data[best])
  }

  function release() {
    setHoverIdx(null)
    onScrub?.(null)
  }

  if (loading) {
    return (
      <div ref={wrapRef} style={{ height }} className="flex items-center justify-center">
        <div className="h-full w-full animate-pulse rounded-2xl"
          style={{ backgroundColor: "var(--bg-muted)", opacity: 0.35 }} />
      </div>
    )
  }

  if (!geometry) {
    return (
      <div ref={wrapRef} style={{ height }} className="flex items-center justify-center">
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Pas encore assez d&apos;historique pour tracer une courbe.
        </p>
      </div>
    )
  }

  const hovered = hoverIdx != null ? geometry.pts[hoverIdx] : null

  return (
    <div
      ref={wrapRef}
      className="relative select-none"
      style={{ height, touchAction: "pan-y" }}
      onMouseMove={e => pick(e.clientX)}
      onMouseLeave={release}
      onTouchStart={e => pick(e.touches[0].clientX)}
      onTouchMove={e => pick(e.touches[0].clientX)}
      onTouchEnd={release}
    >
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={trendColor} stopOpacity="0.28" />
            <stop offset="55%"  stopColor={trendColor} stopOpacity="0.08" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grille discrète — repères horizontaux uniquement, pour ne pas
            concurrencer la courbe. */}
        {[0.25, 0.5, 0.75].map(r => (
          <line
            key={r}
            x1={0} x2={width}
            y1={PAD_TOP + r * (height - PAD_TOP - PAD_BOTTOM)}
            y2={PAD_TOP + r * (height - PAD_TOP - PAD_BOTTOM)}
            stroke="var(--border-subtle, #1e1e28)"
            strokeDasharray="2 6"
            strokeWidth={1}
          />
        ))}

        <g key={seriesKey}>
          <path d={geometry.area} fill={`url(#${gradientId})`} className="pc-fade" />
          <path
            d={geometry.line}
            fill="none"
            stroke={trendColor}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pc-draw"
          />
        </g>

        {/* Curseur de lecture */}
        {hovered && (
          <>
            <line
              x1={hovered.x} x2={hovered.x} y1={PAD_TOP - 12} y2={height}
              stroke={trendColor} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3"
            />
            <circle cx={hovered.x} cy={hovered.y} r={5.5} fill="var(--bg-base, #0b0b0f)"
              stroke={trendColor} strokeWidth={2.25} />
          </>
        )}

        {/* Point lumineux sur la dernière valeur */}
        {!hovered && (
          <g filter={`url(#${glowId})`}>
            <circle cx={geometry.last.x} cy={geometry.last.y} r={4} fill={trendColor}>
              <animate attributeName="r" values="3.4;5;3.4" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.65;1" dur="2.4s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </svg>

      {/* Date lue au doigt */}
      {hoverIdx != null && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums"
          style={{
            left: Math.min(Math.max(hovered!.x - 34, 0), Math.max(width - 68, 0)),
            backgroundColor: "var(--bg-overlay, #16161d)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {new Date(data[hoverIdx].date).toLocaleDateString("fr-CH", { day: "2-digit", month: "short" })}
          {formatValue && ` · ${formatValue(data[hoverIdx].value)}`}
        </div>
      )}

      <style jsx>{`
        .pc-draw {
          stroke-dasharray: 2200;
          stroke-dashoffset: 2200;
          animation: pc-draw 0.85s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .pc-fade {
          opacity: 0;
          animation: pc-fade 0.7s ease-out 0.25s forwards;
        }
        @keyframes pc-draw { to { stroke-dashoffset: 0; } }
        @keyframes pc-fade { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .pc-draw { animation: none; stroke-dashoffset: 0; }
          .pc-fade { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  )
}
