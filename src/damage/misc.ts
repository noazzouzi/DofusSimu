/**
 * Formules diverses : initiative, invocations, armure (réduction fixe), renvoi de dommages.
 * Références : docs/research/formulas.md §11, §12, §19 ; mechanics.md §8, §11.
 */
import type { StatKey, Stats } from '../core/types'

/**
 * Initiative = (Force + Intelligence + Chance + Agilité + Initiative) × PV actuels / PV max, tronquée.
 * INCERTAIN : facteur PV et arrondi (formule communautaire) ; les monstres n'ont pas de bonus d'initiative.
 */
export function initiative(stats: Stats, hp: number, maxHp: number): number {
  const base = stats.strength + stats.intelligence + stats.chance + stats.agility + stats.initiative
  if (!(maxHp > 0)) return Math.trunc(base)
  const h = hp < 0 ? 0 : hp > maxHp ? maxHp : hp
  const v = Math.trunc((base * h) / maxHp)
  return v === 0 ? 0 : v
}

/** Caractéristiques d'une invocation mises à l'échelle du niveau de l'invocateur (PV et caractéristiques). */
export const SUMMON_SCALED_STATS: readonly StatKey[] = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'lifePoints',
]

/** Facteur d'échelle d'une invocation : `1 + niveauInvocateur / 100` — INCERTAIN (règle 2.x, refontes D3). */
export function summonScaleFactor(summonerLevel: number): number {
  return 1 + summonerLevel / 100
}

/** Valeur d'invocation mise à l'échelle : `floor(valeur × (100 + niveau) / 100)` — INCERTAIN. */
export function scaleSummonValue(value: number, summonerLevel: number): number {
  const v = Math.floor((value * (100 + summonerLevel)) / 100)
  return v === 0 ? 0 : v
}

/** Copie des caractéristiques d'un grade de monstre invoqué, mises à l'échelle (`SUMMON_SCALED_STATS`) — INCERTAIN. */
export function scaleSummonStats<T extends Partial<Stats>>(stats: T, summonerLevel: number): T {
  const out = { ...stats }
  for (const k of SUMMON_SCALED_STATS) {
    const v = out[k]
    if (typeof v === 'number' && v !== 0) (out as Partial<Stats>)[k] = scaleSummonValue(v, summonerLevel)
  }
  return out
}

/**
 * Réduction d'armure (effets 105/265, « −X dommages reçus ») : `floor(valeur × (100 + 5 × niveau) / 100)`
 * = valeur × (1 + niveau/20), niveau du porteur du buff (AS3 l.2923, Giny `CalculateArmorValue`).
 */
export function armorReduction(value: number, level: number): number {
  return Math.floor((value * (100 + 5 * level)) / 100)
}

/**
 * Valeur de renvoi : renvoi fixe (carac 50) + buffs non boostés + `trunc(buffs boostés × (niveau/20 + 1))`
 * (AS3 `int(value × (casterLevel/20 + 1))`) — INCERTAIN sur le niveau utilisé.
 */
export function reflectValue(fixed: number, unboostedBuffs: number, boostedBuffs: number, level: number): number {
  return fixed + unboostedBuffs + Math.trunc(boostedBuffs * (level / 20 + 1))
}

/**
 * Dégâts renvoyés : `min(dégâts subis après résistances fixes et AVANT % résistances, renvoi)`, puis infligés au
 * lanceur en tenant compte de ses % résistances (pas de ses résistances fixes). Un renvoi ne se renvoie pas.
 */
export function reflectedDamage(damageBeforePercentRes: number, reflect: number): number {
  const v = damageBeforePercentRes < reflect ? damageBeforePercentRes : reflect
  return v > 0 ? v : 0
}
