import { describe, test, expect } from "vitest"
import { aggregateCashflow, classifyMovement, movementsForMonth } from "./cashflow"
import type { CashMovement } from "./types"

// Scénario D — fixture 6 mois / 3 devises. Taux: USD 1.25, EUR 1.08 par CHF.
const RATES: Record<string, number> = { CHF: 1, USD: 1.25, EUR: 1.08 }
const convert = (amount: number, currency: string) => amount / (RATES[currency] ?? 1)

const mk = (over: Partial<CashMovement>): CashMovement => ({
  id: Math.random().toString(36).slice(2),
  type: "deposit",
  currency: "CHF",
  amount: 0,
  date: "2026-01-15",
  ...over,
})

const FIXTURE: CashMovement[] = [
  // Janvier: dépôt 1000 CHF, achat 500 CHF
  mk({ type: "deposit", amount: 1000, date: "2026-01-05" }),
  mk({ type: "buy_deduction", amount: -500, date: "2026-01-10", refTicker: "EUNL" }),
  // Février: dividende 50 USD, intérêts 12.5 USD, frais −5 CHF
  mk({ type: "dividend_credit", amount: 50, currency: "USD", date: "2026-02-12", refTicker: "AAPL" }),
  mk({ type: "revenue_credit", amount: 12.5, currency: "USD", date: "2026-02-20", note: "interest" }),
  mk({ type: "fee", amount: -5, date: "2026-02-21", note: "withholding" }),
  // Mars: revenu annexe 108 EUR, conversion interne (exclue)
  mk({ type: "revenue_credit", amount: 108, currency: "EUR", date: "2026-03-03", note: "Cashback" }),
  mk({ type: "conversion", amount: -100, currency: "CHF", date: "2026-03-05", note: "fx_from" }),
  mk({ type: "conversion", amount: 125, currency: "USD", date: "2026-03-05", note: "fx_to" }),
  // Avril: retrait 200 CHF
  mk({ type: "withdrawal", amount: -200, date: "2026-04-08" }),
  // Mai: vente 250 USD (investissement)
  mk({ type: "sell_credit", amount: 250, currency: "USD", date: "2026-05-15", refTicker: "SMH" }),
  // Juin: dépôt 300 CHF
  mk({ type: "deposit", amount: 300, date: "2026-06-02" }),
]

describe("classifyMovement", () => {
  test("revenue_credit + note interest → interest, sinon revenus", () => {
    expect(classifyMovement(mk({ type: "revenue_credit", note: "interest" }))).toBe("interest")
    expect(classifyMovement(mk({ type: "revenue_credit", note: "Cashback" }))).toBe("revenus")
    expect(classifyMovement(mk({ type: "revenue_credit" }))).toBe("revenus")
  })

  test("conversion → null (flux interne)", () => {
    expect(classifyMovement(mk({ type: "conversion" }))).toBeNull()
  })
})

describe("aggregateCashflow — flux externes (sans investissements)", () => {
  const summary = aggregateCashflow(FIXTURE, convert)

  test("mois présents triés, conversions et buys/sells exclus", () => {
    expect(summary.months.map(m => m.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-06",
    ])
    // Mai ne contient qu'une vente (investissement) → absent
  })

  test("janvier: 1000 in, 0 out (achat exclu)", () => {
    const jan = summary.months[0]
    expect(jan.totalIn).toBeCloseTo(1000, 6)
    expect(jan.totalOut).toBeCloseTo(0, 6)
    expect(jan.net).toBeCloseTo(1000, 6)
  })

  test("février: dividende + intérêts convertis en CHF, frais en sortie", () => {
    const feb = summary.months[1]
    expect(feb.inflows.dividends).toBeCloseTo(50 / 1.25, 6)   // 40
    expect(feb.inflows.interest).toBeCloseTo(12.5 / 1.25, 6)  // 10
    expect(feb.outflows.fees).toBeCloseTo(5, 6)
    expect(feb.net).toBeCloseTo(40 + 10 - 5, 6)
  })

  test("mars: revenu 108 EUR → 100 CHF, conversions ignorées", () => {
    const mar = summary.months[2]
    expect(mar.inflows.revenus).toBeCloseTo(100, 6)
    expect(mar.totalOut).toBeCloseTo(0, 6)
  })

  test("totaux et taux d'épargne", () => {
    // In: 1000 + 40 + 10 + 100 + 300 = 1450 ; Out: 5 + 200 = 205
    expect(summary.totalIn).toBeCloseTo(1450, 6)
    expect(summary.totalOut).toBeCloseTo(205, 6)
    expect(summary.net).toBeCloseTo(1245, 6)
    expect(summary.savingsRatePct).toBeCloseTo((1245 / 1450) * 100, 4)
  })

  test("byCategory pour le donut (valeurs absolues)", () => {
    expect(summary.byCategory.deposits).toBeCloseTo(1300, 6)
    expect(summary.byCategory.withdrawals).toBeCloseTo(200, 6)
    expect(summary.byCategory.dividends).toBeCloseTo(40, 6)
    expect(summary.byCategory.buys).toBeUndefined()
  })
})

describe("aggregateCashflow — avec investissements", () => {
  const summary = aggregateCashflow(FIXTURE, convert, { includeInvestments: true })

  test("mai apparaît avec la vente 250 USD → 200 CHF en entrée", () => {
    const may = summary.months.find(m => m.month === "2026-05")
    expect(may?.inflows.sells).toBeCloseTo(200, 6)
  })

  test("janvier inclut l'achat 500 CHF en sortie", () => {
    const jan = summary.months.find(m => m.month === "2026-01")
    expect(jan?.outflows.buys).toBeCloseTo(500, 6)
    expect(jan?.net).toBeCloseTo(500, 6)
  })
})

describe("aggregateCashflow — filtre de période", () => {
  test("fromDate/toDate bornent l'agrégation", () => {
    const summary = aggregateCashflow(FIXTURE, convert, { fromDate: "2026-02-01", toDate: "2026-03-31" })
    expect(summary.months.map(m => m.month)).toEqual(["2026-02", "2026-03"])
  })
})

describe("movementsForMonth", () => {
  test("liste du mois, hors conversions, triée récente d'abord", () => {
    const feb = movementsForMonth(FIXTURE, "2026-02")
    expect(feb).toHaveLength(3)
    expect(feb[0].date >= feb[1].date).toBe(true)
  })

  test("les investissements suivent le toggle", () => {
    expect(movementsForMonth(FIXTURE, "2026-01")).toHaveLength(1)
    expect(movementsForMonth(FIXTURE, "2026-01", { includeInvestments: true })).toHaveLength(2)
  })
})
