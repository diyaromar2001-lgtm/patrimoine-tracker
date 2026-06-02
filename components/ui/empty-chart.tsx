"use client"

import { motion } from "framer-motion"
import { BarChart2 } from "lucide-react"

interface EmptyChartProps {
  title?: string
  description?: string
  height?: number
}

export function EmptyChart({
  title = "Aucune donnée disponible",
  description = "Ajoutez vos actifs pour voir l'évolution de votre patrimoine",
  height = 220,
}: EmptyChartProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border"
      style={{
        height,
        backgroundColor: "var(--background-card)",
        borderColor: "var(--border)",
        borderStyle: "dashed",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col items-center gap-3"
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ backgroundColor: "var(--background-hover)" }}
        >
          <BarChart2 className="h-6 w-6" style={{ color: "var(--foreground-dim)" }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: "var(--foreground-muted)" }}>
            {title}
          </p>
          <p className="mt-0.5 max-w-xs text-xs" style={{ color: "var(--foreground-dim)" }}>
            {description}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
