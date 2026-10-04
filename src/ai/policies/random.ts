/**
 * Politique `random` (docs/design/ai.md §16.5, échelle des modes : `random` < `scripted` < `fast` < …) — WP4 :
 * référence basse. À chaque pas, choisit uniformément entre les lancers légaux depuis la case actuelle (sorts connus ×
 * cases occupées par un combattant visible, case du lanceur comprise), un déplacement vers une case atteignable tirée
 * au hasard (un seul par tour) et la fin du tour ; ≤ `maxActions` pas.
 *
 * Déterministe : flux propre `Rng(aiSeed(cfg.seed, fighter.id, round, 0x52))` (src/ai/core) ; aucun `Math.random`.
 * N'avance jamais `fight.rngState` (les dés réels ne sont tirés que par les actions jouées). Vue honnête
 * (`createView(...).visible()`).
 */
import { aiSeed, createView } from '../core'
import { Rng } from '../../core/rng'
import { canCast } from '../../engine/cast'
import type { Engine } from '../../engine/engine'
import { pathTo, reachableCells } from '../../engine/move'
import { performAction, type Controller } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import type { AIConfig } from '../types'

export interface RandomPolicyOptions {
  /** Pas maximaux par tour (lancers + déplacement). Défaut 8. */
  maxActions?: number
  /** Poids relatif de « finir le tour » parmi les options d'un pas (défaut 1 option sur N + 1). */
  endWeight?: number
}

/** Joue un tour aléatoire légal pour `me`. */
export function playRandomTurn(engine: Engine, fight: FightState, me: Fighter, seed: number, opts: RandomPolicyOptions = {}): void {
  const rng = new Rng(aiSeed(seed, me.id, fight.round, 0x52))
  const maxActions = opts.maxActions ?? 8
  let moved = false
  for (let step = 0; step < maxActions && me.alive && !fight.ended; step++) {
    const visible = createView(engine, fight, me, seed).visible()
    const cells = new Set<number>([me.cell])
    for (const f of visible) if (f.alive && f.cell >= 0 && f.carriedBy === undefined) cells.add(f.cell)
    const sorted = [...cells].sort((a, b) => a - b)
    const casts: { spellId: number; cell: number }[] = []
    for (const sp of me.spells) for (const c of sorted) if (canCast(engine, fight, me, sp, c) === null) casts.push({ spellId: sp.spellId, cell: c })
    const canMove = !moved && me.mp >= 1
    const options = casts.length + (canMove ? 1 : 0) + (opts.endWeight ?? 1)
    const pick = Math.floor(rng.next() * options)
    if (pick < casts.length) {
      const c = casts[pick]
      if (!performAction(engine, fight, me, { type: 'cast', ...c }).ok) break
      continue
    }
    if (canMove && pick === casts.length) {
      moved = true
      const reach = reachableCells(fight, me, engine)
      const targets = [...reach.cost.keys()].filter(c => c !== me.cell).sort((a, b) => a - b)
      if (!targets.length) continue
      const path = pathTo(reach, me.cell, targets[Math.floor(rng.next() * targets.length)])
      if (path && path.length > 1) performAction(engine, fight, me, { type: 'move', path })
      continue
    }
    break // fin du tour
  }
}

/** Contrôleur aléatoire (référence basse) pour les personnages et leurs invocations. */
export function createRandomPolicy(cfg: AIConfig, opts: RandomPolicyOptions = {}): Controller {
  return { playTurn: (engine, fight, me) => playRandomTurn(engine, fight, me, cfg.seed, opts) }
}
