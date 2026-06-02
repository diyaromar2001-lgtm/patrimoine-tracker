// Simple in-memory TTL cache — avoids hammering Yahoo / CoinGecko
interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { store.delete(key); return null }
  return entry.value
}

export function cacheSet<T>(key: string, value: T, ttlSeconds = 60): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

export async function cacheFetch<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds = 60
): Promise<T> {
  const cached = cacheGet<T>(key)
  if (cached !== null) return cached
  const value = await fn()
  cacheSet(key, value, ttlSeconds)
  return value
}
