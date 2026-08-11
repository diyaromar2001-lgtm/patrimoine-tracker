"use client"

import { useMemo } from "react"
import {
  xirr, portfolioCashFlows, timeWeightedReturn, annualize,
  riskMetrics, type ValuePoint, type RiskMetrics,
} from "@/lib/performance"
import type { Transaction } from "@/lib/types"

export interface PerformanceResult {
  /** Rendement pondéré par les montants, annualisé, en %. */
  irrPct:        number | null
  /** Rendement pondéré par le temps sur la période de la courbe, en %. */
  twrPct:        number | null
  /** TWR ramené à une base annuelle. */
  twrAnnualPct:  number | null
  risk:          RiskMetrics
  /** Nombre de flux ayant servi au calcul de l'IRR. */
  cashFlowCount: number
  /** Jours couverts par la courbe. */
  spanDays:      number
}

/**
 * Mesures de performance et de risque du portefeuille.
 *
 * Deux sources distinctes, et c'est volontaire :
 *   — l'IRR vient des TRANSACTIONS réelles, donc il est exact ;
 *   — le TWR et le risque viennent de la courbe de valorisation.
 *
 * Cette courbe applique les quantités ACTUELLES aux prix passés : elle décrit
 * le comportement du portefeuille tel qu'il est aujourd'hui, pas l'historique
 * exact des positions. C'est la bonne base pour mesurer un risque (volatilité,
 * bêta) — on veut justement savoir ce que le portefeuille actuel encaisse —
 * mais cela rend le TWR approché. L'interface doit le dire.
 */
export function usePerformance(
  transactions: Transaction[],
  history: ValuePoint[],
  currentValue: number,
  benchmark?: ValuePoint[],
  riskFreeRatePct = 0
): PerformanceResult {
  return useMemo(() => {
    // ── IRR : flux réels ────────────────────────────────────────────────────
    const flows = portfolioCashFlows(
      transactions.map(t => ({
        type: t.type,
        date: String(t.date).slice(0, 10),
        // Montant réellement déboursé/encaissé, frais inclus. Un 0 vaut
        // « inconnu », pas « gratuit » : `??` laisserait passer le zéro et
        // ferait disparaître le flux.
        amountChf: t.netAmountChf || (t.quantity * t.price),
      })),
      currentValue
    )
    const rate = xirr(flows)

    // ── TWR + risque : courbe de valorisation ───────────────────────────────
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
    const spanDays = sorted.length >= 2
      ? (Date.parse(sorted[sorted.length - 1].date) - Date.parse(sorted[0].date)) / 86_400_000
      : 0

    const twrPct = timeWeightedReturn(sorted)

    return {
      irrPct:       rate != null ? rate * 100 : null,
      twrPct,
      twrAnnualPct: twrPct != null ? annualize(twrPct, spanDays) : null,
      risk:         riskMetrics(sorted, benchmark, riskFreeRatePct),
      cashFlowCount: flows.length,
      spanDays,
    }
  }, [transactions, history, currentValue, benchmark, riskFreeRatePct])
}
