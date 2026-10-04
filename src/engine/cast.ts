/**
 * Lancement de sorts : validation (PA, portée, ligne, diagonale, ligne de vue, relances, états),
 * jet de coup critique, calcul des zones et des cibles, puis application ordonnée des effets.
 */
import type { EffectData, SpellLevelData } from '../data/model'
import { distance, inDiagonal, inLine } from '../map/geometry'
import { hasLineOfSight } from '../map/los'
import { zoneCells, zoneEfficiency } from '../map/zones'
import type { Engine } from './engine'
import { getEffectHandler, noteUnknownEffect, type EffectContext } from './effects/registry'
import { nextRandom } from './random'
import { matchesTargetMask } from './targetMask'
import type { Fighter, FightState, KnownSpell } from './types'

export type CastFailure =
  | 'dead'
  | 'ap'
  | 'cooldown'
  | 'maxPerTurn'
  | 'maxPerTarget'
  | 'range'
  | 'line'
  | 'diagonal'
  | 'los'
  | 'cellNotFree'
  | 'cellNotTaken'
  | 'cellInvalid'
  | 'state'
  | 'unknownSpell'

export function spellRange(caster: Fighter, lvl: SpellLevelData): { min: number; max: number } {
  const bonus = lvl.rangeBoostable ? caster.stats.range : 0
  return { min: lvl.minRange, max: Math.max(lvl.minRange, lvl.range + bonus) }
}

/** Vérifie la condition d'états du lanceur, ex. "E12&e34|E56" (E = doit avoir, e = ne doit pas avoir). */
export function checkStatesCriterion(criterion: string, f: Fighter): boolean {
  if (!criterion) return true
  return criterion.split('|').some(group =>
    group.split('&').every(term => {
      const t = term.trim()
      if (!t) return true
      const m = /^([Ee])(\d+)$/.exec(t)
      if (!m) return true
      const has = f.states.includes(Number(m[2]))
      return m[1] === 'E' ? has : !has
    }),
  )
}

export function canCast(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  spell: KnownSpell,
  cell: number,
  opts: { ignoreAp?: boolean; fromCell?: number } = {},
): CastFailure | null {
  const lvl = spell.level
  const from = opts.fromCell ?? caster.cell
  if (!caster.alive) return 'dead'
  if (!opts.ignoreAp && caster.ap < lvl.apCost) return 'ap'
  if ((caster.cooldowns[spell.spellId] ?? 0) > 0) return 'cooldown'
  if (lvl.maxCastPerTurn > 0 && (caster.castsThisTurn[spell.spellId] ?? 0) >= lvl.maxCastPerTurn) return 'maxPerTurn'
  if (!checkStatesCriterion(lvl.statesCriterion, caster)) return 'state'
  if (engine.stateFlag(caster, 'preventsSpellCast')) return 'state'
  const mapCell = fight.map.cells[cell]
  if (!mapCell || !mapCell.walkable) return 'cellInvalid'
  const { min, max } = spellRange(caster, lvl)
  const d = distance(from, cell)
  if (d < min || d > max) return 'range'
  if (lvl.castInLine && lvl.castInDiagonal) {
    if (!inLine(from, cell) && !inDiagonal(from, cell)) return 'line'
  } else if (lvl.castInLine && !inLine(from, cell)) return 'line'
  else if (lvl.castInDiagonal && !inDiagonal(from, cell)) return 'diagonal'
  const occupant = engine.fighterAt(fight, cell)
  if (lvl.needFreeCell && occupant && occupant.id !== caster.id) return 'cellNotFree'
  if (lvl.needFreeCell && from !== caster.cell && cell === from) return 'cellNotFree'
  if (lvl.needTakenCell && !occupant) return 'cellNotTaken'
  if (lvl.maxCastPerTarget > 0 && occupant) {
    if ((caster.castsOnTarget[`${spell.spellId}:${occupant.id}`] ?? 0) >= lvl.maxCastPerTarget) return 'maxPerTarget'
  }
  if (lvl.castTestLos && d > 1) {
    const blocks = (c: number) => {
      if (c === from) return false
      const mc = fight.map.cells[c]
      if (!mc || !mc.los) return true
      const o = engine.fighterAt(fight, c)
      return !!o && o.id !== caster.id
    }
    if (!hasLineOfSight(from, cell, blocks)) return 'los'
  }
  return null
}

/** Probabilité de coup critique d'un sort pour un lanceur (0..1). */
export function critProbability(caster: Fighter, lvl: SpellLevelData): number {
  if (lvl.critChance <= 0) return 0
  return Math.max(0, Math.min(1, (lvl.critChance + caster.stats.critical) / 100))
}

export interface CastResult {
  ok: boolean
  failure?: CastFailure
  crit?: boolean
}

/**
 * Lance un sort. En mode de jet 'average', les effets normaux et critiques sont pondérés par la
 * probabilité de critique (via le multiplicateur `critWeight` lu par le module de dégâts).
 */
export function castSpell(engine: Engine, fight: FightState, caster: Fighter, spellId: number, cell: number): CastResult {
  const spell = caster.spells.find(s => s.spellId === spellId)
  if (!spell) return { ok: false, failure: 'unknownSpell' }
  const failure = canCast(engine, fight, caster, spell, cell)
  if (failure) return { ok: false, failure }
  const lvl = spell.level
  caster.ap -= lvl.apCost
  const pCrit = critProbability(caster, lvl)
  const crit = fight.options.rollMode === 'random' ? nextRandom(fight) < pCrit : false
  const effects = crit && lvl.criticalEffects.length ? lvl.criticalEffects : lvl.effects
  const occupant = engine.fighterAt(fight, cell)

  // Bookkeeping avant application (un sort peut tuer son lanceur ou terminer le combat).
  caster.castsThisTurn[spellId] = (caster.castsThisTurn[spellId] ?? 0) + 1
  if (occupant) {
    const k = `${spellId}:${occupant.id}`
    caster.castsOnTarget[k] = (caster.castsOnTarget[k] ?? 0) + 1
  }
  if (lvl.minCastInterval > 0) caster.cooldowns[spellId] = lvl.minCastInterval
  if (lvl.globalCooldown > 0) {
    for (const ally of engine.alliesOf(fight, caster, true)) {
      if (ally.spells.some(s => s.spellId === spellId)) ally.cooldowns[spellId] = Math.max(ally.cooldowns[spellId] ?? 0, lvl.globalCooldown)
    }
  }

  const casterCell = caster.cell
  const allCells = new Set<number>()
  for (const e of effects) for (const c of zoneCells(e.zone, cell, casterCell)) allCells.add(c)
  const mainElement = effects.find(e => e.element >= 0 && e.element <= 4)?.element
  engine.emit(fight, {
    t: 'cast',
    fighter: caster.id,
    spellId,
    spellName: spell.name,
    cell,
    crit,
    apCost: lvl.apCost,
    zone: [...allCells],
    element: mainElement as never,
  })
  engine.emit(fight, { t: 'apmp', target: caster.id, ap: caster.ap, mp: caster.mp, reason: 'cast' })

  if (fight.options.rollMode === 'average' && pCrit > 0 && lvl.criticalEffects.length) {
    // Évaluation en espérance : on applique les effets normaux avec un poids (1 - p) et critiques avec p
    // uniquement pour les effets de dommages/soins ; les autres effets sont appliqués une fois (normaux).
    caster.tags.critWeight = pCrit
  }
  applyEffects(engine, fight, caster, spell, spellId, effects, cell, casterCell, crit, false, 0)
  delete caster.tags.critWeight
  engine.checkEnd(fight)
  return { ok: true, crit }
}

/**
 * Applique une liste d'effets (sort, glyphe, piège, sort déclenché) sur une cellule cible.
 * Gère les effets aléatoires (random/group), les zones, masques et l'efficacité de zone.
 */
export function applyEffects(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  spell: KnownSpell | null,
  spellId: number,
  effects: EffectData[],
  cell: number,
  casterCell: number,
  crit: boolean,
  indirect: boolean,
  depth: number,
): void {
  if (depth > 6) return
  const ordered = [...effects].sort((a, b) => a.order - b.order)
  // Effets aléatoires : parmi les effets d'un même groupe avec random > 0, un seul est tiré.
  const randomPicks = new Map<number, EffectData>()
  const groups = new Map<number, EffectData[]>()
  for (const e of ordered) if (e.random > 0) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  for (const [g, list] of groups) {
    let r = nextRandom(fight) * list.reduce((s, e) => s + e.random, 0)
    for (const e of list) {
      r -= e.random
      if (r <= 0) {
        randomPicks.set(g, e)
        break
      }
    }
  }
  for (const effect of ordered) {
    if (fight.ended && depth === 0) break
    if (effect.random > 0 && randomPicks.get(effect.group) !== effect) continue
    const entry = getEffectHandler(effect.effectId)
    if (!entry) {
      noteUnknownEffect(effect.effectId)
      continue
    }
    const cells = zoneCells(effect.zone, cell, casterCell)
    const targets: EffectContext['targets'] = []
    const efficiency = new Map<number, number>()
    for (const c of cells) {
      const f = engine.fighterAt(fight, c)
      if (!f || !f.alive) continue
      if (!matchesTargetMask(effect.targetMask, caster, f)) continue
      targets.push(f)
      efficiency.set(f.id, zoneEfficiency(effect.zone, cell, c))
    }
    // Les cibles sont traitées de la plus proche à la plus éloignée du centre.
    targets.sort((a, b) => distance(cell, a.cell) - distance(cell, b.cell))
    const ctx: EffectContext = {
      engine,
      fight,
      caster,
      spell,
      spellId,
      effect,
      targetCell: cell,
      casterCell,
      cells,
      targets,
      efficiency,
      crit,
      indirect,
      depth,
    }
    entry.handler(ctx)
  }
}
