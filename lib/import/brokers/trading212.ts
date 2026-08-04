/**
 * Trading 212 — adaptateur.
 *
 * Le parseur existant (lib/parsers/trading212-parser-client) est conservé tel
 * quel : il est éprouvé sur les données réelles de l'utilisateur. Cet
 * adaptateur ne fait que l'habiller au contrat commun.
 */

import { parseTrading212CSVContent } from "@/lib/parsers/trading212-parser-client"
import type { BrokerAdapter, BrokerOperation, BrokerParseResult } from "./types"
import { BROKERS } from "./types"

/** En-tête caractéristique de l'export Trading 212. */
const T212_HEADER = /Action.*Time.*ISIN.*Ticker/i

export async function parseTrading212(content: string): Promise<BrokerParseResult> {
  const { operations, stats } = await parseTrading212CSVContent(content)

  const ops = operations as BrokerOperation[]
  const byType: Record<string, number> = {}
  const currencies = new Set<string>()
  for (const o of ops) {
    byType[o.type] = (byType[o.type] ?? 0) + 1
    if (o.totalCurrency) currencies.add(o.totalCurrency)
    if (o.priceCurrency) currencies.add(o.priceCurrency)
  }

  const dates = ops.map(o => o.date).filter(Boolean).sort()
  const warnings: string[] = []
  const unknown = stats.unknownActions as Map<string, number> | undefined
  if (unknown?.size) {
    for (const [action, count] of unknown) {
      warnings.push(`Action non reconnue ignorée : « ${action} » (${count}×).`)
    }
  }
  if (stats.orphanedSplits?.length) {
    warnings.push(`${stats.orphanedSplits.length} division d'action non appairée — ignorée.`)
  }

  return {
    broker: "trading_212",
    operations: ops,
    positions: [],   // l'export T212 ne déclare pas de positions
    stats: {
      linesRead:  stats.csvLinesRead ?? ops.length,
      operations: ops.length,
      byType,
      period: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
      currencies: [...currencies].sort(),
    },
    warnings,
  }
}

export const trading212Adapter: BrokerAdapter = {
  info: BROKERS.trading_212,
  detect(content) {
    const head = content.slice(0, 2000)
    if (!T212_HEADER.test(head)) return 0
    return /No\. of shares|Price \/ share/i.test(head) ? 1 : 0.6
  },
  parse: parseTrading212,
}
