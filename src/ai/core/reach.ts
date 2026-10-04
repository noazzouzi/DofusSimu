/**
 * Accessibilité avec tacle (docs/design/ai.md §6.2) — WP1.
 *
 * Recherche « au mieux » sur les cases, avec pour chaque case UN couple (PM, PA) restants et un unique prédécesseur
 * (arbre des chemins). Priorité (`priority`) :
 *  - 'mp' (défaut, design §6.2 « meilleur couple (PM, PA) ») : PM d'abord, puis PA. Les PM après tacle ne dépendent
 *    que des PM (fonction croissante) : les PM annoncés sont EXACTEMENT les PM maximaux et l'ensemble des cases est
 *    exactement l'ensemble atteignable (test T-reach) ; les PA sont les meilleurs parmi ces chemins (optimaux dans
 *    > 99,5 % des cas : un chemin plus long qui évite un tacleur peut garder plus de PA avec moins de PM).
 *  - 'ap' : PA d'abord, puis PM — meilleur pour lancer depuis la case, mais une case atteignable seulement par un
 *    chemin tacleur (plus court) peut manquer. Les candidats de lancer (candidates.ts) combinent les deux arbres.
 * Un arbre à un seul label par case ne peut pas être exact pour les deux critères à la fois (front de Pareto).
 * Quitter une case adjacente à des tacleurs applique la règle
 * DÉTERMINISTE de Dofus 3 exactement comme `move` (src/engine/move.ts) : ratio = Π tackleRatio(fuite, tacle) des
 * ennemis adjacents (sauf `tags.cantTackle` / état cantTackle ; aucun si le marcheur est cantBeTackled), puis
 * PA/PM = `apMpAfterTackle`, pas impossible si PM ≤ 0 après le tacle, −1 PM par pas. Les valeurs annoncées pour une
 * case sont donc celles que `move` produit en suivant le chemin `prev` (test T-reach).
 *
 * Écart assumé avec le design : `tags.canTackle === false` (drapeau DofusDB des monstres) n'est PAS lu, car `move` ne
 * le lit pas (parité exacte) ; Intaclable (96) passe par le drapeau d'état cantBeTackled.
 *
 * PM fractionnaires (clones 'average') : chemins sur ⌊PM⌋ (les consommateurs interpolent, cf. threat.ts).
 * Cases-événements (pièges connus — tout piège arrête la marche —, glyphes « à l'entrée », portails) : contournées par
 * défaut ; admises comme cases TERMINALES si elles figurent dans `allowEventCells` (`viaEvent` = 1).
 * Positions des autres combattants : celles que voit l'équipe de la vue (invisibles adverses sur leur dernière case
 * connue). Aucune allocation hors du résultat (tampons de module) ; `opts.out` permet de réutiliser un résultat.
 */
import type { TeamId } from '../../core/types'
import { apMpAfterTackle, tackleRatio } from '../../damage/tackle'
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, distance, neighborsOf } from '../../map/geometry'
import type { AIView, ReachInfo } from '../types'
import { fnvInt, mobilityDigest } from './hash'
import { believedCell, trapKnownBy } from './view'

export interface ReachOptions {
  /** Ordre des labels : 'mp' (défaut : ensemble exact) ou 'ap' (PA maximaux, voir l'en-tête). */
  priority?: 'mp' | 'ap'
  /** PM disponibles (défaut : PM courants) ; partie fractionnaire ignorée. */
  mp?: number
  /** PA disponibles (défaut : PA courants). */
  ap?: number
  /** Cases-événements admises (terminales). */
  allowEventCells?: ReadonlySet<number>
  /** Résultat à réutiliser (évite l'allocation). */
  out?: ReachInfo
  /** Occupation précalculée (`buildOccupancy`) pour plusieurs appels sur le même état. */
  occupancy?: Int16Array
}

/** Octets d'un ReachInfo (un seul tampon : mpLeft, apLeft, cells, prev, viaEvent). */
const REACH_BYTES = CELL_COUNT * (4 + 4 + 2 + 2 + 1)
/** Gabarit « vide » (−1 partout sauf `cells` / `viaEvent`) recopié à chaque création. */
const REACH_TEMPLATE = (() => {
  const b = new ArrayBuffer(REACH_BYTES)
  new Float32Array(b, 0, 2 * CELL_COUNT).fill(-1)
  new Int16Array(b, 8 * CELL_COUNT + 2 * CELL_COUNT, CELL_COUNT).fill(-1)
  return new Uint8Array(b)
})()

/** ReachInfo vide (toutes cases non atteintes) : un seul `ArrayBuffer`, initialisé par copie d'un gabarit. */
export function createReachInfo(): ReachInfo {
  const bytes = new Uint8Array(REACH_BYTES)
  bytes.set(REACH_TEMPLATE)
  const b = bytes.buffer
  return {
    mpLeft: new Float32Array(b, 0, CELL_COUNT),
    apLeft: new Float32Array(b, 4 * CELL_COUNT, CELL_COUNT),
    cells: new Int16Array(b, 8 * CELL_COUNT, CELL_COUNT),
    count: 0,
    prev: new Int16Array(b, 10 * CELL_COUNT, CELL_COUNT),
    viaEvent: new Uint8Array(b, 12 * CELL_COUNT, CELL_COUNT),
  }
}

/**
 * Occupation du plateau vue par `team` : `occ[c]` = id du combattant (vivant, non porté) sur la case, −1 sinon.
 * Les invisibles adverses sont placés sur leur dernière case connue (ou absents).
 */
export function buildOccupancy(s: FightState, team: TeamId, out: Int16Array = new Int16Array(CELL_COUNT)): Int16Array {
  out.fill(-1)
  const fs = s.fighters
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]
    if (!f.alive || f.carriedBy !== undefined) continue
    const c = believedCell(f, team)
    if (c >= 0 && c < CELL_COUNT && out[c] < 0) out[c] = f.id
  }
  return out
}

// ───────────────────────────── tampons de module ─────────────────────────────

const OCC = new Int16Array(CELL_COUNT)
const FINAL = new Uint8Array(CELL_COUNT)
const EVENT = new Uint8Array(CELL_COUNT)
const EVENT_LIST: number[] = []
/** Tacle des tacleurs par case (−1 = pas de tacleur). */
const LOCK = new Float64Array(CELL_COUNT).fill(-1)
const LOCK_LIST: number[] = []
/** PA restants en double précision (les sorties sont en Float32 : PA fractionnaires des clones 'average'). */
const AP64 = new Float64Array(CELL_COUNT)
const HEAP_CELL = new Int16Array(4 * CELL_COUNT + 8)
const HEAP_KEY = new Float64Array(4 * CELL_COUNT + 8)
let heapSize = 0

function heapPush(cell: number, key: number): void {
  let i = heapSize++
  while (i > 0) {
    const p = (i - 1) >> 1
    if (HEAP_KEY[p] > key || (HEAP_KEY[p] === key && HEAP_CELL[p] < cell)) break
    HEAP_CELL[i] = HEAP_CELL[p]
    HEAP_KEY[i] = HEAP_KEY[p]
    i = p
  }
  HEAP_CELL[i] = cell
  HEAP_KEY[i] = key
}

function heapPop(): number {
  const top = HEAP_CELL[0]
  const lastCell = HEAP_CELL[--heapSize]
  const lastKey = HEAP_KEY[heapSize]
  let i = 0
  for (;;) {
    let c = 2 * i + 1
    if (c >= heapSize) break
    if (c + 1 < heapSize && (HEAP_KEY[c + 1] > HEAP_KEY[c] || (HEAP_KEY[c + 1] === HEAP_KEY[c] && HEAP_CELL[c + 1] < HEAP_CELL[c]))) c++
    if (lastKey > HEAP_KEY[c] || (lastKey === HEAP_KEY[c] && lastCell <= HEAP_CELL[c])) break
    HEAP_CELL[i] = HEAP_CELL[c]
    HEAP_KEY[i] = HEAP_KEY[c]
    i = c
  }
  HEAP_CELL[i] = lastCell
  HEAP_KEY[i] = lastKey
  return top
}

/** Clé de priorité : PM d'abord puis PA (PA < 4096), ou PA d'abord puis PM (PM entiers ≤ 1023). */
function key(ap: number, mp: number, apFirst: boolean): number {
  return apFirst ? ap * 1024 + mp : mp * 4096 + ap
}

/** Le combattant `e` tacle-t-il (même test que `escapeRatio` de move.ts) ? */
export function canTackleNow(engine: Engine, e: Fighter): boolean {
  return !(e.tags.cantTackle || engine.stateFlag(e, 'cantTackle'))
}

/** Ratio de fuite de `mover` sur la case `cell` (tacleurs = ennemis vivants adjacents), comme `escapeRatio`. */
export function escapeRatioAt(engine: Engine, s: FightState, mover: Fighter, cell: number, team: TeamId = mover.team): number {
  if (engine.stateFlag(mover, 'cantBeTackled')) return 1
  const occ = buildOccupancy(s, team, OCC)
  let ratio = 1
  for (const n of neighborsOf(cell)) {
    const id = occ[n]
    if (id < 0) continue
    const e = s.fighters[id]
    if (e.team === mover.team || !canTackleNow(engine, e)) continue
    ratio *= tackleRatio(mover.stats.tackleEvade, e.stats.tackleBlock)
  }
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
}

/** `computeReach` sans vue : `team` = équipe dont on prend le point de vue (positions des invisibles). */
export function computeReachFor(engine: Engine, s: FightState, f: Fighter, team: TeamId, opts: ReachOptions = {}): ReachInfo {
  const out = opts.out ?? createReachInfo()
  // Remise à zéro des cases touchées par l'appel précédent sur `out`.
  for (let i = 0; i < out.count; i++) {
    const c = out.cells[i]
    out.mpLeft[c] = -1
    out.apLeft[c] = -1
    out.prev[c] = -1
    out.viaEvent[c] = 0
  }
  out.count = 0
  const start = believedCell(f, team)
  if (!f.alive || start < 0 || start >= CELL_COUNT) return out
  const mp0 = Math.max(0, Math.floor(opts.mp ?? f.mp))
  const ap0 = opts.ap ?? f.ap
  out.mpLeft[start] = mp0
  out.apLeft[start] = ap0
  AP64[start] = ap0
  if (mp0 <= 0 || (engine.stateFlag(f, 'cantBeMoved') && f.tags.rooted)) {
    out.cells[0] = start
    out.count = 1
    return out
  }
  const occ = opts.occupancy ?? buildOccupancy(s, team, OCC)
  const cells = s.map.cells

  // Cases-événements : pièges connus (tout piège arrête la marche), glyphes « à l'entrée » et portails.
  for (const t of s.traps) {
    if (!trapKnownBy(s, t, team)) continue
    for (const c of t.cells) if (c >= 0 && c < CELL_COUNT && !EVENT[c]) (EVENT[c] = 1), EVENT_LIST.push(c)
  }
  for (const g of s.glyphs) {
    if (g.trigger !== 'enter' && g.markType !== 'portal') continue
    for (const c of g.cells) if (c >= 0 && c < CELL_COUNT && !EVENT[c]) (EVENT[c] = 1), EVENT_LIST.push(c)
  }
  // Tacleurs (ennemis du marcheur, vivants, non portés).
  const tackled = !engine.stateFlag(f, 'cantBeTackled')
  if (tackled) {
    for (const e of s.fighters) {
      if (!e.alive || e.team === f.team || e.carriedBy !== undefined) continue
      const c = believedCell(e, team)
      if (c < 0 || c >= CELL_COUNT || occ[c] !== e.id || !canTackleNow(engine, e)) continue
      LOCK[c] = e.stats.tackleBlock
      LOCK_LIST.push(c)
    }
  }
  const evade = f.stats.tackleEvade
  const allow = opts.allowEventCells
  const apFirst = opts.priority === 'ap'

  heapSize = 0
  heapPush(start, key(ap0, mp0, apFirst))
  let count = 0
  while (heapSize > 0) {
    const c = heapPop()
    if (FINAL[c]) continue
    FINAL[c] = 1
    out.cells[count++] = c
    if (c !== start && EVENT[c]) continue // case-événement admise : terminale
    const mp = out.mpLeft[c]
    if (mp <= 0) continue
    let ap = AP64[c]
    let mpAfter = mp
    if (LOCK_LIST.length) {
      let ratio = 1
      const ns = neighborsOf(c)
      for (let i = 0; i < ns.length; i++) {
        const lock = LOCK[ns[i]]
        if (lock >= 0) ratio *= tackleRatio(evade, lock)
      }
      if (ratio < 1) {
        ap = apMpAfterTackle(ap, ratio)
        mpAfter = apMpAfterTackle(mp, ratio)
      }
    }
    if (mpAfter <= 0) continue
    const nmp = mpAfter - 1
    const k = key(ap, nmp, apFirst)
    const ns = neighborsOf(c)
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i]
      if (FINAL[n] || occ[n] >= 0) continue
      const mc = cells[n]
      if (!mc || !mc.walkable) continue
      if (EVENT[n] && !(allow && allow.has(n))) continue
      if (out.mpLeft[n] >= 0) {
        const prevAp = AP64[n]
        const prevMp = out.mpLeft[n]
        if (apFirst ? prevAp > ap || (prevAp === ap && prevMp >= nmp) : prevMp > nmp || (prevMp === nmp && prevAp >= ap)) continue
      }
      out.mpLeft[n] = nmp
      out.apLeft[n] = ap
      AP64[n] = ap
      out.prev[n] = c
      out.viaEvent[n] = EVENT[n]
      heapPush(n, k)
    }
  }
  out.count = count
  // Nettoyage des tampons.
  for (let i = 0; i < count; i++) FINAL[out.cells[i]] = 0
  for (const c of EVENT_LIST) EVENT[c] = 0
  EVENT_LIST.length = 0
  for (const c of LOCK_LIST) LOCK[c] = -1
  LOCK_LIST.length = 0
  return out
}

/** Cases atteignables par `f` (tacle exact, cases-événements, positions vues par l'équipe de la vue). */
export function computeReach(view: AIView, s: FightState, f: Fighter, opts?: ReachOptions): ReachInfo {
  return computeReachFor(view.engine, s, f, view.team, opts)
}

/** Chemin (path[0] = case de départ) vers `to` dans un `ReachInfo`, ou null. */
export function reachPath(reach: ReachInfo, from: number, to: number): number[] | null {
  if (to < 0 || to >= CELL_COUNT || reach.mpLeft[to] < 0) return null
  const path = [to]
  let c = to
  for (let guard = 0; c !== from && guard < CELL_COUNT; guard++) {
    c = reach.prev[c]
    if (c < 0) return null
    path.push(c)
  }
  return path.reverse()
}

/** PM consommés pour atteindre `cell` (pas + tacle) depuis le départ de `reach`, −1 si non atteinte. */
export function mpSpent(reach: ReachInfo, cell: number): number {
  if (reach.count === 0 || reach.mpLeft[cell] < 0) return -1
  return reach.mpLeft[reach.cells[0]] - reach.mpLeft[cell]
}

/** PA perdus au tacle pour atteindre `cell`, −1 si non atteinte. */
export function apSpent(reach: ReachInfo, cell: number): number {
  if (reach.count === 0 || reach.apLeft[cell] < 0) return -1
  return reach.apLeft[reach.cells[0]] - reach.apLeft[cell]
}

// ───────────────────────────── cache partagé ─────────────────────────────

/** Entrée du cache : second hash de vérification (clé effective 64 bits) et résultat partagé. */
interface ReachEntry { k2: number; r: ReachInfo }
/** Cache d'accessibilité (par moteur) : clé = combattant + révision + PA/PM + empreinte LOCALE de l'occupation. */
const REACH_CACHE = new WeakMap<Engine, Map<number, ReachEntry>>()
/** Plafond d'entrées (≈ 7 ko chacune). */
const REACH_CACHE_MAX = 4000
const SCRATCH_REACH = createReachInfo()

/** Copie indépendante d'un `ReachInfo`. */
export function cloneReach(r: ReachInfo): ReachInfo {
  const out = createReachInfo()
  out.count = r.count
  out.cells.set(r.cells.subarray(0, r.count), 0)
  for (let i = 0; i < r.count; i++) {
    const c = r.cells[i]
    out.mpLeft[c] = r.mpLeft[c]
    out.apLeft[c] = r.apLeft[c]
    out.prev[c] = r.prev[c]
    out.viaEvent[c] = r.viaEvent[c]
  }
  return out
}

/**
 * `computeReachFor` mis en cache (résultat partagé : NE PAS le modifier). L'empreinte (2 × 32 bits) ne couvre que ce
 * qui peut changer le résultat : carte, combattants à distance ≤ PM + 1 du départ (blocage ; tacle et drapeau de tacle
 * des ennemis), marques (cases-événements), mobilité du marcheur (`mobilityDigest` : fuite, états, marqueurs), case,
 * PA/PM, priorité.
 */
export function cachedReach(engine: Engine, s: FightState, f: Fighter, team: TeamId, mp: number, ap: number, occupancy?: Int16Array,
                            priority: 'mp' | 'ap' = 'mp'): ReachInfo {
  let cache = REACH_CACHE.get(engine)
  if (!cache) REACH_CACHE.set(engine, (cache = new Map()))
  const start = believedCell(f, team)
  const mpi = Math.max(0, Math.floor(mp))
  const apq = Math.round(ap * 100)
  // Marcheur : empreinte de mobilité (fuite, états, marqueurs), pas sa révision (un buff de dégâts ne change rien).
  const md = mobilityDigest(f)
  let h = fnvInt(fnvInt(fnvInt(fnvInt(0x811c9dc5, f.id), md), start), mpi * 2 + (priority === 'ap' ? 1 : 0))
  let h2 = fnvInt(fnvInt(fnvInt(fnvInt(0x050c5d1f, f.id), md), start), mpi * 2 + (priority === 'ap' ? 1 : 0))
  // Carte (le cache est partagé par tous les combats du moteur) : obstacles et cases non marchables.
  h = fnvInt(fnvInt(h, apq), s.map.id)
  h2 = fnvInt(fnvInt(h2, apq), s.map.id)
  for (const o of s.fighters) {
    if (!o.alive || o.id === f.id || o.carriedBy !== undefined) continue
    const c = believedCell(o, team)
    if (c < 0 || distance(c, start) > mpi + 1) continue
    // Voisin : blocage (case) et, pour un ennemi, tacle (valeur et drapeaux).
    const tk = o.team === f.team ? 0 : o.stats.tackleBlock * 2 + (canTackleNow(engine, o) ? 1 : 0)
    h = fnvInt(fnvInt(fnvInt(h, o.id), c), tk)
    h2 = fnvInt(fnvInt(fnvInt(h2, o.id), c), tk)
  }
  for (const g of s.glyphs) {
    if (g.trigger !== 'enter' && g.markType !== 'portal') continue
    h = fnvInt(h, g.center + 1000)
    h2 = fnvInt(h2, g.center + 1000)
  }
  for (const t of s.traps) {
    if (!trapKnownBy(s, t, team)) continue
    h = fnvInt(h, t.center + 2000)
    h2 = fnvInt(h2, t.center + 2000)
  }
  const e = cache.get(h)
  if (e && e.k2 === h2) return e.r
  computeReachFor(engine, s, f, team, { mp: mpi, ap, out: SCRATCH_REACH, occupancy, priority })
  const r = cloneReach(SCRATCH_REACH)
  if (cache.size >= REACH_CACHE_MAX) cache.clear()
  cache.set(h, { k2: h2, r })
  return r
}
