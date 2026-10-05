/**
 * IA de groupe — couche d'équipe et couche tactique (docs/design/ai.md §8, §9, §10.3, §13.2) — WP2, sur vraies
 * données (cartes, classes, monstres de l'Œil de Vortex) :
 *  - rôles (§9.2) : capacités, affectation par avantage comparatif, rôles imposés, réassignation ;
 *  - tableau noir (§9.3) : focus, réservations, sérialisation pure ; allocation des intentions (§9.5) ;
 *  - `GenericModel` (§9.4) ; évaluation d'une feuille (§8.4 : satisfaction des intentions, bandes, paliers) ;
 *  - exécuteur (§8.7 : écarts, replanification) ; décisions clés (§8.8) ; MCTS plat (`deep`) ;
 *  - contrôleur : déterminisme, honnêteté (ni `fight.events`, ni dés réels), budget en nœuds, instantané/reprise,
 *    annotations `aiNote` (E3) seulement si `explain` et enregistrement, clé de registre `team:<mode>`.
 */
import { describe, expect, it } from 'vitest'
import { createControllers, defaultAIConfig } from '../src/ai'
import { createNodeBudget, createPerception, createView, LAST_SEEN_TAG, observeVisibility, simClone, stateHash, STATE_INVISIBLE, type PerceptionX } from '../src/ai/core'
import { evalLeaf, healCleansablePoison, intentSatisfaction, newSummonLife, rootInfo, scenarioTerm } from '../src/ai/tactical/evaluate'
import { generate, macroContent, selectForSim } from '../src/ai/tactical/generate'
import { deviation, executePlan } from '../src/ai/tactical/executor'
import { postKeyReason, preKeyReason } from '../src/ai/tactical/keys'
import { mctsChoose } from '../src/ai/tactical/mcts'
import type { SearchPlan } from '../src/ai/tactical/node'
import { digestOf, isCreative, searchTurn, selectDiverse } from '../src/ai/tactical/turnSearch'
import { TACTICS, tacticsFor } from '../src/ai/tactics'
import { allocateIntents } from '../src/ai/team/allocator'
import { computeFocus, deserializeBlackboard, emptyBlackboard, serializeBlackboard } from '../src/ai/team/blackboard'
import { createTeamController, TeamController } from '../src/ai/team/controller'
import { createGenericModel } from '../src/ai/team/genericModel'
import { assignRoles, capabilities, defaultReferenceTargets, GENERIC_NEEDS, roleScores } from '../src/ai/team/roles'
import { toActions, type Intent, type MacroAction, type RoleId } from '../src/ai/types'
import { castSpell } from '../src/engine/cast'
import { castSubSpell } from '../src/engine/effects/core'
import { runFight } from '../src/engine/runner'
import type { FightState } from '../src/engine/types'
import { BREEDS, yieldToEventLoop } from './ai-core-helpers'
import { at, castsOf, decide, foe, hero, scene, type Scene } from './ai-puzzles-helpers'

/** Scène P1 (Enutrof, Crâ, Buboxor) : petite, rapide. */
function p1(): Scene {
  return scene({ fighters: [hero(BREEDS.enutrof, 'Enu', 25, -9), hero(BREEDS.cra, 'Cra', 16, -8), foe(3838, 'Bubo', 20, -4)], order: ['Enu', 'Bubo', 'Cra'] })
}

/** Équipe complète contre trois monstres du Vortex. */
function team4(): Scene {
  return scene({
    fighters: [hero(BREEDS.iop, 'Iop', 15, -8), hero(BREEDS.cra, 'Cra', 16, -9), hero(BREEDS.enutrof, 'Enu', 17, -8), hero(BREEDS.eniripsa, 'Eni', 19, -9),
      foe(3834, 'Ika', 20, -2), foe(3838, 'Bubo', 22, -3), foe(3836, 'Mej', 23, -3)],
    order: ['Iop', 'Ika', 'Cra', 'Bubo', 'Enu', 'Mej', 'Eni'],
  })
}

function perceptionOf(sc: Scene): PerceptionX {
  return createPerception(createView(sc.engine, sc.fight, sc.me, 5)) as PerceptionX
}

describe('rôles (§9.2)', () => {
  it('capacités et affectation : Eniripsa soigneur, rôles distincts, scores relatifs ≤ 1,1', () => {
    const sc = team4()
    const view = createView(sc.engine, sc.fight, sc.me, 1)
    const p = perceptionOf(sc)
    const players = sc.fight.fighters.filter(f => f.kind === 'player')
    const ref = defaultReferenceTargets(view)
    expect(ref.targets).toHaveLength(3)
    const caps = players.map(f => capabilities(view, f, p, ref))
    const eni = caps[players.findIndex(f => f.name === 'Eni')]
    const enu = caps[players.findIndex(f => f.name === 'Enu')]
    const iop = caps[players.findIndex(f => f.name === 'Iop')]
    expect(eni.heal).toBeGreaterThan(enu.heal)
    expect(enu.mpRemoval).toBeGreaterThan(0)
    expect(iop.dptMono).toBeGreaterThan(500)
    expect(eni.cleanse).toBe(true)
    const scores = players.map((f, i) => roleScores(view, f, caps[i], p))
    const roles = assignRoles(players, scores, GENERIC_NEEDS)
    expect(roles.get(sc.get('Eni').id)!.primary).toBe('healer')
    for (const r of roles.values()) for (const v of Object.values(r.scores)) expect(v).toBeLessThanOrEqual(1.1 + 1e-9)
    // Rôle imposé (preset) : prioritaire.
    const imposed = assignRoles(players, scores, GENERIC_NEEDS, new Map<number, RoleId>([[sc.get('Iop').id, 'tank']]))
    expect(imposed.get(sc.get('Iop').id)!.primary).toBe('tank')
    // Besoins du Vortex (2 tueurs, 1 entrave) : l'Enutrof prend l'entrave.
    const vx = assignRoles(players, scores, { killer: 2, mpLock: 1, zoneDps: 1, placer: 0.5, healer: 0.5, tank: 0.5 })
    expect(vx.get(sc.get('Enu').id)!.primary).toBe('mpLock')
    expect([...vx.values()].filter(r => r.primary === 'killer').length).toBeGreaterThanOrEqual(1)
  })

  it('le TeamBrain affecte les rôles au premier tour et les réassigne si un porteur de rôle clé meurt', () => {
    const sc = team4()
    const tc = createTeamController(defaultAIConfig('fast', 3))
    tc.brain.observe(sc.engine, sc.fight, sc.me)
    expect(tc.brain.bb.roles.size).toBe(4)
    const healer = [...tc.brain.bb.roles].find(([, r]) => r.primary === 'healer')
    expect(healer).toBeDefined()
    sc.engine.kill(sc.fight, sc.fight.fighters[healer![0]])
    tc.brain.observe(sc.engine, sc.fight, sc.me)
    expect(tc.brain.bb.roles.size).toBe(3)
    expect(tc.brain.bb.roles.has(healer![0])).toBe(false)
  })
})

describe('tableau noir, allocation, GenericModel (§9.3-§9.5)', () => {
  it('focus : un ennemi affaibli (fenêtre de kill d’équipe) monte dans l’ordre ; sérialisation pure (aller-retour identique)', () => {
    const sc = team4()
    const bubo = sc.get('Bubo')
    const view = createView(sc.engine, sc.fight, sc.me, 1)
    const bb = emptyBlackboard()
    const full = computeFocus(view, perceptionOf(sc), bb)
    expect(full).toHaveLength(3)
    bubo.hp = 600
    bb.focus = computeFocus(view, perceptionOf(sc), bb)
    expect(bb.focus).toHaveLength(3)
    expect(bb.focus.indexOf(bubo.id)).toBeLessThanOrEqual(full.indexOf(bubo.id))
    bb.prices.kill.set(bubo.id, Float32Array.from([1, 2, 3]))
    bb.prices.cell = new Float32Array(560).fill(-1)
    bb.intents.push({ id: 'x', kind: 'control', owner: 0, window: { fromRound: 1, fromIndex: 0, toRound: 1, toIndex: 3 }, target: bubo.id, params: { mpMax: 2 }, price: 100, source: 'allocator', explain: 'x' })
    bb.reservedCells.set(100, 0)
    bb.reservations.set(0, { targetId: bubo.id, p: 0.9, value: 500, spellIds: [1, 2] })
    const data = serializeBlackboard(bb)
    const json = JSON.parse(JSON.stringify(data))
    const back = deserializeBlackboard(json)
    expect(serializeBlackboard(back)).toEqual(data)
    expect(Array.from(back.prices.kill.get(bubo.id)!)).toEqual([1, 2, 3])
  })

  it('allocation : le Buboxor reçoit une intention de contrôle portée par l’Enutrof ; un allié mourant ⇒ protect/survive', () => {
    const sc = p1()
    const tc = createTeamController(defaultAIConfig('fast', 2))
    const { view, perception } = tc.brain.observe(sc.engine, sc.fight, sc.me)
    allocateIntents(view, perception, tc.brain.bb, tc.cfg.theta, tc.brain.caps)
    const ctl = tc.brain.bb.intents.find(i => i.kind === 'control')
    expect(ctl).toBeDefined()
    expect(ctl!.target).toBe(sc.get('Bubo').id)
    expect(ctl!.owner).toBe(sc.me.id)
    expect(ctl!.params?.mpMax).toBeGreaterThanOrEqual(0)
    // Crâ presque mort, Buboxor au contact : protection d'urgence.
    sc.get('Cra').hp = 300
    const sc2 = scene({ fighters: [hero(BREEDS.eniripsa, 'Eni', 20, -9), hero(BREEDS.cra, 'Cra', 20, -6), foe(3838, 'Bubo', 20, -4)], order: ['Eni', 'Bubo', 'Cra'], setup: (_e, _f, get) => { get('Cra').hp = 300 } })
    const tc2 = createTeamController(defaultAIConfig('fast', 2))
    const o2 = tc2.brain.observe(sc2.engine, sc2.fight, sc2.me)
    allocateIntents(o2.view, o2.perception, tc2.brain.bb, tc2.cfg.theta, tc2.brain.caps)
    expect(tc2.brain.bb.intents.some(i => i.kind === 'protect' && i.target === sc2.get('Cra').id && i.owner === sc2.me.id)).toBe(true)
    expect(tc2.brain.bb.emergency).toBe(true)
  })

  it('GenericModel : phase fight, prix vides, besoins génériques, cibles de référence', () => {
    const sc = team4()
    const m = createGenericModel(defaultAIConfig('fast', 1).theta)
    const bb = emptyBlackboard()
    bb.prices.kill.set(1, new Float32Array(13))
    const view = createView(sc.engine, sc.fight, sc.me, 1)
    m.update(view, bb, perceptionOf(sc), 'fast')
    expect(bb.phase).toBe('fight')
    expect(bb.prices.kill.size).toBe(0)
    expect(bb.focus.length).toBe(3)
    expect(m.roleNeeds!().killer).toBe(2)
    expect(m.referenceTargets!(view).targets.length).toBe(3)
    expect(m.isKeyDecision!(view, bb)).toBeNull()
  })
})

describe('évaluation d’une feuille (§8.4)', () => {
  it('satisfaction des intentions et terme de scénario (bandes, paliers, cases)', () => {
    const sc = p1()
    const d = decide(sc, 'fast')
    const ctx = d.ctx
    const info = rootInfo(ctx)
    const bubo = sc.get('Bubo')
    const root = ctx.root!
    const w = { fromRound: 0, fromIndex: 0, toRound: 99, toIndex: 0 }
    const it = (kind: Intent['kind'], extra: Partial<Intent> = {}): Intent => ({ id: kind, kind, owner: sc.me.id, window: w, price: 1000, source: 'allocator', explain: '', ...extra })
    // control : PM retirés au Buboxor ⇒ satisfaction croissante.
    const s = simClone(ctx.view, root, 3)
    const b2 = s.fighters[bubo.id]
    const ctl = it('control', { target: bubo.id, params: { mpMax: 2 } })
    expect(intentSatisfaction(ctx, ctl, s, info, true)).toBe(0)
    sc.engine.addBuff(s, b2, { sourceId: sc.me.id, spellId: 1, effect: { ...b2.spells[0].level.effects[0], effectId: 127 }, value: -4, remaining: 2, delay: 0, dispellable: true, statDelta: { mp: -4 }, label: 'test', kind: 'stat' })
    expect(intentSatisfaction(ctx, ctl, s, info, true)).toBe(1)
    // reserve : −1 si le sort réservé a été lancé.
    const spell = sc.me.spells.find(k => k.spellId === 13337)!
    const res = it('reserve', { params: { spellId: spell.spellId } })
    expect(intentSatisfaction(ctx, res, root, info, true)).toBe(0)
    const s3 = simClone(ctx.view, root, 4)
    s3.fighters[sc.me.id].castsThisTurn[spell.spellId] = 1
    expect(intentSatisfaction(ctx, res, s3, info, true)).toBe(-1)
    // position : case finale dans la cible ⇒ 1 (feuille terminale seulement).
    const pos = it('position', { cells: [sc.me.cell] })
    expect(intentSatisfaction(ctx, pos, root, info, true)).toBe(1)
    expect(intentSatisfaction(ctx, pos, root, info, false)).toBe(0)
    // Bandes de PV et palier : bonus dans la bande, pente nulle sous le palier.
    ctx.bb.prices.hp.set(bubo.id, { slope: 0.5, floor: 5000, bandMin: 1, bandMax: 6000, bandBonus: 300 })
    const s4 = simClone(ctx.view, root, 5)
    s4.fighters[bubo.id].hp = 4000
    const t4 = scenarioTerm(ctx, s4, info, { terminal: true })
    expect(t4).toBeCloseTo(300 - 0.5 * (5000 - 4000), 6)
    // Case finale : prix de case lu sur la case du combattant (feuilles terminales).
    ctx.bb.prices.hp.clear()
    ctx.bb.prices.cell = new Float32Array(560)
    ctx.bb.prices.cell[sc.me.cell] = -777
    expect(scenarioTerm(ctx, root, info, { terminal: true })).toBe(-777)
    expect(scenarioTerm(ctx, root, info, { terminal: false })).toBe(0)
    const e = evalLeaf(ctx, root, { terminal: true })
    expect(e.b.scenario).toBe(-777)
    expect(e.v).toBeCloseTo(e.b.total, 6)
  })

  it('poison retiré par un soin : détecté sur les personnages touchés par le Petit poison', () => {
    const sc = scene({
      fighters: [hero(BREEDS.eniripsa, 'Eni', 20, -6), hero(BREEDS.iop, 'Iop', 21, -7), foe(3837, 'Harp', 20, 2)],
      order: ['Eni', 'Harp', 'Iop'],
      setup: (e, f, get) => castSubSpell(e, f, get('Harp'), 5021, 1, get('Harp').cell, false, 0),
    })
    expect(healCleansablePoison(sc.get('Eni'))).toBe(true)
    expect(healCleansablePoison(sc.get('Iop'))).toBe(true)
    expect(healCleansablePoison(sc.get('Harp'))).toBe(false)
  })
})

describe('recherche tactique (§8.2, §8.3)', () => {
  it('budget en nœuds respecté (fast 40, standard 1 500 hors décision clé) ; plans valides ; déterminisme', () => {
    for (const mode of ['fast', 'standard'] as const) {
      const a = decide(p1(), mode)
      const max = a.budget.maxNodes * (a.key && mode === 'standard' ? a.budget.keyDecisionBoost * 2 : 1)
      expect(a.nodes).toBeGreaterThan(0)
      expect(a.nodes).toBeLessThanOrEqual(max + 8)
      const b = decide(p1(), mode)
      expect(b.plan.actions.map(m => m.key)).toEqual(a.plan.actions.map(m => m.key))
      expect(b.plan.value).toBe(a.plan.value)
      // Le plan se rejoue tel quel dans le combat réel (actions valides).
      const sc = p1()
      const d = decide(sc, mode)
      const r = executePlan(sc.engine, sc.fight, sc.me, d.plan, { mode, replan: () => null, maxReplans: 0, hpDev: 0.15 })
      expect(r.actions).toBeGreaterThan(0)
    }
  }, 60_000)

  it('selectDiverse : emplacement réservé à un enfant non offensif dans la marge, pas plus de 2 signatures identiques', () => {
    const mk = (v: number, cats: MacroAction['cat'][], spell: number) => ({
      s: {} as FightState, hash: BigInt(v), depth: 1, actions: [{ cast: { spellId: spell, cell: 1 }, cat: cats[0], prior: 0, key: `${spell}:${v}` }],
      v, adj: 0, split: false, tactics: [], cats, hasMandatory: false, digests: [],
    })
    const kids = [mk(100, ['damage'], 1), mk(99, ['damage'], 1), mk(98, ['damage'], 1), mk(97, ['damage'], 2), mk(90, ['control'], 3)]
    const out = selectDiverse(kids, 3, 0, 0.3)
    expect(out[0].v).toBe(100)
    expect(out.some(n => n.cats.includes('control'))).toBe(true)
    expect(out.filter(n => n.actions[0].cast!.spellId === 1).length).toBeLessThanOrEqual(2)
  })

  it('marquage créatif (§10.3) : action non offensive ET (≥ 15 % au-dessus du meilleur plan offensif ou ≥ 60 % du ΔV hors dégâts)', () => {
    const zero = { total: 0, enemyLife: 0, kills: 0, allyLife: 0, erosion: 0, allyDeath: 0, incoming: 0, pendingDot: 0, control: 0, potential: 0, continuation: 0, resources: 0, position: 0, scenario: 0 }
    const leaf = (v: number, cats: MacroAction['cat'][], b = zero) => ({
      node: { s: {} as FightState, hash: 0n, depth: 1, actions: cats.map((c, i) => ({ cat: c, prior: 0, key: `${i}` })), v, adj: 0, split: false, tactics: [], cats, hasMandatory: false, digests: [] },
      s: {} as FightState, v, vTerminal: v, breakdown: { ...b, total: v }, rolled: false,
    })
    const pass = leaf(0, [])
    expect(isCreative(leaf(1000, ['damage']), pass, 500)).toBe(false)
    expect(isCreative(leaf(1200, ['control', 'damage']), pass, 1000)).toBe(true)
    expect(isCreative(leaf(1100, ['control', 'damage'], { ...zero, enemyLife: 1000 }), pass, 1000)).toBe(false)
    expect(isCreative(leaf(1100, ['control', 'damage'], { ...zero, enemyLife: 300, incoming: 800 }), pass, 1000)).toBe(true)
  })

  it('tactiques : `requires` filtre par profils de sorts ; propositions bien formées (séquences étiquetées)', () => {
    const sc = scene({
      fighters: [hero(BREEDS.pandawa, 'Pan', 18, -6), foe(3834, 'Ika', 18, -7), foe(3838, 'Bubo', 21, -4), foe(3836, 'Mej', 21, -3), hero(BREEDS.iop, 'Iop', 20, -9)],
      order: ['Pan', 'Iop', 'Ika', 'Bubo', 'Mej'],
      setup: (e, f, get) => castSubSpell(e, f, get('Pan'), 24037, 1, get('Pan').cell, false, 0),
    })
    const p = perceptionOf(sc)
    const forPan = tacticsFor(sc.me, undefined, p).map(t => t.id)
    expect(forPan).toContain('carryThrow')
    const forEnu = tacticsFor(hero(BREEDS.enutrof, 'E', 15, -8), undefined, p).map(t => t.id)
    expect(forEnu).toContain('mpLock')
    expect(forEnu).not.toContain('carryThrow')
    const d = decide(sc, 'fast')
    const node = { s: d.ctx.root!, hash: stateHash(d.ctx.root!), depth: 0, actions: [], v: 0, adj: 0, split: false, tactics: [], cats: [], hasMandatory: false, digests: [] }
    let proposals = 0
    for (const t of TACTICS) {
      if (t.relevance(d.ctx, node) <= 0) continue
      for (const m of t.propose(d.ctx, node, 4)) {
        proposals++
        expect(m.key.length).toBeGreaterThan(0)
        if (m.seq) {
          expect(m.tactic).toBe(t.id)
          expect(m.seq.length).toBeGreaterThanOrEqual(1)
          expect(m.seq.length).toBeLessThanOrEqual(4)
        }
      }
    }
    expect(proposals).toBeGreaterThan(0)
  }, 60_000)
})

describe('exécution et replanification (§8.7)', () => {
  it('écarts détectés : case, PM, mort, PV (> 15 % des dégâts prévus)', () => {
    const sc = p1()
    const s = simClone(createView(sc.engine, sc.fight, sc.me, 1), sc.fight, 9)
    const d0 = digestOf(sc.fight, s, sc.me.id)
    expect(deviation(sc.fight, sc.me, d0, 0.15)).toBe('')
    const moved = { ...d0, meCell: d0.meCell + 1 }
    expect(deviation(sc.fight, sc.me, moved, 0.15)).toBe('case')
    expect(deviation(sc.fight, sc.me, { ...d0, meMp: d0.meMp - 2 }, 0.15)).toBe('PM')
    const bubo = sc.get('Bubo')
    expect(deviation(sc.fight, sc.me, { ...d0, alive: d0.alive.filter(id => id !== bubo.id) }, 0.15)).toBe('mort')
    expect(deviation(sc.fight, sc.me, { ...d0, hp: [[bubo.id, bubo.hp - 1000, bubo.hp]] }, 0.15)).toBe('PV')
    expect(deviation(sc.fight, sc.me, { ...d0, hp: [[bubo.id, bubo.hp - 1000, bubo.hp + 100000]] }, 0.15)).toBe('')
  })

  it('une action qui échoue déclenche une replanification ; le budget de replanification est borné', () => {
    const sc = p1()
    const bad: SearchPlan = {
      actions: [{ cast: { spellId: 13337, cell: 0 }, cat: 'control', prior: 0, key: 'bad' }],
      value: 0, nodes: 0, digests: [], leafV: 0, passV: 0, rootV: 0, hasMandatory: false,
    }
    let calls = 0
    const r = executePlan(sc.engine, sc.fight, sc.me, bad, {
      mode: 'standard', hpDev: 0.15, maxReplans: 2,
      replan: () => {
        calls++
        return calls <= 5 ? bad : null
      },
    })
    expect(r.deviations[0]).toBe('échec')
    expect(r.replans).toBe(2)
    expect(calls).toBe(2)
  })
})

describe('décisions clés (§8.8) et MCTS deep (simplifié)', () => {
  it('allyDeathRisk avant la recherche ; closeCall après', () => {
    const sc = scene({ fighters: [hero(BREEDS.eniripsa, 'Eni', 20, -9), hero(BREEDS.cra, 'Cra', 20, -6), foe(3838, 'Bubo', 20, -4)], order: ['Eni', 'Bubo', 'Cra'], setup: (_e, _f, get) => { get('Cra').hp = 300 } })
    const d = decide(sc, 'fast')
    expect(preKeyReason({ ...d.ctx, root: undefined })).toBe('allyDeathRisk')
    const plan = { ...d.plan, closeCall: true, maxDeathRisk: 0 }
    expect(postKeyReason(plan)).toBe('closeCall')
    expect(postKeyReason({ ...plan, closeCall: false, maxDeathRisk: 0.5 })).toBe('allyDeathRisk')
    expect(postKeyReason({ ...plan, closeCall: false })).toBeNull()
  })

  it('MCTS plat : déterministe, itérations réparties, préfère un plan nettement meilleur', () => {
    const sc = p1()
    const d = decide(sc, 'fast')
    const good = d.plan
    const nothing: SearchPlan = { ...good, actions: [], digests: [] }
    const a = mctsChoose(d.ctx, [nothing, good], 12)
    const b = mctsChoose(d.ctx, [nothing, good], 12)
    expect(a).toEqual(b)
    expect(a.iterations).toBe(12)
    expect(a.visits.reduce((x, y) => x + y, 0)).toBe(12)
    expect(a.index).toBe(1)
  }, 60_000)
})

describe('contrôleur (§9.1, §13.2)', () => {
  it('honnêteté : decide ne lit pas fight.events, ne touche ni aux dés ni à l’état réel', () => {
    const sc = p1()
    const rng = sc.fight.rngState
    const h0 = stateHash(sc.fight)
    // Accesseur non énumérable : la copie superficielle de `cloneFight` ne le lit pas, toute lecture explicite échoue.
    Object.defineProperty(sc.fight, 'events', { get: () => { throw new Error('lecture de fight.events') }, configurable: true, enumerable: false })
    const d = decide(sc, 'standard')
    expect(d.plan.actions.length).toBeGreaterThan(0)
    expect(sc.fight.rngState).toBe(rng)
    expect(stateHash(sc.fight)).toBe(h0)
  }, 60_000)

  it('combat complet rejouable bit à bit ; instantané/reprise du TeamBrain ⇒ décisions identiques', async () => {
    const run = (cut?: number): { hash: bigint; log: string[] } => {
      const sc = team4()
      const cfg = defaultAIConfig('fast', 21)
      const log: string[] = []
      let tc = new TeamController(cfg, undefined, { onTurn: i => log.push(`${i.fighterId}:${i.plan.actions.map(m => m.key).join('>')}`) })
      let turns = 0
      const provider = (f: { team: number }) => (f.team === 0 ? {
        playTurn(engine: typeof sc.engine, fight: FightState, me: Parameters<TeamController['playTurn']>[2]) {
          if (cut !== undefined && turns === cut) {
            // Reprise : un contrôleur neuf restauré depuis l'instantané pur (JSON) du précédent.
            const snap = JSON.parse(JSON.stringify(tc.brain.snapshot()))
            tc = new TeamController(cfg, undefined, { onTurn: i => log.push(`${i.fighterId}:${i.plan.actions.map(m => m.key).join('>')}`) })
            tc.brain.restore(snap)
          }
          turns++
          tc.playTurn(engine, fight, me)
        },
      } : { playTurn() {} })
      // Monstres passifs : seul le comportement de l'équipe est comparé.
      sc.fight.options.maxRounds = 3
      runFight(sc.engine, sc.fight, provider as never, 60)
      return { hash: stateHash(sc.fight), log }
    }
    const a = run()
    await yieldToEventLoop()
    const b = run()
    expect(b).toEqual(a)
    await yieldToEventLoop()
    const c = run(3)
    expect(c.log).toEqual(a.log)
    expect(c.hash).toBe(a.hash)
  }, 120_000)

  it('annotations aiNote : émises seulement avec explain + enregistrement ; aucune influence sur le combat', () => {
    const play = (explain: boolean, record: boolean) => {
      const sc = team4()
      sc.fight.options.record = record
      const cfg = defaultAIConfig('fast', 4)
      cfg.explain = explain
      const tc = createTeamController(cfg)
      tc.playTurn(sc.engine, sc.fight, sc.me)
      return { notes: sc.fight.events.filter(e => e.t === 'aiNote'), hash: stateHash(sc.fight) }
    }
    const on = play(true, true)
    const off = play(false, true)
    const noRec = play(true, false)
    expect(on.notes.length).toBeGreaterThan(0)
    expect(on.notes.some(n => n.t === 'aiNote' && n.kind === 'plan')).toBe(true)
    for (const n of on.notes) if (n.t === 'aiNote') expect(n.text.length).toBeGreaterThan(5)
    expect(off.notes).toHaveLength(0)
    expect(noRec.notes).toHaveLength(0)
    expect(on.hash).toBe(off.hash)
    expect(noRec.hash).toBe(off.hash)
  })

  it('registre : la clé `team:<mode>` fait jouer un TeamController du mode demandé ; stats agrégées par createControllers', () => {
    const sc = p1()
    sc.me.ai = 'team:standard'
    const provider = createControllers(sc.engine, defaultAIConfig('fast', 1))
    provider(sc.me).playTurn(sc.engine, sc.fight, sc.me)
    expect(sc.me.ap).toBeLessThan(sc.me.stats.ap)
    const sc2 = p1()
    const prov2 = createControllers(sc2.engine, defaultAIConfig('fast', 1))
    prov2(sc2.me).playTurn(sc2.engine, sc2.fight, sc2.me)
    const st = prov2.stats()
    expect(st.nodes).toBeGreaterThan(0)
    expect(st.nodes).toBeLessThanOrEqual(40 + 8)
    const snap = prov2.snapshot()
    expect(() => prov2.restore(JSON.parse(JSON.stringify(snap)))).not.toThrow()
  })

  it('plans valides en combat réel : aucune action refusée par le moteur sur 6 scènes (fast)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const sc = team4()
      const cfg = defaultAIConfig('fast', seed)
      const tc = createTeamController(cfg)
      const d = tc.decide(sc.engine, sc.fight, sc.me)!
      const casts = castsOf(d.plan.actions)
      expect(casts.length).toBeGreaterThan(0)
      const r = executePlan(sc.engine, sc.fight, sc.me, d.plan, { mode: 'fast', replan: () => null, maxReplans: 0, hpDev: 0.15 })
      expect(r.deviations.filter(x => x === 'échec')).toHaveLength(0)
    }
  }, 60_000)

  it('budget des invocations alliées : ≤ 12 nœuds, mode fast', () => {
    const sc = p1()
    const cfg = defaultAIConfig('standard', 3)
    const tc = createTeamController(cfg)
    // Fait jouer l'Enutrof (il invoque souvent) puis la première invocation qui joue.
    tc.playTurn(sc.engine, sc.fight, sc.me)
    const summon = sc.fight.fighters.find(f => f.summonerId === sc.me.id && f.alive && f.tags.static !== true)
    if (!summon) return
    const d = tc.decide(sc.engine, sc.fight, summon)
    if (!d) return
    expect(d.mode).toBe('fast')
    expect(d.nodes).toBeLessThanOrEqual(12 + 4)
    void createNodeBudget
  }, 60_000)
})

// ───────────────────────────── revue adversariale (WP2) : régressions ─────────────────────────────

describe('revue WP2 : rôles, reprise, écarts, doublons, cohérence, invocations, honnêteté, deep', () => {
  it('réassignation (§9.2) : les rôles écrits par l’IA sur Fighter.role ne passent pas pour des rôles imposés', () => {
    const sc = team4()
    const tc = createTeamController(defaultAIConfig('fast', 3))
    // Chaque personnage décide une fois : l'IA écrit son rôle dans Fighter.role (replay).
    for (const n of ['Iop', 'Cra', 'Enu', 'Eni']) tc.decide(sc.engine, sc.fight, sc.get(n))
    for (const n of ['Iop', 'Cra', 'Enu', 'Eni']) expect(sc.get(n).role).toBe(tc.brain.bb.roles.get(sc.get(n).id)!.primary)
    const healer = [...tc.brain.bb.roles].find(([, r]) => r.primary === 'healer')![0]
    sc.engine.kill(sc.fight, sc.fight.fighters[healer])
    tc.brain.observe(sc.engine, sc.fight, sc.get('Iop'))
    // Référence : affectation libre (aucun rôle imposé) des survivants.
    const view = createView(sc.engine, sc.fight, sc.get('Iop'), 1)
    const p = perceptionOf(sc)
    const players = sc.fight.fighters.filter(f => f.alive && f.kind === 'player')
    const ref = defaultReferenceTargets(view)
    const scores = players.map(f => roleScores(view, f, capabilities(view, f, p, ref), p))
    const expected = assignRoles(players, scores, GENERIC_NEEDS)
    for (const f of players) expect(tc.brain.bb.roles.get(f.id)!.primary).toBe(expected.get(f.id)!.primary)
    // Un rôle réellement imposé (preset) le reste après réassignation.
    const sc2 = team4()
    sc2.get('Iop').role = 'tank'
    const tc2 = createTeamController(defaultAIConfig('fast', 3))
    for (const n of ['Iop', 'Cra', 'Enu', 'Eni']) tc2.decide(sc2.engine, sc2.fight, sc2.get(n))
    const h2 = [...tc2.brain.bb.roles].find(([, r]) => r.primary === 'healer')
    if (h2) sc2.engine.kill(sc2.fight, sc2.fight.fighters[h2[0]])
    tc2.brain.observe(sc2.engine, sc2.fight, sc2.get('Iop'))
    expect(tc2.brain.bb.roles.get(sc2.get('Iop').id)!.primary).toBe('tank')
    // Rôles imposés par les options du contrôleur (TeamOptions.roles).
    const sc3 = team4()
    const tc3 = createTeamController(defaultAIConfig('fast', 3), undefined, { roles: new Map<number, RoleId>([[sc3.get('Cra').id, 'support']]) })
    tc3.brain.observe(sc3.engine, sc3.fight, sc3.me)
    expect(tc3.brain.bb.roles.get(sc3.get('Cra').id)!.primary).toBe('support')
  }, 60_000)

  it('instantané (§15.8) : capacités et rôles imposés repris à l’identique (données pures)', () => {
    const sc = team4()
    sc.get('Iop').role = 'tank'
    const tc = createTeamController(defaultAIConfig('fast', 3))
    tc.brain.observe(sc.engine, sc.fight, sc.me)
    // L'IA écrit les rôles affectés (Fighter.role) : un contrôleur restauré ne doit pas les prendre pour imposés.
    for (const n of ['Cra', 'Enu', 'Eni']) tc.decide(sc.engine, sc.fight, sc.get(n))
    const snap = JSON.parse(JSON.stringify(tc.brain.snapshot()))
    const tc2 = createTeamController(defaultAIConfig('fast', 3))
    tc2.brain.restore(snap)
    expect([...tc2.brain.caps.keys()].sort()).toEqual([...tc.brain.caps.keys()].sort())
    for (const [id, c] of tc.brain.caps) expect(tc2.brain.caps.get(id)).toEqual(c)
    expect(tc2.brain.imposed.get(sc.get('Iop').id)).toBe('tank')
    expect(tc2.brain.imposed.get(sc.get('Cra').id) ?? null).toBeNull()
    // Après la mort du soigneur, les deux cerveaux réassignent de la même façon.
    const healer = [...tc.brain.bb.roles].find(([, r]) => r.primary === 'healer')
    if (healer) sc.engine.kill(sc.fight, sc.fight.fighters[healer[0]])
    tc.brain.observe(sc.engine, sc.fight, sc.get('Iop'))
    tc2.brain.observe(sc.engine, sc.fight, sc.get('Iop'))
    expect(serializeBlackboard(tc2.brain.bb).roles).toEqual(serializeBlackboard(tc.brain.bb).roles)
  }, 60_000)

  it('exécuteur (§8.7) : un retrait de PM esquivé ou un combattant hors de sa case prévue est un écart', () => {
    const sc = p1()
    const bubo = sc.get('Bubo')
    const s = simClone(createView(sc.engine, sc.fight, sc.me, 1), sc.fight, 9)
    const d0 = digestOf(sc.fight, s, sc.me.id)
    expect(d0.moved).toBeUndefined()
    // Prévu : le Buboxor à 3 PM (retrait de 3) ; réel : aucun retrait.
    const dodged = { ...d0, moved: [[bubo.id, bubo.cell, bubo.stats.ap, bubo.stats.mp - 3]] as [number, number, number, number][] }
    expect(deviation(sc.fight, sc.me, dodged, 0.15)).toBe('retrait')
    // Écart fractionnaire (espérance du clone) sous 0,75 point : conforme.
    const close = { ...d0, moved: [[bubo.id, bubo.cell, bubo.stats.ap, bubo.stats.mp - 0.5]] as [number, number, number, number][] }
    expect(deviation(sc.fight, sc.me, close, 0.15)).toBe('')
    const pushed = { ...d0, moved: [[bubo.id, bubo.cell + 1, bubo.stats.ap, bubo.stats.mp]] as [number, number, number, number][] }
    expect(deviation(sc.fight, sc.me, pushed, 0.15)).toBe('déplacement')
    // Empreinte d'un vrai retrait simulé : le Buboxor y figure avec ses PM prévus.
    const enu = s.fighters[sc.me.id]
    const mal = enu.spells.find(k => k.spellId === 13337)!
    const after = sc.engine.cloneFight(s, false)
    after.options.rollMode = 'average'
    const r = castSpell(sc.engine, after, after.fighters[sc.me.id], mal.spellId, bubo.cell)
    if (r.ok && after.fighters[bubo.id].stats.mp < bubo.stats.mp) {
      const d1 = digestOf(s, after, sc.me.id)
      expect(d1.moved?.some(([id, , , mp]) => id === bubo.id && mp < bubo.stats.mp)).toBe(true)
    }
  })

  it('génération (§8.1, §10) : une tactique qui ré-étiquette un candidat générique n’est pas simulée deux fois', () => {
    const sc = p1()
    const d = decide(sc, 'fast')
    const root = d.ctx.root!
    const node = { s: root, hash: stateHash(root), depth: 0, actions: [], v: 0, adj: 0, split: false, tactics: [], cats: [], hasMandatory: false, digests: [] }
    const g = generate(d.ctx, node)
    const base = g.generic[0]
    const copy: MacroAction = { ...base, key: `ml[${base.key}]`, tactic: 'mpLock', prior: base.prior + 500, mandatory: true }
    const picked = selectForSim(d.ctx, node, { ...g, tactics: [copy, ...g.tactics] }, d.budget)
    const same = picked.filter(m => macroContent(m) === macroContent(base))
    expect(same).toHaveLength(1)
    expect(same[0].mandatory).toBe(true)
    const contents = picked.map(macroContent)
    expect(new Set(contents).size).toBe(contents.length)
  })

  it('cohérence (§9.3) : une seule attente publiée par recherche, celle du plan retenu', () => {
    const sc = team4()
    const d = decide(sc, 'standard')
    const calls: [number, string][] = []
    const plan = searchTurn({ ...d.ctx, root: undefined, isKey: false, nodes: createNodeBudget(d.budget.maxNodes), expect: (id, key) => calls.push([id, key]) })
    expect(calls.length).toBeLessThanOrEqual(1)
    if (calls.length) expect(sc.fight.fighters[calls[0][0]].team).toBe(sc.me.team)
    expect(plan.actions.length).toBeGreaterThan(0)
  }, 60_000)

  it('invocations (§7, écart) : invoquer ne crée pas de valeur par les PV de l’invocation', () => {
    const sc = p1()
    const d = decide(sc, 'fast')
    const ctx = d.ctx
    const root = ctx.root!
    const s = simClone(ctx.view, root, 17)
    const enu = s.fighters[sc.me.id]
    const coffre = enu.spells.find(k => k.spellId === 13347)
    expect(coffre).toBeDefined()
    // Case libre adjacente où le Coffre Animé peut être invoqué.
    let ok = false
    for (const c of [enu.cell + 1, enu.cell - 1, enu.cell + 14, enu.cell - 14, enu.cell + 15, enu.cell - 15, enu.cell + 13, enu.cell - 13]) {
      const t = sc.engine.cloneFight(s, false)
      t.options.rollMode = 'average'
      if (castSpell(sc.engine, t, t.fighters[sc.me.id], 13347, c).ok && t.fighters.length > s.fighters.length) {
        const summon = t.fighters[t.fighters.length - 1]
        expect(summon.team).toBe(sc.me.team)
        const born = newSummonLife(ctx, t)
        expect(born).toBeCloseTo(ctx.cfg.theta.value.summonLife * (summon.hp + ctx.cfg.theta.value.allyShield * summon.shield), 6)
        const e0 = evalLeaf(ctx, root, { terminal: false })
        const e1 = evalLeaf(ctx, t, { terminal: false })
        // Personne d'autre n'a changé de PV : allyLife inchangé malgré les PV de l'invocation.
        expect(e1.b.allyLife).toBeCloseTo(e0.b.allyLife, 6)
        ok = true
        break
      }
    }
    expect(ok).toBe(true)
  })

  it('honnêteté (§6.1) : la décision ne dépend pas de la case RÉELLE d’un invisible adverse', () => {
    const plans: string[] = []
    for (const real of [[20, -1], [22, -4], [22, -4]] as const) {
      const visible = plans.length === 4 // 3e variante : l'Ikargn VISIBLE sur sa vraie case (témoin)
      const sc = scene({
        fighters: [hero(BREEDS.cra, 'Cra', 18, -10), hero(BREEDS.enutrof, 'Enu', 16, -8), foe(3838, 'Bubo', 20, -4), foe(3834, 'Ika', 23, -3)],
        order: ['Cra', 'Bubo', 'Enu', 'Ika'],
      })
      const ika = sc.get('Ika')
      // Invisible, vu pour la dernière fois sur sa case de départ, réellement ailleurs (deux variantes).
      observeVisibility(sc.fight)
      if (!visible) ika.states.push(STATE_INVISIBLE)
      ika.tags[LAST_SEEN_TAG] = ika.cell
      ika.cell = at(real[0], real[1])
      if (visible) observeVisibility(sc.fight)
      for (const mode of ['fast', 'standard'] as const) {
        const d = decide(sc, mode)
        plans.push(`${mode}:${d.plan.actions.map(m => m.key).join('>')}:${d.plan.value.toFixed(3)}:${d.ctx.bb.focus.join(',')}`)
      }
    }
    expect(plans[2]).toBe(plans[0])
    expect(plans[3]).toBe(plans[1])
    // Témoin : visible sur cette case, l'Ikargn change la décision (la case réelle compterait si elle était lue).
    expect(plans[4] !== plans[2] || plans[5] !== plans[3]).toBe(true)
  }, 120_000)

  it('deep (§8.8, simplifié) : une décision clé passe par le MCTS ; déterministe ; plan valide', () => {
    const build = () => scene({ fighters: [hero(BREEDS.eniripsa, 'Eni', 20, -9), hero(BREEDS.cra, 'Cra', 20, -6), foe(3838, 'Bubo', 20, -4)], order: ['Eni', 'Bubo', 'Cra'], setup: (_e, _f, get) => { get('Cra').hp = 300 } })
    const run = () => {
      const sc = build()
      // Budget réduit (le `deep` complet coûte ≈ 40 s par décision clé : 15 000 nœuds + 1 500 itérations).
      const d = decide(sc, 'deep', { budget: { maxNodes: 400, width: 4, rollouts: 2, mctsIterations: 12 } })
      return { sc, d }
    }
    const a = run()
    expect(a.d.key).toBe('allyDeathRisk')
    expect(a.d.mode).toBe('deep')
    expect(a.d.nodes).toBeGreaterThan(a.d.ctx.nodes.used) // itérations du MCTS comptées en plus de la recherche
    const b = run()
    expect(b.d.plan.actions.map(m => m.key)).toEqual(a.d.plan.actions.map(m => m.key))
    const r = executePlan(a.sc.engine, a.sc.fight, a.sc.me, a.d.plan, { mode: 'deep', replan: () => null, maxReplans: 0, hpDev: 0.15 })
    expect(r.deviations.filter(x => x === 'échec')).toHaveLength(0)
  }, 120_000)
})
