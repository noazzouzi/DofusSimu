/**
 * Registre des interprètes d'effets de sorts (effectId DofusDB -> handler).
 * Chaque famille d'effets (dégâts, déplacements, buffs, invocations, glyphes...) s'enregistre ici.
 * Les effets inconnus sont comptés pour mesurer la couverture du moteur.
 */
import type { EffectData } from '../../data/model'
import type { Engine } from '../engine'
import type { Fighter, FightState, KnownSpell } from '../types'

export interface EffectContext {
  engine: Engine
  fight: FightState
  caster: Fighter
  /** Sort lancé (null si l'effet vient d'une glyphe, d'un piège, d'un déclencheur...). */
  spell: KnownSpell | null
  spellId: number
  effect: EffectData
  /** Cellule ciblée par le lancer. */
  targetCell: number
  /** Cellule d'origine du lanceur au moment du lancer (pour les directions de poussée...). */
  casterCell: number
  /** Cellules de la zone de cet effet. */
  cells: number[]
  /** Cibles retenues (zone ∩ masque de cibles), dans l'ordre d'application. */
  targets: Fighter[]
  /** Efficacité par cible (baisse de dommages en zone), 1 = 100 %. */
  efficiency: Map<number, number>
  crit: boolean
  /** Lancer issu d'un piège / glyphe / poison / déclencheur (dommages indirects). */
  indirect: boolean
  /** Profondeur de récursion (sorts lançant des sorts). */
  depth: number
}

export type EffectHandler = (ctx: EffectContext) => void

export interface EffectHandlerEntry {
  handler: EffectHandler
  /** Famille, pour le diagnostic de couverture. */
  family: string
  /** L'effet s'applique-t-il une fois par cible (true) ou une fois par lancer (false) ? */
  perTarget: boolean
}

const REGISTRY = new Map<number, EffectHandlerEntry>()
const UNKNOWN = new Map<number, number>()

export function registerEffect(ids: number | number[], family: string, handler: EffectHandler, perTarget = true): void {
  for (const id of Array.isArray(ids) ? ids : [ids]) REGISTRY.set(id, { handler, family, perTarget })
}

export function getEffectHandler(effectId: number): EffectHandlerEntry | undefined {
  return REGISTRY.get(effectId)
}

export function noteUnknownEffect(effectId: number): void {
  UNKNOWN.set(effectId, (UNKNOWN.get(effectId) ?? 0) + 1)
}

/** Effets rencontrés sans interprète (effectId -> occurrences). */
export function unknownEffects(): Map<number, number> {
  return UNKNOWN
}

export function registeredEffects(): Map<number, EffectHandlerEntry> {
  return REGISTRY
}
