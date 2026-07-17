"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { useLivePrices } from "@/hooks/use-live-prices"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricCard } from "@/components/ui/metric-card"
import { ChangeBadge } from "@/components/ui/badge"
import type { AppCurrency } from "@/lib/utils"
import { ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from "@/lib/types"
import {
  PieChart, ShieldAlert, Globe2, Factory, Banknote, Receipt,
  BarChart2, ArrowRight, Layers,
} from "lucide-react"

const BAR_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#eab308", "#64748b"]

/** Barres horizontales de répartition — composant local réutilisé par section. */
function ExposureBars({ data, format }: {
  data: Array<{ label: string; value: number; pct: number; color?: string }>
  format: (v: number) => string
}) {
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={d.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{d.label}</span>
            <span className="flex-shrink-0 text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              {format(d.value)} · <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{d.pct.toFixed(1)} %</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, d.pct)}%`, backgroundColor: d.color ?? BAR_COLORS[i % BAR_COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AnalysesPage() {
  const { portfolios, transactions } = useAppData()
  const { format, convert, fxRates, currency } = useCurrency()

  const allAssets = useMemo(() => portfolios.flatMap(p => p.assets).filter(a => a.assetClass !== "cash"), [portfolios])
  const tickers = useMemo(() => allAssets.map(a => a.ticker), [allAssets])
  const { prices: livePrices } = useLivePrices(tickers, 60_000)

  // Valeur de chaque position en devise d'affichage (prix live sinon coût converti)
  const positions = useMemo(() =>
    allAssets
      .map(a => ({
        ...a,
        displayValue: (livePrices[a.ticker]?.price ?? convert(a.currentPrice, (a.currency ?? "CHF") as AppCurrency)) * a.quantity,
        priceIsStale: livePrices[a.ticker] == null,
        pnlPct: (() => {
          const orig = livePrices[a.ticker]?.originalPrice
          return orig != null && a.avgBuyPrice > 0 ? ((orig - a.avgBuyPrice) / a.avgBuyPrice) * 100 : null
        })(),
      }))
      .filter(p => p.displayValue > 0)
      .sort((a, b) => b.displayValue - a.displayValue),
    [allAssets, livePrices, convert]
  )

  const totalValue = useMemo(() => positions.reduce((s, p) => s + p.displayValue, 0), [positions])

  // Agrégation générique par champ
  const groupBy = (getKey: (p: typeof positions[number]) => string) => {
    const map: Record<string, number> = {}
    for (const p of positions) {
      const k = getKey(p)
      map[k] = (map[k] ?? 0) + p.displayValue
    }
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([label, value]) => ({ label, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
  }

  const byClass    = useMemo(() => groupBy(p => ASSET_CLASS_LABELS[p.assetClass as keyof typeof ASSET_CLASS_LABELS] ?? p.assetClass)
    .map((d, i) => ({ ...d, color: Object.values(ASSET_CLASS_COLORS)[i] })), [positions, totalValue]) // eslint-disable-line
  const bySector   = useMemo(() => groupBy(p => p.sector?.trim() && p.sector !== "-" ? p.sector : "Non renseigné"), [positions, totalValue]) // eslint-disable-line
  const byCountry  = useMemo(() => groupBy(p => p.country?.trim() && p.country !== "-" ? p.country : "Non renseigné"), [positions, totalValue]) // eslint-disable-line
  const byCurrency = useMemo(() => groupBy(p => livePrices[p.ticker]?.originalCurrency ?? p.currency ?? "CHF"), [positions, totalValue, livePrices]) // eslint-disable-line

  // Frais cumulés (historiques, en devise d'affichage)
  const totalFees = useMemo(() => {
    const ur = (fxRates as Record<string, number>)[currency] ?? 1
    return transactions.reduce((s, t) => s + ((t.feesChf ?? 0) * ur), 0)
  }, [transactions, fxRates, currency])

  // Alertes de concentration (règles simples et transparentes)
  const alerts = useMemo(() => {
    const out: string[] = []
    if (totalValue <= 0) return out
    const top1 = positions[0]
    if (top1 && top1.displayValue / totalValue > 0.25)
      out.push(`${top1.ticker} représente ${(top1.displayValue / totalValue * 100).toFixed(0)} % du portefeuille — envisagez de diversifier.`)
    const top3 = positions.slice(0, 3).reduce((s, p) => s + p.displayValue, 0)
    if (positions.length >= 3 && top3 / totalValue > 0.6)
      out.push(`Vos 3 plus grosses positions pèsent ${(top3 / totalValue * 100).toFixed(0)} % du portefeuille.`)
    if (byCurrency[0] && byCurrency[0].pct > 80)
      out.push(`${byCurrency[0].pct.toFixed(0)} % du portefeuille est exposé à la devise ${byCurrency[0].label}.`)
    const unknownSector = bySector.find(s => s.label === "Non renseigné")
    if (unknownSector && unknownSector.pct > 50)
      out.push(`Le secteur de ${unknownSector.pct.toFixed(0)} % du portefeuille n'est pas renseigné — complétez les fiches actifs pour une analyse sectorielle fiable.`)
    return out.slice(0, 3)
  }, [positions, totalValue, byCurrency, bySector])

  const hasData = positions.length > 0

  return (
    <div className="flex flex-col">
      <Topbar title="Analyses" subtitle="Diversification, expositions et risque" />
      <div className="flex-1 space-y-6 p-4 sm:p-6 max-w-7xl mx-auto w-full">

        {!hasData ? (
          <div className="rounded-2xl border" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <EmptyState
              icon={<PieChart className="h-5 w-5" />}
              title="Aucune position à analyser"
              description="Ajoutez des positions ou importez un CSV Trading 212 depuis la page Portefeuilles pour voir vos expositions."
              action={
                <Link href="/portfolios" className="btn-primary">
                  Aller aux portefeuilles <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </div>
        ) : (
          <>
            {/* ── KPIs ── */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Valeur des positions" value={format(totalValue)}
                icon={<BarChart2 className="h-4 w-4" />} />
              <MetricCard label="Positions" value={positions.length}
                sub={`${byClass.length} classe${byClass.length > 1 ? "s" : ""} d'actifs`}
                icon={<Layers className="h-4 w-4" />} />
              <MetricCard label="Plus grosse position"
                value={`${positions[0].ticker} · ${(positions[0].displayValue / totalValue * 100).toFixed(1)} %`}
                icon={<ShieldAlert className="h-4 w-4" />}
                iconColor={positions[0].displayValue / totalValue > 0.25 ? "#f59e0b" : "var(--accent)"} />
              <MetricCard label="Frais cumulés" value={`−${format(totalFees)}`}
                sub="tous frais de transaction historiques"
                icon={<Receipt className="h-4 w-4" />} iconColor="#f59e0b" />
            </div>

            {/* ── Alertes ── */}
            {alerts.length > 0 && (
              <div className="rounded-2xl border px-5 py-4 space-y-2"
                style={{ backgroundColor: "#f59e0b08", borderColor: "#f59e0b30" }}>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" style={{ color: "#f59e0b" }} />
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Points d'attention</p>
                </div>
                {alerts.map(a => (
                  <p key={a} className="pl-6 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{a}</p>
                ))}
              </div>
            )}

            {/* ── Expositions ── */}
            <div className="grid gap-6 lg:grid-cols-2">
              {[
                { title: "Par classe d'actifs", icon: <PieChart className="h-4 w-4" style={{ color: "#6366f1" }} />, data: byClass },
                { title: "Par devise", icon: <Banknote className="h-4 w-4" style={{ color: "#22c55e" }} />, data: byCurrency },
                { title: "Par secteur", icon: <Factory className="h-4 w-4" style={{ color: "#a855f7" }} />, data: bySector.slice(0, 8) },
                { title: "Par zone géographique", icon: <Globe2 className="h-4 w-4" style={{ color: "#0ea5e9" }} />, data: byCountry.slice(0, 8) },
              ].map(section => (
                <div key={section.title} className="rounded-2xl border p-5"
                  style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <div className="mb-4 flex items-center gap-2">
                    {section.icon}
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{section.title}</h3>
                  </div>
                  {section.data.length === 1 && section.data[0].label === "Non renseigné" ? (
                    <EmptyState compact title="Données non renseignées"
                      description="Complétez le secteur/pays de vos actifs pour activer cette analyse." />
                  ) : (
                    <ExposureBars data={section.data} format={format} />
                  )}
                </div>
              ))}
            </div>

            {/* ── Top positions ── */}
            <div className="rounded-2xl border overflow-hidden"
              style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Top positions</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Poids dans le portefeuille et performance</p>
              </div>
              <div>
                {positions.slice(0, 10).map((p, i) => {
                  const weight = totalValue > 0 ? (p.displayValue / totalValue) * 100 : 0
                  return (
                    <div key={p.id} className="flex items-center gap-4 px-5 py-3"
                      style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                      <span className="w-4 text-[11px] font-bold tabular-nums" style={{ color: "var(--text-tertiary)" }}>{i + 1}</span>
                      <div className="min-w-0 w-24 sm:w-32">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {p.ticker}
                          {p.priceIsStale && (
                            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }}
                              title="Prix indisponible — valorisé au coût" />
                          )}
                        </p>
                        <p className="truncate text-[11px]" style={{ color: "var(--text-tertiary)" }}>{p.name}</p>
                      </div>
                      <div className="hidden flex-1 items-center gap-2 sm:flex">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-muted)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, weight)}%`, backgroundColor: "var(--accent)" }} />
                        </div>
                        <span className="w-12 text-right text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {weight.toFixed(1)} %
                        </span>
                      </div>
                      <div className="ml-auto flex items-center gap-3">
                        {p.pnlPct != null && <ChangeBadge value={p.pnlPct} showIcon={false} />}
                        <span className="w-24 text-right text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                          {format(p.displayValue)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
