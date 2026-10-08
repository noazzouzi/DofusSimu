/**
 * Theorycraft — question (1) « quel stuff est le plus intéressant contre ce boss ? » (src/theorycraft/stuff.ts,
 * formatStuff.ts ; docs/design/theorycraft.md §1.7) : amélioration contre Merkator, builds valides et déterministes,
 * aucune graine `vortex_*`, top distinct et trié, comparaison des éléments sur un boss à élément faible (équivalences
 * dans l'élément retenu), import RoxxSolver (pénalité de PO décisive signalée, PO visée réglable), départ invalide
 * jamais retenu, classes à posture classées par le logJ soutenu (Zobal contre le Père Ver), Crâ au contact contre le
 * Père Ver, objets exclus jamais proposés (références comprises), objets imposés ET exclus refusés, retrait sans valeur
 * signalé, preset de repli d'un build signalé, élément de recherche sans sort dans la rotation signalé, équivalences
 * des caractéristiques (part des pénalités séparée ; PA sur le DPT soutenu), rendu texte, pureté (dépendances
 * transitives figées) et performance.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ELEMENT_RES_PCT, type Element } from '../src/core/types'
import { allocatePoints, getPreset, presetBuild, STUFFS } from '../src/optimizer/team/presets'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats } from '../src/stats/build'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { formatStuffVsBoss } from '../src/theorycraft/formatStuff'
import { DEFAULT_TOP, itemSetKey, statEquivalences, stuffVsBoss, type StuffProgress } from '../src/theorycraft/stuff'
import type { BossProfile, PerElement, StuffEvaluation, StuffVsBossResult } from '../src/theorycraft/types'
import { runtimeImportClosure, runtimeImports } from './import-graph-helpers'

const data = loadDataStore()
const MERKATOR = 3534
const PERE_VER = 4726
const HAREBOURG = 3416
const SOLAR = 5100
const VORTEX = 3835
const BOUFTOU_ROYAL = 147
const KOULOSSE = 670
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
/** Score de classement d'un stuff dans son résultat (logJ du proxy, ou logJ soutenu). */
const rankOf = (r: StuffVsBossResult, e: StuffEvaluation) => (r.ranking.by === 'sustained' ? e.logJSustained : e.logJ)

describe('stuffVsBoss : Crâ Terre contre Merkator (−50 % à distance)', () => {
  it('le stuff optimisé améliore logJ et PV effectifs par rapport au stuff du preset', () => {
    // Joué au contact : tout son DPT soutenu passe par des coups au contact, que Merkator subit mieux (style, target.ts).
    expect(cra.character).toMatchObject({ presetId: 'cra_terre_mono', breedId: 9, input: 'preset', melee: true, element: 'earth' })
    expect(cra.character.style).toMatchObject({ contact: true, source: 'dpt' })
    expect(cra.options.rangeNeed).toBe(0)
    expect(cra.boss).toMatchObject({ monsterId: MERKATOR, grade: 1, rangedResPct: 50 })
    expect(cra.startValid).toBe(true)
    expect(cra.start.origin).toBe('start')
    expect(cra.comparison[0]).toEqual(cra.start)
    expect(cra.comparison[0].id).toBe('start')
    expect(cra.ranking.by).toBe('proxy')
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
    // Les graines `vortex_*` ont bien été PROPOSÉES par l'optimiseur et écartées par le filtre (pas seulement absentes).
    const vortexIds = Object.keys(STUFFS).filter(id => id.startsWith('vortex_'))
    expect(vortexIds.length).toBeGreaterThan(40)
    expect(cra.search.excludedSeeds).toEqual(expect.arrayContaining(vortexIds))
    expect(cra.search.seedStuffs.filter(id => cra.search.excludedSeeds.includes(id))).toEqual([])
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

  it('équivalences des caractéristiques finies et documentées (référence : Force), pénalités d’objectif à part', () => {
    const w = cra.statWeights
    expect(w.reference).toBe('strength')
    expect(w.notes.length).toBeGreaterThanOrEqual(2)
    expect(w.notes.some(n => /pénalités de l’objectif/.test(n))).toBe(true)
    expect(w.items.length).toBeGreaterThan(5)
    for (const e of w.items) {
      expect(Number.isFinite(e.perPoint) && e.perPoint > 0).toBe(true)
      expect(e.inReference !== null && Number.isFinite(e.inReference)).toBe(true)
      expect(e.text).toMatch(e.objectivePenalty ? /≈ .* Force, dont .* de pénalité d’objectif \(.* pour les effets modélisés\)$/ : /≈ .* Force$/)
    }
    const ap = w.items.find(e => e.stat === 'ap')!
    expect(ap.text).toMatch(/^1 PA \(sous le plafond\) ≈ /)
    // La pénalité de l'objectif (×0,85 par PA manquant : ln(1/0,85) par point) est séparée de la part modélisée, qui
    // reste nettement positive (un PA de plus = plus de sorts lancés) : un PA vaut bien plus qu'un point de Force.
    expect(ap.objectivePenalty!).toBeCloseTo(-Math.log(0.85), 9)
    expect(ap.modeledInReference!).toBeGreaterThan(50)
    expect(ap.modeledInReference!).toBeLessThan(ap.inReference!)
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
    // Équivalences dans l'élément RETENU (contexte du proxy construit au meilleur stuff, pas au départ Terre).
    expect(r.statWeights.reference).toBe('intelligence')
    expect(r.statWeights.notes.some(n => /principale .*ne vaut rien/.test(n))).toBe(false)
    expect(r.statWeights.items.find(e => e.stat === 'ap')!.modeledInReference!).toBeGreaterThan(0)
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

  it('RoxxSolver 12/6/0 : la pénalité de PO, seule, place le stuff de l’utilisateur derrière — signalé ; PO visée réglable', () => {
    const harebourg = bossProfile(data, HAREBOURG)
    const r = stuffVsBoss(data, { roxx: ROXX }, harebourg, { ...QUICK, top: 2 })
    expect(r.start.range).toBe(0)
    expect(r.start.penalty).toBeCloseTo(0.95 ** 6, 9)
    expect(r.options.rangeNeed).toBe(6)
    const noPen = (e: StuffEvaluation) => e.logJ! - Math.log(e.penalty)
    // Sans pénalités, le stuff de l'utilisateur passerait devant le meilleur : avertissement chiffré, bonus de PO du Crâ cités.
    expect(r.best.logJ!).toBeGreaterThan(r.start.logJ!)
    expect(noPen(r.start)).toBeGreaterThan(noPen(r.best))
    const w = r.warnings.find(x => /Pénalités d'objectif décisives/.test(x))
    expect(w).toMatch(/12\/6\/0/)
    expect(w).toMatch(/Tirs Éloignés/)
    expect(w).toMatch(/--range N en ligne de commande \(option rangeNeed de l’API\)/)
    // Le tableau texte montre la pénalité de chaque ligne.
    const text = formatStuffVsBoss(r)
    expect(text).toMatch(/Pénalité/)
    expect(text).toContain('×0,735')
    // PO visée abaissée (bonus de PO de la classe) : plus de pénalité de PO.
    const low = stuffVsBoss(data, { roxx: ROXX }, harebourg, { ...QUICK, top: 1, rangeNeed: 0 })
    expect(low.options.rangeNeed).toBe(0)
    expect(low.start.penalty).toBe(1)
    expect(low.start.logJ!).toBeCloseTo(noPen(r.start), 9)
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
    // Le boss inflige ~4 par tour : PVe plafonnés à 20 × PV ; la survie ne départage plus que par les PV bruts (dit).
    expect(r.best.survival.capped).toBe(true)
    expect(r.warnings.some(w => /plafonnés.*PV bruts/.test(w))).toBe(true)
  })

  it('Père Ver (invulnérable à distance) : le Crâ frappe au contact (sorts de PO 1 à N), joué au contact — PO non exigée', () => {
    const r = stuffVsBoss(data, { preset: 'cra_terre_mono' }, bossProfile(data, PERE_VER), { ...QUICK, top: 1 })
    expect(r.best.damage.steady).toBeGreaterThan(1000)
    expect(r.best.damage.spells.map(s => s.name)).toContain('Flèche Vagabonde')
    expect(r.warnings.some(w => /DPT soutenu nul/.test(w))).toBe(false)
    expect(r.statWeights.reference).toBe('strength')
    // Boss attaquable seulement au contact : même règle que la comparaison des classes (`playsMelee`).
    expect(r.character.melee).toBe(true)
    expect(r.options.rangeNeed).toBe(0)
    expect(r.assumptions.join(' ')).toMatch(/joué au contact \(PO non exigée\)/)
    const forge = stuffVsBoss(data, { preset: 'forgelance_zone_terre' }, bossProfile(data, PERE_VER), { ...QUICK, top: 1 })
    expect([forge.character.melee, forge.options.rangeNeed]).toEqual([true, 0])
    expect(forge.statWeights.items.find(i => i.stat === 'range')).toBeUndefined()
  })

  it('Zobal : meilleure posture dans le DPT soutenu, écart avec le proxy sans posture signalé', () => {
    const r = stuffVsBoss(data, { preset: 'zobal_psychopathe' }, bossProfile(data, SOLAR), { ...QUICK, top: 1 })
    expect(r.best.damage.stance.id).not.toBe('base')
    expect(r.best.damage.steady).toBeGreaterThan(1000)
    expect(r.warnings.some(w => /Posture de classe/.test(w))).toBe(true)
  })

  it('Zobal contre le Père Ver (proxy presque aveugle sans posture) : classement soutenu, le meilleur garde son DPT soutenu', () => {
    const r = stuffVsBoss(data, { preset: 'zobal_psychopathe' }, bossProfile(data, PERE_VER), { ...QUICK, top: 3 })
    expect(r.start.damage.proxy).toBeLessThan(0.3 * r.start.damage.steady)
    expect(r.start.damage.steady).toBeGreaterThan(1000)
    expect(r.ranking.by).toBe('sustained')
    expect(r.ranking.reason).toMatch(/logJ SOUTENU/)
    // Avant correction : « meilleur » stuff à 464 de DPT soutenu contre 1 852 au départ (−75 %), tout en survie.
    expect(r.best.damage.steady).toBeGreaterThanOrEqual(0.85 * r.start.damage.steady)
    expect(r.best.logJSustained!).toBeGreaterThanOrEqual(r.start.logJSustained!)
    for (let i = 1; i < r.top.length; i++) expect(r.top[i].logJSustained!).toBeLessThanOrEqual(r.top[i - 1].logJSustained!)
    // logJ soutenu = logJ du proxy avec le terme de DPT remplacé (même PVe, UTIL et pénalités) : le proxy, sans posture,
    // ne voit qu'une petite part des dégâts (coups au contact sans masque).
    expect(r.start.logJSustained! - r.start.logJ!).toBeGreaterThan(0.5)
    // La caractéristique principale vaut quelque chose (DPT soutenu en posture), pas « aucun dégât ».
    expect(r.statWeights.reference).toBe('strength')
    expect(r.statWeights.notes.some(n => /principale .*ne vaut rien/.test(n))).toBe(false)
    expect(r.statWeights.notes.some(n => /Classement soutenu/.test(n))).toBe(true)
    expect(r.search.polish).toBeDefined()
    for (const e of r.top) expect(computeBuildStats(e.build, data).valid).toBe(true)
    // Objets imposés (Dofus à passif du départ) portés par tous les stuffs proposés, affinés compris.
    for (const e of r.top) for (const id of r.options.fixed) expect(e.build.items.some(i => i.itemId === id)).toBe(true)
    // Affinage déterministe.
    const again = stuffVsBoss(data, { preset: 'zobal_psychopathe' }, bossProfile(data, PERE_VER), { ...QUICK, top: 3 })
    expect(keysOf(again.top)).toEqual(keysOf(r.top))
    expect(again.top.map(e => e.logJSustained)).toEqual(r.top.map(e => e.logJSustained))
  })

  it('top trié par le score de classement même avec une recherche courte (second passage du tri distinct)', () => {
    for (const preset of ['zobal_psychopathe', 'enutrof_retrait_pm_eau']) {
      const r = stuffVsBoss(data, { preset }, bossProfile(data, VORTEX), { ...QUICK, top: 3 })
      const ranks = r.top.map(e => rankOf(r, e)!)
      for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1])
      expect(r.best).toEqual(r.top[0])
    }
  })

  it('objets exclus : jamais dans le meilleur ni le top, stuffs de référence compris (affinage soutenu aussi) ; imposés ET exclus refusés', () => {
    // Zobal Psychopathe contre le Père Ver : classement soutenu (affinage depuis les meilleurs stuffs) ; 19244 fait
    // partie du stuff du preset.
    const verZ = bossProfile(data, PERE_VER)
    const plain = stuffVsBoss(data, { preset: 'zobal_psychopathe' }, verZ, { ...QUICK, top: 3 })
    expect(plain.start.build.items.some(i => i.itemId === 19244)).toBe(true)
    const r = stuffVsBoss(data, { preset: 'zobal_psychopathe' }, verZ, { ...QUICK, top: 5, exclude: [19244] })
    expect(r.options.exclude).toEqual([19244])
    expect(r.ranking.by).toBe('sustained')
    for (const e of [r.best, ...r.top]) expect(e.build.items.some(i => i.itemId === 19244), e.label).toBe(false)
    // Le stuff du preset (départ) reste affiché dans la comparaison, écarté du classement (dit).
    expect(r.comparison[0].build.items.some(i => i.itemId === 19244)).toBe(true)
    expect(r.assumptions.join(' ')).toMatch(/Stuffs de référence écartés du classement \(objet exclu\) : Stuff du preset/)
    expect(() => stuffVsBoss(data, { preset: 'cra_terre_mono' }, merkator, { ...QUICK, fixed: [15746], exclude: [15746] })).toThrow(/Objets à la fois imposés et exclus : .*\(15746\)/)
  })

  it('retrait sans valeur contre ce boss : utilité du rôle ignorée dans l’objectif, signalé (Enutrof retrait PM contre Merkator)', () => {
    const r = stuffVsBoss(data, { preset: 'enutrof_retrait_pm_eau' }, merkator, { ...QUICK, top: 1 })
    expect(r.best.util).toBe(0)
    expect(r.start.util).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/Retrait PM sans valeur contre ce boss \(le boss punit le retrait de PM\) : utilité du rôle ignorée/)
  })

  it('build sans preset de son élément : preset de repli signalé en avertissement (Féca Air)', () => {
    const feca = getPreset('feca_glyphes')
    const build = presetBuild(feca, data, { stuff: 'air' })
    build.characteristicPoints = allocatePoints({ ...feca.points, primary: 'agility' }, feca.breedId, data, 200)
    const r = stuffVsBoss(data, { build }, merkator, { ...QUICK, top: 1 })
    expect(r.character.element).toBe('air')
    expect(r.warnings.join(' ')).toMatch(/Aucun preset Air pour la classe Féca \(élément du build\) : preset « feca_\w+ » \(.*, rôle .*\) pris par défaut .*--class <preset>/)
    expect(r.assumptions.join(' ')).not.toMatch(/élément Air du build/)
  })

  it('recherche limitée à l’élément du preset sans sort de cet élément dans la rotation : signalé, chiffré (Sram Air niveau 40)', () => {
    const r = stuffVsBoss(data, { preset: 'sram_air_poisons' }, bossProfile(data, BOUFTOU_ROYAL), { ...QUICK, top: 1, level: 40 })
    expect(r.statWeights.reference).not.toBe('agility')
    expect(r.warnings.join(' ')).toMatch(/Aucun sort Air dans la rotation du meilleur stuff contre ce boss \(.* \d+ %.*\) : .*--elements all/)
    // Recherche dans tous les éléments : pas d'avertissement.
    expect(stuffVsBoss(data, { preset: 'sram_air_poisons' }, bossProfile(data, BOUFTOU_ROYAL), { ...QUICK, top: 1, level: 40, elements: 'all' }).warnings.join(' ')).not.toMatch(/Aucun sort Air/)
  })

  it('équivalences : la part des dégâts d’un PA vient du DPT soutenu (Iop Terre contre Merkator : la rafale évolue par paliers)', () => {
    const r = stuffVsBoss(data, { preset: 'iop_terre_burst' }, merkator, { ...QUICK, top: 1 })
    expect(r.ranking.by).toBe('proxy')
    const ap = r.statWeights.items.find(i => i.stat === 'ap')!
    expect(ap.modeledInReference!).toBeGreaterThan(10)
    expect(r.statWeights.notes.some(n => /^PA : la part des dégâts vient du DPT soutenu/.test(n))).toBe(true)
    // Hypothèses : Dofus à sort passif seulement imposés ; dégâts du boss = estimation (pas une borne).
    const a = r.assumptions.join(' ')
    expect(a).toMatch(/les Dofus à sort passif du départ sont gardés imposés/)
    expect(a).not.toMatch(/borne haute/)
    expect(a).toMatch(/le total peut être sous-estimé/)
  })

  it('le meilleur stuff qui perd du DPT soutenu par rapport au départ est signalé, chiffré', () => {
    // Zobal Rempart (tank : a = 0,2, b = 0,8) contre le Comte Harebourg : la survie l'emporte sur les dégâts.
    const r = stuffVsBoss(data, { preset: 'zobal_rempart' }, bossProfile(data, HAREBOURG), { ...QUICK, top: 1 })
    const loss = 1 - r.best.damage.steady / r.start.damage.steady
    expect(loss).toBeGreaterThan(0.15)
    expect(r.warnings.some(w => w.includes(`perd ${Math.round(100 * loss)} % de DPT soutenu`))).toBe(true)
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

  it('PA/PM/PO : part des pénalités d’objectif séparée ; « aucun dégât » seulement sans DPT soutenu ; jamais « -0 »', () => {
    const pen = -Math.log(0.85)
    const w = statEquivalences({ strength: 0.001, ap: pen + 0.2, mp: -Math.log(0.9) }, 'earth', { penalties: { ap: pen, mp: -Math.log(0.9) }, steady: 1500 })
    const ap = w.items.find(i => i.stat === 'ap')!
    expect(ap.objectivePenalty).toBeCloseTo(pen, 12)
    expect(ap.modeledInReference).toBeCloseTo(200, 9)
    expect(ap.text).toBe(`1 PA (sous le plafond) ≈ ${Math.round((pen + 0.2) / 0.001)} Force, dont ${Math.round(pen / 0.001)} de pénalité d’objectif (200 pour les effets modélisés)`)
    const mp = w.items.find(i => i.stat === 'mp')!
    expect(mp.modeledInReference).toBeCloseTo(0, 9)
    expect(mp.text).toMatch(/\(0 pour les effets modélisés\)$/)
    expect(mp.text).not.toMatch(/-0/)
    // Référence en Vitalité alors que le DPT soutenu n'est pas nul : pas de « aucun dégât ».
    const vit = statEquivalences({ strength: 0, vitality: 0.002 }, 'earth', { steady: 900 })
    expect(vit.reference).toBe('vitality')
    expect(vit.notes.some(n => /aucun dégât/.test(n))).toBe(false)
  })
})

describe('formatStuffVsBoss', () => {
  it('rendu texte français : boss, comparaison, meilleur stuff, sorts, équivalences, hypothèses', () => {
    const text = formatStuffVsBoss(cra)
    for (const s of ['Stuff contre Merkator (3534)', 'réduction distance 50 %', 'Comparaison', 'Pénalité', cra.ranking.reason, 'Meilleur stuff', 'Objets :', 'Objets changés', 'DPT soutenu par sort', 'Équivalences des caractéristiques', 'Hypothèses', 'Recherche :'])
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

  it('dépendances TRANSITIVES de stuff.ts vers src/dungeons : seulement celles du proxy et de l’optimiseur, liste figée (en-tête)', () => {
    const dungeons = (entries: string[]) => runtimeImportClosure(entries).files.filter(f => f.startsWith('src/dungeons/'))
    const mine = dungeons(['src/theorycraft/stuff.ts'])
    // stuff.ts n'ajoute rien à ce que tirent déjà proxy.ts et search.ts…
    expect(mine.filter(f => !dungeons(['src/optimizer/stuff/proxy.ts', 'src/optimizer/stuff/search.ts']).includes(f))).toEqual([])
    // … et toute nouvelle dépendance au Vortex (ou à un autre donjon) fait échouer ce test : à documenter dans l'en-tête.
    const known = [
      'src/dungeons/generic/dummy.ts',
      'src/dungeons/generic/skirmish.ts',
      'src/dungeons/vortex/clock.ts',
      'src/dungeons/vortex/constants.ts',
      'src/dungeons/vortex/params.ts',
      'src/dungeons/vortex/placement.ts',
      'src/dungeons/waves.ts',
    ]
    expect(mine.filter(f => !known.includes(f))).toEqual([])
    expect(runtimeImportClosure(['src/theorycraft/stuff.ts']).external.filter(e => e.spec.startsWith('node:'))).toEqual([])
  })
})
