/**
 * Partage copie-sur-écriture (COW) de l'état mutable des combattants entre clones de combat (`Engine.cloneFight`) —
 * chemin chaud de l'IA : des milliers de clones par tour, dont chaque nœud ne modifie que quelques combattants.
 *
 * Buffs (`Fighter.buffs`, tableau ET objets) : `cloneFight` partage le tableau du parent et ouvre une nouvelle ÉPOQUE ;
 * un tableau n'est privé (modifiable en place) que s'il a été copié pendant l'époque courante (marque `OWNED`). Toute
 * modification d'un buff (champ) ou du tableau (push, splice, remplacement filtré) passe donc d'abord par
 * `ownBuffs(f)`, qui copie le tableau et ses buffs (`cloneBuff`) s'ils ne sont pas privés, et renvoie `f.buffs`.
 * Règles :
 *  - `ownBuffs` AVANT de prendre une référence (tableau ou buff) qui sera modifiée ensuite : une fois privé, le tableau
 *    (et l'identité de ses buffs) reste stable jusqu'au prochain clonage — jamais pendant une opération du moteur ;
 *  - un remplacement filtré du tableau garde la propriété (`keepOwnership`) pour préserver l'identité des buffs ;
 *  - hors du moteur, les buffs se lisent librement mais ne se modifient JAMAIS en place (remplacer le tableau).
 *
 * Relances et compteurs de lancers (`cooldowns`, `castsThisTurn`, `castsOnTarget`) : objets partagés par `cloneFight`,
 * REMPLACÉS à chaque écriture (`setRecord`), jamais modifiés en place (même convention que `spellMods` et
 * `FightState.deaths`). `cloneFighter` (copie autonome d'un combattant) reste une copie profonde.
 *
 * Métriques (`FightState.metrics`) : la table est copiée par `cloneFight`, les objets par combattant sont partagés et
 * REMPLACÉS à chaque écriture (`addMetric`).
 */
import type { Buff, Fighter, FighterMetrics, FightState } from './types'

/** Époque de partage courante (incrémentée à chaque clonage partagé). */
let epoch = 1
/**
 * Marque (clé symbole NON énumérable : invisible de `for…in`, JSON et des comparaisons profondes) : époque à laquelle
 * le tableau de buffs est devenu privé.
 */
const OWNED: unique symbol = Symbol('cowOwnedEpoch')
type OwnedBuffs = Buff[] & { [OWNED]?: number }

/** Ouvre une nouvelle époque : plus aucun tableau de buffs n'est privé (appelé par `cloneFight` avant le partage). */
export function newShareEpoch(): void {
  epoch++
}

/** Les buffs de `f` sont-ils privés (modifiables en place) ? */
export function buffsOwned(f: Fighter): boolean {
  return (f.buffs as OwnedBuffs)[OWNED] === epoch
}

/** Rend privés (copie si partagés) le tableau des buffs de `f` et ses buffs ; renvoie `f.buffs`. */
export function ownBuffs(f: Fighter): Buff[] {
  const cur = f.buffs as OwnedBuffs
  if (cur[OWNED] === epoch) return cur
  const n = cur.length
  const copy: OwnedBuffs = new Array(n)
  for (let i = 0; i < n; i++) copy[i] = cloneBuff(cur[i])
  markOwned(copy)
  f.buffs = copy
  return copy
}

function markOwned(a: OwnedBuffs): void {
  Object.defineProperty(a, OWNED, { value: epoch, writable: true, enumerable: false, configurable: true })
}

/** `next` (filtré depuis `prev`, mêmes objets) hérite de la propriété de `prev`. */
export function keepOwnership(prev: Buff[], next: Buff[]): void {
  if ((prev as OwnedBuffs)[OWNED] === epoch) markOwned(next)
}

/**
 * Copie d'un buff — littéral explicite (forme stable pour V8, ~20 % plus rapide qu'une décomposition).
 * TOUT nouveau champ de `Buff` doit être ajouté ici (garde-fou : tests/engine-clone.test.ts).
 */
export function cloneBuff(b: Buff): Buff {
  return {
    uid: b.uid,
    sourceId: b.sourceId,
    spellId: b.spellId,
    effect: b.effect,
    value: b.value,
    remaining: b.remaining,
    delay: b.delay,
    dispellable: b.dispellable,
    statDelta: b.statDelta,
    stateId: b.stateId,
    triggers: b.triggers,
    label: b.label,
    kind: b.kind,
    crit: b.crit,
    triggerCount: b.triggerCount,
    maxTriggers: b.maxTriggers,
    firing: b.firing,
    spellMod: b.spellMod,
    disabledStateId: b.disabledStateId,
    passTurn: b.passTurn,
    markUid: b.markUid,
    targetCell: b.targetCell,
  }
}

/** `fight.metrics[id][key] += delta` en copie-sur-écriture (objet de métriques remplacé, partagé entre clones). */
export function addMetric(fight: FightState, id: number, key: keyof FighterMetrics, delta: number): void {
  const m = fight.metrics[id]
  const n: FighterMetrics = {
    damageDealt: m.damageDealt,
    damageTaken: m.damageTaken,
    healingDone: m.healingDone,
    apRemoved: m.apRemoved,
    mpRemoved: m.mpRemoved,
    kills: m.kills,
    turnsPlayed: m.turnsPlayed,
  }
  n[key] = m[key] + delta
  fight.metrics[id] = n
}

/** Écriture COW d'une entrée d'un enregistrement partagé (relances, lancers) : `{ ...rec, [key]: value }`. */
export function setRecord<K extends string | number>(rec: Record<K, number>, key: K, value: number): Record<K, number> {
  const out = { ...rec }
  out[key] = value
  return out
}
