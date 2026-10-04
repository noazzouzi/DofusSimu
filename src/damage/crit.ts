/**
 * Chance de coup critique (docs/research/formulas.md §3.3 et §6).
 *
 * DoMath (worker) : `min(100, max(0, critSort ? critSort + %crit : 0))`.
 * Jeu (patch 2.29) : additif, plafond 100 %, plancher de 1 % pour un sort pouvant critiquer — non implémenté
 * par DoMath, donc optionnel (`minChance: 1`) ; la Poisse (« minimise les effets aléatoires », carac 76)
 * empêche tout coup critique. Un sort de taux de base 0 ne critique jamais. L'Agilité n'a plus d'effet.
 */

export interface CritOptions {
  /** Lanceur sous Poisse (`unlucky`) : aucun coup critique, même avec le plancher. */
  unlucky?: boolean
  /** Plancher en % : 0 (DoMath, défaut) ou 1 (patch 2.29 — INCERTAIN côté Dofus 3). */
  minChance?: number
  /** Bonus de critique propre au sort (modification de sort, % critique d'un buff ciblé). */
  spellCritBonus?: number
}

/** Chance de coup critique en % (0..100). */
export function critChance(baseSpellCrit: number, critStat: number, opts?: CritOptions): number {
  // DoMath teste la valeur de vérité de `crit` : un taux de base nul (ou absent) interdit le critique.
  if (!(baseSpellCrit > 0) || opts?.unlucky) return 0
  const c = baseSpellCrit + critStat + (opts?.spellCritBonus ?? 0)
  const floor = opts?.minChance ?? 0
  return c > 100 ? 100 : c < floor ? floor : c
}

/** Probabilité de coup critique (0..1). */
export function critProbability(baseSpellCrit: number, critStat: number, opts?: CritOptions): number {
  return critChance(baseSpellCrit, critStat, opts) / 100
}
