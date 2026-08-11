"use client"

import {
  createContext, useContext, useState, useMemo, useRef,
  useEffect, useCallback, type ReactNode,
} from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import type { Portfolio, Transaction, Asset, RevenuAnnexe, CashBalance, GlobalCash, CashMovement, CashMovementType } from "@/lib/types"
import { EMPTY_CASH_BALANCE, EMPTY_GLOBAL_CASH } from "@/lib/types"
import { calculateRealizedPnLEvents, calculateTransactionChfAmounts, chfPerCurrencyUnit, type RealizedPnLEvent } from "@/lib/finance"
import {
  buildCashAccounts, sumBalances, balancesInChf, normalizeBalances, toChf,
  applyDeposit, applyWithdrawal, applyBuy, applyCredit, applyConversion, applyTransfer,
  UNASSIGNED_CASH, type CashAccount, type CashAccountId, type CashCurrency,
} from "@/lib/cash"
import { useCurrency } from "@/hooks/use-currency"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppData {
  // State
  portfolios:    Portfolio[]
  transactions:  Transaction[]
  revenus:       RevenuAnnexe[]
  /**
   * Somme de TOUTE la trésorerie (chaque portefeuille + la poche libre).
   * Vue agrégée uniquement — pour dépenser ou créditer, on passe par un compte.
   */
  globalCash:    GlobalCash
  /** Trésorerie détaillée : un compte par portefeuille, plus « Hors portefeuille ». */
  cashAccounts:  CashAccount[]
  cashMovements: CashMovement[]
  loading:       boolean
  realizedPnLEvents: RealizedPnLEvent[]
  totalRealizedPnL: number
  // Portfolio mutations
  addPortfolio:    (p: Omit<Portfolio, "id" | "assets">) => Promise<string | null>
  removePortfolio: (id: string) => Promise<void>
  /** Renomme un portefeuille (description et couleur optionnelles). */
  updatePortfolio: (id: string, updates: { name?: string; description?: string; color?: string }) => Promise<{ ok: boolean; error?: string }>
  /** Enregistre l'allocation cible (« Pie ») d'un portefeuille. */
  setTargetAllocation: (id: string, targets: Record<string, number> | null) => Promise<{ ok: boolean; needsMigration?: boolean; error?: string }>
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
  // ── Trésorerie par compte ─────────────────────────────────────────────────
  // Un « compte » est un portefeuille, ou UNASSIGNED_CASH pour l'argent qui ne
  // dépend d'aucun courtier. Le cash d'un portefeuille ne finance que SES
  // opérations : c'est ce que fait un vrai compte-titres.
  /** Dépose du cash sur un compte */
  depositCash:  (accountId: CashAccountId, amount: number, currency: CashCurrency, note?: string) => Promise<void>
  /** Retire du cash d'un compte */
  withdrawCash: (accountId: CashAccountId, amount: number, currency: CashCurrency, note?: string) => Promise<{ ok: boolean; error?: string }>
  /** Convertit une devise en une autre AU SEIN d'un même compte */
  convertCash:  (accountId: CashAccountId, from: CashCurrency, to: CashCurrency, fromAmount: number) => Promise<{ ok: boolean; error?: string }>
  /** Vire du cash d'un compte à un autre, à devise constante */
  transferCash: (fromId: CashAccountId, toId: CashAccountId, amount: number, currency: CashCurrency) => Promise<{ ok: boolean; error?: string }>
  /** Contre-valeur CHF de toute la trésorerie */
  globalCashInChf: () => number
  /** Solde d'un compte dans une devise */
  getAvailableCash: (accountId: CashAccountId, currency: CashCurrency) => number
  // Refresh
  refresh: () => Promise<void>
}

const DEFAULT: AppData = {
  portfolios: [], transactions: [], revenus: [], globalCash: { ...EMPTY_GLOBAL_CASH },
  cashMovements: [], loading: true,
  realizedPnLEvents: [], totalRealizedPnL: 0,
  addPortfolio:    async () => null,
  removePortfolio: async () => {},
  updatePortfolio: async () => ({ ok: true }),
  setTargetAllocation: async () => ({ ok: true }),
  addAsset:        async () => {},
  removeAsset:     async () => {},
  editAsset:       async () => {},
  updateAssetCostBasis: async () => {},
  addTransaction:    async () => ({ ok: true }),
  editTransaction:   async () => {},
  removeTransaction: async () => {},
  addRevenu:    async () => {},
  removeRevenu: async () => {},
  cashAccounts: [],
  depositCash:  async () => {},
  withdrawCash: async () => ({ ok: true }),
  convertCash:  async () => ({ ok: true }),
  transferCash: async () => ({ ok: true }),
  globalCashInChf: () => 0,
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
  // Poche « Hors portefeuille » : l'ancienne cagnotte unique (table global_cash).
  // Elle reste pour ne perdre aucun solde déjà saisi, et pour l'argent qui ne
  // dépend d'aucun courtier. Le cash des portefeuilles vit, lui, dans
  // portfolios.cash_balances.
  const [unassignedCash, setUnassignedCash] = useState<GlobalCash>({ ...EMPTY_GLOBAL_CASH })
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([])
  const [loading,       setLoading]       = useState(isSupabaseConfigured)
  const realizedPnLEvents = useMemo(() => calculateRealizedPnLEvents(transactions), [transactions])
  const totalRealizedPnL = useMemo(
    () => realizedPnLEvents.reduce((sum, event) => sum + event.pnl, 0),
    [realizedPnLEvents]
  )

  // ── Persistance du mode DÉMO (Supabase non configuré) ──────────────────────
  // Sans cela, tout disparaît au moindre rechargement : le mode local était
  // inutilisable. N'a AUCUN effet quand Supabase est configuré.
  const DEMO_KEY = "patrimoine-demo-state"
  const [demoLoaded, setDemoLoaded] = useState(false)

  useEffect(() => {
    if (isSupabaseConfigured) { setDemoLoaded(true); return }
    try {
      const raw = localStorage.getItem(DEMO_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        if (Array.isArray(s.portfolios))   setPortfolios(s.portfolios)
        if (Array.isArray(s.transactions)) setTransactions(s.transactions)
        if (Array.isArray(s.revenus))      setRevenus(s.revenus)
        if (Array.isArray(s.cashMovements))setCashMovements(s.cashMovements)
        if (s.unassignedCash)              setUnassignedCash(s.unassignedCash)
        else if (s.globalCash)             setUnassignedCash(s.globalCash)   // ancien format
      }
    } catch { /* état corrompu → on repart à vide */ }
    setDemoLoaded(true)
  }, [])

  useEffect(() => {
    if (isSupabaseConfigured || !demoLoaded) return
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify({
        portfolios, transactions, revenus, unassignedCash, cashMovements,
      }))
    } catch { /* quota dépassé — on ignore */ }
  }, [demoLoaded, portfolios, transactions, revenus, unassignedCash, cashMovements])

  // ── Vue trésorerie ────────────────────────────────────────────────────────
  const cashAccounts = useMemo(
    () => buildCashAccounts(portfolios, unassignedCash),
    [portfolios, unassignedCash]
  )
  /** Total agrégé : ce que les pages patrimoine consomment. */
  const globalCash = useMemo(() => sumBalances(cashAccounts), [cashAccounts])

  /**
   * Miroir synchrone des soldes.
   *
   * L'état React ne se rafraîchit qu'au rendu suivant : deux écritures
   * enchaînées dans le même gestionnaire (`await depositCash(CHF)` puis
   * `await depositCash(USD)`, ce que fait l'import) reliraient toutes deux
   * l'ancien solde, et la seconde écraserait la première. Ce miroir est mis à
   * jour dans le même tick que l'écriture, donc chaque opération part bien du
   * solde réellement à jour.
   */
  const balancesRef = useRef<Map<CashAccountId, GlobalCash>>(new Map())
  useEffect(() => {
    const next = new Map<CashAccountId, GlobalCash>()
    for (const p of portfolios) next.set(p.id, normalizeBalances(p.cashBalances))
    next.set(UNASSIGNED_CASH, unassignedCash)
    balancesRef.current = next
  }, [portfolios, unassignedCash])

  /** Solde courant d'un compte, quelle que soit sa nature. */
  const balancesOf = useCallback((accountId: CashAccountId): GlobalCash => {
    const mirrored = balancesRef.current.get(accountId)
    if (mirrored) return mirrored
    if (accountId === UNASSIGNED_CASH) return unassignedCash
    return normalizeBalances(portfolios.find(x => x.id === accountId)?.cashBalances)
  }, [portfolios, unassignedCash])

  /** Écrit le solde d'un compte — miroir, état local, puis Supabase. */
  const writeBalances = useCallback(async (accountId: CashAccountId, next: GlobalCash) => {
    balancesRef.current.set(accountId, next)
    if (accountId === UNASSIGNED_CASH) {
      setUnassignedCash(next)
      if (isSupabaseConfigured) await Q.upsertGlobalCash(next)
      return
    }
    setPortfolios(prev => prev.map(p => p.id === accountId ? { ...p, cashBalances: next } : p))
    if (isSupabaseConfigured) await Q.updateCashBalance(accountId, next)
  }, [])

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    try {
      const [p, t, r, gc, cm] = await Promise.all([
        Q.fetchPortfolios(),
        Q.fetchTransactions(),
        Q.fetchRevenus(),
        Q.fetchGlobalCash(),
        Q.fetchCashMovements(2000),  // historique long pour l'agrégation Cashflow
      ])
      if (p)  setPortfolios(p)
      if (t)  setTransactions(t)
      if (r)  setRevenus(r)
      if (gc) setUnassignedCash(gc)
      if (cm) setCashMovements(cm)
      // NOTE: l'ancienne « migration silencieuse » des cost basis (recalcul BCE
      // au chargement) a été supprimée : elle écrasait des valeurs historiques
      // correctes à chaque session. La réparation se fait désormais uniquement
      // via le bouton « Recalculer les positions » dans Réglages (aperçu + confirmation).
    } catch (e) {
      console.error("[AppData] refresh failed:", e)
    }
    setLoading(false)
  }, [])

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
    if (isSupabaseConfigured) {
      const result = await Q.deletePortfolio(id)
      if (!result.ok) {
        console.error("[removePortfolio] Failed to delete portfolio:", result.error)
        // Reload to restore the deleted portfolio
        await refresh()
      }
    }
  }

  /**
   * Renomme un portefeuille. Mise à jour optimiste puis persistance : en cas
   * d'échec on remet l'état d'origine plutôt que de laisser l'écran afficher
   * un nom qui n'existe pas en base.
   */
  async function updatePortfolio(
    id: string,
    updates: { name?: string; description?: string; color?: string }
  ): Promise<{ ok: boolean; error?: string }> {
    const name = updates.name?.trim()
    if (updates.name !== undefined && !name) {
      return { ok: false, error: "Le nom ne peut pas être vide." }
    }
    const clean = { ...updates, ...(name !== undefined ? { name } : {}) }

    const previous = portfolios.find(p => p.id === id)
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, ...clean } : p))

    if (!isSupabaseConfigured) return { ok: true }

    const ok = await Q.updatePortfolio(id, clean)
    if (!ok && previous) {
      setPortfolios(prev => prev.map(p => p.id === id ? previous : p))
      return { ok: false, error: "Enregistrement impossible. Réessaie." }
    }
    return { ok: true }
  }

  /**
   * Écrit l'allocation cible. Mise à jour optimiste, annulée si la base
   * refuse — typiquement quand la migration n'a pas encore été exécutée.
   */
  async function setTargetAllocation(
    id: string,
    targets: Record<string, number> | null
  ): Promise<{ ok: boolean; needsMigration?: boolean; error?: string }> {
    const previous = portfolios.find(p => p.id === id)?.targetAllocation
    setPortfolios(prev => prev.map(p =>
      p.id === id ? { ...p, targetAllocation: targets ?? undefined } : p
    ))

    if (!isSupabaseConfigured) return { ok: true }

    const res = await Q.updateTargetAllocation(id, targets)
    if (!res.ok) {
      setPortfolios(prev => prev.map(p =>
        p.id === id ? { ...p, targetAllocation: previous } : p
      ))
    }
    return res
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
      // ── Liquidité du PORTEFEUILLE concerné ────────────────────────────────
      // On ne contrôle que le compte qui va payer : un solde disponible
      // ailleurs ne finance pas cet achat.
      const nativeCurr = (tx.currency ?? "CHF") as CashCurrency
      const totalCostNative = tx.quantity * tx.price + (tx.fees ?? 0)
      const costChf = toChf(totalCostNative, nativeCurr, fxRates as never)

      const accountBalances = balancesOf(tx.portfolioId)
      const availableChf    = balancesInChf(accountBalances, fxRates as never)
      const accountName     = portfolios.find(p => p.id === tx.portfolioId)?.name ?? "ce portefeuille"

      // Un compte à zéro n'est pas forcément une erreur : la trésorerie peut
      // ne jamais avoir été saisie. On ne bloque donc que si un solde existe.
      if (availableChf > 0 && costChf > availableChf) {
        return {
          ok: false,
          error: `Liquidité insuffisante sur ${accountName}. Requis : ${costChf.toFixed(2)} CHF — Disponible : ${availableChf.toFixed(2)} CHF (manque ${(costChf - availableChf).toFixed(2)} CHF).`,
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
          const newAvg = (existing.quantity * existing.avgBuyPrice + preparedTx.quantity * preparedTx.price + (preparedTx.fees ?? 0)) / newQty
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
            avgBuyPrice:  preparedTx.quantity > 0 ? preparedTx.price + ((preparedTx.fees ?? 0) / preparedTx.quantity) : preparedTx.price,
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

    // ── Mise à jour du solde de liquidité ────────────────────────────────────
    // Achat  → débite (devise native si disponible, sinon CHF converti)
    // Vente  → crédite le produit net en devise native
    // Dividende → crédite le net (même convention que les revenus annexes)
    // C'est de la LOGIQUE MÉTIER : elle doit s'exécuter aussi en mode local,
    // sinon acheter un actif gonfle le patrimoine (cash jamais débité).
    // Le compte débité/crédité est celui du PORTEFEUILLE de l'opération :
    // acheter chez IBKR ne peut pas puiser dans le cash Trading 212.
    if (tx.assetClass !== "cash") {
      const nativeCurr = (tx.currency ?? "CHF") as CashCurrency
      const account    = tx.portfolioId
      const before     = balancesOf(account)
      const ref        = { ticker: tx.ticker, portfolioId: tx.portfolioId }

      if (tx.type === "buy") {
        const res = applyBuy(before, tx.quantity * tx.price + (tx.fees ?? 0), nativeCurr, fxRates as never)
        await writeBalances(account, res.balances)
        await recordCashMovement("buy_deduction", res.movement.currency, res.movement.amount,
          res.balances, { ...ref, note: res.movement.note })

      } else if (tx.type === "sell") {
        const res = applyCredit(before, tx.quantity * tx.price - (tx.fees ?? 0), nativeCurr)
        await writeBalances(account, res.balances)
        await recordCashMovement("sell_credit", res.movement.currency, res.movement.amount,
          res.balances, ref)

      } else if (tx.type === "dividend") {
        const netDividend = tx.quantity * tx.price - (tx.fees ?? 0)
        if (netDividend > 0) {
          const res = applyCredit(before, netDividend, nativeCurr)
          await writeBalances(account, res.balances)
          await recordCashMovement("dividend_credit", res.movement.currency, res.movement.amount,
            res.balances, ref)
        }
      }
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
    // Optimistic: update in UI immediately
    const oldTx = transactions.find(t => t.id === id)
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))

    if (isSupabaseConfigured) {
      try {
        // Update transaction AND recalculate affected asset in one atomic operation
        const result = await Q.updateTransactionAndRecalculate(id, updates)
        if (!result.ok) {
          // Revert optimistic update on error
          if (oldTx) {
            setTransactions(prev => prev.map(t => t.id === id ? oldTx : t))
          }
          console.error("[AppData] editTransaction failed:", result.error)
          return
        }
        // Success: refresh to get recalculated assets and global cash
        await refresh()
      } catch (e) {
        // Revert optimistic update on exception
        if (oldTx) {
          setTransactions(prev => prev.map(t => t.id === id ? oldTx : t))
        }
        console.error("[AppData] editTransaction exception:", e)
      }
    }
  }

  async function removeTransaction(id: string) {
    // Optimistic: remove from UI immediately
    const txToRemove = transactions.find(t => t.id === id)
    setTransactions(prev => prev.filter(t => t.id !== id))

    if (isSupabaseConfigured) {
      try {
        // Delete transaction AND recalculate affected asset in one atomic operation
        const result = await Q.deleteTransactionAndRecalculate(id)
        if (!result.ok) {
          // Revert optimistic update on error
          if (txToRemove) {
            setTransactions(prev => [txToRemove, ...prev])
          }
          console.error("[AppData] removeTransaction failed:", result.error)
          return
        }
        // Success: refresh to get recalculated assets and global cash
        await refresh()
      } catch (e) {
        // Revert optimistic update on exception
        if (txToRemove) {
          setTransactions(prev => [txToRemove, ...prev])
        }
        console.error("[AppData] removeTransaction exception:", e)
      }
    }
  }

  // ── Revenus Annexes ──────────────────────────────────────────────────────────

  async function addRevenu(rev: Omit<RevenuAnnexe, "id" | "createdAt" | "userId">) {
    const tempId = `local-${Date.now()}`
    const local: RevenuAnnexe = { ...rev, id: tempId, userId: "local", createdAt: new Date().toISOString() }
    setRevenus(prev => [local, ...prev])

    // ── Revenu annexe → crédite la poche « Hors portefeuille » ───────────────
    // Un salaire ou un loyer n'arrive pas sur un compte-titres : il n'a aucune
    // raison d'atterrir sur un courtier. Un virement le placera ensuite sur le
    // portefeuille voulu. (Le patrimoine = positions + trésorerie ; les revenus
    // expliquent l'ORIGINE du cash, ils ne sont pas comptés deux fois.)
    const revCurrency = (rev.currency || "CHF") as CashCurrency
    if (["CHF","USD","EUR"].includes(revCurrency)) {
      const res = applyCredit(unassignedCash, rev.amount, revCurrency)
      await writeBalances(UNASSIGNED_CASH, res.balances)
      await recordCashMovement("revenue_credit", revCurrency, rev.amount, res.balances,
        { note: rev.label ?? "Revenu annexe" })
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
  /**
   * Enregistre un mouvement de cash : état local D'ABORD (l'historique des
   * Liquidités et la page Cashflow se mettent à jour immédiatement, y compris
   * en mode local), puis persistance Supabase si configurée.
   */
  async function recordCashMovement(
    type: CashMovementType,
    currency: keyof GlobalCash,
    amount: number,
    afterCash: GlobalCash,
    opts?: { note?: string; ticker?: string; portfolioId?: string }
  ) {
    const local: CashMovement = {
      id: `local-cm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      currency,
      amount,
      balanceAfterChf: afterCash.CHF,
      balanceAfterUsd: afterCash.USD,
      balanceAfterEur: afterCash.EUR,
      note: opts?.note,
      refTicker: opts?.ticker,
      refPortfolioId: opts?.portfolioId,
      date: new Date().toISOString().slice(0, 10),
    }
    setCashMovements(prev => [local, ...prev])
    if (isSupabaseConfigured) {
      const id = await Q.insertCashMovement(type, currency, amount, afterCash, opts)
      if (id) setCashMovements(prev => prev.map(m => m.id === local.id ? { ...m, id } : m))
    }
  }

  /**
   * Dépôt sur UN compte. L'argent n'est plus versé dans une cagnotte commune :
   * il atterrit sur le portefeuille (ou la poche libre) explicitement désigné.
   */
  async function depositCash(
    accountId: CashAccountId, amount: number, currency: CashCurrency, note?: string
  ) {
    if (!amount || amount <= 0) return
    const res = applyDeposit(balancesOf(accountId), amount, currency, note)
    await writeBalances(accountId, res.balances)
    await recordCashMovement("deposit", currency, amount, res.balances,
      { note, portfolioId: accountId === UNASSIGNED_CASH ? undefined : accountId })

    // Trace dans l'historique des transactions
    const tx: Omit<Transaction, "id"> = {
      portfolioId: accountId === UNASSIGNED_CASH ? (portfolios[0]?.id ?? "global") : accountId,
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

  /** Retrait depuis UN compte. Refusé si le solde de CE compte ne suffit pas. */
  async function withdrawCash(
    accountId: CashAccountId, amount: number, currency: CashCurrency, note?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const current   = balancesOf(accountId)
    // Arrondi avant comparaison — évite qu'un 0.09999… flottant passe pour < 0.10
    const available = Math.round((current[currency] ?? 0) * 1e8) / 1e8
    const needed    = Math.round(amount * 1e8) / 1e8
    if (available < needed) {
      return { ok: false, error: `Solde insuffisant : ${available.toFixed(2)} ${currency} disponible, ${amount.toFixed(2)} requis.` }
    }
    const res = applyWithdrawal(current, amount, currency, fxRates as never, note)
    await writeBalances(accountId, res.balances)
    await recordCashMovement("withdrawal", currency, -amount, res.balances,
      { note, portfolioId: accountId === UNASSIGNED_CASH ? undefined : accountId })
    return { ok: true }
  }

  /** Conversion de devises AU SEIN d'un compte — le total du compte ne change pas. */
  async function convertCash(
    accountId: CashAccountId, from: CashCurrency, to: CashCurrency, fromAmount: number
  ): Promise<{ ok: boolean; error?: string }> {
    const res = applyConversion(balancesOf(accountId), from, to, fromAmount, fxRates as never)
    if (res.error) return { ok: false, error: res.error }
    await writeBalances(accountId, res.balances)
    const portfolioId = accountId === UNASSIGNED_CASH ? undefined : accountId
    for (const m of res.movements) {
      await recordCashMovement("conversion", m.currency, m.amount, res.balances,
        { note: m.note, portfolioId })
    }
    return { ok: true }
  }

  /**
   * Virement entre deux comptes, à devise constante.
   * C'est ce qui permet de placer un solde existant sur le bon courtier :
   * sans lui, l'argent saisi avant cette logique resterait bloqué dans la
   * poche « Hors portefeuille ».
   */
  async function transferCash(
    fromId: CashAccountId, toId: CashAccountId, amount: number, currency: CashCurrency
  ): Promise<{ ok: boolean; error?: string }> {
    if (fromId === toId) return { ok: false, error: "Choisis deux comptes différents." }
    const res = applyTransfer(balancesOf(fromId), balancesOf(toId), amount, currency)
    if (res.error) return { ok: false, error: res.error }

    await writeBalances(fromId, res.from)
    await writeBalances(toId, res.to)
    await recordCashMovement("withdrawal", currency, -amount, res.from,
      { note: "Virement interne", portfolioId: fromId === UNASSIGNED_CASH ? undefined : fromId })
    await recordCashMovement("deposit", currency, amount, res.to,
      { note: "Virement interne", portfolioId: toId === UNASSIGNED_CASH ? undefined : toId })
    return { ok: true }
  }

  /** Solde d'un compte donné dans une devise. */
  function getAvailableCash(accountId: CashAccountId, currency: CashCurrency): number {
    return balancesOf(accountId)[currency] ?? 0
  }


  return (
    <AppDataContext.Provider value={{
      portfolios, transactions, revenus, globalCash, cashMovements, loading,
      realizedPnLEvents, totalRealizedPnL,
      addPortfolio, removePortfolio, updatePortfolio, setTargetAllocation, addAsset, removeAsset, editAsset, updateAssetCostBasis,
      addTransaction, editTransaction, removeTransaction,
      addRevenu, removeRevenu,
      cashAccounts, depositCash, withdrawCash, convertCash, transferCash,
      globalCashInChf, getAvailableCash,
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
