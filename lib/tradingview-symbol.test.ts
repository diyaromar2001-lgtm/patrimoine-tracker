import { describe, test, expect } from "vitest"
import { toTradingViewSymbol, tradingViewChartUrl } from "./tradingview-symbol"

describe("toTradingViewSymbol", () => {
  test("un ticker US reste nu — TradingView choisit la place", () => {
    expect(toTradingViewSymbol({ ticker: "O", assetClass: "stock" })).toBe("O")
    expect(toTradingViewSymbol({ ticker: "aapl" })).toBe("AAPL")
  })

  test("les ETF londoniens du mapping T212 passent par LSE", () => {
    expect(toTradingViewSymbol({ ticker: "WSML", assetClass: "etf" })).toBe("LSE:WSML")
    expect(toTradingViewSymbol({ ticker: "VHYL", assetClass: "etf" })).toBe("LSE:VHYL")
    // SMH doit rester l'ETF UCITS londonien, pas l'ETF US homonyme
    expect(toTradingViewSymbol({ ticker: "SMH", assetClass: "etf" })).toBe("LSE:SMH")
  })

  test("les actions suisses passent par SIX avec le vrai code", () => {
    expect(toTradingViewSymbol({ ticker: "UBS", assetClass: "stock" })).toBe("SIX:UBSG")
    expect(toTradingViewSymbol({ ticker: "NESN", assetClass: "stock" })).toBe("SIX:NESN")
  })

  test("Xetra et Milan sont traduits", () => {
    expect(toTradingViewSymbol({ ticker: "EUNL", assetClass: "etf" })).toBe("XETR:EUNL")
    expect(toTradingViewSymbol({ ticker: "X", resolvedSymbol: "X.MI" })).toBe("MIL:X")
  })

  test("le symbole résolu par /api/prices est prioritaire sur la table", () => {
    expect(toTradingViewSymbol({ ticker: "SMH", resolvedSymbol: "SMH.DE" })).toBe("XETR:SMH")
  })

  test("un suffixe inconnu ne fabrique pas de place", () => {
    expect(toTradingViewSymbol({ ticker: "ZZZ", resolvedSymbol: "ZZZ.XYZ" })).toBe("ZZZ")
  })

  test("crypto → paire Binance", () => {
    expect(toTradingViewSymbol({ ticker: "BTC", assetClass: "crypto" })).toBe("BINANCE:BTCUSDT")
    expect(toTradingViewSymbol({ ticker: "ETHUSDT", assetClass: "crypto" })).toBe("BINANCE:ETHUSDT")
  })

  test("liquidités et immobilier ne sont pas cotables", () => {
    expect(toTradingViewSymbol({ ticker: "CHF", assetClass: "cash" })).toBeNull()
    expect(toTradingViewSymbol({ ticker: "APPT", assetClass: "real_estate" })).toBeNull()
    expect(toTradingViewSymbol({ ticker: "" })).toBeNull()
  })
})

describe("tradingViewChartUrl", () => {
  test("encode le préfixe de place", () => {
    expect(tradingViewChartUrl("LSE:WSML"))
      .toBe("https://www.tradingview.com/chart/?symbol=LSE%3AWSML")
  })
})
