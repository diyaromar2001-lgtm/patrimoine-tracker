import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface ChangeBadgeProps {
  value: number
  suffix?: string
  className?: string
  showIcon?: boolean
  size?: "sm" | "md"
}

export function ChangeBadge({
  value,
  suffix = "%",
  className,
  showIcon = true,
  size = "sm",
}: ChangeBadgeProps) {
  const isPos = value > 0
  const isNeg = value < 0
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium tabular-nums",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
      style={{
        backgroundColor: isPos
          ? "var(--gain-muted)"
          : isNeg
          ? "var(--loss-muted)"
          : "var(--background-hover)",
        color: isPos
          ? "var(--gain)"
          : isNeg
          ? "var(--loss)"
          : "var(--foreground-muted)",
      }}
    >
      {showIcon && <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />}
      {isPos ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
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
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${color}18`,
        color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

interface StatusBadgeProps {
  status: "upcoming" | "paid" | "active" | "inactive"
}

const STATUS_MAP = {
  upcoming: { label: "À venir", color: "#f59e0b", bg: "#f59e0b18" },
  paid: { label: "Versé", color: "#22c55e", bg: "#22c55e18" },
  active: { label: "Actif", color: "#22c55e", bg: "#22c55e18" },
  inactive: { label: "Inactif", color: "#6b7280", bg: "#6b728018" },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const s = STATUS_MAP[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
      {s.label}
    </span>
  )
}
