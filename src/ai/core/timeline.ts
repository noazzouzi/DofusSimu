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
  walkSlots(engine, fight, n, (round, index, f, passes) => {
    out.push({ round, index, fighterId: f.id, team: f.team, isPlayer: f.kind === 'player', isSummon: f.summonerId !== undefined, passes })
  })
  return out
}

/** Parcours des `n` prochains créneaux (logique d'`Engine.nextTurn`), sans allocation ; renvoie le nombre de créneaux. */
function walkSlots(engine: Engine, fight: FightState, n: number,
                   visit: (round: number, index: number, f: Fighter, passes: boolean) => void): number {
  const tl = fight.timeline
  if (!tl.length || n <= 0) return 0
  let round = Math.max(1, fight.round)
  let idx = fight.turnIndex
  let count = 0
  for (let guard = 0; count < n && guard < tl.length * (n + 2); guard++) {
    idx++
    if (idx >= tl.length) {
      idx = 0
      round++
    }
    const f = fight.fighters[tl[idx]]
    if (!f || !f.alive) continue
    const passes = engine.passesTurn(f) || !canPlay(engine, f) || ((f.tags.skipTurns as number | undefined) ?? 0) > 0
    visit(round, idx, f, passes)
    count++
  }
  return count
}

/**
 * Relations d'ordre sur un tour de jeu à partir du combattant courant : `pos[id]` = rang (0 = prochain créneau) du
 * prochain tour de `id` (le combattant courant rejoue en fin de cycle) ; un combattant absent de la timeline (mort,
 * invocation future) reçoit `count`.
 */
export class SlotOrder {
  /** Rang du prochain créneau de chaque combattant (indexé par id), `count` si absent. */
  readonly pos: Int16Array
  readonly count: number
  /** Créneaux en tableaux typés (sans objet par créneau : construit à chaque état de la recherche). */
  readonly ids: Int16Array
  readonly rounds: Int32Array
  readonly indexes: Int16Array
  readonly teams: Int8Array
  /** Bits : 1 = tour passé, 2 = personnage joueur, 4 = invocation. */
  readonly flags: Uint8Array
  private slotList: SlotForecast[] | null = null

  constructor(engine: Engine, readonly fight: FightState) {
    const n = Math.max(1, fight.timeline.length)
    const ids = (this.ids = new Int16Array(n))
    const rounds = (this.rounds = new Int32Array(n))
    const indexes = (this.indexes = new Int16Array(n))
    const teams = (this.teams = new Int8Array(n))
    const flags = (this.flags = new Uint8Array(n))
    let k = 0
    this.count = walkSlots(engine, fight, n, (round, index, f, passes) => {
      ids[k] = f.id
      rounds[k] = round
      indexes[k] = index
      teams[k] = f.team
      flags[k] = (passes ? 1 : 0) | (f.kind === 'player' ? 2 : 0) | (f.summonerId !== undefined ? 4 : 0)
      k++
    })
    this.pos = new Int16Array(fight.fighters.length).fill(this.count)
    for (let i = this.count - 1; i >= 0; i--) {
      const id = ids[i]
      if (id < this.pos.length) this.pos[id] = i
    }
  }

  /** Créneaux sous forme d'objets (`forecastSlots`), construits à la demande. */
  get slots(): SlotForecast[] {
    if (!this.slotList) {
      const out: SlotForecast[] = []
      for (let i = 0; i < this.count; i++) {
        const fl = this.flags[i]
        out.push({ round: this.rounds[i], index: this.indexes[i], fighterId: this.ids[i], team: this.teams[i] as TeamId,
          isPlayer: (fl & 2) !== 0, isSummon: (fl & 4) !== 0, passes: (fl & 1) !== 0 })
      }
      this.slotList = out
    }
    return this.slotList
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
    return r < this.count ? (this.flags[r] & 1) !== 0 : false
  }

  /** Un combattant de l'équipe `team` (autre que `except`) joue-t-il avant le prochain tour de `id` ? */
  teamPlaysBefore(team: TeamId, id: number, except = -1): boolean {
    const r = this.rank(id)
    for (let i = 0; i < r && i < this.count; i++) {
      if (this.teams[i] === team && this.ids[i] !== except && (this.flags[i] & 1) === 0) return true
    }
    return false
  }

  /** Rang du prochain créneau (non passé) d'un PERSONNAGE de l'équipe `team` (count si aucun). */
  nextPlayerOf(team: TeamId): number {
    for (let i = 0; i < this.count; i++) {
      if (this.teams[i] === team && (this.flags[i] & 3) === 2) return i
    }
    return this.count
  }
}
