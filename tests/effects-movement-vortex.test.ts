/**
 * Famille « déplacements » avec toutes les familles chargées (buffs, castspell, damage, marks, summons, misc) sur la
 * vraie salle du Vortex (carte 143393281) : sorts du Brabuzar (Mise en situation : attire les alliés de la cible puis
 * la repousse de 4 avec +200 Dommages Poussée ; Neutralisation : symétrie autour du Brabuzar), Morfaille du Vortex
 * (retour à la position précédente) et *Action !* (retour à la case de début de combat, Vortex Indéplaçable compris).
 *
 * Arène (repère logique) : rangée y = −8 marchable de x = 12 à 28 (bord en x = 11) ; pilier en (18..20, −5).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import '../src/engine/effects/buffs'
import '../src/engine/effects/castspell'
import { castSubSpell } from '../src/engine/effects/core'
import { installDamageHooks } from '../src/engine/effects/damage'
import { installMarks } from '../src/engine/effects/marks'
import '../src/engine/effects/misc'
import { dragFighter } from '../src/engine/effects/movement'
import { getEffectHandler } from '../src/engine/effects/registry'
import '../src/engine/effects/summons'
import type { Engine } from '../src/engine/engine'
import { move } from '../src/engine/move'
import type { Fighter, FightState } from '../src/engine/types'
import { Direction } from '../src/map/geometry'
import { cellAt, data, events, fight, giveState, monster, newEngine, player, pushDamageTaken } from './effects-movement-helpers'

const VORTEX_MAP_ID = 143393281
const BRABUZAR = 3839
const VORTEX = 3835
const IOP = 8
const MISE_EN_SITUATION = 5030
const NEUTRALISATION = 5033
const MORFAILLE = 5070
const ACTION = 5060
const STATE_INDEPLACABLE = 97
const AURORAIRE = 3833
const DECALAGE_HORAIRE = 4996
const STATE_ONZIEME_HEURE = 231
/** Case de l'heure XII dans les effets 1023 / 4 « *E231 » de Décalage horaire (zone `;`). */
const CLOCK_XII = 212

const map = () => data().map(VORTEX_MAP_ID)!

function engineAll(): Engine {
  return newEngine(e => {
    installDamageHooks(e)
    installMarks(e)
  })
}

function walkable(cells: number[]): void {
  const m = map()
  for (const c of cells) expect(m.cells[c].walkable, `case ${c} marchable`).toBe(true)
}

function arena(fighters: Fighter[]): { engine: Engine; fs: FightState } {
  walkable(fighters.map(f => f.cell))
  const engine = engineAll()
  const fs = fight(engine, fighters, { map: map() })
  for (const f of fighters) f.ap = 30
  return { engine, fs }
}

describe('Brabuzar — Mise en situation (5030)', () => {
  const hasSubSpell = getEffectHandler(792) !== undefined
  const hasPushBoost = getEffectHandler(414) !== undefined

  it.skipIf(!hasSubSpell || !hasPushBoost)('la cible attire ses alliés (*3, attire de 3), puis est repoussée de 4 : collision avec +200 Dommages Poussée', () => {
    const brab = monster(BRABUZAR, cellAt(15, -8))
    const target = player({ name: 'Cible', breedId: IOP, cell: cellAt(17, -8) })
    const mate = player({ name: 'Allié', breedId: IOP, cell: cellAt(20, -8) })
    const { engine, fs } = arena([brab, target, mate])
    expect(brab.level).toBe(200)
    expect(castSpell(engine, fs, brab, MISE_EN_SITUATION, target.cell).ok).toBe(true)
    // 792 : la cible lance 5029 (attire de 3 ses alliés en étoile) : l'allié s'arrête au contact.
    expect(mate.cell).toBe(cellAt(18, -8))
    // 414 : +200 Dommages Poussée (2 tours) ; 5 : poussée de 4 bloquée d'emblée par l'allié (force 4).
    expect(brab.stats.pushDamage).toBe(200)
    expect(target.cell).toBe(cellAt(17, -8))
    const hit = Math.trunc((4 * (100 + 32 + 200)) / 4) // 332
    expect(pushDamageTaken(fs, target)).toEqual([hit])
    expect(pushDamageTaken(fs, mate)).toEqual([Math.trunc((4 * (100 + 32 + 200)) / 8)]) // 166
    expect(events(fs, 'push').at(-1)).toMatchObject({ target: target.id, collisionWith: mate.id, collisionDamage: hit })
  })

  it.skipIf(!hasPushBoost)('poussée contre le pilier de la salle : force restante 3 ⇒ 249', () => {
    const brab = monster(BRABUZAR, cellAt(14, -5))
    const target = player({ name: 'Cible', breedId: IOP, cell: cellAt(16, -5) })
    const { engine, fs } = arena([brab, target])
    expect(map().cells[cellAt(18, -5)].walkable).toBe(false)
    expect(castSpell(engine, fs, brab, MISE_EN_SITUATION, target.cell).ok).toBe(true)
    expect(target.cell).toBe(cellAt(17, -5))
    expect(pushDamageTaken(fs, target)).toEqual([Math.trunc((3 * 332) / 4)])
  })
})

describe('Brabuzar — Neutralisation (5033, symétrie 1105)', () => {
  it('téléporte la cible symétriquement par rapport au Brabuzar', () => {
    const brab = monster(BRABUZAR, cellAt(15, -8))
    const target = player({ name: 'Cible', breedId: IOP, cell: cellAt(17, -8) })
    const { engine, fs } = arena([brab, target])
    expect(castSpell(engine, fs, brab, NEUTRALISATION, target.cell).ok).toBe(true)
    expect(target.cell).toBe(cellAt(13, -8))
    expect(events(fs, 'teleport').at(-1)).toMatchObject({ target: target.id, from: cellAt(17, -8), to: cellAt(13, -8) })
  })

  it('case symétrique non marchable (bord de l’arène) : pas de déplacement, marqueur W', () => {
    const brab = monster(BRABUZAR, cellAt(13, -8))
    const target = player({ name: 'Cible', breedId: IOP, cell: cellAt(15, -8) })
    const { engine, fs } = arena([brab, target])
    expect(map().cells[cellAt(11, -8)].walkable).toBe(false)
    expect(castSpell(engine, fs, brab, NEUTRALISATION, target.cell).ok).toBe(true)
    expect(target.cell).toBe(cellAt(15, -8))
    expect(target.tags.teleportedInvalid).toBe(true)
  })
})

describe('Vortex — Morfaille (5070, retour à la position précédente)', () => {
  it('annule la dernière marche de la cible, puis une poussée', () => {
    const vortex = monster(VORTEX, cellAt(14, -8))
    const target = player({ name: 'Cible', breedId: IOP, cell: cellAt(16, -8) })
    const { engine, fs } = arena([vortex, target])
    expect(vortex.spells.some(s => s.spellId === MORFAILLE)).toBe(true)
    expect(move(fs, target, [cellAt(16, -8), cellAt(17, -8)], engine)).toBe(1)
    expect(castSpell(engine, fs, vortex, MORFAILLE, target.cell).ok).toBe(true)
    expect(target.cell).toBe(cellAt(16, -8))
    // Poussée puis Morfaille au tour suivant (1/cible/tour).
    dragFighter(engine, fs, vortex, target, 2, Direction.NE)
    expect(target.cell).toBe(cellAt(16, -6))
    vortex.castsOnTarget = {}
    vortex.castsThisTurn = {}
    expect(castSpell(engine, fs, vortex, MORFAILLE, target.cell).ok).toBe(true)
    expect(target.cell).toBe(cellAt(16, -8))
  })
})

describe('Vortex — Action ! (5060, 784 : retour aux cases de début de combat)', () => {
  it('le Vortex (Indéplaçable) et les personnages reviennent à leur case de départ', () => {
    const vortex = monster(VORTEX, cellAt(14, -8))
    const a = player({ name: 'A', breedId: IOP, cell: cellAt(16, -8) })
    const b = player({ name: 'B', breedId: IOP, cell: cellAt(18, -10) })
    const { engine, fs } = arena([vortex, a, b])
    move(fs, a, [cellAt(16, -8), cellAt(17, -8), cellAt(18, -8)], engine)
    dragFighter(engine, fs, a, b, 2, Direction.SE)
    dragFighter(engine, fs, a, vortex, 2, Direction.SW)
    expect([vortex.cell, a.cell, b.cell]).toEqual([cellAt(14, -10), cellAt(18, -8), cellAt(20, -10)])
    giveState(engine, fs, vortex, STATE_INDEPLACABLE)
    expect(castSubSpell(engine, fs, vortex, ACTION, 1, vortex.cell, false, 0)).toBe(true)
    expect([vortex.cell, a.cell, b.cell]).toEqual([cellAt(14, -8), cellAt(16, -8), cellAt(18, -10)])
  })
})

describe('Auroraire — Décalage horaire (4996 : 1023 échange forcé, sinon 4 téléportation)', () => {
  // Les cases d'heure des données (212, 173...) ne sont pas marchables sur la carte 143393281 (dont les annotations
  // `clockPositions` diffèrent) : mécanique vérifiée sur la carte ouverte.
  const setup = (occupied: boolean) => {
    const engine = engineAll()
    const aur = monster(AURORAIRE, cellAt(12, -6))
    const p = player({ name: 'Joueur', breedId: IOP, cell: cellAt(16, -8) })
    const blocker = monster(BRABUZAR, occupied ? CLOCK_XII : cellAt(20, -8))
    const fs = fight(engine, [aur, p, blocker])
    giveState(engine, fs, aur, STATE_INDEPLACABLE)
    giveState(engine, fs, aur, STATE_ONZIEME_HEURE)
    return { engine, fs, aur, p, blocker }
  }

  it('case de l’heure libre : l’Auroraire (Indéplaçable) s’y téléporte (4)', () => {
    const { engine, fs, aur, p } = setup(false)
    expect(castSubSpell(engine, fs, aur, DECALAGE_HORAIRE, 1, p.cell, false, 0)).toBe(true)
    expect(aur.cell).toBe(CLOCK_XII)
    expect(p.cell).toBe(cellAt(16, -8))
  })

  it('case de l’heure occupée : échange forcé avec son occupant (1023), pas avec la cible du sort', () => {
    const { engine, fs, aur, p, blocker } = setup(true)
    const from = aur.cell
    expect(castSubSpell(engine, fs, aur, DECALAGE_HORAIRE, 1, p.cell, false, 0)).toBe(true)
    expect(aur.cell).toBe(CLOCK_XII)
    expect(blocker.cell).toBe(from)
    expect(p.cell).toBe(cellAt(16, -8))
  })
})
