/**
 * Pipeline de dommages et de soins du moteur (famille « damage ») : construit l'entrée des formules DoMath
 * (src/damage) à partir des caractéristiques du lanceur et de la cible ET des buffs actifs, tire le jet selon
 * `fight.options.rollMode` (espérance exacte, coup critique pondéré, en mode 'average'), puis applique le résultat
 * via `Engine.applyDamage` / `Engine.heal`.
 *
 * Modificateurs lus au moment du calcul (buffs « consommés » par le dommage, docs/research/effects.md §7.5) :
 *  - cible : dommages subis ×N % (1163), réduction fixe / armure (265, 105 : × (1 + niveau du porteur / 20)),
 *    interception (765), partage (1061), conversion en soin (1164), renvoi (carac « Dommages Renvoyés »),
 *    % résistance globale (`allResPct`, 1076/1077 via la famille buffs) ;
 *  - lanceur : % dommages finaux (1171/1172 → `finalDamagePct`), Puissance aux sorts (`spellPower`), bonus de base du
 *    sort (293, 2935) et de dommages du sort (283) via `spellMods`, % soins finaux (2971/2972 → `finalHealPct`).
 * Un buff déclencheur (triggers ≠ 'I', posé par le noyau) ne s'applique que si le dommage le déclencherait
 * (`triggerMatches`, port D3 `ShouldBeTriggeredOnTargetDamage`) ; un buff instantané à durée s'applique toujours.
 *
 * Performances : objets de travail réutilisés (entrée DoMath, paramètres préparés, événement de déclenchement,
 * pile des dommages en cours) — aucune allocation par dommage dans le chemin standard.
 */
import { Element, ELEMENT_RES_PCT, type Stats } from '../../../core/types'
import type { EffectData, SpellLevelData, ZoneSpec } from '../../../data/model'
import {
  bestElement,
  createPreparedDamage,
  effectiveResistPercent,
  meanPrepared,
  prepareDamage,
  rollPrepared,
  worstElement,
  type DamageInput,
  type PreparedDamage,
} from '../../../damage/damage'
import { heal as healFormula, type HealOptions } from '../../../damage/heal'
import {
  hpBasedDamage,
  hpReference,
  HP_BASED_DAMAGE_EFFECTS,
  type HpBasedDamageInput,
  type HpBasedSource,
  type HpSnapshot,
} from '../../../damage/life'
import { armorReduction, reflectedDamage } from '../../../damage/misc'
import { distance } from '../../../map/geometry'
import { zoneCells } from '../../../map/zones'
import { roll } from '../../random'
import { compileTargetMask, matchesTargetMask, type MaskContext } from '../../targetMask'
import type { Buff, DamageKind, Fighter, FightState } from '../../types'
import { spellBaseDamageBonus, spellBaseHealBonus, spellDamageBonus } from '../buffs/spellMods'
import { parseTriggerCodes, triggerMatches, type TriggerEvent } from '../core'
import type { EffectContext } from '../registry'

// ───────────────────────────── éléments ─────────────────────────────

/** Codes d'élément des tables d'effets (en plus de 0..4 et -1 = aucun). */
export const EL_NONE = -1
export const EL_BEST = -2
export const EL_WORST = -3
/** Élément du dommage d'origine (renvois 1123 / 1223 / 2020). */
export const EL_SOURCE = -4

/** Élément effectif d'un code de table, pour un lanceur donné (meilleur / pire élément : port D3 GetBestElement). */
export function resolveElement(code: number, caster: Stats): Element | -1 {
  if (code === EL_BEST) return bestElement(caster)
  if (code === EL_WORST) return worstElement(caster)
  return code >= 0 && code <= 4 ? (code as Element) : -1
}

// ───────────────────────────── tables d'effets ─────────────────────────────

/**
 * Familles de dommages :
 *  - boosted : élémentaire boosté (carac, puissance, fixes, multiplicateurs) — 96-100, 2822, 2832, vols 91-95, 2828, 2890 ;
 *  - mp : boosté puis × PM restants / (PM restants + PM utilisés) — 1012-1016 ;
 *  - fixed : jet non boosté, résistances de la cible appliquées — 144, 1063-1066, vol fixe 82 ;
 *  - hp : % de PV (lanceur / cible, actuels / manquants / érodés / milieu de vie) — 85-89, 275-279, 671, 672, 1067-1071,
 *    1092-1096, 1118-1122.
 */
export type DamageFamily = 'boosted' | 'mp' | 'fixed' | 'hp'

export interface DamageSpec {
  family: DamageFamily
  /** Code d'élément (0..4, EL_BEST, EL_WORST, EL_NONE). */
  element: number
  /** Vol de vie : le lanceur est soigné de la moitié des PV perdus. */
  steal: boolean
  /** Famille hp : PV de référence. */
  hpSource?: HpBasedSource
  /** Famille hp : ignore résistances et multiplicateurs (671 « PV du lanceur (fixe) »). */
  ignoresRes?: boolean
  /** Famille hp : sans dégressivité de zone (672). */
  noAreaMalus?: boolean
}

export const DAMAGE_SPECS = new Map<number, DamageSpec>()

function spec(ids: Record<number, number>, family: DamageFamily, steal = false): void {
  for (const id in ids) DAMAGE_SPECS.set(Number(id), { family, element: ids[id], steal })
}
const { Neutral: N, Earth: E, Fire: F, Water: W, Air: A } = Element
spec({ 96: W, 97: E, 98: A, 99: F, 100: N, 2822: EL_BEST, 2832: EL_WORST }, 'boosted')
spec({ 91: W, 92: E, 93: A, 94: F, 95: N, 2828: EL_BEST, 2890: EL_WORST }, 'boosted', true)
spec({ 1012: N, 1013: A, 1014: W, 1015: F, 1016: E }, 'mp')
spec({ 144: N, 1063: E, 1064: A, 1065: W, 1066: F }, 'fixed')
spec({ 82: N }, 'fixed', true)
for (const [id, info] of HP_BASED_DAMAGE_EFFECTS) {
  if (info.source === 'lifeLoss') continue // 1048 : perte de % PV (handler dédié)
  DAMAGE_SPECS.set(id, { family: 'hp', element: info.element, steal: false, hpSource: info.source, noAreaMalus: id === 672 })
}
// Variantes absentes de src/damage (DofusDB /effects) : PV manquants Terre/Air/Feu, PV du lanceur « fixe ».
for (const [id, el] of [[276, E], [277, A], [278, F]] as const) {
  DAMAGE_SPECS.set(id, { family: 'hp', element: el, steal: false, hpSource: 'casterMissingLife' })
}
DAMAGE_SPECS.set(671, { family: 'hp', element: N, steal: false, hpSource: 'casterLife', ignoresRes: true })

// ───────────────────────────── contexte d'un dommage ─────────────────────────────

/**
 * Nature d'un dommage selon son origine : marque (piège / glyphe), buff déclenché (poison si TB/TE), sous-sort
 * ou effet indirect, sinon direct (effects.md §2.2).
 */
export function damageKindOf(ctx: EffectContext): DamageKind {
  const m = ctx.mark
  if (m) return m.kind === 'trap' ? 'trap' : m.kind === 'rune' ? 'indirect' : 'glyph'
  const t = ctx.trigger
  if (t) return t.type === 'TB' || t.type === 'TE' ? 'poison' : 'indirect'
  return ctx.indirect ? 'indirect' : 'direct'
}

/** Mêlée = lanceur ≠ cible et cases adjacentes AU MOMENT de l'application (port D3, DoMath piège). */
export function isMeleeHit(caster: Fighter, target: Fighter): boolean {
  return caster !== target && caster.cell >= 0 && target.cell >= 0 && distance(caster.cell, target.cell) === 1
}

/** Poids du coup critique en mode 'average' (posé par castSpell) ; 0 pour un effet déclenché. */
export function critWeightOf(ctx: EffectContext): number {
  if (ctx.fight.options.rollMode !== 'average' || ctx.trigger) return 0
  const w = ctx.caster.tags.critWeight
  return typeof w === 'number' && w > 0 ? (w > 1 ? 1 : w) : 0
}

// ───────────────────────────── effet critique / effet normal ─────────────────────────────

interface EffectInfo {
  /** L'effet appartient à la liste `criticalEffects` (bonus de dommages critiques, résistances critiques). */
  crit: boolean
  /** Effet homologue dans l'autre liste (normal ↔ critique), ou null. */
  counterpart: EffectData | null
}

const EFFECT_INFO = new WeakMap<EffectData, EffectInfo>()
const NO_INFO: EffectInfo = { crit: false, counterpart: null }

/** k-ième effet de même effectId : homologue dans l'autre liste (normal ↔ critique). */
function homologue(from: readonly EffectData[], index: number, to: readonly EffectData[]): EffectData | null {
  const id = from[index].effectId
  let k = 0
  for (let i = 0; i < index; i++) if (from[i].effectId === id) k++
  for (const e of to) if (e.effectId === id && k-- === 0) return e
  return null
}

function sameEffect(a: EffectData, b: EffectData): boolean {
  return a.effectId === b.effectId && a.order === b.order && a.diceNum === b.diceNum && a.diceSide === b.diceSide && a.value === b.value
}

function findInfo(levels: readonly SpellLevelData[], effect: EffectData, eq: (a: EffectData, b: EffectData) => boolean): EffectInfo | undefined {
  for (const lvl of levels) {
    const i = lvl.effects.findIndex(e => eq(e, effect))
    if (i >= 0) return { crit: false, counterpart: homologue(lvl.effects, i, lvl.criticalEffects) }
    const j = lvl.criticalEffects.findIndex(e => eq(e, effect))
    if (j >= 0) return { crit: true, counterpart: homologue(lvl.criticalEffects, j, lvl.effects) }
  }
  return undefined
}

/**
 * Situe un effet dans son spell-level (identité d'objet, sinon égalité structurelle pour les copies faites par le
 * noyau : effets différés / déclenchés). Résultat mis en cache par objet.
 */
export function effectInfo(ctx: EffectContext, effect: EffectData): EffectInfo {
  const cached = EFFECT_INFO.get(effect)
  if (cached) return cached
  const levels: SpellLevelData[] = []
  if (ctx.spell && ctx.spell.spellId === ctx.spellId) levels.push(ctx.spell.level)
  const sp = ctx.engine.data.spell(ctx.spellId)
  if (sp) for (const l of sp.levels) if (!levels.includes(l)) levels.push(l)
  const info = findInfo(levels, effect, (a, b) => a === b) ?? findInfo(levels, effect, sameEffect) ?? NO_INFO
  EFFECT_INFO.set(effect, info)
  return info
}

/** Bonus critiques (dommages critiques du lanceur, résistances critiques de la cible) : effet critique non déclenché. */
function critApplies(ctx: EffectContext, effect: EffectData): boolean {
  return ctx.crit && !ctx.trigger && effectInfo(ctx, effect).crit
}

/** Bornes d'un jet (diceSide 0 ⇒ valeur fixe). */
export function diceMin(e: EffectData): number {
  return e.diceNum
}
export function diceMax(e: EffectData): number {
  return e.diceSide > e.diceNum ? e.diceSide : e.diceNum
}

// ───────────────────────────── buffs modificateurs ─────────────────────────────

/** Effets modificateurs lus au moment du dommage / du soin. */
export const MOD_RECEIVED_DAMAGE = 1163
export const MOD_RECEIVED_HEAL = 1159
export const MOD_ARMOR = 265
export const MOD_ARMOR_D2 = 105
export const MOD_INTERCEPT = 765
export const MOD_SHARE = 1061
export const MOD_DAMAGE_TO_HEAL = 1164

const EV: TriggerEvent = { type: 'D' }

/** Événement « dommage subi » réutilisé pour tester les déclencheurs des buffs modificateurs. */
function damageEvent(source: Fighter, element: number, melee: boolean, kind: DamageKind, isWeapon: boolean): TriggerEvent {
  EV.type = kind === 'push' ? 'PD' : 'D'
  EV.source = source
  EV.element = element
  EV.melee = melee
  EV.damageKind = kind
  EV.isWeapon = isWeapon
  EV.amount = undefined
  EV.stateId = undefined
  EV.killed = false
  return EV
}

function healEvent(source: Fighter | undefined): TriggerEvent {
  EV.type = 'H'
  EV.source = source
  EV.element = undefined
  EV.melee = undefined
  EV.damageKind = undefined
  EV.isWeapon = undefined
  EV.amount = undefined
  EV.stateId = undefined
  EV.killed = false
  return EV
}

/**
 * Le buff s'applique-t-il à cet événement ? Buff instantané (stat / spécial) : toujours ; buff déclencheur : si un de
 * ses codes correspond et qu'il lui reste des déclenchements ; buff différé : non.
 */
export function buffApplies(b: Buff, ev: TriggerEvent, holder: Fighter): boolean {
  if (b.delay > 0 || b.kind === 'delayed') return false
  if (b.kind !== 'trigger' || !b.triggers) return true
  if (b.maxTriggers !== undefined && (b.triggerCount ?? 0) >= b.maxTriggers) return false
  for (const c of parseTriggerCodes(b.triggers)) if (triggerMatches(c, ev, holder)) return true
  return false
}

/** Valeur portée par un buff modificateur : valeur résolue (buff spécial), sinon `diceNum` de l'effet. */
function modValue(b: Buff): number {
  return b.kind === 'trigger' || !b.value ? b.effect.diceNum : b.value
}

/** Valeur d'une réduction fixe (265 : `value`, plus rarement `diceNum` ; port D3 GetDamageInterval = param1 + param3). */
function armorValue(b: Buff): number {
  return b.kind === 'trigger' || !b.value ? b.effect.diceNum + b.effect.value : b.value
}

/** Modificateurs côté cible d'un dommage (objet de travail partagé : à lire immédiatement). */
export interface ReceivedMods {
  /** Dommages subis (%, produit tronqué buff par buff comme le port D3). */
  sustainedPct: number
  /** Réduction fixe totale déjà mise à l'échelle du niveau du porteur. */
  armor: number
  /** Entité qui intercepte les dommages (765), ou null. */
  interceptor: Fighter | null
  /** Buffs de partage (1061) portés par la cible : nombre de groupes. */
  shareGroups: number
  /** Conversion des dommages en soins (1164) : % du dommage, 0 = aucune. */
  healRatio: number
  /**
   * Renvoi : carac « Dommages Renvoyés » de la cible (grade de monstre, objets, buffs 107 / 220 de la famille buffs
   * en `statDelta.reflect`) ; part « boostée » (× niveau/20 + 1) non distinguée — INCERTAIN.
   */
  reflectFlat: number
  reflectBoosted: number
}

const MODS: ReceivedMods = {
  sustainedPct: 100,
  armor: 0,
  interceptor: null,
  shareGroups: 0,
  healRatio: 0,
  reflectFlat: 0,
  reflectBoosted: 0,
}

/** Parcourt les buffs de la cible une seule fois et résume les modificateurs actifs pour `ev`. */
export function scanReceivedMods(fight: FightState, target: Fighter, ev: TriggerEvent): ReceivedMods {
  const m = MODS
  m.sustainedPct = 100
  m.armor = 0
  m.interceptor = null
  m.shareGroups = 0
  m.healRatio = 0
  m.reflectFlat = target.stats.reflect
  m.reflectBoosted = 0
  const push = ev.damageKind === 'push'
  for (const b of target.buffs) {
    switch (b.effect.effectId) {
      case MOD_RECEIVED_DAMAGE:
        if (buffApplies(b, ev, target)) m.sustainedPct = Math.trunc((m.sustainedPct * modValue(b)) / 100)
        break
      case MOD_ARMOR:
      case MOD_ARMOR_D2:
        // L'armure ne s'applique pas aux dommages de poussée (port D3 : bloc sauté si collision).
        if (!push && buffApplies(b, ev, target)) m.armor += armorReduction(armorValue(b), target.level)
        break
      case MOD_INTERCEPT:
        if (!push && m.interceptor === null && b.sourceId !== target.id && buffApplies(b, ev, target)) {
          const s = fight.fighters[b.sourceId]
          if (s && s.alive) m.interceptor = s
        }
        break
      case MOD_SHARE:
        if (!push && b.delay <= 0) m.shareGroups++
        break
      case MOD_DAMAGE_TO_HEAL:
        if (m.healRatio === 0 && buffApplies(b, ev, target)) m.healRatio = modValue(b)
        break
    }
  }
  return m
}

/**
 * Multiplicateur « dommages subis » (1163) d'une cible pour un dommage donné, en % (100 = neutre). Exporté pour les
 * dommages calculés hors de ce module (poussée : `pushDamage({ sustainedPct })`, kind 'push' ⇒ codes PD).
 */
export function sustainedPercent(
  fight: FightState,
  target: Fighter,
  source: Fighter,
  info: { element?: number; melee?: boolean; kind: DamageKind; isWeapon?: boolean },
): number {
  return scanReceivedMods(fight, target, damageEvent(source, info.element ?? -1, info.melee ?? false, info.kind, info.isWeapon ?? false)).sustainedPct
}

/** Multiplicateur « soins reçus » (1159) en % (100 = neutre) : buffs déclenchés par un soin (H) ou instantanés. */
export function receivedHealPercent(target: Fighter, source: Fighter | undefined): number {
  let pct = 100
  let ev: TriggerEvent | null = null
  for (const b of target.buffs) {
    if (b.effect.effectId !== MOD_RECEIVED_HEAL) continue
    ev ??= healEvent(source)
    if (buffApplies(b, ev, target)) pct = Math.trunc((pct * modValue(b)) / 100)
  }
  return pct
}

// ───────────────────────────── pile des dommages en cours ─────────────────────────────

/**
 * Dommage en cours d'application (empilé autour de `Engine.applyDamage`) : les effets déclenchés par ce dommage
 * (renvois 1223 / 1123, soins 2020) lisent le sommet de pile pour connaître sa valeur finale, sa valeur « initiale »
 * (avant réductions de la cible) et la case de la cible (même si elle vient de mourir).
 */
export interface DamageFrame {
  target: Fighter
  source: Fighter | undefined
  cell: number
  /** Dommage final (avant bouclier). */
  final: number
  /** Dommage initial : jet boosté et dégressivité, avant résistances, armure et multiplicateurs (port D3 LastTheoreticalRawDamageTaken). */
  raw: number
  element: number
  kind: DamageKind
}

const FRAMES: DamageFrame[] = []
let frameTop = 0

function pushFrame(target: Fighter, source: Fighter | undefined, final: number, raw: number, element: number, kind: DamageKind): void {
  let f = FRAMES[frameTop]
  if (!f) {
    f = { target, source, cell: -1, final: 0, raw: 0, element: -1, kind }
    FRAMES[frameTop] = f
  }
  f.target = target
  f.source = source
  f.cell = target.cell
  f.final = final
  f.raw = raw
  f.element = element
  f.kind = kind
  frameTop++
}

function popFrame(): void {
  if (frameTop > 0) frameTop--
}

/** Dommage dont les déclencheurs sont en cours d'exécution (sommet de pile), ou undefined. */
export function currentDamage(): DamageFrame | undefined {
  return frameTop > 0 ? FRAMES[frameTop - 1] : undefined
}

// ───────────────────────────── dommages occasionnés par le lancer en cours (2973) ─────────────────────────────

const CAST_ACC = { fight: null as FightState | null, caster: -1, spellId: -1, round: -1, turn: -1, count: -1, total: 0 }

function castKeyMatches(ctx: EffectContext): boolean {
  const a = CAST_ACC
  return (
    a.fight === ctx.fight &&
    a.caster === ctx.caster.id &&
    a.spellId === ctx.spellId &&
    a.round === ctx.fight.round &&
    a.turn === ctx.fight.turnIndex &&
    a.count === (ctx.caster.castsThisTurn[ctx.spellId] ?? 0)
  )
}

function accumulateCastDamage(ctx: EffectContext, amount: number): void {
  if (ctx.trigger || amount <= 0) return
  if (!castKeyMatches(ctx)) {
    const a = CAST_ACC
    a.fight = ctx.fight
    a.caster = ctx.caster.id
    a.spellId = ctx.spellId
    a.round = ctx.fight.round
    a.turn = ctx.fight.turnIndex
    a.count = ctx.caster.castsThisTurn[ctx.spellId] ?? 0
    a.total = 0
  }
  CAST_ACC.total += amount
}

/** Dommages finaux occasionnés par le lanceur avec le lancer en cours (soins 2973 « % des dommages occasionnés »). */
export function castDamageDealt(ctx: EffectContext): number {
  return castKeyMatches(ctx) ? CAST_ACC.total : 0
}

// ───────────────────────────── calcul ─────────────────────────────

/** Entrée DoMath réutilisée (tous les champs optionnels sont réécrits à chaque calcul). */
const INPUT: DamageInput = {
  attacker: undefined as unknown as Stats,
  defender: undefined as unknown as Stats,
  element: Element.Neutral,
  crit: false,
  isWeapon: false,
  isMelee: false,
  defenderIsPlayer: false,
}
const PREP_N = createPreparedDamage()
const PREP_C = createPreparedDamage()
const PREP_X = createPreparedDamage()

/** Résultat du dernier calcul (objet partagé). */
const OUT = { amount: 0, raw: 0, rollUsed: 0, reflectBase: 0 }

/**
 * Dégressivité de zone : on retrouve le nombre de paliers depuis l'efficacité (calculée par le noyau sur la position
 * « avant le sort ») pour reproduire exactement l'expression flottante de DoMath ; sinon efficacité directe.
 */
function setArea(input: DamageInput, eff: number, zone: ZoneSpec): void {
  const step = zone.decreaseStepPct
  input.areaMaxSteps = undefined
  if (eff >= 1) {
    input.areaSteps = 0
    input.areaStepPct = step > 0 ? step : 10
    input.efficiency = undefined
    return
  }
  const malus = Math.round((1 - eff) * 100)
  if (step > 0 && malus < 100 && malus % step === 0 && Math.abs(1 - malus / 100 - eff) < 1e-9) {
    input.areaSteps = malus / step
    input.areaStepPct = step
    input.efficiency = undefined
  } else {
    input.areaSteps = 0
    input.areaStepPct = step > 0 ? step : 10
    input.efficiency = eff > 0 ? eff : 0
  }
}

/** Rapport PM restants / (PM restants + PM utilisés) du lanceur (1012-1016, OTOMAI GetTotalDamage). */
function mpRatio(caster: Fighter): number {
  const left = caster.mp
  if (left <= 0) return 0
  const used = caster.stats.mp - left > 0 ? caster.stats.mp - left : 0
  return left / (left + used)
}

function fillInput(
  ctx: EffectContext,
  target: Fighter,
  element: Element,
  crit: boolean,
  melee: boolean,
  kind: DamageKind,
  mods: ReceivedMods,
): DamageInput {
  const caster = ctx.caster
  const s = caster.stats
  const input = INPUT
  input.attacker = s
  input.defender = target.stats
  input.element = element
  input.crit = crit
  input.isWeapon = ctx.spell?.isWeapon === true
  input.isMelee = melee
  input.defenderIsPlayer = target.kind === 'player'
  input.sustainedPct = mods.sustainedPct
  input.spellPower = s.spellPower ?? 0
  input.weaponPower = undefined
  input.extraPower = undefined
  input.extraFixedDamage = spellDamageBonus(caster, ctx.spellId)
  input.baseDamageBonus = spellBaseDamageBonus(caster, ctx.spellId)
  input.isTrap = kind === 'trap'
  input.weaponSkillPct = undefined
  input.weaponCritBonus = undefined
  input.armorReduction = mods.armor
  input.allResPct = target.stats.allResPct ?? 0
  input.portalCells = undefined
  input.portalBonusPct = undefined
  input.monsterResCap = undefined
  input.mode = undefined
  input.order = undefined
  return input
}

/** Paramètres « défenseur neutre » (dommage initial / base du renvoi) dérivés de `src`, dans PREP_X. */
function neutralDefender(src: PreparedDamage, keepFlatRes: boolean): PreparedDamage {
  const x = Object.assign(PREP_X, src)
  if (!keepFlatRes) x.fixedRes = 0
  x.resPct = 0
  x.rawResPct = 0
  x.sustainedPct = 100
  x.finalPct = 0
  x.categoryPct = 0
  x.distancePct = 0
  x.receivedCategoryPct = 0
  x.receivedDistancePct = 0
  return x
}

/** Dommages élémentaires boostés (et 1012-1016) : jet, espérance pondérée en mode 'average', valeur initiale. */
function computeBoosted(ctx: EffectContext, target: Fighter, effect: EffectData, spec: DamageSpec, element: Element, kind: DamageKind, melee: boolean, mods: ReceivedMods): void {
  const fight = ctx.fight
  const caster = ctx.caster
  let eff = ctx.efficiency.get(target.id) ?? 1
  if (spec.family === 'mp') eff *= mpRatio(caster)
  const combo = caster.stats.comboDamagePct ?? 0
  if (combo) eff *= 1 + combo / 100 // INCERTAIN : bonus combo replié dans l'efficacité (port D3 : floor séparé)
  const input = fillInput(ctx, target, element, critApplies(ctx, effect), melee, kind, mods)
  setArea(input, eff, effect.zone)
  const p = prepareDamage(input, PREP_N)
  const lo = diceMin(effect)
  const hi = diceMax(effect)
  if (fight.options.rollMode === 'average') {
    let mean = meanPrepared(p, lo, hi)
    const w = critWeightOf(ctx)
    if (w > 0) {
      const cp = effectInfo(ctx, effect).counterpart ?? effect
      input.crit = true
      const pc = prepareDamage(input, PREP_C)
      mean = (1 - w) * mean + w * meanPrepared(pc, diceMin(cp), diceMax(cp))
    }
    OUT.amount = Math.round(mean)
    OUT.rollUsed = (lo + hi) / 2
  } else {
    const r = roll(fight, lo, hi)
    OUT.amount = rollPrepared(p, r)
    OUT.rollUsed = r
  }
  OUT.raw = rollPrepared(neutralDefender(p, false), OUT.rollUsed)
  OUT.reflectBase = mods.reflectFlat > 0 || mods.reflectBoosted > 0 ? rollPrepared(neutralDefender(p, true), OUT.rollUsed) : 0
}

const HP_SNAP: HpSnapshot = { casterHp: 0, casterMaxHp: 0, casterBaseMaxHp: 0, targetHp: 0, targetMaxHp: 0, targetBaseMaxHp: 0 }
const HP_INPUT: HpBasedDamageInput = { percent: 0, referenceHp: 0, defender: undefined as unknown as Stats, element: -1, defenderIsPlayer: false }

/** Un jet de dommage non boosté : `value` = % (famille hp) ou jet (famille fixed). */
function unboostedOne(spec: DamageSpec, value: number, ref: number, crit: boolean): number {
  const i = HP_INPUT
  if (spec.family === 'hp') {
    i.percent = value
    i.referenceHp = ref
  } else {
    i.percent = 100
    i.referenceHp = value
  }
  i.crit = crit
  return hpBasedDamage(i)
}

/** Dommages non boostés (fixes) et basés sur les PV : rés. de la cible (fixes, %), armure, dommages subis seulement. */
function computeUnboosted(ctx: EffectContext, target: Fighter, effect: EffectData, spec: DamageSpec, element: Element | -1, mods: ReceivedMods): void {
  const caster = ctx.caster
  const eff = spec.noAreaMalus ? 1 : (ctx.efficiency.get(target.id) ?? 1)
  let ref = 0
  if (spec.family === 'hp') {
    const s = HP_SNAP
    s.casterHp = caster.hp
    s.casterMaxHp = caster.maxHp
    s.casterBaseMaxHp = caster.baseMaxHp
    s.targetHp = target.hp
    s.targetMaxHp = target.maxHp
    s.targetBaseMaxHp = target.baseMaxHp
    ref = hpReference(spec.hpSource!, s)
  }
  const i = HP_INPUT
  i.defender = target.stats
  i.element = element
  i.defenderIsPlayer = target.kind === 'player'
  i.armorReduction = mods.armor
  i.allResPct = target.stats.allResPct ?? 0
  i.efficiency = eff
  i.ignoreResistances = spec.ignoresRes
  i.multipliers = undefined
  i.sustainedPct = mods.sustainedPct
  const lo = diceMin(effect)
  const hi = diceMax(effect)
  let used: number
  if (ctx.fight.options.rollMode === 'average') {
    let sum = 0
    for (let v = lo; v <= hi; v++) sum += unboostedOne(spec, v, ref, false)
    let mean = sum / (hi - lo + 1)
    const w = critWeightOf(ctx)
    if (w > 0) {
      const cp = effectInfo(ctx, effect).counterpart ?? effect
      const clo = diceMin(cp)
      const chi = diceMax(cp)
      let cs = 0
      for (let v = clo; v <= chi; v++) cs += unboostedOne(spec, v, ref, true)
      mean = (1 - w) * mean + (w * cs) / (chi - clo + 1)
    }
    OUT.amount = Math.round(mean)
    used = (lo + hi) / 2
  } else {
    used = roll(ctx.fight, lo, hi)
    OUT.amount = unboostedOne(spec, used, ref, critApplies(ctx, effect))
  }
  OUT.rollUsed = used
  OUT.raw = spec.family === 'hp' ? Math.trunc(((used * ref) / 100) * eff) : Math.trunc(used * eff)
  OUT.reflectBase = 0
}

// ───────────────────────────── application ─────────────────────────────

/** Dommages en cours de renvoi / éclaboussure : un renvoi ne déclenche pas d'autre renvoi. */
let splashing = 0

export function isSplashing(): boolean {
  return splashing > 0
}

export function withSplash<T>(fn: () => T): T {
  splashing++
  try {
    return fn()
  } finally {
    splashing--
  }
}

export interface DeliverInfo {
  element: Element | -1
  kind: DamageKind
  melee: boolean
  isWeapon: boolean
  crit: boolean
  raw: number
}

const DELIVER: DeliverInfo = { element: -1, kind: 'direct', melee: false, isWeapon: false, crit: false, raw: 0 }

/** Applique un dommage à un combattant en l'encadrant dans la pile (pour les effets déclenchés). */
function applyFramed(ctx: EffectContext, receiver: Fighter, amount: number, d: DeliverInfo): number {
  const { engine, fight, caster } = ctx
  receiver.tags.lastDmgFinal = amount
  receiver.tags.lastDmgRaw = d.raw
  receiver.tags.lastDmgElement = d.element
  pushFrame(receiver, caster, amount, d.raw, d.element, d.kind)
  try {
    return engine.applyDamage(fight, caster, receiver, amount, d.element, d.kind, { crit: d.crit, melee: d.melee, isWeapon: d.isWeapon })
  } finally {
    popFrame()
  }
}

/** Combattants partageant les dommages de `target` (1061) : mêmes sort et lanceur de buff, vivants. */
function sharers(fight: FightState, target: Fighter): Fighter[][] {
  const groups: Fighter[][] = []
  for (const b of target.buffs) {
    if (b.effect.effectId !== MOD_SHARE || b.delay > 0) continue
    const g: Fighter[] = [target]
    for (const f of fight.fighters) {
      if (f === target || !f.alive) continue
      if (f.buffs.some(o => o.effect.effectId === MOD_SHARE && o.delay <= 0 && o.spellId === b.spellId && o.sourceId === b.sourceId)) g.push(f)
    }
    groups.push(g)
  }
  return groups
}

/**
 * Livre un dommage calculé : conversion en soin (1164), partage (1061), interception (765), puis `applyDamage`.
 * Retourne les PV réellement perdus (somme si partage) — base du vol de vie.
 */
export function deliverDamage(ctx: EffectContext, target: Fighter, amount: number, mods: ReceivedMods, d: DeliverInfo): number {
  const { engine, fight } = ctx
  if (amount <= 0 || !target.alive) return 0
  // Conversion des dommages subis en soins (1164, port D3 GetHealOnDamageRatio).
  if (mods.healRatio > 0) {
    engine.heal(fight, ctx.caster, target, Math.floor((amount * mods.healRatio) / 100))
    return 0
  }
  accumulateCastDamage(ctx, amount)
  // Partage (1061) : réparti à parts égales entre les porteurs du même buff (après résistances de la cible).
  if (mods.shareGroups > 0 && d.kind !== 'reflect') {
    // Copies locales : les déclencheurs des dommages partagés réutilisent les objets de travail du module.
    const base: DeliverInfo = { ...d }
    const groups = sharers(fight, target)
    const n = groups.length
    let lost = 0
    for (const g of groups) {
      const part = Math.trunc(amount / (g.length * n))
      for (const f of g) lost += applyFramed(ctx, f, part, { ...base, melee: isMeleeHit(ctx.caster, f) })
    }
    return lost
  }
  // Interception (765) : le dommage, calculé avec les résistances de la cible, est subi par l'intercepteur.
  const receiver = mods.interceptor ?? target
  return applyFramed(ctx, receiver, amount, d)
}

/** Renvoi de dommages vers le lanceur (carac 50, buffs 107 / 220) : formulas.md §11. */
function reflect(ctx: EffectContext, target: Fighter, base: number, mods: ReceivedMods, element: Element | -1): void {
  const caster = ctx.caster
  if (!caster.alive || caster === target || base <= 0) return
  const value = mods.reflectFlat + Math.trunc(mods.reflectBoosted * (target.level / 20 + 1))
  const r = reflectedDamage(base, value)
  if (r <= 0) return
  let dmg = r
  if (element !== -1) {
    const raw = caster.stats[ELEMENT_RES_PCT[element]] + (caster.stats.allResPct ?? 0)
    const res = effectiveResistPercent(raw, caster.kind === 'player')
    dmg = Math.trunc(r * (1 - res / 100))
  }
  if (dmg > 0) ctx.engine.applyDamage(ctx.fight, target, caster, dmg, element, 'reflect', { melee: isMeleeHit(target, caster) })
}

/**
 * Calcule et applique le dommage d'un effet `effect` (dommage élémentaire, vol, fixe, % PV) du lanceur `ctx.caster`
 * sur `target` : entrée DoMath (stats + buffs actifs), jet selon `rollMode`, modificateurs de la cible,
 * `Engine.applyDamage` (kind direct / indirect / poison / trap / glyph), vol de vie, renvoi.
 * Retourne les PV perdus par le receveur.
 */
export function computeAndApplyDamage(ctx: EffectContext, target: Fighter, effect: EffectData = ctx.effect): number {
  const s = DAMAGE_SPECS.get(effect.effectId)
  if (!s || !target.alive) return 0
  const { engine, caster } = ctx
  // Pacifiste (cantDealDamage) : le lanceur n'inflige plus de dommages (port D3 IsPacifist).
  if (engine.stateFlag(caster, 'cantDealDamage')) return 0
  const kind = damageKindOf(ctx)
  const melee = isMeleeHit(caster, target)
  const isWeapon = ctx.spell?.isWeapon === true
  const element = resolveElement(s.element, caster.stats)
  const mods = scanReceivedMods(ctx.fight, target, damageEvent(caster, element, melee, kind, isWeapon))
  if (s.family === 'boosted' || s.family === 'mp') {
    computeBoosted(ctx, target, effect, s, element === -1 ? Element.Neutral : element, kind, melee, mods)
  } else {
    computeUnboosted(ctx, target, effect, s, element, mods)
  }
  const amount = OUT.amount
  const reflectBase = OUT.reflectBase
  const d = DELIVER
  d.element = element
  d.kind = kind
  d.melee = melee
  d.isWeapon = isWeapon
  d.crit = ctx.crit
  d.raw = OUT.raw
  // Les modificateurs sont lus avant l'application : on copie ce qui sert après (les déclencheurs les réécrivent).
  const reflectFlat = mods.reflectFlat
  const reflectBoosted = mods.reflectBoosted
  const lost = deliverDamage(ctx, target, amount, mods, d)
  // Vol de vie : la moitié des PV réellement perdus, sans déclencher les buffs H (OTOMAI HaxeBuff).
  if (s.steal && target !== caster && lost > 0 && caster.alive) engine.heal(ctx.fight, caster, caster, Math.floor(lost / 2), { noTrigger: true })
  if (reflectBase > 0 && kind !== 'reflect') {
    MODS.reflectFlat = reflectFlat
    MODS.reflectBoosted = reflectBoosted
    reflect(ctx, target, reflectBase, MODS, element)
  }
  return lost
}

/**
 * Dommage « non boosté » d'une valeur de référence (renvois 1123 / 1223 : % d'un dommage déjà subi) sur `target` :
 * résistances fixes et % de la cible, armure, dommages subis ; ni carac ni dégressivité. Retourne les PV perdus.
 */
export function applySplashDamage(ctx: EffectContext, target: Fighter, percent: number, reference: number, element: Element | -1): number {
  if (!target.alive || reference <= 0 || percent <= 0) return 0
  const caster = ctx.caster
  if (ctx.engine.stateFlag(caster, 'cantDealDamage')) return 0
  const melee = isMeleeHit(caster, target)
  const mods = scanReceivedMods(ctx.fight, target, damageEvent(caster, element, melee, 'indirect', false))
  const amount = hpBasedDamage({
    percent,
    referenceHp: reference,
    defender: target.stats,
    element,
    defenderIsPlayer: target.kind === 'player',
    armorReduction: mods.armor,
    allResPct: target.stats.allResPct ?? 0,
    sustainedPct: mods.sustainedPct,
  })
  const d = DELIVER
  d.element = element
  d.kind = 'indirect'
  d.melee = melee
  d.isWeapon = false
  d.crit = false
  d.raw = Math.trunc((percent * reference) / 100)
  return withSplash(() => deliverDamage(ctx, target, amount, mods, d))
}

// ───────────────────────────── soins ─────────────────────────────

const HEAL_OPTS: HealOptions = {}

/**
 * Soin élémentaire boosté (108, 81, 2998-3002) : `floor(jet × (100 + carac)/100) + Soins` (+ bonus de base du sort),
 * × % soins finaux du lanceur, × dégressivité ; espérance pondérée du critique en mode 'average'.
 * Retourne le soin AVANT « soins reçus » et plafonnement.
 */
export function computeHeal(ctx: EffectContext, target: Fighter, effect: EffectData, element: Element): number {
  const caster = ctx.caster
  const o = HEAL_OPTS
  o.element = element
  o.isWeapon = ctx.spell?.isWeapon === true
  o.spellPower = undefined
  o.finalHealPct = caster.stats.finalHealPct ?? 0
  o.efficiency = ctx.efficiency.get(target.id) ?? 1
  const bonus = spellBaseHealBonus(caster, ctx.spellId)
  const lo = diceMin(effect)
  const hi = diceMax(effect)
  if (ctx.fight.options.rollMode === 'average') {
    let sum = 0
    for (let v = lo; v <= hi; v++) sum += healFormula(v + bonus, caster.stats, o)
    let mean = sum / (hi - lo + 1)
    const w = critWeightOf(ctx)
    if (w > 0) {
      const cp = effectInfo(ctx, effect).counterpart ?? effect
      const clo = diceMin(cp)
      const chi = diceMax(cp)
      let cs = 0
      for (let v = clo; v <= chi; v++) cs += healFormula(v + bonus, caster.stats, o)
      mean = (1 - w) * mean + (w * cs) / (chi - clo + 1)
    }
    return Math.round(mean)
  }
  return healFormula(roll(ctx.fight, lo, hi) + bonus, caster.stats, o)
}

/** Applique un soin déjà calculé : × soins reçus (1159) de la cible, puis `Engine.heal` (plafond, Insoignable). */
export function deliverHeal(ctx: EffectContext, target: Fighter, amount: number, source: Fighter | undefined = ctx.caster): number {
  if (amount <= 0 || !target.alive) return 0
  const pct = receivedHealPercent(target, source)
  const h = pct === 100 ? amount : Math.trunc((amount * pct) / 100)
  return ctx.engine.heal(ctx.fight, source, target, h)
}

/** Valeur d'un effet à jet (bouclier fixe, soins non boostés...) : jet ou espérance pondérée du critique. */
export function rollEffectValue(ctx: EffectContext, effect: EffectData = ctx.effect): number {
  const lo = diceMin(effect)
  const hi = diceMax(effect)
  if (ctx.fight.options.rollMode === 'average') {
    let v = (lo + hi) / 2
    const w = critWeightOf(ctx)
    if (w > 0) {
      const cp = effectInfo(ctx, effect).counterpart ?? effect
      v = (1 - w) * v + (w * (diceMin(cp) + diceMax(cp))) / 2
    }
    return v
  }
  return roll(ctx.fight, lo, hi)
}

// ───────────────────────────── cibles des effets de renvoi ─────────────────────────────

/**
 * Destinataires d'un renvoi / soin de renvoi. Pour un buff déclencheur exécuté directement par le noyau (cibles =
 * [porteur], une seule case), la zone de l'effet est recalculée autour du porteur et filtrée par le masque (vu du
 * lanceur du buff, O = attaquant) — descriptions des sorts : « renvoie aux ennemis à son contact » (Couronne
 * d'Épines), « aux ennemis en zone autour de lui » (Massacre). Sinon (sous-sort, effet instantané) : cibles du noyau.
 */
export function splashRecipients(ctx: EffectContext, center: number): Fighter[] {
  const { engine, fight, caster, effect } = ctx
  const mask = effect.targetMask
  const mctx: MaskContext = ctx.trigger?.source ? { triggering: ctx.trigger.source } : {}
  let out: Fighter[] = ctx.targets.filter(t => t.alive)
  if (ctx.trigger && ctx.cells.length <= 1 && center >= 0) {
    const cells = zoneCells(effect.zone, center, caster.cell >= 0 ? caster.cell : center)
    if (cells.length > 1) {
      out = []
      for (const c of cells) {
        const f = engine.fighterAt(fight, c)
        if (f && f.alive && matchesTargetMask(mask, caster, f, mctx)) out.push(f)
      }
    } else if (mask) out = out.filter(f => matchesTargetMask(mask, caster, f, mctx))
  }
  if (mask) {
    const m = compileTargetMask(mask)
    const add = (f: Fighter | undefined) => {
      if (f && f.alive && !out.includes(f) && matchesTargetMask(mask, caster, f, mctx)) out.push(f)
    }
    if (m.addsTriggering) add(ctx.trigger?.source)
    if (m.addsCaster) add(caster)
  }
  return out
}

/** Porteur d'un buff déclenché exécuté directement (cibles = [porteur]) ou, à défaut, le lanceur. */
export function triggerHolder(ctx: EffectContext): Fighter {
  if (ctx.trigger && ctx.targets.length === 1) return ctx.targets[0]
  return ctx.caster
}
