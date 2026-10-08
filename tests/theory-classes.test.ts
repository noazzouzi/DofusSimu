/**
 * Theorycraft — classement des classes contre un boss (src/theorycraft/classes.ts, docs/design/theorycraft.md §1.8) et
 * rendus texte (formatBoss.ts, formatClasses.ts) : invulnérabilité à distance du Père Ver (la mêlée passe devant le
 * Crâ, premier contre le Comte Harebourg), élément faible de vrais boss (Koumiho faible en Terre : le Crâ Terre passe
 * devant le Crâ Feu, nettement plus fort à résistances égales), postures (Zobal, Forgelance, Pandawa > 0), axes Contrôle
 * et Soin en UN budget de PA (soin plafonné aux dégâts reçus), ex æquo de la Survie, étalonnage moteur affiché et
 * signalé, composition à règles explicites (Soin, Protection, Retrait PM, deuxième élément, apport d'équipe), repli des
 * résistances extrêmes (Kimbo), bas niveau sans équipement, mode « optimized » (2 presets), déterminisme et performance.
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
import type { ClassRanking, PresetEvaluation } from '../src/theorycraft/types'

const data = loadDataStore()
const HAREBOURG = 3416
const PERE_VER = 4726
const MERKATOR = 3534
const KIMBO = 1045
const BOUFTOU_ROYAL = 147
const SOLAR = 5100
const VORTEX = 3835
const KOUMIHO = 6394

const byId = (r: ClassRanking, id: string): PresetEvaluation => r.presets.find(e => e.presetId === id)!
const rankOf = (r: ClassRanking, className: string) => r.axes.find(a => a.axis === 'damage')!.entries.findIndex(e => e.className === className)

let harebourg: ClassRanking
let pereVer: ClassRanking
let merkator: ClassRanking
let solar: ClassRanking
let vortex: ClassRanking

beforeAll(() => {
  harebourg = rankClasses(data, bossProfile(data, HAREBOURG))
  pereVer = rankClasses(data, bossProfile(data, PERE_VER))
  merkator = rankClasses(data, bossProfile(data, MERKATOR))
  solar = rankClasses(data, bossProfile(data, SOLAR))
  vortex = rankClasses(data, bossProfile(data, VORTEX))
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

  it('élément faible de vrais boss : contre le Koumiho (Terre −11 %, Feu +23 %) le Crâ Terre passe devant le Crâ Feu', () => {
    // À résistances presque égales (Comte Harebourg : Terre 17 %, Feu 16 %), le Crâ Feu est nettement plus fort (kit et
    // stuff) : l'inversion contre le Koumiho vient de ses résistances effectives, à travers toute la chaîne (fiche, phases,
    // cibles du proxy), pas d'un facteur posé à la main.
    const presets = ['cra_feu_zone', 'cra_terre_mono', 'ecaflip_feu_hybride', 'ecaflip_terre_entrave'].map(getPreset)
    const koumiho = rankClasses(data, bossProfile(data, KOUMIHO), { presets })
    expect(byId(harebourg, 'cra_feu_zone').dpt.steady).toBeGreaterThan(1.25 * byId(harebourg, 'cra_terre_mono').dpt.steady)
    expect(byId(koumiho, 'cra_terre_mono').dpt.steady).toBeGreaterThan(byId(koumiho, 'cra_feu_zone').dpt.steady)
    expect(byId(koumiho, 'ecaflip_terre_entrave').dpt.steady).toBeGreaterThan(byId(koumiho, 'ecaflip_feu_hybride').dpt.steady)
    expect(byId(koumiho, 'cra_terre_mono').elementMatch).toMatchObject({ element: 1, rank: 0 })
    expect(byId(koumiho, 'cra_feu_zone').elementMatch.rank).toBe(4)
    // Le meilleur preset Crâ de l'axe Dégâts suit l'élément faible du boss ; la composition commence par la Terre.
    const craBest = (r: ClassRanking) => r.classes.find(c => c.className === 'Crâ')!.best.damage.presetId
    expect(craBest(harebourg)).toBe('cra_feu_zone')
    expect(craBest(koumiho)).toBe('cra_terre_mono')
    expect(byId(koumiho, koumiho.composition.members[0].presetId).elementMatch.element).toBe(1)
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
    for (const e of merkator.presets) {
      expect(e.control.mpRemoved).toBe(0)
      expect(e.control.combined.mp).toBe(0)
    }
    expect(byId(merkator, 'xelor_retrait_pa').control.apRemoved).toBeGreaterThan(1)
    expect(merkator.warnings.join(' ')).toMatch(/Retrait PM puni/)
    // Merkator −50 % à distance : la mêlée passe devant le Crâ.
    expect(rankOf(merkator, 'Sacrieur')).toBeLessThan(rankOf(merkator, 'Crâ'))
  })

  it('Contrôle = UN tour de PA (tour mixte) : jamais la somme des tours consacrés au retrait PM et au retrait PA', () => {
    for (const e of harebourg.presets) {
      const { mpRemoved, apRemoved, combined, value } = e.control
      expect(value, e.presetId).toBeCloseTo(combined.mp + combined.ap, 9)
      expect(e.axes.control, e.presetId).toBe(value)
      expect(value, e.presetId).toBeGreaterThanOrEqual(Math.max(mpRemoved, apRemoved) - 1e-9)
      expect(value, e.presetId).toBeLessThanOrEqual(mpRemoved + apRemoved + 1e-9)
      expect(e.utilities.removal.combined.apSpent, e.presetId).toBeLessThanOrEqual(12 + 1e-9)
    }
    // Hybrides PM + PA (sorts distincts) : strictement moins que les deux tours consacrés additionnés.
    for (const id of ['enutrof_retrait_pm_eau', 'huppermage_entrave']) {
      const c = byId(harebourg, id).control
      expect(c.value, id).toBeLessThan(c.mpRemoved + c.apRemoved - 0.5)
    }
  })

  it('Soin = PV UTILES : tour mixte soin + bouclier, plafonné aux dégâts d\'un tour du boss ; débit brut à côté', () => {
    for (const r of [harebourg, vortex, pereVer]) {
      const cap = byId(r, 'eniripsa_soin_feu').heal.cap
      expect(cap).toBeGreaterThan(0)
      for (const e of r.presets) {
        expect(e.heal.cap).toBe(cap)
        expect(e.heal.value, e.presetId).toBeCloseTo(Math.min(e.heal.raw, cap), 6)
        expect(e.heal.protection, e.presetId).toBeLessThanOrEqual(cap + 1e-9)
      }
    }
    // Eniripsa contre le Père Ver (550 de dégâts par tour) : 2 288 PV de soin bruts, mais 550 utiles.
    const eni = byId(pereVer, 'eniripsa_soin_feu').heal
    expect(eni.raw).toBeGreaterThan(2 * eni.cap)
    expect(eni.value).toBeCloseTo(eni.cap, 6)
    // Tour mixte : un budget de PA (soin 2 288 + bouclier 700 dans deux rotations consacrées ≠ 2 988 en un tour).
    expect(eni.mixed.heal + eni.mixed.shield).toBeLessThan(eni.heal + eni.shield)
    // Classement : les ex æquo au plafond partagent le rang 1, départagés par le débit brut.
    const heal = harebourg.axes.find(a => a.axis === 'heal')!.entries
    expect(heal[0].rank).toBe(1)
    expect(heal.filter(x => x.rank === 1).every(x => x.tied)).toBe(true)
  })

  it('Survie (stuff seul) : presets d\'un même stuff générique ex æquo, rang partagé', () => {
    const surv = merkator.axes.find(a => a.axis === 'survival')!
    const top = surv.entries.filter(x => x.rank === 1)
    expect(top.map(x => x.className).sort()).toEqual(['Féca', 'Sacrieur', 'Zobal'])
    expect(top.every(x => x.tied && x.value === top[0].value)).toBe(true)
    expect(surv.entries[3].rank).toBe(4)
    expect(surv.unit).toMatch(/stuff seul/)
    // Rangs : 1, 1, 1, 4… et rangs croissants.
    for (let i = 1; i < surv.entries.length; i++) expect(surv.entries[i].rank).toBeGreaterThanOrEqual(surv.entries[i - 1].rank)
  })

  it('étalonnage moteur affiché et signalé : cra_feu_zone ×0,73, premier contre le Comte Harebourg', () => {
    const cra = byId(harebourg, 'cra_feu_zone')
    expect(cra.dpt.calibration).toBeCloseTo(0.73, 3)
    expect(cra.dpt.calibrated).toBeCloseTo(cra.dpt.steady * 0.73, 6)
    expect(harebourg.axes[0].entries[0].presetId).toBe('cra_feu_zone')
    const w = harebourg.warnings.join('\n')
    expect(w).toMatch(/cra_feu_zone : étalonnage moteur ×0,73 \(le moteur inflige 27 % de moins/)
    expect(w).toMatch(/Avec l'étalonnage moteur, le meilleur DPT serait Crâ cra_air_entrave/)
    expect(harebourg.composition.members[0].reason).toMatch(/étalonnage moteur ×0,73/)
    // Un preset proche de 1 n'est pas signalé (Iop 2e du podium).
    expect(byId(harebourg, 'iop_soutien').dpt.calibration).toBeCloseTo(1, 2)
    expect(w).not.toMatch(/iop_soutien : étalonnage/)
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
    // Merkator : aucun autre élément faible n'atteint 85 % ⇒ note chiffrée, et le 2e DPT (Terre, l'élément le plus
    // résistant du boss) le dit.
    expect(merkator.composition.notes.join(' ')).toMatch(/Deuxième DPT d'un autre élément faible écarté : le meilleur, .* n'atteint que \d+ %/)
    const second = merkator.composition.members.filter(x => x.slot === 'Dégâts')[1]
    expect(second.reason).toMatch(/élément le plus résistant du boss, retenu pour son DPT/)
  })

  it('composition : Protection contre le Vortex (insoignable), plafonnée aux dégâts reçus ; boucliers supposés consommés', () => {
    const prot = vortex.composition.members.find(x => x.slot === 'Protection')
    expect(prot).toBeDefined()
    expect(vortex.composition.members.some(x => x.slot === 'Soin')).toBe(false)
    const e = byId(vortex, prot!.presetId)
    expect(e.heal.protection).toBeGreaterThan(0)
    expect(e.heal.protection).toBeLessThanOrEqual(e.heal.cap + 1e-9)
    expect(e.heal.protectionRaw).toBeGreaterThan(e.heal.cap)
    expect(prot!.reason).toMatch(/insoignable.*PV préservés utiles par tour \(plafond .*supposés consommés/)
    expect(vortex.warnings.join(' ')).toMatch(/insoignables/)
  })

  it('composition : deuxième DPT d\'un autre élément faible contre Solar (Feu et Air à 5 %)', () => {
    const dmg = solar.composition.members.filter(x => x.slot === 'Dégâts')
    expect(dmg.length).toBeGreaterThanOrEqual(2)
    const [a, b] = dmg.map(x => byId(solar, x.presetId))
    expect(b.elementMatch.element).not.toBe(a.elementMatch.element)
    expect([a.elementMatch.element, b.elementMatch.element].sort()).toEqual([2, 4])
    expect(dmg[1].reason).toMatch(/^Deuxième DPT, autre élément/)
    expect(b.dpt.steady).toBeGreaterThanOrEqual(0.85 * Math.max(...solar.presets.filter(e => e.breedId !== a.breedId).map(e => e.dpt.steady)) - 1e-6)
  })

  it('composition : apport d\'équipe sans dégâts dit dans la raison (Père Ver : Huppermage invulnérable à distance)', () => {
    const team = pereVer.composition.members.find(x => x.slot === 'Apport d\'équipe')!
    const e = byId(pereVer, team.presetId)
    expect(e.className).toBe('Huppermage')
    expect(e.dpt.steady).toBe(0)
    expect(team.reason).toMatch(/ne touche pas le boss \(DPT propre nul\) : apport seul ; confiance basse/)
    expect(e.relevance.limites[0]).toMatch(/^Ne touche pas le boss/)
    expect(e.relevance.atouts.some(a => /^Rafale|^Mêlée|^Distance|^Dégâts/.test(a))).toBe(false)
    // Un membre qui frappe : son DPT propre est donné (Merkator : Huppermage à distance réduite, DPT > 0).
    const merkTeam = merkator.composition.members.find(x => x.slot === 'Apport d\'équipe')!
    expect(merkTeam.reason).toMatch(/DPT propre \d/)
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
      // L'optimiseur ne dégrade jamais son objectif J (proxy, mêmes cibles que le classement).
      expect(o.optimization).toBeDefined()
      expect(o.optimization!.bestJ, id).toBeGreaterThanOrEqual(o.optimization!.startJ)
      expect(o.dpt.steady > byId(ref, id).dpt.steady || o.survival.ehp > byId(ref, id).survival.ehp).toBe(true)
      expect(byId(ref, id).optimization).toBeUndefined()
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
    for (const s of ['Classes contre Comte Harebourg', 'Dégâts (DPT soutenu)', 'Étalonné (moteur)', 'Survie (PV effectifs du stuff seul)', 'Contrôle (PM + PA retirés en un tour)', 'PM seul', 'Soin (PV soignés ou préservés utiles / tour)', 'Brut', 'Apport d\'équipe', 'Par classe', 'Confiance (classe)', 'Tous les presets évalués', 'Composition suggérée (4 personnage(s))', 'Règles :', 'Atouts et limites', 'Hypothèses', 'Avertissements'])
      expect(txt).toContain(s)
    // Ex æquo de la Survie : rang partagé « =1 ».
    expect(txt).toMatch(/^\s+=1\s+Féca\s+feca_/m)
    expect(txt).toContain('Aucune note globale')
    for (const m of harebourg.composition.members) expect(txt).toContain(m.reason)
    expect(formatClasses(harebourg, { top: 3 }).split('\n').length).toBeLessThan(txt.split('\n').length)
  })
})
