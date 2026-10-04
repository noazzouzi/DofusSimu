/**
 * Relecture adverse de la famille « marques » (src/engine/effects/marks.ts), avec des sorts réels :
 *  - glyphe-aura dont le sort vise la case principale (P1) : le combattant qui entre est ciblé où qu'il soit dans
 *    l'aura (port `ExecuteMarkSpell` : `additionalTarget`) — Cirque Enflammé 14195 (anneau C2,2 → 14196 P1 Feu) ;
 *  - une invocation qui apparaît sur un piège le déclenche (port `HandleSummon` → `ExecuteMarks(fromDrag)`) ;
 *  - portail emprunté à la marche : la sortie ignore les portails occupés (port `RedefinePortals`) ;
 *  - fin de tour : déclencheurs TE puis glyphes de fin de tour (mechanics.md §9.2).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { applyEffects, castSubSpell } from '../src/engine/effects/core'
import { registerEffect } from '../src/engine/effects/registry'
import { move } from '../src/engine/move'
import type { FightEvent } from '../src/engine/types'
import { cellAt, effect, fight, has, monster, newEngine, player, turnOf, zone } from './effects-summons-helpers'

const OSAMODAS = 2
const SRAM = 4
const ELIOTROPE = 16

const damagesOn = (evs: FightEvent[], target: number) => evs.filter((e): e is Extract<FightEvent, { t: 'damage' }> => e.t === 'damage' && e.target === target)

describe('1091 — aura dont le sort vise la case principale (Cirque Enflammé 14195)', () => {
  it("l'ennemi qui entre dans l'anneau subit le sort de l'aura (cible additionnelle), une seule fois", () => {
    if (!has(99)) return
    const engine = newEngine()
    const caster = monster(3834, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const p = player({ name: 'P', breedId: 8, spellIds: [], cell: cellAt(10, 4), hp: 5000, stats: { initiative: 10 } })
    const fs = fight(engine, [caster, p], { rollMode: 'average' })
    turnOf(engine, fs, caster)
    const center = cellAt(10, 1)
    expect(castSubSpell(engine, fs, caster, 14195, 1, center, false, 0)).toBe(true)
    const aura = fs.glyphs.find(g => g.trigger === 'aura')!
    expect(aura).toBeDefined()
    expect(aura.cells).not.toContain(center)
    expect(aura.cells).toContain(cellAt(10, 3))
    const n = fs.events.length
    p.mp = 3
    move(fs, p, [cellAt(10, 4), cellAt(10, 3)], engine)
    const d = damagesOn(fs.events.slice(n), p.id)
    expect(d).toHaveLength(1)
    expect(d[0].element).toBe(2)
    expect(d[0].kind).toBe('glyph')
    expect(aura.triggered).toContain(p.id)
    // Toujours dans l'aura (case voisine de l'anneau) : pas de seconde application.
    move(fs, p, [cellAt(10, 3), cellAt(11, 3)], engine)
    if (aura.cells.includes(cellAt(11, 3))) expect(damagesOn(fs.events.slice(n), p.id)).toHaveLength(1)
  })
})

describe('400 — une invocation qui apparaît sur un piège le déclenche', () => {
  it("le Tofu invoqué sur la case d'un piège allié (Piège Sournois) le déclenche", () => {
    const engine = newEngine()
    const sram = player({ name: 'Sram', breedId: SRAM, spellIds: [12906], cell: cellAt(10, 0), stats: { intelligence: 600, initiative: 9000 } })
    const osa = player({ name: 'Osa', breedId: OSAMODAS, spellIds: [31115], cell: cellAt(10, 2), stats: { summons: 1, initiative: 8000 } })
    const enemy = monster(3834, cellAt(18, 0), { grade: 1 })
    const fs = fight(engine, [sram, osa, enemy])
    turnOf(engine, fs, sram)
    const trapCell = cellAt(12, 2)
    expect(castSpell(engine, fs, sram, 12906, trapCell).ok).toBe(true)
    expect(fs.traps).toHaveLength(1)
    turnOf(engine, fs, osa)
    expect(castSpell(engine, fs, osa, 31115, cellAt(11, 2)).ok).toBe(true)
    const tofu = fs.fighters.find(f => f.monsterId === 8070)!
    expect(tofu).toBeDefined()
    // (11,2) est dans la croix 1 du piège centré en (12,2) : déclenché par l'apparition (sort du piège centré sur le
    // piège, le Tofu allié n'étant pas visé par ses dommages « ennemis »).
    expect(fs.traps).toHaveLength(0)
    expect(fs.events.some(e => e.t === 'trap' && !e.added)).toBe(true)
  })
})

describe('1181 — portail emprunté à la marche', () => {
  it('la sortie saute les portails occupés (chaîne recalculée sans eux)', () => {
    const engine = newEngine()
    const elio = player({ name: 'Elio', breedId: ELIOTROPE, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 9000 } })
    const enemy = monster(3834, cellAt(20, 5), { grade: 1 })
    const fs = fight(engine, [elio, enemy])
    turnOf(engine, fs, elio)
    const portal = effect(1181, { diceNum: 2, value: 0, duration: -1, targetMask: 'a,A' })
    const a = cellAt(12, 0)
    const b = cellAt(12, 6)
    const c = cellAt(18, 6)
    for (const cell of [a, b, c]) applyEffects(engine, fs, elio, null, 14574, [portal], cell, elio.cell, false, false, 0)
    // La sortie normale (c) est occupée : le réseau mène au dernier portail libre (b).
    enemy.cell = c
    move(fs, elio, [cellAt(10, 0), cellAt(11, 0), a], engine)
    expect(elio.cell).toBe(b)
  })
})

describe('402 — ordre de fin de tour', () => {
  it('les déclencheurs TE du combattant passent avant les glyphes de fin de tour (mechanics.md §9.2)', () => {
    const engine = newEngine()
    const caster = player({ name: 'Eni', breedId: 7, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 9000 } })
    const enemy = monster(3834, cellAt(13, 0), { grade: 1, initiative: 10 })
    const fs = fight(engine, [caster, enemy])
    turnOf(engine, fs, caster)
    const order: string[] = []
    registerEffect(990101, 'test', () => order.push('TE'), true)
    registerEffect(990102, 'test', () => order.push('glyphe'), true)
    engine.addBuff(fs, enemy, {
      sourceId: enemy.id,
      spellId: 0,
      effect: effect(990101, { triggers: 'TE', targetMask: 'C' }),
      value: 0,
      remaining: -1,
      delay: 0,
      dispellable: false,
      triggers: 'TE',
      kind: 'trigger',
      label: 'test TE',
    })
    // Glyphe de fin de tour dont le « sort » est l'effet de test (sort réel 25948 remplacé par ses effets).
    applyEffects(engine, fs, caster, null, 25795, [effect(402, { diceNum: 25948, diceSide: 6, duration: 2, zone: zone('C', 1), targetMask: 'a,A' })], enemy.cell, caster.cell, false, false, 0)
    const g = fs.glyphs.find(x => x.trigger === 'turnEnd')!
    expect(g).toBeDefined()
    g.effects = [effect(990102, { targetMask: 'A' })]
    turnOf(engine, fs, enemy)
    engine.endTurn(fs, enemy)
    expect(order).toEqual(['TE', 'glyphe'])
  })
})
