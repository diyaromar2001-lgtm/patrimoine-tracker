"use client"

import { useMemo } from "react"

/**
 * SankeyCashflow — diagramme de flux type Finary, en SVG pur (aucune lib).
 *
 * 4 colonnes : Sources → Hub (flux de la période) → Emplois → Détail
 * (ex. achats ventilés par actif). Les hauteurs sont proportionnelles aux
 * montants réels ; aucun flux n'est inventé.
 */

export interface SankeyLeaf {
  label: string
  value: number
  color: string
}

export interface SankeyNode extends SankeyLeaf {
  id: string
  /** Ventilation optionnelle (4e colonne), ex. achats par ticker. */
  children?: SankeyLeaf[]
}

interface Placed extends SankeyNode {
  y: number
  h: number
}

const W = 1060
const NODE_W = 14
const GAP = 10
const TOP = 16
const BOTTOM = 16

// x des 4 colonnes (barres)
const X_SRC = 190
const X_HUB = 470
const X_USE = 700
const X_CHILD = 936

function ribbon(x1: number, y1: number, h1: number, x2: number, y2: number, h2: number): string {
  const c = (x2 - x1) / 2
  return [
    `M ${x1} ${y1}`,
    `C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`,
    `L ${x2} ${y2 + h2}`,
    `C ${x2 - c} ${y2 + h2}, ${x1 + c} ${y1 + h1}, ${x1} ${y1 + h1}`,
    "Z",
  ].join(" ")
}

function place(nodes: SankeyNode[], scale: number, height: number): Placed[] {
  const totalH = nodes.reduce((s, n) => s + Math.max(n.value * scale, 3), 0) + GAP * Math.max(0, nodes.length - 1)
  let y = TOP + Math.max(0, (height - TOP - BOTTOM - totalH) / 2)
  return nodes.map(n => {
    const h = Math.max(n.value * scale, 3)
    const placed = { ...n, y, h }
    y += h + GAP
    return placed
  })
}

export function SankeyCashflow({
  sources,
  hubLabel,
  uses,
  format,
}: {
  sources: SankeyNode[]
  hubLabel: string
  uses: SankeyNode[]
  format: (v: number) => string
}) {
  const model = useMemo(() => {
    const src = sources.filter(s => s.value > 0.005)
    const use = uses.filter(u => u.value > 0.005)
    const totalIn = src.reduce((s, n) => s + n.value, 0)
    const totalOut = use.reduce((s, n) => s + n.value, 0)
    if (totalIn <= 0 && totalOut <= 0) return null

    const flow = Math.max(totalIn, totalOut)
    // Hauteur du SVG adaptée au nombre de nœuds (détail compris)
    const childCount = use.reduce((s, u) => s + (u.children?.filter(c => c.value > 0.005).length ?? 0), 0)
    const H = Math.max(320, Math.min(560, 120 + Math.max(src.length, use.length, childCount) * 44))
    const usable = H - TOP - BOTTOM - GAP * (Math.max(src.length, use.length, 1) - 1)
    const scale = flow > 0 ? usable / flow : 1

    const placedSrc = place(src, scale, H)
    const placedUse = place(use, scale, H)

    // Hub : hauteur = flux total, centré
    const hubH = Math.max(flow * scale, 6)
    const hubY = TOP + Math.max(0, (H - TOP - BOTTOM - hubH) / 2)

    // Détail (4e colonne) : enfants de chaque emploi, à l'échelle
    const children: Array<Placed & { parent: Placed }> = []
    {
      const all: Array<{ parent: Placed; leaf: SankeyLeaf }> = []
      for (const u of placedUse) {
        for (const c of (u.children ?? []).filter(c => c.value > 0.005)) {
          all.push({ parent: u, leaf: c })
        }
      }
      const childGap = 6
      const totalChildH = all.reduce((s, c) => s + Math.max(c.leaf.value * scale, 3), 0) + childGap * Math.max(0, all.length - 1)
      let y = TOP + Math.max(0, (H - TOP - BOTTOM - totalChildH) / 2)
      for (const { parent, leaf } of all) {
        const h = Math.max(leaf.value * scale, 3)
        children.push({ id: `${parent.id}:${leaf.label}`, ...leaf, y, h, parent })
        y += h + childGap
      }
    }

    return { placedSrc, placedUse, children, hubY, hubH, H, totalIn, totalOut, scale }
  }, [sources, uses])

  if (!model) return null
  const { placedSrc, placedUse, children, hubY, hubH, H, totalIn, scale } = model

  // Offsets cumulés le long du hub pour empiler les rubans proprement
  let inOffset = 0
  let outOffset = 0
  const childOffsets = new Map<string, number>()

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 760 }} role="img"
        aria-label="Diagramme des flux de trésorerie">

        {/* ── Rubans sources → hub ── */}
        {placedSrc.map(s => {
          const h = s.value * scale
          const y = hubY + inOffset
          inOffset += h
          return (
            <path key={`in-${s.id}`} d={ribbon(X_SRC + NODE_W, s.y, s.h, X_HUB, y, h)}
              fill={s.color} opacity={0.28}>
              <title>{`${s.label} → ${hubLabel} : ${format(s.value)}`}</title>
            </path>
          )
        })}

        {/* ── Rubans hub → emplois ── */}
        {placedUse.map(u => {
          const h = u.value * scale
          const y = hubY + outOffset
          outOffset += h
          return (
            <path key={`out-${u.id}`} d={ribbon(X_HUB + NODE_W, y, h, X_USE, u.y, u.h)}
              fill={u.color} opacity={0.28}>
              <title>{`${hubLabel} → ${u.label} : ${format(u.value)}`}</title>
            </path>
          )
        })}

        {/* ── Rubans emplois → détail ── */}
        {children.map(c => {
          const off = childOffsets.get(c.parent.id) ?? 0
          const h = c.value * scale
          const y = c.parent.y + off
          childOffsets.set(c.parent.id, off + h)
          return (
            <path key={`child-${c.id}`} d={ribbon(X_USE + NODE_W, y, h, X_CHILD, c.y, c.h)}
              fill={c.color} opacity={0.22}>
              <title>{`${c.parent.label} → ${c.label} : ${format(c.value)}`}</title>
            </path>
          )
        })}

        {/* ── Nœuds sources (labels à gauche) ── */}
        {placedSrc.map(s => (
          <g key={`src-${s.id}`}>
            <rect x={X_SRC} y={s.y} width={NODE_W} height={s.h} rx={3} fill={s.color}>
              <title>{`${s.label} : ${format(s.value)}`}</title>
            </rect>
            <text x={X_SRC - 10} y={s.y + s.h / 2 - 2} textAnchor="end" fontSize="12" fontWeight="600"
              fill="var(--text-primary)">{s.label}</text>
            <text x={X_SRC - 10} y={s.y + s.h / 2 + 12} textAnchor="end" fontSize="10.5"
              fill="var(--text-secondary)" style={{ fontVariantNumeric: "tabular-nums" }}>{format(s.value)}</text>
          </g>
        ))}

        {/* ── Hub ── */}
        <g>
          <rect x={X_HUB} y={hubY} width={NODE_W} height={hubH} rx={3} fill="var(--accent)">
            <title>{`${hubLabel} : ${format(totalIn)}`}</title>
          </rect>
          <text x={X_HUB + NODE_W / 2} y={hubY - 6} textAnchor="middle" fontSize="12" fontWeight="600"
            fill="var(--text-primary)">{hubLabel}</text>
        </g>

        {/* ── Nœuds emplois ── */}
        {placedUse.map(u => {
          const hasChildren = (u.children?.length ?? 0) > 0
          return (
            <g key={`use-${u.id}`}>
              <rect x={X_USE} y={u.y} width={NODE_W} height={u.h} rx={3} fill={u.color}>
                <title>{`${u.label} : ${format(u.value)}`}</title>
              </rect>
              {/* Si détail à droite : label au-dessus de la barre pour ne pas chevaucher les rubans */}
              <text x={hasChildren ? X_USE + NODE_W / 2 : X_USE + NODE_W + 10}
                y={hasChildren ? u.y - 5 : u.y + u.h / 2 - 2}
                textAnchor={hasChildren ? "middle" : "start"} fontSize="12" fontWeight="600"
                fill="var(--text-primary)">{u.label}</text>
              <text x={hasChildren ? X_USE + NODE_W / 2 : X_USE + NODE_W + 10}
                y={hasChildren ? u.y + u.h + 13 : u.y + u.h / 2 + 12}
                textAnchor={hasChildren ? "middle" : "start"} fontSize="10.5"
                fill="var(--text-secondary)" style={{ fontVariantNumeric: "tabular-nums" }}>{format(u.value)}</text>
            </g>
          )
        })}

        {/* ── Nœuds détail ── */}
        {children.map(c => (
          <g key={`leaf-${c.id}`}>
            <rect x={X_CHILD} y={c.y} width={NODE_W} height={c.h} rx={3} fill={c.color}>
              <title>{`${c.label} : ${format(c.value)}`}</title>
            </rect>
            <text x={X_CHILD + NODE_W + 8} y={c.y + c.h / 2 + 4} textAnchor="start" fontSize="11"
              fill="var(--text-primary)">
              {c.label} <tspan fill="var(--text-secondary)" fontSize="10" style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(c.value)}
              </tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
