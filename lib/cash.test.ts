import { describe, test, expect } from "vitest"
import {
  toChf, balancesInChf, sumBalances, normalizeBalances,
  applyDeposit, applyWithdrawal, applyBuy, applyCredit,
  applyConversion, applyTransfer, buildCashAccounts,
  UNASSIGNED_CASH, EMPTY_CASH,
} from "./cash"
import type { FXRates } from "./utils"

// rates[X] = unités de X pour 1 CHF
const RATES: FXRates = { CHF: 1, USD: 1.25, EUR: 1.08 }

describe("conversions", () => {
  test("un montant natif est ramené en CHF par division", () => {
    expect(toChf(125, "USD", RATES)).toBeCloseTo(100, 6)
    expect(toChf(50, "CHF", RATES)).toBe(50)
  })

  test("une devise absente de la table n'est pas convertie au hasard", () => {
    expect(toChf(100, "JPY", RATES)).toBe(100)
  })

  test("la contre-valeur d'un solde additionne les trois devises", () => {
    expect(balancesInChf({ CHF: 100, USD: 125, EUR: 108 }, RATES)).toBeCloseTo(300, 6)
  })

  test("un solde partiel ou absent est normalisé à zéro", () => {
    expect(normalizeBalances(undefined)).toEqual(EMPTY_CASH)
    expect(normalizeBalances({ USD: 10 })).toEqual({ CHF: 0, USD: 10, EUR: 0 })
  })
})

describe("dépôt et retrait", () => {
  test("un dépôt crédite la devise choisie et laisse les autres intactes", () => {
    const r = applyDeposit({ CHF: 100, USD: 0, EUR: 0 }, 50, "USD")
    expect(r.balances).toEqual({ CHF: 100, USD: 50, EUR: 0 })
    expect(r.movement).toEqual({ currency: "USD", amount: 50, note: undefined })
  })

  test("un retrait supérieur au solde ne descend pas sous zéro et signale le manque", () => {
    const r = applyWithdrawal({ CHF: 30, USD: 0, EUR: 0 }, 50, "CHF", RATES)
    expect(r.balances.CHF).toBe(0)
    expect(r.movement.amount).toBe(-30)          // seul le disponible est sorti
    expect(r.shortfallChf).toBeCloseTo(20, 6)    // le manque est dit, pas masqué
  })
})

describe("achat — quelle devise est débitée", () => {
  test("on paie dans la devise du titre quand le compte la détient", () => {
    const r = applyBuy({ CHF: 500, USD: 300, EUR: 0 }, 250, "USD", RATES)
    expect(r.balances).toEqual({ CHF: 500, USD: 50, EUR: 0 })
    expect(r.movement.currency).toBe("USD")
    expect(r.shortfallChf).toBe(0)
  })

  test("sinon le CHF paie la contre-valeur, et la note le dit", () => {
    const r = applyBuy({ CHF: 500, USD: 10, EUR: 0 }, 250, "USD", RATES)
    expect(r.balances.USD).toBe(10)              // le peu d'USD n'est pas entamé
    expect(r.balances.CHF).toBeCloseTo(500 - 200, 6)
    expect(r.movement.currency).toBe("CHF")
    expect(r.movement.note).toContain("USD converti")
  })

  test("un achat plus gros que tout le compte laisse un découvert explicite", () => {
    const r = applyBuy({ CHF: 50, USD: 0, EUR: 0 }, 250, "USD", RATES)
    expect(r.balances.CHF).toBe(0)
    expect(r.shortfallChf).toBeCloseTo(150, 6)   // 200 CHF requis, 50 dispo
  })

  test("une devise inconnue retombe sur le CHF plutôt que de créer une poche", () => {
    const r = applyBuy({ CHF: 100, USD: 0, EUR: 0 }, 20, "GBP", RATES)
    expect(r.movement.currency).toBe("CHF")
    expect(Object.keys(r.balances).sort()).toEqual(["CHF", "EUR", "USD"])
  })
})

describe("crédit de vente ou de dividende", () => {
  test("le produit arrive dans la devise reçue", () => {
    const r = applyCredit({ CHF: 0, USD: 100, EUR: 0 }, 250, "USD")
    expect(r.balances.USD).toBe(350)
    expect(r.movement).toEqual({ currency: "USD", amount: 250, note: undefined })
  })
})

describe("conversion interne à un compte", () => {
  test("le montant converti suit le taux, les deux jambes sont journalisées", () => {
    const r = applyConversion({ CHF: 200, USD: 0, EUR: 0 }, "CHF", "USD", 100, RATES)
    expect(r.error).toBeUndefined()
    expect(r.balances).toEqual({ CHF: 100, USD: 125, EUR: 0 })
    expect(r.toAmount).toBeCloseTo(125, 6)
    expect(r.movements.map(m => m.amount)).toEqual([-100, 125])
  })

  test("un solde insuffisant refuse la conversion sans rien modifier", () => {
    const before = { CHF: 50, USD: 0, EUR: 0 }
    const r = applyConversion(before, "CHF", "USD", 100, RATES)
    expect(r.error).toContain("insuffisant")
    expect(r.balances).toBe(before)
  })

  test("convertir une devise vers elle-même est refusé", () => {
    expect(applyConversion({ CHF: 100, USD: 0, EUR: 0 }, "CHF", "CHF", 10, RATES).error)
      .toBeTruthy()
  })
})

describe("virement entre comptes", () => {
  test("l'argent quitte un compte et arrive sur l'autre, total conservé", () => {
    const r = applyTransfer({ CHF: 300, USD: 0, EUR: 0 }, { CHF: 20, USD: 0, EUR: 0 }, 100, "CHF")
    expect(r.error).toBeUndefined()
    expect(r.from.CHF).toBe(200)
    expect(r.to.CHF).toBe(120)
    expect(r.from.CHF + r.to.CHF).toBe(320)
  })

  test("un virement au-delà du solde est refusé, rien ne bouge", () => {
    const from = { CHF: 50, USD: 0, EUR: 0 }
    const to   = { CHF: 0, USD: 0, EUR: 0 }
    const r = applyTransfer(from, to, 100, "CHF")
    expect(r.error).toContain("insuffisant")
    expect(r.from).toBe(from)
    expect(r.to).toBe(to)
  })
})

describe("écritures enchaînées", () => {
  test("créditer deux devises de suite les conserve toutes les deux", () => {
    // Reproduit l'import d'un relevé : CHF puis USD sur le même compte.
    // Chaque opération doit partir du solde issu de la précédente, sinon la
    // seconde écrase la première.
    let balances = EMPTY_CASH
    balances = applyDeposit(balances, 203.61, "CHF").balances
    balances = applyDeposit(balances, 1389.59, "USD").balances
    expect(balances.CHF).toBeCloseTo(203.61, 6)
    expect(balances.USD).toBeCloseTo(1389.59, 6)
  })

  test("un achat puis une vente rendent le compte à son point de départ", () => {
    const start = { CHF: 0, USD: 1000, EUR: 0 }
    const afterBuy = applyBuy(start, 250, "USD", RATES).balances
    expect(afterBuy.USD).toBe(750)
    const afterSell = applyCredit(afterBuy, 250, "USD").balances
    expect(afterSell).toEqual(start)
  })
})

describe("vue d'ensemble des comptes", () => {
  const portfolios = [
    { id: "p1", name: "IBKR",        cashBalances: { CHF: 203.61, USD: 1389.59, EUR: 0 } },
    { id: "p2", name: "Trading 212", cashBalances: { CHF: 50, USD: 0, EUR: 0 } },
  ]

  test("chaque portefeuille est un compte distinct", () => {
    const accounts = buildCashAccounts(portfolios, EMPTY_CASH)
    expect(accounts.map(a => a.label)).toEqual(["IBKR", "Trading 212"])
    expect(accounts.every(a => a.isPortfolio)).toBe(true)
  })

  test("la poche « Hors portefeuille » n'apparaît que si elle porte de l'argent", () => {
    expect(buildCashAccounts(portfolios, EMPTY_CASH)).toHaveLength(2)
    const withFree = buildCashAccounts(portfolios, { CHF: 1000, USD: 0, EUR: 0 })
    expect(withFree).toHaveLength(3)
    expect(withFree[2].id).toBe(UNASSIGNED_CASH)
    expect(withFree[2].isPortfolio).toBe(false)
  })

  test("le total agrège tous les comptes devise par devise", () => {
    const accounts = buildCashAccounts(portfolios, { CHF: 1000, USD: 0, EUR: 0 })
    const total = sumBalances(accounts)
    expect(total.CHF).toBeCloseTo(1253.61, 6)
    expect(total.USD).toBeCloseTo(1389.59, 6)
    expect(total.EUR).toBe(0)
  })

  test("un portefeuille sans solde enregistré compte pour zéro, pas pour NaN", () => {
    const accounts = buildCashAccounts([{ id: "p3", name: "Neuf" }], EMPTY_CASH)
    expect(accounts[0].balances).toEqual(EMPTY_CASH)
    expect(balancesInChf(sumBalances(accounts), RATES)).toBe(0)
  })
})
