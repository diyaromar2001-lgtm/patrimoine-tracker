"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: string
  children?: React.ReactNode
  /** Show an info icon instead of wrapping children */
  icon?: boolean
  className?: string
}

export function Tooltip({ content, children, icon = false, className }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const ref             = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={ref}
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {icon ? (
        <Info className="h-3 w-3 cursor-help" style={{ color: "var(--foreground-dim)" }} />
      ) : (
        children
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 w-56 rounded-xl border px-3 py-2.5 text-xs shadow-2xl pointer-events-none"
            style={{
              backgroundColor: "#1a1a1f",
              borderColor:      "var(--border)",
              color:            "var(--foreground-muted)",
              lineHeight:       1.5,
              boxShadow:        "0 8px 32px rgba(0,0,0,0.6)",
            }}
          >
            {content}
            {/* Arrow */}
            <div
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rotate-45 border-b border-r"
              style={{ backgroundColor: "#1a1a1f", borderColor: "var(--border)" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Tooltips définitions pour les métriques financières ─────────────────────

export const METRIC_TOOLTIPS = {
  alpha:
    "L'alpha mesure la surperformance par rapport au benchmark (S&P 500). Un alpha positif signifie que votre portefeuille a mieux performé que le marché sur la période.",

  beta:
    "Le bêta mesure la sensibilité du portefeuille aux mouvements du marché. Un bêta > 1 = plus volatil que le marché. Un bêta < 1 = moins volatil.",

  sharpe:
    "Le ratio de Sharpe mesure le rendement ajusté au risque. Plus il est élevé, mieux c'est. Au-dessus de 1 = bon, au-dessus de 2 = excellent.",

  yieldOnCost:
    "Le rendement sur coût (Yield on Cost) est le ratio dividendes annuels / coût d'achat total de la position. Il augmente si le dividende croît ou si vous avez acheté à un prix bas.",

  latentPnL:
    "La plus-value latente est la différence entre la valeur actuelle et le coût d'acquisition. Elle n'est réalisée que lors de la vente de l'actif.",

  dividendYield:
    "Le rendement sur dividende (Dividend Yield) est le ratio dividendes annuels / cours actuel de l'action. Il varie avec le cours de l'action.",

  allocation:
    "Le pourcentage d'allocation représente le poids de cet actif ou classe d'actifs dans la valeur totale du portefeuille.",

  cagr:
    "Le CAGR (Compound Annual Growth Rate) est le taux de croissance annuel composé. Il représente le taux de rendement annuel constant qui aurait conduit au même résultat final.",

  ytd:
    "YTD (Year to Date) : performance depuis le 1er janvier de l'année en cours.",
} as const
