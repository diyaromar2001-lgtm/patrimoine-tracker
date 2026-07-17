"use client"

import type { ReactNode } from "react"
import { ChangeBadge } from "./badge"

/**
 * MetricCard — carte KPI unifiée du design system.
 * Remplace les blocs KPI dupliqués dans dashboard / portfolios / cashflow.
 */
export function MetricCard({
  label,
  value,
  icon,
  iconColor = "var(--accent)",
  changePct,
  sub,
  valueColor = "var(--text-primary)",
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  iconColor?: string
  /** Si fourni, affiche un ChangeBadge (+x % / −x %). */
  changePct?: number
  /** Ligne secondaire discrète sous la valeur. */
  sub?: ReactNode
  valueColor?: string
}) {
  return (
    <div className="kpi-card">
      <div className="mb-2 flex items-center gap-2">
        {icon && <span className="flex-shrink-0" style={{ color: iconColor }}>{icon}</span>}
        <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: valueColor }}>
          {value}
        </p>
        {changePct != null && Number.isFinite(changePct) && (
          <ChangeBadge value={changePct} showIcon={false} />
        )}
      </div>
      {sub && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{sub}</p>
      )}
    </div>
  )
}
