"use client"

import { useState, useEffect, useCallback } from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import { MOCK_PORTFOLIOS, MOCK_TRANSACTIONS } from "@/lib/mock-data"
import type { Portfolio, Transaction, Asset } from "@/lib/types"

// ─── Portfolios hook ──────────────────────────────────────────────────────────
export function usePortfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(
    isSupabaseConfigured ? [] : MOCK_PORTFOLIOS
  )
  const [loading, setLoading] = useState(isSupabaseConfigured)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    try {
      const data = await Q.fetchPortfolios()
      if (data) setPortfolios(data)
    } catch (e) {
      console.error("[usePortfolios] reload failed:", e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function addPortfolio(p: Omit<Portfolio, "id" | "assets">): Promise<string | null> {
    if (!isSupabaseConfigured) {
      const local: Portfolio = { ...p, id: `local-${Date.now()}`, assets: [] }
      setPortfolios(prev => [...prev, local])
      return local.id
    }
    const result = await Q.createPortfolio(p)
    if (result) {
      await reload()
      return result.id
    }
    return null
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
    try {
      await Q.createAsset(asset)
      await reload()
    } catch (e) {
      console.error("[usePortfolios] addAsset failed:", e)
    }
  }

  async function removeAsset(portfolioId: string, assetId: string) {
    // Optimistic update — remove immediately from UI
    setPortfolios(prev => prev.map(p =>
      p.id === portfolioId ? { ...p, assets: p.assets.filter(a => a.id !== assetId) } : p
    ))
    if (isSupabaseConfigured) {
      try { await Q.deleteAsset(assetId) }
      catch (e) { console.error("[usePortfolios] removeAsset failed:", e); reload() }
    }
  }

  return { portfolios, setPortfolios, loading, addPortfolio, removePortfolio, addAsset, removeAsset, reload }
}

// ─── Transactions hook ────────────────────────────────────────────────────────
export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>(
    isSupabaseConfigured ? [] : MOCK_TRANSACTIONS
  )
  const [loading, setLoading] = useState(isSupabaseConfigured)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    try {
      const data = await Q.fetchTransactions()
      if (data) setTransactions(data)
    } catch (e) {
      console.error("[useTransactions] reload failed:", e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function addTransaction(tx: Omit<Transaction, "id">) {
    // 1. Optimistic: add locally with temp ID
    const tempId = `local-${Date.now()}`
    const local: Transaction = { ...tx, id: tempId }
    setTransactions(prev => [local, ...prev])

    if (!isSupabaseConfigured) return

    // 2. Save to Supabase
    try {
      const result = await Q.createTransaction(tx)
      if (result) {
        // Replace temp entry with real DB entry (has real UUID)
        setTransactions(prev =>
          prev.map(t => t.id === tempId ? { ...t, id: result.id } : t)
        )
      } else {
        // Save failed — remove optimistic entry
        console.error("[useTransactions] addTransaction: Supabase returned null")
        setTransactions(prev => prev.filter(t => t.id !== tempId))
        await reload()
      }
    } catch (e) {
      console.error("[useTransactions] addTransaction failed:", e)
      setTransactions(prev => prev.filter(t => t.id !== tempId))
      await reload()
    }
  }

  async function editTransaction(id: string, updates: Partial<Omit<Transaction, "id">>) {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    if (isSupabaseConfigured) {
      try {
        const result = await Q.updateTransactionAndRecalculate(id, updates)
        if (!result.ok) {
          console.error("[useTransactions] editTransaction failed:", result.error)
          await reload()
        } else {
          await reload()
        }
      } catch (e) {
        console.error("[useTransactions] editTransaction exception:", e)
        await reload()
      }
    }
  }

  async function removeTransaction(id: string) {
    setTransactions(prev => prev.filter(t => t.id !== id))
    if (isSupabaseConfigured) {
      try {
        const result = await Q.deleteTransactionAndRecalculate(id)
        if (!result.ok) {
          console.error("[useTransactions] removeTransaction failed:", result.error)
          await reload()
        } else {
          await reload()
        }
      } catch (e) {
        console.error("[useTransactions] removeTransaction exception:", e)
        await reload()
      }
    }
  }

  return { transactions, loading, addTransaction, editTransaction, removeTransaction, reload }
}
