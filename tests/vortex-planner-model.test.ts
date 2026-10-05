/**
 * Modèle stratégique complet de l'Œil de Vortex (`VortexAIModel`, docs/design/ai.md §5.2, §12) sur le VRAI combat
 * (données, carte, sorts réels) — WP3b : mise à jour par phase, prix publiés, contrat avec V(s) (`damageWeight`,
 * `deathValue`, `extraIncoming`, `allyDeathExtra`), honnêteté, PL7 (tout corrompu → `waiting`), burst de phase 2,
 * décisions clés, placement analytique et simulé, enregistrement sur `vortexScenario`.
 */
import { describe, expect, it } from 'vitest'
import { createPerception } from '../src/ai/core/perception'
import { createView } from '../src/ai/core/view'
import { emptyBlackboard } from '../src/ai/team/controller'
import { loadTheta } from '../src/ai/theta'
import type { AIMode, Blackboard } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { planBurst, safeCellsFor } from '../src/dungeons/vortex/burst'
import { currentHour, forecastHours, hasStar, isWaveMonster, lineCells, nextVortexSlot, onHourLine } from '../src/dungeons/vortex/clock'
import { CORRUPTED, HOUR_CELL, IKARGN, RED_START_CELLS, SPELL, VORTEX, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { createPhase2Fight } from '../src/dungeons/vortex/micro'
import { createVortexAIModel, VortexAIModel, vortexPlanOf } from '../src/dungeons/vortex/model'
import { vortexState } from '../src/dungeons/vortex/params'
import { rankVortexPlacements } from '../src/dungeons/vortex/placement'
import { basicVortexAIModel, createSmokeTeam, vortexScenario } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { CELL_X, CELL_Y, distance } from '../src/map/geometry'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { buildTeam } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'

const data = loadDataStore('data')
const theta = loadTheta()
const META = 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu'

interface Setup {
  engine: Engine
  fight: FightState
  players: Fighter[]
}

function setup(o: { seed?: number; meta?: boolean; hp?: number } = {}): Setup {
  const engine = createEngine(data, vortexHooks)
  const players = o.meta ? buildTeam(data, parseTeam(META, data)) : createSmokeTeam(data, undefined, { hp: o.hp ?? 1_000_000 })
  const fight = createVortexFight(engine, players, { params: VORTEX_DEFAULT_PARAMS, seed: o.seed ?? 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  return { engine, fight, players }
}

/** Joue passivement jusqu'au début du tour de `f` au tour de jeu ≥ `round`. */
function turnOf(s: Setup, f: Fighter, round = 0): void {
  for (let i = 0; i < 4000; i++) {
    const cur = s.engine.current(s.fight)
    if (cur && cur.id === f.id && s.fight.round >= round && s.fight.round > 0) return
    if (cur && s.fight.round > 0 && cur.alive) s.engine.endTurn(s.fight, cur)
    if (!s.engine.nextTurn(s.fight)) break
  }
  throw new Error('tour jamais atteint')
}

/** Mise à jour du modèle au début du tour du combattant courant (perception réelle, tableau noir neuf). */
function update(model: VortexAIModel, s: Setup, mode: AIMode, bb: Blackboard = emptyBlackboard()): Blackboard {
  const me = s.engine.current(s.fight)!
  const view = createView(s.engine, s.fight, me, 7)
  const perception = createPerception(view, { theta }, model, { bb })
  model.update(view, bb, perception, mode)
  return bb
}

describe('modèle complet : phases de vagues (vrai combat)', () => {
  it('ouverture : plan d’heures, prix bornés pour les 3 monstres de la vague 1, déterministe, sans intention du planificateur', () => {
    for (const mode of ['fast', 'standard'] as AIMode[]) {
      const s = setup({ meta: true, seed: 3 })
      turnOf(s, s.players[0], 1)
      const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
      const bb = update(model, s, mode)
      expect(bb.phase).toBe('opening')
      const plan = vortexPlanOf(bb)
      expect(plan?.kind).toBe('hours')
      if (plan?.kind !== 'hours') continue
      expect(plan.plan.steps[0]).toMatchObject({ round: 1, fighterId: s.engine.current(s.fight)!.id })
      const wave = s.fight.fighters.filter(isWaveMonster)
      expect(wave).toHaveLength(3)
      for (const m of wave) {
        const row = bb.prices.kill.get(m.id)!
        expect(row).toHaveLength(13)
        for (let h = 1; h <= 12; h++) {
          expect(row[h]).toBeGreaterThanOrEqual(theta.vortex.killMin)
          expect(row[h]).toBeLessThanOrEqual(theta.vortex.killMax)
        }
        expect(row[0]).toBeGreaterThanOrEqual(theta.vortex.corruptKill)
        const hp = bb.prices.hp.get(m.id)!
        expect(hp.slope).toBeGreaterThanOrEqual(0)
        expect(hp.slope).toBeLessThanOrEqual(1.2)
      }
      for (const c of bb.prices.clock) expect(Math.abs(c)).toBeLessThanOrEqual(2000)
      expect(bb.intents.some(i => i.source === 'planner')).toBe(false)
      expect(model.costs?.source).toBe(mode === 'standard' ? 'measured' : 'fallback')
      // Même état, même modèle neuf ⇒ mêmes prix (aucun aléa, aucune lecture du temps).
      const again = update(createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta), s, mode)
      for (const m of wave) expect(Array.from(again.prices.kill.get(m.id)!)).toEqual(Array.from(bb.prices.kill.get(m.id)!))
      expect(again.prices.clock).toEqual(bb.prices.clock)
      expect(model.explain()).toMatch(/^Plan/)
    }
  })

  it('honnêteté : ne lit jamais fight.events, ne touche pas aux dés du combat réel', () => {
    const s = setup({ meta: true, seed: 4 })
    turnOf(s, s.players[1], 1)
    const rng = s.fight.rngState
    Object.defineProperty(s.fight, 'events', { get: () => { throw new Error('lecture de fight.events') }, configurable: true })
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    expect(() => update(model, s, 'standard')).not.toThrow()
    expect(s.fight.rngState).toBe(rng)
  })

  it('damageWeight / extraIncoming / allyDeathExtra : contrat avec V(s)', () => {
    const s = setup({ seed: 2 })
    turnOf(s, s.players[0], 2)
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    const bb = update(model, s, 'standard')
    const vx = vortexState(s.fight)!
    const vortex = s.fight.fighters[vx.vortexId]
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    expect(model.damageWeight(vortex, bb)).toBe(0) // Marginal, phase 1
    expect(model.damageWeight(ika, bb)).toBe(bb.prices.hp.get(ika.id)!.slope)
    expect(model.damageWeight(s.players[1], bb)).toBeUndefined()
    // Croix de l'Auroraire : même valeur que le modèle de base en phase 1.
    const base = basicVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    base.update(createView(s.engine, s.fight, s.players[0], 7), emptyBlackboard(), {} as never, 'fast')
    const slots = forecastHours(s.fight, 2, VORTEX_DEFAULT_PARAMS)
    const vh = slots[nextVortexSlot(slots, 1)].hour
    const onLine = Array.from(lineCells(vh)).find(c => s.fight.map.cells[c]?.walkable)!
    expect(model.extraIncoming(s.fight, s.players[0], onLine)).toBe(base.extraIncoming!(s.fight, s.players[0], onLine))
    expect(model.extraIncoming(s.fight, s.players[0], onLine)).toBeGreaterThan(0)
    // Coût « horloge » de la mort d'un allié : fini, positif, plafonné.
    for (const p of s.players) {
      const v = model.allyDeathExtra(s.fight, p)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(4000)
    }
    expect(Math.max(...s.players.map(p => model.allyDeathExtra(s.fight, p)))).toBeGreaterThan(0)
  })

  it('deathValue : heure LUE sur la victime (mort simulée), étoile ⇒ prix de corruption, Vortex ⇒ victoire', () => {
    const s = setup({ seed: 5 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    let bb = update(model, s, 'fast')
    // Mort simulée à l'heure courante (I) : prix kill[m][I].
    const leaf = s.engine.cloneFight(s.fight, false)
    s.engine.kill(leaf, leaf.fighters[ika.id], leaf.fighters[p1.id])
    expect(currentHour(leaf)).toBe(1)
    expect(model.deathValue(s.fight, leaf, leaf.fighters[ika.id], bb)).toBe(bb.prices.kill.get(ika.id)![1])
    // Vraie mort à I, résurrection, retour de I au tour 4 : étoile ⇒ la mort vaut kill[m][0].
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, p1, 4)
    expect(hasStar(ika)).toBe(true)
    bb = update(model, s, 'fast')
    const leaf2 = s.engine.cloneFight(s.fight, false)
    s.engine.kill(leaf2, leaf2.fighters[ika.id], leaf2.fighters[p1.id])
    expect(model.deathValue(s.fight, leaf2, leaf2.fighters[ika.id], bb)).toBe(bb.prices.kill.get(ika.id)![0])
    expect(bb.prices.kill.get(ika.id)![0]).toBeGreaterThanOrEqual(theta.vortex.corruptKill)
    const vortex = s.fight.fighters[vortexState(s.fight)!.vortexId]
    expect(model.deathValue(s.fight, leaf2, vortex, bb)).toBe(theta.vortex.vortexKill)
    // Décision clé « corruption » cohérente avec le plan : contrat de corruption au créneau courant pour P1.
    const view = createView(s.engine, s.fight, p1, 7)
    const plan = vortexPlanOf(bb)
    const corruptNow = plan?.kind === 'hours' && plan.plan.contracts.some(c => c.kind === 'corrupt' && c.killer === p1.id && c.round === s.fight.round && c.index === plan.plan.steps[0].index)
    const reason = model.isKeyDecision(view, bb)
    if (corruptNow && reason !== 'waveArrival' && reason !== 'phaseChange') expect(reason).toBe('corruptionKill')
  })
})

describe('PL7 — tout corrompu au tour 18 : phase waiting, aucun contrat, cases hors lignes', () => {
  it('phase waiting, prix de kill vides, croix de l’Auroraire évitée', () => {
    const s = setup({ seed: 7 })
    turnOf(s, s.players[0], 18)
    for (const m of s.fight.fighters) {
      if (!isWaveMonster(m) || !m.alive) continue
      s.engine.addBuff(s.fight, m, {
        sourceId: m.id, spellId: SPELL.GLYPHE_TELEPORTEUR, value: CORRUPTED, remaining: -1, delay: 0, dispellable: false,
        stateId: CORRUPTED, passTurn: true, kind: 'stat', label: 'corrompu (test)',
        effect: { effectId: 950, order: 0, diceNum: 0, diceSide: 0, value: CORRUPTED, duration: -1, delay: 0, random: 0, group: 0, targetMask: '', targetId: 0, triggers: 'I', dispellable: 4, element: -1, zone: { shape: 'P', size: 0, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false } },
      })
    }
    for (const m of s.fight.fighters) if (isWaveMonster(m) && !m.alive) m.states = [...m.states, CORRUPTED]
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    const bb = update(model, s, 'standard')
    expect(bb.phase).toBe('waiting')
    const plan = vortexPlanOf(bb)
    expect(plan?.kind === 'hours' && plan.plan.contracts.length).toBe(0)
    expect(bb.prices.kill.size).toBe(0)
    expect(model.explain()).toMatch(/Attente/)
    // Le joueur courant ne rejoue pas avant le Vortex : la croix de l'Auroraire à son créneau est dangereuse.
    const me = s.engine.current(s.fight)!
    const slots = forecastHours(s.fight, 2, VORTEX_DEFAULT_PARAMS)
    const vh = slots[nextVortexSlot(slots, 1)].hour
    const onLine = Array.from(lineCells(vh)).find(c => s.fight.map.cells[c]?.walkable && !s.fight.fighters.some(f => f.alive && f.cell === c))!
    const off = s.fight.map.cells.findIndex((c, i) => c.walkable && !onHourLine(vh, i) && i !== HOUR_CELL[vh])
    expect(model.extraIncoming(s.fight, me, onLine)).toBeGreaterThan(0)
    expect(model.extraIncoming(s.fight, me, off)).toBe(0)
    const avoid = model.hints(createView(s.engine, s.fight, me, 7), me, bb).find(h => h.kind === 'avoidCells')
    expect(avoid?.cells).toContain(onLine)
    // Aucune case n'est « payée » pour finir dessus.
    for (const v of bb.prices.cell ?? []) expect(v).toBeLessThanOrEqual(0)
  })
})

describe('burst de phase 2 (§12.9)', () => {
  function phase2(): Setup {
    const engine = createEngine(data, vortexHooks)
    const players = buildTeam(data, parseTeam(META, data))
    const fight = createPhase2Fight(engine, players, { params: { ...VORTEX_DEFAULT_PARAMS, phase2Hours: [2, 7, 10] }, seed: 5, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    return { engine, fight, players }
  }

  it('préparation : Vortex invulnérable, vulnérable après son tour ; intentions burst / position / réserve ; cases sûres', () => {
    const s = phase2()
    const cur = s.engine.nextTurn(s.fight)!
    const first = cur.kind === 'player' ? cur : (turnOf(s, s.players[0], 1), s.engine.current(s.fight)!)
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    const bb = update(model, s, 'standard')
    expect(bb.phase).toBe('transition')
    const b = model.lastBurst!
    expect(b).toBeDefined()
    // Vulnérable au premier créneau JOUEUR après le prochain tour du Vortex.
    const slots = forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS).filter(x => x.index >= 0)
    const v = nextVortexSlot(slots, 1)
    const after = slots.slice(v + 1).find(x => x.isPlayer)!
    expect(b.vulnerableFrom).toEqual({ round: after.round, index: after.index })
    expect(b.pKill).toBeGreaterThanOrEqual(0)
    expect(b.pKill).toBeLessThanOrEqual(b.pKill2 + 1e-9)
    expect(b.hp).toBe(15000) // Vortex de rang 1 à 4 personnages
    expect(b.mean).toBeGreaterThan(0)
    const owners = new Set(bb.intents.filter(i => i.kind === 'burst').map(i => i.owner))
    for (const p of s.players) expect(owners.has(p.id)).toBe(true)
    expect(bb.intents.every(i => i.source === 'burst' && i.price >= 0)).toBe(true)
    expect(bb.prices.kill.size).toBe(0) // invulnérable : pas de prix de kill pendant la préparation
    expect(vortexPlanOf(bb)?.kind).toBe('burst')
    expect(model.damageWeight(s.fight.fighters[vortexState(s.fight)!.vortexId], bb)).toBe(0)
    // Cases sûres : hors des lignes ≤ 8 de la case prévue du Vortex.
    const safe = b.safeCells(after.round, after.index)
    for (let c = 0; c < safe.length; c++) if (safe[c]) expect(s.fight.map.cells[c].walkable).toBe(true)
    const vc = b.vortexCell
    const ref = safeCellsFor(s.fight, [vc], 0)
    const walk = (c: number) => s.fight.map.cells[c]?.walkable === true
    const aligned = s.fight.map.cells.findIndex((_, c) => walk(c) && c !== vc && (CELL_X[c] === CELL_X[vc] || CELL_Y[c] === CELL_Y[vc]) && distance(c, vc) <= 8)
    const far = s.fight.map.cells.findIndex((_, c) => walk(c) && CELL_X[c] !== CELL_X[vc] && CELL_Y[c] !== CELL_Y[vc])
    expect(ref[aligned]).toBe(0)
    expect(ref[far]).toBe(1)
    void first
  })

  it('fenêtre de burst : prix du Vortex = victoire, pente ≥ 1, décision clé « burst » pendant la première fenêtre seulement', () => {
    const s = phase2()
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    const vortex = s.fight.fighters[vortexState(s.fight)!.vortexId]
    const reasons: (string | null)[] = []
    let bursts = 0
    for (let i = 0; i < 40 && !s.fight.ended && s.fight.round <= 3; i++) {
      const cur = s.engine.nextTurn(s.fight)
      if (!cur) break
      if (cur.kind === 'player') {
        const bb = update(model, s, 'fast')
        if (bb.phase === 'burst') {
          bursts++
          expect(bb.prices.kill.get(vortex.id)![1]).toBe(theta.vortex.vortexKill)
          expect(model.damageWeight(vortex, bb)).toBeGreaterThanOrEqual(1)
          expect(model.deathValue(s.fight, s.fight, vortex, bb)).toBe(theta.vortex.vortexKill)
          reasons.push(model.isKeyDecision(createView(s.engine, s.fight, cur, 7), bb))
        }
      }
      if (cur.alive && !s.fight.ended) s.engine.endTurn(s.fight, cur)
    }
    expect(bursts).toBeGreaterThan(3)
    expect(reasons).toContain('burst')
    expect(reasons[reasons.length - 1]).toBeNull()
  })

  it('planBurst hors combat du Vortex ou Vortex mort : undefined', () => {
    const s = phase2()
    const p = s.engine.nextTurn(s.fight)!
    const vortex = s.fight.fighters[vortexState(s.fight)!.vortexId]
    s.engine.kill(s.fight, vortex)
    expect(planBurst(createView(s.engine, s.fight, p, 1), { theta, params: VORTEX_DEFAULT_PARAMS })).toBeUndefined()
  })
})

describe('placement, enregistrement, robustesse', () => {
  it('choosePlacement : analytique = classement de rankVortexPlacements ; simulé = un des candidats (prefix12)', () => {
    const s = setup({ meta: true })
    const team = buildTeam(data, parseTeam(META, data))
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta, { placementCandidates: 2, placementSeeds: 1 })
    const analytic = model.choosePlacement(team, {} as never, 'analytic')
    expect(analytic).toEqual(rankVortexPlacements(team, { ...VORTEX_DEFAULT_PARAMS, players: 4 }, { top: 1 })[0].cells)
    expect(new Set(analytic).size).toBe(4)
    for (const c of analytic) expect(RED_START_CELLS).toContain(c)
    const view = createView(s.engine, s.fight, s.players[0], 1)
    const perception = createPerception(view, { theta })
    const ranked = rankVortexPlacements(team, { ...VORTEX_DEFAULT_PARAMS, players: 4 }, { top: 2 }).map(r => r.cells)
    const simulated = model.choosePlacement(team, perception, 'simulated')
    expect(ranked.map(c => c.join(','))).toContain(simulated.join(','))
  })

  it('import du modèle ⇒ vortexScenario.aiModel renvoie le modèle complet ; perception factice tolérée', () => {
    const m = vortexScenario.aiModel(VORTEX_DEFAULT_PARAMS, theta)
    expect(m).toBeInstanceOf(VortexAIModel)
    const s = setup({ seed: 9 })
    turnOf(s, s.players[2], 1)
    const bb = emptyBlackboard()
    expect(() => m.update(createView(s.engine, s.fight, s.players[2], 1), bb, {} as never, 'fast')).not.toThrow()
    expect(bb.prices.kill.size).toBeGreaterThan(0)
    expect(m.roleNeeds?.()).toMatchObject({ killer: 2, mpLock: 1 })
  })

  it('combat passif de 20 tours : mise à jour à chaque tour de joueur sans erreur, versions croissantes, snapshot/restore', () => {
    const s = setup({ seed: 11 })
    const model = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    let lastVersion = -1
    let updates = 0
    for (let i = 0; i < 400 && s.fight.round <= 20 && !s.fight.ended; i++) {
      const cur = s.engine.nextTurn(s.fight)
      if (!cur) break
      if (cur.kind === 'player') {
        const bb = update(model, s, 'fast')
        updates++
        const plan = vortexPlanOf(bb)
        if (plan?.kind === 'hours') {
          expect(plan.plan.version).toBeGreaterThanOrEqual(lastVersion)
          lastVersion = plan.plan.version
        }
        for (const id of bb.prices.kill.keys()) expect(s.fight.fighters[id].alive).toBe(true)
      }
      if (cur.alive) s.engine.endTurn(s.fight, cur)
    }
    expect(updates).toBeGreaterThan(60)
    expect(s.fight.fighters.some(f => isWaveMonster(f) && f.wave === 4)).toBe(true)
    const snap = model.snapshot()
    const other = createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
    other.restore(snap)
    expect(other.snapshot()).toEqual(snap)
    expect(s.fight.fighters.find(f => f.monsterId === VORTEX)!.alive).toBe(true)
  })
})
