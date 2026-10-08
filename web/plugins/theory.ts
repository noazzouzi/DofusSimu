/**
 * Section « Boss » (theorycraft contre un boss, docs/design/theorycraft.md §3) côté Vite : API JSON du serveur de
 * développement seulement (`npm run dev`, usage personnel), sous `/api/theory/` :
 *   GET  bosses?all=1                         index des boss (`BossEntry[]` ; `all` : Expéditions incluses)
 *   GET  presets                              presets de base { id, breedId, className, label, role, roleLabel, element }
 *   GET  boss?id=&players=&grade=             fiche du boss (`BossProfileDetail`), fiche manuelle data/bosses appliquée
 *   POST classes { id, players?, grade?, stuff?, iterations?, profile? }                    classement (`ClassRanking`)
 *   POST stuff   { id, players?, grade?, preset?, roxx?, elements?, profile?, top?, iterations?, rangeNeed? }
 *                                                                                         meilleur stuff (`StuffVsBossResult`)
 * Erreurs : `{ error }` et code HTTP (400 paramètre invalide, 403 requête d'une autre origine, 404 boss ou route
 * inconnus, 405 méthode, 415 corps non JSON, 500 imprévu). Un POST doit être un JSON (`Content-Type: application/json`)
 * de la page elle-même (`readJson`, web/plugins/store.ts) : une page tierce ne peut pas lancer de calcul long.
 *
 * La logique des routes vit dans des fonctions PURES exportées (`theoryBosses`, `theoryBoss`, `theoryClasses`,
 * `theoryStuff`, `theoryPresets`, et l'aiguillage `theoryRoute`), testées sans HTTP (tests/web-theory.test.ts) ; le
 * middleware ne fait que lire la requête et sérialiser la réponse. Les données du jeu sont celles du plugin des stuffs
 * (`sharedStore`, web/plugins/store.ts) : chargées une seule fois.
 *
 * `id` : id de monstre d'un boss (Expéditions comprises), ou un nom résolu comme la CLI (`resolveBoss`). `players`
 * (1 à 8, défaut 4) et `grade` (1 au nombre de grades du boss) s'excluent. Les fiches manuelles `data/bosses/*.json`
 * sont relues à chaque demande (une fiche modifiée s'applique sans redémarrer) ; une fiche illisible est signalée dans
 * les avertissements de la fiche du boss, qui est alors calculée sans fiche manuelle.
 *
 * Les calculs sont synchrones : le serveur de développement ne répond plus pendant une optimisation (≈ 3 s pour un
 * stuff, ≈ 20 s pour le classement des classes en stuffs optimisés).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { roxxImport } from '../../src/optimizer/team/roxx'
import { BASE_PRESETS, resolvePreset, type Preset } from '../../src/optimizer/team/presets'
import type { ExponentProfile } from '../../src/optimizer/stuff/profiles'
import { ROLE_LABELS_FR } from '../../src/stats/sheet'
import type { GameDataStore } from '../../src/data/store'
import type { NodeDataStore } from '../../src/data/node'
import {
  bossProfile,
  listBosses,
  rankClasses,
  resolveBoss,
  stuffVsBoss,
  type BossEntry,
  type BossOverrides,
  type BossProfileDetail,
  type ClassRanking,
  type StuffInput,
  type StuffVsBossResult,
} from '../../src/theorycraft/analysis'
import { loadBossOverrides, nodeDungeonSource } from '../../src/theorycraft/node'
import { HttpError, readJson, sendJson, sharedStore } from './store'

const API = '/api/theory/'
/**
 * Bornes des paramètres numériques (le serveur de développement calcule en synchrone : pas de recherche démesurée).
 * `iterations` du stuff : une recherche (≈ 10 s par élément à 100 000) ; `classesIterations` : une recherche PAR
 * preset (49) en stuffs optimisés — 10 000 itérations ≈ 30 s de calcul bloquant (mesure de l'audit), 200 000 en
 * prendraient près de 6 min : au-delà, la CLI (`boss … classes --optimize --iterations N`).
 */
export const THEORY_LIMITS = {
  players: { min: 1, max: 8 },
  top: { min: 1, max: 10 },
  iterations: { min: 0, max: 200_000 },
  classesIterations: { min: 0, max: 10_000 },
  rangeNeed: { min: 0, max: 20 },
} as const
const PROFILES: readonly ExponentProfile[] = ['balanced', 'defensive', 'offensive']

// ───────────────────────────── environnement ─────────────────────────────

/** Ce dont les routes ont besoin : données du jeu, index des boss, fiches manuelles. */
export interface TheoryEnv {
  readonly data: GameDataStore
  /** Index des boss (Expéditions comprises si `all`), calculé une fois. */
  bosses(all: boolean): readonly BossEntry[]
  /** Fiches manuelles par monstre ; lève une erreur qui cite le fichier si l'une est illisible. */
  overrides(): ReadonlyMap<number, BossOverrides>
}

/** Environnement du serveur : index des boss mis en cache, fiches manuelles relues à chaque appel. */
export function theoryEnv(data: NodeDataStore, bossDir = 'data/bosses'): TheoryEnv {
  const src = nodeDungeonSource(data)
  const cache = new Map<boolean, BossEntry[]>()
  return {
    data,
    bosses(all) {
      let list = cache.get(all)
      if (!list) cache.set(all, (list = listBosses(data, src, { includeExpeditions: all })))
      return list
    },
    overrides: () => loadBossOverrides(bossDir),
  }
}

// ───────────────────────────── paramètres ─────────────────────────────

/** Paramètres d'une route (requête GET ou corps JSON). */
export type TheoryParams = Readonly<Record<string, unknown>>

const isBlank = (v: unknown) => v === undefined || v === null || v === ''

/** Entier borné facultatif (nombre ou texte) ; absent ou vide : undefined. */
function intParam(v: unknown, what: string, min: number, max: number): number | undefined {
  if (isBlank(v)) return undefined
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `« ${what} » : entier de ${min} à ${max} attendu (reçu ${JSON.stringify(v)})`)
  return n
}

/** Texte facultatif parmi des valeurs permises. */
function oneOf<T extends string>(v: unknown, what: string, allowed: readonly T[]): T | undefined {
  if (isBlank(v)) return undefined
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new HttpError(400, `« ${what} » : ${allowed.map(a => `« ${a} »`).join(', ')} attendu (reçu ${JSON.stringify(v)})`)
  return v as T
}

/** Texte facultatif non vide. */
function textParam(v: unknown, what: string): string | undefined {
  if (isBlank(v)) return undefined
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `« ${what} » : texte attendu`)
  return v.trim()
}

/** Boss désigné par `id` : id de monstre (Expéditions comprises) ou nom (résolution de la CLI). */
export function bossOf(env: TheoryEnv, id: unknown): BossEntry {
  if (isBlank(id)) throw new HttpError(400, '« id » manquant (id de monstre du boss)')
  const all = env.bosses(true)
  const text = String(id).trim()
  if (/^\d+$/.test(text)) {
    const hit = all.find(e => e.monsterId === Number(text))
    if (!hit) throw new HttpError(404, `Aucun boss d'id ${text}`)
    return hit
  }
  try {
    return resolveBoss(all, text)
  } catch (e) {
    const msg = (e as Error).message
    throw new HttpError(/^Aucun/.test(msg) ? 404 : 400, msg)
  }
}

/** Fiche du boss d'une requête (`id`, `players` | `grade`), fiche manuelle appliquée si elle existe. */
function profileOf(env: TheoryEnv, p: TheoryParams): BossProfileDetail {
  const entry = bossOf(env, p.id)
  const players = intParam(p.players, 'players', THEORY_LIMITS.players.min, THEORY_LIMITS.players.max)
  const grade = intParam(p.grade, 'grade', 1, entry.gradeCount)
  if (players !== undefined && grade !== undefined) throw new HttpError(400, '« players » et « grade » s\'excluent : donnez l\'un ou l\'autre')
  let overrides: BossOverrides | undefined
  let unreadable: string | undefined
  try {
    overrides = env.overrides().get(entry.monsterId)
  } catch (e) {
    unreadable = `Fiches manuelles (data/bosses) illisibles, aucune appliquée : ${(e as Error).message}`
  }
  const profile = bossProfile(env.data, entry.monsterId, { grade, players, overrides })
  if (unreadable) profile.warnings.unshift(unreadable)
  return profile
}

// ───────────────────────────── routes ─────────────────────────────

/** Preset de base tel que l'interface le liste. */
export interface TheoryPreset {
  id: string
  breedId: number
  className: string
  label: string
  role: string
  roleLabel: string
  element: Preset['element']
}

/** GET bosses : index des boss (`all` : Expéditions incluses ; « 1 », « true » ou vrai). */
export function theoryBosses(env: TheoryEnv, p: TheoryParams = {}): readonly BossEntry[] {
  return env.bosses(p.all === true || p.all === '1' || p.all === 'true')
}

/** GET presets : les presets de base (ordre du fichier : le premier d'une classe est son preset par défaut). */
export function theoryPresets(): TheoryPreset[] {
  return BASE_PRESETS.map(p => ({ id: p.id, breedId: p.breedId, className: p.className, label: p.label, role: p.role, roleLabel: ROLE_LABELS_FR[p.role] ?? p.role, element: p.element }))
}

/** GET boss : fiche du boss. */
export function theoryBoss(env: TheoryEnv, p: TheoryParams): BossProfileDetail {
  return profileOf(env, p)
}

/** POST classes : classement des classes contre le boss (stuffs des presets, ou optimisés contre lui). */
export function theoryClasses(env: TheoryEnv, p: TheoryParams): ClassRanking {
  const profile = profileOf(env, p)
  const stuff = oneOf(p.stuff, 'stuff', ['preset', 'optimized'] as const)
  const iterations = intParam(p.iterations, 'iterations', THEORY_LIMITS.classesIterations.min, THEORY_LIMITS.classesIterations.max)
  const expProfile = oneOf(p.profile, 'profile', PROFILES)
  return rankClasses(env.data, profile, { stuff, iterations, profile: expProfile })
}

/** Preset désigné par un texte (`cra_terre_mono`, `cra:terre`, `cra`) ; inconnu : erreur 400. */
function presetParam(text: string): Preset {
  try {
    return resolvePreset(text)
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
}

/**
 * POST stuff : meilleur stuff contre le boss pour un preset (`preset`), ou à partir d'un lien RoxxSolver (`roxx`, avec
 * `preset` facultatif de la même classe pour les variantes de sorts et le rôle).
 */
export function theoryStuff(env: TheoryEnv, p: TheoryParams): StuffVsBossResult {
  const profile = profileOf(env, p)
  const presetText = textParam(p.preset, 'preset')
  const roxx = textParam(p.roxx, 'roxx')
  if (!presetText && !roxx) throw new HttpError(400, '« preset » ou « roxx » attendu')
  const preset = presetText ? presetParam(presetText) : undefined
  let input: StuffInput
  if (roxx) {
    let breedId: number
    try {
      breedId = roxxImport(roxx, env.data).breedId
    } catch (e) {
      throw new HttpError(400, `Lien RoxxSolver illisible : ${(e as Error).message}`)
    }
    if (preset && preset.breedId !== breedId) {
      const cls = theoryPresets().find(x => x.breedId === breedId)?.className ?? `classe ${breedId}`
      throw new HttpError(400, `Le preset « ${preset.id} » (${preset.className}) n'est pas de la classe du lien (${cls}) : choisissez un preset ${cls} ou le preset automatique`)
    }
    input = { roxx, presetId: preset?.id }
  } else input = { preset: preset!.id }
  const elements = oneOf(p.elements, 'elements', ['preset', 'all'] as const)
  const expProfile = oneOf(p.profile, 'profile', PROFILES)
  const top = intParam(p.top, 'top', THEORY_LIMITS.top.min, THEORY_LIMITS.top.max)
  const iterations = intParam(p.iterations, 'iterations', THEORY_LIMITS.iterations.min, THEORY_LIMITS.iterations.max)
  const rangeNeed = intParam(p.rangeNeed, 'rangeNeed', THEORY_LIMITS.rangeNeed.min, THEORY_LIMITS.rangeNeed.max)
  return stuffVsBoss(env.data, input, profile, { elements, profile: expProfile, top, iterations, rangeNeed })
}

/** Requête réduite à ce que l'aiguillage lit. */
export interface TheoryRequest {
  method: string
  /** Chemin sous /api/theory/ (« bosses », « boss »…). */
  route: string
  query?: URLSearchParams
  body?: TheoryParams
}

/** Aiguillage des routes (voir l'en-tête) : réponse JSON, ou `HttpError` (404 route inconnue, 405 méthode). */
export function theoryRoute(env: TheoryEnv, req: TheoryRequest): unknown {
  const GET: Record<string, (p: TheoryParams) => unknown> = {
    bosses: q => theoryBosses(env, q),
    presets: () => theoryPresets(),
    boss: q => theoryBoss(env, q),
  }
  const POST: Record<string, (p: TheoryParams) => unknown> = {
    classes: b => theoryClasses(env, b),
    stuff: b => theoryStuff(env, b),
  }
  const route = req.route.replace(/^\/+|\/+$/g, '')
  const table = req.method === 'GET' ? GET : req.method === 'POST' ? POST : undefined
  const fn = table && Object.hasOwn(table, route) ? table[route] : undefined
  if (fn) return fn(req.method === 'GET' ? Object.fromEntries(req.query ?? []) : (req.body ?? {}))
  if (Object.hasOwn(GET, route) || Object.hasOwn(POST, route)) throw new HttpError(405, `Méthode ${req.method} non prise en charge pour « ${route} »`)
  throw new HttpError(404, `Route inconnue : ${route}`)
}

// ───────────────────────────── plugin ─────────────────────────────

/** Plugin Vite : API `/api/theory/` du serveur de développement (aucun effet sur `vite build`). */
export function theoryPlugin(): Plugin {
  let env: TheoryEnv | undefined
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      const method = req.method ?? 'GET'
      const body = method === 'POST' ? await readJson(req) : undefined
      env ??= theoryEnv(sharedStore())
      sendJson(res, 200, theoryRoute(env, { method, route: url.pathname, query: url.searchParams, body }))
    } catch (e) {
      sendJson(res, e instanceof HttpError ? e.status : 500, { error: (e as Error).message })
    }
  }
  return {
    name: 'dofussimu-theory',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(API, (req, res) => void handle(req, res))
    },
  }
}
