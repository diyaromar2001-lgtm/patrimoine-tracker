/**
 * Cache de prix partagé par toute l'application.
 *
 * Chaque page appelait `useLivePrices` de son côté : six états séparés, six
 * requêtes, six horloges. Deux conséquences visibles :
 *
 *   — les chiffres divergeaient d'une page à l'autre (le tableau de bord et
 *     les portefeuilles interrogeaient Yahoo à quelques secondes d'écart et
 *     n'affichaient donc pas le même patrimoine) ;
 *   — chaque navigation repartait de zéro, écran vide compris.
 *
 * Ce module tient UN jeu de prix. Les composants s'y abonnent ; le premier
 * qui demande un ticker déclenche la requête, les suivants sont servis
 * instantanément. Les requêtes concurrentes sont fusionnées.
 *
 * Volontairement hors React : le cache doit survivre au démontage des pages,
 * sinon changer d'onglet reviendrait à tout re-télécharger.
 */

export interface RawPrice {
  chf: number; usd: number; eur: number; changePct: number
  originalPrice: number; originalCurrency: string
  dayHigh?: number; dayLow?: number
  fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number
  marketCap?: number; trailingPE?: number
  resolvedSymbol?: string
}

type Listener = () => void

/** Durée pendant laquelle un prix déjà connu est réutilisé sans rappeler l'API. */
const FRESH_MS = 20_000

const store = {
  prices:      {} as Record<string, RawPrice>,
  lastUpdated: null as Date | null,
  loading:     false,
  /** Tickers demandés par au moins un composant monté. */
  wanted:      new Map<string, number>(),
  listeners:   new Set<Listener>(),
  /** Requête en vol, partagée entre appelants simultanés. */
  inFlight:    null as Promise<void> | null,
  /** Tickers déjà récupérés au moins une fois. */
  fetched:     new Set<string>(),
}

function emit() {
  for (const l of store.listeners) l()
}

export function subscribe(listener: Listener): () => void {
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}

export function getSnapshot() {
  return store.prices
}

export function getLastUpdated() {
  return store.lastUpdated
}

export function isLoading() {
  return store.loading
}

/** Déclare l'intérêt d'un composant pour des tickers ; renvoie le désabonnement. */
export function retain(tickers: string[]): () => void {
  for (const t of tickers) store.wanted.set(t, (store.wanted.get(t) ?? 0) + 1)
  return () => {
    for (const t of tickers) {
      const n = (store.wanted.get(t) ?? 1) - 1
      if (n <= 0) store.wanted.delete(t)
      else store.wanted.set(t, n)
    }
  }
}

function isFresh(): boolean {
  return store.lastUpdated != null && Date.now() - store.lastUpdated.getTime() < FRESH_MS
}

/**
 * Récupère les prix des tickers demandés.
 *
 * `force` ignore la fenêtre de fraîcheur (bouton « rafraîchir », minuterie).
 * Sans lui, une navigation vers une page déjà servie ne rappelle pas l'API.
 */
export async function fetchPrices(force = false): Promise<void> {
  const tickers = [...store.wanted.keys()]
  if (!tickers.length) return

  // Tout est déjà connu et récent : rien à faire, l'écran s'affiche aussitôt.
  const allKnown = tickers.every(t => store.fetched.has(t))
  if (!force && allKnown && isFresh()) return

  // Une requête est déjà partie : on s'y raccroche au lieu d'en lancer une seconde.
  if (store.inFlight) return store.inFlight

  store.loading = true
  emit()

  store.inFlight = (async () => {
    try {
      const res = await fetch("/api/prices", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickers }),
      })
      if (res.ok) {
        const raw: Record<string, RawPrice> = await res.json()
        // Fusion plutôt que remplacement : une page qui ne demande qu'un
        // sous-ensemble ne doit pas effacer les prix des autres.
        store.prices      = { ...store.prices, ...raw }
        store.lastUpdated = new Date()
        for (const t of tickers) store.fetched.add(t)
      }
    } catch { /* on garde les prix précédents plutôt qu'un écran vide */ }
    finally {
      store.loading  = false
      store.inFlight = null
      emit()
    }
  })()

  return store.inFlight
}

/** Remise à zéro — réservée aux tests. */
export function __resetPriceStore() {
  store.prices = {}
  store.lastUpdated = null
  store.loading = false
  store.wanted.clear()
  store.listeners.clear()
  store.inFlight = null
  store.fetched.clear()
}
