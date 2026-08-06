"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { useFundamentals, sectorBreakdown, countryBreakdown } from "@/hooks/use-fundamentals"
import { useAppData } from "@/hooks/use-app-data"
import { useCurrency } from "@/hooks/use-currency"
import { useLivePrices } from "@/hooks/use-live-prices"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHero } from "@/components/ui/page-hero"
import { SectionCard } from "@/components/ui/section-card"
import { ChangeBadge } from "@/components/ui/badge"
import type { AppCurrency } from "@/lib/utils"
import { ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from "@/lib/types"
import { herfindahlIndex } from "@/lib/finance"
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

  // Secteur / pays : rien ne remplissait ces champs, d'où « non renseigné pour
  // 100 % du portefeuille ». Ils viennent maintenant de Yahoo, avec la
  // transparence sectorielle des ETF — indispensable ici, la majorité de la
  // valeur étant en fonds.
  const { data: fundamentals, loading: fundamentalsLoading } = useFundamentals(
    useMemo(() => positions.map(p => p.ticker), [positions])
  )
  const valuedPositions = useMemo(
    () => positions.map(p => ({ ticker: p.ticker, value: p.displayValue })),
    [positions]
  )
  const sectors   = useMemo(() => sectorBreakdown(valuedPositions, fundamentals), [valuedPositions, fundamentals])
  const countries = useMemo(() => countryBreakdown(valuedPositions, fundamentals), [valuedPositions, fundamentals])

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
  const byCurrency = useMemo(() => groupBy(p => livePrices[p.ticker]?.originalCurrency ?? p.currency ?? "CHF"), [positions, totalValue, livePrices]) // eslint-disable-line

  // Frais cumulés (historiques, en devise d'affichage)
  const totalFees = useMemo(() => {
    const ur = (fxRates as Record<string, number>)[currency] ?? 1
    return transactions.reduce((s, t) => s + ((t.feesChf ?? 0) * ur), 0)
  }, [transactions, fxRates, currency])

  // Indice de concentration HHI (Σ poids², échelle ×10000)
  const hhi = useMemo(() => herfindahlIndex(positions.map(p => p.displayValue)), [positions])
  const hhiLabel = hhi > 2500 ? "Concentré" : hhi > 1500 ? "Modéré" : "Diversifié"

  // Alertes structurées : problème → pourquoi → action possible
  const alerts = useMemo(() => {
    const out: Array<{ probleme: string; pourquoi: string; action: string }> = []
    if (totalValue <= 0) return out
    const top1 = positions[0]
    if (top1 && top1.displayValue / totalValue > 0.25) out.push({
      probleme: `${top1.ticker} pèse ${(top1.displayValue / totalValue * 100).toFixed(0)} % du portefeuille`,
      pourquoi: "Une chute de ce seul actif impacterait fortement tout votre patrimoine.",
      action: "Renforcer d'autres positions lors des prochains apports plutôt que celle-ci.",
    })
    const top3 = positions.slice(0, 3).reduce((s, p) => s + p.displayValue, 0)
    if (positions.length >= 3 && top3 / totalValue > 0.6) out.push({
      probleme: `Le top 3 concentre ${(top3 / totalValue * 100).toFixed(0)} % du portefeuille`,
      pourquoi: "La diversification réelle est plus faible que le nombre de lignes ne le suggère.",
      action: "Viser progressivement un poids < 60 % pour les 3 premières lignes.",
    })
    if (byCurrency[0] && byCurrency[0].pct > 80) out.push({
      probleme: `${byCurrency[0].pct.toFixed(0)} % exposé à la devise ${byCurrency[0].label}`,
      pourquoi: "Votre patrimoine varie avec le taux de change de cette seule devise.",
      action: "Considérer des actifs libellés dans d'autres devises (ou couverts).",
    })
    const crypto = byClass.find(c => c.label.toLowerCase().includes("crypto"))
    if (crypto && crypto.pct > 30) out.push({
      probleme: `Crypto = ${crypto.pct.toFixed(0)} % du portefeuille`,
      pourquoi: "Classe très volatile : les baisses de 50 %+ y sont historiquement fréquentes.",
      action: "Vérifier que cette part correspond bien à votre tolérance au risque.",
    })
    const stale = positions.filter(p => p.priceIsStale)
    if (stale.length > 0) out.push({
      probleme: `${stale.length} position(s) sans prix live (${stale.slice(0, 3).map(p => p.ticker).join(", ")}${stale.length > 3 ? "…" : ""})`,
      pourquoi: "Ces lignes sont valorisées au coût : la valeur et le P&L affichés sont incomplets.",
      action: "Vérifier le symbole de cotation (quote_symbol) de ces actifs.",
    })
    return out.slice(0, 4)
  }, [positions, totalValue, byCurrency, byClass])

  // Qualité des données (transparence, pas de fallback silencieux)
  const dataQuality = useMemo(() => {
    const stalePrices = positions.filter(p => p.priceIsStale).length
    // Part de la valeur qu'on n'a PAS su classer — annoncée telle quelle
    // plutôt que noyée dans les pourcentages affichés.
    const unknownSector  = totalValue > 0 ? (sectors.unclassified   / totalValue) * 100 : 0
    const unknownCountry = totalValue > 0 ? (countries.unclassified / totalValue) * 100 : 0
    return { stalePrices, unknownSector, unknownCountry }
  }, [positions, totalValue, sectors, countries])

  const hasData = positions.length > 0

  return (
    <div className="flex flex-col">
      <Topbar title="Analyses" subtitle="Diversification, expositions et risque" />
      <div className="flex-1 space-y-6 p-4 sm:p-6 max-w-7xl mx-auto w-full">

        {!hasData ? (
          <SectionCard padded={false}>
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
          </SectionCard>
        ) : (
          <>
            {/* ── Héro : la valeur analysée domine ── */}
            <PageHero
              label="Valeur des positions analysées"
              value={format(totalValue)}
              stats={[
                {
                  label: "Positions",
                  value: `${positions.length} · ${byClass.length} classe${byClass.length > 1 ? "s" : ""}`,
                },
                {
                  label: "Plus grosse position",
                  value: `${positions[0].ticker} · ${(positions[0].displayValue / totalValue * 100).toFixed(1)} %`,
                  color: positions[0].displayValue / totalValue > 0.25 ? "#f59e0b" : undefined,
                },
                {
                  label: "Concentration (HHI)",
                  value: `${Math.round(hhi)} · ${hhiLabel}`,
                  color: hhi > 2500 ? "var(--loss)" : hhi > 1500 ? "#f59e0b" : "var(--gain)",
                  title: "Indice de Herfindahl-Hirschman : < 1500 diversifié · 1500-2500 modéré · > 2500 concentré",
                },
                {
                  label: "Frais cumulés",
                  value: `−${format(totalFees)}`,
                  color: "#f59e0b",
                  title: "Tous frais de transaction historiques",
                },
              ]}
            />

            {/* ── Alertes actionnables ── */}
            {alerts.length > 0 && (
              <SectionCard
                title="Points d'attention"
                description="Chaque alerte explique le problème, pourquoi il compte et l'action possible"
                padded={false}
                action={<ShieldAlert className="h-4 w-4" style={{ color: "#f59e0b" }} />}
              >
                {alerts.map((a, i) => (
                  <div key={a.probleme} className="px-5 py-4"
                    style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                      {a.probleme}
                    </p>
                    <p className="mt-1 pl-3.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{a.pourquoi}</p>
                    <p className="mt-1 pl-3.5 text-xs" style={{ color: "var(--accent)" }}>→ {a.action}</p>
                  </div>
                ))}
              </SectionCard>
            )}

            {/* ── Qualité des données ── */}
            {(dataQuality.stalePrices > 0 || dataQuality.unknownSector > 20 || dataQuality.unknownCountry > 20) && (
              <SectionCard
                title="Qualité des données"
                description="Ce qui limite la fiabilité des analyses ci-dessous"
              >
                <ul className="space-y-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {dataQuality.stalePrices > 0 && (
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                      {dataQuality.stalePrices} position(s) valorisée(s) au coût — prix indisponible
                    </li>
                  )}
                  {dataQuality.unknownSector > 20 && (
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "var(--text-tertiary)" }} />
                      Secteur non renseigné pour {dataQuality.unknownSector.toFixed(0)} % du portefeuille
                    </li>
                  )}
                  {dataQuality.unknownCountry > 20 && (
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "var(--text-tertiary)" }} />
                      Pays non renseigné pour {dataQuality.unknownCountry.toFixed(0)} % du portefeuille
                    </li>
                  )}
                </ul>
              </SectionCard>
            )}

            {/* ── Expositions ──
                Les sections entièrement « Non renseigné » ne s'affichent pas
                comme de grandes cartes vides : une seule carte compacte les
                remplace (règle : jamais d'écran qui semble cassé). */}
            {(() => {
              const sections = [
                { title: "Par classe d'actifs", icon: <PieChart className="h-4 w-4" style={{ color: "#6366f1" }} />, data: byClass, note: undefined as string | undefined },
                { title: "Par devise", icon: <Banknote className="h-4 w-4" style={{ color: "#22c55e" }} />, data: byCurrency, note: undefined as string | undefined },
                ...(sectors.rows.length ? [{
                  title: "Par secteur",
                  icon: <Factory className="h-4 w-4" style={{ color: "#a855f7" }} />,
                  data: sectors.rows.slice(0, 9),
                  // Un ETF n'a pas de secteur propre : sa valeur est ventilée
                  // selon la composition du fonds. On le dit, sinon le lecteur
                  // croirait que ses ETF sont classés comme des actions.
                  note: "Les ETF sont ventilés selon la composition réelle du fonds.",
                }] : []),
                ...(countries.rows.length ? [{
                  title: "Par pays",
                  icon: <Globe2 className="h-4 w-4" style={{ color: "#0ea5e9" }} />,
                  data: countries.rows.slice(0, 9),
                  note: countries.unclassified > 0
                    ? `${format(countries.unclassified)} en fonds internationaux, sans pays unique.`
                    : undefined,
                }] : []),
              ]
              return (
                <>
                  <div className="grid gap-6 lg:grid-cols-2">
                    {sections.map(section => (
                      <SectionCard key={section.title} title={section.title} action={section.icon}>
                        <ExposureBars data={section.data} format={format} />
                        {section.note && (
                          <p className="mt-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                            {section.note}
                          </p>
                        )}
                      </SectionCard>
                    ))}
                  </div>

                  {fundamentalsLoading && !sectors.rows.length && (
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      Chargement des secteurs et pays…
                    </p>
                  )}
                </>
              )
            })()}

            {/* ── Top positions ── */}
            <SectionCard
              title="Top positions"
              description="Poids dans le portefeuille et performance"
              padded={false}
            >
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
            </SectionCard>
          </>
        )}
      </div>
    </div>
  )
}
