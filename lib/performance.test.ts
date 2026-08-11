import { describe, test, expect } from "vitest"
import {
  xirr, portfolioCashFlows, timeWeightedReturn, annualize,
  periodicReturns, periodsPerYear, annualizedVolatility, sharpeRatio, beta,
  drawdown, riskMetrics, type ValuePoint,
} from "./performance"

// ═══════════════════════════════════════════════════════════════════════════
// XIRR
// ═══════════════════════════════════════════════════════════════════════════

describe("xirr — rendement pondéré par les montants", () => {
  test("un doublement en un an vaut 100 %", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount:  2000 },
    ])!
    expect(r * 100).toBeCloseTo(100, 1)
  })

  test("aucun gain donne 0 %", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount:  1000 },
    ])!
    expect(r * 100).toBeCloseTo(0, 4)
  })

  test("une perte donne un taux négatif", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount:   800 },
    ])!
    expect(r * 100).toBeCloseTo(-20, 1)
  })

  test("+10 % sur six mois s'annualise au-dessus de 20 %", () => {
    // (1,10)^2 − 1 ≈ 21 % : le taux est ANNUEL, pas le gain brut.
    const r = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2025-07-02", amount:  1100 },
    ])!
    expect(r * 100).toBeGreaterThan(20)
    expect(r * 100).toBeLessThan(22)
  })

  test("la date des versements change le résultat — c'est tout l'intérêt", () => {
    // Même argent investi, même valeur finale, mais le second verse tard.
    const tot = (second: string) => xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: second,       amount: -1000 },
      { date: "2026-01-01", amount:  2200 },
    ])!
    // Verser tard et finir au même montant = meilleur rendement sur le capital
    expect(tot("2025-11-01")).toBeGreaterThan(tot("2025-02-01"))
  })

  test("le cas concret d'un versement mensuel reste plausible", () => {
    const flows = []
    for (let m = 0; m < 12; m++) {
      flows.push({ date: `2025-${String(m + 1).padStart(2, "0")}-01`, amount: -100 })
    }
    flows.push({ date: "2026-01-01", amount: 1260 })   // 1200 versés, 1260 récupérés
    const r = xirr(flows)!
    // Le capital n'a été exposé qu'en moyenne ~6 mois → taux annuel > gain brut (5 %)
    expect(r * 100).toBeGreaterThan(8)
    expect(r * 100).toBeLessThan(12)
  })

  test("refuse de produire un taux quand il n'a pas de sens", () => {
    expect(xirr([])).toBeNull()
    expect(xirr([{ date: "2025-01-01", amount: -100 }])).toBeNull()
    // Que des sorties : rien n'a été récupéré
    expect(xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-06-01", amount: -100 },
    ])).toBeNull()
  })

  test("l'ordre des flux fournis n'influence pas le résultat", () => {
    const a = xirr([
      { date: "2026-01-01", amount:  2000 },
      { date: "2025-01-01", amount: -1000 },
    ])!
    const b = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount:  2000 },
    ])!
    expect(a).toBeCloseTo(b, 10)
  })
})

describe("portfolioCashFlows", () => {
  test("achat = sortie, vente et dividende = entrée, valeur actuelle en dernier", () => {
    const flows = portfolioCashFlows([
      { type: "buy",      date: "2025-01-01", amountChf: 1000 },
      { type: "sell",     date: "2025-06-01", amountChf: 400 },
      { type: "dividend", date: "2025-09-01", amountChf: 20 },
    ], 900, "2026-01-01")

    expect(flows.find(f => f.date === "2025-01-01")!.amount).toBe(-1000)
    expect(flows.find(f => f.date === "2025-06-01")!.amount).toBe(400)
    expect(flows.find(f => f.date === "2025-09-01")!.amount).toBe(20)
    expect(flows[flows.length - 1]).toEqual({ date: "2026-01-01", amount: 900 })
  })

  test("un montant nul est ignoré plutôt que de polluer la série", () => {
    const flows = portfolioCashFlows([
      { type: "dividend", date: "2025-01-01", amountChf: 0 },
      { type: "buy",      date: "2025-01-01", amountChf: 100 },
    ], 120)
    expect(flows.filter(f => f.amount === 0)).toHaveLength(0)
  })

  test("les dépôts ne sont pas des flux d'investissement", () => {
    // Déposer du cash n'achète rien : cela ne doit pas peser sur le rendement.
    const flows = portfolioCashFlows([
      { type: "deposit", date: "2025-01-01", amountChf: 5000 },
      { type: "buy",     date: "2025-01-02", amountChf: 1000 },
    ], 1100)
    expect(flows).toHaveLength(2)
    expect(flows[0].amount).toBe(-1000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TWR
// ═══════════════════════════════════════════════════════════════════════════

describe("timeWeightedReturn", () => {
  test("sans versement, c'est simplement la variation de valeur", () => {
    const r = timeWeightedReturn([
      { date: "2025-01-01", value: 100 },
      { date: "2025-06-01", value: 110 },
      { date: "2026-01-01", value: 121 },
    ])!
    expect(r).toBeCloseTo(21, 6)
  })

  test("un versement n'est PAS compté comme une performance", () => {
    // La valeur passe de 100 à 200, mais 100 viennent d'un apport :
    // la performance réelle est nulle.
    const r = timeWeightedReturn(
      [{ date: "2025-01-01", value: 100 }, { date: "2025-02-01", value: 200 }],
      { "2025-02-01": 100 }
    )!
    expect(r).toBeCloseTo(0, 6)
  })

  test("c'est là que TWR et IRR divergent", () => {
    // Gros apport juste avant une baisse : le TWR ignore le mauvais timing,
    // l'IRR le sanctionne. Les deux ont raison, ils répondent à deux questions.
    const twr = timeWeightedReturn(
      [
        { date: "2025-01-01", value: 100 },
        { date: "2025-06-01", value: 1100 },   // +1000 d'apport
        { date: "2025-12-01", value: 990 },    // −10 %
      ],
      { "2025-06-01": 1000 }
    )!
    expect(twr).toBeCloseTo(-10, 6)

    const irr = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-06-01", amount: -1000 },
      { date: "2025-12-01", amount: 990 },
    ])!
    expect(irr * 100).toBeLessThan(twr)   // l'IRR est plus sévère
  })

  test("une série trop courte ne renvoie rien", () => {
    expect(timeWeightedReturn([{ date: "2025-01-01", value: 100 }])).toBeNull()
  })
})

describe("annualize", () => {
  test("+21 % sur deux ans font ~10 % par an", () => {
    expect(annualize(21, 730)!).toBeCloseTo(10, 1)
  })

  test("une période trop courte n'est pas annualisée", () => {
    // Extrapoler trois jours sur un an produirait des chiffres absurdes.
    expect(annualize(2, 3)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Risque
// ═══════════════════════════════════════════════════════════════════════════

const flat: ValuePoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: `2025-01-${String(i + 1).padStart(2, "0")}`, value: 100,
}))

describe("périodicité et rendements", () => {
  test("les rendements successifs sont corrects", () => {
    const r = periodicReturns([
      { date: "2025-01-01", value: 100 },
      { date: "2025-01-02", value: 110 },
      { date: "2025-01-03", value: 99 },
    ])
    expect(r[0]).toBeCloseTo(0.1, 6)
    expect(r[1]).toBeCloseTo(-0.1, 6)
  })

  test("la fréquence est déduite de l'espacement réel", () => {
    const daily = Array.from({ length: 20 }, (_, i) =>
      ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), value: 100 + i }))
    const weekly = Array.from({ length: 20 }, (_, i) =>
      ({ date: new Date(Date.UTC(2025, 0, 1 + i * 7)).toISOString().slice(0, 10), value: 100 + i }))
    expect(periodsPerYear(daily)).toBe(252)
    expect(periodsPerYear(weekly)).toBe(52)
  })
})

describe("volatilité", () => {
  test("une série plate a une volatilité nulle", () => {
    expect(annualizedVolatility(flat)!).toBeCloseTo(0, 10)
  })

  test("une série agitée a une volatilité élevée", () => {
    const choppy = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      value: i % 2 === 0 ? 100 : 110,
    }))
    expect(annualizedVolatility(choppy)!).toBeGreaterThan(50)
  })

  test("un historique trop court ne produit pas de chiffre", () => {
    expect(annualizedVolatility([{ date: "2025-01-01", value: 100 }])).toBeNull()
  })
})

describe("Sharpe", () => {
  test("une hausse régulière donne un Sharpe très élevé", () => {
    const steady = Array.from({ length: 40 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      value: 100 * Math.pow(1.001, i),
    }))
    expect(sharpeRatio(steady)!).toBeGreaterThan(5)
  })

  test("sans volatilité, le ratio n'est pas défini", () => {
    expect(sharpeRatio(flat)).toBeNull()
  })

  test("un taux sans risque plus élevé abaisse le ratio", () => {
    const s = Array.from({ length: 40 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      value: 100 + i + (i % 3),
    }))
    expect(sharpeRatio(s, 5)!).toBeLessThan(sharpeRatio(s, 0)!)
  })
})

describe("bêta", () => {
  const bench: ValuePoint[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
    value: 100 * Math.pow(1.01, i % 5 === 0 ? -1 : 1),
  }))

  test("une copie de l'indice a un bêta de 1", () => {
    expect(beta(bench, bench)!).toBeCloseTo(1, 6)
  })

  test("un portefeuille deux fois plus réactif a un bêta de 2", () => {
    // Rendements doublés → bêta 2
    const amplified: ValuePoint[] = [{ date: bench[0].date, value: 100 }]
    const bRets = periodicReturns(bench)
    bRets.forEach((r, i) => {
      amplified.push({
        date: bench[i + 1].date,
        value: amplified[i].value * (1 + 2 * r),
      })
    })
    expect(beta(amplified, bench)!).toBeCloseTo(2, 1)
  })

  test("sans dates communes, aucun bêta n'est calculé", () => {
    const other = bench.map(p => ({ date: "2030-" + p.date.slice(5), value: p.value }))
    expect(beta(other, bench)).toBeNull()
  })
})

describe("drawdown", () => {
  test("mesure la plus forte baisse depuis un sommet", () => {
    const d = drawdown([
      { date: "2025-01-01", value: 100 },
      { date: "2025-02-01", value: 150 },
      { date: "2025-03-01", value: 75 },     // −50 % depuis 150
      { date: "2025-04-01", value: 140 },
    ])
    expect(d).toBeCloseTo(-50, 6)
  })

  test("une série toujours croissante n'a pas de drawdown", () => {
    expect(drawdown([
      { date: "2025-01-01", value: 100 },
      { date: "2025-02-01", value: 120 },
    ])).toBe(0)
  })
})

describe("riskMetrics", () => {
  test("regroupe les mesures et expose la taille d'échantillon", () => {
    const m = riskMetrics(flat)
    expect(m.sampleSize).toBe(29)
    expect(m.volatility).toBeCloseTo(0, 10)
    expect(m.beta).toBeNull()          // aucun indice fourni
  })
})
