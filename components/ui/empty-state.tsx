"use client"

import type { ReactNode } from "react"

/**
 * EmptyState — état vide unifié (aucune donnée / historique insuffisant).
 * Jamais de valeur fictive : un message clair + une action utile.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode
  title: string
  description?: string
  /** Bouton/CTA optionnel (ex. « Importer un CSV »). */
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-8 px-4" : "py-14 px-6"}`}>
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: "var(--bg-muted)", color: "var(--text-tertiary)" }}>
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
