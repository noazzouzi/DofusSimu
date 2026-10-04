/**
 * Buffs / débuffs / vols de caractéristiques (kinds `stat_buff`, `stat_debuff`, `stat_steal` de
 * data/research/effect-semantics.json ; docs/research/effects.md §7.4).
 *
 * Correspondance effectId -> caractéristique :
 *  - lignes « stat » de data/research/characteristics-map.json, déjà recopiées par src/stats/effects.ts
 *    (`itemEffectStat` / `itemEffectSign` : 118 +Force, 157 −Force, 210 +% Rés. Terre, 2803 +% Rés. mêlée…) ;
 *  - lignes « fightBuff » (buffs de combat, absentes des objets) : table FIGHT_LINES ci-dessous.
 * La valeur est tirée dans [diceNum, diceSide] (moyenne en mode 'average') et devient un `statDelta` pour `duration`
 * tours. La Vitalité (125, 1078, 1033, 2844) modifie aussi les PV max/courants (Engine.applyPoolDelta).
 * Déclencheurs : perte de portée 'R', de PA 'APA', de PM 'MPA' sur la cible.
 */
import type { Stats, StatKey } from '../../../core/types'
import { itemEffectSign, itemEffectStat } from '../../../stats/effects'
import type { Fighter } from '../../types'
import type { EffectContext } from '../registry'
import { addEffectBuff, enforceMaxStack, recording, registerBuffEffect, rollValue, signed } from './common'

/** Mode de calcul du montant. */
const enum Mode {
  /** Montant = jet. */
  Flat = 0,
  /** % des PV max « hors contexte » (PV max de début de combat) — 1078 / 1033. */
  BaseLifePct = 1,
  /** % des PV max actuels — 2844 / 2845. */
  MaxLifePct = 2,
  /** % de la valeur actuelle de la caractéristique — 2847, 2849… (formule INCERTAINE, formulas.md §2). */
  StatPct = 3,
}

interface StatDef {
  /** Caractéristique modifiée (`undefined` : buff « lu par effectId », ex. érosion 776 via Engine.erosionPercent). */
  stat: keyof Stats | undefined
  sign: 1 | -1
  mode: Mode
}

/** Buffs de combat hors lignes d'objets : [effectId, caractéristique, signe, mode]. */
const FIGHT_LINES: readonly (readonly [number, keyof Stats | undefined, 1 | -1, Mode])[] = [
  [136, 'range', 1, Mode.Flat], // « +#1 Portée (lanceur) »
  [107, 'reflect', 1, Mode.Flat], // « #1 Dommages Renvoyés » (même carac que 220, INCERTAIN)
  [1076, 'allResPct', 1, Mode.Flat],
  [1077, 'allResPct', -1, Mode.Flat],
  [1171, 'finalDamagePct', 1, Mode.Flat],
  [1172, 'finalDamagePct', -1, Mode.Flat],
  [2971, 'finalHealPct', 1, Mode.Flat],
  [2972, 'finalHealPct', -1, Mode.Flat],
  [1027, 'comboDamagePct', 1, Mode.Flat],
  [1054, 'spellPower', 1, Mode.Flat],
  // Érosion : pas de clé Stats, le moteur somme la valeur des buffs 776/3804 (Engine.erosionPercent).
  [776, undefined, 1, Mode.Flat],
  [3804, undefined, -1, Mode.Flat],
  [1078, 'vitality', 1, Mode.BaseLifePct],
  [1033, 'vitality', -1, Mode.BaseLifePct],
  [2844, 'vitality', 1, Mode.MaxLifePct],
  [2845, 'vitality', -1, Mode.MaxLifePct],
  [2847, 'ap', -1, Mode.StatPct],
  [2849, 'mp', -1, Mode.StatPct],
  [2851, 'tackleBlock', -1, Mode.StatPct],
  [2853, 'tackleEvade', -1, Mode.StatPct],
  [2857, 'mpParry', -1, Mode.StatPct],
]

/** Vols de caractéristique : la cible perd X, le lanceur gagne X (même durée). */
const STEAL_LINES: readonly (readonly [number, StatKey])[] = [
  [266, 'chance'],
  [267, 'vitality'],
  [268, 'agility'],
  [269, 'intelligence'],
  [271, 'strength'],
  [320, 'range'],
]

/** PA/PM retirés de façon non esquivable : interprétés par apmp.ts (déclencheurs, métriques). */
const HANDLED_ELSEWHERE = new Set([168, 169])
/** Parchemins (606-611) : bonus permanents d'objets, pas des buffs de combat. */
const SCROLLS = new Set([606, 607, 608, 609, 610, 611])

const MAX_ID = 4096
const DEFS: (StatDef | undefined)[] = new Array<StatDef | undefined>(MAX_ID)
const STEALS: (StatKey | undefined)[] = new Array<StatKey | undefined>(MAX_ID)

/** Ids des buffs/débuffs de caractéristiques interprétés ici. */
export const STAT_EFFECT_IDS: number[] = []
/** Ids des vols de caractéristiques. */
export const STEAL_EFFECT_IDS: number[] = STEAL_LINES.map(([id]) => id)

for (let id = 0; id < MAX_ID; id++) {
  if (HANDLED_ELSEWHERE.has(id) || SCROLLS.has(id)) continue
  const stat = itemEffectStat(id)
  const sign = itemEffectSign(id)
  if (stat && sign) {
    DEFS[id] = { stat, sign, mode: Mode.Flat }
    STAT_EFFECT_IDS.push(id)
  }
}
for (const [id, stat, sign, mode] of FIGHT_LINES) {
  if (!DEFS[id]) STAT_EFFECT_IDS.push(id)
  DEFS[id] = { stat, sign, mode }
}
for (const [id, stat] of STEAL_LINES) STEALS[id] = stat

/** Caractéristique et signe d'un effet de buff (pour l'IA / l'affichage), ou undefined. */
export function statBuffDef(effectId: number): { stat: keyof Stats | undefined; sign: 1 | -1 } | undefined {
  return effectId >= 0 && effectId < MAX_ID ? DEFS[effectId] : undefined
}

const STAT_LABELS: Partial<Record<keyof Stats, string>> = {
  vitality: 'Vitalité', wisdom: 'Sagesse', strength: 'Force', intelligence: 'Intelligence', chance: 'Chance',
  agility: 'Agilité', ap: 'PA', mp: 'PM', range: 'Portée', summons: 'Invocation', initiative: 'Initiative',
  prospecting: 'Prospection', critical: '% Critique', heals: 'Soins', power: 'Puissance', damage: 'Dommages',
  neutralDamage: 'Dommages Neutre', earthDamage: 'Dommages Terre', fireDamage: 'Dommages Feu',
  waterDamage: 'Dommages Eau', airDamage: 'Dommages Air', criticalDamage: 'Dommages Critiques',
  pushDamage: 'Dommages Poussée', trapDamage: 'Dommages Pièges', trapPower: 'Puissance Pièges',
  spellDamagePct: '% Dommages aux sorts', weaponDamagePct: "% Dommages d'armes", meleeDamagePct: '% Dommages mêlée',
  rangedDamagePct: '% Dommages distance', finalDamagePct: '% Dommages finaux', apReduction: 'Retrait PA',
  mpReduction: 'Retrait PM', apParry: 'Esquive PA', mpParry: 'Esquive PM', tackleBlock: 'Tacle', tackleEvade: 'Fuite',
  neutralResPct: '% Résistance Neutre', earthResPct: '% Résistance Terre', fireResPct: '% Résistance Feu',
  waterResPct: '% Résistance Eau', airResPct: '% Résistance Air', neutralRes: 'Résistance Neutre',
  earthRes: 'Résistance Terre', fireRes: 'Résistance Feu', waterRes: 'Résistance Eau', airRes: 'Résistance Air',
  criticalRes: 'Résistance Critiques', pushRes: 'Résistance Poussée', meleeResPct: '% Résistance mêlée',
  rangedResPct: '% Résistance distance', spellResPct: '% Résistance aux sorts', weaponResPct: "% Résistance aux armes",
  reflect: 'Dommages Renvoyés', allResPct: '% Résistance', finalHealPct: '% Soins finaux',
  comboDamagePct: '% Dommages Combo', spellPower: 'Puissance Sorts',
}

export function statLabel(stat: keyof Stats | undefined, effectId: number): string {
  if (stat) return STAT_LABELS[stat] ?? stat
  return effectId === 776 || effectId === 3804 ? '% Érosion' : `Effet ${effectId}`
}

/** Montant (positif) d'un buff selon son mode de calcul. */
function amountOf(def: StatDef, target: Fighter, roll: number): number {
  switch (def.mode) {
    case Mode.BaseLifePct:
      return Math.floor((target.baseMaxHp * roll) / 100)
    case Mode.MaxLifePct:
      return Math.floor((target.maxHp * roll) / 100)
    case Mode.StatPct: {
      const cur = def.stat ? (target.stats[def.stat] ?? 0) : 0
      return cur > 0 ? Math.round((cur * roll) / 100) : 0
    }
    default:
      return roll
  }
}

/** `statDelta` d'un montant signé ; la Sagesse apporte aussi 1/10 en Retrait et Esquive PA/PM (déjà inclus dans les stats). */
function deltaOf(stat: keyof Stats, delta: number): Partial<Stats> {
  if (stat === 'wisdom') {
    const d = Math.trunc(delta / 10)
    return { wisdom: delta, apReduction: d, mpReduction: d, apParry: d, mpParry: d }
  }
  const out: Partial<Stats> = {}
  out[stat] = delta
  return out
}

/** Déclencheurs de perte de portée / PA / PM sur la cible d'un malus. */
export function fireLossTriggers(ctx: EffectContext, target: Fighter, stat: keyof Stats | undefined, amount: number): void {
  if (!target.alive) return
  if (stat === 'range') ctx.engine.trigger(ctx.fight, target, { type: 'R', source: ctx.caster, amount })
  else if (stat === 'ap') ctx.engine.trigger(ctx.fight, target, { type: 'APA', source: ctx.caster, amount })
  else if (stat === 'mp') ctx.engine.trigger(ctx.fight, target, { type: 'MPA', source: ctx.caster, amount })
}

/**
 * Pose un buff de caractéristique sur `target` : `magnitude` positive, `sign` du buff. Retourne la valeur signée
 * appliquée (0 si rien n'a été posé).
 */
export function applyStatBuff(
  ctx: EffectContext,
  target: Fighter,
  stat: keyof Stats | undefined,
  sign: 1 | -1,
  amount: number,
): number {
  if (!amount || !target.alive) return 0
  enforceMaxStack(ctx, target)
  const delta = sign * amount
  const label = recording(ctx) ? `${signed(delta)} ${statLabel(stat, ctx.effect.effectId)}` : ''
  addEffectBuff(ctx, target, stat ? { value: delta, statDelta: deltaOf(stat, delta) } : { value: delta }, label)
  if (sign < 0) fireLossTriggers(ctx, target, stat, amount)
  return delta
}

function statBuffHandler(ctx: EffectContext): void {
  const def = DEFS[ctx.effect.effectId]
  if (!def) return
  for (const t of ctx.targets) applyStatBuff(ctx, t, def.stat, def.sign, amountOf(def, t, rollValue(ctx)))
}

function stealHandler(ctx: EffectContext): void {
  const stat = STEALS[ctx.effect.effectId]
  if (!stat) return
  const caster = ctx.caster
  for (const t of ctx.targets) {
    if (t.id === caster.id) continue
    const v = rollValue(ctx)
    if (!v || !t.alive) continue
    applyStatBuff(ctx, t, stat, -1, v)
    if (caster.alive) applyStatBuff(ctx, caster, stat, 1, v)
  }
}

registerBuffEffect(STAT_EFFECT_IDS, statBuffHandler)
registerBuffEffect(STEAL_EFFECT_IDS, stealHandler)
