import { describe, test, expect } from "vitest"
import { replayPosition, type ReplayEvent } from "./replay-position"
import { txsToReplayEvents } from "./supabase/queries"
import {
  safeCostBasisChf,
  calculateTransactionChfAmounts,
  sumDividendsDisplay,
  computeAllocation,
  type FXRates,
} from "./finance"

// ═══════════════════════════════════════════════════════════════════════════
// Tests de positions simulées — cycle de vie complet multi-devises
//
// Objectif : prouver que la chaîne de calcul (replay canonique + cost basis
// CHF figé + agrégats dashboard) est correcte et déterministe, indépendamment
// du FX live.
// ═══════════════════════════════════════════════════════════════════════════

// Taux historiques simulés (unités par CHF)
const RATES_T1: FXRates = { CHF: 1, USD: 1.10, EUR: 1.05 } // au 1er achat
const RATES_T2: FXRates = { CHF: 1, USD: 1.25, EUR: 1.08 } // au 2e achat
const RATES_T3: FXRates = { CHF: 1, USD: 1.00, EUR: 1.02 } // au 3e achat (parité USD!)
const RATES_LIVE: FXRates = { CHF: 1, USD: 1.20, EUR: 1.06 } // aujourd'hui

// ───────────────────────────────────────────────────────────────────────────
// Scénario A — cycle de vie d'un actif USD : 3 achats avec frais à des taux
// FX différents, vente partielle, rachat.
// ───────────────────────────────────────────────────────────────────────────

describe("Scénario A — cycle de vie multi-devises (actif USD)", () => {
  // Achat 1: 10 @ 100 USD + 2 USD frais, à 1.10 USD/CHF
  const buy1 = calculateTransactionChfAmounts({ type: "buy", quantity: 10, price: 100, fees: 2, currency: "USD", fxRates: RATES_T1 })
  // Achat 2: 5 @ 120 USD + 1 USD frais, à 1.25 USD/CHF
  const buy2 = calculateTransactionChfAmounts({ type: "buy", quantity: 5, price: 120, fees: 1, currency: "USD", fxRates: RATES_T2 })
  // Achat 3: 5 @ 110 USD + 0 frais, à parité (1.00)
  const buy3 = calculateTransactionChfAmounts({ type: "buy", quantity: 5, price: 110, fees: 0, currency: "USD", fxRates: RATES_T3 })

  const events: ReplayEvent[] = [
    { type: "buy", date: "2025-01-10", order: 0, quantity: 10, price: 100, feesNative: 2, baseAmountChf: buy1.netAmountChf },
    { type: "buy", date: "2025-02-10", order: 1, quantity: 5, price: 120, feesNative: 1, baseAmountChf: buy2.netAmountChf },
    { type: "sell", date: "2025-03-10", order: 2, quantity: 8 },
    { type: "buy", date: "2025-04-10", order: 3, quantity: 5, price: 110, feesNative: 0, baseAmountChf: buy3.netAmountChf },
  ]

  test("montants CHF historiques figés (indépendants du FX live)", () => {
    // buy1: (10×100 + 2) / 1.10 = 1002 / 1.10 = 910.909…
    expect(buy1.netAmountChf).toBeCloseTo(1002 / 1.10, 6)
    // buy2: (5×120 + 1) / 1.25 = 601 / 1.25 = 480.8
    expect(buy2.netAmountChf).toBeCloseTo(601 / 1.25, 6)
    // buy3: 550 / 1.00 = 550
    expect(buy3.netAmountChf).toBeCloseTo(550, 6)
  })

  test("quantité, prix moyen natif (frais inclus) et cost basis CHF après le cycle", () => {
    const r = replayPosition(events)

    // Quantité: 10 + 5 − 8 + 5 = 12
    expect(r.quantity).toBeCloseTo(12, 8)

    // Avg natif après achat 1: (1000+2)/10 = 100.2
    // après achat 2: (10×100.2 + 5×120.2)/15 = (1002+601)/15 = 106.8667
    // vente: avg inchangé (106.8667)
    // après achat 3: (7×106.8667 + 5×110)/12 = (748.0667+550)/12 = 108.1722
    expect(r.avgBuyPriceNative).toBeCloseTo(108.1722, 3)

    // Cost basis CHF: buy1+buy2 = 910.909+480.8 = 1391.709
    // vente 8/15 → reste 7/15 × 1391.709 = 649.464
    // + buy3 550 = 1199.464
    const costAfterSell = (7 / 15) * (1002 / 1.10 + 601 / 1.25)
    expect(r.costBasisChf).toBeCloseTo(costAfterSell + 550, 4)
  })

  test("P&L latent au prix live: valeur CHF − cost basis CHF", () => {
    const r = replayPosition(events)
    const livePriceUsd = 130
    const valueChf = (livePriceUsd * r.quantity) / RATES_LIVE.USD  // 130×12/1.20 = 1300
    const pnlChf = valueChf - r.costBasisChf
    expect(valueChf).toBeCloseTo(1300, 6)
    // Le P&L dépend du FX live pour la VALEUR mais pas pour le COÛT
    expect(pnlChf).toBeCloseTo(1300 - r.costBasisChf, 8)
  })

  test("P&L réalisé sur la vente partielle: produit − coût proportionnel", () => {
    // Vente 8 @ 125 USD à 1.20 USD/CHF, 1 USD frais
    const sell = calculateTransactionChfAmounts({ type: "sell", quantity: 8, price: 125, fees: 1, currency: "USD", fxRates: RATES_LIVE })
    // Produit net CHF: (1000 − 1)/1.20 = 832.5
    expect(sell.netAmountChf).toBeCloseTo(999 / 1.20, 6)
    // Coût CHF des 8 vendues: 8/15 du cost basis pré-vente
    const costSold = (8 / 15) * (1002 / 1.10 + 601 / 1.25)
    const realized = sell.netAmountChf - costSold
    expect(realized).toBeCloseTo(999 / 1.20 - costSold, 8)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Scénario B — équivalence edit/delete : le recompute de queries.ts (via
// txsToReplayEvents + replayPosition) produit un avg NATIF, jamais du CHF.
// ───────────────────────────────────────────────────────────────────────────

describe("Scénario B — txsToReplayEvents (recompute edit/delete)", () => {
  const dbRows = [
    { type: "buy", date: "2025-01-10", quantity: 10, price: 100, fees: 2, net_amount_chf: 1002 / 1.10, fx_rate_to_chf: 1 / 1.10 },
    { type: "buy", date: "2025-02-10", quantity: 5, price: 120, fees: 1, net_amount_chf: 601 / 1.25, fx_rate_to_chf: 1 / 1.25 },
    { type: "sell", date: "2025-03-10", quantity: 8, price: 125, fees: 1, net_amount_chf: 999 / 1.20, fx_rate_to_chf: 1 / 1.20 },
  ]

  test("avg_buy_price reste en devise NATIVE après recompute (régression unit-flip)", () => {
    const r = replayPosition(txsToReplayEvents(dbRows))
    // Avg natif attendu: (1002+601)/15 = 106.8667 USD — PAS 92.83 CHF
    expect(r.avgBuyPriceNative).toBeCloseTo(106.8667, 3)
    // La valeur CHF/action serait ~92.8 ; on vérifie qu'on n'est PAS dessus
    expect(Math.abs(r.avgBuyPriceNative - 92.83)).toBeGreaterThan(5)
  })

  test("cost basis CHF = somme historique réduite proportionnellement", () => {
    const r = replayPosition(txsToReplayEvents(dbRows))
    expect(r.quantity).toBeCloseTo(7, 8)
    expect(r.costBasisChf).toBeCloseTo((7 / 15) * (1002 / 1.10 + 601 / 1.25), 4)
  })

  test("éditer une transaction = rejouer la liste modifiée (déterminisme)", () => {
    const edited = dbRows.map(t =>
      t.type === "sell" ? { ...t, quantity: 5 } : t
    )
    const r = replayPosition(txsToReplayEvents(edited))
    expect(r.quantity).toBeCloseTo(10, 8)
    expect(r.costBasisChf).toBeCloseTo((10 / 15) * (1002 / 1.10 + 601 / 1.25), 4)
    // Avg natif inchangé par la vente
    expect(r.avgBuyPriceNative).toBeCloseTo(106.8667, 3)
  })

  test("fallback net_amount_chf manquant → (qty×price+fees) × fx_rate_to_chf", () => {
    const legacy = [{ type: "buy", date: "2025-01-10", quantity: 10, price: 100, fees: 2, net_amount_chf: null, fx_rate_to_chf: 1 / 1.10 }]
    const r = replayPosition(txsToReplayEvents(legacy))
    expect(r.costBasisChf).toBeCloseTo(1002 / 1.10, 6)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Scénario C — safeCostBasisChf : la valeur stockée fait foi (régression de
// l'heuristique ±3 % qui écrasait les positions USD/EUR proches de la parité).
// ───────────────────────────────────────────────────────────────────────────

describe("Scénario C — safeCostBasisChf sans heuristique", () => {
  test("position USD à ratio ≈ 0.98 : la valeur stockée n'est PAS réécrite", () => {
    // 10 @ 100 USD achetés à parité ~0.98 → cost basis CHF légitime ≈ 1020
    const stored = 1020.41
    const result = safeCostBasisChf(stored, 10, 100, "USD", RATES_LIVE)
    expect(result).toBe(stored)  // exactement la valeur stockée, pas de drift FX
  })

  test("la valeur retournée ne dépend PAS du FX live quand stockée", () => {
    const stored = 910.91
    const a = safeCostBasisChf(stored, 10, 100, "USD", { CHF: 1, USD: 1.10 })
    const b = safeCostBasisChf(stored, 10, 100, "USD", { CHF: 1, USD: 1.30 })
    expect(a).toBe(b)
  })

  test("null/0 → fallback nativeTotal / taux courant", () => {
    expect(safeCostBasisChf(null, 10, 100, "USD", { CHF: 1, USD: 1.25 })).toBeCloseTo(800, 6)
    expect(safeCostBasisChf(0, 10, 100, "USD", { CHF: 1, USD: 1.25 })).toBeCloseTo(800, 6)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Scénario E — agrégats dashboard purs
// ───────────────────────────────────────────────────────────────────────────

describe("Scénario E — sumDividendsDisplay (pas de double FX)", () => {
  const rates: FXRates = { CHF: 1, USD: 1.25, EUR: 1.08 }

  test("netAmountChf présent → une seule conversion CHF → affichage", () => {
    const txs = [{ type: "dividend", quantity: 1, price: 50, currency: "USD", netAmountChf: 40 }]
    // Affichage USD: 40 CHF × 1.25 = 50 USD (PAS 40×convert×1.25)
    expect(sumDividendsDisplay(txs, "USD", rates)).toBeCloseTo(50, 6)
    // Affichage CHF: 40
    expect(sumDividendsDisplay(txs, "CHF", rates)).toBeCloseTo(40, 6)
  })

  test("fallback sans netAmountChf → natif → affichage, une seule conversion", () => {
    const txs = [{ type: "dividend", quantity: 2, price: 25, currency: "USD" }]
    // 50 USD → CHF = 40 → affichage USD = 50 (round-trip cohérent)
    expect(sumDividendsDisplay(txs, "USD", rates)).toBeCloseTo(50, 6)
    expect(sumDividendsDisplay(txs, "CHF", rates)).toBeCloseTo(40, 6)
  })

  test("les non-dividendes sont ignorés", () => {
    const txs = [
      { type: "buy", quantity: 10, price: 100, currency: "USD", netAmountChf: 800 },
      { type: "dividend", quantity: 1, price: 10, currency: "CHF", netAmountChf: 10 },
    ]
    expect(sumDividendsDisplay(txs, "CHF", rates)).toBeCloseTo(10, 6)
  })
})

describe("Scénario E — computeAllocation (cash compté une fois, unités homogènes)", () => {
  const rates: FXRates = { CHF: 1, USD: 1.25, EUR: 1.08 }
  const assets = [
    { assetClass: "etf", ticker: "EUNL", quantity: 10, currentPrice: 100, currency: "EUR" },
    { assetClass: "stock", ticker: "AAPL", quantity: 2, currentPrice: 200, currency: "USD" },
    { assetClass: "cash", ticker: "CASH-CHF", quantity: 500, currentPrice: 1, currency: "CHF" },
  ]

  test("les actifs cash de la boucle sont ignorés — le cash vient du total fourni", () => {
    const live = (t: string) => (t === "EUNL" ? 1000 : t === "AAPL" ? 400 : undefined)
    const entries = computeAllocation(assets, live, 800, "CHF", rates)
    const cash = entries.find(e => e.cls === "cash")
    // 800 uniquement (pas 800 + 500 de l'actif cash)
    expect(cash?.val).toBeCloseTo(800, 6)
  })

  test("les pourcentages somment à 100", () => {
    const live = (t: string) => (t === "EUNL" ? 1000 : t === "AAPL" ? 400 : undefined)
    const entries = computeAllocation(assets, live, 800, "CHF", rates)
    const totalPct = entries.reduce((s, e) => s + e.pct, 0)
    expect(totalPct).toBeCloseTo(100, 6)
  })

  test("fallback sans prix live : natif → devise d'affichage (pas de mélange d'unités)", () => {
    const entries = computeAllocation(assets, () => undefined, 0, "CHF", rates)
    const etf = entries.find(e => e.cls === "etf")
    // 10 × 100 EUR / 1.08 = 925.93 CHF (PAS 1000 « natif » compté comme CHF)
    expect(etf?.val).toBeCloseTo(1000 / 1.08, 4)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// herfindahlIndex — concentration du portefeuille
// ───────────────────────────────────────────────────────────────────────────

import { herfindahlIndex } from "./finance"

describe("herfindahlIndex", () => {
  test("position unique → 10000 (concentration maximale)", () => {
    expect(herfindahlIndex([500])).toBeCloseTo(10000, 6)
  })

  test("4 positions égales → 2500", () => {
    expect(herfindahlIndex([100, 100, 100, 100])).toBeCloseTo(2500, 6)
  })

  test("10 positions égales → 1000 (diversifié)", () => {
    expect(herfindahlIndex(Array(10).fill(50))).toBeCloseTo(1000, 6)
  })

  test("vide ou total nul → 0", () => {
    expect(herfindahlIndex([])).toBe(0)
    expect(herfindahlIndex([0, 0])).toBe(0)
  })
})
