/**
 * Outils des tests des familles « invocations », « marques » et « lancements de sorts » : données réelles
 * (loadDataStore), toutes les familles d'effets disponibles (import.meta.glob), carte ouverte ou carte du Vortex.
 */
import { emptyStats, type Stats, type TeamId } from '../src/core/types'
import type { EffectData, MapData, ZoneSpec } from '../src/data/model'
import { loadDataStore, type NodeDataStore } from '../src/data/node'
import { installEffectCore } from '../src/engine/effects/core'
import { installMarks } from '../src/engine/effects/marks'
import { getEffectHandler } from '../src/engine/effects/registry'
import { Engine } from '../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightOptions, FightState } from '../src/engine/types'
import { pointToCell } from '../src/map/geometry'

// Toutes les familles d'effets présentes (enregistrement par effet de bord à l'import).
import.meta.glob('../src/engine/effects/**/*.ts', { eager: true })

let store: NodeDataStore | undefined
export function data(): NodeDataStore {
  return (store ??= loadDataStore())
}

/** Carte entièrement marchable, sans obstacle. */
export function openMap(): MapData {
  return { id: 0, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }
}

/** Salle des heures perdues (Œil de Vortex). */
export function vortexMap(): MapData {
  const m = data().map(143393281)
  if (!m) throw new Error('carte 143393281 absente')
  return m
}

export const cellAt = (x: number, y: number): number => pointToCell(x, y)

/** Un interprète est-il enregistré pour cet effet (famille éventuellement absente) ? */
export const has = (effectId: number): boolean => getEffectHandler(effectId) !== undefined

export function newEngine(): Engine {
  const engine = new Engine(data())
  installEffectCore(engine)
  installMarks(engine)
  return engine
}

export interface PlayerSpec {
  name?: string
  breedId: number
  spellIds: number[]
  team?: TeamId
  cell: number
  stats?: Partial<Stats>
  hp?: number
  level?: number
}

export function player(spec: PlayerSpec): Fighter {
  const stats: Stats = { ...emptyStats(), ap: 12, mp: 6, summons: 1, ...spec.stats }
  return createPlayerFighter(data(), {
    name: spec.name ?? `Joueur ${spec.breedId}`,
    breedId: spec.breedId,
    level: spec.level ?? 200,
    stats,
    maxHp: spec.hp ?? 3000,
    spellIds: spec.spellIds,
    team: spec.team ?? 0,
    cell: spec.cell,
  })
}

export function monster(monsterId: number, cell: number, opts: { grade?: number; team?: TeamId; initiative?: number } = {}): Fighter {
  const f = createMonsterFighter(data(), { monsterId, grade: opts.grade ?? 1, team: opts.team ?? 1, cell })
  if (opts.initiative !== undefined) f.baseStats.initiative = opts.initiative
  return f
}

export function fight(engine: Engine, fighters: Fighter[], options: Partial<FightOptions> = {}, map: MapData = openMap()): FightState {
  return engine.createFight({ map, fighters, options: { record: true, ...options } })
}

/** Avance jusqu'au DÉBUT du tour de `f` (les tours intermédiaires sont passés sans action). */
export function turnOf(engine: Engine, fs: FightState, f: Fighter, guard = 60): void {
  let cur = engine.current(fs)
  for (let i = 0; i < guard; i++) {
    if (cur && fs.round > 0 && cur.alive) engine.endTurn(fs, cur)
    cur = engine.nextTurn(fs)
    if (!cur || cur.id === f.id) return
  }
  throw new Error(`tour de ${f.name} jamais atteint`)
}

const POINT: ZoneSpec = { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false }

/** Effet synthétique (instantané, zone P1 par défaut). */
export function effect(effectId: number, p: Partial<EffectData> = {}): EffectData {
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
    zone: POINT,
    ...p,
  }
}

export function zone(shape: string, size = 1, minSize = 0): ZoneSpec {
  return { ...POINT, shape, size, minSize }
}
