"use client"

/**
 * PeriodSelector — sélecteur de période unifié (dashboard, cashflow, analyses).
 * Pilule active discrète, accessible clavier.
 */
export interface PeriodOption<T extends string = string> {
  value: T
  label: string
}

export function PeriodSelector<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: PeriodOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: "sm" | "md"
}) {
  return (
    <div
      role="tablist"
      aria-label="Période"
      className="period-selector inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--border)" }}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`period-btn rounded-md font-medium transition-colors ${size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"}`}
            style={{
              backgroundColor: active ? "var(--bg-subtle)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
