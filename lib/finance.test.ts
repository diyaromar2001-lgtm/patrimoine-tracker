import { describe, it, expect } from "vitest"
import {
  weightedAveragePrice,
  assetLatentPnL,
  assetLatentPnLPct,
  portfolioTotalValue,
  portfolioTotalCostBasis,
  portfolioLatentPnL,
  portfolioLatentPnLPct,
  calculateAllocationByClass,
  calculateAssetWeight,
  totalAnnualDividend,
  dividendYieldOnCost,
  currentDividendYield,
  annualDividendPerShare,
  simpleReturn,
  cagr,
  convertCurrency,
  formatPct,
  generateInsights,
  DEFAULT_FX_RATES,
} from "./finance"

// ─── Conversion de devises ────────────────────────────────────────────────────

describe("convertCurrency", () => {
  it("same currency → unchanged", () => {
    expect(convertCurrency(100, "CHF", "CHF")).toBe(100)
  })

  it("CHF → USD", () => {
    const result = convertCurrency(100, "CHF", "USD", DEFAULT_FX_RATES)
    expect(result).toBeCloseTo(110.9, 1)
  })

  it("USD → CHF", () => {
    const result = convertCurrency(110.9, "USD", "CHF", DEFAULT_FX_RATES)
    expect(result).toBeCloseTo(100, 1)
  })

  it("EUR → CHF", () => {
    const result = convertCurrency(104.2, "EUR", "CHF", DEFAULT_FX_RATES)
    expect(result).toBeCloseTo(100, 1)
  })
})

// ─── Prix moyen pondéré ───────────────────────────────────────────────────────

describe("weightedAveragePrice", () => {
  it("achat initial", () => {
    expect(weightedAveragePrice(0, 0, 10, 100)).toBe(100)
  })

  it("achat supplémentaire au même prix", () => {
    expect(weightedAveragePrice(10, 100, 10, 100)).toBe(100)
  })

  it("achat supplémentaire à prix différent", () => {
    // 10 @ 100 + 10 @ 120 = avg (1000 + 1200) / 20 = 110
    expect(weightedAveragePrice(10, 100, 10, 120)).toBe(110)
  })

  it("renforcement à la baisse", () => {
    // 5 @ 200 + 5 @ 100 = avg (1000 + 500) / 10 = 150
    expect(weightedAveragePrice(5, 200, 5, 100)).toBe(150)
  })

  it("quantité 0 existante", () => {
    expect(weightedAveragePrice(0, 0, 23, 54.02)).toBeCloseTo(54.02)
  })
})

// ─── P&L latent ───────────────────────────────────────────────────────────────

describe("assetLatentPnL", () => {
  it("gain", () => {
    expect(assetLatentPnL(10, 150, 100)).toBe(500)  // 10 × (150 - 100)
  })
  it("perte", () => {
    expect(assetLatentPnL(10, 80, 100)).toBe(-200)  // 10 × (80 - 100)
  })
  it("neutre", () => {
    expect(assetLatentPnL(10, 100, 100)).toBe(0)
  })
})

describe("assetLatentPnLPct", () => {
  it("+50 %", () => {
    expect(assetLatentPnLPct(150, 100)).toBe(50)
  })
  it("-20 %", () => {
    expect(assetLatentPnLPct(80, 100)).toBe(-20)
  })
  it("prix moyen zéro → 0", () => {
    expect(assetLatentPnLPct(100, 0)).toBe(0)
  })
})

// ─── Valeur totale portefeuille ───────────────────────────────────────────────

const SAMPLE_ASSETS = [
  { ticker: "AAPL", quantity: 10, avgBuyPrice: 150, currentPrice: 180, assetClass: "stock" },
  { ticker: "BTC",  quantity:  1, avgBuyPrice: 30000, currentPrice: 52000, assetClass: "crypto" },
  { ticker: "CW8",  quantity:  5, avgBuyPrice: 400,   currentPrice: 420, assetClass: "etf" },
]

describe("portfolioTotalValue", () => {
  it("somme correcte", () => {
    // 10×180 + 1×52000 + 5×420 = 1800 + 52000 + 2100 = 55900
    expect(portfolioTotalValue(SAMPLE_ASSETS)).toBe(55900)
  })
  it("portefeuille vide → 0", () => {
    expect(portfolioTotalValue([])).toBe(0)
  })
})

describe("portfolioTotalCostBasis", () => {
  it("coût total correct", () => {
    // 10×150 + 1×30000 + 5×400 = 1500 + 30000 + 2000 = 33500
    expect(portfolioTotalCostBasis(SAMPLE_ASSETS)).toBe(33500)
  })
})

describe("portfolioLatentPnL", () => {
  it("plus-value totale", () => {
    // 55900 - 33500 = 22400
    expect(portfolioLatentPnL(SAMPLE_ASSETS)).toBe(22400)
  })
})

describe("portfolioLatentPnLPct", () => {
  it("pourcentage correct", () => {
    // 22400 / 33500 * 100 ≈ 66.87 %
    expect(portfolioLatentPnLPct(SAMPLE_ASSETS)).toBeCloseTo(66.87, 1)
  })
})

// ─── Allocation ───────────────────────────────────────────────────────────────

describe("calculateAllocationByClass", () => {
  it("répartit correctement par classe", () => {
    const alloc = calculateAllocationByClass(SAMPLE_ASSETS)
    expect(alloc.find(a => a.key === "crypto")?.value).toBe(52000)
    expect(alloc.find(a => a.key === "stock")?.value).toBe(1800)
    expect(alloc.find(a => a.key === "etf")?.value).toBe(2100)
  })
  it("les pourcentages somment à 100", () => {
    const alloc = calculateAllocationByClass(SAMPLE_ASSETS)
    const total = alloc.reduce((s, a) => s + a.pct, 0)
    expect(total).toBeCloseTo(100, 5)
  })
})

describe("calculateAssetWeight", () => {
  it("poids correct", () => {
    expect(calculateAssetWeight(5000, 10000)).toBe(50)
    expect(calculateAssetWeight(2500, 10000)).toBe(25)
  })
  it("total zéro → 0", () => {
    expect(calculateAssetWeight(100, 0)).toBe(0)
  })
})

// ─── Dividendes ───────────────────────────────────────────────────────────────

describe("annualDividendPerShare", () => {
  it("mensuel × 12", () => {
    expect(annualDividendPerShare(0.26, "monthly")).toBeCloseTo(3.12, 2)
  })
  it("trimestriel × 4", () => {
    expect(annualDividendPerShare(0.75, "quarterly")).toBe(3)
  })
  it("annuel × 1", () => {
    expect(annualDividendPerShare(60, "annual")).toBe(60)
  })
})

describe("totalAnnualDividend", () => {
  it("calcul correct multi-positions", () => {
    const divs = [
      { ticker: "MSFT", amountPerShare: 0.75, frequency: "quarterly" as const, quantity: 10 },
      { ticker: "O",    amountPerShare: 0.26, frequency: "monthly"   as const, quantity: 23 },
    ]
    // MSFT: 0.75×4×10 = 30 / O: 0.26×12×23 ≈ 71.76
    const total = totalAnnualDividend(divs)
    expect(total).toBeCloseTo(101.76, 1)
  })
})

describe("dividendYieldOnCost", () => {
  it("rendement sur coût", () => {
    expect(dividendYieldOnCost(30, 1000)).toBe(3)
  })
  it("coût zéro → 0", () => {
    expect(dividendYieldOnCost(30, 0)).toBe(0)
  })
})

describe("currentDividendYield", () => {
  it("rendement actuel", () => {
    expect(currentDividendYield(30, 1500)).toBe(2)
  })
})

// ─── Performance ─────────────────────────────────────────────────────────────

describe("simpleReturn", () => {
  it("+50 %", () => expect(simpleReturn(100, 150)).toBe(50))
  it("-25 %", () => expect(simpleReturn(100, 75)).toBe(-25))
  it("start=0 → 0", () => expect(simpleReturn(0, 100)).toBe(0))
})

describe("cagr", () => {
  it("doublement en 7 ans ≈ +10.4 %/an", () => {
    expect(cagr(1000, 2000, 7)).toBeCloseTo(10.41, 1)
  })
  it("aucune croissance → 0", () => {
    expect(cagr(1000, 1000, 5)).toBe(0)
  })
})

// ─── Formatage ────────────────────────────────────────────────────────────────

describe("formatPct", () => {
  it("positif avec +", () => expect(formatPct(8.99)).toBe("+8.99 %"))
  it("négatif", () => expect(formatPct(-0.25)).toBe("-0.25 %"))
  it("zéro", () => expect(formatPct(0)).toBe("0.00 %"))
})

// ─── Insights ─────────────────────────────────────────────────────────────────

describe("generateInsights", () => {
  it("détecte concentration élevée", () => {
    const assets = [
      { ticker: "ZURN", quantity: 1, avgBuyPrice: 500, currentPrice: 600, assetClass: "stock" },
      { ticker: "AAPL", quantity: 1, avgBuyPrice: 100, currentPrice: 20, assetClass: "stock" },
    ]
    const ins = generateInsights(assets)
    expect(ins.some(i => i.type === "warning" && i.ticker === "ZURN")).toBe(true)
  })

  it("portefeuille vide → aucun insight", () => {
    expect(generateInsights([])).toHaveLength(0)
  })

  it("détecte meilleur contributeur (2 actifs requis)", () => {
    const assets = [
      { ticker: "BTC",  quantity: 1, avgBuyPrice: 10000, currentPrice: 52000, assetClass: "crypto" },
      { ticker: "AAPL", quantity: 1, avgBuyPrice: 150,   currentPrice: 160,   assetClass: "stock" },
    ]
    const ins = generateInsights(assets)
    expect(ins.some(i => i.type === "success" && i.ticker === "BTC")).toBe(true)
  })
})
