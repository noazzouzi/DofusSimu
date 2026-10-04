/**
 * Kills (docs/design/ai.md §6.7) — WP1.
 *
 *  - `killProbability(mean, variance, hpEff) = Φ((mean − hpEff)/σ)` (Φ déterministe, rng.ts).
 *  - `canKillNow(view, me, t)` : meilleur plan analytique de kill CE tour depuis l'accessibilité actuelle (sac à dos
 *    « reste du tour » des sorts qui portent sur la cible depuis une même case) → { p, apNeeded, spells, castCell }.
 *  - `lethalSplit` (`standard`/`deep`) : la macro-action rejouée en `rollMode` 'min' et 'max' (2 nœuds) ;
 *    p = 1 si 'min' tue, 0 si 'max' ne tue pas, sinon (Dmax − PV)/(Dmax − Dmin) (jet uniforme), puis mélange avec le
 *    coup critique (les modes 'min'/'max' du moteur ne tirent jamais de critique) : p = (1 − c)·p_N + c·p_C, où p_C
 *    applique aux bornes le rapport analytique dégâts critiques / normaux du sort.
 */
import { critChance } from '../../damage/crit'
import type { FightState, Fighter } from '../../engine/types'
import type { AIView, KillEstimate, LethalSplit, MacroAction, Perception } from '../types'
import { castCellsFor, castFailureStatic, LosOracle, levelFor } from './castCells'
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
    castCellsFor(s, me, ks, lvl, tCell, reach, los, 600, cells)
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
    const pk = killProbability(mean, turn.variance * calib * calib, need)
    if (pk > best.p + 1e-9 || (Math.abs(pk - best.p) <= 1e-9 && mean > bestMean)) {
      let apNeeded = Math.ceil(ap)
      for (let a = 0; a <= Math.floor(ap); a++) {
        const tt = dpt.turn(me, t, a, 'now', filter)
        if (killProbability(tt.mean * calib, tt.variance * calib * calib, need) >= 0.95 * pk) {
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
  const dMax = need - (vMax.alive ? lifeToKill(vMax) : 0)
  const minKills = !vMin.alive
  const maxKills = !vMax.alive
  const uniform = (factor: number): number => {
    const lo = dMin * factor
    const hi = dMax * factor
    if (lo >= need) return 1
    if (hi < need) return 0
    return hi > lo ? clamp((hi - need) / (hi - lo), 0, 1) : 1
  }
  let pk = minKills ? 1 : !maxKills ? 0 : uniform(1)
  // Coup critique : sort lancé par la macro (premier lancer).
  const castOf = (x: MacroAction): number | undefined => x.cast?.spellId ?? x.seq?.map(castOf).find(v => v !== undefined)
  const spellId = castOf(m)
  const me = parent.fighters[meId]
  if (spellId !== undefined && me && pk < 1) {
    const dpt = (p?.dpt as DptTableImpl | undefined) ?? createDptTable(view.engine)
    const si = me.spells.findIndex(sp => sp.spellId === spellId)
    if (si >= 0) {
      const { c, k } = critRatio(me, victim0, si, dpt)
      if (c > 0 && k > 1) pk = (1 - c) * pk + c * uniform(k)
    }
  }
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
    nodes: 2,
  }
}
