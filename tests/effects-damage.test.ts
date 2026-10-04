/**
 * Famille « damage » (src/engine/effects/damage.ts) sur données réelles : sorts de classe et du donjon Vortex lancés
 * par castSpell / castSubSpell, comparés aux formules DoMath de src/damage. Seule la famille damage est chargée ici :
 * les effets d'autres familles (retraits de PM, états, sous-sorts...) restent sans interprète (comptés comme inconnus).
 */
import { describe, expect, it } from 'vitest'
import { Element, emptyStats, type Stats } from '../src/core/types'
import { damageRoll, expectedDamage, heal as healFormula, hpBasedDamage, type DamageInput } from '../src/damage'
import type { EffectData, MapData } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import { castSpell } from '../src/engine/cast'
import { castSubSpell, installEffectCore } from '../src/engine/effects/core'
import { computeAndApplyDamage, installDamageHooks, isShieldBuff } from '../src/engine/effects/damage'
import { getEffectHandler, type EffectContext } from '../src/engine/effects/registry'
import { Engine } from '../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightEvent, FightState, RollMode } from '../src/engine/types'
import { cellInDirection } from '../src/map/geometry'

const data = loadDataStore()

/** Carte synthétique ouverte : 560 cases marchables, sans obstacle. */
const OPEN: MapData = { id: 1, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }

const CENTER = 300
/** Case à `n` pas dans la direction d'axe `dir` (1, 3, 5, 7 = axes de la grille). */
const at = (cell: number, dir: number, n: number) => cellInDirection(cell, dir, n)

function stats(p: Partial<Stats>): Stats {
  return { ...emptyStats(), ap: 12, mp: 6, ...p }
}

function player(name: string, breedId: number, spellIds: number[], cell: number, s: Partial<Stats>, opts: { team?: 0 | 1; maxHp?: number; level?: number } = {}): Fighter {
  return createPlayerFighter(data, {
    name,
    breedId,
    level: opts.level ?? 200,
    stats: stats(s),
    maxHp: opts.maxHp ?? 4000,
    spellIds,
    cell,
    team: opts.team ?? 0,
  })
}

/** Combat sur la carte ouverte ; un adversaire factice lointain évite la fin immédiate du combat (équipe vide). */
function setup(fighters: Fighter[], rollMode: RollMode = 'random', seed = 7, map: MapData = OPEN): { engine: Engine; fight: FightState } {
  if (!fighters.some(f => f.team === 1)) fighters.push(createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: 14 }))
  if (!fighters.some(f => f.team === 0)) fighters.push(player('Témoin', 8, [], 545, {}))
  const engine = new Engine(data)
  installEffectCore(engine)
  const fight = engine.createFight({ map, fighters, options: { rollMode, seed } })
  return { engine, fight }
}

type DamageEvent = Extract<FightEvent, { t: 'damage' }>
const damages = (fight: FightState, target?: number): DamageEvent[] =>
  fight.events.filter((e): e is DamageEvent => e.t === 'damage' && (target === undefined || e.target === target))

/** Entrée DoMath d'un coup de `a` sur `d` (mêmes conventions que le moteur). */
function input(a: Fighter, d: Fighter, element: Element, extra: Partial<DamageInput> = {}): DamageInput {
  return { attacker: a.stats, defender: d.stats, element, crit: false, isWeapon: false, isMelee: false, defenderIsPlayer: d.kind === 'player', areaStepPct: 10, ...extra }
}

function effectOf(spellId: number, effectId: number, grade?: number): EffectData {
  const lvl = data.spellLevel(spellId, { grade })!
  return lvl.effects.find(e => e.effectId === effectId)!
}

/** Contexte d'effet minimal (exécution directe d'un handler / de computeAndApplyDamage). */
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

describe('dommages élémentaires (96-100) : sorts réels = DoMath', () => {
  it('Épée Divine (Iop) : jets min / max et dégressivité de la croix X3', () => {
    for (const mode of ['min', 'max'] as const) {
      const iop = player('Iop', 8, [13110], CENTER, { agility: 500, power: 100 })
      const a = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 2) })
      const b = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 4) })
      const { engine, fight } = setup([iop, a, b], mode)
      expect(castSpell(engine, fight, iop, 13110, a.cell).ok).toBe(true)
      const roll = mode === 'min' ? 24 : 28
      const evA = damages(fight, a.id)
      const evB = damages(fight, b.id)
      expect(evA).toHaveLength(1)
      expect(evA[0].amount).toBe(damageRoll(input(iop, a, Element.Air), roll))
      // B est à 2 cases du centre de la croix : 2 paliers de 10 %.
      expect(evB[0].amount).toBe(damageRoll(input(iop, b, Element.Air, { areaSteps: 2 }), roll))
      expect(evA[0]).toMatchObject({ element: Element.Air, kind: 'direct', source: iop.id })
    }
    // Contrôle à la main (jet 24, Agilité 500 + Puissance 100, Harpille −8 % Air) : 24 × 7 = 168 → × 0,92 = 154.
    const iop = player('Iop', 8, [13110], CENTER, { agility: 500, power: 100 })
    const a = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 2) })
    const { engine, fight } = setup([iop, a], 'min')
    castSpell(engine, fight, iop, 13110, a.cell)
    expect(a.baseMaxHp - a.hp).toBeGreaterThanOrEqual(154)
    expect(damages(fight, a.id)[0].amount).toBe(154)
  })

  it('Couperet (Iop) : ligne L3 dégressive (100/90/80/70 %), alliés compris, jets aléatoires dans les bornes', () => {
    const iop = player('Iop', 8, [13115], CENTER, { intelligence: 800, power: 50, fireDamage: 20 })
    const impact = at(CENTER, 1, 2)
    // Ligne L3 : impact + 3 cases en s'éloignant du lanceur ; deux monstres puis un allié du lanceur (masque a,A).
    const targets = [0, 1, 2].map(i => createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(impact, 1, i) }))
    const friend = player('Ami', 1, [], at(impact, 1, 3), {}, { maxHp: 3000 })
    const ally = player('Allié', 1, [], at(impact, 3, 1), {}, { maxHp: 3000 }) // à côté de l'impact : hors ligne
    const { engine, fight } = setup([iop, ...targets, friend, ally], 'random', 11)
    expect(castSpell(engine, fight, iop, 13115, impact).ok).toBe(true)
    const hit = [...targets, friend]
    hit.forEach((t, i) => {
      const ev = damages(fight, t.id)
      expect(ev).toHaveLength(1)
      const lo = damageRoll(input(iop, t, Element.Fire, { areaSteps: i }), 28)
      const hi = damageRoll(input(iop, t, Element.Fire, { areaSteps: i }), 32)
      expect(ev[0].amount).toBeGreaterThanOrEqual(lo)
      expect(ev[0].amount).toBeLessThanOrEqual(hi)
    })
    expect(damages(fight, ally.id)).toHaveLength(0)
    // Le retrait de PM (1080) n'appartient pas à cette famille : effet compté comme inconnu, sans erreur.
  })

  it("mode 'average' : espérance exacte (critique pondéré) = moyenne de nombreux jets aléatoires", () => {
    const mk = () => {
      const iop = player('Iop', 8, [13110], CENTER, { agility: 600, power: 80, critical: 40, criticalDamage: 30 })
      const t = createMonsterFighter(data, { monsterId: 3835, grade: 1, cell: at(CENTER, 3, 2) })
      return { iop, t }
    }
    // Espérance DoMath : (1 − p)·E[normal] + p·E[critique], p = (10 + 40) %, jets critiques 29-34.
    const { iop: i0, t: t0 } = mk()
    const expected = expectedDamage(input(i0, t0, Element.Air), null, { min: 24, max: 28, critMin: 29, critMax: 34 }, 50)

    const avg = mk()
    const a = setup([avg.iop, avg.t], 'average')
    castSpell(a.engine, a.fight, avg.iop, 13110, avg.t.cell)
    const avgDamage = damages(a.fight, avg.t.id)[0].amount
    expect(avgDamage).toBe(Math.round(expected))
    expect(avg.iop.tags.critWeight).toBeUndefined()

    const base = mk()
    const r = setup([base.iop, base.t], 'random')
    const N = 3000
    let sum = 0
    for (let k = 0; k < N; k++) {
      const f = r.engine.cloneFight(r.fight)
      f.rngState = (k * 2654435761) | 0
      const caster = f.fighters[base.iop.id]
      const target = f.fighters[base.t.id]
      castSpell(r.engine, f, caster, 13110, target.cell)
      sum += target.baseMaxHp - target.hp
    }
    expect(Math.abs(sum / N - expected)).toBeLessThan(2)
  })

  it('élément « meilleur » (2822) : caractéristique la plus haute du lanceur', () => {
    const eni = player('Eni', 7, [], CENTER, { chance: 900, strength: 100 })
    const t = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 2) })
    const { engine, fight } = setup([eni, t], 'max')
    const e = effectOf(25832, 2822) // Scalpel : 40-44 dommages du meilleur élément
    computeAndApplyDamage(ctxFor(engine, fight, eni, e, [t]), t)
    const ev = damages(fight, t.id)[0]
    expect(ev.element).toBe(Element.Water)
    expect(ev.amount).toBe(damageRoll(input(eni, t, Element.Water), 44))
  })
})

describe('vols de vie et soins', () => {
  it('Flèche de Rédemption (Crâ, 91) : le lanceur est soigné de la moitié des PV perdus', () => {
    const cra = player('Crâ', 9, [32442], CENTER, { chance: 400 }, { maxHp: 3000 })
    cra.hp = 1000
    const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 5) })
    const { engine, fight } = setup([cra, t], 'min')
    expect(castSpell(engine, fight, cra, 32442, t.cell).ok).toBe(true)
    const dmg = damageRoll(input(cra, t, Element.Water), 26)
    expect(damages(fight, t.id)[0].amount).toBe(dmg)
    expect(cra.hp).toBe(1000 + Math.floor(dmg / 2))
    expect(fight.events.some(e => e.t === 'heal' && e.target === cra.id && e.amount === Math.floor(dmg / 2))).toBe(true)
  })

  it("vol de vie : pas de soin si la cible est le lanceur ; le soin du vol ne déclenche pas les buffs H", () => {
    const cra = player('Crâ', 9, [], CENTER, { chance: 400 }, { maxHp: 3000 })
    cra.hp = 2000
    const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 5) })
    const { engine, fight } = setup([cra, t], 'min')
    const steal = effectOf(32442, 91)
    computeAndApplyDamage(ctxFor(engine, fight, cra, steal, [cra]), cra)
    expect(cra.hp).toBeLessThan(2000)
    expect(fight.events.some(e => e.t === 'heal')).toBe(false)
    const fired: string[] = []
    const prev = engine.trigger
    engine.trigger = (f, h, ev) => {
      fired.push(ev.type)
      prev(f, h, ev)
    }
    const before = cra.hp
    computeAndApplyDamage(ctxFor(engine, fight, cra, steal, [t]), t)
    expect(cra.hp).toBeGreaterThan(before)
    expect(fired).not.toContain('H')
  })

  it('Mot Interdit (Eniripsa, 2998) : soin Eau = floor(jet × (100 + Chance)/100) + Soins, plafonné aux PV max', () => {
    const eni = player('Eni', 7, [25873], CENTER, { chance: 400, heals: 50 })
    const ally = player('Allié', 1, [], at(CENTER, 1, 3), {}, { maxHp: 3000 })
    ally.hp = 1000
    const { engine, fight } = setup([eni, ally], 'min')
    expect(castSpell(engine, fight, eni, 25873, ally.cell).ok).toBe(true)
    const h = healFormula(46, eni.stats, { element: Element.Water })
    expect(h).toBe(280)
    expect(ally.hp).toBe(1000 + h)
    // Plafond : il ne manque que 100 PV.
    ally.hp = ally.maxHp - 100
    castSpell(engine, fight, eni, 25873, ally.cell) // 1 lancer par tour : refusé
    eni.castsThisTurn = {}
    eni.ap = 12
    castSpell(engine, fight, eni, 25873, ally.cell)
    expect(ally.hp).toBe(ally.maxHp)
  })

  it('Insoignable (état 76) : aucun soin', () => {
    const eni = player('Eni', 7, [25873], CENTER, { chance: 400 })
    const ally = player('Allié', 1, [], at(CENTER, 1, 3), {}, { maxHp: 3000 })
    ally.hp = 1000
    const { engine, fight } = setup([eni, ally], 'min')
    engine.addBuff(fight, ally, { sourceId: eni.id, spellId: 0, effect: effectOf(25873, 2998), value: 0, remaining: 1, delay: 0, dispellable: true, stateId: 76, label: 'Insoignable' })
    castSpell(engine, fight, eni, 25873, ally.cell)
    expect(ally.hp).toBe(1000)
  })

  it('Onguent Ancestral (1159 ×125 % sur un allié, déclencheur H) : le soin suivant est multiplié', () => {
    const eni = player('Eni', 7, [25869], CENTER, { strength: 300, heals: 20 })
    const ally = player('Allié', 1, [], at(CENTER, 1, 3), {}, { maxHp: 5000 })
    ally.hp = 1000
    const { engine, fight } = setup([eni, ally], 'min')
    castSpell(engine, fight, eni, 25869, ally.cell)
    const h = healFormula(35, eni.stats, { element: Element.Earth })
    expect(ally.hp).toBe(1000 + h)
    castSpell(engine, fight, eni, 25869, ally.cell)
    expect(ally.hp).toBe(1000 + h + Math.trunc((h * 125) / 100))
  })

  it("mode 'average' : soin pondéré par le critique", () => {
    const eni = player('Eni', 7, [25873], CENTER, { chance: 400, heals: 50, critical: 25 })
    const ally = player('Allié', 1, [], at(CENTER, 1, 3), {}, { maxHp: 3000 })
    ally.hp = 100
    const { engine, fight } = setup([eni, ally], 'average')
    castSpell(engine, fight, eni, 25873, ally.cell)
    const mean = (lo: number, hi: number) => {
      let s = 0
      for (let v = lo; v <= hi; v++) s += healFormula(v, eni.stats, { element: Element.Water })
      return s / (hi - lo + 1)
    }
    const p = (25 + 25) / 100
    expect(ally.hp - 100).toBe(Math.round((1 - p) * mean(46, 50) + p * mean(55, 60)))
  })
})

describe('boucliers', () => {
  it('Endurance (Iop, 1020) : 75 % du niveau, absorbe avant les PV, érosion sur le total, buff suivi', () => {
    const iop = player('Iop', 8, [13133], CENTER, {}, { maxHp: 4000 })
    const { engine, fight } = setup([iop], 'min')
    expect(castSpell(engine, fight, iop, 13133, iop.cell).ok).toBe(true)
    expect(iop.shield).toBe(150)
    const buff = iop.buffs.find(isShieldBuff)!
    expect(buff).toMatchObject({ value: 150, remaining: 2 })
    // 100 dommages : absorbés ; l'érosion (10 %) porte sur les 100 points AVANT bouclier (DoMath / port D3).
    engine.applyDamage(fight, undefined, iop, 100, Element.Fire, 'direct')
    expect(iop.shield).toBe(50)
    expect(buff.value).toBe(50)
    expect(iop.maxHp).toBe(3990)
    expect(iop.hp).toBe(3990)
    // 120 dommages : 50 absorbés (buff vidé ⇒ retiré), 70 sur les PV.
    engine.applyDamage(fight, undefined, iop, 120, Element.Fire, 'direct')
    expect(iop.shield).toBe(0)
    expect(iop.buffs.some(isShieldBuff)).toBe(false)
    expect(iop.maxHp).toBe(3978) // érosion de 12 sur les 120 points
    expect(iop.hp).toBe(3920)
  })

  it("le bouclier disparaît avec son buff (expiration au début du tour du lanceur, désenvoûtement)", () => {
    const iop = player('Iop', 8, [13133], CENTER, {})
    const { engine, fight } = setup([iop], 'min')
    castSpell(engine, fight, iop, 13133, iop.cell)
    expect(iop.shield).toBe(150)
    engine.startTurn(fight, iop)
    expect(iop.shield).toBe(150)
    engine.startTurn(fight, iop)
    expect(iop.shield).toBe(0)
    // Deux boucliers : le retrait d'un buff n'emporte que ses points restants.
    iop.ap = 12
    iop.castsThisTurn = {}
    castSpell(engine, fight, iop, 13133, iop.cell)
    castSpell(engine, fight, iop, 13133, iop.cell)
    expect(iop.shield).toBe(300)
    engine.applyDamage(fight, undefined, iop, 100, Element.Fire, 'direct') // consomme le plus ancien
    const [b1, b2] = iop.buffs.filter(isShieldBuff)
    expect([b1.value, b2.value]).toEqual([50, 150])
    engine.removeBuff(fight, iop, b2.uid)
    expect(iop.shield).toBe(50)
  })

  it('1039 (% PV max du lanceur) et 1040 (fixe)', () => {
    const sacri = player('Sacri', 11, [], CENTER, {}, { maxHp: 5000 })
    const { engine, fight } = setup([sacri], 'min')
    installDamageHooks(engine)
    const e1039 = effectOf(3897, 1039) // Crac boum hue : 10 % des PV max (celui de Couronne d'Épines est d'affichage)
    const before = sacri.shield
    runHandler(ctxFor(engine, fight, sacri, e1039, [sacri]))
    expect(sacri.shield - before).toBe(500)
    const e1040 = effectOf(13702, 1040) // Ébullition : 200 bouclier
    runHandler(ctxFor(engine, fight, sacri, e1040, [sacri]))
    expect(sacri.shield - before).toBe(700)
  })
})

describe('modificateurs de dommages (buffs consommés au calcul)', () => {
  it('Tirs optiques (Harpille, 1163 ×200 %) : le coup suivant subi est doublé', () => {
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 0, 2), { neutralResPct: 10 }, { maxHp: 8000 }) // Tirs optiques : en diagonale
    const { engine, fight } = setup([harpille, p], 'min')
    expect(castSpell(engine, fight, harpille, 5018, p.cell).ok).toBe(true)
    const first = damageRoll(input(harpille, p, Element.Neutral), 31)
    expect(damages(fight, p.id)[0].amount).toBe(first)
    expect(p.buffs.some(b => b.effect.effectId === 1163 && b.kind === 'trigger')).toBe(true)
    harpille.ap = 12
    harpille.castsOnTarget = {}
    expect(castSpell(engine, fight, harpille, 5018, p.cell).ok).toBe(true)
    expect(damages(fight, p.id)[1].amount).toBe(damageRoll(input(harpille, p, Element.Neutral, { sustainedPct: 200 }), 31))
  })

  it('Bouclier Féca (1163 ×70 % sur un allié) et Rempart (265 : 12 × (1 + niveau/20) = 132)', () => {
    const feca = player('Féca', 1, [12982, 12981], CENTER, {}, { maxHp: 6000 })
    const ally = player('Allié', 8, [], at(CENTER, 1, 2), {}, { maxHp: 6000 })
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(ally.cell, 0, 2) })
    const { engine, fight } = setup([feca, ally, harpille], 'min')
    expect(castSpell(engine, fight, feca, 12982, ally.cell).ok).toBe(true)
    expect(castSpell(engine, fight, harpille, 5018, ally.cell).ok).toBe(true)
    expect(damages(fight, ally.id)[0].amount).toBe(damageRoll(input(harpille, ally, Element.Neutral, { sustainedPct: 70 }), 31))
    // Rempart : réduction fixe appliquée avec les résistances fixes, avant les % (Féca et alliés en C3).
    expect(castSpell(engine, fight, feca, 12981, feca.cell).ok).toBe(true)
    const buff = ally.buffs.find(b => b.effect.effectId === 265)
    expect(buff?.kind).toBe('trigger')
    harpille.ap = 12
    harpille.castsThisTurn = {}
    harpille.castsOnTarget = {}
    harpille.cell = at(CENTER, 4, 2) // en diagonale du Féca, à portée (1-5)
    expect(castSpell(engine, fight, harpille, 5018, feca.cell).ok).toBe(true)
    expect(damages(fight, feca.id)[0].amount).toBe(damageRoll(input(harpille, feca, Element.Neutral, { armorReduction: 132 }), 31))
  })

  it('Pacifiste (état 218) : le lanceur n’inflige plus de dommages', () => {
    const iop = player('Iop', 8, [13110], CENTER, { agility: 500 })
    const t = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(CENTER, 1, 2) })
    const { engine, fight } = setup([iop, t], 'min')
    engine.addBuff(fight, iop, { sourceId: t.id, spellId: 5022, effect: effectOf(5022, 950), value: 0, remaining: 1, delay: 0, dispellable: true, stateId: 218, label: 'Pacifiste' })
    castSpell(engine, fight, iop, 13110, t.cell)
    expect(t.hp).toBe(t.maxHp)
  })

  it('Sacrifice (Sacrieur, 765) : les dommages subis par l’allié sont encaissés par le Sacrieur', () => {
    const sacri = player('Sacri', 11, [12739], CENTER, {}, { maxHp: 6000 })
    const ally = player('Allié', 8, [], at(CENTER, 1, 2), {}, { maxHp: 6000 })
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(ally.cell, 0, 2) })
    const { engine, fight } = setup([sacri, ally, harpille], 'min')
    expect(castSpell(engine, fight, sacri, 12739, ally.cell).ok).toBe(true)
    expect(ally.buffs.some(b => b.effect.effectId === 765)).toBe(true)
    castSpell(engine, fight, harpille, 5018, ally.cell)
    expect(ally.hp).toBe(ally.maxHp)
    expect(damages(fight, sacri.id)).toHaveLength(1)
    expect(damages(fight, sacri.id)[0].amount).toBe(damageRoll(input(harpille, ally, Element.Neutral), 31))
  })

  it('Butin Partagé (sous-sort de la Musette, 1061) : les dommages sont partagés entre les porteurs du buff', () => {
    // NB : la ligne 1061 de *Musette Animée* (13354) est un effet d'affichage (forClientOnly), ignoré.
    const enu = player('Enu', 3, [13354], CENTER, {}, { maxHp: 6000 })
    const x = player('X', 8, [], at(CENTER, 3, 1), {}, { maxHp: 6000 })
    const y = player('Y', 8, [], at(CENTER, 7, 1), {}, { maxHp: 6000 })
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(x.cell, 0, 2) })
    const { engine, fight } = setup([enu, x, y, harpille], 'min')
    expect(castSpell(engine, fight, enu, 13354, at(CENTER, 5, 2)).ok).toBe(true)
    expect(x.buffs.some(b => b.effect.effectId === 1061)).toBe(false)
    castSubSpell(engine, fight, enu, 13373, 1, enu.cell, false, 0)
    expect(x.buffs.some(b => b.effect.effectId === 1061) && y.buffs.some(b => b.effect.effectId === 1061)).toBe(true)
    castSpell(engine, fight, harpille, 5018, x.cell)
    const full = damageRoll(input(harpille, x, Element.Neutral), 31)
    expect(damages(fight, x.id).map(e => e.amount)).toEqual([Math.trunc(full / 2)])
    expect(damages(fight, y.id).map(e => e.amount)).toEqual([Math.trunc(full / 2)])
  })

  it('effets d’affichage (forClientOnly) ignorés : Couronne d’Épines n’applique ni renvoi ni bouclier direct', () => {
    const sacri = player('Sacri', 11, [12761], CENTER, {}, { maxHp: 5000 })
    const { engine, fight } = setup([sacri], 'min')
    castSpell(engine, fight, sacri, 12761, sacri.cell)
    // 1039 / 1223 de la ligne principale sont forClientOnly ; le vrai effet est dans le sous-sort 25851 (792).
    expect(sacri.shield).toBe(0)
    expect(sacri.buffs.some(b => b.effect.effectId === 1223)).toBe(sacri.buffs.some(b => b.effect.effectId === 1223 && !b.effect.clientOnly))
  })
})

describe('érosion et dommages basés sur les PV', () => {
  it('érosion : 10 % de base, +776, plafond 50 %, calculée avant bouclier', () => {
    const p = player('Joueur', 8, [], CENTER, {}, { maxHp: 10000 })
    const { engine, fight } = setup([p])
    engine.applyDamage(fight, undefined, p, 1000, Element.Fire, 'direct')
    expect(p.maxHp).toBe(9900)
    const erosionEffect = effectOf(13106, 776) // Pression (Iop) : +10 % érosion
    engine.addBuff(fight, p, { sourceId: p.id, spellId: 13106, effect: erosionEffect, value: 25, remaining: 2, delay: 0, dispellable: true, kind: 'stat', label: '+25 % Érosion' })
    expect(engine.erosionPercent(p)).toBe(35)
    engine.applyDamage(fight, undefined, p, 1000, Element.Fire, 'direct')
    expect(p.maxHp).toBe(9900 - 350)
    engine.addBuff(fight, p, { sourceId: p.id, spellId: 13106, effect: erosionEffect, value: 60, remaining: 2, delay: 0, dispellable: true, kind: 'stat', label: '+60 % Érosion' })
    engine.applyDamage(fight, undefined, p, 1000, Element.Fire, 'direct')
    expect(p.maxHp).toBe(9550 - 500)
    // Bouclier : l'érosion porte sur le total (bouclier compris).
    engine.addShield(fight, undefined, p, 1000)
    engine.applyDamage(fight, undefined, p, 400, Element.Fire, 'direct')
    expect(p.maxHp).toBe(9050 - 200)
  })

  it('Morfaille (Vortex, sous-sort 5069) : 20 % des PV érodés du lanceur en Terre (1122)', () => {
    const vortex = createMonsterFighter(data, { monsterId: 3835, grade: 1, cell: CENTER })
    vortex.maxHp -= 2000 // 2000 PV érodés
    vortex.hp = vortex.maxHp
    const p = player('Joueur', 8, [], at(CENTER, 1, 4), { earthResPct: 20, earthRes: 10 }, { maxHp: 6000 })
    const { engine, fight } = setup([vortex, p], 'min')
    castSubSpell(engine, fight, vortex, 5069, 1, p.cell, false, 0)
    const ev = damages(fight, p.id)
    // 100 / 96 en anneau C2,1 : la cible au centre n'est touchée que par 1122.
    expect(ev).toHaveLength(1)
    expect(ev[0].element).toBe(Element.Earth)
    expect(ev[0].amount).toBe(312) // trunc((20 % × 2000 − 10) × 0,8)
    expect(ev[0].amount).toBe(hpBasedDamage({ percent: 20, referenceHp: 2000, defender: p.stats, element: Element.Earth, defenderIsPlayer: true }))
  })

  it('En temps et en heure (Auroraire, 5061) : 500 Terre puis 50 % des PV érodés de la cible (1096)', () => {
    const auro = createMonsterFighter(data, { monsterId: 3833, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 3, 5), { earthResPct: 10 }, { maxHp: 8000 })
    p.maxHp -= 1000 // déjà 1000 PV érodés
    p.hp = p.maxHp
    const { engine, fight } = setup([auro, p], 'min')
    castSubSpell(engine, fight, auro, 5061, 1, auro.cell, false, 0)
    const [hit, eroded] = damages(fight, p.id)
    expect(hit.amount).toBe(damageRoll(input(auro, p, Element.Earth), 500))
    const ref = 1000 + (hit.erosion ?? 0)
    expect(eroded.amount).toBe(hpBasedDamage({ percent: 50, referenceHp: ref, defender: p.stats, element: Element.Earth, defenderIsPlayer: true }))
  })
})

describe('poisons et renvois', () => {
  it('Petit poison (Harpille, 5021) : 50 Eau au début de chacun des 3 tours suivants de la cible (kind poison)', () => {
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 1, 6), { waterResPct: 20 }, { maxHp: 8000 })
    const { engine, fight } = setup([harpille, p], 'min')
    let casted = false
    for (let i = 0; i < 12 && !fight.ended; i++) {
      const f = engine.nextTurn(fight)!
      if (f === harpille && !casted) {
        expect(castSpell(engine, fight, harpille, 5021, harpille.cell).ok).toBe(true)
        casted = true
      }
      engine.endTurn(fight, f)
    }
    const ticks = damages(fight, p.id).filter(e => e.kind === 'poison')
    expect(ticks).toHaveLength(3)
    expect(ticks[0].amount).toBe(damageRoll(input(harpille, p, Element.Water), 50))
    expect(ticks.every(e => e.element === Element.Water && e.source === harpille.id)).toBe(true)
  })

  it('renvoi 1223 (Massacre) exécuté par un buff D : 30 % des dommages finaux du porteur aux ennemis autour de lui', () => {
    const iop = player('Iop', 8, [], CENTER, {})
    const holder = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 4) })
    const near = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(holder.cell, 3, 1) })
    const far = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(holder.cell, 3, 4) })
    const { engine, fight } = setup([iop, holder, near, far], 'min')
    // Ligne 1223 de Massacre (30 %, zone C2,1, masque A) : forClientOnly dans les données (le vrai renvoi passe par le
    // sous-sort 13127) ; on la rejoue ici comme un buff déclencheur réel exécuté directement par le noyau.
    const splash = effectOf(13112, 1223)
    const ctx = ctxFor(engine, fight, iop, { ...splash, triggers: 'I', clientOnly: false }, [holder], {
      trigger: { type: 'D', source: iop, element: Element.Fire, amount: 1000 },
      indirect: true,
    })
    runHandler(ctx)
    expect(damages(fight, holder.id)).toHaveLength(0)
    expect(damages(fight, far.id)).toHaveLength(0)
    const ev = damages(fight, near.id)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ element: Element.Fire, kind: 'indirect' })
    expect(ev[0].amount).toBe(hpBasedDamage({ percent: 30, referenceHp: 1000, defender: near.stats, element: Element.Fire, defenderIsPlayer: false }))
  })

  it('Feinterception (Buboxor, 786) : l’attaquant de la cible est soigné de 50 % des dommages', () => {
    const bubo = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 1, 1), {}, { maxHp: 8000 })
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(p.cell, 0, 2) })
    harpille.hp = 1000
    const { engine, fight } = setup([bubo, p, harpille], 'min')
    expect(castSpell(engine, fight, bubo, 5027, p.cell).ok).toBe(true)
    expect(p.buffs.some(b => b.effect.effectId === 786)).toBe(true)
    castSpell(engine, fight, harpille, 5018, p.cell)
    const dealt = damages(fight, p.id).filter(e => e.source === harpille.id)[0].amount
    expect(harpille.hp).toBe(1000 + Math.floor((dealt * 50) / 100))
  })
})

/** Exécute le handler enregistré pour l'effet du contexte (comme runEffect pour un effet instantané). */
function runHandler(ctx: EffectContext): void {
  const entry = getEffectHandler(ctx.effect.effectId)
  if (!entry) throw new Error(`pas d'interprète pour ${ctx.effect.effectId}`)
  entry.handler(ctx)
}
