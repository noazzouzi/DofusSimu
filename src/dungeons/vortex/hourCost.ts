/**
 * Coût des heures de l'Œil de Vortex (docs/design/ai.md §12.4) — WP3b. Calculé UNE fois par combat (≤ 2 ms).
 *
 * Deux coûts par heure h, en PVe :
 *  - `C_mon(m, h)` (vie de zombie) = `ΔThreat_m(h)·E[tours monstre avant corruption] + λ_ehp·ΔEHP_m(h)` : le monstre m
 *    tué à h ressuscite avec le bonus de h (5002) et joue E tours de plus avant sa corruption ;
 *  - `C_vx(h)` (phase 2, payé UNE fois, à la première utilisation de h) = `ΔThreat_V(h)·T2 + λ_burst·ΔEHP_V(h)` : le
 *    Vortex hérite du bonus de chaque heure distincte (5009), T2 = tours du Vortex attendus en phase 2
 *    (`θ.burst.phase2VortexTurns`).
 *
 * MESURE (`measureHourCosts`) : monstre de référence au grade du combat (Vortex au grade du boss, PA/PM de phase 2),
 * clone portant le bonus de h (buff de caractéristiques synthétique, mêmes valeurs que 5002/5009, `HOUR_BONUS`), puis
 *  - ΔThreat = `HIT_FACTOR`·[T(m+h) − T(m)], T = dégâts d'un tour répartis sur l'équipe réelle (`teamTurnDamage`,
 *    profils et dégâts par lancer de la `DptTable`, §6.4 : un bonus de PA ajoute un lancer sur une autre cible) ;
 *  - ΔEHP = PV utiles·(D₀/D₁ − 1) + PV ajoutés·D₀/D₁, D = Σ_p dpt(p, m) (dégâts de l'équipe sur le monstre) ;
 *    PV utiles = PV d'un ressuscité (`rezHpPct`·PV de base) pour C_mon, PV du Vortex pour C_vx ; V (×70 % / ×75 %) et
 *    XI (+30 % PV de base) sont appliqués analytiquement, VII (+150 résistances critiques) passe par le DPT réel.
 * Bonus NON mesurables par le DPT (mobilité, tacle, poussée) — approximations documentées, calées sur la table de
 * repli : IV (+2 PM) `MP_THREAT`/PM × menace de base (Vortex : `VORTEX_MP_THREAT`, Heurage + lignes de 8) ;
 * II (Intaclable) `INTACLABLE_THREAT` × menace ; X (Inébranlable) `UNMOVABLE_THREAT` × menace (`UNMOVABLE_THREAT_PLACER`
 * si l'équipe a un placeur).
 *
 * REPLI (`fallbackHourCosts`, mode `fast` sans calcul, tests) : table du §12.4 (`C_MON_FALLBACK`, `C_VX_FALLBACK`) ;
 * III/VI/IX/XII : `C_MON_NO_ELEMENT` si le monstre n'a pas de sort de l'élément boosté ; X : `C_MON_X_WITH_PLACER` avec un
 * placeur. Les deux sont multipliés par `θ.planner.hourCostScale`.
 */
import { calibrationOf, castsAvailable, createDptTable, type DptTableImpl } from '../../ai/core/dpt'
import type { StrategyParams } from '../../ai/types'
import type { Stats } from '../../core/types'
import type { Engine } from '../../engine/engine'
import { cloneFighter } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { Buff, Fighter } from '../../engine/types'
import type { EffectData } from '../../data/model'
import {
  C_MON_FALLBACK,
  C_MON_NO_ELEMENT,
  C_MON_X_WITH_PLACER,
  C_VX_FALLBACK,
  HOUR_BONUS,
  HOUR_COUNT as HOURS,
  VORTEX,
  VORTEX_PHASE2_AP,
  VORTEX_PHASE2_MP,
  WAVE_MONSTER_IDS,
  type VortexParams,
} from './constants'

/** Copie locale (chemins chauds du planificateur : pas de résolution d'import à chaque appel). */
const HOUR_COUNT: number = HOURS

// ───────────────────────────── constantes des bonus non mesurables ─────────────────────────────

/** Part des dégâts par tour d'un monstre réellement infligée (portée, ciblage) : menace = HIT_FACTOR·dpt moyen. */
export const HIT_FACTOR = 0.75
/** Menace ajoutée par PM (IV) : monstre à distance / de mêlée (portée max ≤ 2) / Vortex de phase 2. */
export const MP_THREAT = 0.1
export const MP_THREAT_MELEE = 0.12
export const VORTEX_MP_THREAT = 0.25
/** Intaclable (II) : fuite libre du contact. */
export const INTACLABLE_THREAT = 0.05
/** Inébranlable (X) : ne peut plus être poussé (placeur : la valeur du placement disparaît). */
export const UNMOVABLE_THREAT = 0.02
export const UNMOVABLE_THREAT_PLACER = 0.12

// ───────────────────────────── modèle ─────────────────────────────

/** Détail d'une mesure (rapport, tests T-hours). */
export interface HourCostDetail {
  /** ΔThreat (PVe par tour) et ΔEHP (PV effectifs) par heure, index 1..12. */
  dThreat: Float64Array
  dEhp: Float64Array
  /** Menace de base (PVe/tour) et dégâts de l'équipe par tour sur le monstre de référence. */
  baseThreat: number
  teamDamage: number
}

/** Coûts d'heures d'un combat (PVe). Index des tableaux : heure 1..12 (case 0 inutilisée). */
export class HourCostModel {
  constructor(
    /** C_mon par identifiant de monstre de vague. */
    readonly mon: ReadonlyMap<number, Float64Array>,
    readonly vx: Float64Array,
    readonly source: 'measured' | 'fallback',
    readonly detail?: ReadonlyMap<number, HourCostDetail>,
  ) {}

  /** C_mon(m, h) ; monstre inconnu : moyenne des monstres connus. */
  cMon(monsterId: number, h: number): number {
    if (h < 1 || h > HOUR_COUNT) return 0
    const row = this.mon.get(monsterId)
    if (row) return row[h]
    let s = 0
    let n = 0
    for (const r of this.mon.values()) {
      s += r[h]
      n++
    }
    return n ? s / n : C_MON_FALLBACK[h]
  }

  /** C_vx(h). */
  cVx(h: number): number {
    return h >= 1 && h <= HOUR_COUNT ? this.vx[h] : 0
  }

  /**
   * Coût d'une mort de `monsterId` à l'heure h quand les heures `hoursUsed` (masque) sont déjà posées : C_mon·réveils
   * + C_vx si h est nouvelle. Une mort sous l'étoile (corruption) ne coûte rien (appelant).
   */
  markCost(monsterId: number, h: number, hoursUsed: number, wakes = 1): number {
    const fresh = h >= 1 && h <= HOUR_COUNT && (hoursUsed & (1 << (h - 1))) === 0
    return this.cMon(monsterId, h) * wakes + (fresh ? this.cVx(h) : 0)
  }

  /** Heures triées par coût Vortex croissant (départage : coût zombie moyen, puis heure). */
  hoursByVortexCost(): number[] {
    const hs = Array.from({ length: HOUR_COUNT }, (_, i) => i + 1)
    return hs.sort((a, b) => this.cVx(a) - this.cVx(b) || this.cMon(-1, a) - this.cMon(-1, b) || a - b)
  }
}

// ───────────────────────────── repli ─────────────────────────────

export interface FallbackOptions {
  /** L'équipe a-t-elle un placeur (X plus cher) ? */
  hasPlacer?: boolean
  /** Éléments des sorts de dégâts d'un monstre (III/VI/IX/XII moins chers sans l'élément boosté) ; défaut : tous. */
  elementsOf?: (monsterId: number) => ReadonlySet<number> | undefined
  /** `θ.planner.hourCostScale` (défaut 1). */
  scale?: number
  monsters?: readonly number[]
}

/** Table de repli du §12.4 (PVe). */
export function fallbackHourCosts(o: FallbackOptions = {}): HourCostModel {
  const scale = o.scale ?? 1
  const mon = new Map<number, Float64Array>()
  for (const id of o.monsters ?? WAVE_MONSTER_IDS) {
    const row = new Float64Array(HOUR_COUNT + 1)
    const els = o.elementsOf?.(id)
    for (let h = 1; h <= HOUR_COUNT; h++) {
      let c = C_MON_FALLBACK[h]
      const el = HOUR_BONUS[h]?.boostedElement
      if (el !== undefined && els && !els.has(el)) c = C_MON_NO_ELEMENT
      if (h === 10 && o.hasPlacer) c = C_MON_X_WITH_PLACER
      row[h] = c * scale
    }
    mon.set(id, row)
  }
  const vx = new Float64Array(HOUR_COUNT + 1)
  for (let h = 1; h <= HOUR_COUNT; h++) vx[h] = C_VX_FALLBACK[h] * scale
  return new HourCostModel(mon, vx, 'fallback')
}

// ───────────────────────────── mesure ─────────────────────────────

export interface MeasureOptions {
  params: Pick<VortexParams, 'monsterGrade' | 'bossGrade' | 'rezHpPct' | 'players'>
  theta: StrategyParams
  /** Personnages vivants (cibles du DPT des monstres, sources des dégâts subis). */
  team: readonly Fighter[]
  hasPlacer?: boolean
  /** E[tours monstre avant corruption] (défaut 12/N : un cycle d'horloge à N personnages vivants). */
  zombieTurns?: number
  dpt?: DptTableImpl
  monsters?: readonly number[]
}

const EMPTY_EFFECT: EffectData = {
  effectId: 0, order: 0, diceNum: 0, diceSide: 0, value: 0, duration: -1, delay: 0, random: 0, group: 0, targetMask: '',
  targetId: 0, triggers: 'I', dispellable: 4, element: -1, zone: { shape: 'P', size: 0, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
}

/** Clone du monstre portant le bonus de caractéristiques de l'heure h (buff synthétique non désenvoûtable). */
function withHourStats(engine: Engine, m: Fighter, h: number): Fighter {
  const stats = HOUR_BONUS[h]?.stats
  const c = cloneFighter(m)
  if (!stats) return c
  const buff: Buff = {
    uid: -h,
    sourceId: m.id,
    spellId: 0,
    effect: EMPTY_EFFECT,
    value: 0,
    remaining: -1,
    delay: 0,
    dispellable: false,
    statDelta: { ...stats } as Partial<Stats>,
    label: `heure ${h}`,
    kind: 'stat',
  }
  c.buffs = [...c.buffs, buff]
  engine.recomputeStats(c)
  return c
}

/** Éléments des sorts de dégâts d'un combattant (profils analytiques, sous-sorts compris). */
export function damageElements(dpt: DptTableImpl, f: Fighter): Set<number> {
  const out = new Set<number>()
  for (const p of dpt.profiles.ofFighter(f)) for (const l of p.damage) if (l.element >= 0 && l.element <= 4) out.add(l.element)
  return out
}

/** Portée maximale des sorts de dégâts (mêlée si ≤ 2). */
function maxDamageRange(dpt: DptTableImpl, f: Fighter): number {
  let r = 0
  for (const p of dpt.profiles.ofFighter(f)) if (p.damage.length) r = Math.max(r, p.maxRange)
  return r
}

/**
 * Dégâts d'un tour de `a` répartis sur l'équipe `team` (PVe, calibrés) : sac à dos sur `ap` PA des lancers disponibles
 * au prochain tour, `castsPerTurn` pour le tour et `castsPerTarget` PAR CIBLE (la k-ième copie d'un sort frappe la
 * meilleure cible encore libre). Contrairement à `dpt(a, d)` (une seule cible), un bonus de PA (VIII) y ajoute un lancer
 * sur une autre cible : c'est la « menace propre » d'un monstre au sens du planificateur.
 */
export function teamTurnDamage(dpt: DptTableImpl, a: Fighter, team: readonly Fighter[], ap: number = a.stats.ap): number {
  if (!team.length) return 0
  const profiles = dpt.profiles.ofFighter(a)
  const budget = Math.max(0, Math.min(40, Math.floor(ap + 1e-9)))
  const best = new Float64Array(budget + 1)
  for (let i = 0; i < a.spells.length; i++) {
    const p = profiles[i]
    if (!p || !p.damage.length || p.apCost <= 0) continue
    if (castsAvailable(a, a.spells[i], p, team[0].id, 'next') <= 0) continue
    const perTurn = p.castsPerTurn > 0 ? p.castsPerTurn : Infinity
    const perTarget = p.castsPerTarget > 0 ? p.castsPerTarget : Infinity
    let n = Math.min(perTurn, perTarget * team.length, Math.floor(budget / p.apCost))
    if (p.cooldown > 0) n = Math.min(n, 1)
    if (n <= 0) continue
    const means = team.map(d => dpt.perCast(a, i, d).mean).sort((x, y) => y - x)
    for (let k = 0; k < n; k++) {
      const v = means[Number.isFinite(perTarget) ? Math.min(means.length - 1, Math.floor(k / perTarget)) : 0]
      if (!(v > 0)) break
      for (let w = budget; w >= p.apCost; w--) if (best[w - p.apCost] + v > best[w]) best[w] = best[w - p.apCost] + v
    }
  }
  let m = 0
  for (let w = 0; w <= budget; w++) if (best[w] > m) m = best[w]
  return m * calibrationOf(a)
}

/** Mesure de ΔThreat et ΔEHP d'un monstre de référence pour les 12 heures. */
function measureOne(
  engine: Engine,
  dpt: DptTableImpl,
  ref: Fighter,
  team: readonly Fighter[],
  usefulHp: number,
  baseHp: number,
  o: { mpThreat: number; unmovable: number; vortex: boolean },
): HourCostDetail {
  const dThreat = new Float64Array(HOUR_COUNT + 1)
  const dEhp = new Float64Array(HOUR_COUNT + 1)
  const baseThreat = HIT_FACTOR * teamTurnDamage(dpt, ref, team)
  const teamDamage = team.reduce((a, p) => a + dpt.dpt(p, ref), 0)
  for (let h = 1; h <= HOUR_COUNT; h++) {
    const b = HOUR_BONUS[h]!
    let dt = 0
    let de = 0
    if (b.stats) {
      const clone = withHourStats(engine, ref, h)
      dt += Math.max(0, HIT_FACTOR * teamTurnDamage(dpt, clone, team) - baseThreat)
      if (b.stats.mp) dt += o.mpThreat * b.stats.mp * baseThreat
      if (b.stats.criticalRes && teamDamage > 0) {
        const d1 = team.reduce((a, p) => a + dpt.dpt(p, clone), 0)
        if (d1 > 0) de += usefulHp * Math.max(0, teamDamage / d1 - 1)
      }
    }
    if (b.damageTakenMult) {
      const k = o.vortex ? b.damageTakenMult.vortex : b.damageTakenMult.monster
      de += usefulHp * (1 / k - 1)
    }
    if (b.vitalityPct) de += baseHp * (b.vitalityPct / 100)
    if (b.grantsState === 96) dt += INTACLABLE_THREAT * baseThreat
    if (b.grantsState === 157) dt += o.unmovable * baseThreat
    dThreat[h] = dt
    dEhp[h] = de
  }
  return { dThreat, dEhp, baseThreat, teamDamage }
}

/**
 * Coûts d'heures MESURÉS (voir l'en-tête) contre l'équipe réelle. Sans personnage vivant : table de repli.
 * Déterministe (DPT analytique, aucun aléa).
 */
export function measureHourCosts(engine: Engine, o: MeasureOptions): HourCostModel {
  const team = o.team.filter(f => f.alive && f.kind === 'player')
  const tp = o.theta.planner
  const scale = tp.hourCostScale
  if (!team.length) return fallbackHourCosts({ hasPlacer: o.hasPlacer, scale })
  const dpt = o.dpt ?? createDptTable(engine)
  const data = engine.data
  const rezPct = ((o.params.rezHpPct[0] ?? 20) + (o.params.rezHpPct[1] ?? 30)) / 200
  const zombieTurns = o.zombieTurns ?? HOUR_COUNT / Math.max(1, team.length)
  const t2 = o.theta.burst.phase2VortexTurns
  const mon = new Map<number, Float64Array>()
  const detail = new Map<number, HourCostDetail>()
  let refId = -200
  for (const id of o.monsters ?? WAVE_MONSTER_IDS) {
    const ref = createMonsterFighter(data, { monsterId: id, grade: o.params.monsterGrade, team: 1 })
    ref.id = refId--
    engine.recomputeStats(ref)
    const melee = maxDamageRange(dpt, ref) <= 2
    const d = measureOne(engine, dpt, ref, team, rezPct * ref.baseMaxHp, ref.baseMaxHp, {
      mpThreat: melee ? MP_THREAT_MELEE : MP_THREAT,
      unmovable: o.hasPlacer ? UNMOVABLE_THREAT_PLACER : UNMOVABLE_THREAT,
      vortex: false,
    })
    const row = new Float64Array(HOUR_COUNT + 1)
    for (let h = 1; h <= HOUR_COUNT; h++) row[h] = scale * (d.dThreat[h] * zombieTurns + tp.lambdaEhp * d.dEhp[h])
    mon.set(id, row)
    detail.set(id, d)
  }
  // Vortex de phase 2 : grade du boss, 16 PA / 5 PM, sans Marginal.
  const vortex = createMonsterFighter(data, { monsterId: VORTEX, grade: o.params.bossGrade, team: 1 })
  vortex.id = refId--
  vortex.baseStats = { ...vortex.baseStats, ap: Math.max(vortex.baseStats.ap, VORTEX_PHASE2_AP), mp: Math.max(vortex.baseStats.mp, VORTEX_PHASE2_MP) }
  engine.recomputeStats(vortex)
  const dv = measureOne(engine, dpt, vortex, team, vortex.baseMaxHp, vortex.baseMaxHp, {
    mpThreat: VORTEX_MP_THREAT,
    unmovable: o.hasPlacer ? UNMOVABLE_THREAT_PLACER : UNMOVABLE_THREAT,
    vortex: true,
  })
  const vx = new Float64Array(HOUR_COUNT + 1)
  for (let h = 1; h <= HOUR_COUNT; h++) vx[h] = scale * (dv.dThreat[h] * t2 + tp.lambdaBurst * dv.dEhp[h])
  detail.set(VORTEX, dv)
  return new HourCostModel(mon, vx, 'measured', detail)
}

/** Éléments de dégâts de chaque monstre de vague (repli « sans élément boosté »). */
export function waveMonsterElements(engine: Engine, grade: number): Map<number, Set<number>> {
  const dpt = createDptTable(engine)
  const out = new Map<number, Set<number>>()
  for (const id of WAVE_MONSTER_IDS) out.set(id, damageElements(dpt, createMonsterFighter(engine.data, { monsterId: id, grade, team: 1 })))
  return out
}

/** Table lisible (rapport) : une ligne par monstre puis le Vortex, coûts arrondis. */
export function formatHourCosts(m: HourCostModel, names: (id: number) => string = String): string {
  const head = ['', ...Array.from({ length: HOUR_COUNT }, (_, i) => HOUR_BONUS[i + 1]!.roman)].join('\t')
  const rows = [...m.mon.entries()].map(([id, row]) => [names(id), ...Array.from(row.subarray(1), v => Math.round(v))].join('\t'))
  rows.push(['C_vx', ...Array.from(m.vx.subarray(1), v => Math.round(v))].join('\t'))
  return [head, ...rows].join('\n')
}
