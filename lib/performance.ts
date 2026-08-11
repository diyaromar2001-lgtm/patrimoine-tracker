/**
 * Performance et risque — les chiffres que tout tracker sérieux affiche.
 *
 * L'application ne savait dire qu'un « rendement sur capital cumulé »
 * (P&L / somme des achats). Ce chiffre a un défaut rédhibitoire : il ignore
 * QUAND l'argent a été investi. Placer 10 000 il y a dix ans et 10 000 le mois
 * dernier n'a rien à voir, et pourtant les deux comptent pareil. Impossible,
 * donc, de se comparer à un indice.
 *
 * Deux mesures normalisées le corrigent, et elles répondent à deux questions
 * différentes — d'où l'intérêt de les afficher toutes les deux :
 *
 *   TWR (time-weighted)  → « mes choix de titres sont-ils bons ? »
 *                          Neutralise les versements. C'est ce que publient
 *                          les fonds, donc le seul comparable à un indice.
 *
 *   IRR / XIRR (money-weighted) → « mon argent a-t-il bien travaillé ? »
 *                          Tient compte des dates de versement. C'est le
 *                          rendement réellement obtenu sur SON capital.
 *
 * Tout est pur et sans dépendance : ces calculs doivent être vérifiables
 * ligne à ligne, ce sont eux qu'on regarde pour juger un portefeuille.
 */

export interface CashFlow {
  /** AAAA-MM-JJ */
  date:   string
  /** Négatif = argent investi (sortie de poche), positif = argent récupéré. */
  amount: number
}

export interface ValuePoint {
  date:  string
  value: number
}

const MS_PER_DAY = 86_400_000
/** Jours calendaires entre deux dates ISO. */
function daysBetween(a: string, b: string): number {
  return (Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / MS_PER_DAY
}

// ═══════════════════════════════════════════════════════════════════════════
// XIRR — rendement pondéré par les montants (money-weighted)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valeur actuelle nette d'une série de flux, au taux annuel `rate`.
 * Chaque flux est actualisé sur sa durée réelle en jours.
 */
function npv(flows: CashFlow[], rate: number, origin: string): number {
  return flows.reduce((sum, f) => {
    const years = daysBetween(f.date, origin) / 365
    return sum + f.amount / Math.pow(1 + rate, years)
  }, 0)
}

/**
 * Taux de rendement interne d'une série de flux datés (équivalent XIRR).
 *
 * Résolu par bissection plutôt que par Newton-Raphson : Newton converge plus
 * vite mais diverge sur les séries irrégulières d'un portefeuille réel
 * (dividendes minuscules, gros versement tardif). La bissection est plus lente
 * et toujours convergente — sur cinquante flux, la lenteur ne se voit pas.
 *
 * Renvoie `null` quand le taux n'a pas de sens : moins de deux flux, ou tous
 * de même signe (on ne peut pas calculer un rendement sans avoir investi ET
 * récupéré quelque chose).
 */
export function xirr(flows: CashFlow[], maxRate = 100): number | null {
  if (flows.length < 2) return null
  const hasNegative = flows.some(f => f.amount < 0)
  const hasPositive = flows.some(f => f.amount > 0)
  if (!hasNegative || !hasPositive) return null

  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date))
  const origin = sorted[0].date

  // Borne basse : −99,99 % (tout perdu). Borne haute : maxRate.
  let low = -0.9999
  let high = maxRate
  let fLow = npv(sorted, low, origin)
  let fHigh = npv(sorted, high, origin)

  // Pas de changement de signe : la racine est hors de l'intervalle.
  if (fLow * fHigh > 0) return null

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2
    const fMid = npv(sorted, mid, origin)
    if (Math.abs(fMid) < 1e-9 || (high - low) < 1e-10) return mid
    if (fLow * fMid < 0) { high = mid; fHigh = fMid }
    else                 { low = mid;  fLow = fMid }
  }
  return (low + high) / 2
}

/**
 * Construit les flux d'un portefeuille pour le XIRR.
 *
 * Convention : un achat sort de la poche (négatif), une vente et un dividende
 * y rentrent (positif). La valeur actuelle est ajoutée comme un flux positif
 * final — comme si on liquidait tout aujourd'hui.
 */
export function portfolioCashFlows(
  transactions: Array<{ type: string; date: string; amountChf: number }>,
  currentValue: number,
  today: string = new Date().toISOString().slice(0, 10)
): CashFlow[] {
  const flows: CashFlow[] = []
  for (const t of transactions) {
    const date = String(t.date).slice(0, 10)
    const amount = Math.abs(t.amountChf)
    if (!amount) continue
    if (t.type === "buy")                                flows.push({ date, amount: -amount })
    else if (t.type === "sell" || t.type === "dividend") flows.push({ date, amount:  amount })
  }
  if (currentValue > 0) flows.push({ date: today, amount: currentValue })
  return flows
}

// ═══════════════════════════════════════════════════════════════════════════
// TWR — rendement pondéré par le temps (time-weighted)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rendement pondéré par le temps, en %.
 *
 * On découpe la période à chaque versement, on calcule le rendement de chaque
 * sous-période hors flux, puis on les chaîne. Un versement n'est donc jamais
 * compté comme une performance — c'est tout l'intérêt.
 *
 * `flowsByDate` donne le flux NET entrant à chaque date (positif = apport).
 */
export function timeWeightedReturn(
  series: ValuePoint[],
  flowsByDate: Record<string, number> = {}
): number | null {
  const points = [...series].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 2) return null

  let chained = 1
  let counted = 0

  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1].value
    const end   = points[i].value
    if (start <= 0) continue

    // Le flux du jour ne doit pas passer pour une hausse de valeur.
    const flow = flowsByDate[points[i].date] ?? 0
    const periodReturn = (end - flow - start) / start
    chained *= 1 + periodReturn
    counted++
  }

  if (!counted) return null
  return (chained - 1) * 100
}

/** Ramène un rendement total à une base annuelle. */
export function annualize(totalReturnPct: number, days: number): number | null {
  if (days <= 0) return null
  const years = days / 365
  if (years < 1 / 52) return null            // moins d'une semaine : non significatif
  return (Math.pow(1 + totalReturnPct / 100, 1 / years) - 1) * 100
}

// ═══════════════════════════════════════════════════════════════════════════
// Risque
// ═══════════════════════════════════════════════════════════════════════════

/** Rendements période à période, en fraction (0,01 = +1 %). */
export function periodicReturns(series: ValuePoint[]): number[] {
  const points = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const out: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value
    if (prev > 0) out.push((points[i].value - prev) / prev)
  }
  return out
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
}

/**
 * Nombre de périodes par an, déduit de l'espacement réel des points.
 *
 * L'historique est tantôt journalier, tantôt hebdomadaire selon la fenêtre
 * demandée : annualiser avec une constante donnerait une volatilité fausse
 * d'un facteur 2,6 entre les deux.
 */
export function periodsPerYear(series: ValuePoint[]): number {
  const points = [...series].sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 3) return 252
  const gaps: number[] = []
  for (let i = 1; i < points.length; i++) gaps.push(daysBetween(points[i].date, points[i - 1].date))
  gaps.sort((a, b) => a - b)
  const medianGap = gaps[Math.floor(gaps.length / 2)] || 1
  if (medianGap <= 1.5) return 252          // séances de bourse
  if (medianGap <= 4)   return 252 / 3
  if (medianGap <= 10)  return 52           // hebdomadaire
  if (medianGap <= 45)  return 12           // mensuel
  return 4
}

/**
 * Volatilité annualisée, en %.
 *
 * Écart-type d'échantillon (dénominateur n−1) : sur un historique court, la
 * version population sous-estime systématiquement la dispersion.
 */
export function annualizedVolatility(series: ValuePoint[]): number | null {
  const rets = periodicReturns(series)
  if (rets.length < 3) return null
  const m = mean(rets)
  const variance = rets.reduce((s, r) => s + Math.pow(r - m, 2), 0) / (rets.length - 1)
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear(series)) * 100
}

/**
 * Ratio de Sharpe : rendement excédentaire par unité de risque.
 * `riskFreeRatePct` est un taux ANNUEL (ex. 1 pour 1 %).
 */
export function sharpeRatio(series: ValuePoint[], riskFreeRatePct = 0): number | null {
  const rets = periodicReturns(series)
  if (rets.length < 3) return null
  const ppy = periodsPerYear(series)
  const m = mean(rets)
  const sd = Math.sqrt(rets.reduce((s, r) => s + Math.pow(r - m, 2), 0) / (rets.length - 1))
  if (sd === 0) return null

  const annualReturn = m * ppy
  const annualSd     = sd * Math.sqrt(ppy)
  return (annualReturn - riskFreeRatePct / 100) / annualSd
}

/**
 * Bêta vs un indice : sensibilité du portefeuille aux mouvements du marché.
 * 1 = bouge comme l'indice, < 1 = amorti, > 1 = amplifié.
 *
 * Les deux séries sont alignées sur les dates COMMUNES : comparer des jours
 * différents produirait un chiffre dénué de sens.
 */
export function beta(portfolio: ValuePoint[], benchmark: ValuePoint[]): number | null {
  const byDate = new Map(benchmark.map(p => [p.date, p.value]))
  const common = portfolio
    .filter(p => byDate.has(p.date))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (common.length < 4) return null

  const pRets = periodicReturns(common)
  const bRets = periodicReturns(common.map(p => ({ date: p.date, value: byDate.get(p.date)! })))
  const n = Math.min(pRets.length, bRets.length)
  if (n < 3) return null

  const pm = mean(pRets.slice(0, n))
  const bm = mean(bRets.slice(0, n))
  let cov = 0, varB = 0
  for (let i = 0; i < n; i++) {
    cov  += (pRets[i] - pm) * (bRets[i] - bm)
    varB += Math.pow(bRets[i] - bm, 2)
  }
  if (varB === 0) return null
  return cov / varB
}

export interface RiskMetrics {
  volatility: number | null
  sharpe:     number | null
  beta:       number | null
  maxDrawdown: number | null
  /** Nombre de points ayant servi au calcul — sert à dire « peu fiable ». */
  sampleSize: number
}

/** Regroupe les mesures de risque d'une série, avec sa taille d'échantillon. */
export function riskMetrics(
  series: ValuePoint[],
  benchmark?: ValuePoint[],
  riskFreeRatePct = 0
): RiskMetrics {
  return {
    volatility:  annualizedVolatility(series),
    sharpe:      sharpeRatio(series, riskFreeRatePct),
    beta:        benchmark?.length ? beta(series, benchmark) : null,
    maxDrawdown: series.length >= 2 ? drawdown(series) : null,
    sampleSize:  Math.max(0, series.length - 1),
  }
}

/** Plus forte baisse depuis un sommet, en % (négatif). */
export function drawdown(series: ValuePoint[]): number {
  let peak = -Infinity
  let worst = 0
  for (const p of [...series].sort((a, b) => a.date.localeCompare(b.date))) {
    if (p.value > peak) peak = p.value
    if (peak > 0) worst = Math.min(worst, ((p.value - peak) / peak) * 100)
  }
  return worst
}
