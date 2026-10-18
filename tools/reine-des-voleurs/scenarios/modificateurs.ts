// Registre des modificateurs de dimension de la Reine des Voleurs (data/reine/modificateurs.json). Le modificateur d'un
// combat se reconnaît aux sorts lancés au début de la manche 1, avant le premier tour, par les Crâs et/ou les monstres
// (Crâs +25 % dommages finaux et monstres +50 % vitalité, monstres soignés de 50 % des dommages infligés…), hors sorts
// lancés à chaque combat (« communs » : passifs des Crâs, Péché Mignon, Doublage).
//
// Un ensemble de sorts encore inconnu crée un modificateur à l'apprentissage (apprendre.ts), nommé « Auto <sorts> » : il
// suffit de le renommer. Un nouveau passif des Crâs (équipement changé) en créerait un aussi : ajouter alors son sort aux
// « communs » et renommer le combat (son modificateur se recalcule à la prochaine relecture de sa session).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ModifierDef {
  nom: string
  /** Sorts lancés au début du combat qui le signalent (hors communs), triés. */
  sorts: number[]
  /** Ce qu'on en sait (effets relevés dans les journaux). */
  effets?: string
  /** Créé par l'apprentissage, pas encore relu. */
  auto?: boolean
}

export interface ModifierRegistry {
  version: 1
  notes?: string[]
  /** Sorts lancés au début de chaque combat, quel que soit le modificateur. */
  communs: number[]
  modificateurs: ModifierDef[]
}

export const MODIFIERS_FILE = join('data', 'reine', 'modificateurs.json')

/**
 * Lancés au début de chaque combat du 2026-10-09 au 2026-10-12 : passifs des Crâs (26005, 32462 Flèche de Rédemption,
 * 32480, 21977, 5952 Bleu Turquoise, 8395 Pourpre Profond) et mécaniques du donjon (4693 Péché Mignon, 4776 et 4777
 * Doublage).
 */
export const COMMUNS = [4693, 4776, 4777, 5952, 8395, 21977, 26005, 32462, 32480]

export function loadModifiers(root = process.cwd()): ModifierRegistry {
  const file = join(root, MODIFIERS_FILE)
  if (!existsSync(file)) return { version: 1, communs: [...COMMUNS], modificateurs: [] }
  const reg = JSON.parse(readFileSync(file, 'utf8')) as ModifierRegistry
  checkModifiers(reg)
  return reg
}

export function checkModifiers(reg: ModifierRegistry): void {
  const names = new Set<string>()
  const keys = new Map<string, string>()
  for (const m of reg.modificateurs) {
    if (!m.nom) throw new Error(`${MODIFIERS_FILE} : modificateur sans nom`)
    if (names.has(m.nom)) throw new Error(`${MODIFIERS_FILE} : modificateur « ${m.nom} » en double`)
    names.add(m.nom)
    if (!Array.isArray(m.sorts) || m.sorts.some(s => !Number.isInteger(s))) throw new Error(`${MODIFIERS_FILE} : « ${m.nom} », sorts invalides`)
    const key = modifierKey(m.sorts)
    const other = keys.get(key)
    if (other) throw new Error(`${MODIFIERS_FILE} : « ${m.nom} » et « ${other} » ont les mêmes sorts (${key || 'aucun'})`)
    keys.set(key, m.nom)
  }
}

export function saveModifiers(reg: ModifierRegistry, root = process.cwd()): string {
  checkModifiers(reg)
  const file = join(root, MODIFIERS_FILE)
  mkdirSync(dirname(file), { recursive: true })
  const j = (x: unknown) => JSON.stringify(x)
  const out = ['{', `  "version": ${reg.version},`]
  if (reg.notes?.length) out.push(`  "notes": [\n${reg.notes.map(n => `    ${j(n)}`).join(',\n')}\n  ],`)
  out.push(`  "communs": ${j(reg.communs)},`)
  out.push(`  "modificateurs": [\n${reg.modificateurs.map(m => `    ${j(m)}`).join(',\n')}\n  ]`)
  out.push('}')
  writeFileSync(file, out.join('\n') + '\n')
  return file
}

/** Clé d'un ensemble de sorts : « 4655+4667 » (vide : aucun sort hors communs). */
export function modifierKey(sorts: number[]): string {
  return [...new Set(sorts)].sort((a, b) => a - b).join('+')
}

/** Sorts du début d'un combat qui signalent son modificateur (hors communs), triés. */
export function modifierSpells(reg: ModifierRegistry, sortsDebut: number[]): number[] {
  const communs = new Set(reg.communs)
  return [...new Set(sortsDebut.filter(s => !communs.has(s)))].sort((a, b) => a - b)
}

/** Modificateur signalé exactement par ces sorts (déjà privés des communs). */
export function recognizeModifier(reg: ModifierRegistry, sorts: number[]): ModifierDef | undefined {
  const key = modifierKey(sorts)
  return reg.modificateurs.find(m => modifierKey(m.sorts) === key)
}

/** Modificateur créé pour des sorts inconnus : « Auto <sorts> » (« Aucun » : pas de sort hors communs). */
export function autoModifier(sorts: number[], noms: string[] = []): ModifierDef {
  const base = sorts.length ? `Auto ${modifierKey(sorts)}` : 'Aucun'
  let nom = base
  for (let k = 2; noms.includes(nom); k++) nom = `${base} (${k})`
  return { nom, sorts: [...sorts].sort((a, b) => a - b), auto: true }
}
