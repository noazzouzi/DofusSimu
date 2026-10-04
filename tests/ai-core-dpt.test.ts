/**
 * T-dpt (docs/design/ai.md §16.1, §6.3-§6.4) : `DptTable` contre le moteur, vrais sorts de classes.
 *
 *  - Pour Crâ, Iop, Sacrieur et Enutrof (stuff THL simulé) contre un monstre réel aux PV énormes : à chacun de 3 tours,
 *    le sac à dos analytique (`turn`, mode « reste du tour ») choisit ses lancers ; on les joue dans le moteur en
 *    `rollMode: 'average'` (le lanceur est placé sur une case d'où le sort est valide) ; écart total ≤ 5 % entre les
 *    dégâts analytiques et les dégâts simulés.
 *  - Dégâts d'un lancer (`castDamage`) = moteur `average` sur un lancer isolé, pour tous les sorts à dégâts directs
 *    des 4 classes (écart ≤ 2 % par sort, hors sorts à effets déclenchés/aléatoires).
 *  - Profils de sorts : sorts non supportés repérés (E5), sous-sorts inclus, catégories.
 *  - Calibration : bornes [0,5 ; 2], défaut 1.
 */
import { describe, expect, it } from 'vitest'
import { calibrationOf, castDamage, createDptTable, createSpellProfileIndex, isMeleeSpell, levelFor, selfZoneHits } from '../src/ai/core'
import { canCast, castSpell } from '../src/engine/cast'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { CELL_COUNT, distance } from '../src/map/geometry'
import { BREEDS, engineFor, makeFight, monster, player, THL, VORTEX_MAP } from './ai-core-helpers'

const DUMMY_CELL = 300

/** Combat « mannequin » : un personnage contre un monstre réel aux PV énormes (le monstre passe ses tours). */
function dummyFight(engine: Engine, breedId: number, monsterId = 3838): { fight: FightState; me: Fighter; dummy: Fighter } {
  const me = player(breedId, { cell: 0, extra: THL })
  const d = monster(monsterId, DUMMY_CELL)
  const fight = makeFight(engine, VORTEX_MAP, [me, d], { rollMode: 'average' })
  const dummy = fight.fighters[1]
  dummy.maxHp = dummy.baseMaxHp = dummy.hp = 1_000_000
  dummy.tags.cannotPlay = true
  // Case de départ du personnage : la plus proche du mannequin, libre et marchable.
  const m = fight.fighters[0]
  m.cell = nearestFree(fight, DUMMY_CELL, 1)
  return { fight, me: m, dummy }
}

function nearestFree(fight: FightState, to: number, minDist: number): number {
  let best = -1
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!fight.map.cells[c]?.walkable || fight.fighters.some(f => f.alive && f.cell === c)) continue
    const d = distance(c, to)
    if (d < minDist) continue
    if (best < 0 || d < distance(best, to) || (d === distance(best, to) && c < best)) best = c
  }
  return best
}

/**
 * Place le lanceur sur une case d'où `spellId` touche la cible et renvoie la case à viser (−1 si aucune). Comme le DPT
 * (sort « de mêlée » = portée ≤ 1, `isMeleeSpell`), un sort à distance est lancé à distance ≥ 2 quand c'est possible :
 * le moteur applique les bonus/résistances de mêlée selon la distance réelle. Sort de portée 0 à zone (Transfusion) :
 * lancé sur la case du lanceur, la cible dans sa zone.
 */
function placeFor(engine: Engine, fight: FightState, me: Fighter, spellId: number, target: number): number {
  const ks = me.spells.find(s => s.spellId === spellId)!
  const lvl = levelFor(me, ks)
  const prof = createSpellProfileIndex(engine).ofSpell(me, ks.level)
  const free = [...Array(CELL_COUNT).keys()].filter(c => fight.map.cells[c]?.walkable && !fight.fighters.some(f => f.alive && f.cell === c && f.id !== me.id))
  const max = lvl.range + (lvl.rangeBoostable ? me.stats.range : 0)
  if (max === 0 && prof.zone && prof.zoneRadius > 0) {
    free.sort((a, b) => distance(a, target) - distance(b, target) || a - b)
    for (const c of free) {
      if (!selfZoneHits(prof.zone, prof.zoneRadius, c, target)) continue
      me.cell = c
      if (canCast(engine, fight, me, ks, c) === null) return c
    }
    return -1
  }
  const want = max <= 1 ? 1 : 2
  const ok = (c: number) => (want === 1 ? distance(c, target) <= 1 : distance(c, target) >= 2 || lvl.range < 2)
  if (ok(me.cell) && canCast(engine, fight, me, ks, target) === null) return target
  free.sort((a, b) => Math.abs(distance(a, target) - want) - Math.abs(distance(b, target) - want) || a - b)
  for (const c of free) {
    if (canCast(engine, fight, me, ks, target, { fromCell: c }) === null) {
      me.cell = c
      return target
    }
  }
  return -1
}

describe('T-dpt : DPT analytique contre 3 tours simulés (average)', () => {
  for (const [name, breedId] of [['Crâ', BREEDS.cra], ['Iop', BREEDS.iop], ['Sacrieur', BREEDS.sacrieur], ['Enutrof', BREEDS.enutrof]] as const) {
    it(`${name} : écart ≤ 5 % sur 3 tours`, () => {
      const engine = engineFor()
      const { fight, me, dummy } = dummyFight(engine, breedId)
      const dpt = createDptTable(engine)
      let analytic = 0
      let simulated = 0
      let casts = 0
      for (let turn = 0; turn < 3; turn++) {
        // Tour du personnage (le mannequin passe).
        let f = engine.nextTurn(fight)!
        while (f.id !== me.id) {
          engine.endTurn(fight, f)
          f = engine.nextTurn(fight)!
        }
        const plan = dpt.turn(me, dummy, me.ap, 'now')
        analytic += plan.mean
        for (const spellId of plan.casts) {
          const cell = placeFor(engine, fight, me, spellId, dummy.cell)
          expect(cell, `placement ${spellId}`).toBeGreaterThanOrEqual(0)
          const before = dummy.hp + dummy.shield
          const r = castSpell(engine, fight, me, spellId, cell)
          expect(r.ok, `lancer ${spellId} (${r.failure})`).toBe(true)
          const got = before - (dummy.hp + dummy.shield)
          if (process.env.DPT_DEBUG) console.log(`  tour ${turn} ${spellId} ${me.spells.find(x => x.spellId === spellId)?.name} : ${got}`)
          simulated += got
          casts++
        }
        engine.endTurn(fight, me)
      }
      const gap = Math.abs(simulated - analytic) / analytic
      console.log(`T-dpt ${name} : analytique ${Math.round(analytic)}, simulé ${Math.round(simulated)}, écart ${(100 * gap).toFixed(2)} % (${casts} lancers)`)
      expect(casts).toBeGreaterThan(3)
      expect(gap).toBeLessThanOrEqual(0.05)
    })
  }
})

describe('castDamage = moteur (un lancer, average)', () => {
  it('tous les sorts à dégâts directs (sans déclencheur ni aléa) des 4 classes : écart ≤ 2 %', () => {
    const engine = engineFor()
    const profiles = createSpellProfileIndex(engine)
    let checked = 0
    const worst: string[] = []
    for (const breedId of [BREEDS.cra, BREEDS.iop, BREEDS.sacrieur, BREEDS.enutrof, BREEDS.pandawa, BREEDS.eniripsa]) {
      const probe = dummyFight(engine, breedId)
      for (let i = 0; i < probe.me.spells.length; i++) {
        const prof = profiles.ofFighter(probe.me)[i]
        if (!prof.damage.length || prof.hasTriggers || prof.hasRandomGroups || prof.unsupported) continue
        if (prof.damage.some(l => l.dotTurns > 0 || l.delayed > 0 || l.family === 'hp' || l.sub)) continue
        const { fight, me, dummy } = dummyFight(engine, breedId)
        engine.nextTurn(fight)
        const ks = me.spells[i]
        const cell = placeFor(engine, fight, me, ks.spellId, dummy.cell)
        if (cell < 0) continue
        me.ap = 99
        const lvl = levelFor(me, ks)
        // Analytique AVANT le lancer (un sort peut se buffer lui-même après ses dégâts : Opportunité, Épée Divine).
        const ana = castDamage(me, dummy, profiles.ofFighter(me)[i], ks.isWeapon === true, 1, isMeleeSpell(profiles.ofFighter(me)[i])).centerMean ?? 0
        const before = dummy.hp + dummy.shield
        if (!castSpell(engine, fight, me, ks.spellId, cell).ok) continue
        const sim = before - (dummy.hp + dummy.shield)
        if (sim <= 0 && ana <= 0) continue
        const gap = Math.abs(sim - ana) / Math.max(1, sim)
        if (gap > 0.02) worst.push(`${ks.spellId} ${ks.name} (${lvl.apCost} PA) : moteur ${Math.round(sim)}, analytique ${Math.round(ana)}`)
        checked++
      }
    }
    if (worst.length) console.log(worst.join('\n'))
    expect(checked).toBeGreaterThan(20)
    expect(worst).toEqual([])
  })
})

describe('profils et calibration', () => {
  it('profils : sorts à sous-sorts inclus, catégories, couverture analytique dans [0, 1]', () => {
    const engine = engineFor()
    const profiles = createSpellProfileIndex(engine)
    for (const breedId of Object.values(BREEDS)) {
      const p = player(breedId)
      for (const prof of profiles.ofFighter(p)) {
        expect(prof.analyticCoverage).toBeGreaterThanOrEqual(0)
        expect(prof.analyticCoverage).toBeLessThanOrEqual(1)
        expect(['damage', 'control', 'placement', 'heal', 'buff', 'summon', 'mark', 'utility']).toContain(prof.cat)
      }
    }
    // Vertu (Iop) : bouclier porté par un sous-sort (2794 → 29723) ; Cri de Guerre (Eniripsa) : zone autour du lanceur.
    const iop = player(BREEDS.iop)
    const vertu = profiles.ofFighter(iop).find(x => x.spellId === 13142)!
    expect(vertu.shields.length).toBeGreaterThan(0)
    expect(vertu.cat).toBe('heal')
    const eni = player(BREEDS.eniripsa)
    const cri = profiles.ofFighter(eni).find(x => x.spellId === 25863)!
    expect(cri.zoneRadius).toBe(3)
    // Un lancer de Cri de Guerre touche la couronne (la case du lanceur est hors zone) : DPT non nul.
    const dummy = monster(3838, 10)
    // Combattants hors combat : ids distincts (sinon le masque voit le lanceur lui-même).
    eni.id = 0
    dummy.id = 1
    const cd = castDamage(eni, dummy, cri, false)
    expect(cd.centerMean).toBe(0)
    expect(cd.ringMean).toBeGreaterThan(0)
    expect(cd.mean).toBe(cd.ringMean)
  })

  it('calibration : défaut 1, bornée à [0,5 ; 2], clé preset > classe > monstre', () => {
    const p = player(BREEDS.iop)
    expect(calibrationOf(p)).toBe(1)
    const table = { default: 1, presets: { x: 5 }, breeds: { [String(BREEDS.iop)]: 0.1 }, monsters: { '3838': 1.3 } }
    expect(calibrationOf(p, table)).toBe(0.5)
    p.tags.presetId = 'x'
    expect(calibrationOf(p, table)).toBe(2)
    expect(calibrationOf(monster(3838, 1), table)).toBeCloseTo(1.3)
  })
})
