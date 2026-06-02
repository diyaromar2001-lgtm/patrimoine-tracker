"use client"

import { useState, useEffect, useCallback } from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import { MOCK_PORTFOLIOS, MOCK_TRANSACTIONS } from "@/lib/mock-data"
import type { Portfolio, Transaction, Asset } from "@/lib/types"

// ─── Portfolios hook ──────────────────────────────────────────────────────────
export function usePortfolios() {
  // If Supabase is configured → start empty (real data comes from DB)
  // If no Supabase → use mock data for dev/demo
  const [portfolios, setPortfolios] = useState<Portfolio[]>(
    isSupabaseConfigured ? [] : MOCK_PORTFOLIOS
  )
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [fromDB,     setFromDB]     = useState(false)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    const data = await Q.fetchPortfolios()
    if (data) { setPortfolios(data); setFromDB(true) }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function addPortfolio(p: Omit<Portfolio, "id" | "assets">) {
    if (!isSupabaseConfigured) {
      const local: Portfolio = { ...p, id: `local-${Date.now()}`, assets: [] }
      setPortfolios(prev => [...prev, local])
      return local.id
    }
    const result = await Q.createPortfolio(p)
    await reload()
    return result?.id ?? null
  }

  async function removePortfolio(id: string) {
    setPortfolios(prev => prev.filter(p => p.id !== id))
    if (isSupabaseConfigured) await Q.deletePortfolio(id)
  }

  async function addAsset(portfolioId: string, asset: Omit<Asset, "currentPrice">) {
    if (!isSupabaseConfigured) {
      const local: Asset = { ...asset, currentPrice: asset.avgBuyPrice, id: `local-${Date.now()}` }
      setPortfolios(prev => prev.map(p =>
        p.id === portfolioId ? { ...p, assets: [...p.assets, local] } : p
      ))
      return
    }
    await Q.createAsset(asset)
    await reload()
  }

  async function removeAsset(portfolioId: string, assetId: string) {
    setPortfolios(prev => prev.map(p =>
      p.id === portfolioId ? { ...p, assets: p.assets.filter(a => a.id !== assetId) } : p
    ))
    if (isSupabaseConfigured) await Q.deleteAsset(assetId)
  }

  return { portfolios, setPortfolios, loading, fromDB, addPortfolio, removePortfolio, addAsset, removeAsset, reload }
}

// ─── Transactions hook ────────────────────────────────────────────────────────
export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>(
    isSupabaseConfigured ? [] : MOCK_TRANSACTIONS
  )
  const [loading,      setLoading]      = useState(isSupabaseConfigured)
  const [fromDB,       setFromDB]       = useState(false)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    const data = await Q.fetchTransactions()
    if (data) { setTransactions(data); setFromDB(true) }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function addTransaction(tx: Omit<Transaction, "id">) {
    const local: Transaction = { ...tx, id: `local-${Date.now()}` }
    setTransactions(prev => [local, ...prev])
    if (isSupabaseConfigured) {
      const result = await Q.createTransaction(tx)
      if (result) await reload()
    }
  }

  async function editTransaction(id: string, updates: Partial<Omit<Transaction, "id">>) {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    if (isSupabaseConfigured) await Q.updateTransaction(id, updates)
  }

  async function removeTransaction(id: string) {
    setTransactions(prev => prev.filter(t => t.id !== id))
    if (isSupabaseConfigured) await Q.deleteTransaction(id)
  }

  return { transactions, loading, fromDB, addTransaction, editTransaction, removeTransaction, reload }
}
