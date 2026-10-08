/**
 * Theorycraft contre un boss — index des boss, recherche par nom et grade selon le nombre de joueurs
 * (docs/design/theorycraft.md §1.1).
 *
 * Source des boss : `dungeons.json[].bosses` (126 donjons, 137 boss distincts au 2026-10-04) ; un donjon sans
 * `bosses[]` retombe sur les monstres du donjon marqués `isBoss` (les 58 Expéditions concernées ajoutent 25 boss
 * propres, soit 162 au total). Les donjons arrivent par une `DungeonSource` (adaptateur Node : src/theorycraft/node.ts,
 * qui lit `NodeDataStore.rawFile('dungeons.json')` et décide quels donjons sont des Expéditions).
 *
 * Module PUR : aucun import `node:`, rien de src/dungeons/vortex ni de src/dungeons/generic/dummy.
 */
import type { GameDataStore } from '../data/store'
import type { BossEntry, DungeonSource } from './types'

export interface ListBossesOptions {
  /** Inclure les donjons « Expédition » (défaut : non). */
  includeExpeditions?: boolean
}

/**
 * Boss de tous les donjons, un par monstre (un boss présent dans plusieurs donjons est fusionné : ses donjons sont
 * listés dans `dungeons`). Expéditions exclues par défaut : leurs donjons n'apparaissent pas dans `dungeons` et les
 * boss qui n'existent que par elles sont omis. Les ids absents des données de monstres sont ignorés.
 *
 * Tri : niveau du premier donjon (classique d'abord), puis nom, puis id — ordre stable d'une exécution à l'autre.
 */
export function listBosses(data: GameDataStore, src: DungeonSource, opts: ListBossesOptions = {}): BossEntry[] {
  const byId = new Map<number, BossEntry>()
  for (const d of src.dungeons()) {
    if (d.isExpedition && !opts.includeExpeditions) continue
    let ids: readonly number[] = d.bossIds
    let source: BossEntry['source'] = 'bosses'
    if (!ids.length) {
      ids = [...new Set(d.monsterIds)].filter(id => data.monster(id)?.isBoss)
      source = 'isBoss'
    }
    for (const id of ids) {
      const m = data.monster(id)
      if (!m || !m.grades.length) continue
      let entry = byId.get(id)
      if (!entry) {
        const g1 = m.grades.find(g => g.grade === 1) ?? m.grades[0]
        entry = { monsterId: id, name: m.name, dungeons: [], bossLevel: g1.level, gradeCount: m.grades.length, isExpedition: true, source }
        byId.set(id, entry)
      }
      if (!entry.dungeons.some(x => x.id === d.id))
        entry.dungeons.push({ id: d.id, name: d.name, level: d.optimalPlayerLevel, isExpedition: d.isExpedition })
      if (source === 'bosses') entry.source = 'bosses'
    }
  }
  const out = [...byId.values()]
  for (const e of out) {
    e.dungeons.sort((a, b) => Number(a.isExpedition) - Number(b.isExpedition) || a.level - b.level || a.id - b.id)
    e.isExpedition = e.dungeons.every(x => x.isExpedition)
  }
  return out.sort(
    (a, b) => a.dungeons[0].level - b.dungeons[0].level || compareNames(a.name, b.name) || a.monsterId - b.monsterId,
  )
}

function compareNames(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  return na < nb ? -1 : na > nb ? 1 : 0
}

// ---------------------------------------------------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Forme de recherche d'un texte : minuscules, sans accents (décomposition NFD), ligatures « œ »/« æ » développées,
 * ponctuation et apostrophes remplacées par des espaces, espaces fusionnés. Ex. « Père Ver » → « pere ver »,
 * « L'Œil de Vortex » → « l oeil de vortex ».
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Score de pertinence d'un nom normalisé pour une requête normalisée (0 = aucune correspondance). */
function nameScore(name: string, q: string, exact: number): number {
  if (name === q) return exact
  if (name.startsWith(q)) return exact - 20
  if (name.split(' ').some(w => w.startsWith(q)) || name.includes(' ' + q)) return exact - 30
  if (name.includes(q)) return exact - 40
  return 0
}

/**
 * Score d'une entrée : nom du boss (100 exact, 80 préfixe, 70 début de mot, 60 sous-chaîne), sinon nom d'un de ses
 * donjons (50 / 30 / 20 / 10), sinon 5 si chaque mot de la requête commence un mot du boss ou de ses donjons.
 */
function entryScore(e: BossEntry, q: string): number {
  const name = normalize(e.name)
  let s = nameScore(name, q, 100)
  if (s) return s
  for (const d of e.dungeons) s = Math.max(s, nameScore(normalize(d.name), q, 50))
  if (s) return s
  const words = [name, ...e.dungeons.map(d => normalize(d.name))].join(' ').split(' ')
  return q.split(' ').every(t => words.some(w => w.startsWith(t))) ? 5 : 0
}

interface ScoredEntry {
  entry: BossEntry
  score: number
}

function scoreAll(entries: readonly BossEntry[], query: string): ScoredEntry[] {
  const raw = query.trim()
  if (/^\d+$/.test(raw)) {
    const id = Number(raw)
    return entries.filter(e => e.monsterId === id).map(entry => ({ entry, score: 1000 }))
  }
  const q = normalize(raw)
  if (!q) return entries.map(entry => ({ entry, score: 0 }))
  const out: ScoredEntry[] = []
  for (const entry of entries) {
    const score = entryScore(entry, q)
    if (score > 0) out.push({ entry, score })
  }
  // Pertinence décroissante, puis nom le plus court (le plus spécifique), puis nom et id.
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.name.length - b.entry.name.length ||
      compareNames(a.entry.name, b.entry.name) ||
      a.entry.monsterId - b.entry.monsterId,
  )
}

/**
 * Boss correspondant à une requête, par pertinence décroissante : nom du boss OU nom d'un de ses donjons, sans
 * accents ni casse ; une requête purement numérique est un id de monstre (correspondance exacte). Requête vide :
 * toutes les entrées, dans leur ordre.
 */
export function searchBosses(entries: readonly BossEntry[], query: string): BossEntry[] {
  return scoreAll(entries, query).map(s => s.entry)
}

/** Nombre maximal de candidats cités dans une erreur d'ambiguïté. */
const MAX_CANDIDATES = 8

function describe(e: BossEntry): string {
  return `${e.name} (${e.monsterId}, ${e.dungeons[0]?.name ?? 'sans donjon'})`
}

/**
 * Résout un texte en un boss : id exact, sinon nom exact (sans accents ni casse), sinon meilleur résultat de
 * `searchBosses` s'il est seul à son score. Lève une erreur en français si rien ne correspond ou si la requête est
 * ambiguë (avec au plus 8 candidats « nom (id, donjon) »).
 */
export function resolveBoss(entries: readonly BossEntry[], text: string): BossEntry {
  const raw = text.trim()
  if (/^\d+$/.test(raw)) {
    const hit = entries.find(e => e.monsterId === Number(raw))
    if (!hit) throw new Error(`Aucun boss d'id ${raw} (les Expéditions sont exclues par défaut).`)
    return hit
  }
  const q = normalize(raw)
  if (!q) throw new Error('Nom de boss vide.')
  const exact = entries.filter(e => normalize(e.name) === q)
  if (exact.length === 1) return exact[0]
  const scored = exact.length > 1 ? exact.map(entry => ({ entry, score: 100 })) : scoreAll(entries, raw)
  if (!scored.length) throw new Error(`Aucun boss ne correspond à « ${raw} ».`)
  if (scored.length === 1 || scored[0].score > scored[1].score) return scored[0].entry
  const ties = scored.filter(s => s.score === scored[0].score)
  const shown = ties.slice(0, MAX_CANDIDATES).map(s => describe(s.entry))
  const more = ties.length > MAX_CANDIDATES ? ` (et ${ties.length - MAX_CANDIDATES} autres)` : ''
  throw new Error(`« ${raw} » est ambigu : ${shown.join(' ; ')}${more}. Précisez le nom ou donnez l'id du monstre.`)
}

// ---------------------------------------------------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Grade (= rang) du boss selon le nombre de joueurs : `joueurs − 3`, borné à 1..5 et au nombre de grades du monstre.
 * Règle des donjons modulaires (devblog 2.7 ; bestiaire 3.7 : « à 4, le boss sera de rang 1 »), sources et mesures
 * dans docs/research/vortex-audit.md §1.3 — même règle que `bossGradeFor` du Vortex, réécrite ici pour ne pas
 * dépendre de src/dungeons/vortex. Le grade 6 et plus (variantes hors donjon, ex. « Songes infinis ») n'est jamais
 * choisi : il faut l'imposer explicitement.
 */
export function bossGradeFor(players: number, gradeCount: number): number {
  if (!Number.isFinite(players)) throw new RangeError(`Nombre de joueurs invalide : ${players}`)
  const max = Math.max(1, Math.min(5, Math.floor(gradeCount)))
  return Math.max(1, Math.min(max, Math.floor(players) - 3))
}

/** Taille maximale d'un groupe (composition). */
export const MAX_PLAYERS = 8

/**
 * Taille de la composition pour un grade imposé : inverse de `bossGradeFor` (grade = joueurs − 3, de 1 à 5) — grade 1 :
 * 4 joueurs (défaut), grade G de 2 à 5 : G + 3, au-delà : `MAX_PLAYERS` (groupe maximal). Défaut de `rankClasses` quand
 * la fiche n'a pas de nombre de joueurs (grade imposé), pour la CLI comme pour la page web.
 */
export function playersForGrade(grade: number): number {
  return grade <= 1 ? 4 : Math.min(MAX_PLAYERS, grade + 3)
}
