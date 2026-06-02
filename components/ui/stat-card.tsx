"use client"

import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string
  change?: number       // percentage change
  changeLabel?: string  // e.g. "aujourd'hui"
  icon: LucideIcon
  iconColor?: string
  loading?: boolean
  index?: number        // for stagger animation
}

export function StatCard({
  label,
  value,
  change,
  changeLabel = "vs hier",
  icon: Icon,
  iconColor = "#3b82f6",
  loading = false,
  index = 0,
}: StatCardProps) {
  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0
  const isNeutral  = change === undefined || change === 0

  const changeColor = isPositive
    ? "var(--gain)"
    : isNegative
    ? "var(--loss)"
    : "var(--foreground-muted)"

  const ChangeBadgeBg = isPositive
    ? "var(--gain-muted)"
    : isNegative
    ? "var(--loss-muted)"
    : "var(--background-hover)"

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: "easeOut" }}
      className="group relative overflow-hidden rounded-xl border p-3 sm:p-5 transition-colors duration-200"
      style={{
        backgroundColor: "var(--background-card)",
        borderColor: "var(--border)",
      }}
    >
      {/* Subtle gradient on hover */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 rounded-xl"
        style={{
          background: `radial-gradient(ellipse at top left, ${iconColor}0a 0%, transparent 60%)`,
        }}
      />

      <div className="relative flex items-start justify-between gap-4">
        {/* Icon */}
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${iconColor}18` }}
        >
          <Icon className="h-4.5 w-4.5" style={{ color: iconColor }} />
        </div>

        {/* Change badge */}
        {!isNeutral && change !== undefined && (
          <div
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
            style={{
              backgroundColor: ChangeBadgeBg,
              color: changeColor,
            }}
          >
            <TrendIcon className="h-3 w-3" />
            {isPositive ? "+" : ""}{change.toFixed(2)}%
          </div>
        )}
      </div>

      <div className="relative mt-4 space-y-1">
        {loading ? (
          <>
            <div className="h-7 w-32 animate-pulse rounded-md bg-zinc-800" />
            <div className="h-4 w-24 animate-pulse rounded-md bg-zinc-800/60" />
          </>
        ) : (
          <>
            <p
              className="text-lg sm:text-2xl font-bold tracking-tight tabular-nums"
              style={{ color: "var(--foreground)" }}
            >
              {value}
            </p>
            <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
              {label}
              {change !== undefined && (
                <span
                  className={cn("ml-1.5 font-medium", isNeutral && "hidden")}
                  style={{ color: changeColor }}
                >
                  {isPositive ? "▲" : "▼"} {changeLabel}
                </span>
              )}
            </p>
          </>
        )}
      </div>
    </motion.div>
  )
}
