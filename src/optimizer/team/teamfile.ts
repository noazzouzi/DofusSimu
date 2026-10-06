/**
 * Fichiers d'équipe de l'utilisateur (`data/teams/<scénario>.json`, format : `userteam.ts`) — lecture (builds donnés par
 * chemin chargés, relatifs au fichier d'équipe), recherche du fichier d'un scénario, écriture (`optimize --save-team`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionFromTeamFile, parseTeamFile, scenarioTag, type TeamFile, type TeamFileBuild, type UserComposition } from './userteam'

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
