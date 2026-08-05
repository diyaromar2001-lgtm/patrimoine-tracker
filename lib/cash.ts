/**
 * Trésorerie — moteur pur.
 *
 * MODÈLE : chaque portefeuille possède SON propre solde de trésorerie, en
 * CHF/USD/EUR. C'est ce que montrent les courtiers eux-mêmes : le cash IBKR
 * n'est pas le cash Trading 212, et acheter chez l'un ne peut pas puiser dans
 * l'autre. Une poche « Hors portefeuille » complète le tableau pour l'argent
 * qui ne dépend d'aucun courtier (compte bancaire, épargne).
 *
 * Auparavant une cagnotte unique servait tous les portefeuilles : les soldes
 * ne correspondaient à aucun compte réel, et un import de relevé versait son
 * cash dans un pot commun indistinct.
 *
 * Tout est pur ici — pas de Supabase, pas de React — pour que les règles
 * (quelle devise débiter, que faire d'un solde insuffisant) soient testables
 * isolément.
 */

import type { GlobalCash } from "./types"
import type { FXRates } from "./utils"

/** Identifiant du compte de trésorerie : un portefeuille, ou la poche libre. */
export type CashAccountId = string
export const UNASSIGNED_CASH: CashAccountId = "unassigned"
export const UNASSIGNED_LABEL = "Hors portefeuille"

export type CashCurrency = keyof GlobalCash   // "CHF" | "USD" | "EUR"
export const CASH_CURRENCIES: CashCurrency[] = ["CHF", "USD", "EUR"]

export const EMPTY_CASH: GlobalCash = { CHF: 0, USD: 0, EUR: 0 }

export interface CashAccount {
  id:       CashAccountId
  label:    string
  balances: GlobalCash
  /** Faux pour la poche « Hors portefeuille ». */
  isPortfolio: boolean
}

/** Mouvement à journaliser en regard d'une opération de trésorerie. */
export interface CashMovementDraft {
  currency: CashCurrency
  amount:   number      // signé : négatif = sortie
  note?:    string
}

export interface CashApplication {
  balances: GlobalCash
  movement: CashMovementDraft
  /**
   * Montant en CHF qui manquait pour honorer l'opération.
   * 0 quand le solde couvrait tout. On l'expose au lieu de l'écraser
   * silencieusement : un découvert doit pouvoir être dit à l'utilisateur.
   */
  shortfallChf: number
}

// ─── Conversions ────────────────────────────────────────────────────────────

/** rates[X] = unités de X pour 1 CHF → un montant natif vaut montant/rate CHF. */
export function toChf(amount: number, currency: string, rates: FXRates): number {
  if (currency === "CHF") return amount
  const rate = rates[currency]
  return rate && rate > 0 ? amount / rate : amount
}

export function fromChf(amountChf: number, currency: string, rates: FXRates): number {
  if (currency === "CHF") return amountChf
  const rate = rates[currency]
  return rate && rate > 0 ? amountChf * rate : amountChf
}

/** Contre-valeur CHF d'un solde multi-devises. */
export function balancesInChf(balances: GlobalCash, rates: FXRates): number {
  return CASH_CURRENCIES.reduce((sum, cur) => sum + toChf(balances[cur] ?? 0, cur, rates), 0)
}

/** Somme de plusieurs comptes, devise par devise. */
export function sumBalances(accounts: Array<{ balances: GlobalCash }>): GlobalCash {
  const total = { ...EMPTY_CASH }
  for (const a of accounts) {
    for (const cur of CASH_CURRENCIES) total[cur] += a.balances[cur] ?? 0
  }
  return total
}

/** Normalise un solde éventuellement partiel ou absent. */
export function normalizeBalances(raw: Partial<GlobalCash> | null | undefined): GlobalCash {
  return {
    CHF: Number(raw?.CHF ?? 0) || 0,
    USD: Number(raw?.USD ?? 0) || 0,
    EUR: Number(raw?.EUR ?? 0) || 0,
  }
}

// ─── Opérations ─────────────────────────────────────────────────────────────

export function applyDeposit(
  balances: GlobalCash, amount: number, currency: CashCurrency, note?: string
): CashApplication {
  return {
    balances: { ...balances, [currency]: (balances[currency] ?? 0) + amount },
    movement: { currency, amount, note },
    shortfallChf: 0,
  }
}

export function applyWithdrawal(
  balances: GlobalCash, amount: number, currency: CashCurrency, rates: FXRates, note?: string
): CashApplication {
  const available = balances[currency] ?? 0
  const taken     = Math.min(available, amount)
  return {
    balances: { ...balances, [currency]: available - taken },
    movement: { currency, amount: -taken, note },
    shortfallChf: toChf(amount - taken, currency, rates),
  }
}

/**
 * Débit d'un achat.
 *
 * RÈGLE : on paie dans la devise du titre quand le compte la détient en
 * quantité suffisante — c'est ce que fait le courtier. Sinon on débite le CHF
 * pour la contre-valeur, en le signalant dans la note du mouvement.
 */
export function applyBuy(
  balances: GlobalCash, amountNative: number, currency: string, rates: FXRates
): CashApplication {
  const cur = (CASH_CURRENCIES as string[]).includes(currency)
    ? (currency as CashCurrency)
    : "CHF"

  if (cur !== "CHF" && (balances[cur] ?? 0) >= amountNative) {
    return {
      balances: { ...balances, [cur]: balances[cur] - amountNative },
      movement: { currency: cur, amount: -amountNative },
      shortfallChf: 0,
    }
  }

  const costChf   = toChf(amountNative, cur, rates)
  const available = balances.CHF ?? 0
  const taken     = Math.min(available, costChf)
  return {
    balances: { ...balances, CHF: available - taken },
    movement: {
      currency: "CHF",
      amount: -taken,
      note: cur !== "CHF" ? `${amountNative.toFixed(2)} ${cur} converti` : undefined,
    },
    shortfallChf: costChf - taken,
  }
}

/** Crédit d'une vente ou d'un dividende, dans la devise reçue. */
export function applyCredit(
  balances: GlobalCash, amountNative: number, currency: string, note?: string
): CashApplication {
  const cur = (CASH_CURRENCIES as string[]).includes(currency)
    ? (currency as CashCurrency)
    : "CHF"
  return {
    balances: { ...balances, [cur]: (balances[cur] ?? 0) + amountNative },
    movement: { currency: cur, amount: amountNative, note },
    shortfallChf: 0,
  }
}

export interface ConversionResult {
  balances: GlobalCash
  /** Deux mouvements : la sortie puis l'entrée. */
  movements: CashMovementDraft[]
  toAmount: number
  error?:   string
}

/** Conversion interne à UN compte : CHF → USD par exemple. */
export function applyConversion(
  balances: GlobalCash,
  from: CashCurrency, to: CashCurrency, fromAmount: number, rates: FXRates
): ConversionResult {
  if (from === to) {
    return { balances, movements: [], toAmount: 0, error: "Devises identiques." }
  }
  const available = balances[from] ?? 0
  if (available < fromAmount) {
    return {
      balances, movements: [], toAmount: 0,
      error: `Solde insuffisant : ${available.toFixed(2)} ${from} disponible, ${fromAmount.toFixed(2)} requis.`,
    }
  }
  const toAmount = fromChf(toChf(fromAmount, from, rates), to, rates)
  return {
    balances: {
      ...balances,
      [from]: available - fromAmount,
      [to]:   (balances[to] ?? 0) + toAmount,
    },
    movements: [
      { currency: from, amount: -fromAmount, note: `→ ${to}` },
      { currency: to,   amount:  toAmount,   note: `← ${from}` },
    ],
    toAmount,
  }
}

export interface TransferResult {
  from:  GlobalCash
  to:    GlobalCash
  error?: string
}

/**
 * Virement d'un compte à l'autre, à devise constante.
 *
 * C'est ce qui permet de placer un solde existant sur le bon courtier —
 * sans lui, l'argent déjà saisi resterait prisonnier de sa poche d'origine.
 */
export function applyTransfer(
  fromBalances: GlobalCash, toBalances: GlobalCash,
  amount: number, currency: CashCurrency
): TransferResult {
  const available = fromBalances[currency] ?? 0
  if (amount <= 0) {
    return { from: fromBalances, to: toBalances, error: "Montant invalide." }
  }
  if (available < amount) {
    return {
      from: fromBalances, to: toBalances,
      error: `Solde insuffisant : ${available.toFixed(2)} ${currency} disponible, ${amount.toFixed(2)} requis.`,
    }
  }
  return {
    from: { ...fromBalances, [currency]: available - amount },
    to:   { ...toBalances,   [currency]: (toBalances[currency] ?? 0) + amount },
  }
}

// ─── Vue d'ensemble ─────────────────────────────────────────────────────────

/**
 * Construit la liste des comptes de trésorerie affichables.
 * La poche « Hors portefeuille » n'apparaît que si elle porte de l'argent —
 * inutile de montrer une ligne vide à qui n'a que des comptes courtier.
 */
export function buildCashAccounts(
  portfolios: Array<{ id: string; name: string; cashBalances?: Partial<GlobalCash> }>,
  unassigned: GlobalCash
): CashAccount[] {
  const accounts: CashAccount[] = portfolios.map(p => ({
    id:          p.id,
    label:       p.name,
    balances:    normalizeBalances(p.cashBalances),
    isPortfolio: true,
  }))

  const free = normalizeBalances(unassigned)
  if (CASH_CURRENCIES.some(c => Math.abs(free[c]) > 1e-9)) {
    accounts.push({
      id: UNASSIGNED_CASH, label: UNASSIGNED_LABEL, balances: free, isPortfolio: false,
    })
  }
  return accounts
}
