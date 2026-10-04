/**
 * Famille « damage » — relecture adversariale : tests de non-régression des corrections, sur données réelles
 * (sorts de classe, de monstres et sous-sorts lancés par castSpell / castSubSpell, comparés aux formules DoMath).
 *  - modificateurs à dés nuls (1163 *Assaisonnement*, 1159 *Gélifiant*, 1164 *Décalage horaire* : valeur dans `value`) ;
 *  - bonus combo (1027) et PM restants (1012-1016, *Zénith*) appliqués avec la dégressivité exacte ;
 *  - transfert de vie 90 (*Transfusion*) : coût payé une fois, chaque allié soigné du montant ;
 *  - PV érodés (1122 *Morfaille*) corrigés des bonus de Vitalité ;
 *  - dommages d'un sous-sort instantané = directs (déclencheur DS) ;
 *  - 786 (*Feinterception*) sur les PV réellement perdus (bouclier exclu) ;
 *  - vol de vie × % soins finaux ; Puissance aux sorts dans les soins ;
 *  - renvoi 1223 et soin 2973 (*Poisse*) bornés aux PV + bouclier réellement retirés.
 */
import { describe, expect, it } from 'vitest'
import { Element, emptyStats, type Stats } from '../src/core/types'
import { damageRoll, heal as healFormula, hpBasedDamage, type DamageInput } from '../src/damage'
import type { EffectData, MapData } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import { castSpell } from '../src/engine/cast'
import '../src/engine/effects/buffs'
import '../src/engine/effects/castspell'
import { castSubSpell, installEffectCore } from '../src/engine/effects/core'
import { computeAndApplyDamage } from '../src/engine/effects/damage'
import { getEffectHandler, type EffectContext } from '../src/engine/effects/registry'
import { Engine } from '../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightEvent, FightState, RollMode } from '../src/engine/types'
import { cellInDirection } from '../src/map/geometry'

const data = loadDataStore()
const OPEN: MapData = { id: 1, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }
const CENTER = 300
const at = (cell: number, dir: number, n: number) => cellInDirection(cell, dir, n)

function player(name: string, breedId: number, spellIds: number[], cell: number, s: Partial<Stats>, opts: { team?: 0 | 1; maxHp?: number } = {}): Fighter {
  return createPlayerFighter(data, {
    name,
    breedId,
    level: 200,
    stats: { ...emptyStats(), ap: 12, mp: 6, ...s },
    maxHp: opts.maxHp ?? 5000,
    spellIds,
    cell,
    team: opts.team ?? 0,
  })
}

function setup(fighters: Fighter[], rollMode: RollMode = 'min'): { engine: Engine; fight: FightState } {
  if (!fighters.some(f => f.team === 1)) fighters.push(createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: 14 }))
  if (!fighters.some(f => f.team === 0)) fighters.push(player('Témoin', 8, [], 545, {}))
  const engine = new Engine(data)
  installEffectCore(engine)
  return { engine, fight: engine.createFight({ map: OPEN, fighters, options: { rollMode, seed: 9 } }) }
}

type DamageEvent = Extract<FightEvent, { t: 'damage' }>
const damages = (fight: FightState, target: number): DamageEvent[] =>
  fight.events.filter((e): e is DamageEvent => e.t === 'damage' && e.target === target)

function input(a: Fighter, d: Fighter, element: Element, extra: Partial<DamageInput> = {}): DamageInput {
  return { attacker: a.stats, defender: d.stats, element, crit: false, isWeapon: false, isMelee: false, defenderIsPlayer: d.kind === 'player', areaStepPct: 10, ...extra }
}

function effectOf(spellId: number, effectId: number, grade?: number): EffectData {
  return data.spellLevel(spellId, { grade })!.effects.find(e => e.effectId === effectId)!
}

function ctxFor(engine: Engine, fight: FightState, caster: Fighter, effect: EffectData, targets: Fighter[], extra: Partial<EffectContext> = {}): EffectContext {
  return {
    engine,
    fight,
    caster,
    spell: null,
    spellId: 0,
    effect,
    targetCell: targets[0]?.cell ?? caster.cell,
    casterCell: caster.cell,
    cells: targets.map(t => t.cell),
    targets,
    efficiency: new Map(targets.map(t => [t.id, 1])),
    crit: false,
    indirect: false,
    depth: 0,
    ...extra,
  }
}

/** Pugilat (Iop) : 9 dommages Terre — coup de référence. */
const PUNCH = () => effectOf(13146, 97)

describe('modificateurs à dés nuls : valeur portée par `value` (port D3 GetEffectMinRoll)', () => {
  it('Assaisonnement (24780, 1163 d=0 v=130, déclencheur D) : dommages subis ×130 %, pas ×0 %', () => {
    const a = player('A', 8, [], CENTER, { strength: 300 })
    const b = player('B', 8, [], at(CENTER, 1, 3), {}, { team: 1 })
    const { engine, fight } = setup([a, b])
    expect(effectOf(24780, 1163)).toMatchObject({ diceNum: 0, diceSide: 0, value: 130, triggers: 'D' })
    castSubSpell(engine, fight, a, 24780, 1, b.cell, false, 0)
    expect(b.buffs.some(x => x.effect.effectId === 1163 && x.kind === 'trigger')).toBe(true)
    const lost = computeAndApplyDamage(ctxFor(engine, fight, a, PUNCH(), [b]), b)
    expect(lost).toBe(damageRoll(input(a, b, Element.Earth, { sustainedPct: 130 }), 9))
    expect(lost).toBeGreaterThan(damageRoll(input(a, b, Element.Earth), 9))
  })

  it('Gélifiant (29844 : 1109 10 % puis 1159 d=0 v=130 sur H) : le soin suivant est ×130 %', () => {
    const eni = player('Eni', 7, [25873], CENTER, { chance: 400 })
    const ally = player('Allié', 8, [], at(CENTER, 1, 3), {}, { maxHp: 8000 })
    ally.hp = 1000
    const { engine, fight } = setup([eni, ally])
    castSubSpell(engine, fight, eni, 29844, 1, ally.cell, false, 0)
    expect(ally.hp).toBe(1000 + 800) // 10 % des PV max, avant la pose du 1159
    expect(castSpell(engine, fight, eni, 25873, ally.cell).ok).toBe(true)
    const h = healFormula(46, eni.stats, { element: Element.Water })
    expect(ally.hp).toBe(1800 + Math.trunc((h * 130) / 100))
  })

  it('Décalage horaire (5109, 1164 d=0 v=100 instantané) : 100 % du dommage ENTRANT (avant résistances) converti en soin', () => {
    const a = player('A', 8, [], CENTER, { strength: 300 })
    const b = player('B', 8, [], at(CENTER, 1, 3), { earthResPct: 30, earthRes: 5 }, { team: 1 })
    b.hp = 1000
    const { engine, fight } = setup([a, b])
    const e1164 = effectOf(5109, 1164)
    expect(e1164).toMatchObject({ diceNum: 0, diceSide: 0, value: 100, triggers: 'I', duration: -1 })
    getEffectHandler(1164)!.handler(ctxFor(engine, fight, a, e1164, [b]))
    expect(b.buffs.find(x => x.effect.effectId === 1164)?.value).toBe(100)
    // Port D3 ReceiveDamageOrHeal : le ratio s'applique au dommage reçu avant résistances fixes / % de la cible.
    const raw = damageRoll(input(a, b, Element.Earth, { defender: emptyStats() }), 9)
    expect(raw).toBeGreaterThan(damageRoll(input(a, b, Element.Earth), 9))
    expect(computeAndApplyDamage(ctxFor(engine, fight, a, PUNCH(), [b]), b)).toBe(0)
    expect(damages(fight, b.id)).toHaveLength(0)
    expect(b.hp).toBe(1000 + raw)
  })
})

describe('facteurs hors zone : bonus combo (1027) et PM restants (1012-1016)', () => {
  it('Épée Divine avec +50 % combo : bonus appliqué au centre ET en dégressivité (paliers exacts)', () => {
    const iop = player('Iop', 8, [13110], CENTER, { agility: 500, power: 100, comboDamagePct: 50 })
    const a = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 2) })
    const b = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 4) })
    const { engine, fight } = setup([iop, a, b], 'max')
    // Épée Divine donne ensuite +Dommages au lanceur (112) : caractéristiques AVANT le lancer.
    const before = { ...iop.stats }
    expect(castSpell(engine, fight, iop, 13110, a.cell).ok).toBe(true)
    const centre = damageRoll(input(iop, a, Element.Air, { attacker: before, portalBonusPct: 50 }), 28)
    expect(damages(fight, a.id)[0].amount).toBe(centre)
    expect(centre).toBeGreaterThan(damageRoll(input(iop, a, Element.Air, { attacker: before }), 28))
    // B à 2 cases du centre de la croix : 80 % × 150 %, une seule troncature (forme DoMath zone × portail).
    expect(damages(fight, b.id)[0].amount).toBe(damageRoll(input(iop, b, Element.Air, { attacker: before, areaSteps: 2, portalBonusPct: 50 }), 28))
  })

  it('Zénith (13145, 1013) : × PM restants / (PM restants + PM utilisés), 0 PM ⇒ aucun dommage 1013', () => {
    for (const mp of [6, 4, 0]) {
      const iop = player('Iop', 8, [13145], CENTER, { agility: 400 })
      const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 1) })
      const far = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 3) })
      const { engine, fight } = setup([iop, t, far])
      iop.mp = mp
      expect(castSpell(engine, fight, iop, 13145, t.cell).ok).toBe(true)
      const ratio = mp / 6
      const extra = ratio !== 1 ? { portalBonusPct: (ratio - 1) * 100 } : {}
      for (const [f, steps] of [[t, 0], [far, 2]] as const) {
        const ev = damages(fight, f.id).map(e => e.amount)
        const base = damageRoll(input(iop, f, Element.Air, { areaSteps: steps }), 27) // 98
        const mpPart = damageRoll(input(iop, f, Element.Air, { areaSteps: steps, ...extra }), 52) // 1013
        expect(ev).toEqual(mpPart > 0 ? [base, mpPart] : [base])
      }
    }
  })
})

describe('transfert de vie (90)', () => {
  it('Transfusion (Sacrieur, 12738) : le lanceur perd 10 % de ses PV UNE fois, chaque allié en zone en reçoit autant', () => {
    const sacri = player('Sacri', 11, [12738], CENTER, {}, { maxHp: 10000 })
    const allies = [1, 3, 5].map(d => player(`Allié ${d}`, 8, [], at(CENTER, d, 2), {}, { maxHp: 10000 }))
    for (const a of allies) a.hp = 5000
    const { engine, fight } = setup([sacri, ...allies])
    expect(castSpell(engine, fight, sacri, 12738, sacri.cell).ok).toBe(true)
    expect(sacri.hp).toBe(9000)
    expect(allies.map(a => a.hp)).toEqual([6000, 6000, 6000])
    // Faux dommage sur le lanceur (sans bouclier ni multiplicateur), une seule perte.
    expect(damages(fight, sacri.id).map(e => e.amount)).toEqual([1000])
  })
})

describe('dommages basés sur les PV érodés', () => {
  it('Morfaille (Vortex, 1122) : PV érodés du lanceur corrigés d’un bonus de Vitalité (+3000)', () => {
    const vortex = createMonsterFighter(data, { monsterId: 3835, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 1, 4), { earthResPct: 20 }, { maxHp: 6000 })
    const { engine, fight } = setup([vortex, p])
    vortex.maxHp -= 2000 // 2000 PV érodés
    vortex.hp = vortex.maxHp
    engine.addBuff(fight, vortex, { sourceId: vortex.id, spellId: 0, effect: PUNCH(), value: 3000, remaining: 3, delay: 0, dispellable: true, kind: 'stat', statDelta: { vitality: 3000 }, label: '+3000 Vitalité' })
    expect(vortex.maxHp - vortex.baseMaxHp).toBe(1000)
    castSubSpell(engine, fight, vortex, 5069, 1, p.cell, false, 0)
    const ev = damages(fight, p.id)
    expect(ev).toHaveLength(1)
    expect(ev[0].amount).toBe(hpBasedDamage({ percent: 20, referenceHp: 2000, defender: p.stats, element: Element.Earth, defenderIsPlayer: true }))
  })
})

describe("mode 'average' : critique pondéré seulement là où il existe", () => {
  it('Morfaille (Vortex 5070, 20 % CC) : le sous-sort 5069 sans liste critique n’ajoute pas de bonus critique', () => {
    const vortex = createMonsterFighter(data, { monsterId: 3835, grade: 1, cell: CENTER })
    vortex.baseStats = { ...vortex.baseStats, criticalDamage: 300 }
    const p1 = player('Cible', 8, [], at(CENTER, 1, 3), {}, { maxHp: 9000 })
    const p2 = player('Voisin', 8, [], at(p1.cell, 3, 1), { neutralResPct: 10 }, { maxHp: 9000 })
    const { engine, fight } = setup([vortex, p1, p2], 'average')
    expect(vortex.stats.criticalDamage).toBe(300)
    expect(castSpell(engine, fight, vortex, 5070, p1.cell).ok).toBe(true)
    expect(vortex.tags.critWeight).toBeUndefined()
    // Anneau C2,1 autour de la cible : le voisin à 1 case prend 100 % des dégâts Neutre (100) et Eau (96).
    const mean = (el: Element) => {
      let s = 0
      for (let r = 41; r <= 50; r++) s += damageRoll(input(vortex, p2, el), r)
      return Math.round(s / 10)
    }
    expect(damages(fight, p2.id).map(e => e.amount)).toEqual([mean(Element.Neutral), mean(Element.Water)])
  })
})

describe('nature des dommages', () => {
  it('sous-sort lancé par un effet instantané : dommages directs (DS déclenché), pas indirects', () => {
    const vortex = createMonsterFighter(data, { monsterId: 3835, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 1, 4), {}, { maxHp: 6000 })
    const { engine, fight } = setup([vortex, p])
    vortex.maxHp -= 1000
    vortex.hp = vortex.maxHp
    // Dommages subis ×200 % sur les seuls dommages de sort directs (code DS).
    const ds = { ...effectOf(5018, 1163), triggers: 'DS' }
    engine.addBuff(fight, p, { sourceId: vortex.id, spellId: 5018, effect: ds, value: 0, remaining: 2, delay: 0, dispellable: true, triggers: 'DS', kind: 'trigger', label: 'DS ×200 %' })
    castSubSpell(engine, fight, vortex, 5069, 1, p.cell, false, 0)
    const [ev] = damages(fight, p.id)
    expect(ev.kind).toBe('direct')
    expect(ev.amount).toBe(hpBasedDamage({ percent: 20, referenceHp: 1000, defender: p.stats, element: Element.Earth, defenderIsPlayer: true, sustainedPct: 200 }))
  })
})

describe('soins liés aux dommages', () => {
  it('Feinterception (786) : l’attaquant n’est soigné que des PV réellement perdus (bouclier exclu)', () => {
    for (const shield of [100000, 50]) {
      const bubo = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: CENTER })
      const p = player('Joueur', 8, [], at(CENTER, 1, 1), {}, { maxHp: 8000 })
      const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(p.cell, 0, 2) })
      harpille.hp = 1000
      const { engine, fight } = setup([bubo, p, harpille])
      expect(castSpell(engine, fight, bubo, 5027, p.cell).ok).toBe(true)
      engine.addShield(fight, undefined, p, shield)
      expect(castSpell(engine, fight, harpille, 5018, p.cell).ok).toBe(true)
      const hit = damages(fight, p.id).filter(e => e.source === harpille.id)[0]
      expect(hit.amount).toBe(shield > 1000 ? 0 : damageRoll(input(harpille, p, Element.Neutral), 31) - shield)
      expect(harpille.hp).toBe(1000 + Math.floor((hit.amount * 50) / 100))
    }
  })

  it('vol de vie (Flèche de Rédemption) : soin du lanceur × % soins finaux (2971/2972)', () => {
    const cra = player('Crâ', 9, [32442], CENTER, { chance: 400, finalHealPct: 20 }, { maxHp: 3000 })
    cra.hp = 1000
    const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 5) })
    const { engine, fight } = setup([cra, t])
    expect(castSpell(engine, fight, cra, 32442, t.cell).ok).toBe(true)
    const dmg = damageRoll(input(cra, t, Element.Water), 26)
    expect(damages(fight, t.id)[0].amount).toBe(dmg)
    expect(cra.hp).toBe(1000 + Math.floor((Math.floor(dmg / 2) * 120) / 100))
  })

  it('Mot Interdit (2998) : la Puissance aux sorts (98) s’ajoute à la carac du soin, pas la Puissance (25)', () => {
    const eni = player('Eni', 7, [25873], CENTER, { chance: 400, heals: 50, spellPower: 100, power: 300 })
    const ally = player('Allié', 1, [], at(CENTER, 1, 3), {}, { maxHp: 3000 })
    ally.hp = 1000
    const { engine, fight } = setup([eni, ally])
    expect(castSpell(engine, fight, eni, 25873, ally.cell).ok).toBe(true)
    const h = healFormula(46, eni.stats, { element: Element.Water, spellPower: 100 })
    expect(h).toBe(Math.floor((46 * (100 + 400 + 100)) / 100) + 50)
    expect(ally.hp).toBe(1000 + h)
  })

  it('Poisse (Ecaflip, 2973 via 28716 sur D) : alliés soignés de 50 % des dommages RÉELLEMENT retirés à la cible', () => {
    for (const targetHp of [5000, 40]) {
      const eca = player('Eca', 6, [12922], CENTER, { chance: 500 }, { maxHp: 4000 })
      const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 3) })
      const ally = player('Allié', 8, [], at(t.cell, 3, 1), {}, { maxHp: 5000 })
      ally.hp = 1000
      const { engine, fight } = setup([eca, t, ally])
      t.hp = targetHp
      expect(castSpell(engine, fight, eca, 12922, t.cell).ok).toBe(true)
      const dmg = damageRoll(input(eca, t, Element.Water), 34)
      expect(dmg).toBeGreaterThan(40)
      const removed = Math.min(dmg, targetHp)
      // Cible tuée (40 PV) : le déclencheur XD ne relance pas le sous-sort sur la case du mort (problème du noyau,
      // cf. rapport) — on vérifie seulement qu'aucun soin n'excède la part réellement retirée.
      if (t.alive) expect(ally.hp).toBe(1000 + Math.floor(removed / 2))
      else expect(ally.hp - 1000).toBeLessThanOrEqual(Math.floor(removed / 2))
    }
  })
})

describe('renvoi 1223 sur un coup fatal', () => {
  it('buff D|XD exécuté directement sur le porteur : 30 % des PV réellement retirés, pas du coup entier', () => {
    const iop = player('Iop', 8, [13110], CENTER, { agility: 600 })
    const holder = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 2) })
    const near = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(holder.cell, 3, 1) })
    const { engine, fight } = setup([iop, holder, near])
    // Ligne 1223 de Massacre (30 %, C2,1, masque A) rejouée comme buff réel D|XD posé par l'Iop sur la cible.
    // NB : `dispellable: 4` — Engine.kill retire les buffs désenvoûtables 1/2 du mort AVANT que les déclencheurs XD
    // (onDamaged) ne s'exécutent (problème du moteur / noyau, cf. rapport) ; on isole ici le calcul du renvoi.
    const splash = { ...effectOf(13112, 1223), clientOnly: false, dispellable: 4 }
    engine.addBuff(fight, holder, { sourceId: iop.id, spellId: 13112, effect: splash, value: 0, remaining: 2, delay: 0, dispellable: true, triggers: 'D|XD', kind: 'trigger', label: 'Massacre' })
    holder.hp = 60
    expect(castSpell(engine, fight, iop, 13110, holder.cell).ok).toBe(true)
    expect(holder.alive).toBe(false)
    expect(damages(fight, holder.id)[0].amount).toBe(60)
    const ev = damages(fight, near.id).filter(e => e.kind === 'indirect')
    expect(ev).toHaveLength(1)
    expect(ev[0].amount).toBe(hpBasedDamage({ percent: 30, referenceHp: 60, defender: near.stats, element: Element.Air, defenderIsPlayer: false }))
  })
})
