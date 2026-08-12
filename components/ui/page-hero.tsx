"use client"

import type { ReactNode } from "react"
import { motion } from "framer-motion"

/**
 * PageHero — en-tête de page du design system.
 *
 * Encode la hiérarchie établie sur le tableau de bord :
 *   label discret en capitales → chiffre dominant → chiffres secondaires
 *   en grille aérée (jamais une ligne dense séparée par des barres).
 *
 * Règles de couleur : vert/rouge réservés aux gains et pertes, indigo à la
 * marque. Un chiffre neutre reste en --text-primary.
 */

export interface HeroStat {
  label: string
  value: ReactNode
  /** Couleur de la valeur — omettre pour un chiffre neutre. */
  color?: string
  /** Infobulle facultative (détail du calcul). */
  title?: string
}

export function PageHero({
  label,
  value,
  badge,
  stats = [],
  actions,
  /** Teinte de l'halo d'ambiance ; omettre pour un héro neutre. */
  glow,
}: {
  label: string
  value: ReactNode
  badge?: ReactNode
  stats?: HeroStat[]
  actions?: ReactNode
  glow?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border px-6 pt-8 pb-7 sm:px-8"
      style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)", boxShadow: "var(--shadow-md)" }}
    >
      {glow && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(ellipse 60% 50% at 80% 50%, ${glow}08, transparent)` }}
        />
      )}

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3 min-w-0">
          <p className="data-label">{label}</p>

          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="hero-value text-5xl sm:text-[3.4rem] font-bold tabular-nums leading-none"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.03em" }}
            >
              {value}
            </span>
            {badge}
          </div>

          {stats.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-10 gap-y-3 pt-2">
              {stats.map(s => (
                <div key={s.label} title={s.title}>
                  <p className="data-label">{s.label}</p>
                  <p className="data-value mt-1 text-[15px] font-semibold"
                    style={{ color: s.color ?? "var(--text-primary)" }}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </motion.div>
  )
}
