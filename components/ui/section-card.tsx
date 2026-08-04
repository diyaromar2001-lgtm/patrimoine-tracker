"use client"

import type { ReactNode } from "react"

/**
 * SectionCard — carte de contenu du design system.
 *
 * Unifie ce qui était réécrit à la main sur chaque page : même rayon, même
 * bordure, même en-tête (titre + sous-titre discret + action à droite).
 *
 * `padded={false}` pour les contenus qui gèrent leur propre gouttière
 * (listes, tableaux) et doivent toucher les bords de la carte.
 */
export function SectionCard({
  title,
  description,
  action,
  children,
  padded = true,
  className = "",
}: {
  title?: string
  description?: string
  /** Lien ou bouton aligné à droite du titre. */
  action?: ReactNode
  children: ReactNode
  padded?: boolean
  className?: string
}) {
  const hasHeader = Boolean(title || action)

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${className}`}
      style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      {hasHeader && (
        <div
          className="flex items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </div>
  )
}
