/**
 * Famille « damage » (kinds damage, life_steal, heal, shield, damage_modifier de data/research/effect-semantics.json ;
 * docs/research/effects.md §3, §7.1, §7.2, §7.5 ; formulas.md) :
 *  - dommages élémentaires (96-100, meilleur / pire élément 2822 / 2832), vols de vie (91-95, 2828, 2890, 82),
 *    dommages fixes non boostés (144, 1063-1066), dommages selon les PM restants (1012-1016),
 *    dommages en % de PV (85-89, 275-279, 671, 672, 1067-1071, 1092-1096, 1118-1122), perte de PV (1047, 1048) ;
 *  - renvois de dommages (1123-1128 initiaux, 1223-1228 finaux, 2829 / 2830 / 2891 / 2896) ;
 *  - soins (81, 108, 2998-3002 boostés ; 143, 407 fixes ; 1109 % PV max ; 90 transfert ; 786 soin des attaquants ;
 *    2020 % des dommages subis ; 2973 % des dommages occasionnés) ;
 *  - boucliers (1020 % du niveau, 1039 % des PV max, 1040 fixe) suivis PAR BUFF (expiration / désenvoûtement) ;
 *  - modificateurs (1163 dommages subis, 1159 soins reçus, 265 / 105 réduction fixe, 765 interception, 1061 partage,
 *    1164 conversion en soins) : buffs posés par le noyau (déclencheurs) ou ici (instantanés à durée), CONSOMMÉS au
 *    moment du calcul du dommage / soin (damage/pipeline.ts) ; leur exécution déclenchée est donc sans effet.
 *
 * Le calcul et l'application des dommages passent tous par `computeAndApplyDamage` (damage/pipeline.ts).
 */
import { Element } from '../../core/types'
import { healLastDamage, healPercentMaxHp, shieldFromLevel, shieldFromMaxHp } from '../../damage/heal'
import type { Engine } from '../engine'
import type { Buff, Fighter, FightState } from '../types'
import {
  applySplashDamage,
  castDamageDealt,
  computeAndApplyDamage,
  computeHeal,
  currentDamage,
  DAMAGE_SPECS,
  deliverHeal,
  EL_BEST,
  EL_SOURCE,
  EL_WORST,
  isSplashing,
  MOD_ARMOR,
  MOD_ARMOR_D2,
  MOD_DAMAGE_TO_HEAL,
  MOD_INTERCEPT,
  MOD_RECEIVED_DAMAGE,
  MOD_RECEIVED_HEAL,
  MOD_SHARE,
  resolveElement,
  rollEffectValue,
  splashRecipients,
  triggerHolder,
} from './damage/pipeline'
import { registerEffect, type EffectContext } from './registry'

export {
  computeAndApplyDamage,
  computeHeal,
  currentDamage,
  damageKindOf,
  deliverHeal,
  isMeleeHit,
  receivedHealPercent,
  sustainedPercent,
} from './damage/pipeline'

export const FAMILY = 'damage'

// ───────────────────────────── dommages ─────────────────────────────

function damageHandler(ctx: EffectContext): void {
  for (const t of ctx.targets) {
    if (ctx.fight.ended) return
    computeAndApplyDamage(ctx, t)
  }
}

/**
 * Perte de PV (1048 : % des PV ACTUELS, 1047 : fixe) — « faux dommage » (port D3 IsFakeDamage) : ni résistances,
 * ni multiplicateurs, ni bouclier. Avec une durée, un buff indicatif « −X PV » est posé (pas de restitution).
 */
function lifeLossHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  for (const t of ctx.targets) {
    if (!t.alive) continue
    const v = rollEffectValue(ctx)
    const amount = effect.effectId === 1048 ? Math.floor((t.hp * v) / 100) : Math.round(v)
    if (amount <= 0) continue
    engine.applyDamage(fight, t === caster ? undefined : caster, t, amount, -1, 'indirect', { ignoreShield: true })
    if (effect.duration !== 0 && t.alive) {
      engine.addBuff(fight, t, {
        sourceId: caster.id,
        spellId: ctx.spellId,
        effect,
        value: amount,
        remaining: effect.duration < 0 ? -1 : effect.duration,
        delay: 0,
        dispellable: effect.dispellable === 1,
        kind: 'special',
        label: `-${amount} PV`,
      })
    }
  }
}

// ───────────────────────────── renvois (dommages et soins) ─────────────────────────────

/** Dommage de référence d'un renvoi : celui qui a déclenché l'effet, sinon le dernier subi par le lanceur. */
const SRC = { final: 0, raw: 0, element: -1, center: -1 }

function tagNumber(f: Fighter, key: string, def = 0): number {
  const v = f.tags[key]
  return typeof v === 'number' ? v : def
}

function splashSource(ctx: EffectContext): typeof SRC {
  const t = ctx.trigger
  const top = currentDamage()
  if (t && t.type === 'D') {
    // Dommage en cours (pile) : valeur finale avant bouclier, valeur initiale, case de la cible (même morte).
    SRC.final = top ? top.final : (t.amount ?? 0)
    SRC.raw = top ? top.raw : SRC.final
    SRC.element = top ? top.element : (t.element ?? -1)
    SRC.center = top ? top.cell : triggerHolder(ctx).cell
  } else {
    // Porteur = lanceur (sous-sort lancé par le porteur, effet instantané) : derniers dommages subis.
    const p = ctx.caster
    SRC.final = tagNumber(p, 'lastDmgFinal')
    SRC.raw = tagNumber(p, 'lastDmgRaw')
    SRC.element = tagNumber(p, 'lastDmgElement', -1)
    SRC.center = p.cell
  }
  return SRC
}

/** Renvois de dommages : [initial ?, élément]. */
const SPLASH_DAMAGE: Record<number, readonly [boolean, number]> = {
  1123: [true, EL_SOURCE],
  1124: [true, Element.Neutral],
  1125: [true, Element.Air],
  1126: [true, Element.Fire],
  1127: [true, Element.Water],
  1128: [true, Element.Earth],
  2829: [true, EL_BEST],
  2896: [true, EL_WORST],
  1223: [false, EL_SOURCE],
  1224: [false, Element.Neutral],
  1225: [false, Element.Air],
  1226: [false, Element.Fire],
  1227: [false, Element.Water],
  1228: [false, Element.Earth],
  2830: [false, EL_BEST],
  2891: [false, EL_WORST],
}

/**
 * 1223 & co : `diceNum` % des dommages finaux (ou initiaux : 1123 & co) subis par le porteur, dans le même élément,
 * infligés aux entités de la zone — non boostés, sans dégressivité, réduits par les résistances des receveurs ;
 * un renvoi ne déclenche pas d'autre renvoi.
 */
function splashDamageHandler(ctx: EffectContext): void {
  if (isSplashing()) return
  const def = SPLASH_DAMAGE[ctx.effect.effectId]
  if (!def) return
  const src = splashSource(ctx)
  const ref = def[0] ? src.raw : src.final
  if (ref <= 0) return
  const el = def[1] === EL_SOURCE ? (src.element >= 0 && src.element <= 4 ? (src.element as Element) : -1) : resolveElement(def[1], ctx.caster.stats)
  const pct = rollEffectValue(ctx)
  for (const r of splashRecipients(ctx, src.center)) {
    if (ctx.fight.ended) return
    applySplashDamage(ctx, r, pct, ref, el)
  }
}

/** 2020 : soin de `diceNum` % des dommages subis par le porteur (Perfusion), aux entités de la zone. */
function splashHealTakenHandler(ctx: EffectContext): void {
  if (isSplashing()) return
  const src = splashSource(ctx)
  const h = healLastDamage(rollEffectValue(ctx), src.final)
  if (h <= 0) return
  for (const r of splashRecipients(ctx, src.center)) deliverHeal(ctx, r, h)
}

/**
 * 2973 : soin de `diceNum` % des dommages occasionnés — par le lancer en cours (effet instantané : Poisse,
 * Lamentations), ou du dommage déclencheur (buff D : Distribution).
 */
function splashHealDealtHandler(ctx: EffectContext): void {
  const t = ctx.trigger
  let base: number
  let recipients: Fighter[]
  if (t && t.type === 'D') {
    const src = splashSource(ctx)
    base = src.final
    recipients = splashRecipients(ctx, src.center)
  } else {
    base = castDamageDealt(ctx)
    recipients = ctx.targets
  }
  const h = healLastDamage(rollEffectValue(ctx), base)
  if (h <= 0) return
  for (const r of recipients) deliverHeal(ctx, r, h)
}

// ───────────────────────────── soins ─────────────────────────────

/** Soins boostés : élément du soin (carac utilisée) ; 81 sans élément = Intelligence (formulas.md §7). */
const HEAL_ELEMENTS: Record<number, number> = {
  81: Element.Fire,
  108: Element.Fire,
  2998: Element.Water,
  2999: Element.Air,
  3000: Element.Earth,
  3001: Element.Neutral,
  3002: EL_BEST,
}

function healHandler(ctx: EffectContext): void {
  const code = HEAL_ELEMENTS[ctx.effect.effectId]
  for (const t of ctx.targets) {
    if (!t.alive) continue
    const el = resolveElement(code, ctx.caster.stats)
    deliverHeal(ctx, t, computeHeal(ctx, t, ctx.effect, el === -1 ? Element.Fire : el))
  }
}

/** Soins non boostés (143, 407) : valeur du jet. */
function fixedHealHandler(ctx: EffectContext): void {
  for (const t of ctx.targets) if (t.alive) deliverHeal(ctx, t, Math.round(rollEffectValue(ctx)))
}

/** 1109 : soin de `diceNum` % des PV max (courants) de la cible, non boosté. */
function percentMaxHpHealHandler(ctx: EffectContext): void {
  for (const t of ctx.targets) if (t.alive) deliverHeal(ctx, t, healPercentMaxHp(t.maxHp, rollEffectValue(ctx)))
}

/** 90 : le lanceur perd `diceNum` % de ses PV actuels et la cible est soignée du même montant. */
function transferHandler(ctx: EffectContext): void {
  const { engine, fight, caster } = ctx
  for (const t of ctx.targets) {
    if (t === caster || !t.alive || !caster.alive) continue
    const amount = Math.floor((caster.hp * rollEffectValue(ctx)) / 100)
    if (amount <= 0) continue
    engine.applyDamage(fight, undefined, caster, amount, -1, 'indirect', { ignoreShield: true })
    deliverHeal(ctx, t, amount)
  }
}

/** 786 (buff D) : l'attaquant du porteur est soigné de `value` % des dommages infligés. */
function healAttackersHandler(ctx: EffectContext): void {
  const t = ctx.trigger
  if (!t || t.type !== 'D' || !t.source || !t.source.alive) return
  const top = currentDamage()
  const dealt = top ? top.final : (t.amount ?? 0)
  const pct = ctx.effect.value || ctx.effect.diceNum
  const h = Math.floor((dealt * pct) / 100)
  if (h > 0) deliverHeal(ctx, t.source, h)
}

// ───────────────────────────── boucliers ─────────────────────────────

export const SHIELD_EFFECTS: ReadonlySet<number> = new Set([1020, 1039, 1040])

/** Buff de bouclier posé par ce module : `value` = points de bouclier restants de ce buff. */
export function isShieldBuff(b: Buff): boolean {
  return b.kind === 'special' && SHIELD_EFFECTS.has(b.effect.effectId)
}

const HOOKED = new WeakSet<Engine>()

/**
 * Installe le suivi des boucliers par buff sur un moteur (idempotent ; fait automatiquement au premier bouclier) :
 * les points absorbés sont retirés des buffs de bouclier du plus ancien au plus récent (buff vidé ⇒ retiré), et un
 * buff de bouclier qui expire ou est désenvoûté emporte ses points restants.
 */
export function installDamageHooks(engine: Engine): void {
  if (HOOKED.has(engine)) return
  HOOKED.add(engine)
  const prevAbsorbed = engine.hooks.onShieldAbsorbed
  engine.hooks.onShieldAbsorbed = (fight, target, absorbed) => {
    prevAbsorbed?.(fight, target, absorbed)
    consumeShieldBuffs(engine, fight, target, absorbed)
  }
  const prevRemoved = engine.hooks.onBuffRemoved
  engine.hooks.onBuffRemoved = (fight, target, buff) => {
    prevRemoved?.(fight, target, buff)
    if (isShieldBuff(buff) && buff.value > 0) target.shield = Math.max(0, target.shield - buff.value)
  }
}

function consumeShieldBuffs(engine: Engine, fight: FightState, target: Fighter, absorbed: number): void {
  let rest = absorbed
  let emptied: number[] | undefined
  for (const b of target.buffs) {
    if (rest <= 0) break
    if (!isShieldBuff(b) || b.value <= 0) continue
    const take = b.value < rest ? b.value : rest
    b.value -= take
    rest -= take
    if (b.value <= 0) (emptied ??= []).push(b.uid)
  }
  if (emptied) for (const uid of emptied) engine.removeBuff(fight, target, uid)
}

/** Donne `amount` points de bouclier à `target` pour la durée de l'effet (buff suivi) et déclenche CS du lanceur. */
export function giveShield(ctx: EffectContext, target: Fighter, amount: number): void {
  const { engine, fight, caster, effect } = ctx
  const a = Math.floor(amount)
  if (a <= 0 || !target.alive) return
  installDamageHooks(engine)
  engine.addShield(fight, caster, target, a)
  const dur = effect.duration
  engine.addBuff(fight, target, {
    sourceId: caster.id,
    spellId: ctx.spellId,
    effect,
    value: a,
    remaining: dur < 0 ? -1 : dur === 0 ? 1 : dur,
    delay: 0,
    dispellable: effect.dispellable === 1,
    kind: 'special',
    crit: ctx.crit,
    label: `Bouclier ${a}`,
  })
  if (caster.alive) engine.trigger(fight, caster, { type: 'CS', source: caster, amount: a })
}

/** Boucliers : 1020 = round(niveau du lanceur × X / 100), 1039 = X % des PV max du lanceur, 1040 = jet. */
function shieldHandler(ctx: EffectContext): void {
  const { caster, effect } = ctx
  for (const t of ctx.targets) {
    const v = rollEffectValue(ctx)
    const amount =
      effect.effectId === 1020 ? shieldFromLevel(caster.level, v) : effect.effectId === 1039 ? shieldFromMaxHp(caster.maxHp, v) : Math.round(v)
    giveShield(ctx, t, amount)
  }
}

// ───────────────────────────── modificateurs ─────────────────────────────

const MODIFIER_LABELS: Record<number, string> = {
  [MOD_RECEIVED_DAMAGE]: 'Dommages subis',
  [MOD_RECEIVED_HEAL]: 'Soins reçus',
  [MOD_ARMOR]: 'Réduction',
  [MOD_ARMOR_D2]: 'Réduction',
  [MOD_INTERCEPT]: 'Interception',
  [MOD_SHARE]: 'Partage des dommages',
  [MOD_DAMAGE_TO_HEAL]: 'Dommages convertis en soins',
}

/**
 * Modificateurs : déclenchés (buff posé par le noyau), ils ont déjà été appliqués au calcul du dommage / soin qui
 * les déclenche ⇒ rien à faire ; instantanés avec une durée, ils deviennent un buff spécial toujours actif.
 */
function modifierHandler(ctx: EffectContext): void {
  if (ctx.trigger) return
  const { engine, fight, caster, effect } = ctx
  if (effect.duration === 0) return
  const id = effect.effectId
  const armor = id === MOD_ARMOR || id === MOD_ARMOR_D2
  for (const t of ctx.targets) {
    if (!t.alive) continue
    const v = armor ? effect.value + Math.round(rollEffectValue(ctx)) : Math.round(rollEffectValue(ctx))
    engine.addBuff(fight, t, {
      sourceId: caster.id,
      spellId: ctx.spellId,
      effect,
      value: v,
      remaining: effect.duration < 0 ? -1 : effect.duration,
      delay: 0,
      dispellable: effect.dispellable === 1,
      kind: 'special',
      label: id === MOD_RECEIVED_DAMAGE || id === MOD_RECEIVED_HEAL ? `${MODIFIER_LABELS[id]} ×${v} %` : `${MODIFIER_LABELS[id]} ${v || ''}`.trim(),
    })
  }
}

// ───────────────────────────── enregistrement ─────────────────────────────

registerEffect([...DAMAGE_SPECS.keys()], FAMILY, damageHandler)
registerEffect([1047, 1048], FAMILY, lifeLossHandler)
registerEffect(Object.keys(SPLASH_DAMAGE).map(Number), FAMILY, splashDamageHandler)
registerEffect(2020, FAMILY, splashHealTakenHandler)
registerEffect(2973, FAMILY, splashHealDealtHandler)
registerEffect(Object.keys(HEAL_ELEMENTS).map(Number), FAMILY, healHandler)
registerEffect([143, 407], FAMILY, fixedHealHandler)
registerEffect(1109, FAMILY, percentMaxHpHealHandler)
registerEffect(90, FAMILY, transferHandler)
registerEffect(786, FAMILY, healAttackersHandler)
registerEffect([...SHIELD_EFFECTS], FAMILY, shieldHandler)
registerEffect(Object.keys(MODIFIER_LABELS).map(Number), FAMILY, modifierHandler)
