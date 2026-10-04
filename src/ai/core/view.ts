/**
 * Vue « honnête » d'un combat pour une équipe (docs/design/ai.md §6.1, §13.2) — WP1.
 *
 * Ce que l'IA d'une équipe a le droit de lire : positions des combattants VISIBLES (un invisible adverse est placé
 * sur sa dernière case connue), pièges visibles ou posés par son équipe, ordre public des tours. Elle ne lit jamais
 * `fight.events`, ni les pièges invisibles adverses, ni l'état réel des dés.
 *
 * Mémoire de visibilité : `observeVisibility(fight)` (appelé par les contrôleurs au début de chaque tour réel,
 * src/ai/index.ts) recopie la case de chaque combattant visible dans `fighter.tags.aiLastSeen` ; la case d'un
 * invisible n'est plus mise à jour. La mémoire vit donc dans `fighter.tags` (§11.2) et suit les clones.
 */
import type { TeamId } from '../../core/types'
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState, Trap } from '../../engine/types'
import type { AIView } from '../types'
import { forecastSlots } from './timeline'

/** État « Invisible » (effet 150, src/engine/effects/buffs/states.ts). */
export const STATE_INVISIBLE = 250
/** Clé de `fighter.tags` : dernière case où l'adversaire a vu ce combattant. */
export const LAST_SEEN_TAG = 'aiLastSeen'

/** Le combattant est-il invisible (état 250 actif, non neutralisé) ? */
export function isInvisible(f: Fighter): boolean {
  if (!f.states.includes(STATE_INVISIBLE)) return false
  return !(f.disabledStates !== undefined && f.disabledStates.includes(STATE_INVISIBLE))
}

/** Piège visible pour l'équipe `team` (poseur allié ou piège visible). */
export function trapKnownBy(fight: FightState, t: Trap, team: TeamId): boolean {
  return t.visible || (t.team ?? fight.fighters[t.sourceId]?.team) === team
}

/** Met à jour la dernière case connue des combattants visibles (début de tour réel). */
export function observeVisibility(fight: FightState): void {
  for (const f of fight.fighters) {
    if (!f.alive || f.cell < 0 || isInvisible(f)) continue
    if (f.tags[LAST_SEEN_TAG] !== f.cell) f.tags[LAST_SEEN_TAG] = f.cell
  }
}

/**
 * Case de `f` telle que la voit l'équipe `team` : sa case réelle s'il est visible (ou allié), sa dernière case connue
 * s'il est un invisible adverse, −1 si elle est inconnue.
 */
export function believedCell(f: Fighter, team: TeamId): number {
  if (f.team === team || !isInvisible(f)) return f.cell
  const seen = f.tags[LAST_SEEN_TAG]
  return typeof seen === 'number' ? seen : -1
}

/**
 * Rend un clone « vu par `team` » EN PLACE : pièges invisibles adverses retirés, invisibles adverses déplacés sur leur
 * dernière case connue (si elle est libre ; sinon, ou inconnue, retirés du plateau : case −1, tag `aiUnknownPos`).
 * Idempotent. À n'appeler que sur un clone (jamais sur le combat réel).
 */
export function sanitizeForTeam(s: FightState, team: TeamId): FightState {
  if (s.traps.length) {
    let hidden = false
    for (const t of s.traps) if (!trapKnownBy(s, t, team)) hidden = true
    if (hidden) s.traps = s.traps.filter(t => trapKnownBy(s, t, team))
  }
  for (const f of s.fighters) {
    if (!f.alive || f.team === team || f.cell < 0 || !isInvisible(f)) continue
    const seen = f.tags[LAST_SEEN_TAG]
    if (typeof seen === 'number' && seen === f.cell) continue
    let target = -1
    if (typeof seen === 'number' && seen >= 0) {
      let free = !!s.map.cells[seen]?.walkable
      for (const o of s.fighters) if (o !== f && o.alive && o.cell === seen && o.carriedBy === undefined) free = false
      if (free) target = seen
    }
    f.cell = target
    if (target < 0) f.tags.aiUnknownPos = true
  }
  return s
}

/** Vue honnête de `me` sur `fight` (graine IA `seed` : sels des clones). */
export function createView(engine: Engine, fight: FightState, me: Fighter, seed: number): AIView {
  const team = me.team
  return {
    engine,
    fight,
    me,
    team,
    seed,
    visible: () => {
      const out: Fighter[] = []
      for (const f of fight.fighters) {
        if (!f.alive) continue
        if (f.team === team || !isInvisible(f)) {
          out.push(f)
          continue
        }
        const cell = believedCell(f, team)
        if (cell >= 0) out.push({ ...f, cell })
      }
      return out
    },
    knownTraps: () => fight.traps.filter(t => trapKnownBy(fight, t, team)),
    upcoming: (n: number) => forecastSlots(engine, fight, n),
  }
}

/** Vue sur un autre état (clone) en gardant le moteur, l'équipe et la graine ; `me` = même id dans `s`. */
export function viewOn(view: AIView, s: FightState, meId: number = view.me.id): AIView {
  if (s === view.fight && meId === view.me.id) return view
  return createView(view.engine, s, s.fighters[meId] ?? view.me, view.seed)
}
