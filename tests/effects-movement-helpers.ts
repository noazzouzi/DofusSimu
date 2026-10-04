/**
 * Outils des tests de la famille « déplacements » : données réelles (loadDataStore), carte ouverte synthétique
 * (avec obstacles optionnels), combattants, espion de déclencheurs.
 */
import { emptyStats, type Stats, type TeamId } from '../src/core/types'
import type { EffectData, MapData } from '../src/data/model'
import { loadDataStore, type NodeDataStore } from '../src/data/node'
import { installEffectCore } from '../src/engine/effects/core'
import { installMovement } from '../src/engine/effects/movement'
import { registerEffect } from '../src/engine/effects/registry'
import { Engine } from '../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightEvent, FightOptions, FightState } from '../src/engine/types'
import { CELL_COUNT, pointToCell } from '../src/map/geometry'

let store: NodeDataStore | undefined
export function data(): NodeDataStore {
  return (store ??= loadDataStore())
}

/** Carte entièrement marchable ; `walls` = cases non marchables (et opaques). */
export function openMap(walls: readonly number[] = []): MapData {
  return {
    id: 0,
    cells: Array.from({ length: CELL_COUNT }, (_, id) => ({ id, walkable: !walls.includes(id), los: !walls.includes(id), placement: 0 as const })),
  }
}

/** Case aux coordonnées logiques (x, y). */
export function cellAt(x: number, y: number): number {
  const c = pointToCell(x, y)
  if (c < 0) throw new Error(`case invalide (${x}, ${y})`)
  return c
}

export function newEngine(install: (engine: Engine) => void = () => {}): Engine {
  const engine = new Engine(data())
  installEffectCore(engine)
  installMovement(engine)
  install(engine)
  return engine
}

export interface PlayerSpec {
  name?: string
  breedId: number
  spellIds?: number[]
  team?: TeamId
  cell: number
  stats?: Partial<Stats>
  hp?: number
  level?: number
}

export function player(spec: PlayerSpec): Fighter {
  const stats: Stats = { ...emptyStats(), ap: 12, mp: 6, ...spec.stats }
  return createPlayerFighter(data(), {
    name: spec.name ?? `Joueur ${spec.breedId}`,
    breedId: spec.breedId,
    level: spec.level ?? 200,
    stats,
    maxHp: spec.hp ?? 5000,
    spellIds: spec.spellIds ?? [],
    team: spec.team ?? 0,
    cell: spec.cell,
  })
}

export function monster(monsterId: number, cell: number, opts: { grade?: number; team?: TeamId } = {}): Fighter {
  return createMonsterFighter(data(), { monsterId, grade: opts.grade ?? 1, team: opts.team ?? 1, cell })
}

/** Combat démarré (premier tour lancé : cases de début de combat enregistrées). */
export function fight(engine: Engine, fighters: Fighter[], opts: { walls?: number[]; map?: MapData; options?: Partial<FightOptions> } = {}): FightState {
  const fs = engine.createFight({ map: opts.map ?? openMap(opts.walls), fighters, options: { record: true, ...opts.options } })
  engine.nextTurn(fs)
  return fs
}

/** Effet synthétique minimal (zone point). */
export function effect(effectId: number, over: Partial<EffectData> = {}): EffectData {
  return {
    effectId,
    order: 0,
    diceNum: 0,
    diceSide: 0,
    value: 0,
    duration: 0,
    delay: 0,
    random: 0,
    group: 0,
    targetMask: 'a,A',
    targetId: 0,
    triggers: 'I',
    dispellable: 1,
    element: -1,
    zone: { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false },
    ...over,
  }
}

/** Pose un état (buff permanent) sur un combattant. */
export function giveState(engine: Engine, fs: FightState, f: Fighter, stateId: number): void {
  engine.addBuff(fs, f, {
    sourceId: f.id,
    spellId: 0,
    effect: effect(950, { value: stateId, duration: -1 }),
    value: stateId,
    remaining: -1,
    delay: 0,
    dispellable: false,
    stateId,
    kind: 'stat',
    label: `État ${stateId}`,
  })
}

// ───────────────────────────── espion de déclencheurs ─────────────────────────────

/** Effet factice dont le gestionnaire enregistre ses déclenchements (événement + porteur). */
export const SPY_EFFECT = 990_001
export const spyCalls: { holder: number; type: string; source?: number }[] = []
registerEffect(SPY_EFFECT, 'test', ctx => {
  spyCalls.push({ holder: ctx.targets[0]?.id ?? -1, type: ctx.trigger?.type ?? '', source: ctx.trigger?.source?.id })
})

/** Pose sur `f` un buff déclencheur (codes `triggers`, ex. 'P', 'MA|MS') qui alimente `spyCalls`. */
export function spy(engine: Engine, fs: FightState, f: Fighter, triggers: string): void {
  engine.addBuff(fs, f, {
    sourceId: f.id,
    spellId: 0,
    effect: effect(SPY_EFFECT, { triggers }),
    value: 0,
    remaining: -1,
    delay: 0,
    dispellable: false,
    triggers,
    kind: 'trigger',
    label: `espion ${triggers}`,
  })
}

export function events<T extends FightEvent['t']>(fs: FightState, t: T): Extract<FightEvent, { t: T }>[] {
  return fs.events.filter((e): e is Extract<FightEvent, { t: T }> => e.t === t)
}

/** Dommages de poussée reçus par `target` (événements `damage` kind 'push'). */
export function pushDamageTaken(fs: FightState, target: Fighter): number[] {
  return events(fs, 'damage')
    .filter(e => e.target === target.id && e.kind === 'push')
    .map(e => e.amount)
}
