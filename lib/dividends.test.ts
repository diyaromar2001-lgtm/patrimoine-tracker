import { describe, test, expect } from "vitest"
import {
  toReceivedDividend, summarizeDividends,
  estimateAnnualIncome, currentYieldPct, yieldOnCostPct, capitalForMonthlyIncome,
} from "./dividends"

const RATES = { CHF: 1, USD: 1.25, EUR: 1.08 }
const TODAY = new Date("2026-07-15")

const TXS = [
  { type: "dividend", ticker: "IDVY", quantity: 3.6, price: 0.5, currency: "EUR", date: "2026-03-10", grossAmountChf: 1.667, feesChf: 0, netAmountChf: 1.667 },
  { type: "dividend", ticker: "ROP", quantity: 0.0284624, price: 6.37, currency: "CHF", date: "2026-03-16", grossAmountChf: 0.18, feesChf: 0.06, netAmountChf: 0.12 },
  { type: "dividend", ticker: "O", quantity: 10, price: 0.26, currency: "USD", date: "2025-09-15", grossAmountChf: 2.08, feesChf: 0.31, netAmountChf: 1.77 },
  { type: "dividend", ticker: "O", quantity: 10, price: 0.26, currency: "USD", date: "2024-01-15", grossAmountChf: 2.3, feesChf: 0.35, netAmountChf: 1.95 }, // hors 12 mois
  { type: "buy", ticker: "O", quantity: 10, price: 55, currency: "USD", date: "2025-01-05", netAmountChf: 440 }, // ignoré
]

describe("toReceivedDividend", () => {
  test("une seule conversion CHF → affichage (pas de double FX)", () => {
    const d = toReceivedDividend(TXS[1], "USD", RATES)
    expect(d.gross).toBeCloseTo(0.18 * 1.25, 6)
    expect(d.withholding).toBeCloseTo(0.06 * 1.25, 6)
    expect(d.net).toBeCloseTo(0.12 * 1.25, 6)
  })

  test("fallback sans montants CHF : natif → affichage", () => {
    const d = toReceivedDividend({ type: "dividend", ticker: "X", quantity: 2, price: 25, currency: "USD", date: "2026-01-01" }, "CHF", RATES)
    expect(d.gross).toBeCloseTo(50 / 1.25, 6)  // 40 CHF
    expect(d.net).toBeCloseTo(40, 6)
  })
})

describe("summarizeDividends", () => {
  const s = summarizeDividends(TXS, "CHF", RATES, TODAY)

  test("YTD net/brut/retenue (2026 uniquement)", () => {
    expect(s.receivedYtdGross).toBeCloseTo(1.667 + 0.18, 3)
    expect(s.withholdingYtd).toBeCloseTo(0.06, 6)
    expect(s.receivedYtdNet).toBeCloseTo(1.667 + 0.12, 3)
  })

  test("12 mois glissants exclut le versement 2024", () => {
    expect(s.received12mNet).toBeCloseTo(1.667 + 0.12 + 1.77, 3)
    expect(s.history).toHaveLength(4)          // tout l'historique, trié
    expect(s.history[0].date).toBe("2026-03-16")
  })

  test("répartition par ticker + concentration", () => {
    expect(s.byTicker[0].ticker).toBe("O")     // 1.77 > 1.667
    const totalPct = s.byTicker.reduce((x, t) => x + t.pct, 0)
    expect(totalPct).toBeCloseTo(100, 6)
    expect(s.topConcentrationPct).toBeCloseTo((1.77 / (1.667 + 0.12 + 1.77)) * 100, 3)
  })
})

describe("projections estimées", () => {
  test("estimateAnnualIncome convertit natif → affichage", () => {
    const income = estimateAnnualIncome(
      [{ ticker: "O", quantity: 10 }, { ticker: "AAPL", quantity: 5 }],
      [{ ticker: "O", annualRatePerShare: 3.12, currency: "USD" }, { ticker: "AAPL", annualRatePerShare: null }],
      "CHF", RATES
    )
    expect(income).toBeCloseTo(31.2 / 1.25, 6) // 24.96 CHF ; AAPL sans taux ignoré
  })

  test("rendements et capital nécessaire", () => {
    expect(currentYieldPct(300, 10000)).toBeCloseTo(3, 6)
    expect(yieldOnCostPct(300, 7500)).toBeCloseTo(4, 6)
    expect(capitalForMonthlyIncome(100, 3)).toBeCloseTo(40000, 6)
    expect(capitalForMonthlyIncome(100, 0)).toBeNull() // pas de chiffre inventé
  })
})
