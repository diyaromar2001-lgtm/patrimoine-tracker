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

/**
 * Le widget TradingView gratuit n'a PAS les droits de diffusion du London
 * Stock Exchange : `LSE:WSML` renvoie « Ce symbole n'existe pas / disponible
 * uniquement sur TradingView ». Les mêmes ETF (même ISIN, même fonds) sont
 * cotés à Francfort et Xetra passe, lui, dans le widget.
 *
 * Table construite depuis l'ISIN de chaque ligne londonienne via la recherche
 * de symboles TradingView, puis vérifiée dans le widget.
 * Attention : la cotation Xetra est en EUR là où Londres cote en GBP/USD —
 * c'est le même fonds, pas la même ligne de prix. Le symbole affiché dans
 * l'en-tête du graphique le dit explicitement.
 */
const LSE_TO_TRADINGVIEW: Record<string, string> = {
  EIMI: "XETR:IS3N",   // iShares Core MSCI EM IMI      — IE00BKM4GZ66
  WSML: "XETR:IUSN",   // iShares MSCI World Small Cap  — IE00BF4RFH31
  IDVY: "XETR:IQQA",   // iShares Euro Dividend         — IE00B0M62S72
  IUSA: "XETR:IUSA",   // iShares Core S&P 500 Dist     — IE0031442068
  CSPX: "XETR:SXR8",   // iShares Core S&P 500 Acc      — IE00B5BMR087
  ISAC: "XETR:IUSQ",   // iShares MSCI ACWI             — IE00B6R52259
  IUIT: "XETR:QDVE",   // iShares S&P 500 IT            — IE00B3WJKG14
  IGLN: "XETR:PPFB",   // iShares Physical Gold         — IE00B4ND3602
  SMH:  "XETR:VVSM",   // VanEck Semiconductor UCITS    — IE00BMC38736
  VUAA: "XETR:VUAA",   // Vanguard S&P 500 Acc          — IE00BFMXXD54
  VHYL: "XETR:VGWD",   // Vanguard All-World High Div   — IE00B8GKDB10
  VUSA: "XETR:VUSA",   // Vanguard S&P 500 Dist         — IE00B3XXRP09
  VWRL: "XETR:VGWL",   // Vanguard FTSE All-World       — IE00B3RBWM25
  SWRD: "XETR:SPPW",   // SPDR MSCI World Acc           — IE00BFY0GT14
  LGGG: "XETR:ETLQ",   // L&G Global Equity             — IE00BFXR5S54
  HMWO: "XETR:H4ZJ",   // HSBC MSCI World               — IE00B4X9L533
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
  if (!exchange) return base   // suffixe inconnu : pas de place inventée

  // Londres n'est pas diffusé par le widget → on bascule sur la ligne Xetra
  // du même fonds quand on la connaît.
  if (exchange === "LSE") {
    const alt = LSE_TO_TRADINGVIEW[base] ?? LSE_TO_TRADINGVIEW[ticker]
    if (alt) return alt
  }
  return `${exchange}:${base}`
}

/** Lien vers le graphique complet sur tradingview.com. */
export function tradingViewChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`
}
