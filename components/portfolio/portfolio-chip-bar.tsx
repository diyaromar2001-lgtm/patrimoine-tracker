"use client"

import { useEffect, useRef } from "react"
import { Plus } from "lucide-react"
import type { Portfolio } from "@/lib/types"

/** Hauteur fixe de la barre — la barre d'onglets se cale dessous. */
export const CHIP_BAR_HEIGHT = 52

interface PortfolioChipBarProps {
  portfolios: Portfolio[]
  /** "global" pour la vue agrégée, sinon l'id du portefeuille. */
  activeId:   string
  onSelect:   (id: string) => void
  onCreate:   () => void
}

/**
 * Sélection du portefeuille par pastilles défilantes.
 *
 * Une barre toujours visible vaut mieux qu'un menu à ouvrir : le choix reste
 * sous les yeux et à un seul appui, ce qui compte quand on compare deux
 * portefeuilles. Le défilement est calé sur les pastilles (scroll-snap) pour
 * qu'aucune ne s'arrête coupée en deux.
 */
export function PortfolioChipBar({ portfolios, activeId, onSelect, onCreate }: PortfolioChipBarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const activeRef   = useRef<HTMLButtonElement>(null)

  // Ramène la pastille active dans le champ de vision : sans cela, le
  // portefeuille sélectionné peut rester hors écran après un rechargement.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }, [activeId])

  return (
    <div
      className="sticky top-0 z-30 border-b backdrop-blur"
      style={{
        height: CHIP_BAR_HEIGHT,
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
      }}
    >
      <div
        ref={scrollerRef}
        className="flex h-full items-center gap-2 overflow-x-auto px-3"
        style={{ scrollSnapType: "x proximity", scrollbarWidth: "none" }}
      >
        <Chip
          ref={activeId === "global" ? activeRef : undefined}
          label="Tous"
          active={activeId === "global"}
          onClick={() => onSelect("global")}
        />

        {portfolios.map(p => (
          <Chip
            key={p.id}
            ref={activeId === p.id ? activeRef : undefined}
            label={p.name}
            color={p.color}
            active={activeId === p.id}
            onClick={() => onSelect(p.id)}
          />
        ))}

        <button
          onClick={onCreate}
          aria-label="Nouveau portefeuille"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border transition-colors active:opacity-70"
          style={{ borderColor: "var(--border)", color: "var(--text-tertiary)", scrollSnapAlign: "end" }}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <style jsx>{`
        div::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  )
}

interface ChipProps {
  label:   string
  active:  boolean
  onClick: () => void
  color?:  string
  ref?:    React.Ref<HTMLButtonElement>
}

function Chip({ label, active, onClick, color, ref }: ChipProps) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className="flex max-w-[190px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-[0.97]"
      style={{
        scrollSnapAlign: "center",
        // L'actif est plein et contrasté ; les autres restent discrets pour
        // qu'on repère la sélection sans lire les libellés.
        backgroundColor: active ? "var(--accent, #6366f1)" : "var(--bg-elevated)",
        borderColor:     active ? "var(--accent, #6366f1)" : "var(--border)",
        color:           active ? "#fff" : "var(--text-secondary)",
      }}
    >
      {color && (
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: active ? "rgba(255,255,255,0.85)" : color }}
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  )
}
