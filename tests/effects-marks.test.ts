/**
 * Famille « marques » (src/engine/effects/marks.ts) avec des sorts réels : piège du Sram (Piège Sournois 12906),
 * glyphe et glyphe-aura du Féca (Terre Brûlée 12985), dissipation (Pâturage 13013), runes (2022/2023), portails.
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { applyEffects } from '../src/engine/effects/core'
import { registerEffect } from '../src/engine/effects/registry'
import { isTrapVisibleTo, markColor, markOptions, portalBonus, portalChain, portalExit } from '../src/engine/effects/marks'
import { move } from '../src/engine/move'
import type { FightEvent } from '../src/engine/types'
import { distance } from '../src/map/geometry'
import { cellAt, effect, fight, has, monster, newEngine, player, turnOf, zone } from './effects-summons-helpers'

const FECA = 1
const SRAM = 4

const damages = (evs: FightEvent[], target: number) => evs.filter((e): e is Extract<FightEvent, { t: 'damage' }> => e.t === 'damage' && e.target === target)

describe('400 — piège du Sram (Piège Sournois 12906)', () => {
  const setup = () => {
    const engine = newEngine()
    const sram = player({ name: 'Sram', breedId: SRAM, spellIds: [12906], cell: cellAt(10, 0), stats: { intelligence: 600, initiative: 5000 } })
    const ally = player({ name: 'Allié', breedId: FECA, spellIds: [], cell: cellAt(10, 4) })
    const enemy = monster(3834, cellAt(17, 0), { grade: 1 })
    const fs = fight(engine, [sram, ally, enemy])
    turnOf(engine, fs, sram)
    return { engine, fs, sram, ally, enemy }
  }

  it('pose un piège invisible pour les ennemis sur la zone de l’effet (croix 1)', () => {
    const { engine, fs, sram, ally, enemy } = setup()
    const center = cellAt(14, 0)
    expect(castSpell(engine, fs, sram, 12906, center).ok).toBe(true)
    expect(fs.traps).toHaveLength(1)
    const t = fs.traps[0]
    expect(t.center).toBe(center)
    expect(t.cells.sort((a, b) => a - b)).toEqual([center, cellAt(15, 0), cellAt(13, 0), cellAt(14, 1), cellAt(14, -1)].sort((a, b) => a - b))
    expect(t.castSpellId).toBe(12929)
    expect(t.color).toBe(markColor(12128795))
    expect(isTrapVisibleTo(fs, t, ally)).toBe(true)
    expect(isTrapVisibleTo(fs, t, enemy)).toBe(false)
    expect(fs.events.some(e => e.t === 'trap' && e.added)).toBe(true)
  })

  it('se déclenche quand un ennemi y entre en marchant : arrêt, disparition, dommages de piège centrés sur le piège', () => {
    const { engine, fs, sram, enemy } = setup()
    const center = cellAt(14, 0)
    castSpell(engine, fs, sram, 12906, center)
    const hp0 = enemy.hp
    const steps = move(fs, enemy, [cellAt(17, 0), cellAt(16, 0), cellAt(15, 0), cellAt(14, 0), cellAt(13, 0)], engine)
    expect(steps).toBe(2)
    expect(fs.traps).toHaveLength(0)
    expect(fs.events.some(e => e.t === 'trap' && !e.added)).toBe(true)
    if (has(99)) {
      expect(enemy.hp).toBeLessThan(hp0)
      const d = damages(fs.events, enemy.id)
      expect(d.length).toBeGreaterThan(0)
      expect(d.every(x => x.kind === 'trap' && x.source === sram.id)).toBe(true)
    }
    // Attirance de 1 vers le centre du piège (famille déplacements).
    if (has(6)) expect(enemy.cell).toBe(center)
    else expect(enemy.cell).toBe(cellAt(15, 0))
  })

  it("se déclenche aussi sur un allié (option), et pas une seconde fois", () => {
    const { engine, fs, sram, ally } = setup()
    castSpell(engine, fs, sram, 12906, cellAt(10, 2))
    expect(markOptions.trapsTriggeredByAllies).toBe(true)
    move(fs, ally, [cellAt(10, 4), cellAt(10, 3), cellAt(10, 2)], engine)
    expect(fs.traps).toHaveLength(0)
    expect(ally.cell).toBe(has(6) ? cellAt(10, 2) : cellAt(10, 3))
  })

  it('déclencheur DT (dommages de piège subis) sur la cible', () => {
    if (!has(99)) return
    const { engine, fs, sram, enemy } = setup()
    let dt = 0
    registerEffect(990002, 'test', () => dt++, true)
    engine.addBuff(fs, enemy, {
      sourceId: enemy.id,
      spellId: 0,
      effect: effect(990002, { triggers: 'DT', targetMask: 'C' }),
      value: 0,
      remaining: -1,
      delay: 0,
      dispellable: false,
      triggers: 'DT',
      kind: 'trigger',
      label: 'test DT',
    })
    castSpell(engine, fs, sram, 12906, cellAt(14, 0))
    move(fs, enemy, [cellAt(17, 0), cellAt(16, 0), cellAt(15, 0)], engine)
    expect(dt).toBe(1)
  })
})

describe('401 / 1091 — glyphe et glyphe-aura du Féca (Terre Brûlée 12985)', () => {
  const setup = () => {
    const engine = newEngine()
    const feca = player({ name: 'Féca', breedId: FECA, spellIds: [12985], cell: cellAt(10, 0), stats: { intelligence: 800, initiative: 9000, summons: 1 } })
    const ally = player({ name: 'Allié', breedId: SRAM, spellIds: [], cell: cellAt(13, 0), stats: { initiative: 10 } })
    const enemy = monster(3834, cellAt(15, 0), { grade: 1, initiative: 5000 })
    const fs = fight(engine, [feca, ally, enemy])
    turnOf(engine, fs, feca)
    return { engine, fs, feca, ally, enemy }
  }

  it('pose une glyphe de début de tour et une glyphe-aura (carré 2, 2 tours) + la Lanterne', () => {
    const { engine, fs, feca } = setup()
    const center = cellAt(14, 0)
    expect(castSpell(engine, fs, feca, 12985, center).ok).toBe(true)
    const glyph = fs.glyphs.find(g => g.trigger === 'turnStart' && g.spellId === 12985)!
    const aura = fs.glyphs.find(g => g.trigger === 'aura' && g.spellId === 12985)!
    expect(glyph.cells).toHaveLength(25)
    expect(glyph.remaining).toBe(2)
    expect(glyph.castSpellId).toBe(12996)
    expect(glyph.spellId).toBe(12985)
    expect(aura.castSpellId).toBe(29062)
    expect(fs.fighters.some(f => f.monsterId === 7841 && f.cell === center)).toBe(true)
  })

  it("l'aura s'applique aux présents et ses effets sont retirés à la sortie", () => {
    if (!has(950)) return
    const { engine, fs, feca, ally } = setup()
    castSpell(engine, fs, feca, 12985, cellAt(14, 0))
    const aura = fs.glyphs.find(g => g.trigger === 'aura' && g.spellId === 12985)!
    // 950 état 5263 (Armure incandescente) aux alliés présents (masque a).
    expect(ally.states).toContain(5263)
    expect(aura.triggered).toContain(ally.id)
    expect(ally.buffs.some(b => b.markUid === aura.uid)).toBe(true)
    // L'allié sort de l'aura (marche) : effets directs retirés.
    move(fs, ally, [cellAt(13, 0), cellAt(12, 0), cellAt(11, 0)], engine)
    engine.hooks.onTurnEnd?.(fs, feca)
    expect(ally.states).not.toContain(5263)
    expect(aura.triggered).not.toContain(ally.id)
    // Il y revient : réappliquée une fois.
    move(fs, ally, [cellAt(11, 0), cellAt(12, 0)], engine)
    expect(ally.states).toContain(5263)
  })

  it("la glyphe frappe l'ennemi présent au début de SON tour (dommages de glyphe) et expire après 2 tours du Féca", () => {
    const { engine, fs, feca, enemy } = setup()
    castSpell(engine, fs, feca, 12985, cellAt(14, 0))
    const hp0 = enemy.hp
    const before = fs.events.length
    turnOf(engine, fs, enemy)
    if (has(99)) {
      const d = damages(fs.events.slice(before), enemy.id).filter(e => e.element === 2)
      expect(d.length).toBe(1)
      expect(d[0].kind).toBe('glyph')
      expect(d[0].source).toBe(feca.id)
      expect(enemy.hp).toBeLessThan(hp0)
    }
    turnOf(engine, fs, feca)
    expect(fs.glyphs.filter(g => g.spellId === 12985)).toHaveLength(2)
    turnOf(engine, fs, feca)
    expect(fs.glyphs.filter(g => g.spellId === 12985)).toHaveLength(0)
  })
})

describe('2018 / 1026 / 2022 / 2023 — dissipation, déclenchement forcé, runes', () => {
  const setup = () => {
    const engine = newEngine()
    const caster = player({ name: 'Féca', breedId: FECA, spellIds: [], cell: cellAt(10, 0), stats: { intelligence: 500, initiative: 9000 } })
    const enemy = monster(3834, cellAt(14, 0), { grade: 1 })
    const fs = fight(engine, [caster, enemy])
    turnOf(engine, fs, caster)
    return { engine, fs, caster, enemy }
  }
  const place = (s: ReturnType<typeof setup>, effects: ReturnType<typeof effect>[], cell: number, spellId = 0) =>
    applyEffects(s.engine, s.fs, s.caster, null, spellId, effects, cell, s.caster.cell, false, false, 0)

  it('2018 dissipe les glyphes du lanceur issus du sort (posant ou lancé)', () => {
    const s = setup()
    place(s, [effect(401, { diceNum: 12996, diceSide: 3, duration: 2, zone: zone('C', 1), targetMask: 'A' })], cellAt(14, 0), 12985)
    place(s, [effect(401, { diceNum: 12996, diceSide: 3, duration: 2, zone: zone('C', 1), targetMask: 'A' })], cellAt(12, 3), 13013)
    expect(s.fs.glyphs).toHaveLength(2)
    place(s, [effect(2018, { diceNum: 12985, targetMask: 'C' })], s.caster.cell, 13013)
    expect(s.fs.glyphs).toHaveLength(1)
    expect(s.fs.glyphs[0].spellId).toBe(13013)
    place(s, [effect(2018, { diceNum: 0, targetMask: 'C' })], s.caster.cell)
    expect(s.fs.glyphs).toHaveLength(0)
  })

  it('1026 déclenche immédiatement la glyphe du sort `value` contenant la case ciblée', () => {
    if (!has(99)) return
    const s = setup()
    place(s, [effect(401, { diceNum: 12996, diceSide: 3, duration: 2, zone: zone('C', 2), targetMask: 'A' })], cellAt(14, 0), 12985)
    const hp0 = s.enemy.hp
    place(s, [effect(1026, { value: 12987, targetMask: 'a,A' })], cellAt(14, 0))
    expect(s.enemy.hp).toBe(hp0)
    place(s, [effect(1026, { value: 12985, targetMask: 'a,A' })], cellAt(14, 0))
    expect(s.enemy.hp).toBeLessThan(hp0)
    expect(damages(s.fs.events, s.enemy.id).at(-1)?.kind).toBe('glyph')
  })

  it('2022 pose une rune inerte (remplacée sur la même case), 2023 la déclenche puis la consomme', () => {
    const s = setup()
    const rune = effect(2022, { diceNum: 13665, diceSide: 1, duration: 2, value: 13243184 })
    place(s, [rune], cellAt(14, 0))
    place(s, [rune], cellAt(14, 0))
    const runes = s.fs.glyphs.filter(g => g.markType === 'rune')
    expect(runes).toHaveLength(1)
    // Marcher sur une rune ne fait rien.
    s.engine.hooks.onEnterCell?.(s.fs, s.enemy, s.enemy.cell)
    expect(s.fs.glyphs.filter(g => g.markType === 'rune')).toHaveLength(1)
    place(s, [effect(2023, { targetMask: 'a,A' })], cellAt(14, 0))
    expect(s.fs.glyphs.filter(g => g.markType === 'rune')).toHaveLength(0)
    expect(s.fs.events.some(e => e.t === 'glyph' && !e.added && e.glyph.uid === runes[0].uid)).toBe(true)
  })
})

describe('1181 / 1183 — portails', () => {
  it('chaîne, sortie, bonus et téléportation en marchant', () => {
    const engine = newEngine()
    const elio = player({ name: 'Elio', breedId: 16, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 9000 } })
    const enemy = monster(3834, cellAt(20, 5), { grade: 1 })
    const fs = fight(engine, [elio, enemy])
    turnOf(engine, fs, elio)
    const portal = effect(1181, { diceNum: 2, value: 0, duration: -1, targetMask: 'a,A' })
    const a = cellAt(12, 0)
    const b = cellAt(12, 6)
    const c = cellAt(18, 6)
    for (const cell of [a, b, c]) applyEffects(engine, fs, elio, null, 14574, [portal], cell, elio.cell, false, false, 0)
    expect(fs.glyphs.filter(g => g.markType === 'portal')).toHaveLength(3)
    expect(portalChain(a, [a, b, c])).toEqual([b, c])
    const entry = fs.glyphs.find(g => g.center === a)!
    expect(portalExit(fs, entry)).toBe(c)
    expect(portalBonus(fs, entry)).toBe(2 * (distance(a, b) + distance(b, c)))
    // L'Eliotrope marche sur le portail d'entrée : téléporté sur la sortie.
    move(fs, elio, [cellAt(10, 0), cellAt(11, 0), a], engine)
    expect(elio.cell).toBe(c)
    // 1183 : désactivation de tous les portails jusqu'au prochain tour du lanceur.
    applyEffects(engine, fs, elio, null, 14582, [effect(1183, { zone: zone('a', 1), targetMask: 'a,A' })], elio.cell, elio.cell, false, false, 0)
    expect(portalExit(fs, entry)).toBe(-1)
    turnOf(engine, fs, elio)
    // Réactivés ; l'Eliotrope occupe encore c : la sortie saute ce portail (port `RedefinePortals`).
    expect(portalExit(fs, entry)).toBe(b)
    elio.cell = cellAt(10, 0)
    expect(portalExit(fs, entry)).toBe(c)
  })
})
