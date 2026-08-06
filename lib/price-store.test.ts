import { describe, test, expect, beforeEach, vi, afterEach } from "vitest"
import {
  retain, fetchPrices, getSnapshot, getLastUpdated, subscribe, __resetPriceStore,
} from "./price-store"

const quote = (chf: number) => ({
  chf, usd: chf * 1.25, eur: chf * 1.08, changePct: 0,
  originalPrice: chf, originalCurrency: "CHF",
})

function mockFetch(payload: Record<string, unknown>, onCall?: (body: string[]) => void) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    onCall?.(JSON.parse(init.body).tickers)
    return { ok: true, json: async () => payload } as Response
  })
}

beforeEach(() => { __resetPriceStore(); vi.useRealTimers() })
afterEach(() => { vi.restoreAllMocks() })

describe("cache de prix partagé", () => {
  test("un seul appel réseau sert plusieurs abonnés", async () => {
    const spy = mockFetch({ NVDA: quote(100) })
    vi.stubGlobal("fetch", spy)

    retain(["NVDA"])
    retain(["NVDA"])
    // Deux pages qui se montent en même temps ne doivent pas doubler la requête
    await Promise.all([fetchPrices(), fetchPrices()])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(getSnapshot().NVDA.chf).toBe(100)
  })

  test("la requête porte sur l'union des tickers demandés", async () => {
    let asked: string[] = []
    vi.stubGlobal("fetch", mockFetch({ NVDA: quote(100), MSFT: quote(200) }, t => { asked = t }))

    retain(["NVDA"])
    retain(["MSFT"])
    await fetchPrices()

    expect(asked.sort()).toEqual(["MSFT", "NVDA"])
  })

  test("un prix récent est resservi sans rappeler l'API", async () => {
    const spy = mockFetch({ NVDA: quote(100) })
    vi.stubGlobal("fetch", spy)

    retain(["NVDA"])
    await fetchPrices()
    await fetchPrices()          // navigation vers une autre page

    expect(spy).toHaveBeenCalledTimes(1)
  })

  test("force ignore la fenêtre de fraîcheur", async () => {
    const spy = mockFetch({ NVDA: quote(100) })
    vi.stubGlobal("fetch", spy)

    retain(["NVDA"])
    await fetchPrices()
    await fetchPrices(true)      // minuterie ou bouton « rafraîchir »

    expect(spy).toHaveBeenCalledTimes(2)
  })

  test("un ticker jamais chargé déclenche une requête même si le cache est frais", async () => {
    const spy = vi.fn(async (_u: string, init: { body: string }) => {
      const t = JSON.parse(init.body).tickers as string[]
      return { ok: true, json: async () => Object.fromEntries(t.map(x => [x, quote(1)])) } as Response
    })
    vi.stubGlobal("fetch", spy)

    retain(["NVDA"]); await fetchPrices()
    retain(["MSFT"]); await fetchPrices()   // MSFT est inconnu → il faut y aller

    expect(spy).toHaveBeenCalledTimes(2)
    expect(getSnapshot().MSFT).toBeDefined()
  })

  test("les nouveaux prix fusionnent au lieu d'effacer les précédents", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const t = JSON.parse(init.body).tickers as string[]
      return { ok: true, json: async () => Object.fromEntries(t.map(x => [x, quote(7)])) } as Response
    }))

    retain(["NVDA"]); await fetchPrices()
    retain(["MSFT"]); await fetchPrices()

    // Une page qui ne demande qu'un sous-ensemble ne doit pas vider le cache
    expect(getSnapshot().NVDA).toBeDefined()
    expect(getSnapshot().MSFT).toBeDefined()
  })

  test("une erreur réseau conserve les prix précédents", async () => {
    vi.stubGlobal("fetch", mockFetch({ NVDA: quote(100) }))
    retain(["NVDA"])
    await fetchPrices()

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    await fetchPrices(true)

    expect(getSnapshot().NVDA.chf).toBe(100)   // pas d'écran vide
  })

  test("les abonnés sont notifiés à l'arrivée des prix", async () => {
    vi.stubGlobal("fetch", mockFetch({ NVDA: quote(100) }))
    const listener = vi.fn()
    subscribe(listener)

    retain(["NVDA"])
    await fetchPrices()

    expect(listener).toHaveBeenCalled()
    expect(getLastUpdated()).toBeInstanceOf(Date)
  })

  test("relâcher tous les abonnés vide la liste des tickers voulus", async () => {
    const spy = mockFetch({ NVDA: quote(100) })
    vi.stubGlobal("fetch", spy)

    const release = retain(["NVDA"])
    release()
    await fetchPrices()

    expect(spy).not.toHaveBeenCalled()
  })
})
