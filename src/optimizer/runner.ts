/**
 * Exécution d'UN combat à partir d'une `FightSpec` et d'une graine (docs/design/ai.md §15.2, §13) — WP4.
 *
 * Pipeline : scénario (registre src/dungeons, ou combat de contrôle `control:…`) → variante INCERTAINE (`sampled` :
 * `Rng(mix32(graine, 0x5C))`, src/optimizer/seeds.ts) → personnages (src/stats `computeBuildStats` + fabrique du
 * moteur, preset en `tags.presetId`) → `scenario.createFight` (E1 `rngRekey: 'perTurn'` par défaut) → contrôleurs
 * (`createControllers` de src/ai selon `spec.mode` ; politique aléatoire si `spec.playerPolicy === 'random'` ; bruit des
 * monstres `spec.monsterNoise`) → `runFight` → `FightSummary` (+ replay sur demande).
 *
 * Un combat n'est jamais enregistré dans les lots (`record: false`) : `eventsHash` est l'empreinte de l'état final
 * (`fightDigest`), identique enregistré ou non, avec 1 ou 4 workers ; `spellUse` est compté par un enrobage des
 * contrôleurs (lancers du tour lus dans `castsThisTurn` après chaque tour d'un allié), sans événements.
 *
 * Combats de contrôle (§16.5) : `control:<carte>:<monstre>[*n][@grade],…` (ex. `control:143393281:3834,3838*2@5`) —
 * raccourci vers le scénario générique « escarmouche » de WP3 (src/dungeons/generic/skirmish.ts : `mapId`,
 * `monsterIds`, `monsterGrades`, placement générique, sorts de départ, `GenericModel`) ; repli local (cases
 * rouges/bleues, aucune règle) si celui-ci n'est pas enregistré. Un scénario enregistré sous le même identifiant
 * l'emporte toujours.
 *
 * Non fait ici (hors WP4a ou moteur) : sorts passifs des objets (effet 1175, non appliqués par le moteur), kind 't0'
 * (modèle analytique T0, WP4b).
 */
import { createControllers, defaultAIConfig } from '../ai'
import { createRandomPolicy } from '../ai/policies/random'
import { createGenericModel } from '../ai/team/genericModel'
import type { AIControllerProvider, StrategyParams } from '../ai/types'
import { fnv1a32 } from '../core/hash'
import type { TeamId } from '../core/types'
import type { DataStore } from '../data/store'
import { getScenario, listScenarios } from '../dungeons'
import type { DungeonScenario, FightSetupOptions, MicroId, MicroResult, ScenarioParams, ScenarioSummary } from '../dungeons/types'
import { createEngine, type Engine } from '../engine'
import { createMonsterFighter, createPlayerFighter } from '../engine/factory'
import { runFight, type Controller, type ControllerProvider } from '../engine/runner'
import type { Fighter, FightEvent, FightState } from '../engine/types'
import type { Replay, ReplayMeta, ReplayTeamMember } from '../replay/types'
import { computeBuildStats } from '../stats/build'
import { sampleVariant, variantKeyOf } from './seeds'
import { buildSummary, findPreset } from './team/presets'
import type { FightSpec, FightSummary, MemberSpec, WorkerTask } from './types'

export interface RunOptions {
  /** Enregistrer les événements (replay) ; défaut faux (lots : résumés seulement, §13.2). */
  record?: boolean
  /** Re-semis des dés par tour (E1) ; défaut 'perTurn' (CRN). */
  rngRekey?: 'none' | 'perTurn'
  /**
   * Annotations de l'IA (`AIConfig.explain` : événements `aiNote` du replay) ; défaut = `record`. N'influence aucune
   * décision (§13.2 : même combat, annoté ou non).
   */
  explain?: boolean
}

export interface RunResult {
  summary: FightSummary
  fight: FightState
  /** Paramètres effectifs du scénario (défauts + variante + `spec.params`). */
  params: ScenarioParams
  /** Résultat du micro-scénario (runMicro seulement). */
  micro?: MicroResult
}

// ───────────────────────────── scénarios ─────────────────────────────

/** Préfixe des combats de contrôle ad hoc (voir l'en-tête). */
export const CONTROL_PREFIX = 'control:'
/** Carte par défaut des combats de contrôle (salle du Vortex, vraies cases de placement). */
export const CONTROL_DEFAULT_MAP = 143393281

interface ControlMonster {
  monsterId: number
  count: number
  grade: number
}

/** Analyse `control:<carte>:<monstre>[*n][@grade],…` (carte vide ou 0 ⇒ carte par défaut). */
export function parseControlId(id: string): { mapId: number; monsters: ControlMonster[] } | undefined {
  if (!id.startsWith(CONTROL_PREFIX)) return undefined
  const [mapText, list] = id.slice(CONTROL_PREFIX.length).split(':')
  if (list === undefined) return undefined
  const mapId = Number(mapText) || CONTROL_DEFAULT_MAP
  const monsters: ControlMonster[] = []
  for (const part of list.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\*(\d+))?(?:@(\d+))?$/.exec(part)
    if (!m) throw new Error(`Combat de contrôle : monstre illisible « ${part} » (attendu <id>[*n][@grade])`)
    monsters.push({ monsterId: Number(m[1]), count: Number(m[2] ?? 1), grade: Number(m[3] ?? 5) })
  }
  if (!monsters.length) throw new Error(`Combat de contrôle sans monstre : « ${id} »`)
  return { mapId, monsters }
}

/** Cases de placement d'une équipe (rouges = 1, bleues = 2), triées, marchables. */
function placementCells(fight: { map: FightState['map'] }, kind: 1 | 2): number[] {
  const map = fight.map
  const listed = kind === 1 ? map.redCells : map.blueCells
  const raw = listed?.length ? listed : map.cells.filter(c => c.placement === kind).map(c => c.id)
  return raw.filter(c => map.cells[c]?.walkable).sort((a, b) => a - b)
}

function controlSummary(fight: FightState, playerTeam: TeamId): ScenarioSummary {
  const win = fight.ended && fight.winner === playerTeam
  const enemies = fight.fighters.filter(f => f.team !== playerTeam && f.kind !== 'summon')
  const allies = fight.fighters.filter(f => f.team === playerTeam && f.kind === 'player')
  const enemyMax = enemies.reduce((a, f) => a + f.baseMaxHp, 0)
  const enemyLeft = enemies.reduce((a, f) => a + (f.alive ? f.hp : 0), 0)
  const alive = allies.filter(f => f.alive).length
  const progress = win ? 1 : 0.8 * (1 - enemyLeft / Math.max(1, enemyMax)) + 0.2 * (alive / Math.max(1, allies.length))
  return {
    win,
    rounds: fight.round,
    endReason: fight.endReason ?? '',
    failReason: win ? undefined : fight.winner === null ? 'limite de tours' : 'équipe éliminée',
    progress,
    corruptedByRound: [],
    hoursUsed: 0,
  }
}

const controlCache = new Map<string, DungeonScenario>()

/** Identifiant du scénario générique « escarmouche » de WP3 (src/dungeons/generic/skirmish.ts). */
const SKIRMISH_ID = 'skirmish'

/**
 * Scénario d'un combat de contrôle (`control:…`). Si le scénario générique « escarmouche » de WP3 est enregistré, il
 * est utilisé avec les paramètres tirés de l'identifiant (`mapId`, `monsterIds`, `monsterGrades` : placement générique
 * et sorts de départ de WP3) ; sinon, repli local (cases rouges/bleues triées, aucune règle).
 */
export function controlScenario(id: string): DungeonScenario {
  const cached = controlCache.get(id)
  if (cached) return cached
  const parsed = parseControlId(id)
  if (!parsed) throw new Error(`Identifiant de combat de contrôle invalide : « ${id} »`)
  if (listScenarios().includes(SKIRMISH_ID)) {
    const base = getScenario(SKIRMISH_ID)
    const ids: number[] = []
    const grades: number[] = []
    for (const m of parsed.monsters) for (let k = 0; k < m.count; k++) (ids.push(m.monsterId), grades.push(m.grade))
    const extra: ScenarioParams = { mapId: parsed.mapId, monsterIds: ids, monsterGrades: grades, maxRounds: 30 }
    const delegated: DungeonScenario = {
      ...base,
      id,
      mapId: parsed.mapId,
      defaultParams: { ...base.defaultParams, ...extra },
      createFight: (engine, team, o) => base.createFight(engine, team, { ...o, params: { ...o.params, ...extra, maxRounds: o.params.maxRounds ?? 30 } }),
    }
    controlCache.set(id, delegated)
    return delegated
  }
  const scenario: DungeonScenario = {
    id,
    mapId: parsed.mapId,
    defaultParams: { maxRounds: 30 },
    uncertain: [],
    hooks: { id },
    createFight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState {
      const map = engine.data.map(parsed.mapId)
      if (!map) throw new Error(`Carte ${parsed.mapId} absente des données`)
      const red = placementCells({ map }, 1)
      const blue = placementCells({ map }, 2)
      team.forEach((f, i) => {
        f.team = 0
        f.cell = o.placement?.[i] ?? red[i % Math.max(1, red.length)]
      })
      const monsters: Fighter[] = []
      for (const m of parsed.monsters) {
        for (let k = 0; k < m.count; k++) {
          const cell = blue[monsters.length % Math.max(1, blue.length)]
          monsters.push(createMonsterFighter(engine.data, { monsterId: m.monsterId, grade: m.grade, team: 1, cell }))
        }
      }
      const maxRounds = Number(o.params.maxRounds ?? 30)
      return engine.createFight({
        map,
        fighters: [...team, ...monsters],
        options: { seed: o.seed, rollMode: o.rollMode, record: o.record, maxRounds, rngRekey: o.rngRekey },
        scenarioId: id,
      })
    },
    aiModel: (_params, theta) => createGenericModel(theta),
    micro: {},
    summarize: fight => controlSummary(fight, 0),
  }
  controlCache.set(id, scenario)
  return scenario
}

/** Scénario d'une spécification : registre d'abord, puis combat de contrôle `control:…`. */
export function resolveScenario(id: string): DungeonScenario {
  if (listScenarios().includes(id)) return getScenario(id)
  if (id.startsWith(CONTROL_PREFIX)) return controlScenario(id)
  return getScenario(id) // erreur explicite (scénarios connus)
}

/** Paramètres effectifs d'un combat et clé de variante (`variantPolicy` 'sampled' : tirage par graine). */
export function fightParams(scenario: DungeonScenario, spec: FightSpec, seed: number): { params: ScenarioParams; variant: string } {
  const fixed = spec.params ?? {}
  const sampled = spec.variantPolicy === 'sampled' ? sampleVariant(scenario.uncertain, seed, new Set(Object.keys(fixed))).params : {}
  const params = { ...scenario.defaultParams, ...sampled, ...fixed } as ScenarioParams
  return { params, variant: variantKeyOf(scenario.uncertain, params) }
}

// ───────────────────────────── équipe ─────────────────────────────

/** Combattants des personnages d'une équipe (caractéristiques calculées par src/stats ; preset en `tags.presetId`). */
export function buildTeam(data: DataStore, members: readonly MemberSpec[]): Fighter[] {
  return members.map(m => {
    const res = computeBuildStats(m.build, data)
    const variants = m.variants.length ? m.variants : m.build.spellVariants
    const f = createPlayerFighter(data, {
      name: m.name,
      breedId: m.breedId,
      level: m.build.level,
      stats: res.stats,
      maxHp: res.maxHp,
      variants,
      role: m.role ?? findPreset(m.presetId)?.role,
      ai: 'player',
    })
    f.tags.presetId = m.presetId
    return f
  })
}

// ───────────────────────────── empreintes et score ─────────────────────────────

/** Hash des événements hors `log` / `aiNote` (replays enregistrés) ; 0 si le combat n'est pas enregistré. */
export function eventsHash(events: readonly FightEvent[]): number {
  let h = 0x811c9dc5
  for (const e of events) {
    if (e.t === 'log' || e.t === 'aiNote') continue
    h = fnv1a32(JSON.stringify(e), h)
  }
  return events.length ? h : 0
}

/**
 * Empreinte déterministe d'un combat terminé (`FightSummary.eventsHash`, §13.2, §16.5) : état final complet (dés,
 * tour, timeline, combattants, buffs, marques, registre des morts, métriques). Contrairement à `eventsHash`, elle ne
 * dépend PAS de l'enregistrement : identique avec `record` vrai ou faux, 1 ou 4 workers, Node ou navigateur. Deux
 * combats qui divergent à un moment quelconque (dés, décision, effet) ont, sauf collision, des empreintes différentes.
 * `Fighter.rev` (opaque, E4) en est exclu.
 */
export function fightDigest(fight: FightState): number {
  const p: (number | string)[] = [fight.round, fight.turnIndex, fight.rngState, fight.nextUid, fight.winner ?? -1,
    fight.ended ? 1 : 0, fight.endReason ?? '', fight.unknownEffects ?? 0, fight.timeline.join('.')]
  for (const f of fight.fighters) {
    p.push(f.id, f.team, f.alive ? 1 : 0, f.hp, f.shield, f.maxHp, f.cell, Math.round(f.ap * 100), Math.round(f.mp * 100),
      f.states.join('.'))
    for (const b of f.buffs) p.push(b.uid, b.sourceId, b.spellId, b.effect.effectId, b.value, b.remaining)
    const m = fight.metrics[f.id]
    if (m) p.push(m.damageDealt, m.damageTaken, m.healingDone, m.apRemoved, m.mpRemoved, m.kills, m.turnsPlayed)
  }
  for (const g of fight.glyphs) p.push('g', g.uid, g.spellId, g.center, g.remaining)
  for (const t of fight.traps) p.push('t', t.uid, t.spellId, t.center)
  for (const d of fight.deaths ?? []) p.push('d', d.fighter, d.round, d.cell, d.killer ?? -1)
  return fnv1a32(p.join(','))
}

/** Score d'un combat (§15.2) : `win ? 1 + 0,1·PV% − tours/600 : 0,8·progress` (PV% en fraction [0, 1]). */
export function fightScore(win: boolean, hpLeftPct: number, rounds: number, progress: number): number {
  return win ? 1 + 0.1 * hpLeftPct - rounds / 600 : 0.8 * progress
}

// ───────────────────────────── préparation d'un combat ─────────────────────────────

interface Prepared {
  engine: Engine
  fight: FightState
  scenario: DungeonScenario
  params: ScenarioParams
  variant: string
  playerTeam: TeamId
  controllers: AIControllerProvider
  provider: ControllerProvider
  spellUse: Record<number, number>
}

/** Fournisseur enrobé : compte les lancers des alliés (`castsThisTurn` après chaque tour) sans événements. */
function countingProvider(inner: ControllerProvider, team: TeamId, spellUse: Record<number, number>): ControllerProvider {
  const wrapped = new Map<Controller, Controller>()
  return (f: Fighter) => {
    const c = inner(f)
    if (f.team !== team) return c
    let w = wrapped.get(c)
    if (!w) {
      w = {
        playTurn(engine, fight, me) {
          c.playTurn(engine, fight, me)
          for (const k in me.castsThisTurn) spellUse[Number(k)] = (spellUse[Number(k)] ?? 0) + me.castsThisTurn[k]
        },
      }
      wrapped.set(c, w)
    }
    return w
  }
}

function prepare(
  data: DataStore,
  spec: FightSpec,
  seed: number,
  opts: RunOptions,
  create: (scenario: DungeonScenario, engine: Engine, team: Fighter[], o: FightSetupOptions) => FightState,
): Prepared {
  const scenario = resolveScenario(spec.scenarioId)
  const engine = createEngine(data, scenario.hooks)
  const team = buildTeam(data, spec.team)
  const { params, variant } = fightParams(scenario, spec, seed)
  const fight = create(scenario, engine, team, {
    params,
    seed,
    placement: spec.placement,
    rollMode: 'random',
    record: opts.record ?? false,
    rngRekey: opts.rngRekey ?? 'perTurn',
  })
  const playerTeam = team[0]?.team ?? 0
  const cfg = defaultAIConfig(spec.mode, seed, spec.theta as StrategyParams)
  cfg.monster = { ...cfg.monster, noiseTau: spec.monsterNoise }
  cfg.explain = opts.explain ?? opts.record ?? false
  const controllers = createControllers(engine, cfg, { scenario: scenario.aiModel(params, spec.theta) })
  let provider: ControllerProvider = controllers
  if (spec.playerPolicy === 'random') {
    const random = createRandomPolicy(cfg)
    const players = new Set<TeamId>([playerTeam])
    provider = f => (players.has(f.team) && f.ai !== 'pass' ? random : controllers(f))
  }
  const spellUse: Record<number, number> = {}
  return { engine, fight, scenario, params, variant, playerTeam, controllers, provider: countingProvider(provider, playerTeam, spellUse), spellUse }
}

function summarize(p: Prepared, seed: number, s: ScenarioSummary): FightSummary {
  const { fight } = p
  const chars = fight.fighters.filter(f => f.team === p.playerTeam && f.kind === 'player')
  // PV restants plafonnés aux PV max de début de combat (un buff de Vitalité ne fait pas dépasser 100 %).
  const hpLeftPct = chars.reduce((a, f) => a + (f.alive ? Math.min(f.hp, f.baseMaxHp) : 0), 0) / Math.max(1, chars.reduce((a, f) => a + f.baseMaxHp, 0))
  const st = p.controllers.stats()
  const spellUse: Record<number, number> = {}
  for (const k of Object.keys(p.spellUse).map(Number).sort((a, b) => a - b)) spellUse[k] = p.spellUse[k]
  return {
    seed,
    variant: p.variant,
    win: s.win,
    rounds: s.rounds,
    endReason: s.endReason,
    failReason: s.failReason,
    deaths: chars.filter(f => !f.alive).length,
    hpLeftPct,
    damageTaken: chars.reduce((a, f) => a + (fight.metrics[f.id]?.damageTaken ?? 0), 0),
    progress: s.progress,
    score: fightScore(s.win, hpLeftPct, s.rounds, s.progress),
    corruptedByRound: s.corruptedByRound,
    hoursUsed: s.hoursUsed,
    phase2Rounds: s.phase2Rounds,
    vortexHpPct: s.vortexHpPct,
    creativeActions: st.creativeActions,
    tactics: st.tactics,
    spellUse,
    unknownEffects: fight.unknownEffects ?? 0,
    nodes: st.nodes,
    eventsHash: fightDigest(fight),
  }
}

// ───────────────────────────── exécution ─────────────────────────────

/** Joue un combat complet et le résume. */
export function runOne(data: DataStore, spec: FightSpec, seed: number, opts: RunOptions = {}): RunResult {
  const p = prepare(data, spec, seed, opts, (scenario, engine, team, o) => scenario.createFight(engine, team, o))
  runFight(p.engine, p.fight, p.provider)
  return { summary: summarize(p, seed, p.scenario.summarize(p.fight)), fight: p.fight, params: p.params }
}

/** Boucle de `runFight` avec un arrêt anticipé (micro-scénarios) : même logique de tour (cannotPlay, preventsFight). */
export function runUntil(engine: Engine, fight: FightState, controllers: ControllerProvider, done: (f: FightState) => boolean, maxTurns = 5000): FightState {
  for (let i = 0; i < maxTurns && !fight.ended && !done(fight); i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
    if (canPlay) controllers(f).playTurn(engine, fight, f)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
    else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
  }
  return fight
}

/**
 * Joue un micro-scénario (§12.11 : 'prefix12', 'phase2', 'poutch') du scénario de `spec` et le résume. Le résumé
 * reprend le `MicroResult` : `win` = pWin ≥ 0,5, `score` = pWin, `progress`, `rounds`, `deaths`, `hpLeftPct` ; les
 * métriques propres sont dans `micro.metrics` du `RunResult` (pas dans `FightSummary`, gelé).
 */
export function runMicro(data: DataStore, spec: FightSpec, seed: number, microId: MicroId, opts: RunOptions = {}): RunResult {
  const scenario = resolveScenario(spec.scenarioId)
  const micro = scenario.micro[microId]
  if (!micro) throw new Error(`Micro-scénario « ${microId} » indisponible pour « ${scenario.id} »`)
  const p = prepare(data, spec, seed, opts, (_s, engine, team, o) => micro.createFight(engine, team, o))
  runUntil(p.engine, p.fight, p.provider, f => micro.done(f), Math.max(1, micro.maxRounds) * Math.max(8, p.fight.timeline.length) * 4)
  const r = micro.evaluate(p.fight)
  const base = summarize(p, seed, {
    win: r.pWin >= 0.5,
    rounds: r.rounds,
    endReason: p.fight.endReason ?? `micro:${microId}`,
    progress: r.progress,
    corruptedByRound: [],
    hoursUsed: 0,
  })
  const hpLeftPct = Math.max(0, Math.min(1, r.hpLeftPct))
  return { summary: { ...base, deaths: r.deaths, hpLeftPct, score: r.pWin }, fight: p.fight, params: p.params, micro: r }
}

/** Exécute une tâche de worker (toutes ses graines, dans l'ordre). */
export function runTask(data: DataStore, task: WorkerTask): FightSummary[] {
  if (task.kind === 't0') throw new Error("Tâche 't0' (modèle analytique T0) non implémentée (WP4b, src/optimizer/team/t0model.ts)")
  const out: FightSummary[] = []
  for (const seed of task.seeds) {
    out.push(task.kind === 'full' ? runOne(data, task.spec, seed).summary : runMicro(data, task.spec, seed, task.kind).summary)
  }
  return out
}

// ───────────────────────────── replays ─────────────────────────────

export interface ReplayExtras {
  title?: string
  description?: string
  generator?: string
  createdAt?: string
}

/** Replay animé (src/replay/types) d'un combat joué avec `record: true`. */
export function toReplay(data: DataStore, spec: FightSpec, result: RunResult, extras: ReplayExtras = {}): Replay {
  const { fight, summary } = result
  const chars = fight.fighters.filter(f => f.kind === 'player')
  const team: ReplayTeamMember[] = spec.team.map((m, i) => {
    const preset = findPreset(m.presetId)
    return {
      name: m.name,
      breed: preset?.className ?? data.breed(m.breedId)?.name,
      breedId: m.breedId,
      role: m.role ?? preset?.role,
      build: buildSummary(m, data),
      notes: preset ? `${preset.label} (${preset.id})` : m.presetId,
      fighterId: chars[i]?.id,
    }
  })
  const scenario = resolveScenario(spec.scenarioId)
  const meta: ReplayMeta = {
    title: extras.title ?? `${scenario.id} — graine ${summary.seed} — ${summary.win ? 'victoire' : 'défaite'}`,
    description:
      extras.description ??
      `${spec.mode}${spec.playerPolicy === 'random' ? ' (aléatoire)' : ''}, ${summary.rounds} tours, ${summary.deaths} mort(s), ` +
        `variante ${summary.variant}${summary.failReason ? `, échec : ${summary.failReason}` : ''}`,
    team,
    seed: summary.seed,
    scenario: scenario.id,
    generator: extras.generator ?? 'dofussimu-optimizer',
    createdAt: extras.createdAt,
  }
  return { version: 1, events: fight.events, map: fight.map, meta }
}
