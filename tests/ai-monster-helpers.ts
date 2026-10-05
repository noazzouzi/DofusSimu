/**
 * Aides des tests de l'IA des monstres (tests/ai-monster-*.test.ts, docs/design/ai.md §16.2) : vraies données
 * (`loadDataStore`), vraie carte de l'Œil de Vortex (143393281), vrais sorts et vrais monstres. Configuration de l'IA
 * construite sans passer par src/ai/index.ts (les lots WP2 en cours ne doivent pas casser ces tests).
 */
import { fightAISeed } from '../src/ai/core/rng'
import { createMonsterBrain, type MonsterBrain } from '../src/ai/monster'
import { loadTheta, type ThetaJson } from '../src/ai/theta'
import type { AIConfig, MonsterSetting, TurnBudget } from '../src/ai/types'
import type { TeamId } from '../src/core/types'
import type { EffectData } from '../src/data/model'
import { createEngine, type Engine } from '../src/engine'
import type { Buff, Fighter, FightEvent, FightState } from '../src/engine/types'
import { distance, pointToCell } from '../src/map/geometry'
import { BREEDS, data, makeFight, monster, player, THL, VORTEX_MAP, type PlayerOpts } from './ai-core-helpers'

export { BREEDS, data, monster, player, THL, VORTEX_MAP }

export const IKARGN = 3834
export const VORTEX = 3835
export const MEJAIRE = 3836
export const HARPILLE = 3837
export const BUBOXOR = 3838
export const BRABUZAR = 3839
export const AURORAIRE = 3833

const THETA = loadTheta()
const NO_BUDGET: TurnBudget = {
  maxNodes: 0, width: 0, topK: 0, maxDepth: 0, endCells: 0, rollouts: 0, pessimism: 0, keyDecisionBoost: 1, maxKeyDecisions: 0,
  mctsIterations: 0, maxReplans: 0, replanFraction: 0,
  quotas: { damage: 0, control: 0, placement: 0, heal: 0, buff: 0, summon: 0, mark: 0, utility: 0 }, mandatoryMax: 0,
}

/** Configuration de l'IA (θ par défaut, graine de combat `seed`) ; l'IA des monstres ne dépend pas du mode. */
export function monsterCfg(seed = 1, o: { theta?: ThetaJson; noiseTau?: number; explain?: boolean } = {}): AIConfig {
  const theta = o.theta ?? THETA
  const m = theta.monster
  return {
    mode: 'fast',
    budget: NO_BUDGET,
    theta,
    monster: { topK: m.topK, predictTopK: m.predictTopK, noiseTau: o.noiseTau ?? m.noiseTau, referenceTopK: m.referenceTopK },
    seed: fightAISeed(seed),
    explain: o.explain ?? false,
    unsupportedSpells: 'skip',
  }
}

export function brain(setting: MonsterSetting = 'play', seed = 1, o: { noiseTau?: number; explain?: boolean } = {}): MonsterBrain {
  return createMonsterBrain(monsterCfg(seed, o), setting)
}

/** Case de la carte du Vortex aux coordonnées (x, y) (MapPoint) ; erreur si hors carte ou non marchable. */
export function at(x: number, y: number): number {
  const c = pointToCell(x, y)
  const m = data.map(VORTEX_MAP)!
  if (c < 0 || !m.cells[c]?.walkable) throw new Error(`case (${x}, ${y}) non marchable`)
  return c
}

export interface SceneSpec {
  players?: { breed: number; cell: number; extra?: PlayerOpts['extra']; name?: string; hp?: number }[]
  monsters?: { id: number; cell: number; grade?: number; team?: TeamId }[]
  seed?: number
  record?: boolean
  rollMode?: 'random' | 'average' | 'min' | 'max'
  engine?: Engine
}

export interface Scene {
  engine: Engine
  fight: FightState
  players: Fighter[]
  monsters: Fighter[]
}

/**
 * Combat sur la vraie carte du Vortex, moteur nu (aucun scénario) : personnages THL (équipe 0) et monstres (équipe 1)
 * aux cases données. Aucun tour n'est commencé.
 */
export function scene(spec: SceneSpec): Scene {
  const engine = spec.engine ?? createEngine(data)
  const players = (spec.players ?? []).map((p, i) => {
    const f = player(p.breed, { cell: p.cell, extra: p.extra ?? THL, name: p.name ?? `${data.breed(p.breed)?.name}${i}` })
    if (p.hp !== undefined) f.hp = f.maxHp = f.baseMaxHp = p.hp
    return f
  })
  const monsters = (spec.monsters ?? []).map(m => monster(m.id, m.cell, m.grade ?? 5, m.team ?? 1))
  const fight = makeFight(engine, VORTEX_MAP, [...players, ...monsters], { seed: spec.seed ?? 1, rollMode: 'random', record: spec.record ?? true })
  fight.options.rollMode = spec.rollMode ?? 'random'
  return { engine, fight, players: players.map(p => fight.fighters[p.id] ?? p), monsters: monsters.map(m => fight.fighters[m.id] ?? m) }
}

/** Avance (sans jouer) jusqu'au début du tour de `f` (au tour de jeu `round` au moins). */
export function turnOf(engine: Engine, fight: FightState, f: Fighter, round = 1): void {
  for (let i = 0; i < 400; i++) {
    const cur = engine.current(fight)
    if (cur && cur.id === f.id && fight.round >= round && fight.round > 0) return
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    if (!engine.nextTurn(fight)) break
  }
  throw new Error(`tour de ${f.name} jamais atteint`)
}

/** Événements émis depuis l'indice `from`. */
export function eventsSince(fight: FightState, from: number): FightEvent[] {
  return fight.events.slice(from)
}

/** Lancers (sort, case) des événements. */
export function casts(evs: FightEvent[]): { spellId: number; cell: number; fighter: number }[] {
  const out: { spellId: number; cell: number; fighter: number }[] = []
  for (const e of evs) if (e.t === 'cast') out.push({ spellId: e.spellId, cell: e.cell, fighter: e.fighter })
  return out
}

/** Joue le tour de `me` avec le cerveau `b` et renvoie les événements émis. */
export function playTurn(b: MonsterBrain, s: Scene, me: Fighter): FightEvent[] {
  const n = s.fight.events.length
  b.playTurn(s.engine, s.fight, me)
  return eventsSince(s.fight, n)
}

const ZONE_P = { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false, includeCarried: true, onlyIfInSight: false, forcedDirection: false }

/** Effet factice d'état (950) pour poser un état par buff. */
export function stateEffect(stateId: number, duration = -1): EffectData {
  return {
    effectId: 950, order: 0, diceNum: 0, diceSide: 0, value: stateId, duration, delay: 0, random: 0, group: 0, targetMask: 'a,A',
    targetId: 0, triggers: 'I', dispellable: 1, element: -1, zone: { ...ZONE_P },
  }
}

/** Pose un état (buff de `remaining` tours, −1 = permanent) sur `f`. */
export function addState(engine: Engine, fight: FightState, f: Fighter, stateId: number, remaining = -1, extra: Partial<Buff> = {}): Buff {
  return engine.addBuff(fight, f, {
    sourceId: f.id, spellId: 0, effect: stateEffect(stateId, remaining), value: stateId, remaining, delay: 0, dispellable: true,
    stateId, kind: 'stat', label: `état ${stateId}`, ...extra,
  })
}

/** Ajoute une caractéristique permanente (buff) à `f`. */
export function addStat(engine: Engine, fight: FightState, f: Fighter, stat: string, value: number, remaining = -1): Buff {
  return engine.addBuff(fight, f, {
    sourceId: f.id, spellId: 0, effect: { ...stateEffect(0, remaining), effectId: 111 }, value, remaining, delay: 0, dispellable: true,
    statDelta: { [stat]: value }, kind: 'stat', label: `+${value} ${stat}`,
  })
}

export function dist(a: number, b: number): number {
  return distance(a, b)
}
