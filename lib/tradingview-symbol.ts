/**
 * Résolution du symbole TradingView pour un actif du portefeuille.
 *
 * TradingView n'utilise ni les tickers bruts du courtier (WSML, UBS…) ni les
 * suffixes Yahoo (.L, .SW…) : il attend `PLACE:TICKER`, par exemple
 * `LSE:WSML` ou `SIX:UBSG`.
 *
 * On réutilise la table de résolution Yahoo (t212-symbol-map) comme source de
 * vérité de la PLACE de cotation — c'est elle qui sait que SMH est l'ETF
 * londonien et non l'ETF américain homonyme — puis on traduit le suffixe.
 */

import { resolveQuoteSymbol } from "./import/t212-symbol-map"
import type { AssetClass } from "./types"

/** Suffixe Yahoo → préfixe de place TradingView. */
const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  L:  "LSE",        // London Stock Exchange
  SW: "SIX",        // SIX Swiss Exchange
  DE: "XETR",       // Deutsche Börse Xetra
  F:  "FWB",        // Francfort
  MI: "MIL",        // Borsa Italiana
  PA: "EURONEXT",   // Euronext Paris
  AS: "EURONEXT",   // Euronext Amsterdam
  BR: "EURONEXT",   // Euronext Bruxelles
  LS: "EURONEXT",   // Euronext Lisbonne
  MC: "BME",        // Bolsa de Madrid
  VI: "VIE",        // Vienne
  ST: "OMXSTO",     // Stockholm
  HE: "OMXHEX",     // Helsinki
  CO: "OMXCOP",     // Copenhague
  OL: "OSE",        // Oslo
  TO: "TSX",        // Toronto
  V:  "TSXV",       // TSX Venture
  HK: "HKEX",       // Hong Kong
  T:  "TSE",        // Tokyo
  AX: "ASX",        // Australie
}

/** Actifs sans marché coté : aucun graphique TradingView possible. */
const UNCHARTABLE: AssetClass[] = ["cash", "real_estate"]

export interface TradingViewSymbolInput {
  ticker:       string
  assetClass?:  AssetClass
  /** Symbole réellement résolu par /api/prices (ex. "WSML.L"), s'il est connu. */
  resolvedSymbol?: string | null
}

/**
 * Renvoie le symbole TradingView, ou `null` si l'actif n'est pas cotable.
 *
 * Un ticker américain est renvoyé nu (`AAPL`) : TradingView choisit alors
 * lui-même la place, ce qui est plus fiable que de deviner NYSE vs NASDAQ.
 */
export function toTradingViewSymbol(input: TradingViewSymbolInput): string | null {
  const ticker = (input.ticker ?? "").trim().toUpperCase()
  if (!ticker) return null
  if (input.assetClass && UNCHARTABLE.includes(input.assetClass)) return null

  if (input.assetClass === "crypto") {
    // Les paires spot les plus liquides sont sur Binance ; le fallback USD
    // couvre les tickers déjà exprimés en paire (BTCUSDT, ETHUSD…).
    if (/USDT?$/.test(ticker)) return `BINANCE:${ticker}`
    return `BINANCE:${ticker}USDT`
  }

  // Priorité au symbole réellement résolu, puis à la table T212, puis au brut.
  const yahoo = (input.resolvedSymbol || resolveQuoteSymbol(ticker) || ticker).toUpperCase()

  const dot = yahoo.lastIndexOf(".")
  if (dot === -1) return yahoo   // ticker US → TradingView résout seul

  const base     = yahoo.slice(0, dot)
  const suffix   = yahoo.slice(dot + 1)
  const exchange = SUFFIX_TO_EXCHANGE[suffix]
  // Suffixe inconnu : on renvoie la base seule plutôt qu'un préfixe inventé.
  return exchange ? `${exchange}:${base}` : base
}

/** Lien vers le graphique complet sur tradingview.com. */
export function tradingViewChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`
}
