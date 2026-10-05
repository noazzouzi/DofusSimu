/**
 * WP4b — composition d'équipe (niveau L5, docs/design/ai.md §15.6) : prior (rôles, synergies des fiches de classe),
 * capacités des presets réels (proxy exact, DptTable), modèle analytique T0 (monotonie, énumération, classement,
 * calibration sur observations).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { CLASS_IDS, normalizeName, PRESETS, resolvePreset, type Preset } from '../src/optimizer/team/presets'
import { aptitude, archetypeKey, archetypeOf, coverageOf, SYNERGY_LINKS, synergyKey, teamPrior } from '../src/optimizer/team/prior'
import { calibrateT0 } from '../src/optimizer/team/halving'
import { defaultT0Params, presetCapabilities, t0Evaluate, t0Rank, teamIndexSets, type PresetCapability } from '../src/optimizer/team/t0model'

const DATA = loadDataStore('data')
const P = (id: string) => resolvePreset(id)
const META = ['cra_feu_zone', 'enutrof_retrait_pm_eau', 'iop_terre_burst', 'eniripsa_soin_feu'].map(P)

describe('prior de composition', () => {
  it('matrice de synergies = fiches de classe (data/research/class-mechanics/*.json)', () => {
    const dir = 'data/research/class-mechanics'
    const links: Record<string, number> = {}
    for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { breedId: number; synergies?: { with?: string }[] }
      for (const s of d.synergies ?? []) {
        const found = new Set<number>()
        for (const tok of normalizeName(s.with ?? '').match(/[a-z']+/g) ?? []) {
          const id = CLASS_IDS[tok]
          if (id !== undefined && id !== d.breedId) found.add(id)
        }
        for (const b of found) links[synergyKey(d.breedId, b)] = (links[synergyKey(d.breedId, b)] ?? 0) + 1
      }
    }
    expect(links).toEqual(SYNERGY_LINKS)
  })

  it('couverture des besoins du Vortex, synergies, compositions citées, pénalités, archétypes', () => {
    const meta = teamPrior(META, undefined, id => DATA.breed(id))
    expect(meta.coverage).toBeGreaterThan(0.6)
    expect(meta.cited).toContain('Crâ + Enutrof retrait PM (DPLN)')
    expect(meta.penalties).toEqual([])
    expect(meta.assignment).toEqual(['zoneDps', 'mpLock', 'killer', 'healer'])
    const healers = teamPrior(['eniripsa_soin_feu', 'sadida_soin', 'osamodas_soutien_soin', 'steamer_soutien'].map(P))
    expect(healers.coverage).toBeLessThan(meta.coverage)
    expect(healers.score).toBeLessThan(meta.score)
    const triple = teamPrior(['iop_terre_burst', 'iop_multi_zone', 'iop_soutien', 'cra_feu_zone'].map(P))
    expect(triple.penalties.some(p => p.startsWith('classe'))).toBe(true)
    expect(triple.score).toBeLessThan(meta.score - 0.5)
    expect(archetypeKey(archetypeOf(META))).toBe('soin/sans-placeur')
    expect(aptitude(P('iop_terre_burst'), 'zoneDps')).toBe(0.8)
    expect(aptitude(P('pandawa_placement'), 'placer')).toBe(1)
    // Mémoïsation : même résultat, indépendant de l'appel.
    expect(coverageOf(META, { killer: 2, mpLock: 1 })).toEqual(coverageOf(META, { killer: 2, mpLock: 1 }))
  })
})

describe('modèle T0', () => {
  const subset = ['cra_feu_zone', 'enutrof_retrait_pm_eau', 'iop_terre_burst', 'eniripsa_soin_feu', 'pandawa_placement', 'sacrieur_tank', 'xelor_zone_feu_air', 'sadida_soin', 'roublard_artificier', 'feca_protecteur'].map(P)
  const caps = presetCapabilities(DATA, subset)
  const cap = (id: string) => caps[subset.findIndex(p => p.id === id)]
  const params = defaultT0Params(DATA)

  it('capacités cohérentes avec les rôles (presets et stuffs réels)', () => {
    expect(params.waveSizes).toEqual([3, 4, 4, 4, 4])
    expect(params.waveHp).toBeGreaterThan(1000)
    expect(cap('cra_feu_zone').dptWave).toBeGreaterThan(2 * cap('enutrof_retrait_pm_eau').dptWave)
    expect(cap('enutrof_retrait_pm_eau').mpRemoved).toBeGreaterThan(cap('cra_feu_zone').mpRemoved)
    expect(cap('eniripsa_soin_feu').heal).toBeGreaterThan(cap('cra_feu_zone').heal)
    expect(cap('sacrieur_tank').ehp).toBeGreaterThan(cap('cra_feu_zone').ehp)
    for (const c of caps) {
      for (const k of ['dptWave', 'dptVortex', 'incWave', 'incVortex', 'ehp', 'mpRemoved', 'heal'] as const) expect(Number.isFinite(c[k])).toBe(true)
      expect(c.incVortex).toBeGreaterThan(0)
    }
  })

  it('monotonie : plus de dégâts ou d’EHP ne dégrade jamais la prédiction', () => {
    const team = ['cra_feu_zone', 'enutrof_retrait_pm_eau', 'iop_terre_burst', 'eniripsa_soin_feu'].map(cap)
    const base = t0Evaluate(team, params)
    const stronger = t0Evaluate(team.map(c => ({ ...c, dptWave: c.dptWave * 1.5, dptVortex: c.dptVortex * 1.5 })), params)
    const tougher = t0Evaluate(team.map(c => ({ ...c, ehp: c.ehp * 2 })), params)
    expect(stronger.predicted).toBeGreaterThanOrEqual(base.predicted)
    expect(tougher.predicted).toBeGreaterThanOrEqual(base.predicted)
    expect(stronger.phase1.corrupted).toBeGreaterThanOrEqual(base.phase1.corrupted)
    const weak = t0Evaluate(team.map(c => ({ ...c, dptWave: c.dptWave * 0.2, dptVortex: c.dptVortex * 0.2 })), params)
    expect(weak.predicted).toBeLessThan(base.predicted + 1e-12)
    expect(weak.pWin).toBeLessThanOrEqual(base.pWin)
    for (const r of [base, stronger, tougher, weak]) {
      expect(r.pWin).toBeGreaterThanOrEqual(0)
      expect(r.pWin).toBeLessThanOrEqual(1)
      expect(r.phase1.total).toBe(19)
    }
  })

  it('énumération des multiensembles (≤ 2 par classe) et classement déterministe', () => {
    const toy = [{ breedId: 1 }, { breedId: 1 }, { breedId: 2 }] as Preset[]
    expect([...teamIndexSets(toy, 2, 2, 1)]).toEqual([[0, 1], [0, 2], [1, 2]])
    expect([...teamIndexSets(toy, 2, 1, 1)]).toEqual([[0, 2], [1, 2]])
    expect([...teamIndexSets(toy, 2, 2, 2)].length).toBe(6)
    expect([...teamIndexSets(toy, 3, 2, 2)].every(t => t.filter(i => toy[i].breedId === 1).length <= 2)).toBe(true)
    const r = t0Rank(DATA, { presets: subset, capabilities: caps, top: 15 })
    expect(r.evaluated).toBe([...teamIndexSets(subset, 4, 2, 1)].length)
    expect(r.top.length).toBe(15)
    for (let i = 1; i < r.top.length; i++) expect(r.top[i - 1].score).toBeGreaterThanOrEqual(r.top[i].score)
    const again = t0Rank(DATA, { presets: subset, capabilities: caps, top: 15 })
    expect(again.top.map(x => x.presetIds.join(','))).toEqual(r.top.map(x => x.presetIds.join(',')))
    // Le meilleur classé bat le pire de l'énumération complète.
    const all = t0Rank(DATA, { presets: subset, capabilities: caps, top: 1000 })
    expect(all.top[0].score).toBeGreaterThan(all.top[all.top.length - 1].score)
  })

  it('calibration sur observations : retrouve l’efficacité et l’exposition qui ont produit les scores', () => {
    const truth = { ...params, efficiency: 0.7, exposure: 1.5 }
    const teams: PresetCapability[][] = []
    for (const idx of teamIndexSets(subset, 4, 2, 1)) {
      if (teams.length >= 24) break
      if (idx[0] % 2 === 0) teams.push(idx.map(i => caps[i]))
    }
    const obs = teams.map(t => ({ capabilities: t, observed: t0Evaluate(t, truth).predicted }))
    const fit = calibrateT0(obs, params)
    expect(fit.params.efficiency).toBeCloseTo(0.7, 6)
    expect(fit.params.exposure).toBeCloseTo(1.5, 6)
    expect(fit.mse).toBeLessThan(1e-12)
  })

  it('évaluation rapide (< 200 µs par équipe en moyenne, cible du design)', () => {
    const teams = [...teamIndexSets(subset, 4, 2, 1)].map(idx => ({ caps: idx.map(i => caps[i]), presets: idx.map(i => subset[i]) }))
    for (const t of teams.slice(0, 200)) t0Evaluate(t.caps, params, t.presets)
    const t0 = performance.now()
    let n = 0
    for (let k = 0; k < 4; k++) for (const t of teams) (t0Evaluate(t.caps, params, t.presets), n++)
    expect((performance.now() - t0) / n).toBeLessThan(0.2)
  })
})

void PRESETS
