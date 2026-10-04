/**
 * Contrôleurs triviaux pour les combats de contrôle et les tests de fumée des scénarios (docs/design/ai.md §16.5) —
 * WP3. Indépendants de l'IA (src/ai) pour que les tests du scénario ne dépendent pas des lots en cours.
 *
 *  - `passTurnController` : ne fait rien ;
 *  - `nearestAttackController` : lance le premier sort à dégâts possible sur l'ennemi le plus proche (vulnérable de
 *    préférence), sinon s'approche une fois puis réessaie ; ≤ `maxActions` actions. Déterministe (ordre des sorts,
 *    distance puis id) ;
 *  - `scriptedVortexController` : comme ci-dessus, et le Vortex lance d'abord *Heurage* puis *En temps et en heure*
 *    sur l'Auroraire dès que possible (exercice des mécaniques du donjon dans les tests de fumée).
 */
import { canCast, castSpell } from '../../engine/cast'
import type { Engine } from '../../engine/engine'
import { move, pathTo, reachableCells } from '../../engine/move'
import { passController, type Controller, type ControllerProvider } from '../../engine/runner'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { distance } from '../../map/geometry'

export const passTurnController: Controller = passController

const DAMAGE_EFFECTS = new Set([80, 81, 82, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 1012, 1013, 1014, 1015, 1016, 1067, 1068, 1069, 1070, 1071])

/** Le sort inflige-t-il des dommages (effet de dommages élémentaire) ? */
export function isDamagingSpell(s: KnownSpell): boolean {
  return s.level.effects.some(e => DAMAGE_EFFECTS.has(e.effectId) || (e.element >= 0 && e.element <= 4 && e.effectId < 1000))
}

function enemiesByDistance(engine: Engine, fight: FightState, me: Fighter): Fighter[] {
  const out = fight.fighters.filter(f => f.alive && f.team !== me.team && f.cell >= 0 && f.carriedBy === undefined)
  const vuln = (f: Fighter) => (engine.stateFlag(f, 'invulnerable') ? 1 : 0)
  return out.sort((a, b) => vuln(a) - vuln(b) || distance(me.cell, a.cell) - distance(me.cell, b.cell) || a.id - b.id)
}

/** Premier lancer offensif possible depuis la case actuelle (sorts dans l'ordre, ennemis du plus proche au plus loin). */
function firstAttack(engine: Engine, fight: FightState, me: Fighter): { spellId: number; cell: number } | undefined {
  const enemies = enemiesByDistance(engine, fight, me).filter(e => !engine.stateFlag(e, 'invulnerable'))
  for (const e of enemies) {
    for (const sp of me.spells) {
      if (!isDamagingSpell(sp)) continue
      if (canCast(engine, fight, me, sp, e.cell) === null) return { spellId: sp.spellId, cell: e.cell }
    }
  }
  return undefined
}

/** Chemin vers la case atteignable la plus proche de l'ennemi le plus proche (null si déjà au mieux). */
function approachPath(engine: Engine, fight: FightState, me: Fighter): number[] | null {
  if (me.mp < 1) return null
  const target = enemiesByDistance(engine, fight, me)[0]
  if (!target) return null
  const reach = reachableCells(fight, me, engine, Math.floor(me.mp))
  let best = me.cell
  let bestD = distance(me.cell, target.cell)
  let bestCost = 0
  for (const [c, cost] of reach.cost) {
    const d = distance(c, target.cell)
    if (d < bestD || (d === bestD && (cost < bestCost || (cost === bestCost && c < best)))) {
      best = c
      bestD = d
      bestCost = cost
    }
  }
  return best === me.cell ? null : pathTo(reach, me.cell, best)
}

export interface NearestAttackOptions {
  maxActions?: number
}

/** Tour « attaque au plus près » (voir l'en-tête). */
export function playNearestAttack(engine: Engine, fight: FightState, me: Fighter, o: NearestAttackOptions = {}): void {
  let moved = false
  for (let step = 0; step < (o.maxActions ?? 8) && me.alive && !fight.ended; step++) {
    const atk = firstAttack(engine, fight, me)
    if (atk) {
      if (!castSpell(engine, fight, me, atk.spellId, atk.cell).ok) break
      continue
    }
    if (moved) break
    const path = approachPath(engine, fight, me)
    if (!path || path.length < 2) break
    moved = true
    // Déplacement réel (tacle, pièges, glyphes d'entrée).
    if (move(fight, me, path, engine) <= 0) break
  }
}

export function nearestAttackController(o: NearestAttackOptions = {}): Controller {
  return { playTurn: (engine, fight, me) => playNearestAttack(engine, fight, me, o) }
}

/** Ids des sorts du Vortex exercés par `scriptedVortexController`. */
const HEURAGE = 5066
const EN_TEMPS_ET_EN_HEURE = 5062
const AURORAIRE = 3833
const VORTEX = 3835

/** Contrôleur de fumée : sorts du Vortex sur l'Auroraire, puis attaque au plus près (tout le monde). */
export function scriptedVortexController(o: NearestAttackOptions = {}): Controller {
  return {
    playTurn(engine, fight, me) {
      if (me.monsterId === VORTEX) {
        const aur = fight.fighters.find(f => f.alive && f.monsterId === AURORAIRE)
        for (const [spellId, cell] of [[HEURAGE, me.cell], [EN_TEMPS_ET_EN_HEURE, aur?.cell ?? -1]] as const) {
          const sp = me.spells.find(s => s.spellId === spellId)
          if (sp && cell >= 0 && canCast(engine, fight, me, sp, cell) === null) castSpell(engine, fight, me, spellId, cell)
          if (!me.alive || fight.ended) return
        }
      }
      playNearestAttack(engine, fight, me, o)
    },
  }
}

/** Fournisseur : le même contrôleur pour tous, `pass` pour les combattants marqués `ai: 'pass'`. */
export function uniformProvider(c: Controller): ControllerProvider {
  return f => (f.ai === 'pass' ? passController : c)
}
