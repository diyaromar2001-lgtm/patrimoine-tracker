import { createClient } from "./client"
import type { Portfolio, Asset, Transaction, CashBalance } from "@/lib/types"

const EMPTY_CASH: CashBalance = { CHF: 0, USD: 0, EUR: 0 }

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
    id:           p.id,
    name:         p.name,
    description:  p.description ?? undefined,
    color:        p.color,
    currency:     p.currency,
    createdAt:    p.created_at,
    cashBalances: { ...EMPTY_CASH, ...(p.cash_balances ?? {}) } as CashBalance,
    assets: (assetsData ?? [])
      .filter(a => a.portfolio_id === p.id)
      .map(a => ({
        id:             a.id,
        portfolioId:    a.portfolio_id,
        ticker:         a.ticker,
        name:           a.name,
        assetClass:     a.asset_class as Asset["assetClass"],
        quantity:       Number(a.quantity),
        avgBuyPrice:    Number(a.avg_buy_price),
        currentPrice:   Number(a.avg_buy_price),
        currency:       a.currency,
        sector:         a.sector ?? undefined,
        country:        a.country ?? undefined,
        cryptoCustody:  a.crypto_custody ?? undefined,
        stakingEnabled: Boolean(a.staking_enabled),
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

/** Update the cash_balances JSON column for a portfolio */
export async function updateCashBalance(portfolioId: string, cash: CashBalance) {
  const sb = createClient()
  if (!sb) return false
  const { error } = await sb
    .from("portfolios")
    .update({ cash_balances: cash })
    .eq("id", portfolioId)
  if (error) console.error("[updateCashBalance]", error.message)
  return !error
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
    crypto_custody: asset.cryptoCustody,
    staking_enabled: asset.stakingEnabled,
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
    // Log complet pour diagnostiquer: code, message, détails, hint
    console.error("[createTransaction] Supabase error:", {
      code:    error.code,
      message: error.message,
      details: error.details,
      hint:    error.hint,
      payload: { portfolio_id: tx.portfolioId, type: tx.type, ticker: tx.ticker },
    })
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
// ─── Asset upsert from transaction ────────────────────────────────────────────

/**
 * Called after a BUY transaction:
 *  - If the asset already exists in the portfolio → update qty + recalculate avg price
 *  - Otherwise → insert a new asset row
 */
export async function upsertAssetFromBuy(tx: {
  portfolioId: string
  ticker:      string
  assetName:   string
  assetClass:  string
  quantity:    number
  price:       number
  fees?:       number
  currency:    string
  cryptoCustody?: string
  stakingEnabled?: boolean
}) {
  const sb = createClient()
  if (!sb) return

  // Check if asset already exists in this portfolio
  const { data: existing } = await sb
    .from("assets")
    .select("id, quantity, avg_buy_price")
    .eq("portfolio_id", tx.portfolioId)
    .eq("ticker", tx.ticker)
    .maybeSingle()

  if (existing) {
    // Recalculate: weighted avg price
    const oldQty  = Number(existing.quantity)
    const oldAvg  = Number(existing.avg_buy_price)
    const newQty  = oldQty + tx.quantity
    const newAvg  = (oldQty * oldAvg + tx.quantity * tx.price + (tx.fees ?? 0)) / newQty

    const update: Record<string, unknown> = { quantity: newQty, avg_buy_price: Number(newAvg.toFixed(4)) }
    if (tx.assetClass === "crypto") {
      if (tx.cryptoCustody) update.crypto_custody = tx.cryptoCustody
      if (tx.stakingEnabled !== undefined) update.staking_enabled = tx.stakingEnabled
    }

    const { error } = await sb.from("assets")
      .update(update)
      .eq("id", existing.id)

    if (error) console.error("[upsertAsset] update error:", error.message, error.details)
  } else {
    // Create new asset row
    const { error } = await sb.from("assets").insert({
      portfolio_id:  tx.portfolioId,
      ticker:        tx.ticker,
      name:          tx.assetName,
      asset_class:   tx.assetClass,
      quantity:      tx.quantity,
      avg_buy_price: tx.quantity > 0 ? tx.price + ((tx.fees ?? 0) / tx.quantity) : tx.price,
      currency:      tx.currency ?? "CHF",
      crypto_custody: tx.assetClass === "crypto" ? tx.cryptoCustody : undefined,
      staking_enabled: tx.assetClass === "crypto" ? Boolean(tx.stakingEnabled) : undefined,
    })

    if (error) console.error("[upsertAsset] insert error:", error.message, error.details)
  }
}

/**
 * Called after a SELL transaction — reduces the asset quantity.
 * If quantity reaches 0 or below, the asset is deleted.
 */
export async function reduceAssetFromSell(tx: {
  portfolioId: string
  ticker:      string
  quantity:    number
}) {
  const sb = createClient()
  if (!sb) return

  const { data: existing } = await sb
    .from("assets")
    .select("id, quantity")
    .eq("portfolio_id", tx.portfolioId)
    .eq("ticker", tx.ticker)
    .maybeSingle()

  if (!existing) return

  const newQty = Number(existing.quantity) - tx.quantity

  if (newQty <= 0) {
    await sb.from("assets").delete().eq("id", existing.id)
  } else {
    await sb.from("assets").update({ quantity: Number(newQty.toFixed(8)) }).eq("id", existing.id)
  }
}

// ─── Revenus Annexes ──────────────────────────────────────────────────────────

import type { RevenuAnnexe } from "@/lib/types"

export async function fetchRevenus(): Promise<RevenuAnnexe[] | null> {
  const sb = createClient()
  if (!sb) return null
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data, error } = await sb
    .from("revenus_annexes")
    .select("*")
    .order("date", { ascending: false })
  if (error || !data) return null
  return data.map(r => ({
    id:          r.id,
    portfolioId: r.portfolio_id ?? undefined,
    userId:      r.user_id,
    type:        r.type,
    label:       r.label,
    amount:      Number(r.amount),
    currency:    r.currency,
    platform:    r.platform ?? undefined,
    date:        new Date(r.date).toISOString().slice(0, 10),
    notes:       r.notes ?? undefined,
    createdAt:   r.created_at,
  }))
}

export async function createRevenu(rev: Omit<RevenuAnnexe, "id" | "createdAt" | "userId">) {
  const sb = createClient()
  if (!sb) return null
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data, error } = await sb.from("revenus_annexes").insert({
    user_id:      user.id,
    portfolio_id: rev.portfolioId ?? null,
    type:         rev.type,
    label:        rev.label,
    amount:       rev.amount,
    currency:     rev.currency,
    platform:     rev.platform ?? null,
    date:         rev.date,
    notes:        rev.notes ?? null,
  }).select().single()
  if (error) { console.error("[createRevenu]", error.message); return null }
  return data
}

export async function deleteRevenu(id: string) {
  const sb = createClient()
  if (!sb) return false
  const { error } = await sb.from("revenus_annexes").delete().eq("id", id)
  return !error
}
