// Registre des placements de la Reine des Voleurs (data/reine/placements.json) : pour chaque placement des monstres
// (l'espèce et la case de chacun au début du combat, la signature que le script reconnaît pendant la phase de
// placement), la case de placement de chaque Crâ et sa case de la colonne (il y revient à la fin de chacun de ses tours).
// Les cases seules ne suffisent pas : plusieurs placements occupent les mêmes cases avec des monstres permutés
// (Placements 1, 3 et 6 ; 2 et 4 ; 5, 8 et 11 ; 7 et 9).
//
// Un placement s'ajoute à la main dans le fichier (monstres, et au besoin cases et colonne : sans elles, celles du
// placement par défaut), ou tout seul : un combat appris (apprendre.ts) dont les monstres ne correspondent à aucun
// placement connu en crée un, nommé « Auto <cases des monstres> », sans cases ni colonne : les Crâs se placent comme au
// placement par défaut, quel que soit le placement des monstres (consigne du joueur, 2026-10-11). Les cases où les Crâs
// ont commencé le combat appris ne sont pas reprises : quand le placement échoue, ce sont celles où le jeu les a mis.
// Il suffit alors de le renommer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PlacementMonster { espece: number; cellule: number; nom?: string }

export interface PlacementDef {
  nom: string
  /** Monstres au début du combat : la signature du placement (espèce et case de chacun). */
  monstres: PlacementMonster[]
  /** Case de placement de chaque Crâ (nom du personnage → case) ; Crâ absent : sa case du placement par défaut. */
  cases?: Record<string, number>
  /** Case de la colonne de chaque Crâ ; Crâ absent : sa case du placement par défaut. */
  colonne?: Record<string, number>
  /** Créé par l'apprentissage (placement de monstres rencontré en combat, pas encore déclaré). */
  auto?: boolean
  /** Mode « 4 Crâs + mule » (un 5e personnage qui passe ses tours : 5 monstres par vague). */
  mule?: boolean
  notes?: string
}

export interface Registry {
  version: 1
  carte: number
  /** Placement dont les cases des Crâs servent aux placements de monstres inconnus (FORMATION_PAR_DEFAUT du script). */
  defaut?: string
  /** Combats appris à partir de cette heure (ISO, UTC) seulement : nouveau départ des bibliothèques. */
  depuis?: string
  /** Identifiant de jeu de chaque personnage (repli du script quand character:name() ne répond pas). */
  personnages: Record<string, number>
  placements: PlacementDef[]
  notes?: string[]
}

export const PLACEMENTS_FILE = join('data', 'reine', 'placements.json')

export function registryPath(root = process.cwd()): string {
  return join(root, PLACEMENTS_FILE)
}

export function loadRegistry(root = process.cwd()): Registry {
  const file = registryPath(root)
  if (!existsSync(file)) return { version: 1, carte: 137101316, personnages: {}, placements: [] }
  const reg = JSON.parse(readFileSync(file, 'utf8')) as Registry
  checkRegistry(reg)
  return reg
}

/** Erreurs d'un registre écrit à la main (noms en double, signatures en double, cases manquantes). */
export function checkRegistry(reg: Registry): void {
  const names = new Set<string>()
  const sigs = new Map<string, string>()
  for (const p of reg.placements) {
    if (!p.nom) throw new Error(`${PLACEMENTS_FILE} : placement sans nom`)
    if (names.has(p.nom)) throw new Error(`${PLACEMENTS_FILE} : placement « ${p.nom} » en double`)
    names.add(p.nom)
    if (!Array.isArray(p.monstres) || !p.monstres.length) throw new Error(`${PLACEMENTS_FILE} : « ${p.nom} » sans monstres`)
    for (const m of p.monstres) {
      if (!Number.isInteger(m.cellule)) throw new Error(`${PLACEMENTS_FILE} : « ${p.nom} », case de monstre invalide`)
      if (!Number.isInteger(m.espece)) throw new Error(`${PLACEMENTS_FILE} : « ${p.nom} », espèce de monstre invalide`)
    }
    const sig = signature(p.monstres)
    const other = sigs.get(sig)
    if (other) throw new Error(`${PLACEMENTS_FILE} : « ${p.nom} » et « ${other} » ont les mêmes monstres sur les mêmes cases (${sig})`)
    sigs.set(sig, p.nom)
  }
  if (reg.defaut && !names.has(reg.defaut)) throw new Error(`${PLACEMENTS_FILE} : placement par défaut « ${reg.defaut} » inconnu`)
  if (reg.depuis && Number.isNaN(Date.parse(reg.depuis))) throw new Error(`${PLACEMENTS_FILE} : « depuis » n'est pas une date (${reg.depuis})`)
}

/** Registre écrit lisiblement (un monstre par ligne). */
export function saveRegistry(reg: Registry, root = process.cwd()): string {
  checkRegistry(reg)
  const file = registryPath(root)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatRegistry(reg))
  return file
}

export function formatRegistry(reg: Registry): string {
  const j = (x: unknown) => JSON.stringify(x)
  const out: string[] = ['{', `  "version": ${reg.version},`, `  "carte": ${reg.carte},`]
  if (reg.defaut) out.push(`  "defaut": ${j(reg.defaut)},`)
  if (reg.depuis) out.push(`  "depuis": ${j(reg.depuis)},`)
  if (reg.notes?.length) out.push(`  "notes": [\n${reg.notes.map(n => `    ${j(n)}`).join(',\n')}\n  ],`)
  out.push(`  "personnages": ${j(reg.personnages)},`)
  out.push('  "placements": [')
  reg.placements.forEach((p, i) => {
    const lines = [`      "nom": ${j(p.nom)}`]
    if (p.auto) lines.push('      "auto": true')
    if (p.mule) lines.push('      "mule": true')
    if (p.notes) lines.push(`      "notes": ${j(p.notes)}`)
    lines.push(`      "monstres": [\n${p.monstres.map(m => `        ${j(m)}`).join(',\n')}\n      ]`)
    if (p.cases) lines.push(`      "cases": ${j(p.cases)}`)
    if (p.colonne) lines.push(`      "colonne": ${j(p.colonne)}`)
    out.push(`    {\n${lines.join(',\n')}\n    }${i < reg.placements.length - 1 ? ',' : ''}`)
  })
  out.push('  ]', '}')
  return out.join('\n') + '\n'
}

/** Signature d'un placement : espèce et case de chaque monstre, par case (« 3747@132 3726@134 … »). */
export function signature(monstres: { espece: number; cellule: number }[]): string {
  return [...monstres].sort((a, b) => a.cellule - b.cellule || a.espece - b.espece).map(m => `${m.espece}@${m.cellule}`).join(' ')
}

/** Cases des monstres, triées (« 132-134-178-208 ») : communes à plusieurs placements. */
export function cellules(monstres: { cellule: number }[]): string {
  return monstres.map(m => m.cellule).sort((a, b) => a - b).join('-')
}

/** Placement dont les monstres sont exactement ceux-ci, sur ces cases. */
export function recognize(reg: Registry, monstres: { espece: number; cellule: number }[]): PlacementDef | undefined {
  const sig = signature(monstres)
  return reg.placements.find(p => signature(p.monstres) === sig)
}

export function defaultPlacement(reg: Registry): PlacementDef | undefined {
  return reg.placements.find(p => p.nom === reg.defaut) ?? reg.placements.find(p => p.cases && p.colonne)
}

/**
 * Les Crâs (noms des cases du placement par défaut) et leur identifiant de jeu, s'il est connu. Tout autre personnage du
 * groupe est une mule (mode « 4 Crâs + mule »).
 */
export function crasOf(reg: Registry): Record<string, number | undefined> {
  return Object.fromEntries(Object.keys(defaultPlacement(reg)?.cases ?? {}).map(n => [n, reg.personnages[n]]))
}

/** Cases de placement des Crâs d'un placement : celles du placement par défaut, remplacées Crâ par Crâ par les siennes. */
export function casesOf(reg: Registry, p: PlacementDef): Record<string, number> {
  return { ...defaultPlacement(reg)?.cases, ...p.cases }
}

/** Colonne des Crâs d'un placement : celle du placement par défaut, remplacée Crâ par Crâ par la sienne. */
export function colonneOf(reg: Registry, p: PlacementDef): Record<string, number> {
  return { ...defaultPlacement(reg)?.colonne, ...p.colonne }
}

/** Nom de fichier d'un placement : « Placement 2 » → « placement-2 ». */
export function slug(nom: string): string {
  return (
    nom
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'placement'
  )
}

/**
 * Placement créé pour des monstres inconnus : leurs espèces et leurs cases seulement ; les Crâs y gardent les cases et
 * la colonne du placement par défaut. Nom : « Auto <cases> », suivi d'un numéro si un autre placement inconnu occupe
 * déjà ces cases (`noms` : noms déjà pris).
 */
export function autoPlacement(monstres: PlacementMonster[], noms: string[] = []): PlacementDef {
  const base = `Auto ${cellules(monstres)}`
  let nom = base
  for (let k = 2; noms.includes(nom); k++) nom = `${base} (${k})`
  return { nom, auto: true, monstres: [...monstres].sort((a, b) => a.cellule - b.cellule) }
}
