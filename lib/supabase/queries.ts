import { createClient } from "./client"
import type { Portfolio, Asset, Transaction, CashBalance, GlobalCash, CashMovement, CashMovementType } from "@/lib/types"

const EMPTY_CASH: CashBalance = { CHF: 0, USD: 0, EUR: 0 }
const EMPTY_GLOBAL: GlobalCash = { CHF: 0, USD: 0, EUR: 0 }

// ─── Global Cash ─────────────────────────────────────────────────────────────

export async function fetchGlobalCash(): Promise<GlobalCash> {
  const sb = createClient()
  if (!sb) return { ...EMPTY_GLOBAL }
  const { data } = await sb.from("global_cash").select("chf,usd,eur").maybeSingle()
  if (!data) return { ...EMPTY_GLOBAL }
  return { CHF: Number(data.chf ?? 0), USD: Number(data.usd ?? 0), EUR: Number(data.eur ?? 0) }
}

export async function upsertGlobalCash(cash: GlobalCash): Promise<boolean> {
  const sb = createClient()
  if (!sb) return false
  const { data: user } = await sb.auth.getUser()
  if (!user.user) return false
  const { error } = await sb.from("global_cash").upsert({
    user_id:    user.user.id,
    chf:        cash.CHF,
    usd:        cash.USD,
    eur:        cash.EUR,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" })
  if (error) console.error("[upsertGlobalCash]", error.message)
  return !error
}

export async function fetchCashMovements(limit = 100): Promise<CashMovement[]> {
  const sb = createClient()
  if (!sb) return []
  const { data } = await sb
    .from("cash_movements")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit)
  if (!data) return []
  return data.map(d => ({
    id:               d.id,
    type:             d.type as CashMovementType,
    currency:         d.currency,
    amount:           Number(d.amount),
    balanceAfterChf:  d.balance_after_chf != null ? Number(d.balance_after_chf) : undefined,
    balanceAfterUsd:  d.balance_after_usd != null ? Number(d.balance_after_usd) : undefined,
    balanceAfterEur:  d.balance_after_eur != null ? Number(d.balance_after_eur) : undefined,
    note:             d.note ?? undefined,
    refTicker:        d.ref_ticker ?? undefined,
    refPortfolioId:   d.ref_portfolio_id ?? undefined,
    date:             typeof d.date === "string" ? d.date.slice(0, 10) : new Date(d.date).toISOString().slice(0, 10),
  }))
}

export async function insertCashMovement(
  type: CashMovementType,
  currency: string,
  amount: number,
  afterCash: GlobalCash,
  opts?: { note?: string; ticker?: string; portfolioId?: string; date?: string }
): Promise<string | null> {
  const sb = createClient()
  if (!sb) return null
  const { data: user } = await sb.auth.getUser()
  if (!user.user) return null
  const { data, error } = await sb.from("cash_movements").insert({
    user_id:           user.user.id,
    type,
    currency,
    amount,
    balance_after_chf: afterCash.CHF,
    balance_after_usd: afterCash.USD,
    balance_after_eur: afterCash.EUR,
    note:              opts?.note ?? null,
    ref_ticker:        opts?.ticker ?? null,
    ref_portfolio_id:  opts?.portfolioId ?? null,
    date:              opts?.date ?? new Date().toISOString(),
  }).select("id").single()
  if (error) console.error("[insertCashMovement]", error.message)
  return data?.id ?? null
}

// ─── Portfolios ───────────────────────────────────────────────────────────────

export async function fetchPortfolios(): Promise<Portfolio[] | null> {
  const sb = createClient()
  if (!sb) return null

  // Double protection: RLS + filtre explicite user_id
  const { data: user } = await sb.auth.getUser()
  if (!user.user) return []

  const { data: portfoliosData, error: pErr } = await sb
    .from("portfolios")
    .select("*")
    .eq("user_id", user.user.id)
    .order("created_at", { ascending: true })

  if (pErr || !portfoliosData) return null

  // Assets filtrés via les portfolio_ids de l'user
  const portfolioIds = portfoliosData.map(p => p.id)
  const { data: assetsData } = portfolioIds.length > 0
    ? await sb.from("assets").select("*").in("portfolio_id", portfolioIds)
    : { data: [] }

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
        costBasisChf:   Number(a.cost_basis_chf ?? Number(a.quantity) * Number(a.avg_buy_price)),
        costBasisSource: a.cost_basis_source ?? "backfill",
        costBasisUpdatedAt: a.cost_basis_updated_at ?? undefined,
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
    cost_basis_chf: asset.costBasisChf ?? asset.quantity * asset.avgBuyPrice,
    cost_basis_source: asset.costBasisSource ?? "computed",
    cost_basis_updated_at: asset.costBasisUpdatedAt ?? new Date().toISOString(),
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

  // Filtre explicite : uniquement les transactions des portfolios de l'user
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return []
  const { data: userPortfolios } = await sb.from("portfolios").select("id").eq("user_id", user.id)
  const pIds = (userPortfolios ?? []).map((p: { id: string }) => p.id)
  if (pIds.length === 0) return []

  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .in("portfolio_id", pIds)
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
    fxRateToChf: Number(t.fx_rate_to_chf ?? 1),
    grossAmountChf: Number(t.gross_amount_chf ?? 0),
    feesChf: Number(t.fees_chf ?? 0),
    netAmountChf: Number(t.net_amount_chf ?? 0),
    realizedPnlChf: Number(t.realized_pnl_chf ?? 0),
    date:        t.date,
    notes:       t.notes ?? undefined,
  }))
}

export async function createTransaction(tx: Omit<Transaction, "id">) {
  const sb = createClient()
  if (!sb) return null

  const { data, error } = await sb.from("transactions").insert({
    asset_id:     tx.assetId ?? null,  // ← Nouvelle colonne : asset_id en priorité
    portfolio_id: tx.portfolioId,
    ticker:       tx.ticker,
    asset_name:   tx.assetName,
    asset_class:  tx.assetClass,
    type:         tx.type,
    quantity:     tx.quantity,
    price:        tx.price,
    fees:         tx.fees,
    currency:     tx.currency ?? "CHF",
    fx_rate_to_chf: tx.fxRateToChf ?? 1,
    gross_amount_chf: tx.grossAmountChf ?? 0,
    fees_chf: tx.feesChf ?? 0,
    net_amount_chf: tx.netAmountChf ?? 0,
    realized_pnl_chf: tx.realizedPnlChf ?? 0,
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

/**
 * Update transaction AND recalculate affected asset metrics.
 * Returns {ok: true} on success, or {ok: false, error: string} if validation fails.
 */
export async function updateTransactionAndRecalculate(
  id: string,
  updates: Partial<Omit<Transaction, "id">>
): Promise<{ ok: boolean; error?: string }> {
  const sb = createClient()
  if (!sb) return { ok: false, error: "Supabase not configured" }

  try {
    // 1. Fetch the transaction to update (to know which asset to recalculate)
    const { data: oldTx, error: fetchErr } = await sb
      .from("transactions")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchErr || !oldTx) {
      return { ok: false, error: "Transaction not found" }
    }

    // 2. Update the transaction
    const { error: updateErr } = await sb.from("transactions").update({
      ticker:      updates.ticker ?? oldTx.ticker,
      asset_name:  updates.assetName ?? oldTx.asset_name,
      asset_class: updates.assetClass ?? oldTx.asset_class,
      type:        updates.type ?? oldTx.type,
      quantity:    updates.quantity ?? oldTx.quantity,
      price:       updates.price ?? oldTx.price,
      fees:        updates.fees ?? oldTx.fees,
      currency:    updates.currency ?? oldTx.currency,
      fx_rate_to_chf: updates.fxRateToChf ?? oldTx.fx_rate_to_chf,
      gross_amount_chf: updates.grossAmountChf ?? oldTx.gross_amount_chf,
      fees_chf: updates.feesChf ?? oldTx.fees_chf,
      net_amount_chf: updates.netAmountChf ?? oldTx.net_amount_chf,
      realized_pnl_chf: updates.realizedPnlChf ?? oldTx.realized_pnl_chf,
      date:        updates.date ?? oldTx.date,
      notes:       updates.notes ?? oldTx.notes,
    }).eq("id", id)

    if (updateErr) {
      return { ok: false, error: `Update failed: ${updateErr.message}` }
    }

    // 3. Recalculate asset if this was a buy/sell (not cash-related)
    if (oldTx.asset_id && ["buy", "sell"].includes(oldTx.type)) {
      const { data: remainingTx, error: txErr } = await sb
        .from("transactions")
        .select("*")
        .eq("asset_id", oldTx.asset_id)
        .in("type", ["buy", "sell"])
        .order("date", { ascending: true })

      if (txErr) {
        console.error("[updateTransactionAndRecalculate] Error fetching transactions:", txErr)
        return { ok: false, error: "Failed to recalculate asset" }
      }

      // Reconstruct asset metrics from all transactions
      let newQty = 0
      let totalQtyBought = 0
      let totalBuyCostChf = 0

      for (const t of remainingTx || []) {
        if (t.type === "buy") {
          newQty += Number(t.quantity)
          totalQtyBought += Number(t.quantity)
          totalBuyCostChf += Number(t.net_amount_chf ?? 0)
        } else if (t.type === "sell") {
          newQty -= Number(t.quantity)
        }
      }

      const newAvgBuyPrice = totalQtyBought > 0 ? totalBuyCostChf / totalQtyBought : 0

      // Cost basis remaining = remaining qty × avg buy price (includes fees proportionally)
      // Example after selling 1: 0.2 × 80.83 = 16.1667 CHF (not 97 CHF)
      const newCostBasisChf = Math.max(0, newQty) * newAvgBuyPrice

      const { error: updateAssetErr } = await sb
        .from("assets")
        .update({
          quantity: Math.max(0, newQty),
          avg_buy_price: newAvgBuyPrice,
          cost_basis_chf: newCostBasisChf,
          cost_basis_source: "computed",
          cost_basis_updated_at: new Date().toISOString(),
        })
        .eq("id", oldTx.asset_id)

      if (updateAssetErr) {
        console.error("[updateTransactionAndRecalculate] Error updating asset:", updateAssetErr)
        return { ok: false, error: "Failed to update asset metrics" }
      }
    }

    return { ok: true }
  } catch (e) {
    console.error("[updateTransactionAndRecalculate] Exception:", e)
    return { ok: false, error: String(e) }
  }
}

/**
 * Delete a transaction AND recalculate the affected asset.
 * Returns {ok: true} on success, or {ok: false, error: string} if validation fails.
 */
export async function deleteTransactionAndRecalculate(id: string): Promise<{ ok: boolean; error?: string }> {
  const sb = createClient()
  if (!sb) return { ok: false, error: "Supabase not configured" }

  try {
    // 1. Fetch the transaction to delete (to know which asset to recalculate)
    const { data: tx, error: fetchErr } = await sb
      .from("transactions")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchErr || !tx) {
      return { ok: false, error: "Transaction not found" }
    }

    // 2. Delete the transaction
    const { error: deleteErr } = await sb.from("transactions").delete().eq("id", id)
    if (deleteErr) {
      return { ok: false, error: `Delete failed: ${deleteErr.message}` }
    }

    // 3. If this was a buy/sell (not cash-related), recalculate the asset
    if (tx.asset_id && ["buy", "sell"].includes(tx.type)) {
      // Fetch all remaining transactions for this asset to recalculate qty/avgPrice/costBasis
      const { data: remainingTx, error: txErr } = await sb
        .from("transactions")
        .select("*")
        .eq("asset_id", tx.asset_id)
        .in("type", ["buy", "sell"])
        .order("date", { ascending: true })

      if (txErr) {
        console.error("[deleteTransactionAndRecalculate] Error fetching remaining transactions:", txErr)
        return { ok: false, error: "Failed to recalculate asset" }
      }

      // Reconstruct asset metrics from remaining transactions
      let newQty = 0
      let totalQtyBought = 0
      let totalBuyCostChf = 0

      for (const t of remainingTx || []) {
        if (t.type === "buy") {
          newQty += Number(t.quantity)
          totalQtyBought += Number(t.quantity)
          totalBuyCostChf += Number(t.net_amount_chf ?? 0)  // Includes fees
        } else if (t.type === "sell") {
          newQty -= Number(t.quantity)
        }
      }

      // Calculate avg buy price including fees: totalBuyCostChf / totalQtyBought
      // Example: 1.2 shares @ 80 CHF + 1 CHF fees = 97 CHF total → 97/1.2 = 80.83 per share
      const newAvgBuyPrice = totalQtyBought > 0 ? totalBuyCostChf / totalQtyBought : 0

      // Cost basis remaining = remaining qty × avg buy price (includes fees proportionally)
      // Example after selling 1: 0.2 × 80.83 = 16.1667 CHF (not 97 CHF)
      const newCostBasisChf = Math.max(0, newQty) * newAvgBuyPrice

      // Update the asset
      const { error: updateErr } = await sb
        .from("assets")
        .update({
          quantity: Math.max(0, newQty),
          avg_buy_price: newAvgBuyPrice,
          cost_basis_chf: newCostBasisChf,
          cost_basis_source: "computed",
          cost_basis_updated_at: new Date().toISOString(),
        })
        .eq("id", tx.asset_id)

      if (updateErr) {
        console.error("[deleteTransactionAndRecalculate] Error updating asset:", updateErr)
        return { ok: false, error: "Failed to update asset metrics" }
      }
    }

    return { ok: true }
  } catch (e) {
    console.error("[deleteTransactionAndRecalculate] Exception:", e)
    return { ok: false, error: String(e) }
  }
}
// ─── Asset upsert from transaction ────────────────────────────────────────────

/**
 * Called before a BUY transaction to ensure the asset exists.
 * Returns the asset ID (new or existing).
 *
 * - If assetId provided → update that specific asset, return its ID
 * - Else if asset exists by portfolio_id + ticker → update it, return its ID (legacy fallback)
 * - Otherwise → insert a new asset row, return its ID
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
  costBasisChf?: number
  cryptoCustody?: string
  stakingEnabled?: boolean
  assetId?: string
}): Promise<string | null> {
  const sb = createClient()
  if (!sb) return null

  let existing: { id: string; quantity: string; avg_buy_price: string; cost_basis_chf: string | null } | null = null

  if (tx.assetId) {
    const { data } = await sb
      .from("assets")
      .select("id, quantity, avg_buy_price, cost_basis_chf")
      .eq("id", tx.assetId)
      .maybeSingle()
    existing = data
  } else {
    // Fallback: chercher par portfolio_id + ticker (legacy only)
    const { data } = await sb
      .from("assets")
      .select("id, quantity, avg_buy_price, cost_basis_chf")
      .eq("portfolio_id", tx.portfolioId)
      .eq("ticker", tx.ticker)
      .maybeSingle()
    existing = data
  }

  if (existing) {
    // Update existing asset
    const oldQty  = Number(existing.quantity)
    const oldAvg  = Number(existing.avg_buy_price)
    const oldCostBasisChf = Number(existing.cost_basis_chf ?? 0)
    const newQty  = oldQty + tx.quantity
    const newAvg  = (oldQty * oldAvg + tx.quantity * tx.price + (tx.fees ?? 0)) / newQty
    const buyCostBasisChf = tx.costBasisChf ?? (tx.quantity * tx.price + (tx.fees ?? 0))

    const update: Record<string, unknown> = {
      quantity: newQty,
      avg_buy_price: Number(newAvg.toFixed(4)),
      cost_basis_chf: Number((oldCostBasisChf + buyCostBasisChf).toFixed(8)),
      cost_basis_source: "computed",
      cost_basis_updated_at: new Date().toISOString(),
    }
    if (tx.assetClass === "crypto") {
      if (tx.cryptoCustody) update.crypto_custody = tx.cryptoCustody
      if (tx.stakingEnabled !== undefined) update.staking_enabled = tx.stakingEnabled
    }

    const { error } = await sb.from("assets")
      .update(update)
      .eq("id", existing.id)

    if (error) console.error("[upsertAssetFromBuy] update error:", error.message, error.details)
    return existing.id  // ← Return the asset ID
  } else {
    // Insert new asset
    const buyCostBasisChf = tx.costBasisChf ?? (tx.quantity * tx.price + (tx.fees ?? 0))

    const { data, error } = await sb.from("assets").insert({
      portfolio_id:  tx.portfolioId,
      ticker:        tx.ticker,
      name:          tx.assetName,
      asset_class:   tx.assetClass,
      quantity:      tx.quantity,
      avg_buy_price: tx.quantity > 0 ? tx.price + ((tx.fees ?? 0) / tx.quantity) : tx.price,
      currency:      tx.currency ?? "CHF",
      cost_basis_chf: buyCostBasisChf,
      cost_basis_source: tx.costBasisChf ? "computed" : "backfill",
      cost_basis_updated_at: new Date().toISOString(),
      crypto_custody: tx.assetClass === "crypto" ? tx.cryptoCustody : undefined,
      staking_enabled: tx.assetClass === "crypto" ? Boolean(tx.stakingEnabled) : undefined,
    }).select().single()

    if (error) {
      console.error("[upsertAssetFromBuy] insert error:", error.message, error.details)
      return null
    }
    return data?.id ?? null  // ← Return the newly created asset ID
  }
}

/**
 * Called after a SELL transaction — reduces the asset quantity.
 * If quantity reaches 0 or below, the asset is deleted.
 *
 * assetId is REQUIRED for sells — we must know exactly which asset to reduce.
 */
export async function reduceAssetFromSell(tx: {
  portfolioId: string
  ticker:      string
  quantity:    number
  soldCostBasisChf?: number
  assetId?: string  // ← NEW: prioritaire si fourni
}) {
  const sb = createClient()
  if (!sb) return

  let existing: { id: string; quantity: string; cost_basis_chf: string | null } | null = null

  if (tx.assetId) {
    // Use assetId directly
    const { data } = await sb
      .from("assets")
      .select("id, quantity, cost_basis_chf")
      .eq("id", tx.assetId)
      .maybeSingle()
    existing = data
  } else {
    // Fallback: chercher par portfolio_id + ticker (legacy, risky for sells)
    const { data } = await sb
      .from("assets")
      .select("id, quantity, cost_basis_chf")
      .eq("portfolio_id", tx.portfolioId)
      .eq("ticker", tx.ticker)
      .maybeSingle()
    existing = data
  }

  if (!existing) return

  const newQty = Number(existing.quantity) - tx.quantity
  const oldQty = Number(existing.quantity)
  const oldCostBasisChf = Number(existing.cost_basis_chf ?? 0)
  const proportionalCost = oldQty > 0 ? oldCostBasisChf * (tx.quantity / oldQty) : 0
  const soldCostBasisChf = tx.soldCostBasisChf ?? proportionalCost

  if (newQty <= 0) {
    await sb.from("assets").delete().eq("id", existing.id)
  } else {
    await sb.from("assets").update({
      quantity: Number(newQty.toFixed(8)),
      cost_basis_chf: Number(Math.max(0, oldCostBasisChf - soldCostBasisChf).toFixed(8)),
      cost_basis_source: "computed",
      cost_basis_updated_at: new Date().toISOString(),
    }).eq("id", existing.id)
  }
}

export async function updateAssetCostBasisChf(assetId: string, costBasisChf: number) {
  const sb = createClient()
  if (!sb) return false

  const { error } = await sb
    .from("assets")
    .update({
      cost_basis_chf: costBasisChf,
      cost_basis_source: "manual",
      cost_basis_updated_at: new Date().toISOString(),
    })
    .eq("id", assetId)

  if (error) console.error("[updateAssetCostBasisChf]", error.message)
  return !error
}

/** Modifie directement la quantité et le prix moyen d'une position existante */
export async function updateAssetPosition(
  assetId: string,
  qty: number,
  avgBuyPrice: number,
  costBasisChf?: number,
) {
  const sb = createClient()
  if (!sb) return false
  const { error } = await sb
    .from("assets")
    .update({
      quantity:               qty,
      avg_buy_price:          avgBuyPrice,
      cost_basis_chf:         costBasisChf ?? null,
      cost_basis_source:      "manual",
      cost_basis_updated_at:  new Date().toISOString(),
    })
    .eq("id", assetId)
  if (error) console.error("[updateAssetPosition]", error.message)
  return !error
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
    .eq("user_id", user.id)
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
