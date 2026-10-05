/**
 * Recherche de stuff (niveau L3, docs/design/ai.md §15.4 points 2, 4, 6, 7) — WP4b.
 *
 * Pour UN personnage (classe, variantes, rôle, élément) :
 *  1. contexte de proxy (`proxy.ts`) au build de départ, viviers par emplacement (`pools.ts`) ;
 *  2. graines : stuff de départ du membre, stuffs méta d'equipment.md §12 (`STUFFS` de data/ai/presets.json, tous
 *     éléments), stuff glouton (meilleur objet linéaire par position) ;
 *  3. montée par coordonnées depuis chaque graine (16 positions × vivier), puis recuit simulé (graine fixe, mouvements
 *     « changer un objet », « poser/retirer un bloc de panoplie », « échanger un Dofus », « déplacer l'exo
 *     PA/PM/PO ») sur la forme fermée du proxy (`surrogate`) ; forgemagie re-planifiée à chaque évaluation
 *     (`exos.ts`) ; tout build invalide (conditions, doublons, prysmaradites…) vaut −∞ ;
 *  4. re-notation EXACTE (`ProxyContext.exact`, caractéristiques recalculées par `computeBuildStats`) des `topExact`
 *     (50) meilleurs builds distincts, puis des répartitions de points (`points.ts`) sur les meilleurs ;
 *  5. front de Pareto (DPT, EHP, UTIL) : `diversity` (5) builds diversifiés pour la validation par combats (L3 point 7,
 *     `validateStuffs`).
 * Déterministe : `Rng` graine, départages par logJ puis clé ; aucun `Math.random`/`Date.now` dans une décision
 * (`performance.now` ne sert qu'au temps rapporté).
 */
import type { RoleId } from '../../ai/types'
import { Rng } from '../../core/rng'
import type { Stats } from '../../core/types'
import type { EquipmentSlot, ItemData } from '../../data/model'
import type { GameDataStore } from '../../data/store'
import { computeBuildStats, finalizeStats, type CharacterBuild, type EquippedItem } from '../../stats/build'
import { statLevel } from '../../stats/characteristicPoints'
import { evaluateCriterion, parseCriterion, type CriterionContext } from '../../stats/conditions'
import { EFFECT_STAT_CAP } from '../../stats/effects'
import { copyStats } from '../../stats/fastStats'
import type { PrimaryStat } from '../../stats/characteristicPoints'
import { findPreset, presetPoints, STUFFS } from '../team/presets'
import type { MemberSpec } from '../types'
import { detExp, detLog } from './detmath'
import { EXO_STATS, ForgePlanner, type ExoStat, type ForgePlan, type ForgeProfile } from './exos'
import { pointsOptions, type PointsOption } from './points'
import { buildPools, linearValue, itemStatDelta, STUFF_POSITIONS, type PassivePolicy, type StuffPools } from './pools'
import { createProxyContext, ELEMENT_STAT, type ProxyContext, type ProxyElement, type ProxyOptions, type ProxyScore } from './proxy'

export interface StuffSearchOptions {
  /** Graine du recuit (défaut 1). */
  seed?: number
  /** Itérations du recuit (défaut 20 000 ; 0 = montée par coordonnées seule). */
  iterations?: number
  /** Balayages maximaux de la montée par coordonnées (défaut 6). */
  sweeps?: number
  /** Builds re-notés exactement (défaut 50). */
  topExact?: number
  /** Builds diversifiés rendus (front de Pareto, défaut 5). */
  diversity?: number
  profile?: ForgeProfile
  /** Rôle imposé (défaut : rôle du membre / du preset). */
  role?: RoleId
  element?: ProxyElement
  perSlot?: number
  dofusPool?: number
  minLevel?: number
  passivePolicy?: PassivePolicy
  /** Essayer les répartitions de points (défaut vrai). */
  points?: boolean
  proxy?: ProxyOptions
  /** Températures du recuit (unités de logJ). */
  t0?: number
  t1?: number
}

export interface StuffCandidate {
  build: CharacterBuild
  /** Score exact (DptTable). */
  score: ProxyScore
  /** Score de la forme fermée. */
  surrogate: ProxyScore
  /** Clé stable (objets par position, exos, points). */
  key: string
  forge: ForgePlan
  pointsId: string
  /** Objets portant un sort passif non simulé (rapport). */
  passiveItems: number[]
}

export interface StuffResult {
  member: string
  role: RoleId
  element: ProxyElement
  /** Build de départ, noté exactement (référence d'amélioration). */
  start: StuffCandidate
  best: StuffCandidate
  /** Builds diversifiés (front DPT/EHP/UTIL), meilleur d'abord. */
  front: StuffCandidate[]
  evaluations: { surrogate: number; exact: number }
  pools: { examined: number; kept: number; setBlocks: number }
  ms: number
}

// ───────────────────────────── état d'un stuff ─────────────────────────────

/** Objets par position (`STUFF_POSITIONS`, 0 = vide) et hôtes préférés des exos (−1 = automatique). */
interface State {
  ids: Int32Array
  hosts: Int8Array
}

const N_POS = STUFF_POSITIONS.length

function cloneState(s: State): State {
  return { ids: s.ids.slice(), hosts: s.hosts.slice() }
}

function stateKey(s: State): string {
  return `${Array.from(s.ids).join(',')}|${Array.from(s.hosts).join(',')}`
}

/** Clé indépendante de l'ordre des anneaux et des Dofus (doublons de recherche). */
function canonicalKey(s: State): string {
  const ids = Array.from(s.ids)
  const rings = [ids[1], ids[2]].sort((a, b) => a - b)
  const dofus = ids.slice(10).sort((a, b) => a - b)
  return [ids[0], ...rings, ...ids.slice(3, 10), ...dofus].join(',')
}

/** Positions d'un emplacement. */
const POSITIONS_OF: Readonly<Record<EquipmentSlot, number[]>> = (() => {
  const out = {} as Record<EquipmentSlot, number[]>
  STUFF_POSITIONS.forEach((slot, i) => (out[slot] ??= []).push(i))
  out.other = []
  return out
})()

/** Range une liste d'objets dans les positions (première position libre de leur emplacement). */
function stateFromItems(data: GameDataStore, items: readonly EquippedItem[]): State {
  const ids = new Int32Array(N_POS)
  for (const eq of items) {
    const it = data.item(eq.itemId)
    if (!it) continue
    const pos = POSITIONS_OF[it.slot]?.find(p => ids[p] === 0)
    if (pos !== undefined) ids[pos] = it.id
  }
  return { ids, hosts: new Int8Array(EXO_STATS.length).fill(-1) }
}

// ───────────────────────────── évaluateur ─────────────────────────────

interface Evaluated {
  state: State
  logJ: number
  score?: ProxyScore
  stats?: Stats
  maxHp?: number
  forge?: ForgePlan
  build?: CharacterBuild
}

/**
 * L'objet porte-t-il un plafond de caractéristique (effet 2897), sur ses lignes OU dans un palier de sa panoplie
 * (ex. Malédiction de Cire Momore, 6 objets : PM/PO/invocations max 2) ? Ces plafonds ne sont appliqués que par
 * `computeBuildStats` : le chemin rapide de la forgemagie ne les connaît pas.
 */
function carriesStatCap(data: GameDataStore, item: ItemData, cache: WeakMap<ItemData, boolean>): boolean {
  let v = cache.get(item)
  if (v === undefined) {
    v = item.effects.some(e => e.effectId === EFFECT_STAT_CAP)
    if (!v && item.setId !== null) {
      const set = data.itemSet(item.setId)
      if (set) v = Object.values(set.bonuses).some(lines => lines.some(l => l.effectId === EFFECT_STAT_CAP))
    }
    cache.set(item, v)
  }
  return v
}

class Evaluator {
  readonly memo = new Map<string, Evaluated>()
  /** Meilleurs builds distincts (clé canonique), pour la re-notation exacte. */
  readonly hall = new Map<string, Evaluated>()
  readonly forge: ForgePlanner
  private readonly capCache = new WeakMap<ItemData, boolean>()

  constructor(
    readonly data: GameDataStore,
    readonly ctx: ProxyContext,
    readonly base: CharacterBuild,
    readonly profile: ForgeProfile,
    readonly hallSize: number,
  ) {
    this.forge = new ForgePlanner({ profile, weights: ctx.statWeights(), rangeCap: 6 })
  }

  items(s: State): (ItemData | null)[] {
    return Array.from(s.ids, id => (id ? (this.data.item(id) ?? null) : null))
  }

  build(s: State, forge: ForgePlan | null, points = this.base.characteristicPoints): CharacterBuild {
    const items: EquippedItem[] = []
    s.ids.forEach((id, i) => {
      if (!id) return
      const lines = forge?.lines[i]
      items.push(lines && lines.length ? { itemId: id, exos: lines.map(l => ({ ...l })) } : { itemId: id })
    })
    return { ...this.base, characteristicPoints: { ...points }, items }
  }

  evaluate(s: State, points?: CharacterBuild['characteristicPoints']): Evaluated {
    const key = points ? `${stateKey(s)}|${JSON.stringify(points)}` : stateKey(s)
    const hit = this.memo.get(key)
    if (hit) return hit
    const out = this.compute(s, points)
    if (this.memo.size > 200_000) this.memo.clear()
    this.memo.set(key, out)
    if (!points && out.logJ > -Infinity) this.remember(out)
    return out
  }

  private compute(s: State, points?: CharacterBuild['characteristicPoints']): Evaluated {
    const bare = this.build(s, null, points)
    const r0 = computeBuildStats(bare, this.data)
    let forge: ForgePlan | null = null
    let build = bare
    let r = r0
    if (this.profile !== 'none') {
      const hosts: Partial<Record<ExoStat, number>> = {}
      EXO_STATS.forEach((st, i) => {
        if (s.hosts[i] >= 0) hosts[st] = s.hosts[i]
      })
      const items = this.items(s)
      // Un PA/PM/PO déjà au-delà de son plafond EFFECTIF (plafond 2897 d'un objet ou d'une panoplie, sous 12/6/6) :
      // l'exo serait perdu, il n'est pas posé (la ligne de forgemagie sert alors à une transcendance).
      let planStats = r0.stats
      if (r0.wasted.ap || r0.wasted.mp || r0.wasted.range) {
        planStats = copyStats(r0.stats)
        if (r0.wasted.ap) planStats.ap = Number.MAX_SAFE_INTEGER
        if (r0.wasted.mp) planStats.mp = Number.MAX_SAFE_INTEGER
        if (r0.wasted.range) planStats.range = Number.MAX_SAFE_INTEGER
      }
      forge = this.forge.plan(items, planStats, hosts)
      if (forge.lines.some(l => l.length)) {
        build = this.build(s, forge, points)
        if (!r0.valid || items.some(it => it !== null && carriesStatCap(this.data, it, this.capCache))) {
          // Plafonds 2897 (objet ou panoplie) : recalcul complet par src/stats.
          r = computeBuildStats(build, this.data)
        } else {
          // Chemin rapide (≈ 10× moins cher que le chemin « forgemagie » de computeBuildStats) : lignes ajoutées aux
          // sommes brutes puis finalisation ; exos et runes conformes par construction ; conditions des objets
          // ré-évaluées sur les nouvelles sommes (mêmes règles que computeBuildStats).
          const raw = copyStats(r0.raw)
          for (const lines of forge.lines) for (const l of lines) raw[l.stat] += l.value
          const fin = finalizeStats(raw, { level: statLevel(this.base.level), breedId: this.base.breedId })
          let valid = true
          const cctx: CriterionContext = { raw, base: r0.base, additional: r0.additional, level: this.base.level, breedId: this.base.breedId, setBonusCount: r0.setBonusCount }
          for (const it of items) {
            if (!it?.conditions) continue
            try {
              if (!evaluateCriterion(parseCriterion(it.conditions), cctx)) {
                valid = false
                break
              }
            } catch {
              // condition illisible : supposée vraie (comme computeBuildStats)
            }
          }
          r = { ...r0, stats: fin.stats, raw, maxHp: fin.maxHp, valid }
        }
        if (!r.valid && r0.valid) {
          // La forgemagie casse une condition (ex. « PA < 12 ») : stuff sans forgemagie.
          forge = null
          build = bare
          r = r0
        }
      }
    }
    if (!r.valid) return { state: cloneState(s), logJ: -Infinity }
    const score = this.ctx.surrogate(r.stats, r.maxHp)
    return { state: cloneState(s), logJ: score.logJ, score, stats: r.stats, maxHp: r.maxHp, forge: forge ?? undefined, build }
  }

  private remember(e: Evaluated): void {
    const k = canonicalKey(e.state)
    const prev = this.hall.get(k)
    if (prev && prev.logJ >= e.logJ) return
    this.hall.set(k, e)
    if (this.hall.size > this.hallSize * 4) {
      const keep = [...this.hall.entries()].sort((a, b) => b[1].logJ - a[1].logJ || (a[0] < b[0] ? -1 : 1)).slice(0, this.hallSize * 2)
      this.hall.clear()
      for (const [kk, v] of keep) this.hall.set(kk, v)
    }
  }
}

// ───────────────────────────── recherche ─────────────────────────────

function coordinateAscent(ev: Evaluator, pools: StuffPools, start: State, sweeps: number): Evaluated {
  const s = cloneState(start)
  let cur = ev.evaluate(s)
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let improved = false
    for (let pos = 0; pos < N_POS; pos++) {
      const slot = STUFF_POSITIONS[pos]
      const keep = s.ids[pos]
      let bestId = keep
      let best = cur
      const candidates = [0, ...pools.bySlot[slot].map(p => p.item.id)]
      for (const id of candidates) {
        if (id === keep) continue
        s.ids[pos] = id
        const e = ev.evaluate(s)
        if (e.logJ > best.logJ + 1e-12) {
          best = e
          bestId = id
        }
      }
      s.ids[pos] = bestId
      if (bestId !== keep) {
        cur = best
        improved = true
      }
    }
    if (!improved) break
  }
  return cur
}

function annealing(ev: Evaluator, pools: StuffPools, start: Evaluated, iterations: number, seed: number, t0: number, t1: number): Evaluated {
  const rng = new Rng(seed)
  let cur = start
  let best = start
  const s = cloneState(start.state)
  const lnRatio = detLog(t1 / t0)
  const slotLists = STUFF_POSITIONS.map(slot => pools.bySlot[slot].map(p => p.item.id))
  const dofusPositions = POSITIONS_OF.dofus
  for (let it = 0; it < iterations; it++) {
    const T = t0 * detExp((lnRatio * it) / Math.max(1, iterations))
    const prevIds = s.ids.slice()
    const prevHosts = s.hosts.slice()
    const u = rng.next()
    if (u < 0.6) {
      // Changer un objet.
      const pos = rng.int(0, N_POS - 1)
      const list = slotLists[pos]
      s.ids[pos] = rng.chance(0.05) || !list.length ? 0 : list[rng.int(0, list.length - 1)]
    } else if (u < 0.75 && pools.setBlocks.length) {
      // Poser (ou retirer) un bloc de panoplie.
      const block = pools.setBlocks[rng.int(0, pools.setBlocks.length - 1)]
      const present = block.items.filter(id => s.ids.includes(id))
      if (present.length === block.items.length && rng.chance(0.5)) {
        for (let p = 0; p < N_POS; p++) if (block.items.includes(s.ids[p])) s.ids[p] = 0
      } else {
        const used = new Set<number>()
        for (const id of block.items) {
          const item = ev.data.item(id)
          if (!item) continue
          const positions = POSITIONS_OF[item.slot]
          if (s.ids.includes(id)) {
            used.add(s.ids.indexOf(id))
            continue
          }
          const pos = positions.find(p => !used.has(p) && !block.items.includes(s.ids[p])) ?? positions[0]
          s.ids[pos] = id
          used.add(pos)
        }
      }
    } else if (u < 0.88) {
      // Échanger un Dofus/trophée.
      const pos = dofusPositions[rng.int(0, dofusPositions.length - 1)]
      const list = slotLists[pos]
      if (list.length) s.ids[pos] = list[rng.int(0, list.length - 1)]
    } else {
      // Déplacer un exo PA/PM/PO.
      const k = rng.int(0, EXO_STATS.length - 1)
      s.hosts[k] = rng.chance(0.2) ? -1 : rng.int(0, N_POS - 1)
    }
    const e = ev.evaluate(s)
    const delta = e.logJ - cur.logJ
    if (e.logJ > -Infinity && (delta >= 0 || rng.next() < detExp(delta / T))) {
      cur = e
      if (e.logJ > best.logJ + 1e-12) best = e
    } else {
      s.ids.set(prevIds)
      s.hosts.set(prevHosts)
    }
  }
  return best
}

/** Stuff glouton : meilleur objet (valeur linéaire) par position, sans doublon de Dofus. */
function greedyState(pools: StuffPools): State {
  const ids = new Int32Array(N_POS)
  const used = new Set<number>()
  STUFF_POSITIONS.forEach((slot, pos) => {
    const p = pools.bySlot[slot].find(x => !(used.has(x.item.id) && (slot === 'dofus' || x.item.setId !== null)))
    if (p) {
      ids[pos] = p.item.id
      used.add(p.item.id)
    }
  })
  return { ids, hosts: new Int8Array(EXO_STATS.length).fill(-1) }
}

/**
 * Front diversifié : candidats non dominés en (DPT, EHP, UTIL), un seul par profil (DPT, EHP, UTIL arrondis : deux
 * stuffs aux profils identiques n'apportent rien à la validation par combats), complété par les meilleurs restants.
 */
function paretoFront(cands: StuffCandidate[], k: number): StuffCandidate[] {
  const sig = (s: ProxyScore) => `${Math.round(s.dpt)}|${Math.round(s.ehp)}|${Math.round(s.util * 1000)}`
  const seen = new Set<string>()
  const unique = cands.filter(c => {
    const key = sig(c.score)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const dominated = (a: ProxyScore, b: ProxyScore) =>
    b.dpt >= a.dpt && b.ehp >= a.ehp && b.util >= a.util && (b.dpt > a.dpt || b.ehp > a.ehp || b.util > a.util)
  const front = unique.filter(c => !unique.some(o => o !== c && dominated(c.score, o.score)))
  const out = front.slice(0, k)
  for (const c of unique) {
    if (out.length >= k) break
    if (!out.includes(c)) out.push(c)
  }
  return out
}

/** Élément principal d'un membre (preset, sinon caractéristique élémentaire la plus haute du build). */
function memberElement(member: MemberSpec, stats: Stats, forced?: ProxyElement): ProxyElement {
  if (forced) return forced
  const p = findPreset(member.presetId)
  if (p) return p.element
  const entries: [ProxyElement, number][] = (Object.keys(ELEMENT_STAT) as ProxyElement[]).map(e => [e, stats[ELEMENT_STAT[e]]])
  entries.sort((a, b) => b[1] - a[1])
  return entries[0][0]
}

/** Optimise le stuff d'un membre (voir l'en-tête). */
export function optimizeStuff(data: GameDataStore, member: MemberSpec, opts: StuffSearchOptions = {}): StuffResult {
  const t0 = performance.now()
  const preset = findPreset(member.presetId)
  const role: RoleId = opts.role ?? member.role ?? preset?.role ?? 'killer'
  const ref = computeBuildStats(member.build, data)
  const element = memberElement(member, ref.stats, opts.element)
  const primary = ELEMENT_STAT[element] as PrimaryStat
  const variants = member.variants.length ? member.variants : (member.build.spellVariants ?? [])
  const ctx = createProxyContext(data, { breedId: member.breedId, level: member.build.level, variants, role, presetId: member.presetId, element, name: member.name }, ref, opts.proxy)
  const startItems = member.build.items.map(i => i.itemId)
  const pools = buildPools(data, ctx, {
    level: member.build.level,
    minLevel: opts.minLevel,
    perSlot: opts.perSlot,
    dofusPool: opts.dofusPool,
    passivePolicy: opts.passivePolicy,
    include: startItems,
    reference: member.build,
  })
  const profile = opts.profile ?? 'thlOptimized'
  const topExact = opts.topExact ?? 50
  const ev = new Evaluator(data, ctx, { ...member.build, spellVariants: variants.slice() }, profile, topExact)

  // Graines : stuff de départ, stuffs méta, glouton.
  const seeds: State[] = [stateFromItems(data, member.build.items)]
  for (const id of Object.keys(STUFFS).sort()) seeds.push(stateFromItems(data, STUFFS[id].items))
  seeds.push(greedyState(pools))
  let best: Evaluated | undefined
  for (const seed of seeds) {
    const e = coordinateAscent(ev, pools, seed, opts.sweeps ?? 6)
    if (!best || e.logJ > best.logJ + 1e-12) best = e
  }
  if (best && (opts.iterations ?? 20_000) > 0) {
    best = annealing(ev, pools, best, opts.iterations ?? 20_000, opts.seed ?? 1, opts.t0 ?? 0.05, opts.t1 ?? 0.0005)
    best = coordinateAscent(ev, pools, best.state, 2)
  }

  // Re-notation exacte des meilleurs builds distincts.
  const passiveIds = new Set<number>()
  for (const slot of Object.keys(pools.bySlot) as EquipmentSlot[]) for (const p of pools.bySlot[slot]) if (p.passive) passiveIds.add(p.item.id)
  // Re-notation (§15.4 point 4 : « computeBuildStats sur les 50 meilleurs ») : les caractéristiques du build RENDU sont
  // recalculées par src/stats (garde-fou du chemin rapide de la forgemagie) ; un build que src/stats refuse est écarté.
  const toCandidate = (e: Evaluated, pointsId: string): StuffCandidate | undefined => {
    const build = e.build!
    const full = computeBuildStats(build, data)
    if (!full.valid) return undefined
    const exact = ctx.exact(full.stats, full.maxHp)
    return {
      build,
      score: exact,
      surrogate: ctx.surrogate(full.stats, full.maxHp),
      key: `${canonicalKey(e.state)}|${pointsId}`,
      forge: e.forge ?? { lines: [], exos: {}, transcendences: [] },
      pointsId,
      passiveItems: build.items.map(i => i.itemId).filter(id => passiveIds.has(id)),
    }
  }
  const top = [...ev.hall.values()].sort((a, b) => b.logJ - a.logJ || (canonicalKey(a.state) < canonicalKey(b.state) ? -1 : 1)).slice(0, topExact)
  const isCand = (c: StuffCandidate | undefined): c is StuffCandidate => c !== undefined
  let cands = top.map(e => toCandidate(e, 'start')).filter(isCand)

  // Répartitions de points sur les 5 meilleurs (notées exactement).
  if (opts.points ?? true) {
    const breed = data.breed(member.breedId)
    const presetPts = preset ? presetPoints(preset, data, member.build.level) : undefined
    const options: PointsOption[] = pointsOptions(breed, member.build.level, primary, role, presetPts)
    const sorted = cands.slice().sort((a, b) => b.score.logJ - a.score.logJ)
    for (const c of sorted.slice(0, 5)) {
      const state = top.find(e => `${canonicalKey(e.state)}|start` === c.key)!.state
      for (const o of options) {
        const e = ev.evaluate(state, o.points)
        if (e.logJ === -Infinity) continue
        const cand = toCandidate(e, o.id)
        if (cand) cands.push(cand)
      }
    }
  }
  cands.sort((a, b) => b.score.logJ - a.score.logJ || (a.key < b.key ? -1 : 1))
  // Doublons (même stuff et mêmes points) : garder le premier.
  const seen = new Set<string>()
  cands = cands.filter(c => {
    const k = `${c.key.split('|')[0]}|${JSON.stringify(c.build.characteristicPoints)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const startScore = computeBuildStats(member.build, data)
  const startExact = ctx.exact(startScore.stats, startScore.maxHp)
  const startCand: StuffCandidate = {
    build: member.build,
    score: startExact,
    surrogate: ctx.surrogate(startScore.stats, startScore.maxHp),
    key: 'start',
    forge: { lines: [], exos: {}, transcendences: [] },
    pointsId: 'start',
    passiveItems: member.build.items.map(i => i.itemId).filter(id => passiveIds.has(id) || data.item(id)?.effects.some(e => e.effectId === 1175)),
  }
  const bestCand = cands.length && cands[0].score.logJ > startExact.logJ ? cands[0] : startCand
  const front = paretoFront(cands.length ? cands : [startCand], opts.diversity ?? 5)
  if (!front.includes(bestCand)) front.unshift(bestCand)
  return {
    member: member.name,
    role,
    element,
    start: startCand,
    best: bestCand,
    front: front.slice(0, opts.diversity ?? 5),
    evaluations: { surrogate: ctx.surrogateCalls, exact: ctx.exactCalls },
    pools: { examined: pools.examined, kept: Object.values(pools.bySlot).reduce((a, l) => a + l.length, 0), setBlocks: pools.setBlocks.length },
    ms: performance.now() - t0,
  }
}

/**
 * Évaluation d'un stuff telle que la recherche la voit (objets rangés par position, forgemagie planifiée par
 * `ForgePlanner`, caractéristiques par le chemin rapide quand il s'applique) : build forgé, caractéristiques, PV max,
 * logJ de la forme fermée (−∞ si invalide). Sert aux tests de cohérence avec `computeBuildStats` et aux outils.
 */
export function evaluateStuff(data: GameDataStore, ctx: ProxyContext, build: CharacterBuild, profile: ForgeProfile = 'thlOptimized'): { build: CharacterBuild; stats?: Stats; maxHp?: number; logJ: number } {
  const ev = new Evaluator(data, ctx, build, profile, 1)
  const e = ev.evaluate(stateFromItems(data, build.items))
  return { build: e.build ?? ev.build(e.state, null), stats: e.stats, maxHp: e.maxHp, logJ: e.logJ }
}

/** Membre avec un autre build (variantes conservées). */
export function withBuild(member: MemberSpec, build: CharacterBuild): MemberSpec {
  return { ...member, build: { ...build, spellVariants: member.build.spellVariants?.slice() ?? build.spellVariants } }
}

/** Valeur linéaire d'un objet pour un contexte (outils, rapports). */
export function itemLinearValue(ctx: ProxyContext, item: ItemData): number {
  return linearValue(itemStatDelta(item), ctx.statWeights())
}
