/**
 * Theorycraft — classement des classes contre un boss (src/theorycraft/classes.ts, docs/design/theorycraft.md §1.8) et
 * rendus texte (formatBoss.ts, formatClasses.ts) : invulnérabilité à distance du Père Ver (la mêlée passe devant le
 * Crâ, premier contre le Comte Harebourg), élément faible du boss (un même Crâ Feu / Terre s'inverse quand on inverse les
 * résistances), postures (Zobal, Forgelance, Pandawa > 0), composition à règles explicites, repli des résistances
 * extrêmes (Kimbo), bas niveau sans équipement, mode « optimized » (2 presets), déterminisme et performance.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { BASE_PRESETS, getPreset, presetMember } from '../src/optimizer/team/presets'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { COMPOSITION_RULES, rankClasses } from '../src/theorycraft/classes'
import { bossFighter, playerFighterFromMember, theoryDptTable } from '../src/theorycraft/fighters'
import { formatBoss } from '../src/theorycraft/formatBoss'
import { formatClasses } from '../src/theorycraft/formatClasses'
import { sustainedDamage } from '../src/theorycraft/rotation'
import type { BossProfile, ClassRanking, PerElement, PresetEvaluation } from '../src/theorycraft/types'

const data = loadDataStore()
const HAREBOURG = 3416
const PERE_VER = 4726
const MERKATOR = 3534
const KIMBO = 1045
const BOUFTOU_ROYAL = 147

const byId = (r: ClassRanking, id: string): PresetEvaluation => r.presets.find(e => e.presetId === id)!
const rankOf = (r: ClassRanking, className: string) => r.axes.find(a => a.axis === 'damage')!.entries.findIndex(e => e.className === className)

let harebourg: ClassRanking
let pereVer: ClassRanking
let merkator: ClassRanking

beforeAll(() => {
  harebourg = rankClasses(data, bossProfile(data, HAREBOURG))
  pereVer = rankClasses(data, bossProfile(data, PERE_VER))
  merkator = rankClasses(data, bossProfile(data, MERKATOR))
})

describe('classement des classes', () => {
  it('49 presets, 19 classes, 5 axes ; aucune note globale', () => {
    expect(harebourg.presets).toHaveLength(BASE_PRESETS.length)
    expect(harebourg.classes).toHaveLength(19)
    expect(harebourg.axes.map(a => a.axis)).toEqual(['damage', 'survival', 'control', 'heal', 'team'])
    for (const a of harebourg.axes) {
      expect(a.entries).toHaveLength(19)
      for (let i = 1; i < a.entries.length; i++) expect(a.entries[i - 1].value).toBeGreaterThanOrEqual(a.entries[i].value)
    }
    for (const e of harebourg.presets) {
      expect(Object.keys(e.axes).sort()).toEqual(['control', 'damage', 'heal', 'survival', 'team'])
      expect(e.dpt.steady).toBeLessThanOrEqual(e.dpt.burst + 1e-6)
      expect(e.survival.ehp).toBeGreaterThan(0)
    }
  })

  it('Père Ver (invulnérable à distance) : un preset de mêlée passe devant tous les Crâ sur l\'axe Dégâts', () => {
    // Contre le Comte Harebourg (attaquable à distance), le Crâ est dans le peloton de tête…
    expect(rankOf(harebourg, 'Crâ')).toBeLessThan(3)
    // … contre le Père Ver, tous ses presets tombent derrière l'Iop et la Forgelance (mêlée).
    const craBest = Math.max(...pereVer.presets.filter(e => e.className === 'Crâ').map(e => e.dpt.steady))
    expect(craBest).toBeLessThan(0.25 * byId(pereVer, 'iop_terre_burst').dpt.steady)
    expect(rankOf(pereVer, 'Iop')).toBeLessThan(rankOf(pereVer, 'Crâ'))
    expect(pereVer.axes[0].entries[0].className).not.toBe('Crâ')
    // Atout « mêlée » mesuré (forme du DPT) pour l'Iop.
    expect(byId(pereVer, 'iop_terre_burst').relevance.atouts.some(a => /^Mêlée/.test(a))).toBe(true)
    expect(byId(pereVer, 'cra_terre_mono').relevance.limites.some(l => /^Distance/.test(l))).toBe(true)
  })

  it('élément faible : le même Crâ en Feu et en Terre s\'inverse quand on inverse les résistances du boss', () => {
    const base = bossProfile(data, HAREBOURG)
    const withRes = (res: PerElement): BossProfile => {
      const p = structuredClone(base) as BossProfile
      p.resPct = res.slice() as PerElement
      for (const ph of p.phases) ph.resPct = res.slice() as PerElement
      p.weakestElements = [0, 1, 2, 3, 4].sort((a, b) => res[a] - res[b] || a - b)
      return p
    }
    const presets = [getPreset('cra_feu_zone'), getPreset('cra_terre_mono')]
    const fireWeak = rankClasses(data, withRes([20, 50, -10, 20, 20]), { presets })
    const earthWeak = rankClasses(data, withRes([20, -10, 50, 20, 20]), { presets })
    const ratio = (r: ClassRanking) => byId(r, 'cra_feu_zone').dpt.steady / byId(r, 'cra_terre_mono').dpt.steady
    expect(ratio(fireWeak)).toBeGreaterThan(1)
    expect(ratio(earthWeak)).toBeLessThan(1)
    expect(ratio(fireWeak) / ratio(earthWeak)).toBeGreaterThan(2)
    expect(byId(fireWeak, 'cra_feu_zone').elementMatch).toMatchObject({ element: 2, resPct: -10, rank: 0 })
    expect(byId(earthWeak, 'cra_feu_zone').elementMatch.rank).toBe(4)
  })

  it('postures : Zobal, Forgelance et Pandawa frappent (> 0, bien au-delà du DPT sans posture)', () => {
    const table = theoryDptTable(data)
    const p = bossProfile(data, HAREBOURG)
    const boss = bossFighter(data, HAREBOURG, { grade: p.grade, stats: p.stats })
    for (const id of ['zobal_rempart', 'zobal_psychopathe', 'forgelance_zone_terre', 'pandawa_placement', 'pandawa_saoul']) {
      const e = byId(harebourg, id)
      expect(e.dpt.steady, id).toBeGreaterThan(500)
      expect(e.stance.id, id).not.toBe('base')
      const bare = sustainedDamage(table, playerFighterFromMember(data, presetMember(getPreset(id), data)), boss).steady
      expect(e.dpt.steady, id).toBeGreaterThan(1.5 * bare)
    }
  })

  it('axes : contrôle et soin chiffrés ; Merkator punit le retrait PM (contrôle = retrait PA seul)', () => {
    expect(byId(harebourg, 'enutrof_retrait_pm_eau').control.mpRemoved).toBeGreaterThan(2)
    expect(harebourg.axes.find(a => a.axis === 'heal')!.entries[0].className).toBe('Eniripsa')
    for (const e of merkator.presets) expect(e.control.mpRemoved).toBe(0)
    expect(byId(merkator, 'xelor_retrait_pa').control.apRemoved).toBeGreaterThan(1)
    expect(merkator.warnings.join(' ')).toMatch(/Retrait PM puni/)
    // Merkator −50 % à distance : la mêlée passe devant le Crâ.
    expect(rankOf(merkator, 'Sacrieur')).toBeLessThan(rankOf(merkator, 'Crâ'))
  })

  it('composition : règles explicites, classes distinctes, chaque membre a sa raison', () => {
    for (const r of [harebourg, pereVer, merkator]) {
      const m = r.composition.members
      expect(m).toHaveLength(4)
      expect(new Set(m.map(x => x.breedId)).size).toBe(4)
      for (const x of m) expect(x.reason.length).toBeGreaterThan(20)
      expect(m[0].slot).toBe('Dégâts')
      expect(r.composition.rules).toEqual(COMPOSITION_RULES)
    }
    // Merkator : un tour du boss retire plus de 20 % des PV ⇒ soigneur ; retrait PM puni ⇒ pas de retraitiste PM.
    expect(merkator.composition.members.some(x => x.slot === 'Soin')).toBe(true)
    expect(merkator.composition.members.some(x => x.slot === 'Retrait PM')).toBe(false)
    expect(merkator.composition.notes.join(' ')).toMatch(/punit le retrait de PM/)
    // Père Ver : aucun PM ⇒ pas de retrait PM ; le premier dégât est un preset de mêlée.
    expect(pereVer.composition.notes.join(' ')).toMatch(/n'a pas de PM/)
    expect(byId(pereVer, pereVer.composition.members[0].presetId).utilities.tags).toContain('melee')
    // Comte Harebourg : PM et esquive PM 110 ⇒ retraitiste PM (≥ 1 PM retiré par tour).
    const rm = harebourg.composition.members.find(x => x.slot === 'Retrait PM')
    expect(rm).toBeDefined()
    expect(byId(harebourg, rm!.presetId).control.mpRemoved).toBeGreaterThanOrEqual(1)
  })

  it('Kimbo (400 % partout, sans fiche) : DPT nul, composition classée sur le DPT « résistances levées », signalée', () => {
    const r = rankClasses(data, bossProfile(data, KIMBO))
    expect(r.presets.every(e => e.dpt.steady === 0)).toBe(true)
    expect(r.presets.every(e => (e.dpt.resLifted ?? 0) > 0)).toBe(true)
    expect(r.composition.members).toHaveLength(4)
    expect(r.composition.notes.join(' ')).toMatch(/résistances ≥ 100 %/)
    expect(r.warnings.join(' ')).toMatch(/Résistance ≥ 100 %/)
  })

  it('bas niveau (Bouftou Royal, niveau 30) : personnages sans équipement, signalé', () => {
    const presets = ['iop_terre_burst', 'cra_air_entrave', 'eniripsa_soin_feu'].map(getPreset)
    const r = rankClasses(data, bossProfile(data, BOUFTOU_ROYAL), { level: 30, presets })
    expect(r.level).toBe(30)
    for (const e of r.presets) {
      expect(e.stuff).toBe('unstuffed')
      expect(e.warnings).toEqual([])
      expect(e.survival.hp).toBeLessThan(1000)
    }
    expect(r.assumptions.join(' ')).toMatch(/Niveau 30 .*SANS équipement/)
    expect(r.presets.some(e => e.dpt.steady > 0)).toBe(true)
  })

  it('mode « optimized » (2 presets) : stuff optimisé contre le boss puis mesuré', () => {
    const presets = [getPreset('cra_terre_mono'), getPreset('iop_terre_burst')]
    const profile = bossProfile(data, HAREBOURG)
    const opt = rankClasses(data, profile, { presets, stuff: 'optimized' })
    const ref = rankClasses(data, profile, { presets })
    for (const id of ['cra_terre_mono', 'iop_terre_burst']) {
      const o = byId(opt, id)
      expect(o.stuff).toBe('optimized')
      expect(o.warnings).toEqual([])
      // L'optimiseur (killer : J ≈ DPT^0,7 · EHP^0,3) ne dégrade pas les deux à la fois.
      expect(o.dpt.steady > byId(ref, id).dpt.steady || o.survival.ehp > byId(ref, id).survival.ehp).toBe(true)
    }
    expect(opt.assumptions.join(' ')).toMatch(/optimizeStuff/)
  }, 60_000)

  it('déterministe, sérialisable JSON ; 49 presets en moins de 5 s à chaud', () => {
    const profile = bossProfile(data, HAREBOURG)
    const t0 = performance.now()
    const again = rankClasses(data, profile)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(5000)
    expect(JSON.stringify(again)).toBe(JSON.stringify(harebourg))
    expect(JSON.parse(JSON.stringify(again))).toEqual(again)
  })

  it('hypothèses et avertissements : stuffs génériques, DPT non calibré, ce qui n\'est pas modélisé', () => {
    const a = harebourg.assumptions.join('\n')
    expect(a).toMatch(/Stuffs génériques/)
    expect(a).toMatch(/Presets écrits à la main/)
    expect(a).toMatch(/NON calibré/)
    expect(a).toMatch(/Grade 1 pour 4 joueur/)
    expect(harebourg.warnings.join('\n')).toMatch(/invocations, glyphes, pièges.*arme.*buffs d'équipe.*IA réelle du boss.*positions/)
    for (const e of harebourg.presets) expect(e.confidence.reasons.length).toBeGreaterThan(0)
    expect(byId(harebourg, 'osamodas_invocations').confidence.level).toBe('basse')
  })
})

describe('rendus texte', () => {
  it('fiche du boss : identité, résistances brutes et effectives, profil offensif par phase, mécaniques, avertissements, hypothèses', () => {
    const txt = formatBoss(bossProfile(data, MERKATOR), { spells: true })
    for (const s of ['Merkator (3534)', 'PV 13 000', 'Résistances', 'Brute', 'Effective', 'Éléments du plus faible au plus fort', 'Profil offensif par phase', 'Sorts qui frappent', 'Mécaniques', 'Avertissements', 'Hypothèses'])
      expect(txt).toContain(s)
    expect(txt).toMatch(/distance 50 %/)
    expect(txt).toMatch(/\[retrait puni\]/)
    // Tableaux alignés : la ligne de tirets a la largeur de l'en-tête.
    const lines = txt.split('\n')
    const i = lines.findIndex(l => /^\s+Élément\s+Brute\s+Effective$/.test(l))
    expect(lines[i + 1].replace(/\s+$/, '').length).toBe(lines[i].length)
    // Solar : phases et parts élémentaires.
    expect(formatBoss(bossProfile(data, 5100))).toMatch(/Aurore|Nadir|états/)
    expect(txt).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('classement : un tableau par axe, par classe, composition, règles, atouts et limites, hypothèses', () => {
    const txt = formatClasses(harebourg, { presets: true })
    for (const s of ['Classes contre Comte Harebourg', 'Dégâts (DPT soutenu)', 'Survie (PV effectifs)', 'Contrôle', 'Soin', 'Apport d\'équipe', 'Par classe', 'Tous les presets évalués', 'Composition suggérée (4 personnage(s))', 'Règles :', 'Atouts et limites', 'Hypothèses', 'Avertissements'])
      expect(txt).toContain(s)
    expect(txt).toContain('Aucune note globale')
    for (const m of harebourg.composition.members) expect(txt).toContain(m.reason)
    expect(formatClasses(harebourg, { top: 3 }).split('\n').length).toBeLessThan(txt.split('\n').length)
  })
})
