/**
 * Relecture adverse de la famille « invocations » (src/engine/effects/summons.ts), avec des sorts réels :
 *  - invocation en zone DIFFÉRÉE (Appel des Fonds Marins 6808 : 181 en cercle 63 avec délai) : les cases candidates
 *    sont celles de la zone de l'effet, pas la seule case du porteur de l'effet différé ;
 *  - 1034 sur un monstre : nouvelle invocation sur la case CIBLÉE (port `Summon` : `TargetedCell`) ;
 *  - un ressuscité qui réapparaît sur une marque la déclenche (port `HandleSummon` → `ExecuteMarks(fromDrag)`) ;
 *  - 1097 : la téléportation du lanceur est un déplacement forcé (glyphes immédiates non déclenchées).
 */
import { describe, expect, it } from 'vitest'
import { applyEffects, castSubSpell } from '../src/engine/effects/core'
import { cellAt, effect, fight, monster, newEngine, player, turnOf, zone } from './effects-summons-helpers'

describe('181 différé en zone — Appel des Fonds Marins (6808)', () => {
  it('les invocations différées (délai 1) apparaissent sur les cases libres de la zone autour du lanceur', () => {
    const engine = newEngine()
    const caster = monster(3834, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const p = player({ name: 'P', breedId: 8, spellIds: [], cell: cellAt(16, 4), stats: { initiative: 10 } })
    const fs = fight(engine, [caster, p])
    turnOf(engine, fs, caster)
    expect(castSubSpell(engine, fs, caster, 6808, 1, caster.cell, false, 0)).toBe(true)
    // o0 immédiat : 4455 ; o1 différé d'un tour : 4457.
    expect(fs.fighters.filter(f => f.alive && f.monsterId === 4455)).toHaveLength(1)
    expect(fs.fighters.some(f => f.monsterId === 4457)).toBe(false)
    turnOf(engine, fs, p)
    turnOf(engine, fs, caster)
    const s = fs.fighters.find(f => f.alive && f.monsterId === 4457)
    expect(s).toBeDefined()
    expect(s!.summonerId).toBe(caster.id)
    expect(s!.cell).not.toBe(caster.cell)
  })
})

describe('1034 — dernier allié mort, en invocation', () => {
  it("un monstre revient comme nouvelle invocation sur la case ciblée (pas sur sa case de mort)", () => {
    const engine = newEngine()
    const healer = monster(3836, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const ally = monster(3834, cellAt(12, 0), { grade: 1 })
    const enemy = player({ name: 'P', breedId: 8, spellIds: [], cell: cellAt(16, 0) })
    const fs = fight(engine, [healer, ally, enemy], { rollMode: 'average' })
    turnOf(engine, fs, healer)
    engine.kill(fs, ally, enemy)
    applyEffects(engine, fs, healer, null, 0, [effect(1034, { diceNum: 25 })], cellAt(11, 3), healer.cell, false, false, 0)
    const s = fs.fighters.find(f => f.alive && f.monsterId === 3834)!
    expect(s).toBeDefined()
    expect(s.summonerId).toBe(healer.id)
    expect(s.cell).toBe(cellAt(11, 3))
  })
})

describe('780 — un ressuscité qui réapparaît sur un piège le déclenche', () => {
  it('le monstre ressuscité sur sa case de mort piégée déclenche le piège ennemi', () => {
    const engine = newEngine()
    const healer = monster(3836, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const ally = monster(3834, cellAt(12, 0), { grade: 1 })
    const sram = player({ name: 'Sram', breedId: 4, spellIds: [12906], cell: cellAt(16, 0), stats: { intelligence: 400 } })
    const fs = fight(engine, [healer, ally, sram], { rollMode: 'average' })
    turnOf(engine, fs, healer)
    engine.kill(fs, ally, sram)
    // Piège du Sram posé sur la case de mort (pose directe : sort réel 12929 lancé par la marque).
    applyEffects(engine, fs, sram, null, 12906, [effect(400, { diceNum: 12929, diceSide: 1, zone: zone('P'), targetMask: 'a,A' })], cellAt(12, 0), sram.cell, false, false, 0)
    expect(fs.traps).toHaveLength(1)
    applyEffects(engine, fs, healer, null, 0, [effect(780, { diceNum: 50 })], cellAt(11, 3), healer.cell, false, false, 0)
    expect(ally.alive).toBe(true)
    expect(ally.cell).toBe(cellAt(12, 0))
    expect(fs.traps).toHaveLength(0)
  })
})

describe('1097 — téléportation du lanceur (Roublardise)', () => {
  it("l'arrivée du lanceur est un déplacement forcé : une glyphe immédiate (1165) de la case n'est pas déclenchée", () => {
    const engine = newEngine()
    const roub = player({ name: 'Roub', breedId: 13, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 9000 } })
    const ik = monster(3834, cellAt(18, 5), { grade: 1 })
    const fs = fight(engine, [roub, ik])
    turnOf(engine, fs, roub)
    // Glyphe téléporteur de l'Ikargn (5012 → 1165 → 5011 : échange avec un personnage) sur la case visée.
    const target = cellAt(12, 0)
    castSubSpell(engine, fs, ik, 5012, 1, target, false, 0)
    expect(fs.glyphs.some(g => g.trigger === 'enter' && g.center === target)).toBe(true)
    applyEffects(engine, fs, roub, null, 13431, [effect(1097, { diceNum: 3 })], target, roub.cell, false, false, 0)
    expect(roub.cell).toBe(target)
    expect(ik.cell).toBe(cellAt(18, 5))
  })
})
