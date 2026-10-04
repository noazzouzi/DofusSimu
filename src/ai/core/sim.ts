/**
 * Clones de simulation, application des macro-actions et avance du temps (docs/design/ai.md §6.1) — WP1.
 *
 * `simClone` : clone « vu par l'équipe » (record = false, `rollMode` 'average', pièges cachés adverses retirés,
 * invisibles adverses sur leur dernière case connue) dont les dés sont re-semés depuis la graine IA et un sel
 * déterministe — jamais l'état réel : l'IA ne lit pas les dés futurs. `advanceUntil` reprend exactement l'enchaînement
 * de `runFight` (test T-parity).
 */
import { castSpell } from '../../engine/cast'
import type { Engine } from '../../engine/engine'
import { move } from '../../engine/move'
import type { ControllerProvider } from '../../engine/runner'
import type { Fighter, FightState, RollMode } from '../../engine/types'
import { toActions, type AIView, type MacroAction } from '../types'
import { cloneRngState } from './rng'
import { canPlay } from './timeline'
import { sanitizeForTeam } from './view'

export { canPlay } from './timeline'

/**
 * Clone « vu par `view.team` » : record = false, rollMode 'average' (ou `rollMode`), pièges invisibles adverses
 * retirés, invisibles adverses déplacés sur leur dernière case connue, `rngState = mix32(view.seed ^ 0x5bd1e995, salt)`.
 * `options.seed` du clone reçoit cette même graine IA : avec E1 (`rngRekey: 'perTurn'`), les débuts de tour simulés
 * (rollouts, `advanceUntil`) re-sèment depuis la graine IA et non depuis la graine du vrai combat, qui donnerait
 * exactement les dés réels des tours futurs.
 */
export function simClone(view: AIView, parent: FightState, salt: number, rollMode: RollMode = 'average'): FightState {
  const c = view.engine.cloneFight(parent, false)
  c.options.rollMode = rollMode
  c.rngState = cloneRngState(view.seed, salt)
  c.options.seed = c.rngState
  sanitizeForTeam(c, view.team)
  return c
}

/**
 * Applique une macro-action EN PLACE sur `s` (cloner avant) et renvoie `s`, ou null si le chemin est interrompu
 * (tacle, piège, case occupée) avant un lancer prévu, ou si un lancer échoue. Un combat terminé par une action
 * précédente compte comme une macro aboutie.
 */
export function applyMacro(engine: Engine, s: FightState, meId: number, m: MacroAction): FightState | null {
  const me = s.fighters[meId]
  if (!me || !me.alive) return null
  const actions = toActions(m)
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]
    if (s.ended) return s
    if (!me.alive) return null
    if (a.type === 'move') {
      const steps = move(s, me, a.path, engine)
      if (steps !== a.path.length - 1) {
        for (let j = i + 1; j < actions.length; j++) if (actions[j].type === 'cast') return null
      }
    } else if (a.type === 'cast') {
      if (!castSpell(engine, s, me, a.spellId, a.cell).ok) return null
    }
  }
  return s
}

/**
 * Termine le tour courant puis joue les tours suivants (contrôleurs fournis) jusqu'à ce que `stop(next)` soit vrai au
 * début du tour de `next` (renvoyé, tour commencé mais non joué), la fin du combat ou `maxTurns` (undefined).
 * Même enchaînement que `runFight` (runner.ts) : test de parité T-parity (§16.1).
 */
export function advanceUntil(engine: Engine, s: FightState, controllers: ControllerProvider,
                             stop: (next: Fighter) => boolean, maxTurns = 64): Fighter | undefined {
  const cur = engine.current(s)
  if (cur && cur.alive && !s.ended) engine.endTurn(s, cur)
  for (let i = 0; i < maxTurns && !s.ended; i++) {
    const f = engine.nextTurn(s)
    if (!f) return undefined
    if (stop(f)) return f
    if (canPlay(engine, f)) controllers(f).playTurn(engine, s, f)
    if (!s.ended && f.alive) engine.endTurn(s, f)
    else if (!s.ended) engine.emit(s, { t: 'turnEnd', fighter: f.id })
  }
  return undefined
}

/** Termine le tour du combattant courant d'un clone (fin de tour simulée : glyphes TE, poisons TE, scénario). */
export function endCurrentTurn(engine: Engine, s: FightState): void {
  const cur = engine.current(s)
  if (cur && cur.alive && !s.ended) engine.endTurn(s, cur)
}
