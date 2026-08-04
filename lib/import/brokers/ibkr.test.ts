import { describe, test, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseIbkrCsv, splitSections, ibkrDate, reconcilePositions, ibkrAdapter } from "./ibkr"
import { detectBroker } from "./index"

const CSV = readFileSync(join(__dirname, "../__fixtures__/ibkr-sample.csv"), "utf-8")
const result = parseIbkrCsv(CSV)
const ops = result.operations

const find = (type: string, ticker?: string) =>
  ops.filter(o => o.type === type && (!ticker || o.ticker === ticker))

describe("segmentation du relevé", () => {
  test("chaque tableau concaténé devient une section", () => {
    const sections = splitSections(CSV)
    // P&L réalisé, positions, trades, trésorerie, titres, taux
    expect(sections.length).toBe(6)
    expect(sections.every(s => s.rows.length > 0)).toBe(true)
  })

  test("les dates IBKR sont normalisées", () => {
    expect(ibkrDate("20260421")).toBe("2026-04-21")
    expect(ibkrDate("20260421;093105")).toBe("2026-04-21")
    expect(ibkrDate("")).toBe("")
  })
})

describe("achats et ventes", () => {
  test("un achat garde le prix natif et convertit le total au taux du jour", () => {
    const buy = find("buy", "AMZN")[0]
    expect(buy.date).toBe("2026-04-21")
    expect(buy.quantity).toBe(1)
    // Prix unitaire commission incluse : 253 exécuté + 1 de commission
    expect(buy.price).toBeCloseTo(254, 6)
    expect(buy.priceCurrency).toBe("USD")
    // NetCash 254 USD (commission incluse) × 0.78081 = 198.3257 CHF
    expect(buy.totalAmount).toBeCloseTo(254 * 0.78081, 6)
    expect(buy.totalCurrency).toBe("CHF")
    expect(buy.exchangeRate).toBeCloseTo(0.78081, 6)
  })

  test("le prix moyen inclut la commission, comme le prix de revient IBKR", () => {
    const buy = find("buy", "AMZN")[0]
    // Le relevé exécute à 253 et prélève 1 : le coût réel est 254 par action.
    // Avec le prix d'exécution nu, le prix moyen affiché restait sous celui
    // du relevé.
    expect(buy.price).toBeGreaterThan(253)
    expect(buy.quantity! * buy.price!).toBeCloseTo(254, 6)
    // et le total en CHF reste cohérent avec ce prix
    expect(buy.totalAmount).toBeCloseTo(buy.quantity! * buy.price! * 0.78081, 6)
  })

  test("une vente est convertie au taux de SA date, pas du jour de l'achat", () => {
    const sell = find("sell", "AMZN")[0]
    expect(sell.date).toBe("2026-04-30")
    expect(sell.exchangeRate).toBeCloseTo(0.78139, 6)
    expect(sell.totalAmount).toBeCloseTo(271.934182436 * 0.78139, 6)
  })

  test("le nom et l'ISIN viennent du référentiel titres", () => {
    expect(find("buy", "AMZN")[0].name).toBe("AMAZON.COM INC")
    expect(find("buy", "AMZN")[0].isin).toBe("US0231351067")
    expect(find("buy", "VWCE")[0].isin).toBe("IE00BK5BQT80")
  })

  test("un achat en EUR utilise le taux EUR, pas le taux USD", () => {
    const vwce = find("buy", "VWCE")[0]
    expect(vwce.priceCurrency).toBe("EUR")
    expect(vwce.price).toBeCloseTo(985.313296 / 6, 6)   // commission incluse
    expect(vwce.exchangeRate).toBeCloseTo(0.92119, 6)
    expect(vwce.totalAmount).toBeCloseTo(985.313296 * 0.92119, 6)
  })

  test("deux exécutions partielles identiques restent deux opérations", () => {
    // Régression : un ordre exécuté en plusieurs fois produit des lignes
    // rigoureusement identiques (même horodatage, quantité et prix). Quand
    // l'identifiant ne les distinguait pas, la déduplication à l'insertion
    // n'en gardait qu'une et la position restait ouverte à tort.
    const twice = CSV.replace(
      '"U22434973","AMZN","20260430","20260430;083130","SELL","-1","272.94","-1.005817564","272.94","-254","271.934182436","17.934182","USD","STK"',
      '"U22434973","AMZN","20260430","20260430;083130","SELL","-1","272.94","-1.005817564","272.94","-254","271.934182436","17.934182","USD","STK"\n' +
      '"U22434973","AMZN","20260430","20260430;083130","SELL","-1","272.94","-1.005817564","272.94","-254","271.934182436","17.934182","USD","STK"'
    )
    const r = parseIbkrCsv(twice)
    const sells = r.operations.filter(o => o.type === "sell" && o.ticker === "AMZN")
    expect(sells).toHaveLength(2)
    expect(new Set(sells.map(o => o.sourceId)).size).toBe(2)
  })

  test("chaque opération porte un identifiant stable (import idempotent)", () => {
    const ids = ops.map(o => o.sourceId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(find("buy", "AMZN")[0].sourceId).toContain("AMZN")
  })
})

describe("conversions de devises", () => {
  test("un trade sur paire USD.CHF devient une conversion, pas un achat d'action", () => {
    const fx = find("fx_conversion")
    expect(fx).toHaveLength(1)
    expect(fx[0].fromCurrency).toBe("CHF")
    expect(fx[0].toCurrency).toBe("USD")
    expect(fx[0].toAmount).toBeCloseTo(419.53, 6)
    // et surtout : aucune position "USD.CHF" créée
    expect(ops.some(o => o.ticker === "USD.CHF")).toBe(false)
  })
})

describe("dividendes et retenue à la source", () => {
  test("la retenue est rattachée au dividende, pas importée séparément", () => {
    const msft = find("dividend", "MSFT")[0]
    const rate = 0.79481   // USD→CHF au 2026-06-11, d'après le relevé
    // Le montant transmis est le NET : la RPC reconstruit le brut en ajoutant
    // la retenue. Les deux sont convertis avec le MÊME taux, sinon le brut
    // recomposé (0.91 USD) ne correspondrait à rien.
    expect(msft.totalAmount).toBeCloseTo((0.91 - 0.14) * rate, 6)
    expect(msft.withholdingTax).toBeCloseTo(0.14 * rate, 6)
    expect(msft.totalCurrency).toBe("CHF")
    expect(msft.withholdingTaxCurrency).toBe("CHF")
    expect(msft.priceCurrency).toBe("USD")           // devise d'origine conservée
    expect(ops.some(o => o.rawAction === "Withholding Tax")).toBe(false)
  })

  test("brut recomposé = brut du relevé", () => {
    const msft = find("dividend", "MSFT")[0]
    expect(msft.totalAmount! + msft.withholdingTax!).toBeCloseTo(0.91 * 0.79481, 6)
  })

  test("un dividende sans retenue ne s'en invente pas", () => {
    const inLieu = ops.find(o => o.ticker === "IBKR")!
    expect(inLieu.type).toBe("dividend")
    expect(inLieu.withholdingTax).toBe(0)
    expect(inLieu.withholdingTaxCurrency).toBeUndefined()
  })

  test("un « payment in lieu of dividend » compte comme dividende", () => {
    expect(find("dividend").map(o => o.ticker).sort()).toEqual(["GOOGL", "IBKR", "MSFT"])
  })
})

describe("trésorerie", () => {
  test("le signe distingue dépôt et retrait", () => {
    expect(find("deposit")[0].totalAmount).toBe(750)
    expect(find("withdrawal")[0].totalAmount).toBe(41)
    expect(find("withdrawal")[0].totalCurrency).toBe("CHF")
  })
})

describe("réconciliation avec les positions déclarées", () => {
  test("les positions du relevé sont extraites", () => {
    expect(result.positions.find(p => p.ticker === "VWCE")?.quantity).toBe(6)
  })

  test("une position sans transaction est reprise, pas perdue", () => {
    // GOOGL est détenue mais aucun ordre ne figure dans le fichier : sans
    // reprise, la ligne disparaîtrait et le total ne correspondrait plus au
    // courtier. Elle est donc reprise à son prix de revient déclaré…
    const opening = ops.find(o => o.sourceId.startsWith("ibkr:opening") && o.ticker === "GOOGL")!
    expect(opening.type).toBe("buy")
    expect(opening.quantity).toBe(1)
    expect(opening.price).toBeCloseTo(333.34726, 5)
    expect(opening.rawAction).toContain("ouverture")
    // …et l'utilisateur en est averti : ce n'est pas une transaction réelle.
    expect(result.warnings.some(w => w.includes("GOOGL") && w.includes("sans transaction"))).toBe(true)
    // Après reprise, plus aucun écart avec le relevé.
    expect(reconcilePositions(ops, result.positions)).toHaveLength(0)
  })

  test("aucun écart quand rejeu et déclaration coïncident", () => {
    const gaps = reconcilePositions(ops, [{ ticker: "VWCE", quantity: 6, costBasis: 0, currency: "EUR" }])
    expect(gaps.find(g => g.ticker === "VWCE")).toBeUndefined()
  })
})

describe("détection du courtier", () => {
  test("un relevé IBKR est reconnu", () => {
    expect(detectBroker(CSV).broker).toBe("ibkr")
    expect(ibkrAdapter.detect(CSV)).toBeGreaterThan(0.5)
  })

  test("un export Trading 212 n'est pas confondu avec IBKR", () => {
    const t212 = [
      "Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share)",
      'Market buy,2025-08-04 10:00:00,US7561091049,O,Realty Income,,EOF123,5,55.2,USD',
    ].join("\n")
    expect(detectBroker(t212).broker).toBe("trading_212")
    expect(ibkrAdapter.detect(t212)).toBeLessThan(0.5)
  })
})

describe("robustesse", () => {
  test("un taux manquant laisse le montant en devise native et le signale", () => {
    const noRates = CSV.split('"Date/Time","FromCurrency"')[0]
    const r = parseIbkrCsv(noRates)
    const buy = r.operations.find(o => o.type === "buy" && o.ticker === "AMZN")!
    expect(buy.totalCurrency).toBe("USD")       // jamais converti à un taux inventé
    expect(buy.totalAmount).toBeCloseTo(254, 6)
    expect(r.warnings.some(w => w.includes("Taux"))).toBe(true)
  })

  test("un fichier vide ne casse pas le parseur", () => {
    const r = parseIbkrCsv("")
    expect(r.operations).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
