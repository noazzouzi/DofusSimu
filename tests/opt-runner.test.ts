/**
 * WP4a — exécution d'un combat, graines, variantes, statistiques, Monte-Carlo, cache, politiques `scripted`/`random`
 * (docs/design/ai.md §13, §15.1-§15.2, §16.5) sur données réelles (loadDataStore('data'), vraie carte du Vortex,
 * vrais monstres de vague et vrais sorts de classe).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAIConfig, loadTheta } from '../src/ai'
import { playRandomTurn } from '../src/ai/policies/random'
import { playScriptedTurn } from '../src/ai/policies/scripted'
import { Rng } from '../src/core/rng'
import { loadDataStore } from '../src/data/node'
import { sampleVariant as scenarioVariant, variantKey } from '../src/dungeons'
import type { UncertainParam } from '../src/dungeons/types'
import { canCast, createEngine } from '../src/engine'
import { distance } from '../src/map/geometry'
import { MemoryFightCache, JsonlFightCache, cacheKey, canonicalJson } from '../src/optimizer/cache'
import { checkpoints, compareConfigs, notableSeeds, runBatch } from '../src/optimizer/montecarlo'
import { createLocalPool } from '../src/optimizer/pool/pool'
import { buildTeam, controlScenario, fightDigest, fightParams, parseControlId, resolveScenario, runMicro, runOne, runTask, toReplay } from '../src/optimizer/runner'
import { campaignSeed, campaignSeeds, chunkSeeds, sampleVariant, variantKeyOf, weightedIndex } from '../src/optimizer/seeds'
import {
  batchShouldStop,
  failReasons,
  pairedDiff,
  pairedShouldStop,
  quantile,
  rankKey,
  summarizeBatch,
  variantMarginals,
  wilson,
  worstVariant,
} from '../src/optimizer/stats'
import { PRESETS, getPreset, parseTeam, presetMember } from '../src/optimizer/team/presets'
import { DAMAGE_SPECS } from '../src/engine/effects/damage/pipeline'
import type { FightSpec, FightSummary } from '../src/optimizer/types'
import { parseReplay } from '../src/replay/validate'
import { fighterTable, parseArgs, writeReplay } from '../src/cli/simulate'

const DATA = loadDataStore('data')
/** Combat de contrôle : 4 monstres de vague du Vortex (grade 5) sur la vraie salle, sans règles serveur. */
const CONTROL = 'control:143393281:3834,3836,3837,3838'
const TEAM = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)

function spec(over: Partial<FightSpec> = {}): FightSpec {
  return { scenarioId: CONTROL, team: TEAM, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0, ...over }
}

function fakeSummary(seed: number, win: boolean, score = win ? 1 : 0.2, extra: Partial<FightSummary> = {}): FightSummary {
  return {
    seed, variant: 'default', win, rounds: 10, endReason: win ? 'ok' : 'ko', failReason: win ? undefined : 'défaite',
    deaths: 0, hpLeftPct: win ? 0.5 : 0, damageTaken: 0, progress: 0.25, score, corruptedByRound: [], hoursUsed: 0,
    creativeActions: 0, tactics: {}, spellUse: {}, unknownEffects: 0, nodes: 0, eventsHash: seed, ...extra,
  }
}

describe('seeds (§13.1) : CRN et variantes INCERTAINES', () => {
  it('graines de campagne = mix32(master, i), stables et distinctes', () => {
    const s = campaignSeeds(42, 1000)
    expect(s[0]).toBe(campaignSeed(42, 0))
    expect(campaignSeeds(42, 10, 5)).toEqual(s.slice(5, 15))
    expect(new Set(s).size).toBe(1000)
    expect(s.every(x => Number.isInteger(x) && x >= 0 && x < 2 ** 32)).toBe(true)
    expect(campaignSeeds(43, 3)).not.toEqual(s.slice(0, 3))
    expect(chunkSeeds(s.slice(0, 20), 8).map(c => c.length)).toEqual([8, 8, 4])
  })

  it('tirage pondéré et variante déterministe par graine', () => {
    expect(weightedIndex([0.7, 0.3], 0)).toBe(0)
    expect(weightedIndex([0.7, 0.3], 0.69)).toBe(0)
    expect(weightedIndex([0.7, 0.3], 0.71)).toBe(1)
    expect(weightedIndex([0, 1], 0.2)).toBe(1)
    const unc: UncertainParam[] = [
      { key: 'a', values: [1, 2], weights: [0.7, 0.3] },
      { key: 'b', values: ['x', 'y', 'z'], weights: [0.5, 0.25, 0.25] },
      { key: 'c', values: [[1, 2], [3, 4]], weights: [0.5, 0.5] },
    ]
    const v1 = sampleVariant(unc, 1234)
    expect(sampleVariant(unc, 1234)).toEqual(v1)
    // Fréquences proches des poids sur 4 000 graines.
    let a2 = 0
    let by = 0
    let def = 0
    for (const seed of campaignSeeds(9, 4000)) {
      const v = sampleVariant(unc, seed)
      if (v.params.a === 2) a2++
      if (v.params.b === 'y') by++
      if (v.key === 'default') def++
      expect(variantKeyOf(unc, { a: 1, b: 'x', c: [1, 2], ...v.params })).toBe(v.key)
    }
    expect(a2 / 4000).toBeGreaterThan(0.27)
    expect(a2 / 4000).toBeLessThan(0.33)
    expect(by / 4000).toBeGreaterThan(0.22)
    expect(by / 4000).toBeLessThan(0.28)
    expect(def / 4000).toBeGreaterThan(0.7 * 0.5 * 0.5 - 0.03)
    expect(def / 4000).toBeLessThan(0.7 * 0.5 * 0.5 + 0.03)
    // Un paramètre imposé n'est pas tiré, mais ne décale pas les tirages des autres.
    for (const seed of campaignSeeds(3, 50)) {
      const free = sampleVariant(unc, seed)
      const fixed = sampleVariant(unc, seed, new Set(['a']))
      expect(fixed.params.a).toBeUndefined()
      expect(fixed.params.b).toEqual(free.params.b)
      expect(fixed.params.c).toEqual(free.params.c)
    }
  })

  it('variantes identiques à celles du scénario (src/dungeons sampleVariant / variantKey, WP3)', () => {
    const vortex = resolveScenario('vortex')
    for (const seed of campaignSeeds(77, 500)) {
      const mine = sampleVariant(vortex.uncertain, seed)
      const theirs = scenarioVariant(vortex, seed)
      expect(mine.params).toEqual(theirs.params)
      expect(mine.key).toBe(theirs.key)
      expect(variantKeyOf(vortex.uncertain, { ...vortex.defaultParams, ...mine.params })).toBe(variantKey({ ...vortex.defaultParams, ...mine.params }, vortex.uncertain))
    }
  })

  it('fightParams : défaut, variante tirée, paramètres imposés prioritaires', () => {
    const vortex = resolveScenario('vortex')
    const unc = vortex.uncertain
    expect(unc.length).toBeGreaterThan(0)
    const base = fightParams(vortex, spec({ scenarioId: 'vortex' }), 5)
    expect(base.variant).toBe('default')
    expect(base.params).toEqual(vortex.defaultParams)
    let nonDefault = 0
    for (const seed of campaignSeeds(1, 64)) {
      const p = fightParams(vortex, spec({ scenarioId: 'vortex', variantPolicy: 'sampled' }), seed)
      expect(fightParams(vortex, spec({ scenarioId: 'vortex', variantPolicy: 'sampled' }), seed)).toEqual(p)
      if (p.variant !== 'default') nonDefault++
      const k = unc[0].key
      const forced = fightParams(vortex, spec({ scenarioId: 'vortex', variantPolicy: 'sampled', params: { [k]: unc[0].values[0] as never } }), seed)
      expect(forced.params[k]).toEqual(unc[0].values[0])
    }
    expect(nonDefault).toBeGreaterThan(32) // ≥ 11 paramètres INCERTAINS : presque toujours au moins une variante
  })
})

describe('stats (§15.2) : Wilson, agrégats, comparaisons appariées', () => {
  it('intervalle de Wilson (valeurs de référence)', () => {
    const [lo, hi] = wilson(50, 100)
    expect(lo).toBeCloseTo(0.4038, 3)
    expect(hi).toBeCloseTo(0.5962, 3)
    const [l0, h0] = wilson(0, 32)
    expect(l0).toBe(0)
    expect(h0).toBeCloseTo(0.1072, 3)
    const [l1, h1] = wilson(32, 32)
    expect(l1).toBeCloseTo(0.8928, 3)
    expect(h1).toBe(1)
    expect(wilson(0, 0)).toEqual([0, 1])
    // Couverture empirique ≈ 95 % (p = 0,3, n = 60, 2 000 lots tirés).
    const rng = new Rng(77)
    let covered = 0
    for (let t = 0; t < 2000; t++) {
      let k = 0
      for (let i = 0; i < 60; i++) if (rng.next() < 0.3) k++
      const [a, b] = wilson(k, 60)
      if (a <= 0.3 && 0.3 <= b) covered++
    }
    expect(covered / 2000).toBeGreaterThan(0.92) // couverture discrète, oscillante autour de 95 %
    expect(covered / 2000).toBeLessThan(0.975)
  })

  it('summarizeBatch : indépendant de l\'ordre, variantes, p10, classement', () => {
    const s = [fakeSummary(5, true, 1.05), fakeSummary(1, false), fakeSummary(3, true, 1.02, { variant: 'x=1' }), fakeSummary(2, false, 0.1, { variant: 'x=1' })]
    const b = summarizeBatch(s)
    expect(summarizeBatch([...s].reverse())).toEqual(b)
    expect(b.n).toBe(4)
    expect(b.wins).toBe(2)
    expect(b.winRate).toBe(0.5)
    expect(b.byVariant).toEqual({ default: { n: 2, winRate: 0.5 }, 'x=1': { n: 2, winRate: 0.5 } })
    expect(b.p10HpLeft).toBe(0)
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(1)
    expect(rankKey(b)).toBeGreaterThan(1)
    expect(rankKey(summarizeBatch([fakeSummary(1, false, 0.3)]))).toBeCloseTo(0.3)
    expect(worstVariant(summarizeBatch([...s, fakeSummary(9, false, 0, { variant: 'x=1' })]))?.key).toBe('x=1')
    expect(failReasons(s)).toEqual([{ reason: 'défaite', n: 2 }])
    // Effets marginaux des valeurs INCERTAINES (clés « a=1|b=x »).
    const mv = variantMarginals([
      fakeSummary(1, true, 1, { variant: 'default' }), fakeSummary(2, false, 0, { variant: 'a=1' }),
      fakeSummary(3, false, 0.2, { variant: 'a=1|b=x' }), fakeSummary(4, true, 1, { variant: 'b=x' }),
    ])
    expect(mv.map(m => `${m.param}=${m.value}:${m.n}/${m.baseN}:${m.winRate}/${m.baseWinRate}`)).toEqual(['a=1:2/2:0/1', 'b=x:2/2:0.5/0.5'])
  })

  it('arrêts séquentiels et différence appariée', () => {
    const a = campaignSeeds(1, 40).map((seed, i) => fakeSummary(seed, i % 3 === 0, i % 3 === 0 ? 1 : 0.2))
    const b = a.map(x => ({ ...x, win: true, score: 1.05 }))
    const p = pairedDiff(a, b)
    expect(p.n).toBe(40)
    expect(p.winDiff).toBeCloseTo(1 - 14 / 40)
    expect(p.scoreDiff).toBeGreaterThan(0)
    expect(pairedShouldStop(p, { minN: 32, maxN: 1000, halfWidth: 0.03 })).toBe(true)
    expect(pairedShouldStop(pairedDiff(a, a), { minN: 32, maxN: 1000, halfWidth: 0.03 })).toBe(false)
    expect(batchShouldStop(summarizeBatch(a.slice(0, 10)), { minN: 32, maxN: 100, halfWidth: 0.5 })).toBe(false)
    expect(batchShouldStop(summarizeBatch(a), { minN: 32, maxN: 100, halfWidth: 0.2 })).toBe(true)
    expect(batchShouldStop(summarizeBatch(a), { minN: 32, maxN: 40, halfWidth: 0 })).toBe(true)
    expect(checkpoints({ minN: 32, maxN: 100, halfWidth: 0 }, 1000, 16)).toEqual([32, 48, 64, 80, 96, 100])
    expect(checkpoints({ minN: 32, maxN: 100, halfWidth: 0 }, 20, 16)).toEqual([20])
  })
})

describe('runner : combat complet sur données réelles', () => {
  it('combat de contrôle : analyse de l\'identifiant, placement réel, monstres de vague', () => {
    expect(parseControlId('control:0:36*4@3')).toEqual({ mapId: 143393281, monsters: [{ monsterId: 36, count: 4, grade: 3 }] })
    expect(parseControlId('vortex')).toBeUndefined()
    expect(() => parseControlId('control:1:abc')).toThrow(/illisible/)
    const sc = controlScenario(CONTROL)
    expect(resolveScenario(CONTROL)).toBe(sc)
    const engine = createEngine(DATA, sc.hooks)
    const fight = sc.createFight(engine, buildTeam(DATA, TEAM), { params: sc.defaultParams, seed: 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const players = fight.fighters.filter(f => f.team === 0)
    const monsters = fight.fighters.filter(f => f.team === 1)
    expect(players).toHaveLength(4)
    expect(monsters.map(m => m.monsterId)).toEqual([3834, 3836, 3837, 3838])
    for (const f of fight.fighters) expect(fight.map.cells[f.cell].walkable).toBe(true)
    expect(players.map(p => p.tags.presetId)).toEqual(TEAM.map(m => m.presetId))
    expect(players[0].role).toBe('killer')
    // Les sorts connus sont ceux des variantes du preset.
    const iop = getPreset(TEAM[0].presetId)
    const pairs = DATA.breed(8)!.spellPairs
    expect(players[0].spells.map(s => s.spellId).sort()).toEqual(pairs.map((p, i) => p[iop.variants[i]]).filter(id => DATA.spellLevel(id, { playerLevel: 200 })).sort())
  })

  it('déterminisme : même graine ⇒ même combat (record on/off), graines différentes ⇒ combats différents', () => {
    const a = runOne(DATA, spec(), 11)
    const b = runOne(DATA, spec(), 11, { record: true })
    expect(b.summary).toEqual(a.summary)
    expect(b.fight.events.length).toBeGreaterThan(50)
    expect(a.fight.events.length).toBe(0)
    expect(fightDigest(a.fight)).toBe(a.summary.eventsHash)
    const c = runOne(DATA, spec(), 12)
    expect(c.summary.eventsHash).not.toBe(a.summary.eventsHash)
    // spellUse compté sans événements = lancers enregistrés de l'équipe.
    const recorded: Record<number, number> = {}
    for (const e of b.fight.events) if (e.t === 'cast' && b.fight.fighters[e.fighter].team === 0) recorded[e.spellId] = (recorded[e.spellId] ?? 0) + 1
    expect(a.summary.spellUse).toEqual(recorded)
    // Résumé cohérent (§15.2).
    const s = a.summary
    expect(s.nodes).toBe(0) // scripted : aucun nœud simulé
    expect(s.score).toBeCloseTo(s.win ? 1 + 0.1 * s.hpLeftPct - s.rounds / 600 : 0.8 * s.progress, 10)
    expect(s.hpLeftPct).toBeGreaterThanOrEqual(0)
    expect(s.hpLeftPct).toBeLessThanOrEqual(1)
  })

  it('replay : format du visualiseur (fightStart, carte, méta équipe/rôles/stuff) ; index.json mis à jour', () => {
    const res = runOne(DATA, spec(), 3, { record: true })
    const replay = toReplay(DATA, spec(), res, { createdAt: 'test' })
    const parsed = parseReplay(JSON.parse(JSON.stringify(replay)))
    expect(parsed.warnings ?? []).toEqual([])
    expect(parsed.events[0].t).toBe('fightStart')
    expect(parsed.map?.id).toBe(143393281)
    expect(parsed.meta?.team?.map(t => t.role)).toEqual(['killer', 'zoneDps', 'mpLock', 'healer'])
    expect(parsed.meta?.team?.[0].build).toMatch(/12 PA 6 PM/)
    const dir = mkdtempSync(join(tmpdir(), 'opt-replay-'))
    try {
      writeReplay(join(dir, 'a.json'), replay, { title: 'A', seed: 3 })
      writeReplay(join(dir, 'b.json'), replay, { title: 'B' })
      writeReplay(join(dir, 'a.json'), replay, { title: 'A2' })
      const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { replays: { file: string; title: string }[] }
      expect(idx.replays.map(r => `${r.file}:${r.title}`)).toEqual(['a.json:A2', 'b.json:B'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const table = fighterTable(res.fight).split('\n')
    expect(table).toHaveLength(1 + TEAM.length + res.fight.fighters.filter(f => f.team === 0 && f.kind === 'summon' && (res.fight.metrics[f.id]?.damageDealt || res.fight.metrics[f.id]?.healingDone)).length)
    expect(table[1]).toMatch(/^Iop \(killer\)/)
    expect(parseArgs(['vortex', '--ai', 'fast', '--runs=10', '--robust', '--team', 'iop:killer']).flags).toEqual(
      new Map<string, string | true>([['ai', 'fast'], ['runs', '10'], ['robust', true], ['team', 'iop:killer']]),
    )
  })

  it('Œil de Vortex : un combat complet se joue et se résume (quel que soit l\'avancement de WP3)', () => {
    const r = runOne(DATA, spec({ scenarioId: 'vortex', variantPolicy: 'sampled' }), 7)
    expect(r.summary.rounds).toBeGreaterThan(0)
    expect(typeof r.summary.win).toBe('boolean')
    expect(Number.isFinite(r.summary.score)).toBe(true)
    expect(r.summary.variant).toBe(fightParams(resolveScenario('vortex'), spec({ scenarioId: 'vortex', variantPolicy: 'sampled' }), 7).variant)
    expect(runOne(DATA, spec({ scenarioId: 'vortex', variantPolicy: 'sampled' }), 7).summary).toEqual(r.summary)
  })

  it('micro-scénarios du Vortex (prefix12, phase2, poutch) : résumé = MicroResult, déterministe, tâches de worker', () => {
    const team = parseTeam('iop:killer,cra:killer,enutrof:mpLock,pandawa:placer', DATA)
    const s = spec({ scenarioId: 'vortex', team })
    for (const id of ['prefix12', 'phase2', 'poutch'] as const) {
      const r = runMicro(DATA, s, 3, id)
      expect(r.micro, id).toBeDefined()
      expect(r.summary.score).toBe(r.micro!.pWin)
      expect(r.summary.progress).toBe(r.micro!.progress)
      expect(r.summary.hpLeftPct).toBeGreaterThanOrEqual(0)
      expect(r.summary.hpLeftPct).toBeLessThanOrEqual(1)
      expect(runMicro(DATA, s, 3, id).summary).toEqual(r.summary)
      expect(runTask(DATA, { taskId: 3, spec: s, seeds: [3], kind: id, record: false })).toEqual([r.summary])
    }
    expect(() => runMicro(DATA, spec(), 1, 'prefix12')).toThrow(/indisponible/)
  })

  it('runTask : graines dans l\'ordre ; t0 refusé (WP4b)', () => {
    const out = runTask(DATA, { taskId: 1, spec: spec(), seeds: [4, 2], kind: 'full', record: false })
    expect(out.map(s => s.seed)).toEqual([4, 2])
    expect(() => runTask(DATA, { taskId: 2, spec: spec(), seeds: [1], kind: 't0', record: false })).toThrow(/T0/)
  })
})

describe('politiques `scripted` et `random`', () => {
  it('scripted : suit la rotation du preset, n\'avance pas les dés, 0 nœud', () => {
    const sc = controlScenario(CONTROL)
    const engine = createEngine(DATA, sc.hooks)
    const team = parseTeam('cra:feu', DATA)
    const fight = sc.createFight(engine, buildTeam(DATA, team), { params: sc.defaultParams, seed: 5, rollMode: 'random', record: true, rngRekey: 'perTurn' })
    const cra = fight.fighters[0]
    let me = engine.nextTurn(fight)!
    while (me.id !== cra.id) {
      engine.endTurn(fight, me)
      me = engine.nextTurn(fight)!
    }
    // Position de test : un monstre placé à 4-6 cases du Crâ, sur la case libre la plus « visée » par ses sorts.
    const target = fight.fighters.find(f => f.team === 1)!
    let best = -1
    let bestN = -1
    for (const c of fight.map.cells) {
      const d = distance(c.id, cra.cell)
      if (!c.walkable || d < 4 || d > 6 || engine.fighterAt(fight, c.id)) continue
      const n = cra.spells.filter(s => canCast(engine, fight, cra, s, c.id) === null).length
      if (n > bestN) [best, bestN] = [c.id, n]
    }
    target.cell = best
    const before = fight.events.length
    playScriptedTurn(engine, fight, cra, 1)
    const casts = fight.events.slice(before).filter(e => e.t === 'cast')
    expect(casts.length).toBeGreaterThan(0)
    const preset = getPreset(team[0].presetId)
    const rotationIds = new Set(preset.rotation.map(r => r.spell))
    // Le premier lancer est un sort de la rotation (Balise Tactique / Tirs Puissants / Flèche Explosive…).
    expect(casts.some(c => c.t === 'cast' && rotationIds.has(c.spellId))).toBe(true)
    // Premier lancer : un sort de la rotation, tous les lancers sur des cases légales (le moteur l'a vérifié).
    const first = casts[0]
    expect(first.t === 'cast' && rotationIds.has(first.spellId)).toBe(true)
    expect(cra.ap).toBeLessThan(cra.stats.ap)
    expect(target.hp).toBeLessThan(target.maxHp)
  })

  it('scripted : chaque preset frappe le mannequin (proche ou à 13 cases) ; ≥ 90 % des sorts à dégâts touchent aussitôt', () => {
    // Mannequin passif de WP3 (src/dungeons/generic/dummy.ts, résistances du mix Vortex), 3 tours, un seul personnage.
    const dummyCell = 311
    const near = 323 // 3 cases
    const silent: string[] = []
    const misses: string[] = []
    let damageCasts = 0
    for (const p of PRESETS) {
      for (const params of [{ dummyCell, playerCells: [near] }, {}]) {
        const r = runOne(DATA, { ...spec({ scenarioId: 'dummy', team: [presetMember(p, DATA)] }), params }, 1, { record: true })
        const team = r.fight.fighters.filter(f => f.team === 0)
        const dealt = team.reduce((a, f) => a + (r.fight.metrics[f.id]?.damageDealt ?? 0), 0)
        if (!(dealt > 0)) silent.push(`${p.id} ${params.dummyCell ? 'proche' : 'loin'}`)
        // Un lancer d'un sort à dégâts du personnage doit toucher un ennemi (pas de lancer « pour un buff »).
        const me = team[0]
        const events = r.fight.events
        for (let i = 0; i < events.length; i++) {
          const e = events[i]
          if (e.t !== 'cast' || e.fighter !== me.id || e.element === undefined) continue
          const lvl = me.spells.find(s => s.spellId === e.spellId)?.level
          if (!lvl || !lvl.effects.some(x => DAMAGE_SPECS.has(x.effectId))) continue
          // Les positions bougent (poussées) : on compte un dégât sur un ennemi avant le lancer suivant. Les sorts à
          // dégâts différés ou conditionnels (Flèche Détonante, états) peuvent légitimement ne rien infliger tout de suite.
          let hit = false
          for (let j = i + 1; j < events.length && events[j].t !== 'cast' && events[j].t !== 'turnEnd'; j++) {
            const d = events[j]
            if (d.t === 'damage' && r.fight.fighters[d.target].team !== 0) hit = true
          }
          damageCasts++
          if (!hit) misses.push(`${p.id} : ${e.spellName} sur ${e.cell}`)
        }
      }
    }
    expect(silent).toEqual([])
    console.info(`[scripted/mannequin] ${damageCasts} lancers de sorts à dégâts, ${misses.length} sans dégât immédiat (poisons, bombes, différés) : ${misses.slice(0, 8).join(' ; ')}…`)
    expect(misses.length / damageCasts).toBeLessThan(0.1)
  })

  it('random : légal, déterministe par graine IA', () => {
    const run = (seed: number) => {
      const sc = controlScenario(CONTROL)
      const engine = createEngine(DATA, sc.hooks)
      const fight = sc.createFight(engine, buildTeam(DATA, TEAM), { params: sc.defaultParams, seed: 9, rollMode: 'random', record: true, rngRekey: 'perTurn' })
      const me = engine.nextTurn(fight)!
      const cfg = defaultAIConfig('fast', seed, loadTheta())
      playRandomTurn(engine, fight, me, cfg.seed)
      return { digest: fightDigest(fight), events: fight.events.filter(e => e.t === 'cast' || e.t === 'move').length }
    }
    expect(run(1)).toEqual(run(1))
    const results = new Set([1, 2, 3, 4, 5, 6].map(s => run(s).digest))
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('Monte-Carlo (L1) et cache', () => {
  it('runBatch : ordre des graines, arrêt séquentiel aux points de contrôle, cache', async () => {
    const pool = createLocalPool(DATA)
    const seeds = campaignSeeds(5, 24)
    const full = await runBatch(spec(), seeds, pool)
    expect(full.summaries.map(s => s.seed)).toEqual(seeds)
    expect(full.n).toBe(24)
    expect(full.result).toEqual(summarizeBatch(full.summaries))
    // Arrêt : demi-largeur 0,5 atteinte dès le premier point de contrôle (8 graines).
    const early = await runBatch(spec(), seeds, pool, { stop: { minN: 8, maxN: 24, halfWidth: 0.5 }, checkEvery: 8 })
    expect(early.n).toBe(8)
    expect(early.summaries).toEqual(full.summaries.slice(0, 8))
    // Cache : seconde exécution sans aucun combat joué.
    const cache = new MemoryFightCache()
    const first = await runBatch(spec(), seeds.slice(0, 6), pool, { cache })
    expect(first.computed).toBe(6)
    const again = await runBatch(spec(), seeds.slice(0, 6), pool, { cache })
    expect(again.computed).toBe(0)
    expect(again.cached).toBe(6)
    expect(again.summaries).toEqual(first.summaries)
    expect(notableSeeds(full.summaries)).toBeTypeOf('object')
  })

  it('compareConfigs : appariement sur les mêmes graines (random contre scripted)', async () => {
    const pool = createLocalPool(DATA)
    const seeds = campaignSeeds(8, 16)
    const cmp = await compareConfigs(spec({ playerPolicy: 'random' }), spec(), seeds, pool, { minN: 8, maxN: 16, halfWidth: 0 }, { checkEvery: 8 })
    expect(cmp.a.summaries.map(s => s.seed)).toEqual(cmp.b.summaries.map(s => s.seed))
    expect(cmp.paired.n).toBe(cmp.n)
    expect(cmp.paired.scoreDiff).toBeGreaterThan(0) // scripted > random
  })

  it('cache JSONL : reprise de campagne, autre version ignorée, clés canoniques', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opt-cache-'))
    try {
      const file = join(dir, 'c.jsonl')
      const s = fakeSummary(1, true)
      const c1 = new JsonlFightCache(file, 'v-test')
      c1.put(spec(), 1, s)
      c1.put(spec(), 1, s) // doublon ignoré
      expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1)
      expect(new JsonlFightCache(file, 'v-test').get(spec(), 1)).toEqual(s)
      const other = new JsonlFightCache(file, 'v-other')
      expect(other.get(spec(), 1)).toBeUndefined()
      expect(other.skipped).toBe(1)
      expect(cacheKey(spec(), 1)).not.toBe(cacheKey(spec({ mode: 'fast' }), 1))
      expect(cacheKey(spec(), 1)).not.toBe(cacheKey(spec(), 2))
      expect(cacheKey(spec(), 1, 'prefix12')).not.toBe(cacheKey(spec(), 1))
      expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
