/**
 * POST /api/fundamentals
 *
 * Secteur, industrie et pays d'un titre — et, pour un ETF, la répartition
 * sectorielle de ce qu'il détient réellement.
 *
 * Sans cette route, la page Analyses affichait « secteur non renseigné pour
 * 100 % du portefeuille » : les champs `sector` / `country` existaient dans le
 * type Asset mais rien ne les remplissait jamais.
 *
 * Le cas ETF compte plus que le cas action ici : un portefeuille surtout
 * composé d'ETF n'a aucun secteur propre. Yahoo expose la ventilation
 * sectorielle du fonds (`topHoldings.sectorWeightings`), ce qui permet une
 * vue « par transparence » au lieu d'une ligne « Non renseigné ».
 *
 * Corps : { tickers: string[] }
 * Réponse : { [ticker]: FundamentalsEntry }
 */

import { NextRequest, NextResponse } from "next/server"
import YahooFinanceClass from "yahoo-finance2"
import { cacheFetch } from "@/lib/cache"
import { buildTickerAliases } from "@/lib/import/t212-symbol-map"

export const runtime = "nodejs"

const yf = new (YahooFinanceClass as unknown as new (o: Record<string, unknown>) => typeof YahooFinanceClass)(
  { suppressNotices: ["yahooSurvey", "ripHistorical"] } as never
) as typeof YahooFinanceClass

const TICKER_ALIASES: Record<string, string[]> = {
  ...buildTickerAliases(),
  VUAA: ["VUAA.L", "VUAA.MI", "VUAA.DE"],
}

export interface FundamentalsEntry {
  /** "stock" quand le secteur est propre au titre, "etf" quand il vient du fonds. */
  kind:     "stock" | "etf" | "unknown"
  sector?:  string
  industry?: string
  country?: string
  /** ETF : poids sectoriels du fonds, en % (somme ≈ 100). */
  sectorWeights?: Record<string, number>
}

/** Libellés Yahoo → français, pour ne pas mélanger deux langues à l'écran. */
const SECTOR_FR: Record<string, string> = {
  technology: "Technologie",
  financial_services: "Finance",
  "financial services": "Finance",
  healthcare: "Santé",
  consumer_cyclical: "Consommation cyclique",
  "consumer cyclical": "Consommation cyclique",
  consumer_defensive: "Consommation de base",
  "consumer defensive": "Consommation de base",
  industrials: "Industrie",
  energy: "Énergie",
  utilities: "Services publics",
  real_estate: "Immobilier",
  realestate: "Immobilier",
  "real estate": "Immobilier",
  basic_materials: "Matériaux",
  "basic materials": "Matériaux",
  communication_services: "Communication",
  "communication services": "Communication",
}

function frSector(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_")
  return SECTOR_FR[key] ?? SECTOR_FR[raw.trim().toLowerCase()] ?? raw.trim()
}

const COUNTRY_FR: Record<string, string> = {
  "United States": "États-Unis",
  "Switzerland":   "Suisse",
  "Germany":       "Allemagne",
  "United Kingdom": "Royaume-Uni",
  "Ireland":       "Irlande",
  "France":        "France",
  "Netherlands":   "Pays-Bas",
  "China":         "Chine",
  "Taiwan":        "Taïwan",
  "Japan":         "Japon",
}

async function fetchOne(ticker: string): Promise<FundamentalsEntry> {
  const aliases = TICKER_ALIASES[ticker.toUpperCase()] ?? []
  const candidates = aliases.length ? [...new Set([...aliases, ticker])] : [ticker]

  for (const candidate of candidates) {
    try {
      const raw = await yf.quoteSummary(candidate, {
        modules: ["assetProfile", "topHoldings"] as never,
      }) as unknown as {
        assetProfile?: { sector?: string; industry?: string; country?: string }
        topHoldings?: { sectorWeightings?: Array<Record<string, number>> }
      }

      // ── ETF : ventilation du fonds ────────────────────────────────────────
      const weightings = raw.topHoldings?.sectorWeightings
      if (Array.isArray(weightings) && weightings.length) {
        const sectorWeights: Record<string, number> = {}
        for (const row of weightings) {
          // Yahoo renvoie [{ realestate: 0.0243 }, { technology: 0.28 }, …]
          for (const [key, value] of Object.entries(row)) {
            if (typeof value !== "number" || value <= 0) continue
            sectorWeights[frSector(key)] = (sectorWeights[frSector(key)] ?? 0) + value * 100
          }
        }
        if (Object.keys(sectorWeights).length) {
          return { kind: "etf", sectorWeights }
        }
      }

      // ── Action : secteur propre ───────────────────────────────────────────
      const p = raw.assetProfile
      if (p?.sector || p?.country) {
        return {
          kind:     "stock",
          sector:   p.sector   ? frSector(p.sector) : undefined,
          industry: p.industry,
          country:  p.country  ? (COUNTRY_FR[p.country] ?? p.country) : undefined,
        }
      }
    } catch { /* candidat suivant */ }
  }
  return { kind: "unknown" }
}

export async function POST(req: NextRequest) {
  const body: { tickers?: string[] } = await req.json()
  const tickers = [...new Set(body.tickers ?? [])].filter(Boolean)
  if (!tickers.length) return NextResponse.json({})

  const entries = await Promise.all(
    tickers.map(async ticker => {
      // Un secteur ne change pas d'un jour à l'autre : 24 h de cache.
      const data = await cacheFetch(
        `fundamentals:v1:${ticker}`,
        () => fetchOne(ticker),
        24 * 3600
      ) as FundamentalsEntry
      return [ticker, data] as const
    })
  )

  return NextResponse.json(Object.fromEntries(entries))
}
