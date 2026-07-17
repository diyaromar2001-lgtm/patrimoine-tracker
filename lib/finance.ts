/**
 * lib/finance.ts — Fonctions financières pures et testables
 *
 * Aucun import React, aucun hook.
 * Toutes les formules sont ici — les composants ne font que les appeler.
 */

import type { AppCurrency } from "./utils"
import { DEFAULT_FX_RATES as BASE_FX_RATES, DEFAULT_GBP_PER_CHF } from "./utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type FXRates = { [currency: string]: number }

// Dérivée de la table unique de lib/utils.ts (+ GBP) — plus de littéraux divergents.
export const DEFAULT_FX_RATES: FXRates = {
  ...BASE_FX_RATES,
  GBP: DEFAULT_GBP_PER_CHF,
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
  grossAmountChf?: number
  feesChf?: number
  realizedPnlChf?: number
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

export interface TransactionChfAmountsInput {
  type: string
  quantity: number
  price: number
  fees?: number
  currency?: string
  fxRates: FXRates
  assetQuantity?: number
  assetCostBasisChf?: number
}

export interface TransactionChfAmounts {
  fxRateToChf: number
  grossAmountChf: number
  feesChf: number
  netAmountChf: number
  soldCostBasisChf: number
  realizedPnlChf: number
}

export interface PositionMetricInput {
  ticker?: string
  quantity: number
  currentPriceNative: number
  nativeCurrency?: string
  costBasisChf?: number
  assetClass?: string
}

export type CashBalancesInput =
  | Record<string, number | undefined>
  | { CHF?: number; USD?: number; EUR?: number; GBP?: number }

export interface PortfolioMetricInput {
  assets: PositionMetricInput[]
  cashBalances?: CashBalancesInput
}

export interface PortfolioMetrics {
  positionValueChf: number
  cashChf: number
  portfolioValueChf: number
  investedChf: number
  totalPnlChf: number
  totalReturnPercent: number
  positionLineCount: number
  uniqueAssetCount: number
}

export interface CashFlowSnapshot extends PortfolioSnapshot {
  /** Net deposits are positive, withdrawals are negative. */
  cashFlow?: number
}

export interface DividendCashflowInput {
  amount: number
  currency?: string
  payDate?: string
  paymentDate?: string
  status?: "paid" | "upcoming" | string
  frequency?: "monthly" | "quarterly" | "semi-annual" | "annual" | string
  quantity?: number
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

export function chfPerCurrencyUnit(currency: string | undefined, rates: FXRates): number {
  const code = currency ?? "CHF"
  if (code === "CHF") return 1
  const liveRate = rates[code]
  return liveRate && liveRate > 0 ? 1 / liveRate : 1
}

/**
 * Retourne le cost basis CHF d'une position.
 *
 * RÈGLE: la valeur stockée (Σ net_amount_chf historique, figée) fait foi dès
 * qu'elle est présente et > 0. Le fallback nativeTotal/taux-courant n'est
 * utilisé qu'en l'absence totale de valeur stockée (anciennes lignes).
 *
 * @param costBasisChf  valeur brute en DB (CHF historique figé)
 * @param quantity      quantité détenue
 * @param avgBuyPrice   prix moyen natif
 * @param nativeCurrency devise native de l'actif (USD/EUR/CHF)
 * @param rates         taux FX actuels (fallback uniquement)
 */
export function safeCostBasisChf(
  costBasisChf: number | null | undefined,
  quantity: number,
  avgBuyPrice: number,
  nativeCurrency: string | undefined,
  rates: FXRates
): number {
  // La valeur stockée est un cost basis CHF historique FIGÉ (Σ net_amount_chf).
  // On lui fait confiance dès qu'elle est présente et > 0.
  //
  // L'ancienne heuristique |costBasisChf/nativeTotal − 1| < 0.03 (« valeur
  // stockée en natif sans FX ») produisait des faux positifs systématiques
  // pour USD/CHF et EUR/CHF (taux ≈ 0.95–1.05) : un cost basis correct était
  // écrasé par nativeTotal/taux-courant, et se mettait à dériver avec le FX
  // live à chaque rendu. Supprimée — la source du bug (recompute CHF dans
  // edit/delete de transaction) est corrigée à l'écriture via replayPosition.
  if (costBasisChf != null && costBasisChf > 0) {
    return costBasisChf
  }
  // Fallback uniquement si aucune valeur stockée : approximation au taux courant.
  const nativeTotal = quantity * avgBuyPrice
  const rate = rates[nativeCurrency ?? "CHF"] ?? 1
  return nativeTotal / rate
}

export function calculateTransactionChfAmounts(input: TransactionChfAmountsInput): TransactionChfAmounts {
  const fxRateToChf = chfPerCurrencyUnit(input.currency, input.fxRates)
  const fees = input.fees ?? 0
  const grossAmountChf = input.quantity * input.price * fxRateToChf
  const feesChf = fees * fxRateToChf
  const netAmountChf = input.type === "buy"
    ? grossAmountChf + feesChf
    : input.type === "sell"
      ? grossAmountChf - feesChf
      : grossAmountChf

  const soldCostBasisChf = input.type === "sell" && input.assetQuantity && input.assetQuantity > 0
    ? ((input.assetCostBasisChf ?? 0) / input.assetQuantity) * input.quantity
    : 0
  const realizedPnlChf = input.type === "sell" ? netAmountChf - soldCostBasisChf : 0

  return {
    fxRateToChf,
    grossAmountChf,
    feesChf,
    netAmountChf,
    soldCostBasisChf,
    realizedPnlChf,
  }
}

export function amountToChf(amount: number, currency: string | undefined, rates: FXRates): number {
  return amount * chfPerCurrencyUnit(currency, rates)
}

export function positionValue(asset: PositionMetricInput, rates: FXRates): number {
  if (asset.quantity <= 0 || asset.currentPriceNative <= 0) return 0
  return amountToChf(asset.quantity * asset.currentPriceNative, asset.nativeCurrency, rates)
}

export function cashValueChf(cashBalances: CashBalancesInput | undefined, rates: FXRates): number {
  if (!cashBalances) return 0
  return Object.entries(cashBalances).reduce((sum, [currency, value]) => {
    const amount = Number(value ?? 0)
    return amount > 0 ? sum + amountToChf(amount, currency, rates) : sum
  }, 0)
}

export function portfolioValue(
  assets: PositionMetricInput[],
  cashBalances: CashBalancesInput | undefined,
  rates: FXRates,
): number {
  return assets.reduce((sum, asset) => sum + positionValue(asset, rates), 0) + cashValueChf(cashBalances, rates)
}

export function totalPnL(assets: PositionMetricInput[], rates: FXRates): number {
  const investedChf = assets.reduce((sum, asset) => sum + Math.max(0, asset.costBasisChf ?? 0), 0)
  const valueChf = assets.reduce((sum, asset) => sum + positionValue(asset, rates), 0)
  return valueChf - investedChf
}

export function totalReturnPercent(assets: PositionMetricInput[], rates: FXRates): number {
  const investedChf = assets.reduce((sum, asset) => sum + Math.max(0, asset.costBasisChf ?? 0), 0)
  if (investedChf <= 0) return 0
  return (totalPnL(assets, rates) / investedChf) * 100
}

export function netWorth(portfolios: PortfolioMetricInput[], rates: FXRates): number {
  return portfolios.reduce((sum, portfolio) => (
    sum + portfolioValue(portfolio.assets, portfolio.cashBalances, rates)
  ), 0)
}

export function calculatePortfolioMetrics(
  assets: PositionMetricInput[],
  cashBalances: CashBalancesInput | undefined,
  rates: FXRates,
): PortfolioMetrics {
  const investableAssets = assets.filter(a => a.assetClass !== "cash" && a.quantity > 0)
  const positionValueChf = investableAssets.reduce((sum, asset) => sum + positionValue(asset, rates), 0)
  const cashChf = cashValueChf(cashBalances, rates)
  const investedChf = investableAssets.reduce((sum, asset) => sum + Math.max(0, asset.costBasisChf ?? 0), 0)
  const totalPnlChf = positionValueChf - investedChf

  return {
    positionValueChf,
    cashChf,
    portfolioValueChf: positionValueChf + cashChf,
    investedChf,
    totalPnlChf,
    totalReturnPercent: investedChf > 0 ? (totalPnlChf / investedChf) * 100 : 0,
    positionLineCount: investableAssets.length,
    uniqueAssetCount: new Set(investableAssets.map(a => a.ticker).filter(Boolean)).size,
  }
}

export function benchmarkAlpha(portfolioReturnPercent: number, benchmarkReturnPercent: number): number {
  return portfolioReturnPercent - benchmarkReturnPercent
}

export function simpleMoneyWeightedReturn(
  startValue: number,
  endValue: number,
  cashFlows: Array<{ amount: number; weight?: number }> = [],
): number {
  const netFlows = cashFlows.reduce((sum, flow) => sum + flow.amount, 0)
  const weightedFlows = cashFlows.reduce((sum, flow) => sum + flow.amount * (flow.weight ?? 0.5), 0)
  const denominator = startValue + weightedFlows
  if (denominator <= 0) return 0
  return ((endValue - startValue - netFlows) / denominator) * 100
}

export function timeWeightedReturn(snapshots: CashFlowSnapshot[]): number {
  if (snapshots.length < 2) return 0
  let compounded = 1

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].value
    if (prev <= 0) continue
    const current = snapshots[i].value
    const cashFlow = snapshots[i].cashFlow ?? 0
    compounded *= 1 + ((current - cashFlow - prev) / prev)
  }

  return (compounded - 1) * 100
}

export function maxDrawdownAdjusted(snapshots: CashFlowSnapshot[]): number {
  if (snapshots.length < 2) return 0
  const performanceSeries: PortfolioSnapshot[] = [{ date: snapshots[0].date, value: 100 }]
  let indexedValue = 100

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].value
    if (prev <= 0) continue
    const current = snapshots[i].value
    const cashFlow = snapshots[i].cashFlow ?? 0
    indexedValue *= 1 + ((current - cashFlow - prev) / prev)
    performanceSeries.push({ date: snapshots[i].date, value: indexedValue })
  }

  return maxDrawdown(performanceSeries)
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

// ─── Agrégats dashboard (purs, testables) ────────────────────────────────────

export interface DashboardDividendTx {
  type: string
  quantity: number
  price: number
  currency?: string
  netAmountChf?: number | null
}

/**
 * Somme des dividendes encaissés, exprimée en devise d'affichage.
 * Une SEULE conversion par transaction :
 *  - netAmountChf présent → CHF × taux d'affichage
 *  - sinon montant natif → devise d'affichage (jamais les deux à la suite)
 */
export function sumDividendsDisplay(
  transactions: DashboardDividendTx[],
  displayCurrency: string,
  rates: FXRates
): number {
  const userRate = rates[displayCurrency] ?? 1
  return transactions
    .filter(t => t.type === "dividend")
    .reduce((s, t) => {
      if (t.netAmountChf != null) return s + t.netAmountChf * userRate
      return s + convertCurrency(t.quantity * t.price, t.currency ?? "CHF", displayCurrency, rates)
    }, 0)
}

export interface DashboardAllocationAsset {
  assetClass: string
  ticker: string
  quantity: number
  currentPrice: number
  currency?: string
}

/**
 * Allocation par classe d'actif en devise d'affichage.
 *  - Les actifs de classe "cash" sont IGNORÉS dans la boucle : la liquidité
 *    vient uniquement de totalCashDisplay (sinon double comptage).
 *  - Fallback de prix normalisé : natif → devise d'affichage (pas de mélange
 *    d'unités avec les prix live déjà convertis).
 *  - Les % sont calculés sur la somme des buckets → total exactement 100.
 */
export function computeAllocation(
  assets: DashboardAllocationAsset[],
  livePriceDisplay: (ticker: string) => number | undefined,
  totalCashDisplay: number,
  displayCurrency: string,
  rates: FXRates
): Array<{ cls: string; val: number; pct: number }> {
  const byClass: Record<string, number> = {}
  for (const a of assets) {
    if (a.assetClass === "cash") continue
    const price = livePriceDisplay(a.ticker)
      ?? convertCurrency(a.currentPrice, a.currency ?? "CHF", displayCurrency, rates)
    byClass[a.assetClass] = (byClass[a.assetClass] ?? 0) + price * a.quantity
  }
  if (totalCashDisplay > 0) byClass.cash = (byClass.cash ?? 0) + totalCashDisplay
  const total = Object.values(byClass).reduce((s, v) => s + v, 0)
  return Object.entries(byClass)
    .sort(([, a], [, b]) => b - a)
    .map(([cls, val]) => ({ cls, val, pct: total > 0 ? (val / total) * 100 : 0 }))
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

function dividendDate(dividend: DividendCashflowInput): string {
  return dividend.paymentDate ?? dividend.payDate ?? ""
}

export function dividendReceivedYTD(
  dividends: DividendCashflowInput[],
  rates: FXRates,
  today: Date = new Date(),
): number {
  const year = today.getFullYear()
  const todayTime = today.getTime()

  return dividends.reduce((sum, dividend) => {
    const date = dividendDate(dividend)
    if (!date || dividend.status !== "paid") return sum
    const paymentTime = new Date(date).getTime()
    if (Number.isNaN(paymentTime) || paymentTime > todayTime || new Date(date).getFullYear() !== year) return sum
    return sum + amountToChf(dividend.amount, dividend.currency, rates)
  }, 0)
}

export function plannedDividends(
  dividends: DividendCashflowInput[],
  rates: FXRates,
  today: Date = new Date(),
): number {
  const todayTime = today.getTime()

  return dividends.reduce((sum, dividend) => {
    const date = dividendDate(dividend)
    if (!date) return sum
    const paymentTime = new Date(date).getTime()
    if (Number.isNaN(paymentTime) || paymentTime <= todayTime) return sum
    return sum + amountToChf(dividend.amount, dividend.currency, rates)
  }, 0)
}

export function estimatedAnnualDividend(
  dividends: DividendCashflowInput[],
  rates: FXRates,
): number {
  return dividends.reduce((sum, dividend) => {
    const quantity = dividend.quantity ?? 1
    const multiplier = FREQ_MULTIPLIER[dividend.frequency ?? "annual"] ?? 1
    return sum + amountToChf(dividend.amount * quantity * multiplier, dividend.currency, rates)
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
      const buyCost = tx.quantity * tx.price + (tx.fees ?? 0)
      pos.avg = nextQty > 0 ? ((pos.qty * pos.avg) + buyCost) / nextQty : 0
      pos.qty = nextQty
      positions[key] = pos
      continue
    }

    if (tx.type === "sell") {
      const soldQty = Math.min(tx.quantity, pos.qty || tx.quantity)
      const costBasis = soldQty * pos.avg
      const proceeds  = tx.quantity * tx.price
      const fees      = tx.fees ?? 0
      const hasRealizedChf = tx.realizedPnlChf != null && tx.realizedPnlChf !== 0

      events.push({
        ticker: tx.ticker,
        date: tx.date,
        quantity: tx.quantity,
        proceeds: hasRealizedChf ? (tx.grossAmountChf ?? proceeds) : proceeds,
        costBasis,
        fees: hasRealizedChf ? (tx.feesChf ?? fees) : fees,
        pnl: hasRealizedChf ? tx.realizedPnlChf! : proceeds - costBasis - fees,
        currency: hasRealizedChf ? "CHF" : tx.currency ?? "CHF",
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
