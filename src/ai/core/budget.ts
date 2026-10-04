/**
 * Budget de calcul en NŒUDS simulés (docs/design/ai.md §6.8, §13.2) — WP1.
 *
 * Toute décision dépend du nombre de nœuds, jamais du temps : un combat reste rejouable bit à bit quelle que soit la
 * machine. Le garde-fou en millisecondes (`warnAfterMs`) ne fait qu'émettre un avertissement (`warned`) et n'influence
 * aucune décision.
 */
import type { NodeBudget } from '../types'

export class CountingBudget implements NodeBudget {
  used = 0
  /** Vrai si le garde-fou temporel a été dépassé (diagnostic seulement). */
  warned = false
  private readonly start: number

  constructor(
    readonly max: number,
    private readonly warnAfterMs = 0,
  ) {
    this.start = warnAfterMs > 0 ? now() : 0
  }

  spend(n = 1): void {
    this.used += n
    if (this.warnAfterMs > 0 && !this.warned && now() - this.start > this.warnAfterMs) this.warned = true
  }

  exhausted(): boolean {
    return this.used >= this.max
  }

  remaining(): number {
    return Math.max(0, this.max - this.used)
  }

  /** Sous-budget (rollouts, splits) : `n` nœuds au plus, imputés aussi au parent. */
  child(n: number): NodeBudget {
    const parent = this
    const cap = Math.min(n, this.remaining())
    const state = { used: 0 }
    return {
      max: cap,
      get used() {
        return state.used
      },
      spend(k = 1) {
        state.used += k
        parent.spend(k)
      },
      exhausted: () => state.used >= cap,
      remaining: () => Math.max(0, cap - state.used),
    }
  }
}

/** Horloge de diagnostic (jamais utilisée dans une décision). */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0
}

/** Budget de `max` nœuds ; `warnAfterMs` > 0 active le garde-fou temporel (avertissement seulement). */
export function createNodeBudget(max: number, warnAfterMs = 0): CountingBudget {
  return new CountingBudget(max, warnAfterMs)
}
