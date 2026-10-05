/**
 * T-dpt (docs/design/ai.md §16.1, §6.3-§6.4) : `DptTable` contre le moteur, vrais sorts de classes.
 *
 *  - Pour Crâ, Iop, Sacrieur et Enutrof (stuff THL simulé) contre un monstre réel aux PV énormes : protocole de
 *    calibration (src/ai/core/calibrate.ts : 3 tours de lancers choisis par le sac à dos analytique, joués dans le
 *    moteur en `rollMode: 'average'`, puis 3 tours pour les dégâts différés) sur des cibles AUTRES que celle de la
 *    calibration ; écart ≤ 5 % entre DPT analytique × calibration (data/ai/calibration.json) et dégâts simulés.
 *  - Dégâts d'un lancer (`castDamage`) = moteur `average` sur un lancer isolé, pour tous les sorts à dégâts directs
 *    des 4 classes (écart ≤ 2 % par sort, hors sorts à effets déclenchés/aléatoires).
 *  - Profils de sorts : sorts non supportés repérés (E5), sous-sorts inclus, catégories.
 *  - Calibration : bornes [0,5 ; 2], défaut 1.
 */
import { describe, expect, it } from 'vitest'
import {
  calibrationOf, castDamage, createDptTable, createSpellProfileIndex, DptFrame, DptTableImpl, isMeleeSpell, levelFor,
  measureCalibration, placeForCast,
} from '../src/ai/core'
import { canCast, castSpell } from '../src/engine/cast'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { CELL_COUNT, distance } from '../src/map/geometry'
import { BREEDS, data, engineFor, makeFight, mapOf, monster, player, THL, VORTEX_MAP } from './ai-core-helpers'

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

describe('T-dpt : DPT calibré contre 3 tours simulés (average)', () => {
  // Calibration mesurée sur un Buboxor (data/ai/calibration.json) ; T-dpt la vérifie sur d'AUTRES cibles (Méjaire,
  // Brabuzar : autres résistances) : analytique × calibration = simulé à 5 % près.
  // ÉCART assumé : Crâ à 15 % — Flèche Dévorante cumule des états sur la cible (paliers de dégâts) et ses dégâts
  // différés sont dissipés / déclenchés par la relance : invisible à l'analytique, le facteur de calibration dépend de
  // la rotation choisie (donc des résistances de la cible).
  for (const [name, breedId, tol] of [['Crâ', BREEDS.cra, 0.15], ['Iop', BREEDS.iop, 0.05], ['Sacrieur', BREEDS.sacrieur, 0.05], ['Enutrof', BREEDS.enutrof, 0.05]] as const) {
    it(`${name} : écart ≤ ${100 * tol} % sur 3 tours (Méjaire, Brabuzar)`, () => {
      const engine = engineFor()
      for (const target of [3836, 3839]) {
        const f = player(breedId, { extra: THL })
        const calib = calibrationOf(f)
        const m = measureCalibration(engine, f, { map: mapOf(VORTEX_MAP), targetMonsterId: target })
        const predicted = m.analytic * calib
        const gap = Math.abs(m.simulated - predicted) / Math.max(1, m.simulated)
        console.log(`T-dpt ${name} vs ${target} : analytique ${Math.round(m.analytic)} × ${calib} = ${Math.round(predicted)}, simulé ${Math.round(m.simulated)}, écart ${(100 * gap).toFixed(2)} % (${m.casts} lancers)`)
        expect(m.casts).toBeGreaterThan(3)
        expect(gap).toBeLessThanOrEqual(tol)
      }
    })
  }
})

describe('castDamage = moteur (un lancer, average)', () => {
  // Toutes les classes : chaque sort à dégâts directs (hors aléa, dégâts différés/poisons et poussées — dégâts de
  // collision selon la géométrie) est lancé tel que le suppose le DPT : sur l'entité, ou à côté pour un sort
  // « couronne » / à case libre (Fourvoiement, Brimade, Souffle, Vajra, Propulsion), sous-sorts compris (Jormun,
  // Pendule), gains du lanceur qui précèdent les dégâts compris (vols et buffs du Sram). Écart ≤ 2 % par sort.
  it('tous les sorts à dégâts directs de toutes les classes, placement du DPT (centre ou couronne) : écart ≤ 2 %', () => {
    const engine = engineFor()
    const profiles = createSpellProfileIndex(engine)
    let checked = 0
    let ring = 0
    let sub = 0
    const worst: string[] = []
    for (const breed of data.listBreeds()) {
      const probe = dummyFight(engine, breed.id)
      for (let i = 0; i < probe.me.spells.length; i++) {
        const prof = profiles.ofFighter(probe.me)[i]
        if (!prof.damage.length || prof.hasRandomGroups || prof.unsupported) continue
        if (prof.moves.some(m => m.kind === 'push' || m.kind === 'pull')) continue
        if (prof.damage.some(l => l.dotTurns > 0 || l.delayed > 0 || l.family === 'hp')) continue
        const { fight, me, dummy } = dummyFight(engine, breed.id)
        engine.nextTurn(fight)
        const ks = me.spells[i]
        const cell = placeForCast(engine, fight, me, ks.spellId, dummy.cell)
        if (cell < 0) continue
        me.ap = 99
        const lvl = levelFor(me, ks)
        const p = profiles.ofFighter(me)[i]
        // Analytique AVANT le lancer (un sort peut se buffer lui-même après ses dégâts : Opportunité, Épée Divine).
        const cd = castDamage(me, dummy, p, ks.isWeapon === true, 1, isMeleeSpell(p))
        const aimRing = cell !== dummy.cell
        const ana = (aimRing ? cd.ringMean : cd.centerMean) ?? 0
        const before = dummy.hp + dummy.shield
        if (!castSpell(engine, fight, me, ks.spellId, cell).ok) continue
        const sim = before - (dummy.hp + dummy.shield)
        if (sim <= 0 && ana <= 0) continue
        const gap = Math.abs(sim - ana) / Math.max(1, sim)
        if (gap > 0.02) worst.push(`${breed.name} ${ks.spellId} ${ks.name} (${lvl.apCost} PA, ${aimRing ? 'couronne' : 'centre'}) : moteur ${Math.round(sim)}, analytique ${Math.round(ana)}`)
        checked++
        if (aimRing) ring++
        if (p.damage.some(l => l.sub)) sub++
      }
    }
    if (worst.length) console.log(worst.join('\n'))
    console.log(`castDamage = moteur : ${checked} sorts (${ring} visés en couronne, ${sub} à sous-sorts)`)
    expect(checked).toBeGreaterThan(120)
    expect(ring).toBeGreaterThan(5)
    expect(sub).toBeGreaterThan(5)
    expect(worst).toEqual([])
  })
})

describe('caches du DPT : lignes conditionnées par les PV ou le bouclier', () => {
  // Flèche Perforante (Crâ) : lignes « PB » / « pb » (cible avec / sans bouclier) ; Attaque Mortelle (Sram, variante) :
  // « V50 » / « v50 » (cible sous / au-dessus de 50 % de PV). Les empreintes « dégâts » ne couvrent ni les PV ni le
  // bouclier : ces sorts doivent être recalculés (sinon le cache rend la valeur de l'état précédent).
  it('table et cadre DPT = calcul à froid quand le bouclier ou les PV de la cible changent', () => {
    const engine = engineFor()
    for (const [breedId, spellId, change] of [[BREEDS.cra, 32429, 'shield'], [BREEDS.sram, 12917, 'hp']] as const) {
      const me0 = player(breedId, { cell: 286, extra: THL, variants: new Array(22).fill(breedId === BREEDS.sram ? 1 : 0) })
      const fight = makeFight(engine, VORTEX_MAP, [me0, monster(3838, 300)])
      const me = fight.fighters[0]
      const i = me.spells.findIndex(s => s.spellId === spellId)
      if (i < 0) continue // variante absente des données
      const table = createDptTable(engine)
      const frame = new DptFrame(table)
      frame.refresh(fight)
      const before = table.perCast(me, i, fight.fighters[1]).mean
      const turnBefore = frame.dpt(me, fight.fighters[1])
      const c = engine.cloneFight(fight, false)
      const t = c.fighters[1]
      if (change === 'shield') t.shield = 400
      else t.hp = Math.floor(0.4 * t.maxHp)
      frame.refresh(c)
      const warm = table.perCast(c.fighters[0], i, t).mean
      const warmTurn = frame.dpt(c.fighters[0], t)
      const cold = new DptTableImpl(engine)
      const fresh = cold.perCast(c.fighters[0], i, t).mean
      expect(warm, `${spellId} (lancer)`).toBeCloseTo(fresh, 6)
      expect(warmTurn, `${spellId} (tour)`).toBeCloseTo(cold.dpt(c.fighters[0], t), 6)
      // La condition change vraiment les dégâts (sinon le test ne prouve rien).
      expect(Math.abs(fresh - before)).toBeGreaterThan(1)
      expect(Number.isFinite(turnBefore)).toBe(true)
    }
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
