/**
 * Ordre public des prochains tours (docs/design/ai.md §6.1, §6.5) — WP1.
 *
 * `forecastSlots` déroule la timeline depuis le combattant courant (exclu) avec la logique d'`Engine.nextTurn` (morts
 * sautés, `skipTurns`, tour annulé, `cannotPlay`/`preventsFight`) ; les invocations futures sont inconnues.
 * `SlotOrder` en dérive les relations utilisées par la menace et le potentiel : « e joue-t-il avant le prochain tour
 * de a ? », « un allié joue-t-il entre maintenant et e ? ».
 */
import type { TeamId } from '../../core/types'
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState } from '../../engine/types'
import type { SlotForecast } from '../types'

/** Même test que runner.ts (`cannotPlay`, `preventsFight`) : le combattant joue-t-il le tour qui commence ? */
export function canPlay(engine: Engine, f: Fighter): boolean {
  return f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
}

/**
 * Ordre public des `n` prochains créneaux après le combattant courant (exclu), tours de jeu suivants compris
 * (les morts sont sautés ; les invocations à venir sont inconnues). Logique de `Engine.nextTurn` (skipTurns, tour annulé).
 */
export function forecastSlots(engine: Engine, fight: FightState, n: number): SlotForecast[] {
  const out: SlotForecast[] = []
  const tl = fight.timeline
  if (!tl.length || n <= 0) return out
  let round = Math.max(1, fight.round)
  let idx = fight.turnIndex
  for (let guard = 0; out.length < n && guard < tl.length * (n + 2); guard++) {
    idx++
    if (idx >= tl.length) {
      idx = 0
      round++
    }
    const f = fight.fighters[tl[idx]]
    if (!f || !f.alive) continue
    const passes = engine.passesTurn(f) || !canPlay(engine, f) || ((f.tags.skipTurns as number | undefined) ?? 0) > 0
    out.push({ round, index: idx, fighterId: f.id, team: f.team, isPlayer: f.kind === 'player', isSummon: f.summonerId !== undefined, passes })
  }
  return out
}

/**
 * Relations d'ordre sur un tour de jeu à partir du combattant courant : `pos[id]` = rang (0 = prochain créneau) du
 * prochain tour de `id` (le combattant courant rejoue en fin de cycle) ; un combattant absent de la timeline (mort,
 * invocation future) reçoit `count`.
 */
export class SlotOrder {
  readonly slots: SlotForecast[]
  /** Rang du prochain créneau de chaque combattant (indexé par id), `count` si absent. */
  readonly pos: Int16Array
  readonly count: number

  constructor(engine: Engine, readonly fight: FightState) {
    const n = Math.max(1, fight.timeline.length)
    this.slots = forecastSlots(engine, fight, n)
    this.count = this.slots.length
    this.pos = new Int16Array(fight.fighters.length).fill(this.count)
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const id = this.slots[i].fighterId
      if (id < this.pos.length) this.pos[id] = i
    }
  }

  /** Rang du prochain tour de `id`. */
  rank(id: number): number {
    return id < this.pos.length ? this.pos[id] : this.count
  }

  /** `a` joue-t-il (strictement) avant le prochain tour de `b` ? */
  before(a: number, b: number): boolean {
    return this.rank(a) < this.rank(b)
  }

  /** Le prochain créneau de `id` est-il un tour passé (tour annulé, cannotPlay, preventsFight, skipTurns) ? */
  passes(id: number): boolean {
    const r = this.rank(id)
    return r < this.count ? this.slots[r].passes : false
  }

  /** Un combattant de l'équipe `team` (autre que `except`) joue-t-il avant le prochain tour de `id` ? */
  teamPlaysBefore(team: TeamId, id: number, except = -1): boolean {
    const r = this.rank(id)
    for (let i = 0; i < r && i < this.count; i++) {
      const s = this.slots[i]
      if (s.team === team && s.fighterId !== except && !s.passes) return true
    }
    return false
  }

  /** Rang du prochain créneau (non passé) d'un PERSONNAGE de l'équipe `team` (count si aucun). */
  nextPlayerOf(team: TeamId): number {
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]
      if (s.team === team && s.isPlayer && !s.passes) return i
    }
    return this.count
  }
}
