"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react"
import { generateInsights, type Insight } from "@/lib/finance"
import type { AssetInput } from "@/lib/finance"

const ICONS = {
  warning: AlertTriangle,
  success: CheckCircle2,
  info:    Info,
  tip:     Lightbulb,
}
const COLORS = {
  warning: { bg: "#f59e0b18", border: "#f59e0b40", icon: "#f59e0b", text: "#f59e0b" },
  success: { bg: "#22c55e18", border: "#22c55e40", icon: "#22c55e", text: "#22c55e" },
  info:    { bg: "#3b82f618", border: "#3b82f640", icon: "#3b82f6", text: "#3b82f6" },
  tip:     { bg: "#a78bfa18", border: "#a78bfa40", icon: "#a78bfa", text: "#a78bfa" },
}

interface InsightsWidgetProps {
  assets: AssetInput[]
  className?: string
}

export function InsightsWidget({ assets, className }: InsightsWidgetProps) {
  const insights = useMemo(() => generateInsights(assets), [assets])

  if (!insights.length) return null

  return (
    <div className={className}>
      <p className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--foreground-muted)" }}>
        <Lightbulb className="h-3.5 w-3.5" style={{ color: "#a78bfa" }} />
        Insights automatiques
      </p>
      <div className="space-y-2">
        {insights.map((ins, i) => {
          const Icon  = ICONS[ins.type]
          const color = COLORS[ins.type]
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex items-start gap-3 rounded-xl border px-4 py-3"
              style={{ backgroundColor: color.bg, borderColor: color.border }}
            >
              <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: color.icon }} />
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: color.text }}>{ins.title}</p>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
                  {ins.message}
                </p>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
