/**
 * lib/pnl.ts — Calcul du P&L standardisé en CHF
 *
 * Formule stricte (spec utilisateur) :
 *   1. Tout convertir en CHF (devise de base)
 *   2. cost_chf  = (qty × avgBuyPrice_native) × rate(native→CHF)
 *   3. value_chf = (qty × currentPrice_native) × rate(native→CHF)
 *   4. PnL abs   = Σ value_chf - Σ cost_chf
 *   5. PnL %     = PnL abs / Σ cost_chf × 100
 *
 * Clés : utiliser les prix NATIFS pour les deux termes,
 * jamais mélanger des prix déjà convertis avec des prix natifs.
 */

import type { FXRates } from "./finance"

export interface AssetForPnL {
  ticker:           string
  quantity:         number
  /** Prix d'achat moyen dans la devise NATIVE de l'actif */
  avgBuyPrice:      number
  /** Devise native de l'actif (USD pour NVDA, CHF pour Zurich, etc.) */
  nativeCurrency:   string
  /** Prix actuel dans la devise NATIVE (depuis Yahoo Finance) */
  currentPriceNative?: number
  /** Prix actuel déjà converti en devise user (fallback si currentPriceNative indispo) */
  currentPriceConverted?: number
}

/**
 * Convertit un montant de `from` vers CHF.
 * rates[from] = combien de `from` pour 1 CHF.
 * Donc: CHF = amount / rates[from]
 */
function toCHF(amount: number, from: string, rates: FXRates): number {
  if (from === "CHF") return amount
  const rate = rates[from]
  if (!rate || rate === 0) return amount // fallback si devise inconnue
  return amount / rate
}

export interface PnLResult {
  costCHF:     number   // capital investi total en CHF
  valueCHF:    number   // valeur actuelle totale en CHF
  pnlCHF:      number   // plus-value absolue en CHF
  pnlPct:      number   // plus-value en %
  perAsset:    Array<{
    ticker:     string
    costCHF:    number
    valueCHF:   number
    pnlCHF:     number
    pnlPct:     number
  }>
}

/**
 * Calcule le P&L d'un ensemble de positions.
 *
 * @param assets      - Liste des positions avec prix natifs
 * @param rates       - Taux de change live (CHF base)
 * @param userCurrency - Devise d'affichage (pour convertir le résultat final)
 */
export function calculatePortfolioPnL(
  assets:       AssetForPnL[],
  rates:        FXRates,
): PnLResult {
  let totalCostCHF  = 0
  let totalValueCHF = 0
  const perAsset: PnLResult["perAsset"] = []

  for (const a of assets) {
    if (a.quantity <= 0) continue

    const nativeCurr = a.nativeCurrency || "CHF"

    // ── Cost basis en CHF ────────────────────────────────────────────────────
    // avgBuyPrice est en devise native → convertir en CHF
    const costCHF = toCHF(a.avgBuyPrice * a.quantity, nativeCurr, rates)

    // ── Valeur actuelle en CHF ───────────────────────────────────────────────
    // Priorité: prix natif (originalPrice) → déjà converti (price)
    let valueCHF: number
    if (a.currentPriceNative != null && a.currentPriceNative > 0) {
      // Meilleur cas: on a le prix natif → convertir en CHF
      valueCHF = toCHF(a.currentPriceNative * a.quantity, nativeCurr, rates)
    } else if (a.currentPriceConverted != null && a.currentPriceConverted > 0) {
      // Fallback: prix déjà converti (accepter tel quel)
      valueCHF = a.currentPriceConverted * a.quantity
    } else {
      // Aucun prix disponible: utiliser le coût (PnL = 0)
      valueCHF = costCHF
    }

    const pnlCHF = valueCHF - costCHF
    const pnlPct = costCHF > 0 ? (pnlCHF / costCHF) * 100 : 0

    totalCostCHF  += costCHF
    totalValueCHF += valueCHF

    perAsset.push({ ticker: a.ticker, costCHF, valueCHF, pnlCHF, pnlPct })
  }

  const pnlCHF = totalValueCHF - totalCostCHF
  const pnlPct = totalCostCHF > 0 ? (pnlCHF / totalCostCHF) * 100 : 0

  return {
    costCHF:  totalCostCHF,
    valueCHF: totalValueCHF,
    pnlCHF,
    pnlPct,
    perAsset,
  }
}

/**
 * Convertit un résultat P&L CHF vers la devise de l'utilisateur.
 */
export function convertPnL(result: PnLResult, toCurr: string, rates: FXRates) {
  const rate = toCurr === "CHF" ? 1 : (rates[toCurr] ?? 1)
  return {
    cost:  result.costCHF  * rate,
    value: result.valueCHF * rate,
    pnl:   result.pnlCHF   * rate,
    pct:   result.pnlPct,  // % est currency-independent
  }
}
