"use client"

import { useMemo } from "react"
import { useDividendHistory } from "@/hooks/use-dividend-history"
import {
  computeReceivedDividends, summarizeReal,
  type DividendTxInput, type ReceivedDividendDetail,
} from "@/lib/dividend-engine"
import type { Transaction } from "@/lib/types"
import type { AppCurrency } from "@/lib/utils"

/**
 * Dividendes réellement encaissés — source unique pour toute l'application.
 *
 * Il existait deux façons de répondre à « combien de dividendes ai-je
 * touché ? » : le tableau de bord additionnait les transactions `dividend`,
 * la page Dividendes reconstruisait le versement à partir du calendrier Yahoo
 * croisé avec les quantités détenues. Les deux ne donnaient pas le même
 * chiffre — l'import laisse beaucoup de transactions dividende à zéro, si
 * bien que le tableau de bord affichait pratiquement rien.
 *
 * La reconstruction fait foi : elle ne dépend pas de ce que le courtier a
 * bien voulu écrire dans son export. Ce hook l'expose une fois pour toutes.
 */
export function useRealDividends(
  transactions: Transaction[],
  currency: AppCurrency,
  fxRates: Record<string, number>
) {
  const txInputs = useMemo<DividendTxInput[]>(
    () => transactions.map(t => ({
      ticker:   t.ticker,
      type:     t.type as DividendTxInput["type"],
      quantity: t.quantity,
      date:     t.date,
      feesChf:  t.feesChf,
      netAmountChf: t.netAmountChf,
      portfolioId:  t.portfolioId,
    })),
    [transactions]
  )

  // Tous les titres jamais détenus : un titre revendu a pu verser des
  // dividendes pendant qu'il était en portefeuille.
  const everHeldTickers = useMemo(
    () => [...new Set(txInputs.filter(t => t.type === "buy").map(t => t.ticker))],
    [txInputs]
  )

  const { events, loading, error, missing } = useDividendHistory(everHeldTickers)

  const received: ReceivedDividendDetail[] = useMemo(
    () => computeReceivedDividends(txInputs, events, currency, fxRates),
    [txInputs, events, currency, fxRates]
  )

  const summary = useMemo(() => summarizeReal(received), [received])

  return { received, summary, events, loading, error, missing }
}
