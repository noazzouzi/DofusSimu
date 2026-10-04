import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RawManifest } from '../src/data/raw'
import {
  SPELL_LEVEL_REF_DICESIDE_EFFECTS,
  SPELL_MODIFIER_EFFECTS,
  SPELL_REF_DICENUM_EFFECTS,
  SPELL_REF_VALUE_EFFECTS,
  STATE_EFFECTS,
  SUMMON_EFFECTS,
  effectSpellLevelRef,
  effectSpellRef,
  effectStateRef,
  effectSummonRef,
  itemEffectSpellRef,
  targetMaskStates,
  triggerStates,
} from '../src/data/refs'

const manifest = JSON.parse(readFileSync('data/dofusdb/manifest.json', 'utf8')) as RawManifest
const sorted = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b)
const fx = (effectId: number, diceNum = 0, diceSide = 0, value = 0) => ({ effectId, diceNum, diceSide, value })

describe('effets référents', () => {
  it('les listes recopiées sont synchronisées avec manifest.json', () => {
    const r = manifest.spellRefEffects
    expect(sorted(SPELL_REF_DICENUM_EFFECTS)).toEqual([...r.diceNumIsSpell].sort((a, b) => a - b))
    expect(sorted(SPELL_MODIFIER_EFFECTS)).toEqual([...r.spellModifiers].sort((a, b) => a - b))
    expect(sorted(SPELL_REF_VALUE_EFFECTS)).toEqual([...r.valueIsSpell].sort((a, b) => a - b))
    expect(sorted(SPELL_LEVEL_REF_DICESIDE_EFFECTS)).toEqual([...r.diceSideIsSpellLevel].sort((a, b) => a - b))
    expect(sorted(SUMMON_EFFECTS)).toEqual([...r.summonDiceNumIsMonster].sort((a, b) => a - b))
    expect(sorted(STATE_EFFECTS)).toEqual([...r.stateValueIsState].sort((a, b) => a - b))
    expect(r.diceSideIsSpell).toEqual([])
  })

  it('sort référencé : lancer (diceNum + grade), modificateur (sans grade), value', () => {
    expect(effectSpellRef(fx(792, 5003, 1))).toEqual({ spellId: 5003, grade: 1 })
    expect(effectSpellRef(fx(401, 12996, 3, 13243184))).toEqual({ spellId: 12996, grade: 3 })
    expect(effectSpellRef(fx(1175, 8395, 1))).toEqual({ spellId: 8395, grade: 1 })
    expect(effectSpellRef(fx(281, 13139, 0, 2))).toEqual({ spellId: 13139 })
    expect(effectSpellRef(fx(2018, 100, 5))).toEqual({ spellId: 100 })
    expect(effectSpellRef(fx(722, 0, 2, 8166))).toEqual({ spellId: 8166, grade: 2 })
    expect(effectSpellRef(fx(406, 0, 0, 1234))).toEqual({ spellId: 1234 })
    expect(effectSpellRef(fx(1406, 0, 3, 1234))).toEqual({ spellId: 1234, grade: 3 })
    expect(effectSpellRef(fx(99, 17, 19))).toBeUndefined()
    expect(effectSpellRef(fx(792, 0, 0))).toBeUndefined()
    expect(effectSpellRef(fx(406, 0, 0, 0))).toBeUndefined()
  })

  it('invocation, état, niveau de sort, masques', () => {
    expect(effectSummonRef(fx(181, 3833, 1))).toEqual({ monsterId: 3833, grade: 1 })
    expect(effectSummonRef(fx(1008, 3112, 0))).toEqual({ monsterId: 3112, grade: 1 })
    expect(effectSummonRef(fx(99, 3833, 1))).toBeUndefined()
    expect(effectStateRef(fx(950, 0, 0, 236))).toBe(236)
    expect(effectStateRef(fx(951, 0, 0, 56))).toBe(56)
    expect(effectStateRef(fx(99, 0, 0, 56))).toBeUndefined()
    expect(effectSpellLevelRef(fx(1181, 0, 44338))).toBe(44338)
    expect(effectSpellLevelRef(fx(792, 0, 44338))).toBeUndefined()
    expect(targetMaskStates('a,A,*E4254')).toEqual([4254])
    expect(targetMaskStates('c,E234,e12,E234,F3833')).toEqual([234, 12])
    expect(targetMaskStates('')).toEqual([])
  })

  it('états cités par les déclencheurs', () => {
    expect(triggerStates('I')).toEqual([])
    expect(triggerStates('')).toEqual([])
    expect(triggerStates('TB|D')).toEqual([])
    expect(triggerStates('EON99')).toEqual([99])
    expect(triggerStates('EOFF8|EON98|EACT5|EON98')).toEqual([8, 98, 5])
    expect(triggerStates('EK:i,F3833,E234')).toEqual([234])
    expect(triggerStates('EK:a,F12')).toEqual([])
    expect(triggerStates('EC:=2:m,h,e6611')).toEqual([6611])
    expect(triggerStates('TR13115|EC:>1:g')).toEqual([]) // TR# = sort, EC:>n = nombre
  })

  it('sort référencé par un effet d’objet', () => {
    expect(itemEffectSpellRef({ effectId: 1175, min: 8395, max: 1 })).toEqual({ spellId: 8395, grade: 1 })
    expect(itemEffectSpellRef({ effectId: 722, min: 0, max: 1, value: 8166 })).toEqual({ spellId: 8166, grade: 1 })
    expect(itemEffectSpellRef({ effectId: 281, min: 13139, max: 13139, value: 2 })).toBeUndefined()
    expect(itemEffectSpellRef({ effectId: 118, min: 71, max: 100 })).toBeUndefined()
  })
})
