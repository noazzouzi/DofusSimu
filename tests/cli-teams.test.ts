/**
 * CLI (src/cli/simulate.ts, src/cli/optimize.ts) — composition CHOISIE PAR L'UTILISATEUR : fichier d'équipe du scénario
 * comme équipe par défaut (`--team` prioritaire), `--classes` (doublons), options exclusives, et commandes `optimize`
 * (de bout en bout sur le mannequin : rapport Markdown + JSON, meilleur replay dans l'index du visualiseur,
 * `--save-team`), `report` (rendu d'un résultat enregistré), `stuff` (build JSON réutilisable dans un fichier d'équipe).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, teamChoiceOf } from '../src/cli/common'
import { main, usage } from '../src/cli/simulate'
import { loadDataStore } from '../src/data/node'

let out: string[] = []
let err: string[] = []
beforeEach(() => {
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((...x: unknown[]) => void out.push(x.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...x: unknown[]) => void err.push(x.join(' ')))
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => vi.restoreAllMocks())

const text = () => out.join('\n')

/** Dossier d'équipes temporaire avec `dummy.json`. */
function teamsDir(members: unknown[], extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dofussimu-cli-teams-'))
  writeFileSync(join(dir, 'dummy.json'), JSON.stringify({ version: 1, scenario: 'dummy', chosenBy: 'utilisateur', decidedAt: '2026-10-05', members, notes: 'test', ...extra }))
  return dir
}

describe('CLI : composition de l’utilisateur', () => {
  it('aide : composition = choix de l’utilisateur, commandes optimize/stuff/report/team (opt-in), exemples Vortex', async () => {
    const u = usage()
    expect(u).toContain('COMPOSITION = CHOIX DE L\'UTILISATEUR')
    expect(u).toContain('data/teams/vortex.json')
    for (const c of ['optimize <scénario>', 'stuff <scénario>', 'report <fichier>', 'team <scénario>', '--classes C']) expect(u).toContain(c)
    expect(u).toMatch(/team <scénario>\s+RECHERCHE AUTOMATIQUE DE COMPOSITION \(opt-in\)/)
    expect(await main(['help'])).toBe(0)
  })

  it('--classes : doublons, builds par défaut distincts pour deux Crâs', async () => {
    expect(await main(['fight', 'dummy', '--classes', 'eniripsa,enutrof,cra,cra', '--ai', 'scripted', '--replay', 'none'])).toBe(0)
    const line = out.find(l => l.startsWith('Équipe :'))!
    expect(line).toContain('Eniripsa=eniripsa_soin_feu')
    expect(line).toContain('Crâ=cra_feu_zone')
    expect(line).toContain('Crâ 2=cra_air_entrave')
    expect(line).toContain('composition choisie par l’utilisateur — --classes')
  })

  it('fichier d’équipe du scénario = équipe par défaut ; --team prioritaire ; sans fichier, équipe d’exemple', async () => {
    const dir = teamsDir([{ class: 'cra', preset: 'cra_terre_mono' }, 'eniripsa'])
    expect(await main(['fight', 'dummy', '--teams-dir', dir, '--ai', 'scripted', '--replay', 'none'])).toBe(0)
    let line = out.find(l => l.startsWith('Équipe :'))!
    expect(line).toContain('Crâ=cra_terre_mono')
    expect(line).toContain('Eniripsa=eniripsa_soin_feu')
    expect(line).toContain(`fichier ${join(dir, 'dummy.json')}`)
    out = []
    expect(await main(['fight', 'dummy', '--teams-dir', dir, '--team', 'iop', '--ai', 'scripted', '--replay', 'none'])).toBe(0)
    line = out.find(l => l.startsWith('Équipe :'))!
    expect(line).toContain('--team iop')
    out = []
    const empty = mkdtempSync(join(tmpdir(), 'dofussimu-cli-empty-'))
    expect(await main(['fight', 'dummy', '--teams-dir', empty, '--ai', 'scripted', '--replay', 'none'])).toBe(0)
    expect(out.find(l => l.startsWith('Équipe :'))).toContain('équipe d\'exemple')
  })

  it('le fichier d’équipe du Vortex est l’équipe par défaut de `batch vortex` (et de --team-file ailleurs)', async () => {
    expect(await main(['fight', 'dummy', '--team-file', 'data/teams/vortex.json', '--ai', 'scripted', '--replay', 'none'])).toBe(0)
    const line = out.find(l => l.startsWith('Équipe :'))!
    // Builds : ceux du fichier (par défaut, ou épinglés plus tard par `optimize --save-team`) — seules les classes sont fixes.
    expect(line).toMatch(/^Équipe : Eniripsa=eniripsa_\S+, Enutrof=enutrof_\S+, Crâ=cra_\S+, Crâ 2=cra_\S+ — Eniripsa, Enutrof, Crâ, Crâ \(composition choisie par l’utilisateur — fichier data\/teams\/vortex\.json\)$/)
    // Sans --team : `vortex` prend data/teams/vortex.json (sans jouer de combat ici).
    const data = loadDataStore('data')
    const choice = teamChoiceOf(parseArgs([]), data, 'vortex')
    expect(choice.composition?.source).toBe('file')
    expect(choice.composition?.file).toMatch(/data\/teams\/vortex\.json$/)
    expect(choice.team.map(m => m.breedId)).toEqual([7, 3, 9, 9])
    expect(teamChoiceOf(parseArgs(['--team', 'iop,cra']), data, 'vortex').team.map(m => m.breedId)).toEqual([8, 9])
    // --classes : mêmes classes, builds par défaut du scénario (deux Crâs distincts).
    expect(teamChoiceOf(parseArgs(['--classes', 'eni,enu,cra*2']), data, 'vortex').options!.map(o => o.id)).toEqual(['eniripsa_soin_vortex', 'enutrof_retrait_pm_vortex', 'cra_feu_vortex', 'cra_air_entrave_vortex'])
  })

  it('optimize --dry-run : options et combats prévus sans jouer', async () => {
    expect(await main(['optimize', 'vortex', '--dry-run', '--budget', 'quick', '--no-cache', '--workers', '3'])).toBe(0)
    const t = text()
    expect(t).toContain('optimize vortex — Eniripsa, Enutrof, Crâ, Crâ (composition choisie par l’utilisateur — fichier data/teams/vortex.json)')
    expect(t).toMatch(/Crâ 2 \(Crâ\) : cra_\S+, /)
    expect(t).toMatch(/Combats prévus \(majorant\) : criblage \d+, halving \d+, variantes 0, validation 64 → \d+/)
  })

  it('erreurs : options exclusives, classe inconnue, optimize sans composition', async () => {
    expect(await main(['fight', 'dummy', '--classes', 'cra', '--team', 'iop', '--replay', 'none'])).toBe(1)
    expect(err.join('\n')).toContain('exclusifs')
    err = []
    expect(await main(['fight', 'dummy', '--classes', 'cra,foo', '--replay', 'none'])).toBe(1)
    expect(err.join('\n')).toContain('Classe inconnue : « foo »')
    err = []
    const empty = mkdtempSync(join(tmpdir(), 'dofussimu-cli-empty-'))
    expect(await main(['optimize', 'dummy', '--teams-dir', empty])).toBe(1)
    expect(err.join('\n')).toContain('--classes')
  })
})

describe('CLI : erreurs et garde-fous (revue)', () => {
  it('option d’équipe sans valeur : erreur (pas de repli silencieux sur le fichier du scénario)', async () => {
    expect(await main(['fight', 'dummy', '--team', '--replay', 'none'])).toBe(1)
    expect(err.join('\n')).toContain('--team : équipe attendue')
    err = []
    expect(await main(['fight', 'dummy', '--team-file', '--replay', 'none'])).toBe(1)
    expect(err.join('\n')).toContain('--team-file : chemin du fichier d’équipe attendu')
  })

  it('stuff --member <n°> : n° hors de l’équipe ou sans équipe ⇒ erreur (jamais un identifiant de classe)', async () => {
    const dir = teamsDir(['eniripsa', 'cra'])
    expect(await main(['stuff', 'dummy', '--teams-dir', dir, '--member', '5', '--iterations', '10'])).toBe(1)
    expect(err.join('\n')).toContain('n° de membre entre 1 et 2 attendu (1 = Eniripsa, 2 = Crâ)')
    err = []
    const empty = mkdtempSync(join(tmpdir(), 'dofussimu-cli-empty-'))
    expect(await main(['stuff', 'dummy', '--teams-dir', empty, '--member', '2', '--iterations', '10'])).toBe(1)
    expect(err.join('\n')).toContain('aucune équipe pour « dummy »')
  })

  it('stuff --out : le chemin proposé pour « build » est relatif au fichier d’équipe', async () => {
    const dir = teamsDir(['cra'])
    const file = join(dir, 'builds', 'cra.json')
    expect(await main(['stuff', 'dummy', '--teams-dir', dir, '--member', '1', '--iterations', '50', '--out', file, '--json'])).toBe(0)
    expect(JSON.parse(text()).usage).toContain('"build": "builds/cra.json"')
  }, 120_000)

  it('optimize --save-team : vérifié AVANT les combats ; une autre composition n’est jamais remplacée', async () => {
    const dir = teamsDir(['eniripsa', 'cra'])
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--classes', 'iop,iop', '--save-team', '--dry-run', '--no-cache'])).toBe(1)
    expect(err.join('\n')).toContain('n\'est pas remplacé')
    expect(JSON.parse(readFileSync(join(dir, 'dummy.json'), 'utf8')).members).toEqual(['eniripsa', 'cra'])
    // Même composition donnée par --classes : le fichier du scénario est la cible ; --save-team <fichier> : autre cible.
    err = []
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--classes', 'eni,cra', '--save-team', '--dry-run', '--no-cache'])).toBe(0)
    expect(text()).toContain(`--save-team : builds retenus écrits dans`)
    expect(text()).toContain('dummy.json')
    out = []
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--classes', 'iop,iop', '--save-team', join(dir, 'iops.json'), '--dry-run', '--no-cache'])).toBe(0)
    expect(text()).toContain('iops.json')
  })

  it('optimize : --theta <fichier> = θ de départ (aucun réglage) ; --tune-theta (ou --theta seul) = réglage, compté dans --dry-run', async () => {
    const dir = teamsDir(['cra'])
    const th = join(dir, 'theta.json')
    writeFileSync(th, '{}')
    const estimate = () => out.find(l => l.startsWith('Combats prévus'))!
    // --json : l'aperçu porte le coût du réglage de θ (0 = pas de réglage).
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--theta', th, '--dry-run', '--no-cache', '--json'])).toBe(0)
    expect(JSON.parse(text()).estimate.theta).toBe(0)
    out = []
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--tune-theta', '--dry-run', '--no-cache', '--json'])).toBe(0)
    expect(JSON.parse(text()).estimate.theta).toBeGreaterThan(0)
    out = []
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--tune-theta', '--dry-run', '--no-cache'])).toBe(0)
    expect(estimate()).toMatch(/, θ \d+, validation/)
    out = []
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--theta', '--dry-run', '--no-cache'])).toBe(0)
    expect(estimate()).toMatch(/, θ \d+, validation/)
    expect(await main(['optimize', 'dummy', '--teams-dir', dir, '--theta-paths', 'a.b', '--dry-run', '--no-cache'])).toBe(1)
    expect(err.join('\n')).toContain('--theta-paths : seulement avec --tune-theta')
  })
})

describe('CLI : optimize, report, stuff', () => {
  it('optimize de bout en bout (mannequin) : rapport Markdown + JSON, meilleur replay indexé, --save-team, report', async () => {
    const dir = teamsDir(['cra', 'cra'])
    const work = mkdtempSync(join(tmpdir(), 'dofussimu-cli-opt-'))
    const reports = join(work, 'reports')
    const replays = join(work, 'replays')
    const code = await main([
      'optimize', 'dummy', '--teams-dir', dir, '--ai', 'scripted', '--budget', 'quick', '--screen-seeds', '3', '--halving', '3,4', '--validate', '4',
      '--workers', '0', '--no-cache', '--no-stuff-search', '--out-dir', reports, '--replay-dir', replays, '--id', 'cli-opt', '--save-team',
    ])
    expect(err.join('\n')).toBe('')
    expect(code).toBe(0)
    const t = text()
    expect(t).toContain('optimize dummy — Crâ, Crâ (composition choisie par l’utilisateur — fichier')
    expect(t).toContain('Criblage membre par membre')
    expect(t).toContain('Builds retenus')
    const md = readFileSync(join(reports, 'cli-opt.md'), 'utf8')
    expect(md).toContain('# Builds optimisés — dummy — composition de l’utilisateur (Crâ, Crâ)')
    expect(md).toContain('**Composition choisie par l’utilisateur** : Crâ, Crâ')
    expect(md).toContain('## Recherche des builds (composition fixée)')
    const json = JSON.parse(readFileSync(join(reports, 'cli-opt.json'), 'utf8'))
    expect(json.composition.kind).toBe('user')
    expect(json.builds.validation.seeds).toBe(4)
    // Meilleur replay → index du visualiseur.
    const index = JSON.parse(readFileSync(join(replays, 'index.json'), 'utf8'))
    expect(index.replays[0].file).toMatch(/^dummy-optimize-cli-opt-s\d+\.json$/)
    expect(existsSync(join(replays, index.replays[0].file))).toBe(true)
    // --save-team : builds retenus écrits, composition et notes conservées.
    const saved = JSON.parse(readFileSync(join(dir, 'dummy.json'), 'utf8'))
    expect(saved.members.map((m: { class: string }) => m.class)).toEqual(['cra', 'cra'])
    expect(saved.members.every((m: { preset?: string }) => typeof m.preset === 'string')).toBe(true)
    expect(saved.optimized.report).toContain('cli-opt.md')
    expect(saved.notes).toBe('test')
    expect(saved.members.map((m: { preset: string }) => m.preset)).toEqual(json.builds.slots.map((s: { chosen: string }) => s.chosen))
    // report : rendu identique du JSON enregistré.
    out = []
    const again = join(work, 'again.md')
    expect(await main(['report', join(reports, 'cli-opt.json'), '--out', again])).toBe(0)
    expect(readFileSync(again, 'utf8')).toBe(md)
  }, 300_000)

  it('stuff : build JSON d’un membre de l’équipe, réutilisable comme « build » d’un fichier d’équipe', async () => {
    const dir = teamsDir(['eniripsa', 'cra'])
    const file = join(dir, 'builds', 'cra.json')
    mkdirSync(join(dir, 'builds'), { recursive: true })
    expect(await main(['stuff', 'dummy', '--teams-dir', dir, '--member', '2', '--iterations', '200', '--out', file])).toBe(0)
    const b = JSON.parse(readFileSync(file, 'utf8'))
    expect(b.kind).toBe('dofussimu-build')
    expect(b.preset).toBe('cra_feu_zone')
    expect(b.member).toBe('Crâ')
    expect(b.build.items.length).toBeGreaterThan(5)
    expect(text()).toContain('Proxy  : logJ')
    // Le build sert de build par défaut du membre.
    writeFileSync(join(dir, 'dummy.json'), JSON.stringify({ version: 1, scenario: 'dummy', members: ['eniripsa', { class: 'cra', preset: 'cra_feu_zone', build: 'builds/cra.json' }] }))
    out = []
    expect(await main(['fight', 'dummy', '--teams-dir', dir, '--ai', 'scripted', '--replay', 'none'])).toBe(0)
    expect(out.find(l => l.startsWith('Équipe :'))).toContain('Crâ=cra_feu_zone+build')
    // --member par classe et par preset.
    out = []
    expect(await main(['stuff', 'dummy', '--teams-dir', dir, '--member', 'cra_air_entrave', '--iterations', '100', '--out', join(dir, 'x.json'), '--json'])).toBe(0)
    expect(JSON.parse(text()).preset).toBe('cra_air_entrave')
  }, 300_000)
})
