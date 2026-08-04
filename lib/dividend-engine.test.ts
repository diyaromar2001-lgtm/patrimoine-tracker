import { describe, test, expect } from "vitest"
import {
  quantityHeldAt,
  computeReceivedDividends,
  groupByMonth,
  groupByYear,
  groupByTicker,
  summarizeReal,
  nextExpectedDividend,
  type DividendTxInput,
  type DividendEvent,
} from "./dividend-engine"
import type { FXRates } from "./finance"

const RATES: FXRates = { CHF: 1, USD: 1.25, EUR: 1.08 }

// Scénario calqué sur le cas réel : Realty Income (O), dividende mensuel USD.
const TXS: DividendTxInput[] = [
  { ticker: "O", type: "buy",  quantity: 5,   date: "2025-08-04" },
  { ticker: "O", type: "buy",  quantity: 1,   date: "2025-10-10" },
  { ticker: "O", type: "sell", quantity: 2,   date: "2025-12-20" },
  { ticker: "X", type: "buy",  quantity: 100, date: "2025-01-01" },
]

const EVENTS: DividendEvent[] = [
  { ticker: "O", exDate: "2025-07-01", amountPerShare: 0.269, currency: "USD" }, // avant achat
  { ticker: "O", exDate: "2025-09-02", amountPerShare: 0.269, currency: "USD" },
  { ticker: "O", exDate: "2025-10-31", amountPerShare: 0.270, currency: "USD" },
  { ticker: "O", exDate: "2026-01-30", amountPerShare: 0.270, currency: "USD" },
]

describe("quantityHeldAt — détention à une date", () => {
  test("avant tout achat → 0", () => {
    expect(quantityHeldAt(TXS, "O", "2025-08-01")).toBe(0)
  })

  test("le jour de l'achat, la quantité n'est PAS encore acquise (règle ex-date)", () => {
    // strictlyBefore : un achat le jour de l'ex-date ne donne pas droit au dividende
    expect(quantityHeldAt(TXS, "O", "2025-08-04")).toBe(0)
    expect(quantityHeldAt(TXS, "O", "2025-08-05")).toBe(5)
  })

  test("cumule les achats puis retranche les ventes", () => {
    expect(quantityHeldAt(TXS, "O", "2025-10-31")).toBe(6)   // 5 + 1
    expect(quantityHeldAt(TXS, "O", "2026-01-30")).toBe(4)   // 6 − 2
  })

  test("strictlyBefore=false inclut les opérations du jour", () => {
    expect(quantityHeldAt(TXS, "O", "2025-08-04", false)).toBe(5)
  })
})

describe("computeReceivedDividends — éligibilité et montants", () => {
  const details = computeReceivedDividends(TXS, EVENTS, "CHF", RATES, "2026-08-04")

  test("un dividende dont l'ex-date précède l'achat n'est PAS perçu", () => {
    expect(details.find(d => d.exDate === "2025-07-01")).toBeUndefined()
  })

  test("brut = quantité détenue × montant par action, converti une seule fois", () => {
    const sep = details.find(d => d.exDate === "2025-09-02")!
    expect(sep.quantityHeld).toBe(5)
    // 5 × 0.269 = 1.345 USD → /1.25 = 1.076 CHF
    expect(sep.gross).toBeCloseTo(5 * 0.269 / 1.25, 6)
    expect(sep.nativeCurrency).toBe("USD")
    expect(sep.fxRateUsed).toBeCloseTo(1 / 1.25, 6)
  })

  test("la quantité suit les achats/ventes intervenus entre deux versements", () => {
    expect(details.find(d => d.exDate === "2025-10-31")!.quantityHeld).toBe(6)
    expect(details.find(d => d.exDate === "2026-01-30")!.quantityHeld).toBe(4)
  })

  test("la retenue à la source n'est jamais inventée", () => {
    // Aucune transaction dividende avec frais → withholding null, net = brut
    for (const d of details) {
      expect(d.withholding).toBeNull()
      expect(d.net).toBeCloseTo(d.gross, 10)
    }
  })

  test("une retenue réelle issue d'une transaction est utilisée", () => {
    const withTax: DividendTxInput[] = [
      ...TXS,
      { ticker: "O", type: "dividend", quantity: 0, date: "2025-09-05", feesChf: 0.16 },
    ]
    const d = computeReceivedDividends(withTax, EVENTS, "CHF", RATES, "2026-08-04")
      .find(x => x.exDate === "2025-09-02")!
    expect(d.withholding).toBeCloseTo(0.16, 6)
    expect(d.net).toBeCloseTo(d.gross - 0.16, 6)
  })

  test("les versements futurs sont exclus du réel", () => {
    const early = computeReceivedDividends(TXS, EVENTS, "CHF", RATES, "2025-11-01")
    expect(early.some(d => d.exDate === "2026-01-30")).toBe(false)
  })

  test("un actif jamais détenu ne génère rien", () => {
    const evOther: DividendEvent[] = [{ ticker: "ZZZ", exDate: "2025-09-02", amountPerShare: 1, currency: "USD" }]
    expect(computeReceivedDividends(TXS, evOther, "CHF", RATES, "2026-08-04")).toHaveLength(0)
  })
})

describe("agrégations", () => {
  const details = computeReceivedDividends(TXS, EVENTS, "CHF", RATES, "2026-08-04")

  test("groupByMonth trie par mois et conserve le détail", () => {
    const months = groupByMonth(details)
    expect(months.map(m => m.month)).toEqual(["2025-09", "2025-10", "2026-01"])
    expect(months[0].details).toHaveLength(1)
    expect(months[0].net).toBeCloseTo(5 * 0.269 / 1.25, 6)
  })

  test("groupByYear sépare les exercices", () => {
    const years = groupByYear(details)
    expect(years.map(y => y.year)).toEqual(["2025", "2026"])
  })

  test("groupByTicker calcule des parts sommant à 100", () => {
    const byT = groupByTicker(details)
    expect(byT[0].ticker).toBe("O")
    expect(byT.reduce((s, t) => s + t.pct, 0)).toBeCloseTo(100, 6)
  })
})

describe("summarizeReal — YTD, année précédente et progression", () => {
  const details = computeReceivedDividends(TXS, EVENTS, "CHF", RATES, "2026-08-04")
  const s = summarizeReal(details, "2026-08-04")

  test("YTD ne retient que l'année en cours", () => {
    expect(s.ytdNet).toBeCloseTo(4 * 0.270 / 1.25, 6)   // seul le versement de 2026
  })

  test("l'année précédente est bornée à la même date pour une comparaison juste", () => {
    // 2025 : 2025-09-02 et 2025-10-31, tous deux avant le 04/08 ? Non →
    // seuls les versements jusqu'au 2025-08-04 comptent, donc aucun.
    expect(s.previousYearNet).toBeCloseTo(0, 10)
    expect(s.yoyPct).toBeNull()   // pas de base de comparaison → pas de % inventé
  })

  test("progression calculée quand une base existe", () => {
    const withBase = computeReceivedDividends(
      [{ ticker: "O", type: "buy", quantity: 10, date: "2024-01-01" }],
      [
        { ticker: "O", exDate: "2025-03-01", amountPerShare: 1, currency: "CHF" },
        { ticker: "O", exDate: "2026-03-01", amountPerShare: 2, currency: "CHF" },
      ],
      "CHF", RATES, "2026-08-04"
    )
    const r = summarizeReal(withBase, "2026-08-04")
    expect(r.previousYearNet).toBeCloseTo(10, 6)
    expect(r.ytdNet).toBeCloseTo(20, 6)
    expect(r.yoyPct).toBeCloseTo(100, 6)
  })

  test("moyenne mensuelle sur les mois réellement couverts", () => {
    expect(s.monthlyAvg).toBeCloseTo(s.totalNet / 3, 6)
  })
})

describe("nextExpectedDividend", () => {
  test("retourne le premier versement futur sur une ligne détenue", () => {
    const next = nextExpectedDividend(TXS, EVENTS, "CHF", RATES, "2025-12-01")
    expect(next?.exDate).toBe("2026-01-30")
    expect(next?.ticker).toBe("O")
    expect(next?.amount).toBeCloseTo(6 * 0.270 / 1.25, 6)  // 6 détenues au 01/12
  })

  test("null si plus aucun versement à venir", () => {
    expect(nextExpectedDividend(TXS, EVENTS, "CHF", RATES, "2027-01-01")).toBeNull()
  })

  test("ignore les actifs non détenus", () => {
    const ev: DividendEvent[] = [{ ticker: "ZZZ", exDate: "2026-12-01", amountPerShare: 5, currency: "USD" }]
    expect(nextExpectedDividend(TXS, ev, "CHF", RATES, "2026-08-04")).toBeNull()
  })
})
