/**
 * Point d'entrée du moteur d'import multi-courtiers.
 *
 * L'appelant n'a pas à savoir quel courtier a produit le fichier : on
 * interroge chaque adaptateur, le plus confiant l'emporte. Un choix explicite
 * de l'utilisateur reste toujours prioritaire sur la détection.
 */

import { trading212Adapter } from "./trading212"
import { ibkrAdapter } from "./ibkr"
import type { BrokerAdapter, BrokerId, BrokerParseResult } from "./types"

export * from "./types"
export { reconcilePositions } from "./ibkr"

export const ADAPTERS: BrokerAdapter[] = [trading212Adapter, ibkrAdapter]

export interface BrokerDetection {
  broker:     BrokerId | null
  confidence: number
  /** Tous les scores, pour expliquer un échec de détection. */
  scores:     Array<{ broker: BrokerId; confidence: number }>
}

/** Seuil en dessous duquel on préfère demander à l'utilisateur. */
const MIN_CONFIDENCE = 0.5

export function detectBroker(content: string): BrokerDetection {
  const scores = ADAPTERS
    .map(a => ({ broker: a.info.id, confidence: a.detect(content) }))
    .sort((x, y) => y.confidence - x.confidence)

  const best = scores[0]
  return {
    broker:     best && best.confidence >= MIN_CONFIDENCE ? best.broker : null,
    confidence: best?.confidence ?? 0,
    scores,
  }
}

/**
 * Analyse un fichier. `brokerHint` force un courtier (choix explicite dans
 * l'interface) ; sans indication, la détection décide.
 */
export async function parseBrokerCsv(
  content: string, brokerHint?: BrokerId
): Promise<BrokerParseResult> {
  const id = brokerHint ?? detectBroker(content).broker
  if (!id) {
    throw new Error(
      "Format non reconnu. Sélectionne le courtier manuellement, ou vérifie que " +
      "le fichier est bien l'export CSV brut (non modifié dans Excel)."
    )
  }
  const adapter = ADAPTERS.find(a => a.info.id === id)
  if (!adapter) throw new Error(`Courtier non pris en charge : ${id}`)
  return adapter.parse(content)
}

/** SHA-256 du contenu — clé de déduplication d'un import. */
export async function computeChecksum(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}
