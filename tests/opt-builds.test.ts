/**
 * Optimisation des builds pour une composition FIXÉE par l'utilisateur (src/optimizer/builds.ts, commande `optimize`) :
 * pipeline complet sur le mannequin (`dummy`, IA `scripted`, pool local, peu de graines) — options par membre, stuffs
 * optimisés pour les presets sans stuff du scénario, criblage apparié, halving avec témoin, validation, plafond de
 * combats, membres imposés, mesures (corrompus, tours, première mort) et rapport (composition de l'utilisateur).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { buildsReport, fightMetrics, optimizeBuilds, previewBuildSearch, scenarioProxyOptions, thetaTuneCost, thetaTuneOptions } from '../src/optimizer/builds'
import { createLocalPool } from '../src/optimizer/pool/pool'
import { generateReport, renderMarkdown } from '../src/optimizer/report'
import { runOne } from '../src/optimizer/runner'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { loadTeamFile, findTeamFile } from '../src/optimizer/team/teamfile'
import { compositionFromClasses, compositionFromTeamFile, compositionFromTeamText, parseTeamFile } from '../src/optimizer/team/userteam'
import { tunableParams } from '../src/optimizer/tune'
import type { FightSpec, FightSummary } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const BASE: Omit<FightSpec, 'team'> = { scenarioId: 'dummy', mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }

describe('optimize : builds d’une composition fixée', () => {
  it('pipeline complet sur le mannequin : criblage, halving avec témoin, validation, classes inchangées', async () => {
    const comp = compositionFromClasses([7, 9, 9], 'dummy')
    const lines: string[] = []
    const r = await optimizeBuilds(DATA, BASE, comp, createLocalPool(DATA), { budget: 'quick', screenSeeds: 4, halving: [4, 6], validation: 6, stuff: false, onLog: l => lines.push(l) })
    // Classes inchangées (composition de l'utilisateur), noms uniques.
    expect(r.chosen.spec.team.map(m => m.breedId)).toEqual([7, 9, 9])
    expect(r.chosen.spec.team.map(m => m.name)).toEqual(['Eniripsa', 'Crâ', 'Crâ 2'])
    expect(r.slots.map(s => s.reference)).toEqual(['eniripsa_soin_feu', 'cra_feu_zone', 'cra_air_entrave'])
    // Criblage : chaque option de chaque membre jouée sur les mêmes graines ; la référence a Δ = 0.
    for (const s of r.slots) {
      expect(s.screen!.length).toBe(s.options.length)
      expect(s.screen!.find(e => e.option === s.reference)!.diff).toBe(0)
      expect(s.kept.length).toBe(2)
      for (const e of s.screen!) expect(e.metrics.n).toBe(4)
    }
    // Halving : témoin à chaque étage, jamais éliminé ; graines cumulées.
    expect(r.halving.length).toBeGreaterThanOrEqual(1)
    for (const h of r.halving) {
      const ctl = h.entries.filter(e => e.control)
      expect(ctl.length).toBe(1)
      expect(ctl[0].kept).toBe(true)
      expect(ctl[0].id).toBe(r.reference.id)
      expect(h.entries.every(e => e.metrics.n === h.seeds)).toBe(true)
    }
    // Deux Crâs interchangeables : jamais à la fois « A, B » et « B, A ».
    const firstRound = r.halving[0].entries.map(e => [e.options[0], [...e.options.slice(1)].sort().join('|')].join('/'))
    expect(new Set(firstRound).size).toBe(firstRound.length)
    // Validation sur graines neuves, configuration retenue = la meilleure si elle n'est pas moins bonne que la référence.
    expect(r.validation.seeds).toBe(6)
    expect(r.validation.bestMetrics.n).toBe(6)
    if (!r.validation.same) expect(r.validation.chosen).toBe(r.validation.best.objective >= r.validation.reference.objective ? 'best' : 'reference')
    expect(r.chosen.evaluation.summaries.length).toBe(6)
    expect(r.fights).toBeGreaterThan(0)
    expect(lines.some(l => l.includes('Composition fixée'))).toBe(true)
    // Le meilleur build trouvé ne dégrade pas l'objectif sur les graines du dernier étage.
    const last = r.halving[r.halving.length - 1].entries
    const top = last.slice().sort((a, b) => a.rank - b.rank)[0]
    expect(top.metrics.objective).toBeGreaterThanOrEqual(last.find(e => e.control)!.metrics.objective)
    expect(r.best.id).toBe(top.id)
  }, 300_000)

  it('stuffs optimisés pour les presets sans stuff du scénario (`<preset>@opt`), membres imposés non cherchés', async () => {
    const comp = compositionFromClasses([9], 'dummy')
    const r = await optimizeBuilds(DATA, BASE, comp, createLocalPool(DATA), { screenSeeds: 3, halving: [3], validation: 3, stuff: { iterations: 200, topExact: 5, points: false }, variants: false })
    const ids = r.slots[0].options.map(o => o.id)
    expect(ids[0]).toBe('cra_feu_zone') // la référence reste jouée telle quelle
    expect(ids).toContain('cra_feu_zone@opt')
    expect(ids.filter(x => x.endsWith('@opt')).length).toBe(3) // un stuff par preset de base de la classe
    expect(ids).not.toContain('cra_air_entrave') // remplacé par sa version optimisée
    expect(r.stuff.length).toBe(3)
    const opt = r.slots[0].options.find(o => o.id === 'cra_feu_zone@opt')!
    expect(opt.origin).toBe('stuff-optimizer')
    expect(opt.note).toMatch(/proxy/)
    // Membre imposé (--team) : une seule option, pas de criblage.
    const fixed = await optimizeBuilds(DATA, BASE, compositionFromTeamText('cra_feu_zone', 'dummy'), createLocalPool(DATA), { validation: 2 })
    expect(fixed.slots[0].options.map(o => o.id)).toEqual(['cra_feu_zone'])
    expect(fixed.screenSeeds).toBe(0)
    expect(fixed.halving.length).toBe(0)
    expect(fixed.validation.same).toBe(true)
    expect(fixed.fights).toBe(2)
  }, 300_000)

  it('plafond de combats : validation réservée, étages réduits ou sautés et signalés', async () => {
    const comp = compositionFromClasses([9, 9], 'dummy')
    const r = await optimizeBuilds(DATA, BASE, comp, createLocalPool(DATA), { screenSeeds: 8, halving: [8, 16], validation: 4, maxFights: 40, stuff: false })
    expect(r.fights).toBeLessThanOrEqual(40)
    expect(r.validation.seeds).toBe(4)
    expect(r.notes.some(n => n.includes('Plafond de combats'))).toBe(true)
  }, 300_000)

  it('déterministe : même graine maîtresse ⇒ même recherche (options, criblage, halving, validation, combats)', async () => {
    const comp = compositionFromClasses([9, 9], 'dummy')
    const run = () => optimizeBuilds(DATA, BASE, comp, createLocalPool(DATA), { screenSeeds: 2, halving: [2, 3], validation: 2, stuff: false, masterSeed: 77 })
    const a = await run()
    const b = await run()
    expect(JSON.stringify(buildsReport(b))).toBe(JSON.stringify(buildsReport(a)))
    expect(b.chosen.evaluation.summaries.map(s => s.eventsHash)).toEqual(a.chosen.evaluation.summaries.map(s => s.eventsHash))
    expect(b.best.id).toBe(a.best.id)
  }, 300_000)

  it('θ respecte le plafond de combats : réglage sauté et signalé s’il ne tient pas', async () => {
    const r = await optimizeBuilds(DATA, BASE, compositionFromTeamText('cra_feu_zone', 'dummy'), createLocalPool(DATA), { validation: 2, maxFights: 10, theta: true })
    expect(r.tune).toBeUndefined()
    expect(r.notes.some(n => n.includes('réglage de θ sauté'))).toBe(true)
    expect(r.fights).toBeLessThanOrEqual(10)
    // Coût estimé : criblage (1 + 2P) × 8, CEM 8 × 4 × 8, validation 2 × 32 ; moins de paramètres avec `paths`.
    const p = tunableParams(BASE.theta).length
    expect(thetaTuneCost(BASE.theta, thetaTuneOptions(true, 1))).toBe((1 + 2 * p) * 8 + 8 * 4 * 8 + 64)
    const one = tunableParams(BASE.theta)[0].path
    expect(thetaTuneCost(BASE.theta, thetaTuneOptions({ paths: [one] }, 1))).toBe(8 * 4 * 8 + 64)
    expect(previewBuildSearch(DATA, BASE, compositionFromClasses([9], 'dummy'), { theta: true }).estimate.theta).toBe((1 + 2 * p) * 8 + 8 * 4 * 8 + 64)
  }, 120_000)

  it('preset donné par l’utilisateur sans stuff du scénario : joué tel quel en référence + option `@opt`', () => {
    const comp = compositionFromTeamFile(parseTeamFile({ scenario: 'dummy', members: [{ class: 'cra', preset: 'cra_terre_mono' }] }))
    const ids = previewBuildSearch(DATA, BASE, comp, { budget: 'quick' }).slots[0].options.map(o => o.id)
    expect(ids[0]).toBe('cra_terre_mono')
    expect(ids).toContain('cra_terre_mono@opt')
  })

  it('mesures : corrompus en fin de combat, première mort (tours du combat sans mort), Wilson', () => {
    const s = (seed: number, win: boolean, rounds: number, corrupted: number[], firstDeathRound?: number): FightSummary => ({
      seed, variant: 'default', win, rounds, endReason: 'x', deaths: firstDeathRound ? 1 : 0, hpLeftPct: 0.5, damageTaken: 0, progress: 0.5, score: win ? 1 : 0.4,
      corruptedByRound: corrupted, hoursUsed: 0, creativeActions: 0, tactics: {}, spellUse: {}, unknownEffects: 0, nodes: 0, eventsHash: 0, ...(firstDeathRound ? { firstDeathRound } : {}),
    })
    const m = fightMetrics([s(1, true, 30, [1, 4, 19], 21), s(2, false, 20, [2, 5]), s(3, false, 10, [], 4)])
    expect(m.n).toBe(3)
    expect(m.wins).toBe(1)
    expect(m.corrupted).toBeCloseTo((19 + 5 + 0) / 3, 3)
    expect(m.rounds).toBeCloseTo(20, 6)
    expect(m.firstDeath).toBeCloseTo((21 + 20 + 4) / 3, 3)
    expect(m.wilson95[0]).toBeLessThan(1 / 3)
    expect(m.wilson95[1]).toBeGreaterThan(1 / 3)
  })

  it('première mort d’un personnage dans le résumé d’un combat (registre des morts)', () => {
    // Crâ sans stuff contre 4 Brabuzars : il meurt ; le tour de sa mort est rapporté.
    const spec: FightSpec = { ...BASE, scenarioId: 'control:143393281:3839*4', team: [presetMember(getPreset('cra_feu_zone'), DATA, { stuff: 'naked' })] }
    const s = runOne(DATA, spec, 3).summary
    expect(s.deaths).toBe(1)
    expect(s.firstDeathRound).toBeGreaterThanOrEqual(1)
    expect(s.firstDeathRound).toBeLessThanOrEqual(s.rounds)
    expect(fightMetrics([s]).firstDeath).toBe(s.firstDeathRound)
  }, 120_000)

  it('rapport : bandeau « composition choisie par l’utilisateur », section de recherche des builds, Markdown + JSON', async () => {
    const comp = compositionFromClasses([9, 9], 'dummy')
    const pool = createLocalPool(DATA)
    const r = await optimizeBuilds(DATA, BASE, comp, pool, { screenSeeds: 3, halving: [3], validation: 3, stuff: false })
    const dir = mkdtempSync(join(tmpdir(), 'dofussimu-builds-'))
    const { report, files } = await generateReport(DATA, r.chosen.spec, pool, {
      id: 'builds-test',
      title: 'Builds — test',
      createdAt: '2026-10-05',
      evaluation: r.chosen.evaluation,
      history: r.log,
      notes: r.notes,
      dir,
      replays: false,
      composition: { kind: 'user', classes: ['Crâ', 'Crâ'], text: 'Crâ, Crâ', file: 'data/teams/x.json', decidedAt: '2026-10-05' },
      builds: buildsReport(r),
    })
    const md = readFileSync(files.markdown, 'utf8')
    expect(md).toContain('**Composition choisie par l’utilisateur** : Crâ, Crâ (`data/teams/x.json`, décision du 2026-10-05)')
    expect(md).toContain('Les classes ne sont pas optimisées')
    for (const h of ['## Recherche des builds (composition fixée)', '### Criblage — Crâ (Crâ)', '### Criblage — Crâ 2 (Crâ)', '### Halving — Étage 1 (3 graines)', '### Validation (3 graines neuves)']) expect(md).toContain(h)
    const json = JSON.parse(readFileSync(files.json, 'utf8'))
    expect(json.composition.kind).toBe('user')
    expect(json.builds.slots.length).toBe(2)
    expect(json.builds.composition.classes).toEqual(['Crâ', 'Crâ'])
    expect(renderMarkdown(json)).toBe(renderMarkdown(report))
  }, 300_000)

  it('aperçu (--dry-run) de l’équipe du Vortex : options de chaque membre, stuff à optimiser annoncé, combats prévus', () => {
    // Classes du fichier de l'utilisateur (sans ses éventuels builds épinglés) : options par défaut de la composition.
    const composition = compositionFromClasses(loadTeamFile(findTeamFile('vortex')!).composition.members.map(m => m.breedId), 'vortex')
    const p = previewBuildSearch(DATA, { ...BASE, scenarioId: 'vortex', mode: 'fast' }, composition, { budget: 'quick' })
    expect(p.slots.map(s => s.options[0].id)).toEqual(['eniripsa_soin_vortex', 'enutrof_retrait_pm_vortex', 'cra_feu_vortex', 'cra_air_entrave_vortex'])
    for (const s of p.slots) expect(s.options.length).toBeGreaterThanOrEqual(5)
    // Presets sans stuff Vortex : stuff construit par l'optimiseur (annoncé, non calculé ici).
    const eni = p.slots[0].options.map(o => o.id)
    expect(eni.filter(id => id.endsWith('@opt')).every(id => !id.includes('_vortex'))).toBe(true)
    const e = p.estimate
    const screenTeams = 1 + p.slots.reduce((a, s) => a + s.options.length - 1, 0)
    expect(e.screen).toBe(screenTeams * 8)
    expect(e.validation).toBe(64)
    expect(e.total).toBe(e.screen + e.halving + e.variants + e.validation)
    expect(previewBuildSearch(DATA, { ...BASE, scenarioId: 'vortex' }, composition, { budget: 'quick', maxFights: 100 }).estimate.total).toBe(100)
    expect(previewBuildSearch(DATA, { ...BASE, scenarioId: 'vortex' }, composition, { budget: 'full' }).estimate.variants).toBeGreaterThan(0)
  })

  it('proxy du scénario : Vortex ⇒ cibles et dégâts reçus mesurés du Vortex, PO visée 6 à distance ; ailleurs défaut', () => {
    const v = scenarioProxyOptions('vortex', getPreset('cra_feu_vortex'))!
    expect(v.incoming?.length).toBeGreaterThan(0)
    expect(v.rangeNeed).toBe(6)
    expect(scenarioProxyOptions('vortex', getPreset('iop_terre_burst'))!.rangeNeed).toBeUndefined()
    expect(scenarioProxyOptions('dummy', getPreset('cra_feu_zone'))).toBeUndefined()
  })
})
