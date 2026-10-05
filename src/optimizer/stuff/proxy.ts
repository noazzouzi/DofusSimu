/**
 * Proxy analytique d'un stuff (niveau L3, docs/design/ai.md §15.4 point 3) — WP4b.
 *
 *   J = DPT^a · EHP^b · (1 + c·UTIL) × pénalités        (classement en log : logJ = a·ln DPT + b·ln EHP + …)
 *
 *  - DPT : dégâts par tour contre le mix de cibles du scénario (Vortex : Ikargn 3, Méjaire 4, Harpille 4, Buboxor 3,
 *    Brabuzar 5, Vortex 0,3 × 19 — `VORTEX_TARGET_MIX`), sac à dos `DptTable` (src/ai/core/dpt.ts) × calibration du
 *    preset ;
 *  - EHP : PV × (dégâts reçus d'un personnage sans défense / dégâts reçus avec ses défenses), les dégâts reçus étant
 *    ceux des rotations des monstres du mix (DoMath, % résistances plafonnés à 50, résistances fixes, critiques,
 *    % résistances mêlée/distance et sorts) : la pondération des éléments reçus vient des sorts réels des monstres ;
 *  - UTIL : retrait PM/PA espéré (fraction des PM/PA de la cible de référence, `expectedApMpRemoved`), soins par tour
 *    (/1 500), tacle (tank), poussée (placeur), invocations ;
 *  - exposants (a, b, c) par rôle : killer/zoneDps 0,7/0,3/0 ; tank 0,2/0,8/0,2 ; mpLock/apLock 0,3/0,4/1 ; healer
 *    0,2/0,5/1 (placeur, soutien, invocateur : valeurs intermédiaires, non chiffrées par le design) ;
 *  - pénalités : ×0,85 par PA sous 12, ×0,9 par PM sous 6, ×0,95 par PO sous le besoin de la rotation (5 si un sort
 *    de la rotation a une portée modifiable ≥ 3, sinon 0) ; bonus d'initiative facultatif (`initiativeWeight`).
 *
 * Deux évaluations :
 *  - `exact(stats)` : vrais combattants (src/engine/factory) et `DptTable` sur chaque cible du mix (≈ 0,3-0,9 ms) —
 *    sert à re-noter les meilleurs candidats ;
 *  - `surrogate(stats)` : forme fermée (≈ 1-2 µs) des mêmes formules DoMath sans troncatures, rotations figées par PA
 *    (sac à dos calculé une fois au build de référence pour chaque nombre de PA, contre une cible SYNTHÉTIQUE aux
 *    résistances moyennes du mix) ; utilisée par la recherche locale et le recuit (corrélation vérifiée par
 *    tests/opt-stuff.test.ts). Les sorts passifs des objets (effet 1175) ne sont pas simulés par le moteur : ils sont
 *    ignorés ici aussi (cohérence avec les combats).
 */
import { critChance } from '../../damage/crit'
import { expectedApMpRemoved } from '../../damage/apmp'
import { heal } from '../../damage/heal'
import { createDptTable, castDamage, isMeleeSpell, lineDamage, spellCritPct, type DptTableImpl } from '../../ai/core/dpt'
import { calibrationOf } from '../../ai/core/dpt'
import { zoneHitsCenter } from '../../ai/core/dpt'
import { zoneRadius, type DamageLineX, type SpellProfileX } from '../../ai/core/spellProfile'
import type { RoleId } from '../../ai/types'
import { Element, ELEMENT_FIXED_DAMAGE, ELEMENT_MAIN_STAT, ELEMENT_RES_FIXED, ELEMENT_RES_PCT, type StatKey, type Stats } from '../../core/types'
import type { DataStore } from '../../data/store'
import { VORTEX_TARGET_MIX } from '../../dungeons/generic/dummy'
import { createEngine, type Engine } from '../../engine'
import { resolveElement } from '../../engine/effects/damage/pipeline'
import { createMonsterFighter, createPlayerFighter } from '../../engine/factory'
import { bumpRev } from '../../engine/rev'
import { matchesTargetMask } from '../../engine/targetMask'
import type { Fighter } from '../../engine/types'
import { copyStats } from '../../stats/fastStats'
import { RUNE_WEIGHT_PER_POINT } from '../../stats/forgemagie'
import { detLog } from './detmath'

// ───────────────────────────── paramètres ─────────────────────────────

export interface ProxyExponents {
  a: number
  b: number
  c: number
}

/** Exposants (a, b, c) de J par rôle (§15.4). */
export const ROLE_EXPONENTS: Readonly<Record<RoleId, ProxyExponents>> = {
  killer: { a: 0.7, b: 0.3, c: 0 },
  zoneDps: { a: 0.7, b: 0.3, c: 0 },
  tank: { a: 0.2, b: 0.8, c: 0.2 },
  mpLock: { a: 0.3, b: 0.4, c: 1 },
  apLock: { a: 0.3, b: 0.4, c: 1 },
  healer: { a: 0.2, b: 0.5, c: 1 },
  // Non chiffrés par le design : compromis documentés.
  placer: { a: 0.4, b: 0.5, c: 0.5 },
  support: { a: 0.3, b: 0.5, c: 1 },
  summoner: { a: 0.6, b: 0.4, c: 0.3 },
}

export type ProxyElement = 'earth' | 'fire' | 'water' | 'air'

/** Personnage évalué : classe, niveau, variantes de sorts, preset (calibration DPT), rôle, élément principal. */
export interface ProxyMember {
  breedId: number
  level: number
  variants: readonly (0 | 1)[]
  role: RoleId
  presetId?: string
  element?: ProxyElement
  name?: string
}

export interface ProxyTarget {
  monsterId: number
  weight: number
  grade?: number
}

export interface ProxyOptions {
  /** Mix de cibles (défaut : mix du Vortex, `VORTEX_TARGET_MIX`). */
  targets?: readonly ProxyTarget[]
  /** Grade des cibles sans grade explicite (défaut 5). */
  grade?: number
  exponents?: Partial<ProxyExponents>
  apTarget?: number
  mpTarget?: number
  /** PO voulue (défaut : 5 si la rotation a un sort à portée modifiable ≥ 3, sinon 0). */
  rangeNeed?: number
  /** Bonus d'initiative (équipe qui vise k = 4, §12.2) : × (1 + w·min(1, ini/5000)). Défaut 0. */
  initiativeWeight?: number
}

export interface ProxyScore {
  logJ: number
  /** J = e^logJ (lecture humaine ; le classement se fait sur logJ). */
  j: number
  dpt: number
  ehp: number
  util: number
  penalty: number
  /** Dégâts reçus par tour du mix (PVe). */
  incoming: number
  ap: number
  mp: number
  range: number
  maxHp: number
}

// ───────────────────────────── outils ─────────────────────────────

/** Caractéristique principale d'un élément de preset. */
export const ELEMENT_STAT: Readonly<Record<ProxyElement, StatKey>> = {
  earth: 'strength',
  fire: 'intelligence',
  water: 'chance',
  air: 'agility',
}

/** Clés de défense remises à zéro pour la référence « sans défense » de l'EHP. */
const DEFENSE_KEYS: readonly StatKey[] = [
  'neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct', 'neutralRes', 'earthRes', 'fireRes',
  'waterRes', 'airRes', 'criticalRes', 'meleeResPct', 'rangedResPct', 'spellResPct', 'weaponResPct',
]

/** Clés moyennées pour la cible synthétique du mix. */
const TARGET_KEYS: readonly StatKey[] = [...DEFENSE_KEYS, 'pushRes', 'apParry', 'mpParry', 'tackleBlock', 'tackleEvade']

const ELEMS: readonly Element[] = [Element.Neutral, Element.Earth, Element.Fire, Element.Water, Element.Air]

/** Plafonds hors combat appliqués à une somme de caractéristiques (PA 12, PM 6, PO 6, invocations 6). */
export function capStats(s: Stats, caps = { ap: 12, mp: 6, range: 6, summons: 6 }): Stats {
  if (s.ap > caps.ap) s.ap = caps.ap
  if (s.mp > caps.mp) s.mp = caps.mp
  if (s.range > caps.range) s.range = caps.range
  if (s.summons > caps.summons) s.summons = caps.summons
  return s
}

function weightedAverage(fighters: readonly Fighter[], weights: readonly number[], key: StatKey): number {
  let s = 0
  let w = 0
  fighters.forEach((f, i) => {
    s += weights[i] * (f.stats[key] ?? 0)
    w += weights[i]
  })
  return w > 0 ? s / w : 0
}

// ───────────────────────────── lignes de la forme fermée ─────────────────────────────

/** Ligne de dégâts d'une rotation (lanceur = personnage) : jets moyens, élément, poids (lancers × DoT/différé × p). */
interface OutLine {
  boosted: boolean
  element: Element
  baseN: number
  baseC: number
  /** Taux critique de base du sort (0 = ne critique pas). */
  critBase: number
  melee: boolean
  weight: number
  /** Valeur constante (familles non boostées) contre la cible synthétique. */
  constant: number
}

/** Ligne reçue (lanceur = monstre) : dégâts avant défense, normale et critique. */
interface InLine {
  boosted: boolean
  element: Element
  preN: number
  preC: number
  crit: number
  melee: boolean
  weight: number
  /** Multiplicateurs du lanceur (finaux × sorts × mêlée/distance). */
  mult: number
  constant: number
}

/** Rotation de soin / retrait d'un nombre de PA donné. */
interface UtilRotation {
  heals: { baseN: number; baseC: number; crit: number; element: Element; count: number }[]
  /** Points retirés tentés (esquivables) et sûrs, par réserve. */
  mpTry: number
  mpSure: number
  apTry: number
  apSure: number
}

const MAX_AP = 16

/** Lignes d'un lancer retenues par `castDamage` (centre ou couronne, la meilleure) contre `d`. */
function castLines(a: Fighter, d: Fighter, p: SpellProfileX, isWeapon: boolean): DamageLineX[] {
  const cd = castDamage(a, d, p, isWeapon, 1, isMeleeSpell(p))
  const useRing = (cd.ringMean ?? 0) > (cd.centerMean ?? 0)
  return p.damage.filter(line => {
    const ok = useRing ? zoneRadius(line.zone) > 0 : zoneHitsCenter(line.zone)
    if (!ok) return false
    if (!matchesTargetMask(line.mask, a, d)) return false
    if (line.gates && !line.gates.every(g => matchesTargetMask(g, a, d))) return false
    return true
  })
}

function lineWeight(line: DamageLineX): number {
  let w = line.p
  if (line.dotTurns > 0) w *= Math.min(line.dotTurns, 2) * 0.8
  else if (line.delayed > 0) w *= 0.8
  return w
}

const meanOf = (lo: number, hi: number): number => (lo + Math.max(lo, hi)) / 2

/** Lancers (multiensemble) d'une liste d'ids de sorts. */
function countCasts(casts: readonly number[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const id of casts) m.set(id, (m.get(id) ?? 0) + 1)
  return m
}

// ───────────────────────────── contexte ─────────────────────────────

const ENGINES = new WeakMap<DataStore, Engine>()

/** Moteur partagé par donnée (profils de sorts et tables DPT mis en cache). */
export function proxyEngine(data: DataStore): Engine {
  let e = ENGINES.get(data)
  if (!e) ENGINES.set(data, (e = createEngine(data)))
  return e
}

/**
 * Contexte d'évaluation d'un personnage (voir l'en-tête). Construit une fois par (classe, variantes, rôle, cibles) à
 * partir de caractéristiques de référence (stuff de départ) : rotations par PA, lignes reçues, poids des
 * caractéristiques. Ensuite `surrogate`/`exact` sont des fonctions pures des caractéristiques.
 */
export class ProxyContext {
  readonly engine: Engine
  readonly dptTable: DptTableImpl
  readonly exponents: ProxyExponents
  readonly rangeNeed: number
  readonly apTarget: number
  readonly mpTarget: number
  readonly initiativeWeight: number
  /** Cibles réelles du mix et leurs poids. */
  readonly targets: Fighter[]
  readonly weights: number[]
  /** Cible synthétique (résistances moyennes pondérées). */
  readonly mixTarget: Fighter
  /** Combattant du personnage (caractéristiques remplacées à chaque évaluation exacte). */
  readonly fighter: Fighter
  readonly calibration: number
  private readonly outByAp: OutLine[][] = []
  private readonly utilByAp: UtilRotation[] = []
  private readonly inLines: InLine[] = []
  private readonly inConstant: number
  private readonly inc0Surrogate: number
  private inc0Exact = -1
  private readonly targetMp: number
  private readonly targetAp: number
  private readonly removalMemo = new Map<number, number>()
  private weightsCache?: Partial<Record<StatKey, number>>
  /** Nombre d'évaluations (statistiques des recherches). */
  surrogateCalls = 0
  exactCalls = 0

  constructor(
    readonly data: DataStore,
    readonly member: ProxyMember,
    readonly refStats: Stats,
    readonly refMaxHp: number,
    opts: ProxyOptions = {},
  ) {
    this.engine = proxyEngine(data)
    this.dptTable = createDptTable(this.engine)
    this.exponents = { ...ROLE_EXPONENTS[member.role], ...opts.exponents }
    this.apTarget = opts.apTarget ?? 12
    this.mpTarget = opts.mpTarget ?? 6
    this.initiativeWeight = opts.initiativeWeight ?? 0
    const mix: readonly ProxyTarget[] = opts.targets ?? VORTEX_TARGET_MIX
    const grade = opts.grade ?? 5
    this.targets = mix.map((t, i) => {
      const f = createMonsterFighter(data, { monsterId: t.monsterId, grade: t.grade ?? grade, team: 1 })
      f.id = 1 + i
      f.tags.referenceTarget = true
      return f
    })
    this.weights = mix.map(t => t.weight)
    // Cible synthétique : premier monstre du mix, défenses et parades moyennées.
    const synth = createMonsterFighter(data, { monsterId: mix[0].monsterId, grade: mix[0].grade ?? grade, team: 1 })
    synth.id = 1 + mix.length
    synth.tags.referenceTarget = true
    for (const k of TARGET_KEYS) synth.stats[k] = weightedAverage(this.targets, this.weights, k)
    synth.stats.ap = Math.round(weightedAverage(this.targets, this.weights, 'ap'))
    synth.stats.mp = Math.round(weightedAverage(this.targets, this.weights, 'mp'))
    synth.ap = synth.stats.ap
    synth.mp = synth.stats.mp
    bumpRev(synth)
    this.mixTarget = synth
    this.targetMp = Math.max(1, synth.stats.mp)
    this.targetAp = Math.max(1, synth.stats.ap)

    this.fighter = createPlayerFighter(data, {
      name: member.name ?? 'proxy',
      breedId: member.breedId,
      level: member.level,
      stats: refStats,
      maxHp: refMaxHp,
      variants: member.variants.slice(),
    })
    this.fighter.id = 0
    if (member.presetId) this.fighter.tags.presetId = member.presetId
    bumpRev(this.fighter)
    this.calibration = calibrationOf(this.fighter)

    // Rotations offensives et utilitaires par PA (au build de référence, contre la cible synthétique).
    const profiles = this.dptTable.profiles.ofFighter(this.fighter)
    const indexOf = new Map<number, number>()
    this.fighter.spells.forEach((s, i) => indexOf.set(s.spellId, i))
    let needRange = 0
    for (let ap = 0; ap <= MAX_AP; ap++) {
      const turn = this.dptTable.turn(this.fighter, synth, ap, 'next')
      const lines: OutLine[] = []
      for (const [spellId, n] of countCasts(turn.casts)) {
        const i = indexOf.get(spellId)
        if (i === undefined) continue
        const p = profiles[i]
        const ks = this.fighter.spells[i]
        if (ap === this.apTarget && p.level.rangeBoostable && p.level.range >= 3) needRange = 5
        const crit = p.level.criticalEffects.length ? p.level.critChance : 0
        for (const line of castLines(this.fighter, synth, p, ks.isWeapon === true)) {
          const el = resolveElement(line.element, refStats)
          if (el < 0) continue
          const boosted = line.family === 'boosted' || line.family === 'mp'
          const w = n * lineWeight(line)
          lines.push({
            boosted,
            element: el as Element,
            baseN: meanOf(line.min, line.max),
            baseC: meanOf(line.critMin, line.critMax),
            critBase: crit,
            melee: isMeleeSpell(p),
            weight: w,
            constant: boosted ? 0 : w * lineDamage(this.fighter, synth, line, spellId, ks.isWeapon === true, isMeleeSpell(p), 1, spellCritPct(this.fighter, p)).mean,
          })
        }
      }
      this.outByAp.push(lines)
      this.utilByAp.push(this.utilRotation(profiles, ap))
    }
    this.rangeNeed = opts.rangeNeed ?? needRange

    // Lignes reçues : rotations des monstres du mix contre le personnage de référence.
    let inConstant = 0
    this.targets.forEach((m, mi) => {
      const mProfiles = this.dptTable.profiles.ofFighter(m)
      const mIndex = new Map<number, number>()
      m.spells.forEach((s, i) => mIndex.set(s.spellId, i))
      const turn = this.dptTable.turn(m, this.fighter, m.stats.ap, 'next')
      for (const [spellId, n] of countCasts(turn.casts)) {
        const i = mIndex.get(spellId)
        if (i === undefined) continue
        const p = mProfiles[i]
        const melee = isMeleeSpell(p)
        const crit = spellCritPct(m, p) / 100
        const st = m.stats
        const mult = (1 + st.finalDamagePct / 100) * (1 + st.spellDamagePct / 100) * (1 + (melee ? st.meleeDamagePct : st.rangedDamagePct) / 100)
        for (const line of castLines(m, this.fighter, p, false)) {
          const el = resolveElement(line.element, st)
          if (el < 0) continue
          const boosted = line.family === 'boosted' || line.family === 'mp'
          const w = this.weights[mi] * n * lineWeight(line)
          const power = Math.max(0, st.power + st[ELEMENT_MAIN_STAT[el as Element]] + (st.spellPower ?? 0))
          const fixed = st[ELEMENT_FIXED_DAMAGE[el as Element]] + st.damage
          const inLine: InLine = {
            boosted,
            element: el as Element,
            preN: meanOf(line.min, line.max) * (1 + power / 100) + fixed,
            preC: meanOf(line.critMin, line.critMax) * (1 + power / 100) + fixed + st.criticalDamage,
            crit,
            melee,
            weight: w,
            mult,
            constant: 0,
          }
          if (!boosted) inConstant += w * lineDamage(m, this.fighter, line, spellId, false, melee, 1, crit * 100).mean
          else this.inLines.push(inLine)
        }
      }
    })
    this.inConstant = inConstant
    const zero = copyStats(refStats)
    for (const k of DEFENSE_KEYS) zero[k] = 0
    this.inc0Surrogate = this.incomingSurrogate(zero)
  }

  // ── rotations utilitaires (soins, retraits) ──

  private utilRotation(profiles: readonly SpellProfileX[], ap: number): UtilRotation {
    const r: UtilRotation = { heals: [], mpTry: 0, mpSure: 0, apTry: 0, apSure: 0 }
    // Soins : glouton par soin moyen / PA (caractéristiques de référence).
    const healers = profiles
      .map((p, i) => ({ p, i, v: p.heals.reduce((a, h) => a + (h.kind === 'boosted' ? heal(meanOf(h.min, h.max), this.refStats, { element: Math.max(0, h.element) as Element }) : 0), 0) }))
      .filter(x => x.v > 0 && x.p.apCost > 0)
      .sort((x, y) => y.v / y.p.apCost - x.v / x.p.apCost || x.i - y.i)
    let left = ap
    for (const { p } of healers) {
      const max = p.cooldown > 0 ? 1 : p.castsPerTurn > 0 ? p.castsPerTurn : 99
      const n = Math.min(max, Math.floor(left / p.apCost))
      if (n <= 0) continue
      left -= n * p.apCost
      const crit = p.level.criticalEffects.length ? p.level.critChance : 0
      for (const h of p.heals) {
        if (h.kind !== 'boosted') continue
        r.heals.push({ baseN: meanOf(h.min, h.max), baseC: meanOf(h.critMin, h.critMax), crit, element: Math.max(0, h.element) as Element, count: n * h.p })
      }
    }
    // Retraits : glouton par points retirés / PA, par réserve.
    for (const pool of ['mp', 'ap'] as const) {
      const list = profiles
        .map((p, i) => ({ p, i, v: p.removals.filter(x => x.pool === pool && x.delay <= 0).reduce((a, x) => a + x.value, 0) }))
        .filter(x => x.v > 0 && x.p.apCost > 0)
        .sort((x, y) => y.v / y.p.apCost - x.v / x.p.apCost || x.i - y.i)
      let budget = ap
      for (const { p } of list) {
        const max = p.cooldown > 0 ? 1 : p.castsPerTurn > 0 ? p.castsPerTurn : 99
        const n = Math.min(max, Math.floor(budget / p.apCost))
        if (n <= 0) continue
        budget -= n * p.apCost
        for (const x of p.removals) {
          if (x.pool !== pool || x.delay > 0) continue
          const v = n * x.value
          if (pool === 'mp') {
            if (x.dodgeable) r.mpTry += v
            else r.mpSure += v
          } else if (x.dodgeable) r.apTry += v
          else r.apSure += v
        }
      }
    }
    return r
  }

  // ── forme fermée ──

  private dptSurrogate(s: Stats): number {
    const lines = this.outByAp[Math.max(0, Math.min(MAX_AP, Math.floor(s.ap)))]
    const t = this.mixTarget.stats
    let total = 0
    const multBase = (1 + s.finalDamagePct / 100) * (1 + s.spellDamagePct / 100) * (1 - t.spellResPct / 100)
    for (const l of lines) {
      if (!l.boosted) {
        total += l.constant
        continue
      }
      const el = l.element
      const power = Math.max(0, s.power + s[ELEMENT_MAIN_STAT[el]] + (s.spellPower ?? 0))
      const fixed = s[ELEMENT_FIXED_DAMAGE[el]] + s.damage
      const fr = t[ELEMENT_RES_FIXED[el]]
      const res = Math.min(100, t[ELEMENT_RES_PCT[el]]) / 100
      const mult = multBase * (1 + (l.melee ? s.meleeDamagePct : s.rangedDamagePct) / 100) * (1 - (l.melee ? t.meleeResPct : t.rangedResPct) / 100)
      const k = 1 + power / 100
      const n = Math.max(0, l.baseN * k + fixed - fr) * (1 - res)
      let e = n
      if (l.critBase > 0) {
        const c = critChance(l.critBase, s.critical) / 100
        const cr = Math.max(0, l.baseC * k + fixed + s.criticalDamage - fr - t.criticalRes) * (1 - res)
        e = (1 - c) * n + c * cr
      }
      total += l.weight * e * mult
    }
    return total * this.calibration
  }

  private incomingSurrogate(s: Stats): number {
    let total = this.inConstant
    const spellRes = 1 - s.spellResPct / 100
    for (const l of this.inLines) {
      const el = l.element
      const fr = s[ELEMENT_RES_FIXED[el]]
      const res = Math.min(50, s[ELEMENT_RES_PCT[el]]) / 100
      const n = Math.max(0, l.preN - fr) * (1 - res)
      const c = l.crit
      const e = c > 0 ? (1 - c) * n + c * Math.max(0, l.preC - fr - s.criticalRes) * (1 - res) : n
      total += l.weight * e * l.mult * spellRes * (1 - (l.melee ? s.meleeResPct : s.rangedResPct) / 100)
    }
    return total
  }

  private removed(pool: 'mp' | 'ap', s: Stats, rot: UtilRotation): number {
    const tryN = Math.min(24, Math.round(pool === 'mp' ? rot.mpTry : rot.apTry))
    const sure = pool === 'mp' ? rot.mpSure : rot.apSure
    const max = pool === 'mp' ? this.targetMp : this.targetAp
    if (tryN <= 0) return Math.min(max, sure)
    const removal = Math.max(0, Math.round(pool === 'mp' ? s.mpReduction : s.apReduction))
    const dodge = Math.max(0, Math.round(pool === 'mp' ? this.mixTarget.stats.mpParry : this.mixTarget.stats.apParry))
    const key = ((removal * 64 + tryN) * 2 + (pool === 'mp' ? 1 : 0)) * 4096 + dodge
    let v = this.removalMemo.get(key)
    if (v === undefined) {
      v = expectedApMpRemoved(removal, dodge, max, max, tryN)
      this.removalMemo.set(key, v)
    }
    return Math.min(max, v + sure)
  }

  private rotationAt(s: Stats): UtilRotation {
    return this.utilByAp[Math.max(0, Math.min(MAX_AP, Math.floor(s.ap)))]
  }

  /** PM (ou PA) retirés par tour à la cible de référence (espérance, esquive comprise). */
  removedPoints(pool: 'mp' | 'ap', s: Stats): number {
    return this.removed(pool, s, this.rotationAt(s))
  }

  /** Soins par tour (rotation de soin du nombre de PA, critique pondéré). */
  healPerTurn(s: Stats): number {
    let h = 0
    for (const x of this.rotationAt(s).heals) {
      const n = heal(x.baseN, s, { element: x.element })
      const c = x.crit > 0 ? critChance(x.crit, s.critical) / 100 : 0
      h += x.count * (c > 0 ? (1 - c) * n + c * heal(x.baseC, s, { element: x.element }) : n)
    }
    return h
  }

  /** UTIL selon le rôle (voir l'en-tête). */
  utility(s: Stats): number {
    switch (this.member.role) {
      case 'mpLock':
        return this.removedPoints('mp', s) / this.targetMp
      case 'apLock':
        return this.removedPoints('ap', s) / this.targetAp
      case 'healer':
        return this.healPerTurn(s) / 1500
      case 'support': {
        const h = this.healPerTurn(s)
        return h > 0 ? h / 1500 : 0.5
      }
      case 'tank':
        return Math.max(0, s.tackleBlock) / 100
      case 'placer':
        return 0.5 + Math.max(0, s.pushDamage) / 400
      case 'summoner':
        return Math.max(0, s.summons - 1) / 3
      default:
        return 0
    }
  }

  /** DPT exact (calibré) de `s` contre une cible du mix (index), ou contre un combattant donné. */
  dptAgainst(s: Stats, maxHp: number, target: number | Fighter): number {
    this.setFighter(s, maxHp)
    const t = typeof target === 'number' ? this.targets[target] : target
    return this.dptTable.turn(this.fighter, t, Math.max(0, s.ap), 'next').mean * this.calibration
  }

  /** Dégâts par tour d'un monstre du mix (index) sur le personnage `s` (PA du monstre ou `ap`). */
  incomingFrom(s: Stats, maxHp: number, monster: number, ap?: number): number {
    this.setFighter(s, maxHp)
    const m = this.targets[monster]
    return this.dptTable.turn(m, this.fighter, Math.max(0, ap ?? m.stats.ap), 'next').mean
  }

  private score(dpt: number, incoming: number, inc0: number, s: Stats, maxHp: number): ProxyScore {
    const { a, b, c } = this.exponents
    const ehp = maxHp * (incoming > 1e-6 ? Math.min(20, inc0 / incoming) : 20)
    const util = c > 0 ? this.utility(s) : 0
    let penalty = 1
    for (let x = s.ap; x < this.apTarget; x++) penalty *= 0.85
    for (let x = s.mp; x < this.mpTarget; x++) penalty *= 0.9
    for (let x = s.range; x < this.rangeNeed; x++) penalty *= 0.95
    if (this.initiativeWeight > 0) penalty *= 1 + this.initiativeWeight * Math.min(1, Math.max(0, s.initiative) / 5000)
    const logJ = a * detLog(Math.max(1, dpt)) + b * detLog(Math.max(1, ehp)) + detLog(1 + c * util) + detLog(penalty)
    return { logJ, j: Math.exp(logJ), dpt, ehp, util, penalty, incoming, ap: s.ap, mp: s.mp, range: s.range, maxHp }
  }

  /** Évaluation rapide (forme fermée, voir l'en-tête). */
  surrogate(s: Stats, maxHp: number): ProxyScore {
    this.surrogateCalls++
    return this.score(this.dptSurrogate(s), this.incomingSurrogate(s), this.inc0Surrogate, s, maxHp)
  }

  /** Évaluation exacte (DptTable sur chaque cible du mix). */
  exact(s: Stats, maxHp: number): ProxyScore {
    this.exactCalls++
    const f = this.fighter
    if (this.inc0Exact < 0) {
      const zero = copyStats(this.refStats)
      for (const k of DEFENSE_KEYS) zero[k] = 0
      this.setFighter(zero, this.refMaxHp)
      this.inc0Exact = this.incomingExact()
    }
    this.setFighter(s, maxHp)
    let dpt = 0
    let w = 0
    this.targets.forEach((t, i) => {
      dpt += this.weights[i] * this.dptTable.turn(f, t, Math.max(0, s.ap), 'next').mean
      w += this.weights[i]
    })
    dpt = (w > 0 ? dpt / w : 0) * this.calibration
    return this.score(dpt, this.incomingExact(), this.inc0Exact, s, maxHp)
  }

  private incomingExact(): number {
    let inc = 0
    this.targets.forEach((m, i) => {
      inc += this.weights[i] * this.dptTable.turn(m, this.fighter, Math.max(0, m.stats.ap), 'next').mean
    })
    return inc
  }

  private setFighter(s: Stats, maxHp: number): void {
    const f = this.fighter
    f.baseStats = copyStats(s)
    f.stats = copyStats(s)
    f.maxHp = maxHp
    f.baseMaxHp = maxHp
    f.hp = maxHp
    f.ap = s.ap
    f.mp = s.mp
    bumpRev(f)
  }

  /**
   * Poids marginaux ∂logJ̃/∂carac (par point) au build de référence, différences finies de la forme fermée (10
   * unités de poids de rune par pas ; PA/PM/PO : 1 point, sous les plafonds). Sert au classement des objets, aux
   * transcendances et aux exos.
   */
  statWeights(): Partial<Record<StatKey, number>> {
    if (this.weightsCache) return this.weightsCache
    const base = this.surrogate(this.refStats, this.refMaxHp).logJ
    const out: Partial<Record<StatKey, number>> = {}
    for (const k of Object.keys(RUNE_WEIGHT_PER_POINT) as StatKey[]) {
      const rw = RUNE_WEIGHT_PER_POINT[k]!
      const step = k === 'ap' || k === 'mp' || k === 'range' || k === 'summons' ? 1 : Math.max(1, Math.round(10 / rw))
      const s = copyStats(this.refStats)
      let hp = this.refMaxHp
      if (k === 'ap' || k === 'mp' || k === 'range') {
        // PA/PM/PO : valeur d'un point SOUS le plafond (le build de référence peut être plafonné).
        s[k] = Math.min(s[k], (k === 'ap' ? this.apTarget : k === 'mp' ? this.mpTarget : 6) - 1)
        const lo = this.surrogate(s, hp).logJ
        s[k] += 1
        out[k] = this.surrogate(s, hp).logJ - lo
        continue
      }
      s[k] += step
      if (k === 'vitality' || k === 'lifePoints') hp += step
      out[k] = (this.surrogate(s, hp).logJ - base) / step
    }
    this.surrogateCalls -= Object.keys(RUNE_WEIGHT_PER_POINT).length + 1
    this.weightsCache = out
    return out
  }
}

/** Contexte de proxy d'un personnage (caractéristiques de référence : son build actuel). */
export function createProxyContext(data: DataStore, member: ProxyMember, ref: { stats: Stats; maxHp: number }, opts: ProxyOptions = {}): ProxyContext {
  return new ProxyContext(data, member, copyStats(ref.stats), ref.maxHp, opts)
}

/** Liste des éléments (tests, rapports). */
export const PROXY_ELEMENTS = ELEMS
