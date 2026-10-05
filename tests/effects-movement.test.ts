/**
 * Famille « déplacements » (src/engine/effects/movement.ts) avec des sorts réels : poussées et collisions
 * (Mot de Frayeur, Violence), attirance (Attirance), recul / avance du lanceur (Piston, Pistage), « pousse jusqu'à »
 * (Peur), téléportations (Bond, Fulgurance), échanges (Transposition, Assaut), symétries (Pivot, Cabestan), retours
 * (Gelure, Le Monde), portage (Karcham, Propulsion), portails (Portail de l'Eliotrope via effects/marks.ts).
 * Formule de collision (niveau 200, Poussée 0, Rés. 0) : trunc(force × 132 / (4 × 2^k)).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { applyEffects, castSubSpell } from '../src/engine/effects/core'
import { installMarks } from '../src/engine/effects/marks'
import {
  carryFighter,
  dragFighter,
  installMovement,
  previousCell,
  pushDirection,
  teleportFighter,
} from '../src/engine/effects/movement'
import { move } from '../src/engine/move'
import { Direction } from '../src/map/geometry'
import {
  cellAt,
  data,
  effect,
  events,
  fight,
  giveState,
  monster,
  newEngine,
  player,
  pushDamageTaken,
  spy,
  spyCalls,
} from './effects-movement-helpers'

const SRAM = 4
const XELOR = 5
const ENIRIPSA = 7
const IOP = 8
const SACRIEUR = 11
const PANDAWA = 12
const ZOBAL = 14
const STEAMER = 15
const ELIOTROPE = 16
const OUGINAK = 18

const MOT_DE_FRAYEUR = 13175 // repousse de 1 (P1, a,A), PO 1-7 en ligne
const VIOLENCE = 13137 // repousse de 4 en cercle C2,1 autour du lanceur
const ATTIRANCE = 12735 // attire de 9
const BOND = 13107 // téléportation (4), HS!7
const FULGURANCE = 12724 // 4 en ligne `l1,63` stopAtTarget
const TRANSPOSITION = 12736 // échange (8), HS!7
const ASSAUT = 12733 // échange (8) masque *e7
const PIVOT = 13410 // 1104 (C)
const PISTON = 14308 // 1041 recule de 3
const PISTAGE = 13806 // repousse 2 puis le lanceur avance de 3
const PEUR = 12908 // 783
const GELURE = 13245 // 1100
const KARCHAM = 12787 // 50 / 51
const PROPULSION = 12788 // 51 + effets sur le porté
const PORTAIL = 14574 // 1181

const STATE_PESANTEUR = 7
const STATE_INVULNERABLE = 56
const STATE_INDEPLACABLE = 97
const STATE_INEBRANLABLE = 157
const STATE_PACIFISTE = 218
const STATE_SOBRE = 3531

/** Dommages de collision (niveau 200, Poussée/Rés. poussée 0). */
const col = (force: number, k = 0) => Math.trunc((force * 132) / (4 * 2 ** k))

describe('direction de poussée (port PushUtils.GetPushDirection)', () => {
  it('depuis la case ciblée, ou depuis le lanceur si la cible est sur la case ciblée ; diagonale exacte sinon axe', () => {
    const c = cellAt(14, 0)
    expect(pushDirection(cellAt(10, 0), c, c)).toBe(Direction.SE)
    expect(pushDirection(cellAt(10, 0), c, cellAt(14, 3))).toBe(Direction.NE)
    expect(pushDirection(c, c, cellAt(15, 1))).toBe(Direction.E)
    expect(pushDirection(c, c, cellAt(16, 1))).toBe(Direction.SE)
    expect(pushDirection(c, c, c)).toBe(-1)
  })
})

describe('5 — poussée et collisions', () => {
  const setup = (walls: number[] = [], stats: { pusher?: Record<string, number>; target?: Record<string, number> } = {}) => {
    const engine = newEngine()
    const eni = player({ name: 'Eniripsa', breedId: ENIRIPSA, spellIds: [MOT_DE_FRAYEUR], cell: cellAt(10, 0), stats: stats.pusher })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(12, 0), stats: stats.target })
    const fs = fight(engine, [eni, enemy], { walls })
    return { engine, fs, eni, enemy }
  }

  it('Mot de Frayeur repousse d’une case dans l’axe lanceur → cible, sans dommages', () => {
    const { engine, fs, eni, enemy } = setup()
    spy(engine, fs, enemy, 'P')
    spyCalls.length = 0
    expect(castSpell(engine, fs, eni, MOT_DE_FRAYEUR, enemy.cell).ok).toBe(true)
    expect(enemy.cell).toBe(cellAt(13, 0))
    expect(pushDamageTaken(fs, enemy)).toEqual([])
    expect(events(fs, 'push').at(-1)).toMatchObject({ target: enemy.id, from: cellAt(12, 0), to: cellAt(13, 0) })
    expect(spyCalls).toEqual([{ holder: enemy.id, type: 'P', source: eni.id }])
    expect(enemy.tags.prevCell).toBe(cellAt(12, 0))
  })

  it('collision contre un obstacle : trunc((niv/2 + 32 + Poussée − Rés.) × force / 4)', () => {
    const { engine, fs, eni, enemy } = setup([cellAt(13, 0)])
    const hp = enemy.hp
    castSpell(engine, fs, eni, MOT_DE_FRAYEUR, enemy.cell)
    expect(enemy.cell).toBe(cellAt(12, 0))
    expect(pushDamageTaken(fs, enemy)).toEqual([col(1)]) // 33
    expect(enemy.hp).toBe(hp - 33)
    expect(events(fs, 'push').at(-1)).toMatchObject({ from: cellAt(12, 0), to: cellAt(12, 0), collisionDamage: 33 })
    // Dommages Poussée du lanceur et résistance poussée de la cible : (100 + 32 + 50 − 10) / 4 = 43.
    const b = setup([cellAt(13, 0)], { pusher: { pushDamage: 50 }, target: { pushRes: 10 } })
    castSpell(b.engine, b.fs, b.eni, MOT_DE_FRAYEUR, b.enemy.cell)
    expect(pushDamageTaken(b.fs, b.enemy)).toEqual([43])
  })

  it('collision contre une entité : le percuté subit la moitié (k = 1), avec SES résistances', () => {
    const engine = newEngine()
    const eni = player({ name: 'Eniripsa', breedId: ENIRIPSA, spellIds: [MOT_DE_FRAYEUR], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(12, 0) })
    const behind = player({ name: 'Derrière', breedId: IOP, team: 1, cell: cellAt(13, 0), stats: { pushRes: 4 } })
    const fs = fight(engine, [eni, enemy, behind])
    castSpell(engine, fs, eni, MOT_DE_FRAYEUR, enemy.cell)
    expect(enemy.cell).toBe(cellAt(12, 0))
    expect(pushDamageTaken(fs, enemy)).toEqual([33])
    expect(pushDamageTaken(fs, behind)).toEqual([Math.trunc((1 * (132 - 4)) / 8)]) // 16
    expect(events(fs, 'push').at(-1)).toMatchObject({ target: enemy.id, collisionWith: behind.id })
  })

  it('Violence (zone C2,1) : cibles poussées de la plus éloignée à la plus proche, collision en chaîne', () => {
    const run = (walls: number[]) => {
      const engine = newEngine()
      const iop = player({ name: 'Iop', breedId: IOP, spellIds: [VIOLENCE], cell: cellAt(14, 0) })
      const near = player({ name: 'Proche', breedId: IOP, team: 1, cell: cellAt(15, 0) })
      const far = player({ name: 'Loin', breedId: IOP, team: 0, cell: cellAt(16, 0) })
      const fs = fight(engine, [iop, near, far], { walls })
      expect(castSpell(engine, fs, iop, VIOLENCE, iop.cell).ok).toBe(true)
      return { fs, near, far }
    }
    // L'allié (distance 2) part d'abord : sinon l'ennemi serait bloqué d'emblée.
    const free = run([])
    expect(free.far.cell).toBe(cellAt(20, 0))
    expect(free.near.cell).toBe(cellAt(19, 0))
    expect(pushDamageTaken(free.fs, free.near)).toEqual([])
    // Mur en (19, 0) : l'allié s'arrête en (18, 0) (force 2 ⇒ 66), l'ennemi le percute (force 2 : 66, percuté 33).
    const wall = run([cellAt(19, 0)])
    expect(wall.far.cell).toBe(cellAt(18, 0))
    expect(wall.near.cell).toBe(cellAt(17, 0))
    expect(pushDamageTaken(wall.fs, wall.near)).toEqual([col(2)])
    expect(pushDamageTaken(wall.fs, wall.far)).toEqual([col(2), col(2, 1)])
  })

  it('poussée diagonale : ceil(n/2) cases, cases latérales libres exigées, force restante ×2', () => {
    const run = (walls: number[]) => {
      const engine = newEngine()
      const iop = player({ name: 'Iop', breedId: IOP, spellIds: [VIOLENCE], cell: cellAt(14, 0) })
      const t = player({ name: 'Cible', breedId: IOP, team: 1, cell: cellAt(15, 1) })
      const fs = fight(engine, [iop, t], { walls })
      castSpell(engine, fs, iop, VIOLENCE, iop.cell)
      return { t, dmg: pushDamageTaken(fs, t) }
    }
    const free = run([])
    expect(free.t.cell).toBe(cellAt(17, 3))
    expect(free.dmg).toEqual([])
    // Mur sur la 2e case diagonale : 1 pas fait sur 2 ⇒ force 1 × 2 = 2 ⇒ 66.
    const wall = run([cellAt(17, 3)])
    expect(wall.t.cell).toBe(cellAt(16, 2))
    expect(wall.dmg).toEqual([col(2)])
    // Case latérale bloquée dès le 1er pas : force 2 × 2 = 4 ⇒ 132.
    const side = run([cellAt(16, 1)])
    expect(side.t.cell).toBe(cellAt(15, 1))
    expect(side.dmg).toEqual([col(4)])
  })

  it('immunités : Inébranlable / Indéplaçable / monstre non poussable (boss Père Ver) ; l’invulnérable est poussé sans dommages', () => {
    for (const state of [STATE_INEBRANLABLE, STATE_INDEPLACABLE]) {
      const { engine, fs, eni, enemy } = setup([cellAt(13, 0)])
      giveState(engine, fs, enemy, state)
      castSpell(engine, fs, eni, MOT_DE_FRAYEUR, enemy.cell)
      expect(enemy.cell).toBe(cellAt(12, 0))
      expect(pushDamageTaken(fs, enemy)).toEqual([])
    }
    const engine = newEngine()
    const eni = player({ name: 'Eniripsa', breedId: ENIRIPSA, spellIds: [MOT_DE_FRAYEUR], cell: cellAt(10, 0) })
    const boss = monster(4726, cellAt(12, 0)) // Père Ver : canBePushed = false
    expect(data().monster(4726)?.isBoss).toBe(true)
    const fs = fight(engine, [eni, boss], { walls: [cellAt(13, 0)] })
    castSpell(engine, fs, eni, MOT_DE_FRAYEUR, boss.cell)
    expect(boss.cell).toBe(cellAt(12, 0))
    expect(pushDamageTaken(fs, boss)).toEqual([])
    expect(events(fs, 'push')).toEqual([])

    const inv = setup()
    giveState(inv.engine, inv.fs, inv.enemy, STATE_INVULNERABLE)
    castSpell(inv.engine, inv.fs, inv.eni, MOT_DE_FRAYEUR, inv.enemy.cell)
    expect(inv.enemy.cell).toBe(cellAt(13, 0))
    const blocked = setup([cellAt(13, 0)])
    giveState(blocked.engine, blocked.fs, blocked.enemy, STATE_INVULNERABLE)
    const hp = blocked.enemy.hp
    castSpell(blocked.engine, blocked.fs, blocked.eni, MOT_DE_FRAYEUR, blocked.enemy.cell)
    expect(blocked.enemy.hp).toBe(hp)
  })

  it('lanceur Pacifiste : aucun dommage de collision', () => {
    const { engine, fs, eni, enemy } = setup([cellAt(13, 0)])
    giveState(engine, fs, eni, STATE_PACIFISTE)
    castSpell(engine, fs, eni, MOT_DE_FRAYEUR, enemy.cell)
    expect(pushDamageTaken(fs, enemy)).toEqual([])
  })

  it('un piège arrête la poussée SUR sa case, sans dommages de collision', () => {
    const engine = newEngine()
    const iop = player({ name: 'Iop', breedId: IOP, cell: cellAt(10, 0) })
    const t = player({ name: 'Cible', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const fs = fight(engine, [iop, t])
    fs.traps.push({ uid: 999, sourceId: iop.id, spellId: 0, center: cellAt(13, 0), cells: [cellAt(13, 0)], effects: [], visible: true, color: '#f00' })
    expect(dragFighter(engine, fs, iop, t, 5, Direction.SE, { collision: true })).toBe(true)
    expect(t.cell).toBe(cellAt(13, 0))
    expect(pushDamageTaken(fs, t)).toEqual([])
  })
})

describe('6 / 1041 / 1042 / 783 — attirance, recul et avance du lanceur, « pousse jusqu’à »', () => {
  it('Attirance (Sacrieur) attire jusqu’au contact, sans dommages ; déclencheur MA', () => {
    const engine = newEngine()
    const sacri = player({ name: 'Sacrieur', breedId: SACRIEUR, spellIds: [ATTIRANCE], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(16, 0) })
    const fs = fight(engine, [sacri, enemy])
    spy(engine, fs, enemy, 'MA')
    spyCalls.length = 0
    expect(castSpell(engine, fs, sacri, ATTIRANCE, enemy.cell).ok).toBe(true)
    expect(enemy.cell).toBe(cellAt(11, 0))
    expect(pushDamageTaken(fs, enemy)).toEqual([])
    expect(spyCalls.map(c => c.type)).toEqual(['MA'])
  })

  it('Piston (Steamer, 1041) : le lanceur recule de 3, collision sur lui-même', () => {
    const run = (walls: number[]) => {
      const engine = newEngine()
      const steamer = player({ name: 'Steamer', breedId: STEAMER, spellIds: [PISTON], cell: cellAt(10, 0) })
      const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
      const fs = fight(engine, [steamer, enemy], { walls })
      expect(castSpell(engine, fs, steamer, PISTON, enemy.cell).ok).toBe(true)
      return { steamer, enemy, fs }
    }
    const free = run([])
    expect(free.steamer.cell).toBe(cellAt(7, 0))
    expect(free.enemy.cell).toBe(cellAt(11, 0))
    const wall = run([cellAt(8, 0)])
    expect(wall.steamer.cell).toBe(cellAt(9, 0))
    expect(pushDamageTaken(wall.fs, wall.steamer)).toEqual([col(2)])
  })

  it('Pistage (Ouginak) : repousse la cible de 2 puis le lanceur avance de 3 vers elle (arrêt au contact)', () => {
    const engine = newEngine()
    const ougi = player({ name: 'Ouginak', breedId: OUGINAK, spellIds: [PISTAGE], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const fs = fight(engine, [ougi, enemy])
    expect(castSpell(engine, fs, ougi, PISTAGE, enemy.cell).ok).toBe(true)
    expect(enemy.cell).toBe(cellAt(13, 0))
    expect(ougi.cell).toBe(cellAt(12, 0))
  })

  it('Peur (Sram, 783) : pousse l’entité adjacente jusqu’à la case visée, sans dommages même bloquée', () => {
    const run = (walls: number[]) => {
      const engine = newEngine()
      const sram = player({ name: 'Sram', breedId: SRAM, spellIds: [PEUR], cell: cellAt(10, 0) })
      const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
      const fs = fight(engine, [sram, enemy], { walls })
      expect(castSpell(engine, fs, sram, PEUR, cellAt(15, 0)).ok).toBe(true)
      return { enemy, fs }
    }
    const free = run([])
    expect(free.enemy.cell).toBe(cellAt(15, 0))
    const wall = run([cellAt(14, 0)])
    expect(wall.enemy.cell).toBe(cellAt(13, 0))
    expect(pushDamageTaken(wall.fs, wall.enemy)).toEqual([])
  })
})

describe('4 — téléportation du lanceur', () => {
  it('Bond (Iop) : téléporte sur la case libre ciblée ; événement teleport ; déclencheur TP ; impossible sous Pesanteur', () => {
    const engine = newEngine()
    const iop = player({ name: 'Iop', breedId: IOP, spellIds: [BOND], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(20, 0) })
    const fs = fight(engine, [iop, enemy])
    spy(engine, fs, iop, 'TP')
    spyCalls.length = 0
    const dest = cellAt(12, 2)
    expect(castSpell(engine, fs, iop, BOND, dest).ok).toBe(true)
    expect(iop.cell).toBe(dest)
    expect(events(fs, 'teleport').at(-1)).toEqual({ t: 'teleport', target: iop.id, from: cellAt(10, 0), to: dest })
    expect(spyCalls.map(c => c.type)).toEqual(['TP'])
    expect(iop.tags.prevCell).toBe(cellAt(10, 0))
    giveState(engine, fs, iop, STATE_PESANTEUR)
    iop.castsThisTurn = {}
    expect(castSpell(engine, fs, iop, BOND, cellAt(13, 2)).failure).toBe('state')
  })

  it('Fulgurance (ligne l1,63 stopAtTarget) : case libre la plus proche de la cible', () => {
    const run = (blockers: number[]) => {
      const engine = newEngine()
      const sacri = player({ name: 'Sacrieur', breedId: SACRIEUR, spellIds: [FULGURANCE], cell: cellAt(10, 0) })
      const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(14, 0) })
      const others = blockers.map((c, i) => player({ name: `Obstacle ${i}`, breedId: IOP, team: 1, cell: c }))
      const fs = fight(engine, [sacri, enemy, ...others])
      expect(castSpell(engine, fs, sacri, FULGURANCE, enemy.cell).ok).toBe(true)
      return sacri
    }
    expect(run([]).cell).toBe(cellAt(13, 0))
    expect(run([cellAt(13, 0)]).cell).toBe(cellAt(12, 0))
  })

  it('un lanceur Indéplaçable se téléporte lui-même (Auroraire / Vortex) mais n’est pas déplacé par autrui', () => {
    const engine = newEngine()
    const iop = player({ name: 'Iop', breedId: IOP, spellIds: [BOND], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(20, 0) })
    const fs = fight(engine, [iop, enemy])
    giveState(engine, fs, iop, STATE_INDEPLACABLE)
    castSpell(engine, fs, iop, BOND, cellAt(12, 0))
    expect(iop.cell).toBe(cellAt(12, 0))
    giveState(engine, fs, enemy, STATE_INDEPLACABLE)
    expect(teleportFighter(engine, fs, iop, enemy, 1105, enemy.cell)).toBe(false)
    expect(enemy.cell).toBe(cellAt(20, 0))
  })
})

describe('8 — échanges de place', () => {
  const setup = (spells: number[]) => {
    const engine = newEngine()
    const sacri = player({ name: 'Sacrieur', breedId: SACRIEUR, spellIds: spells, cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const fs = fight(engine, [sacri, enemy])
    return { engine, fs, sacri, enemy }
  }

  it('Transposition : échange lanceur ↔ cible ; déclencheur MS sur les deux ; téléfrag (masque T)', () => {
    const { engine, fs, sacri, enemy } = setup([TRANSPOSITION])
    spy(engine, fs, sacri, 'MS')
    spy(engine, fs, enemy, 'M')
    spyCalls.length = 0
    expect(castSpell(engine, fs, sacri, TRANSPOSITION, enemy.cell).ok).toBe(true)
    expect(sacri.cell).toBe(cellAt(11, 0))
    expect(enemy.cell).toBe(cellAt(10, 0))
    expect(spyCalls.map(c => [c.holder, c.type]).sort()).toEqual([[sacri.id, 'MS'], [enemy.id, 'MS']].sort())
    expect(sacri.tags.telefragged).toBe(true)
    expect(enemy.tags.telefragged).toBe(true)
    expect(events(fs, 'teleport')).toHaveLength(2)
  })

  it('Pesanteur bloque l’échange : sur la cible (règle moteur), sur le lanceur (critère HS!7 / masque *e7)', () => {
    const a = setup([TRANSPOSITION])
    giveState(a.engine, a.fs, a.enemy, STATE_PESANTEUR)
    expect(castSpell(a.engine, a.fs, a.sacri, TRANSPOSITION, a.enemy.cell).ok).toBe(true)
    expect(a.sacri.cell).toBe(cellAt(10, 0))
    expect(a.enemy.cell).toBe(cellAt(11, 0))

    const b = setup([TRANSPOSITION, ASSAUT])
    giveState(b.engine, b.fs, b.sacri, STATE_PESANTEUR)
    expect(castSpell(b.engine, b.fs, b.sacri, TRANSPOSITION, b.enemy.cell).failure).toBe('state')
    expect(castSpell(b.engine, b.fs, b.sacri, ASSAUT, b.enemy.cell).ok).toBe(true)
    expect(b.sacri.cell).toBe(cellAt(10, 0))
  })

  it('monstre canSwitchPos = false (Père Ver) : pas d’échange ; Indéplaçable : pas d’échange', () => {
    const engine = newEngine()
    const sacri = player({ name: 'Sacrieur', breedId: SACRIEUR, spellIds: [TRANSPOSITION], cell: cellAt(10, 0) })
    const boss = monster(4726, cellAt(12, 0))
    const fs = fight(engine, [sacri, boss])
    castSpell(engine, fs, sacri, TRANSPOSITION, boss.cell)
    expect(boss.cell).toBe(cellAt(12, 0))
    const b = setup([TRANSPOSITION])
    giveState(b.engine, b.fs, b.enemy, STATE_INDEPLACABLE)
    castSpell(b.engine, b.fs, b.sacri, TRANSPOSITION, b.enemy.cell)
    expect(b.enemy.cell).toBe(cellAt(11, 0))
  })
})

describe('1104 / 1105 / 1106 — symétries', () => {
  it('Pivot (Zobal, 1104 masque C) : le lanceur passe de l’autre côté de la cible ; case occupée ⇒ téléfrag', () => {
    const engine = newEngine()
    const zobal = player({ name: 'Zobal', breedId: ZOBAL, spellIds: [PIVOT], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const fs = fight(engine, [zobal, enemy])
    expect(castSpell(engine, fs, zobal, PIVOT, enemy.cell).ok).toBe(true)
    expect(zobal.cell).toBe(cellAt(12, 0))

    const e2 = newEngine()
    const z2 = player({ name: 'Zobal', breedId: ZOBAL, spellIds: [PIVOT], cell: cellAt(10, 0) })
    const t2 = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const other = player({ name: 'Occupant', breedId: IOP, team: 1, cell: cellAt(12, 0) })
    const fs2 = fight(e2, [z2, t2, other])
    castSpell(e2, fs2, z2, PIVOT, t2.cell)
    expect(z2.cell).toBe(cellAt(12, 0))
    expect(other.cell).toBe(cellAt(10, 0))
    expect(z2.tags.telefragged).toBe(true)
    expect(other.tags.telefragged).toBe(true)
  })

  it('1105 : la cible passe de l’autre côté du lanceur ; hors carte ⇒ marqueur W, pas de déplacement', () => {
    const engine = newEngine()
    const caster = player({ name: 'Lanceur', breedId: XELOR, cell: cellAt(1, 0) })
    const t = player({ name: 'Cible', breedId: IOP, team: 1, cell: cellAt(3, 0) })
    const fs = fight(engine, [caster, t])
    expect(teleportFighter(engine, fs, caster, t, 1105, t.cell)).toBe(false)
    expect(t.cell).toBe(cellAt(3, 0))
    expect(t.tags.teleportedInvalid).toBe(true)
    caster.cell = cellAt(5, 0)
    expect(teleportFighter(engine, fs, caster, t, 1105, t.cell)).toBe(true)
    expect(t.cell).toBe(cellAt(7, 0))
  })

  it('Cabestan (1106, carré G1) : chaque cible passe de l’autre côté de la case d’impact', () => {
    const engine = newEngine()
    const caster = player({ name: 'Lanceur', breedId: STEAMER, cell: cellAt(8, 0) })
    const a = player({ name: 'A', breedId: IOP, team: 1, cell: cellAt(13, 0) })
    const b = player({ name: 'B', breedId: IOP, team: 1, cell: cellAt(14, 1) })
    const fs = fight(engine, [caster, a, b])
    const lvl = data().spellLevel(29262, {})!
    applyEffects(engine, fs, caster, null, 29262, lvl.effects, cellAt(14, 0), caster.cell, false, false, 0)
    expect(a.cell).toBe(cellAt(15, 0))
    expect(b.cell).toBe(cellAt(14, -1))
  })
})

describe('1100 / 1099 — retours dans le temps', () => {
  it('Gelure (1100) ramène à la position précédente : après une poussée, après une marche', () => {
    const engine = newEngine()
    const xelor = player({ name: 'Xélor', breedId: XELOR, spellIds: [GELURE], cell: cellAt(10, 0), stats: { initiative: 1000 } })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(13, 0) })
    const fs = fight(engine, [xelor, enemy])
    expect(engine.current(fs)).toBe(xelor)
    dragFighter(engine, fs, xelor, enemy, 2, Direction.SE)
    expect(enemy.cell).toBe(cellAt(15, 0))
    expect(previousCell(enemy)).toBe(cellAt(13, 0))
    spy(engine, fs, enemy, 'TP')
    spyCalls.length = 0
    expect(castSpell(engine, fs, xelor, GELURE, enemy.cell).ok).toBe(true)
    expect(enemy.cell).toBe(cellAt(13, 0))
    expect(spyCalls.map(c => c.type)).toEqual(['TP'])

    // Marche de l'ennemi pendant son tour, puis Gelure au tour suivant du Xélor.
    engine.endTurn(fs, xelor)
    expect(engine.nextTurn(fs)).toBe(enemy)
    expect(move(fs, enemy, [cellAt(13, 0), cellAt(14, 0), cellAt(15, 0)], engine)).toBe(2)
    expect(previousCell(enemy)).toBe(cellAt(13, 0))
    engine.endTurn(fs, enemy)
    expect(engine.nextTurn(fs)).toBe(xelor)
    castSpell(engine, fs, xelor, GELURE, enemy.cell)
    expect(enemy.cell).toBe(cellAt(13, 0))
  })

  it('1099 (Le Monde) : retour à la case de début de tour ; téléfrag si occupée', () => {
    const engine = newEngine()
    const eca = player({ name: 'Ecaflip', breedId: 6, cell: cellAt(10, 0), stats: { initiative: 1000 } })
    const ally = player({ name: 'Allié', breedId: IOP, cell: cellAt(20, 0) })
    const fs = fight(engine, [eca, ally])
    expect(eca.tags.turnStartCell).toBe(cellAt(10, 0))
    dragFighter(engine, fs, ally, eca, 3, Direction.SE)
    expect(eca.cell).toBe(cellAt(13, 0))
    const intruder = player({ name: 'Intrus', breedId: IOP, team: 1, cell: cellAt(10, 0) })
    engine.spawn(fs, intruder)
    const lvl = data().spellLevel(30023, { grade: 2 })!
    const e1099 = lvl.effects.filter(e => e.effectId === 1099)
    applyEffects(engine, fs, eca, null, 30023, e1099, eca.cell, eca.cell, false, false, 0)
    expect(eca.cell).toBe(cellAt(10, 0))
    expect(intruder.cell).toBe(cellAt(13, 0))
  })
})

describe('50 / 51 — porter et jeter (Pandawa)', () => {
  const setup = () => {
    const engine = newEngine()
    const panda = player({ name: 'Pandawa', breedId: PANDAWA, spellIds: [KARCHAM, PROPULSION], cell: cellAt(10, 0) })
    const ally = player({ name: 'Allié', breedId: IOP, cell: cellAt(11, 0) })
    const enemy = player({ name: 'Ennemi', breedId: ENIRIPSA, team: 1, spellIds: [MOT_DE_FRAYEUR], cell: cellAt(10, 5) })
    const fs = fight(engine, [panda, ally, enemy])
    giveState(engine, fs, panda, STATE_SOBRE)
    return { engine, fs, panda, ally, enemy }
  }

  it('Karcham porte (états Porteur / Porté, porté hors des cases), Propulsion le jette sur la case ciblée', () => {
    const { engine, fs, panda, ally } = setup()
    expect(castSpell(engine, fs, panda, KARCHAM, ally.cell).ok).toBe(true)
    expect(panda.carrying).toBe(ally.id)
    expect(ally.carriedBy).toBe(panda.id)
    expect(panda.states).toContain(3)
    expect(ally.states).toContain(8)
    expect(ally.cell).toBe(panda.cell)
    expect(engine.fighterAt(fs, cellAt(11, 0))).toBeUndefined()
    expect(engine.fighterAt(fs, panda.cell)).toBe(panda)

    const land = cellAt(13, 0)
    // Un Porteur (état 3 `preventsSpellCast`) peut lancer les sorts dont le critère exige l'état (HS=3 de Propulsion,
    // mechanics.md §4.3 — exception gérée par cast.ts `castPreventedByStates`).
    panda.ap = 20
    expect(castSpell(engine, fs, panda, PROPULSION, land).ok).toBe(true)
    expect(ally.cell).toBe(land)
    expect(panda.cell).toBe(cellAt(10, 0))
    expect(panda.carrying).toBeUndefined()
    expect(ally.carriedBy).toBeUndefined()
    expect(panda.states).not.toContain(3)
    expect(ally.states).not.toContain(8)
    expect(engine.fighterAt(fs, land)).toBe(ally)
  })

  it('le porté suit le porteur téléporté ; un porteur poussé lâche le porté sur sa case de départ', () => {
    const { engine, fs, panda, ally, enemy } = setup()
    castSpell(engine, fs, panda, KARCHAM, ally.cell)
    teleportFighter(engine, fs, panda, panda, 1104, cellAt(10, 1)) // symétrie du lanceur autour de (10, 1)
    expect(panda.cell).toBe(cellAt(10, 2))
    expect(ally.cell).toBe(cellAt(10, 2))
    expect(ally.carriedBy).toBe(panda.id)
    castSpell(engine, fs, enemy, MOT_DE_FRAYEUR, panda.cell)
    expect(panda.cell).toBe(cellAt(10, 1))
    expect(ally.cell).toBe(cellAt(10, 2))
    expect(ally.carriedBy).toBeUndefined()
    expect(panda.states).not.toContain(3)
    expect(ally.states).not.toContain(8)
  })

  it('pas de portage d’un Indéplaçable ; la mort du porteur libère le porté (état Porté retiré)', () => {
    const a = setup()
    giveState(a.engine, a.fs, a.ally, STATE_INDEPLACABLE)
    expect(carryFighter(a.engine, a.fs, a.panda, a.ally, KARCHAM)).toBe(false)
    const b = setup()
    castSpell(b.engine, b.fs, b.panda, KARCHAM, b.ally.cell)
    b.engine.kill(b.fs, b.panda)
    expect(b.ally.carriedBy).toBeUndefined()
    expect(b.ally.states).not.toContain(8)
    expect(b.ally.cell).toBe(cellAt(10, 0))
  })

  it('le porteur ne peut pas échanger sa place', () => {
    const { engine, fs, panda, ally, enemy } = setup()
    castSpell(engine, fs, panda, KARCHAM, ally.cell)
    expect(teleportFighter(engine, fs, enemy, enemy, 8, panda.cell)).toBe(false)
    expect(panda.cell).toBe(cellAt(10, 0))
  })
})

describe('portails (pose par effects/marks.ts, passage lors d’un déplacement forcé)', () => {
  /** Eliotrope en (14, 3) ; portails en (14, 0) et (15, 5) (Portail 14574) ; `pushed` en (13, 0). */
  const setup = (team: 0 | 1) => {
    const engine = newEngine(installMarks)
    const elio = player({ name: 'Eliotrope', breedId: ELIOTROPE, spellIds: [PORTAIL], cell: cellAt(14, 3), stats: { initiative: 1000 } })
    const pushed = player({ name: 'Poussé', breedId: IOP, team, cell: cellAt(13, 0) })
    const foe = player({ name: 'Adversaire', breedId: IOP, team: 1, cell: cellAt(25, -5) })
    const fs = fight(engine, [elio, pushed, foe])
    expect(castSpell(engine, fs, elio, PORTAIL, cellAt(14, 0)).ok).toBe(true)
    expect(castSpell(engine, fs, elio, PORTAIL, cellAt(15, 5)).ok).toBe(true)
    expect(fs.glyphs.filter(g => g.markType === 'portal')).toHaveLength(2)
    return { engine, fs, elio, pushed }
  }

  it('une poussée sur un portail transporte à la sortie et continue avec la force restante ; déclencheur PT', () => {
    const { engine, fs, elio, pushed } = setup(0)
    spy(engine, fs, pushed, 'PT')
    spyCalls.length = 0
    expect(dragFighter(engine, fs, elio, pushed, 3, Direction.SE, { collision: true })).toBe(true)
    expect(pushed.cell).toBe(cellAt(17, 5))
    expect(spyCalls.map(c => c.type)).toEqual(['PT'])
    expect(events(fs, 'teleport').at(-1)).toMatchObject({ target: pushed.id, from: cellAt(14, 0), to: cellAt(15, 5) })
  })

  it('au 1er tour de jeu, un ennemi n’emprunte pas les portails adverses lors d’une poussée (il les traverse)', () => {
    const a = setup(1)
    expect(a.fs.round).toBe(1)
    dragFighter(a.engine, a.fs, a.elio, a.pushed, 1, Direction.SE)
    expect(a.pushed.cell).toBe(cellAt(14, 0))
    const b = setup(1)
    while (b.fs.round < 2) {
      const cur = b.engine.current(b.fs)!
      b.engine.endTurn(b.fs, cur)
      b.engine.nextTurn(b.fs)
    }
    dragFighter(b.engine, b.fs, b.elio, b.pushed, 1, Direction.SE)
    expect(b.pushed.cell).toBe(cellAt(15, 5))
  })
})

describe('historique de position et installation', () => {
  it('startCell posée au premier tour, prevCell / lastCell à chaque déplacement forcé', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: IOP, cell: cellAt(10, 0) })
    const b = player({ name: 'B', breedId: IOP, team: 1, cell: cellAt(12, 0) })
    const fs = fight(engine, [a, b])
    expect(a.tags.startCell).toBe(cellAt(10, 0))
    expect(b.tags.startCell).toBe(cellAt(12, 0))
    dragFighter(engine, fs, a, b, 1, Direction.SE)
    expect(b.tags.prevCell).toBe(cellAt(12, 0))
    expect(b.tags.lastCell).toBe(cellAt(13, 0))
    installMovement(engine) // idempotent
  })

  it('les sorts synthétiques passent par le registre (1103 sans dommages)', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: IOP, cell: cellAt(10, 0) })
    const b = player({ name: 'B', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const fs = fight(engine, [a, b], { walls: [cellAt(13, 0)] })
    applyEffects(engine, fs, a, null, 0, [effect(1103, { diceNum: 4 })], b.cell, a.cell, false, false, 0)
    expect(b.cell).toBe(cellAt(12, 0))
    expect(pushDamageTaken(fs, b)).toEqual([])
  })
})
