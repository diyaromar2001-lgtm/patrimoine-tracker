import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface ChangeBadgeProps {
  value:    number
  suffix?:  string
  className?: string
  showIcon?: boolean
  size?:    "sm" | "md"
}

export function ChangeBadge({
  value,
  suffix    = "%",
  className,
  showIcon  = true,
  size      = "sm",
}: ChangeBadgeProps) {
  const isPos = value > 0
  const isNeg = value < 0
  const Icon  = isPos ? TrendingUp : isNeg ? TrendingDown : Minus

  const color  = isPos ? "var(--gain)"  : isNeg ? "var(--loss)"  : "var(--text-secondary)"
  const bgCol  = isPos ? "var(--gain-muted)" : isNeg ? "var(--loss-muted)" : "var(--bg-muted)"
  const border = isPos ? "var(--gain-glow)"  : isNeg ? "var(--loss-glow)"  : "var(--border)"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold tabular-nums",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className
      )}
      style={{ backgroundColor: bgCol, color, border: `1px solid ${border}` }}
    >
      {showIcon && <Icon className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />}
      {isPos ? "+" : ""}{Math.abs(value).toFixed(2)}{suffix}
    </span>
  )
}

interface AssetClassBadgeProps {
  label: string
  color: string
}

export function AssetClassBadge({ label, color }: AssetClassBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: `${color}15`,
        color,
        border: `1px solid ${color}25`,
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </span>
  )
}

interface StatusBadgeProps {
  status: "upcoming" | "paid" | "active" | "inactive"
}

const STATUS_MAP = {
  upcoming: { label: "À venir",  color: "#f59e0b", bg: "#f59e0b15", border: "#f59e0b25" },
  paid:     { label: "Versé",    color: "#22c55e", bg: "#22c55e15", border: "#22c55e25" },
  active:   { label: "Actif",    color: "#22c55e", bg: "#22c55e15", border: "#22c55e25" },
  inactive: { label: "Inactif",  color: "#64748b", bg: "#64748b15", border: "#64748b25" },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const s = STATUS_MAP[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
      {s.label}
    </span>
  )
}
