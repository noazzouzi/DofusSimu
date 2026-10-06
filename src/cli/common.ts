/**
 * Outils partagés des commandes de la CLI (src/cli/simulate.ts, src/cli/optimize.ts) : arguments, θ, paramètres de
 * scénario, ÉQUIPE (composition de l'utilisateur : `--team`, `--classes`, `--team-file`, `data/teams/<scénario>.json`),
 * spécification de combat, pool de workers, replays (index.json du visualiseur), tableau des personnages.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTheta, type AIMode, type ThetaOverrides } from '../ai'
import type { TeamId } from '../core/types'
import type { DataStore } from '../data/store'
import type { FightState } from '../engine/types'
import { createNodePool } from '../optimizer/pool/node'
import { createLocalPool, type ManagedPool } from '../optimizer/pool/pool'
import { runMicro, runOne, toReplay, type RunResult } from '../optimizer/runner'
import { parseTeam, type StuffChoice } from '../optimizer/team/presets'
import { findTeamFile, loadTeamFile, TEAMS_DIR } from '../optimizer/team/teamfile'
import {
  compositionFromClasses,
  compositionFromTeamText,
  describeComposition,
  parseClasses,
  resolveComposition,
  type BuildOption,
  type UserComposition,
} from '../optimizer/team/userteam'
import type { FightSpec, FightSummary, MemberSpec, WorkerTask } from '../optimizer/types'
import type { Replay } from '../replay/types'

export const MODES: readonly AIMode[] = ['scripted', 'fast', 'standard', 'deep']

/** Équipe d'exemple historique (design §15.9) : dernier recours quand le scénario n'a pas de fichier d'équipe. */
export const DEFAULT_TEAM = 'iop:killer,cra:killer,enutrof:mpLock,pandawa:placer'
/** Racine du dépôt (src/cli → ../..). */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** Dossier des replays lus par le visualiseur (index.json). */
export const REPLAY_DIR = join(REPO_ROOT, 'web', 'public', 'replays')
/** Dossier des rapports. */
export const REPORTS_DIR = join(REPO_ROOT, 'docs', 'reports')
/** Dossier des campagnes (caches JSONL, résumés). */
export const RUNS_DIR = join(REPO_ROOT, 'runs')

// ───────────────────────────── arguments ─────────────────────────────

export interface Args {
  positional: string[]
  flags: Map<string, string | true>
}

/** `--clé valeur`, `--clé=valeur`, `--drapeau` (booléen si suivi d'une autre option ou de rien). */
export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const eq = a.indexOf('=')
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1))
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags.set(a.slice(2), argv[++i])
    else flags.set(a.slice(2), true)
  }
  return { positional, flags }
}

export const str = (a: Args, k: string): string | undefined => {
  const v = a.flags.get(k)
  return typeof v === 'string' ? v : undefined
}
export const num = (a: Args, k: string, def: number): number => {
  const v = str(a, k)
  if (v === undefined) return def
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`--${k} : nombre attendu (« ${v} »)`)
  return n
}
export const bool = (a: Args, k: string): boolean => a.flags.has(k) && a.flags.get(k) !== 'false'

export function modeOf(a: Args, def: AIMode): AIMode {
  const m = (str(a, 'ai') ?? def) as AIMode
  if (!MODES.includes(m)) throw new Error(`--ai : ${MODES.join('|')} attendu (« ${m} »)`)
  return m
}

/** θ : défaut + surcharge facultative `--theta fichier.json`. */
export function thetaOf(a: Args) {
  const file = str(a, 'theta')
  return loadTheta(file ? (JSON.parse(readFileSync(resolve(file), 'utf8')) as ThetaOverrides) : undefined)
}

/** Liste d'entiers `1,2,3` (cases de placement, graines). */
export function intList(text: string, flag: string): number[] {
  const out = text.split(',').map(x => Number(x.trim()))
  if (!out.every(Number.isInteger)) throw new Error(`--${flag} : liste d'entiers attendue (« ${text} »)`)
  return out
}

/**
 * Paramètres de scénario imposés : `--param clé=valeur,clé2=valeur2` (nombre, booléen, liste `a;b;c` de nombres, ou
 * texte) — ex. `--param maxRounds=40,arrivalRounds=1;6;11;16;21`.
 */
export function parseParams(text: string | undefined): Record<string, number | string | boolean | number[]> | undefined {
  if (!text) return undefined
  const out: Record<string, number | string | boolean | number[]> = {}
  for (const part of text.split(',').map(x => x.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    if (eq <= 0) throw new Error(`--param : clé=valeur attendu (« ${part} »)`)
    const k = part.slice(0, eq)
    const v = part.slice(eq + 1)
    if (v === 'true' || v === 'false') out[k] = v === 'true'
    else if (v.includes(';')) out[k] = v.split(';').map(Number)
    else if (v !== '' && Number.isFinite(Number(v))) out[k] = Number(v)
    else out[k] = v
  }
  return out
}

export const pct = (x: number): string => `${(100 * x).toFixed(1)} %`

/** Dossier des replays (`--replay-dir`, défaut web/public/replays). */
export const replayDirOf = (a: Args): string => resolve(str(a, 'replay-dir') ?? REPLAY_DIR)
/** Dossier des données (`--data`, défaut 'data'), partagé par le processus principal et les workers. */
export const dataDirOf = (a: Args): string => str(a, 'data') ?? 'data'

// ───────────────────────────── équipe : composition de l'utilisateur ─────────────────────────────

export interface TeamChoice {
  team: MemberSpec[]
  /** Composition (absente pour l'équipe d'exemple historique). */
  composition?: UserComposition
  /** Option de build de chaque membre (absente pour `--team` et l'équipe d'exemple). */
  options?: BuildOption[]
  /** Scénario dont les presets donnent les builds par défaut (celui du fichier d'équipe, sinon celui du combat). */
  buildScenario: string
  /** Libellé de la source (CLI). */
  label: string
}

/** Dossiers où chercher `<scénario>.json` : `--teams-dir`, sinon `<--data>/teams` puis data/teams du dépôt. */
export function teamsDirsOf(a: Args): string[] {
  const explicit = str(a, 'teams-dir')
  if (explicit) return [resolve(explicit)]
  return [...new Set([resolve(dataDirOf(a), 'teams'), TEAMS_DIR])]
}

/** Composition demandée : `--team`, `--classes`, `--team-file`, fichier d'équipe du scénario (sinon undefined). */
export function compositionOf(a: Args, scenarioId: string): UserComposition | undefined {
  // Option donnée sans valeur (`--team` seul, ou suivie d'une autre option) : erreur plutôt qu'un repli silencieux sur
  // le fichier d'équipe du scénario.
  if (a.flags.get('team') === true) throw new Error('--team : équipe attendue (ex. cra_feu_vortex,enutrof_retrait_pm_vortex,…)')
  if (a.flags.get('classes') === true) throw new Error('--classes : liste de classes attendue (ex. eniripsa,enutrof,cra,cra)')
  if (a.flags.get('team-file') === true) throw new Error('--team-file : chemin du fichier d’équipe attendu (ex. data/teams/vortex.json)')
  const team = str(a, 'team')
  const classes = str(a, 'classes')
  const file = str(a, 'team-file')
  if ([team, classes, file].filter(x => x !== undefined).length > 1) throw new Error('--team, --classes et --team-file sont exclusifs (une seule source de composition)')
  if (team !== undefined) return compositionFromTeamText(team, scenarioId)
  if (classes !== undefined) return compositionFromClasses(parseClasses(classes), scenarioId)
  const path = file ?? findTeamFile(scenarioId, teamsDirsOf(a))
  if (!path) return undefined
  const comp = loadTeamFile(path).composition
  // Chemin affiché relatif au dossier courant quand le fichier y est (data/teams/vortex.json).
  const r = relative(process.cwd(), resolve(path))
  return { ...comp, file: r && !r.startsWith('..') && !isAbsolute(r) ? r : resolve(path) }
}

/**
 * Équipe d'une commande (voir `src/optimizer/team/userteam.ts`) : `--team` (builds exacts, comportement historique de
 * `parseTeam`), `--classes` (classes de l'utilisateur, builds par défaut du scénario) ou `--team-file` — options
 * EXCLUSIVES —, sinon le fichier d'équipe du scénario (`data/teams/<scénario>.json`), sinon l'équipe d'exemple
 * `DEFAULT_TEAM`. `--stuff` (hors 'default') s'applique à tous les membres.
 */
export function teamChoiceOf(a: Args, data: DataStore, scenarioId: string): TeamChoice {
  const stuff = (str(a, 'stuff') ?? 'default') as StuffChoice
  const comp = compositionOf(a, scenarioId)
  const teamText = str(a, 'team')
  if (teamText !== undefined) {
    return { team: parseTeam(teamText, data, { stuff }), composition: comp, buildScenario: scenarioId, label: `--team ${teamText}` }
  }
  if (!comp) {
    return { team: parseTeam(DEFAULT_TEAM, data, { stuff }), buildScenario: scenarioId, label: `équipe d'exemple ${DEFAULT_TEAM} (aucun fichier d'équipe pour « ${scenarioId} »)` }
  }
  if (stuff !== 'default') for (const m of comp.members) Object.assign(m, { stuff, build: undefined, preset: m.preset?.split('@')[0] })
  const buildScenario = comp.scenarioId ?? scenarioId
  const { team, options } = resolveComposition(comp, data, buildScenario)
  return { team, composition: comp, options, buildScenario, label: describeComposition(comp) }
}

/** Ligne « Équipe : … » de la CLI. */
export function teamLine(choice: TeamChoice): string {
  const builds = choice.options ? choice.options.map(o => `${o.member.name}=${o.id}`) : choice.team.map(m => `${m.name}=${m.presetId}`)
  return `Équipe : ${builds.join(', ')} — ${choice.label}`
}

/** Spécification de combat SANS équipe (scénario, mode, θ, paramètres, placement, politique, bruit). */
export function baseSpecOf(a: Args, scenarioId: string, defMode: AIMode): Omit<FightSpec, 'team'> {
  const policy = str(a, 'policy') ?? 'ai'
  if (policy !== 'ai' && policy !== 'random') throw new Error(`--policy : ai|random attendu (« ${policy} »)`)
  const placement = str(a, 'placement')
  const params = parseParams(str(a, 'param'))
  return {
    scenarioId,
    placement: placement ? intList(placement, 'placement') : undefined,
    params,
    mode: modeOf(a, defMode),
    theta: thetaOf(a),
    variantPolicy: bool(a, 'robust') ? 'sampled' : 'default',
    monsterNoise: num(a, 'noise', 0),
    playerPolicy: policy === 'random' ? 'random' : undefined,
  }
}

/** Spécification de combat d'une commande (équipe : `teamChoiceOf`). */
export function specOf(a: Args, data: DataStore, scenarioId: string, defMode: AIMode, choice = teamChoiceOf(a, data, scenarioId)): FightSpec {
  const base = baseSpecOf(a, scenarioId, defMode)
  return { ...base, team: choice.team }
}

export function describe(s: FightSummary): string {
  return [
    `${s.win ? 'VICTOIRE' : 'DÉFAITE'} en ${s.rounds} tours (${s.endReason}${s.failReason ? ` — ${s.failReason}` : ''})`,
    `morts ${s.deaths}${s.firstDeathRound !== undefined ? ` (première au tour ${s.firstDeathRound})` : ''}, PV restants ${pct(s.hpLeftPct)}, dégâts subis ${Math.round(s.damageTaken)}, progression ${pct(s.progress)}, score ${s.score.toFixed(3)}`,
    `variante ${s.variant}, nœuds IA ${s.nodes}, coups créatifs ${s.creativeActions}, effets inconnus ${s.unknownEffects}, empreinte ${s.eventsHash}`,
  ].join('\n')
}

// ───────────────────────────── pool ─────────────────────────────

export async function withPool<T>(workers: number, f: (pool: ManagedPool) => Promise<T>, data: DataStore, dataDir = 'data'): Promise<T> {
  // Les workers chargent le MÊME dossier de données que le processus principal (`--data`).
  const pool = workers > 0 ? createNodePool(workers, { dataDir: resolve(dataDir) }) : createLocalPool(data)
  try {
    return await f(pool)
  } finally {
    await pool.close()
  }
}

// ───────────────────────────── replays ─────────────────────────────

export interface ReplayIndexEntry {
  file: string
  title: string
  scenario?: string
  seed?: number
  win?: boolean
  rounds?: number
  createdAt?: string
}

/** Écrit un replay et met à jour `index.json` du même dossier (entrée remplacée si le fichier existe déjà). */
export function writeReplay(file: string, replay: Replay, entry: Omit<ReplayIndexEntry, 'file'>): string {
  const path = resolve(file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(replay))
  const indexPath = join(dirname(path), 'index.json')
  let list: ReplayIndexEntry[] = []
  if (existsSync(indexPath)) {
    try {
      const raw = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown
      const arr = Array.isArray(raw) ? raw : (raw as { replays?: unknown[] })?.replays
      if (Array.isArray(arr)) list = arr as ReplayIndexEntry[]
    } catch {
      /* index illisible : reconstruit */
    }
  }
  const name = basename(path)
  list = list.filter(e => e.file !== name)
  list.unshift({ file: name, ...entry })
  writeFileSync(indexPath, JSON.stringify({ replays: list }, null, 2) + '\n')
  return path
}

/**
 * Tableau des personnages (et invocations alliées) d'un combat : PV restants, dégâts infligés/subis, soins, retraits,
 * kills (métriques du moteur).
 */
export function fighterTable(fight: FightState, team: TeamId = 0): string {
  const rows = [['', 'PV', 'dégâts', 'subis', 'soins', 'PA/PM retirés', 'kills']]
  for (const f of fight.fighters) {
    if (f.team !== team) continue
    const m = fight.metrics[f.id]
    if (f.kind === 'summon' && !(m?.damageDealt || m?.healingDone)) continue
    rows.push([
      `${f.kind === 'summon' ? '  ↳ ' : ''}${f.name}${f.role ? ` (${f.role})` : ''}`,
      f.alive ? `${f.hp}/${f.maxHp}` : 'mort',
      String(Math.round(m?.damageDealt ?? 0)),
      String(Math.round(m?.damageTaken ?? 0)),
      String(Math.round(m?.healingDone ?? 0)),
      `${(m?.apRemoved ?? 0).toFixed(0)}/${(m?.mpRemoved ?? 0).toFixed(0)}`,
      String(m?.kills ?? 0),
    ])
  }
  const widths = rows[0].map((_, j) => Math.max(...rows.map(r => r[j].length)))
  return rows.map(r => r.map((c, j) => (j === 0 ? c.padEnd(widths[j]) : c.padStart(widths[j]))).join('  ')).join('\n')
}

/** Écrit le replay d'un combat joué avec `record: true` (`label` : suffixe du nom de fichier). */
export function writeFightReplay(data: DataStore, spec: FightSpec, res: RunResult, out: string | undefined, label: string, dir = REPLAY_DIR, title?: string): string {
  const seed = res.summary.seed
  const createdAt = new Date().toISOString()
  const replay = toReplay(data, spec, res, { generator: 'dofussimu-cli (npm run sim)', createdAt, title })
  const scen = spec.scenarioId.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const file = out ?? join(dir, `${scen}-${spec.mode}-${label}-s${seed}.json`)
  return writeReplay(file, replay, {
    title: replay.meta?.title ?? file,
    scenario: spec.scenarioId,
    seed,
    win: res.summary.win,
    rounds: res.summary.rounds,
    createdAt,
  })
}

/**
 * Rejoue une graine avec enregistrement et écrit son replay (`kind` : combat complet, ou le micro-scénario du lot —
 * le replay montre alors exactement ce qui a été évalué).
 */
export function saveReplay(data: DataStore, spec: FightSpec, seed: number, out: string | undefined, label: string, dir = REPLAY_DIR, title?: string, kind: WorkerTask['kind'] = 'full'): string {
  if (kind === 't0') throw new Error("Pas de replay pour une tâche 't0' (modèle analytique)")
  const res = kind === 'full' ? runOne(data, spec, seed, { record: true }) : runMicro(data, spec, seed, kind, { record: true })
  return writeFightReplay(data, spec, res, out, kind === 'full' ? label : `${kind}-${label}`, dir, title)
}
