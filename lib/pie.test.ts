import { describe, test, expect } from "vitest"
import {
  computePie, balanceScore, planContribution, planRebalance, targetsFromCurrent,
  type PieInput, type TargetAllocation,
} from "./pie"

const POSITIONS: PieInput[] = [
  { ticker: "VWCE", value: 600 },
  { ticker: "NVDA", value: 400 },
]
// 50/50 voulu, 60/40 réel
const TARGETS: TargetAllocation = { VWCE: 50, NVDA: 50 }

describe("computePie — écart entre le voulu et le réel", () => {
  const pie = computePie(POSITIONS, TARGETS)

  test("le poids réel et l'écart sont calculés par ligne", () => {
    const vwce = pie.slices.find(s => s.ticker === "VWCE")!
    expect(vwce.currentPct).toBeCloseTo(60, 6)
    expect(vwce.targetPct).toBe(50)
    expect(vwce.driftPct).toBeCloseTo(10, 6)
    // Il faudrait retirer 100 pour revenir à 500 sur 1000
    expect(vwce.driftValue).toBeCloseTo(-100, 6)
  })

  test("une ligne ciblée mais non détenue apparaît à 0 %", () => {
    // C'est là qu'il faut investir : la masquer serait contre-productif.
    const p = computePie(POSITIONS, { ...TARGETS, MSFT: 10 })
    const msft = p.slices.find(s => s.ticker === "MSFT")!
    expect(msft.value).toBe(0)
    expect(msft.currentPct).toBe(0)
    expect(msft.driftValue).toBeGreaterThan(0)
  })

  test("une ligne détenue sans cible est signalée", () => {
    const p = computePie([...POSITIONS, { ticker: "BTC", value: 200 }], TARGETS)
    expect(p.untargeted).toEqual(["BTC"])
  })

  test("la dérive ne compte que les écarts positifs", () => {
    // +10 sur VWCE et −10 sur NVDA : la distance est 10, pas 20.
    expect(pie.totalDriftPct).toBeCloseTo(10, 6)
  })

  test("un portefeuille vide ne divise pas par zéro", () => {
    const p = computePie([], TARGETS)
    expect(p.totalValue).toBe(0)
    expect(p.slices.every(s => s.currentPct === 0)).toBe(true)
  })
})

describe("balanceScore", () => {
  test("10 quand rien ne dérive, 1 au-delà du seuil", () => {
    expect(balanceScore(0, 100)).toBe(10)
    expect(balanceScore(25, 100)).toBe(1)
    expect(balanceScore(80, 100)).toBe(1)      // plafonné
  })

  test("décroissance linéaire entre les deux", () => {
    expect(balanceScore(12.5, 100)).toBeCloseTo(5.5, 6)
  })

  test("sans cible complète, la note vaut 0 plutôt qu'un chiffre trompeur", () => {
    expect(balanceScore(0, 80)).toBe(0)
    expect(balanceScore(0, 120)).toBe(0)
  })
})

describe("planContribution — où mettre l'argent frais", () => {
  const pie = computePie(POSITIONS, TARGETS)

  test("self-balancing sert d'abord la ligne en retard", () => {
    // 200 de plus → total 1200, cible 600/600. NVDA est à 400, il lui manque
    // 200 : toute la somme doit y aller.
    const plan = planContribution(pie, 200, "self-balancing")
    expect(plan).toHaveLength(1)
    expect(plan[0].ticker).toBe("NVDA")
    expect(plan[0].amount).toBeCloseTo(200, 2)
    expect(plan[0].resultingPct).toBeCloseTo(50, 1)
  })

  test("le surplus au-delà du rattrapage est réparti selon les cibles", () => {
    // 400 : 200 pour rattraper NVDA, puis 200 répartis 50/50
    const plan = planContribution(pie, 400, "self-balancing")
    const nvda = plan.find(p => p.ticker === "NVDA")!
    const vwce = plan.find(p => p.ticker === "VWCE")!
    expect(nvda.amount).toBeCloseTo(300, 2)
    expect(vwce.amount).toBeCloseTo(100, 2)
    expect(nvda.amount + vwce.amount).toBeCloseTo(400, 2)
  })

  test("une somme insuffisante va au prorata du retard", () => {
    const plan = planContribution(pie, 50, "self-balancing")
    expect(plan).toHaveLength(1)
    expect(plan[0].ticker).toBe("NVDA")   // seule ligne en retard
    expect(plan[0].amount).toBeCloseTo(50, 2)
  })

  test("by-targets ignore l'écart et applique les pourcentages", () => {
    const plan = planContribution(pie, 200, "by-targets")
    expect(plan.find(p => p.ticker === "VWCE")!.amount).toBeCloseTo(100, 2)
    expect(plan.find(p => p.ticker === "NVDA")!.amount).toBeCloseTo(100, 2)
  })

  test("la somme du plan égale toujours la contribution", () => {
    for (const amount of [10, 137.5, 1000, 25000]) {
      for (const mode of ["self-balancing", "by-targets"] as const) {
        const total = planContribution(pie, amount, mode).reduce((s, p) => s + p.amount, 0)
        expect(total).toBeCloseTo(amount, 1)
      }
    }
  })

  test("un montant nul ou sans cible ne produit aucun plan", () => {
    expect(planContribution(pie, 0)).toEqual([])
    expect(planContribution(computePie(POSITIONS, {}), 500)).toEqual([])
  })

  test("investir sur une ligne ciblée mais non détenue est prévu", () => {
    const p = computePie(POSITIONS, { VWCE: 40, NVDA: 40, MSFT: 20 })
    const plan = planContribution(p, 300, "self-balancing")
    expect(plan.find(x => x.ticker === "MSFT")!.amount).toBeGreaterThan(0)
  })
})

describe("planRebalance — arbitrage avec vente", () => {
  test("vend le surpondéré et achète le sous-pondéré, à taille constante", () => {
    const moves = planRebalance(computePie(POSITIONS, TARGETS))
    const sell = moves.find(m => m.ticker === "VWCE")!
    const buy  = moves.find(m => m.ticker === "NVDA")!
    expect(sell.action).toBe("sell")
    expect(buy.action).toBe("buy")
    expect(sell.amount).toBeCloseTo(100, 2)
    expect(buy.amount).toBeCloseTo(100, 2)
    // Ce qui est vendu finance exactement ce qui est acheté
    expect(sell.amount).toBeCloseTo(buy.amount, 2)
  })

  test("un écart sous le seuil ne déclenche aucun mouvement", () => {
    const almost = computePie([{ ticker: "A", value: 501 }, { ticker: "B", value: 499 }],
                              { A: 50, B: 50 })
    expect(planRebalance(almost, 0.5)).toEqual([])
  })

  test("aucun arbitrage proposé si la cible ne totalise pas 100", () => {
    expect(planRebalance(computePie(POSITIONS, { VWCE: 50 }))).toEqual([])
  })
})

describe("targetsFromCurrent — partir de l'existant", () => {
  test("reproduit la répartition actuelle et totalise exactement 100", () => {
    const t = targetsFromCurrent(POSITIONS)
    expect(t.VWCE).toBeCloseTo(60, 1)
    expect(t.NVDA).toBeCloseTo(40, 1)
    expect(Object.values(t).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 6)
  })

  test("le reliquat d'arrondi ne casse pas le total", () => {
    // Trois tiers : 33.3 × 3 = 99.9, il manque 0.1
    const t = targetsFromCurrent([
      { ticker: "A", value: 100 }, { ticker: "B", value: 100 }, { ticker: "C", value: 100 },
    ])
    expect(Object.values(t).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 6)
  })

  test("un portefeuille vide ne produit aucune cible", () => {
    expect(targetsFromCurrent([])).toEqual({})
  })
})
