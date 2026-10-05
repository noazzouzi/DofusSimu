/**
 * Kills (docs/design/ai.md §6.7) — WP1.
 *
 *  - `killProbability(mean, variance, hpEff) = Φ((mean − hpEff)/σ)` (Φ déterministe, rng.ts).
 *  - `canKillNow(view, me, t)` : meilleur plan analytique de kill CE tour depuis l'accessibilité actuelle (sac à dos
 *    « reste du tour » des sorts qui portent sur la cible depuis une même case) → { p, apNeeded, spells, castCell }.
 *  - `lethalSplit` (`standard`/`deep`) : la macro-action rejouée en `rollMode` 'min' et 'max' (2 nœuds, 3 si 'max' tue :
 *    sonde aux PV gonflés pour lire les dégâts maximaux non plafonnés) ;
 *    p = 1 si 'min' tue, 0 si 'max' ne tue pas, sinon (Dmax − PV)/(Dmax − Dmin) (jet uniforme), puis mélange avec le
 *    coup critique (les modes 'min'/'max' du moteur ne tirent jamais de critique) : p = (1 − c)·p_N + c·p_C, où p_C
 *    applique aux bornes le rapport analytique dégâts critiques / normaux du sort.
 */
import { critChance } from '../../damage/crit'
import type { FightState, Fighter } from '../../engine/types'
import type { AIView, KillEstimate, LethalSplit, MacroAction, Perception } from '../types'
import { castFailureStatic, hitCellsFor, LosOracle, levelFor } from './castCells'
import { calibrationOf, createDptTable, lineDamage, isMeleeSpell, type DptTableImpl } from './dpt'
import { cachedReach, buildOccupancy } from './reach'
import { clamp, phi } from './rng'
import { applyMacro, simClone } from './sim'
import { believedCell } from './view'

/** Φ((mean − hpEff)/σ) ; variance nulle ⇒ 0 ou 1. */
export function killProbability(mean: number, variance: number, hpEff: number): number {
  if (hpEff <= 0) return 1
  if (!(variance > 0)) return mean >= hpEff ? 1 : 0
  return clamp(phi((mean - hpEff) / Math.sqrt(variance)), 0, 1)
}

/** Lancer d'un plan : probabilité de critique et lois normale / critique (espérance, variance). */
export interface CastPart { crit: number; nMean: number; nVar: number; cMean: number; cVar: number }

/**
 * P(Σ dégâts ≥ hpEff) d'une suite de lancers indépendants dont chacun tire UN critique : mélange exact sur les
 * combinaisons de critiques (≤ 2¹⁰ termes ; au-delà, approximation normale globale), approximation normale (Φ
 * déterministe) à l'intérieur de chaque combinaison. Plus fidèle que Φ((μ − PV)/σ) quand la loi est asymétrique
 * (critique rare et fort : la médiane est sous l'espérance).
 */
export function killProbabilityParts(parts: readonly CastPart[], hpEff: number): number {
  if (hpEff <= 0) return 1
  const n = parts.length
  if (!n) return 0
  if (n > 10) {
    let m = 0
    let v = 0
    for (const x of parts) {
      const mu = (1 - x.crit) * x.nMean + x.crit * x.cMean
      m += mu
      v += (1 - x.crit) * (x.nVar + x.nMean * x.nMean) + x.crit * (x.cVar + x.cMean * x.cMean) - mu * mu
    }
    return killProbability(m, v, hpEff)
  }
  let p = 0
  const combos = 1 << n
  for (let mask = 0; mask < combos; mask++) {
    let w = 1
    let m = 0
    let v = 0
    for (let i = 0; i < n; i++) {
      const x = parts[i]
      if (mask & (1 << i)) {
        w *= x.crit
        m += x.cMean
        v += x.cVar
      } else {
        w *= 1 - x.crit
        m += x.nMean
        v += x.nVar
      }
      if (w === 0) break
    }
    if (w > 0) p += w * killProbability(m, v, hpEff)
  }
  return clamp(p, 0, 1)
}

/** PV à retirer pour tuer (bouclier compris en entier : les dommages le consomment d'abord). */
export function lifeToKill(f: Fighter): number {
  return f.hp + f.shield
}

const NO_KILL = (me: Fighter): KillEstimate => ({ p: 0, apNeeded: 0, spells: [], castCell: me.cell })

/**
 * Meilleur plan analytique pour tuer `t` ce tour (§6.7) : pour les cases atteignables d'où au moins un sort à dégâts
 * porte (les 4 meilleures en PA restants), sac à dos « reste du tour » des sorts lançables depuis cette case.
 * `apNeeded` = plus petit budget de PA qui atteint 95 % de la meilleure probabilité.
 */
export function canKillNow(view: AIView, me: Fighter, t: Fighter, p?: Perception, s: FightState = view.fight): KillEstimate {
  if (!me.alive || !t.alive) return NO_KILL(me)
  const tCell = believedCell(t, view.team)
  if (tCell < 0) return NO_KILL(me)
  const engine = view.engine
  const dpt: DptTableImpl = (p?.dpt as DptTableImpl | undefined) ?? createDptTable(engine)
  const occ = buildOccupancy(s, view.team)
  const reach = cachedReach(engine, s, me, view.team, me.mp, me.ap, occ)
  const los = new LosOracle(s, view.team, me.id, occ)
  const profiles = dpt.profiles.ofFighter(me)
  // Case → masque des sorts qui portent (≤ 31 sorts à dégâts suivis).
  const byCell = new Map<number, number>()
  const idx: number[] = []
  const cells: number[] = []
  for (let i = 0; i < me.spells.length && idx.length < 31; i++) {
    if (!profiles[i].damage.length) continue
    const ks = me.spells[i]
    const lvl = levelFor(me, ks)
    if (castFailureStatic(engine, me, ks, lvl, me.ap) !== null) continue
    const bit = 1 << idx.length
    idx.push(i)
    // Cases d'où le sort inflige ses dégâts à t (visée directe, couronne, autour du lanceur, portée 0 à zone).
    hitCellsFor(s, me, ks, lvl, profiles[i], tCell, reach, los, 600, cells)
    for (const c of cells) byCell.set(c, (byCell.get(c) ?? 0) | bit)
  }
  if (!byCell.size) return NO_KILL(me)
  const ranked = [...byCell.keys()].sort((a, b) => reach.apLeft[b] - reach.apLeft[a] || reach.mpLeft[b] - reach.mpLeft[a] || a - b).slice(0, 4)
  const need = lifeToKill(t)
  const calib = calibrationOf(me)
  let best: KillEstimate = NO_KILL(me)
  let bestMean = -1
  for (const c of ranked) {
    const mask = byCell.get(c)!
    const filter = (i: number) => {
      const k = idx.indexOf(i)
      return k >= 0 && (mask & (1 << k)) !== 0
    }
    const ap = reach.apLeft[c]
    const turn = dpt.turn(me, t, ap, 'now', filter)
    const mean = turn.mean * calib
    const pk = killProbabilityParts(castParts(dpt, me, t, turn.casts, calib), need)
    if (pk > best.p + 1e-9 || (Math.abs(pk - best.p) <= 1e-9 && mean > bestMean)) {
      let apNeeded = Math.ceil(ap)
      for (let a = 0; a <= Math.floor(ap); a++) {
        const tt = dpt.turn(me, t, a, 'now', filter)
        // Même loi que `pk` (mélange exact des critiques) : sinon le seuil de 95 % compare deux approximations.
        if (killProbabilityParts(castParts(dpt, me, t, tt.casts, calib), need) >= 0.95 * pk) {
          apNeeded = a
          break
        }
      }
      best = { p: pk, apNeeded, spells: turn.casts, castCell: c }
      bestMean = mean
    }
  }
  return best
}

/** Lancers d'un plan (ids de sorts) décomposés normal / critique, calibrés. */
function castParts(dpt: DptTableImpl, me: Fighter, t: Fighter, casts: readonly number[], calib: number): CastPart[] {
  const out: CastPart[] = []
  for (const spellId of casts) {
    const i = me.spells.findIndex(s => s.spellId === spellId)
    if (i < 0) continue
    const cd = dpt.perCast(me, i, t)
    const c2 = calib * calib
    out.push({
      crit: cd.crit ?? 0,
      nMean: (cd.nMean ?? cd.mean) * calib,
      nVar: (cd.nVar ?? cd.variance) * c2,
      cMean: (cd.cMean ?? cd.mean) * calib,
      cVar: (cd.cVar ?? cd.variance) * c2,
    })
  }
  return out
}

/** PV ajoutés à la victime du clone-sonde de `lethalSplit`. */
const SPLIT_PROBE_HP = 10_000_000

/** Rapport analytique dégâts critiques / normaux d'un sort de `me` sur `v` (1 si le sort ne critique pas). */
function critRatio(me: Fighter, v: Fighter, spellIndex: number, dpt: DptTableImpl): { c: number; k: number } {
  const p = dpt.profiles.ofFighter(me)[spellIndex]
  if (!p || !p.level.criticalEffects.length || !p.damage.length) return { c: 0, k: 1 }
  const c = critChance(p.level.critChance, me.stats.critical) / 100
  let n = 0
  let k = 0
  const isWeapon = me.spells[spellIndex].isWeapon === true
  for (const line of p.damage) {
    n += line.p * lineDamage(me, v, line, p.spellId, isWeapon, isMeleeSpell(p), 1, 0).mean
    k += line.p * lineDamage(me, v, line, p.spellId, isWeapon, isMeleeSpell(p), 1, 100).mean
  }
  return { c, k: n > 0 ? k / n : 1 }
}

/**
 * Split léthal (§6.7) de la macro-action `m` de `meId` sur `victimId` depuis `parent` (non modifié), clones salés par
 * `salt`. null si la macro échoue. `nodes` = 2.
 */
export function lethalSplit(view: AIView, parent: FightState, meId: number, m: MacroAction, victimId: number,
                            salt: number, p?: Perception): LethalSplit | null {
  const victim0 = parent.fighters[victimId]
  if (!victim0 || !victim0.alive) return null
  const need = lifeToKill(victim0)
  const cMin = simClone(view, parent, salt, 'min')
  if (!applyMacro(view.engine, cMin, meId, m)) return null
  const cMax = simClone(view, parent, salt, 'max')
  if (!applyMacro(view.engine, cMax, meId, m)) return null
  const vMin = cMin.fighters[victimId]
  const vMax = cMax.fighters[victimId]
  const dMin = need - (vMin.alive ? lifeToKill(vMin) : 0)
  const minKills = !vMin.alive
  const maxKills = !vMax.alive
  let nodes = 2
  // Dégâts maximaux NON plafonnés par les PV de la victime (sinon (Dmax − PV) = 0 dès que 'max' tue) : 3e nœud,
  // victime aux PV gonflés.
  let dMax = need - (vMax.alive ? lifeToKill(vMax) : 0)
  if (maxKills && !minKills) {
    const probe = simClone(view, parent, salt, 'max')
    const pv = probe.fighters[victimId]
    pv.hp += SPLIT_PROBE_HP
    pv.maxHp += SPLIT_PROBE_HP
    pv.baseMaxHp += SPLIT_PROBE_HP
    const before = lifeToKill(pv)
    nodes++
    if (applyMacro(view.engine, probe, meId, m) && pv.alive) dMax = Math.max(dMax, before - lifeToKill(pv))
  }
  // Coup critique et loi du jet : sort lancé par la macro (premier lancer).
  const castOf = (x: MacroAction): number | undefined => x.cast?.spellId ?? x.seq?.map(castOf).find(v => v !== undefined)
  const spellId = castOf(m)
  const me = parent.fighters[meId]
  // Nombre de valeurs du jet principal (loi uniforme DISCRÈTE : 41-44 = 4 valeurs, pas un continuum).
  let rolls = 0
  if (spellId !== undefined && me) {
    const si = me.spells.findIndex(sp => sp.spellId === spellId)
    const prof = si >= 0 ? ((p?.dpt as DptTableImpl | undefined) ?? createDptTable(view.engine)).profiles.ofFighter(me)[si] : undefined
    const line = prof?.damage.find(l => !l.sub && l.delayed <= 0 && l.dotTurns <= 0)
    if (line) rolls = line.max - line.min + 1
  }
  const uniform = (factor: number): number => {
    const lo = dMin * factor
    const hi = dMax * factor
    if (lo >= need) return 1
    if (hi < need) return 0
    if (!(hi > lo)) return 1
    if (rolls > 1) {
      // Valeurs du jet ≈ lo + i·pas, arrondies à l'entier (le moteur arrondit les dégâts) : comptées si ≥ PV.
      const step = (hi - lo) / (rolls - 1)
      return clamp((Math.floor((hi - (need - 0.5)) / step + 1e-9) + 1) / rolls, 0, 1)
    }
    return clamp((hi - need) / (hi - lo), 0, 1)
  }
  let pk = minKills ? 1 : !maxKills ? 0 : uniform(1)
  if (spellId !== undefined && me && pk < 1) {
    const dpt = (p?.dpt as DptTableImpl | undefined) ?? createDptTable(view.engine)
    const si = me.spells.findIndex(sp => sp.spellId === spellId)
    if (si >= 0) {
      const { c, k } = critRatio(me, victim0, si, dpt)
      if (c > 0 && k > 1) pk = (1 - c) * pk + c * uniform(k)
    }
  }
  // Les états rendus reviennent en 'average' : la recherche qui les prolongerait ne doit pas jouer en jets min/max.
  cMin.options.rollMode = 'average'
  cMax.options.rollMode = 'average'
  let killed: FightState | null = pk > 0 ? (minKills ? cMin : maxKills ? cMax : null) : null
  if (pk > 0 && !killed) {
    // Kill possible seulement en critique : état « tué » approché par la mort de la victime après le jet maximal.
    killed = view.engine.cloneFight(cMax, false)
    const v = killed.fighters[victimId]
    if (v.alive) view.engine.kill(killed, v, killed.fighters[meId])
  }
  return {
    p: pk,
    killed,
    survived: pk < 1 ? (minKills ? null : cMin) : null,
    nodes,
  }
}
