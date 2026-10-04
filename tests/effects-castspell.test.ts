/**
 * Famille « lancements de sorts » (src/engine/effects/castspell.ts) : table lanceur / case (effects.md §2.5),
 * limites globales, source d'un effet déclenché, et la chaîne réelle de l'Ikargn
 * « Attraction ailée » 5015 → (différé 1 tour) 793 → 5014 → 1160 → 5013.
 *
 * Les règles sont vérifiées avec le sous-sort réel 5012 (Glyphe téléporteur), qui pose une glyphe (1165) sur la case
 * visée au nom de son lanceur : `glyph.sourceId` = lanceur du sous-sort, `glyph.center` = case visée.
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { applyEffects, runEffect } from '../src/engine/effects/core'
import { CAST_SPELL_RULES } from '../src/engine/effects/castspell'
import type { EffectData } from '../src/data/model'
import type { Fighter } from '../src/engine/types'
import { cellAt, effect, fight, has, monster, newEngine, player, turnOf, zone } from './effects-summons-helpers'

const IOP = 8

function setup() {
  const engine = newEngine()
  const caster = player({ name: 'Lanceur', breedId: IOP, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 9000 } })
  const e1 = monster(3834, cellAt(12, 0), { grade: 1 })
  const e2 = monster(3834, cellAt(11, 1), { grade: 1 })
  const e3 = monster(3834, cellAt(10, -2), { grade: 1 })
  const fs = fight(engine, [caster, e1, e2, e3])
  turnOf(engine, fs, caster)
  return { engine, fs, caster, e1, e2, e3 }
}

/** Effet « lance 5012 » (pose une glyphe à la case visée, au nom du lanceur du sous-sort). */
const exec = (effectId: number, p: Partial<EffectData> = {}): EffectData =>
  effect(effectId, { diceNum: 5012, diceSide: 1, targetMask: 'A', zone: zone('C', 3), ...p })

const glyphs = (s: ReturnType<typeof setup>) => s.fs.glyphs.map(g => ({ source: g.sourceId, cell: g.center }))
const sortG = (a: { source: number; cell: number }[]) => a.slice().sort((x, y) => x.source - y.source || x.cell - y.cell)

describe('table lanceur / case (effects.md §2.5)', () => {
  it('1160 : le lanceur lance le sous-sort sur chaque cible', () => {
    const s = setup()
    applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(1160)], s.caster.cell, s.caster.cell, false, false, 0)
    expect(sortG(glyphs(s))).toEqual(sortG([s.e1, s.e2, s.e3].map(e => ({ source: s.caster.id, cell: e.cell }))))
  })

  it('792 / 793 : chaque cible lance le sous-sort sur elle-même', () => {
    for (const id of [792, 793]) {
      const s = setup()
      applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(id)], s.caster.cell, s.caster.cell, false, false, 0)
      expect(sortG(glyphs(s))).toEqual(sortG([s.e1, s.e2, s.e3].map(e => ({ source: e.id, cell: e.cell }))))
    }
  })

  it('2794 : chaque cible lance le sous-sort sur la case ciblée par le parent ; 2960 : le lanceur, une fois, même sans entité', () => {
    const s = setup()
    const cell = cellAt(12, 1)
    applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(2794, { zone: zone('C', 2) })], cell, s.caster.cell, false, false, 0)
    expect(sortG(glyphs(s))).toEqual(sortG([s.e1, s.e2].map(e => ({ source: e.id, cell }))))
    const s2 = setup()
    const empty = cellAt(15, 5)
    applyEffects(s2.engine, s2.fs, s2.caster, null, 0, [exec(2960, { zone: zone('P'), targetMask: 'a,A' })], empty, s2.caster.cell, false, false, 0)
    expect(glyphs(s2)).toEqual([{ source: s2.caster.id, cell: empty }])
    // Condition « * » du lanceur non remplie : rien.
    const s3 = setup()
    applyEffects(s3.engine, s3.fs, s3.caster, null, 0, [exec(2960, { zone: zone('P'), targetMask: 'a,A,*E999' })], empty, s3.caster.cell, false, false, 0)
    expect(s3.fs.glyphs).toHaveLength(0)
  })

  it('1017 / 1018 / 1019 : « source » = entité déclenchante d’un effet déclenché, sinon le lanceur', () => {
    // Effet non déclenché : source = lanceur.
    const s = setup()
    applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(1017, { zone: zone('P') })], s.e1.cell, s.caster.cell, false, false, 0)
    expect(glyphs(s)).toEqual([{ source: s.e1.id, cell: s.caster.cell }])
    // Effet déclenché par e2 (ex. dommages subis) sur le porteur e1.
    const run = (id: number) => {
      const t = setup()
      runEffect(t.engine, t.fs, {
        caster: t.caster,
        spell: null,
        spellId: 0,
        effect: exec(id, { zone: zone('P') }),
        targetCell: t.e1.cell,
        casterCell: t.caster.cell,
        cells: [t.e1.cell],
        targets: [t.e1],
        efficiency: new Map([[t.e1.id, 1]]),
        crit: false,
        indirect: true,
        depth: 1,
        trigger: { type: 'D', source: t.e2 },
      })
      return { t, g: glyphs(t) }
    }
    const a = run(1017)
    expect(a.g).toEqual([{ source: a.t.e1.id, cell: a.t.e2.cell }])
    const b = run(1018)
    expect(b.g).toEqual([{ source: b.t.e2.id, cell: b.t.e1.cell }])
    const c = run(1019)
    expect(c.g).toEqual([{ source: c.t.e2.id, cell: c.t.e2.cell }])
  })

  it('limites globales (2160, 2792, 2017…) : `value` exécutions au plus par effet parent', () => {
    const s = setup()
    applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(2160, { value: 1 })], s.caster.cell, s.caster.cell, false, false, 0)
    expect(s.fs.glyphs).toHaveLength(1)
    const s2 = setup()
    applyEffects(s2.engine, s2.fs, s2.caster, null, 0, [exec(2792, { value: 2 })], s2.caster.cell, s2.caster.cell, false, false, 0)
    expect(s2.fs.glyphs).toHaveLength(2)
    // Variante sans limite globale : `value` ignoré pour un effet instantané.
    const s3 = setup()
    applyEffects(s3.engine, s3.fs, s3.caster, null, 0, [exec(1160, { value: 1 })], s3.caster.cell, s3.caster.cell, false, false, 0)
    expect(s3.fs.glyphs).toHaveLength(3)
    expect(Object.keys(CAST_SPELL_RULES).map(Number).sort((x, y) => x - y)).toEqual([792, 793, 1017, 1018, 1019, 1160, 2017, 2160, 2792, 2793, 2794, 2795, 2960])
  })

  it('masque C : le lanceur est ciblé même hors de la zone', () => {
    const s = setup()
    applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(792, { targetMask: 'C', zone: zone('P') })], s.e1.cell, s.caster.cell, false, false, 0)
    expect(glyphs(s)).toEqual([{ source: s.caster.id, cell: s.caster.cell }])
  })

  it('buff déclencheur : `value` = nombre max de déclenchements du buff', () => {
    const s = setup()
    applyEffects(s.engine, s.fs, s.caster, null, 0, [exec(1160, { triggers: 'D', value: 2, zone: zone('P'), targetMask: 'A' })], s.e1.cell, s.caster.cell, false, false, 0)
    const buff = s.e1.buffs.find(b => b.kind === 'trigger')!
    expect(buff.maxTriggers).toBe(2)
  })
})

describe("Ikargn — Attraction ailée (5015 → 5014 → 5013)", () => {
  it('au tour suivant, 80 Air autour de lui puis, pour chaque joueur touché, il s’immobilise (−10 PM)', () => {
    const engine = newEngine()
    const ik = monster(3834, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const p = player({ name: 'Cible', breedId: IOP, spellIds: [], cell: cellAt(12, 0), team: 0, hp: 5000, stats: { initiative: 10 } })
    const fs = fight(engine, [ik, p], { rollMode: 'average' })
    turnOf(engine, fs, ik)
    expect(castSpell(engine, fs, ik, 5015, ik.cell).ok).toBe(true)
    // L'effet différé (793 → 5014) est posé sur l'Ikargn (masque C).
    expect(ik.buffs.some(b => b.kind === 'delayed' && b.effect.effectId === 793 && b.effect.diceNum === 5014)).toBe(true)
    const hpBefore = p.hp
    const n = fs.events.length
    turnOf(engine, fs, p)
    turnOf(engine, fs, ik)
    const evs = fs.events.slice(n)
    expect(evs.some(e => e.t === 'log' && e.text.includes('Attraction ailée'))).toBe(true)
    if (has(98)) {
      expect(p.hp).toBeLessThan(hpBefore)
      expect(evs.some(e => e.t === 'damage' && e.target === p.id && e.source === ik.id && e.element === 4)).toBe(true)
    }
    if (has(169)) {
      // 5013 : 169 −10 PM « C » (le lanceur du sous-sort, l'Ikargn), lancé sur la case du joueur touché.
      expect(ik.buffs.some(b => b.spellId === 5013)).toBe(true)
      expect(ik.mp).toBe(0)
      expect(p.buffs.some(b => b.spellId === 5013)).toBe(false)
    }
  })

  it("sans joueur dans la zone au moment différé : pas d'immobilisation", () => {
    const engine = newEngine()
    const ik = monster(3834, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const p = player({ name: 'Loin', breedId: IOP, spellIds: [], cell: cellAt(20, 0), team: 0, stats: { initiative: 10 } })
    const fs = fight(engine, [ik, p], { rollMode: 'average' })
    turnOf(engine, fs, ik)
    castSpell(engine, fs, ik, 5015, ik.cell)
    turnOf(engine, fs, p)
    turnOf(engine, fs, ik)
    expect(ik.buffs.some((b: Fighter['buffs'][number]) => b.spellId === 5013)).toBe(false)
    expect(ik.mp).toBe(ik.stats.mp)
  })
})
