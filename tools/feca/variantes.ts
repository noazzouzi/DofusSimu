// Variantes de sorts équipées, déclarées par personnage : la liste du jeu (message hkh) ne donne que le sort de base de
// chaque paire (combat du 2026-10-17 : Frisson, Renfort et Torpeur au lieu de Giboulée, Ataraxie et Escapade ; Torpeur
// planifiée a bloqué le script), et AnkaBot n'a aucune méthode pour lire les variantes équipées.
//
// Fichier <dossier des journaux>/variantes.json (data/fightlogs/variantes.json), lu à chaque nouvel état :
//   { "Kaskyzo": ["Giboulée", "Ataraxie", "Escapade"] }      (noms ou identifiants de sorts)
import { existsSync, readFileSync } from 'node:fs'
import { data } from '../reine-des-voleurs/planificateur/etat'

export type SpellList = { spellId: number; grade: number }[]

/** Identifiant d'un sort de classe donné par son nom (français) ou son identifiant. */
function spellIdOf(x: string | number): number | undefined {
  if (typeof x === 'number' || /^\d+$/.test(String(x))) return data.spell(Number(x)) ? Number(x) : undefined
  const want = String(x).trim().toLowerCase()
  for (const b of data.listBreeds()) {
    for (const s of data.breedSpells(b.id, 200)) if (data.spell(s.spellId)?.name.toLowerCase() === want) return s.spellId
  }
  return undefined
}

/** Remplace, dans la liste, le sort de la paire de chaque variante par celle-ci (grade gardé, borné à ses niveaux). */
export function appliquerVariantes(list: SpellList, variantes: (string | number)[]): SpellList {
  const out = list.map(x => ({ ...x }))
  for (const v of variantes) {
    const id = spellIdOf(v)
    const sv = id !== undefined ? data.spell(id) : undefined
    if (!sv || sv.pairIndex === undefined) continue
    const levels = sv.levels.length
    const k = out.findIndex(x => {
      const s = data.spell(x.spellId)
      return s?.breedId === sv.breedId && s?.pairIndex === sv.pairIndex
    })
    if (k >= 0) out[k] = { spellId: sv.id, grade: Math.max(1, Math.min(levels, out[k].grade)) }
    else out.push({ spellId: sv.id, grade: levels })
  }
  return out
}

/** Variantes déclarées par personnage (fichier absent ou illisible : aucune). */
export function lireVariantes(file: string): Record<string, (string | number)[]> {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, (string | number)[]>) : {}
  } catch {
    return {}
  }
}
