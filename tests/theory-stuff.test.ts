/**
 * Theorycraft — question (1) « quel stuff est le plus intéressant contre ce boss ? » (src/theorycraft/stuff.ts,
 * formatStuff.ts ; docs/design/theorycraft.md §1.7) : amélioration contre Merkator, builds valides et déterministes,
 * aucune graine `vortex_*`, top distinct, comparaison des éléments sur un boss à élément faible, import RoxxSolver,
 * départ invalide jamais retenu, équivalences des caractéristiques, rendu texte, pureté et performance.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ELEMENT_RES_PCT, type Element } from '../src/core/types'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats } from '../src/stats/build'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { formatStuffVsBoss } from '../src/theorycraft/formatStuff'
import { DEFAULT_TOP, itemSetKey, statEquivalences, stuffVsBoss, type StuffProgress } from '../src/theorycraft/stuff'
import type { BossProfile, PerElement, StuffEvaluation } from '../src/theorycraft/types'
import { runtimeImportClosure, runtimeImports } from './import-graph-helpers'

const data = loadDataStore()
const MERKATOR = 3534
const PERE_VER = 4726
const HAREBOURG = 3416
const SOLAR = 5100
const BOUFTOU_ROYAL = 147
/** Lien partagé par l'utilisateur (Crâ, 2026-10-06), le même que tests/stuff-editor.test.ts. */
const ROXX =
  'https://roxxsolver.com/solver?build=AQGbyAL__04SSQw1SU4QNUpOETdSN1F9eTSZVfR29RuDAuN29wK2Ax5LHvGQZAUB_wEpAAgBLgABAS4AAQEuAAEBCQABAQgAAQEuAAEBKQAIASkACA&config=AQEDtg0AAwIEVgQVBgwA9AEMAAcGAPQBBgALyAAPAP9_BQmH7MP-Ifr0_WoHJv8BARsIAAEgAQABIAEAASABAAEHAQABBgEAASABAAEbCAABGwgA'
/** Recherche courte (tests qui ne portent pas sur la qualité de l'optimisation). */
const QUICK = { iterations: 0, restarts: 1 } as const

const merkator = bossProfile(data, MERKATOR)
const progress: StuffProgress[] = []
const t0 = performance.now()
// Réglages par défaut (30 000 itérations × 2 recherches) : la mesure de performance porte sur cet appel.
const cra = stuffVsBoss(data, { preset: 'cra:terre' }, merkator, { onProgress: p => progress.push(p) })
const craMs = performance.now() - t0

/** Boss aux résistances imposées (toutes phases) : un élément nettement plus faible que les autres. */
function withResistances(p: BossProfile, res: PerElement): BossProfile {
  const stats = { ...p.stats }
  res.forEach((v, el) => (stats[ELEMENT_RES_PCT[el as Element]] = v))
  return { ...p, resPct: res.slice() as PerElement, stats, phases: p.phases.map(ph => ({ ...ph, resPct: res.slice() as PerElement })) }
}

const keysOf = (list: readonly StuffEvaluation[]) => list.map(e => itemSetKey(e.build))

describe('stuffVsBoss : Crâ Terre contre Merkator (−50 % à distance)', () => {
  it('le stuff optimisé améliore logJ et PV effectifs par rapport au stuff du preset', () => {
    expect(cra.character).toMatchObject({ presetId: 'cra_terre_mono', breedId: 9, input: 'preset', melee: false, element: 'earth' })
    expect(cra.boss).toMatchObject({ monsterId: MERKATOR, grade: 1, rangedResPct: 50 })
    expect(cra.startValid).toBe(true)
    expect(cra.start.origin).toBe('start')
    expect(cra.comparison[0]).toEqual(cra.start)
    expect(cra.comparison[0].id).toBe('start')
    expect(cra.best.origin).toBe('optimized')
    expect(cra.best.logJ!).toBeGreaterThan(cra.start.logJ! + 0.01)
    expect(cra.best.survival.ehp).toBeGreaterThan(cra.start.survival.ehp)
    // Le meilleur bat aussi tous les stuffs génériques (même contexte de notation).
    for (const e of cra.comparison) if (e.logJ !== null) expect(cra.best.logJ!).toBeGreaterThanOrEqual(e.logJ)
    expect(cra.best).toEqual(cra.top[0])
  })

  it('builds valides (computeBuildStats), objets changés cohérents avec le départ', () => {
    for (const e of cra.top) {
      expect(e.valid).toBe(true)
      expect(computeBuildStats(e.build, data).valid).toBe(true)
      expect(e.sheet.valid).toBe(true)
      expect(e.items.length).toBe(e.build.items.length)
      const start = new Set(cra.start.build.items.map(i => i.itemId))
      for (const a of e.changes.added) expect(start.has(a.itemId)).toBe(false)
      for (const r of e.changes.removed) expect(e.build.items.some(i => i.itemId === r.itemId)).toBe(false)
    }
    // Dofus à sort passif du départ gardés (keepPassives, défaut).
    const passives = cra.start.items.filter(i => i.passive && i.slot === 'dofus').map(i => i.itemId)
    expect(passives.length).toBeGreaterThan(0)
    for (const id of passives) expect(cra.best.build.items.some(i => i.itemId === id)).toBe(true)
    expect(cra.options.fixed).toEqual(expect.arrayContaining(passives))
  })

  it('aucune graine ni stuff comparé `vortex_*` ; stuffs génériques notés', () => {
    expect(cra.search.seedStuffs.length).toBeGreaterThan(0)
    expect(cra.search.seedStuffs.filter(id => id.startsWith('vortex_'))).toEqual([])
    expect(cra.comparison.filter(e => e.id.includes('vortex'))).toEqual([])
    const generics = cra.comparison.filter(e => e.origin === 'generic').map(e => e.id)
    expect(generics).toEqual(expect.arrayContaining(['generic:feu', 'generic:eau', 'generic:air', 'generic:tank', 'generic:retrait']))
    // Le stuff « terre » du preset n'est pas compté deux fois.
    expect(generics).not.toContain('generic:terre')
  })

  it('top N distinct : ensembles d’objets différents, au moins 2 objets d’écart, logJ décroissants', () => {
    expect(cra.top).toHaveLength(DEFAULT_TOP)
    const keys = keysOf(cra.top)
    expect(new Set(keys).size).toBe(keys.length)
    for (let i = 1; i < cra.top.length; i++) expect(cra.top[i].logJ!).toBeLessThanOrEqual(cra.top[i - 1].logJ!)
    const diff = (a: StuffEvaluation, b: StuffEvaluation) => {
      const left = b.build.items.map(i => i.itemId)
      let n = 0
      for (const it of a.build.items) {
        const k = left.indexOf(it.itemId)
        if (k >= 0) left.splice(k, 1)
        else n++
      }
      return n
    }
    for (let i = 0; i < cra.top.length; i++) for (let j = 0; j < i; j++) expect(diff(cra.top[i], cra.top[j])).toBeGreaterThanOrEqual(cra.options.minDifferences)
  })

  it('DPT soutenu (meilleure posture) et détail par sort cohérents ; dégâts reçus par élément', () => {
    for (const e of [cra.start, ...cra.top]) {
      const d = e.damage
      expect(d.steady).toBeGreaterThan(0)
      expect(d.steady).toBeLessThanOrEqual(d.burst + 1e-6)
      expect(d.period).toBeGreaterThan(0)
      const sum = d.spells.reduce((s, x) => s + x.damagePerTurn, 0)
      expect(sum).toBeCloseTo(d.steady, 6)
      for (const s of d.spells) expect(s.damagePerTurn).toBeCloseTo(s.castsPerTurn * s.damagePerCast, 6)
      expect(d.stance.id).toBe('base')
      // Merkator frappe Terre et Eau : répartition par élément ≈ dégâts reçus exacts.
      const inc = e.survival.incomingByElement.reduce((s, x) => s + x, 0) + e.survival.incomingOther
      expect(inc).toBeGreaterThan(0)
      expect(Math.abs(inc - e.survival.incoming) / e.survival.incoming).toBeLessThan(0.15)
    }
  })

  it('équivalences des caractéristiques finies et documentées (référence : Force)', () => {
    const w = cra.statWeights
    expect(w.reference).toBe('strength')
    expect(w.notes.length).toBeGreaterThanOrEqual(2)
    expect(w.items.length).toBeGreaterThan(5)
    for (const e of w.items) {
      expect(Number.isFinite(e.perPoint) && e.perPoint > 0).toBe(true)
      expect(e.inReference !== null && Number.isFinite(e.inReference)).toBe(true)
      expect(e.text).toMatch(/≈ .* Force$/)
    }
    const ap = w.items.find(e => e.stat === 'ap')!
    expect(ap.text).toMatch(/^1 PA \(sous le plafond\) ≈ /)
    // Un PA vaut bien plus qu'un point de Force ; un point de Force vaut 1 Force.
    expect(ap.inReference!).toBeGreaterThan(50)
    expect(w.items.find(e => e.stat === 'strength')!.inReference).toBeCloseTo(1, 9)
  })

  it('hypothèses et avertissements portés par le résultat ; sérialisable en JSON', () => {
    expect(cra.assumptions.join('\n')).toMatch(/Jets max/)
    expect(cra.assumptions.join('\n')).toMatch(/arme non lancée/)
    expect(cra.assumptions.join('\n')).toMatch(/passif/)
    expect(cra.assumptions.join('\n')).toMatch(/CLASSEMENTS/)
    expect(cra.assumptions.some(a => a.startsWith('Boss : '))).toBe(true)
    expect(cra.warnings.some(w => /3\.6/.test(w))).toBe(true)
    expect(JSON.parse(JSON.stringify(cra))).toEqual(cra)
  })

  it('performance mesurée : réglages par défaut < 15 s pour un preset ; avancement signalé', () => {
    expect(craMs).toBeLessThan(15_000)
    expect(cra.search.runs).toBe(2)
    expect(progress.filter(p => p.step === 'optimize')).toHaveLength(cra.search.runs)
  })
})

describe('stuffVsBoss : déterminisme et options', () => {
  it('deux appels identiques rendent les mêmes stuffs et les mêmes notes', () => {
    const opts = { iterations: 2000, restarts: 1, top: 3 }
    const a = stuffVsBoss(data, { preset: 'iop_terre_burst' }, merkator, opts)
    const b = stuffVsBoss(data, { preset: 'iop_terre_burst' }, merkator, opts)
    expect(keysOf(a.top)).toEqual(keysOf(b.top))
    expect(a.top.map(e => e.logJ)).toEqual(b.top.map(e => e.logJ))
    expect(a.top.map(e => e.damage.steady)).toEqual(b.top.map(e => e.damage.steady))
    expect(a.character.melee).toBe(true)
    expect(a.top).toHaveLength(3)
  })

  it('elements « all » : 4 entrées, l’élément retenu est l’élément nettement plus faible du boss', () => {
    // Comte Harebourg aux résistances imposées : Feu −20 %, tous les autres éléments 40 %.
    const fireWeak = withResistances(bossProfile(data, HAREBOURG), [40, 40, -20, 40, 40])
    const r = stuffVsBoss(data, { preset: 'cra_terre_mono' }, fireWeak, { elements: 'all' })
    expect(r.elements).toHaveLength(4)
    expect(r.elements!.map(e => e.element)).toEqual(['earth', 'fire', 'water', 'air'])
    expect(r.elements!.find(e => e.element === 'fire')!.bossResPct).toBe(-20)
    const chosen = r.elements!.filter(e => e.chosen)
    expect(chosen.map(e => e.element)).toEqual(['fire'])
    for (const e of r.elements!) expect(chosen[0].best.logJ!).toBeGreaterThanOrEqual(e.best.logJ!)
    expect(r.best.element).toBe('fire')
    expect(r.search.runs).toBe(4)
  })

  it('import RoxxSolver (lien réel) évalué contre un boss : parchemins complétés et signalés, preset de la classe', () => {
    const r = stuffVsBoss(data, { roxx: ROXX }, merkator, QUICK)
    expect(r.character).toMatchObject({ breedId: 9, input: 'roxx', level: 200 })
    expect(r.start.origin).toBe('user')
    expect(r.start.valid).toBe(true)
    expect(r.start.scrolls).toEqual({ vitality: 100, wisdom: 100, strength: 100, intelligence: 100, chance: 100, agility: 100 })
    expect(r.start.points).toEqual({ strength: 300, intelligence: 495, chance: 100, agility: 100 })
    expect(r.warnings.some(w => /parchemins.*100 partout/.test(w))).toBe(true)
    expect(r.assumptions.some(a => a.includes(`preset « ${r.character.presetId} »`))).toBe(true)
    // Stuff du preset comparé, sans doublon avec les génériques.
    const ids = r.comparison.map(e => e.id)
    expect(ids[0]).toBe('user')
    expect(ids).toContain('preset')
    expect(new Set(r.comparison.map(e => itemSetKey(e.build))).size).toBe(r.comparison.length)
    expect(r.best.valid).toBe(true)
    expect(r.start.damage.steady).toBeGreaterThan(0)
    // Sans complément, les parchemins restent à 0 (comme le lien).
    const raw = stuffVsBoss(data, { roxx: ROXX }, merkator, { ...QUICK, fillScrolls: false, top: 1 })
    expect(Object.values(raw.start.scrolls).every(v => !v)).toBe(true)
    expect(raw.start.survival.hp).toBeLessThan(r.start.survival.hp)
  })

  it('build fourni : variantes du preset désigné, départ = stuff de l’utilisateur', () => {
    const own = cra.top[1].build
    const r = stuffVsBoss(data, { build: own, presetId: 'cra_terre_mono' }, merkator, { ...QUICK, top: 2 })
    expect(r.character.input).toBe('build')
    expect(r.start.origin).toBe('user')
    expect(r.start.logJ).toBeCloseTo(cra.top[1].logJ!, 9)
    expect(r.best.logJ!).toBeGreaterThanOrEqual(r.start.logJ!)
  })

  it('départ invalide (stuff 200 au niveau 30) jamais présenté comme meilleur : Bouftou Royal', () => {
    const r = stuffVsBoss(data, { preset: 'iop_terre_burst' }, bossProfile(data, BOUFTOU_ROYAL), { ...QUICK, level: 30, top: 2 })
    expect(r.startValid).toBe(false)
    expect(r.start.valid).toBe(false)
    expect(r.start.logJ).toBeNull()
    expect(r.best.valid).toBe(true)
    expect(r.best.origin).toBe('optimized')
    for (const it of r.best.build.items) expect(data.item(it.itemId)!.level).toBeLessThanOrEqual(30)
    // Stuffs génériques de niveau 200 non évalués (signalé), Dofus à passif du départ non imposés (trop hauts).
    expect(r.comparison).toHaveLength(1)
    expect(r.assumptions.some(a => /génériques non évalués/.test(a))).toBe(true)
    expect(r.options.fixed).toEqual([])
    expect(r.warnings.some(w => /départ est invalide/.test(w))).toBe(true)
  })

  it('Père Ver (invulnérable à distance) : Crâ sans dégâts, signalé ; référence des équivalences = Vitalité', () => {
    const r = stuffVsBoss(data, { preset: 'cra_terre_mono' }, bossProfile(data, PERE_VER), { ...QUICK, top: 1 })
    expect(r.best.damage.steady).toBe(0)
    expect(r.warnings.some(w => /DPT soutenu nul/.test(w))).toBe(true)
    expect(r.statWeights.reference).toBe('vitality')
  })

  it('Zobal : meilleure posture dans le DPT soutenu, écart avec le proxy sans posture signalé', () => {
    const r = stuffVsBoss(data, { preset: 'zobal_psychopathe' }, bossProfile(data, SOLAR), { ...QUICK, top: 1 })
    expect(r.best.damage.stance.id).not.toBe('base')
    expect(r.best.damage.steady).toBeGreaterThan(1000)
    expect(r.warnings.some(w => /Posture de classe/.test(w))).toBe(true)
  })
})

describe('statEquivalences', () => {
  it('référence = caractéristique principale, sinon élémentaire la plus utile, sinon Vitalité, sinon aucune', () => {
    const main = statEquivalences({ strength: 0.001, ap: 0.5, vitality: 0.0005, fireResPct: 0 }, 'earth')
    expect(main.reference).toBe('strength')
    expect(main.items.map(i => i.stat)).toEqual(['ap', 'strength', 'vitality'])
    expect(main.items[0].inReference).toBeCloseTo(500, 9)
    expect(main.items[0].perRuneWeight).toBeCloseTo(5, 9) // PA : poids 100 par point, Force : 1.
    // Sram Air de bas niveau : l'Agilité ne vaut rien, la Force si.
    const other = statEquivalences({ agility: 0, strength: 0.002, chance: 0.001, ap: 0.2, vitality: 0.001 }, 'air')
    expect(other.reference).toBe('strength')
    expect(other.items[0].text).toBe('1 PA (sous le plafond) ≈ 100 Force')
    expect(other.notes.some(n => /Agilité.*Force/.test(n))).toBe(true)
    const vit = statEquivalences({ strength: 0, vitality: 0.002, earthResPct: 0.01 }, 'earth')
    expect(vit.reference).toBe('vitality')
    expect(vit.items[0].text).toBe('1 % Résistance Terre ≈ 5 Vitalité')
    const none = statEquivalences({ strength: 0, vitality: 0 }, 'fire')
    expect(none.items).toEqual([])
    expect(none.notes.some(n => /Aucune caractéristique de référence/.test(n))).toBe(true)
  })
})

describe('formatStuffVsBoss', () => {
  it('rendu texte français : boss, comparaison, meilleur stuff, sorts, équivalences, hypothèses', () => {
    const text = formatStuffVsBoss(cra)
    for (const s of ['Stuff contre Merkator (3534)', 'réduction distance 50 %', 'Comparaison', 'Meilleur stuff', 'Objets :', 'Objets changés', 'DPT soutenu par sort', 'Équivalences des caractéristiques', 'Hypothèses', 'Recherche :'])
      expect(text).toContain(s)
    expect(text).toContain(cra.best.items[0].name)
    expect(text).toContain(cra.best.damage.spells[0].name)
    expect(text).not.toMatch(/undefined|NaN|\[object/)
  })

  it('module pur : aucun import d’exécution', () => {
    const src = readFileSync(new URL('../src/theorycraft/formatStuff.ts', import.meta.url), 'utf8')
    expect(runtimeImports(src)).toEqual([])
  })
})

describe('pureté', () => {
  it('stuff.ts n’importe pas src/dungeons directement ; index.ts ne tire ni stuff.ts ni le proxy', () => {
    const src = readFileSync(new URL('../src/theorycraft/stuff.ts', import.meta.url), 'utf8')
    expect(runtimeImports(src).filter(s => /dungeons|node:/.test(s))).toEqual([])
    const index = runtimeImportClosure(['src/theorycraft/index.ts']).files
    expect(index).not.toContain('src/theorycraft/stuff.ts')
    expect(index).not.toContain('src/optimizer/stuff/proxy.ts')
  })
})
