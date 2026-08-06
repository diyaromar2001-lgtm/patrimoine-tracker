"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CalendarDays, CheckCircle2, CircleDashed } from "lucide-react"
import {
  FREQUENCY_LABELS,
  type ProjectedDividend, type DividendFrequency,
} from "@/lib/dividend-engine"

interface UpcomingCalendarProps {
  months: Array<{ month: string; total: number; items: ProjectedDividend[]; confirmed: boolean }>
  format: (v: number) => string
}

const MONTH_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]

function monthLabel(month: string) {
  const [y, m] = month.split("-")
  return `${MONTH_SHORT[Number(m) - 1]} ${y.slice(2)}`
}

function fullMonthLabel(month: string) {
  const d = new Date(month + "-01T00:00:00Z")
  return d.toLocaleDateString("fr-CH", { month: "long", year: "numeric" })
}

/**
 * Calendrier des versements à venir, sur douze mois.
 *
 * Deux natures de prévision cohabitent et ne doivent surtout pas se
 * confondre : une ex-date déjà publiée par l'émetteur, et une date
 * extrapolée du rythme passé. Le trait plein contre le trait pointillé porte
 * cette distinction, et chaque ligne du détail la répète en toutes lettres.
 */
export function UpcomingCalendar({ months, format }: UpcomingCalendarProps) {
  const [open, setOpen] = useState<string | null>(null)

  if (!months.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10"
        style={{ borderColor: "var(--border)" }}>
        <CalendarDays className="h-6 w-6" style={{ color: "var(--text-tertiary)" }} />
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Aucun versement projeté sur les douze prochains mois.
        </p>
        <p className="max-w-sm text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
          Il faut au moins trois versements passés sur une ligne encore détenue
          pour en déduire un rythme.
        </p>
      </div>
    )
  }

  const max = Math.max(...months.map(m => m.total), 1)
  const total12 = months.reduce((s, m) => s + m.total, 0)

  return (
    <div className="space-y-4">
      {/* Total attendu — la réponse à « combien vais-je toucher cette année ? » */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--gain)" }}>
            ≈ {format(total12)}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            attendus sur 12 mois · {months.length} mois avec versement
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--gain)" }} />
            Date confirmée
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed"
              style={{ borderColor: "var(--gain)", backgroundColor: "transparent" }} />
            Estimée
          </span>
        </div>
      </div>

      {/* Douze colonnes cliquables */}
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
        {months.map(m => {
          const active = open === m.month
          const h = Math.max((m.total / max) * 100, 6)
          return (
            <button
              key={m.month}
              onClick={() => setOpen(active ? null : m.month)}
              className="group flex min-w-[46px] flex-1 flex-col items-center gap-1.5"
              title={`${fullMonthLabel(m.month)} — ${format(m.total)}`}
            >
              <span className="text-[10px] tabular-nums transition-colors"
                style={{ color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                {m.total >= 1 ? Math.round(m.total) : m.total.toFixed(1)}
              </span>
              <div className="flex h-24 w-full items-end">
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${h}%`,
                    backgroundColor: m.confirmed ? "var(--gain)" : "transparent",
                    border: m.confirmed ? "none" : "1px dashed var(--gain)",
                    opacity: active ? 1 : 0.75,
                  }}
                />
              </div>
              <span className="text-[10px] font-medium transition-colors"
                style={{ color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                {monthLabel(m.month)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Détail du mois choisi */}
      <AnimatePresence initial={false}>
        {open && (() => {
          const m = months.find(x => x.month === open)
          if (!m) return null
          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between border-b px-4 py-2.5"
                  style={{ borderColor: "var(--border)" }}>
                  <p className="text-sm font-semibold capitalize" style={{ color: "var(--text-primary)" }}>
                    {fullMonthLabel(m.month)}
                  </p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: "var(--gain)" }}>
                    ≈ {format(m.total)}
                  </p>
                </div>

                <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {m.items.map((it, i) => (
                    <div key={`${it.ticker}-${it.exDate}-${i}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {it.confirmed
                          ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--gain)" }} />
                          : <CircleDashed className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-tertiary)" }} />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            {it.ticker}
                          </p>
                          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                            ex-date {it.exDate} · {FREQUENCY_LABELS[it.frequency as DividendFrequency]}
                            {!it.confirmed && " · date estimée"}
                          </p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                          ≈ {format(it.amount)}
                        </p>
                        <p className="text-[11px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                          {it.quantityHeld.toFixed(2).replace(/\.?0+$/, "")} × {it.amountPerShare.toFixed(4)} {it.nativeCurrency}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="border-t px-4 py-2.5 text-[11px]" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
                  Montants calculés sur ta quantité actuelle et le dernier dividende connu.
                  Aucune croissance n&apos;est supposée : une hausse du dividende ne s&apos;y voit pas.
                </p>
              </div>
            </motion.div>
          )
        })()}
      </AnimatePresence>
    </div>
  )
}
