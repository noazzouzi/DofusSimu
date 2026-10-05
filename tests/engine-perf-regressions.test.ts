/**
 * Régressions des optimisations de performance (vérification adverse) — caches et partages introduits dans le moteur
 * et le socle IA, testés contre une implémentation de référence SANS cache ni partage :
 *  - `cloneFight` en copie-sur-écriture (src/engine/cow.ts) ≡ copie profonde (ancienne sémantique) sur de VRAIS combats
 *    (Vortex et escarmouche, équipes à invocations, portage, téléportations, pièges, glyphes, doubles, tourelles) joués
 *    par un contrôleur qui tente chaque sort sur de nombreuses cases (morts, résurrections du Vortex, boucliers, états,
 *    relances, compteurs, métriques), en jets aléatoires ET en espérance ('average', PO fractionnaires) ; indépendance
 *    parent / clone / petit-clone ;
 *  - anneaux de portée inverse (`inverseRange`) : clé de cache exacte (PO fractionnaires des clones 'average') ;
 *  - `castCellsFor` (invariants par cible, anneau sans revérification de portée) ≡ ancienne version (`castGeometryOk`
 *    sur chaque case, anneau exhaustif) ;
 *  - cadres réutilisés des zones (`zoneCells`, `isCellInZone`) : rappels réentrants et exceptions ;
 *  - tranches de mémoire partagées des `ReachInfo` / occupations (`reach.ts`) : aucun recouvrement.
 */
import { describe, expect, it } from 'vitest'
import { castCellsFor, castGeom, castGeometryOk, inverseRange, LosOracle, levelFor, type CastGeom } from '../src/ai/core/castCells'
import { buildOccupancy, cachedReach, cloneReach, computeReachFor, createReachInfo } from '../src/ai/core/reach'
import type { ReachInfo } from '../src/ai/types'
import { Rng } from '../src/core/rng'
import { createEngine } from '../src/engine'
import { canCast, castSpell } from '../src/engine/cast'
import { cloneFighter, type Engine } from '../src/engine/engine'
import { move, reachableCells, pathTo } from '../src/engine/move'
import type { Fighter, FighterMetrics, FightState, KnownSpell } from '../src/engine/types'
import type { SpellLevelData } from '../src/data/model'
import { CELL_COUNT, distance, isInCastRange } from '../src/map/geometry'
import { isCellInZone, zoneCells, zoneMembership } from '../src/map/zones'
import { buildTeam, fightParams, resolveScenario } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'
import { data, randomScene, yieldToEventLoop } from './ai-core-helpers'
import { cellAt, effect, fight, has, monster, newEngine, player, turnOf } from './effects-summons-helpers'
import { applyEffects } from '../src/engine/effects/core'
import type { EffectData } from '../src/data/model'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, spawnVortexWave, vortexHooks } from '../src/dungeons/vortex/setup'
import { VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'

// ───────────────────────────── anneaux : clé exacte ─────────────────────────────

/** Référence : balayage exhaustif trié par (distance, id). */
function refRing(g: CastGeom, target: number): number[] {
  const out: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) if (isInCastRange(c, target, g.min, g.max, g.line, g.diag)) out.push(c)
  return out.sort((a, b) => distance(a, target) - distance(b, target) || a - b)
}

/**
 * Géométrie fractionnaire de même clé numérique que `g` dans l'ancien `geomKey` (4 × (min·128 + max) + 2·ligne + diag) :
 * PO fractionnaire d'un clone 'average' (ex. +0,25 PO en espérance).
 */
function collider(g: CastGeom): CastGeom {
  const k = (g.line ? 2 : 0) + (g.diag ? 1 : 0)
  if (k === 0) return { min: g.min, max: g.max - 0.25, line: false, diag: true }
  return { min: g.min, max: g.max + k / 4, line: false, diag: false }
}

describe('inverseRange : clé de cache exacte', () => {
  it('une géométrie fractionnaire ne partage pas l’anneau d’une géométrie entière (dans les deux ordres)', () => {
    const geoms: CastGeom[] = []
    for (const line of [false, true]) for (const diag of [false, true]) for (const max of [1, 3, 6]) geoms.push({ min: 1, max, line, diag })
    let target = 3
    for (const g of geoms) {
      const f = collider(g)
      // Fractionnaire d'abord, puis entière (cible neuve à chaque fois : cache vierge pour ce couple).
      target = (target + 37) % CELL_COUNT
      expect(Array.from(inverseRange(f, target)), `${JSON.stringify(f)} → ${target}`).toEqual(refRing(f, target))
      expect(Array.from(inverseRange(g, target)), `${JSON.stringify(g)} après ${JSON.stringify(f)}`).toEqual(refRing(g, target))
      // Entière d'abord, puis fractionnaire.
      target = (target + 37) % CELL_COUNT
      expect(Array.from(inverseRange(g, target))).toEqual(refRing(g, target))
      expect(Array.from(inverseRange(f, target)), `${JSON.stringify(f)} après ${JSON.stringify(g)}`).toEqual(refRing(f, target))
    }
  })
})

// ───────────────────────────── castCellsFor ≡ ancienne version ─────────────────────────────

/** Ancienne `castCellsFor` (avant optimisation) : `castGeometryOk` sur chaque case, anneau exhaustif (sans cache). */
function refCastCellsFor(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, target: number,
                         reach: ReachInfo, los: LosOracle, limit = CELL_COUNT, nextTurn = false): number[] {
  const out: number[] = []
  const g = castGeom(caster, lvl)
  const cost = lvl.apCost
  const start = reach.count > 0 ? reach.cells[0] : caster.cell
  if (start >= 0 && reach.count > 0 && distance(start, target) > reach.mpLeft[start] + g.max) return out
  let perTarget = false
  const occT = target >= 0 && target < CELL_COUNT ? los.occ[target] : -1
  if (!nextTurn && lvl.maxCastPerTarget > 0 && occT >= 0 && occT !== caster.id) {
    if ((caster.castsThisTurn[spell.spellId] ?? 0) > 0 && (caster.castsOnTarget[`${spell.spellId}:${occT}`] ?? 0) >= lvl.maxCastPerTarget) return out
    perTarget = true
  }
  if (start >= 0 && reach.apLeft[start] >= cost && castGeometryOk(s, caster, spell, lvl, g, start, target, los, nextTurn, perTarget)) {
    out.push(start)
    if (out.length >= limit) return out
  }
  const ring = refRing(g, target)
  if (ring.length <= reach.count * 2) {
    for (const c of ring) {
      if (c === start || reach.mpLeft[c] < 0 || reach.apLeft[c] < cost) continue
      if (!castGeometryOk(s, caster, spell, lvl, g, c, target, los, nextTurn, perTarget)) continue
      out.push(c)
      if (out.length >= limit) break
    }
  } else {
    for (let i = 0; i < reach.count; i++) {
      const c = reach.cells[i]
      if (c === start || reach.apLeft[c] < cost) continue
      if (!castGeometryOk(s, caster, spell, lvl, g, c, target, los, nextTurn, perTarget)) continue
      out.push(c)
      if (out.length >= limit) break
    }
  }
  return out
}

describe('castCellsFor ≡ ancienne version (castGeometryOk case par case)', () => {
  it('scènes aléatoires, compteurs par cible, prochain tour, PO fractionnaires et cache d’anneaux empoisonné', () => {
    let checked = 0
    let nonEmpty = 0
    for (let seed = 1; seed <= 8; seed++) {
      const { engine, fight, me } = randomScene(seed, { nPlayers: 3, nMonsters: 4 })
      // Quelques lancers réels : compteurs du tour et par cible non vides (maxCastPerTarget).
      for (const sp of me.spells) {
        for (const e of fight.fighters) {
          if (e.alive && e.team !== me.team && canCast(engine, fight, me, sp, e.cell) === null) castSpell(engine, fight, me, sp.spellId, e.cell)
        }
      }
      if (!me.alive || fight.ended) continue
      for (const frac of [0, 0.25, 0.5, 0.75]) {
        const range0 = me.stats.range
        me.stats.range = range0 + frac
        const reach = computeReachFor(engine, fight, me, me.team, { mp: 3 })
        const los = new LosOracle(fight, me.team, me.id)
        const targets = fight.fighters.filter(f => f.alive && f.cell >= 0).map(f => f.cell)
        for (let k = 0; k < 6; k++) targets.push((seed * 97 + k * 61 + frac * 400) % CELL_COUNT)
        for (const sp of me.spells) {
          const lvl = levelFor(me, sp)
          const g = castGeom(me, lvl)
          for (const t of targets) {
            // Empoisonne le cache avec la géométrie fractionnaire de même (ancienne) clé, puis l'inverse.
            inverseRange(collider({ min: g.min, max: Math.round(g.max), line: g.line, diag: g.diag }), t)
            for (const nextTurn of [false, true]) {
              const ref = refCastCellsFor(fight, me, sp, lvl, t, reach, los, CELL_COUNT, nextTurn)
              const got = castCellsFor(fight, me, sp, lvl, t, reach, los, CELL_COUNT, [], nextTurn)
              expect(got, `graine ${seed} +${frac} PO, sort ${sp.spellId} → ${t}${nextTurn ? ' (tour suivant)' : ''}`).toEqual(ref)
              const lim = castCellsFor(fight, me, sp, lvl, t, reach, los, 2, [], nextTurn)
              expect(lim).toEqual(ref.slice(0, 2))
              checked++
              if (ref.length) nonEmpty++
            }
          }
        }
        me.stats.range = range0
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(nonEmpty).toBeGreaterThan(10)
  })
})

// ───────────────────────────── zones : cadres réutilisés ─────────────────────────────

describe('zones : cadres réutilisés (pile) — rappels réentrants et exceptions', () => {
  const CROSS = { shape: 'X', size: 3, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false }
  const CIRCLE = { shape: 'C', size: 4, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false }
  const LINE = { shape: 'L', size: 6, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: true }

  it('cellFilter / stopAtOccupied qui rappellent zoneCells et isCellInZone : même résultat que sans réentrance', () => {
    for (const center of [120, 255, 300, 401]) {
      const caster = center - 28 >= 0 ? center - 28 : center + 28
      // Prédicat précalculé (aucune réentrance) puis le même, calculé PENDANT le parcours (réentrant).
      const inner = new Set(zoneCells(CROSS, center + 1, center))
      const pre = (c: number): boolean => inner.has(c) || isCellInZone(CIRCLE, c, center, caster) === false
      const preSet = new Set<number>()
      for (let c = 0; c < CELL_COUNT; c++) if (pre(c)) preSet.add(c)
      const reentrant = (c: number): boolean => zoneCells(CROSS, center + 1, center).includes(c) || !isCellInZone(CIRCLE, c, center, caster)
      for (const z of [CIRCLE, CROSS, LINE]) {
        const ref = zoneCells(z, center, caster, { cellFilter: c => preSet.has(c) })
        expect(zoneCells(z, center, caster, { cellFilter: reentrant }), `${z.shape} ${center}`).toEqual(ref)
        const member = zoneMembership(z, center, caster, { cellFilter: c => preSet.has(c) })
        for (let c = 0; c < CELL_COUNT; c += 3) expect(isCellInZone(z, c, center, caster, { cellFilter: reentrant })).toBe(member(c))
      }
      // Ligne arrêtée sur la première case occupée, test d'occupation réentrant.
      const occupied = new Set(zoneCells(CIRCLE, center, center).filter((_, i) => i % 5 === 2))
      const refLine = zoneCells(LINE, center, caster, { stopAtOccupied: c => occupied.has(c) })
      let calls = 0
      const gotLine = zoneCells(LINE, center, caster, { stopAtOccupied: c => (calls++, zoneCells(CIRCLE, center, center).filter((_, i) => i % 5 === 2).includes(c)) })
      expect(gotLine).toEqual(refLine)
      expect(calls).toBeGreaterThan(0)
    }
  })

  it('une exception dans un rappel ne désynchronise pas la pile de cadres', () => {
    const ref = zoneCells(CIRCLE, 300, 272)
    const refIn = isCellInZone(CROSS, 301, 300, 272)
    for (let k = 0; k < 5; k++) {
      expect(() => zoneCells(CIRCLE, 300, 272, { cellFilter: () => { throw new Error('boom') } })).toThrow('boom')
      expect(() => isCellInZone(CIRCLE, 301, 300, 272, { cellFilter: () => { throw new Error('boom') } })).toThrow('boom')
      expect(() => zoneCells(LINE, 300, 272, { stopAtOccupied: () => { throw new Error('boom') } })).toThrow('boom')
    }
    expect(zoneCells(CIRCLE, 300, 272)).toEqual(ref)
    expect(isCellInZone(CROSS, 301, 300, 272)).toBe(refIn)
    // Un rappel qui retient un résultat imbriqué : le tableau rendu n'est pas recyclé.
    const kept: number[][] = []
    zoneCells(CIRCLE, 300, 272, { cellFilter: c => (kept.push(zoneCells(CROSS, c, 272)), true) })
    for (const a of kept) expect(a).toEqual(zoneCells(CROSS, a[0], 272))
  })
})

// ───────────────────────────── reach : tranches partagées ─────────────────────────────

describe('reach : ReachInfo et occupations dans des tranches partagées', () => {
  it('aucun recouvrement entre résultats (au-delà d’une tranche), cache = calcul neuf', () => {
    const { engine, fight } = randomScene(3, { nPlayers: 4, nMonsters: 5 })
    const live = fight.fighters.filter(f => f.alive && f.cell >= 0)
    const kept: { f: Fighter; mp: number; r: ReachInfo; copy: ReachInfo }[] = []
    const occs: { team: 0 | 1; occ: Int16Array; copy: Int16Array }[] = []
    for (let k = 0; k < 90; k++) {
      const f = live[k % live.length]
      const mp = 1 + (k % 6)
      const r = cachedReach(engine, fight, f, f.team, mp, f.ap)
      kept.push({ f, mp, r, copy: cloneReach(r) })
      const fresh = computeReachFor(engine, fight, f, f.team, { mp, ap: f.ap, out: createReachInfo() })
      expect(Array.from(r.cells.subarray(0, r.count))).toEqual(Array.from(fresh.cells.subarray(0, fresh.count)))
      const team = (k % 2) as 0 | 1
      const occ = buildOccupancy(fight, team)
      occs.push({ team, occ, copy: occ.slice() })
    }
    // Tous les résultats retenus sont intacts après les allocations suivantes (tranches de 32 / 64 blocs).
    for (const { r, copy } of kept) {
      expect(r.count).toBe(copy.count)
      for (let i = 0; i < r.count; i++) {
        const c = r.cells[i]
        expect(c).toBe(copy.cells[i])
        expect(r.mpLeft[c]).toBe(copy.mpLeft[c])
        expect(r.apLeft[c]).toBe(copy.apLeft[c])
        expect(r.prev[c]).toBe(copy.prev[c])
      }
    }
    for (const { occ, copy } of occs) expect(Array.from(occ)).toEqual(Array.from(copy))
  })
})

// ───────────────────────────── cloneFight COW ≡ copie profonde ─────────────────────────────

/** Empreinte complète de l'état mutable (buffs : tous les champs, objet d'effet par son id). */
function snap(fight: FightState): string {
  return JSON.stringify(
    {
      fighters: fight.fighters.map(f => ({
        ...f,
        // `rev` : estampille d'un compteur GLOBAL (src/engine/rev.ts) — dépend de l'ordre des opérations entre combats.
        rev: undefined,
        spells: f.spells.length,
        buffs: f.buffs.map(b => ({ ...b, effect: b.effect.effectId })),
      })),
      glyphs: fight.glyphs,
      traps: fight.traps,
      timeline: fight.timeline,
      deaths: fight.deaths,
      metrics: fight.metrics,
      round: fight.round,
      turnIndex: fight.turnIndex,
      rng: fight.rngState,
      uid: fight.nextUid,
      ended: fight.ended,
      winner: fight.winner,
      scenario: fight.scenarioState,
      events: fight.options.record ? fight.events.length : -1,
      lastEvents: fight.options.record ? fight.events.slice(-30) : null,
    },
    canonical,
  )
}

/** Remplaçant JSON canonique : clés triées (l'ordre d'insertion diffère entre un combattant créé et sa copie). */
function canonical(_k: string, v: unknown): unknown {
  if (v instanceof Map || v instanceof Set) return [...v]
  if (ArrayBuffer.isView(v)) return Array.from(v as Int16Array)
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(o).sort()) out[key] = o[key]
    return out
  }
  return v
}

/** Ancienne sémantique de `cloneFight` : combattants copiés en profondeur (buffs, relances, compteurs), métriques copiées. */
function deepCloneFight(engine: Engine, fight: FightState): FightState {
  const c = engine.cloneFight(fight, fight.options.record)
  c.fighters = c.fighters.map(cloneFighter)
  const m: Record<number, FighterMetrics> = {}
  for (const k in c.metrics) m[k] = { ...c.metrics[k] }
  c.metrics = m
  return c
}

/**
 * Tour « chaos » déterministe : approche de l'ennemi le plus proche, puis chaque sort tenté sur les ennemis, les alliés,
 * sa propre case et des cases proches (invocations, pièges, glyphes, portails, téléportations, portage…).
 */
function chaosTurn(engine: Engine, fight: FightState, me: Fighter): void {
  for (const act of chaosActions(engine, fight, me)) act(engine, fight)
}

/** Action d'un combattant désigné par id : rejouable à l'identique sur un clone. */
type Action = (engine: Engine, fs: FightState) => void

/**
 * Actions du tour « chaos » de `me`, décidées paresseusement sur l'état COURANT de `fight` (l'appelant applique chaque
 * action avant de demander la suivante) : approche, puis lancers.
 */
function* chaosActions(engine: Engine, fight: FightState, me: Fighter): Generator<Action> {
  const id = me.id
  const enemy = fight.fighters
    .filter(f => f.alive && f.team !== me.team && f.cell >= 0)
    .sort((a, b) => distance(me.cell, a.cell) - distance(me.cell, b.cell) || a.id - b.id)[0]
  if (enemy && me.mp >= 1 && me.cell >= 0) {
    const reach = reachableCells(fight, me, engine, Math.min(3, Math.floor(me.mp)))
    let best = me.cell
    for (const [c] of reach.cost) if (distance(c, enemy.cell) < distance(best, enemy.cell) || (distance(c, enemy.cell) === distance(best, enemy.cell) && c < best)) best = c
    const path = best === me.cell ? null : pathTo(reach, me.cell, best)
    if (path && path.length >= 2) yield (e, s) => void move(s, s.fighters[id], path, e)
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const sp of me.spells) {
      if (!me.alive || fight.ended || me.cell < 0) return
      const cells: number[] = []
      for (const f of fight.fighters) if (f.alive && f.cell >= 0) cells.push(f.cell)
      for (let d = 1; d <= 2; d++) for (const c of [me.cell + d, me.cell - d, me.cell + 14 * d, me.cell - 14 * d, me.cell + 28, me.cell - 28]) if (c >= 0 && c < CELL_COUNT) cells.push(c)
      for (const c of cells) {
        if (!me.alive || fight.ended || me.cell < 0) return
        if (canCast(engine, fight, me, sp, c) === null) yield (e, s) => void castSpell(e, s, s.fighters[id], sp.spellId, c)
      }
    }
  }
}

/** Un tour de combattant (même boucle que `runFight`). */
function playOne(engine: Engine, fight: FightState): void {
  const f = engine.nextTurn(fight)
  if (!f) return
  const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
  if (canPlay && f.ai !== 'pass') chaosTurn(engine, fight, f)
  if (!fight.ended && f.alive) engine.endTurn(fight, f)
  else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
}

function realFight(scenarioId: string, team: string, seed: number, rollMode: 'random' | 'average', record: boolean): { engine: Engine; fight: FightState } {
  const spec: FightSpec = { scenarioId, team: parseTeam(team, data), mode: 'fast', theta: {}, variantPolicy: 'default', monsterNoise: 0 } as FightSpec
  const scenario = resolveScenario(scenarioId)
  const engine = createEngine(data, scenario.hooks)
  const { params } = fightParams(scenario, spec, seed)
  const fight = scenario.createFight(engine, buildTeam(data, spec.team), { params, seed, placement: undefined, rollMode, record, rngRekey: 'perTurn' })
  return { engine, fight }
}

const CASES: { scenario: string; team: string; seed: number; rollMode: 'random' | 'average'; record: boolean; turns: number }[] = [
  { scenario: 'vortex', team: 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu', seed: 11, rollMode: 'random', record: true, turns: 70 },
  { scenario: 'vortex', team: 'pandawa_placement,osamodas_invocations,eliotrope_passeur,xelor_soutien_placement', seed: 12, rollMode: 'random', record: false, turns: 60 },
  { scenario: 'vortex', team: 'steamer_artillerie,sram_terre_pieges,roublard_artificier,feca_glyphes', seed: 13, rollMode: 'average', record: false, turns: 60 },
  { scenario: 'skirmish', team: 'sadida_infection,sacrieur_renvoi,zobal_rempart,huppermage_quadra', seed: 14, rollMode: 'random', record: true, turns: 50 },
  { scenario: 'skirmish', team: 'ecaflip_feu_hybride,ouginak_terre_feu,sram_utilitaire,steamer_soutien', seed: 15, rollMode: 'average', record: false, turns: 50 },
]

describe('cloneFight (copie-sur-écriture) ≡ copie profonde, sur de vrais combats', () => {
  for (const k of CASES) {
    it(`${k.scenario} ${k.team} (${k.rollMode}${k.record ? ', enregistré' : ''})`, async () => {
      const { engine, fight } = realFight(k.scenario, k.team, k.seed, k.rollMode, k.record)
      let played = 0
      for (let i = 0; i < k.turns && !fight.ended; i++) {
        const s0 = snap(fight)
        const c = engine.cloneFight(fight, k.record)
        const d = deepCloneFight(engine, fight)
        expect(snap(c)).toBe(s0)
        playOne(engine, c)
        const sc = snap(c)
        expect(snap(fight), `tour ${i} : le clone a modifié son parent`).toBe(s0)
        playOne(engine, d)
        expect(snap(d), `tour ${i} : clone COW ≠ copie profonde`).toBe(sc)
        if (!c.ended) {
          // Petit-clone joué deux tours : le clone intermédiaire ne bouge pas.
          const g = engine.cloneFight(c, false)
          playOne(engine, g)
          playOne(engine, g)
          expect(snap(c), `tour ${i} : le petit-clone a modifié le clone`).toBe(sc)
        }
        playOne(engine, fight)
        expect(snap(fight), `tour ${i} : parent ≠ clone après le même tour`).toBe(sc)
        expect(snap(c), `tour ${i} : le parent a modifié le clone`).toBe(sc)
        played++
        if (i % 10 === 9) await yieldToEventLoop()
      }
      expect(played).toBeGreaterThan(10)
    })
  }
})

describe('cloneFight COW : clones pris EN COURS de tour (comme la recherche de l’IA), action par action', () => {
  for (const k of CASES) {
    it(`${k.scenario} ${k.team} (${k.rollMode}${k.record ? ', enregistré' : ''})`, async () => {
      const { engine, fight } = realFight(k.scenario, k.team, k.seed + 100, k.rollMode, k.record)
      let actions = 0
      for (let i = 0; i < Math.min(k.turns, 35) && !fight.ended; i++) {
        cowCheck(engine, fight, s => void engine.nextTurn(s), `tour ${i} : début`, false)
        const f = engine.current(fight)
        if (!f) break
        const id = f.id
        const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
        if (canPlay && f.ai !== 'pass') {
          for (const act of chaosActions(engine, fight, f)) {
            // Relances, lancers du tour et par cible, buffs, PV… modifiés par un clone pris APRÈS d'autres actions du tour.
            cowCheck(engine, fight, s => act(engine, s), `tour ${i} : action ${actions}`, false)
            actions++
          }
        }
        cowCheck(engine, fight, s => {
          const g = s.fighters[id]
          if (!s.ended && g.alive) engine.endTurn(s, g)
          else if (!s.ended) engine.emit(s, { t: 'turnEnd', fighter: id })
        }, `tour ${i} : fin`, false)
        if (i % 5 === 4) await yieldToEventLoop()
      }
      expect(actions).toBeGreaterThan(20)
    })
  }
})

describe('cloneFight : une même opération sur deux clones frères', () => {
  it('chaque frère a ses propres buffs, relances, compteurs et métriques', () => {
    const { engine, fight } = realFight('vortex', 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu', 21, 'random', false)
    for (let i = 0; i < 12 && !fight.ended; i++) playOne(engine, fight)
    const a = engine.cloneFight(fight, false)
    const b = engine.cloneFight(fight, false)
    const s0 = snap(fight)
    const rng = new Rng(5)
    for (let k = 0; k < 15 && !a.ended && !b.ended; k++) {
      // Ordre différent des opérations : a joue, puis b, puis a deux fois.
      playOne(engine, a)
      if (rng.next() < 0.5) playOne(engine, b)
      playOne(engine, a)
    }
    expect(snap(fight)).toBe(s0)
    const sa = snap(a)
    const b2 = deepCloneFight(engine, fight)
    const rng2 = new Rng(5)
    const a2 = deepCloneFight(engine, fight)
    for (let k = 0; k < 15 && !a2.ended && !b2.ended; k++) {
      playOne(engine, a2)
      if (rng2.next() < 0.5) playOne(engine, b2)
      playOne(engine, a2)
    }
    expect(snap(a2)).toBe(sa)
    expect(snap(b2)).toBe(snap(b))
  })
})

// ───────────────────────────── COW : chaque écriture en place du moteur, isolément ─────────────────────────────

/**
 * Opération `op` (désignant les combattants par id) jouée sur un clone COW, sur une copie profonde et sur le parent :
 * le parent est intact après le clone, le clone COW ≡ la copie profonde, et le clone est intact après le parent.
 */
function cowCheck(engine: Engine, P: FightState, op: (fs: FightState) => void, label: string, mustChange = true): void {
  const s0 = snap(P)
  const c = engine.cloneFight(P, P.options.record)
  const d = deepCloneFight(engine, P)
  op(c)
  expect(snap(P), `${label} : parent modifié par le clone`).toBe(s0)
  op(d)
  const sc = snap(c)
  expect(sc, `${label} : clone COW ≠ copie profonde`).toBe(snap(d))
  if (mustChange) expect(sc, `${label} : l'opération n'a rien changé (test sans objet)`).not.toBe(s0)
  const c2 = engine.cloneFight(P, P.options.record)
  op(P)
  expect(snap(c2), `${label} : clone modifié par le parent`).toBe(s0)
  expect(snap(P), `${label} : parent ≠ clone après la même opération`).toBe(sc)
}

describe('cloneFight COW : écritures en place du moteur (une par une)', () => {
  const FECA = 1
  const SRAM = 4
  const SPELL = 999001
  /** Moteur du test en cours (les opérations reçoivent seulement le combat). */
  let current: Engine | undefined
  const eff = (fs: FightState, caster: number, target: number, effects: EffectData[], spellId = SPELL): void =>
    applyEffects(current!, fs, fs.fighters[caster], null, spellId, effects, fs.fighters[target].cell, fs.fighters[caster].cell, false, false, 0)

  function duel(): { engine: Engine; fs: FightState; a: Fighter; b: Fighter } {
    const engine = newEngine()
    current = engine
    const a = player({ name: 'A', breedId: SRAM, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 9000 } })
    const b = player({ name: 'B', breedId: FECA, spellIds: [], team: 1, cell: cellAt(12, 0), stats: { initiative: 10 } })
    const fs = fight(engine, [a, b], { rollMode: 'random' })
    turnOf(engine, fs, a)
    // Buffs de départ de b (lanceur a) : PM, état Enraciné, bouclier, déclencheur DIS (compteur de déclenchements).
    eff(fs, a.id, b.id, [
      effect(128, { diceNum: 2, duration: 3, dispellable: 1 }),
      effect(950, { value: 6, duration: 1, dispellable: 1 }),
      effect(1040, { diceNum: 300, duration: 2, dispellable: 1 }),
    ])
    eff(fs, b.id, b.id, [effect(950, { triggers: 'DIS', value: 74, duration: 1, triggerDuration: 3, targetMask: 'a', dispellable: 4 })])
    return { engine, fs, a, b }
  }

  it('1075 : durées raccourcies en place (shortenBuffs)', () => {
    const { engine, fs, a, b } = duel()
    cowCheck(engine, fs, s => eff(s, a.id, b.id, [effect(1075, { diceNum: 1 })]), '1075')
  })

  it('950 : état déjà posé par le même sort, durée rafraîchie en place (addState)', () => {
    const { engine, fs, a, b } = duel()
    cowCheck(engine, fs, s => eff(s, a.id, b.id, [effect(950, { value: 6, duration: 3, dispellable: 1 })]), '950 rafraîchi')
  })

  it('132 : désenvoûtement (retraits + déclencheur DIS, compteur de déclenchements)', () => {
    const { engine, fs, a, b } = duel()
    cowCheck(engine, fs, s => eff(s, a.id, b.id, [effect(132)]), '132')
  })

  it('bouclier entamé en place par des dommages', () => {
    const { engine, fs, a, b } = duel()
    cowCheck(engine, fs, s => engine.applyDamage(s, s.fighters[a.id], s.fighters[b.id], 120, 2, 'direct', {}), 'bouclier')
  })

  it('début de tour : buffs du lanceur décomptés en place, relances décrémentées, métriques', () => {
    const { engine, fs, a } = duel()
    fs.fighters[a.id].cooldowns = { 12345: 2 }
    cowCheck(engine, fs, s => {
      const cur = engine.current(s)
      if (cur) engine.endTurn(s, cur)
      engine.nextTurn(s)
      const cur2 = engine.current(s)
      if (cur2) engine.endTurn(s, cur2)
      engine.nextTurn(s)
    }, 'début de tour')
  })

  it('mort (buffs filtrés, propriété conservée) puis nouvelle modification', () => {
    const { engine, fs, a, b } = duel()
    cowCheck(engine, fs, s => {
      engine.kill(s, s.fighters[b.id], s.fighters[a.id])
      eff(s, a.id, a.id, [effect(128, { diceNum: 1, duration: 2, dispellable: 1 })])
    }, 'mort')
  })

  it('glyphe-aura du Féca : markUid posé en place, buffs d’aura retirés à la sortie (sweep)', () => {
    if (!has(950)) return
    const engine = newEngine()
    current = engine
    const feca = player({ name: 'Féca', breedId: FECA, spellIds: [12985], cell: cellAt(10, 0), stats: { intelligence: 800, initiative: 9000, summons: 1 } })
    const ally = player({ name: 'Allié', breedId: SRAM, spellIds: [], cell: cellAt(13, 0), stats: { initiative: 10 } })
    const enemy = monster(3834, cellAt(15, 0), { grade: 1, initiative: 5000 })
    const fs = fight(engine, [feca, ally, enemy])
    turnOf(engine, fs, feca)
    // Pose de l'aura sur un clone : markUid posé sur les buffs de l'allié.
    cowCheck(engine, fs, s => castSpell(engine, s, s.fighters[feca.id], 12985, cellAt(14, 0)), 'pose de l’aura')
    expect(fs.fighters[ally.id].buffs.some(x => x.markUid !== undefined)).toBe(true)
    // Sortie de l'aura sur un clone : buffs marqués retirés.
    cowCheck(engine, fs, s => {
      move(s, s.fighters[ally.id], [cellAt(13, 0), cellAt(12, 0), cellAt(11, 0)], engine)
      engine.hooks.onTurnEnd?.(s, s.fighters[feca.id])
    }, 'sortie de l’aura')
    // Disparition de l'aura (fin de durée) : balayage des buffs orphelins.
    cowCheck(engine, fs, s => {
      for (let k = 0; k < 6 && !s.ended; k++) {
        const cur = engine.current(s)
        if (cur && cur.alive) engine.endTurn(s, cur)
        engine.nextTurn(s)
      }
    }, 'fin de l’aura')
  })
})

// ───────────────────────────── COW : invocations, résurrections, vagues (vérification adverse, tour 2) ─────────────

/**
 * Chemins du moteur ajoutés ou touchés APRÈS le premier tour d'optimisation, ou peu couverts par les combats « chaos » :
 * effets portés par l'invocation (`aliveSourceId` posé en place sur les buffs créés, décompte sur les tours de
 * l'invocateur, effet différé exécuté par l'invocation), résurrections 780 / 1034 (buffs conservés par le mort puis
 * Zombi), vague du Vortex apparue dans un clone (fabrique, invulnérabilité d'arrivée, sorts de départ, relances
 * initiales posées en place sur les arrivants). Chaque opération : parent intact, clone COW ≡ copie profonde, clone
 * intact après le parent (`cowCheck`).
 */
describe('cloneFight COW : invocations, résurrections et vagues', () => {
  const ENUTROF = 3
  /** [sort, id, tours de vie, effets portés par l'invocation (sinon : cibles recalculées après l'invocation)]. */
  const SUMMON_OWNED: [string, number, number, boolean][] = [
    ['Sac Animé', 13328, 3, true],
    ['Musette Animée', 13354, 2, false],
    ['Pelle de Fortune', 29755, 2, true],
  ]

  for (const [name, spellId, life, owned] of SUMMON_OWNED) {
    it(`${name} : invocation et effets portés par l’invocation dans un clone, puis ses ${life} tours de vie`, () => {
      const engine = newEngine()
      const enu = player({ name: 'Enu', breedId: ENUTROF, spellIds: [spellId], cell: cellAt(10, 0), hp: 4000, stats: { summons: 3, initiative: 5000 } })
      const enemy = monster(3834, cellAt(20, 0), { grade: 1 })
      const fs = fight(engine, [enu, enemy])
      turnOf(engine, fs, enu)
      // Buffs déjà portés (tableaux partagés par le clone) : la pose des buffs de l'invocation les copie.
      applyEffects(engine, fs, enu, null, 999002, [effect(128, { diceNum: 1, duration: 4, dispellable: 1 })], enu.cell, enu.cell, false, false, 0)
      applyEffects(engine, fs, enu, null, 999003, [effect(128, { diceNum: 1, duration: 4, dispellable: 1 })], enemy.cell, enu.cell, false, false, 0)
      cowCheck(engine, fs, s => {
        expect(castSpell(engine, s, s.fighters[enu.id], spellId, cellAt(11, 0)).ok).toBe(true)
      }, `${name} : invocation`)
      const summon = fs.fighters.find(f => f.kind === 'summon' && f.summonerId === enu.id)!
      expect(summon.alive).toBe(true)
      // Buffs « portés par l'invocation » : source = l'invocation, décompte sur les tours de l'Enutrof.
      expect(fs.fighters.some(f => f.buffs.some(b => b.sourceId === summon.id && b.aliveSourceId === enu.id))).toBe(owned)
      for (let k = 1; k <= life; k++) cowCheck(engine, fs, s => turnOf(engine, s, s.fighters[enu.id]), `${name} : tour ${k} de l’Enutrof`)
      expect(summon.alive).toBe(false)
      expect(enu.alive).toBe(true)
    })
  }

  it('780 / 1034 : résurrections dans un clone (buffs conservés par le mort, état Zombi, timeline)', () => {
    const engine = newEngine()
    const healer = monster(3836, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const ally = monster(3834, cellAt(12, 0), { grade: 1 })
    const ally2 = monster(3834, cellAt(12, 2), { grade: 1 })
    const enemy = player({ name: 'P', breedId: 8, spellIds: [], cell: cellAt(16, 0) })
    const fs = fight(engine, [healer, ally, ally2, enemy], { rollMode: 'average' })
    turnOf(engine, fs, healer)
    // Buff indésenvoûtable (conservé à la mort) + buff ordinaire (retiré à la mort).
    applyEffects(engine, fs, enemy, null, 999004, [effect(128, { diceNum: 1, duration: 5, dispellable: 4 })], ally.cell, enemy.cell, false, false, 0)
    applyEffects(engine, fs, enemy, null, 999005, [effect(128, { diceNum: 1, duration: 5, dispellable: 1 })], ally2.cell, enemy.cell, false, false, 0)
    cowCheck(engine, fs, s => engine.kill(s, s.fighters[ally.id], s.fighters[enemy.id]), 'mort (buffs conservés)')
    cowCheck(engine, fs, s => applyEffects(engine, s, s.fighters[healer.id], null, 0, [effect(780, { diceNum: 50 })], cellAt(11, 3), s.fighters[healer.id].cell, false, false, 0), '780')
    expect(fs.fighters[ally.id].alive).toBe(true)
    cowCheck(engine, fs, s => engine.kill(s, s.fighters[ally2.id], s.fighters[enemy.id]), 'mort (buffs retirés)')
    cowCheck(engine, fs, s => applyEffects(engine, s, s.fighters[healer.id], null, 0, [effect(1034, { diceNum: 25 })], cellAt(11, 3), s.fighters[healer.id].cell, false, false, 0), '1034')
    expect(fs.fighters.some(f => f.alive && f.summonerId === healer.id && f.monsterId === 3834)).toBe(true)
    cowCheck(engine, fs, s => {
      for (let k = 0; k < 4 && !s.ended; k++) {
        const cur = engine.current(s)
        if (cur && cur.alive) engine.endTurn(s, cur)
        engine.nextTurn(s)
      }
    }, 'tours suivants')
  })

  it('vague du Vortex apparue dans un clone, puis les tours suivants', () => {
    const engine = createEngine(data, vortexHooks)
    const players = createSmokeTeam(data, undefined, { initiative: 4000, hp: 1_000_000 })
    const fs = createVortexFight(engine, players, { params: VORTEX_DEFAULT_PARAMS, seed: 3, rollMode: 'random', record: true, rngRekey: 'perTurn' })
    engine.nextTurn(fs)
    const before = fs.fighters.length
    cowCheck(engine, fs, s => void spawnVortexWave(engine, s, 2), 'vague 2')
    const arrived = fs.fighters.slice(before)
    expect(arrived.length).toBeGreaterThan(0)
    // Arrivants : invulnérabilité d'arrivée (buff) et relances initiales (relances posées en place à l'arrivée).
    expect(arrived.every(f => f.buffs.length > 0)).toBe(true)
    cowCheck(engine, fs, s => {
      for (let k = 0; k < 12 && !s.ended; k++) {
        const cur = engine.current(s)
        if (cur && cur.alive) engine.endTurn(s, cur)
        engine.nextTurn(s)
      }
    }, 'tours après la vague')
  })
})
