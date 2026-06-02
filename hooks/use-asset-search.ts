"use client"

import { useState, useEffect, useCallback } from "react"

export interface SearchResult {
  ticker:   string
  name:     string
  type:     string
  exchange: string
}

export function useAssetSearch(debounceMs = 300) {
  const [query, setQuery]     = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 1) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data: SearchResult[] = await res.json()
      setResults(data)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => search(query), debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs, search])

  return { query, setQuery, results, loading, clear: () => { setQuery(""); setResults([]) } }
}
