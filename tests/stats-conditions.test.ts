import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyStats } from '../src/core/types'
import { emptyPrimaryStats } from '../src/stats/characteristicPoints'
import {
  criterionAtoms,
  criterionValue,
  evaluateCriterion,
  explainCriterion,
  parseCriterion,
  type CriterionContext,
} from '../src/stats/conditions'

function ctx(over: Partial<CriterionContext> = {}): CriterionContext {
  const raw = emptyStats()
  raw.ap = 7
  raw.mp = 3
  raw.summons = 1
  return {
    raw,
    base: emptyPrimaryStats(),
    additional: emptyPrimaryStats(),
    level: 200,
    breedId: 8,
    setBonusCount: 0,
    ...over,
  }
}

describe('stats/conditions — analyse', () => {
  it('atomes : code sur 2 caractères, opérateur en 3ᵉ position, valeur', () => {
    const [a] = criterionAtoms('CA>299')
    expect(a).toMatchObject({ code: 'CA', op: '>', value: '299', num: 299, text: 'CA>299' })
    const [j] = criterionAtoms('PJ>2,40')
    expect(j.code).toBe('PJ')
    expect(Number.isNaN(j.num)).toBe(true)
    const [x] = criterionAtoms('PX=A')
    expect(x.value).toBe('A')
  })

  it('& prioritaire sur |, parenthèses, cache', () => {
    const n = parseCriterion('CP<12|CM<6&CW>99')
    expect(n.kind).toBe('or')
    if (n.kind === 'or') {
      expect(n.children[0].kind).toBe('atom')
      expect(n.children[1].kind).toBe('and')
    }
    const p = parseCriterion('(CS>89&CI>89&CA>89)&(CP<12|CM<6)')
    expect(p.kind).toBe('and')
    if (p.kind === 'and') {
      expect(p.children).toHaveLength(2)
      expect(p.children[0].kind).toBe('and')
      expect(p.children[1].kind).toBe('or')
    }
    expect(parseCriterion('CP<12|CM<6')).toBe(parseCriterion('CP<12|CM<6'))
    expect(parseCriterion('').kind).toBe('true')
    expect(parseCriterion('  ').kind).toBe('true')
    expect(criterionAtoms('PZ=1&((Qa=2037&Qo>14621)|Qa=2038)').map(a => a.text)).toEqual([
      'PZ=1',
      'Qa=2037',
      'Qo>14621',
      'Qa=2038',
    ])
  })

  it('rejette les expressions mal formées', () => {
    expect(() => parseCriterion('(CA>10')).toThrow()
    expect(() => parseCriterion('CA>10)')).toThrow()
    expect(() => parseCriterion('CA')).toThrow()
    expect(() => parseCriterion('CA>1&')).toThrow()
  })

  it('analyse toutes les conditions des équipements DofusDB', () => {
    const items = JSON.parse(readFileSync(new URL('../data/dofusdb/equipment.json', import.meta.url), 'utf8')) as {
      criterions: string
    }[]
    let n = 0
    for (const i of items) {
      if (!i.criterions) continue
      expect(() => parseCriterion(i.criterions), i.criterions).not.toThrow()
      const unknown = new Set<string>()
      evaluateCriterion(i.criterions, ctx(), unknown)
      // Seul `Pn` (inconnu du client D2) n'est pas interprété.
      for (const u of unknown) expect(u.startsWith('Pn')).toBe(true)
      n++
    }
    expect(n).toBeGreaterThan(300)
  })
})

describe('stats/conditions — évaluation', () => {
  it('comparaisons strictes sur les caractéristiques totales', () => {
    const c = ctx()
    c.raw.agility = 299
    expect(evaluateCriterion('CA>299', c)).toBe(false)
    c.raw.agility = 300
    expect(evaluateCriterion('CA>299', c)).toBe(true)
    c.raw.strength = 300
    expect(evaluateCriterion('CA>299&CS>299', c)).toBe(true)
    c.raw.strength = 299
    expect(evaluateCriterion('CA>299&CS>299', c)).toBe(false)
    expect(evaluateCriterion('CS>249|CA>199', c)).toBe(true)
    c.raw.chance = 0
    expect(evaluateCriterion('CC=0', c)).toBe(true)
    expect(evaluateCriterion('CC!0', c)).toBe(false)
    expect(evaluateCriterion('CC~0', c)).toBe(true)
    c.raw.vitality = 1500
    c.raw.wisdom = 100
    c.raw.intelligence = 50
    expect(evaluateCriterion('CV>1499&CW>99&CI<100', c)).toBe(true)
  })

  it('PA/PM totaux bruts : CP<12|CM<6', () => {
    const c = ctx()
    c.raw.ap = 11
    c.raw.mp = 6
    expect(evaluateCriterion('CP<12|CM<6', c)).toBe(true)
    c.raw.ap = 12
    expect(evaluateCriterion('CP<12|CM<6', c)).toBe(false)
    c.raw.mp = 5
    expect(evaluateCriterion('CP<12|CM<6', c)).toBe(true)
    c.raw.ap = 13 // brut au-delà du plafond : toujours refusé
    c.raw.mp = 7
    expect(evaluateCriterion('CP<12|CM<6', c)).toBe(false)
    expect(evaluateCriterion('(CS>89&CI>89&CA>89)&(CP<12|CM<6)', c)).toBe(false)
  })

  it('valeurs de base (Ca…) et additionnelles (ca…)', () => {
    const c = ctx()
    c.raw.strength = 500
    c.base.strength = 398
    c.additional.strength = 100
    expect(criterionValue('CS', c)).toBe(500)
    expect(criterionValue('Cs', c)).toBe(398)
    expect(criterionValue('cs', c)).toBe(100)
    expect(evaluateCriterion('Cs>397&cs=100&CS>499', c)).toBe(true)
  })

  it('tacle et fuite totaux (⌊Agilité/10⌋ + bonus)', () => {
    const c = ctx()
    c.raw.agility = 205
    c.raw.tackleBlock = 10
    c.raw.tackleEvade = 3
    expect(criterionValue('CT', c)).toBe(30)
    expect(criterionValue('Ct', c)).toBe(23)
    // Agilité totale négative : arrondi inférieur (⌊−2,5⌋ = −3), cohérent avec finalizeStats.
    c.raw.agility = -25
    expect(criterionValue('CT', c)).toBe(-3 + 10)
    expect(criterionValue('Ct', c)).toBe(-3 + 3)
  })

  it('bonus de panoplie (Pk), niveau, classe', () => {
    expect(evaluateCriterion('Pk<3', ctx({ setBonusCount: 2 }))).toBe(true)
    expect(evaluateCriterion('Pk<3', ctx({ setBonusCount: 3 }))).toBe(false)
    expect(evaluateCriterion('PL<6', ctx({ level: 5 }))).toBe(true)
    expect(evaluateCriterion('PL<6', ctx({ level: 6 }))).toBe(false)
    expect(evaluateCriterion('PG=3', ctx({ breedId: 3 }))).toBe(true)
    expect(evaluateCriterion('PG=3', ctx({ breedId: 8 }))).toBe(false)
    expect(evaluateCriterion('PG=6&PS=0', ctx({ breedId: 6, profile: { sex: 0 } }))).toBe(true)
    expect(evaluateCriterion('PG=6&PS=0', ctx({ breedId: 6, profile: { sex: 1 } }))).toBe(false)
  })

  it('profil joueur : sexe, alignement, abonnement, progression', () => {
    expect(evaluateCriterion('PS=1', ctx())).toBe(true) // sexe inconnu ⇒ vrai
    expect(evaluateCriterion('Ps=1&Pa>20', ctx())).toBe(true)
    expect(evaluateCriterion('Ps=1&Pa>20', ctx({ profile: { alignment: 2 } }))).toBe(false)
    expect(evaluateCriterion('Ps=1&Pa>20', ctx({ profile: { alignment: 1, alignmentLevel: 21 } }))).toBe(true)
    expect(evaluateCriterion('Ps=1&Pa>20', ctx({ profile: { alignment: 1, alignmentLevel: 20 } }))).toBe(false)
    expect(evaluateCriterion('PZ=1', ctx())).toBe(true)
    expect(evaluateCriterion('PZ=1', ctx({ profile: { subscriber: false } }))).toBe(false)
    expect(evaluateCriterion('Qa=2488|Qa=2489', ctx())).toBe(true)
    expect(evaluateCriterion('PJ>2,180|PJ>24,180', ctx())).toBe(true)
    expect(evaluateCriterion('Oa>2999', ctx({ profile: { progression: false } }))).toBe(false)
  })

  it("objets d'événement, nominatifs ou inutilisables : faux", () => {
    for (const expr of ['BI=0', 'BI=1', 'PN~Silaisie&BI=1', 'PX=3|PX=5', 'OS=505', 'PO!10119', 'PK>49999', 'PE=51']) {
      expect(evaluateCriterion(expr, ctx()), expr).toBe(false)
    }
    expect(evaluateCriterion('(Sc=968&SG=08&Sd>18&Sd<27)|PX=A', ctx())).toBe(false)
  })

  it('codes ou opérateurs inconnus : vrais et signalés', () => {
    const unknown = new Set<string>()
    expect(evaluateCriterion('Zz=4&CA#3&Pn!8', ctx(), unknown)).toBe(true)
    expect([...unknown].sort()).toEqual(['CA#3', 'Pn!8', 'Zz=4'])
    const u2 = new Set<string>()
    expect(evaluateCriterion('CA>abc', ctx(), u2)).toBe(true)
    expect([...u2]).toEqual(['CA>abc'])
  })

  it('explication des atomes non remplis', () => {
    const c = ctx()
    c.raw.agility = 250
    c.raw.strength = 1258
    expect(explainCriterion('CA>299&CS>299', c)).toEqual(['CA>299 (Agilité = 250)'])
    expect(explainCriterion('Pk<3&BI=1', ctx({ setBonusCount: 4 }))).toEqual(['Pk<3 (bonus de panoplie = 4)', 'BI=1'])
    expect(explainCriterion('', c)).toEqual([])
  })
})
