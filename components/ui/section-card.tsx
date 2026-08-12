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
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {hasHeader && (
        // Pas de trait de séparation : la carte se détache déjà du fond, et
        // un filet sous chaque titre rajoutait une ligne à lire pour rien.
        // C'est l'espacement qui sépare l'en-tête du contenu.
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={padded ? (hasHeader ? "px-5 pb-5" : "p-5") : ""}>{children}</div>
    </div>
  )
}
