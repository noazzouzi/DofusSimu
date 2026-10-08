/**
 * Cibles du proxy de stuff, partie SANS dépendance au Vortex (proxy.ts importe le mix du Vortex comme défaut
 * historique ; le theorycraft, docs/design/theorycraft.md §0 point 3, importe ce module-ci) :
 *  - `proxyEngine` : moteur partagé par donnée (profils de sorts et tables DPT mis en cache), commun au proxy, aux
 *    outils d'optimisation et au theorycraft ;
 *  - `applyTargetOverrides` : surcharges d'un monstre de fabrique (`ProxyTarget.stats`/`states` : boss « en combat »,
 *    caractéristiques imposées et états de phase).
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

/** Surcharges d'un monstre cible (voir `ProxyTarget.stats`/`states`, proxy.ts). */
export interface TargetOverrides {
  /** Caractéristiques imposées (valeurs finales). */
  stats?: Partial<Stats>
  /** États ajoutés. */
  states?: readonly number[]
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
 * Applique à un combattant monstre de fabrique les surcharges d'une cible (`ProxyTarget.stats`/`states`) : valeurs
 * imposées sur `baseStats` ET `stats` (cohérent avec un recalcul des buffs), dérivées d'une caractéristique
 * principale imposée décalées d'autant (tacle/fuite ← Agilité/10, esquives/retraits ← Sagesse/10, initiative ← somme
 * des quatre éléments) sauf si la dérivée est elle-même imposée, PV décalés de la Vitalité imposée, PA/PM courants
 * alignés ; états AJOUTÉS (sans doublon). Révision renouvelée (caches DPT). Sans surcharge : combattant intact (même
 * objet, aucune révision posée). Modifie `f` en place et le renvoie.
 */
export function applyTargetOverrides(f: Fighter, o: TargetOverrides): Fighter {
  const imposed = (o.stats ?? {}) as Partial<Record<keyof Stats, number>>
  const keys = (Object.keys(imposed) as (keyof Stats)[]).filter(k => imposed[k] !== undefined)
  const states = o.states ?? []
  if (!keys.length && !states.length) return f
  if (keys.length) {
    const before = f.stats
    // Copies complètes (clés facultatives comprises : `allResPct`…) : objets remplacés, jamais modifiés en place.
    const st: Stats = { ...f.stats }
    const base: Stats = { ...f.baseStats }
    for (const k of keys) {
      ;(st as unknown as Record<string, number>)[k] = imposed[k]!
      ;(base as unknown as Record<string, number>)[k] = imposed[k]!
    }
    for (const [src, derived, fn] of MONSTER_DERIVED) {
      if (imposed[src] === undefined) continue
      const d = fn(st[src]) - fn(before[src])
      if (!d) continue
      for (const k of derived) {
        if (imposed[k] !== undefined) continue
        st[k] += d
        base[k] += d
      }
    }
    if (imposed.vitality !== undefined) {
      const d = st.vitality - before.vitality
      f.maxHp = Math.max(1, f.maxHp + d)
      f.baseMaxHp = Math.max(1, f.baseMaxHp + d)
      f.hp = Math.max(1, f.hp + d)
    }
    f.stats = st
    f.baseStats = base
    f.ap = st.ap
    f.mp = st.mp
  }
  if (states.length) f.states = [...new Set([...f.states, ...states])]
  bumpRev(f)
  return f
}
