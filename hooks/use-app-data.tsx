"use client"

import {
  createContext, useContext, useState, useMemo,
  useEffect, useCallback, type ReactNode,
} from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import type { Portfolio, Transaction, Asset, RevenuAnnexe, CashBalance, GlobalCash, CashMovement } from "@/lib/types"
import { EMPTY_CASH_BALANCE, EMPTY_GLOBAL_CASH } from "@/lib/types"
import { calculateRealizedPnLEvents, calculateTransactionChfAmounts, chfPerCurrencyUnit, type RealizedPnLEvent } from "@/lib/finance"
import { useCurrency } from "@/hooks/use-currency"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppData {
  // State
  portfolios:    Portfolio[]
  transactions:  Transaction[]
  revenus:       RevenuAnnexe[]
  /** Liquidité globale (toutes devises, commune à tous les portfolios) */
  globalCash:    GlobalCash
  cashMovements: CashMovement[]
  loading:       boolean
  realizedPnLEvents: RealizedPnLEvent[]
  totalRealizedPnL: number
  // Portfolio mutations
  addPortfolio:    (p: Omit<Portfolio, "id" | "assets">) => Promise<string | null>
  removePortfolio: (id: string) => Promise<void>
  addAsset:        (portfolioId: string, asset: Omit<Asset, "currentPrice">) => Promise<void>
  removeAsset:     (portfolioId: string, assetId: string) => Promise<void>
  /** Modifie directement quantité + prix moyen d'une position (sans créer de transaction) */
  editAsset:       (portfolioId: string, assetId: string, qty: number, avgBuyPrice: number, costBasisChf?: number) => Promise<void>
  updateAssetCostBasis: (portfolioId: string, assetId: string, costBasisChf: number) => Promise<void>
  // Transaction mutations
  addTransaction:    (tx: Omit<Transaction, "id">) => Promise<{ ok: boolean; error?: string }>
  editTransaction:   (id: string, updates: Partial<Omit<Transaction, "id">>) => Promise<void>
  removeTransaction: (id: string) => Promise<void>
  // Revenus Annexes mutations
  addRevenu:    (rev: Omit<RevenuAnnexe, "id" | "createdAt" | "userId">) => Promise<void>
  removeRevenu: (id: string) => Promise<void>
  // ── Liquidité globale (nouvelle logique) ──────────────────────────────────
  /** Dépose du cash dans la réserve globale */
  depositGlobalCash: (amount: number, currency: keyof GlobalCash, note?: string) => Promise<void>
  /** Retire du cash de la réserve globale */
  withdrawGlobalCash: (amount: number, currency: keyof GlobalCash, note?: string) => Promise<{ ok: boolean; error?: string }>
  /** Convertit du cash entre devises (ex: 100 CHF → USD) */
  convertGlobalCash: (fromCurrency: keyof GlobalCash, toCurrency: keyof GlobalCash, fromAmount: number) => Promise<{ ok: boolean; error?: string }>
  /** Total de la liquidité globale convertie en CHF */
  globalCashInChf: () => number
  // Rétrocompatibilité (deprecated)
  /** @deprecated Utiliser depositGlobalCash */
  depositCash:   (portfolioId: string, amount: number, currency: keyof CashBalance) => Promise<void>
  /** @deprecated Utiliser globalCash directement */
  getAvailableCash: (portfolioId: string, currency: keyof CashBalance) => number
  // Refresh
  refresh: () => Promise<void>
}

const DEFAULT: AppData = {
  portfolios: [], transactions: [], revenus: [], globalCash: { ...EMPTY_GLOBAL_CASH },
  cashMovements: [], loading: true,
  realizedPnLEvents: [], totalRealizedPnL: 0,
  addPortfolio:    async () => null,
  removePortfolio: async () => {},
  addAsset:        async () => {},
  removeAsset:     async () => {},
  editAsset:       async () => {},
  updateAssetCostBasis: async () => {},
  addTransaction:    async () => ({ ok: true }),
  editTransaction:   async () => {},
  removeTransaction: async () => {},
  addRevenu:    async () => {},
  removeRevenu: async () => {},
  depositGlobalCash:   async () => {},
  withdrawGlobalCash:  async () => ({ ok: true }),
  convertGlobalCash:   async () => ({ ok: true }),
  globalCashInChf: () => 0,
  depositCash:  async () => {},
  getAvailableCash: () => 0,
  refresh: async () => {},
}

const AppDataContext = createContext<AppData>(DEFAULT)

// ─── Provider — single fetch, shared across all pages ────────────────────────

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { fxRates } = useCurrency()
  const [portfolios,    setPortfolios]    = useState<Portfolio[]>([])
  const [transactions,  setTransactions]  = useState<Transaction[]>([])
  const [revenus,       setRevenus]       = useState<RevenuAnnexe[]>([])
  const [globalCash,    setGlobalCash]    = useState<GlobalCash>({ ...EMPTY_GLOBAL_CASH })
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([])
  const [loading,       setLoading]       = useState(isSupabaseConfigured)
  const realizedPnLEvents = useMemo(() => calculateRealizedPnLEvents(transactions), [transactions])
  const totalRealizedPnL = useMemo(
    () => realizedPnLEvents.reduce((sum, event) => sum + event.pnl, 0),
    [realizedPnLEvents]
  )

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    try {
      const [p, t, r, gc, cm] = await Promise.all([
        Q.fetchPortfolios(),
        Q.fetchTransactions(),
        Q.fetchRevenus(),
        Q.fetchGlobalCash(),
        Q.fetchCashMovements(200),
      ])
      if (p)  setPortfolios(p)
      if (t)  setTransactions(t)
      if (r)  setRevenus(r)
      if (gc) setGlobalCash(gc)
      if (cm) setCashMovements(cm)

      // ── MIGRATION AUTO : corrige les costBasisChf corrompus (1 fois par session) ──
      // Si costBasisChf ≈ qty × avgBuyPrice (ratio ~1.0) → valeur stockée sans FX
      // → on recalcule via API BCE avec la date des transactions d'achat
      if (p && t) await migrateCorruptedCostBasis(p, t)
    } catch (e) {
      console.error("[AppData] refresh failed:", e)
    }
    setLoading(false)
  }, [])

  // ── Migration silencieuse — exécutée 1× par session pour les anciens assets ──
  const [migrated, setMigrated] = useState(false)
  async function migrateCorruptedCostBasis(portfolios: Portfolio[], transactions: Transaction[]) {
    if (migrated) return
    setMigrated(true)
    // Note: la fonction est protégée par la condition Math.abs(current - totalCostChf) < 1
    // donc si tous les costBasisChf sont corrects, aucun update DB n'est fait.

    const fixes: Array<{ assetId: string; portfolioId: string; qty: number; avg: number; newCostChf: number }> = []

    // RÈGLE SIMPLE: pour TOUTE position non-CHF qui a au moins 1 transaction buy,
    // on recalcule TOUJOURS le cost_basis_chf via les taux BCE historiques.
    // Plus de détection "ratio" fragile : la vérité = somme des CHF réellement payés.
    for (const p of portfolios) {
      for (const a of p.assets) {
        if (a.assetClass === "cash") continue
        const native = a.currency
        if (!native || native === "CHF") continue

        // ── RÈGLE: coût CHF de la position résiduelle ──────────────────────
        // newCostChf = quantité_actuelle × avgBuyPrice_natif × tauxBCE_pondéré
        // Où tauxBCE_pondéré = moyenne des taux historiques de TOUS les buys
        // pondérée par le montant natif de chaque achat.
        //
        // Cela évite le bug de "somme des transactions" si l'utilisateur a fait
        // plusieurs achats puis des sells (qty réduite mais somme des buys gonflée).

        const buys = transactions.filter(t => t.portfolioId === p.id && t.ticker === a.ticker && t.type === "buy")
        if (!buys.length) continue

        let totalNative   = 0  // somme native pour pondération
        let weightedRate  = 0  // Σ (montant_natif × rate)
        let allFetched    = true

        for (const tx of buys) {
          try {
            const res = await fetch(`/api/fx-rates-historical?date=${tx.date}&currency=${tx.currency}`)
            if (!res.ok) { allFetched = false; break }
            const hist = await res.json() as { rate: number }
            const rate = hist.rate ?? 1
            if (rate <= 0) { allFetched = false; break }
            const nativeAmount = tx.quantity * tx.price
            totalNative  += nativeAmount
            weightedRate += nativeAmount * rate  // attention: rate = native/CHF
          } catch { allFetched = false; break }
        }

        if (!allFetched || totalNative <= 0) continue

        // Taux pondéré = Σ(nativeAmount × rate) / Σ(nativeAmount)
        // Coût CHF = qty_actuelle × avgBuyPrice / tauxPondéré
        const avgRate     = weightedRate / totalNative
        const nativeCurrentTotal = a.quantity * a.avgBuyPrice
        const newCostChf  = nativeCurrentTotal / avgRate

        if (newCostChf <= 0) continue

        const current = a.costBasisChf ?? 0
        if (Math.abs(current - newCostChf) < 1) continue

        fixes.push({ assetId: a.id, portfolioId: p.id, qty: a.quantity, avg: a.avgBuyPrice, newCostChf })
      }
    }

    // Applique les corrections silencieusement
    for (const f of fixes) {
      try {
        await Q.updateAssetPosition(f.assetId, f.qty, f.avg, f.newCostChf)
      } catch { /* skip */ }
    }
    if (fixes.length > 0) {
      console.log(`[AppData] Migration: ${fixes.length} asset(s) corrigé(s) avec taux BCE historiques`)
      const fresh = await Q.fetchPortfolios()
      if (fresh) setPortfolios(fresh)
    }
  }

  useEffect(() => { refresh() }, [refresh])

  // ── Portfolio mutations ──────────────────────────────────────────────────────

  async function addPortfolio(p: Omit<Portfolio, "id" | "assets">): Promise<string | null> {
    if (!isSupabaseConfigured) {
      const id = `local-${Date.now()}`
      setPortfolios(prev => [...prev, { ...p, id, assets: [] }])
      return id
    }
    const result = await Q.createPortfolio(p)
    if (result) { await refresh(); return result.id }
    return null
  }

  async function removePortfolio(id: string) {
    setPortfolios(prev => prev.filter(p => p.id !== id))
    if (isSupabaseConfigured) await Q.deletePortfolio(id)
  }

  async function addAsset(portfolioId: string, asset: Omit<Asset, "currentPrice">) {
    // Optimistic
    const local: Asset = {
      ...asset,
      currentPrice: asset.avgBuyPrice,
      costBasisChf: asset.costBasisChf ?? asset.quantity * asset.avgBuyPrice,
      costBasisSource: asset.costBasisSource ?? ("computed" as const),
      costBasisUpdatedAt: asset.costBasisUpdatedAt ?? new Date().toISOString(),
    }
    setPortfolios(prev => prev.map(p =>
      p.id === portfolioId ? { ...p, assets: [...p.assets, local] } : p
    ))
    if (isSupabaseConfigured) {
      try { await Q.createAsset(asset) }
      catch (e) { console.error("[AppData] addAsset failed:", e); await refresh() }
    }
  }

  async function removeAsset(portfolioId: string, assetId: string) {
    setPortfolios(prev => prev.map(p =>
      p.id === portfolioId ? { ...p, assets: p.assets.filter(a => a.id !== assetId) } : p
    ))
    if (isSupabaseConfigured) {
      try { await Q.deleteAsset(assetId) }
      catch (e) { console.error("[AppData] removeAsset failed:", e); await refresh() }
    }
  }

  async function editAsset(portfolioId: string, assetId: string, qty: number, avgBuyPrice: number, costBasisChf?: number) {
    // Optimistic update
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p
      return {
        ...p,
        assets: p.assets.map(a => a.id !== assetId ? a : {
          ...a,
          quantity:    qty,
          avgBuyPrice: avgBuyPrice,
          costBasisChf:       costBasisChf ?? qty * avgBuyPrice,
          costBasisSource:    "manual" as const,
          costBasisUpdatedAt: new Date().toISOString(),
        }),
      }
    }))
    if (isSupabaseConfigured) {
      try {
        await Q.updateAssetPosition(assetId, qty, avgBuyPrice, costBasisChf ?? qty * avgBuyPrice)
      } catch (e) {
        console.error("[AppData] editAsset failed:", e)
        await refresh()
      }
    }
  }

  async function updateAssetCostBasis(portfolioId: string, assetId: string, costBasisChf: number) {
    const updatedAt = new Date().toISOString()
    setPortfolios(prev => prev.map(p =>
      p.id === portfolioId
        ? {
            ...p,
            assets: p.assets.map(a =>
              a.id === assetId
                ? { ...a, costBasisChf, costBasisSource: "manual" as const, costBasisUpdatedAt: updatedAt }
                : a
            ),
          }
        : p
    ))

    if (isSupabaseConfigured) {
      try { await Q.updateAssetCostBasisChf(assetId, costBasisChf) }
      catch (e) { console.error("[AppData] updateAssetCostBasis failed:", e); await refresh() }
    }
  }

  // ── Transaction mutations ────────────────────────────────────────────────────

  async function addTransaction(tx: Omit<Transaction, "id">): Promise<{ ok: boolean; error?: string }> {
    // ── Taux FX historique au moment de la transaction ──────────────────────
    // Si la devise est différente du CHF ET qu'on a une date → on fetch
    // le taux BCE historique pour cette date exacte.
    // Cela garantit que costBasisChf = vrai CHF sorti du compte le jour de l'achat.
    let txFxRates = { ...fxRates }
    if (tx.type === "buy" && tx.currency && tx.currency !== "CHF" && tx.date) {
      try {
        const res = await fetch(
          `/api/fx-rates-historical?date=${tx.date}&currency=${tx.currency}`
        )
        if (res.ok) {
          const hist = await res.json() as { rate: number; source: string }
          if (hist.rate && hist.rate > 0) {
            txFxRates = { ...fxRates, [tx.currency]: hist.rate }
          }
        }
      } catch { /* fallback to current */ }
    }

    const rateToChf = (curr: string | undefined) => {
      return chfPerCurrencyUnit(curr, txFxRates)
    }

    const existingAsset = portfolios
      .find(p => p.id === tx.portfolioId)
      ?.assets.find(a => a.ticker === tx.ticker)

    const assetCostBasisChf = existingAsset?.costBasisChf
      ?? (existingAsset ? existingAsset.quantity * existingAsset.avgBuyPrice * rateToChf(existingAsset.currency) : 0)
    const amounts = calculateTransactionChfAmounts({
      type: tx.type,
      quantity: tx.quantity,
      price: tx.price,
      fees: tx.fees,
      currency: tx.currency,
      fxRates: txFxRates,   // ← taux historique
      assetQuantity: existingAsset?.quantity,
      assetCostBasisChf,
    })
    const grossAmountChf = tx.grossAmountChf ?? amounts.grossAmountChf
    const feesChf = tx.feesChf ?? amounts.feesChf
    const netAmountChf = tx.netAmountChf ?? amounts.netAmountChf
    const soldCostBasisChf = amounts.soldCostBasisChf
    const realizedPnlChf = tx.type === "sell" ? (tx.realizedPnlChf ?? amounts.realizedPnlChf) : (tx.realizedPnlChf ?? 0)

    // ── Validations métier ───────────────────────────────────────────────────
    if (tx.type === "sell") {
      const asset = existingAsset
      if (!asset) return { ok: false, error: "Position introuvable pour cette vente." }
      if (tx.quantity <= 0) return { ok: false, error: "La quantité vendue doit être positive." }
      if (tx.quantity > asset.quantity) {
        return { ok: false, error: `Quantité vendue trop élevée. Disponible: ${asset.quantity}.` }
      }
    }

    // ── Pour BUY/SELL: créer/mettre à jour l'asset AVANT la transaction ──
    let assetIdForTx = existingAsset?.id
    if ((tx.type === "buy" || tx.type === "sell") && tx.assetClass !== "cash") {
      if (tx.type === "buy" && !isSupabaseConfigured) {
        // Mode local: garder assetId temporaire
        if (!assetIdForTx) assetIdForTx = `local-${Date.now()}`
      } else if (isSupabaseConfigured) {
        // Mode Supabase: upsertAsset AVANT createTransaction pour avoir l'ID réel
        if (tx.type === "buy") {
          const newAssetId = await Q.upsertAssetFromBuy({
            portfolioId: tx.portfolioId,
            ticker:      tx.ticker,
            assetName:   tx.assetName,
            assetClass:  tx.assetClass,
            quantity:    tx.quantity,
            price:       tx.price,
            fees:        tx.fees,
            currency:    tx.currency ?? "CHF",
            costBasisChf: netAmountChf,
            cryptoCustody: tx.cryptoCustody,
            stakingEnabled: tx.stakingEnabled,
            assetId: assetIdForTx,  // Passer l'ID existant si présent
          })
          if (newAssetId) {
            assetIdForTx = newAssetId
          } else {
            return { ok: false, error: "Erreur lors de la création/mise à jour de l'actif." }
          }
        }
      }
    }

    const preparedTx: Omit<Transaction, "id"> = {
      ...tx,
      assetId: assetIdForTx,  // ← Inclure asset_id (obligatoire pour buy/sell non-cash)
      fxRateToChf: tx.fxRateToChf ?? amounts.fxRateToChf,
      grossAmountChf,
      feesChf,
      netAmountChf,
      realizedPnlChf,
    }

    if (tx.type === "buy" && tx.assetClass !== "cash") {
      // ── Validation liquidité GLOBALE avec cross-devise ────────────────────
      const nativeCurr = (tx.currency ?? "CHF") as keyof GlobalCash
      const totalCostNative = tx.quantity * tx.price + (tx.fees ?? 0)
      const fxN = (fxRates as Record<string,number>)[nativeCurr] ?? 1
      const costChf = totalCostNative / fxN  // coût en CHF

      const cashChf = globalCash.CHF
      const cashUsd = globalCash.USD
      const cashEur = globalCash.EUR
      const fxUsd = (fxRates as Record<string,number>)["USD"] ?? 1
      const fxEur = (fxRates as Record<string,number>)["EUR"] ?? 1
      const totalGlobalInChf = cashChf + cashUsd / fxUsd + cashEur / fxEur

      // Bloquer si liquidité globale insuffisante
      if (totalGlobalInChf > 0 && costChf > totalGlobalInChf) {
        return {
          ok: false,
          error: `Liquidité insuffisante. Requis : ${costChf.toFixed(2)} CHF — Disponible : ${totalGlobalInChf.toFixed(2)} CHF (manque ${(costChf - totalGlobalInChf).toFixed(2)} CHF).`,
        }
      }
    }

    const tempId = `local-${Date.now()}`

    // ── 1. Optimistic update: add transaction ────────────────────────────────
    setTransactions(prev => [{ ...preparedTx, id: tempId }, ...prev])

    // ── 2. Optimistic update: sync portfolio assets ──────────────────────────
    if (preparedTx.type === "buy") {
      setPortfolios(prev => prev.map(p => {
        if (p.id !== preparedTx.portfolioId) return p
        const existing = p.assets.find(a => a.ticker === preparedTx.ticker)
        if (existing) {
          // Update qty + weighted avg price
          const newQty = existing.quantity + preparedTx.quantity
          const newAvg = (existing.quantity * existing.avgBuyPrice + preparedTx.quantity * preparedTx.price + preparedTx.fees) / newQty
          const nextCostBasisChf = (existing.costBasisChf ?? existing.quantity * existing.avgBuyPrice * rateToChf(existing.currency)) + netAmountChf
          return {
            ...p,
            assets: p.assets.map(a =>
              a.ticker === preparedTx.ticker
                ? {
                    ...a,
                    quantity: newQty,
                    avgBuyPrice: newAvg,
                    costBasisChf: nextCostBasisChf,
                    costBasisSource: "computed" as const,
                    costBasisUpdatedAt: new Date().toISOString(),
                  }
                : a
            ),
          }
        } else {
          // New position
          const newAsset: Asset = {
            id: `local-${Date.now()}`,
            portfolioId:  preparedTx.portfolioId,
            ticker:       preparedTx.ticker,
            name:         preparedTx.assetName,
            assetClass:   preparedTx.assetClass,
            quantity:     preparedTx.quantity,
            avgBuyPrice:  preparedTx.quantity > 0 ? preparedTx.price + (preparedTx.fees / preparedTx.quantity) : preparedTx.price,
            currentPrice: preparedTx.price,
            currency:     preparedTx.currency ?? "CHF",
            costBasisChf: netAmountChf,
            costBasisSource: "computed" as const,
            costBasisUpdatedAt: new Date().toISOString(),
            cryptoCustody: preparedTx.cryptoCustody,
            stakingEnabled: preparedTx.stakingEnabled,
          }
          return { ...p, assets: [...p.assets, newAsset] }
        }
      }))
    } else if (preparedTx.type === "sell") {
      setPortfolios(prev => prev.map(p => {
        if (p.id !== preparedTx.portfolioId) return p
        return {
          ...p,
          assets: p.assets
            .map(a => a.ticker === preparedTx.ticker
              ? {
                  ...a,
                  quantity: a.quantity - preparedTx.quantity,
                  costBasisChf: Math.max(0, (a.costBasisChf ?? assetCostBasisChf) - soldCostBasisChf),
                  costBasisSource: "computed" as const,
                  costBasisUpdatedAt: new Date().toISOString(),
                }
              : a
            )
            .filter(a => a.quantity > 0),
        }
      }))
    }

    if (!isSupabaseConfigured) return { ok: true }  // local-only mode

    try {
      // ── 3. Save transaction to Supabase ──────────────────────────────────
      const result = await Q.createTransaction(preparedTx)
      if (!result) {
        // Revert optimistic updates
        setTransactions(prev => prev.filter(t => t.id !== tempId))
        await refresh()
        const msg = "Supabase: insert retourné null. Vérifiez les politiques RLS."
        console.error("[AppData] addTransaction:", msg, preparedTx)
        return { ok: false, error: msg }
      }

      setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: result.id } : t))

      // ── 4. Sync asset in Supabase ─────────────────────────────────────────
      // Note: upsertAssetFromBuy a déjà été appelé AVANT createTransaction
      // Ici on ne traite que les SELL
      if (preparedTx.type === "sell" && preparedTx.assetClass !== "cash") {
        await Q.reduceAssetFromSell({
          portfolioId: preparedTx.portfolioId,
          ticker:      preparedTx.ticker,
          quantity:    preparedTx.quantity,
          soldCostBasisChf,
          assetId: assetIdForTx,  // Obligatoire pour sells
        })
      }

      // ── 5. Update GLOBAL cash balance ────────────────────────────────────────
      // Achat  → déduit dans la devise native si dispo, sinon CHF converti
      // Vente  → crédite en devise native de l'actif
      if (tx.assetClass !== "cash") {
        const nativeCurr = (tx.currency ?? "CHF") as keyof GlobalCash
        if (tx.type === "buy") {
          const totalCostNative = tx.quantity * tx.price + (tx.fees ?? 0)
          const fxN = (fxRates as Record<string,number>)[nativeCurr] ?? 1
          const costChf = totalCostNative / fxN

          let newCash = { ...globalCash }
          if (nativeCurr !== "CHF" && newCash[nativeCurr] >= totalCostNative) {
            // Déduit en devise native directement
            newCash[nativeCurr] = Math.max(0, newCash[nativeCurr] - totalCostNative)
            await Q.insertCashMovement("buy_deduction", nativeCurr, -totalCostNative, newCash,
              { ticker: tx.ticker, portfolioId: tx.portfolioId })
          } else {
            // Déduit en CHF converti
            newCash.CHF = Math.max(0, newCash.CHF - costChf)
            await Q.insertCashMovement("buy_deduction", "CHF", -costChf, newCash,
              { ticker: tx.ticker, portfolioId: tx.portfolioId, note: `${totalCostNative.toFixed(2)} ${nativeCurr} converti` })
          }
          setGlobalCash(newCash)
          await Q.upsertGlobalCash(newCash)

        } else if (tx.type === "sell") {
          // Crédite en devise native de l'actif vendu
          const netProceeds = tx.quantity * tx.price - (tx.fees ?? 0)
          const newCash = { ...globalCash, [nativeCurr]: globalCash[nativeCurr] + netProceeds }
          await Q.insertCashMovement("sell_credit", nativeCurr, netProceeds, newCash,
            { ticker: tx.ticker, portfolioId: tx.portfolioId })
          setGlobalCash(newCash)
          await Q.upsertGlobalCash(newCash)
        }
      }

      // ── 6. Reload to get consistent state ─────────────────────────────────
      await refresh()
      return { ok: true }

    } catch (e) {
      const msg = String(e)
      console.error("[AppData] addTransaction exception:", msg)
      setTransactions(prev => prev.filter(t => t.id !== tempId))
      await refresh()
      return { ok: false, error: msg }
    }
  }

  async function editTransaction(id: string, updates: Partial<Omit<Transaction, "id">>) {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    if (isSupabaseConfigured) {
      try { await Q.updateTransaction(id, updates) }
      catch (e) { console.error("[AppData] editTransaction failed:", e); await refresh() }
    }
  }

  async function removeTransaction(id: string) {
    setTransactions(prev => prev.filter(t => t.id !== id))
    if (isSupabaseConfigured) {
      try { await Q.deleteTransaction(id) }
      catch (e) { console.error("[AppData] removeTransaction failed:", e); await refresh() }
    }
  }

  // ── Revenus Annexes ──────────────────────────────────────────────────────────

  async function addRevenu(rev: Omit<RevenuAnnexe, "id" | "createdAt" | "userId">) {
    const tempId = `local-${Date.now()}`
    const local: RevenuAnnexe = { ...rev, id: tempId, userId: "local", createdAt: new Date().toISOString() }
    setRevenus(prev => [local, ...prev])

    // ── Revenu annexe → crédite aussi la liquidité globale (pas de double comptage) ──
    // Le patrimoine = positions + cash global (les revenus expliquent l'ORIGINE du cash)
    const revCurrency = (rev.currency || "CHF") as keyof GlobalCash
    if (["CHF","USD","EUR"].includes(revCurrency)) {
      const newCash = { ...globalCash, [revCurrency]: globalCash[revCurrency] + rev.amount }
      setGlobalCash(newCash)
      if (isSupabaseConfigured) {
        await Q.upsertGlobalCash(newCash)
        await Q.insertCashMovement("revenue_credit", revCurrency, rev.amount, newCash,
          { note: rev.label ?? "Revenu annexe" })
      }
    }

    if (!isSupabaseConfigured) return
    try {
      const result = await Q.createRevenu(rev)
      if (result) setRevenus(prev => prev.map(r => r.id === tempId ? { ...r, id: result.id } : r))
      else        setRevenus(prev => prev.filter(r => r.id !== tempId))
    } catch (e) {
      console.error("[AppData] addRevenu failed:", e)
      setRevenus(prev => prev.filter(r => r.id !== tempId))
    }
  }

  async function removeRevenu(id: string) {
    setRevenus(prev => prev.filter(r => r.id !== id))
    if (isSupabaseConfigured) {
      try { await Q.deleteRevenu(id) }
      catch (e) { console.error("[AppData] removeRevenu failed:", e); await refresh() }
    }
  }

  // ── Liquidité globale ────────────────────────────────────────────────────────

  /** Total de la liquidité globale converti en CHF */
  function globalCashInChf(): number {
    const fxUsd = (fxRates as Record<string,number>)["USD"] ?? 1
    const fxEur = (fxRates as Record<string,number>)["EUR"] ?? 1
    return globalCash.CHF + globalCash.USD / fxUsd + globalCash.EUR / fxEur
  }

  /** Dépôt de liquidité globale — augmente le cash, PAS de P&L */
  async function depositGlobalCash(amount: number, currency: keyof GlobalCash, note?: string) {
    if (!amount || amount <= 0) return
    const newCash = { ...globalCash, [currency]: globalCash[currency] + amount }
    setGlobalCash(newCash)
    if (isSupabaseConfigured) {
      await Q.upsertGlobalCash(newCash)
      await Q.insertCashMovement("deposit", currency, amount, newCash, { note })
    }
    // Enregistre comme transaction pour l'historique
    const tx: Omit<Transaction, "id"> = {
      portfolioId: portfolios[0]?.id ?? "global",
      ticker:     currency,
      assetName:  `Dépôt ${currency}`,
      assetClass: "cash" as Transaction["assetClass"],
      type:       "deposit" as Transaction["type"],
      quantity:   1, price: amount, fees: 0,
      currency:   currency as unknown as Transaction["currency"],
      date:       new Date().toISOString().slice(0, 10),
      notes:      note,
    }
    const tempId = `local-${Date.now()}`
    setTransactions(prev => [{ ...tx, id: tempId } as Transaction, ...prev])
    if (isSupabaseConfigured) {
      const result = await Q.createTransaction(tx)
      if (result) setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: result.id } : t))
    }
  }

  /** Retrait de liquidité globale */
  async function withdrawGlobalCash(amount: number, currency: keyof GlobalCash, note?: string): Promise<{ ok: boolean; error?: string }> {
    // Arrondir à 8 décimales avant comparaison — évite 0.09999... < 0.10 = true (float JS)
    const available = Math.round(globalCash[currency] * 1e8) / 1e8
    const needed    = Math.round(amount * 1e8) / 1e8
    if (available < needed) {
      return { ok: false, error: `Solde insuffisant : ${globalCash[currency].toFixed(2)} ${currency} disponible, ${amount.toFixed(2)} requis.` }
    }
    const newCash = { ...globalCash, [currency]: globalCash[currency] - amount }
    setGlobalCash(newCash)
    if (isSupabaseConfigured) {
      await Q.upsertGlobalCash(newCash)
      await Q.insertCashMovement("withdrawal", currency, -amount, newCash, { note })
    }
    return { ok: true }
  }

  /** Conversion de devise dans la liquidité globale */
  async function convertGlobalCash(fromCurrency: keyof GlobalCash, toCurrency: keyof GlobalCash, fromAmount: number): Promise<{ ok: boolean; error?: string }> {
    if (globalCash[fromCurrency] < fromAmount) {
      return { ok: false, error: `Solde insuffisant en ${fromCurrency} : ${globalCash[fromCurrency].toFixed(2)} disponible.` }
    }
    const fxFrom = (fxRates as Record<string,number>)[fromCurrency] ?? 1
    const fxTo   = (fxRates as Record<string,number>)[toCurrency]   ?? 1
    const chfAmount = fromAmount / fxFrom
    const toAmount  = chfAmount * fxTo
    const newCash = {
      ...globalCash,
      [fromCurrency]: globalCash[fromCurrency] - fromAmount,
      [toCurrency]:   globalCash[toCurrency] + toAmount,
    }
    setGlobalCash(newCash)
    if (isSupabaseConfigured) {
      await Q.upsertGlobalCash(newCash)
      await Q.insertCashMovement("conversion", fromCurrency, -fromAmount, newCash,
        { note: `Converti ${fromAmount.toFixed(2)} ${fromCurrency} → ${toAmount.toFixed(2)} ${toCurrency}` })
    }
    return { ok: true }
  }

  // ── Rétrocompatibilité ────────────────────────────────────────────────────────
  /** @deprecated Utiliser depositGlobalCash */
  async function depositCash(portfolioId: string, amount: number, currency: keyof CashBalance) {
    await depositGlobalCash(amount, currency as keyof GlobalCash)
  }

  /** @deprecated Utiliser globalCash directement */
  function getAvailableCash(_portfolioId: string, currency: keyof CashBalance): number {
    return globalCash[currency as keyof GlobalCash] ?? 0
  }

  return (
    <AppDataContext.Provider value={{
      portfolios, transactions, revenus, globalCash, cashMovements, loading,
      realizedPnLEvents, totalRealizedPnL,
      addPortfolio, removePortfolio, addAsset, removeAsset, editAsset, updateAssetCostBasis,
      addTransaction, editTransaction, removeTransaction,
      addRevenu, removeRevenu,
      depositGlobalCash, withdrawGlobalCash, convertGlobalCash, globalCashInChf,
      depositCash, getAvailableCash,
      refresh,
    }}>
      {children}
    </AppDataContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAppData() {
  return useContext(AppDataContext)
}
