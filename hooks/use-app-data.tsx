"use client"

import {
  createContext, useContext, useState,
  useEffect, useCallback, type ReactNode,
} from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import type { Portfolio, Transaction, Asset, RevenuAnnexe } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppData {
  // State
  portfolios:    Portfolio[]
  transactions:  Transaction[]
  revenus:       RevenuAnnexe[]
  loading:       boolean
  // Portfolio mutations
  addPortfolio:    (p: Omit<Portfolio, "id" | "assets">) => Promise<string | null>
  removePortfolio: (id: string) => Promise<void>
  addAsset:        (portfolioId: string, asset: Omit<Asset, "currentPrice">) => Promise<void>
  removeAsset:     (portfolioId: string, assetId: string) => Promise<void>
  // Transaction mutations
  addTransaction:    (tx: Omit<Transaction, "id">) => Promise<{ ok: boolean; error?: string }>
  editTransaction:   (id: string, updates: Partial<Omit<Transaction, "id">>) => Promise<void>
  removeTransaction: (id: string) => Promise<void>
  // Revenus Annexes mutations
  addRevenu:    (rev: Omit<RevenuAnnexe, "id" | "createdAt" | "userId">) => Promise<void>
  removeRevenu: (id: string) => Promise<void>
  // Refresh
  refresh: () => Promise<void>
}

const DEFAULT: AppData = {
  portfolios: [], transactions: [], revenus: [], loading: true,
  addPortfolio:    async () => null,
  removePortfolio: async () => {},
  addAsset:        async () => {},
  removeAsset:     async () => {},
  addTransaction:    async () => ({ ok: true }),
  editTransaction:   async () => {},
  removeTransaction: async () => {},
  addRevenu:    async () => {},
  removeRevenu: async () => {},
  refresh: async () => {},
}

const AppDataContext = createContext<AppData>(DEFAULT)

// ─── Provider — single fetch, shared across all pages ────────────────────────

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [portfolios,   setPortfolios]   = useState<Portfolio[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [revenus,      setRevenus]      = useState<RevenuAnnexe[]>([])
  const [loading,      setLoading]      = useState(isSupabaseConfigured)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    try {
      const [p, t, r] = await Promise.all([
        Q.fetchPortfolios(),
        Q.fetchTransactions(),
        Q.fetchRevenus(),
      ])
      if (p) setPortfolios(p)
      if (t) setTransactions(t)
      if (r) setRevenus(r)
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
    if (isSupabaseConfigured) await Q.deletePortfolio(id)
  }

  async function addAsset(portfolioId: string, asset: Omit<Asset, "currentPrice">) {
    // Optimistic
    const local: Asset = { ...asset, currentPrice: asset.avgBuyPrice }
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

  // ── Transaction mutations ────────────────────────────────────────────────────

  async function addTransaction(tx: Omit<Transaction, "id">): Promise<{ ok: boolean; error?: string }> {
    const tempId = `local-${Date.now()}`

    // ── 1. Optimistic update: add transaction ────────────────────────────────
    setTransactions(prev => [{ ...tx, id: tempId }, ...prev])

    // ── 2. Optimistic update: sync portfolio assets ──────────────────────────
    if (tx.type === "buy") {
      setPortfolios(prev => prev.map(p => {
        if (p.id !== tx.portfolioId) return p
        const existing = p.assets.find(a => a.ticker === tx.ticker)
        if (existing) {
          // Update qty + weighted avg price
          const newQty = existing.quantity + tx.quantity
          const newAvg = (existing.quantity * existing.avgBuyPrice + tx.quantity * tx.price) / newQty
          return {
            ...p,
            assets: p.assets.map(a =>
              a.ticker === tx.ticker
                ? { ...a, quantity: newQty, avgBuyPrice: newAvg }
                : a
            ),
          }
        } else {
          // New position
          const newAsset: Asset = {
            id: `local-${Date.now()}`,
            portfolioId:  tx.portfolioId,
            ticker:       tx.ticker,
            name:         tx.assetName,
            assetClass:   tx.assetClass,
            quantity:     tx.quantity,
            avgBuyPrice:  tx.price,
            currentPrice: tx.price,
            currency:     tx.currency ?? "CHF",
          }
          return { ...p, assets: [...p.assets, newAsset] }
        }
      }))
    } else if (tx.type === "sell") {
      setPortfolios(prev => prev.map(p => {
        if (p.id !== tx.portfolioId) return p
        return {
          ...p,
          assets: p.assets
            .map(a => a.ticker === tx.ticker
              ? { ...a, quantity: a.quantity - tx.quantity }
              : a
            )
            .filter(a => a.quantity > 0),
        }
      }))
    }

    if (!isSupabaseConfigured) return { ok: true }  // local-only mode

    try {
      // ── 3. Save transaction to Supabase ──────────────────────────────────
      const result = await Q.createTransaction(tx)
      if (!result) {
        // Revert optimistic updates
        setTransactions(prev => prev.filter(t => t.id !== tempId))
        await refresh()
        const msg = "Supabase: insert retourné null. Vérifiez les politiques RLS."
        console.error("[AppData] addTransaction:", msg, tx)
        return { ok: false, error: msg }
      }

      setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: result.id } : t))

      // ── 4. Sync asset in Supabase ─────────────────────────────────────────
      if (tx.type === "buy") {
        await Q.upsertAssetFromBuy({
          portfolioId: tx.portfolioId,
          ticker:      tx.ticker,
          assetName:   tx.assetName,
          assetClass:  tx.assetClass,
          quantity:    tx.quantity,
          price:       tx.price,
          currency:    tx.currency ?? "CHF",
        })
      } else if (tx.type === "sell") {
        await Q.reduceAssetFromSell({
          portfolioId: tx.portfolioId,
          ticker:      tx.ticker,
          quantity:    tx.quantity,
        })
      }

      // ── 5. Reload to get consistent state (real IDs, current prices) ──────
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
    const local: RevenuAnnexe = {
      ...rev,
      id: tempId,
      userId: "local",
      createdAt: new Date().toISOString(),
    }
    setRevenus(prev => [local, ...prev])
    if (!isSupabaseConfigured) return
    try {
      const result = await Q.createRevenu(rev)
      if (result) {
        setRevenus(prev => prev.map(r => r.id === tempId ? { ...r, id: result.id } : r))
      } else {
        setRevenus(prev => prev.filter(r => r.id !== tempId))
      }
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

  return (
    <AppDataContext.Provider value={{
      portfolios, transactions, revenus, loading,
      addPortfolio, removePortfolio, addAsset, removeAsset,
      addTransaction, editTransaction, removeTransaction,
      addRevenu, removeRevenu,
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
