/**
 * WP4b — rapport d'optimisation (docs/design/ai.md §15.9) : lot réel (combat de contrôle, `scripted`), Markdown + JSON
 * + replays notables rejoués avec `record: true`, écrits dans un dossier temporaire ; plan de combat du Vortex.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { createLocalPool } from '../src/optimizer/pool/pool'
import { buildReport, describeMember, fightPlan, generateReport, renderMarkdown, thetaChanges } from '../src/optimizer/report'
import { optimizeStuff } from '../src/optimizer/stuff/search'
import { parseTeam } from '../src/optimizer/team/presets'
import { evaluateSpec } from '../src/optimizer/tune'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const team = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
const spec: FightSpec = { scenarioId: 'control:143393281:3834,3836,3837,3838,3839,3834', team, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }

describe('rapport', () => {
  it('écrit Markdown + JSON + replays notables (victoire médiane, meilleure victoire, échec typique)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dofussimu-report-'))
    const stuff = [optimizeStuff(DATA, team[1], { iterations: 50, perSlot: 8, dofusPool: 8, topExact: 5, points: false })]
    const { report, files } = await generateReport(DATA, spec, createLocalPool(DATA), {
      id: 'test-controle',
      title: 'Rapport de test',
      createdAt: '2026-10-05',
      seeds: 10,
      dir,
      stuff,
      history: ['étape de test'],
    })
    expect(existsSync(files.markdown)).toBe(true)
    expect(existsSync(files.json)).toBe(true)
    const json = JSON.parse(readFileSync(files.json, 'utf8'))
    expect(json.id).toBe('test-controle')
    expect(json.results.n).toBe(10)
    expect(json.team.length).toBe(4)
    expect(report.results.result.wilson95[0]).toBeLessThanOrEqual(report.results.result.winRate)
    const md = readFileSync(files.markdown, 'utf8')
    for (const h of ['# Rapport de test', '## Résultat', '## Équipe', '## Plan de combat', '## Paramètres de stratégie θ', '## Historique d’optimisation', '## Replays']) expect(md).toContain(h)
    expect(md).toContain('IC 95 %')
    expect(md).toContain('étape de test')
    expect(md).toContain('Stuff Crâ (proxy)')
    // Replays : 1 à 3 fichiers valides (fightStart en tête), référencés par le rapport.
    expect(report.replays.length).toBeGreaterThanOrEqual(1)
    expect(report.replays.length).toBeLessThanOrEqual(3)
    for (const r of report.replays) {
      const replay = JSON.parse(readFileSync(join(dir, r.file), 'utf8'))
      expect(replay.events[0].t).toBe('fightStart')
      expect(replay.meta.seed).toBe(r.seed)
    }
    expect(files.replays.length).toBe(report.replays.length)
  }, 300_000)

  it('membres : objets, forgemagie, sorts passifs non simulés, variantes ; plan du Vortex ; écarts de θ', async () => {
    const m = describeMember(DATA, team[0])
    expect(m.className).toBe('Iop')
    expect(m.items.length).toBe(team[0].build.items.length)
    expect(m.items.some(i => i.forgemagie.length > 0)).toBe(true)
    expect(m.items.find(i => i.itemId === 7754)?.passiveUnsimulated).toBe(true) // Dofus Ocre
    expect(m.spells.length).toBe(22)
    expect(m.spells.every(s => !s.changedFromPreset)).toBe(true)
    expect(m.stats.ap).toBe(12)
    const members = team.map(x => describeMember(DATA, x))
    const plan = fightPlan({ ...spec, scenarioId: 'vortex' }, members)
    expect(plan.hours!.map(h => h.hours)).toEqual([['I', 'V', 'IX'], ['II', 'VI', 'X'], ['III', 'VII', 'XI'], ['IV', 'VIII', 'XII']])
    expect(plan.cheapHours![0]).toMatch(/^VII/)
    expect(plan.doctrine.length).toBeGreaterThan(0)
    const theta = loadTheta({ value: { incoming: 1.2 } })
    expect(thetaChanges(theta)).toEqual({ 'value.incoming': [0.8, 1.2] })
    const evaluation = await evaluateSpec(spec, [1, 2, 3], createLocalPool(DATA))
    const r = buildReport(DATA, { id: 'x', spec: { ...spec, theta }, evaluation })
    const md = renderMarkdown(r)
    expect(md).toContain('`value.incoming` : 0.8 → **1.2**')
    expect(md).toContain('Sorts passifs')
  }, 300_000)
})
