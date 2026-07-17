// ─── Core domain types ───────────────────────────────────────────────────────

export type AssetClass = "stock" | "etf" | "crypto" | "real_estate" | "bond" | "cash"
export type TransactionType = "buy" | "sell" | "dividend" | "transfer" | "revenu" | "deposit" | "withdrawal" | "conversion"
export type Currency = "CHF" | "EUR" | "USD" | "GBP"
export type CryptoCustodyType = "cold_wallet" | "hot_wallet" | "exchange"
export type CostBasisSource = "computed" | "manual" | "backfill"

// ─── Cash / Liquidités globales ───────────────────────────────────────────────
//
// La liquidité est GLOBALE — pas attachée à un portefeuille précis.
// Tous les portefeuilles piochent dans la même réserve globale.
//
// Formule patrimoine: positions + globalCash (NO double-comptage avec revenus)

/** Liquidité globale multi-devises (indépendante des portefeuilles) */
export interface GlobalCash {
  CHF: number
  USD: number
  EUR: number
}

export const EMPTY_GLOBAL_CASH: GlobalCash = { CHF: 0, USD: 0, EUR: 0 }

/** Type de mouvement dans l'historique de cash */
export type CashMovementType =
  | "deposit"          // dépôt de cash (argent perso)
  | "withdrawal"       // retrait de cash
  | "conversion"       // conversion entre devises
  | "buy_deduction"    // déduction lors d'un achat
  | "sell_credit"      // crédit lors d'une vente
  | "dividend_credit"  // dividende reçu → crédité en cash
  | "revenue_credit"   // revenu annexe → crédité en cash (import: aussi intérêts, note='interest')
  | "fee"              // frais / impôt à la source (import T212, montant négatif)

export interface CashMovement {
  id:          string
  type:        CashMovementType
  currency:    string
  amount:      number   // positif = entrée, négatif = sortie
  balanceAfterChf?: number
  balanceAfterUsd?: number
  balanceAfterEur?: number
  note?:       string
  refTicker?:  string
  refPortfolioId?: string
  date:        string
}

// ─── Rétrocompatibilité ───────────────────────────────────────────────────────
/** @deprecated Utiliser GlobalCash à la place */
export interface CashBalance {
  CHF: number
  USD: number
  EUR: number
}

/** @deprecated Utiliser EMPTY_GLOBAL_CASH */
export const EMPTY_CASH_BALANCE: CashBalance = { CHF: 0, USD: 0, EUR: 0 }

/**
 * Classe d'actif sélectionnable dans la modale transaction
 * (pour filtrer la recherche et adapter l'UI)
 */
export type ModalAssetClass = "stock" | "etf" | "crypto" | "cash"

// ─── Revenus Annexes ─────────────────────────────────────────────────────────

export type RevenuType =
  | "parrainage"
  | "bonus_bienvenue"
  | "airdrop"
  | "interets"
  | "cashback"
  | "staking"
  | "autre"

export interface RevenuAnnexe {
  id:          string
  portfolioId?: string
  userId:      string
  type:        RevenuType
  label:       string
  amount:      number      // in native currency
  currency:    string      // "CHF" | "USD" | "EUR"
  platform?:   string
  date:        string      // ISO
  notes?:      string
  createdAt:   string
}

export const REVENU_TYPE_META: Record<RevenuType, { label: string; icon: string; color: string }> = {
  parrainage:      { label: "Parrainage",       icon: "💰", color: "#a855f7" },
  bonus_bienvenue: { label: "Bonus bienvenue",  icon: "🎁", color: "#c084fc" },
  airdrop:         { label: "Airdrop",          icon: "🪂", color: "#9333ea" },
  interets:        { label: "Intérêts",         icon: "💵", color: "#7c3aed" },
  cashback:        { label: "Cashback",         icon: "🔄", color: "#6d28d9" },
  staking:         { label: "Staking",          icon: "⚡", color: "#8b5cf6" },
  autre:           { label: "Autre",            icon: "📦", color: "#a78bfa" },
}

export interface Portfolio {
  id:           string
  name:         string
  description?: string
  color:        string
  currency:     Currency
  createdAt:    string
  assets:       Asset[]
  /** Poche de liquidité disponible par devise */
  cashBalances: CashBalance
}

export interface Asset {
  id: string
  portfolioId: string
  ticker: string
  name: string
  assetClass: AssetClass
  quantity: number
  avgBuyPrice: number
  currentPrice: number
  currency: Currency
  /** Historical invested capital in CHF. Static: never recomputed with live FX. */
  costBasisChf?: number
  /** Marks whether costBasisChf came from transaction logic, manual correction, or migration. */
  costBasisSource?: CostBasisSource
  costBasisUpdatedAt?: string
  logoUrl?: string
  sector?: string
  country?: string
  cryptoCustody?: CryptoCustodyType
  stakingEnabled?: boolean
  /**
   * Yahoo Finance quote symbol — may differ from `ticker` for T212 EU instruments.
   * e.g. ticker="WSML" → quoteSymbol="WSML.L" (LSE), ticker="SMH" → "SMH.L".
   * When set, the prices API and all price lookups use this instead of `ticker`.
   */
  quoteSymbol?: string
  /** Original broker export ticker (e.g. "WSML" as it appears in T212 CSV). */
  brokerTicker?: string
}

export interface Transaction {
  id: string
  portfolioId: string
  assetId?: string
  ticker: string
  assetName: string
  assetClass: AssetClass
  type: TransactionType
  quantity: number
  price: number
  fees: number
  currency: Currency
  /** CHF value for 1 unit of transaction currency at transaction date. */
  fxRateToChf?: number
  /** quantity * price converted with the historical transaction FX rate. */
  grossAmountChf?: number
  /** fees converted with the historical transaction FX rate. */
  feesChf?: number
  /** Buy cost / sell proceeds in CHF after fees according to transaction type. */
  netAmountChf?: number
  /** Realized PnL in CHF for SELL transactions. */
  realizedPnlChf?: number
  date: string
  notes?: string
  cryptoCustody?: CryptoCustodyType
  stakingEnabled?: boolean
}

export interface DividendEvent {
  id: string
  ticker: string
  assetName: string
  assetClass: AssetClass
  exDate: string
  payDate: string
  amount: number
  frequency: "annual" | "semi-annual" | "quarterly" | "monthly"
  currency: Currency
  status: "upcoming" | "paid"
}

export interface WatchlistItem {
  id: string
  ticker: string
  name: string
  assetClass: AssetClass
  currentPrice: number
  change24h: number
  changePct24h: number
  high24h: number
  low24h: number
  marketCap?: number
  volume24h?: number
  currency: Currency
  sparkline: number[]
  addedAt: string
}

export interface PortfolioSnapshot {
  date: string
  value: number
}

// ─── Computed helpers ─────────────────────────────────────────────────────────
//
// ⚠️  ATTENTION — CES FONCTIONS N'ONT PAS DE CONVERSION FX
//
//  Elles supposent que tous les prix sont déjà dans la même devise.
//  Pour un portefeuille multi-devises (USD + EUR + CHF), ces fonctions
//  produisent des chiffres incorrects.
//
//  → Pour le P&L et la valeur en devise de base (CHF) :
//      utiliser lib/finance.ts (positionValue, portfolioLatentPnL, etc.)
//      ou lib/pnl.ts (calculatePortfolioPnL)
//
//  Ces fonctions restent utiles uniquement pour :
//    - la comparaison ordinale (tri) quand tous les actifs sont dans la même devise
//    - les tests unitaires isolés
//    - les calculs de coût CHF quand costBasisChf est déjà disponible
//
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Utiliser livePrices[ticker].price * qty (déjà converti en devise user) */
export function assetValue(a: Asset) {
  return a.quantity * a.currentPrice
}

/** @deprecated Utiliser asset.costBasisChf (taux historique) pour le coût réel en CHF */
export function assetCost(a: Asset) {
  return a.quantity * a.avgBuyPrice
}

export function assetCostBasisChf(a: Asset) {
  return a.costBasisChf ?? assetCost(a)
}

export function assetAvgCostChf(a: Asset) {
  if (a.quantity <= 0) return 0
  return assetCostBasisChf(a) / a.quantity
}

/** @deprecated Utiliser lib/finance.ts positionValue() + costBasisChf */
export function assetPnl(a: Asset) {
  return assetValue(a) - assetCost(a)
}

/** @deprecated Utiliser lib/pnl.ts calculatePortfolioPnL() pour le % correct avec FX */
export function assetPnlPct(a: Asset) {
  const cost = assetCost(a)
  if (cost === 0) return 0
  return (assetPnl(a) / cost) * 100
}

/** @deprecated Utiliser lib/finance.ts portfolioValue() avec fxRates */
export function portfolioTotalValue(p: Portfolio) {
  return p.assets.reduce((s, a) => s + assetValue(a), 0)
}

/** @deprecated Utiliser Σ asset.costBasisChf pour le coût réel historique en CHF */
export function portfolioTotalCost(p: Portfolio) {
  return p.assets.reduce((s, a) => s + assetCost(a), 0)
}

/** @deprecated Utiliser lib/pnl.ts calculatePortfolioPnL() */
export function portfolioPnl(p: Portfolio) {
  return portfolioTotalValue(p) - portfolioTotalCost(p)
}

/** @deprecated Utiliser lib/pnl.ts calculatePortfolioPnL().pnlPct */
export function portfolioPnlPct(p: Portfolio) {
  const cost = portfolioTotalCost(p)
  if (cost === 0) return 0
  return (portfolioPnl(p) / cost) * 100
}

// ─── Asset class metadata ─────────────────────────────────────────────────────

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stock: "Action",
  etf: "ETF",
  crypto: "Crypto",
  real_estate: "Immobilier",
  bond: "Obligataire",
  cash: "Liquidités",
}

ASSET_CLASS_LABELS.cash = "Liquidités / Cash"

export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  stock: "#3b82f6",
  etf: "#22c55e",
  crypto: "#a78bfa",
  real_estate: "#f59e0b",
  bond: "#64748b",
  cash: "#6b7280",
}
