/**
 * Cache des combats d'une campagne (docs/design/ai.md §15.2) — WP4.
 *
 * Clé = (versions code/données, scénario + paramètres, équipe, θ, mode, politique, bruit, variantes, type de tâche,
 * graine) → `FightSummary`. Stockage JSONL `runs/<campagne>.jsonl` (une ligne `{"k":clé,"v":version,"s":résumé}` par
 * combat, ajout immédiat) : une campagne interrompue reprend sans rejouer les graines faites ; une ligne d'une autre
 * version est ignorée (un changement de version invalide tout). `MemoryFightCache` : même interface, en mémoire.
 *
 * Version par défaut (`cacheVersion`) : `OPTIMIZER_CACHE_VERSION` + version du paquet + empreinte du manifeste des
 * données (data/dofusdb/manifest.json) + empreinte du CODE (`sourceFingerprint` : sources TypeScript de src/ hors CLI et
 * paramètres data/ai/*.json — θ, presets, calibration). Toute modification du moteur, de l'IA, des scénarios ou de
 * l'optimiseur invalide donc les résultats en cache (§15.2 : « un changement de version invalide tout ») : une
 * campagne relancée après l'arrivée de l'IA réelle ne réutilise pas les combats joués par les bouchons. Une version
 * explicite (CLI `--cache-version`) remplace ce calcul.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { thetaHash } from '../ai/theta'
import { fnv1a32 } from '../core/hash'
import type { FightSpec, FightSummary, WorkerTask } from './types'

/** À incrémenter quand le moteur, l'IA ou le résumé changent de façon incompatible. */
export const OPTIMIZER_CACHE_VERSION = 1

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const fingerprints = new Map<string, string>()

/**
 * Empreinte du code qui détermine un combat : sources TypeScript de `src/` (hors `src/cli`, sans effet sur un combat) et
 * `data/ai/*.json` sous `root`, triés par chemin, chemin et contenu hachés (FNV-1a 2 × 32 bits). Calculée une fois par
 * processus et par racine (≈ 2 Mo lus) ; '0' si `root` n'a pas de sources (code empaqueté).
 */
export function sourceFingerprint(root = REPO_ROOT): string {
  const cached = fingerprints.get(root)
  if (cached !== undefined) return cached
  const files: string[] = []
  const src = join(root, 'src')
  if (existsSync(src)) {
    for (const f of readdirSync(src, { recursive: true }) as string[]) {
      const rel = f.split('\\').join('/')
      if (rel.endsWith('.ts') && !rel.startsWith('cli/')) files.push(`src/${rel}`)
    }
  }
  const ai = join(root, 'data', 'ai')
  if (existsSync(ai)) for (const f of readdirSync(ai)) if (f.endsWith('.json')) files.push(`data/ai/${f}`)
  files.sort()
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (const f of files) {
    const text = `${f}\n${readFileSync(join(root, f), 'utf8')}\n`
    a = fnv1a32(text, a)
    b = fnv1a32(text, b)
  }
  const out = files.length ? `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}` : '0'
  fingerprints.set(root, out)
  return out
}

/** Version par défaut des entrées du cache (voir l'en-tête). */
export function cacheVersion(dataDir = 'data'): string {
  let pkg = '0'
  let manifest = 0
  try {
    pkg = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0'
  } catch {
    /* paquet introuvable */
  }
  for (const dir of [resolve(dataDir), resolve(REPO_ROOT, dataDir)]) {
    const f = join(dir, 'dofusdb', 'manifest.json')
    if (existsSync(f)) {
      manifest = fnv1a32(readFileSync(f, 'utf8'))
      break
    }
  }
  return `v${OPTIMIZER_CACHE_VERSION}-${pkg}-${manifest.toString(16)}-${sourceFingerprint()}`
}

/** JSON canonique (clés triées) d'une valeur. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** Empreinte d'une configuration (tout ce qui influe sur le combat, sauf la graine). */
export function specKey(spec: FightSpec, kind: WorkerTask['kind'] = 'full'): string {
  const body = canonicalJson({
    scenarioId: spec.scenarioId,
    params: spec.params ?? {},
    team: spec.team.map(m => ({ breedId: m.breedId, presetId: m.presetId, build: m.build, variants: m.variants, role: m.role, name: m.name })),
    placement: spec.placement ?? null,
    mode: spec.mode,
    playerPolicy: spec.playerPolicy ?? 'ai',
    theta: thetaHash(spec.theta),
    variantPolicy: spec.variantPolicy,
    monsterNoise: spec.monsterNoise,
    kind,
  })
  return `${fnv1a32(body).toString(16).padStart(8, '0')}${fnv1a32(body, 0x9e3779b9).toString(16).padStart(8, '0')}`
}

/** Clé d'un combat dans le cache. */
export function cacheKey(spec: FightSpec, seed: number, kind: WorkerTask['kind'] = 'full'): string {
  return `${specKey(spec, kind)}:${seed >>> 0}`
}

export interface FightCache {
  readonly version: string
  get(spec: FightSpec, seed: number, kind?: WorkerTask['kind']): FightSummary | undefined
  put(spec: FightSpec, seed: number, summary: FightSummary, kind?: WorkerTask['kind']): void
  readonly size: number
}

/** Cache en mémoire (navigateur, tests). */
export class MemoryFightCache implements FightCache {
  protected readonly map = new Map<string, FightSummary>()
  constructor(readonly version = `v${OPTIMIZER_CACHE_VERSION}`) {}
  get size(): number {
    return this.map.size
  }
  get(spec: FightSpec, seed: number, kind: WorkerTask['kind'] = 'full'): FightSummary | undefined {
    return this.map.get(cacheKey(spec, seed, kind))
  }
  put(spec: FightSpec, seed: number, summary: FightSummary, kind: WorkerTask['kind'] = 'full'): void {
    this.map.set(cacheKey(spec, seed, kind), summary)
  }
}

/** Cache JSONL d'une campagne (Node). */
export class JsonlFightCache extends MemoryFightCache {
  /** Lignes ignorées au chargement (autre version, illisibles). */
  readonly skipped: number

  constructor(readonly file: string, version = cacheVersion()) {
    super(version)
    let skipped = 0
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const row = JSON.parse(line) as { k: string; v: string; s: FightSummary }
          if (row.v !== version || typeof row.k !== 'string' || !row.s) {
            skipped++
            continue
          }
          this.map.set(row.k, row.s)
        } catch {
          skipped++
        }
      }
    }
    this.skipped = skipped
  }

  override put(spec: FightSpec, seed: number, summary: FightSummary, kind: WorkerTask['kind'] = 'full'): void {
    const k = cacheKey(spec, seed, kind)
    if (this.map.has(k)) return
    this.map.set(k, summary)
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, JSON.stringify({ k, v: this.version, s: summary }) + '\n')
  }
}

/** Cache d'une campagne : `<dir>/<campagne>.jsonl` (défaut `runs/`). */
export function openCampaignCache(campaign: string, dir = 'runs', version?: string): JsonlFightCache {
  const safe = campaign.replace(/[^A-Za-z0-9._-]+/g, '_')
  return new JsonlFightCache(resolve(dir, `${safe}.jsonl`), version ?? cacheVersion())
}
