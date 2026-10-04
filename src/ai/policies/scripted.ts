/**
 * Politique `scripted` (docs/design/ai.md §8.3, §15.6) — WP4 : rotations des presets (data/ai/presets.json), sans
 * recherche (0 nœud simulé). Utilisée par `createControllers` (src/ai/index.ts) pour les personnages et leurs
 * invocations quand `cfg.mode === 'scripted'` ; les monstres gardent le `MonsterBrain` 'play' dans tous les modes.
 *
 * Tour d'un personnage (preset lu dans `fighter.tags.presetId`, à défaut preset par défaut de sa classe) :
 *  1. étapes de la rotation dans l'ordre (chacune `repeat` fois au plus) : meilleure case cible du sort selon une
 *     estimation ANALYTIQUE (`scoreCast` : dégâts moyens DoMath des lignes — `expectedDamage`, résistances de la
 *     cible — sur les ennemis touchés, sous-sorts 1160/2160/2960 compris sur 2 niveaux, effets différés à moitié, tir
 *     ami pénalisé ×1,5, soins plafonnés aux PV manquants, retraits PA/PM, buffs/débuffs, invocations) ; un sort n'est
 *     lancé que si son score est > 0 (un sort à dégâts doit toucher un ennemi : pas de lancer « pour son buff ») ;
 *  2. complément générique : tant qu'un sort a un score > 0 depuis la case actuelle, le meilleur (ordre : dégâts
 *     moyens par PA, puis id) ;
 *  3. déplacement : au plus un déplacement « pour lancer » par tour (case atteignable la moins coûteuse d'où un sort
 *     de la rotation, ou l'un des 4 meilleurs sorts offensifs, porte) ; en fin de tour, un profil mêlée (portée idéale
 *     ≤ 2 ou tank) reste au contact, un profil distance qui n'a engagé aucun ennemi (dégâts, retraits) s'approche à
 *     sa portée idéale (portée du meilleur sort à dégâts, bornée à [1, 8]), sinon s'éloigne des ennemis proches.
 * Les invocations alliées jouent le complément générique + approche. Déplacements de placement purs (porter/jeter,
 * téléportations) : non joués (score analytique nul) — simplification assumée de la référence `scripted`.
 *
 * Coût : aucun clone ; caches par « état » (niveaux de sort modifiés, occupation des cases, scores par (sort, case))
 * invalidés après chaque action ; préfiltre de portée avant `canCast` ; zones testées sur les seules cases occupées.
 * Déterministe : aucun tirage ; départages par score, puis case, puis id de sort. N'utilise que la vue honnête
 * (`createView(...).visible()`, src/ai/core) : ni `fight.events`, ni pièges invisibles, ni dés futurs ; occupation des
 * cases, cibles et chemins (`honestReach`) sont calculés sur cette vue (un invisible adverse est à sa dernière case
 * connue, jamais à sa case réelle).
 */
import { createView } from '../core'
import type { Element } from '../../core/types'
import { expectedDamage } from '../../damage/damage'
import type { EffectData, SpellLevelData } from '../../data/model'
import { canCast } from '../../engine/cast'
import type { Engine } from '../../engine/engine'
import { modifiedSpellLevel } from '../../engine/effects/buffs/spellMods'
import { DAMAGE_SPECS, resolveElement } from '../../engine/effects/damage/pipeline'
import { pathTo, type Reachable } from '../../engine/move'
import { performAction, type Controller } from '../../engine/runner'
import { compileTargetMask, matchesTargetMask } from '../../engine/targetMask'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { CELL_COUNT, distance, neighborsOf } from '../../map/geometry'
import { zoneMembership } from '../../map/zones'
import { defaultPresetOf, findPreset, type Preset, type PresetTarget, type RotationStep } from '../../optimizer/team/presets'
import type { AIConfig } from '../types'

// ───────────────────────────── classification analytique des effets ─────────────────────────────

const HEAL_IDS = new Set([81, 108, 2998, 2999, 3000, 3001, 3002, 143, 407, 1109, 90, 786])
const SHIELD_IDS = new Set([1020, 1039, 1040])
const AP_MP_LOSS_IDS = new Set([77, 84, 101, 127, 168, 169, 1079, 1080])
const BUFF_IDS = new Set([
  111, 112, 115, 117, 118, 119, 120, 123, 125, 126, 128, 138, 160, 161, 178, 182, 410, 412, 414, 416, 418, 420, 752,
  753, 210, 211, 212, 213, 1027, 1076, 1078, 1171, 2800, 2803, 2804, 2807, 2812, 2844, 2971, 280, 281, 285, 287, 290,
  291, 293, 296, 2935,
])
const DEBUFF_IDS = new Set([
  116, 145, 152, 154, 155, 157, 162, 163, 171, 186, 411, 413, 417, 419, 421, 754, 755, 215, 216, 217, 218, 219, 776, 1033,
  1172, 2802, 2805, 2806, 2972, 1163, 266, 268, 269, 271, 320,
])
const SUMMON_IDS = new Set([180, 181, 405, 1008, 1011, 1097, 2796])
const MARK_IDS = new Set([400, 401, 402, 1091, 1165, 2022])

type EffectKind = 'damage' | 'heal' | 'shield' | 'apmp' | 'buff' | 'debuff' | 'summon' | 'mark' | 'other'

function effectKind(e: EffectData): EffectKind {
  const id = e.effectId
  if (DAMAGE_SPECS.has(id)) return 'damage'
  if (HEAL_IDS.has(id)) return 'heal'
  if (SHIELD_IDS.has(id)) return 'shield'
  if (AP_MP_LOSS_IDS.has(id)) return 'apmp'
  if (BUFF_IDS.has(id)) return 'buff'
  if (DEBUFF_IDS.has(id)) return 'debuff'
  if (SUMMON_IDS.has(id)) return 'summon'
  if (MARK_IDS.has(id)) return 'mark'
  return 'other'
}

/** Jet moyen d'une ligne (diceSide 0 ⇒ valeur fixe diceNum). */
const avgDice = (e: EffectData): number => (e.diceSide > 0 ? (e.diceNum + e.diceSide) / 2 : e.diceNum)

interface SpellInfo {
  kinds: EffectKind[]
  damagePerCast: number
  offensive: boolean
  selfOnly: boolean
  needsFreeCell: boolean
}

const infoCache = new WeakMap<SpellLevelData, SpellInfo>()

/** Nature d'un niveau de sort (calculée une fois ; les modificateurs de sort ne changent pas les effets). */
function spellInfo(lvl: SpellLevelData): SpellInfo {
  let info = infoCache.get(lvl)
  if (info) return info
  const kinds = lvl.effects.map(effectKind)
  let dmg = 0
  lvl.effects.forEach((e, i) => {
    if (kinds[i] === 'damage') dmg += avgDice(e)
  })
  info = {
    kinds,
    damagePerCast: dmg,
    offensive: kinds.some(k => k === 'damage' || k === 'apmp' || k === 'debuff'),
    selfOnly: lvl.range <= 0 && lvl.minRange <= 0,
    // Case libre : exigée par le sort, ou invocation/marque SANS dégâts (les sorts de l'Huppermage posent une rune ET
    // frappent la cible : ils visent un combattant).
    needsFreeCell: lvl.needFreeCell || (kinds.some(k => k === 'summon' || k === 'mark') && !kinds.includes('damage')),
  }
  infoCache.set(lvl, info)
  return info
}

/** Multiplicateur de caractéristique d'un élément de dégâts (Puissance comprise). */
function statMult(f: Fighter, element: number): number {
  const s = f.stats
  const stat = element === 1 ? s.strength : element === 2 ? s.intelligence : element === 3 ? s.chance : element === 4 ? s.agility : s.strength
  return 1 + Math.max(0, stat + s.power) / 100
}

// ───────────────────────────── contexte d'un tour ─────────────────────────────

/** Contexte d'un tour : vue honnête + caches invalidés après chaque action (`refresh`). */
interface TurnCtx {
  engine: Engine
  fight: FightState
  me: Fighter
  seed: number
  visible: readonly Fighter[]
  /** Combattants tels que vus par l'équipe, par id (invisible adverse : copie placée sur sa dernière case connue). */
  seen: Map<number, Fighter>
  enemies: Fighter[]
  /** Occupant visible de chaque case (−1 = libre). */
  occ: Int16Array
  /** Cases occupées (vue honnête), croissantes : les zones ne sont testées que sur elles. */
  occupied: number[]
  /** Niveaux de sort modifiés par les buffs du lanceur. */
  lvl: Map<number, SpellLevelData>
  /** Estimations par « spellId:case » depuis la case actuelle. */
  scores: Map<number, CastValue>
}

/**
 * Estimation d'un lancer : total et parts offensive (ennemis), soin utile, soutien (buffs, boucliers, invocations) ;
 * `engage` = part « directe » sur les ennemis (dégâts et retraits PA/PM, hors simples débuffs) : un lancer qui n'en a
 * pas (ex. Roulette de l'Ecaflip, qui débuffe toute la carte) ne compte pas comme un engagement du combat.
 */
interface CastValue {
  total: number
  offense: number
  heal: number
  support: number
  engage: number
}

function turnCtx(engine: Engine, fight: FightState, me: Fighter, seed: number): TurnCtx {
  const visible = createView(engine, fight, me, seed).visible()
  const occ = new Int16Array(CELL_COUNT).fill(-1)
  const seen = new Map<number, Fighter>()
  const occupied: number[] = []
  for (const f of visible) {
    seen.set(f.id, f)
    if (f.alive && f.cell >= 0 && f.carriedBy === undefined) {
      if (occ[f.cell] < 0) occupied.push(f.cell)
      occ[f.cell] = f.id
    }
  }
  occupied.sort((a, b) => a - b)
  return {
    engine,
    fight,
    me,
    seed,
    visible,
    seen,
    enemies: visible.filter(f => f.alive && f.team !== me.team && f.cell >= 0 && f.carriedBy === undefined),
    occ,
    occupied,
    lvl: new Map(),
    scores: new Map(),
  }
}

const refresh = (ctx: TurnCtx): TurnCtx => turnCtx(ctx.engine, ctx.fight, ctx.me, ctx.seed)

function levelOf(ctx: TurnCtx, spell: KnownSpell): SpellLevelData {
  let l = ctx.lvl.get(spell.spellId)
  if (!l) ctx.lvl.set(spell.spellId, (l = modifiedSpellLevel(ctx.me, spell.level)))
  return l
}

/** Occupant d'une case selon la vue honnête (jamais la case réelle d'un invisible adverse). */
function occupantAt(ctx: TurnCtx, cell: number): Fighter | undefined {
  const id = cell >= 0 && cell < CELL_COUNT ? ctx.occ[cell] : -1
  return id >= 0 ? ctx.seen.get(id) : undefined
}

/**
 * Cases atteignables avec les PM actuels (BFS 4-voisins, même ordre que `reachableCells` du moteur) sur l'occupation
 * VUE par l'équipe : un invisible adverse bloque sa dernière case connue, pas sa case réelle. Le déplacement réel
 * (`move`) s'arrête de lui-même s'il bute sur lui, comme en jeu.
 */
function honestReach(ctx: TurnCtx): Reachable {
  const me = ctx.me
  const cells = ctx.fight.map.cells
  const cost = new Map<number, number>([[me.cell, 0]])
  const prev = new Map<number, number>()
  const queue = [me.cell]
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi]
    const d = cost.get(c)!
    if (d >= me.mp) continue
    for (const n of neighborsOf(c)) {
      if (cost.has(n) || !cells[n]?.walkable || ctx.occ[n] >= 0) continue
      cost.set(n, d + 1)
      prev.set(n, c)
      queue.push(n)
    }
  }
  return { cost, prev }
}

// ───────────────────────────── estimation d'un lancer ─────────────────────────────

/** Effets « lance un sort » dont le lanceur est le lanceur du sort parent (1160/2160 : sur chaque cible ; 2960 : une fois). */
const SUB_SPELL_ON_TARGETS = new Set([1160, 2160])
const SUB_SPELL_ON_CELL = 2960
/** Profondeur maximale des sous-sorts estimés (le moteur va jusqu'à 4 ; au-delà, contribution négligeable). */
const MAX_SUB_DEPTH = 2

/**
 * Dégâts moyens d'une ligne sur `t` : formule DoMath (src/damage `expectedDamage` : caractéristique, puissance,
 * dommages fixes, résistances de la cible, mêlée/distance) pour les dommages « boostés » ; approximation par le
 * multiplicateur de caractéristique pour les autres familles (fixes, % PV, PM utilisés).
 */
function lineDamage(me: Fighter, t: Fighter, e: EffectData, v: number): number {
  const spec = DAMAGE_SPECS.get(e.effectId)
  if (spec?.family === 'boosted') {
    const element = resolveElement(spec.element, me.stats)
    if (element >= 0) {
      const min = e.diceNum
      const max = e.diceSide > 0 ? e.diceSide : e.diceNum
      const input = {
        attacker: me.stats,
        defender: t.stats,
        element: element as Element,
        crit: false,
        isWeapon: false,
        isMelee: me.cell >= 0 && t.cell >= 0 && distance(me.cell, t.cell) <= 1,
        defenderIsPlayer: t.kind === 'player',
      }
      return Math.max(0, expectedDamage(input, null, { min, max }, 0))
    }
  }
  return v * statMult(me, e.element)
}

/**
 * Estimation analytique (PVe approximatifs) du lancer de `spell` sur `cell` depuis `from`, par composantes. Les
 * sous-sorts lancés par le lanceur (1160/2160 sur chaque cible touchée, 2960 sur la case) sont estimés récursivement
 * (≤ 2 niveaux) : beaucoup de sorts portent leurs dégâts dans un sous-sort (runes de l'Huppermage, cartes de
 * l'Ecaflip…). N'appelle ni `castSpell` ni `cloneFight` (0 nœud).
 */
function scoreCast(ctx: TurnCtx, spell: KnownSpell, cell: number, from: number): CastValue {
  const v0: CastValue = { total: 0, offense: 0, heal: 0, support: 0, engage: 0 }
  scoreEffects(ctx, levelOf(ctx, spell).effects, spellInfo(spell.level).kinds, cell, from, 0, v0)
  v0.total = v0.offense + v0.heal + v0.support
  return v0
}

/**
 * Cases OCCUPÉES couvertes par une zone (croissantes) : la zone n'est jamais énumérée — une zone « toute la carte »
 * (C63, 560 cases : sous-sorts des balises du Crâ, Flèche Dévorante…) coûtait ≈ 0,3 ms par estimation — mais testée
 * case par case (`zoneMembership`, même règle que `zoneCells`) sur les seules cases occupées.
 */
function occupiedInZone(ctx: TurnCtx, zone: EffectData['zone'], cell: number, from: number): number[] {
  const inZone = zoneMembership(zone, cell, from)
  const out: number[] = []
  for (const c of ctx.occupied) if (inZone(c)) out.push(c)
  return out
}

/** Accumule dans `v0` la valeur des `effects` lancés sur `cell` (voir `scoreCast`). */
function scoreEffects(ctx: TurnCtx, effects: readonly EffectData[], kinds: readonly EffectKind[], cell: number, from: number, depth: number, v0: CastValue): void {
  const me = ctx.me
  let lastZone: EffectData['zone'] | undefined
  let lastCells: number[] = []
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i]
    const kind = kinds[i] ?? effectKind(e)
    if (kind === 'other') {
      if (depth >= MAX_SUB_DEPTH || e.delay > 0) continue
      const sub = SUB_SPELL_ON_TARGETS.has(e.effectId) || e.effectId === SUB_SPELL_ON_CELL
        ? ctx.engine.data.spellLevel(e.diceNum, { grade: e.diceSide || undefined })
        : undefined
      if (!sub) continue
      const subKinds = spellInfo(sub).kinds
      if (e.effectId === SUB_SPELL_ON_CELL) {
        if (matchesTargetMask(e.targetMask, me, me)) scoreEffects(ctx, sub.effects, subKinds, cell, from, depth + 1, v0)
        continue
      }
      if (e.zone !== lastZone) {
        lastZone = e.zone
        lastCells = occupiedInZone(ctx, e.zone, cell, from)
      }
      for (const c of lastCells) {
        const t = occupantAt(ctx, c)
        if (t && matchesTargetMask(e.targetMask, me, t)) scoreEffects(ctx, sub.effects, subKinds, t.cell, from, depth + 1, v0)
      }
      continue
    }
    if (kind === 'summon' || kind === 'mark') {
      // Invocation / marque : utile près des ennemis, sur une case libre.
      if (depth > 0 || occupantAt(ctx, cell)) continue
      const near = ctx.enemies.some(en => distance(en.cell, cell) <= 2)
      v0.support += kind === 'summon' ? (near ? 25 : 12) : near ? 10 : 0
      continue
    }
    if (e.zone !== lastZone) {
      lastZone = e.zone
      lastCells = occupiedInZone(ctx, e.zone, cell, from)
    }
    // Effets différés (poisons, explosions programmées) : comptés à moitié.
    const w = e.delay > 0 ? 0.5 : 1
    const v = avgDice(e)
    let hitCaster = false
    const apply = (t: Fighter) => {
      const enemy = t.team !== me.team
      switch (kind) {
        case 'damage': {
          const d = w * lineDamage(me, t, e, v)
          const ehp = t.hp + t.shield
          if (enemy) {
            const val = Math.min(d, ehp) + (d >= ehp ? 0.3 * t.maxHp : 0)
            v0.offense += val
            v0.engage += val
          } else v0.offense -= 1.5 * d
          break
        }
        case 'heal': {
          const h = Math.min(v * statMult(me, 2) * 0.5, t.maxHp - t.hp)
          if (enemy) v0.offense -= h
          else v0.heal += h
          break
        }
        case 'shield':
          v0.support += enemy ? -15 : t.hp < t.maxHp ? 15 : 6
          break
        case 'apmp':
          v0.offense += enemy ? 12 * v : -12 * v
          if (enemy) v0.engage += 12 * v
          break
        case 'buff':
          v0.support += enemy ? -6 : 8
          break
        case 'debuff':
          if (enemy) v0.offense += 8
          else v0.support -= 8
          break
      }
    }
    for (const c of lastCells) {
      const t = occupantAt(ctx, c)
      if (!t || !matchesTargetMask(e.targetMask, me, t)) continue
      if (t === me) hitCaster = true
      apply(t)
    }
    if (!hitCaster && compileTargetMask(e.targetMask).addsCaster && matchesTargetMask(e.targetMask, me, me)) apply(me)
  }
}

/** Estimation mise en cache par (sort, case) pour l'état courant (orientation de zone depuis la case actuelle). */
function cachedScore(ctx: TurnCtx, spell: KnownSpell, cell: number): CastValue {
  const key = spell.spellId * 1024 + cell
  let s = ctx.scores.get(key)
  if (s === undefined) ctx.scores.set(key, (s = scoreCast(ctx, spell, cell, ctx.me.cell)))
  return s
}

/**
 * Lancer acceptable : utile aux ennemis (dégâts, retraits, débuffs), soin réellement utile, ou soutien pur (buff,
 * bouclier, invocation) une seule fois par sort et par tour — pas de répétition d'un buff sans effet chiffrable.
 * Mode 'offense' : uniquement un lancer qui touche un ennemi.
 */
function acceptable(ctx: TurnCtx, spell: KnownSpell, v: CastValue, mode: 'any' | 'offense'): boolean {
  if (!(v.total > 0)) return false
  if (v.offense > 0) return true
  if (mode === 'offense') return false
  if (v.heal > 0) return true
  // Un sort à dégâts lancé sans toucher d'ennemi (pour un effet secondaire de buff) gaspille ses PA.
  if (spellInfo(spell.level).damagePerCast > 0) return false
  return v.support > 0 && (ctx.me.castsThisTurn[spell.spellId] ?? 0) === 0
}

/** Cases cibles candidates d'un sort (selon sa nature et l'indice de la rotation). */
function candidateCells(ctx: TurnCtx, spell: KnownSpell, hint: PresetTarget): number[] {
  const me = ctx.me
  const info = spellInfo(spell.level)
  if (hint === 'self' || info.selfOnly) return [me.cell]
  const out = new Set<number>()
  if (info.needsFreeCell) {
    // Cases libres au contact des ennemis les plus proches (3 au plus).
    const enemies = [...ctx.enemies].sort((a, b) => distance(me.cell, a.cell) - distance(me.cell, b.cell) || a.id - b.id)
    for (const en of enemies.slice(0, 3)) {
      for (const n of neighborsOf(en.cell)) if (ctx.fight.map.cells[n]?.walkable && !occupantAt(ctx, n)) out.add(n)
    }
    if (!info.offensive) for (const n of neighborsOf(me.cell)) if (ctx.fight.map.cells[n]?.walkable && !occupantAt(ctx, n)) out.add(n)
  } else {
    for (const f of ctx.visible) if (f.alive && f.cell >= 0 && f.carriedBy === undefined) out.add(f.cell)
  }
  return [...out].sort((a, b) => a - b)
}

interface CastChoice {
  spellId: number
  cell: number
  score: number
  /** Part offensive de l'estimation (> 0 : le lancer touche un ennemi). */
  offense: number
  /** Part directe (dégâts, retraits PA/PM) sur les ennemis. */
  engage: number
}

/** Préfiltre de portée (sans LdV ni ligne) : la case est-elle dans l'anneau de portée depuis `from` ? */
function inRing(ctx: TurnCtx, lvl: SpellLevelData, from: number, cell: number): boolean {
  const d = distance(from, cell)
  const max = lvl.range + (lvl.rangeBoostable ? ctx.me.stats.range : 0)
  return d >= lvl.minRange && d <= Math.max(lvl.minRange, max)
}

/** Meilleure cible acceptable (`acceptable`) d'un sort lançable depuis `from`, ou undefined. */
function bestTarget(
  ctx: TurnCtx,
  spell: KnownSpell,
  hint: PresetTarget,
  from: number,
  cells = candidateCells(ctx, spell, hint),
  mode: 'any' | 'offense' = 'any',
): CastChoice | undefined {
  const me = ctx.me
  const lvl = levelOf(ctx, spell)
  if (me.ap < lvl.apCost) return undefined
  let best: CastChoice | undefined
  for (const cell of cells) {
    if (!inRing(ctx, lvl, from, cell)) continue
    const v = cachedScore(ctx, spell, cell)
    if (!acceptable(ctx, spell, v, mode) || (best && v.total <= best.score)) continue
    if (canCast(ctx.engine, ctx.fight, me, spell, cell, from === me.cell ? {} : { fromCell: from }) !== null) continue
    best = { spellId: spell.spellId, cell, score: v.total, offense: v.offense, engage: v.engage }
  }
  return best
}

// ───────────────────────────── déplacements ─────────────────────────────

/** Portée maximale d'un sort (PO comprise si modifiable). */
function spellRange(ctx: TurnCtx, s: KnownSpell): number {
  const lvl = levelOf(ctx, s)
  return lvl.range + (lvl.rangeBoostable ? ctx.me.stats.range : 0)
}

/**
 * Portée « idéale » d'approche : portée du sort à dégâts le plus rentable (dégâts moyens par PA), sorts de la rotation
 * d'abord, bornée à [1, 8] (un sort de zone géante ou à portée de toute la carte ne doit pas figer le personnage loin
 * des ennemis) ; à défaut de sort à dégâts, portée des sorts offensifs (retraits, débuffs) ; 1 sans sort offensif.
 */
function idealRange(ctx: TurnCtx, preset: Preset | undefined): number {
  const rotation = new Set(preset?.rotation.map(r => r.spell) ?? [])
  let best: { r: number; key: number } | undefined
  let fallback = 0
  for (const s of ctx.me.spells) {
    const info = spellInfo(s.level)
    if (!info.offensive || info.selfOnly) continue
    const r = spellRange(ctx, s)
    fallback = Math.max(fallback, r)
    if (!(info.damagePerCast > 0)) continue
    const key = (rotation.has(s.spellId) ? 1e6 : 0) + info.damagePerCast / Math.max(1, s.level.apCost)
    if (!best || key > best.key || (key === best.key && r > best.r)) best = { r, key }
  }
  return Math.max(1, Math.min(8, best ? best.r : fallback || 1))
}

function moveTo(ctx: TurnCtx, reach: Reachable, cell: number): boolean {
  const path = pathTo(reach, ctx.me.cell, cell)
  if (!path || path.length < 2) return false
  return performAction(ctx.engine, ctx.fight, ctx.me, { type: 'move', path }).ok
}

/**
 * Déplacement « pour lancer » : case atteignable la moins coûteuse d'où l'un des `spells` touche un ennemi (part
 * offensive > 0) ; parmi les cases de même coût, meilleur score puis plus petit id. Renvoie vrai si le combattant a
 * bougé.
 */
function moveToCast(ctx: TurnCtx, spells: { spell: KnownSpell; hint: PresetTarget }[]): boolean {
  const me = ctx.me
  if (me.mp < 1 || !spells.length) return false
  const usable = spells.filter(({ spell }) => me.ap >= levelOf(ctx, spell).apCost)
  if (!usable.length) return false
  const cands = usable.map(({ spell, hint }) => ({ spell, cells: candidateCells(ctx, spell, hint) }))
  const reach = honestReach(ctx)
  const byCost: number[][] = []
  for (const [c, cost] of reach.cost) if (c !== me.cell) (byCost[cost] ??= []).push(c)
  for (const cells of byCost) {
    if (!cells) continue
    cells.sort((a, b) => a - b)
    let best: { cell: number; score: number } | undefined
    for (const c of cells) {
      for (const { spell, cells: targets } of cands) {
        const choice = bestTarget(ctx, spell, 'auto', c, targets, 'offense')
        if (choice && (!best || choice.score > best.score)) best = { cell: c, score: choice.score }
      }
    }
    if (best) return moveTo(ctx, reach, best.cell)
  }
  return false
}

/** Approche : case atteignable minimisant |distance à l'ennemi le plus proche − portée idéale|. */
function approach(ctx: TurnCtx, ideal: number): boolean {
  const me = ctx.me
  if (me.mp < 1 || !ctx.enemies.length) return false
  const reach = honestReach(ctx)
  const gap = (c: number) => {
    let m = Infinity
    for (const e of ctx.enemies) m = Math.min(m, distance(c, e.cell))
    return Math.abs(m - ideal)
  }
  let bestCell = me.cell
  let bestGap = gap(me.cell)
  let bestCost = 0
  for (const [c, cost] of reach.cost) {
    const g = gap(c)
    if (g < bestGap || (g === bestGap && (cost < bestCost || (cost === bestCost && c < bestCell)))) {
      bestCell = c
      bestGap = g
      bestCost = cost
    }
  }
  return bestCell !== me.cell && moveTo(ctx, reach, bestCell)
}

/** Fin de tour d'un profil distance : s'éloigner d'ennemis à ≤ 3 cases (distance minimale maximale). */
function kite(ctx: TurnCtx): void {
  const me = ctx.me
  if (me.mp < 1 || !ctx.enemies.length) return
  const minDist = (c: number) => {
    let m = Infinity
    for (const e of ctx.enemies) m = Math.min(m, distance(c, e.cell))
    return m
  }
  if (minDist(me.cell) > 3) return
  const reach = honestReach(ctx)
  let bestCell = me.cell
  let bestD = minDist(me.cell)
  let bestCost = 0
  for (const [c, cost] of reach.cost) {
    const d = minDist(c)
    if (d > bestD || (d === bestD && (cost < bestCost || (cost === bestCost && c < bestCell)))) {
      bestCell = c
      bestD = d
      bestCost = cost
    }
  }
  if (bestCell !== me.cell) moveTo(ctx, reach, bestCell)
}

// ───────────────────────────── tour ─────────────────────────────

const MAX_ACTIONS = 16

/** Sorts du complément générique : dégâts moyens par PA décroissants, puis id. */
function genericOrder(me: Fighter): KnownSpell[] {
  return [...me.spells].sort((a, b) => {
    const da = spellInfo(a.level).damagePerCast / Math.max(1, a.level.apCost)
    const db = spellInfo(b.level).damagePerCast / Math.max(1, b.level.apCost)
    return db - da || a.spellId - b.spellId
  })
}

function presetOf(me: Fighter): Preset | undefined {
  if (me.kind !== 'player') return undefined
  const p = findPreset(me.tags.presetId as string | undefined)
  if (p || me.breedId === undefined) return p
  try {
    return defaultPresetOf(me.breedId)
  } catch {
    return undefined
  }
}

/** Joue le tour `scripted` de `me` (voir l'en-tête). `seed` : graine IA (vue honnête). */
export function playScriptedTurn(engine: Engine, fight: FightState, me: Fighter, seed = 0): void {
  const preset = presetOf(me)
  let ctx = turnCtx(engine, fight, me, seed)
  let actions = 0
  /** Lancers réussis qui engageaient un ennemi (dégâts ou retraits PA/PM). */
  let hits = 0
  let movedToCast = false
  const steps: RotationStep[] = preset?.rotation ?? []
  const known = (id: number) => me.spells.find(s => s.spellId === id)

  const cast = (c: CastChoice): boolean => {
    if (actions >= MAX_ACTIONS || fight.ended || !me.alive) return false
    actions++
    const ok = performAction(engine, fight, me, { type: 'cast', spellId: c.spellId, cell: c.cell }).ok
    if (ok && c.engage > 0) hits++
    ctx = refresh(ctx)
    return ok
  }

  // 1. Rotation du preset.
  for (const step of steps) {
    const spell = known(step.spell)
    if (!spell) continue
    for (let k = 0; k < (step.repeat ?? 1); k++) {
      if (fight.ended || !me.alive || actions >= MAX_ACTIONS) return
      let choice = bestTarget(ctx, spell, step.target, me.cell)
      if (!choice && !movedToCast && spellInfo(spell.level).offensive) {
        movedToCast = moveToCast(ctx, [{ spell, hint: step.target }])
        if (movedToCast) {
          actions++
          ctx = refresh(ctx)
          choice = bestTarget(ctx, spell, step.target, me.cell)
        }
      }
      if (!choice || !cast(choice)) break
    }
  }

  // 2. Complément générique (ordre dégâts/PA).
  const order = genericOrder(me)
  for (let guard = 0; guard < MAX_ACTIONS && !fight.ended && me.alive && actions < MAX_ACTIONS; guard++) {
    let best: CastChoice | undefined
    for (const spell of order) {
      const c = bestTarget(ctx, spell, 'auto', me.cell)
      if (c && (!best || c.score > best.score)) best = c
    }
    if (!best) {
      if (movedToCast) break
      // Rien depuis la case actuelle : se déplacer d'où l'un des 4 meilleurs sorts offensifs porte.
      const offensive = order
        .filter(s => spellInfo(s.level).offensive && (me.cooldowns[s.spellId] ?? 0) <= 0)
        .slice(0, 4)
        .map(spell => ({ spell, hint: 'auto' as PresetTarget }))
      movedToCast = moveToCast(ctx, offensive)
      if (!movedToCast) break
      actions++
      ctx = refresh(ctx)
      continue
    }
    if (!cast(best)) break
  }
  if (fight.ended || !me.alive) return

  // 3. Fin de tour : profil mêlée (portée ≤ 2 ou tank) → contact ; distance → s'éloigner après avoir frappé, sinon
  //    approcher à la portée offensive (un tour passé à se buffer loin des ennemis ne doit pas immobiliser le personnage).
  ctx = refresh(ctx)
  const range = idealRange(ctx, preset)
  const melee = range <= 2 || preset?.role === 'tank'
  if (melee) approach(ctx, 1)
  else if (hits === 0) approach(ctx, range)
  else kite(ctx)
}

/** Contrôleur `scripted` partagé par les personnages d'un combat (et leurs invocations). */
export function createScriptedPolicy(cfg: AIConfig): Controller {
  return { playTurn: (engine, fight, me) => playScriptedTurn(engine, fight, me, cfg.seed) }
}
