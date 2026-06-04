"use client"

import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react"
import { generateInsights } from "@/lib/finance"
import type { AssetInput } from "@/lib/finance"

const META = {
  warning: { icon: AlertTriangle, color: "#f59e0b" },
  success: { icon: CheckCircle2, color: "#22c55e" },
  info:    { icon: Info,          color: "#3b82f6" },
  tip:     { icon: Lightbulb,     color: "#a78bfa" },
}

export function InsightsWidget({ assets, className }: { assets: AssetInput[]; className?: string }) {
  const insights = useMemo(() => generateInsights(assets), [assets])
  if (!insights.length) return null

  return (
    <div className={className}>
      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
        <Lightbulb className="h-3 w-3" style={{ color: "#a78bfa" }} />
        Insights
      </p>
      {/* Compact badge grid */}
      <div className="flex flex-wrap gap-2">
        {insights.slice(0, 6).map((ins, i) => {
          const { icon: Icon, color } = META[ins.type]
          return (
            <div key={i}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
              style={{ backgroundColor: color + "12", borderColor: color + "30", color: "var(--text-secondary)" }}
              title={ins.message}
            >
              <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />
              <span className="font-medium" style={{ color }}>{ins.title}</span>
              <span className="hidden sm:inline truncate max-w-48">{ins.message}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
