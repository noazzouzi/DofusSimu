/**
 * Création / copie d'objets `Stats` en « propriétés rapides » V8.
 *
 * Un objet construit par ajouts successifs de 55 clés (cas de `emptyStats()` de src/core/types.ts) passe en mode
 * dictionnaire : chaque accès devient une recherche par hachage et une copie `{ ...stats }` coûte ~13 µs.
 * Un littéral d'objet garde une forme (hidden class) stable : création et copie ~0,1 µs.
 * Les littéraux sont typés `Stats` : l'ajout d'une clé à `Stats` provoque une erreur de compilation ici.
 */
import type { Stats, StatKey } from '../core/types'

/** `Stats` à zéro (équivalent rapide de `emptyStats()`). */
export function zeroStats(): Stats {
  return {
    vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0, ap: 0, mp: 0, range: 0, summons: 0,
    initiative: 0, prospecting: 0, critical: 0, heals: 0, power: 0, damage: 0, neutralDamage: 0, earthDamage: 0,
    fireDamage: 0, waterDamage: 0, airDamage: 0, criticalDamage: 0, pushDamage: 0, trapDamage: 0, trapPower: 0,
    spellDamagePct: 0, weaponDamagePct: 0, meleeDamagePct: 0, rangedDamagePct: 0, finalDamagePct: 0, apReduction: 0,
    mpReduction: 0, apParry: 0, mpParry: 0, tackleBlock: 0, tackleEvade: 0, neutralResPct: 0, earthResPct: 0,
    fireResPct: 0, waterResPct: 0, airResPct: 0, neutralRes: 0, earthRes: 0, fireRes: 0, waterRes: 0, airRes: 0,
    criticalRes: 0, pushRes: 0, meleeResPct: 0, rangedResPct: 0, spellResPct: 0, weaponResPct: 0, reflect: 0,
    lifePoints: 0, weaponSkillPct: 0,
  }
}

/** Copie d'un `Stats` (le résultat est toujours en propriétés rapides, même si la source ne l'est pas). */
export function copyStats(s: Stats): Stats {
  return {
    vitality: s.vitality, wisdom: s.wisdom, strength: s.strength, intelligence: s.intelligence, chance: s.chance,
    agility: s.agility, ap: s.ap, mp: s.mp, range: s.range, summons: s.summons, initiative: s.initiative,
    prospecting: s.prospecting, critical: s.critical, heals: s.heals, power: s.power, damage: s.damage,
    neutralDamage: s.neutralDamage, earthDamage: s.earthDamage, fireDamage: s.fireDamage,
    waterDamage: s.waterDamage, airDamage: s.airDamage, criticalDamage: s.criticalDamage, pushDamage: s.pushDamage,
    trapDamage: s.trapDamage, trapPower: s.trapPower, spellDamagePct: s.spellDamagePct,
    weaponDamagePct: s.weaponDamagePct, meleeDamagePct: s.meleeDamagePct, rangedDamagePct: s.rangedDamagePct,
    finalDamagePct: s.finalDamagePct, apReduction: s.apReduction, mpReduction: s.mpReduction, apParry: s.apParry,
    mpParry: s.mpParry, tackleBlock: s.tackleBlock, tackleEvade: s.tackleEvade, neutralResPct: s.neutralResPct,
    earthResPct: s.earthResPct, fireResPct: s.fireResPct, waterResPct: s.waterResPct, airResPct: s.airResPct,
    neutralRes: s.neutralRes, earthRes: s.earthRes, fireRes: s.fireRes, waterRes: s.waterRes, airRes: s.airRes,
    criticalRes: s.criticalRes, pushRes: s.pushRes, meleeResPct: s.meleeResPct, rangedResPct: s.rangedResPct,
    spellResPct: s.spellResPct, weaponResPct: s.weaponResPct, reflect: s.reflect, lifePoints: s.lifePoints,
    weaponSkillPct: s.weaponSkillPct,
  }
}

/**
 * Ordre des caractéristiques dans les accumulateurs `Float64Array` (indépendant de `STAT_KEYS`, vérifié par les tests).
 * Les additions par index dans un tableau typé coûtent ~30× moins que des écritures `stats[clé] +=` à clé variable.
 */
export const STAT_ORDER = [
  'vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility', 'ap', 'mp', 'range', 'summons', 'initiative',
  'prospecting', 'critical', 'heals', 'power', 'damage', 'neutralDamage', 'earthDamage', 'fireDamage', 'waterDamage',
  'airDamage', 'criticalDamage', 'pushDamage', 'trapDamage', 'trapPower', 'spellDamagePct', 'weaponDamagePct',
  'meleeDamagePct', 'rangedDamagePct', 'finalDamagePct', 'apReduction', 'mpReduction', 'apParry', 'mpParry',
  'tackleBlock', 'tackleEvade', 'neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct', 'neutralRes',
  'earthRes', 'fireRes', 'waterRes', 'airRes', 'criticalRes', 'pushRes', 'meleeResPct', 'rangedResPct', 'spellResPct',
  'weaponResPct', 'reflect', 'lifePoints', 'weaponSkillPct',
] as const satisfies readonly StatKey[]

export const STAT_COUNT = STAT_ORDER.length

const statIndex = {} as Record<StatKey, number>
STAT_ORDER.forEach((k, i) => (statIndex[k] = i))
/** Index d'une caractéristique dans les accumulateurs (`STAT_ORDER`). */
export const STAT_INDEX: Readonly<Record<StatKey, number>> = statIndex

/** `Stats` construit depuis un accumulateur indexé selon `STAT_ORDER`. */
export function statsFromArray(a: ArrayLike<number>): Stats {
  return {
    vitality: a[0], wisdom: a[1], strength: a[2], intelligence: a[3], chance: a[4], agility: a[5], ap: a[6],
    mp: a[7], range: a[8], summons: a[9], initiative: a[10], prospecting: a[11], critical: a[12], heals: a[13],
    power: a[14], damage: a[15], neutralDamage: a[16], earthDamage: a[17], fireDamage: a[18], waterDamage: a[19],
    airDamage: a[20], criticalDamage: a[21], pushDamage: a[22], trapDamage: a[23], trapPower: a[24],
    spellDamagePct: a[25], weaponDamagePct: a[26], meleeDamagePct: a[27], rangedDamagePct: a[28],
    finalDamagePct: a[29], apReduction: a[30], mpReduction: a[31], apParry: a[32], mpParry: a[33],
    tackleBlock: a[34], tackleEvade: a[35], neutralResPct: a[36], earthResPct: a[37], fireResPct: a[38],
    waterResPct: a[39], airResPct: a[40], neutralRes: a[41], earthRes: a[42], fireRes: a[43], waterRes: a[44],
    airRes: a[45], criticalRes: a[46], pushRes: a[47], meleeResPct: a[48], rangedResPct: a[49], spellResPct: a[50],
    weaponResPct: a[51], reflect: a[52], lifePoints: a[53], weaponSkillPct: a[54],
  }
}
