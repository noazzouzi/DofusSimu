/**
 * Theorycraft contre un boss — validation des fiches manuelles `data/bosses/<monsterId>.json`
 * (docs/design/theorycraft.md §1.3 ; schéma : `BossOverrides` de src/theorycraft/types.ts ; règles de rédaction et
 * de sources : data/bosses/README.md).
 *
 * Validation STRICTE : toute clé inconnue, tout type inattendu ou toute valeur hors domaine lève une erreur en
 * français qui cite le fichier, le chemin de la clé (ex. « phases[1].weight ») et la valeur attendue. La fiche
 * renvoyée est une copie normalisée (aucune référence vers l'objet JSON d'origine).
 *
 * Module PUR : aucun import `node:` (la lecture du dossier est dans src/theorycraft/node.ts).
 */
import { STAT_KEYS, type Stats } from '../core/types'
import type {
  BossMechanicNote,
  BossOverrides,
  BossPhaseOverride,
  MechanicKind,
  PerElement,
  UtilityTag,
} from './types'

/** Toutes les valeurs de `MechanicKind` (vérifié à la compilation, cf. `_EXHAUSTIVE`). */
export const MECHANIC_KINDS = [
  'invulnerable',
  'invulnerable-melee',
  'invulnerable-range',
  'reduced-range',
  'reduced-melee',
  'damage-taken',
  'final-damage',
  'res-change',
  'extreme-res',
  'reflect',
  'erosion',
  'hp-based-damage',
  'ap-mp-removal',
  'range-removal',
  'punished-removal',
  'pacifist',
  'incurable',
  'cant-be-moved',
  'push-resource',
  'summons',
  'boss-heal',
  'boss-shield',
  'marks',
  'phases',
  'mp-cost',
  'other',
] as const satisfies readonly MechanicKind[]

/** Toutes les valeurs de `UtilityTag` (vérifié à la compilation, cf. `_EXHAUSTIVE`). */
export const UTILITY_TAGS = [
  'melee',
  'range',
  'zone',
  'burst',
  'indirect-damage',
  'mp-removal',
  'ap-removal',
  'range-removal',
  'heal',
  'shield',
  'damage-reduction',
  'placement',
  'push-damage',
  'summons',
  'debuff',
  'erosion',
  'ally-ap-mp',
  'ally-damage',
  'damage-taken-debuff',
  'dodge',
  'multi-element',
] as const satisfies readonly UtilityTag[]

// Erreur de compilation si une valeur des unions de types.ts manque dans les listes ci-dessus.
type Missing<U, L extends readonly unknown[]> = Exclude<U, L[number]>
const _EXHAUSTIVE: [Missing<MechanicKind, typeof MECHANIC_KINDS>, Missing<UtilityTag, typeof UTILITY_TAGS>] extends [never, never]
  ? true
  : never = true
void _EXHAUSTIVE

/** Caractéristiques de combat optionnelles de `Stats` (hors STAT_KEYS), acceptées dans `stats`. */
const FIGHT_STAT_KEYS = ['allResPct', 'finalHealPct', 'comboDamagePct', 'spellPower'] as const
const STAT_KEY_SET: ReadonlySet<string> = new Set<string>([...STAT_KEYS, ...FIGHT_STAT_KEYS])

const TOP_KEYS = [
  'version',
  'monsterId',
  'name',
  'sources',
  'updatedAt',
  'patch',
  'resPct',
  'stats',
  'phases',
  'adds',
  'excludeSpells',
  'positionalSpells',
  'mechanics',
  'notes',
] as const
const SOURCE_KEYS = ['url', 'date', 'patch'] as const
const PHASE_KEYS = ['id', 'name', 'states', 'weight', 'resPct', 'vulnerable', 'notes'] as const
const ADD_KEYS = ['monsterId', 'grade', 'count'] as const
const MECHANIC_KEYS = ['kind', 'summary', 'counters', 'punishes'] as const

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Contexte d'erreur : fichier et chemin de la clé en cours. */
class Ctx {
  constructor(
    readonly file: string,
    readonly path: string,
  ) {}
  at(key: string | number): Ctx {
    const p = typeof key === 'number' ? `${this.path}[${key}]` : this.path ? `${this.path}.${key}` : key
    return new Ctx(this.file, p)
  }
  fail(expected: string, got: unknown): never {
    throw new Error(`${this.file} : « ${this.path || '(racine)'} » : ${expected} attendu (reçu ${show(got)})`)
  }
}

function show(v: unknown): string {
  if (v === undefined) return 'rien'
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 57) + '…' : s
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function object(v: unknown, c: Ctx, allowed: readonly string[]): Record<string, unknown> {
  if (!isObject(v)) c.fail('un objet', v)
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw new Error(`${c.file} : clé inconnue « ${c.at(k).path} » (clés permises : ${allowed.join(', ')})`)
  return v
}

function array(v: unknown, c: Ctx): unknown[] {
  if (!Array.isArray(v)) c.fail('un tableau', v)
  return v
}

function str(v: unknown, c: Ctx, nonEmpty = false): string {
  if (typeof v !== 'string' || (nonEmpty && !v.trim())) c.fail(nonEmpty ? 'un texte non vide' : 'un texte', v)
  return v
}

function num(v: unknown, c: Ctx, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    const range = min > -Infinity && max < Infinity ? ` entre ${min} et ${max}` : min > -Infinity ? ` ≥ ${min}` : max < Infinity ? ` ≤ ${max}` : ''
    c.fail(`un nombre${range}`, v)
  }
  return v
}

function int(v: unknown, c: Ctx, min = -Infinity): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) c.fail(min > -Infinity ? `un entier ≥ ${min}` : 'un entier', v)
  return v
}

function date(v: unknown, c: Ctx): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) c.fail('une date AAAA-MM-JJ', v)
  return v
}

function intList(v: unknown, c: Ctx, min = 1): number[] {
  return array(v, c).map((x, i) => int(x, c.at(i), min))
}

function perElement(v: unknown, c: Ctx): PerElement {
  const a = array(v, c)
  if (a.length !== 5) c.fail('5 nombres [Neutre, Terre, Feu, Eau, Air]', v)
  return a.map((x, i) => num(x, c.at(i))) as PerElement
}

function oneOf<T extends string>(v: unknown, c: Ctx, values: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) c.fail(`${what} (${values.join(', ')})`, v)
  return v as T
}

function stats(v: unknown, c: Ctx): Partial<Stats> {
  if (!isObject(v)) c.fail('un objet de caractéristiques', v)
  const out: Partial<Record<keyof Stats, number>> = {}
  for (const [k, x] of Object.entries(v)) {
    if (!STAT_KEY_SET.has(k)) throw new Error(`${c.file} : caractéristique inconnue « ${c.at(k).path} » (clés de Stats, src/core/types.ts)`)
    out[k as keyof Stats] = num(x, c.at(k))
  }
  return out
}

function source(v: unknown, c: Ctx): { url: string; date?: string; patch?: string } {
  const o = object(v, c, SOURCE_KEYS)
  const url = str(o.url, c.at('url'), true)
  if (!/^https?:\/\/\S+$/.test(url)) c.at('url').fail('une URL http(s)', url)
  const out: { url: string; date?: string; patch?: string } = { url }
  if (o.date !== undefined) out.date = date(o.date, c.at('date'))
  if (o.patch !== undefined) out.patch = str(o.patch, c.at('patch'), true)
  return out
}

function phase(v: unknown, c: Ctx): BossPhaseOverride {
  const o = object(v, c, PHASE_KEYS)
  const out: BossPhaseOverride = {
    id: str(o.id, c.at('id'), true),
    name: str(o.name, c.at('name'), true),
    states: intList(o.states, c.at('states')),
    weight: num(o.weight, c.at('weight'), 0),
  }
  if (o.resPct !== undefined) out.resPct = o.resPct === null ? null : perElement(o.resPct, c.at('resPct'))
  if (o.vulnerable !== undefined) {
    const v = o.vulnerable
    if (typeof v === 'boolean' || v === 'melee' || v === 'range') out.vulnerable = v
    else c.at('vulnerable').fail('true, false, "melee" ou "range"', v)
  }
  if (o.notes !== undefined) out.notes = str(o.notes, c.at('notes'))
  return out
}

function add(v: unknown, c: Ctx): { monsterId: number; grade?: number; count: number } {
  const o = object(v, c, ADD_KEYS)
  const out: { monsterId: number; grade?: number; count: number } = {
    monsterId: int(o.monsterId, c.at('monsterId'), 1),
    count: int(o.count, c.at('count'), 1),
  }
  if (o.grade !== undefined) out.grade = int(o.grade, c.at('grade'), 1)
  return out
}

function mechanic(v: unknown, c: Ctx): BossMechanicNote {
  const o = object(v, c, MECHANIC_KEYS)
  const out: BossMechanicNote = {
    kind: oneOf(o.kind, c.at('kind'), MECHANIC_KINDS, 'un type de mécanique'),
    summary: str(o.summary, c.at('summary'), true),
  }
  if (o.counters !== undefined)
    out.counters = array(o.counters, c.at('counters')).map((x, i) => oneOf(x, c.at('counters').at(i), UTILITY_TAGS, 'une utilité'))
  if (o.punishes !== undefined)
    out.punishes = array(o.punishes, c.at('punishes')).map((x, i) => oneOf(x, c.at('punishes').at(i), UTILITY_TAGS, 'une utilité'))
  return out
}

/**
 * Valide une fiche manuelle (JSON déjà analysé) et en renvoie une copie typée. `file` sert aux messages d'erreur
 * (défaut « fiche de boss »). Contrôles au-delà des types : `version` = 1, ids entiers positifs, dates AAAA-MM-JJ,
 * URL http(s), résistances = 5 nombres, ids de phase uniques et au moins une phase de poids > 0, sorts exclus et
 * positionnels disjoints.
 */
export function parseBossOverrides(json: unknown, file = 'fiche de boss'): BossOverrides {
  const root = new Ctx(file, '')
  const o = object(json, root, TOP_KEYS)
  if (o.version !== 1) root.at('version').fail('1 (version du schéma)', o.version)
  const out: BossOverrides = { version: 1, monsterId: int(o.monsterId, root.at('monsterId'), 1) }
  if (o.name !== undefined) out.name = str(o.name, root.at('name'), true)
  if (o.sources !== undefined) out.sources = array(o.sources, root.at('sources')).map((x, i) => source(x, root.at('sources').at(i)))
  if (o.updatedAt !== undefined) out.updatedAt = date(o.updatedAt, root.at('updatedAt'))
  if (o.patch !== undefined) out.patch = str(o.patch, root.at('patch'), true)
  if (o.resPct !== undefined) out.resPct = perElement(o.resPct, root.at('resPct'))
  if (o.stats !== undefined) out.stats = stats(o.stats, root.at('stats'))
  if (o.phases !== undefined) {
    const c = root.at('phases')
    const phases = array(o.phases, c).map((x, i) => phase(x, c.at(i)))
    const seen = new Set<string>()
    phases.forEach((p, i) => {
      if (seen.has(p.id)) c.at(i).at('id').fail('un id de phase unique', p.id)
      seen.add(p.id)
    })
    if (!phases.some(p => p.weight > 0)) c.fail('au moins une phase de poids > 0', o.phases)
    out.phases = phases
  }
  if (o.adds !== undefined) out.adds = array(o.adds, root.at('adds')).map((x, i) => add(x, root.at('adds').at(i)))
  if (o.excludeSpells !== undefined) out.excludeSpells = intList(o.excludeSpells, root.at('excludeSpells'))
  if (o.positionalSpells !== undefined) out.positionalSpells = intList(o.positionalSpells, root.at('positionalSpells'))
  const both = (out.excludeSpells ?? []).filter(id => out.positionalSpells?.includes(id))
  if (both.length) root.at('positionalSpells').fail('des sorts absents de excludeSpells', both)
  if (o.mechanics !== undefined) out.mechanics = array(o.mechanics, root.at('mechanics')).map((x, i) => mechanic(x, root.at('mechanics').at(i)))
  if (o.notes !== undefined) out.notes = str(o.notes, root.at('notes'))
  return out
}
