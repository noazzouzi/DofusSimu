/**
 * Soins, vol de vie et boucliers (docs/research/formulas.md §7-8).
 *
 * Soin (client D2 `DamageUtil.getHeal`) : `floor(base × (100 + Int) / 100) + (base > 0 ? Soins : 0)`, avec
 * Int ≤ 0 remplacée par 1 ; la Puissance n'augmente pas les soins. Ajouts Dofus 3 (port Haxe, INCERTAINS) :
 * carac de l'élément pour les soins élémentaires, Puissance Sorts (98), multiplicateur de soins finaux.
 * Le plafonnement aux PV manquants de la cible est séparé (`capHeal`).
 */
import { Element, ELEMENT_MAIN_STAT, type Stats } from '../core/types'
import type { DamageMode } from './math'

export interface HealOptions {
  /** Élément du soin (D3 : soins Eau/Terre/Air boostés par leur carac). Défaut Feu = Intelligence (effets 81/108). */
  element?: Element
  /** Soin d'arme : la maîtrise d'arme s'ajoute à l'Intelligence (client D2). */
  isWeapon?: boolean
  /** Puissance Sorts (98) ajoutée à la carac (port D3) — INCERTAIN. */
  spellPower?: number
  /** % soins finaux (143 `dealtHealMultiplier` / effets 2971-2972) : `× (100 + x) / 100` — INCERTAIN. */
  finalHealPct?: number
  /** Efficacité de zone (0..1) appliquée au soin final (client D2). */
  efficiency?: number
}

/** Soin d'un jet `base` (avant plafonnement aux PV manquants). */
export function heal(base: number, healer: Stats, opts?: HealOptions): number {
  const carac = healer[ELEMENT_MAIN_STAT[opts?.element ?? Element.Fire]]
  // Client D2 : `int <= 0 ? 1 : int + (arme ? maîtrise : 0)` (test sur la carac seule).
  const stat = (carac <= 0 ? 1 : carac + (opts?.isWeapon ? healer.weaponSkillPct : 0)) + (opts?.spellPower ?? 0)
  let h = Math.floor((base * (100 + stat)) / 100) + (base > 0 ? healer.heals : 0)
  if (opts?.finalHealPct) h = Math.floor((h * (100 + opts.finalHealPct)) / 100)
  if (opts?.efficiency !== undefined && opts.efficiency !== 1) h = Math.trunc(h * opts.efficiency)
  return h > 0 ? h : 0
}

/** Soin réellement appliqué : plafonné aux PV manquants (PV max courants, donc érodés). */
export function capHeal(amount: number, hp: number, maxHp: number): number {
  const missing = maxHp - hp
  const v = amount < missing ? amount : missing
  return v > 0 ? v : 0
}

/**
 * Vol de vie : le lanceur est soigné de `floor(PV réellement perdus / 2)` (DoMath `Math.floor(E/2)`, port D3
 * `LifeStealMultiplicator = 0.5`, D2 `int(min(PV cible, dégâts)/2)`). Les vols élémentaires (91-95, 2828) sont un
 * dégât normal suivi de ce soin, plafonné par `capHeal`. Pas de vol si la cible est le lanceur.
 */
export function lifeSteal(lifeLost: number): number {
  return lifeLost > 0 ? Math.floor(lifeLost / 2) : 0
}

/** Soin de X % des derniers dégâts subis (DoMath `HEAL_LAST_DAMAGE` : `floor(X / 100 × dernierDégât)`). */
export function healLastDamage(percent: number, lastDamage: number, mode: DamageMode = 'domath'): number {
  const v = mode === 'domath' ? Math.floor((percent / 100) * lastDamage) : Math.floor((percent * lastDamage) / 100)
  return v > 0 ? v : 0
}

/** Soin en % des PV max de la cible (1109, non boosté) : `floor(PVmax × X / 100)`. */
export function healPercentMaxHp(maxHp: number, percent: number): number {
  return Math.max(0, Math.floor((maxHp * percent) / 100))
}

/** Bouclier en % des PV max du lanceur (1039) : `floor(PVmax × X / 100)`. */
export function shieldFromMaxHp(maxHp: number, percent: number): number {
  return Math.max(0, Math.floor((maxHp * percent) / 100))
}

/** Bouclier en % du niveau du lanceur (1020) : arrondi loin de zéro de `niveau × X / 100` (port D3 `GetTotalShield`). */
export function shieldFromLevel(level: number, percent: number): number {
  const v = (level * percent) / 100
  return Math.max(0, v < 0 ? -Math.round(-v) : Math.round(v))
}
