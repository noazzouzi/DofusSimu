/**
 * Famille « déplacements » — relecture contradictoire : régressions et cas non couverts, avec toutes les familles
 * chargées (buffs, castspell, damage, marks, summons, misc) et des sorts réels.
 *
 *  - effets `forClientOnly` ignorés (Comète 13726 : 1041 / 4 « info-bulle », vrai déplacement dans le sous-sort 32706 ;
 *    Rembobinage 13243 : 1099 « info-bulle ») ;
 *  - effet 4 : conditions de cible du masque évaluées sur le lanceur (sous-sort 32706 « a,A,*e7,e7027 ») ; masque « A »
 *    de monstre sur case libre (Foutaise 667) ;
 *  - marqueurs T / W : effacés au premier déplacement d'un nouveau lancer, même dans un sous-sort ;
 *  - ordre des marques d'un échange (déplacé puis partenaire, port `Teleport.TeleportFighter`) ;
 *  - lâcher d'un porté (porteur poussé après une marche) : événement de replay ;
 *  - 1101 (Renaissance 31185 du Sulfénix), 1021 / 1022 forcés, 1043, 2184, mode de jet « average ».
 * Formule de collision (niveau 200, Poussée 0, Rés. 0) : trunc(force × 132 / (4 × 2^k)).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import '../src/engine/effects/buffs'
import '../src/engine/effects/castspell'
import { applyEffects, castSubSpell } from '../src/engine/effects/core'
import { installDamageHooks } from '../src/engine/effects/damage'
import { installMarks } from '../src/engine/effects/marks'
import '../src/engine/effects/misc'
import { carryFighter, dragFighter, teleportFighter } from '../src/engine/effects/movement'
import { registerEffect } from '../src/engine/effects/registry'
import '../src/engine/effects/summons'
import type { Engine } from '../src/engine/engine'
import { move } from '../src/engine/move'
import { Direction } from '../src/map/geometry'
import { cellAt, data, effect, events, fight, giveState, newEngine, player, pushDamageTaken } from './effects-movement-helpers'

const XELOR = 5
const IOP = 8
const ENIRIPSA = 7
const SACRIEUR = 11
const PANDAWA = 12
const HUPPERMAGE = 17

const COMETE = 13726 // 1160 → 32706 : recul de 3 au contact (1041 « *E7027 »), sinon téléportation au contact (4 ligne)
const COMETE_SUB = 32706
const REMBOBINAGE = 13243 // 1099 « info-bulle » (forClientOnly)
const TRANSPOSITION = 12736 // échange (8)
const FOUTAISE = 667 // sort de monstre : 4 « A » sur case libre
const RENAISSANCE = 31185 // Sulfénix : 1101 « a,A,e7 »
const MOT_DE_FRAYEUR = 13175 // repousse de 1
const KARCHAM = 12787
const STATE_SOBRE = 3531
const STATE_AU_CONTACT = 7027 // état technique de Comète (posé en zone Q1 autour de la cible)
const STATE_INDEPLACABLE = 97
const STATE_INEBRANLABLE = 157

const col = (force: number, k = 0) => Math.trunc((force * 132) / (4 * 2 ** k))

function engineAll(): Engine {
  return newEngine(e => {
    installDamageHooks(e)
    installMarks(e)
  })
}

describe('effets « info-bulle » (forClientOnly) ignorés', () => {
  it('Comète au contact : seul le recul de 3 du sous-sort (pas de 1041 / 4 « info-bulle » en plus)', () => {
    const lvl = data().spellLevel(COMETE, { playerLevel: 200 })!
    expect(lvl.effects.filter(e => e.clientOnly).map(e => e.effectId)).toEqual(expect.arrayContaining([1041, 4]))
    const engine = engineAll()
    const hupper = player({ name: 'Huppermage', breedId: HUPPERMAGE, spellIds: [COMETE], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const fs = fight(engine, [hupper, enemy])
    expect(castSpell(engine, fs, hupper, COMETE, enemy.cell).ok).toBe(true)
    expect(hupper.cell).toBe(cellAt(7, 0))
    expect(events(fs, 'push').filter(e => e.target === hupper.id)).toHaveLength(1)
    expect(events(fs, 'teleport').filter(e => e.target === hupper.id)).toEqual([])
    expect(pushDamageTaken(fs, hupper)).toEqual([])
  })

  it('Comète à distance : téléportation au contact de la cible, sans recul', () => {
    const engine = engineAll()
    const hupper = player({ name: 'Huppermage', breedId: HUPPERMAGE, spellIds: [COMETE], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(15, 0) })
    const fs = fight(engine, [hupper, enemy])
    expect(castSpell(engine, fs, hupper, COMETE, enemy.cell).ok).toBe(true)
    expect(hupper.cell).toBe(cellAt(14, 0))
    expect(events(fs, 'push').filter(e => e.target === hupper.id)).toEqual([])
    expect(events(fs, 'teleport').filter(e => e.target === hupper.id)).toEqual([{ t: 'teleport', target: hupper.id, from: cellAt(10, 0), to: cellAt(14, 0) }])
  })

  it('Rembobinage : le 1099 « info-bulle » ne déplace pas (la version non « info-bulle » du même effet, si)', () => {
    const engine = newEngine()
    const xelor = player({ name: 'Xélor', breedId: XELOR, cell: cellAt(10, 0), stats: { initiative: 9999 } })
    const ally = player({ name: 'Allié', breedId: IOP, cell: cellAt(12, 0) })
    const fs = fight(engine, [xelor, ally])
    dragFighter(engine, fs, xelor, ally, 2, Direction.SE)
    expect(ally.cell).toBe(cellAt(14, 0))
    const e1099 = data().spellLevel(REMBOBINAGE, { playerLevel: 200 })!.effects.find(e => e.effectId === 1099 && e.triggers === 'I')!
    expect(e1099.clientOnly).toBe(true)
    applyEffects(engine, fs, xelor, null, REMBOBINAGE, [e1099], ally.cell, xelor.cell, false, false, 0)
    expect(ally.cell).toBe(cellAt(14, 0))
    // Sans le drapeau : retour à la case de début de combat (= début de tour, l'allié n'a pas encore joué).
    ally.tags.turnStartCell = cellAt(12, 0)
    applyEffects(engine, fs, xelor, null, REMBOBINAGE, [{ ...e1099, clientOnly: false }], ally.cell, xelor.cell, false, false, 0)
    expect(ally.cell).toBe(cellAt(12, 0))
  })
})

describe('4 — conditions du masque évaluées sur le lanceur', () => {
  it('sous-sort 32706 de Comète : état 7027 ⇒ recul (1041) sans téléportation ; sans l’état ⇒ téléportation seule', () => {
    const run = (melee: boolean) => {
      const engine = newEngine()
      const hupper = player({ name: 'Huppermage', breedId: HUPPERMAGE, cell: cellAt(10, 0) })
      const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(15, 0) })
      const fs = fight(engine, [hupper, enemy])
      if (melee) giveState(engine, fs, hupper, STATE_AU_CONTACT)
      expect(castSubSpell(engine, fs, hupper, COMETE_SUB, 2, enemy.cell, false, 0)).toBe(true)
      return hupper.cell
    }
    // Avec 7027 (« au contact ») : 1041 recule de 3 à l'opposé de la cible ; le 4 « e7027 » ne s'applique pas.
    expect(run(true)).toBe(cellAt(7, 0))
    // Sans 7027 : pas de recul (1041 « *E7027 »), téléportation au contact (ligne l stopAtTarget).
    expect(run(false)).toBe(cellAt(14, 0))
  })

  it('Foutaise (sort de monstre, 4 masque « A ») : le lanceur se téléporte sur la case libre ciblée', () => {
    const engine = newEngine()
    const caster = player({ name: 'Lanceur', breedId: IOP, cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(20, 0) })
    const fs = fight(engine, [caster, enemy])
    expect(castSubSpell(engine, fs, caster, FOUTAISE, 1, cellAt(12, 1), false, 0)).toBe(true)
    expect(caster.cell).toBe(cellAt(12, 1))
  })
})

describe('marqueurs T / W : durée d’un lancer', () => {
  it('Transposition marque T les deux échangés ; le lancer suivant (Comète, téléportation dans un sous-sort) les efface', () => {
    const engine = engineAll()
    const sacri = player({ name: 'Sacrieur', breedId: SACRIEUR, spellIds: [TRANSPOSITION, COMETE], cell: cellAt(10, 0), stats: { initiative: 9999 } })
    const e1 = player({ name: 'Ennemi 1', breedId: IOP, team: 1, cell: cellAt(11, 0) })
    const e2 = player({ name: 'Ennemi 2', breedId: IOP, team: 1, cell: cellAt(17, 0) })
    const fs = fight(engine, [sacri, e1, e2])
    expect(engine.current(fs)).toBe(sacri)
    expect(castSpell(engine, fs, sacri, TRANSPOSITION, e1.cell).ok).toBe(true)
    expect([sacri.cell, e1.cell]).toEqual([cellAt(11, 0), cellAt(10, 0)])
    expect(sacri.tags.telefragged).toBe(true)
    expect(e1.tags.telefragged).toBe(true)
    expect(castSpell(engine, fs, sacri, COMETE, e2.cell).ok).toBe(true)
    expect(sacri.cell).toBe(cellAt(16, 0))
    expect(sacri.tags.telefragged).toBe(false)
    expect(e1.tags.telefragged).toBe(false)
  })
})

describe('échange (téléfrag) : ordre des marques', () => {
  const REC = 990_101
  const order: number[] = []
  registerEffect(REC, 'test', ctx => {
    for (const t of ctx.targets) order.push(t.id)
  })

  it('1100 avec téléfrag : pièges de la case du déplacé, puis de celle du partenaire (port TeleportFighter)', () => {
    const engine = newEngine(installMarks)
    const xelor = player({ name: 'Xélor', breedId: XELOR, cell: cellAt(5, 0), stats: { initiative: 9999 } })
    const moved = player({ name: 'Déplacé', breedId: IOP, team: 1, cell: cellAt(10, 0) })
    const partner = player({ name: 'Partenaire', breedId: IOP, team: 1, cell: cellAt(20, 3) })
    const fs = fight(engine, [xelor, moved, partner])
    dragFighter(engine, fs, xelor, moved, 2, Direction.SE)
    expect(moved.cell).toBe(cellAt(12, 0))
    partner.cell = cellAt(10, 0) // occupe la position précédente du déplacé
    const trap = (uid: number, cell: number) => ({
      uid,
      sourceId: xelor.id,
      spellId: 0,
      center: cell,
      cells: [cell],
      effects: [effect(REC)],
      visible: true,
      color: '#f00',
      team: xelor.team,
    })
    fs.traps.push(trap(901, cellAt(10, 0)), trap(902, cellAt(12, 0)))
    order.length = 0
    expect(teleportFighter(engine, fs, xelor, moved, 1100, moved.cell)).toBe(true)
    expect([moved.cell, partner.cell]).toEqual([cellAt(10, 0), cellAt(12, 0)])
    expect(order).toEqual([moved.id, partner.id])
  })
})

describe('porter : lâcher du porté', () => {
  it('porteur qui a marché puis est poussé : le porté est posé sur la case de départ de la poussée (événement de replay)', () => {
    const engine = engineAll()
    const panda = player({ name: 'Pandawa', breedId: PANDAWA, spellIds: [KARCHAM], cell: cellAt(10, 0), stats: { initiative: 9999 } })
    const ally = player({ name: 'Allié', breedId: IOP, cell: cellAt(11, 0) })
    const enemy = player({ name: 'Ennemi', breedId: ENIRIPSA, team: 1, spellIds: [MOT_DE_FRAYEUR], cell: cellAt(10, 5) })
    const fs = fight(engine, [panda, ally, enemy])
    giveState(engine, fs, panda, STATE_SOBRE)
    expect(castSpell(engine, fs, panda, KARCHAM, ally.cell).ok).toBe(true)
    expect(panda.carrying).toBe(ally.id)
    expect(move(fs, panda, [cellAt(10, 0), cellAt(10, 1), cellAt(10, 2)], engine)).toBe(2)
    expect(castSpell(engine, fs, enemy, MOT_DE_FRAYEUR, panda.cell).ok).toBe(true)
    expect(panda.cell).toBe(cellAt(10, 1))
    expect(ally.carriedBy).toBeUndefined()
    expect(ally.cell).toBe(cellAt(10, 2))
    expect(events(fs, 'teleport').filter(e => e.target === ally.id).at(-1)).toMatchObject({ to: cellAt(10, 2) })
    expect(engine.fighterAt(fs, cellAt(10, 2))).toBe(ally)
  })

  it('un porté ne peut pas être poussé ni porté par un autre ; Inébranlable n’empêche pas le portage', () => {
    const engine = engineAll()
    const panda = player({ name: 'Pandawa', breedId: PANDAWA, cell: cellAt(10, 0) })
    const ally = player({ name: 'Allié', breedId: IOP, cell: cellAt(11, 0) })
    const other = player({ name: 'Autre', breedId: PANDAWA, cell: cellAt(9, 0) })
    const fs = fight(engine, [panda, ally, other, player({ name: 'E', breedId: IOP, team: 1, cell: cellAt(20, 0) })])
    giveState(engine, fs, ally, STATE_INEBRANLABLE)
    expect(carryFighter(engine, fs, panda, ally, KARCHAM)).toBe(true)
    expect(dragFighter(engine, fs, other, ally, 2, Direction.SE)).toBe(false)
    expect(carryFighter(engine, fs, other, ally, KARCHAM)).toBe(false)
    expect(ally.carriedBy).toBe(panda.id)
  })
})

describe('1101 — la cible prend la place du lanceur', () => {
  it('Renaissance (Sulfénix, 31185) : échange cible ↔ lanceur, téléfrag des deux ; Pesanteur sur la cible (masque e7) l’empêche', () => {
    const run = (pesanteur: boolean) => {
      const engine = engineAll()
      const caster = player({ name: 'Lanceur', breedId: IOP, cell: cellAt(10, 0) })
      const ally = player({ name: 'Allié', breedId: IOP, cell: cellAt(14, 2) })
      const fs = fight(engine, [caster, ally, player({ name: 'E', breedId: IOP, team: 1, cell: cellAt(20, 0) })])
      if (pesanteur) giveState(engine, fs, ally, 7)
      expect(castSubSpell(engine, fs, caster, RENAISSANCE, 2, ally.cell, false, 0)).toBe(true)
      return { caster, ally }
    }
    const a = run(false)
    expect([a.caster.cell, a.ally.cell]).toEqual([cellAt(14, 2), cellAt(10, 0)])
    expect(a.ally.tags.telefragged).toBe(true)
    const b = run(true)
    expect([b.caster.cell, b.ally.cell]).toEqual([cellAt(10, 0), cellAt(14, 2)])
  })
})

describe('1021 / 1022 forcés, 1043, 2184', () => {
  it('1021 : poussée forcée malgré Inébranlable / Indéplaçable, sans dommages de collision', () => {
    for (const state of [STATE_INEBRANLABLE, STATE_INDEPLACABLE]) {
      const engine = newEngine()
      const a = player({ name: 'A', breedId: IOP, cell: cellAt(10, 0) })
      const b = player({ name: 'B', breedId: IOP, team: 1, cell: cellAt(11, 0) })
      const fs = fight(engine, [a, b], { walls: [cellAt(14, 0)] })
      giveState(engine, fs, b, state)
      applyEffects(engine, fs, a, null, 0, [effect(1021, { diceNum: 5 })], b.cell, a.cell, false, false, 0)
      expect(b.cell).toBe(cellAt(13, 0))
      expect(pushDamageTaken(fs, b)).toEqual([])
      // 5 (non forcé) : bloqué par l'état.
      applyEffects(engine, fs, a, null, 0, [effect(5, { diceNum: 1 })], b.cell, a.cell, false, false, 0)
      expect(b.cell).toBe(cellAt(13, 0))
    }
  })

  it('1022 : attirance forcée d’un Indéplaçable ; 6 ne l’attire pas', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: IOP, cell: cellAt(10, 0) })
    const b = player({ name: 'B', breedId: IOP, team: 1, cell: cellAt(15, 0) })
    const fs = fight(engine, [a, b])
    giveState(engine, fs, b, STATE_INDEPLACABLE)
    applyEffects(engine, fs, a, null, 0, [effect(6, { diceNum: 2 })], b.cell, a.cell, false, false, 0)
    expect(b.cell).toBe(cellAt(15, 0))
    applyEffects(engine, fs, a, null, 0, [effect(1022, { diceNum: 2 })], b.cell, a.cell, false, false, 0)
    expect(b.cell).toBe(cellAt(13, 0))
  })

  it('1043 : la 1re entité de la ligne est attirée jusqu’à la case ciblée', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: IOP, cell: cellAt(10, 0) })
    const b = player({ name: 'B', breedId: IOP, team: 1, cell: cellAt(16, 0) })
    const c = player({ name: 'C', breedId: IOP, team: 1, cell: cellAt(18, 0) })
    const fs = fight(engine, [a, b, c])
    applyEffects(engine, fs, a, null, 0, [effect(1043)], cellAt(12, 0), a.cell, false, false, 0)
    expect(b.cell).toBe(cellAt(12, 0))
    expect(c.cell).toBe(cellAt(18, 0))
  })

  it('2184 : la cible rejoint la case libre adjacente au lanceur la plus proche d’elle', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: IOP, cell: cellAt(10, 0) })
    const b = player({ name: 'B', breedId: IOP, cell: cellAt(14, 1) })
    const fs = fight(engine, [a, b, player({ name: 'E', breedId: IOP, team: 1, cell: cellAt(20, 0) })])
    applyEffects(engine, fs, a, null, 0, [effect(2184)], b.cell, a.cell, false, false, 0)
    expect(b.cell).toBe(cellAt(11, 0))
  })
})

describe('mode de jet « average » (évaluation de l’IA)', () => {
  it('les dommages de collision sont exacts (aucun aléa) : Mot de Frayeur contre un mur', () => {
    const engine = newEngine()
    const eni = player({ name: 'Eniripsa', breedId: ENIRIPSA, spellIds: [MOT_DE_FRAYEUR], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: IOP, team: 1, cell: cellAt(12, 0) })
    const fs = fight(engine, [eni, enemy], { walls: [cellAt(13, 0)], options: { rollMode: 'average' } })
    expect(castSpell(engine, fs, eni, MOT_DE_FRAYEUR, enemy.cell).ok).toBe(true)
    expect(pushDamageTaken(fs, enemy)).toEqual([col(1)])
  })
})
