/**
 * Cibles du proxy de stuff, partie SANS dépendance au Vortex (proxy.ts importe le mix du Vortex comme défaut
 * historique ; le theorycraft, docs/design/theorycraft.md §0 point 3, importe ce module-ci) :
 *  - `proxyEngine` : moteur partagé par donnée (profils de sorts et tables DPT mis en cache), commun au proxy, aux
 *    outils d'optimisation et au theorycraft ;
 *  - `applyTargetOverrides` : surcharges d'un monstre de fabrique (`ProxyTarget.stats`/`states`/`excludeSpells`/
 *    `hpShare` : boss « en combat », caractéristiques imposées, états de phase, sorts retirés, PV restants) ;
 *  - `imposeStats` : caractéristiques imposées et dérivées décalées (même règle, sans combattant : fiche du boss).
 * Ré-exporté par proxy.ts (API inchangée).
 */
import type { Stats, StatKey } from '../../core/types'
import type { DataStore } from '../../data/store'
import { createEngine, type Engine } from '../../engine'
import { bumpRev } from '../../engine/rev'
import type { Fighter } from '../../engine/types'

const ENGINES = new WeakMap<DataStore, Engine>()

/** Moteur partagé par donnée (profils de sorts et tables DPT mis en cache). */
export function proxyEngine(data: DataStore): Engine {
  let e = ENGINES.get(data)
  if (!e) ENGINES.set(data, (e = createEngine(data)))
  return e
}

/** Surcharges d'un monstre cible (voir `ProxyTarget.stats`/`states`/`excludeSpells`/`hpShare`, proxy.ts). */
export interface TargetOverrides {
  /** Caractéristiques imposées (valeurs finales). */
  stats?: Partial<Stats>
  /** États ajoutés. */
  states?: readonly number[]
  /** Sorts retirés du monstre (ids : sorts exclus ou positionnels d'une fiche manuelle). */
  excludeSpells?: readonly number[]
  /** PV restants en part des PV max (ex. 0,5 : boss « à mi-vie », lignes en % de PV du lanceur). */
  hpShare?: number
}

/**
 * Dérivées des caractéristiques principales d'un monstre (mêmes règles que `createMonsterFighter`) : source, clés
 * dérivées, fonction de la source.
 */
const MONSTER_DERIVED: readonly (readonly [StatKey, readonly StatKey[], (v: number) => number])[] = [
  ['agility', ['tackleBlock', 'tackleEvade'], v => Math.floor(v / 10)],
  ['wisdom', ['apParry', 'mpParry', 'apReduction', 'mpReduction'], v => Math.floor(v / 10)],
  ['strength', ['initiative'], v => v],
  ['intelligence', ['initiative'], v => v],
  ['chance', ['initiative'], v => v],
  ['agility', ['initiative'], v => v],
]

/**
 * Caractéristiques `stats` après imposition de `imposed` (valeurs finales) : clés imposées remplacées, dérivées d'une
 * caractéristique principale imposée décalées d'autant (tacle/fuite ← Agilité/10, esquives/retraits ← Sagesse/10,
 * initiative ← somme des quatre éléments) sauf si la dérivée est elle-même imposée. Nouvel objet ; `vitality` : écart
 * de Vitalité (PV à décaler par l'appelant).
 */
export function imposeStats(stats: Stats, imposed: Partial<Stats>): { stats: Stats; vitality: number } {
  const imp = imposed as Partial<Record<keyof Stats, number>>
  const st: Stats = { ...stats }
  for (const k of Object.keys(imp) as (keyof Stats)[]) if (imp[k] !== undefined) (st as unknown as Record<string, number>)[k] = imp[k]!
  for (const [src, derived, fn] of MONSTER_DERIVED) {
    if (imp[src] === undefined) continue
    const d = fn(st[src]) - fn(stats[src])
    if (!d) continue
    for (const k of derived) if (imp[k] === undefined) st[k] += d
  }
  return { stats: st, vitality: imp.vitality !== undefined ? st.vitality - stats.vitality : 0 }
}

/**
 * Applique à un combattant monstre de fabrique les surcharges d'une cible (`ProxyTarget.stats`/`states`/
 * `excludeSpells`/`hpShare`) : valeurs imposées sur `baseStats` ET `stats` (cohérent avec un recalcul des buffs),
 * dérivées décalées (`imposeStats`), PV décalés de la Vitalité imposée, PA/PM courants alignés ; états AJOUTÉS (sans
 * doublon) ; sorts exclus retirés ; PV courants = `hpShare` × PV max. Révision renouvelée (caches DPT). Sans
 * surcharge : combattant intact (même objet, aucune révision posée). Modifie `f` en place et le renvoie.
 */
export function applyTargetOverrides(f: Fighter, o: TargetOverrides): Fighter {
  const imposed = (o.stats ?? {}) as Partial<Record<keyof Stats, number>>
  const keys = (Object.keys(imposed) as (keyof Stats)[]).filter(k => imposed[k] !== undefined)
  const states = o.states ?? []
  const excluded = o.excludeSpells ?? []
  if (!keys.length && !states.length && !excluded.length && o.hpShare === undefined) return f
  if (keys.length) {
    // Copies complètes (clés facultatives comprises : `allResPct`…) : objets remplacés, jamais modifiés en place.
    const st = imposeStats(f.stats, imposed)
    const base = imposeStats(f.baseStats, imposed)
    if (st.vitality) {
      f.maxHp = Math.max(1, f.maxHp + st.vitality)
      f.baseMaxHp = Math.max(1, f.baseMaxHp + st.vitality)
      f.hp = Math.max(1, f.hp + st.vitality)
    }
    f.stats = st.stats
    f.baseStats = base.stats
    f.ap = st.stats.ap
    f.mp = st.stats.mp
  }
  if (states.length) f.states = [...new Set([...f.states, ...states])]
  if (excluded.length) f.spells = f.spells.filter(s => !excluded.includes(s.spellId))
  if (o.hpShare !== undefined) f.hp = Math.max(1, Math.round(f.maxHp * Math.min(1, Math.max(0, o.hpShare))))
  bumpRev(f)
  return f
}
