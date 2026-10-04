/**
 * Profils analytiques des sorts (docs/design/ai.md §6.3) — WP1.
 *
 * Un `SpellProfile` est calculé UNE fois par `SpellLevelData` (objet partagé du DataStore, ou niveau modifié par les
 * modificateurs de sort du lanceur) : lignes de dégâts (normales + homologues critiques), retraits PA/PM, déplacements,
 * soins, boucliers, états posés, invocations, marques, buffs/débuffs, catégorie dominante, couverture analytique et
 * support moteur (E5, `isSpellSupported`). Les sous-sorts lancés par le lanceur sur la case ciblée (1160, 2160, 2960 ;
 * profondeur ≤ 4) sont inclus (fermeture) ; les autres effets « lance un sort » (cible/source exécutante, déclencheurs)
 * sont seulement marqués (`hasTriggers`, couverture réduite).
 *
 * Les champs du contrat (`SpellProfile`, src/ai/types.ts) sont complétés par des listes détaillées (`SpellProfileX`)
 * utilisées par le DPT, la menace, le préfiltre et les candidats.
 */
import type { Stats } from '../../core/types'
import type { EffectData, SpellLevelData, ZoneSpec } from '../../data/model'
import { modifiedSpellLevel } from '../../engine/effects/buffs/spellMods'
import { statBuffDef } from '../../engine/effects/buffs/stats'
import { CAST_SPELL_EFFECTS, isInstant } from '../../engine/effects/core'
import { DAMAGE_SPECS, type DamageFamily } from '../../engine/effects/damage/pipeline'
import { registeredEffects } from '../../engine/effects/registry'
import { isSpellSupported } from '../../engine/effects/support'
import type { Engine } from '../../engine/engine'
import { compileTargetMask } from '../../engine/targetMask'
import type { Fighter } from '../../engine/types'
import { compileZone } from '../../map/zones'
import type { CandidateCat, DamageLine, DisplacementKind, SpellProfile, SpellProfileIndex } from '../types'

// ───────────────────────────── types détaillés ─────────────────────────────

/** Camps visés par un masque (relatifs au lanceur). */
export interface MaskSides {
  enemy: boolean
  ally: boolean
  /** Le lanceur peut être touché (c, C, a, masque vide). */
  self: boolean
  /** Masque réduit au lanceur (C / c seuls). */
  selfOnly: boolean
}

export interface DamageLineX extends DamageLine {
  effectId: number
  family: DamageFamily
  /** Probabilité d'application (groupes aléatoires), 1 sinon. */
  p: number
  /** Ligne issue d'un sous-sort (lancé par le lanceur sur la case ciblée). */
  sub: boolean
  sides: MaskSides
  effect: EffectData
  /** Effet homologue de la liste critique (null : critique sans effet propre). */
  critEffect: EffectData | null
}
export interface HealLineX { effectId: number; kind: 'boosted' | 'fixed' | 'pctMax'; element: number; min: number; max: number
  critMin: number; critMax: number; zone: ZoneSpec; mask: string; sides: MaskSides; p: number }
export interface ShieldLineX { effectId: number; kind: 'flat' | 'pctLevel' | 'pctMaxHp'; value: number; duration: number
  zone: ZoneSpec; mask: string; sides: MaskSides }
export interface StatLineX { effectId: number; stat: keyof Stats; sign: 1 | -1; value: number; duration: number
  zone: ZoneSpec; mask: string; sides: MaskSides
  /** Vitalité en % des PV max de début de combat (1078, 1033). */
  pctBaseLife?: boolean }
export interface RemovalLineX { effectId: number; pool: 'ap' | 'mp'; value: number; dodgeable: boolean; steal: boolean
  duration: number; delay: number; zone: ZoneSpec; mask: string; sides: MaskSides }
export interface MoveLineX { effectId: number; kind: DisplacementKind; cells: number; zone: ZoneSpec; mask: string; sides: MaskSides
  /** Le déplacement porte sur le lanceur (1041/1042, 4, téléportations du lanceur). */
  onCaster: boolean }
export interface StateLineX { effectId: number; stateId: number; duration: number; on: 'self' | 'target' | 'zone'
  zone: ZoneSpec; mask: string; sides: MaskSides; remove: boolean }
export interface ReceivedLineX { effectId: number; pct: number; duration: number; zone: ZoneSpec; mask: string; sides: MaskSides }

export interface SpellProfileX extends SpellProfile {
  level: SpellLevelData
  damage: DamageLineX[]
  heals: HealLineX[]
  shields: ShieldLineX[]
  stats: StatLineX[]
  removals: RemovalLineX[]
  moves: MoveLineX[]
  states: StateLineX[]
  /** Modificateurs « dommages subis ×% » (1163) posés. */
  received: ReceivedLineX[]
  /** Rayon de la zone principale (0 = monocible). */
  zoneRadius: number
  /** Zone principale (première ligne de dégâts, sinon premier effet). */
  zone: ZoneSpec | null
  needFreeCell: boolean
  needTakenCell: boolean
  /** Le sort ne vise que le lanceur (portée 0, masques C/c). */
  selfCast: boolean
  /** Effets qui touchent des ennemis / des alliés. */
  hitsEnemies: boolean
  hitsAllies: boolean
  /** Somme des jets moyens de base des lignes de dégâts directes (sans caractéristiques). */
  baseDamage: number
  /** Retire un état (951) / désenvoûte (132, 406, 1075, 1406). */
  removesStates: boolean
  /** Invocations : monstre, grade, résurrection (780 / 1034). */
  summonLines: { effectId: number; monsterId: number; grade: number; revive: boolean }[]
}

// ───────────────────────────── tables d'effets ─────────────────────────────

const HEAL_BOOSTED: Record<number, number> = { 81: 2, 108: 2, 2998: 3, 2999: 4, 3000: 1, 3001: 0, 3002: -2 }
const HEAL_FIXED = new Set([143, 407])
const HEAL_PCT_MAX = new Set([1109])
const SHIELD: Record<number, ShieldLineX['kind']> = { 1040: 'flat', 1020: 'pctLevel', 1039: 'pctMaxHp' }
const MOVE: Record<number, [DisplacementKind, boolean]> = {
  5: ['push', false], 1103: ['push', false], 783: ['push', false], 1041: ['push', true],
  6: ['pull', false], 1043: ['pull', false], 1042: ['pull', true],
  4: ['teleport', true], 784: ['teleport', false], 2184: ['teleport', false],
  8: ['swap', true], 1023: ['swap', true], 1101: ['swap', true],
  1104: ['symmetric', true], 1105: ['symmetric', false], 1106: ['symmetric', false],
  50: ['carry', false], 51: ['throw', false], 1099: ['return', false], 1100: ['return', false],
}
/** Retraits de PA/PM : [réserve, esquivable, vol]. */
const REMOVAL: Record<number, ['ap' | 'mp', boolean, boolean]> = {
  1079: ['ap', true, false], 1080: ['mp', true, false], 84: ['ap', true, true], 77: ['mp', true, true],
  168: ['ap', false, false], 169: ['mp', false, false],
}
const DISPEL = new Set([132, 406, 1075, 1406])
const GLYPH = new Set([401, 402, 1091, 1165, 4040, 2022, 1181])
const TRAP = new Set([400])
/** Sous-sorts lancés par le lanceur sur la case ciblée (fermeture analytique). */
const CASTER_SUBSPELL = new Set([1160, 2160, 2960])
const NOOP_FAMILIES = new Set(['visual', 'noop'])
const MAX_SUB_DEPTH = 4

const ENEMY_LETTERS = new Set(['A', 'H', 'L', 'D', 'M', 'I', 'J', 'S'])
const ALLY_LETTERS = new Set(['a', 'g', 'h', 'l', 'd', 'm', 'i', 'j', 's'])
const sidesCache = new Map<string, MaskSides>()

/** Camps visés par un masque de cibles (cache par chaîne). */
export function maskSides(mask: string): MaskSides {
  let s = sidesCache.get(mask)
  if (s) return s
  const m = compileTargetMask(mask)
  if (m.empty) s = { enemy: true, ally: true, self: true, selfOnly: false }
  else {
    let enemy = false
    let ally = false
    let self = false
    for (const l of m.inclusionLetters) {
      if (ENEMY_LETTERS.has(l)) enemy = true
      if (ALLY_LETTERS.has(l)) ally = true
      if (l === 'c' || l === 'C' || l === 'a') self = true
    }
    const selfOnly = self && !enemy && !ally
    s = { enemy, ally, self, selfOnly }
  }
  sidesCache.set(mask, s)
  return s
}

function diceMinOf(e: EffectData): number {
  return e.diceNum
}
function diceMaxOf(e: EffectData): number {
  return e.diceSide > e.diceNum ? e.diceSide : e.diceNum
}
function meanOf(e: EffectData): number {
  return (diceMinOf(e) + diceMaxOf(e)) / 2
}

/** Rayon d'une zone (0 = case unique). */
export function zoneRadius(zone: ZoneSpec): number {
  const z = compileZone(zone)
  return z.shape === 'P' ? 0 : Math.max(0, z.radius)
}

/** k-ième effet de même effectId dans l'autre liste (homologue normal ↔ critique). */
function homologue(from: readonly EffectData[], index: number, to: readonly EffectData[]): EffectData | null {
  const id = from[index].effectId
  let k = 0
  for (let i = 0; i < index; i++) if (from[i].effectId === id) k++
  for (const e of to) if (e.effectId === id && k-- === 0) return e
  return null
}

/** Probabilité de chaque effet aléatoire (un seul groupe tiré, ∝ somme des poids : effects/core.ts). */
function randomProbabilities(effects: readonly EffectData[]): Map<EffectData, number> {
  const weights = new Map<number, number>()
  for (const e of effects) if (e.random > 0) weights.set(e.group || -e.order - 1, (weights.get(e.group || -e.order - 1) ?? 0) + e.random)
  const total = [...weights.values()].reduce((a, b) => a + b, 0)
  const out = new Map<EffectData, number>()
  for (const e of effects) if (e.random > 0) out.set(e, total > 0 ? (weights.get(e.group || -e.order - 1) ?? 0) / total : 0)
  return out
}

// ───────────────────────────── construction ─────────────────────────────

interface Acc {
  p: SpellProfileX
  covered: number
  uncovered: number
}

/** Effet « lance un sort » conditionnel (conditions de masque sur la cible ou le lanceur : PV, états…). */
function conditionalCast(e: EffectData): boolean {
  if (!CAST_SPELL_EFFECTS.has(e.effectId) || !e.targetMask) return false
  const m = compileTargetMask(e.targetMask)
  return m.targetConditions.length > 0 || m.casterConditions.length > 0
}

function scanEffects(engine: Engine, acc: Acc, effects: readonly EffectData[], crits: readonly EffectData[], sub: boolean, depth: number,
                     seen: Set<SpellLevelData>, weight = 1): void {
  const p = acc.p
  const probs = randomProbabilities(effects)
  // Sous-sorts conditionnels frères (paliers de PV, états) : une seule branche s'applique en général ⇒ poids 1/n.
  let nCond = 0
  for (const e of effects) if (conditionalCast(e)) nCond++
  const registry = registeredEffects()
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i]
    if (e.clientOnly) continue
    const family = registry.get(e.effectId)?.family
    if (family && NOOP_FAMILIES.has(family)) continue
    const prob = weight * (e.random > 0 ? (probs.get(e) ?? 0) : 1)
    if (e.random > 0) p.hasRandomGroups = true
    const instant = isInstant(e)
    if (!instant || e.delay > 0) p.hasTriggers = true
    const sides = maskSides(e.targetMask)
    const id = e.effectId
    const spec = DAMAGE_SPECS.get(id)
    if (spec) {
      const isDot = !instant && /(^|\|)(TB|TE)(\||$)/.test(e.triggers)
      if (instant || isDot) {
        const ce = crits.length ? homologue(effects, i, crits) : null
        const line: DamageLineX = {
          element: spec.element, min: diceMinOf(e), max: diceMaxOf(e),
          critMin: ce ? diceMinOf(ce) : diceMinOf(e), critMax: ce ? diceMaxOf(ce) : diceMaxOf(e),
          zone: e.zone, mask: e.targetMask, lifeSteal: spec.steal, delayed: e.delay,
          dotTurns: isDot ? Math.max(1, e.triggerDuration ?? e.duration) : 0,
          effectId: id, family: spec.family, p: prob, sub, sides, effect: e, critEffect: ce,
        }
        p.damage.push(line)
        if (!isDot && e.delay <= 0 && spec.family !== 'hp') p.baseDamage += prob * meanOf(e)
        acc.covered++
      } else acc.uncovered++
      continue
    }
    if (id in HEAL_BOOSTED || HEAL_FIXED.has(id) || HEAL_PCT_MAX.has(id)) {
      const ce = crits.length ? homologue(effects, i, crits) : null
      p.heals.push({
        effectId: id, kind: id in HEAL_BOOSTED ? 'boosted' : HEAL_FIXED.has(id) ? 'fixed' : 'pctMax',
        element: HEAL_BOOSTED[id] ?? 2, min: diceMinOf(e), max: diceMaxOf(e),
        critMin: ce ? diceMinOf(ce) : diceMinOf(e), critMax: ce ? diceMaxOf(ce) : diceMaxOf(e),
        zone: e.zone, mask: e.targetMask, sides, p: prob,
      })
      p.heal += prob * meanOf(e)
      acc.covered++
      continue
    }
    if (id in SHIELD) {
      p.shields.push({ effectId: id, kind: SHIELD[id], value: prob * meanOf(e), duration: e.duration, zone: e.zone, mask: e.targetMask, sides })
      p.shield += prob * meanOf(e)
      acc.covered++
      continue
    }
    if (id in REMOVAL) {
      const [pool, dodgeable, steal] = REMOVAL[id]
      const v = prob * meanOf(e)
      p.removals.push({ effectId: id, pool, value: v, dodgeable, steal, duration: e.duration, delay: e.delay, zone: e.zone, mask: e.targetMask, sides })
      if (pool === 'ap') p.apRemoval += v
      else p.mpRemoval += v
      if (dodgeable) p.dodgeable = true
      if (sides.enemy) p.enemyDebuff = true
      acc.covered++
      continue
    }
    if (id in MOVE) {
      const [kind, onCaster] = MOVE[id]
      const cells = kind === 'push' || kind === 'pull' ? Math.max(1, e.diceNum) : 0
      p.moves.push({ effectId: id, kind, cells, zone: e.zone, mask: e.targetMask, sides, onCaster })
      p.displacement.push({ kind, cells })
      acc.uncovered++
      continue
    }
    if (id === 950 || id === 951 || id === 952) {
      const on: StateLineX['on'] = sides.selfOnly ? 'self' : e.zone.shape === 'P' ? 'target' : 'zone'
      p.states.push({ effectId: id, stateId: e.value, duration: e.duration, on, zone: e.zone, mask: e.targetMask, sides, remove: id !== 950 })
      if (id === 950) p.appliesStates.push({ stateId: e.value, on, duration: e.duration })
      else p.removesStates = true
      acc.covered++
      continue
    }
    if (DISPEL.has(id)) {
      p.dispel = true
      p.removesStates = true
      acc.uncovered++
      continue
    }
    if (id === 1163) {
      const pct = e.diceNum === 0 && e.diceSide === 0 ? e.value : e.diceNum
      p.received.push({ effectId: id, pct, duration: e.duration, zone: e.zone, mask: e.targetMask, sides })
      if (sides.enemy && pct > 100) p.enemyDebuff = true
      acc.covered++
      continue
    }
    const sd = statBuffDef(id)
    if (sd && sd.stat) {
      const v = prob * meanOf(e)
      p.stats.push({ effectId: id, stat: sd.stat, sign: sd.sign, value: v, duration: e.duration, zone: e.zone, mask: e.targetMask, sides,
        pctBaseLife: id === 1078 || id === 1033 })
      if (sd.sign > 0) {
        if (sides.selfOnly || (sides.self && !sides.ally && !sides.enemy)) p.selfBuff = true
        else if (sides.ally) {
          p.allyBuff = true
          if (sides.self) p.selfBuff = true
        }
      } else if (sides.enemy) p.enemyDebuff = true
      acc.covered++
      continue
    }
    if (family === 'summons') {
      p.summons.push(e.diceNum)
      p.summonLines.push({ effectId: id, monsterId: e.diceNum, grade: e.diceSide || 1, revive: id === 780 || id === 1034 })
      acc.uncovered++
      continue
    }
    if (GLYPH.has(id) || TRAP.has(id)) {
      if (TRAP.has(id)) p.trap = true
      else p.glyph = true
      // Le sort de la marque est analysé à part (déclenché plus tard) : couverture nulle.
      acc.uncovered++
      continue
    }
    if (CAST_SPELL_EFFECTS.has(id)) {
      // Sous-sort lancé par le lanceur (1160, 2160, 2960), ou par la « cible » quand le masque ne vise que le lanceur.
      const byCaster = CASTER_SUBSPELL.has(id) || sides.selfOnly
      if (byCaster && instant && e.delay <= 0 && e.diceNum > 0 && depth < MAX_SUB_DEPTH) {
        const lvl = engine.data.spellLevel(e.diceNum, { grade: e.diceSide || undefined })
        if (lvl && !seen.has(lvl)) {
          seen.add(lvl)
          scanEffects(engine, acc, lvl.effects, lvl.criticalEffects, true, depth + 1, seen, conditionalCast(e) && nCond > 1 ? prob / nCond : prob)
          continue
        }
      }
      p.hasTriggers = true
      acc.uncovered++
      continue
    }
    if (id >= 280 && id <= 299) {
      // Modificateurs de sort (portée, coût, lancers…) : buff du lanceur.
      if (sides.selfOnly || sides.self) p.selfBuff = true
      acc.uncovered++
      continue
    }
    acc.uncovered++
  }
}

function buildProfile(engine: Engine, level: SpellLevelData, crit: boolean): SpellProfileX {
  const effects = crit && level.criticalEffects.length ? level.criticalEffects : level.effects
  const crits = crit ? [] : level.criticalEffects
  const p: SpellProfileX = {
    spellId: level.spellId, apCost: level.apCost, minRange: level.minRange, maxRange: level.range,
    los: level.castTestLos, line: level.castInLine, diagonal: level.castInDiagonal,
    castsPerTurn: level.maxCastPerTurn, castsPerTarget: level.maxCastPerTarget, cooldown: level.minCastInterval,
    damage: [], apRemoval: 0, mpRemoval: 0, dodgeable: false, displacement: [], heal: 0, shield: 0, appliesStates: [],
    requiresStates: level.statesCondition, summons: [], glyph: false, trap: false,
    selfBuff: false, allyBuff: false, enemyDebuff: false, dispel: false, cat: 'utility',
    hasRandomGroups: false, hasTriggers: false, analyticCoverage: 1, unsupported: !isSpellSupported(engine, level),
    level, heals: [], shields: [], stats: [], removals: [], moves: [], states: [], received: [],
    zoneRadius: 0, zone: null, needFreeCell: level.needFreeCell, needTakenCell: level.needTakenCell,
    selfCast: false, hitsEnemies: false, hitsAllies: false, baseDamage: 0, removesStates: false, summonLines: [],
  }
  const acc: Acc = { p, covered: 0, uncovered: 0 }
  scanEffects(engine, acc, effects, crits, false, 0, new Set([level]))
  const total = acc.covered + acc.uncovered
  p.analyticCoverage = total > 0 ? acc.covered / total : 1
  // Zone principale : première ligne de dégâts directe, sinon premier effet non visuel.
  const main = p.damage.find(l => !l.sub) ?? null
  const firstZone = main ? main.zone : (effects.find(e => !e.clientOnly)?.zone ?? null)
  p.zone = firstZone
  p.zoneRadius = firstZone ? zoneRadius(firstZone) : 0
  let enemy = false
  let ally = false
  let selfOnly = true
  for (const e of effects) {
    if (e.clientOnly) continue
    const s = maskSides(e.targetMask)
    if (s.enemy) enemy = true
    if (s.ally) ally = true
    if (!s.selfOnly) selfOnly = false
  }
  p.hitsEnemies = enemy
  p.hitsAllies = ally
  p.selfCast = level.range === 0 || selfOnly
  p.cat = categorize(p)
  return p
}

/**
 * Catégorie dominante (quotas, §8.1) : dégâts si les dégâts de base dominent ; contrôle (retraits, poussées/attirances
 * d'ennemis, débuffs, états sur ennemis) ; placement (téléportations, échanges, portage) ; soin (soins, boucliers) ;
 * buff ; invocation ; marque ; utilitaire.
 */
function categorize(p: SpellProfileX): CandidateCat {
  const controlValue = (p.apRemoval + p.mpRemoval) * 120 + (p.moves.some(m => (m.kind === 'push' || m.kind === 'pull') && !m.onCaster && m.sides.enemy) ? 150 : 0)
    + (p.states.some(s => !s.remove && s.sides.enemy && !s.sides.selfOnly) ? 100 : 0) + (p.enemyDebuff ? 60 : 0)
  if (p.damage.length && p.baseDamage * 4 >= controlValue && p.baseDamage > 0) return 'damage'
  if (controlValue > 0) return 'control'
  if (p.damage.length) return 'damage'
  if (p.moves.length) return 'placement'
  if (p.heals.length || p.shields.length) return 'heal'
  if (p.summons.length) return 'summon'
  if (p.glyph || p.trap) return 'mark'
  if (p.selfBuff || p.allyBuff || p.stats.length || p.received.length) return 'buff'
  if (p.dispel || p.removesStates) return 'utility'
  return 'utility'
}

// ───────────────────────────── index ─────────────────────────────

export interface SpellProfileIndexX extends SpellProfileIndex {
  of(level: SpellLevelData, crit?: boolean): SpellProfileX
  ofFighter(f: Fighter): readonly SpellProfileX[]
  /** Profil d'un sort connu tel que le voit son lanceur (modificateurs de sort appliqués). */
  ofSpell(f: Fighter, level: SpellLevelData): SpellProfileX
}

const INDEXES = new WeakMap<Engine, SpellProfileIndexX>()

/** Index des profils d'un moteur (partagé : les profils ne dépendent que des données et du registre d'effets). */
export function createSpellProfileIndex(engine: Engine): SpellProfileIndexX {
  let idx = INDEXES.get(engine)
  if (idx) return idx
  const normal = new WeakMap<SpellLevelData, SpellProfileX>()
  const critical = new WeakMap<SpellLevelData, SpellProfileX>()
  const of = (level: SpellLevelData, crit = false): SpellProfileX => {
    const cache = crit ? critical : normal
    let p = cache.get(level)
    if (!p) cache.set(level, (p = buildProfile(engine, level, crit)))
    return p
  }
  const byFighter = new WeakMap<Fighter['spells'], { mods: Fighter['spellMods']; list: SpellProfileX[] }>()
  idx = {
    of,
    ofSpell: (f, level) => of(modifiedSpellLevel(f, level)),
    ofFighter: f => {
      const hit = byFighter.get(f.spells)
      if (hit && hit.mods === f.spellMods) return hit.list
      const list = f.spells.map(s => of(modifiedSpellLevel(f, s.level)))
      byFighter.set(f.spells, { mods: f.spellMods, list })
      return list
    },
  }
  INDEXES.set(engine, idx)
  return idx
}
