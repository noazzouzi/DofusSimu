// Bibliothèque des scénarios de la Reine des Voleurs : tout ce que les combats joués ont appris, par placement
// (data/reine/scenarios/<placement>.json, versionné : les journaux, eux, ne le sont pas).
//
// Pour chaque combat appris : sa source (session du journal, rang du combat), son issue (victoire, abandon…), ses
// manches. Pour chaque tour de Crâ joué : une BRANCHE = (Crâ, n-ième tour, plateau au moment où il commence à jouer,
// actions exactes) ; une branche jouée dans plusieurs combats n'est écrite qu'une fois, avec la liste des combats où elle
// l'a été (dégâts du tour et Crâs morts dans la manche qui a suivi, combat par combat). La compilation (compilation.ts)
// choisit ensuite, pour chaque situation connue, la meilleure branche : le scénario optimal du placement.
//
// Format compact (une branche par ligne) : plateau en jetons « c<id>@<case> » (Crâ), « <espèce>@<case> » (monstre,
// Bonbombe 3725), suffixe « ~ » invisible, « + » Bonbombe du Crâ apparue au début de ce tour ; actions
// ["m", case, case, …] (déplacement, chemin complet) ou ["s", sort, case, depuis, cible, espèce?, id?].
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { corners, type BoardEntry, type Issue, type Scenario, type Step, type TurnPlan } from '../../fightlog/scenario'
import { data } from '../planificateur/etat'
import { slug } from './placements'

export const SPECIES: Record<number, string> = {
  3725: 'Bonbombe', 3726: 'Reine des Voleurs', 3745: 'Bombe Illicale', 3746: 'Mâchassin', 3747: 'Terristocrate',
  3748: 'Doublure', 3749: 'Bourôliste', 3750: 'Magouille',
}

export interface FightRecord {
  /** « <jour>/<session>.jsonl#<rang du combat dans la session> ». */
  id: string
  /** Heure du début du combat (lot du journal), si connue. */
  debut?: string
  issue: Issue
  /** Cases de départ des Crâs (phase de placement). */
  cases: Record<string, number>
  /** Tours de Crâ du combat. */
  tours: number
  verification: string
}

export interface Occurrence {
  combat: string
  /** Dégâts du tour dans ce combat. */
  degats: number
  /** Crâs morts entre le début de ce tour et le tour suivant du même Crâ, dans ce combat. */
  morts: string[]
}

export interface LibraryBranch {
  perso: string
  /** n-ième tour du Crâ dans le combat (1 = premier). */
  tour: number
  manche: number
  depart: number
  fin: number
  /** PA et PM dépensés par les actions. */
  pa: number
  pm: number
  plateau: string[]
  actions: (string | number)[][]
  joue: Occurrence[]
}

export interface Library {
  version: 1
  placement: string
  combats: FightRecord[]
  branches: LibraryBranch[]
}

export const SCENARIOS_DIR = join('data', 'reine', 'scenarios')

export function libraryPath(nom: string, root = process.cwd()): string {
  return join(root, SCENARIOS_DIR, `${slug(nom)}.json`)
}

export function emptyLibrary(nom: string): Library {
  return { version: 1, placement: nom, combats: [], branches: [] }
}

export function loadLibrary(nom: string, root = process.cwd()): Library {
  const file = libraryPath(nom, root)
  if (!existsSync(file)) return emptyLibrary(nom)
  const lib = JSON.parse(readFileSync(file, 'utf8')) as Library
  if (lib.version !== 1) throw new Error(`${file} : version ${lib.version} inconnue`)
  return lib
}

/** Bibliothèque écrite une branche par ligne (diffs lisibles, fichier compact). */
export function formatLibrary(lib: Library): string {
  const j = (x: unknown) => JSON.stringify(x)
  const combats = lib.combats.map(c => `    ${j(c)}`).join(',\n')
  const branches = lib.branches.map(b => `    ${j(b)}`).join(',\n')
  return `{\n  "version": 1,\n  "placement": ${j(lib.placement)},\n  "combats": [\n${combats}\n  ],\n  "branches": [\n${branches}\n  ]\n}\n`
}

export function saveLibrary(lib: Library, root = process.cwd()): string {
  const file = libraryPath(lib.placement, root)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatLibrary(lib))
  return file
}

// ───────────────────────────── jetons ─────────────────────────────

export function encodeEntry(b: BoardEntry): string {
  const who = b.espece === 0 ? `c${b.id}` : String(b.espece)
  return `${who}@${b.cellule}${b.invisible ? '~' : ''}${b.nouvelle ? '+' : ''}`
}

/** Jeton → combattant du plateau ; `names` : nom de chaque Crâ par identifiant. */
export function decodeEntry(t: string, names: Map<number, string> = new Map()): BoardEntry {
  const m = /^(c?)(-?\d+)@(-?\d+)(~?)(\+?)$/.exec(t)
  if (!m) throw new Error(`jeton de plateau illisible : ${t}`)
  const n = Number(m[2])
  const out: BoardEntry = m[1]
    ? { espece: 0, id: n, cellule: Number(m[3]), nom: names.get(n) ?? `Crâ ${n}` }
    : { espece: n, cellule: Number(m[3]), nom: SPECIES[n] ?? `espèce ${n}` }
  if (m[4]) out.invisible = true
  if (m[5]) out.nouvelle = true
  return out
}

export function encodeStep(a: Step): (string | number)[] {
  if (a.type === 'deplacer') return ['m', ...a.chemin]
  const out: (string | number)[] = ['s', a.sort, a.cellule, a.depuis, a.cible]
  if (a.espece !== undefined || a.idCible !== undefined) out.push(a.espece ?? 0)
  if (a.idCible !== undefined) out.push(a.idCible)
  return out
}

type Cible = Extract<Step, { type: 'sort' }>['cible']

export function decodeStep(x: (string | number)[], names: Map<number, string> = new Map()): Step {
  if (x[0] === 'm') {
    const chemin = x.slice(1).map(Number)
    return { type: 'deplacer', cellule: chemin[chemin.length - 1], chemin, etapes: corners(chemin) }
  }
  const [, sort, cellule, depuis, cible, espece, id] = x as [string, number, number, number, Cible, number?, number?]
  const step: Step = { type: 'sort', sort, nom: data.spell(sort)?.name ?? `sort ${sort}`, cellule, depuis, cible }
  if (espece) step.espece = espece
  if (id !== undefined) {
    step.idCible = id
    step.nomCible = cible === 'allie' ? names.get(id) ?? `Crâ ${id}` : SPECIES[espece ?? 0] ?? `espèce ${espece}`
  }
  return step
}

/** Clé d'une situation : Crâ, n-ième tour, case de départ et plateau (sans distinguer la bombe du tour). */
export function situationKey(b: Pick<LibraryBranch, 'perso' | 'tour' | 'depart' | 'plateau'>): string {
  return `${b.perso}|${b.tour}|${b.depart}|${[...b.plateau].map(t => t.replace(/\+$/, '')).sort().join(',')}`
}

const actionsKey = (a: LibraryBranch['actions']) => JSON.stringify(a)

/** Tour d'une branche de la bibliothèque, au format des scénarios (scenario.ts). */
export function planOf(b: LibraryBranch, names: Map<number, string> = new Map()): TurnPlan {
  return {
    manche: b.manche, depart: b.depart, fin: b.fin, pa: b.pa, pm: b.pm,
    plateau: b.plateau.map(t => decodeEntry(t, names)),
    actions: b.actions.map(x => decodeStep(x, names)),
  }
}

// ───────────────────────────── apprentissage ─────────────────────────────

/**
 * Ajoute un combat (scénario extrait d'un journal) à la bibliothèque de son placement. Un combat déjà appris (même
 * identifiant : session relue) est remplacé. Rend le nombre de tours et de branches nouvelles.
 */
export function addFight(lib: Library, id: string, sc: Scenario): { tours: number; nouvelles: number; remplace: boolean } {
  const remplace = removeFight(lib, id)
  const index = new Map(lib.branches.map(b => [`${situationKey(b)}#${actionsKey(b.actions)}`, b]))
  let tours = 0
  let nouvelles = 0
  for (const [perso, turns] of Object.entries(sc.plans)) {
    turns.forEach((t, k) => {
      // (tour sans fin : combat coupé pendant ce tour)
      if (t.depart < 0 || t.fin < 0) return
      tours++
      const b: LibraryBranch = {
        perso, tour: k + 1, manche: t.manche, depart: t.depart, fin: t.fin, pa: t.pa ?? 0, pm: t.pm ?? 0,
        plateau: t.plateau.map(encodeEntry).sort(), actions: t.actions.map(encodeStep), joue: [],
      }
      const key = `${situationKey(b)}#${actionsKey(b.actions)}`
      let x = index.get(key)
      if (!x) {
        x = b
        index.set(key, x)
        lib.branches.push(x)
        nouvelles++
      }
      x.joue.push({ combat: id, degats: t.degats ?? 0, morts: t.morts ?? [] })
    })
  }
  lib.combats.push({ id, debut: sc.debut, issue: sc.issue ?? { fin: 'interrompu', manches: sc.manches, vagues: 1, morts: [] }, cases: sc.cases, tours, verification: sc.verification })
  lib.combats.sort((a, b) => (a.debut ?? a.id).localeCompare(b.debut ?? b.id) || a.id.localeCompare(b.id))
  lib.branches.sort((a, b) => a.perso.localeCompare(b.perso) || a.tour - b.tour || situationKey(a).localeCompare(situationKey(b)))
  return { tours, nouvelles, remplace }
}

/** Retire un combat (et les branches que lui seul avait jouées). Rend vrai s'il y était. */
export function removeFight(lib: Library, id: string): boolean {
  const had = lib.combats.some(c => c.id === id)
  lib.combats = lib.combats.filter(c => c.id !== id)
  for (const b of lib.branches) b.joue = b.joue.filter(o => o.combat !== id)
  lib.branches = lib.branches.filter(b => b.joue.length > 0)
  return had
}
