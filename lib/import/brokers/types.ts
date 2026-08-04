/**
 * Moteur d'import multi-courtiers — contrat commun.
 *
 * Chaque courtier exporte un format différent, mais le stockage est unique :
 * la RPC `create_portfolio_and_import_trading212` consomme une liste
 * d'opérations normalisées (le nom de la RPC est historique — elle prend un
 * paramètre `p_broker` et n'a rien de spécifique à Trading 212).
 *
 * Un adaptateur a donc deux responsabilités, et seulement deux :
 *   1. reconnaître son propre format (`detect`)
 *   2. le traduire en `BrokerOperation[]` (`parse`)
 *
 * Tout le reste — création du portefeuille, positions, mouvements de
 * trésorerie, déduplication — est commun et ne doit jamais être dupliqué
 * dans un adaptateur.
 */

export type BrokerId = "trading_212" | "ibkr"

export interface BrokerInfo {
  id:    BrokerId
  label: string
  /** Ce que l'utilisateur doit exporter chez le courtier. */
  hint:  string
}

export const BROKERS: Record<BrokerId, BrokerInfo> = {
  trading_212: {
    id:    "trading_212",
    label: "Trading 212",
    hint:  "Historique CSV (from_AAAA-MM-JJ_to_AAAA-MM-JJ_*.csv)",
  },
  ibkr: {
    id:    "ibkr",
    label: "Interactive Brokers",
    hint:  "Relevé d'activité CSV (Flex Query ou Activity Statement)",
  },
}

/**
 * Opération normalisée, dans la forme attendue par la RPC d'import.
 * Les noms de champs sont ceux lus par le SQL — ne pas les renommer sans
 * mettre à jour la migration correspondante.
 */
export interface BrokerOperation {
  type:
    | "buy" | "sell"
    | "dividend" | "dividend_tax_exempted" | "dividend_adjustment"
    | "interest" | "deposit" | "withdrawal"
    | "fx_conversion" | "stock_split" | "fee"
  /** AAAA-MM-JJ */
  date:      string
  sourceId:  string
  rawAction: string

  isin?:   string
  ticker?: string
  name?:   string

  quantity?:      number
  price?:         number
  priceCurrency?: string
  /** Taux devise de cotation → devise du compte, à la date de l'opération. */
  exchangeRate?:  number

  /** Montant total dans `totalCurrency` (positif). */
  totalAmount?:   number
  totalCurrency?: string

  withholdingTax?:         number
  withholdingTaxCurrency?: string

  fromAmount?:   number
  fromCurrency?: string
  toAmount?:     number
  toCurrency?:   string
  fxFee?:        number
}

/** Position telle que le courtier la déclare — sert à la réconciliation. */
export interface BrokerPosition {
  ticker:      string
  quantity:    number
  costBasis:   number
  currency:    string
}

export interface BrokerParseResult {
  broker:     BrokerId
  operations: BrokerOperation[]
  /** Positions déclarées par le courtier, si l'export les contient. */
  positions:  BrokerPosition[]
  /**
   * Soldes de trésorerie déclarés par devise, si l'export les contient.
   * Vide quand le courtier ne les fournit pas — dans ce cas on n'invente
   * surtout pas un solde à partir d'un rejeu incomplet.
   */
  cashBalances: Record<string, number>
  stats: {
    linesRead:     number
    operations:    number
    byType:        Record<string, number>
    period:        { start: string; end: string }
    currencies:    string[]
  }
  /** Anomalies non bloquantes à montrer avant l'import. */
  warnings: string[]
}

export interface BrokerAdapter {
  info: BrokerInfo
  /** Score de confiance 0–1 que ce contenu appartienne à ce courtier. */
  detect(content: string): number
  parse(content: string): Promise<BrokerParseResult>
}
