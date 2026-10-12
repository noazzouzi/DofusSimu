// Registre des placements de la Reine des Voleurs (data/reine/placements.json) : pour chaque placement des monstres
// (leurs cases au début du combat, la signature que le script reconnaît pendant la phase de placement), la case de
// placement de chaque Crâ et sa case de la colonne (il y revient à la fin de chacun de ses tours).
//
// Un placement s'ajoute à la main dans le fichier (monstres, et au besoin cases et colonne : sans elles, celles du
// placement par défaut), ou tout seul : un combat appris (apprendre.ts) dont les monstres ne correspondent à aucun
// placement connu en crée un, nommé « Auto <cases des monstres> », avec les cases où les Crâs ont commencé et fini leurs
// tours. Il suffit alors de le renommer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PlacementMonster { espece: number; cellule: number; nom?: string }

export interface PlacementDef {
  nom: string
  /** Monstres au début du combat : la signature du placement (les cases seules sont comparées, comme en jeu). */
  monstres: PlacementMonster[]
  /** Case de placement de chaque Crâ (nom du personnage → case) ; absente : celle du placement par défaut. */
  cases?: Record<string, number>
  /** Case de la colonne de chaque Crâ ; absente : celle du placement par défaut. */
  colonne?: Record<string, number>
  /** Créé par l'apprentissage (placement de monstres rencontré en combat, pas encore déclaré). */
  auto?: boolean
  notes?: string
}

export interface Registry {
  version: 1
  carte: number
  /** Placement dont les cases des Crâs servent aux placements de monstres inconnus (FORMATION_PAR_DEFAUT du script). */
  defaut?: string
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
    for (const m of p.monstres) if (!Number.isInteger(m.cellule)) throw new Error(`${PLACEMENTS_FILE} : « ${p.nom} », case de monstre invalide`)
    const sig = signature(p.monstres)
    const other = sigs.get(sig)
    if (other) throw new Error(`${PLACEMENTS_FILE} : « ${p.nom} » et « ${other} » ont les mêmes cases de monstres (${sig})`)
    sigs.set(sig, p.nom)
  }
  if (reg.defaut && !names.has(reg.defaut)) throw new Error(`${PLACEMENTS_FILE} : placement par défaut « ${reg.defaut} » inconnu`)
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
  if (reg.notes?.length) out.push(`  "notes": [\n${reg.notes.map(n => `    ${j(n)}`).join(',\n')}\n  ],`)
  out.push(`  "personnages": ${j(reg.personnages)},`)
  out.push('  "placements": [')
  reg.placements.forEach((p, i) => {
    const lines = [`      "nom": ${j(p.nom)}`]
    if (p.auto) lines.push('      "auto": true')
    if (p.notes) lines.push(`      "notes": ${j(p.notes)}`)
    lines.push(`      "monstres": [\n${p.monstres.map(m => `        ${j(m)}`).join(',\n')}\n      ]`)
    if (p.cases) lines.push(`      "cases": ${j(p.cases)}`)
    if (p.colonne) lines.push(`      "colonne": ${j(p.colonne)}`)
    out.push(`    {\n${lines.join(',\n')}\n    }${i < reg.placements.length - 1 ? ',' : ''}`)
  })
  out.push('  ]', '}')
  return out.join('\n') + '\n'
}

/** Signature d'un placement : cases des monstres, triées (le script ne compare que les cases). */
export function signature(monstres: { cellule: number }[]): string {
  return monstres.map(m => m.cellule).sort((a, b) => a - b).join('-')
}

/** Placement dont les monstres occupent exactement ces cases. */
export function recognize(reg: Registry, monstres: { cellule: number }[]): PlacementDef | undefined {
  const sig = signature(monstres)
  return reg.placements.find(p => signature(p.monstres) === sig)
}

export function defaultPlacement(reg: Registry): PlacementDef | undefined {
  return reg.placements.find(p => p.nom === reg.defaut) ?? reg.placements.find(p => p.cases && p.colonne)
}

/** Cases de placement des Crâs d'un placement (les siennes, sinon celles du placement par défaut). */
export function casesOf(reg: Registry, p: PlacementDef): Record<string, number> {
  return p.cases ?? defaultPlacement(reg)?.cases ?? {}
}

/** Colonne des Crâs d'un placement (la sienne, sinon celle du placement par défaut). */
export function colonneOf(reg: Registry, p: PlacementDef): Record<string, number> {
  return p.colonne ?? defaultPlacement(reg)?.colonne ?? {}
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
 * Placement créé pour des monstres inconnus : leurs cases, les cases de départ des Crâs du combat, et pour colonne la
 * case où chaque Crâ a le plus souvent fini ses tours.
 */
export function autoPlacement(monstres: PlacementMonster[], cases: Record<string, number>, fins: Record<string, number[]>): PlacementDef {
  const colonne: Record<string, number> = {}
  for (const [who, list] of Object.entries(fins)) {
    const n = new Map<number, number>()
    for (const c of list) if (c >= 0) n.set(c, (n.get(c) ?? 0) + 1)
    const best = [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    if (best) colonne[who] = best[0]
  }
  return { nom: `Auto ${signature(monstres)}`, auto: true, monstres: [...monstres].sort((a, b) => a.cellule - b.cellule), cases: { ...cases }, colonne }
}
