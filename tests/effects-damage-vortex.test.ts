/**
 * Famille « damage » avec les autres familles chargées (buffs : 406 / 776 / 1171 / 293 ; castspell : 792) et sur la
 * vraie salle du Vortex (carte 143393281) : poison de la Harpille retiré par un soin (vortex.md), mais pas par le soin
 * d'un vol de vie ; auto-désenvoûtement de Tirs optiques ; Massacre (792 → 1223) ; buffs de caractéristiques lus
 * au calcul des dommages.
 */
import { describe, expect, it } from 'vitest'
import { Element, emptyStats, type Stats } from '../src/core/types'
import { damageRoll, hpBasedDamage, type DamageInput } from '../src/damage'
import type { MapData } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import { canCast, castSpell } from '../src/engine/cast'
import '../src/engine/effects/buffs'
import '../src/engine/effects/castspell'
import { installEffectCore } from '../src/engine/effects/core'
import '../src/engine/effects/damage'
import { getEffectHandler } from '../src/engine/effects/registry'
import { Engine } from '../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightEvent, FightState, RollMode } from '../src/engine/types'
import { cellInDirection, distance, inDiagonal } from '../src/map/geometry'
import { hasLineOfSight } from '../src/map/los'

const data = loadDataStore()
const OPEN: MapData = { id: 1, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }
const VORTEX_MAP = data.map(143393281)!
const CENTER = 300
const at = (cell: number, dir: number, n: number) => cellInDirection(cell, dir, n)

function player(name: string, breedId: number, spellIds: number[], cell: number, s: Partial<Stats>, maxHp = 5000): Fighter {
  return createPlayerFighter(data, { name, breedId, level: 200, stats: { ...emptyStats(), ap: 12, mp: 6, ...s }, maxHp, spellIds, cell })
}

function setup(fighters: Fighter[], rollMode: RollMode = 'min', map: MapData = OPEN): { engine: Engine; fight: FightState } {
  const engine = new Engine(data)
  installEffectCore(engine)
  return { engine, fight: engine.createFight({ map, fighters, options: { rollMode, seed: 5 } }) }
}

type DamageEvent = Extract<FightEvent, { t: 'damage' }>
const damages = (fight: FightState, target: number): DamageEvent[] =>
  fight.events.filter((e): e is DamageEvent => e.t === 'damage' && e.target === target)

function input(a: Fighter, d: Fighter, element: Element, extra: Partial<DamageInput> = {}): DamageInput {
  return { attacker: a.stats, defender: d.stats, element, crit: false, isWeapon: false, isMelee: false, defenderIsPlayer: d.kind === 'player', areaStepPct: 10, ...extra }
}

const hasDispel = !!getEffectHandler(406)
const hasCastSpell = !!getEffectHandler(792)

/** Rejoue des tours complets ; `act` est appelé au début du tour de chaque combattant. */
function playRounds(engine: Engine, fight: FightState, turns: number, act: (f: Fighter, round: number) => void): void {
  for (let i = 0; i < turns && !fight.ended; i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    act(f, fight.round)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
  }
}

describe('Harpille : Petit poison (5021) sur la salle du Vortex', () => {
  it.skipIf(!hasDispel || !hasCastSpell)(
    'poison 3 tours au début du tour des personnages ; retiré par un soin, pas par le soin d’un vol de vie',
    () => {
      const cells = VORTEX_MAP.cells.filter(c => c.walkable && c.los).map(c => c.id)
      const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: 271 })
      // Crâ à 4-9 cases de la Harpille (Flèche de Rédemption), Eniripsa à 0-5 cases du Crâ (Mot Interdit).
      const craCell = cells.find(c => distance(c, 271) >= 5 && distance(c, 271) <= 8 && hasLineOfSight(c, 271, x => x !== c && x !== 271 && !VORTEX_MAP.cells[x]?.los))!
      const cra = player('Crâ', 9, [32442], craCell, { chance: 300 })
      const eni = player('Eni', 7, [25873], -1, { chance: 300 })
      cra.hp = 3000
      const { engine, fight } = setup([harpille, cra, eni], 'min', VORTEX_MAP)
      // Eniripsa : une case libre d'où Mot Interdit atteint le Crâ (portée 0-5, ligne de vue de la vraie carte).
      eni.cell = cells.find(c => {
        if (c === craCell || c === harpille.cell) return false
        eni.cell = c
        return canCast(engine, fight, eni, eni.spells[0], cra.cell) === null && canCast(engine, fight, cra, cra.spells[0], harpille.cell) === null
      })!
      expect(eni.cell).toBeGreaterThanOrEqual(0)
      expect(canCast(engine, fight, cra, cra.spells[0], harpille.cell)).toBeNull()
      const log: string[] = []
      playRounds(engine, fight, 9, (f, round) => {
        if (f === harpille && round === 1) log.push(`poison:${castSpell(engine, fight, harpille, 5021, harpille.cell).ok}`)
        if (f === cra && round === 1) log.push(`vol:${castSpell(engine, fight, cra, 32442, harpille.cell).ok}`)
        if (f === eni && round === 2) log.push(`soin:${castSpell(engine, fight, eni, 25873, cra.cell).ok}`)
      })
      expect(log).toEqual(['poison:true', 'vol:true', 'soin:true'])
      const tick = damageRoll(input(harpille, cra, Element.Water), 50)
      const craPoison = damages(fight, cra.id).filter(e => e.kind === 'poison')
      const eniPoison = damages(fight, eni.id).filter(e => e.kind === 'poison')
      // Crâ : tours 1 et 2 (le vol de vie du tour 1 ne retire rien), puis soigné par l'Eniripsa au tour 2.
      expect(craPoison.map(e => e.amount)).toEqual([tick, tick])
      // Eniripsa : jamais soignée ⇒ 3 tours de poison.
      expect(eniPoison).toHaveLength(3)
    },
  )
})

describe('modificateurs portés par les autres familles', () => {
  it.skipIf(!hasDispel)('Tirs optiques : seul le coup suivant est doublé (406 sur déclencheur D retire le buff)', () => {
    const harpille = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: CENTER })
    const p = player('Joueur', 8, [], at(CENTER, 0, 2), {}, 9000)
    const { engine, fight } = setup([harpille, p])
    expect(inDiagonal(harpille.cell, p.cell)).toBe(true)
    expect(castSpell(engine, fight, harpille, 5018, p.cell).ok).toBe(true)
    // Coups suivants : Superfidie (en ligne, sans 1163) — le premier est doublé, puis 406 (déclencheur D) retire le buff.
    const hit = (n: number) => {
      harpille.ap = 12
      harpille.castsThisTurn = {}
      harpille.castsOnTarget = {}
      expect(castSpell(engine, fight, harpille, 5019, p.cell).ok).toBe(true)
      return damages(fight, p.id)[n].amount
    }
    harpille.cell = at(p.cell, 1, 3)
    const doubled = hit(1)
    const normal = hit(2)
    expect(doubled).toBe(damageRoll(input(harpille, p, Element.Fire, { sustainedPct: 200 }), 31))
    expect(normal).toBe(damageRoll(input(harpille, p, Element.Fire), 31))
  })

  it('érosion (Pression, Iop : +10 % ⇒ 20 %) lue par Engine.applyDamage', () => {
    const iop = player('Iop', 8, [13106], CENTER, { strength: 500 })
    const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 2) })
    const { engine, fight } = setup([iop, t])
    expect(castSpell(engine, fight, iop, 13106, t.cell).ok).toBe(true)
    expect(engine.erosionPercent(t)).toBe(20)
    const ev = damages(fight, t.id)[0]
    expect(ev.erosion).toBe(Math.floor(ev.amount * 0.2))
    expect(t.maxHp).toBe(t.baseMaxHp - ev.erosion!)
  })

  it('bonus de base du sort (Pugilat, 293 +18 au lancer suivant) et % dommages finaux (1171 → finalDamagePct)', () => {
    const iop = player('Iop', 8, [13146], CENTER, { strength: 400 })
    const t = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 3) })
    const { engine, fight } = setup([iop, t])
    expect(castSpell(engine, fight, iop, 13146, t.cell).ok).toBe(true)
    expect(damages(fight, t.id)[0].amount).toBe(damageRoll(input(iop, t, Element.Earth), 9))
    iop.castsOnTarget = {}
    expect(castSpell(engine, fight, iop, 13146, t.cell).ok).toBe(true)
    expect(damages(fight, t.id)[1].amount).toBe(damageRoll(input(iop, t, Element.Earth), 9 + 18))
    // 1171 : la famille buffs l'agrège dans stats.finalDamagePct (buff de caractéristique), lu par le calcul.
    const e1171 = { ...data.spellLevel(14574, {})!.effects.find(e => e.effectId === 1171)!, clientOnly: false }
    engine.addBuff(fight, iop, { sourceId: iop.id, spellId: 14574, effect: e1171, value: 25, remaining: 1, delay: 0, dispellable: true, kind: 'stat', statDelta: { finalDamagePct: 25 }, label: '+25 % Dommages finaux' })
    expect(iop.stats.finalDamagePct).toBe(25)
    const roll = 9 + 36 // deux buffs 293 actifs (cumul)
    iop.castsOnTarget = {}
    expect(castSpell(engine, fight, iop, 13146, t.cell).ok).toBe(true)
    const third = damages(fight, t.id)[2].amount
    expect([damageRoll(input(iop, t, Element.Earth), roll), damageRoll(input(iop, t, Element.Earth), 27)]).toContain(third)
    expect(third).toBeGreaterThan(damageRoll(input(iop, t, Element.Earth, { attacker: { ...iop.stats, finalDamagePct: 0 } }), 27))
  })

  it.skipIf(!hasCastSpell)('Massacre (Iop) : la cible renvoie 30 % des dommages subis à ses alliés autour (792 → 1223)', () => {
    const iop = player('Iop', 8, [13112, 13110], CENTER, { agility: 600 })
    const a = createMonsterFighter(data, { monsterId: 3838, grade: 1, cell: at(CENTER, 1, 2) })
    const b = createMonsterFighter(data, { monsterId: 3837, grade: 1, cell: at(a.cell, 0, 1) }) // en diagonale : hors croix X3
    const { engine, fight } = setup([iop, a, b])
    expect(castSpell(engine, fight, iop, 13112, a.cell).ok).toBe(true)
    const before = { ...iop.stats } // Épée Divine pose ensuite +30 Dommages sur l'Iop (effet suivant)
    expect(castSpell(engine, fight, iop, 13110, a.cell).ok).toBe(true)
    const [hitA] = damages(fight, a.id)
    expect(hitA.amount).toBe(damageRoll(input(iop, a, Element.Air, { attacker: before, sustainedPct: 115 }), 24))
    const splash = damages(fight, b.id)
    expect(splash).toHaveLength(1)
    expect(splash[0]).toMatchObject({ element: Element.Air, kind: 'indirect' })
    expect(splash[0].amount).toBe(hpBasedDamage({ percent: 30, referenceHp: hitA.amount, defender: b.stats, element: Element.Air, defenderIsPlayer: false }))
  })
})
