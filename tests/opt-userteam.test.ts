/**
 * Composition choisie par l'utilisateur (décision du 2026-10-05, src/optimizer/team/userteam.ts, teamfile.ts) : fichier
 * d'équipe du Vortex (data/teams/vortex.json : Eniripsa, Enutrof, Crâ, Crâ), `--classes` (noms, alias, ids, doublons),
 * résolution des builds (version du scénario des presets, deux membres d'une même classe ⇒ builds distincts), options
 * de recherche, validation des fichiers, builds donnés par chemin, écriture des builds retenus.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats } from '../src/stats/build'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { findTeamFile, loadTeamFile, saveTeamFile, teamFilePath, TEAMS_DIR } from '../src/optimizer/team/teamfile'
import {
  compositionFromClasses,
  compositionFromTeamFile,
  compositionFromTeamText,
  isScenarioPreset,
  memberNames,
  memberOptions,
  parseClasses,
  parseTeamFile,
  referenceOption,
  resolveComposition,
  scenarioPresets,
  teamFileWithBuilds,
  withOverrides,
} from '../src/optimizer/team/userteam'

const DATA = loadDataStore('data')

describe('fichier d’équipe du Vortex (choix de l’utilisateur)', () => {
  it('data/teams/vortex.json : 1 Eniripsa, 1 Enutrof, 2 Crâs, choisie par l’utilisateur ; fichier par défaut du scénario', () => {
    const path = findTeamFile('vortex')
    expect(path).toBe(teamFilePath('vortex', TEAMS_DIR))
    const { file, composition } = loadTeamFile(path!)
    expect(file.scenario).toBe('vortex')
    expect(file.chosenBy).toBe('utilisateur')
    expect(composition.source).toBe('file')
    expect(composition.members.map(m => m.className)).toEqual(['Eniripsa', 'Enutrof', 'Crâ', 'Crâ'])
    expect(composition.members.map(m => m.breedId)).toEqual([7, 3, 9, 9])
    expect(composition.notes.join(' ')).toContain('2 Cras')
    expect(findTeamFile('dummy')).toBeUndefined()
  })

  it('builds par défaut : version Vortex des presets, deux Crâs ⇒ deux builds distincts, noms uniques', () => {
    // Classes du fichier de l'utilisateur, SANS ses éventuels builds épinglés (`optimize --save-team` les y écrira) : on
    // teste ici les builds par défaut d'une composition Eniripsa, Enutrof, Crâ, Crâ.
    const classes = loadTeamFile(findTeamFile('vortex')!).composition.members.map(m => m.breedId)
    const { team, options } = resolveComposition(compositionFromClasses(classes, 'vortex'), DATA, 'vortex')
    expect(options.map(o => o.id)).toEqual(['eniripsa_soin_vortex', 'enutrof_retrait_pm_vortex', 'cra_feu_vortex', 'cra_air_entrave_vortex'])
    expect(options.every(o => o.origin === 'scenario' && o.scenarioStuff)).toBe(true)
    expect(team.map(m => m.name)).toEqual(['Eniripsa', 'Enutrof', 'Crâ', 'Crâ 2'])
    // Identité IA = preset de BASE (alias base@stuff), stuff et points du preset dérivé.
    expect(team.map(m => m.presetId)).toEqual(['eniripsa_soin_feu', 'enutrof_retrait_pm_eau', 'cra_feu_zone', 'cra_air_entrave'])
    expect(team[2].build.items).toEqual(presetMember(getPreset('cra_feu_vortex'), DATA).build.items)
    for (const m of team) expect(computeBuildStats(m.build, DATA).valid, m.name).toBe(true)
  })
})

describe('--classes', () => {
  it('noms, accents, alias, identifiants, doublons et répétitions', () => {
    expect(parseClasses('eniripsa,enutrof,cra,cra')).toEqual([7, 3, 9, 9])
    expect(parseClasses('Eniripsa, Enutrof, Crâ, CRA')).toEqual([7, 3, 9, 9])
    expect(parseClasses('eni,enu,cra*2')).toEqual([7, 3, 9, 9])
    expect(parseClasses('7,3,9,9')).toEqual([7, 3, 9, 9])
    expect(parseClasses('2*cra+iop')).toEqual([9, 9, 8])
    expect(parseClasses('cra,cra,cra,cra')).toEqual([9, 9, 9, 9])
  })

  it('erreurs explicites : classe inconnue, liste vide, plus de 8 personnages', () => {
    expect(() => parseClasses('eniripsa,foo')).toThrow(/Classe inconnue : « foo »/)
    expect(() => parseClasses(' , ')).toThrow(/aucune classe/)
    expect(() => parseClasses('cra*9')).toThrow(/répétition invalide/)
    expect(() => parseClasses('cra*4,iop*4,eni')).toThrow(/8 au plus/)
  })

  it('composition depuis des classes : builds par défaut du scénario ; hors Vortex, presets de base distincts', () => {
    const comp = compositionFromClasses(parseClasses('cra,cra,cra,cra'), 'vortex')
    const ids = resolveComposition(comp, DATA, 'vortex').options.map(o => o.id)
    // k-ième Crâ ⇒ k-ième build de la liste (versions Vortex des presets de base, dans l'ordre du fichier), en boucle.
    const primary = scenarioPresets(9, 'vortex').primary.map(p => p.id)
    expect(ids).toEqual([0, 1, 2, 3].map(k => primary[k % primary.length]))
    expect(new Set(ids.slice(0, Math.min(3, primary.length))).size).toBe(Math.min(3, primary.length))
    const dummy = resolveComposition(compositionFromClasses([9, 9], 'dummy'), DATA, 'dummy').options
    expect(dummy.map(o => o.id)).toEqual(['cra_feu_zone', 'cra_air_entrave'])
    expect(dummy.every(o => o.origin === 'class' && !o.scenarioStuff)).toBe(true)
  })
})

describe('presets d’un scénario et options de recherche', () => {
  it('versions du scénario : dérivées `<base>_<scénario>[_profil]` ; bases remplacées hors liste', () => {
    expect(isScenarioPreset(getPreset('cra_feu_vortex'), 'vortex')).toBe(true)
    expect(isScenarioPreset(getPreset('cra_feu_vortex_def'), 'vortex')).toBe(true)
    expect(isScenarioPreset(getPreset('cra_feu_zone'), 'vortex')).toBe(false)
    expect(isScenarioPreset(getPreset('cra_feu_vortex'), 'dummy')).toBe(false)
    const sp = scenarioPresets(9, 'vortex')
    expect(sp.primary[0].id).toBe('cra_feu_vortex')
    expect(sp.extra.map(p => p.id)).toContain('cra_feu_vortex_def')
    expect(sp.superseded.map(p => p.id)).toContain('cra_feu_zone')
    expect(sp.primary.some(p => p.id === 'cra_feu_zone')).toBe(false)
  })

  it('options d’un membre : la référence en tête, sans doublon, toutes de sa classe', () => {
    const comp = compositionFromClasses([7, 3, 9, 9], 'vortex')
    for (let i = 0; i < 4; i++) {
      const opts = memberOptions(comp, i, DATA, 'vortex')
      expect(opts[0].id).toBe(referenceOption(comp, i, DATA, 'vortex').id)
      expect(new Set(opts.map(o => o.id)).size).toBe(opts.length)
      expect(opts.every(o => o.member.breedId === comp.members[i].breedId)).toBe(true)
      expect(opts.length).toBeGreaterThan(1)
    }
    const cra2 = memberOptions(comp, 3, DATA, 'vortex')
    expect(cra2[0].id).toBe('cra_air_entrave_vortex')
    expect(cra2.map(o => o.id)).toContain('cra_feu_vortex')
    expect(cra2.every(o => o.member.name === 'Crâ 2')).toBe(true)
  })

  it('--team : membres imposés (une seule option) ; candidates du fichier ; surcharge des variantes', () => {
    const comp = compositionFromTeamText('cra_feu_vortex,cra:air@vortex_cra_air_entrave', 'vortex')
    expect(comp.members.every(m => m.fixed)).toBe(true)
    expect(memberOptions(comp, 1, DATA, 'vortex').map(o => [o.id, o.origin])).toEqual([['cra_air_entrave@vortex_cra_air_entrave', 'fixed']])
    const file = parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', preset: 'cra_feu_vortex', candidates: ['cra_feu_vortex_def', 'cra_terre_mono'] }] })
    const c2 = loadComp(file)
    expect(memberOptions(c2, 0, DATA, 'vortex').map(o => o.id)).toEqual(['cra_feu_vortex', 'cra_feu_vortex_def', 'cra_terre_mono'])
    const v = getPreset('cra_feu_zone').variants.map(x => (1 - x) as 0 | 1)
    const o = withOverrides(referenceOption(c2, 0, DATA, 'vortex'), { ...c2.members[0], variants: v })
    expect(o.member.variants).toEqual(v)
    expect(o.member.build.spellVariants).toEqual(v)
  })
})

describe('revue : deux membres d’une même classe, variantes d’un membre', () => {
  it('un build épinglé par `preset` est écarté des builds par défaut des autres membres de sa classe', () => {
    const comp = compositionFromTeamFile(parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra' }, { class: 'cra', preset: 'cra_feu_vortex' }] }))
    expect(resolveComposition(comp, DATA, 'vortex').options.map(o => o.id)).toEqual(['cra_air_entrave_vortex', 'cra_feu_vortex'])
    // Épinglé sur le preset de BASE (même build Feu, autre stuff) : écarté aussi.
    const c2 = compositionFromTeamFile(parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', preset: 'cra_feu_zone@vortex_cra_feu_def' }, { class: 'cra' }] }))
    expect(resolveComposition(c2, DATA, 'vortex').options.map(o => o.id)).toEqual(['cra_feu_zone@vortex_cra_feu_def', 'cra_air_entrave_vortex'])
  })

  it('variantes d’un membre : appliquées à son build de référence, pas aux autres presets essayés', () => {
    const v = getPreset('cra_feu_vortex').variants.map(x => (1 - x) as 0 | 1)
    const comp = compositionFromTeamFile(parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', preset: 'cra_feu_vortex', variants: v }] }))
    const opts = memberOptions(comp, 0, DATA, 'vortex')
    expect(opts[0].id).toBe('cra_feu_vortex+variantes')
    expect(opts[0].member.variants).toEqual(v)
    for (const id of ['cra_air_entrave_vortex', 'cra_feu_vortex', 'cra_feu_vortex_def']) {
      const o = opts.find(x => x.id === id)!
      expect(o.member.variants, id).toEqual(getPreset(id).variants)
    }
  })
})

function loadComp(file: ReturnType<typeof parseTeamFile>) {
  const dir = mkdtempSync(join(tmpdir(), 'dofussimu-team-'))
  const path = join(dir, 'x.json')
  saveTeamFile(path, file)
  return loadTeamFile(path).composition
}

describe('validation des fichiers d’équipe', () => {
  it('refuse les clés inconnues, les presets d’une autre classe, les stuffs inconnus, fixed + candidates', () => {
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ clas: 'cra' }] })).toThrow(/clé inconnue « clas »/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', preset: 'iop_terre_burst' }] })).toThrow(/preset Iop, pas Crâ/)
    // Faute de frappe dans un preset : membre et champ cités, presets de la classe proposés.
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', preset: 'cra_fue_vortex' }] })).toThrow(/membre 1 : « preset » = « cra_fue_vortex » : .*presets Crâ : cra_feu_zone,/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: ['eni', { class: 'cra', candidates: ['cra_feu_vortex', 'cra_aire'] }] })).toThrow(/membre 2 : « candidates » = « cra_aire »/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', stuff: 'nope' }] })).toThrow(/stuff inconnu/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', preset: 'cra_feu_zone@vortex_iop_terre' }] })).toThrow(/pas prévu pour Crâ/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', fixed: true, candidates: ['cra_feu_zone'] }] })).toThrow(/incompatibles/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: [] })).toThrow(/non vide/)
    expect(() => parseTeamFile({ scenario: 'vortex', version: 2, members: ['cra'] })).toThrow(/version 2/)
    expect(() => parseTeamFile({ scenario: 'vortex', members: [{ class: 'cra', role: 'boss' }] })).toThrow(/rôle inconnu/)
    // Formes courtes : une classe seule par membre.
    expect(parseTeamFile({ scenario: 'vortex', members: ['eni', 9] }).members.map(m => m.class)).toEqual(['eni', 9])
  })

  it('build donné par chemin (sortie de `stuff --out`), relatif au fichier d’équipe ; noms donnés', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dofussimu-team-'))
    const base = presetMember(getPreset('cra_air_entrave_vortex'), DATA)
    writeFileSync(join(dir, 'cra2.json'), JSON.stringify({ kind: 'dofussimu-build', build: { items: base.build.items.slice(0, 3), characteristicPoints: base.build.characteristicPoints, scrolls: base.build.scrolls } }))
    writeFileSync(join(dir, 'vortex.json'), JSON.stringify({ version: 1, scenario: 'vortex', members: ['eniripsa', 'enutrof', { class: 'cra', name: 'Archer' }, { class: 'cra', preset: 'cra_air_entrave_vortex', build: 'cra2.json' }] }))
    expect(findTeamFile('vortex', [dir])).toBe(join(dir, 'vortex.json'))
    const { composition } = loadTeamFile(join(dir, 'vortex.json'))
    expect(memberNames(composition)).toEqual(['Eniripsa', 'Enutrof', 'Archer', 'Crâ'])
    const { options, team } = resolveComposition(composition, DATA, 'vortex')
    expect(options[3].id).toBe('cra_air_entrave_vortex+build')
    expect(options[3].origin).toBe('file-build')
    expect(team[3].build.items.length).toBe(3)
    // Le 3e membre (Crâ sans preset) prend le premier build Crâ ; le 4e a un preset : il ne décale pas les défauts.
    expect(options[2].id).toBe('cra_feu_vortex')
  })

  it('builds retenus écrits dans le fichier (preset@stuff, build complet, variantes) puis relus à l’identique', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dofussimu-team-'))
    const path = join(dir, 'vortex.json')
    saveTeamFile(path, { version: 1, scenario: 'vortex', chosenBy: 'utilisateur', members: [{ class: 'cra' }, { class: 'cra', role: 'mpLock' }], notes: 'deux Crâs' })
    const { file, composition } = loadTeamFile(path)
    const opts = [memberOptions(composition, 0, DATA, 'vortex')[1], referenceOption(composition, 1, DATA, 'vortex')]
    const custom = { ...opts[1], id: `${opts[1].preset.id}@opt`, origin: 'stuff-optimizer' as const, member: { ...opts[1].member, build: { ...opts[1].member.build, items: opts[1].member.build.items.slice(0, 4) } } }
    const toggled = opts[0].preset.variants.map((x, i) => (i === 0 ? ((1 - x) as 0 | 1) : x))
    const team = [{ ...opts[0].member, variants: toggled }, custom.member]
    saveTeamFile(path, teamFileWithBuilds(file, [opts[0], custom], team, { report: 'docs/reports/x.md', date: '2026-10-05' }))
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved.members[0].preset).toBe(opts[0].id)
    expect(saved.members[0].variants).toEqual(toggled)
    expect(saved.members[1].preset).toBe('cra_air_entrave_vortex')
    expect(saved.members[1].build.items.length).toBe(4)
    expect(saved.members[1].role).toBe('mpLock')
    expect(saved.notes).toBe('deux Crâs')
    expect(saved.optimized.report).toBe('docs/reports/x.md')
    const again = resolveComposition(loadTeamFile(path).composition, DATA, 'vortex')
    expect(again.team[0].variants).toEqual(toggled)
    expect(again.team[0].build.items).toEqual(opts[0].member.build.items)
    expect(again.team[1].build.items).toEqual(custom.member.build.items)
    expect(again.team[1].role).toBe('mpLock')
    // Non imposés : une nouvelle optimisation repart de ces builds et cherche encore.
    expect(memberOptions(loadTeamFile(path).composition, 0, DATA, 'vortex').length).toBeGreaterThan(1)
  })
})
