/**
 * Modificateurs de sorts et relances (kinds `spell_modifier`, `cooldown` ; docs/research/effects.md §7.10) :
 * un buff porteur d'un `spellMod` { sort = diceNum, clé, valeur = value } est posé sur la cible (en général le
 * lanceur, masque C) pour `duration` tours ; Engine.recomputeStats l'agrège dans `Fighter.spellMods`, lu par cast.ts
 * (`modifiedSpellLevel`) et par les dégâts/soins (`spellBaseDamageBonus`, `spellBaseHealBonus`, spellMods.ts).
 * Cumul limité par `maxStack` (ex. *Flèche d'Immobilisation* : +2 dégâts de base par lancer, 4 cumuls).
 *
 * Relances : 1045 fixe la relance restante du sort `diceNum` à `value` tours, 1036 la réduit de `value` tours
 * (compteur `Fighter.cooldowns`, décrémenté au début du tour du porteur). Avec une durée non nulle, 1036 devient un
 * modificateur permanent de l'intervalle de relance (comme 286).
 */
import type { SpellModKey } from '../../types'
import type { EffectContext } from '../registry'
import { addEffectBuff, enforceMaxStack, isPlaying, recording, registerBuffEffect, signed } from './common'

/** effectId -> [clé, signe appliqué à `value` (0 = valeur fixée), libellé]. */
const MODIFIERS: Record<number, readonly [SpellModKey, number, string]> = {
  280: ['rangeMin', 1, 'Portée minimale'],
  281: ['rangeMax', 1, 'Portée maximale'],
  282: ['rangeBoostable', 0, 'Portée modifiable'],
  283: ['damage', 1, 'Dommages'],
  284: ['heal', 1, 'Soins'],
  285: ['apCost', -1, 'PA'],
  286: ['cooldown', -1, 'relance'],
  287: ['critChance', 1, '% Critique'],
  288: ['noLine', 0, 'lancer en ligne désactivé'],
  289: ['noLos', 0, 'ligne de vue désactivée'],
  290: ['castsPerTurn', 1, 'lancer(s) par tour'],
  291: ['castsPerTarget', 1, 'lancer(s) par cible'],
  292: ['setCooldown', 0, 'relance fixée'],
  293: ['baseDamage', 1, 'dégâts de base'],
  294: ['rangeMax', -1, 'Portée maximale'],
  295: ['rangeMin', -1, 'Portée minimale'],
  296: ['apCost', 1, 'PA'],
  297: ['needTakenCell', 0, 'case occupée nécessaire désactivée'],
  298: ['needFreeCell', 0, 'case libre nécessaire désactivée'],
  299: ['needFreeCell', 0, 'case libre nécessaire activée'],
  314: ['needTakenCell', 0, 'case occupée nécessaire activée'],
  798: ['needVisibleEntity', 0, 'cible visible nécessaire activée'],
  2905: ['setRangeMax', 0, 'Portée maximale fixée'],
  2906: ['setRangeMin', 0, 'Portée minimale fixée'],
  2935: ['baseHeal', 1, 'soins de base'],
}

/** Valeur fixée des effets « activé / désactivé » (le `value` des données vaut 1 dans les deux cas). */
const SWITCH_VALUE: Record<number, number> = { 288: 1, 289: 1, 297: 0, 298: 0, 299: 1, 314: 1, 798: 1, 282: 1 }

export const SPELL_MODIFIER_EFFECT_IDS: number[] = Object.keys(MODIFIERS).map(Number)

function spellName(ctx: EffectContext, spellId: number): string {
  return spellId === 0 ? 'Tous les sorts' : (ctx.engine.data.spell(spellId)?.name ?? `Sort ${spellId}`)
}

function modifierHandler(ctx: EffectContext): void {
  const e = ctx.effect
  const def = MODIFIERS[e.effectId]
  if (!def) return
  const [key, sign, text] = def
  const spellId = e.diceNum
  const set = sign === 0
  const value = set ? (SWITCH_VALUE[e.effectId] ?? e.value) : sign * e.value
  if (!set && !value) return
  for (const t of ctx.targets) {
    if (!t.alive) continue
    enforceMaxStack(ctx, t, spellId)
    const label = recording(ctx)
      ? `${spellName(ctx, spellId)} : ${!set ? `${signed(value)} ${text}` : SWITCH_VALUE[e.effectId] !== undefined ? text : `${text} à ${value}`}`
      : ''
    addEffectBuff(ctx, t, { value, spellMod: set ? { spellId, key, value, set: true } : { spellId, key, value } }, label)
  }
}

registerBuffEffect(SPELL_MODIFIER_EFFECT_IDS, modifierHandler)

// ───────────────────────────── relances ─────────────────────────────

/**
 * 1045 : relance restante du sort `diceNum` fixée à `value` tours. Le moteur décompte `Fighter.cooldowns` au DÉBUT
 * du tour du porteur, le client à la FIN de chacun de ses tours (mechanics.md §4.4, `currentTurn` +1 en fin de tour) :
 * équivalent pour le combattant qui joue, mais une cible qui ne joue pas perdrait un tour de relance. On lui ajoute
 * donc 1 (ex. 1045 v2 posé par une invocation sur son invocateur `h,P` : sort bloqué pendant ses 2 prochains tours).
 */
registerBuffEffect(1045, ctx => {
  const spellId = ctx.effect.diceNum
  const turns = Math.max(0, ctx.effect.value)
  for (const t of ctx.targets) if (t.alive) t.cooldowns[spellId] = turns > 0 && !isPlaying(ctx, t) ? turns + 1 : turns
})

/** 1036 : relance restante du sort `diceNum` réduite de `value` tours (modificateur si `duration` ≠ 0). */
registerBuffEffect(1036, ctx => {
  const spellId = ctx.effect.diceNum
  const turns = ctx.effect.value
  if (ctx.effect.duration !== 0) {
    for (const t of ctx.targets) {
      if (!t.alive) continue
      enforceMaxStack(ctx, t, spellId)
      const label = recording(ctx) ? `${spellName(ctx, spellId)} : -${turns} relance` : ''
      addEffectBuff(ctx, t, { value: -turns, spellMod: { spellId, key: 'cooldown', value: -turns } }, label)
    }
    return
  }
  for (const t of ctx.targets) {
    if (!t.alive) continue
    const cd = t.cooldowns[spellId] ?? 0
    if (cd > 0) t.cooldowns[spellId] = Math.max(0, cd - turns)
  }
})
