/**
 * Visée des dégâts (docs/design/ai.md §6.3-§6.7, revue WP1-core) : sorts dont les dégâts ne portent PAS sur la case
 * visée — zone « couronne » (croix sans centre de Brimade / Fourvoiement, Souffle du Iop), case libre exigée (Vajra,
 * Propulsion), zone autour du lanceur (portée 0 : Cri de Guerre, Glacier, Tibia ; sous-sort lancé sur sa propre case :
 * Jormun). `hitCellsFor` / `hitsFrom` (castCells.ts) donnent les cases de lancer d'où le sort inflige vraiment ses
 * dégâts à une entité ; menace, potentiel, `canKillNow` et la continuation de V s'en servent.
 *
 * Vérification sur le moteur : depuis chaque case proposée (chemin réel), il existe une case visée (l'entité, sa
 * propre case ou une case voisine de l'entité) où le lancer réussit et retire des PV à l'entité.
 */
import { describe, expect, it } from 'vitest'
import {
  castFailureStatic, computeReach, createSpellProfileIndex, createView, hitCellsFor, hitsFrom, levelFor, LosOracle,
  reachPath,
} from '../src/ai/core'
import { castSpell } from '../src/engine/cast'
import type { Engine } from '../src/engine/engine'
import { move } from '../src/engine/move'
import type { FightState } from '../src/engine/types'
import { CELL_COUNT, distance } from '../src/map/geometry'
import { engineFor, makeFight, mapOf, monster, player, THL, VORTEX_MAP } from './ai-core-helpers'

/** Sorts « non directs » (classe, sort, visée attendue). */
const SPELLS: [number, number, 'ring' | 'around' | 'self'][] = [
  [16, 14592, 'ring'], // Brimade (croix sans centre)
  [16, 14583, 'ring'], // Commotion
  [4, 12909, 'ring'], // Fourvoiement
  [4, 12905, 'ring'], // Fourberie
  [8, 13116, 'ring'], // Souffle (portée 2-8)
  [13, 13443, 'ring'], // Resquille
  [7, 25863, 'self'], // Cri de Guerre (portée 0, couronne autour du lanceur)
  [17, 13676, 'self'], // Glacier
  [18, 13763, 'self'], // Tibia
]

/** Le lancer depuis `from` (chemin réel) inflige-t-il des dégâts à `victim` pour au moins une case visée ? */
function realHit(engine: Engine, fight: FightState, meId: number, spellId: number, from: number, victimId: number): boolean {
  const base = fight.fighters[meId]
  const path = from === base.cell ? null : reachPath(computeReach(createView(engine, fight, base, 1), fight, base), base.cell, from)
  const tc = fight.fighters[victimId].cell
  const aims = [tc, from]
  for (let c = 0; c < CELL_COUNT; c++) if (c !== tc && c !== from && distance(c, tc) <= 2) aims.push(c)
  for (const t of aims) {
    const c = engine.cloneFight(fight, false)
    const me = c.fighters[meId]
    if (path && move(c, me, path, engine) !== path.length - 1) return false
    const v = c.fighters[victimId]
    const hp = v.hp + v.shield
    if (!castSpell(engine, c, me, spellId, t).ok) continue
    if (!v.alive || v.hp + v.shield < hp) return true
  }
  return false
}

describe('visée des dégâts : couronne, case libre, autour du lanceur', () => {
  it('hitCellsFor : chaque case proposée permet un vrai lancer qui touche l’entité (9 sorts, 6 classes)', () => {
    const engine = engineFor()
    const profiles = createSpellProfileIndex(engine)
    let verified = 0
    for (const [breedId, spellId, aim] of SPELLS) {
      for (const dist of [2, 3, 4]) {
        const me0 = player(breedId, { cell: 300, extra: THL })
        // Monstre à `dist` cases (marchable, sur la carte de l'Œil de Vortex).
        const map = mapOf(VORTEX_MAP)
        let mc = -1
        for (let c = 0; c < CELL_COUNT && mc < 0; c++) if (map.cells[c]?.walkable && distance(c, 300) === dist) mc = c
        const fight = makeFight(engine, VORTEX_MAP, [me0, monster(3838, mc)])
        const me = fight.fighters[0]
        const victim = fight.fighters[1]
        victim.hp = victim.maxHp = victim.baseMaxHp = 1_000_000
        me.ap = 12
        me.mp = 4
        const i = me.spells.findIndex(s => s.spellId === spellId)
        expect(i, `sort ${spellId} connu`).toBeGreaterThanOrEqual(0)
        const ks = me.spells[i]
        const lvl = levelFor(me, ks)
        const prof = profiles.ofFighter(me)[i]
        if (aim !== 'self') expect(prof.aim, `${ks.name}`).toBe(aim)
        if (castFailureStatic(engine, me, ks, lvl, me.ap) !== null) continue
        const view = createView(engine, fight, me, 1)
        const reach = computeReach(view, fight, me)
        const los = new LosOracle(fight, me.team, me.id)
        const cells = hitCellsFor(fight, me, ks, lvl, prof, victim.cell, reach, los, 6, [])
        expect(cells.length, `${ks.name} à ${dist} cases`).toBeGreaterThan(0)
        for (const c of cells.slice(0, 3)) {
          expect(hitsFrom(fight, me, ks, lvl, prof, c, victim.cell, los), `${ks.name} hitsFrom ${c}`).toBe(true)
          expect(realHit(engine, fight, me.id, spellId, c, victim.id), `${ks.name} depuis ${c} (monstre ${victim.cell})`).toBe(true)
          verified++
        }
      }
    }
    expect(verified).toBeGreaterThan(40)
  })

  it('case libre exigée (Vajra de la Forgelance) : visée « couronne », chaque case proposée touche réellement l’entité', () => {
    const engine = engineFor()
    const profiles = createSpellProfileIndex(engine)
    const me0 = player(20, { cell: 300, extra: THL, variants: new Array(22).fill(1) })
    const fight = makeFight(engine, VORTEX_MAP, [me0, monster(3838, 358)])
    const me = fight.fighters[0]
    const victim = fight.fighters[1]
    const ks = me.spells.find(s => s.spellId === 23829)
    if (!ks) return // variante absente des données : rien à vérifier
    const i = me.spells.indexOf(ks)
    const prof = profiles.ofFighter(me)[i]
    expect(prof.needFreeCell).toBe(true)
    expect(prof.aim).toBe('ring')
    const lvl = levelFor(me, ks)
    if (castFailureStatic(engine, me, ks, lvl, me.ap) !== null) return
    const reach = computeReach(createView(engine, fight, me, 1), fight, me)
    const los = new LosOracle(fight, me.team, me.id)
    const cells = hitCellsFor(fight, me, ks, lvl, prof, victim.cell, reach, los, 4, [])
    expect(cells.length).toBeGreaterThan(0)
    for (const c of cells) expect(realHit(engine, fight, me.id, ks.spellId, c, victim.id)).toBe(true)
  })
})

