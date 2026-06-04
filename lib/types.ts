// ─── Core domain types ───────────────────────────────────────────────────────

export type AssetClass = "stock" | "etf" | "crypto" | "real_estate" | "bond" | "cash"
export type TransactionType = "buy" | "sell" | "dividend" | "transfer" | "revenu"
export type Currency = "CHF" | "EUR" | "USD" | "GBP"

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
  id: string
  name: string
  description?: string
  color: string
  currency: Currency
  createdAt: string
  assets: Asset[]
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
  logoUrl?: string
  sector?: string
  country?: string
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
  date: string
  notes?: string
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

export function assetValue(a: Asset) {
  return a.quantity * a.currentPrice
}

export function assetCost(a: Asset) {
  return a.quantity * a.avgBuyPrice
}

export function assetPnl(a: Asset) {
  return assetValue(a) - assetCost(a)
}

export function assetPnlPct(a: Asset) {
  const cost = assetCost(a)
  if (cost === 0) return 0
  return (assetPnl(a) / cost) * 100
}

export function portfolioTotalValue(p: Portfolio) {
  return p.assets.reduce((s, a) => s + assetValue(a), 0)
}

export function portfolioTotalCost(p: Portfolio) {
  return p.assets.reduce((s, a) => s + assetCost(a), 0)
}

export function portfolioPnl(p: Portfolio) {
  return portfolioTotalValue(p) - portfolioTotalCost(p)
}

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

export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  stock: "#3b82f6",
  etf: "#22c55e",
  crypto: "#a78bfa",
  real_estate: "#f59e0b",
  bond: "#64748b",
  cash: "#6b7280",
}
