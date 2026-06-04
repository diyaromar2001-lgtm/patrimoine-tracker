/**
 * lib/finance.ts — Fonctions financières pures et testables
 *
 * Aucun import React, aucun hook.
 * Toutes les formules sont ici — les composants ne font que les appeler.
 */

import type { AppCurrency } from "./utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type FXRates = { [currency: string]: number }

export const DEFAULT_FX_RATES: FXRates = {
  CHF: 1,
  USD: 1.109,
  EUR: 1.042,
  GBP: 0.871,
}

export interface AssetInput {
  ticker:       string
  quantity:     number
  avgBuyPrice:  number   // in user's base currency
  currentPrice: number   // in user's base currency (may be overridden by live price)
  assetClass:   string
  sector?:      string
  country?:     string
}

export interface PortfolioSnapshot {
  date:  string  // ISO date
  value: number
}

export interface DividendInput {
  ticker:         string
  amountPerShare: number
  frequency:      "monthly" | "quarterly" | "semi-annual" | "annual"
  quantity:       number
}

export interface AllocationEntry {
  key:   string
  value: number
  pct:   number
}

export interface PerformanceMetrics {
  totalReturn:    number   // %
  ytdReturn:      number   // %
  periodReturn:   number   // %  (for selected period)
  latentPnL:      number   // absolute value
  latentPnLPct:   number   // %
}

export interface RealizedPnLInput {
  portfolioId: string
  ticker:      string
  type:        string
  quantity:    number
  price:       number
  fees?:       number
  currency?:   string
  date:        string
}

export interface RealizedPnLEvent {
  ticker:    string
  date:      string
  quantity:  number
  proceeds:  number
  costBasis: number
  fees:      number
  pnl:       number
  currency:  string
}

// ─── Conversion de devises ────────────────────────────────────────────────────

export function convertCurrency(
  amount:  number,
  from:    string,
  to:      string,
  rates:   FXRates = DEFAULT_FX_RATES
): number {
  if (from === to) return amount
  const fromRate = rates[from] ?? 1
  const toRate   = rates[to]   ?? 1
  return (amount / fromRate) * toRate
}

// ─── Prix et valeur ───────────────────────────────────────────────────────────

export function assetCurrentValue(quantity: number, currentPrice: number): number {
  return quantity * currentPrice
}

export function assetCostBasis(quantity: number, avgBuyPrice: number): number {
  return quantity * avgBuyPrice
}

export function assetLatentPnL(
  quantity:     number,
  currentPrice: number,
  avgBuyPrice:  number
): number {
  return (currentPrice - avgBuyPrice) * quantity
}

export function assetLatentPnLPct(
  currentPrice: number,
  avgBuyPrice:  number
): number {
  if (!avgBuyPrice) return 0
  return ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100
}

// ─── Calcul prix moyen pondéré ────────────────────────────────────────────────
// Formule : (qty_existante × avg_existant + qty_nouvelle × prix_achat) / (qty_totale)

export function weightedAveragePrice(
  existingQty:   number,
  existingAvg:   number,
  additionalQty: number,
  additionalPrice: number
): number {
  const totalQty = existingQty + additionalQty
  if (totalQty <= 0) return 0
  return (existingQty * existingAvg + additionalQty * additionalPrice) / totalQty
}

// ─── Totaux portefeuille ──────────────────────────────────────────────────────

export function portfolioTotalValue(assets: AssetInput[]): number {
  return assets.reduce((s, a) => s + assetCurrentValue(a.quantity, a.currentPrice), 0)
}

export function portfolioTotalCostBasis(assets: AssetInput[]): number {
  return assets.reduce((s, a) => s + assetCostBasis(a.quantity, a.avgBuyPrice), 0)
}

export function portfolioLatentPnL(assets: AssetInput[]): number {
  const value = portfolioTotalValue(assets)
  const cost  = portfolioTotalCostBasis(assets)
  return value - cost
}

export function portfolioLatentPnLPct(assets: AssetInput[]): number {
  const cost = portfolioTotalCostBasis(assets)
  if (!cost) return 0
  return (portfolioLatentPnL(assets) / cost) * 100
}

// ─── Allocation ───────────────────────────────────────────────────────────────

export function calculateAllocationByClass(
  assets:      AssetInput[],
  totalValue?: number
): AllocationEntry[] {
  const tv  = totalValue ?? portfolioTotalValue(assets)
  const map: Record<string, number> = {}

  for (const a of assets) {
    const v = assetCurrentValue(a.quantity, a.currentPrice)
    map[a.assetClass] = (map[a.assetClass] ?? 0) + v
  }

  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({
      key,
      value,
      pct: tv > 0 ? (value / tv) * 100 : 0,
    }))
}

export function calculateAllocationByField(
  assets:      AssetInput[],
  field:       "sector" | "country",
  fallback:    string = "Non renseigne",
  totalValue?: number
): AllocationEntry[] {
  const tv  = totalValue ?? portfolioTotalValue(assets)
  const map: Record<string, number> = {}

  for (const a of assets) {
    const raw = a[field]?.trim()
    const key = raw && raw !== "-" && raw !== "—" ? raw : fallback
    const v   = assetCurrentValue(a.quantity, a.currentPrice)
    map[key] = (map[key] ?? 0) + v
  }

  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({
      key,
      value,
      pct: tv > 0 ? (value / tv) * 100 : 0,
    }))
}

export function calculateAssetWeight(
  assetValue: number,
  totalValue: number
): number {
  if (!totalValue) return 0
  return (assetValue / totalValue) * 100
}

// ─── Dividendes ───────────────────────────────────────────────────────────────

const FREQ_MULTIPLIER: Record<string, number> = {
  monthly:      12,
  quarterly:    4,
  "semi-annual": 2,
  annual:       1,
}

export function annualDividendPerShare(
  amountPerPayment: number,
  frequency:        string
): number {
  return amountPerPayment * (FREQ_MULTIPLIER[frequency] ?? 4)
}

export function totalAnnualDividend(dividends: DividendInput[]): number {
  return dividends.reduce((s, d) => {
    const annual = annualDividendPerShare(d.amountPerShare, d.frequency)
    return s + annual * d.quantity
  }, 0)
}

export function dividendYieldOnCost(
  annualDividend: number,
  costBasis:      number
): number {
  if (!costBasis) return 0
  return (annualDividend / costBasis) * 100
}

export function currentDividendYield(
  annualDividend: number,
  currentValue:   number
): number {
  if (!currentValue) return 0
  return (annualDividend / currentValue) * 100
}

// ─── Performance ─────────────────────────────────────────────────────────────

export function simpleReturn(startValue: number, endValue: number): number {
  if (!startValue) return 0
  return ((endValue - startValue) / startValue) * 100
}

/** CAGR (Compound Annual Growth Rate) */
export function cagr(startValue: number, endValue: number, years: number): number {
  if (!startValue || !years) return 0
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100
}

export function ytdReturn(snapshots: PortfolioSnapshot[]): number {
  if (!snapshots.length) return 0
  const startOfYear = snapshots.find(s =>
    new Date(s.date).getFullYear() === new Date().getFullYear()
  )
  if (!startOfYear) return 0
  const current = snapshots[snapshots.length - 1]
  return simpleReturn(startOfYear.value, current.value)
}

// ─── Formatage professionnel ──────────────────────────────────────────────────

/**
 * Format monétaire suisse : 4 408.09 CHF
 * Utilise le séparateur d'espace (fr-CH) et 2 décimales.
 */
export function calculateRealizedPnLEvents(transactions: RealizedPnLInput[]): RealizedPnLEvent[] {
  const positions: Record<string, { qty: number; avg: number }> = {}
  const events: RealizedPnLEvent[] = []

  const ordered = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  for (const tx of ordered) {
    const key = `${tx.portfolioId}:${tx.ticker}`
    const pos = positions[key] ?? { qty: 0, avg: 0 }

    if (tx.type === "buy") {
      const nextQty = pos.qty + tx.quantity
      pos.avg = nextQty > 0 ? ((pos.qty * pos.avg) + (tx.quantity * tx.price)) / nextQty : 0
      pos.qty = nextQty
      positions[key] = pos
      continue
    }

    if (tx.type === "sell") {
      const soldQty = Math.min(tx.quantity, pos.qty || tx.quantity)
      const costBasis = soldQty * pos.avg
      const proceeds  = tx.quantity * tx.price
      const fees      = tx.fees ?? 0

      events.push({
        ticker: tx.ticker,
        date: tx.date,
        quantity: tx.quantity,
        proceeds,
        costBasis,
        fees,
        pnl: proceeds - costBasis - fees,
        currency: tx.currency ?? "CHF",
      })

      pos.qty = Math.max(0, pos.qty - tx.quantity)
      positions[key] = pos
    }
  }

  return events
}

export function calculateRealizedPnL(transactions: RealizedPnLInput[]): number {
  return calculateRealizedPnLEvents(transactions).reduce((sum, event) => sum + event.pnl, 0)
}

export function maxDrawdown(snapshots: PortfolioSnapshot[]): number {
  let peak = 0
  let maxDd = 0

  for (const s of snapshots) {
    if (s.value > peak) peak = s.value
    if (peak <= 0) continue

    const drawdown = ((s.value - peak) / peak) * 100
    if (drawdown < maxDd) maxDd = drawdown
  }

  return maxDd
}

export function formatAmount(
  value:    number,
  currency: string = "CHF",
  locale:   string = "fr-CH"
): string {
  return new Intl.NumberFormat(locale, {
    style:                 "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Format pourcentage : +8.99 % ou -0.25 %
 * Toujours 2 décimales, signe explicite.
 */
export function formatPct(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(decimals)} %`
}

/**
 * Formatage compact : 1.24M, 45.3k
 */
export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1e12) return (value / 1e12).toFixed(2) + " B"
  if (Math.abs(value) >= 1e9)  return (value / 1e9).toFixed(2) + " Mrd"
  if (Math.abs(value) >= 1e6)  return (value / 1e6).toFixed(2) + " M"
  if (Math.abs(value) >= 1e3)  return (value / 1e3).toFixed(1) + " k"
  return value.toFixed(2)
}

// ─── Insights automatiques ────────────────────────────────────────────────────

export interface Insight {
  type:    "warning" | "info" | "success" | "tip"
  title:   string
  message: string
  ticker?: string
}

export function generateInsights(
  assets:     AssetInput[],
  dividends?: DividendInput[]
): Insight[] {
  const insights: Insight[] = []
  const totalValue   = portfolioTotalValue(assets)
  if (totalValue <= 0) return insights

  // Concentration par actif
  for (const a of assets) {
    const weight = calculateAssetWeight(assetCurrentValue(a.quantity, a.currentPrice), totalValue)
    if (weight >= 15) {
      insights.push({
        type: "warning",
        title: "Concentration élevée",
        message: `${a.ticker} représente ${weight.toFixed(1)} % du portefeuille — risque de concentration.`,
        ticker: a.ticker,
      })
    }
  }

  const sectorAllocations = calculateAllocationByField(assets, "sector", "Non renseigne", totalValue)
  for (const sector of sectorAllocations) {
    if (sector.pct >= 40) {
      insights.push({
        type: "warning",
        title: "Concentration sectorielle",
        message: `${sector.key} represente ${sector.pct.toFixed(1)} % du portefeuille. Le seuil d'alerte est fixe a 40 %.`,
      })
    }
  }

  // Concentration crypto
  const cryptoAlloc = calculateAllocationByClass(assets).find(a => a.key === "crypto")
  if (cryptoAlloc && cryptoAlloc.pct >= 50) {
    insights.push({
      type: "warning",
      title: "Exposition crypto élevée",
      message: `Les cryptomonnaies représentent ${cryptoAlloc.pct.toFixed(1)} % du portefeuille — volatilité importante.`,
    })
  }

  // Exposition ETF vs actions
  const etfAlloc    = calculateAllocationByClass(assets).find(a => a.key === "etf")
  const stockAlloc  = calculateAllocationByClass(assets).find(a => a.key === "stock")
  if (etfAlloc && stockAlloc) {
    if (stockAlloc.pct > 80) {
      insights.push({
        type: "tip",
        title: "Diversification",
        message: `Le portefeuille est concentré sur les actions (${stockAlloc.pct.toFixed(0)} %). Des ETF pourraient apporter de la diversification.`,
      })
    }
  }

  // Meilleures et pires positions
  const sorted = [...assets].sort((a, b) => assetLatentPnLPct(b.currentPrice, b.avgBuyPrice) - assetLatentPnLPct(a.currentPrice, a.avgBuyPrice))
  if (sorted.length >= 2) {
    const best  = sorted[0]
    const worst = sorted[sorted.length - 1]
    const bestPct  = assetLatentPnLPct(best.currentPrice,  best.avgBuyPrice)
    const worstPct = assetLatentPnLPct(worst.currentPrice, worst.avgBuyPrice)
    if (bestPct > 10) {
      insights.push({ type: "success", title: "Meilleur contributeur", message: `${best.ticker} affiche une plus-value de ${formatPct(bestPct)} depuis l'achat.`, ticker: best.ticker })
    }
    if (worstPct < -10) {
      insights.push({ type: "warning", title: "Plus grosse moins-value", message: `${worst.ticker} est en moins-value de ${formatPct(worstPct)} depuis l'achat.`, ticker: worst.ticker })
    }
  }

  return insights.slice(0, 5) // max 5 insights
}
