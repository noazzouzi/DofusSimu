/**
 * Theorycraft contre un boss — adaptateur Node (seul fichier de src/theorycraft qui accède au disque).
 *
 *  - `nodeDungeonSource(store)` : donjons de `data/dofusdb/dungeons.json` (via `NodeDataStore.rawFile`) réduits à
 *    `DungeonLite`, pour `listBosses` (src/theorycraft/bosses.ts).
 *  - `loadBossOverrides(dir)` : fiches manuelles `data/bosses/<monsterId>.json` validées par `parseBossOverrides`
 *    (src/theorycraft/overrides.ts ; rôle et règles de rédaction : data/bosses/README.md).
 *
 * Règle « Expédition » (établie sur les données extraites le 2026-10-04) : un donjon est une Expédition si son nom
 * français commence par « Expédition » OU si sa difficulté vaut 0. Les deux critères désignent exactement les mêmes
 * 60 donjons (ids 143 à 205 sauf 163-165 ; noms anglais « Expedition – », « Daring … », « Bravery … »), aucun n'a de
 * `bosses[]` et aucun donjon classique n'a la difficulté 0 ; le OU garde la règle si l'un des deux champs change.
 * Leur niveau optimal va de 150 à 200 (44 sur 60 au niveau 200) : ce n'est donc pas un critère.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { textFr } from '../data/convert'
import type { NodeDataStore } from '../data/node'
import type { RawDungeon } from '../data/raw'
import { normalize } from './bosses'
import { parseBossOverrides } from './overrides'
import type { BossOverrides, DungeonLite, DungeonSource } from './types'

/** Racine du dépôt (src/theorycraft/node.ts -> ../..), pour trouver `data/bosses` hors du répertoire du dépôt. */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Le donjon brut est-il une Expédition ? (règle documentée en tête de fichier) */
export function isExpeditionDungeon(d: RawDungeon): boolean {
  return d.difficulty === 0 || normalize(textFr(d.name)).startsWith('expedition')
}

/** Donjon brut réduit aux champs utiles au theorycraft. */
export function toDungeonLite(d: RawDungeon): DungeonLite {
  return {
    id: d.id,
    name: textFr(d.name) || `Donjon ${d.id}`,
    optimalPlayerLevel: d.optimalPlayerLevel,
    minLevel: d.minLevel,
    difficulty: d.difficulty,
    bossIds: d.bosses ?? [],
    monsterIds: d.monsters ?? [],
    isExpedition: isExpeditionDungeon(d),
  }
}

/** Source des donjons lue dans `dungeons.json` (conversion faite une fois, à la première demande). */
export function nodeDungeonSource(store: NodeDataStore): DungeonSource {
  let cache: readonly DungeonLite[] | undefined
  return {
    dungeons() {
      if (!cache) cache = store.rawFile('dungeons.json').map(toDungeonLite)
      return cache
    },
  }
}

/** Dossier existant : chemin absolu tel quel, sinon relatif au répertoire courant puis à la racine du dépôt. */
function findDir(dir: string): string | undefined {
  const candidates = isAbsolute(dir) ? [dir] : [resolve(dir), resolve(REPO_ROOT, dir)]
  return candidates.find(c => existsSync(c) && statSync(c).isDirectory())
}

/**
 * Fiches manuelles du dossier `dir` (défaut `data/bosses`), indexées par monstre. Seuls les fichiers `*.json` sont
 * lus ; ceux dont le nom commence par « _ » (modèle `_template.json`, brouillons) sont ignorés, comme le README.
 * Chaque fiche doit s'appeler `<monsterId>.json` (une fiche par monstre). Toute erreur (JSON invalide, schéma, nom de fichier) lève
 * une exception qui cite le fichier. Dossier introuvable : aucune fiche (Map vide).
 */
export function loadBossOverrides(dir = 'data/bosses'): Map<number, BossOverrides> {
  const out = new Map<number, BossOverrides>()
  const found = findDir(dir)
  if (!found) return out
  const files = readdirSync(found)
    .filter(f => f.toLowerCase().endsWith('.json') && !f.startsWith('_'))
    .sort()
  for (const file of files) {
    const label = join(dir, file)
    let json: unknown
    try {
      json = JSON.parse(readFileSync(join(found, file), 'utf8'))
    } catch (err) {
      throw new Error(`${label} : JSON invalide (${(err as Error).message})`)
    }
    const o = parseBossOverrides(json, label)
    if (file !== `${o.monsterId}.json`) throw new Error(`${label} : le fichier doit s'appeler ${o.monsterId}.json (monsterId ${o.monsterId})`)
    out.set(o.monsterId, o)
  }
  return out
}
