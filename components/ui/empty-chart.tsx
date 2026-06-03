"use client"

import { motion } from "framer-motion"
import { BarChart2 } from "lucide-react"

interface EmptyChartProps {
  title?:       string
  description?: string
  height?:      number
}

export function EmptyChart({
  title       = "Aucune donnée disponible",
  description = "Ajoutez des actifs pour afficher l'évolution de votre portefeuille",
  height      = 220,
}: EmptyChartProps) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        height,
        background:   "var(--bg-elevated)",
        border:       "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-3"
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: "var(--bg-muted)", border: "1px solid var(--border)" }}
        >
          <BarChart2 className="h-5 w-5" style={{ color: "var(--text-tertiary)" }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {title}
          </p>
          <p className="mt-1 max-w-xs text-xs" style={{ color: "var(--text-tertiary)" }}>
            {description}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
