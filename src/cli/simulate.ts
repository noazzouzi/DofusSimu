/**
 * CLI de simulation (docs/design/ai.md §15.9) — WP4 : `npm run sim -- <commande> [options]`.
 *
 *   fight <scénario>   un combat (replay animé écrit dans web/public/replays/ + index.json lu par le visualiseur)
 *   batch <scénario>   Monte-Carlo sur N graines CRN (workers), IC de Wilson, arrêt séquentiel, causes d'échec,
 *                      variantes INCERTAINES (--robust), cache de campagne (runs/<campagne>.jsonl), replays notables
 *   bench              débit du pool (combats/s) pour 1, 2, 4 workers (banc B6 en ligne de commande)
 *   presets            liste des presets (classe, rôle, élément, stuff, PA/PM/PV calculés)
 *   tune | stuff | team | optimize | rewind | report   → lots suivants (WP4b), « non implémenté »
 *
 * Scénarios : identifiant du registre (src/dungeons, ex. `vortex`) ou combat de contrôle
 * `control:<carte>:<monstre>[*n][@grade],…` (src/optimizer/runner.ts).
 * Équipe : `--team iop:killer,cra:feu,enutrof:mpLock,pandawa:placer` (preset exact ou classe:rôle|élément|mot, stuff
 * facultatif après '@' : `iop:killer@unstuffed`) — src/optimizer/team/presets.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTheta, type AIMode, type ThetaOverrides } from '../ai'
import type { DataStore } from '../data/store'
import { loadDataStore } from '../data/node'
import { openCampaignCache, type FightCache } from '../optimizer/cache'
import { notableSeeds, runBatch } from '../optimizer/montecarlo'
import { createNodePool, defaultPoolSize } from '../optimizer/pool/node'
import { createLocalPool, type ManagedPool } from '../optimizer/pool/pool'
import { runOne, toReplay } from '../optimizer/runner'
import { campaignSeeds } from '../optimizer/seeds'
import { failReasons, worstVariant } from '../optimizer/stats'
import { PRESETS, parseTeam, validatePreset, type StuffChoice } from '../optimizer/team/presets'
import type { FightSpec, FightSummary, StopRule } from '../optimizer/types'
import type { Replay } from '../replay/types'

const COMMANDS = ['fight', 'batch', 'bench', 'presets', 'tune', 'stuff', 'team', 'optimize', 'rewind', 'report'] as const
const MODES: readonly AIMode[] = ['scripted', 'fast', 'standard', 'deep']

/** Équipe par défaut (exemple du design §15.9). */
export const DEFAULT_TEAM = 'iop:killer,cra:killer,enutrof:mpLock,pandawa:placer'
/** Racine du dépôt (src/cli → ../..). */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** Dossier des replays lus par le visualiseur (index.json). */
export const REPLAY_DIR = join(REPO_ROOT, 'web', 'public', 'replays')

function usage(): string {
  return [
    'Usage : npm run sim -- <commande> [options]',
    '',
    '  fight <scénario>  [--team T] [--ai scripted|fast|standard|deep] [--policy ai|random] [--seed N]',
    '                    [--stuff default|unstuffed|naked|<stuff>] [--robust] [--replay <fichier>|auto|none] [--replay-dir D] [--json]',
    '  batch <scénario>  [--team T] [--ai M] [--runs N] [--workers W] [--master-seed S] [--robust]',
    '                    [--min-n N --max-n N --half-width H] [--campaign nom] [--cache-version v] [--micro prefix12|phase2|poutch]',
    '                    [--replays] [--replay-dir D] [--json]',
    '  bench             [--workers 1,2,4] [--runs N] [--ai M] [--scenario S] [--team T]',
    '  presets           [--class iop] [--stuff S]',
    '',
    `  Équipe par défaut : ${DEFAULT_TEAM}`,
    '  Scénario : vortex | control:<carte>:<monstre>[*n][@grade],… (combat de contrôle)',
    `  Commandes : ${COMMANDS.join(' | ')}`,
  ].join('\n')
}

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

const str = (a: Args, k: string): string | undefined => {
  const v = a.flags.get(k)
  return typeof v === 'string' ? v : undefined
}
const num = (a: Args, k: string, def: number): number => {
  const v = str(a, k)
  if (v === undefined) return def
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`--${k} : nombre attendu (« ${v} »)`)
  return n
}
const bool = (a: Args, k: string): boolean => a.flags.has(k) && a.flags.get(k) !== 'false'

function modeOf(a: Args, def: AIMode): AIMode {
  const m = (str(a, 'ai') ?? def) as AIMode
  if (!MODES.includes(m)) throw new Error(`--ai : ${MODES.join('|')} attendu (« ${m} »)`)
  return m
}

/** θ : défaut + surcharge facultative `--theta fichier.json`. */
function thetaOf(a: Args) {
  const file = str(a, 'theta')
  return loadTheta(file ? (JSON.parse(readFileSync(resolve(file), 'utf8')) as ThetaOverrides) : undefined)
}

function specOf(a: Args, data: DataStore, scenarioId: string, defMode: AIMode): FightSpec {
  const policy = str(a, 'policy') ?? 'ai'
  if (policy !== 'ai' && policy !== 'random') throw new Error(`--policy : ai|random attendu (« ${policy} »)`)
  return {
    scenarioId,
    team: parseTeam(str(a, 'team') ?? DEFAULT_TEAM, data, { stuff: (str(a, 'stuff') ?? 'default') as StuffChoice }),
    mode: modeOf(a, defMode),
    theta: thetaOf(a),
    variantPolicy: bool(a, 'robust') ? 'sampled' : 'default',
    monsterNoise: num(a, 'noise', 0),
    playerPolicy: policy === 'random' ? 'random' : undefined,
  }
}

const pct = (x: number): string => `${(100 * x).toFixed(1)} %`

/** Dossier des replays (`--replay-dir`, défaut web/public/replays). */
const replayDirOf = (a: Args): string => resolve(str(a, 'replay-dir') ?? REPLAY_DIR)

function describe(s: FightSummary): string {
  return [
    `${s.win ? 'VICTOIRE' : 'DÉFAITE'} en ${s.rounds} tours (${s.endReason}${s.failReason ? ` — ${s.failReason}` : ''})`,
    `morts ${s.deaths}, PV restants ${pct(s.hpLeftPct)}, dégâts subis ${Math.round(s.damageTaken)}, progression ${pct(s.progress)}, score ${s.score.toFixed(3)}`,
    `variante ${s.variant}, nœuds IA ${s.nodes}, coups créatifs ${s.creativeActions}, effets inconnus ${s.unknownEffects}, empreinte ${s.eventsHash}`,
  ].join('\n')
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

/** Rejoue une graine avec enregistrement et écrit son replay (`label` : suffixe du nom de fichier). */
function saveReplay(data: DataStore, spec: FightSpec, seed: number, out: string | undefined, label: string, dir = REPLAY_DIR, title?: string): string {
  const res = runOne(data, spec, seed, { record: true })
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

// ───────────────────────────── commandes ─────────────────────────────

function cmdFight(a: Args, data: DataStore): number {
  const scenarioId = a.positional[0] ?? 'vortex'
  const spec = specOf(a, data, scenarioId, 'fast')
  const seed = num(a, 'seed', 1) >>> 0
  const replayFlag = bool(a, 'no-replay') ? 'none' : str(a, 'replay') ?? 'auto'
  const t0 = performance.now()
  const { summary } = runOne(data, spec, seed)
  const ms = performance.now() - t0
  if (bool(a, 'json')) console.log(JSON.stringify({ summary, ms }, null, 2))
  else console.log(`${scenarioId} — ${spec.mode}${spec.playerPolicy === 'random' ? ' (aléatoire)' : ''}, graine ${seed} (${ms.toFixed(0)} ms)\n${describe(summary)}`)
  if (replayFlag !== 'none') {
    const path = saveReplay(data, spec, seed, replayFlag === 'auto' ? undefined : replayFlag, 'fight', replayDirOf(a))
    console.log(`Replay : ${relative(process.cwd(), path)}`)
  }
  return 0
}

async function withPool<T>(workers: number, f: (pool: ManagedPool) => Promise<T>, data: DataStore): Promise<T> {
  const pool = workers > 0 ? createNodePool(workers) : createLocalPool(data)
  try {
    return await f(pool)
  } finally {
    await pool.close()
  }
}

async function cmdBatch(a: Args, data: DataStore): Promise<number> {
  const scenarioId = a.positional[0] ?? 'vortex'
  const spec = specOf(a, data, scenarioId, 'fast')
  const runs = num(a, 'runs', 100)
  const workers = num(a, 'workers', defaultPoolSize())
  const master = num(a, 'master-seed', 1) >>> 0
  const seeds = campaignSeeds(master, runs)
  const stop: StopRule | undefined = a.flags.has('min-n') || a.flags.has('half-width') || a.flags.has('max-n')
    ? { minN: num(a, 'min-n', 32), maxN: num(a, 'max-n', runs), halfWidth: num(a, 'half-width', 0.03) }
    : undefined
  const campaign = str(a, 'campaign')
  const cache: FightCache | undefined = campaign ? openCampaignCache(campaign, join(REPO_ROOT, 'runs'), str(a, 'cache-version')) : undefined
  const t0 = performance.now()
  let last = 0
  const run = await withPool(
    workers,
    pool =>
      runBatch(spec, seeds, pool, {
        stop,
        cache,
        kind: (str(a, 'micro') as 'prefix12' | 'phase2' | 'poutch' | undefined) ?? 'full',
        onProgress: (done, planned) => {
          const t = performance.now()
          if (!bool(a, 'json') && (t - last > 2000 || done === planned)) {
            last = t
            process.stderr.write(`\r${done}/${planned} combats…`)
          }
        },
      }),
    data,
  )
  const ms = performance.now() - t0
  if (!bool(a, 'json')) process.stderr.write('\n')
  const r = run.result
  const worst = worstVariant(r)
  const fails = failReasons(run.summaries)
  const out = {
    scenarioId,
    mode: spec.mode,
    policy: spec.playerPolicy ?? 'ai',
    team: spec.team.map(m => m.presetId),
    workers,
    masterSeed: master,
    result: r,
    worstVariant: worst,
    failReasons: fails,
    computed: run.computed,
    cached: run.cached,
    seconds: ms / 1000,
    fightsPerSecond: run.computed / Math.max(1e-9, ms / 1000),
  }
  const summaryFile = join(REPO_ROOT, 'runs', `${campaign ?? `batch-${scenarioId.replace(/[^A-Za-z0-9]+/g, '-')}-${spec.mode}`}.summary.json`)
  mkdirSync(dirname(summaryFile), { recursive: true })
  writeFileSync(summaryFile, JSON.stringify({ ...out, summaries: run.summaries }, null, 1))
  if (bool(a, 'json')) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`${scenarioId} — ${spec.mode}${spec.playerPolicy === 'random' ? ' (aléatoire)' : ''}, ${r.n} combats (${run.computed} joués, ${run.cached} en cache) en ${(ms / 1000).toFixed(1)} s (${out.fightsPerSecond.toFixed(2)} combats/s, ${workers} worker(s))`)
    console.log(`Victoires ${r.wins}/${r.n} = ${pct(r.winRate)}  IC95 Wilson [${pct(r.wilson95[0])} ; ${pct(r.wilson95[1])}]`)
    console.log(`Score moyen ${r.meanScore.toFixed(3)}, tours moyens ${r.meanRounds.toFixed(1)}, p10 PV restants ${pct(r.p10HpLeft)}`)
    for (const [k, v] of Object.entries(r.byVariant)) console.log(`  variante ${k} : ${v.n} combats, ${pct(v.winRate)}`)
    if (worst && Object.keys(r.byVariant).length > 1) console.log(`  pire variante : ${worst.key} (${pct(worst.winRate)})`)
    for (const f of fails.slice(0, 6)) console.log(`  échec « ${f.reason} » : ${f.n}`)
    console.log(`Résumé : ${relative(process.cwd(), summaryFile)}`)
  }
  if (bool(a, 'replays')) {
    const notable = notableSeeds(run.summaries)
    for (const [label, seed] of Object.entries(notable)) {
      if (seed === undefined) continue
      const path = saveReplay(data, spec, seed, undefined, label, replayDirOf(a))
      console.log(`Replay ${label} (graine ${seed}) : ${relative(process.cwd(), path)}`)
    }
  }
  return 0
}

async function cmdBench(a: Args, data: DataStore): Promise<number> {
  const scenarioId = str(a, 'scenario') ?? 'vortex'
  const spec = specOf(a, data, scenarioId, 'fast')
  const runs = num(a, 'runs', 32)
  const sizes = (str(a, 'workers') ?? '1,2,4').split(',').map(Number).filter(n => n >= 0)
  const seeds = campaignSeeds(num(a, 'master-seed', 7) >>> 0, runs)
  const rows: { workers: number; seconds: number; fightsPerSecond: number; winRate: number }[] = []
  for (const w of sizes) {
    const t0 = performance.now()
    const run = await withPool(w, pool => runBatch(spec, seeds, pool), data)
    const s = (performance.now() - t0) / 1000
    rows.push({ workers: w, seconds: s, fightsPerSecond: runs / s, winRate: run.result.winRate })
    console.log(`${w} worker(s) : ${runs} combats ${spec.mode} en ${s.toFixed(2)} s → ${(runs / s).toFixed(2)} combats/s (victoires ${pct(run.result.winRate)})`)
  }
  if (bool(a, 'json')) console.log(JSON.stringify(rows, null, 2))
  return 0
}

function cmdPresets(a: Args, data: DataStore): number {
  const cls = str(a, 'class')
  const stuff = (str(a, 'stuff') ?? 'default') as StuffChoice
  for (const p of PRESETS) {
    if (cls && !p.className.toLowerCase().includes(cls.toLowerCase()) && !p.id.includes(cls.toLowerCase())) continue
    const r = validatePreset(p, data, stuff)
    const s = r.stats
    console.log(
      `${p.id.padEnd(28)} ${p.className.padEnd(11)} ${p.role.padEnd(8)} ${p.element.padEnd(6)} ${(stuff === 'default' ? p.stuff : stuff).padEnd(9)} ` +
        `${r.valid ? 'OK ' : 'ERR'} ${s.ap} PA ${s.mp} PM ${s.range} PO ${r.maxHp} PV  rotation ${p.rotation.length} sorts`,
    )
    if (!r.valid) for (const w of r.warnings) console.log(`    ${w}`)
  }
  return 0
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(usage())
    return 0
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    console.error(`Commande inconnue : ${cmd}\n${usage()}`)
    return 2
  }
  const a = parseArgs(rest)
  try {
    const data = loadDataStore(str(a, 'data') ?? 'data')
    switch (cmd) {
      case 'fight':
        return cmdFight(a, data)
      case 'batch':
        return await cmdBatch(a, data)
      case 'bench':
        return await cmdBench(a, data)
      case 'presets':
        return cmdPresets(a, data)
      default:
        console.error(`« ${cmd} » : non implémenté (lot WP4b : réglage θ, stuff, composition, rembobinage, rapport).`)
        return 2
    }
  } catch (e) {
    console.error(`Erreur : ${(e as Error).message}`)
    return 1
  }
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] && /simulate\.[cm]?[jt]s$/.test(process.argv[1])
if (invokedDirectly) void main(process.argv.slice(2)).then(code => (process.exitCode = code))
