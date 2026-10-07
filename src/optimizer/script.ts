/**
 * Scénarios de combat (« combat orchestré ») : pour un placement des monstres, les personnages jouent un script FIGÉ tour
 * par tour (cases, déplacements, sorts) et l'IA des monstres doit répondre chaque fois de la même façon.
 *
 *  - `recordScript` : combat de référence joué par l'IA des personnages (défaut : jets moyens, `rollMode: 'average'`,
 *    déterministe — la trajectoire « centrale »), découpé en tours ; chaque tour garde ses actions (déplacement : case
 *    d'arrivée ; sort : id et case visée). Les tours des personnages sont les INSTRUCTIONS, ceux des monstres les
 *    RÉPONSES ATTENDUES.
 *  - `runScript` : rejoue le script avec d'autres dés (`rollMode: 'random'`, graine des dés = `diceSeed`) ; les monstres
 *    gardent la graine IA de la référence (mêmes départages). Le combat est comparé tour par tour à la référence ;
 *    première rupture : ordre des tours différent (un monstre tué ou non selon les jets…), action d'un personnage
 *    impossible (case occupée, sort hors de portée…), monstre qui joue autrement, fin de combat différente. Après une
 *    rupture : arrêt (`stopAtBreak`, défaut) ou suite jouée par l'IA des personnages (le combat est-il encore gagné ?).
 *  - `summarizeChecks` : conformité (scripts déroulés jusqu'au bout à l'identique), victoires, survie du script tour par
 *    tour et points de rupture regroupés (« tour 7, Méjaire : attendu …, joué … — 12 cas sur 64 »).
 *
 * Les tours sont ceux que rend `engine.nextTurn` (les tours annulés des monstres corrompus n'en font pas partie), même
 * découpage pour la référence et les rejeux. Les déplacements forcés (poussées, téléportations, glyphes) ne sont pas des
 * actions : ils découlent des sorts et se comparent à travers les tours suivants.
 */
import { createControllers, defaultAIConfig } from '../ai'
import type { AIControllerProvider, AIMode, StrategyParams } from '../ai/types'
import type { TeamId } from '../core/types'
import type { DataStore } from '../data/store'
import type { DungeonScenario, ScenarioParams } from '../dungeons/types'
import { createEngine, type Engine } from '../engine'
import { reachableCells, pathTo } from '../engine/move'
import { performAction, type Controller, type ControllerProvider } from '../engine/runner'
import type { Fighter, FightEvent, FightState, RollMode } from '../engine/types'
import { buildTeam, fightDigest, fightScore, resolveScenario, type RunResult } from './runner'
import type { FightSpec, FightSummary, MemberSpec } from './types'

export const SCRIPT_VERSION = 1

// ───────────────────────────── format ─────────────────────────────

export type ScriptStep =
  | { kind: 'move'; to: number; /** Chemin exact (case de départ comprise) : le rejeu le suit, un autre chemin peut être taclé. */ path: number[] }
  | { kind: 'cast'; spellId: number; spell: string; cell: number; /** Combattant sur la case visée (lisibilité). */ target?: string }

export type ScriptSide = 'player' | 'ally' | 'monster'

export interface ScriptTurn {
  /** Rang du tour dans le combat (0 = premier tour joué). */
  index: number
  round: number
  fighterId: number
  name: string
  side: ScriptSide
  startCell: number
  /** Le combattant a-t-il pu agir (faux : tour sans contrôle, états empêchant de combattre) ? */
  played: boolean
  steps: ScriptStep[]
}

export interface FightScript {
  version: number
  scenario: string
  /** Paramètres du scénario (dont `enemyPlacement`). */
  params: ScenarioParams
  enemyPlacement: number
  /** Builds complets des personnages (le script se rejoue à l'identique même si le fichier d'équipe change). */
  team: MemberSpec[]
  /** Cases de départ des personnages, dans l'ordre de `team`. */
  playerCells: number[]
  /** θ de l'IA (suite jouée par l'IA après une rupture, modèle du scénario). */
  theta: StrategyParams
  reference: { seed: number; rollMode: RollMode; mode: AIMode; win: boolean; rounds: number; endReason: string; createdAt: string }
  turns: ScriptTurn[]
}

// ───────────────────────────── boucle de combat découpée en tours ─────────────────────────────

interface TurnHooks {
  /** Avant de jouer le tour ; `false` : arrêter le combat. */
  before?(turn: ScriptTurn, fighter: Fighter): boolean
  /** Après le tour (actions relevées) ; `false` : arrêter le combat. */
  after?(turn: ScriptTurn, fighter: Fighter): boolean
}

function sideOf(f: Fighter, playerTeam: TeamId): ScriptSide {
  return f.team !== playerTeam ? 'monster' : f.kind === 'player' ? 'player' : 'ally'
}

/**
 * Actions de `fighterId` dans les événements depuis `from` (déplacements volontaires et sorts). La cible affichée d'un
 * sort est le combattant présent sur la case visée AU MOMENT du lancer : positions du début du tour (`cells`) mises à
 * jour par les déplacements, poussées, téléportations, invocations et morts du tour.
 */
function stepsSince(fight: FightState, from: number, fighterId: number, cells: Map<number, number>): ScriptStep[] {
  const out: ScriptStep[] = []
  const ev = fight.events
  const at = new Map(cells)
  for (let i = from; i < ev.length; i++) {
    const e = ev[i] as FightEvent
    if (e.t === 'move') {
      at.set(e.fighter, e.path[e.path.length - 1])
      // Chaque déplacement tel qu'il a eu lieu (un déplacement taclé puis repris = deux étapes, comme en jeu).
      if (e.fighter === fighterId && e.path.length > 1) out.push({ kind: 'move', to: e.path[e.path.length - 1], path: e.path.slice() })
    } else if (e.t === 'push' || e.t === 'teleport') at.set(e.target, e.to)
    else if (e.t === 'summon') at.set(e.fighter.id, e.fighter.cell)
    else if (e.t === 'death') at.delete(e.target)
    else if (e.t === 'cast' && e.fighter === fighterId) {
      let target: string | undefined
      for (const [id, c] of at) if (c === e.cell) target = fight.fighters[id]?.name
      out.push({ kind: 'cast', spellId: e.spellId, spell: e.spellName, cell: e.cell, target })
    }
  }
  return out
}

/** Cases des combattants vivants (positions de début de tour). */
const aliveCells = (fight: FightState) => new Map(fight.fighters.filter(f => f.alive).map(f => [f.id, f.cell]))

/** Joue le combat tour par tour (même logique que `runFight`) en relevant les actions de chaque tour. */
function playTurns(engine: Engine, fight: FightState, provider: ControllerProvider, playerTeam: TeamId, hooks: TurnHooks = {}, maxTurns = 5000): ScriptTurn[] {
  let stopped = false
  const turns: ScriptTurn[] = []
  for (let i = 0; i < maxTurns && !fight.ended; i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
    const turn: ScriptTurn = { index: turns.length, round: fight.round, fighterId: f.id, name: f.name, side: sideOf(f, playerTeam), startCell: f.cell, played: canPlay, steps: [] }
    turns.push(turn)
    if (hooks.before && !hooks.before(turn, f)) {
      stopped = true
      break
    }
    const mark = fight.events.length
    const cells = aliveCells(fight)
    if (canPlay) provider(f).playTurn(engine, fight, f)
    turn.steps = stepsSince(fight, mark, f.id, cells)
    const go = hooks.after ? hooks.after(turn, f) : true
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
    else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
    if (!go) {
      stopped = true
      break
    }
  }
  if (!fight.ended) engine.endFight(fight, null, stopped ? 'Scénario rompu' : 'Limite de tours atteinte')
  return turns
}

// ───────────────────────────── préparation ─────────────────────────────

interface Prepared {
  engine: Engine
  fight: FightState
  scenario: DungeonScenario
  params: ScenarioParams
  playerTeam: TeamId
  ai: AIControllerProvider
}

function prepare(data: DataStore, spec: FightSpec, diceSeed: number, aiSeed: number, rollMode: RollMode, params: ScenarioParams): Prepared {
  const scenario = resolveScenario(spec.scenarioId)
  const engine = createEngine(data, scenario.hooks)
  const team = buildTeam(data, spec.team)
  const fight = scenario.createFight(engine, team, { params, seed: diceSeed, placement: spec.placement, rollMode, record: true, rngRekey: 'perTurn' })
  const cfg = defaultAIConfig(spec.mode, aiSeed, spec.theta as StrategyParams)
  cfg.monster = { ...cfg.monster, noiseTau: 0 }
  const ai = createControllers(engine, cfg, { scenario: scenario.aiModel(params, spec.theta) })
  return { engine, fight, scenario, params, playerTeam: team[0]?.team ?? 0, ai }
}

/** Résumé d'un combat de script (mêmes champs que les lots, pour les replays et rapports). */
function summaryOf(p: Prepared, seed: number): FightSummary {
  const s = p.scenario.summarize(p.fight)
  const chars = p.fight.fighters.filter(f => f.team === p.playerTeam && f.kind === 'player')
  const hpLeftPct = chars.reduce((a, f) => a + (f.alive ? Math.min(f.hp, f.baseMaxHp) : 0), 0) / Math.max(1, chars.reduce((a, f) => a + f.baseMaxHp, 0))
  return {
    seed, variant: 'default', win: s.win, rounds: s.rounds, endReason: s.endReason, failReason: s.failReason, deaths: chars.filter(f => !f.alive).length,
    hpLeftPct, damageTaken: chars.reduce((a, f) => a + (p.fight.metrics[f.id]?.damageTaken ?? 0), 0), progress: s.progress,
    score: fightScore(s.win, hpLeftPct, s.rounds, s.progress), corruptedByRound: s.corruptedByRound, hoursUsed: s.hoursUsed,
    phase2Rounds: s.phase2Rounds, vortexHpPct: s.vortexHpPct, creativeActions: 0, tactics: {}, spellUse: {}, unknownEffects: p.fight.unknownEffects ?? 0,
    nodes: 0, eventsHash: fightDigest(p.fight),
  }
}

// ───────────────────────────── référence ─────────────────────────────

export interface RecordOptions {
  /** Jets du combat de référence ; défaut 'average' (trajectoire centrale, déterministe). */
  rollMode?: RollMode
}

/** Combat de référence joué par l'IA des personnages et son script. */
export function recordScript(data: DataStore, spec: FightSpec, seed: number, opts: RecordOptions = {}): { script: FightScript; run: RunResult } {
  const rollMode = opts.rollMode ?? 'average'
  const scenario = resolveScenario(spec.scenarioId)
  const params = { ...scenario.defaultParams, ...(spec.params ?? {}) } as ScenarioParams
  const p = prepare(data, spec, seed, seed, rollMode, params)
  const players = p.fight.fighters.filter(f => f.team === p.playerTeam && f.kind === 'player')
  const playerCells = players.map(f => f.cell)
  const turns = playTurns(p.engine, p.fight, p.ai, p.playerTeam)
  const summary = summaryOf(p, seed)
  const script: FightScript = {
    version: SCRIPT_VERSION,
    scenario: spec.scenarioId,
    params,
    enemyPlacement: Number(params.enemyPlacement ?? 0),
    team: spec.team.map(m => structuredClone(m)),
    playerCells,
    theta: spec.theta,
    reference: { seed, rollMode, mode: spec.mode, win: summary.win, rounds: summary.rounds, endReason: summary.endReason, createdAt: new Date().toISOString() },
    turns,
  }
  return { script, run: { summary, fight: p.fight, params } }
}

// ───────────────────────────── rejeu ─────────────────────────────

export type BreakKind = 'order' | 'action' | 'monster' | 'end'

export interface ScriptBreak {
  kind: BreakKind
  /** Tour du script où la rupture a lieu (index, tour de jeu, combattant attendu). */
  index: number
  round: number
  fighter: string
  expected: string
  actual: string
}

export interface ScriptRun {
  diceSeed: number
  /** Script déroulé jusqu'au bout, identique à la référence. */
  conform: boolean
  /** Tours conformes avant la rupture (= nombre de tours du script si conforme). */
  conformTurns: number
  break?: ScriptBreak
  /** Issue du combat (après la rupture : suite jouée par l'IA si `stopAtBreak` est faux ; sinon défaite). */
  win: boolean
  rounds: number
  summary: FightSummary
}

export interface RunScriptOptions {
  /** Arrêter le combat à la première rupture (défaut vrai : seule la conformité est mesurée). */
  stopAtBreak?: boolean
  /** Enregistrer le replay complet (la référence est toujours enregistrée en interne pour comparer). */
  rollMode?: RollMode
}

const stepKey = (s: ScriptStep) => (s.kind === 'move' ? `m${s.to}` : `c${s.spellId}@${s.cell}`)
const sameSteps = (a: readonly ScriptStep[], b: readonly ScriptStep[]) => a.length === b.length && a.every((s, i) => stepKey(s) === stepKey(b[i]))

/** Texte d'une suite d'actions (« → 301, Rayonirique sur Crâ (455) »). */
export function describeSteps(steps: readonly ScriptStep[]): string {
  if (!steps.length) return 'rien'
  return steps.map(s => (s.kind === 'move' ? `→ ${s.to}` : `${s.spell} sur ${s.target ? `${s.target} (${s.cell})` : s.cell}`)).join(', ')
}

/** Contrôleur des personnages qui exécute les actions du script ; signale la première action impossible. */
class ScriptPlayer implements Controller {
  failure?: string
  constructor(private readonly byKey: ReadonlyMap<string, ScriptTurn>) {}

  playTurn(engine: Engine, fight: FightState, me: Fighter): void {
    const t = this.byKey.get(`${fight.round}:${me.id}`)
    if (!t) {
      this.failure = `tour absent du script`
      return
    }
    for (const step of t.steps) {
      if (fight.ended || !me.alive) return
      if (step.kind === 'move') {
        if (me.cell === step.to) continue
        // Chemin exact de la référence s'il part de la case actuelle, sinon le plus court.
        const path = step.path?.[0] === me.cell ? step.path : pathTo(reachableCells(fight, me, engine), me.cell, step.to)
        if (!path) {
          this.failure = `déplacement vers ${step.to} impossible (case occupée ou hors de portée, ${me.mp} PM)`
          return
        }
        // Case finale non contrôlée ici : une glyphe ou un piège peut téléporter (comme dans la référence) ; un tacle qui
        // raccourcit le chemin se voit à la comparaison des déplacements effectués.
        if (!performAction(engine, fight, me, { type: 'move', path }).ok) {
          this.failure = `déplacement vers ${step.to} impossible depuis ${me.cell}`
          return
        }
      } else {
        const r = performAction(engine, fight, me, { type: 'cast', spellId: step.spellId, cell: step.cell }) as { ok: boolean; failure?: unknown }
        if (!r.ok) {
          this.failure = `${step.spell} sur ${step.cell} impossible${r.failure ? ` (${String(r.failure)})` : ''}`
          return
        }
      }
    }
  }
}

/** Rejoue un script avec les dés `diceSeed` et le compare tour par tour à la référence. */
export function runScript(data: DataStore, script: FightScript, diceSeed: number, opts: RunScriptOptions = {}): ScriptRun & { fight: FightState; turns: ScriptTurn[] } {
  const stop = opts.stopAtBreak ?? true
  const spec: FightSpec = {
    scenarioId: script.scenario, team: script.team, placement: script.playerCells, mode: script.reference.mode,
    theta: script.theta, params: script.params, variantPolicy: 'default', monsterNoise: 0,
  }
  const p = prepare(data, spec, diceSeed, script.reference.seed, opts.rollMode ?? 'random', script.params)
  const byKey = new Map(script.turns.filter(t => t.side !== 'monster').map(t => [`${t.round}:${t.fighterId}`, t]))
  const player = new ScriptPlayer(byKey)
  let broken: ScriptBreak | undefined
  let conformTurns = 0
  const provider: ControllerProvider = f => (f.team === p.playerTeam && !broken ? player : p.ai(f))
  const turns = playTurns(p.engine, p.fight, provider, p.playerTeam, {
    before(turn) {
      const exp = script.turns[turn.index]
      if (!broken && (!exp || exp.round !== turn.round || exp.fighterId !== turn.fighterId)) {
        broken = {
          kind: exp ? 'order' : 'end',
          index: turn.index,
          round: turn.round,
          fighter: exp?.name ?? turn.name,
          expected: exp ? `tour de ${exp.name} (tour de jeu ${exp.round})` : 'fin du combat',
          actual: `tour de ${turn.name} (tour de jeu ${turn.round})`,
        }
        return !stop
      }
      return true
    },
    after(turn) {
      if (broken) return true
      const exp = script.turns[turn.index]
      if (turn.side !== 'monster' && player.failure) {
        broken = { kind: 'action', index: turn.index, round: turn.round, fighter: turn.name, expected: describeSteps(exp.steps), actual: player.failure }
        return !stop
      }
      if (!sameSteps(exp.steps, turn.steps)) {
        broken = { kind: turn.side === 'monster' ? 'monster' : 'action', index: turn.index, round: turn.round, fighter: turn.name, expected: describeSteps(exp.steps), actual: describeSteps(turn.steps) }
        return !stop
      }
      conformTurns++
      return true
    },
  })
  if (!broken && turns.length !== script.turns.length) {
    const exp = script.turns[turns.length]
    broken = {
      kind: 'end', index: turns.length, round: exp?.round ?? p.fight.round, fighter: exp?.name ?? '—',
      expected: exp ? `tour de ${exp.name}` : 'fin du combat', actual: 'fin du combat',
    }
  }
  const summary = summaryOf(p, diceSeed)
  const conform = !broken
  return { diceSeed, conform, conformTurns, break: broken, win: summary.win && (conform || !stop), rounds: summary.rounds, summary, fight: p.fight, turns }
}

// ───────────────────────────── synthèse ─────────────────────────────

export interface BreakGroup {
  index: number
  round: number
  fighter: string
  kind: BreakKind
  expected: string
  actual: string
  count: number
}

export interface ScriptCheck {
  runs: number
  conform: number
  wins: number
  /** survival[k] = part des rejeux encore conformes après le tour k du script. */
  survival: number[]
  /** Ruptures regroupées (même tour, même nature, même action jouée), les plus fréquentes d'abord. */
  breaks: BreakGroup[]
}

export function summarizeChecks(script: FightScript, runs: readonly ScriptRun[]): ScriptCheck {
  const n = script.turns.length
  const survival = Array.from({ length: n }, (_, k) => runs.filter(r => r.conformTurns > k).length / Math.max(1, runs.length))
  const groups = new Map<string, BreakGroup>()
  for (const r of runs) {
    const b = r.break
    if (!b) continue
    const key = `${b.index}|${b.kind}|${b.actual}`
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { ...b, count: 1 })
  }
  return {
    runs: runs.length,
    conform: runs.filter(r => r.conform).length,
    wins: runs.filter(r => r.win).length,
    survival,
    breaks: [...groups.values()].sort((a, b) => b.count - a.count || a.index - b.index),
  }
}
