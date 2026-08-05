"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  LineChart, Wallet, PieChart, Settings2, Info, X,
  ArrowUpRight, TrendingUp, TrendingDown, Upload, Download, Trash2, Pencil, Plus,
} from "lucide-react"
import { PremiumChart, type PremiumChartPoint } from "@/components/charts/premium-chart"
import type { Portfolio, Asset, AppCurrency } from "@/lib/types"
import { ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from "@/lib/types"

/**
 * Portefeuille sur mobile — quatre écrans simples plutôt qu'une page unique.
 *
 * Chaque onglet répond à UNE question :
 *   Aperçu     → comment évolue mon portefeuille ?
 *   Positions  → qu'est-ce que je possède ?
 *   Analyses   → pourquoi il évolue comme ça ?
 *   Paramètres → comment le gérer ?
 *
 * Ce composant ne calcule aucune donnée métier : tout arrive en props, déjà
 * calculé par la page. Il ne décide que de la mise en scène.
 */

export const MOBILE_PERIODS = ["1J", "7J", "1M", "3M", "6M", "YTD", "1A", "Tout"] as const
export type MobilePeriod = (typeof MOBILE_PERIODS)[number]

/** Période affichée → période comprise par /api/portfolio-history. */
export const MOBILE_PERIOD_TO_API: Record<MobilePeriod, string> = {
  "1J": "1D", "7J": "1W", "1M": "1M", "3M": "3M",
  "6M": "6M", "YTD": "YTD", "1A": "1Y", "Tout": "MAX",
}

export interface MobilePortfolioProps {
  portfolio: Portfolio
  /** Historique déjà converti dans la devise d'affichage. */
  history:        PremiumChartPoint[]
  historyLoading: boolean
  period:         MobilePeriod
  onPeriodChange: (p: MobilePeriod) => void

  /** Valeurs déjà calculées par la page — aucune règle métier ici. */
  totalValue:     number
  investedValue:  number
  pnlValue:       number
  pnlPct:         number
  positionsCount: number
  cashValue:      number

  livePrices: Record<string, { price?: number; changePct?: number; originalPrice?: number; originalCurrency?: string }>
  format:  (v: number) => string
  currency: AppCurrency

  analytics: AnalyticsCard[]

  onAddTransaction: () => void
  onEdit:           () => void
  onDelete:         () => void
  onImport:         () => void
  onExport:         () => void
  onSellAsset:      (asset: Asset, price: number, currency: string) => void
}

export interface AnalyticsCard {
  key:    string
  label:  string
  value:  string
  hint?:  string
  /** Lignes du détail dépliable — vide quand la donnée manque. */
  rows:   Array<{ label: string; value: string; pct?: number; color?: string }>
  /** Message affiché quand `rows` est vide : on dit pourquoi, on n'invente pas. */
  empty?: string
}

type TabId = "apercu" | "positions" | "analyses" | "parametres"

const TABS: Array<{ id: TabId; label: string; icon: typeof LineChart }> = [
  { id: "apercu",     label: "Aperçu",     icon: LineChart },
  { id: "positions",  label: "Positions",  icon: Wallet },
  { id: "analyses",   label: "Analyses",   icon: PieChart },
  { id: "parametres", label: "Paramètres", icon: Settings2 },
]

export function MobilePortfolio(props: MobilePortfolioProps) {
  const [tab, setTab] = useState<TabId>("apercu")

  return (
    <div className="flex flex-col">
      {/* Barre d'onglets — collante : la navigation reste atteignable au pouce
          quel que soit le défilement. */}
      <div className="sticky top-0 z-20 border-b backdrop-blur"
        style={{ borderColor: "var(--border)", backgroundColor: "color-mix(in srgb, var(--bg-base) 88%, transparent)" }}>
        <div className="flex">
          {TABS.map(t => {
            const active = tab === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors"
                style={{ color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="text-[11px] font-medium">{t.label}</span>
                {active && (
                  <motion.span
                    layoutId="mobile-portfolio-tab"
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded-full"
                    style={{ backgroundColor: "var(--accent, #6366f1)" }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="p-4"
        >
          {tab === "apercu"     && <OverviewTab {...props} />}
          {tab === "positions"  && <PositionsTab {...props} />}
          {tab === "analyses"   && <AnalysesTab {...props} />}
          {tab === "parametres" && <SettingsTab {...props} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ─── 1. Aperçu ──────────────────────────────────────────────────────────────

function OverviewTab({
  portfolio, history, historyLoading, period, onPeriodChange,
  totalValue, investedValue, pnlValue, pnlPct, positionsCount, cashValue,
  format, onAddTransaction,
}: MobilePortfolioProps) {
  const [showInfo, setShowInfo] = useState(false)
  /** Point lu au doigt sur la courbe — remplace la valeur du jour. */
  const [scrub, setScrub] = useState<PremiumChartPoint | null>(null)

  // Variation SUR LA PÉRIODE affichée : c'est ce que la courbe montre.
  // Le P&L total (vs prix d'achat) reste sous le graphique.
  const periodChange = useMemo(() => {
    if (history.length < 2) return null
    const first = history[0].value
    const last  = history[history.length - 1].value
    if (!first) return null
    return { abs: last - first, pct: ((last - first) / first) * 100 }
  }, [history])

  const shown    = scrub?.value ?? totalValue
  const isGain   = (periodChange?.abs ?? pnlValue) >= 0
  const tone     = isGain ? "var(--gain, #22c55e)" : "var(--loss, #ef4444)"

  return (
    <div className="space-y-5">
      {/* En-tête : la question « combien ? » répondue en un coup d'œil */}
      <div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: portfolio.color }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{portfolio.name}</p>
          <button
            onClick={() => setShowInfo(true)}
            aria-label="Comment ces chiffres sont calculés"
            className="rounded-full p-1 transition-colors hover:bg-zinc-800"
            style={{ color: "var(--text-tertiary)" }}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="mt-1 text-[42px] font-bold leading-none tabular-nums tracking-tight"
          style={{ color: "var(--text-primary)" }}>
          {format(shown)}
        </p>

        {periodChange && (
          <div className="mt-2 flex items-center gap-2">
            {isGain ? <TrendingUp className="h-4 w-4" style={{ color: tone }} />
                    : <TrendingDown className="h-4 w-4" style={{ color: tone }} />}
            <span className="text-base font-semibold tabular-nums" style={{ color: tone }}>
              {periodChange.abs >= 0 ? "+" : ""}{format(periodChange.abs)}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums"
              style={{ backgroundColor: tone + "1e", color: tone }}>
              {periodChange.pct >= 0 ? "+" : ""}{periodChange.pct.toFixed(2)} %
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>sur {period}</span>
          </div>
        )}
      </div>

      {/* Le graphique occupe la place centrale, sans cadre qui l'enferme */}
      <PremiumChart
        data={history}
        height={230}
        loading={historyLoading}
        onScrub={setScrub}
        formatValue={format}
      />

      {/* Périodes */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {MOBILE_PERIODS.map(p => {
          const active = p === period
          return (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
              style={active
                ? { backgroundColor: "var(--accent, #6366f1)", color: "#fff" }
                : { color: "var(--text-tertiary)" }}
            >
              {p}
            </button>
          )
        })}
      </div>

      {/* Les six chiffres qui comptent — rien de plus */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Valeur actuelle" value={format(totalValue)} strong />
        <Stat label="Investi"         value={format(investedValue)} />
        <Stat label="Performance"     value={`${pnlValue >= 0 ? "+" : ""}${format(pnlValue)}`}
              tone={pnlValue >= 0 ? "gain" : "loss"} />
        <Stat label="Performance %"   value={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)} %`}
              tone={pnlPct >= 0 ? "gain" : "loss"} />
        <Stat label="Positions"       value={String(positionsCount)} />
        <Stat label="Liquidités"      value={format(cashValue)} />
      </div>

      <button
        onClick={onAddTransaction}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity active:opacity-80"
        style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}
      >
        <Plus className="h-4 w-4" /> Ajouter une transaction
      </button>

      <AnimatePresence>
        {showInfo && (
          <InfoSheet onClose={() => setShowInfo(false)}>
            <p><strong>Valeur actuelle</strong> — positions valorisées au dernier cours connu, converties dans ta devise d&apos;affichage.</p>
            <p><strong>Variation sur la période</strong> — écart entre le premier et le dernier point de la courbe. Elle ne tient pas compte des versements faits pendant la période.</p>
            <p><strong>Performance</strong> — écart entre la valeur actuelle et le montant réellement investi, frais inclus.</p>
            <p><strong>Liquidités</strong> — trésorerie propre à ce portefeuille, hors positions.</p>
            <p style={{ color: "var(--text-tertiary)" }}>La courbe applique tes quantités actuelles aux cours passés : elle montre l&apos;évolution des marchés, pas celle de tes versements.</p>
          </InfoSheet>
        )}
      </AnimatePresence>
    </div>
  )
}

function Stat({ label, value, tone, strong }: {
  label: string; value: string; tone?: "gain" | "loss"; strong?: boolean
}) {
  const color = tone === "gain" ? "var(--gain, #22c55e)"
              : tone === "loss" ? "var(--loss, #ef4444)"
              : "var(--text-primary)"
  return (
    <div className="rounded-xl border px-3.5 py-3"
      style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? "text-lg font-bold" : "text-base font-semibold"}`}
        style={{ color }}>
        {value}
      </p>
    </div>
  )
}

// ─── 2. Positions ───────────────────────────────────────────────────────────

function PositionsTab({ portfolio, livePrices, format, onSellAsset }: MobilePortfolioProps) {
  const rows = useMemo(() => {
    return portfolio.assets
      .filter(a => a.assetClass !== "cash" && a.quantity > 0)
      .map(a => {
        const live      = livePrices[a.ticker]
        const price     = live?.price ?? a.currentPrice
        const value     = price * a.quantity
        const dayPct    = live?.changePct ?? 0
        const dayAbs    = value * dayPct / 100
        return { asset: a, value, dayPct, dayAbs, live }
      })
      .sort((x, y) => y.value - x.value)
  }, [portfolio.assets, livePrices])

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12"
        style={{ borderColor: "var(--border)" }}>
        <Wallet className="h-6 w-6" style={{ color: "var(--text-tertiary)" }} />
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Aucune position ouverte</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
        {rows.length} position{rows.length > 1 ? "s" : ""}
      </p>
      <div className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        {rows.map(({ asset, value, dayPct, dayAbs, live }, i) => {
          const tone  = dayPct >= 0 ? "var(--gain, #22c55e)" : "var(--loss, #ef4444)"
          const color = ASSET_CLASS_COLORS[asset.assetClass]
          return (
            <div key={asset.id} className="flex items-center"
              style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
              <Link
                href={`/assets/${encodeURIComponent(asset.ticker)}`}
                className="flex flex-1 items-center gap-3 px-4 py-3.5 min-w-0 active:opacity-70"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-[11px] font-bold"
                  style={{ backgroundColor: color + "1e", color }}>
                  {asset.ticker.slice(0, 3)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {asset.name}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {asset.ticker} · {ASSET_CLASS_LABELS[asset.assetClass]}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {format(value)}
                  </p>
                  <p className="text-[11px] font-medium tabular-nums" style={{ color: tone }}>
                    {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)} % · {dayAbs >= 0 ? "+" : ""}{format(dayAbs)}
                  </p>
                </div>
              </Link>
              <button
                onClick={() => onSellAsset(asset, live?.originalPrice ?? live?.price ?? asset.currentPrice,
                                           live?.originalCurrency ?? asset.currency)}
                aria-label={`Vendre ${asset.ticker}`}
                className="mr-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors active:bg-green-500/20"
                style={{ color: "var(--gain, #22c55e)" }}
              >
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 3. Analyses ────────────────────────────────────────────────────────────

function AnalysesTab({ analytics }: MobilePortfolioProps) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {analytics.map(card => {
        const isOpen = open === card.key
        return (
          <div key={card.key} className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <button
              onClick={() => setOpen(isOpen ? null : card.key)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{card.label}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {card.value}
                </p>
                {card.hint && (
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{card.hint}</p>
                )}
              </div>
              <motion.span animate={{ rotate: isOpen ? 90 : 0 }} className="flex-shrink-0"
                style={{ color: "var(--text-tertiary)" }}>
                ›
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 border-t px-4 py-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                    {card.rows.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {card.empty ?? "Donnée non disponible pour ce portefeuille."}
                      </p>
                    ) : card.rows.map(r => (
                      <div key={r.label}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>{r.label}</span>
                          <span className="flex-shrink-0 text-xs font-semibold tabular-nums"
                            style={{ color: "var(--text-primary)" }}>{r.value}</span>
                        </div>
                        {r.pct != null && (
                          <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--border)" }}>
                            <div className="h-full rounded-full"
                              style={{ width: `${Math.min(Math.max(r.pct, 0), 100)}%`,
                                       backgroundColor: r.color ?? "var(--accent, #6366f1)" }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

// ─── 4. Paramètres ──────────────────────────────────────────────────────────

function SettingsTab({ portfolio, currency, onEdit, onDelete, onImport, onExport }: MobilePortfolioProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border px-4 py-3.5"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Portefeuille</p>
        <p className="mt-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>{portfolio.name}</p>
        {portfolio.description && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>{portfolio.description}</p>
        )}
        <div className="mt-3 flex gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span>Devise du portefeuille · <strong style={{ color: "var(--text-primary)" }}>{portfolio.currency}</strong></span>
          <span>Affichage · <strong style={{ color: "var(--text-primary)" }}>{currency}</strong></span>
        </div>
      </div>

      <Group title="Gestion">
        <Row icon={Pencil}   label="Modifier le portefeuille" onClick={onEdit} />
        <Row icon={Upload}   label="Importer un relevé"       onClick={onImport} />
        <Row icon={Download} label="Exporter en CSV"          onClick={onExport} />
      </Group>

      <Group title="Zone sensible">
        <Row icon={Trash2} label="Supprimer le portefeuille" onClick={onDelete} danger />
      </Group>

      <p className="px-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        La devise d&apos;affichage se change depuis l&apos;en-tête de l&apos;application : elle
        s&apos;applique à toutes les pages, pas à ce seul portefeuille.
      </p>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
        {title}
      </p>
      <div className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        {children}
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, onClick, danger }: {
  icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean
}) {
  const color = danger ? "var(--loss, #ef4444)" : "var(--text-primary)"
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-zinc-800/40"
      style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <Icon className="h-4 w-4 flex-shrink-0" style={{ color }} />
      <span className="flex-1 text-sm" style={{ color }}>{label}</span>
      <span style={{ color: "var(--text-tertiary)" }}>›</span>
    </button>
  )
}

// ─── Feuille d'information ──────────────────────────────────────────────────

function InfoSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="w-full rounded-t-2xl border-t p-5 pb-8"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            D&apos;où viennent ces chiffres
          </p>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: "var(--text-tertiary)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}
