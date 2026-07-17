/**
 * lib/cashflow.ts — Agrégation mensuelle des flux de trésorerie (pur, testable)
 *
 * Source de vérité : cash_movements (tous les types de flux y passent :
 * dépôts, retraits, dividendes, intérêts, achats, ventes, conversions, frais).
 *
 * Conventions :
 *  - amount natif signé (+ entrée / − sortie), converti via convertFn fournie
 *    par l'appelant (le module reste pur, sans hook ni fetch).
 *  - "conversion" = flux INTERNE entre devises → exclue des entrées/sorties.
 *  - buy_deduction / sell_credit = flux d'INVESTISSEMENT (pas des flux
 *    externes) → catégorie séparée, togglable (style Parqet).
 *  - revenue_credit avec note "interest" → intérêts ; sinon revenus annexes.
 */

import type { CashMovement } from "./types"

export type CashflowCategory =
  | "deposits"      // dépôts (entrée externe)
  | "withdrawals"   // retraits (sortie externe)
  | "dividends"     // dividendes reçus
  | "interest"      // intérêts sur cash
  | "revenus"       // revenus annexes
  | "buys"          // achats de titres (sortie d'investissement)
  | "sells"         // ventes de titres (entrée d'investissement)
  | "fees"          // frais / impôt à la source

export const CASHFLOW_CATEGORY_LABELS: Record<CashflowCategory, string> = {
  deposits:    "Dépôts",
  withdrawals: "Retraits",
  dividends:   "Dividendes",
  interest:    "Intérêts",
  revenus:     "Revenus annexes",
  buys:        "Achats",
  sells:       "Ventes",
  fees:        "Frais & impôts",
}

/** Catégories considérées comme flux d'investissement (internes au patrimoine). */
export const INVESTMENT_CATEGORIES: ReadonlySet<CashflowCategory> = new Set(["buys", "sells"])

export interface MonthlyCashflow {
  /** "YYYY-MM" */
  month: string
  /** Montants POSITIFS par catégorie (déjà convertis en devise d'affichage). */
  inflows: Partial<Record<CashflowCategory, number>>
  /** Montants POSITIFS par catégorie (valeur absolue des sorties). */
  outflows: Partial<Record<CashflowCategory, number>>
  totalIn: number
  totalOut: number
  net: number
}

export interface CashflowSummary {
  months: MonthlyCashflow[]
  totalIn: number
  totalOut: number
  net: number
  /** Taux d'épargne = net / entrées (0 si pas d'entrées). En %. */
  savingsRatePct: number
  /** Totaux par catégorie (positifs), pour le donut. */
  byCategory: Partial<Record<CashflowCategory, number>>
}

export interface AggregateOptions {
  /** Inclure achats/ventes (flux d'investissement) dans in/out. Défaut: false. */
  includeInvestments?: boolean
  /** Borne inférieure incluse "YYYY-MM-DD" (filtre de période). */
  fromDate?: string
  /** Borne supérieure incluse "YYYY-MM-DD". */
  toDate?: string
}

/** Classe un mouvement dans une catégorie cashflow, ou null s'il est exclu. */
export function classifyMovement(m: CashMovement): CashflowCategory | null {
  switch (m.type) {
    case "deposit":         return "deposits"
    case "withdrawal":      return "withdrawals"
    case "dividend_credit": return "dividends"
    case "revenue_credit":
      return m.note?.toLowerCase().includes("interest") ? "interest" : "revenus"
    case "buy_deduction":   return "buys"
    case "sell_credit":     return "sells"
    case "fee":             return "fees"
    case "conversion":      return null  // flux interne entre devises
    default:                return null
  }
}

/**
 * Agrège les mouvements de cash par mois, en devise d'affichage.
 * @param movements  liste brute (n'importe quel ordre)
 * @param convertFn  (montant, devise) → montant en devise d'affichage
 */
export function aggregateCashflow(
  movements: CashMovement[],
  convertFn: (amount: number, currency: string) => number,
  opts: AggregateOptions = {}
): CashflowSummary {
  const includeInv = opts.includeInvestments ?? false
  const byMonth = new Map<string, MonthlyCashflow>()
  const byCategory: Partial<Record<CashflowCategory, number>> = {}

  for (const m of movements) {
    if (!m.date) continue
    if (opts.fromDate && m.date < opts.fromDate) continue
    if (opts.toDate && m.date > opts.toDate) continue

    const cat = classifyMovement(m)
    if (cat == null) continue
    if (!includeInv && INVESTMENT_CATEGORIES.has(cat)) continue

    const converted = convertFn(m.amount, m.currency || "CHF")
    if (!Number.isFinite(converted) || converted === 0) continue

    const month = m.date.slice(0, 7)
    let bucket = byMonth.get(month)
    if (!bucket) {
      bucket = { month, inflows: {}, outflows: {}, totalIn: 0, totalOut: 0, net: 0 }
      byMonth.set(month, bucket)
    }

    if (converted > 0) {
      bucket.inflows[cat] = (bucket.inflows[cat] ?? 0) + converted
      bucket.totalIn += converted
    } else {
      const abs = -converted
      bucket.outflows[cat] = (bucket.outflows[cat] ?? 0) + abs
      bucket.totalOut += abs
    }
    bucket.net += converted
    byCategory[cat] = (byCategory[cat] ?? 0) + Math.abs(converted)
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  const totalIn = months.reduce((s, x) => s + x.totalIn, 0)
  const totalOut = months.reduce((s, x) => s + x.totalOut, 0)
  const net = totalIn - totalOut

  return {
    months,
    totalIn,
    totalOut,
    net,
    savingsRatePct: totalIn > 0 ? (net / totalIn) * 100 : 0,
    byCategory,
  }
}

/** Les mouvements d'un mois donné ("YYYY-MM"), triés du plus récent au plus ancien. */
export function movementsForMonth(
  movements: CashMovement[],
  month: string,
  opts: AggregateOptions = {}
): CashMovement[] {
  const includeInv = opts.includeInvestments ?? false
  return movements
    .filter(m => {
      if (!m.date?.startsWith(month)) return false
      const cat = classifyMovement(m)
      if (cat == null) return false
      if (!includeInv && INVESTMENT_CATEGORIES.has(cat)) return false
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
