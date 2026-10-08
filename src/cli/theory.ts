/**
 * CLI du THEORYCRAFT DÉTERMINISTE contre un boss (docs/design/theorycraft.md §2) — commandes de `npm run sim`
 * (src/cli/simulate.ts) :
 *
 *   bosses [recherche]        index des boss (`listBosses`, `searchBosses`) : nom, id, donjons, niveaux, grades, Expédition
 *   boss <nom|id>             fiche du boss (`bossProfile` + `formatBoss`) ; `--details` : tous les sorts du boss et
 *                             arbre du sort de départ (aide à la rédaction d'une fiche data/bosses/<id>.json)
 *   boss <nom|id> classes     classement des classes (`rankClasses` + `formatClasses`)
 *   boss <nom|id> stuff       meilleur stuff (`stuffVsBoss` + `formatStuffVsBoss`) ; `--out` : build réutilisable
 *   degats                    dégâts d'UN sort d'un personnage contre le boss ou des résistances données (vérification
 *                             en jeu sur un Poutch) : lignes du profil de sort (src/ai/core/spellProfile.ts) passées au
 *                             pipeline src/damage (`damageRange`, `meanPrepared`, `expectedDamage`, `explainDamage`,
 *                             `critChance`) — aucune formule recodée ici
 *
 * Choix (documentés dans l'aide) :
 *  - Boss : nom ou id résolu parmi les donjons classiques (`resolveBoss`, erreur « ambigu » avec candidats) ; un boss
 *    introuvable parmi eux est cherché parmi les Expéditions (`--all` : directement parmi tous). Les positionnels
 *    sont joints par des espaces (`boss pere ver classes` ≡ `boss "Père Ver" classes`).
 *  - Fiche manuelle `data/bosses/<id>.json` appliquée par défaut (`loadBossOverride` : ce seul fichier, validé comme
 *    par `loadBossOverrides` ; dossier `--bosses-dir`, défaut `<--data>/bosses`) ; `--no-overrides` l'ignore. Un fichier
 *    mal nommé du dossier (`kimbo.json`) est signalé dans les avertissements (`misnamedOverrides`).
 *  - `stuff --class <classe>` : PREMIER preset de base de la classe (ordre de data/ai/presets.json), les autres
 *    presets cités en note — chaque classe a au moins deux presets de base : exiger un preset rendrait `--class cra`
 *    toujours ambigu ; `--elements all` compare de toute façon les quatre éléments. Avec `--build` / `--roxx`, la
 *    classe vient du build (`--class` facultatif : preset désigné, ou classe vérifiée) et le preset est choisi par
 *    `stuffVsBoss` selon l'élément du build.
 *  - `stuff --out` : fichier « dofussimu-build » (même forme que `stuff <scénario> --out`, src/cli/optimize.ts) dont
 *    le champ `build` est le format des fichiers d'équipe (data/teams, champ `build`) ; relu par `--build`.
 *  - `degats` : mêlée ⇔ cible sur une case ADJACENTE au lanceur (règle du jeu, `isMeleeHit`) ; un sort de portée
 *    1 à N (ou à zone autour du lanceur) est calculé dans les deux cas, sauf `--melee` / `--distance`. Contre un boss,
 *    la vulnérabilité de ses phases est appliquée (invulnérable à distance ⇒ 0 à distance, avertissement) et les
 *    résistances de chaque phase (un tableau par jeu de résistances quand elles en dépendent). Seules les lignes dont
 *    le masque de cible sélectionne la cible (boss, ou Poutch pour `--res`) sont calculées, comme dans le DPT du
 *    theorycraft ; les autres sont comptées par raison (invocations, alliés…).
 *  - Drapeaux booléens déclarés (`THEORY_BOOLEAN_FLAGS`) : ils n'avalent jamais le positionnel qui suit. Options
 *    déclarées par commande (`THEORY_OPTIONS`) : une option inconnue, ou d'une autre sous-commande, est une erreur.
 *  - Aucune écriture de fichier sans `--out` ; `--json` = JSON sur la sortie standard ; progression sur stderr (avec
 *    `--json`, seulement si stderr est un terminal), ligne fermée avant toute erreur (`progressLine`).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isMeleeSpell } from '../ai/core/dpt'
import { createSpellProfileIndex, maskSides, type DamageLineX } from '../ai/core/spellProfile'
import { ELEMENT_FIXED_DAMAGE, ELEMENT_MAIN_STAT, ELEMENT_NAMES_FR, ELEMENT_RES_PCT, emptyStats, type Element, type StatKey, type Stats } from '../core/types'
import { critChance } from '../damage/crit'
import { damageRange, expectedDamage, explainDamage, meanPrepared, prepareDamage, type DamageExplanation, type DamageInput } from '../damage/damage'
import { hpBasedDamage } from '../damage/life'
import type { EffectData, SpellLevelData } from '../data/model'
import type { NodeDataStore } from '../data/node'
import { effectSpellRef, effectStateRef, effectSummonRef } from '../data/refs'
import { DAMAGE_SPECS, resolveElement } from '../engine/effects/damage/pipeline'
import { breedSpellIds } from '../engine/factory'
import { compileTargetMask, matchesTargetMask } from '../engine/targetMask'
import type { Fighter } from '../engine/types'
import { EXPONENT_PROFILES, type ExponentProfile } from '../optimizer/stuff/profiles'
import { BASE_PRESETS, breedIdOf, findPreset, normalizeName, presetBuild, resolvePreset, type Preset } from '../optimizer/team/presets'
import { roxxImport } from '../optimizer/team/roxx'
import { computeBuildStats, fullScrolls, type CharacterBuild, type EquippedItem } from '../stats/build'
import { statLabelFr } from '../stats/sheet'
import {
  bossProfile,
  dominantElement,
  formatBoss,
  formatClasses,
  formatStuffVsBoss,
  listBosses,
  normalize,
  parseBossOverrides,
  rankClasses,
  resolveBoss,
  searchBosses,
  stuffVsBoss,
  type BossEntry,
  type BossOverrides,
  type BossProfileDetail,
  type BossProfileOptions,
  type BossSpellDetail,
  type StuffElement,
  type StuffInput,
  type StuffVsBossOptions,
  type StuffVsBossResult,
} from '../theorycraft/analysis'
import { MAX_PLAYERS, playersForGrade } from '../theorycraft/bosses'
import { bossFighter, playerFighterFromStats, theoryEngine } from '../theorycraft/fighters'
import { bullets, fmtNum, fmtPct, section, textTable } from '../theorycraft/formatBoss'
import { possibleHits } from '../theorycraft/hits'
import { nodeDungeonSource } from '../theorycraft/node'
import { bool, dataDirOf, REPO_ROOT, type Args } from './common'

/**
 * Taille maximale d'un groupe (`--players`) et taille de la composition pour un grade imposé (`--grade G` ⇒ G + 3
 * joueurs, 8 au plus) : définies dans src/theorycraft/bosses.ts (même règle pour la CLI, `rankClasses` et la page web),
 * ré-exportées ici pour les appelants de la CLI.
 */
export { MAX_PLAYERS, playersForGrade }

/** Drapeaux sans valeur des commandes du theorycraft (`parseArgs(argv, THEORY_BOOLEAN_FLAGS)`). */
export const THEORY_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['all', 'json', 'details', 'no-overrides', 'optimize', 'crit', 'trace', 'melee', 'distance'])

/** Sous-commandes de `boss <nom|id>`. */
const BOSS_SUBCOMMANDS = ['classes', 'stuff'] as const

/** Options du choix du boss (`bossOf`), communes à `boss` et à `degats --boss`. */
const BOSS_OPTIONS = ['players', 'grade', 'no-overrides', 'all', 'bosses-dir'] as const
/**
 * Options permises par commande (en plus de `--data`, commune à toute la CLI) : une autre option est refusée
 * (`checkOptions`) plutôt qu'ignorée en silence — ex. `--out` sur la fiche, `--level` sur `degats`.
 */
export const THEORY_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  bosses: ['all', 'json'],
  boss: [...BOSS_OPTIONS, 'details', 'json'],
  'boss … classes': [...BOSS_OPTIONS, 'optimize', 'iterations', 'profile', 'level', 'out', 'json'],
  'boss … stuff': [
    ...BOSS_OPTIONS,
    'class',
    'roxx',
    'build',
    'elements',
    'profile',
    'top',
    'iterations',
    'restarts',
    'seed',
    'level',
    'range',
    'fixed',
    'exclude',
    'out',
    'json',
  ],
  degats: ['preset', 'build', 'roxx', 'sort', 'boss', ...BOSS_OPTIONS, 'res', 'melee', 'distance', 'trace', 'crit', 'json'],
}

/** Erreur « option inconnue » si une option n'est pas permise par la commande (voir `THEORY_OPTIONS`). */
function checkOptions(a: Args, cmd: string): void {
  const allowed = THEORY_OPTIONS[cmd]
  for (const k of a.flags.keys()) {
    if (k === 'data' || allowed.includes(k)) continue
    const elsewhere = Object.keys(THEORY_OPTIONS).filter(c => c !== cmd && THEORY_OPTIONS[c].includes(k))
    const hint = elsewhere.length ? ` — option de ${elsewhere.map(c => `« ${c} »`).join(', ')}` : ''
    throw new Error(`${cmd} : option inconnue --${k}${hint} (options : ${allowed.map(o => `--${o}`).join(', ')})`)
  }
}

/** Profondeur maximale de l'arbre du sort de départ (comme les fermetures de bossProfile.ts). */
const TREE_DEPTH = 4

const today = (): string => new Date().toISOString().slice(0, 10)
/** Chemin affiché : relatif au dossier courant s'il y est, sinon absolu. */
const rel = (p: string): string => {
  const r = relative(process.cwd(), p)
  return r && !r.startsWith('..') && !isAbsolute(r) ? r : p
}
const elementName = (el: number): string => (el >= 0 && el <= 4 ? ELEMENT_NAMES_FR[el as Element] : 'aucun')
/** Élément d'un stuff (`dominantElement`) en français. */
const STUFF_ELEMENT_FR: Readonly<Record<StuffElement, string>> = { earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air' }
/** Nom d'une classe (« Crâ »), l'id à défaut. */
const breedName = (data: NodeDataStore, breedId: number): string => data.breed(breedId)?.name ?? `classe ${breedId}`
/** Durée en secondes à la française (« 0,5 s »). */
const seconds = (ms: number): string => `${fmtNum(ms / 1000, 1)} s`
/** Progression sur stderr : toujours en texte ; avec `--json`, seulement dans un terminal (stderr d'un script propre). */
const showProgress = (json: boolean): boolean => !json || !!process.stderr.isTTY

/**
 * Ligne de progression sur stderr, réécrite en place (`\r`, complétée à 70 colonnes) : `write` la remplace, `end` y met
 * le bilan et passe à la ligne. `around` exécute un calcul et, s'il lève une erreur, ferme d'abord la ligne : le
 * « Erreur : … » de la CLI ne s'écrit pas à la suite de la progression.
 */
export function progressLine(): { write(text: string): void; end(text: string): void; around<T>(fn: () => T): T } {
  let shown = false
  return {
    write(text) {
      shown = true
      process.stderr.write(`\r${text}`.padEnd(70))
    },
    end(text) {
      if (shown) process.stderr.write(`\r${text}`.padEnd(70) + '\n')
      shown = false
    },
    around(fn) {
      try {
        return fn()
      } catch (e) {
        if (shown) process.stderr.write('\n')
        shown = false
        throw e
      }
    },
  }
}

// ───────────────────────────── options ─────────────────────────────

/** Valeur texte d'une option ; erreur si l'option est donnée sans valeur. */
function strFlag(a: Args, k: string, hint = 'valeur'): string | undefined {
  const v = a.flags.get(k)
  if (v === true) throw new Error(`--${k} : ${hint} attendu(e)`)
  return v
}

/** Entier d'une option, borné (erreur en français sinon) ; undefined si l'option est absente. */
function optInt(a: Args, k: string, min = -Infinity, max = Infinity): number | undefined {
  const v = strFlag(a, k, 'nombre')
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) {
    const range = max < Infinity ? ` entre ${min} et ${max}` : min > -Infinity ? ` ≥ ${min}` : ''
    throw new Error(`--${k} : entier${range} attendu (« ${v} »)`)
  }
  return n
}

/** Liste d'ids d'objets `1,2,3` (objets connus). */
function itemIds(a: Args, k: string, data: NodeDataStore): number[] | undefined {
  const v = strFlag(a, k, "liste d'ids d'objets")
  if (v === undefined) return undefined
  const ids = v.split(',').map(x => x.trim()).filter(Boolean).map(Number)
  if (!ids.length || !ids.every(Number.isInteger)) throw new Error(`--${k} : liste d'ids d'objets attendue (« ${v} »)`)
  for (const id of ids) if (!data.item(id)) throw new Error(`--${k} : objet inconnu (${id})`)
  return ids
}

/** Profil d'exposants du proxy (`--profile`). */
function profileFlag(a: Args): ExponentProfile | undefined {
  const p = strFlag(a, 'profile', 'profil')
  if (p !== undefined && !(EXPONENT_PROFILES as readonly string[]).includes(p)) throw new Error(`--profile : ${EXPONENT_PROFILES.join('|')} attendu (« ${p} »)`)
  return p as ExponentProfile | undefined
}

/** Dossier des fiches manuelles : `--bosses-dir`, sinon `<--data>/bosses`. */
const overridesDirOf = (a: Args): string => strFlag(a, 'bosses-dir', 'dossier') ?? join(dataDirOf(a), 'bosses')

// ───────────────────────────── boss ─────────────────────────────

/** Index des boss (donjons classiques, ou Expéditions comprises). */
function bossEntries(data: NodeDataStore, all: boolean): BossEntry[] {
  return listBosses(data, nodeDungeonSource(data), { includeExpeditions: all })
}

/**
 * Boss désigné par un nom ou un id : donjons classiques (`resolveBoss`), sinon Expéditions (seulement si le boss est
 * introuvable parmi les classiques : une requête ambiguë reste une erreur) ; `all` : directement parmi tous. Boss
 * introuvable : message « (Expéditions comprises) », puisqu'elles ont été cherchées (`--all` n'y changerait rien).
 */
export function findBoss(data: NodeDataStore, text: string, all = false): BossEntry {
  const notFound = (e: unknown) => /^Aucun boss/.test((e as Error).message)
  const amongAll = (): BossEntry => {
    try {
      return resolveBoss(bossEntries(data, true), text)
    } catch (e) {
      if (!notFound(e)) throw e
      throw new Error((e as Error).message.replace(/\s*\(les Expéditions sont exclues par défaut\)/, '').replace(/\.$/, ' (Expéditions comprises).'))
    }
  }
  if (all) return amongAll()
  try {
    return resolveBoss(bossEntries(data, false), text)
  } catch (e) {
    if (!notFound(e)) throw e
    return amongAll()
  }
}

/** Dossier existant : chemin absolu tel quel, sinon relatif au dossier courant puis à la racine du dépôt (comme `loadBossOverrides`). */
function findDir(dir: string): string | undefined {
  const candidates = isAbsolute(dir) ? [dir] : [resolve(dir), resolve(REPO_ROOT, dir)]
  return candidates.find(c => existsSync(c) && statSync(c).isDirectory())
}

/**
 * Fiche manuelle d'UN boss : `<dossier>/<monsterId>.json` seul, validé par `parseBossOverrides` (mêmes règles que
 * `loadBossOverrides`, src/theorycraft/node.ts, qui lit TOUT le dossier) — une fiche invalide d'un autre boss, par
 * exemple en cours de rédaction, ne bloque pas les commandes. Absente : undefined (fichiers mal nommés :
 * `misnamedOverrides`).
 */
export function loadBossOverride(dir: string, monsterId: number): BossOverrides | undefined {
  const found = findDir(dir)
  const file = found && join(found, `${monsterId}.json`)
  if (!file || !existsSync(file)) return undefined
  const label = join(dir, `${monsterId}.json`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${label} : JSON invalide (${(err as Error).message})`)
  }
  const o = parseBossOverrides(json, label)
  if (o.monsterId !== monsterId) throw new Error(`${label} : le fichier doit s'appeler ${o.monsterId}.json (monsterId ${o.monsterId})`)
  return o
}

/**
 * Fiches MAL NOMMÉES du dossier : `*.json` hors brouillons (`_…`) dont le nom n'est pas `<entier>.json` (ex.
 * `kimbo.json`). `loadBossOverride` ne lit que `<monsterId>.json` : sans ce contrôle, une telle fiche serait ignorée en
 * silence (`loadBossOverrides`, page web et scripts, la refuse). Un avertissement par fichier ; celui d'une fiche de CE
 * boss (`monsterId` lu dans le fichier, s'il est lisible) dit sous quel nom la renommer.
 */
export function misnamedOverrides(dir: string, monsterId: number): string[] {
  const found = findDir(dir)
  if (!found) return []
  const files = readdirSync(found)
    .filter(f => f.toLowerCase().endsWith('.json') && !f.startsWith('_') && !/^\d+\.json$/.test(f))
    .sort()
  return files.map(f => {
    let id: unknown
    try {
      id = (JSON.parse(readFileSync(join(found, f), 'utf8')) as { monsterId?: unknown } | null)?.monsterId
    } catch {
      id = undefined
    }
    const label = join(dir, f)
    return id === monsterId
      ? `Fiche manuelle ${label} ignorée : c'est une fiche de ce boss (monsterId ${monsterId}), le fichier doit s'appeler ${monsterId}.json.`
      : `Fichier ${label} ignoré : une fiche manuelle doit s'appeler <monsterId>.json (la page web et loadBossOverrides refusent le dossier tant qu'il y est).`
  })
}

interface BossChoice {
  entry: BossEntry
  profile: BossProfileDetail
  /** Avertissements des fichiers mal nommés du dossier des fiches (déjà en tête de `profile.warnings`). */
  misnamed: string[]
}

/**
 * Boss et fiche selon `--players` / `--grade` (exclusifs) et la fiche manuelle (sauf `--no-overrides`) ; fichiers mal
 * nommés du dossier des fiches : avertissements de la fiche du boss (`misnamedOverrides`).
 */
function bossOf(a: Args, data: NodeDataStore, text: string): BossChoice {
  if (a.flags.has('players') && a.flags.has('grade')) throw new Error('--players et --grade sont exclusifs (le grade se déduit du nombre de joueurs)')
  const entry = findBoss(data, text, bool(a, 'all'))
  const opts: BossProfileOptions = {}
  const grade = optInt(a, 'grade', 1)
  const players = optInt(a, 'players', 1, MAX_PLAYERS)
  if (grade !== undefined) opts.grade = grade
  else if (players !== undefined) opts.players = players
  const misnamed = bool(a, 'no-overrides') ? [] : misnamedOverrides(overridesDirOf(a), entry.monsterId)
  if (!bool(a, 'no-overrides')) opts.overrides = loadBossOverride(overridesDirOf(a), entry.monsterId)
  const profile = bossProfile(data, entry.monsterId, opts)
  profile.warnings.unshift(...misnamed)
  return { entry, profile, misnamed }
}

/** Donjons d'un boss (« Antre du Merkator (niv. 190) »). */
function dungeonsText(e: BossEntry): string {
  return e.dungeons.map(d => `${d.name} (niv. ${d.level}${d.isExpedition ? ', Expédition' : ''})`).join(' ; ') || '—'
}

/** `npm run sim -- bosses [recherche] [--all] [--json]` */
export function cmdBosses(a: Args, data: NodeDataStore): number {
  checkOptions(a, 'bosses')
  const all = bool(a, 'all')
  const entries = bossEntries(data, all)
  const query = a.positional.join(' ').trim()
  const list = query ? searchBosses(entries, query) : entries
  if (bool(a, 'json')) {
    console.log(JSON.stringify(list, null, 2))
    return 0
  }
  const scope = all ? 'Expéditions comprises' : 'Expéditions exclues : --all pour les inclure'
  if (!list.length) {
    console.log(`Aucun boss ne correspond à « ${query} » (${scope}).`)
    return 0
  }
  const rows = list.map(e => [
    e.name,
    String(e.monsterId),
    // Premier donjon (classique d'abord) et nombre d'autres : les noms d'Expéditions sont longs (détail : --json, fiche).
    `${e.dungeons[0]?.name ?? '—'}${e.dungeons.length > 1 ? ` (+${e.dungeons.length - 1})` : ''}`,
    [...new Set(e.dungeons.map(d => d.level))].join(', '),
    String(e.bossLevel),
    String(e.gradeCount),
    e.isExpedition ? 'oui' : e.dungeons.some(d => d.isExpedition) ? 'en partie' : 'non',
  ])
  console.log(textTable(['Boss', 'Id', 'Donjon(s)', 'Niv. donjon', 'Niv. boss', 'Grades', 'Expédition'], rows, 'lrlrrrl', ''))
  console.log(`${list.length} boss${query ? ` pour « ${query} »` : ''} (${scope}). Fiche : npm run sim -- boss <nom|id>`)
  return 0
}

/** `npm run sim -- boss <nom|id> [classes|stuff] …` */
export async function cmdBoss(a: Args, data: NodeDataStore): Promise<number> {
  const pos = a.positional.slice()
  const isSub = (x: string | undefined): x is (typeof BOSS_SUBCOMMANDS)[number] => (BOSS_SUBCOMMANDS as readonly string[]).includes(x ?? '')
  const sub = isSub(pos[pos.length - 1]) ? pos.pop() : undefined
  if (isSub(pos[0])) throw new Error(`boss : le nom ou l'id du boss vient AVANT la sous-commande (npm run sim -- boss <nom|id> ${pos[0]} …)`)
  const name = pos.join(' ').trim()
  if (!name) throw new Error(`boss : nom ou id du boss attendu (ex. npm run sim -- boss merkator${sub ? ` ${sub}` : ''})`)
  checkOptions(a, sub ? `boss … ${sub}` : 'boss')
  const boss = bossOf(a, data, name)
  if (sub === 'classes') return cmdBossClasses(a, data, boss)
  if (sub === 'stuff') return cmdBossStuff(a, data, boss)
  return showBoss(a, data, boss)
}

// ───────────────────────────── fiche (--details) ─────────────────────────────

/** Effet du sort de départ (arbre `--details`). */
export interface SpellTreeEffect {
  effectId: number
  /** Description française (effects.json, valeurs remplies) et références résolues (sort, état, monstre). */
  text: string
  targetMask: string
  triggers: string
  duration: number
  delay: number
  /** Probabilité en % (0 = toujours). */
  random: number
  zone: string
  clientOnly: boolean
  /** Sous-sort lancé par l'effet (fermeture, profondeur ≤ 4, cycles coupés). */
  sub?: SpellTreeNode
}

export interface SpellTreeNode {
  spellId: number
  grade: number
  name: string
  effects: SpellTreeEffect[]
  /** Niveau déjà développé plus haut dans l'arbre, ou profondeur maximale atteinte : effets non répétés. */
  truncated?: 'seen' | 'depth'
}

const EFFECT_TEXTS = new WeakMap<NodeDataStore, Map<number, string>>()

/** Descriptions françaises des effets (effects.json), lues une fois par magasin de données. */
function effectTexts(data: NodeDataStore): Map<number, string> {
  let m = EFFECT_TEXTS.get(data)
  if (!m) {
    m = new Map(data.rawFile('effects.json').map(d => [d.id, d.description?.fr ?? '']))
    EFFECT_TEXTS.set(data, m)
  }
  return m
}

/**
 * Description d'un effet : gabarit d'effects.json (`#1{{~1~2 à }}#2 dommages Terre`) rempli avec les dés et la valeur
 * (#1 = dé min, #2 = dé max s'il diffère, #3 = valeur), puis références nommées (sort, état, monstre).
 */
function effectText(data: NodeDataStore, e: EffectData): string {
  const spell = effectSpellRef(e)
  const state = effectStateRef(e)
  const summon = effectSummonRef(e)
  const tpl = effectTexts(data).get(e.effectId) ?? ''
  const p2 = e.diceSide > e.diceNum ? e.diceSide : 0
  let text = tpl
    .replace(/\{\{~1~2([^}]*)\}\}/g, (_, sep: string) => (p2 ? sep : ''))
    .replace(/\{\{~ps\}\}/g, e.diceNum > 1 ? 's' : '')
    .replace(/\{\{~[^}]*\}\}/g, '')
    .replace(/#1/g, String(e.diceNum))
    .replace(/#2/g, p2 ? String(p2) : '')
    .replace(/#3/g, String(e.value))
    .replace(/#4/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Référence nommée : à la place de l'id dans le texte (« État 97 » → « État « Indéplaçable » (97) »), sinon ajoutée.
  const named = (id: number, label: string, kind: string) => {
    const re = new RegExp(`(^|\\D)${id}(?!\\d)`)
    text = re.test(text) ? text.replace(re, `$1${label}`) : `${text} — ${kind} ${label}`
  }
  if (spell) {
    const label = `« ${data.spell(spell.spellId)?.name ?? `Sort ${spell.spellId}`} » (${spell.spellId}${spell.grade !== undefined ? `, grade ${spell.grade}` : ''})`
    if (/^\d+$/.test(text) || !text) text = `Lance le sort ${label}`
    else named(spell.spellId, label, 'sort')
  }
  if (state !== undefined) named(state, `« ${data.state(state)?.name ?? '?'} » (${state})`, 'état')
  if (summon) named(summon.monsterId, `« ${data.monster(summon.monsterId)?.name ?? '?'} » (${summon.monsterId}, grade ${summon.grade})`, 'monstre')
  return text || `Effet ${e.effectId}`
}

/** Zone lisible (« C3 », « L5/1 », « cases listées ») — forme DofusDB et tailles ; rien pour une case seule. */
function zoneText(e: EffectData): string {
  const z = e.zone
  if (!z || (z.shape === 'P' && z.size <= 1)) return ''
  // Forme « ; » : liste explicite de cases (`ZoneSpec.cells`), la taille n'a pas de sens.
  if (z.shape === ';') return z.cells?.length ? `${z.cells.length} case(s) listée(s)` : 'cases listées'
  return `${z.shape}${z.size}${z.minSize ? `/${z.minSize}` : ''}`
}

/**
 * Arbre d'un niveau de sort : ses effets, et pour chaque effet qui LANCE un sous-sort (`effectSpellRef`), le sous-sort
 * au grade indiqué — profondeur ≤ 4 ; un niveau déjà développé dans l'arbre (cycle, ou même sous-sort lancé par deux
 * effets) n'est pas répété (`truncated: 'seen'`). Sert à rédiger une fiche manuelle (états posés, déclencheurs, sorts
 * retirés…).
 */
export function spellTree(data: NodeDataStore, level: SpellLevelData, depth = 0, seen: Set<SpellLevelData> = new Set()): SpellTreeNode {
  seen.add(level)
  const node: SpellTreeNode = { spellId: level.spellId, grade: level.grade, name: data.spell(level.spellId)?.name ?? `Sort ${level.spellId}`, effects: [] }
  for (const e of level.effects) {
    const item: SpellTreeEffect = {
      effectId: e.effectId,
      text: effectText(data, e),
      targetMask: e.targetMask,
      triggers: e.triggers,
      duration: e.duration,
      delay: e.delay,
      random: e.random,
      zone: zoneText(e),
      clientOnly: !!e.clientOnly,
    }
    const ref = effectSpellRef(e)
    const sub = ref && data.spellLevel(ref.spellId, { grade: ref.grade })
    // Sous-sorts suivis : effets qui LANCENT un sort (pas les références « retire les effets du sort », modificateurs…).
    if (sub && /^Lance le sort/.test(item.text)) {
      const leaf = (truncated: 'seen' | 'depth'): SpellTreeNode => ({ spellId: sub.spellId, grade: sub.grade, name: data.spell(sub.spellId)?.name ?? `Sort ${sub.spellId}`, effects: [], truncated })
      item.sub = seen.has(sub) ? leaf('seen') : depth + 1 >= TREE_DEPTH ? leaf('depth') : spellTree(data, sub, depth + 1, seen)
    }
    node.effects.push(item)
  }
  return node
}

/** Arbre du sort de départ d'une fiche de boss (undefined si le grade n'en a pas). */
export function startingSpellTree(data: NodeDataStore, profile: BossProfileDetail): SpellTreeNode | undefined {
  const s = profile.startingSpell
  const level = s && data.spellLevel(s.spellId, { grade: s.grade })
  return level ? spellTree(data, level) : undefined
}

/** Rendu texte de l'arbre (une ligne par effet, sous-sorts indentés). */
function treeLines(node: SpellTreeNode, indent = '  '): string[] {
  const out = [`${indent}${node.name} (sort ${node.spellId}, grade ${node.grade})${node.truncated === 'seen' ? ' — déjà développé plus haut' : node.truncated === 'depth' ? ' — profondeur maximale' : ''}`]
  for (const e of node.effects) {
    const parts = [
      e.targetMask ? `cible ${e.targetMask}` : '',
      e.triggers && e.triggers !== 'I' ? `déclencheur ${e.triggers}` : '',
      e.duration ? `durée ${e.duration < 0 ? 'infinie' : e.duration}` : '',
      e.delay ? `retard ${e.delay}` : '',
      e.random ? `${e.random} %` : '',
      e.zone ? `zone ${e.zone}` : '',
      e.clientOnly ? 'visuel' : '',
    ].filter(Boolean)
    out.push(`${indent}  - [${e.effectId}] ${e.text}${parts.length ? ` (${parts.join(' ; ')})` : ''}`)
    if (e.sub) out.push(...treeLines(e.sub, `${indent}    `))
  }
  return out
}

const FLAG_LABELS: Readonly<Record<string, string>> = {
  'hp-based': '% PV',
  delayed: 'différé',
  triggered: 'déclenché',
  positional: 'positionnel',
  'ring-excludes-target': 'anneau',
  summon: 'invocation',
  mark: 'marque',
  'sub-spell': 'sous-sort',
  excluded: 'exclu',
}

/** Conditions d'états du lanceur d'un sort (« 1234 Nom | sans 5678 »). */
function statesText(data: NodeDataStore, s: BossSpellDetail): string {
  if (!s.statesCondition?.length) return '—'
  const st = (id: number) => `${id} ${data.state(id)?.name ?? ''}`.trim()
  return s.statesCondition.map(c => [...c.has.map(st), ...c.not.map(id => `sans ${st(id)}`)].join(' et ')).join(' | ')
}

/**
 * Tableau de TOUS les sorts du boss (`--details`). « Coup » : mêlée ⇔ PO ≤ 1, convention des dégâts REÇUS du
 * theorycraft (hits.ts, `TheoryDptTable` côté monstre, comme la fiche) — les % de résistance mêlée ou distance du
 * personnage s'y appliquent. Drapeaux : en plus de ceux de la fiche, les états du boss sous lesquels le détail des
 * dégâts est pris (`damageStates`, comme `formatBoss`).
 */
function spellsTable(data: NodeDataStore, profile: BossProfileDetail): string {
  const elements = ['Neutre', 'Terre', 'Feu', 'Eau', 'Air']
  return textTable(
    ['Sort', 'Id', 'PA', 'PO', 'Coup', 'Lancers/tour', '/cible', 'Relance', 'Init.', ...elements, 'Autre', 'États requis', 'Drapeaux'],
    profile.spells.map(s => [
      s.name,
      String(s.spellId),
      String(s.apCost),
      String(s.range),
      s.range <= 1 ? 'mêlée' : 'distance',
      s.castsPerTurn ? String(s.castsPerTurn) : '∞',
      s.castsPerTarget ? String(s.castsPerTarget) : '∞',
      String(s.cooldown),
      String(s.initialCooldown),
      ...s.damageByElement.map(v => (v > 0 ? fmtNum(v) : '—')),
      s.otherDamage > 0 ? fmtNum(s.otherDamage) : '—',
      statesText(data, s),
      [
        ...s.flags.map(f => FLAG_LABELS[f] ?? f),
        ...(s.damageStates?.length ? [`dégâts selon l'état du boss ${s.damageStates.join(', ')}`] : []),
        ...(s.summons.length ? [`invoque ${s.summons.join(', ')}`] : []),
      ].join(', ') || '—',
    ]),
    'lrrrlrrrrrrrrrrll',
  )
}

function showBoss(a: Args, data: NodeDataStore, { entry, profile }: BossChoice): number {
  const details = bool(a, 'details')
  const tree = details ? startingSpellTree(data, profile) : undefined
  const fiche = join(overridesDirOf(a), `${profile.monsterId}.json`)
  if (bool(a, 'json')) {
    const out = details ? { ...profile, entry, details: { overridesFile: fiche, startingSpellTree: tree ?? null } } : { ...profile, entry }
    console.log(JSON.stringify(out, null, 2))
    return 0
  }
  console.log(formatBoss(profile))
  console.log(`\nDonjon(s) : ${dungeonsText(entry)}${entry.isExpedition ? ' — boss d’Expédition' : ''}`)
  if (bool(a, 'no-overrides')) console.log('Fiche manuelle ignorée (--no-overrides).')
  if (!details) {
    console.log('Détails (sorts du boss, sort de départ) : --details ; classes : … classes ; stuff : … stuff --class <classe|preset>')
    return 0
  }
  console.log('')
  console.log(section(`Sorts du boss (grade ${profile.grade}, ${profile.spells.length} sorts)`))
  console.log('  Dégâts moyens par lancer contre un joueur à 0 % de résistance (critique pondéré) ; « Autre » : fixes et % de PV ; ∞ : sans limite ; « Coup » : mêlée si PO ≤ 1, convention du calcul — en jeu, mêlée dès que la cible est adjacente (résistances mêlée/distance du personnage).')
  console.log(spellsTable(data, profile))
  console.log('')
  console.log(section('Sort de départ'))
  if (tree) {
    console.log('  Lancé à l’entrée en combat ; effets en données DofusDB (cible = masque, déclencheur : I = immédiat).')
    console.log(treeLines(tree).join('\n'))
  } else console.log('  (aucun sort de départ à ce grade)')
  console.log('')
  console.log(section('Fiche manuelle'))
  console.log(
    bullets([
      `${profile.overrides ? 'Appliquée' : bool(a, 'no-overrides') ? 'Ignorée (--no-overrides)' : 'Absente'} : ${fiche}`,
      'Modèle : data/bosses/_template.json ; schéma et règles de rédaction (sources, droits) : data/bosses/README.md.',
      `Phases calculées : ${profile.phases.map(p => `${p.id} [${p.states.join(', ') || 'aucun état'}]`).join(' ; ')}.`,
    ]),
  )
  return 0
}

// ───────────────────────────── classes ─────────────────────────────

function cmdBossClasses(a: Args, data: NodeDataStore, { profile }: BossChoice): number {
  const optimize = bool(a, 'optimize')
  if (!optimize && (a.flags.has('iterations') || a.flags.has('profile'))) throw new Error('--iterations et --profile : seulement avec --optimize (stuffs optimisés contre le boss)')
  const json = bool(a, 'json')
  const iterations = optInt(a, 'iterations', 0)
  const level = optInt(a, 'level', 1, 200)
  const expProfile = profileFlag(a)
  const out = strFlag(a, 'out', 'fichier')
  const progress = progressLine()
  const t0 = performance.now()
  const ranking = progress.around(() =>
    rankClasses(data, profile, {
      stuff: optimize ? 'optimized' : 'preset',
      iterations,
      profile: expProfile,
      level,
      // Grade imposé : la fiche n'a pas de nombre de joueurs, la composition prend celui qui correspond au grade.
      players: profile.players ?? playersForGrade(profile.grade),
      onProgress: optimize && showProgress(json) ? (done, total, label) => progress.write(`${done}/${total} presets optimisés (${label})…`) : undefined,
    }),
  )
  progress.end(`${ranking.presets.length} presets évalués en ${seconds(performance.now() - t0)}.`)
  const text = formatClasses(ranking)
  if (out) {
    const path = resolve(out)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, /\.json$/i.test(path) ? JSON.stringify(ranking, null, 2) + '\n' : text + '\n')
  }
  if (json) console.log(JSON.stringify(ranking, null, 2))
  else {
    console.log(text)
    if (out) console.log(`\nClassement : ${rel(resolve(out))}`)
  }
  return 0
}

// ───────────────────────────── personnage (stuff, degats) ─────────────────────────────

/** Classe ou preset désigné par `--class` / `--preset` (identifiant, `classe:qualificatif` ou nom de classe). */
interface Who {
  breedId: number
  className: string
  /** Preset désigné (absent : classe seule). */
  preset?: Preset
}

function whoOf(text: string): Who {
  const t = text.trim()
  const exact = findPreset(t)
  if (exact) return { breedId: exact.breedId, className: exact.className, preset: exact }
  if (!t.includes(':')) {
    const breedId = breedIdOf(t)
    const base = breedId !== undefined ? BASE_PRESETS.find(p => p.breedId === breedId) : undefined
    if (breedId !== undefined && base) return { breedId, className: base.className }
  }
  // Désignation « classe:qualificatif », ou erreur explicite (classe inconnue, presets de la classe du préfixe).
  const p = resolvePreset(t)
  return { breedId: p.breedId, className: p.className, preset: p }
}

/**
 * Premier preset de base d'une classe et note listant les autres (voir l'en-tête) ; `hint` : comment en choisir un
 * autre (option de la commande).
 */
function firstPresetOf(who: Who, hint = '--class <preset> pour en choisir un'): { preset: Preset; note: string } {
  const list = BASE_PRESETS.filter(p => p.breedId === who.breedId)
  const preset = list[0]
  const others = list.slice(1).map(p => p.id)
  const note = `Classe ${who.className} : preset « ${preset.id} » (${preset.label}), le premier preset de base de la classe${others.length ? ` ; autres presets : ${others.join(', ')} (${hint})` : ''}.`
  return { preset, note }
}

/** Contenu d'un fichier de build : `{ build: {...} }` (sortie de `--out`) ou build nu `{ items: [...] }`. */
interface BuildFile {
  build: CharacterBuild
  presetId?: string
  /** Champs absents du fichier repris d'un preset (à afficher : les caractéristiques en dépendent). */
  warnings: string[]
}

/**
 * Build d'un fichier (`--build`) : forme des fichiers d'équipe (champ `build` ; points, parchemins et variantes absents
 * ⇒ ceux du preset, comme `withOverrides` de userteam.ts, avec un avertissement). Classe : celle du build ou du fichier
 * (`breedId`, `preset`, `class`), sinon `--class` ; preset : `--class <preset>`, sinon celui du fichier, sinon — s'il
 * faut compléter le build — le preset de base de la classe dont l'élément est l'élément dominant des OBJETS (comme
 * `stuffVsBoss` choisit le sien), pour ne pas prêter à un build Terre les points Intelligence du premier preset.
 */
function readBuildFile(path: string, data: NodeDataStore, who: Who | undefined, classFlag = '--class'): BuildFile {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(resolve(path), 'utf8')) as Record<string, unknown>
  } catch (e) {
    throw new Error(`--build ${path} : ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'fichier introuvable' : `JSON illisible (${(e as Error).message})`}`)
  }
  const b = (raw && typeof raw === 'object' && 'build' in raw ? raw.build : raw) as Partial<CharacterBuild> | undefined
  if (!b || !Array.isArray(b.items)) throw new Error(`--build ${path} : build introuvable ({ items: [...] } ou { build: { items: [...] } } attendu)`)
  const filePreset = typeof raw.preset === 'string' ? findPreset(raw.preset) : undefined
  const fileBreed =
    (typeof b.breedId === 'number' ? b.breedId : undefined) ??
    (typeof raw.breedId === 'number' ? raw.breedId : undefined) ??
    filePreset?.breedId ??
    (typeof raw.class === 'string' ? breedIdOf(raw.class) : undefined)
  if (who && fileBreed !== undefined && fileBreed !== who.breedId) throw new Error(`--build ${path} : build d'une autre classe que ${who.className} (${breedName(data, fileBreed)})`)
  const breedId = who?.breedId ?? fileBreed
  if (breedId === undefined) throw new Error(`--build ${path} : classe du build inconnue — préciser ${classFlag} <classe|preset>`)
  const items = (b.items as EquippedItem[]).map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })), rolls: it.rolls ? { ...it.rolls } : undefined }))
  const level = typeof b.level === 'number' ? b.level : undefined
  const missing = [
    b.characteristicPoints ? '' : 'points de caractéristiques',
    b.scrolls ? '' : 'parchemins',
    b.spellVariants?.length ? '' : 'variantes de sorts',
  ].filter(Boolean)
  let preset = who?.preset ?? (filePreset?.breedId === breedId ? filePreset : undefined)
  const warnings: string[] = []
  if (missing.length) {
    let how = who?.preset ? `désigné par ${classFlag}` : 'nommé dans le fichier'
    if (!preset) {
      // Élément dominant des objets seuls (points à 0 ; parchemins du fichier, sinon 100 partout : neutres pour l'élément).
      const probe: CharacterBuild = { name: '', breedId, level: level ?? 200, characteristicPoints: {}, scrolls: b.scrolls ? { ...b.scrolls } : fullScrolls(), items }
      const el = dominantElement(computeBuildStats(probe, data).stats)
      const list = BASE_PRESETS.filter(p => p.breedId === breedId)
      preset = list.find(p => p.element === el) ?? list[0]
      how = `choisi par l'élément dominant des objets : ${STUFF_ELEMENT_FR[el]}${preset.element === el ? '' : ', sans preset de base de cet élément'}`
    }
    warnings.push(`--build ${basename(path)} : ${missing.join(', ')} absent(s) du fichier — repris du preset « ${preset.id} » (${preset.label}, ${how}) ; ${classFlag} <preset> pour en imposer un autre.`)
  }
  const base = preset && missing.length ? presetBuild(preset, data, level !== undefined ? { level } : {}) : undefined
  const build: CharacterBuild = {
    name: typeof raw.member === 'string' ? raw.member : typeof b.name === 'string' ? b.name : basename(path),
    breedId,
    level: level ?? base?.level ?? 200,
    characteristicPoints: b.characteristicPoints ? { ...b.characteristicPoints } : base!.characteristicPoints,
    scrolls: b.scrolls ? { ...b.scrolls } : base!.scrolls,
    items,
    spellVariants: b.spellVariants?.length ? b.spellVariants.slice() : base?.spellVariants ?? preset?.variants.slice(),
  }
  return { build, presetId: preset?.id, warnings }
}

/** Entrée de `stuffVsBoss` : `--class`, `--roxx`, `--build` (exclusifs entre eux pour le stuff de départ). */
function stuffInputOf(a: Args, data: NodeDataStore): { input: StuffInput; note?: string; warnings: string[] } {
  const cls = strFlag(a, 'class', 'classe ou preset')
  const roxx = strFlag(a, 'roxx', 'lien RoxxSolver')
  const file = strFlag(a, 'build', 'fichier de build')
  if (roxx !== undefined && file !== undefined) throw new Error('--roxx et --build sont exclusifs (un seul stuff de départ)')
  const who = cls !== undefined ? whoOf(cls) : undefined
  if (roxx !== undefined) {
    if (who) {
      const imp = roxxImport(roxx, data)
      if (imp.breedId !== who.breedId) throw new Error(`--roxx : le lien décrit un personnage d'une autre classe que ${who.className} (${breedName(data, imp.breedId)})`)
    }
    return { input: { roxx, presetId: who?.preset?.id }, warnings: [] }
  }
  if (file !== undefined) {
    const b = readBuildFile(file, data, who)
    return { input: { build: b.build, presetId: b.presetId }, warnings: b.warnings }
  }
  if (!who) throw new Error('stuff : --class <classe|preset> attendu (ex. --class cra, --class cra_terre_mono, --class cra:terre), ou --roxx <lien> / --build <fichier>')
  if (who.preset) return { input: { preset: who.preset.id }, warnings: [] }
  const { preset, note } = firstPresetOf(who, '--class <preset> pour en choisir un ; --elements all compare les quatre éléments')
  return { input: { preset: preset.id }, note, warnings: [] }
}

/** Fichier `--out` du meilleur stuff (format « dofussimu-build », champ `build` des fichiers d'équipe). */
function buildPayload(r: StuffVsBossResult): Record<string, unknown> {
  const best = r.best
  const b = best.build
  const cls = normalizeName(r.character.className)
  return {
    kind: 'dofussimu-build',
    version: 1,
    source: 'theorycraft',
    boss: { monsterId: r.boss.monsterId, name: r.boss.name, grade: r.boss.grade, players: r.boss.players },
    preset: r.character.presetId,
    class: cls,
    breedId: r.character.breedId,
    member: b.name,
    profile: r.options.profile,
    createdAt: today(),
    stuff: { id: best.id, label: best.label, valid: best.valid, ranking: r.ranking.by, logJ: best.logJ, logJSustained: best.logJSustained, dptSteady: best.damage.steady, ehp: best.survival.ehp },
    build: { level: b.level, items: b.items, characteristicPoints: b.characteristicPoints, scrolls: b.scrolls, spellVariants: b.spellVariants },
    usage:
      `Fichier d'équipe (data/teams/<scénario>.json) : { "class": "${cls}", "preset": "${r.character.presetId}", "build": "<chemin de ce fichier, relatif au fichier d'équipe>" } ; ` +
      `theorycraft : npm run sim -- boss ${r.boss.monsterId} stuff --build <ce fichier>`,
  }
}

async function cmdBossStuff(a: Args, data: NodeDataStore, { profile }: BossChoice): Promise<number> {
  const json = bool(a, 'json')
  const { input, note, warnings } = stuffInputOf(a, data)
  const elements = strFlag(a, 'elements', 'preset|all') ?? 'preset'
  if (elements !== 'preset' && elements !== 'all') throw new Error(`--elements : preset|all attendu (« ${elements} »)`)
  const out = strFlag(a, 'out', 'fichier')
  const opts: StuffVsBossOptions = {
    level: optInt(a, 'level', 1, 200),
    iterations: optInt(a, 'iterations', 0),
    restarts: optInt(a, 'restarts', 1),
    profile: profileFlag(a),
    top: optInt(a, 'top', 1),
    elements,
    fixed: itemIds(a, 'fixed', data),
    exclude: itemIds(a, 'exclude', data),
    seed: optInt(a, 'seed'),
    rangeNeed: optInt(a, 'range', 0, 6),
  }
  const progress = progressLine()
  if (showProgress(json)) opts.onProgress = p => progress.write(`${p.step === 'optimize' ? 'Recherche' : 'Évaluation'} : ${p.label} (${p.done}/${p.total})…`)
  const r = progress.around(() => stuffVsBoss(data, input, profile, opts))
  progress.end(`Recherche terminée en ${seconds(r.search.ms)}.`)
  // Avertissements de la lecture du build (champs repris d'un preset) : avec ceux de l'analyse, rendus dans le texte.
  r.warnings.unshift(...warnings)
  // Rendu texte AVANT d'ajouter la note aux hypothèses (affichée en tête, pas répétée en fin de rendu).
  const text = formatStuffVsBoss(r)
  if (note) r.assumptions.unshift(note)
  let file: string | undefined
  if (out) {
    file = resolve(out)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(buildPayload(r), null, 2) + '\n')
  }
  if (json) {
    console.log(JSON.stringify(file ? { ...r, out: file } : r, null, 2))
    return 0
  }
  if (note) console.log(`Note : ${note}\n`)
  console.log(text)
  if (file) {
    console.log(`\nMeilleur build (${r.best.label}) : ${rel(file)}`)
    console.log(`  Réutilisable : … stuff --build ${rel(file)} ; fichier d'équipe : { "class": "${normalizeName(r.character.className)}", "preset": "${r.character.presetId}", "build": "<chemin relatif au fichier d'équipe>" }`)
  }
  return 0
}

// ───────────────────────────── degats ─────────────────────────────

/** Personnage du calculateur : build complet et origine. */
interface DegatsCharacter {
  build: CharacterBuild
  preset?: Preset
  label: string
  warnings: string[]
}

/** Personnage de `degats` : `--preset` (preset ou classe), `--build` ou `--roxx` (exclusifs entre eux). */
function degatsCharacter(a: Args, data: NodeDataStore): DegatsCharacter {
  const text = strFlag(a, 'preset', 'preset')
  const file = strFlag(a, 'build', 'fichier de build')
  const roxx = strFlag(a, 'roxx', 'lien RoxxSolver')
  if (roxx !== undefined && file !== undefined) throw new Error('--roxx et --build sont exclusifs (un seul stuff)')
  const warnings: string[] = []
  let who = text !== undefined ? whoOf(text) : undefined
  if (who && !who.preset && file === undefined && roxx === undefined) {
    const { preset, note } = firstPresetOf(who, '--preset <preset> pour en choisir un')
    warnings.push(note)
    who = { ...who, preset }
  }
  if (file !== undefined) {
    const b = readBuildFile(file, data, who, '--preset')
    warnings.push(...b.warnings)
    return { build: b.build, preset: b.presetId ? findPreset(b.presetId) : undefined, label: `build ${rel(resolve(file))}`, warnings }
  }
  if (roxx !== undefined) {
    const imp = roxxImport(roxx, data)
    if (who && imp.breedId !== who.breedId) throw new Error(`--roxx : le lien décrit un personnage d'une autre classe que ${who.className} (${breedName(data, imp.breedId)})`)
    for (const w of imp.warnings) if (!/parchemins/.test(w)) warnings.push(`RoxxSolver : ${w}`)
    const noScrolls = Object.values(imp.build.scrolls ?? {}).every(v => !v)
    if (noScrolls) warnings.push('RoxxSolver : le lien ne contient pas de parchemins — 100 partout supposés (comme le stuff contre un boss).')
    const build: CharacterBuild = {
      name: imp.name || 'Stuff RoxxSolver',
      breedId: imp.breedId,
      level: imp.level,
      characteristicPoints: { ...(imp.build.characteristicPoints ?? {}) },
      scrolls: noScrolls ? fullScrolls() : { ...(imp.build.scrolls ?? {}) },
      items: imp.build.items.map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })) })),
      spellVariants: who?.preset?.variants.slice(),
    }
    return { build, preset: who?.preset, label: 'lien RoxxSolver', warnings }
  }
  if (!who?.preset) throw new Error('degats : --preset <preset> attendu (ex. --preset cra_terre_mono), ou --build <fichier> / --roxx <lien>')
  return { build: presetBuild(who.preset, data), preset: who.preset, label: `preset ${who.preset.id}`, warnings }
}

/** Sort désigné par un id ou un nom (sans accents ni casse) parmi les sorts de la classe disponibles au niveau. */
function findSpell(data: NodeDataStore, build: CharacterBuild, text: string): { spellId: number; level: SpellLevelData; name: string; inBuild: boolean } {
  const ids = breedSpellIds(data, build.breedId, build.level)
  const chosen = new Set(breedSpellIds(data, build.breedId, build.level, build.spellVariants))
  const named = ids.map(id => ({ id, name: data.spell(id)?.name ?? `Sort ${id}` }))
  const pick = (id: number) => {
    const level = data.spellLevel(id, { playerLevel: build.level })
    if (!level) throw new Error(`Sort ${id} : aucun niveau disponible au niveau ${build.level}`)
    return { spellId: id, level, name: data.spell(id)?.name ?? `Sort ${id}`, inBuild: chosen.has(id) }
  }
  const t = text.trim()
  if (/^\d+$/.test(t)) {
    const id = Number(t)
    if (!ids.includes(id)) throw new Error(`Le sort ${id} n'est pas un sort de cette classe disponible au niveau ${build.level} (sorts : ${named.map(s => `${s.name} ${s.id}`).join(', ')})`)
    return pick(id)
  }
  const q = normalize(t)
  if (!q) throw new Error('--sort : nom ou id du sort attendu')
  const exact = named.filter(s => normalize(s.name) === q)
  const hits = exact.length ? exact : named.filter(s => normalize(s.name).includes(q))
  if (!hits.length) throw new Error(`Aucun sort « ${t} » pour cette classe (sorts : ${named.map(s => s.name).join(', ')})`)
  if (hits.length > 1) throw new Error(`« ${t} » est ambigu : ${hits.map(s => `${s.name} (${s.id})`).join(' ; ')}. Précisez le nom ou donnez l'id du sort.`)
  return pick(hits[0].id)
}

/** Vulnérabilité d'une phase du boss (`BossPhaseProfile.vulnerable`) : 'melee' = au contact seulement, 'range' = à distance seulement. */
type Vulnerability = boolean | 'melee' | 'range'

/** Phase du boss vue par le calculateur (poids > 0) : vulnérabilité, part du combat et résistances effectives. */
export interface DegatsPhase {
  id: string
  name: string
  weight: number
  vulnerable: Vulnerability
  /** Résistances effectives de la phase [Neutre, Terre, Feu, Eau, Air] (`BossPhaseProfile.resPct` : fiche manuelle). */
  resPct: number[]
}

/**
 * Cible du calculateur : boss (résistances EFFECTIVES de sa fiche — celles de chaque phase —, vulnérabilité de ses
 * phases, mécaniques relayées) ou résistances données (`--res`, Poutch).
 */
interface DegatsTarget {
  kind: 'boss' | 'res'
  label: string
  /** Nom court (avertissements). */
  name: string
  /** Caractéristiques de la cible : celles du boss (`profile.stats`), résistances de chaque phase posées par `resGroups`. */
  stats: Stats
  /** Combattant cible hors combat (masques de cible des lignes) : le boss, ou un Poutch (`--res`, monstre non invoqué). */
  fighter: Fighter
  monsterId?: number
  grade?: number
  /** Phases du boss (poids > 0) ; absent : cible toujours vulnérable, résistances `stats` (`--res`). */
  phases?: DegatsPhase[]
  /** Résumés des mécaniques de la fiche utiles au calcul (invulnérabilités, résistances) : repris dans les avertissements. */
  mechanics?: string[]
  /** Avertissements de la fiche relayés (fiches manuelles mal nommées). */
  warnings?: string[]
  /** Fiche manuelle appliquée (ses résistances sont voulues : pas de conseil d'en écrire une). */
  manual?: boolean
}

/** Mécaniques relayées par le calculateur : invulnérabilités (coups mis à 0) et résistances (extrêmes, par phase). */
const RELAYED_MECHANICS: ReadonlySet<string> = new Set(['invulnerable', 'invulnerable-melee', 'invulnerable-range', 'extreme-res', 'res-change'])
/** Poutch Ingball : cible de `--res` (monstre non invoqué : masques de cible, docs/theorycraft.md §6). */
const POUTCH_ID = 494

function degatsTarget(a: Args, data: NodeDataStore): DegatsTarget {
  const bossText = strFlag(a, 'boss', 'nom ou id du boss')
  const resText = strFlag(a, 'res', 'résistances n,t,f,e,a')
  if (bossText !== undefined && resText !== undefined) throw new Error('--boss et --res sont exclusifs (résistances du boss, ou résistances données)')
  if (bossText === undefined && (a.flags.has('players') || a.flags.has('grade'))) throw new Error('--players et --grade : seulement avec --boss')
  const bossOnly = BOSS_OPTIONS.filter(k => k !== 'players' && k !== 'grade' && a.flags.has(k))
  if (bossText === undefined && bossOnly.length) throw new Error(`${bossOnly.map(k => `--${k}`).join(', ')} : seulement avec --boss`)
  if (bossText !== undefined) {
    const { profile, misnamed } = bossOf(a, data, bossText)
    const who = profile.players !== undefined ? `${profile.players} joueur(s)` : 'grade imposé'
    return {
      kind: 'boss',
      label: `${profile.name} (${profile.monsterId}) — grade ${profile.grade}, ${who}, résistances effectives de la fiche`,
      name: profile.name,
      stats: { ...profile.stats },
      fighter: bossFighter(data, profile.monsterId, { grade: profile.grade }),
      monsterId: profile.monsterId,
      grade: profile.grade,
      phases: profile.phases.filter(p => p.weight > 0).map(p => ({ id: p.id, name: p.name, weight: p.weight, vulnerable: p.vulnerable, resPct: p.resPct.slice() })),
      mechanics: profile.mechanics.filter(m => RELAYED_MECHANICS.has(m.kind)).map(m => m.summary),
      warnings: misnamed,
      manual: !!profile.overrides,
    }
  }
  const parts = (resText ?? '0,0,0,0,0').split(',')
  const res = parts.map(x => Number(x.trim()))
  // Entrée vide (« 0,,0,0,0 ») : Number('') = 0 — une résistance oubliée ne devient pas 0 % en silence.
  if (res.length !== 5 || parts.some(x => x.trim() === '') || !res.every(Number.isFinite))
    throw new Error(`--res : 5 pourcentages n,t,f,e,a attendus (Neutre, Terre, Feu, Eau, Air ; « ${resText} »)`)
  const stats = emptyStats()
  res.forEach((v, i) => (stats[ELEMENT_RES_PCT[i as Element]] = v))
  return {
    kind: 'res',
    label: resText === undefined ? 'Poutch : 0 % de résistance partout (--res pour en donner)' : 'résistances données (--res)',
    name: 'la cible',
    stats,
    fighter: bossFighter(data, POUTCH_ID, { grade: 1 }),
  }
}

/** Phases de mêmes résistances et caractéristiques de la cible dans ces phases (un tableau de dégâts par groupe). */
interface ResGroup {
  phases: DegatsPhase[]
  stats: Stats
}

/**
 * Groupes de résistances de la cible : un seul pour `--res` ou un boss dont les phases ont les mêmes résistances ;
 * sinon un par jeu de résistances (fiche manuelle à `resPct` par phase), dans l'ordre des phases. Caractéristiques
 * d'une phase : celles du boss, résistances élémentaires de la phase (comme `phaseStats`, src/theorycraft/target.ts).
 */
function resGroups(target: DegatsTarget): ResGroup[] {
  if (!target.phases?.length) return [{ phases: [], stats: target.stats }]
  const groups = new Map<string, DegatsPhase[]>()
  for (const p of target.phases) {
    const k = p.resPct.join(',')
    const list = groups.get(k)
    if (list) list.push(p)
    else groups.set(k, [p])
  }
  return [...groups.values()].map(phases => {
    const stats = { ...target.stats }
    phases[0].resPct.forEach((v, i) => (stats[ELEMENT_RES_PCT[i as Element]] = v))
    return { phases, stats }
  })
}

/** Une ligne de dégâts du sort, calculée. Valeurs `null` : ligne non calculée (`note`). */
export interface DegatsLine {
  /** Rang de la ligne dans le profil du sort (1 = première). */
  index: number
  effectId: number
  /** Famille (DAMAGE_SPECS) : `boosted` (caractéristiques), `mp` (× PM, comptée comme boostée), `fixed`, `hp` (% de PV). */
  family: string
  /** Élément résolu (0..4 ; -1 : aucun) et son nom. */
  element: number
  elementLabel: string
  /** Conditions du masque de cible (états, bouclier…), en clair ; absent : ligne sans condition. */
  condition?: string
  /** Probabilité de la ligne (groupes aléatoires), 1 sinon. */
  probability: number
  /** Ligne d'un sous-sort lancé par le sort. */
  sub: boolean
  /** Poison : dégâts par tour pendant `dotTurns` tours ; `delayed` : effet différé (tours). */
  dotTurns: number
  delayed: number
  /** Jets (dés) normaux et critiques de la ligne. */
  rolls: { min: number; max: number; critMin: number; critMax: number }
  normal: { min: number; max: number; mean: number } | null
  crit: { min: number; max: number; mean: number } | null
  /** Chance de coup critique du sort (%), commune à toutes ses lignes. */
  critPct: number
  /** Espérance d'un coup (critique pondéré, moyenne exacte sur les jets entiers). */
  expected: number | null
  /** `--trace` : détail étape par étape du jet max (normal, ou critique avec `--crit` si le sort peut critiquer). */
  trace?: DamageExplanation
  note?: string
}

/** Lignes d'UN type de coup : au contact (mêlée) ou à distance. */
export interface DegatsHit {
  /** Coup au contact (cible sur une case adjacente au lanceur : % dommages et % résistances mêlée), sinon à distance. */
  melee: boolean
  lines: DegatsLine[]
  /** Espérance d'un lancer : lignes immédiates sans condition, × probabilité (null : aucune). */
  expectedTotal: number | null
  /** Phases du boss où ce coup ne fait rien (invulnérabilité) ; absent : aucune. */
  blockedPhases?: string[]
  /** Le boss est invulnérable à ce coup dans TOUTES ses phases : 0 en jeu, valeurs des lignes mises à 0 (raison). */
  blocked?: string
}

export interface DegatsResult {
  character: { label: string; className: string; breedId: number; level: number; presetId?: string; valid: boolean; issues: string[] }
  /**
   * `baseCrit` : taux critique du sort (0 s'il n'a pas d'effets critiques) ; `critPct` : chance de critique du lanceur ;
   * `melee` : coup des lignes `lines` ; `hits` : coups possibles (cible sur la case d'impact, ou dans une zone centrée
   * sur le lanceur) ; `hitRule` : choix fait, en clair.
   */
  spell: {
    spellId: number
    name: string
    grade: number
    apCost: number
    minRange: number
    range: number
    melee: boolean
    hits: { melee: boolean; range: boolean }
    hitRule: string
    baseCrit: number
    critPct: number
    inBuild: boolean
  }
  target: {
    kind: 'boss' | 'res'
    label: string
    monsterId?: number
    grade?: number
    resPct: number[]
    rangedResPct: number
    meleeResPct: number
    spellResPct: number
    phases?: DegatsPhase[]
  }
  /** Caractéristiques offensives du lanceur utiles au calcul (clé `Stats` → valeur). */
  attacker: Record<string, number>
  /**
   * Coup principal : lignes, espérance d'un lancer, invulnérabilité du boss (voir `DegatsHit`) — avec des résistances
   * différentes selon la phase (`phaseTables`), ceux de la PREMIÈRE phase (résistances `target.resPct`).
   */
  lines: DegatsLine[]
  expectedTotal: number | null
  blockedPhases?: string[]
  blocked?: string
  /**
   * L'autre coup, quand les deux sont possibles (portée 1 à N, zone autour du lanceur) et ni `--melee` ni `--distance`
   * n'est donné ; `identical` : mêmes valeurs que le coup principal (aucun % mêlée / distance en jeu).
   */
  otherHit?: DegatsHit & { identical: boolean }
  /**
   * Boss dont les phases (poids > 0) n'ont pas toutes les mêmes résistances (fiche manuelle, `resPct` par phase) : un
   * tableau par jeu de résistances, dans l'ordre des phases (le premier = les champs ci-dessus). Absent sinon.
   */
  phaseTables?: DegatsPhaseTable[]
  /** Lignes du profil écartées (ne touchent pas la cible) : total, puis nombre par raison. */
  skippedLines: number
  skipped: { reason: string; count: number }[]
  warnings: string[]
  assumptions: string[]
}

/** Tableau de dégâts d'un jeu de résistances du boss (phases de mêmes résistances). */
export interface DegatsPhaseTable {
  /** Noms des phases et part du combat qu'elles représentent (somme des poids). */
  phases: string[]
  weight: number
  resPct: number[]
  /** Coup principal et, quand les deux sont calculés, l'autre (voir `DegatsResult`). */
  hit: DegatsHit
  otherHit?: DegatsHit & { identical: boolean }
}

/** Lettres d'inclusion d'un masque (src/engine/targetMask.ts) : pas des conditions. */
const MASK_INCLUSION = /^\*?[aAcCghHlLdDmMiIjJsSx]$/

/**
 * Conditions d'un masque en clair, états regroupés (« cible sans les états « A » (573), « B » (574) », « cible avec
 * bouclier »…) ; undefined si le masque n'a que des lettres d'inclusion.
 */
function maskConditions(data: NodeDataStore, masks: readonly string[]): string | undefined {
  const st = (id: string) => `« ${data.state(Number(id))?.name ?? '?'} » (${id})`
  const states = new Map<string, string[]>()
  const out: string[] = []
  const add = (txt: string) => void (out.includes(txt) || out.push(txt))
  for (const mask of masks)
    for (const raw of mask.split(',')) {
      const tok = raw.trim()
      if (!tok || MASK_INCLUSION.test(tok)) continue
      const who = tok.startsWith('*') ? 'lanceur' : 'cible'
      const t = tok.replace(/^\*/, '')
      let m: RegExpExecArray | null
      if ((m = /^([Ee])(\d+)$/.exec(t))) {
        const key = `${who} ${m[1] === 'E' ? 'avec' : 'sans'}`
        const list = states.get(key) ?? []
        if (!list.includes(m[2])) list.push(m[2])
        states.set(key, list)
        if (!out.includes(key)) out.push(key)
      } else if (t === 'PB') add(`${who} avec bouclier`)
      else if (t === 'pb') add(`${who} sans bouclier`)
      else if ((m = /^F(\d+)$/.exec(t))) add(`${who} = monstre ${m[1]}`)
      else if ((m = /^f(\d+)$/.exec(t))) add(`${who} ≠ monstre ${m[1]}`)
      else if ((m = /^V(\d+)$/.exec(t))) add(`${who} sous ${m[1]} % de PV`)
      else if ((m = /^v(\d+)$/.exec(t))) add(`${who} à ${m[1]} % de PV ou plus`)
      else add(`${who} : ${t}`)
    }
  const text = out.map(x => {
    const ids = states.get(x)
    return ids ? `${x} ${ids.length > 1 ? 'les états' : "l'état"} ${ids.map(st).join(', ')}` : x
  })
  return text.length ? text.join(' et ') : undefined
}

/** Caractéristiques du lanceur lues par le pipeline pour des éléments et des types de coup (affichage). */
function attackerStats(stats: Stats, elements: readonly number[], melees: readonly boolean[]): Record<string, number> {
  const keys = new Set<StatKey>()
  for (const el of elements) {
    if (el < 0 || el > 4) continue
    keys.add(ELEMENT_MAIN_STAT[el as Element])
    keys.add(ELEMENT_FIXED_DAMAGE[el as Element])
  }
  for (const k of ['power', 'damage', 'criticalDamage', 'critical', 'spellDamagePct'] as const) keys.add(k)
  if (melees.includes(true)) keys.add('meleeDamagePct')
  if (melees.includes(false)) keys.add('rangedDamagePct')
  keys.add('finalDamagePct')
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = stats[k] ?? 0
  return out
}

/** Le boss reçoit-il ce coup dans une phase ? */
const takesHit = (v: Vulnerability, melee: boolean): boolean => v === true || v === (melee ? 'melee' : 'range')
const hitName = (melee: boolean): string => (melee ? 'au contact' : 'à distance')
/** « la phase A » / « les phases A, B ». */
const phasesText = (names: readonly string[]): string => `${names.length > 1 ? 'les phases' : 'la phase'} ${names.join(', ')}`

/** Lettres d'inclusion ennemies (src/engine/targetMask.ts) et, parmi elles, celles des invocations (I, J, S). */
const ENEMY_INCLUSION = /^[AHLDMIJS]$/
const SUMMON_INCLUSION = /^[IJS]$/

/**
 * Le masque SÉLECTIONNE-t-il la cible par ses lettres d'inclusion (`matchesTargetMask` réduit à elles) ? Les conditions
 * (états, bouclier, PV…) sont affichées par ligne (`maskConditions`) et tenues hors de l'espérance d'un lancer, pas
 * filtrées ici. Masque vide : toutes les entités ; masque sans lettre d'inclusion : aucune (comme le moteur).
 */
function selectsTarget(mask: string, caster: Fighter, target: Fighter): boolean {
  const m = compileTargetMask(mask)
  return m.empty || (m.inclusionLetters.length > 0 && matchesTargetMask(m.inclusionLetters.join(','), caster, target))
}

/**
 * Raison d'écarter une ligne de dégâts du calculateur (undefined : elle touche la cible). Même filtre que le DPT du
 * theorycraft (src/ai/core/dpt.ts : masque de la ligne, puis masques des effets « lance un sort » parents, `gates`),
 * sur un vrai combattant cible (le boss, ou un monstre non invoqué) : une ligne réservée aux invocations ennemies
 * (Concentration du Iop : masque « J,j ») ou un sous-sort lancé sur un allié (arbre du Sadida, tourelle du Steamer,
 * lance du Forgelance) ne touche pas un boss.
 */
function skipReason(line: DamageLineX, caster: Fighter, target: Fighter): string | undefined {
  if (!line.sides.enemy) return 'sur les alliés ou le lanceur'
  if (!selectsTarget(line.mask, caster, target)) {
    const enemy = compileTargetMask(line.mask).inclusionLetters.filter(l => ENEMY_INCLUSION.test(l))
    return enemy.length && enemy.every(l => SUMMON_INCLUSION.test(l)) ? 'sur les invocations' : `sur d'autres types de cible (masque « ${line.mask} »)`
  }
  const gate = line.gates?.find(g => !selectsTarget(g, caster, target))
  if (gate === undefined) return undefined
  return maskSides(gate).enemy ? `de sous-sorts lancés sur d'autres cibles (masque « ${gate} »)` : 'de sous-sorts lancés sur un allié (invocation, arbre, tourelle…)'
}

/**
 * Dégâts d'UN sort (calculateur `degats`) : pour chaque ligne de dégâts du profil de sort qui touche la cible (masques
 * de cible, `skipReason` : les autres sont comptées par raison) — jets normaux et critiques (`damageRange`), moyennes
 * exactes sur les jets entiers (`meanPrepared`), chance de critique (`critChance`, 0 si le sort n'a pas d'effets
 * critiques), espérance (`expectedDamage`) et, sur demande, la trace du jet max (`explainDamage`). Cible : monstre
 * (plafond de résistance 100 %), sur la case d'impact (efficacité de zone 1), hors combat (ni buffs, ni états, ni
 * modificateurs de sort). Lignes « fixes » : `hpBasedDamage` (jet = PV de référence) ; lignes en % de PV : non
 * calculées (dépendent des PV du moment).
 *
 * Coup au contact ou à distance (`possibleHits` de src/theorycraft/hits.ts, la règle du DPT du theorycraft, restreinte
 * aux lignes retenues) : `opts.hit` l'impose ; sinon, si les deux sont possibles, les deux sont calculés (`otherHit`). Contre un boss : résistances de chaque phase (`resGroups` : un tableau par jeu de
 * résistances, `phaseTables`, si elles diffèrent d'une phase à l'autre) ; un coup auquel il est invulnérable dans
 * toutes les phases d'un tableau (`vulnerable` des phases de la fiche : sort de départ, états, fiche manuelle) vaut 0
 * (avertissement qui cite la mécanique).
 */
export function spellDamageReport(
  data: NodeDataStore,
  who: DegatsCharacter,
  spellText: string,
  target: DegatsTarget,
  opts: { trace?: boolean; crit?: boolean; hit?: 'melee' | 'range' } = {},
): DegatsResult {
  const built = computeBuildStats(who.build, data)
  const stats = built.stats
  const warnings = [...who.warnings, ...(target.warnings ?? [])]
  if (!built.valid) warnings.push(`Build invalide (${built.issues.map(i => i.message).slice(0, 3).join(' ; ') || 'conditions'}) : caractéristiques calculées quand même.`)
  const spell = findSpell(data, who.build, spellText)
  if (!spell.inBuild) warnings.push(`« ${spell.name} » est la variante NON retenue par les variantes de sorts du build (calcul fait quand même).`)
  const prof = createSpellProfileIndex(theoryEngine(data)).of(spell.level)
  const critPct = spell.level.criticalEffects.length ? critChance(spell.level.critChance, stats.critical) : 0
  // --crit : trace du jet max critique… si le sort peut critiquer (sinon celle du coup normal, signalé).
  const traceCrit = !!opts.crit && critPct > 0
  if (opts.crit && critPct === 0) warnings.push(`--crit : « ${spell.name} » ne peut pas critiquer — trace du coup normal.`)

  // Lignes qui touchent la cible (masques de cible, comme le DPT du theorycraft) ; les autres, comptées par raison.
  const caster = playerFighterFromStats(data, { breedId: who.build.breedId, level: who.build.level, variants: who.build.spellVariants ?? [] }, stats, built.maxHp)
  const kept: { line: DamageLineX; index: number }[] = []
  const skippedBy = new Map<string, number>()
  prof.damage.forEach((line, index) => {
    const why = skipReason(line, caster, target.fighter)
    if (why === undefined) kept.push({ line, index })
    else skippedBy.set(why, (skippedBy.get(why) ?? 0) + 1)
  })

  const lineOf = (line: DamageLineX, i: number, melee: boolean, defender: Stats): DegatsLine => {
    const el = resolveElement(line.element, stats)
    const base: DegatsLine = {
      index: i + 1,
      effectId: line.effectId,
      family: line.family,
      element: el,
      elementLabel: elementName(el),
      condition: maskConditions(data, [line.mask, ...(line.gates ?? [])]),
      probability: line.p,
      sub: line.sub,
      dotTurns: line.dotTurns,
      delayed: line.delayed,
      rolls: { min: line.min, max: line.max, critMin: line.critMin, critMax: line.critMax },
      normal: null,
      crit: null,
      critPct,
      expected: null,
    }
    if (base.condition === undefined) delete base.condition
    if ((line.family === 'boosted' || line.family === 'mp') && el >= 0) {
      const normal: DamageInput = {
        attacker: stats,
        defender,
        element: el as Element,
        crit: false,
        isWeapon: false,
        isMelee: melee,
        defenderIsPlayer: false,
        allResPct: defender.allResPct ?? 0,
      }
      const crit: DamageInput = { ...normal, crit: true }
      base.normal = { ...damageRange(normal, line.min, line.max), mean: meanPrepared(prepareDamage(normal), line.min, line.max) }
      if (critPct > 0) base.crit = { ...damageRange(crit, line.critMin, line.critMax), mean: meanPrepared(prepareDamage(crit), line.critMin, line.critMax) }
      base.expected = expectedDamage(normal, null, base.rolls, critPct)
      if (opts.trace || opts.crit) base.trace = traceCrit ? explainDamage(crit, line.critMax) : explainDamage(normal, line.max)
      if (line.family === 'mp') base.note = 'dommages × PM restants : calculés comme une ligne boostée (comme le DPT de l’IA)'
    } else if (line.family === 'fixed') {
      const spec = DAMAGE_SPECS.get(line.effectId)
      const fixed = (roll: number, isCrit: boolean) =>
        hpBasedDamage({ percent: 100, referenceHp: roll, defender, element: el, defenderIsPlayer: false, crit: isCrit, allResPct: defender.allResPct ?? 0, ignoreResistances: spec?.ignoresRes })
      const range = (lo: number, hi: number, isCrit: boolean) => {
        let sum = 0
        for (let r = lo; r <= hi; r++) sum += fixed(r, isCrit)
        return { min: fixed(lo, isCrit), max: fixed(hi, isCrit), mean: sum / Math.max(1, hi - lo + 1) }
      }
      base.normal = range(line.min, Math.max(line.min, line.max), false)
      if (critPct > 0) base.crit = range(line.critMin, Math.max(line.critMin, line.critMax), true)
      const c = critPct / 100
      base.expected = (1 - c) * base.normal.mean + c * (base.crit?.mean ?? base.normal.mean)
      base.note = 'dommages fixes : non boostés par les caractéristiques (hpBasedDamage, jet = dégâts de base)'
    } else base.note = line.family === 'hp' ? 'dégâts en % de PV : dépendent des PV du moment, non calculés' : 'élément non résolu : non calculée'
    return base
  }

  // Un tableau par jeu de résistances du boss (un seul sans fiche à résistances par phase, et pour --res).
  const groups = resGroups(target)
  const multi = groups.length > 1
  const hitOf = (melee: boolean, g: ResGroup): DegatsHit => {
    const lines = kept.map(k => lineOf(k.line, k.index, melee, g.stats))
    const blocking = g.phases.filter(p => !takesHit(p.vulnerable, melee))
    const hit: DegatsHit = { melee, lines, expectedTotal: null }
    if (blocking.length) hit.blockedPhases = blocking.map(p => p.name)
    if (blocking.length && blocking.length === g.phases.length) {
      const what = blocking.every(p => p.vulnerable === false) ? 'invulnérable' : `invulnérable ${hitName(melee)}`
      const names = blocking.map(p => p.name)
      hit.blocked = `${target.name} est ${what} ${multi ? `pendant ${phasesText(names)}` : `dans toutes ses phases (${names.join(', ')})`}`
      // En jeu : aucun dégât, quelle que soit la ligne ; la trace (calcul sans invulnérabilité) induirait en erreur.
      for (const l of lines) {
        const zero = { min: 0, max: 0, mean: 0 }
        l.normal = zero
        l.crit = critPct > 0 ? { ...zero } : null
        l.expected = 0
        l.note = `boss ${what} : 0 en jeu`
        delete l.trace
      }
    }
    const direct = lines.filter(l => l.expected !== null && !l.condition && !l.dotTurns && !l.delayed)
    hit.expectedTotal = direct.length ? direct.reduce((s, l) => s + l.probability * l.expected!, 0) : null
    return hit
  }

  // Coup(s) calculé(s) : imposé, ou les deux s'ils sont possibles (principal : heuristique de portée de l'IA).
  const keptLines = new Set(kept.map(k => k.line))
  const hits = possibleHits(prof, l => keptLines.has(l))
  const span = `portée ${prof.minRange} à ${prof.maxRange}`
  let melees: boolean[]
  let hitRule: string
  if (opts.hit) {
    const m = opts.hit === 'melee'
    melees = [m]
    hitRule = `coup ${hitName(m)} imposé (--${m ? 'melee' : 'distance'})`
    if (!(m ? hits.melee : hits.range)) warnings.push(`--${m ? 'melee' : 'distance'} : avec sa ${span}, « ${spell.name} » ne touche pas ${m ? 'au contact' : 'à distance'} une cible placée sur la case d'impact (calcul fait quand même).`)
  } else if (hits.melee && hits.range) {
    const m = isMeleeSpell(prof)
    melees = [m, !m]
    hitRule = `${span} : au contact ou à distance selon la case de la cible — les deux sont calculés (--melee / --distance pour n'en garder qu'un)`
  } else {
    melees = [hits.melee]
    hitRule = `${span} : cible ${hitName(hits.melee)}`
  }
  const tables = groups.map(g => {
    let [primary, other] = melees.map(m => hitOf(m, g))
    // Coup principal impossible contre le boss mais l'autre possible : le tableau utile en tête.
    if (other && primary.blocked && !other.blocked) [primary, other] = [other, primary]
    return { g, primary, other: other as DegatsHit | undefined }
  })

  // Avertissements : mécaniques relayées de la fiche, puis effet sur chaque coup calculé — seulement s'il y a des
  // lignes (sans ligne de dégâts, aucun tableau : rien n'est mis à 0).
  for (const m of target.mechanics ?? []) warnings.push(`Mécanique du boss : ${m}`)
  if (kept.length)
    for (const { g, primary, other } of tables) {
      for (const h of [primary, other]) {
        if (!h) continue
        const alt = h === primary ? other : primary
        if (h.blocked) {
          const otherOk = g.phases.some(p => takesHit(p.vulnerable, !h.melee))
          const hint = !otherOk ? '' : alt ? ` ; ${hitName(!h.melee)} : voir l'autre tableau` : (h.melee ? hits.range : hits.melee) ? ` ; ${hitName(!h.melee)} : --${h.melee ? 'distance' : 'melee'}` : ''
          warnings.push(`Coup ${hitName(h.melee)} : ${h.blocked} — 0 en jeu, valeurs mises à 0${hint}.`)
        } else if (h.blockedPhases)
          warnings.push(`Coup ${hitName(h.melee)} : ${target.name} y est invulnérable pendant ${phasesText(h.blockedPhases)} — 0 pendant ${h.blockedPhases.length > 1 ? 'ces phases' : 'cette phase'} ; valeurs : autres phases.`)
      }
      // Résistance ≥ 100 % d'un élément du sort : 0 dans le calcul (plafond des monstres), une mécanique en jeu.
      if (target.kind !== 'boss') continue
      const extreme = [...new Set(primary.lines.map(l => l.element))].filter(e => e >= 0 && e <= 4 && (g.stats[ELEMENT_RES_PCT[e as Element]] ?? 0) >= 100)
      if (extreme.length)
        warnings.push(
          `Résistance ${extreme.map(e => `${elementName(e)} ${fmtPct(g.stats[ELEMENT_RES_PCT[e as Element]] ?? 0)}`).join(', ')}${multi ? ` pendant ${phasesText(g.phases.map(p => p.name))}` : ''} (≥ 100 %) : 0 dans le calcul. ` +
            (target.manual
              ? 'Valeur de la fiche manuelle.'
              : `C'est une mécanique à lever en combat, pas une immunité : une fiche manuelle (resPct, ou resPct de ses phases) donne les résistances réellement subies (docs/theorycraft.md §5).`),
        )
    }

  const assumptions = [
    'Pipeline DoMath de src/damage (troncatures à chaque étape) ; cible = monstre (plafond de résistance 100 %), touchée sur la case d’impact (efficacité de zone 1).',
    'Hors combat : ni buffs, ni états, ni modificateurs de sort, ni Puissance de sort.',
    `Mêlée ⇔ cible sur une case ADJACENTE au lanceur (règle du jeu, quelle que soit la portée du sort) : % dommages et % résistances mêlée ; sinon à distance. Ici : ${hitRule}.`,
    'Caractéristiques du build par computeBuildStats (jets max des objets).',
    'Moyennes exactes sur les jets entiers (meanPrepared) ; espérance = (1 − %CC) × moyenne normale + %CC × moyenne critique ; chance de critique DoMath (sans plancher de 1 %).',
  ]
  if ([...skippedBy.keys()].some(r => r !== 'sur les alliés ou le lanceur'))
    assumptions.push(
      `Lignes retenues : celles dont le masque de cible (et celui des sorts qui lancent leur sous-sort) sélectionne ${target.kind === 'boss' ? 'le boss' : 'un monstre non invoqué (Poutch)'}, comme le DPT du theorycraft.`,
    )
  if (target.kind === 'boss') assumptions.push('Vulnérabilité par phase de la fiche du boss : un coup bloqué par une invulnérabilité dans toutes ses phases vaut 0 (comme le stuff contre un boss).')
  if (multi) assumptions.push('Résistances différentes selon la phase (fiche manuelle) : un tableau par jeu de résistances, comme le DPT du theorycraft (une cible par phase attaquable).')
  if (tables[0].primary.lines.some(l => l.condition)) assumptions.push('Lignes conditionnelles (états, bouclier…) : calculées une à une, hors espérance d’un lancer.')
  // Mêmes valeurs au contact et à distance (aucun % mêlée / distance en jeu) : l'autre tableau n'est pas répété.
  const strip = (h: DegatsHit) => JSON.stringify([h.blocked ?? null, h.lines.map(({ trace: _t, ...l }) => l)])
  const otherOf = (t: (typeof tables)[number]) => (t.other ? { otherHit: { ...t.other, identical: strip(t.other) === strip(t.primary) } } : {})
  const first = tables[0]
  const resOf = (st: Stats) => [0, 1, 2, 3, 4].map(i => st[ELEMENT_RES_PCT[i as Element]] ?? 0)
  return {
    character: {
      label: who.label,
      className: who.preset?.className ?? data.breed(who.build.breedId)?.name ?? `Classe ${who.build.breedId}`,
      breedId: who.build.breedId,
      level: who.build.level,
      presetId: who.preset?.id,
      valid: built.valid,
      issues: built.issues.map(i => i.message),
    },
    spell: {
      spellId: spell.spellId,
      name: spell.name,
      grade: spell.level.grade,
      apCost: spell.level.apCost,
      minRange: spell.level.minRange,
      range: spell.level.range,
      melee: first.primary.melee,
      hits,
      hitRule,
      baseCrit: spell.level.criticalEffects.length ? spell.level.critChance : 0,
      critPct,
      inBuild: spell.inBuild,
    },
    target: {
      kind: target.kind,
      label: target.label,
      monsterId: target.monsterId,
      grade: target.grade,
      resPct: resOf(first.g.stats),
      rangedResPct: target.stats.rangedResPct ?? 0,
      meleeResPct: target.stats.meleeResPct ?? 0,
      spellResPct: target.stats.spellResPct ?? 0,
      ...(target.phases ? { phases: target.phases } : {}),
    },
    attacker: attackerStats(stats, first.primary.lines.map(l => l.element), melees),
    lines: first.primary.lines,
    expectedTotal: first.primary.expectedTotal,
    ...(first.primary.blockedPhases ? { blockedPhases: first.primary.blockedPhases } : {}),
    ...(first.primary.blocked ? { blocked: first.primary.blocked } : {}),
    ...otherOf(first),
    ...(multi
      ? {
          phaseTables: tables.map(t => ({
            phases: t.g.phases.map(p => p.name),
            weight: t.g.phases.reduce((s, p) => s + p.weight, 0),
            resPct: resOf(t.g.stats),
            hit: t.primary,
            ...otherOf(t),
          })),
        }
      : {}),
    skippedLines: prof.damage.length - kept.length,
    skipped: [...skippedBy].map(([reason, count]) => ({ reason, count })),
    warnings,
    assumptions,
  }
}

/** Intitulé d'un type de coup (tableaux du calculateur). */
const hitTitle = (melee: boolean): string => (melee ? 'Au contact (mêlée : cible sur une case adjacente)' : 'À distance (cible à 2 cases ou plus)')

/** Tableau des lignes d'un coup et espérance d'un lancer. */
function hitTable(h: DegatsHit): string[] {
  const range = (x: { min: number; max: number } | null) => (x ? `${fmtNum(x.min)}-${fmtNum(x.max)}` : '—')
  return [
    textTable(
      ['#', 'Élément', 'Effet', 'Normal', 'Moy.', 'Critique', 'Moy. CC', '%CC', 'Espérance', 'Ligne'],
      h.lines.map(l => [
        String(l.index),
        l.elementLabel,
        String(l.effectId),
        range(l.normal),
        l.normal ? fmtNum(l.normal.mean, 2) : '—',
        range(l.crit),
        l.crit ? fmtNum(l.crit.mean, 2) : '—',
        fmtPct(l.critPct),
        l.expected !== null ? fmtNum(l.expected, 2) : '—',
        [
          l.condition ?? '',
          l.probability < 1 ? `probabilité ${fmtPct(l.probability * 100)}` : '',
          l.sub ? 'sous-sort' : '',
          l.dotTurns ? `poison ${l.dotTurns} tour(s)` : '',
          l.delayed ? `différée ${l.delayed} tour(s)` : '',
          l.note ?? '',
        ]
          .filter(Boolean)
          .join(' ; ') || '—',
      ]),
      'rllrrrrrrl',
    ),
    `  Espérance d'un lancer (lignes immédiates sans condition, probabilités comprises) : ${h.expectedTotal !== null ? fmtNum(h.expectedTotal, 2) : '—'}`,
  ]
}

/** Rendu texte du calculateur. */
export function formatDegats(r: DegatsResult): string {
  const out: string[] = []
  const s = r.spell
  out.push(section(`${s.name} (sort ${s.spellId}, grade ${s.grade}) — ${r.character.className} niveau ${r.character.level} (${r.character.label})`))
  const critText = s.baseCrit > 0 ? `critique ${fmtPct(s.baseCrit)} de base + ${fmtNum(r.attacker.critical ?? 0)} % (caractéristique) ⇒ ${fmtPct(s.critPct)}` : 'ne peut pas critiquer'
  const hitText = r.otherHit ? 'mêlée ou distance selon la case' : s.melee ? 'mêlée (au contact)' : 'distance'
  out.push(`  ${s.apCost} PA · portée ${s.minRange} à ${s.range} · ${hitText} · ${critText}`)
  const t = r.target
  const resText = (res: readonly number[]) => ['Neutre', 'Terre', 'Feu', 'Eau', 'Air'].map((n, i) => `${n} ${fmtPct(res[i])}`).join(', ')
  const others = [t.rangedResPct ? `distance ${fmtPct(t.rangedResPct)}` : '', t.meleeResPct ? `mêlée ${fmtPct(t.meleeResPct)}` : '', t.spellResPct ? `sorts ${fmtPct(t.spellResPct)}` : ''].filter(Boolean)
  out.push(`  Cible : ${t.label}`)
  out.push(`    Résistances : ${r.phaseTables ? 'selon la phase (tableaux ci-dessous)' : resText(t.resPct)}${others.length ? ` ; ${others.join(', ')}` : ''}`)
  out.push(`  Lanceur : ${Object.entries(r.attacker).map(([k, v]) => `${statLabelFr(k as StatKey)} ${fmtNum(v)}`).join(', ')}`)
  out.push('')
  // Un tableau par jeu de résistances (phases du boss), chacun au contact et / ou à distance.
  const tables: DegatsPhaseTable[] = r.phaseTables ?? [
    { phases: [], weight: 1, resPct: t.resPct, hit: { melee: s.melee, lines: r.lines, expectedTotal: r.expectedTotal, blocked: r.blocked }, otherHit: r.otherHit },
  ]
  const traced: { h: DegatsHit; where: string[] }[] = []
  if (!r.lines.length) out.push('  Aucune ligne de dégâts sur la cible.')
  else
    tables.forEach((tb, k) => {
      if (r.phaseTables) {
        if (k) out.push('')
        out.push(`  ${tb.phases.length > 1 ? 'Phases' : 'Phase'} ${tb.phases.map(n => `« ${n} »`).join(', ')} (${fmtPct(tb.weight * 100)} du combat) — résistances : ${resText(tb.resPct)}`)
      }
      const other = tb.otherHit
      const shown = other && !other.identical ? [tb.hit, other] : [tb.hit]
      for (const h of shown) {
        if (other) out.push(`  ${hitTitle(h.melee)}${h.blocked ? ' — 0 en jeu (invulnérabilité)' : ''}`)
        out.push(...hitTable(h))
        if (other?.identical) out.push(`  ${hitTitle(other.melee)} : mêmes valeurs (ni % de dommages ni % de résistances mêlée / distance en jeu).`)
        if (h !== shown[shown.length - 1]) out.push('')
        traced.push({ h, where: [r.phaseTables ? phasesText(tb.phases) : '', shown.length > 1 ? hitName(h.melee) : ''].filter(Boolean) })
      }
    })
  if (r.skipped.length) out.push(`  Lignes de dégâts écartées (ne touchent pas la cible) : ${r.skipped.map(x => `${x.count} ${x.reason}`).join(' ; ')}.`)
  for (const { h, where } of traced)
    for (const l of h.lines) {
      if (!l.trace) continue
      out.push('', `Détail du jet max (${l.trace.roll}, coup ${l.trace.params.crit ? 'critique' : 'normal'}${where.map(w => `, ${w}`).join('')}) — ligne ${l.index}, ${l.elementLabel}`)
      out.push(textTable(['Étape', 'Valeur', 'Calcul'], l.trace.steps.map(st => [st.label, fmtNum(st.value), st.detail]), 'lrl'))
    }
  if (r.warnings.length) out.push('', 'Avertissements', bullets(r.warnings))
  out.push('', 'Hypothèses', bullets(r.assumptions))
  return out.join('\n')
}

/**
 * `npm run sim -- degats --preset <preset> [--build f | --roxx l] --sort <nom|id> [--boss B [--players N]] [--res …]
 * [--melee | --distance]`
 */
export function cmdDegats(a: Args, data: NodeDataStore): number {
  checkOptions(a, 'degats')
  if (a.positional.length) throw new Error(`degats : argument inattendu « ${a.positional.join(' ')} » (tout passe par des options : --preset, --sort, --boss, --res…)`)
  const spellText = strFlag(a, 'sort', 'nom ou id du sort')
  if (spellText === undefined) throw new Error('degats : --sort <nom|id> attendu (ex. --sort "Flèche Punitive" ou --sort 32456)')
  if (bool(a, 'melee') && bool(a, 'distance')) throw new Error('--melee et --distance sont exclusifs (coup au contact, ou à distance)')
  const hit = bool(a, 'melee') ? 'melee' : bool(a, 'distance') ? 'range' : undefined
  const who = degatsCharacter(a, data)
  const target = degatsTarget(a, data)
  const r = spellDamageReport(data, who, spellText, target, { trace: bool(a, 'trace'), crit: bool(a, 'crit'), hit })
  console.log(bool(a, 'json') ? JSON.stringify(r, null, 2) : formatDegats(r))
  return 0
}
