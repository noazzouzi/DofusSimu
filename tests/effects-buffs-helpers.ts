/**
 * Outils des tests de la famille « buffs » : données réelles (loadDataStore), carte ouverte synthétique,
 * combattants joueurs / monstres et effets synthétiques.
 */
import { emptyStats, type Stats, type TeamId } from '../src/core/types'
import type { EffectData, MapData } from '../src/data/model'
import { loadDataStore, type NodeDataStore } from '../src/data/node'
import { applyEffects, installEffectCore } from '../src/engine/effects/core'
import '../src/engine/effects/buffs'
import { Engine } from '../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightOptions, FightState } from '../src/engine/types'
import { pointToCell } from '../src/map/geometry'

let store: NodeDataStore | undefined
export function data(): NodeDataStore {
  return (store ??= loadDataStore())
}

/** Carte entièrement marchable, sans obstacle. */
export function openMap(): MapData {
  return {
    id: 0,
    cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })),
  }
}

/** Case aux coordonnées (x, y) de la carte (cf. src/map/geometry.ts). */
export const cellAt = (x: number, y: number): number => pointToCell(x, y)

export function newEngine(): Engine {
  const engine = new Engine(data())
  installEffectCore(engine)
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
  const stats: Stats = { ...emptyStats(), ap: 12, mp: 6, ...spec.stats }
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

export function fight(engine: Engine, fighters: Fighter[], options: Partial<FightOptions> = {}): FightState {
  return engine.createFight({ map: openMap(), fighters, options: { record: true, ...options } })
}

/** Avance jusqu'au tour de `f` (joue les tours intermédiaires sans action). */
export function turnOf(engine: Engine, fs: FightState, f: Fighter, guard = 50): void {
  let cur = engine.current(fs)
  for (let i = 0; i < guard; i++) {
    if (cur && fs.round > 0) engine.endTurn(fs, cur)
    cur = engine.nextTurn(fs)
    if (!cur || cur.id === f.id) return
  }
  throw new Error(`tour de ${f.name} jamais atteint`)
}

/** Termine le tour courant et passe au suivant ; renvoie le nouveau combattant actif. */
export function next(engine: Engine, fs: FightState): Fighter | undefined {
  const cur = engine.current(fs)
  if (cur && fs.round > 0) engine.endTurn(fs, cur)
  return engine.nextTurn(fs)
}

/** Effet synthétique (champs DofusDB minimaux). */
export function effect(effectId: number, patch: Partial<EffectData> = {}): EffectData {
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
    zone: { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
    ...patch,
  }
}

/** Applique des effets synthétiques de `caster` sur la case de `target` (sort fictif `spellId`). */
export function apply(engine: Engine, fs: FightState, caster: Fighter, target: Fighter, effects: EffectData[], spellId = 999001): void {
  applyEffects(engine, fs, caster, null, spellId, effects, target.cell, caster.cell, false, false, 0)
}
