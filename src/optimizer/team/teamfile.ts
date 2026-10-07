/**
 * Fichiers d'équipe de l'utilisateur (`data/teams/<scénario>.json`, format : `userteam.ts`) — lecture (builds donnés par
 * chemin chargés, relatifs au fichier d'équipe), recherche du fichier d'un scénario, écriture (`optimize --save-team`),
 * fiches de stuff des équipes (`teamStuffs`, `stuffCatalog` : section « Stuffs » du visualiseur, web/plugins/stuffs.ts).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STUFF_SHEET_VERSION, type DraftMember, type SheetDataSource, type StuffCatalog, type TeamStuffs } from '../../stats/sheet'
import { draftsOf, teamFileFromDraft, teamFileName } from './editor'
import { memberSheet } from './sheets'
import { compositionFromTeamFile, parseTeamFile, resolveComposition, scenarioTag, type TeamFile, type TeamFileBuild, type UserComposition } from './userteam'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Dossier des fichiers d'équipe du dépôt. */
export const TEAMS_DIR = join(REPO_ROOT, 'data', 'teams')

/** Chemin du fichier d'équipe d'un scénario dans un dossier (`vortex` → `<dir>/vortex.json`). */
export function teamFilePath(scenarioId: string, dir = TEAMS_DIR): string {
  return join(dir, `${scenarioTag(scenarioId) || 'equipe'}.json`)
}

/** Fichier d'équipe d'un scénario : premier dossier qui en contient un (défaut : `data/teams` du dépôt), sinon undefined. */
export function findTeamFile(scenarioId: string, dirs: readonly string[] = [TEAMS_DIR]): string | undefined {
  for (const d of dirs) {
    const f = teamFilePath(scenarioId, resolve(d))
    if (existsSync(f)) return f
  }
  return undefined
}

/** Build d'un fichier écrit par `stuff --out` (`{ build: {...} }`) ou build nu (`{ items: [...] }`). */
function readBuildFile(path: string): TeamFileBuild {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const b = (raw && typeof raw === 'object' && 'build' in raw ? raw.build : raw) as TeamFileBuild
  if (!b || !Array.isArray(b.items)) throw new Error(`${path} : build introuvable ({ items: [...] } ou { build: { items: [...] } } attendu)`)
  return b
}

/** Lit et valide un fichier d'équipe ; renvoie le fichier et sa composition. */
export function loadTeamFile(path: string): { file: TeamFile; composition: UserComposition; path: string } {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`Fichier d'équipe introuvable : ${path}`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (e) {
    throw new Error(`${path} : JSON invalide (${(e as Error).message})`)
  }
  const members = (json as { members?: unknown[] })?.members
  if (Array.isArray(members)) {
    for (const m of members) {
      const b = (m as { build?: unknown })?.build
      if (typeof b === 'string') (m as { build?: unknown }).build = readBuildFile(isAbsolute(b) ? b : join(dirname(abs), b))
    }
  }
  const file = parseTeamFile(json, path)
  return { file, composition: compositionFromTeamFile(file, path), path: abs }
}

/** Écrit un fichier d'équipe (JSON indenté). */
export function saveTeamFile(path: string, file: TeamFile): string {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(file, null, 2) + '\n')
  return abs
}

// ───────────────────────────── fiches de stuff ─────────────────────────────

/** Nom lisible d'un scénario (data/dungeons/<id>.json), sinon son identifiant. */
function scenarioName(id: string): string {
  const f = join(REPO_ROOT, 'data', 'dungeons', `${id}.json`)
  if (!existsSync(f)) return id
  try {
    const name = (JSON.parse(readFileSync(f, 'utf8')) as { name?: { fr?: string } | string }).name
    return (typeof name === 'string' ? name : name?.fr) || id
  } catch {
    return id
  }
}

const repoPath = (abs: string) => relative(REPO_ROOT, resolve(abs)).split(sep).join('/')

/**
 * Fiches de stuff de l'équipe d'un fichier d'équipe, résolue comme les commandes de la CLI (`resolveComposition` :
 * build de référence de chaque membre). Une équipe illisible renvoie `error` (et aucun membre).
 */
export function teamStuffs(data: SheetDataSource, path: string): TeamStuffs {
  let loaded: ReturnType<typeof loadTeamFile>
  try {
    loaded = loadTeamFile(path)
  } catch (e) {
    const scenario = basename(path, '.json')
    return { scenario, scenarioName: scenarioName(scenario), file: repoPath(path), fileName: basename(path), drafts: [], notes: [], members: [], error: (e as Error).message }
  }
  const { file, composition } = loaded
  const out: TeamStuffs = {
    scenario: file.scenario,
    scenarioName: scenarioName(file.scenario),
    file: repoPath(loaded.path),
    fileName: basename(loaded.path),
    drafts: [],
    chosenBy: file.chosenBy,
    decidedAt: file.decidedAt,
    description: file.description,
    notes: file.notes === undefined ? [] : Array.isArray(file.notes) ? file.notes : [file.notes],
    optimized: file.optimized,
    members: [],
  }
  try {
    const { options } = resolveComposition(composition, data, file.scenario)
    out.members = options.map(o => memberSheet(o.member, data, o))
    out.drafts = draftsOf(file, options)
  } catch (e) {
    out.error = (e as Error).message
  }
  return out
}

/** Fiches de stuff de toutes les équipes d'un dossier (défaut : data/teams du dépôt). */
export function stuffCatalog(data: SheetDataSource, dir = TEAMS_DIR): StuffCatalog {
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : []
  return { version: STUFF_SHEET_VERSION, generatedAt: new Date().toISOString(), teams: files.map(f => teamStuffs(data, join(dir, f))) }
}

/**
 * Enregistre un brouillon d'équipe dans `dir/fileName` (format de `parseTeamFile`, en-tête du fichier existant conservé :
 * voir `teamFileFromDraft`) et renvoie ses fiches relues depuis le disque. Un fichier existant n'est remplacé qu'avec
 * `overwrite` ; un nouveau fichier doit garder le scénario du brouillon.
 */
export function saveTeamDraft(
  data: SheetDataSource,
  name: string,
  scenario: string,
  drafts: readonly DraftMember[],
  opts: { overwrite: boolean; date?: string; dir?: string; from?: string },
): TeamStuffs {
  const dir = opts.dir ?? TEAMS_DIR
  const path = join(dir, teamFileName(name))
  const exists = existsSync(path)
  if (exists && !opts.overwrite) throw new Error(`${repoPath(path)} existe déjà`)
  const original = exists ? loadTeamFile(path).file : undefined
  if (original && original.scenario !== scenario) throw new Error(`${repoPath(path)} est une équipe du scénario « ${original.scenario} », pas « ${scenario} »`)
  const file = teamFileFromDraft(original, scenario, drafts, opts.date ?? new Date().toISOString().slice(0, 10), opts.from)
  resolveComposition(compositionFromTeamFile(file), data, scenario) // builds résolubles avant d'écrire
  saveTeamFile(path, file)
  return teamStuffs(data, path)
}
