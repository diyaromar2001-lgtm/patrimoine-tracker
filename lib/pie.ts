/**
 * Allocation cible — le « Pie » du suivi de portefeuille.
 *
 * L'idée reprise de Trading 212 : on fixe une répartition voulue (30 % ici,
 * 20 % là), et l'application dit en permanence à quel point le portefeuille
 * s'en écarte. Ce qui compte le plus pour un investisseur régulier n'est pas
 * le camembert : c'est la réponse à « où mettre mes 500 prochains francs ? ».
 *
 * Deux façons de revenir vers la cible :
 *   — en versant (self-balancing) : l'argent frais va d'abord aux lignes en
 *     retard. Rien n'est vendu, donc aucune plus-value n'est réalisée ;
 *   — en arbitrant : on vend le surpondéré pour acheter le sous-pondéré.
 *
 * Ce module ne recommande AUCUN actif et ne juge aucune cible : il calcule
 * l'écart entre ce que l'utilisateur a décidé et ce qu'il détient.
 *
 * Tout est pur — ni React, ni réseau — pour que l'arithmétique soit testable
 * indépendamment de l'affichage.
 */

/** Cibles saisies par l'utilisateur : ticker → pourcentage voulu. */
export type TargetAllocation = Record<string, number>

export interface PieInput {
  ticker: string
  name?:  string
  /** Valeur actuelle de la ligne, dans la devise d'affichage. */
  value:  number
}

export interface PieSlice {
  ticker:     string
  name?:      string
  value:      number
  /** Poids actuel, en %. */
  currentPct: number
  /** Poids voulu, en %. 0 si l'utilisateur n'a rien fixé pour cette ligne. */
  targetPct:  number
  /** currentPct − targetPct : positif = surpondéré. */
  driftPct:   number
  /** Montant qu'il faudrait ajouter (positif) ou retirer (négatif) pour être à la cible. */
  driftValue: number
}

export interface PieSummary {
  slices:      PieSlice[]
  totalValue:  number
  /** Somme des cibles saisies — doit valoir 100 pour que le pie soit complet. */
  targetSum:   number
  /**
   * Note d'équilibre sur 10, à la manière de Trading 212.
   * 10 = parfaitement aligné. Elle tombe quand les lignes dérivent.
   */
  score:       number
  /** Somme des écarts positifs, en % — la « distance » à la cible. */
  totalDriftPct: number
  /** Lignes détenues sans cible définie : elles faussent la lecture, on les signale. */
  untargeted:  string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Compare la répartition réelle à la répartition voulue.
 *
 * Les lignes ciblées mais non détenues apparaissent quand même, à 0 % : c'est
 * précisément là qu'il faut investir, les masquer serait contre-productif.
 */
export function computePie(positions: PieInput[], targets: TargetAllocation): PieSummary {
  const totalValue = positions.reduce((s, p) => s + p.value, 0)
  const tickers = [...new Set([...positions.map(p => p.ticker), ...Object.keys(targets)])]

  const slices: PieSlice[] = tickers.map(ticker => {
    const pos = positions.find(p => p.ticker === ticker)
    const value = pos?.value ?? 0
    const currentPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const targetPct = targets[ticker] ?? 0
    return {
      ticker,
      name: pos?.name,
      value,
      currentPct,
      targetPct,
      driftPct:   currentPct - targetPct,
      // Ce qu'il manque pour atteindre la cible, à taille de portefeuille constante
      driftValue: (targetPct / 100) * totalValue - value,
    }
  }).sort((a, b) => b.value - a.value || b.targetPct - a.targetPct)

  const targetSum = Object.values(targets).reduce((s, v) => s + v, 0)

  // Distance à la cible : somme des écarts POSITIFS. Sur- et sous-pondération
  // se compensant toujours, additionner les deux compterait l'écart deux fois.
  const totalDriftPct = slices.reduce((s, x) => s + Math.max(0, x.driftPct), 0)

  return {
    slices,
    totalValue,
    targetSum: round2(targetSum),
    score: balanceScore(totalDriftPct, targetSum),
    totalDriftPct: round2(totalDriftPct),
    untargeted: slices.filter(s => s.targetPct === 0 && s.value > 0).map(s => s.ticker),
  }
}

/**
 * Note d'équilibre sur 10.
 *
 * Trading 212 ne publie pas sa formule ; celle-ci est explicite et vérifiable :
 * 10 quand rien ne dérive, puis une décroissance linéaire jusqu'à 1 à 25 % de
 * dérive cumulée. Au-delà, le portefeuille n'a plus grand-chose à voir avec sa
 * cible et la note reste à 1.
 *
 * Sans cible complète, la note n'a pas de sens : elle vaut 0 et l'interface
 * affiche « cible incomplète » plutôt qu'un chiffre trompeur.
 */
export function balanceScore(totalDriftPct: number, targetSum: number): number {
  if (Math.abs(targetSum - 100) > 0.5) return 0
  const MAX_DRIFT = 25
  const ratio = Math.min(totalDriftPct, MAX_DRIFT) / MAX_DRIFT
  return round2(10 - ratio * 9)
}

export type ContributionMode = "self-balancing" | "by-targets"

export interface ContributionPlan {
  ticker: string
  name?:  string
  /** Montant à investir sur cette ligne. */
  amount: number
  /** Part de la contribution, en %. */
  sharePct: number
  /** Poids de la ligne APRÈS versement. */
  resultingPct: number
}

/**
 * Répartit une nouvelle somme entre les lignes.
 *
 * `self-balancing` sert d'abord les lignes en retard sur leur cible : c'est le
 * rééquilibrage sans vente, donc sans plus-value imposable. Si la somme
 * dépasse ce qu'il faut pour tout remettre à niveau, le reliquat est réparti
 * au prorata des cibles.
 *
 * `by-targets` ignore l'écart et applique bêtement les pourcentages voulus.
 */
export function planContribution(
  summary: PieSummary,
  amount: number,
  mode: ContributionMode = "self-balancing"
): ContributionPlan[] {
  if (amount <= 0) return []
  const targeted = summary.slices.filter(s => s.targetPct > 0)
  if (!targeted.length) return []

  const totalTarget = targeted.reduce((s, x) => s + x.targetPct, 0)
  const alloc = new Map<string, number>()

  if (mode === "by-targets") {
    for (const s of targeted) alloc.set(s.ticker, amount * (s.targetPct / totalTarget))
  } else {
    // Taille du portefeuille APRÈS versement : c'est par rapport à elle que
    // se mesure le retard, sinon on viserait une cible déjà dépassée.
    const totalAfter = summary.totalValue + amount
    const needs = targeted.map(s => ({
      slice: s,
      need: Math.max(0, (s.targetPct / totalTarget) * totalAfter - s.value),
    }))
    const totalNeed = needs.reduce((s, n) => s + n.need, 0)

    if (totalNeed <= amount) {
      // De quoi tout remettre à niveau : on comble, puis on répartit le reste.
      const leftover = amount - totalNeed
      for (const n of needs) {
        alloc.set(n.slice.ticker, n.need + leftover * (n.slice.targetPct / totalTarget))
      }
    } else {
      // Somme insuffisante : au prorata du retard, les plus en retard d'abord.
      for (const n of needs) {
        alloc.set(n.slice.ticker, totalNeed > 0 ? amount * (n.need / totalNeed) : 0)
      }
    }
  }

  const totalAfter = summary.totalValue + amount
  return targeted
    .map(s => {
      const a = alloc.get(s.ticker) ?? 0
      return {
        ticker: s.ticker,
        name:   s.name,
        amount: round2(a),
        sharePct: round2((a / amount) * 100),
        resultingPct: round2(totalAfter > 0 ? ((s.value + a) / totalAfter) * 100 : 0),
      }
    })
    .filter(p => p.amount > 0.005)
    .sort((a, b) => b.amount - a.amount)
}

export interface RebalanceMove {
  ticker: string
  name?:  string
  action: "buy" | "sell"
  amount: number
}

/**
 * Arbitrage à taille de portefeuille constante : ce qu'il faudrait vendre et
 * acheter pour retomber exactement sur la cible.
 *
 * Proposé en second, jamais par défaut : vendre réalise une plus-value, là où
 * un simple versement atteint le même résultat sans déclencher d'impôt.
 */
export function planRebalance(summary: PieSummary, thresholdPct = 0.5): RebalanceMove[] {
  if (Math.abs(summary.targetSum - 100) > 0.5) return []
  return summary.slices
    .filter(s => Math.abs(s.driftPct) >= thresholdPct && Math.abs(s.driftValue) > 0.01)
    .map(s => ({
      ticker: s.ticker,
      name:   s.name,
      action: (s.driftValue > 0 ? "buy" : "sell") as "buy" | "sell",
      amount: round2(Math.abs(s.driftValue)),
    }))
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Cibles déduites de la répartition actuelle — point de départ d'un nouveau
 * pie : on part de ce qu'on détient plutôt que d'une feuille blanche.
 * Arrondi à 0,1 % près, le reliquat allant à la plus grosse ligne pour que la
 * somme fasse exactement 100.
 */
export function targetsFromCurrent(positions: PieInput[]): TargetAllocation {
  const total = positions.reduce((s, p) => s + p.value, 0)
  if (total <= 0) return {}

  const sorted = [...positions].filter(p => p.value > 0).sort((a, b) => b.value - a.value)
  const out: TargetAllocation = {}
  let assigned = 0
  for (const p of sorted) {
    const pct = Math.round((p.value / total) * 1000) / 10
    out[p.ticker] = pct
    assigned += pct
  }
  const gap = round2(100 - assigned)
  if (sorted.length && Math.abs(gap) > 0.001) {
    out[sorted[0].ticker] = round2(out[sorted[0].ticker] + gap)
  }
  return out
}
