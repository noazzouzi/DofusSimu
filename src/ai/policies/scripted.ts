/**
 * Politique `scripted` (docs/design/ai.md §8.3, §15.6) — WP4 : rotations des presets (data/ai/presets.json), sans
 * recherche (0 nœud simulé). Utilisée par `createControllers` (src/ai/index.ts) pour les personnages et leurs
 * invocations quand `cfg.mode === 'scripted'` ; les monstres gardent le `MonsterBrain` 'play' dans tous les modes.
 *
 * Tour d'un personnage (preset lu dans `fighter.tags.presetId`, à défaut preset par défaut de sa classe) :
 *  1. étapes de la rotation dans l'ordre (chacune `repeat` fois au plus) : meilleure case cible du sort selon une
 *     estimation ANALYTIQUE (`scoreCast` : dégâts moyens des lignes × multiplicateur de caractéristique sur les
 *     ennemis touchés, tir ami pénalisé ×1,5, soins plafonnés aux PV manquants, retraits PA/PM, buffs/débuffs,
 *     invocations) ; un sort n'est lancé que si son score est > 0 ;
 *  2. complément générique : tant qu'un sort a un score > 0 depuis la case actuelle, le meilleur (ordre : dégâts
 *     moyens par PA, puis id) ;
 *  3. déplacement : au plus un déplacement « pour lancer » par tour (case atteignable la moins coûteuse d'où un sort
 *     de la rotation, ou l'un des 4 meilleurs sorts offensifs, porte), sinon approche à la portée idéale ; en fin de
 *     tour, un profil distance s'éloigne des ennemis proches (distance minimale maximale), un profil mêlée (portée
 *     offensive ≤ 2 ou tank) reste au contact.
 * Les invocations alliées jouent le complément générique + approche. Déplacements de placement purs (porter/jeter,
 * téléportations) : non joués (score analytique nul) — simplification assumée de la référence `scripted`.
 *
 * Coût : aucun clone ; caches par « état » (niveaux de sort modifiés, occupation des cases, scores par (sort, case))
 * invalidés après chaque action ; préfiltre de portée avant `canCast`.
 * Déterministe : aucun tirage ; départages par score, puis case, puis id de sort. N'utilise que la vue honnête
 * (`createView(...).visible()`, src/ai/core) : ni `fight.events`, ni pièges invisibles, ni dés futurs.
 */
import { createView } from '../core'
import type { EffectData, SpellLevelData } from '../../data/model'
import { canCast } from '../../engine/cast'
import type { Engine } from '../../engine/engine'
import { modifiedSpellLevel } from '../../engine/effects/buffs/spellMods'
import { DAMAGE_SPECS } from '../../engine/effects/damage/pipeline'
import { pathTo, reachableCells, type Reachable } from '../../engine/move'
import { performAction, type Controller } from '../../engine/runner'
import { compileTargetMask, matchesTargetMask } from '../../engine/targetMask'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { CELL_COUNT, distance, neighborsOf } from '../../map/geometry'
import { zoneCells } from '../../map/zones'
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
    needsFreeCell: lvl.needFreeCell || kinds.some(k => k === 'summon' || k === 'mark'),
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
  enemies: Fighter[]
  /** Occupant visible de chaque case (−1 = libre). */
  occ: Int16Array
  /** Niveaux de sort modifiés par les buffs du lanceur. */
  lvl: Map<number, SpellLevelData>
  /** Estimations par « spellId:case » depuis la case actuelle. */
  scores: Map<number, CastValue>
}

/** Estimation d'un lancer : total et parts offensive (ennemis), soin utile, soutien (buffs, boucliers, invocations). */
interface CastValue {
  total: number
  offense: number
  heal: number
  support: number
}

function turnCtx(engine: Engine, fight: FightState, me: Fighter, seed: number): TurnCtx {
  const visible = createView(engine, fight, me, seed).visible()
  const occ = new Int16Array(CELL_COUNT).fill(-1)
  for (const f of visible) if (f.alive && f.cell >= 0 && f.carriedBy === undefined) occ[f.cell] = f.id
  return {
    engine,
    fight,
    me,
    seed,
    visible,
    enemies: visible.filter(f => f.alive && f.team !== me.team && f.cell >= 0 && f.carriedBy === undefined),
    occ,
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

function occupantAt(ctx: TurnCtx, cell: number): Fighter | undefined {
  const id = cell >= 0 && cell < CELL_COUNT ? ctx.occ[cell] : -1
  return id >= 0 ? ctx.fight.fighters[id] : undefined
}

// ───────────────────────────── estimation d'un lancer ─────────────────────────────

/**
 * Estimation analytique (PVe approximatifs) du lancer de `spell` sur `cell` depuis `from`, par composantes.
 * N'appelle ni `castSpell` ni `cloneFight` (0 nœud).
 */
function scoreCast(ctx: TurnCtx, spell: KnownSpell, cell: number, from: number): CastValue {
  const me = ctx.me
  const lvl = levelOf(ctx, spell)
  const info = spellInfo(spell.level)
  const v0: CastValue = { total: 0, offense: 0, heal: 0, support: 0 }
  const effects = lvl.effects
  let lastZone: EffectData['zone'] | undefined
  let lastCells: number[] = []
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i]
    const kind = info.kinds[i] ?? effectKind(e)
    if (kind === 'other') continue
    if (kind === 'summon' || kind === 'mark') {
      // Invocation / marque : utile près des ennemis, sur une case libre.
      if (occupantAt(ctx, cell)) continue
      const near = ctx.enemies.some(en => distance(en.cell, cell) <= 2)
      v0.support += kind === 'summon' ? (near ? 25 : 12) : near ? 10 : 0
      continue
    }
    if (e.zone !== lastZone) {
      lastZone = e.zone
      lastCells = zoneCells(e.zone, cell, from)
    }
    const v = avgDice(e)
    let hitCaster = false
    const apply = (t: Fighter) => {
      const enemy = t.team !== me.team
      switch (kind) {
        case 'damage': {
          const d = v * statMult(me, e.element)
          const ehp = t.hp + t.shield
          if (enemy) v0.offense += Math.min(d, ehp) + (d >= ehp ? 0.3 * t.maxHp : 0)
          else v0.offense -= 1.5 * d
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
  v0.total = v0.offense + v0.heal + v0.support
  return v0
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
    best = { spellId: spell.spellId, cell, score: v.total, offense: v.offense }
  }
  return best
}

// ───────────────────────────── déplacements ─────────────────────────────

/** Portée maximale « utile » des sorts offensifs (profil mêlée ≤ 2). */
function offensiveRange(ctx: TurnCtx): number {
  let r = 0
  for (const s of ctx.me.spells) {
    if (!spellInfo(s.level).offensive) continue
    const lvl = levelOf(ctx, s)
    r = Math.max(r, lvl.range + (lvl.rangeBoostable ? ctx.me.stats.range : 0))
  }
  return r
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
  const reach = reachableCells(ctx.fight, me, ctx.engine)
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
  const reach = reachableCells(ctx.fight, me, ctx.engine)
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
  const reach = reachableCells(ctx.fight, me, ctx.engine)
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
  let movedToCast = false
  const steps: RotationStep[] = preset?.rotation ?? []
  const known = (id: number) => me.spells.find(s => s.spellId === id)

  const cast = (c: CastChoice): boolean => {
    if (actions >= MAX_ACTIONS || fight.ended || !me.alive) return false
    actions++
    const ok = performAction(engine, fight, me, { type: 'cast', spellId: c.spellId, cell: c.cell }).ok
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

  // 3. Fin de tour : profil mêlée (portée ≤ 2 ou tank) → contact ; distance → s'éloigner (ou approcher si rien lancé).
  ctx = refresh(ctx)
  const range = offensiveRange(ctx)
  const melee = range <= 2 || preset?.role === 'tank'
  if (melee) approach(ctx, 1)
  else if (actions === 0) approach(ctx, Math.max(2, range))
  else kite(ctx)
}

/** Contrôleur `scripted` partagé par les personnages d'un combat (et leurs invocations). */
export function createScriptedPolicy(cfg: AIConfig): Controller {
  return { playTurn: (engine, fight, me) => playScriptedTurn(engine, fight, me, cfg.seed) }
}
