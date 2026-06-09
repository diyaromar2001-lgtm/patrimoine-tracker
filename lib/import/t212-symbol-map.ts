/**
 * Trading 212 broker ticker → Yahoo Finance quote symbol mapping.
 *
 * T212 (EU) exports bare LSE tickers for many European UCITS ETFs
 * (e.g. "WSML" instead of "WSML.L") and base names for Swiss stocks
 * (e.g. "UBS" instead of "UBSG.SW").  Yahoo Finance resolves "WSML" to
 * an unrelated US instrument; "SMH" resolves to the US VanEck
 * Semiconductor ETF (~$200) instead of the European UCITS version (~$13).
 *
 * Resolution priority in the prices API:
 *   1. This explicit map (broker ticker → Yahoo symbol)
 *   2. Bare ticker fallback (Yahoo tries its own disambiguation)
 */

/** Primary Yahoo Finance symbol for each T212 EU broker ticker. */
export const T212_TICKER_TO_YAHOO: Record<string, string> = {
  // ── iShares UCITS ETFs ──────────────────────────────────────────────────────
  EUNL:  "EUNL.DE",   // iShares Core MSCI World — EUR, Xetra
  EIMI:  "EIMI.L",    // iShares Core MSCI EM IMI — GBP, LSE
  WSML:  "WSML.L",    // iShares MSCI World Small Cap — GBP, LSE
  IDVY:  "IDVY.L",    // iShares Euro Dividend — GBP, LSE
  IUSA:  "IUSA.L",    // iShares Core S&P 500 — GBP, LSE
  CSPX:  "CSPX.L",    // iShares Core S&P 500 USD Dist — USD, LSE
  ISAC:  "ISAC.L",    // iShares MSCI ACWI — USD, LSE
  IUIT:  "IUIT.L",    // iShares S&P 500 IT — USD, LSE
  IQQW:  "IQQW.DE",   // iShares MSCI World — EUR, Xetra
  IGLN:  "IGLN.L",    // iShares Physical Gold — USD, LSE

  // ── VanEck UCITS ETFs ───────────────────────────────────────────────────────
  // T212 EU "SMH" = VanEck Semiconductor UCITS ETF (IE00BMC38736, LSE)
  // NOT the US VanEck Semiconductor ETF (SMH at ~$200 on NASDAQ).
  SMH:   "SMH.L",     // VanEck Semiconductor UCITS ETF Acc — GBP, LSE

  // ── Vanguard / SPDR / L&G / HSBC UCITS ETFs ────────────────────────────────
  VUAA:  "VUAA.L",    // Vanguard S&P 500 UCITS ETF Acc — USD, LSE
  VHYL:  "VHYL.L",    // Vanguard FTSE All-World High Div Yld — GBP, LSE
  VHY:   "VHYL.L",    // T212 alias used in some CSV export versions
  VUSA:  "VUSA.L",    // Vanguard S&P 500 UCITS ETF — GBP, LSE
  VWRL:  "VWRL.L",    // Vanguard FTSE All-World UCITS ETF — GBP, LSE
  SWRD:  "SWRD.L",    // SPDR MSCI World UCITS ETF — GBP, LSE
  SPPW:  "SPPW.DE",   // SPDR MSCI ACWI IMI UCITS ETF — EUR, Xetra
  LGGG:  "LGGG.L",    // L&G Global ETF — GBP, LSE
  LCWD:  "LCWD.L",    // L&G Clean Water UCITS ETF — GBP, LSE
  HMWO:  "HMWO.L",    // HSBC MSCI World UCITS ETF — GBP, LSE

  // ── Swiss stocks — SIX exchange ─────────────────────────────────────────────
  // Yahoo Finance requires ".SW" suffix for SIX-listed names.
  // Without it, "UBS" → NYSE ADR (USD ~$29); T212 EU holds UBSG.SW (CHF).
  // Verified working as of 2026-06-10: UBSG.SW ✓  NOVN.SW ✓  NESN.SW ✓
  //                                    ABBN.SW ✓  ZURN.SW ✓
  // ROG.SW returns HTTP 404 on Yahoo Finance (Roche restructured share classes
  // Dec 2024).  Do NOT add ROG here until the correct symbol is confirmed.
  UBS:   "UBSG.SW",   // UBS Group AG — CHF, SIX
  UBSG:  "UBSG.SW",
  NOVN:  "NOVN.SW",   // Novartis AG — CHF, SIX
  NESN:  "NESN.SW",   // Nestlé SA — CHF, SIX
  ABBN:  "ABBN.SW",   // ABB Ltd — CHF, SIX
  ZURN:  "ZURN.SW",   // Zurich Insurance Group — CHF, SIX
  SREN:  "SREN.SW",   // Swiss Re AG — CHF, SIX (not verified; assumed from pattern)
  GIVN:  "GIVN.SW",   // Givaudan SA — CHF, SIX (not verified; assumed from pattern)
}

/**
 * Resolve the Yahoo Finance quote symbol for a T212 broker ticker.
 *
 * Returns `undefined` when no mapping is found — callers should fall back
 * to trying the bare ticker directly with Yahoo Finance.
 */
export function resolveQuoteSymbol(brokerTicker: string): string | undefined {
  return T212_TICKER_TO_YAHOO[brokerTicker.toUpperCase()] ?? undefined
}

/**
 * Build the `TICKER_ALIASES` map consumed by `app/api/prices/route.ts`.
 *
 * Format: `{ "WSML": ["WSML.L"], "SMH": ["SMH.L"], ... }`
 *
 * The prices API tries each candidate in order and returns the first quote
 * that has a price, keyed by the **original** broker ticker.  Aliases are
 * therefore transparent to all `livePrices[a.ticker]` lookups in the UI.
 */
export function buildTickerAliases(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [broker, yahoo] of Object.entries(T212_TICKER_TO_YAHOO)) {
    if (broker !== yahoo) {
      out[broker] = [yahoo]
    }
  }
  return out
}
