/**
 * Outils communs aux effets de buffs (caractéristiques, PA/PM, états, modificateurs de sorts) :
 * durée d'un buff, jet de valeur, cumul maximal (`maxStack`), création du buff et libellés.
 *
 * Règles (docs/research/effects.md §2.3, mechanics.md §4.5, §9.1) :
 *  - durée décomptée au début du tour du LANCEUR (Engine.decrementCastedBuffs) ; −1 ou ≥ 63 = permanent ;
 *  - `dispellable` : 1 désenvoûtable (et retiré à la mort), 2 retiré à la mort (et par désenvoûtement fort),
 *    3 désenvoûtement fort uniquement, 4 jamais ; le booléen `Buff.dispellable` vaut `dispellable === 1` ;
 *  - `maxStack` (spell-level) > 0 : quand la cible porte déjà `maxStack` buffs identiques (même sort, même effet,
 *    même paramètre), le plus ancien est retiré avant d'appliquer le nouveau (port D3 `StorePendingBuff`) ; ≤ 0 = illimité.
 */
import type { EffectData, SpellLevelData } from '../../../data/model'
import type { Stats } from '../../../core/types'
import { roll } from '../../random'
import type { Buff, Fighter, SpellModEntry } from '../../types'
import { registerEffect, type EffectContext, type EffectHandler } from '../registry'

/** Famille déclarée au registre (diagnostic de couverture). */
export const FAMILY = 'buffs'

/**
 * Enregistre un interprète de la famille. Les effets `forClientOnly` (purement visuels, ex. le 293 affiché de
 * *Flèche Massacrante*) sont ignorés.
 */
export function registerBuffEffect(ids: number | readonly number[], handler: EffectHandler, perTarget = true): void {
  registerEffect(
    Array.isArray(ids) ? [...ids] : (ids as number),
    FAMILY,
    ctx => {
      if (ctx.effect.clientOnly) return
      handler(ctx)
    },
    perTarget,
  )
}

/** Tours restants d'un buff : −1 (ou ≥ 63) = permanent ; 0 = jusqu'au prochain tour du lanceur (INCERTAIN). */
export function buffDuration(effect: EffectData): number {
  const d = effect.duration
  if (d < 0 || d >= 63) return -1
  return d === 0 ? 1 : d
}

/** Jet de la valeur d'un effet : `diceNum` (fixe) ou dans [diceNum, diceSide] selon le mode de jet du combat. */
export function rollValue(ctx: EffectContext): number {
  const e = ctx.effect
  const min = e.diceNum
  const max = e.diceSide > min ? e.diceSide : min
  return max === min ? min : roll(ctx.fight, min, max)
}

// ───────────────────────────── cumul (maxStack) ─────────────────────────────

/** effectUid DofusDB -> maxStack du spell-level qui le contient (sous-sorts, effets déclenchés). */
const STACK_BY_UID = new Map<number, number>()

function levelContains(l: SpellLevelData, e: EffectData): boolean {
  for (const x of l.effects) if (x === e || (e.uid !== undefined && x.uid === e.uid)) return true
  for (const x of l.criticalEffects) if (x === e || (e.uid !== undefined && x.uid === e.uid)) return true
  return false
}

/** Spell-level (grade) d'un sort contenant l'effet (identité, sinon effectUid), ou undefined. */
export function levelOfEffect(ctx: EffectContext, spellId: number, e: EffectData): SpellLevelData | undefined {
  const data = ctx.engine.data.spell(spellId)
  if (!data) return undefined
  for (const l of data.levels) if (levelContains(l, e)) return l
  return undefined
}

/** `maxStack` du spell-level de l'effet en cours (≤ 0 = illimité). */
export function spellMaxStack(ctx: EffectContext): number {
  const sp = ctx.spell
  if (sp && sp.spellId === ctx.spellId) return sp.level.maxStack
  const e = ctx.effect
  if (e.uid !== undefined) {
    const c = STACK_BY_UID.get(e.uid)
    if (c !== undefined) return c
  }
  const lvl = levelOfEffect(ctx, ctx.spellId, e) ?? ctx.engine.data.spell(ctx.spellId)?.levels[0]
  const v = lvl?.maxStack ?? 0
  if (e.uid !== undefined) STACK_BY_UID.set(e.uid, v)
  return v
}

/** Paramètre distinguant deux buffs du même effet (sort modifié, état). */
function buffParam(b: Buff): number {
  return b.spellMod?.spellId ?? b.stateId ?? b.disabledStateId ?? 0
}

/**
 * Applique la règle de cumul avant l'ajout d'un buff identique (même sort, même effectId, même paramètre) sur
 * `target` : retire les plus anciens tant que leur nombre atteint `maxStack`.
 */
export function enforceMaxStack(ctx: EffectContext, target: Fighter, param = 0): void {
  const max = spellMaxStack(ctx)
  if (max <= 0) return
  const effectId = ctx.effect.effectId
  for (;;) {
    let count = 0
    let oldest: Buff | undefined
    for (const b of target.buffs) {
      if (b.spellId !== ctx.spellId || b.effect.effectId !== effectId) continue
      if (b.kind === 'trigger' || b.kind === 'delayed' || buffParam(b) !== param) continue
      count++
      oldest ??= b
    }
    if (count < max || !oldest) return
    ctx.engine.removeBuff(ctx.fight, target, oldest.uid)
  }
}

// ───────────────────────────── création ─────────────────────────────

export interface BuffFields {
  /** Valeur résolue signée (ex. −2 PA, +300 Puissance). */
  value: number
  statDelta?: Partial<Stats>
  stateId?: number
  spellMod?: SpellModEntry
  disabledStateId?: number
  passTurn?: boolean
  kind?: Buff['kind']
  /** Tours restants (défaut : `buffDuration(effect)`). */
  remaining?: number
}

/** Pose un buff issu de l'effet en cours sur `target` (lanceur = source du décompte). */
export function addEffectBuff(ctx: EffectContext, target: Fighter, f: BuffFields, label: string): Buff {
  const b: Omit<Buff, 'uid'> = {
    sourceId: ctx.caster.id,
    spellId: ctx.spellId,
    effect: ctx.effect,
    value: f.value,
    remaining: f.remaining ?? buffDuration(ctx.effect),
    delay: 0,
    dispellable: ctx.effect.dispellable === 1,
    label,
    kind: f.kind ?? 'stat',
    crit: ctx.crit,
  }
  if (f.statDelta) b.statDelta = f.statDelta
  if (f.stateId !== undefined) b.stateId = f.stateId
  if (f.spellMod) b.spellMod = f.spellMod
  if (f.disabledStateId !== undefined) b.disabledStateId = f.disabledStateId
  if (f.passTurn) b.passTurn = true
  return ctx.engine.addBuff(ctx.fight, target, b)
}

/** Les libellés ne sont construits que si le combat est enregistré (pas pendant les simulations de l'IA). */
export function recording(ctx: EffectContext): boolean {
  return ctx.fight.options.record
}

/** Formate une valeur signée (« +300 », « −2 ») ; arrondie à 2 décimales en mode moyenne. */
export function signed(v: number): string {
  const r = Math.round(v * 100) / 100
  return r >= 0 ? `+${r}` : `${r}`
}

/** Le combattant est-il celui dont c'est le tour ? */
export function isPlaying(ctx: EffectContext, f: Fighter): boolean {
  return ctx.fight.timeline[ctx.fight.turnIndex] === f.id
}
