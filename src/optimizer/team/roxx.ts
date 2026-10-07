/**
 * Import d'un stuff depuis un lien de partage RoxxSolver (https://roxxsolver.com/solver?build=…).
 *
 * Format du paramètre `build` (lu dans le JavaScript public du site, fonctions `cne` / `une`, 2026-10) : base64url d'un
 * flux binaire big-endian — octet de version (1), puis des blocs étiquetés :
 *   1 : uint16 = sexe + 2·(élément de forgemagie d'arme 0-4) + 10·classe (0-18) + 200·(niveau − 1)
 *   2 : uint16 masque des 16 emplacements, puis un uint16 (id d'objet Ankama = id DofusDB) par bit
 *   3 : uint8 masque des 6 caractéristiques, puis les points investis sur 10 bits chacun (bits concaténés, octet complété)
 *   4 : uint8 masque des 6 caractéristiques, puis un uint8 de parchemins par bit
 *   5 : uint16 masque des emplacements forgemagés, puis par emplacement : uint8 nombre de lignes, et par ligne
 *       uint8 caractéristique + int16 valeur
 *   6 : forgemagie « globale » : uint8 nombre de lignes, puis uint8 caractéristique + int16 valeur
 *   7 : nom : uint8 longueur + UTF-8
 * Emplacements : arme, bouclier, coiffe, amulette, anneau ×2, ceinture, cape, bottes, monture/familier, 6 Dofus/trophées.
 * Caractéristiques (blocs 3-4) : Vitalité, Force, Intelligence, Chance, Agilité, Sagesse. Classes : Féca 0 … Ouginak 17,
 * Forgelance 18 (id de classe 20 chez Ankama).
 *
 * Le paramètre `config` (réglages du solveur : sorts, conditions, options) n'est pas importé.
 */
import type { StatKey } from '../../core/types'
import type { EquippedItem } from '../../stats/build'
import type { PrimaryStat } from '../../stats/characteristicPoints'
import { TRANSCENDENCE_RUNES, type ExoLine } from '../../stats/forgemagie'
import type { BuildDataSource } from '../../stats/build'
import type { SheetBuild } from '../../stats/sheet'

/** Caractéristiques RoxxSolver (index du flux) → clés `Stats` ; `null` : sans équivalent (pods). */
const ROXX_STATS: readonly (StatKey | null)[] = [
  'vitality', 'strength', 'intelligence', 'chance', 'agility', 'wisdom', 'power', 'critical', 'ap', 'mp', 'range', 'summons',
  'damage', 'reflect', 'neutralDamage', 'earthDamage', 'fireDamage', 'waterDamage', 'airDamage', 'heals', 'prospecting',
  'initiative', null, 'neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct', 'tackleBlock', 'tackleEvade',
  'neutralRes', 'earthRes', 'fireRes', 'waterRes', 'airRes', 'apReduction', 'mpReduction', 'apParry', 'mpParry', 'criticalRes',
  'pushRes', 'criticalDamage', 'pushDamage', 'trapPower', 'trapDamage', 'meleeDamagePct', 'rangedDamagePct', 'spellDamagePct',
  'weaponDamagePct', 'meleeResPct', 'rangedResPct', 'weaponResPct',
]
const ROXX_PRIMARY: readonly PrimaryStat[] = ['vitality', 'strength', 'intelligence', 'chance', 'agility', 'wisdom']
const WEAPON_ELEMENTS = ['', 'Terre', 'Feu', 'Eau', 'Air'] as const
const SLOT_NAMES = ['arme', 'bouclier', 'coiffe', 'amulette', 'anneau 1', 'anneau 2', 'ceinture', 'cape', 'bottes', 'monture/familier',
  'Dofus 1', 'Dofus 2', 'Dofus 3', 'Dofus 4', 'Dofus 5', 'Dofus 6'] as const

export interface RoxxForgeLine {
  /** Index RoxxSolver de la caractéristique et sa clé `Stats` (undefined : sans équivalent). */
  index: number
  stat?: StatKey
  value: number
}

/** Contenu brut d'un lien RoxxSolver. */
export interface RoxxBuild {
  version: number
  level: number
  /** Classe RoxxSolver (0-18) et id de classe Ankama correspondant. */
  roxxClass: number
  breedId: number
  sex: 0 | 1
  /** Élément de forgemagie de l'arme (0 : aucun ; 1 Terre, 2 Feu, 3 Eau, 4 Air). */
  weaponElement: number
  /** Ids d'objets des 16 emplacements (0 : vide). */
  items: number[]
  /** Forgemagie de chaque emplacement. */
  forge: RoxxForgeLine[][]
  globalForge: RoxxForgeLine[]
  points: Partial<Record<PrimaryStat, number>>
  /** Parchemins (absents du lien : tous à 0 chez RoxxSolver). */
  scrolls: Partial<Record<PrimaryStat, number>>
  hasScrolls: boolean
  name: string
  /** Bloc inconnu rencontré (lecture arrêtée, comme le site). */
  unknownTag?: number
}

/** Paramètre `build` d'un lien RoxxSolver (URL complète ou paramètre seul). */
export function roxxBuildParam(input: string): string {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text)
    if (!/(^|\.)roxxsolver\.com$/i.test(url.hostname)) throw new Error(`Lien RoxxSolver attendu (roxxsolver.com), pas ${url.hostname}`)
    const build = url.searchParams.get('build')
    if (!build) throw new Error('Ce lien RoxxSolver ne contient pas de stuff (paramètre « build » absent : partager « le build »)')
    return build
  }
  const m = /(?:^|[?&])build=([^&\s]+)/.exec(text)
  return m ? m[1] : text
}

function base64urlBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) throw new Error('Stuff RoxxSolver illisible (base64url attendu)')
  let b = s.replace(/-/g, '+').replace(/_/g, '/')
  if (b.length % 4) b += '='.repeat(4 - (b.length % 4))
  const bin = atob(b)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function forgeLine(index: number, value: number): RoxxForgeLine {
  return { index, stat: ROXX_STATS[index] ?? undefined, value }
}

/** Décode le paramètre `build` d'un lien RoxxSolver (voir l'en-tête). */
export function decodeRoxxBuild(input: string): RoxxBuild {
  const bytes = base64urlBytes(roxxBuildParam(input))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 0
  const need = (n: number) => {
    if (p + n > bytes.length) throw new Error('Stuff RoxxSolver tronqué')
  }
  need(1)
  const version = view.getUint8(p++)
  if (version !== 1) throw new Error(`Stuff RoxxSolver : version d'encodage ${version} non prise en charge (1 attendue)`)
  const out: RoxxBuild = {
    version, level: 200, roxxClass: 0, breedId: 1, sex: 0, weaponElement: 0, items: Array(16).fill(0),
    forge: Array.from({ length: 16 }, () => []), globalForge: [], points: {}, scrolls: {}, hasScrolls: false, name: '',
  }
  while (p < bytes.length) {
    const tag = view.getUint8(p++)
    if (tag === 1) {
      need(2)
      let u = view.getUint16(p)
      p += 2
      out.sex = (u % 2) as 0 | 1
      u = Math.floor(u / 2)
      out.weaponElement = u % 5
      u = Math.floor(u / 5)
      out.roxxClass = u % 20
      out.level = Math.floor(u / 20) + 1
      out.breedId = out.roxxClass === 18 ? 20 : out.roxxClass + 1
    } else if (tag === 2) {
      need(2)
      const mask = view.getUint16(p)
      p += 2
      for (let s = 0; s < 16; s++) if (mask & (1 << s)) {
        need(2)
        out.items[s] = view.getUint16(p)
        p += 2
      }
    } else if (tag === 3) {
      need(1)
      const mask = view.getUint8(p++)
      const stats = ROXX_PRIMARY.filter((_, i) => mask & (1 << i))
      const nBytes = Math.ceil((stats.length * 10) / 8)
      need(nBytes)
      let bit = p * 8
      for (const st of stats) {
        let v = 0
        for (let k = 0; k < 10; k++, bit++) v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1)
        out.points[st] = v
      }
      p += nBytes
    } else if (tag === 4) {
      need(1)
      const mask = view.getUint8(p++)
      for (let i = 0; i < 6; i++) if (mask & (1 << i)) {
        need(1)
        out.scrolls[ROXX_PRIMARY[i]] = view.getUint8(p++)
      }
      out.hasScrolls = true
    } else if (tag === 5) {
      need(2)
      const mask = view.getUint16(p)
      p += 2
      for (let s = 0; s < 16; s++) if (mask & (1 << s)) {
        need(1)
        const n = view.getUint8(p++)
        const lines: RoxxForgeLine[] = []
        for (let k = 0; k < n; k++) {
          need(3)
          lines.push(forgeLine(view.getUint8(p), view.getInt16(p + 1)))
          p += 3
        }
        out.forge[s] = lines
      }
    } else if (tag === 6) {
      need(1)
      const n = view.getUint8(p++)
      for (let k = 0; k < n; k++) {
        need(3)
        out.globalForge.push(forgeLine(view.getUint8(p), view.getInt16(p + 1)))
        p += 3
      }
    } else if (tag === 7) {
      need(1)
      const n = view.getUint8(p++)
      need(n)
      out.name = new TextDecoder().decode(bytes.subarray(p, p + n))
      p += n
    } else {
      out.unknownTag = tag
      break
    }
  }
  return out
}

/** Stuff importé : build au format des fichiers d'équipe et remarques sur ce qui n'a pas pu être repris tel quel. */
export interface RoxxImport {
  breedId: number
  level: number
  name: string
  build: SheetBuild
  warnings: string[]
}

/**
 * Build d'un lien RoxxSolver. Forgemagie : une ligne seule qui correspond à une rune de transcendance de niveau ≤ objet
 * (hors PA/PM/PO) est une transcendance ; sinon exo ou over (déduit de l'objet, `forgeKind`). Objets inconnus de nos
 * données, forgemagie d'arme élémentaire, forgemagie globale et caractéristiques sans équivalent sont signalés.
 * Les variantes de sorts ne font pas partie du lien : celles du preset du membre sont gardées par l'interface.
 */
export function roxxImport(input: string, data: BuildDataSource): RoxxImport {
  const r = decodeRoxxBuild(input)
  const warnings: string[] = []
  if (!data.breed(r.breedId)) throw new Error(`Stuff RoxxSolver : classe inconnue (${r.roxxClass})`)
  if (r.unknownTag !== undefined) warnings.push(`Bloc inconnu (0x${r.unknownTag.toString(16)}) : fin du lien ignorée.`)
  const items: EquippedItem[] = []
  for (let s = 0; s < 16; s++) {
    const id = r.items[s]
    if (!id) {
      if (r.forge[s].length) warnings.push(`Forgemagie sans objet (${SLOT_NAMES[s]}) ignorée.`)
      continue
    }
    const item = data.item(id)
    if (!item) {
      warnings.push(`Objet ${id} (${SLOT_NAMES[s]}) absent de nos données (DofusDB) : ignoré.`)
      continue
    }
    const lines = r.forge[s]
    const exos: ExoLine[] = []
    for (const l of lines) {
      if (!l.stat) {
        warnings.push(`${item.name} : forgemagie sans équivalent (caractéristique ${l.index}) ignorée.`)
        continue
      }
      const rune =
        lines.length === 1 && !['ap', 'mp', 'range'].includes(l.stat)
          ? TRANSCENDENCE_RUNES.find(t => t.stat === l.stat && t.value === l.value && t.level <= item.level)
          : undefined
      exos.push(rune ? { stat: l.stat, value: l.value, kind: 'transcendence' } : { stat: l.stat, value: l.value })
    }
    items.push(exos.length ? { itemId: id, exos } : { itemId: id })
  }
  if (r.weaponElement) warnings.push(`Forgemagie élémentaire de l'arme (${WEAPON_ELEMENTS[r.weaponElement]}) non simulée : arme gardée dans son élément d'origine.`)
  if (r.globalForge.length) warnings.push(`Forgemagie globale du lien (${r.globalForge.length} ligne(s)) non importée.`)
  if (!r.hasScrolls) warnings.push('Le lien ne contient pas de parchemins : 0 partout (à vérifier).')
  return {
    breedId: r.breedId,
    level: r.level,
    name: r.name,
    build: { level: r.level, items, characteristicPoints: { ...r.points }, scrolls: { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0, ...r.scrolls } },
    warnings,
  }
}
