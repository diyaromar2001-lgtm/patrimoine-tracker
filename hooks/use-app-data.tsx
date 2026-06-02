"use client"

import {
  createContext, useContext, useState,
  useEffect, useCallback, type ReactNode,
} from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import type { Portfolio, Transaction, Asset, AssetClass } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppData {
  // State
  portfolios:   Portfolio[]
  transactions: Transaction[]
  loading:      boolean
  // Portfolio mutations
  addPortfolio:    (p: Omit<Portfolio, "id" | "assets">) => Promise<string | null>
  removePortfolio: (id: string) => Promise<void>
  addAsset:        (portfolioId: string, asset: Omit<Asset, "currentPrice">) => Promise<void>
  removeAsset:     (portfolioId: string, assetId: string) => Promise<void>
  // Transaction mutations
  addTransaction:    (tx: Omit<Transaction, "id">) => Promise<void>
  editTransaction:   (id: string, updates: Partial<Omit<Transaction, "id">>) => Promise<void>
  removeTransaction: (id: string) => Promise<void>
  // Refresh
  refresh: () => Promise<void>
}

const DEFAULT: AppData = {
  portfolios: [], transactions: [], loading: true,
  addPortfolio:    async () => null,
  removePortfolio: async () => {},
  addAsset:        async () => {},
  removeAsset:     async () => {},
  addTransaction:    async () => {},
  editTransaction:   async () => {},
  removeTransaction: async () => {},
  refresh: async () => {},
}

const AppDataContext = createContext<AppData>(DEFAULT)

// ─── Provider — single fetch, shared across all pages ────────────────────────

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [portfolios,   setPortfolios]   = useState<Portfolio[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading,      setLoading]      = useState(isSupabaseConfigured)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    try {
      const [p, t] = await Promise.all([
        Q.fetchPortfolios(),
        Q.fetchTransactions(),
      ])
      if (p) setPortfolios(p)
      if (t) setTransactions(t)
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

  async function addTransaction(tx: Omit<Transaction, "id">) {
    const tempId = `local-${Date.now()}`
    setTransactions(prev => [{ ...tx, id: tempId }, ...prev])
    if (!isSupabaseConfigured) return
    try {
      const result = await Q.createTransaction(tx)
      if (result) {
        setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: result.id } : t))
      } else {
        console.error("[AppData] addTransaction: null result — removing optimistic")
        setTransactions(prev => prev.filter(t => t.id !== tempId))
      }
    } catch (e) {
      console.error("[AppData] addTransaction failed:", e)
      setTransactions(prev => prev.filter(t => t.id !== tempId))
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

  return (
    <AppDataContext.Provider value={{
      portfolios, transactions, loading,
      addPortfolio, removePortfolio, addAsset, removeAsset,
      addTransaction, editTransaction, removeTransaction,
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
