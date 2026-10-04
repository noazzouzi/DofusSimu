import { describe, expect, it } from 'vitest'
import { emptyStats } from '../src/core/types'
import { checkStatesCriterion as castReexport } from '../src/engine/cast'
import {
  checkStatesClauses,
  checkStatesCriterion,
  criterionToClauses,
  evaluateCriterion,
  isInstantTriggers,
  parseStatesCriterion,
  parseTrigger,
  parseTriggers,
} from '../src/engine/criteria'
import type { Fighter } from '../src/engine/types'

function withStates(states: number[]): Fighter {
  return {
    id: 0,
    team: 0,
    kind: 'player',
    name: 'f',
    level: 200,
    baseStats: emptyStats(),
    stats: emptyStats(),
    hp: 1,
    maxHp: 1,
    baseMaxHp: 1,
    shield: 0,
    ap: 6,
    mp: 3,
    cell: 0,
    alive: true,
    states,
    buffs: [],
    spells: [],
    cooldowns: {},
    castsThisTurn: {},
    castsOnTarget: {},
    ai: '',
    direction: 1,
    tags: {},
  }
}

describe('statesCriterion : analyse', () => {
  it('termes HS= / HS! et forme historique E / e', () => {
    expect(parseStatesCriterion('HS!7').root).toEqual({ kind: 'state', stateId: 7, has: false })
    expect(parseStatesCriterion('HS=236').root).toEqual({ kind: 'state', stateId: 236, has: true })
    expect(parseStatesCriterion('E12').root).toEqual({ kind: 'state', stateId: 12, has: true })
    expect(parseStatesCriterion('e12').root).toEqual({ kind: 'state', stateId: 12, has: false })
    expect(parseStatesCriterion('').root).toEqual({ kind: 'true' })
    expect(parseStatesCriterion(undefined).root).toEqual({ kind: 'true' })
    expect(parseStatesCriterion(' HS=98 | HS=99 ').root.kind).toBe('or')
  })

  it('& prioritaire sur |, parenthèses', () => {
    const p = parseStatesCriterion('HS=1&HS=2|HS=3')
    expect(p.root).toEqual({
      kind: 'or',
      items: [
        { kind: 'and', items: [{ kind: 'state', stateId: 1, has: true }, { kind: 'state', stateId: 2, has: true }] },
        { kind: 'state', stateId: 3, has: true },
      ],
    })
    const q = parseStatesCriterion('(HS=3360|HS=3589)&HS!7')
    expect(q.root.kind).toBe('and')
    expect(q.errors).toEqual([])
    expect(parseStatesCriterion('HS=3|(HS=3531&HS!534&HS!661&HS!8)').unknown).toEqual([])
  })

  it('termes inconnus (vrais) et erreurs de syntaxe signalées', () => {
    const u = parseStatesCriterion('PA<12&HS=3')
    expect(u.unknown).toEqual(['PA<12'])
    expect(u.test([3])).toBe(true)
    expect(u.test([])).toBe(false)
    expect(parseStatesCriterion('(HS=1|HS=2').errors.length).toBe(1)
    expect(parseStatesCriterion('HS=1&').errors.length).toBe(1)
    expect(parseStatesCriterion('HS=1)').errors.length).toBe(1)
    expect(parseStatesCriterion('HS=1&HS=2').errors).toEqual([])
  })

  it('cache : même objet pour la même chaîne', () => {
    expect(parseStatesCriterion('HS!7')).toBe(parseStatesCriterion('HS!7'))
  })
})

describe('statesCriterion : évaluation', () => {
  it('checkStatesCriterion (exemples des données)', () => {
    expect(checkStatesCriterion('', withStates([]))).toBe(true)
    expect(checkStatesCriterion('HS!7', withStates([]))).toBe(true)
    expect(checkStatesCriterion('HS!7', withStates([7]))).toBe(false)
    expect(checkStatesCriterion('HS=236', withStates([236]))).toBe(true) // Contamination zombie
    expect(checkStatesCriterion('HS!236', withStates([236]))).toBe(false) // Heuristique
    expect(checkStatesCriterion('HS=98|HS=100', withStates([100]))).toBe(true)
    expect(checkStatesCriterion('HS=98|HS=100', withStates([99]))).toBe(false)
    expect(checkStatesCriterion('(HS=3360|HS=3589)&HS!7', withStates([3589]))).toBe(true)
    expect(checkStatesCriterion('(HS=3360|HS=3589)&HS!7', withStates([3589, 7]))).toBe(false)
    expect(checkStatesCriterion('HS=3|(HS=3531&HS!534&HS!661&HS!8)', withStates([3]))).toBe(true)
    expect(checkStatesCriterion('HS=3|(HS=3531&HS!534&HS!661&HS!8)', withStates([3531]))).toBe(true)
    expect(checkStatesCriterion('HS=3|(HS=3531&HS!534&HS!661&HS!8)', withStates([3531, 8]))).toBe(false)
    expect(checkStatesCriterion('E12&e34|E56', withStates([56, 34]))).toBe(true)
    expect(castReexport).toBe(checkStatesCriterion) // cast.ts réexporte la fonction
  })

  it('évaluateur générique, AST compilé et forme disjonctive concordent (aléatoire)', () => {
    const criteria = [
      'HS!7',
      'HS=98|HS=99',
      '(HS=515&HS!7)|HS=517',
      'HS=3|(HS=6045&HS=2130&HS!8)',
      'HS=2547&HS!2546&HS!2548',
      'HS=1&HS=2|HS=3&HS!4|(HS=5|HS!6)&HS=7',
      'HS=1&HS!1',
    ]
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 98, 99, 515, 517, 2130, 6045, 2546, 2547, 2548]
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (const c of criteria) {
      const p = parseStatesCriterion(c)
      const clauses = criterionToClauses(c)
      for (let k = 0; k < 300; k++) {
        const states = pool.filter(() => rand() < 0.3)
        const a = p.test(states)
        expect(evaluateCriterion(p.root, id => states.includes(id))).toBe(a)
        expect(checkStatesClauses(clauses, states)).toBe(a)
      }
    }
  })

  it('criterionToClauses : DNF compatible avec StatesClause (undefined = toujours, [] = jamais)', () => {
    expect(criterionToClauses('')).toBeUndefined()
    expect(criterionToClauses('HS!7')).toEqual([{ has: [], not: [7] }])
    expect(criterionToClauses('(HS=3360|HS=3589)&HS!7')).toEqual([
      { has: [3360], not: [7] },
      { has: [3589], not: [7] },
    ])
    expect(criterionToClauses('HS=1&HS!1')).toEqual([])
    expect(checkStatesClauses(undefined, [])).toBe(true)
    expect(checkStatesClauses([], [1])).toBe(false)
  })
})

describe('triggers : analyse', () => {
  it('instantané : I, vide, absent', () => {
    expect(parseTriggers('I')).toMatchObject({ instant: true, unknown: [] })
    expect(parseTriggers('').instant).toBe(true)
    expect(parseTriggers(undefined).instant).toBe(true)
    expect(isInstantTriggers('TB')).toBe(false)
    expect(isInstantTriggers('I')).toBe(true)
  })

  it('codes subis : tours, dommages (élément, camp, portée, origine), poussée, déplacements', () => {
    expect(parseTrigger('TB')).toMatchObject({ event: 'turnStart', side: 'bearer', lethal: false })
    expect(parseTrigger('TE')).toMatchObject({ event: 'turnEnd' })
    expect(parseTrigger('D')).toMatchObject({ event: 'damage', code: 'D' })
    expect(parseTrigger('DF')).toMatchObject({ event: 'damage', element: 2 })
    expect(parseTrigger('DN')).toMatchObject({ element: 0 })
    expect(parseTrigger('DE')).toMatchObject({ element: 1 })
    expect(parseTrigger('DW')).toMatchObject({ element: 3 })
    expect(parseTrigger('DA')).toMatchObject({ element: 4 })
    expect(parseTrigger('DBE')).toMatchObject({ relation: 'enemy' })
    expect(parseTrigger('DCCBA')).toMatchObject({ relation: 'ally', critical: true })
    expect(parseTrigger('DM')).toMatchObject({ range: 'melee' })
    expect(parseTrigger('DR')).toMatchObject({ range: 'ranged' })
    expect(parseTrigger('DT')).toMatchObject({ source: 'trap' })
    expect(parseTrigger('DCAC')).toMatchObject({ source: 'weapon' })
    expect(parseTrigger('DTB')).toMatchObject({ source: 'turnStart' })
    expect(parseTrigger('PD')).toMatchObject({ event: 'pushDamage' })
    expect(parseTrigger('MA')).toMatchObject({ event: 'pulled' })
    expect(parseTrigger('TP')).toMatchObject({ event: 'teleported' })
    expect(parseTrigger('MPA')).toMatchObject({ event: 'mpLoss' })
    expect(parseTrigger('H')).toMatchObject({ event: 'healed' })
    expect(parseTrigger('X')).toMatchObject({ event: 'death', lethal: false })
    expect(parseTrigger('DIS')).toMatchObject({ event: 'dispelled' })
  })

  it('codes causés par le porteur', () => {
    expect(parseTrigger('CC')).toMatchObject({ event: 'criticalHit', side: 'caster' })
    expect(parseTrigger('CI')).toMatchObject({ event: 'summon', side: 'caster' })
    expect(parseTrigger('CDF')).toMatchObject({ event: 'dealDamage', element: 2, side: 'caster' })
    expect(parseTrigger('CDS')).toMatchObject({ event: 'dealDamage', source: 'spell' })
    expect(parseTrigger('CMPAS')).toMatchObject({ event: 'mpRemovalSuccess' })
    expect(parseTrigger('CCMPARR')).toMatchObject({ event: 'mpUsed', perMp: true })
    expect(parseTrigger('CMPARR')).toMatchObject({ perMp: true, uncertain: true })
    expect(parseTrigger('K')).toMatchObject({ event: 'kill', side: 'caster' })
    expect(parseTrigger('KWS')).toMatchObject({ event: 'kill', source: 'spell' })
    expect(parseTrigger('KHE')).toMatchObject({ event: 'kill', victimType: 'human', relation: 'enemy', uncertain: true })
    expect(parseTrigger('KIE')).toMatchObject({ victimType: 'summon', relation: 'enemy' })
    expect(parseTrigger('KMA')).toMatchObject({ victimType: 'monster', relation: 'ally' })
  })

  it('préfixe X (léthal) et codes paramétrés EON / EOFF / EACT / TR / EK / EC', () => {
    expect(parseTrigger('XD')).toMatchObject({ code: 'D', event: 'damage', lethal: true, raw: 'XD' })
    expect(parseTrigger('XPD')).toMatchObject({ code: 'PD', lethal: true })
    expect(parseTrigger('XDTB')).toMatchObject({ code: 'DTB', source: 'turnStart', lethal: true })
    expect(parseTrigger('XI')).toBeNull()
    expect(parseTrigger('XXD')).toBeNull()
    expect(parseTrigger('EON98')).toMatchObject({ code: 'EON', event: 'stateGained', stateId: 98 })
    expect(parseTrigger('EOFF3645')).toMatchObject({ code: 'EOFF', event: 'stateLost', stateId: 3645 })
    expect(parseTrigger('EACT6157')).toMatchObject({ event: 'stateActivated', stateId: 6157, uncertain: true })
    expect(parseTrigger('TR15278')).toMatchObject({ event: 'threshold', spellId: 15278 })
    expect(parseTrigger('TR')).toMatchObject({ event: 'threshold' })
    expect(parseTrigger('EK:a,F2992')).toMatchObject({ event: 'entityDied', mask: 'a,F2992' })
    expect(parseTrigger('EC:>0:m,h')).toMatchObject({ event: 'entityCount', mask: 'm,h', compare: { op: '>', value: 0 } })
    expect(parseTrigger('EC:=0:g')).toMatchObject({ compare: { op: '=', value: 0 }, mask: 'g' })
  })

  it('listes, jetons inconnus et cache', () => {
    const p = parseTriggers('V|VA|VM|VE|TB|TE|D|H|PD|DTB|DTE|DV|LPU')
    expect(p.instant).toBe(false)
    expect(p.unknown).toEqual([])
    expect(p.triggers.map(t => t.code)).toEqual(['V', 'VA', 'VM', 'VE', 'TB', 'TE', 'D', 'H', 'PD', 'DTB', 'DTE', 'DV', 'LPU'])
    const q = parseTriggers('D|XD| ZZZ |EON|')
    expect(q.unknown).toEqual(['ZZZ', 'EON'])
    expect(q.triggers.length).toBe(2)
    expect(parseTriggers('D|XD')).toBe(parseTriggers('D|XD'))
    // Le masque d'EK contient des virgules : la liste n'est découpée que sur '|'.
    expect(parseTriggers('EK:i,P,F3958|X').triggers.map(t => t.code)).toEqual(['EK', 'X'])
  })
})
