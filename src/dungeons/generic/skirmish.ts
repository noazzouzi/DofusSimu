/**
 * Scénario générique « escarmouche » (docs/design/ai.md §16.5, combats de contrôle) — WP3 : n'importe quels monstres
 * sur n'importe quelle carte, sans règle serveur (fin de combat par défaut du moteur : une équipe entièrement morte).
 *
 * Paramètres (plats) : `mapId` (défaut : Cour du Bouftou Royal, 1re salle), `monsterIds` (défaut : 4 Bouftous 101),
 * `monsterGrades` (grade par monstre, le dernier se répète ; défaut 5), `monsterCells` / `playerCells` (défaut : cases
 * bleues / rouges de la carte, placement générique), `startingTeamRule` ('best' = règle du moteur, défaut),
 * `castStartingSpells` (défaut vrai), `maxRounds` (60).
 */
import type { StrategyParams } from '../../ai/types'
import { createGenericModel } from '../../ai/team/genericModel'
import type { Engine } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { MapData } from '../../data/model'
import type { Fighter, FightState, ScenarioHooks } from '../../engine/types'
import type { DungeonScenario, FightSetupOptions, ScenarioParams, ScenarioSummary } from '../types'
import { genericPlacement } from '../vortex/placement'
import { castStartingSpell } from '../../engine/effects/summons'
import { hasStartingSpell, pickFreeCells, rebuildTimeline, type StartingTeamRule } from '../waves'

export const SKIRMISH_SCENARIO_ID = 'skirmish'
/** « Cour du Bouftou Royal - Première salle » (8 cases rouges, 8 bleues). */
export const SKIRMISH_DEFAULT_MAP = 121373185
/** Bouftou (101), niveau 30 au grade 5. */
export const BOUFTOU = 101

export interface SkirmishParams {
  mapId: number
  monsterIds: readonly number[]
  monsterGrades: readonly number[]
  monsterCells: readonly number[]
  playerCells: readonly number[]
  startingTeamRule: StartingTeamRule
  castStartingSpells: boolean
  maxRounds: number
}

export const SKIRMISH_DEFAULT_PARAMS: Readonly<SkirmishParams> = {
  mapId: SKIRMISH_DEFAULT_MAP,
  monsterIds: [BOUFTOU, BOUFTOU, BOUFTOU, BOUFTOU],
  monsterGrades: [5],
  monsterCells: [],
  playerCells: [],
  startingTeamRule: 'best',
  castStartingSpells: true,
  maxRounds: 60,
}

const numArr = (v: unknown, def: readonly number[]): readonly number[] =>
  Array.isArray(v) && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v.slice() : def.slice()

export function resolveSkirmishParams(params: ScenarioParams | Partial<SkirmishParams> = {}): SkirmishParams {
  const r = params as Record<string, unknown>
  const d = SKIRMISH_DEFAULT_PARAMS
  const p: SkirmishParams = {
    mapId: typeof r.mapId === 'number' ? r.mapId : d.mapId,
    monsterIds: numArr(r.monsterIds, d.monsterIds),
    monsterGrades: numArr(r.monsterGrades, d.monsterGrades),
    monsterCells: numArr(r.monsterCells, d.monsterCells),
    playerCells: numArr(r.playerCells, d.playerCells),
    startingTeamRule: r.startingTeamRule === 'average' ? 'average' : d.startingTeamRule,
    castStartingSpells: typeof r.castStartingSpells === 'boolean' ? r.castStartingSpells : d.castStartingSpells,
    maxRounds: typeof r.maxRounds === 'number' && r.maxRounds >= 1 ? r.maxRounds : d.maxRounds,
  }
  if (!p.monsterIds.length) throw new Error('Escarmouche : au moins un monstre (monsterIds)')
  return p
}

/** Cases de départ d'une carte : rouges/bleues des données, sinon moitiés gauche/droite des cases marchables. */
export function startCellsOf(map: MapData): { red: number[]; blue: number[] } {
  if (map.redCells?.length && map.blueCells?.length) return { red: map.redCells.slice(), blue: map.blueCells.slice() }
  const walk = map.cells.filter(c => c.walkable).map(c => c.id)
  const half = Math.floor(walk.length / 2)
  return { red: walk.slice(0, half), blue: walk.slice(half).reverse() }
}

/** Place l'équipe et des monstres sur une carte puis crée le combat (base commune escarmouche / mannequin). */
export function createGenericFight(
  engine: Engine,
  team: Fighter[],
  o: FightSetupOptions,
  setup: { map: MapData; monsters: Fighter[]; monsterCells: readonly number[]; playerCells: readonly number[]; scenarioId: string; maxRounds: number; rule: StartingTeamRule; startingSpells: boolean },
): FightState {
  const { red, blue } = startCellsOf(setup.map)
  const mCells = setup.monsterCells.length ? setup.monsterCells.slice() : blue
  const placement = o.placement ?? (setup.playerCells.length ? setup.playerCells.slice() : genericPlacement(red.filter(c => !mCells.includes(c)), mCells, team.length))
  if (placement.length < team.length) throw new Error(`Placement incomplet : ${placement.length} case(s) pour ${team.length} personnage(s)`)
  team.forEach((f, i) => {
    f.team = 0
    f.cell = placement[i]
    f.tags.startCell = f.cell
  })
  // Cases des monstres : libres, hors cases des personnages (repli sur les plus proches).
  const taken = new Set(placement.slice(0, team.length))
  const probe = { map: setup.map, fighters: team } as unknown as FightState
  const cells = pickFreeCells(engine, probe, mCells, setup.monsters.length, taken)
  setup.monsters.forEach((m, i) => {
    m.team = 1
    m.cell = cells[i] ?? -1
    m.tags.startCell = m.cell
  })
  const placed = setup.monsters.filter(m => m.cell >= 0)
  const fight = engine.createFight({
    map: setup.map,
    fighters: [...team, ...placed],
    options: { seed: o.seed, rollMode: o.rollMode, record: o.record, maxRounds: setup.maxRounds, rngRekey: o.rngRekey },
    scenarioId: setup.scenarioId,
  })
  if (setup.startingSpells) for (const m of placed) if (hasStartingSpell(engine, m)) castStartingSpell(engine, fight, m)
  if (setup.rule !== 'best') rebuildTimeline(engine, fight, setup.rule)
  return fight
}

export const skirmishHooks: ScenarioHooks = {
  id: SKIRMISH_SCENARIO_ID,
  cloneState: s => ({ ...s }),
}

function createSkirmishFight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState {
  const p = resolveSkirmishParams(o.params)
  const map = engine.data.map(p.mapId)
  if (!map) throw new Error(`Carte ${p.mapId} absente des données`)
  const monsters = p.monsterIds.map((monsterId, i) =>
    createMonsterFighter(engine.data, { monsterId, grade: p.monsterGrades[Math.min(i, p.monsterGrades.length - 1)] ?? 1, team: 1 }),
  )
  const fight = createGenericFight(engine, team, o, {
    map,
    monsters,
    monsterCells: p.monsterCells,
    playerCells: p.playerCells,
    scenarioId: SKIRMISH_SCENARIO_ID,
    maxRounds: p.maxRounds,
    rule: p.startingTeamRule,
    startingSpells: p.castStartingSpells,
  })
  fight.scenarioState[SKIRMISH_SCENARIO_ID] = { mapId: p.mapId, monsters: p.monsterIds.length }
  return fight
}

/** Résumé générique : progression = 0,7 × part des PV ennemis retirés + 0,3 × part des personnages vivants. */
export function summarizeGeneric(fight: FightState): ScenarioSummary {
  const win = fight.ended && fight.winner === 0
  const enemies = fight.fighters.filter(f => f.team === 1 && f.summonerId === undefined)
  const players = fight.fighters.filter(f => f.team === 0 && f.kind === 'player')
  const maxHp = enemies.reduce((a, f) => a + f.baseMaxHp, 0)
  const hp = enemies.reduce((a, f) => a + (f.alive ? f.hp : 0), 0)
  const alive = players.filter(f => f.alive).length
  const progress = win ? 1 : 0.7 * (maxHp ? 1 - hp / maxHp : 0) + 0.3 * (players.length ? alive / players.length : 0)
  return {
    win,
    rounds: Math.min(fight.round, fight.options.maxRounds),
    endReason: fight.endReason ?? '',
    failReason: win ? undefined : !fight.ended || fight.winner === null ? 'limite de tours' : 'défaite',
    progress: Math.max(0, Math.min(1, progress)),
    corruptedByRound: [],
    hoursUsed: 0,
    extra: { enemiesAlive: enemies.filter(f => f.alive).length, playersAlive: alive },
  }
}

export const skirmishScenario: DungeonScenario = {
  id: SKIRMISH_SCENARIO_ID,
  mapId: SKIRMISH_DEFAULT_MAP,
  defaultParams: { ...SKIRMISH_DEFAULT_PARAMS },
  uncertain: [],
  hooks: skirmishHooks,
  createFight: createSkirmishFight,
  aiModel: (_params: ScenarioParams, theta: StrategyParams) => createGenericModel(theta),
  micro: {},
  summarize: summarizeGeneric,
}
