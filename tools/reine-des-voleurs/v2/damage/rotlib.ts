// Rotations par tour (12 PA) d'UN Crâ contre UNE cible, mesurées dans le moteur.
// 1. Estimation par sort : valeur par lancer au régime établi (banc moteur, sort seul au rythme max), dans deux
//    contextes : sans buff, et sous Tirs Puissants (Puissance +250, CC +15, PO −3 : caractéristiques modifiées).
//    Un sort hors de portée à cette géométrie (PO min/max, ligne, PO −3 de Tirs Puissants) vaut 0 (refus du moteur).
// 2. Énumération exhaustive des tours possibles (multiensembles de lancers, PA ≤ budget, lancers/tour et /cible, une
//    seule variante par paire), les N meilleurs par estimation ; cycle de 2 tours (relance 2 de Tirs Puissants et
//    d'Expiation : A avec Tirs Puissants, B sans ; Expiation dans un seul des deux).
// 3. Vérification MOTEUR des meilleures paires (A, B) (+ Tir Perçant s'il reste 1 PA) : cycle joué 12 tours, mesure sur
//    les tours 5-12 ; on garde la meilleure mesurée. Persécutrice : le moteur fait partir le 2e coup même en ligne de
//    vue (écart connu, README §3 ch. 7) ; mode « visible » = 2e coup retiré, mode « caché » = 2e coup compté.
import { ALL_SPELLS, CRA, PAIRS, bench, calcSpell, isOffensive, lvlOf, nameOf, type Geom, type Step, type TargetSpec, type TurnPlan } from './lib'
import type { Stats } from '../../../../src/core/types'

export const TP = 32466, EXPI = 32438, PERSE = 32433, TPERC = 32471, REPR = 32472, SENT = 32475, DEVO = 32446, PLUIE = 32431, FULMI = 32450
/** Sorts jamais lancés comme dégâts dans les rotations (piège, % PV érodés). */
const NOT_DAMAGE = new Set([32473, REPR])

export interface Est { spell: number; cost: number; value: number; max: number }
export type Extra = Partial<Record<keyof Stats, number>>
const extraKey = (e?: Extra) => (e ? Object.entries(e).sort().map(([k, v]) => `${k}${v}`).join(',') : '')
export function withExtra(base: Stats, e?: Extra): Stats {
  const s = { ...base } as Stats
  if (e) for (const [k, v] of Object.entries(e)) (s as unknown as Record<string, number>)[k] = ((s as unknown as Record<string, number>)[k] ?? 0) + (v as number)
  return s
}

const estCache = new Map<string, Est[]>()
/**
 * Valeurs MARGINALES par lancer (régime établi, sort seul) : k-ième lancer du tour = DPT(k lancers/tour) − DPT(k−1)
 * (Tyrannique : le 2e lancer remplace le poison du 1er ; rampes 293…). Liste vide si le sort ne peut pas être lancé à
 * cette géométrie. Sort à relance ≥ 2 : un seul élément (valeur par lancer).
 */
export function estimate(spell: number, t: TargetSpec, g: Geom, tp: boolean, mpUsed: number, persMode: 'visible' | 'cache', extra?: Extra): Est[] {
  const key = `${spell}|${t.id}|${g.dx},${g.dy}|${tp}|${mpUsed}|${persMode}|${extraKey(extra)}`
  if (estCache.has(key)) return estCache.get(key)!
  const lv = lvlOf(spell)
  const base = withExtra(CRA, extra)
  const stats: Stats = tp ? { ...base, power: base.power + 250, critical: base.critical + 15, range: base.range - 3 } : base
  const n = Math.max(1, Math.min(lv.maxCastPerTurn || 6, lv.maxCastPerTarget || 6, lv.maxGlobalCastPerTurn || 6))
  const res: Est[] = []
  let prev = 0
  for (let k = 1; k <= n; k++) {
    const r = bench([Array.from({ length: k }, () => ({ spell }))], t, g, {
      stats, turns: 12, warm: 5, apOverride: 99,
      onTurnStart: (_f, c) => { c.mp = CRA.mp - mpUsed },
    })
    const casts = r.casts.get(spell) ?? 0
    if (lv.minCastInterval >= 2) {
      if (casts > 0.01) res.push({ spell, cost: lv.apCost, value: r.mean / casts, max: 1 })
      break
    }
    if (casts < k - 0.01) break
    let value = r.mean - prev
    if (spell === PERSE && persMode === 'visible') value = persImmediate(t, stats)
    res.push({ spell, cost: lv.apCost, value, max: 1 })
    prev = r.mean
  }
  estCache.set(key, res)
  return res
}
/** 1er coup de Persécutrice seul (vol de vie Air, immédiat) : calculateur. */
export function persImmediate(t: TargetSpec, stats: Stats = CRA): number {
  return calcSpell(PERSE, t, { stats }).immediate
}
const persSecondCache = new Map<string, number>()
/** 2e coup (différé) de Persécutrice tel que le moteur le compte. */
export function persSecond(t: TargetSpec, g: Geom, mpUsed: number, extra?: Extra): number {
  const k = `${t.id}|${g.dx},${g.dy}|${mpUsed}|${extraKey(extra)}`
  if (!persSecondCache.has(k)) {
    const stats = withExtra(CRA, extra)
    const r = bench([[{ spell: PERSE }]], t, g, { stats, turns: 1, warm: 0, apOverride: 99, onTurnStart: (_f, c) => { c.mp = CRA.mp - mpUsed } })
    persSecondCache.set(k, Math.max(0, r.perTurn[0] - persImmediate(t, stats)))
  }
  return persSecondCache.get(k)!
}

/** Paire (0..21) de chaque sort du Crâ. */
export const PAIR_OF = new Map<number, number>(PAIRS.flatMap(([a, b], i) => [[a, i], [b, i]] as [number, number][]))
/** Vrai si la liste utilise les deux variantes d'une même paire. */
export function pairClash(spells: number[]): boolean {
  const m = new Map<number, number>()
  for (const s of spells) {
    const k = PAIR_OF.get(s)
    if (k === undefined) continue
    if (m.has(k) && m.get(k) !== s) return true
    m.set(k, s)
  }
  return false
}
export interface Plan { casts: number[]; est: number; ap: number }
/** Les `top` meilleurs multiensembles de lancers (estimation) dans `budget` PA. */
export function topPlans(items: Est[], budget: number, top: number): Plan[] {
  const its = items.filter(i => i.value > 0).sort((a, b) => b.value / b.cost - a.value / a.cost)
  const best: Plan[] = []
  let floor = -Infinity
  const cur: number[] = []
  const used = new Map<number, number>()
  const rec = (k: number, ap: number, val: number) => {
    let ub = val, left = ap
    for (let j = k; j < its.length && left > 0; j++) {
      const take = Math.min(its[j].max, Math.floor(left / its[j].cost))
      ub += take * its[j].value
      left -= take * its[j].cost
      if (take < its[j].max && left > 0) { ub += (left / its[j].cost) * its[j].value; left = 0 }
    }
    if (best.length >= top && ub <= floor + 1e-9) return
    if (k === its.length) {
      const key = cur.slice().sort().join(',')
      const dup = best.findIndex(b => b.casts.slice().sort().join(',') === key)
      if (dup >= 0) { if (best[dup].est >= val) return; best.splice(dup, 1) }
      best.push({ casts: cur.slice(), est: val, ap: budget - ap })
      best.sort((a, b) => b.est - a.est)
      if (best.length > top) best.length = top
      floor = best.length >= top ? best[best.length - 1].est : -Infinity
      return
    }
    const it = its[k]
    const pk = PAIR_OF.get(it.spell)
    const clash = pk !== undefined && used.has(pk) && used.get(pk) !== it.spell
    const maxTake = clash ? 0 : Math.min(it.max, Math.floor(ap / it.cost))
    for (let m = maxTake; m >= 0; m--) {
      const had = pk !== undefined ? used.get(pk) : undefined
      if (m > 0 && pk !== undefined) used.set(pk, it.spell)
      for (let q = 0; q < m; q++) cur.push(it.spell)
      rec(k + 1, ap - m * it.cost, val + m * it.value)
      for (let q = 0; q < m; q++) cur.pop()
      if (m > 0 && pk !== undefined) { if (had === undefined) used.delete(pk); else used.set(pk, had) }
    }
  }
  rec(0, budget, 0)
  return best
}

export interface CycleResult {
  dpt: number
  turnA: number[]
  turnB: number[]
  perTurn: number[]
  tp: boolean
  est: number
  label: string
  /** Lancers par tour (moyenne du cycle) de chaque sort. */
  casts: Map<number, number>
}

/** Ordre des lancers d'un tour : Tirs Puissants, Tir Perçant, puis plus gros coups d'abord. */
export function order(casts: number[], vals: Map<number, number>, tirPercant: boolean, tp: boolean): TurnPlan {
  const sorted = casts.slice().sort((a, b) => (vals.get(b) ?? 0) - (vals.get(a) ?? 0))
  const steps: Step[] = []
  if (tp) steps.push({ spell: TP, on: 'self' })
  if (tirPercant) steps.push({ spell: TPERC })
  for (const s of sorted) steps.push({ spell: s })
  return steps
}

export interface RotOpts {
  /** Sorts disponibles (variantes et sorts permis) ; défaut : tous. */
  allowed?: Set<number>
  mpUsed?: number
  persMode?: 'visible' | 'cache'
  /** PA de ce tour (défaut 12). */
  ap?: number
  topN?: number
  verify?: number
  /** Lancers PAR TOUR maximum imposés à ce Crâ (limites d'équipe : Dévorante 4, Pluie 2, Fulminante 1…). */
  caps?: Map<number, number>
  /** Caractéristiques ajoutées (Balise Tactique : Puissance ; Sentinelle : % distance…). */
  extra?: Extra
}

const cycleCache = new Map<string, CycleResult>()
/** Meilleur cycle de 2 tours contre `t` à la géométrie `g`, vérifié au moteur. */
export function bestCycle(t: TargetSpec, g: Geom, o: RotOpts = {}): CycleResult {
  const allowedSet = o.allowed ?? new Set<number>(ALL_SPELLS)
  const ck = `${t.id}|${g.dx},${g.dy}|${[...allowedSet].sort().join(',')}|${o.mpUsed ?? 0}|${o.persMode ?? 'visible'}|${o.ap ?? 12}|${o.caps ? [...o.caps].join(';') : ''}|${extraKey(o.extra)}|${o.topN ?? 30}|${o.verify ?? 40}`
  if (cycleCache.has(ck)) return cycleCache.get(ck)!
  const pool = [...allowedSet].filter(s => isOffensive(s) && !NOT_DAMAGE.has(s))
  const mpUsed = o.mpUsed ?? 0
  const pm = o.persMode ?? 'visible'
  const ap = o.ap ?? CRA.ap
  const topN = o.topN ?? 30
  const nVerify = o.verify ?? 40
  const hasTP = allowedSet.has(TP)
  const hasTPerc = allowedSet.has(TPERC)
  const ests = (tp: boolean) =>
    pool
      .flatMap(s => {
        const xs = estimate(s, t, g, tp, mpUsed, pm, o.extra)
        const cap = o.caps?.get(s)
        return cap !== undefined ? xs.slice(0, cap) : xs
      })
  const plain = ests(false)
  const withTP = hasTP ? ests(true) : []
  const vals = new Map<number, number>()
  for (const e of plain) if (!vals.has(e.spell)) vals.set(e.spell, e.value)
  const candidates: { A: Plan; B: Plan; tp: boolean; est: number }[] = []
  const combos = (aItems: Est[], aBudget: number, bItems: Est[], tp: boolean) => {
    const As = topPlans(aItems, aBudget, topN)
    const Bs = topPlans(bItems, ap, topN)
    for (const A of As) for (const B of Bs) {
      if (A.casts.includes(EXPI) && B.casts.includes(EXPI)) continue
      if (pairClash([...A.casts, ...B.casts])) continue
      candidates.push({ A, B, tp, est: (A.est + B.est) / 2 })
    }
    // Tour B compatible avec chaque A (mêmes variantes, Expiation pas deux fois) : garantit des candidats.
    for (const A of As.slice(0, 10)) {
      const pairsA = new Map(A.casts.map(s => [PAIR_OF.get(s), s]))
      const okB = bItems.filter(x => !(x.spell === EXPI && A.casts.includes(EXPI)) && !(pairsA.has(PAIR_OF.get(x.spell)) && pairsA.get(PAIR_OF.get(x.spell)) !== x.spell))
      for (const B of topPlans(okB, ap, 3)) candidates.push({ A, B, tp, est: (A.est + B.est) / 2 })
    }
  }
  combos(plain, ap, plain, false)
  if (hasTP) combos(withTP, ap - 1, plain, true)
  candidates.sort((x, y) => y.est - x.est)
  const seen = new Set<string>()
  const pick: typeof candidates = []
  for (const c of candidates) {
    const k = c.tp ? `T|${c.A.casts.join(',')}|${c.B.casts.join(',')}` : [c.A.casts.join(','), c.B.casts.join(',')].sort().join('|')
    if (seen.has(k)) continue
    seen.add(k)
    pick.push(c)
    if (pick.length >= nVerify) break
  }
  const stats = withExtra(CRA, o.extra)
  let best: CycleResult | undefined
  for (const c of pick) {
    for (const tpc of hasTPerc ? [false, true] : [false]) {
      const fitA = c.A.ap + 1 <= (c.tp ? ap - 1 : ap), fitB = c.B.ap + 1 <= ap
      if (tpc && !fitA && !fitB) continue
      const A = order(c.A.casts, vals, tpc && fitA, c.tp)
      const B = order(c.B.casts, vals, tpc && fitB, false)
      const r = bench([A, B], t, g, { stats, turns: 12, warm: 4, onTurnStart: (_f, cr) => { cr.ap = ap; cr.mp = CRA.mp - mpUsed } })
      let dpt = r.mean
      const nP = r.casts.get(PERSE) ?? 0
      if (pm === 'visible' && nP > 0) dpt -= nP * persSecond(t, g, mpUsed, o.extra)
      const label = `${c.tp ? 'A: Tirs Puissants + ' : 'A: '}${A.filter(s => s.spell !== TP).map(s => nameOf(s.spell)).join(' + ')} | B: ${B.map(s => nameOf(s.spell)).join(' + ')}`
      if (!best || dpt > best.dpt) best = { dpt, turnA: A.map(s => s.spell), turnB: B.map(s => s.spell), perTurn: r.perTurn, tp: c.tp, est: c.est, label, casts: r.casts }
    }
  }
  const res = best ?? { dpt: 0, turnA: [], turnB: [], perTurn: [], tp: false, est: 0, label: '—', casts: new Map() }
  cycleCache.set(ck, res)
  return res
}
