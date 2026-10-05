/**
 * Rembobinage stratégique (niveau L*, docs/design/ai.md §15.8) — WP4b. Démo seulement : jamais compté dans un taux de
 * victoire, toujours marqué « optimiste ».
 *
 * Pour une graine fixée : point de contrôle au début de chaque tour de jeu (`cloneFight` + `snapshot()` des
 * contrôleurs, avant le premier tour du round). Si le combat est perdu, retour 1, 2 puis 3 tours avant l'échec (tour
 * de la première mort d'un personnage, sinon dernier tour) et reprise avec une alternative non essayée :
 *  - `policyAlt` : autre mode d'IA des personnages (scripted, fast, standard…) pour la suite du combat ;
 *  - `aiSeedJitter` : graine IA différente (départages, exploration ε des contrôleurs) ;
 *  - `thetaJitter` : θ perturbé de ±20 % (paramètres réglables, `tune.ts`) ;
 *  - `placementAlt` : autre placement initial (reprise au tour 1 : permutations et autres cases de départ) ;
 *  - `plannerAlt` / `burstAlt` (alternatives n° k du `ScenarioPlan` / du `BurstPlan`) : NON disponibles tant que le
 *    `TeamBrain` (WP2) et le planificateur (WP3) n'exposent pas ces alternatives aux contrôleurs — ignorées.
 * Avec E1 (`rngRekey: 'perTurn'`), les dés restent identiques par (tour, combattant) : « mêmes dés » prouve
 * l'existence d'une ligne gagnante (replay annoté) ; « robuste » : au point de contrôle de cette ligne, l'alternative
 * qui maximise le taux de victoire sur `robustSeeds` (16) dés différents (graine des dés remplacée dans le clone).
 * ≤ `maxResumes` (40) reprises.
 */
import { createControllers, defaultAIConfig, flattenTheta, thetaWithPaths } from '../ai'
import { createRandomPolicy } from '../ai/policies/random'
import type { AIControllerProvider, AIMode, StrategyParams } from '../ai/types'
import { mix32 } from '../core/hash'
import { Rng } from '../core/rng'
import type { TeamId } from '../core/types'
import type { GameDataStore } from '../data/store'
import type { DungeonScenario, ScenarioParams } from '../dungeons/types'
import { createEngine, type Engine } from '../engine'
import type { Controller, ControllerProvider } from '../engine/runner'
import type { Fighter, FightState } from '../engine/types'
import type { Replay } from '../replay/types'
import { buildTeam, fightDigest, fightParams, fightScore, resolveScenario, toReplay } from './runner'
import { roundSig } from './stuff/detmath'
import { isTunablePath } from './tune'
import type { FightSpec, FightSummary } from './types'

// ───────────────────────────── alternatives ─────────────────────────────

export type RewindAlternative =
  | { kind: 'none' }
  | { kind: 'policyAlt'; mode: AIMode; policy?: 'ai' | 'random' }
  | { kind: 'aiSeedJitter'; salt: number }
  | { kind: 'thetaJitter'; salt: number }
  | { kind: 'placementAlt'; placement: number[] }

/** Libellé lisible d'une alternative. */
export function alternativeLabel(a: RewindAlternative): string {
  switch (a.kind) {
    case 'none':
      return 'aucune (reprise à l’identique)'
    case 'policyAlt':
      return `IA des personnages en mode ${a.mode}${a.policy === 'random' ? ' (aléatoire)' : ''}`
    case 'aiSeedJitter':
      return `graine IA perturbée (sel ${a.salt})`
    case 'thetaJitter':
      return `θ perturbé ±20 % (sel ${a.salt})`
    case 'placementAlt':
      return `placement ${a.placement.join(', ')}`
  }
}

// ───────────────────────────── combat instrumenté ─────────────────────────────

interface Session {
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

interface Overrides {
  mode?: AIMode
  policy?: 'ai' | 'random'
  aiSalt?: number
  theta?: StrategyParams
}

function makeProvider(engine: Engine, spec: FightSpec, seed: number, scenario: DungeonScenario, params: ScenarioParams, playerTeam: TeamId, explain: boolean, o: Overrides, spellUse: Record<number, number>): { controllers: AIControllerProvider; provider: ControllerProvider } {
  const theta = o.theta ?? spec.theta
  const cfg = defaultAIConfig(o.mode ?? spec.mode, seed, theta)
  if (o.aiSalt) cfg.seed = mix32(cfg.seed, o.aiSalt) >>> 0
  cfg.monster = { ...cfg.monster, noiseTau: spec.monsterNoise }
  cfg.explain = explain
  const controllers = createControllers(engine, cfg, { scenario: scenario.aiModel(params, theta) })
  let provider: ControllerProvider = controllers
  const policy = o.policy ?? spec.playerPolicy ?? 'ai'
  if (policy === 'random') {
    const random = createRandomPolicy(cfg)
    provider = f => (f.team === playerTeam && f.ai !== 'pass' ? random : controllers(f))
  }
  // Compteur des lancers des alliés (même règle que src/optimizer/runner.ts).
  const wrapped = new Map<Controller, Controller>()
  const counting: ControllerProvider = (f: Fighter) => {
    const c = provider(f)
    if (f.team !== playerTeam) return c
    let w = wrapped.get(c)
    if (!w) {
      w = {
        playTurn(eng, fight, me) {
          c.playTurn(eng, fight, me)
          for (const k in me.castsThisTurn) spellUse[Number(k)] = (spellUse[Number(k)] ?? 0) + me.castsThisTurn[k]
        },
      }
      wrapped.set(c, w)
    }
    return w
  }
  return { controllers, provider: counting }
}

function startSession(data: GameDataStore, spec: FightSpec, seed: number, record: boolean, placement?: number[]): Session {
  const scenario = resolveScenario(spec.scenarioId)
  const engine = createEngine(data, scenario.hooks)
  const team = buildTeam(data, spec.team)
  const { params, variant } = fightParams(scenario, spec, seed)
  const fight = scenario.createFight(engine, team, { params, seed, placement: placement ?? spec.placement, rollMode: 'random', record, rngRekey: 'perTurn' })
  const playerTeam = team[0]?.team ?? 0
  const spellUse: Record<number, number> = {}
  const { controllers, provider } = makeProvider(engine, spec, seed, scenario, params, playerTeam, record, {}, spellUse)
  return { engine, fight, scenario, params, variant, playerTeam, controllers, provider, spellUse }
}

export interface Checkpoint {
  /** Tour de jeu qui va commencer. */
  round: number
  fight: FightState
  brain: unknown
  spellUse: Record<number, number>
}

/** Joue jusqu'à la fin en posant un point de contrôle avant le premier tour de chaque round. */
function playWithCheckpoints(s: Session, checkpoints?: Map<number, Checkpoint>, maxTurns = 5000): void {
  const { engine, fight } = s
  for (let i = 0; i < maxTurns && !fight.ended; i++) {
    if (checkpoints && (fight.round === 0 || fight.turnIndex + 1 >= fight.timeline.length)) {
      const round = fight.round + 1
      if (!checkpoints.has(round)) {
        checkpoints.set(round, { round, fight: engine.cloneFight(fight, fight.options.record), brain: s.controllers.snapshot(), spellUse: { ...s.spellUse } })
      }
    }
    const f = engine.nextTurn(fight)
    if (!f) break
    const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
    if (canPlay) s.provider(f).playTurn(engine, fight, f)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
    else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
  }
  if (!fight.ended) engine.endFight(fight, null, 'Limite de tours atteinte')
}

/** Résumé d'un combat de session (mêmes champs et mêmes règles que src/optimizer/runner.ts). */
function summarize(s: Session, seed: number): FightSummary {
  const { fight } = s
  const sum = s.scenario.summarize(fight)
  const chars = fight.fighters.filter(f => f.team === s.playerTeam && f.kind === 'player')
  const hpLeftPct = chars.reduce((a, f) => a + (f.alive ? Math.min(f.hp, f.baseMaxHp) : 0), 0) / Math.max(1, chars.reduce((a, f) => a + f.baseMaxHp, 0))
  const st = s.controllers.stats()
  const spellUse: Record<number, number> = {}
  for (const k of Object.keys(s.spellUse).map(Number).sort((a, b) => a - b)) spellUse[k] = s.spellUse[k]
  return {
    seed,
    variant: s.variant,
    win: sum.win,
    rounds: sum.rounds,
    endReason: sum.endReason,
    failReason: sum.failReason,
    deaths: chars.filter(f => !f.alive).length,
    hpLeftPct,
    damageTaken: chars.reduce((a, f) => a + (fight.metrics[f.id]?.damageTaken ?? 0), 0),
    progress: sum.progress,
    score: fightScore(sum.win, hpLeftPct, sum.rounds, sum.progress),
    corruptedByRound: sum.corruptedByRound,
    hoursUsed: sum.hoursUsed,
    phase2Rounds: sum.phase2Rounds,
    vortexHpPct: sum.vortexHpPct,
    creativeActions: st.creativeActions,
    tactics: st.tactics,
    spellUse,
    unknownEffects: fight.unknownEffects ?? 0,
    nodes: st.nodes,
    eventsHash: fightDigest(fight),
  }
}

/** Reprend un combat depuis un point de contrôle avec une alternative ; `diceSeed` remplace la graine des dés. */
function resume(data: GameDataStore, spec: FightSpec, seed: number, base: Session, cp: Checkpoint, alt: RewindAlternative, record: boolean, diceSeed?: number): Session {
  const fight = base.engine.cloneFight(cp.fight, record)
  if (diceSeed !== undefined) fight.options = { ...fight.options, seed: diceSeed }
  const o: Overrides = {}
  if (alt.kind === 'policyAlt') {
    o.mode = alt.mode
    o.policy = alt.policy
  } else if (alt.kind === 'aiSeedJitter') o.aiSalt = alt.salt
  else if (alt.kind === 'thetaJitter') o.theta = jitterTheta(spec.theta, alt.salt)
  const spellUse = { ...cp.spellUse }
  const { controllers, provider } = makeProvider(base.engine, spec, seed, base.scenario, base.params, base.playerTeam, record, o, spellUse)
  // Même IA : on restaure le tableau noir ; autre IA : départ propre (l'instantané n'a pas de sens pour elle).
  if (alt.kind === 'none' || alt.kind === 'aiSeedJitter' || alt.kind === 'thetaJitter') controllers.restore(cp.brain)
  const s: Session = { ...base, fight, controllers, provider, spellUse }
  playWithCheckpoints(s)
  return s
}

/** θ perturbé de ±20 % (paramètres réglables strictement positifs), déterministe par sel. */
export function jitterTheta(theta: StrategyParams, salt: number): StrategyParams {
  const rng = new Rng(mix32(0x7e7a, salt))
  const flat = flattenTheta(theta)
  const values: Record<string, number> = {}
  for (const k of Object.keys(flat)) {
    if (!isTunablePath(k) || !(flat[k] > 0)) continue
    values[k] = roundSig(flat[k] * (0.8 + 0.4 * rng.next()), 4)
  }
  return thetaWithPaths(theta, values)
}

// ───────────────────────────── rembobinage ─────────────────────────────

export interface RewindOptions {
  /** Retours avant l'échec (tours de jeu, défaut [1, 2, 3]). */
  backs?: readonly number[]
  maxResumes?: number
  /** Modes essayés par `policyAlt` (défaut : scripted, fast, standard hors mode courant). */
  modes?: readonly AIMode[]
  /** Nombre de sels pour aiSeedJitter / thetaJitter (défaut 2 chacun). */
  jitters?: number
  /** Placements alternatifs essayés au tour 1 (défaut 4). */
  placements?: number
  /** Dés différents pour la sortie « robuste » (défaut 16 ; 0 = pas de sortie robuste). */
  robustSeeds?: number
  /** Enregistrer la ligne gagnante (replay). */
  record?: boolean
}

export interface RewindAttempt {
  /** Tour de jeu du point de contrôle (1 = début du combat). */
  from: number
  alternative: RewindAlternative
  label: string
  summary: FightSummary
}

export interface RewindResult {
  /** Toujours vrai : une ligne trouvée par rembobinage n'est jamais un taux de victoire. */
  optimistic: true
  original: FightSummary
  /** Tour de l'échec (première mort d'un personnage, sinon dernier tour). */
  failRound: number
  checkpoints: number[]
  attempts: RewindAttempt[]
  /** Ligne gagnante « mêmes dés ». */
  winningLine?: RewindAttempt & { replay?: Replay }
  /** Sortie « robuste » : au point de contrôle de la ligne (ou du meilleur essai), alternatives × dés différents. */
  robust?: { from: number; seeds: number; results: { label: string; winRate: number; meanScore: number }[]; best: string }
  /** Vérification : reprise « à l'identique » du premier point de contrôle = combat original (déterminisme). */
  deterministic: boolean
}

/** Premier tour où un personnage de l'équipe meurt (registre public), sinon dernier tour. */
export function failureRound(fight: FightState, playerTeam: TeamId = 0): number {
  for (const d of fight.deaths ?? []) {
    const v = fight.fighters[d.fighter]
    if (v?.team === playerTeam && v.kind === 'player') return d.round
  }
  return fight.round
}

/** Placements alternatifs : permutations circulaires du placement d'origine et cases rouges libres de la carte. */
function placementAlternatives(fight: FightState, team: TeamId, count: number): number[][] {
  const players = fight.fighters.filter(f => f.team === team && f.kind === 'player' && f.summonerId === undefined)
  const cells = players.map(f => f.cell)
  const red = (fight.map.redCells?.length ? fight.map.redCells : fight.map.cells.filter(c => c.placement === 1).map(c => c.id)).filter(c => fight.map.cells[c]?.walkable)
  const out: number[][] = []
  const seen = new Set<string>([cells.join(',')])
  const push = (p: number[]) => {
    const k = p.join(',')
    if (!seen.has(k) && new Set(p).size === p.length) {
      seen.add(k)
      out.push(p)
    }
  }
  for (let r = 1; r < cells.length && out.length < count; r++) push(cells.map((_, i) => cells[(i + r) % cells.length]))
  const free = red.filter(c => !cells.includes(c)).sort((a, b) => a - b)
  for (let i = 0; i < free.length && out.length < count; i++) push(cells.map((c, k) => (k === i % cells.length ? free[i] : c)))
  return out.slice(0, count)
}

/** Rembobinage d'un combat (voir l'en-tête). */
export function rewindFight(data: GameDataStore, spec: FightSpec, seed: number, opts: RewindOptions = {}): RewindResult {
  const record = opts.record ?? false
  const base = startSession(data, spec, seed, record)
  const checkpoints = new Map<number, Checkpoint>()
  playWithCheckpoints(base, checkpoints)
  const original = summarize(base, seed)
  const cpRounds = [...checkpoints.keys()].sort((a, b) => a - b)

  // Contrôle de déterminisme : reprise à l'identique depuis le point de contrôle du tour 2 (ou 1).
  const cpCheck = checkpoints.get(Math.min(2, cpRounds[cpRounds.length - 1] ?? 1)) ?? checkpoints.get(1)
  const deterministic = cpCheck ? summarize(resume(data, spec, seed, base, cpCheck, { kind: 'none' }, false), seed).eventsHash === original.eventsHash : true

  const failRound = failureRound(base.fight, base.playerTeam)
  const result: RewindResult = { optimistic: true, original, failRound, checkpoints: cpRounds, attempts: [], deterministic }
  if (original.win) return result

  const maxResumes = opts.maxResumes ?? 40
  const modes = (opts.modes ?? (['scripted', 'fast', 'standard'] as AIMode[])).filter(m => m !== spec.mode)
  const jit = opts.jitters ?? 2
  const alts: RewindAlternative[] = []
  for (const mode of modes) alts.push({ kind: 'policyAlt', mode })
  for (let k = 1; k <= jit; k++) alts.push({ kind: 'aiSeedJitter', salt: k }, { kind: 'thetaJitter', salt: k })

  const tryOne = (from: number, alt: RewindAlternative, cp: Checkpoint | null): RewindAttempt => {
    let s: Session
    if (alt.kind === 'placementAlt') {
      s = startSession(data, spec, seed, false, alt.placement)
      playWithCheckpoints(s)
    } else s = resume(data, spec, seed, base, cp!, alt, false)
    const a: RewindAttempt = { from, alternative: alt, label: alternativeLabel(alt), summary: summarize(s, seed) }
    result.attempts.push(a)
    return a
  }

  let found: RewindAttempt | undefined
  outer: for (const back of opts.backs ?? [1, 2, 3]) {
    const from = Math.max(1, failRound - back)
    const cpRound = cpRounds.filter(r => r <= from).pop()
    const cp = cpRound !== undefined ? checkpoints.get(cpRound)! : null
    if (!cp) continue
    for (const alt of alts) {
      if (result.attempts.length >= maxResumes) break outer
      if (result.attempts.some(a => a.from === cp.round && JSON.stringify(a.alternative) === JSON.stringify(alt))) continue
      const a = tryOne(cp.round, alt, cp)
      if (a.summary.win) {
        found = a
        break outer
      }
    }
  }
  if (!found) {
    // Placement initial (reprise au tour 1).
    for (const placement of placementAlternatives(base.fight, base.playerTeam, opts.placements ?? 4)) {
      if (result.attempts.length >= maxResumes) break
      const a = tryOne(1, { kind: 'placementAlt', placement }, null)
      if (a.summary.win) {
        found = a
        break
      }
    }
  }
  if (found) {
    let replay: Replay | undefined
    if (record) {
      const cp = checkpoints.get(found.from)
      let s: Session
      if (found.alternative.kind === 'placementAlt') {
        s = startSession(data, spec, seed, true, found.alternative.placement)
        playWithCheckpoints(s)
      } else s = resume(data, spec, seed, base, cp!, found.alternative, true)
      replay = toReplay(data, spec, { summary: summarize(s, seed), fight: s.fight, params: s.params }, {
        title: `Rembobinage — graine ${seed} — ligne gagnante (optimiste)`,
        description: `Reprise au tour ${found.from} : ${found.label}. Ligne « mêmes dés » trouvée par rembobinage : optimiste, jamais comptée dans un taux de victoire.`,
        generator: 'dofussimu-rewind',
      })
    }
    result.winningLine = { ...found, replay }
  }

  // Sortie robuste : au point de contrôle de la ligne (ou du meilleur essai), alternatives × dés différents.
  const nRobust = opts.robustSeeds ?? 16
  if (nRobust > 0 && result.attempts.length) {
    const ref = found ?? result.attempts.slice().sort((a, b) => b.summary.score - a.summary.score)[0]
    const cp = ref.alternative.kind === 'placementAlt' ? null : checkpoints.get(ref.from)
    if (cp) {
      const candidates: RewindAlternative[] = [{ kind: 'none' }, ...alts]
      const results = candidates.map(alt => {
        let wins = 0
        let score = 0
        for (let k = 0; k < nRobust; k++) {
          const s = summarize(resume(data, spec, seed, base, cp, alt, false, mix32(seed, 0x0b05 + k) | 0), seed)
          if (s.win) wins++
          score += s.score
        }
        return { label: alternativeLabel(alt), winRate: wins / nRobust, meanScore: score / nRobust }
      })
      const best = results.slice().sort((a, b) => b.winRate - a.winRate || b.meanScore - a.meanScore || a.label.localeCompare(b.label))[0]
      result.robust = { from: cp.round, seeds: nRobust, results, best: best.label }
    }
  }
  return result
}
