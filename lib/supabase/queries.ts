import { createClient } from "./client"
import type { Portfolio, Asset, Transaction } from "@/lib/types"

// ─── Portfolios ───────────────────────────────────────────────────────────────

export async function fetchPortfolios(): Promise<Portfolio[] | null> {
  const sb = createClient()
  if (!sb) return null

  // RLS handles user_id filtering — no need for explicit filter
  const { data: portfoliosData, error: pErr } = await sb
    .from("portfolios")
    .select("*")
    .order("created_at", { ascending: true })

  if (pErr || !portfoliosData) return null

  const { data: assetsData } = await sb.from("assets").select("*")

  return portfoliosData.map(p => ({
    id:          p.id,
    name:        p.name,
    description: p.description ?? undefined,
    color:       p.color,
    currency:    p.currency,
    createdAt:   p.created_at,
    assets:      (assetsData ?? [])
      .filter(a => a.portfolio_id === p.id)
      .map(a => ({
        id:           a.id,
        portfolioId:  a.portfolio_id,
        ticker:       a.ticker,
        name:         a.name,
        assetClass:   a.asset_class as Asset["assetClass"],
        quantity:     Number(a.quantity),
        avgBuyPrice:  Number(a.avg_buy_price),
        currentPrice: Number(a.avg_buy_price),  // will be overridden by live price
        currency:     a.currency,
        sector:       a.sector ?? undefined,
        country:      a.country ?? undefined,
      })),
  }))
}

export async function createPortfolio(portfolio: Omit<Portfolio, "id" | "assets">) {
  const sb = createClient()
  if (!sb) return null

  // user_id is set automatically via RLS (auth.uid())
  const { data: { user } } = await sb.auth.getUser()
  const { data, error } = await sb.from("portfolios").insert({
    user_id:     user?.id,
    name:        portfolio.name,
    description: portfolio.description,
    color:       portfolio.color,
    currency:    portfolio.currency,
    created_at:  portfolio.createdAt,
  }).select().single()

  return error ? null : data
}

export async function deletePortfolio(id: string) {
  const sb = createClient()
  if (!sb) return false
  const { error } = await sb.from("portfolios").delete().eq("id", id)
  return !error
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export async function createAsset(asset: Omit<Asset, "currentPrice">) {
  const sb = createClient()
  if (!sb) return null

  const { data, error } = await sb.from("assets").insert({
    portfolio_id:  asset.portfolioId,
    ticker:        asset.ticker,
    name:          asset.name,
    asset_class:   asset.assetClass,
    quantity:      asset.quantity,
    avg_buy_price: asset.avgBuyPrice,
    currency:      asset.currency,
    sector:        asset.sector,
    country:       asset.country,
  }).select().single()

  return error ? null : data
}

export async function deleteAsset(id: string) {
  const sb = createClient()
  if (!sb) return false
  const { error } = await sb.from("assets").delete().eq("id", id)
  return !error
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function fetchTransactions(): Promise<Transaction[] | null> {
  const sb = createClient()
  if (!sb) return null

  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .order("date", { ascending: false })

  if (error || !data) return null

  return data.map(t => ({
    id:          t.id,
    portfolioId: t.portfolio_id,
    ticker:      t.ticker,
    assetName:   t.asset_name,
    assetClass:  t.asset_class as Transaction["assetClass"],
    type:        t.type as Transaction["type"],
    quantity:    Number(t.quantity),
    price:       Number(t.price),
    fees:        Number(t.fees),
    currency:    t.currency,
    date:        t.date,
    notes:       t.notes ?? undefined,
  }))
}

export async function createTransaction(tx: Omit<Transaction, "id">) {
  const sb = createClient()
  if (!sb) return null

  const { data, error } = await sb.from("transactions").insert({
    portfolio_id: tx.portfolioId,
    ticker:       tx.ticker,
    asset_name:   tx.assetName,
    asset_class:  tx.assetClass,
    type:         tx.type,
    quantity:     tx.quantity,
    price:        tx.price,
    fees:         tx.fees,
    currency:     tx.currency ?? "CHF",
    date:         tx.date,
    notes:        tx.notes ?? null,
  }).select().single()

  if (error) {
    console.error("[createTransaction] Supabase error:", error.message, error.details, error.hint)
    return null
  }
  return data
}

export async function updateTransaction(id: string, tx: Partial<Omit<Transaction, "id">>) {
  const sb = createClient()
  if (!sb) return false

  const { error } = await sb.from("transactions").update({
    ticker:      tx.ticker,
    asset_name:  tx.assetName,
    asset_class: tx.assetClass,
    type:        tx.type,
    quantity:    tx.quantity,
    price:       tx.price,
    fees:        tx.fees,
    date:        tx.date,
    notes:       tx.notes,
  }).eq("id", id)

  return !error
}

export async function deleteTransaction(id: string) {
  const sb = createClient()
  if (!sb) return false
  const { error } = await sb.from("transactions").delete().eq("id", id)
  return !error
}
