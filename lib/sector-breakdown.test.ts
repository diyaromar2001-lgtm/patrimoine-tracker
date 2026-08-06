import { describe, test, expect } from "vitest"
import { sectorBreakdown, countryBreakdown, type FundamentalsMap } from "@/hooks/use-fundamentals"

const FUNDAMENTALS: FundamentalsMap = {
  NVDA: { kind: "stock", sector: "Technologie", country: "États-Unis" },
  NESN: { kind: "stock", sector: "Consommation de base", country: "Suisse" },
  // ETF moitié techno, moitié santé
  VWCE: { kind: "etf", sectorWeights: { Technologie: 50, Santé: 50 } },
  ZZZ:  { kind: "unknown" },
}

describe("répartition sectorielle par transparence", () => {
  test("une action verse toute sa valeur à son secteur", () => {
    const { rows } = sectorBreakdown([{ ticker: "NVDA", value: 1000 }], FUNDAMENTALS)
    expect(rows).toEqual([{ label: "Technologie", value: 1000, pct: 100 }])
  })

  test("un ETF répartit sa valeur selon les poids du fonds", () => {
    const { rows } = sectorBreakdown([{ ticker: "VWCE", value: 1000 }], FUNDAMENTALS)
    expect(rows.find(r => r.label === "Technologie")?.value).toBeCloseTo(500, 6)
    expect(rows.find(r => r.label === "Santé")?.value).toBeCloseTo(500, 6)
  })

  test("actions et ETF se cumulent dans le même secteur", () => {
    // 1000 de NVDA (100 % techno) + 1000 de VWCE (50 % techno) = 1500 techno
    const { rows } = sectorBreakdown(
      [{ ticker: "NVDA", value: 1000 }, { ticker: "VWCE", value: 1000 }],
      FUNDAMENTALS
    )
    expect(rows[0]).toMatchObject({ label: "Technologie" })
    expect(rows[0].value).toBeCloseTo(1500, 6)
    expect(rows[0].pct).toBeCloseTo(75, 6)
  })

  test("les poids d'un ETF sont normalisés s'ils ne totalisent pas 100", () => {
    // Yahoo renvoie parfois une somme légèrement différente de 100.
    const partial: FundamentalsMap = {
      X: { kind: "etf", sectorWeights: { Technologie: 30, Santé: 10 } },
    }
    const { rows } = sectorBreakdown([{ ticker: "X", value: 800 }], partial)
    expect(rows.find(r => r.label === "Technologie")?.value).toBeCloseTo(600, 6)
    expect(rows.reduce((s, r) => s + r.value, 0)).toBeCloseTo(800, 6)
  })

  test("ce qui n'est pas classable est isolé, pas dilué dans les pourcentages", () => {
    const { rows, unclassified } = sectorBreakdown(
      [{ ticker: "NVDA", value: 1000 }, { ticker: "ZZZ", value: 500 }],
      FUNDAMENTALS
    )
    expect(unclassified).toBe(500)
    // Le pourcentage porte sur ce qui est classé — 100 %, pas 66 %
    expect(rows[0].pct).toBeCloseTo(100, 6)
  })

  test("un portefeuille entièrement non classé ne produit aucune ligne", () => {
    const { rows, unclassified } = sectorBreakdown([{ ticker: "ZZZ", value: 500 }], FUNDAMENTALS)
    expect(rows).toHaveLength(0)
    expect(unclassified).toBe(500)
  })
})

describe("répartition géographique", () => {
  test("seules les actions portent un pays", () => {
    const { rows, unclassified } = countryBreakdown(
      [{ ticker: "NVDA", value: 600 }, { ticker: "NESN", value: 400 }, { ticker: "VWCE", value: 1000 }],
      FUNDAMENTALS
    )
    expect(rows.map(r => r.label)).toEqual(["États-Unis", "Suisse"])
    expect(rows[0].pct).toBeCloseTo(60, 6)
    // L'ETF mondial n'a pas de pays : il est annoncé comme non réparti
    expect(unclassified).toBe(1000)
  })
})
