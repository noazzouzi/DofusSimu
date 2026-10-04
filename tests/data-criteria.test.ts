import { describe, expect, it } from 'vitest'
import { normalizeStatesCriterion, parseStatesCriterion, statesConditionMet, statesOfCondition } from '../src/data/criteria'

describe('conditions d’états (statesCriterion)', () => {
  it('normalise HS=x / HS!x vers le format runtime E/e', () => {
    expect(normalizeStatesCriterion('')).toBe('')
    expect(normalizeStatesCriterion('HS!236')).toBe('e236')
    expect(normalizeStatesCriterion('HS=236')).toBe('E236')
    expect(normalizeStatesCriterion('HS=3|(HS=3531&HS!534)')).toBe('E3|(E3531&e534)')
    expect(normalizeStatesCriterion(' HS=98 | HS=99 ')).toBe('E98|E99')
  })

  it('compile en forme disjonctive (ET prioritaire, parenthèses)', () => {
    expect(parseStatesCriterion('')).toBeUndefined()
    expect(parseStatesCriterion('  ')).toBeUndefined()
    expect(parseStatesCriterion('HS!7')).toEqual([{ has: [], not: [7] }])
    expect(parseStatesCriterion('HS=98|HS=99')).toEqual([
      { has: [98], not: [] },
      { has: [99], not: [] },
    ])
    expect(parseStatesCriterion('HS=1&HS!2&HS=3')).toEqual([{ has: [1, 3], not: [2] }])
    expect(parseStatesCriterion('HS=3|(HS=3531&HS!534&HS!661&HS!8)')).toEqual([
      { has: [3], not: [] },
      { has: [3531], not: [534, 661, 8] },
    ])
    expect(parseStatesCriterion('(HS=515&HS!7)|HS=517')).toEqual([
      { has: [515], not: [7] },
      { has: [517], not: [] },
    ])
    expect(parseStatesCriterion('(HS=3360|HS=3589)&HS!7')).toEqual([
      { has: [3360], not: [7] },
      { has: [3589], not: [7] },
    ])
    // & prioritaire sur | sans parenthèses
    expect(parseStatesCriterion('HS=1&HS=2|HS=3')).toEqual([
      { has: [1, 2], not: [] },
      { has: [3], not: [] },
    ])
    // format runtime E/e accepté, doublons fusionnés, clauses contradictoires supprimées
    expect(parseStatesCriterion('E12&e34|E56')).toEqual([
      { has: [12], not: [34] },
      { has: [56], not: [] },
    ])
    expect(parseStatesCriterion('HS=5&HS=5')).toEqual([{ has: [5], not: [] }])
    expect(parseStatesCriterion('HS=5&HS!5')).toEqual([])
  })

  it('rejette une syntaxe invalide', () => {
    expect(() => parseStatesCriterion('HS>5')).toThrow()
    expect(() => parseStatesCriterion('(HS=5')).toThrow()
    expect(() => parseStatesCriterion('HS=5)')).toThrow()
    expect(() => parseStatesCriterion('HS=5&')).toThrow()
    expect(() => parseStatesCriterion('|HS=5')).toThrow()
  })

  it('évalue une condition sur les états du lanceur (cas Vortex : Marginal 236)', () => {
    const heuristique = parseStatesCriterion('HS!236')
    const contamination = parseStatesCriterion('HS=236')
    expect(statesConditionMet(heuristique, [])).toBe(true)
    expect(statesConditionMet(heuristique, [56, 236])).toBe(false)
    expect(statesConditionMet(contamination, [56, 236])).toBe(true)
    expect(statesConditionMet(contamination, [])).toBe(false)
    expect(statesConditionMet(undefined, [1])).toBe(true)
    expect(statesConditionMet([], [1])).toBe(false)
    const c = parseStatesCriterion('(HS=3360|HS=3589)&HS!7')
    expect(statesConditionMet(c, [3589])).toBe(true)
    expect(statesConditionMet(c, [3589, 7])).toBe(false)
    expect(statesConditionMet(c, [1])).toBe(false)
    expect(statesOfCondition(c)).toEqual([3360, 7, 3589])
    expect(statesOfCondition(undefined)).toEqual([])
  })
})
