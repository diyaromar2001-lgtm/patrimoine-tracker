"use client"

import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label:       string
  value:       string
  change?:     number
  changeLabel?: string
  icon:        LucideIcon
  iconColor?:  string
  loading?:    boolean
  index?:      number
}

export function StatCard({
  label,
  value,
  change,
  changeLabel = "vs hier",
  icon:    Icon,
  iconColor = "var(--accent)",
  loading   = false,
  index     = 0,
}: StatCardProps) {
  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0
  const isNeutral  = change === undefined || change === 0

  const changeColor = isPositive ? "var(--gain)" : isNegative ? "var(--loss)" : "var(--text-secondary)"
  const TrendIcon   = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="kpi-card group relative"
    >
      {/* Ambient glow on icon color */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 rounded-[14px]"
        style={{
          background: `radial-gradient(ellipse at top left, ${iconColor}08 0%, transparent 55%)`,
        }}
      />

      {loading ? (
        /* Skeleton */
        <div className="space-y-3">
          <div className="skeleton h-8 w-8 rounded-lg" />
          <div className="skeleton h-7 w-28 rounded-md" />
          <div className="skeleton h-4 w-20 rounded-md" />
        </div>
      ) : (
        <>
          {/* Top row: icon + badge */}
          <div className="flex items-start justify-between mb-4">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                backgroundColor: `${iconColor}15`,
                border: `1px solid ${iconColor}25`,
              }}
            >
              <Icon className="h-4 w-4" style={{ color: iconColor }} />
            </div>

            {/* Change badge */}
            {!isNeutral && change !== undefined && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{
                  backgroundColor: isPositive ? "var(--gain-muted)" : "var(--loss-muted)",
                  color: changeColor,
                  border: `1px solid ${isPositive ? "var(--gain-glow)" : "var(--loss-glow)"}`,
                }}
              >
                <TrendIcon className="h-2.5 w-2.5" />
                {isPositive ? "+" : ""}{change.toFixed(2)} %
              </span>
            )}
          </div>

          {/* Value */}
          <p
            className="text-2xl font-bold tabular-nums tracking-tight mb-1.5"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
          >
            {value}
          </p>

          {/* Label + trend text */}
          <div className="flex items-center gap-1.5">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {label}
            </p>
            {!isNeutral && change !== undefined && (
              <span className="text-[10px] font-medium" style={{ color: changeColor }}>
                {isPositive ? "▲" : "▼"} {changeLabel}
              </span>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
}
