/**
 * Interactive Brokers — relevé d'activité CSV.
 *
 * Le format n'a rien à voir avec Trading 212 : ce n'est pas un tableau mais
 * une CONCATÉNATION de tableaux, chacun avec sa propre ligne d'en-tête et un
 * nombre de colonnes différent. On segmente donc le fichier par en-tête, puis
 * on lit uniquement les sections utiles, identifiées par leurs colonnes :
 *
 *   Trades       Symbol, TradeDate, Buy/Sell, Quantity, TradePrice, NetCash…
 *   Cash         Date/Time, Amount, Type (Dividends, Withholding Tax, …)
 *   Positions    Symbol, Quantity, CostBasisMoney       → réconciliation
 *   Titres       Symbol, ISIN, Description              → noms et ISIN
 *   Taux         Date/Time, FromCurrency, ToCurrency, Rate
 *
 * La section des taux est ce qui rend cet import plus fiable que celui de
 * Trading 212 : IBKR fournit le taux de change vers la devise du compte POUR
 * CHAQUE JOUR. On peut donc figer un coût d'acquisition en CHF exact au lieu
 * de le recalculer plus tard avec un taux courant — c'est précisément la
 * dérive qui rendait les coûts T212 non fiables en devise étrangère.
 */

import { parseCSVRecord } from "@/lib/parsers/trading212-parser-shared"
import type {
  BrokerAdapter, BrokerOperation, BrokerParseResult, BrokerPosition,
} from "./types"
import { BROKERS } from "./types"

// ─── Segmentation du fichier ────────────────────────────────────────────────

interface Section {
  header: string[]
  rows:   Record<string, string>[]
}

/** Une ligne est un en-tête si sa première cellule est un nom de colonne connu. */
const HEADER_FIRST_CELL = new Set(["ClientAccountID", "Symbol", "Date/Time", "CurrencyPrimary"])

export function splitSections(content: string): Section[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim())
  const sections: Section[] = []
  let current: Section | null = null

  for (const line of lines) {
    const cells = parseCSVRecord(line)
    if (!cells.length) continue

    // Un en-tête se reconnaît à sa première cellule ET au fait qu'aucune
    // cellule ne ressemble à une valeur de compte (U12345678).
    const looksLikeHeader =
      HEADER_FIRST_CELL.has(cells[0]) && !cells.some(c => /^U\d{6,}$/.test(c))

    if (looksLikeHeader) {
      current = { header: cells, rows: [] }
      sections.push(current)
      continue
    }
    if (!current) continue
    if (cells.length !== current.header.length) continue   // ligne de total / bruit

    const row: Record<string, string> = {}
    current.header.forEach((h, i) => { row[h] = cells[i] ?? "" })
    current.rows.push(row)
  }
  return sections
}

const has = (s: Section, ...cols: string[]) => cols.every(c => s.header.includes(c))

// ─── Utilitaires ────────────────────────────────────────────────────────────

const num = (v: string | undefined): number => {
  const n = parseFloat((v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** "20260421" ou "20260421;093105" → "2026-04-21" */
export function ibkrDate(raw: string): string {
  const d = (raw ?? "").split(";")[0].trim()
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10)
  return ""
}

// ─── Parseur ────────────────────────────────────────────────────────────────

export function parseIbkrCsv(content: string): BrokerParseResult {
  const sections = splitSections(content)
  const warnings: string[] = []

  // ── Table des taux de change vers la devise du compte ────────────────────
  // rates["2026-04-21"]["USD"] = 0.78081  (multiplier le montant natif)
  const rates = new Map<string, Map<string, number>>()
  let accountCurrency = "CHF"
  for (const s of sections) {
    if (!has(s, "FromCurrency", "ToCurrency", "Rate")) continue
    for (const r of s.rows) {
      const d = ibkrDate(r["Date/Time"])
      if (!d) continue
      if (!rates.has(d)) rates.set(d, new Map())
      rates.get(d)!.set(r.FromCurrency, num(r.Rate))
      if (r.ToCurrency) accountCurrency = r.ToCurrency
    }
  }

  /**
   * Taux natif → devise du compte à la date donnée.
   * On accepte un décalage de quelques jours (week-ends, jours fériés) puis
   * on renonce : mieux vaut un montant non converti et signalé qu'un montant
   * converti à un taux inventé.
   */
  function rateOn(date: string, currency: string, allowForward = false): number | null {
    if (!currency || currency === accountCurrency) return 1
    const at = (offset: number) => {
      const d = new Date(date + "T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + offset)
      return rates.get(d.toISOString().slice(0, 10))?.get(currency)
    }
    for (let back = 0; back <= 5; back++) {
      const r = at(-back)
      if (r && r > 0) return r
    }
    // Seulement pour une reprise de position : sa date peut précéder le début
    // de la table de taux, alors qu'aucune opération réelle ne le fait.
    if (allowForward) {
      for (let fwd = 1; fwd <= 5; fwd++) {
        const r = at(fwd)
        if (r && r > 0) return r
      }
    }
    return null
  }

  /**
   * Convertit un montant vers la devise du compte au taux du jour.
   * Sans taux connu, on RENVOIE le montant natif et on le signale — jamais
   * un montant converti à un taux approximatif.
   */
  function toAccount(amount: number, currency: string, date: string, label: string, allowForward = false) {
    const rate = rateOn(date, currency, allowForward)
    if (rate == null) {
      warnings.push(
        `Taux ${currency}→${accountCurrency} introuvable au ${date} (${label}) : ` +
        `montant laissé en ${currency}.`
      )
      return { amount, currency, rate: 1 }
    }
    return { amount: amount * rate, currency: accountCurrency, rate }
  }

  // ── Référentiel titres : nom + ISIN ──────────────────────────────────────
  const security = new Map<string, { name: string; isin: string; currency: string }>()
  for (const s of sections) {
    if (!has(s, "Symbol", "ISIN", "Description")) continue
    for (const r of s.rows) {
      if (!r.Symbol) continue
      security.set(r.Symbol, {
        name:     r.Description || r.Symbol,
        isin:     r.ISIN || "",
        currency: r.CurrencyPrimary || "",
      })
    }
  }
  const info = (sym: string) => security.get(sym) ?? { name: sym, isin: "", currency: "" }

  // ── Positions déclarées (réconciliation) ─────────────────────────────────
  const positions: BrokerPosition[] = []
  for (const s of sections) {
    if (!has(s, "Symbol", "Quantity", "CostBasisMoney", "MarkPrice")) continue
    for (const r of s.rows) {
      if (!r.Symbol) continue
      positions.push({
        ticker:    r.Symbol,
        quantity:  num(r.Quantity),
        costBasis: num(r.CostBasisMoney),
        currency:  r.CurrencyPrimary || accountCurrency,
      })
    }
  }

  const operations: BrokerOperation[] = []

  // ── Transactions ─────────────────────────────────────────────────────────
  for (const s of sections) {
    // La section "Trades" détaillée porte NetCash ; une seconde section
    // (exécutions) porte les mêmes ordres sans NetCash — on ignore celle-ci
    // pour ne pas compter chaque opération deux fois.
    if (!has(s, "Symbol", "Buy/Sell", "Quantity", "TradePrice", "NetCash")) continue

    for (const [index, r] of s.rows.entries()) {
      const date = ibkrDate(r.TradeDate || r["Date/Time"])
      if (!date) continue

      const symbol   = r.Symbol
      const currency = r.CurrencyPrimary || accountCurrency
      const isBuy    = (r["Buy/Sell"] || "").toUpperCase() === "BUY"
      const qty      = Math.abs(num(r.Quantity))
      const price    = num(r.TradePrice)
      // NetCash = flux réel, commission incluse. C'est ce qui est débité.
      const netCash  = Math.abs(num(r.NetCash))
      // Le rang de la ligne fait partie de l'identifiant : un ordre exécuté en
      // plusieurs fois produit des lignes RIGOUREUSEMENT identiques (même
      // horodatage, même quantité, même prix). Sans le rang, la déduplication
      // à l'insertion les prenait pour un doublon et n'en gardait qu'une —
      // la position restait ouverte alors qu'elle avait été soldée.
      // Le rang est stable tant que le fichier l'est : le réimport reste idempotent.
      const sourceId = `ibkr:trade:${index}:${symbol}:${r.DateTime || date}:${r.Quantity}:${r.TradePrice}`

      // Les conversions de devises apparaissent comme des « trades » sur une
      // paire (USD.CHF) avec AssetClass CASH.
      if (r.AssetClass === "CASH" || /^[A-Z]{3}\.[A-Z]{3}$/.test(symbol)) {
        const [from, to] = symbol.split(".")
        operations.push({
          type: "fx_conversion", date, sourceId, rawAction: `FX ${symbol}`,
          fromCurrency: isBuy ? to   : from,
          toCurrency:   isBuy ? from : to,
          fromAmount:   isBuy ? netCash : qty,
          toAmount:     isBuy ? qty     : netCash,
          fxFee: Math.abs(num(r.IBCommission)),
        })
        continue
      }

      if (!qty || !price) {
        warnings.push(`Opération ignorée : ${symbol} ${date} sans quantité ou prix.`)
        continue
      }

      const total = toAccount(netCash, currency, date, symbol)
      const meta  = info(symbol)
      operations.push({
        type: isBuy ? "buy" : "sell",
        date, sourceId,
        rawAction:     `${r["Buy/Sell"]} ${symbol}`,
        ticker:        symbol,
        name:          meta.name,
        isin:          meta.isin,
        quantity:      qty,
        // Prix unitaire COMMISSION INCLUSE (NetCash / quantité). C'est la
        // convention de l'application — le prix moyen affiché est « frais
        // inclus » — et c'est aussi la définition du prix de revient d'IBKR
        // (CostBasisPrice). Avec le prix d'exécution nu, le prix moyen était
        // systématiquement inférieur à celui du relevé.
        price:         netCash / qty,
        priceCurrency: currency,
        exchangeRate:  total.rate,
        // Converti à la date de l'opération : le coût d'acquisition en CHF est
        // figé une fois pour toutes, il ne dérive plus avec le taux courant.
        totalAmount:   total.amount,
        totalCurrency: total.currency,
      })
    }
  }

  // ── Mouvements de trésorerie (dividendes, retenues, dépôts…) ─────────────
  for (const s of sections) {
    if (!has(s, "Date/Time", "Amount", "Type", "Symbol", "Description")) continue

    // Les retenues à la source sont des lignes séparées : on les rattache au
    // dividende correspondant (même titre, même date) au lieu de les importer
    // comme des opérations distinctes.
    const withholding = new Map<string, number>()
    for (const r of s.rows) {
      if (!/withholding/i.test(r.Type)) continue
      const key = `${r.Symbol}|${ibkrDate(r["Date/Time"])}`
      withholding.set(key, (withholding.get(key) ?? 0) + Math.abs(num(r.Amount)))
    }

    for (const [index, r] of s.rows.entries()) {
      const date = ibkrDate(r["Date/Time"])
      if (!date) continue
      const type     = r.Type || ""
      const amount   = num(r.Amount)
      const currency = r.CurrencyPrimary || accountCurrency
      const symbol   = r.Symbol || ""
      // Rang inclus pour la même raison que les transactions : deux versements
      // identiques le même jour ne doivent pas être pris pour un doublon.
      const sourceId = `ibkr:cash:${index}:${type}:${symbol}:${r["Date/Time"]}:${r.Amount}`

      if (/withholding/i.test(type)) continue            // déjà rattachée

      if (/dividend/i.test(type)) {
        if (!symbol) continue
        const meta = info(symbol)
        const tax  = withholding.get(`${symbol}|${date}`) ?? 0
        // La RPC reconstruit le brut = totalAmount + retenue : on lui passe
        // donc le NET réellement encaissé. Les deux montants sont convertis
        // avec le MÊME taux, sinon le brut recomposé serait faux.
        const net = toAccount(Math.abs(amount) - tax, currency, date, `dividende ${symbol}`)
        operations.push({
          type: "dividend", date, sourceId, rawAction: type,
          ticker: symbol, name: meta.name, isin: meta.isin,
          exchangeRate:  net.rate,
          priceCurrency: currency,          // devise d'origine du versement
          totalAmount:   net.amount,
          totalCurrency: net.currency,
          withholdingTax: tax * net.rate,
          withholdingTaxCurrency: tax > 0 ? net.currency : undefined,
        })
        continue
      }

      const cash = (t: BrokerOperation["type"]) => {
        const conv = toAccount(Math.abs(amount), currency, date, type)
        operations.push({
          type: t, date, sourceId, rawAction: r.Description || type,
          totalAmount: conv.amount, totalCurrency: conv.currency, exchangeRate: conv.rate,
        })
      }

      if (/deposit|withdrawal/i.test(type)) { cash(amount >= 0 ? "deposit" : "withdrawal"); continue }
      if (/interest/i.test(type))           { cash("interest"); continue }
      if (/fee|commission/i.test(type))     { cash("fee") }
    }
  }

  // ── Positions sans transaction : solde d'ouverture ───────────────────────
  // Un relevé commence à une date donnée : une ligne détenue avant cette date,
  // ou reçue hors transaction (attribution, fraction), n'a aucun ordre dans le
  // fichier. Sans reprise, elle disparaîtrait du portefeuille et le total ne
  // correspondrait plus au courtier. On la reprend donc à son prix de revient
  // déclaré — en le signalant, car ce n'est pas une transaction réelle.
  {
    // Seules les transactions comptent : un titre qui n'apparaît que via un
    // dividende n'a toujours aucune ligne d'achat dans l'export.
    const traded = new Set(
      operations.filter(o => o.ticker && (o.type === "buy" || o.type === "sell")).map(o => o.ticker!)
    )
    const firstDate = operations.map(o => o.date).filter(Boolean).sort()[0]
    for (const p of positions) {
      if (traded.has(p.ticker) || Math.abs(p.quantity) < 1e-9 || !firstDate) continue
      const meta  = info(p.ticker)
      const cost  = Math.abs(p.costBasis)
      const total = toAccount(cost, p.currency, firstDate, `position d'ouverture ${p.ticker}`, true)
      operations.push({
        type: "buy",
        date: firstDate,
        sourceId: `ibkr:opening:${p.ticker}:${p.quantity}`,
        rawAction: "Position d'ouverture (aucune transaction dans l'export)",
        ticker: p.ticker, name: meta.name, isin: meta.isin,
        quantity: p.quantity,
        price: cost / p.quantity,
        priceCurrency: p.currency,
        exchangeRate: total.rate,
        totalAmount: total.amount,
        totalCurrency: total.currency,
      })
      warnings.push(
        `${p.ticker} : ${p.quantity} détenue(s) sans transaction dans l'export — ` +
        `reprise au prix de revient du relevé. Élargis la période exportée pour ` +
        `récupérer l'historique réel.`
      )
    }
  }

  operations.sort((a, b) => a.date.localeCompare(b.date))

  const byType: Record<string, number> = {}
  const currencies = new Set<string>()
  for (const o of operations) {
    byType[o.type] = (byType[o.type] ?? 0) + 1
    if (o.totalCurrency)  currencies.add(o.totalCurrency)
    if (o.priceCurrency)  currencies.add(o.priceCurrency)
  }

  if (!operations.length) {
    warnings.push("Aucune opération reconnue — le fichier n'est peut-être pas un relevé IBKR.")
  }

  return {
    broker: "ibkr",
    operations,
    positions,
    stats: {
      linesRead:  sections.reduce((n, s) => n + s.rows.length, 0),
      operations: operations.length,
      byType,
      period: {
        start: operations[0]?.date ?? "",
        end:   operations[operations.length - 1]?.date ?? "",
      },
      currencies: [...currencies].sort(),
    },
    warnings,
  }
}

/**
 * Réconciliation : ce que le rejeu des transactions produit vs ce qu'IBKR
 * déclare détenir. Un écart signale une opération manquante dans l'export
 * (période tronquée, transfert entrant…), pas une erreur de calcul.
 */
export function reconcilePositions(
  operations: BrokerOperation[], declared: BrokerPosition[]
): Array<{ ticker: string; replayed: number; declared: number; diff: number }> {
  const replayed = new Map<string, number>()
  for (const o of operations) {
    if (o.type !== "buy" && o.type !== "sell") continue
    const t = o.ticker ?? ""
    const q = o.quantity ?? 0
    replayed.set(t, (replayed.get(t) ?? 0) + (o.type === "buy" ? q : -q))
  }
  const tickers = new Set([...replayed.keys(), ...declared.map(d => d.ticker)])
  const out: Array<{ ticker: string; replayed: number; declared: number; diff: number }> = []
  for (const t of tickers) {
    const r = replayed.get(t) ?? 0
    const d = declared.find(x => x.ticker === t)?.quantity ?? 0
    if (Math.abs(r - d) > 1e-6) out.push({ ticker: t, replayed: r, declared: d, diff: r - d })
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
}

export const ibkrAdapter: BrokerAdapter = {
  info: BROKERS.ibkr,
  detect(content) {
    const head = content.slice(0, 4000)
    let score = 0
    if (/ClientAccountID/.test(head))                      score += 0.5
    if (/"?Buy\/Sell"?/.test(content.slice(0, 40000)))      score += 0.2
    if (/IBCommission|FifoPnlRealized|CostBasisMoney/.test(content.slice(0, 40000))) score += 0.3
    return Math.min(score, 1)
  },
  async parse(content) { return parseIbkrCsv(content) },
}
