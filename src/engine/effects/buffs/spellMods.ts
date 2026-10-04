/**
 * Modificateurs de sorts (effets de catégorie 3, docs/research/effects.md §7.10) : agrégation des buffs
 * (`Buff.spellMod`) en une table par sort (`Fighter.spellMods`) et lecture par le lancer (cast.ts), les dégâts (293)
 * et les soins (2935).
 *
 * Module PUR (aucun enregistrement d'effet, aucune dépendance au moteur) : importé par engine.ts et cast.ts.
 *
 * `diceNum` = sort modifié. `diceNum = 0` est lu comme « tous les sorts du porteur » (INCERTAIN : *Acuité Absolue* ne
 * désactive la ligne de vue que via un 289 sur le sort 0, alors que *Tirs Éloignés* liste aussi chaque sort offensif
 * en plus du 0). Pour ne pas compter deux fois ces sorts, une clé fixée pour un sort précis REMPLACE la valeur
 * générique (sort 0) de la même clé.
 */
import type { SpellLevelData } from '../../../data/model'
import type { Fighter, SpellModEntry, SpellModifiers, SpellModKey } from '../../types'

/** Sort « générique » des modificateurs (diceNum 0). */
export const ALL_SPELLS = 0

/**
 * Ajoute un modificateur à une table (créée si absente) et la renvoie. Les entrées `set` remplacent la valeur, les
 * autres s'additionnent. Appelé par `Engine.recomputeStats` pour chaque buff portant un `spellMod`.
 */
export function accumulateSpellMod(
  mods: Record<number, SpellModifiers> | undefined,
  e: SpellModEntry,
): Record<number, SpellModifiers> {
  const table = mods ?? {}
  let m = table[e.spellId]
  if (!m) table[e.spellId] = m = {}
  if (e.set) m[e.key] = e.value
  else m[e.key] = (m[e.key] ?? 0) + e.value
  return table
}

/** Valeur d'un modificateur pour un sort (spécifique, sinon générique), `undefined` si aucun buff ne le fixe. */
export function spellModifierValue(f: Fighter, spellId: number, key: SpellModKey): number | undefined {
  const mods = f.spellMods
  if (!mods) return undefined
  const v = mods[spellId]?.[key]
  if (v !== undefined) return v
  return mods[ALL_SPELLS]?.[key]
}

/** Valeur d'un modificateur pour un sort (0 si absent). */
export function spellModifier(f: Fighter, spellId: number, key: SpellModKey): number {
  return spellModifierValue(f, spellId, key) ?? 0
}

/** Bonus de dégâts de BASE du sort (effet 293, ajouté au jet min et max avant multiplicateurs). */
export function spellBaseDamageBonus(f: Fighter, spellId: number): number {
  return spellModifier(f, spellId, 'baseDamage')
}

/** Bonus de dommages « fixes » du sort (effet 283, `#1 : +#3 Dommages`) — position exacte dans la formule INCERTAINE. */
export function spellDamageBonus(f: Fighter, spellId: number): number {
  return spellModifier(f, spellId, 'damage')
}

/** Bonus de soins de BASE du sort (effet 2935), et bonus de soins (284). */
export function spellBaseHealBonus(f: Fighter, spellId: number): number {
  return spellModifier(f, spellId, 'baseHeal') + spellModifier(f, spellId, 'heal')
}

/** Clés qui modifient les conditions de lancer (les autres — dégâts, soins — ne changent pas le spell-level). */
const CAST_KEYS: readonly SpellModKey[] = [
  'rangeMin',
  'rangeMax',
  'setRangeMin',
  'setRangeMax',
  'rangeBoostable',
  'apCost',
  'critChance',
  'castsPerTurn',
  'castsPerTarget',
  'cooldown',
  'setCooldown',
  'noLos',
  'noLine',
  'needFreeCell',
  'needTakenCell',
  'needVisibleEntity',
]

/** Cache : table de modificateurs (immuable, remplacée à chaque recalcul) -> niveau de sort -> niveau modifié. */
const LEVEL_CACHE = new WeakMap<Record<number, SpellModifiers>, Map<SpellLevelData, SpellLevelData>>()

/**
 * Niveau de sort tel que vu par le lanceur, modificateurs de sort appliqués (portée, coût en PA, critique, lancers par
 * tour/cible, relance, ligne de vue/ligne, cases libre/occupée). Renvoie `lvl` lui-même sans modificateur pertinent
 * (cas courant : aucune allocation). Le résultat est mis en cache tant que les buffs du lanceur ne changent pas.
 */
export function modifiedSpellLevel(caster: Fighter, lvl: SpellLevelData): SpellLevelData {
  const mods = caster.spellMods
  if (!mods) return lvl
  const specific = mods[lvl.spellId]
  const generic = lvl.spellId === ALL_SPELLS ? undefined : mods[ALL_SPELLS]
  if (!specific && !generic) return lvl
  let cache = LEVEL_CACHE.get(mods)
  if (!cache) LEVEL_CACHE.set(mods, (cache = new Map()))
  let out = cache.get(lvl)
  if (!out) {
    out = buildModifiedLevel(lvl, specific, generic)
    cache.set(lvl, out)
  }
  return out
}

function buildModifiedLevel(lvl: SpellLevelData, specific?: SpellModifiers, generic?: SpellModifiers): SpellLevelData {
  const get = (k: SpellModKey): number | undefined => specific?.[k] ?? generic?.[k]
  let relevant = false
  for (const k of CAST_KEYS) if (get(k) !== undefined) relevant = true
  if (!relevant) return lvl
  const m: SpellLevelData = { ...lvl }
  const setMax = get('setRangeMax')
  const setMin = get('setRangeMin')
  m.minRange = Math.max(0, setMin ?? lvl.minRange + (get('rangeMin') ?? 0))
  if (setMax !== undefined) {
    // Portée maximale fixée : valeur finale (ni bonus de PO ni modificateurs additifs).
    m.range = setMax
    m.rangeBoostable = false
  } else {
    m.range = Math.max(0, lvl.range + (get('rangeMax') ?? 0))
    if ((get('rangeBoostable') ?? 0) > 0) m.rangeBoostable = true
  }
  m.apCost = Math.max(0, lvl.apCost + (get('apCost') ?? 0))
  // Un sort au taux de base nul ne peut pas critiquer (mechanics.md §4.6).
  if (lvl.critChance > 0) m.critChance = lvl.critChance + (get('critChance') ?? 0)
  if (lvl.maxCastPerTurn > 0) m.maxCastPerTurn = Math.max(1, lvl.maxCastPerTurn + (get('castsPerTurn') ?? 0))
  if (lvl.maxCastPerTarget > 0) m.maxCastPerTarget = Math.max(1, lvl.maxCastPerTarget + (get('castsPerTarget') ?? 0))
  const setCd = get('setCooldown')
  m.minCastInterval = Math.max(0, setCd ?? lvl.minCastInterval + (get('cooldown') ?? 0))
  if ((get('noLos') ?? 0) > 0) m.castTestLos = false
  if ((get('noLine') ?? 0) > 0) m.castInLine = false
  const free = get('needFreeCell')
  if (free !== undefined) m.needFreeCell = free > 0
  const taken = get('needTakenCell')
  if (taken !== undefined) m.needTakenCell = taken > 0
  const visible = get('needVisibleEntity')
  if (visible !== undefined) m.needVisibleEntity = visible > 0
  return m
}
