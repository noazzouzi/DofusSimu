/**
 * Revue adverse du lot WP3b (planificateur d'heures, pricers, modèle du Vortex) : tests de non-régression des défauts
 * corrigés, sur données, carte et sorts RÉELS quand le modèle complet est en jeu (docs/design/ai.md §12, §16.3).
 *
 *  - la racine d'un plan publié n'est jamais une action hypothétique (glyphe hors d'atteinte, mort improbable) ;
 *  - une racine imposée hypothétique est chiffrée avec le même effort qu'une racine réelle (SearchPricer) ;
 *  - un monstre mort à la racine garde une menace (sinon sa vie de zombie ne coûte rien au planificateur) ;
 *  - `reKillMask` ≡ `reKillWindow` heure par heure ; budget du SearchPricer : l'horloge est chiffrée avant les morts
 *    improbables ;
 *  - instantané / reprise : coûts d'heures mesurés conservés (prix identiques après la mort d'un allié) ;
 *  - `revivedValue` : la corruption (ou le marquage) d'un monstre tué puis ressuscité dans un rollout garde son prix ;
 *  - Heuristique (phase 2) : `extraIncoming` identique dans l'état réel et dans un clone, nul pour un allié qui rejoue
 *    avant le Vortex ;
 *  - combat réel : à chaque tour de joueur, le premier pas du plan est faisable.
 */
import { describe, expect, it } from 'vitest'
import { createPerception } from '../src/ai/core/perception'
import { playGreedyTurn } from '../src/ai/fallback'
import { createControllers, defaultAIConfig } from '../src/ai/index'
import { createView } from '../src/ai/core/view'
import { emptyBlackboard } from '../src/ai/team/controller'
import { loadTheta } from '../src/ai/theta'
import type { AIMode, Blackboard } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import type { AbsAction, ClockSlot } from '../src/dungeons/types'
import type { AbsMonster, AbsState } from '../src/dungeons/vortex/abstract'
import { currentHour, deathHours, hasStar, isCorrupted, isWaveMonster, nextVortexSlot } from '../src/dungeons/vortex/clock'
import { HARPILLE, HOUR_CELL, IKARGN, MEJAIRE, nextHour, SPELL, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { fallbackHourCosts } from '../src/dungeons/vortex/hourCost'
import { createPhase2Fight } from '../src/dungeons/vortex/micro'
import { createVortexAIModel, vortexPlanOf, type VortexAIModel } from '../src/dungeons/vortex/model'
import { vortexState } from '../src/dungeons/vortex/params'
import { actionKey, followUpRoundsFor, planHours, plannerConfig, slotsWithoutPlayer, type PlannerContext, type PlannerStep } from '../src/dungeons/vortex/planner'
import { heuristicPrices, reKillMask, reKillWindow, searchPrices } from '../src/dungeons/vortex/pricer'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { CELL_X, CELL_Y, distance } from '../src/map/geometry'
import { buildTeam } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'

const data = loadDataStore('data')
const theta = loadTheta()
const META = 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu'

// ───────────────────────────── outils (puzzles abstraits) ─────────────────────────────

const P1 = 0
const P2 = 1
const P3 = 2
const P4 = 3
const V = 4

function cycleSlots(fromRound: number, rounds: number, hourBefore: number): ClockSlot[] {
  const out: ClockSlot[] = []
  let h = hourBefore
  for (let r = fromRound; r < fromRound + rounds; r++) {
    const tl: [number, boolean][] = [[P1, true], [10, false], [P2, true], [11, false], [P3, true], [12, false], [P4, true], [V, false]]
    tl.forEach(([id, pl], index) => {
      if (pl) h = nextHour(h, 1)
      out.push({ round: r, index, fighterId: id, isPlayer: pl, isVortex: id === V, hour: h })
    })
  }
  return out
}

const mon = (id: number, monsterId: number, o: Partial<AbsMonster> = {}): AbsMonster =>
  ({ id, monsterId, wave: 1, status: 'alive', hp: 6600, maxHp: 6600, hours: 0, star: false, corruptOnWake: false, threat: 900, baseMaxHp: 6600, ...o })

function rootOf(slots: ClockSlot[], monsters: AbsMonster[]): AbsState {
  let used = 0
  for (const m of monsters) used |= m.hours
  return { slotIdx: 0, hour: slots[0].hour, glyphShift: 0, round: slots[0].round, vortexTurns: 0, monsters, hoursUsed: used, score: 0, trace: null }
}

/** Créneau courant : P2 (soigneur), hors de portée de tous les monstres maintenant, aucune glyphe atteignable. */
function healerNow(): { root: AbsState; ctx: PlannerContext } {
  const slots = cycleSlots(1, 9, 12).slice(2)
  const root = rootOf(slots, [mon(10, IKARGN), mon(11, MEJAIRE), mon(12, HARPILLE)])
  const E: Record<number, number> = { [P1]: 9000, [P2]: 1500, [P3]: 3000, [P4]: 9000 }
  const ctx: PlannerContext = {
    slots, costs: fallbackHourCosts(), players: 4, glyphsNow: 0, glyphBonusNow: 0,
    expected: (i, p, m) => (i === 0 ? 0 : E[p] * (m.hours & 16 ? 0.7 : 1) * 0.85),
    canContract: p => p !== P3,
  }
  return { root, ctx }
}

describe('planificateur : racine hypothétique', () => {
  it('le premier pas publié est toujours réalisable (fast, standard, deep)', () => {
    const { root, ctx } = healerNow()
    for (const mode of ['fast', 'standard', 'deep'] as AIMode[]) {
      const cfg = plannerConfig(mode, theta)
      const r = planHours(root, ctx, cfg)
      const first = r.plan.steps[0] as PlannerStep
      expect(first, mode).toMatchObject({ round: root.round, fighterId: P2 })
      expect(r.hypothetical.has(actionKey(first.action)), `${mode} : ${actionKey(first.action)}`).toBe(false)
      // P2 ne peut rien tuer ni déclencher de glyphe maintenant.
      expect(first.action.t === 'kill' || first.action.t === 'glyph', mode).toBe(false)
      expect(r.plan.contracts.every(c => !(c.round === root.round && c.index === first.index)), mode).toBe(true)
    }
  })

  it('une racine imposée hypothétique est chiffrée comme si elle était réelle (même faisceau, même score de prix)', () => {
    const { root, ctx } = healerNow()
    const cfg = plannerConfig('standard', theta)
    const force: AbsAction = { t: 'kill', m: [11], glyph: 'none' }
    const key = actionKey(force)
    const hypo = planHours(root, ctx, cfg, { forceRoot: force, beamWidth: 4, horizonPlayerSlots: 8 })
    const real = planHours(root, { ...ctx, pKillNow: () => 0.95 }, cfg, { forceRoot: force, beamWidth: 4, horizonPlayerSlots: 8 })
    expect(hypo.hypothetical.has(key)).toBe(false)
    expect(hypo.plan.steps[0].action).toEqual(force)
    expect(hypo.priceScores.get(key)).toBeDefined()
    expect(hypo.priceScores.get(key)).toBeCloseTo(real.priceScores.get(key)!, 6)
  })

  it('3 joueurs vivants (un mort) : la fenêtre de re-kill couvre un cycle d’horloge (12/N tours) — VII reste payante', () => {
    // Tour 2 : P1 V, P2 VI, P4 VII (P3 mort, règle par défaut) ; à 3 joueurs chacun revoit son heure 4 tours plus tard.
    const slots = slotsWithoutPlayer(cycleSlots(2, 8, 4), P3, false)
    const root = rootOf(slots, [mon(10, IKARGN), mon(11, MEJAIRE), mon(12, HARPILLE)])
    const ctx: PlannerContext = {
      slots, costs: fallbackHourCosts(), players: 3, glyphsNow: 0, glyphBonusNow: 0,
      expected: (i, p, m) => 9000 * (m.hours & 16 ? 0.7 : 1) * (i === 0 ? 1 : 0.85), canContract: () => true,
    }
    const cfg = plannerConfig('standard', theta)
    expect(followUpRoundsFor(cfg, 4)).toBe(3)
    expect(followUpRoundsFor(cfg, 3)).toBe(4)
    for (const h of [7, 10, 2]) expect(reKillWindow(ctx, cfg, root.monsters[0], 1 << (h - 1)), `heure ${h}`).toBe(true)
    const r = planHours(root, ctx, cfg)
    const prices = heuristicPrices({ result: r, root, ctx, cfg, theta, me: P1 })
    expect(prices.kill.get(10)![7]).toBeGreaterThan(0)
    expect(prices.kill.get(10)![5]).toBeLessThan(0)
    // Le plan marque encore aux heures bon marché puis corrompt.
    expect(r.plan.contracts.some(c => c.kind === 'corrupt')).toBe(true)
  })

  it('reKillMask = reKillWindow heure par heure ; SearchPricer : la glyphe est chiffrée avant les morts improbables', () => {
    const slots = cycleSlots(1, 9, 12)
    const ms = [mon(10, IKARGN), mon(11, MEJAIRE), mon(12, HARPILLE), mon(13, IKARGN, { hp: 9000 }), mon(14, MEJAIRE, { hp: 9000 }),
      mon(15, HARPILLE, { hp: 9000 }), mon(16, IKARGN, { hp: 9000 }), mon(17, MEJAIRE, { hp: 9000 })]
    const root = rootOf(slots, ms)
    const E: Record<number, number> = { [P1]: 2000, [P2]: 4000, [P3]: 9000, [P4]: 3000 }
    const ctx: PlannerContext = {
      slots, costs: fallbackHourCosts(), players: 4, glyphsNow: 1, glyphBonusNow: 0,
      expected: (i, p, m) => E[p] * (m.hours & 16 ? 0.7 : 1) * (i === 0 ? 1 : 0.85),
      canContract: p => p !== P1,
    }
    const cfg = plannerConfig('standard', theta)
    for (const m of ms) {
      const mask = reKillMask(ctx, cfg, m)
      for (let h = 1; h <= 12; h++) expect(((mask >> (h - 1)) & 1) === 1, `${m.id} ${h}`).toBe(reKillWindow(ctx, cfg, m, 1 << (h - 1)))
    }
    // 8 monstres à portée de P1 (2 000/tour, P(kill) ≈ 0) et une glyphe atteignable : budget 8 relances.
    const forced: string[] = []
    const replan = (a: AbsAction) => {
      forced.push(actionKey(a))
      return planHours(root, ctx, cfg, { forceRoot: a, beamWidth: 4, horizonPlayerSlots: 8 })
    }
    const prices = searchPrices({ result: planHours(root, ctx, cfg), root, ctx, cfg, theta, me: P1, replan, maxReplans: 8 })
    // Aucune mort plausible pour P1 (P(kill) ≈ 0) : la glyphe passe juste après « rien », avant les 8 morts improbables.
    expect(forced.slice(0, 2)).toEqual(['none', 'glyph+1'])
    expect(forced.filter(k => k.startsWith('kill:')).length).toBeGreaterThan(0)
    expect(forced.length).toBeLessThanOrEqual(8)
    expect(Number.isFinite(prices.clock[1])).toBe(true)
  })
})

// ───────────────────────────── modèle complet (vrai combat) ─────────────────────────────

interface Setup {
  engine: Engine
  fight: FightState
  players: Fighter[]
}

function setup(o: { seed?: number; meta?: boolean } = {}): Setup {
  const engine = createEngine(data, vortexHooks)
  const players = o.meta ? buildTeam(data, parseTeam(META, data)) : createSmokeTeam(data, undefined, { hp: 1_000_000 })
  if (o.meta) for (const p of players) p.hp = p.maxHp = p.baseMaxHp = 1_000_000
  const fight = createVortexFight(engine, players, { params: VORTEX_DEFAULT_PARAMS, seed: o.seed ?? 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  return { engine, fight, players }
}

function turnOf(s: Setup, f: Fighter, round = 0): void {
  for (let i = 0; i < 4000; i++) {
    const cur = s.engine.current(s.fight)
    if (cur && cur.id === f.id && s.fight.round >= round && s.fight.round > 0) return
    if (cur && s.fight.round > 0 && cur.alive) s.engine.endTurn(s.fight, cur)
    if (!s.engine.nextTurn(s.fight)) break
  }
  throw new Error('tour jamais atteint')
}

function update(model: VortexAIModel, s: Setup, mode: AIMode, bb: Blackboard = emptyBlackboard()): Blackboard {
  const me = s.engine.current(s.fight)!
  const view = createView(s.engine, s.fight, me, 7)
  model.update(view, bb, createPerception(view, { theta }, model, { bb }), mode)
  return bb
}

/** Termine le tour courant du clone puis avance jusqu'au DÉBUT du prochain tour du Vortex (résurrections faites). */
function throughVortexTurn(engine: Engine, leaf: FightState): void {
  const vortexId = vortexState(leaf)!.vortexId
  for (let i = 0; i < 64; i++) {
    const cur = engine.current(leaf)
    if (cur && cur.alive && !leaf.ended) engine.endTurn(leaf, cur)
    const next = engine.nextTurn(leaf)
    if (!next || next.id === vortexId) return
  }
}

describe('modèle complet : défauts corrigés (vrai combat)', () => {
  it('un monstre tué plus tôt dans le tour de jeu garde une menace (coût de sa vie de zombie)', () => {
    const s = setup({ seed: 3 })
    const [p1, p2] = s.players
    turnOf(s, p1, 2)
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, p2, 2)
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    update(model, s, 'fast')
    const abs = model.lastRoot!.monsters.find(m => m.id === ika.id)!
    expect(abs.status).toBe('dead')
    expect(abs.threat).toBeGreaterThan(0)
    // Même ordre de grandeur que la menace de référence d'un monstre de la même espèce encore à venir.
    const pending = model.lastRoot!.monsters.find(m => m.id < 0 && m.monsterId === IKARGN)
    if (pending) expect(abs.threat).toBe(pending.threat)
  })

  it('combat passif : à chaque tour de joueur, premier pas du plan faisable ; indices et décisions clés cohérents', () => {
    const s = setup({ seed: 4, meta: true })
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    const cfg = plannerConfig('fast', theta)
    let checked = 0
    let glyphHints = 0
    for (let i = 0; i < 300 && s.fight.round <= 8 && !s.fight.ended; i++) {
      const cur = s.engine.nextTurn(s.fight)
      if (!cur) break
      if (cur.kind === 'player') {
        const bb = update(model, s, 'fast')
        const view = createView(s.engine, s.fight, cur, 7)
        const hints = model.hints(view, cur, bb)
        const plan = vortexPlanOf(bb)
        const first = plan?.kind === 'hours' ? (plan.plan.steps[0] as PlannerStep | undefined) : undefined
        if (plan?.kind === 'hours' && first && first.round === s.fight.round && first.fighterId === cur.id) {
          checked++
          expect(model.lastPlan!.hypothetical.has(actionKey(first.action))).toBe(false)
          const nowContracts = plan.plan.contracts.filter(c => c.killer === cur.id && c.round === first.round && c.index === first.index)
          if (first.action.t === 'kill') {
            expect(first.pKill ?? 1).toBeGreaterThanOrEqual(cfg.minKillP)
            // Indice « kill » sur chaque cible du contrat courant, pondéré par son prix.
            for (const c of nowContracts) {
              const h = hints.find(x => x.kind === 'kill' && x.targetId === c.m)
              expect(h, `kill ${c.m}`).toBeDefined()
              expect(h!.weight).toBe(bb.prices.kill.get(c.m)![c.kind === 'corrupt' ? 0 : c.hour])
            }
          }
          // Corruption prévue maintenant ⇒ décision clé (sauf arrivée de vague / changement de phase, prioritaires).
          const reason = model.isKeyDecision(view, bb)
          if (nowContracts.some(c => c.kind === 'corrupt') && reason !== 'waveArrival' && reason !== 'phaseChange') expect(reason).toBe('corruptionKill')
        }
        // Indice « glyphe » ⇔ levier d'horloge rentable et glyphe atteignable.
        const g = hints.find(x => x.kind === 'glyph')
        if (g) {
          glyphHints++
          expect(bb.prices.clock[1]).toBeGreaterThan(theta.planner.glyphCost)
          expect(g.weight).toBe(bb.prices.clock[1])
          expect(g.cells!.length).toBeGreaterThan(0)
        }
      }
      if (cur.alive && !s.fight.ended) s.engine.endTurn(s.fight, cur)
    }
    expect(checked).toBeGreaterThan(15)
    void glyphHints
  })

  it('déterminisme sur un vrai combat joué (monstres réels, joueurs gloutons) : mêmes plans et prix à chaque tour', () => {
    const run = (): string[] => {
      const engine = createEngine(data, vortexHooks)
      const players = buildTeam(data, parseTeam(META, data))
      const fight = createVortexFight(engine, players, { params: VORTEX_DEFAULT_PARAMS, seed: 12, rollMode: 'random', record: false, rngRekey: 'perTurn' })
      const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
      const monsters = createControllers(engine, defaultAIConfig('fast', 12, theta), { scenario: model })
      const log: string[] = []
      const provider = Object.assign((f: Fighter) => (f.team !== 0 ? monsters(f) : {
        playTurn(e: Engine, s: FightState, me: Fighter) {
          const bb = update(model, { engine: e, fight: s, players }, 'fast')
          const rows = [...bb.prices.kill].map(([id, row]) => `${id}:${Array.from(row).map(Math.round).join(',')}`).join(';')
          log.push(`${s.round}.${s.turnIndex}|${model.explain()}|${rows}|${bb.prices.clock.map(Math.round).join(',')}`)
          playGreedyTurn(e, s, me)
        },
      }), { stats: monsters.stats, snapshot: monsters.snapshot, restore: monsters.restore })
      for (let i = 0; i < 200 && !fight.ended && fight.round <= 5; i++) {
        const cur = engine.nextTurn(fight)
        if (!cur) break
        if (cur.tags.cannotPlay !== true) provider(cur).playTurn(engine, fight, cur)
        if (!fight.ended && cur.alive) engine.endTurn(fight, cur)
      }
      return log
    }
    const a = run()
    const b = run()
    expect(a.length).toBeGreaterThan(8)
    expect(b).toEqual(a)
  })

  it('instantané / reprise : coûts mesurés conservés ⇒ mêmes prix qu’avant, même après la mort d’un allié', () => {
    const s = setup({ seed: 6, meta: true })
    turnOf(s, s.players[0], 2)
    const a = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    update(a, s, 'standard')
    const snap = a.snapshot()
    expect(snap.costs?.source).toBe('measured')
    // Un allié meurt ; reprise dans un modèle neuf (rembobinage) : il ne doit pas re-mesurer les coûts à 3 joueurs.
    s.engine.kill(s.fight, s.players[3])
    turnOf(s, s.players[1], 2)
    const b = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    b.restore(JSON.parse(JSON.stringify(snap)))
    const bbA = update(a, s, 'standard')
    const bbB = update(b, s, 'standard')
    expect(Array.from(b.costs!.vx)).toEqual(Array.from(a.costs!.vx))
    for (const [id, row] of bbA.prices.kill) expect(Array.from(bbB.prices.kill.get(id)!), `${id}`).toEqual(Array.from(row))
    expect(bbB.prices.clock).toEqual(bbA.prices.clock)
    expect(b.snapshot()).toEqual(a.snapshot())
  })

  it('revivedValue : corruption sous l’étoile puis résurrection dans un rollout ⇒ kill[m][0] ; marquage ⇒ kill[m][h]', () => {
    const s = setup({ seed: 5 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, p1, 4)
    expect(hasStar(ika)).toBe(true)
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    const bb = update(model, s, 'fast')
    // Corruption dans le clone, puis le rollout traverse le tour du Vortex : le mort revient corrompu.
    const leaf = s.engine.cloneFight(s.fight, false)
    s.engine.kill(leaf, leaf.fighters[ika.id], leaf.fighters[p1.id])
    throughVortexTurn(s.engine, leaf)
    expect(leaf.fighters[ika.id].alive).toBe(true)
    expect(isCorrupted(leaf.fighters[ika.id])).toBe(true)
    expect(model.revivedValue(s.fight, leaf, bb)).toBe(bb.prices.kill.get(ika.id)![0])
    // Marquage d'un autre monstre à l'heure courante (neuve pour lui), ressuscité zombie : kill[m][h].
    const other = s.fight.fighters.find(f => isWaveMonster(f) && f.alive && f.id !== ika.id && !hasStar(f) && !isCorrupted(f))!
    const h = currentHour(s.fight)
    expect(deathHours(other) & (1 << (h - 1))).toBe(0)
    const leaf2 = s.engine.cloneFight(s.fight, false)
    s.engine.kill(leaf2, leaf2.fighters[other.id], leaf2.fighters[p1.id])
    throughVortexTurn(s.engine, leaf2)
    expect(leaf2.fighters[other.id].alive).toBe(true)
    expect(deathHours(leaf2.fighters[other.id]) & (1 << (h - 1))).not.toBe(0)
    expect(model.revivedValue(s.fight, leaf2, bb)).toBe(bb.prices.kill.get(other.id)![h])
    // Rien de changé : 0.
    expect(model.revivedValue(s.fight, s.engine.cloneFight(s.fight, false), bb)).toBe(0)
  })

  it('Heuristique (phase 2) : extraIncoming identique dans l’état réel et dans un clone ; nul pour un allié qui rejoue avant le Vortex', () => {
    const engine = createEngine(data, vortexHooks)
    const players = buildTeam(data, parseTeam(META, data))
    const fight = createPhase2Fight(engine, players, { params: { ...VORTEX_DEFAULT_PARAMS, phase2Hours: [2, 7, 10] }, seed: 5, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const s: Setup = { engine, fight, players }
    const vortex = fight.fighters[vortexState(fight)!.vortexId]
    // Premier joueur du tour : les joueurs suivants AVANT le Vortex peuvent encore quitter la ligne, pas lui.
    const order = fight.timeline.map(id => fight.fighters[id])
    const vi = order.findIndex(f => f.id === vortex.id)
    const before = order.slice(0, vi).filter(f => f.kind === 'player')
    const after = order.slice(vi + 1).filter(f => f.kind === 'player')
    expect(before.length).toBeGreaterThanOrEqual(2)
    const first = before[0]
    turnOf(s, first, 1)
    expect((vortex.cooldowns[SPELL.HEURAGE] ?? 0) <= 1).toBe(true)
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    update(model, s, 'fast')
    const slots = (model as unknown as { burstSlots(x: FightState): ClockSlot[] }).burstSlots(fight)
    const target = HOUR_CELL[slots[nextVortexSlot(slots, 1)].hour]
    // Case alignée (≤ 8) avec une case de contact de la future case de l'Auroraire (arrivée d'Heurage).
    const contact = fight.map.cells.findIndex((c, i) => c.walkable && distance(i, target) === 1)
    const aligned = fight.map.cells.findIndex((c, i) => c.walkable && i !== contact && distance(i, target) > 1 && (CELL_X[i] === CELL_X[contact] || CELL_Y[i] === CELL_Y[contact]) && distance(i, contact) <= 8)
    expect(aligned).toBeGreaterThanOrEqual(0)
    const heur = (f: FightState, a: Fighter, c: number): number =>
      (model as unknown as { heuristiqueIncoming(x: FightState, y: Fighter, z: number): number }).heuristiqueIncoming(f, a, c)
    const v = heur(fight, first, aligned)
    expect(v).toBeGreaterThan(0)
    expect(model.extraIncoming(fight, first, aligned)).toBeGreaterThanOrEqual(v)
    // Clone (recherche tactique) : même valeur, sans prévision par appel.
    const clone = engine.cloneFight(fight, false)
    expect(heur(clone, clone.fighters[first.id], aligned)).toBe(v)
    // Un allié qui joue entre maintenant et le Vortex peut encore bouger : rien ; un allié qui joue après le Vortex : oui.
    for (const p of before.slice(1)) expect(heur(fight, p, aligned), p.name).toBe(0)
    for (const p of after) expect(heur(fight, p, aligned), p.name).toBeGreaterThan(0)
    // Case hors de toute ligne d'une case de contact : rien.
    const contacts = fight.map.cells.map((c, i) => (c.walkable && distance(i, target) === 1 ? i : -1)).filter(i => i >= 0)
    const off = fight.map.cells.findIndex((c, i) => c.walkable && contacts.every(k => (CELL_X[i] !== CELL_X[k] && CELL_Y[i] !== CELL_Y[k]) || distance(i, k) > 8))
    expect(heur(fight, first, off)).toBe(0)
    // Hors phase 2 (avant Action !) : pas d'Heuristique.
    const s1 = setup({ seed: 2 })
    turnOf(s1, s1.players[0], 2)
    const m1 = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    update(m1, s1, 'fast')
    const cell = s1.fight.map.cells.findIndex(c => c.walkable)
    expect((m1 as unknown as { heuristiqueIncoming(a: FightState, b: Fighter, c: number): number }).heuristiqueIncoming(s1.fight, s1.players[0], cell)).toBe(0)
  })
})
