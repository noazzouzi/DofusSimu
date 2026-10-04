/**
 * Lancement de sorts : validation (PA, portée, ligne, diagonale, ligne de vue, relances, états),
 * jet de coup critique, calcul des zones et des cibles, puis application ordonnée des effets.
 */
import type { SpellLevelData } from '../data/model'
import { critChance } from '../damage/crit'
import { distance, inDiagonal, inLine, isInCastRange } from '../map/geometry'
import { hasLineOfSight } from '../map/los'
import { zoneCells } from '../map/zones'
import { checkStatesCriterion } from './criteria'
import type { Engine } from './engine'
import { applyEffects } from './effects/core'
import { modifiedSpellLevel } from './effects/buffs/spellMods'
import { forcedRollMode } from './effects/special'
import { nextRandom } from './random'
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

// Condition d'états du lanceur (statesCriterion « HS=x / HS!x », & | ( )) : voir criteria.ts.
export { checkStatesCriterion }

export function canCast(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  spell: KnownSpell,
  cell: number,
  opts: { ignoreAp?: boolean; fromCell?: number } = {},
): CastFailure | null {
  // Modificateurs de sorts du lanceur (portée, coût, lancers, LdV... — effects/buffs/spellMods.ts) ; `spell.level` sinon.
  const lvl = modifiedSpellLevel(caster, spell.level)
  const from = opts.fromCell ?? caster.cell
  if (!caster.alive) return 'dead'
  if (!opts.ignoreAp && caster.ap < lvl.apCost) return 'ap'
  if ((caster.cooldowns[spell.spellId] ?? 0) > 0) return 'cooldown'
  if (lvl.maxCastPerTurn > 0 && (caster.castsThisTurn[spell.spellId] ?? 0) >= lvl.maxCastPerTurn) return 'maxPerTurn'
  if (!checkStatesCriterion(lvl.statesCriterion, caster)) return 'state'
  if (engine.stateFlag(caster, 'preventsSpellCast')) return 'state'
  const mapCell = fight.map.cells[cell]
  // Une case non marchable n'est ciblable que si une entité y a été posée par script (Auroraire de l'Œil de Vortex
  // sur les heures I-III / X-XII, src/dungeons/vortex/setup.ts `syncAuroraireCell`) : l'entité reste une cible.
  if (!mapCell || (!mapCell.walkable && !engine.fighterAt(fight, cell))) return 'cellInvalid'
  const { min, max } = spellRange(caster, lvl)
  const d = distance(from, cell)
  // Portée en « pas » (une diagonale de r cases compte r — map-grammar, isInCastRange).
  if (!isInCastRange(from, cell, min, max, lvl.castInLine, lvl.castInDiagonal)) {
    if (lvl.castInLine && !lvl.castInDiagonal && !inLine(from, cell)) return 'line'
    if (lvl.castInDiagonal && !lvl.castInLine && !inDiagonal(from, cell)) return 'diagonal'
    if (lvl.castInLine && lvl.castInDiagonal && !inLine(from, cell) && !inDiagonal(from, cell)) return 'line'
    return 'range'
  }
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
    // La case cible doit elle-même être transparente (son occupant ne bloque pas).
    const targetBlocks = (c: number) => !fight.map.cells[c]?.los
    if (!hasLineOfSight(from, cell, blocks, targetBlocks)) return 'los'
  }
  return null
}

/** Probabilité de coup critique d'un sort pour un lanceur (0..1). */
export function critProbability(caster: Fighter, lvl: SpellLevelData): number {
  return critChance(lvl.critChance, caster.stats.critical) / 100
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
  const lvl = modifiedSpellLevel(caster, spell.level)
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
  if (crit) engine.trigger(fight, caster, { type: 'CC', source: caster })
  // Poisse / Chance (effets 781/782) : jets minimaux / maximaux pour les sorts du porteur.
  const forced = fight.options.rollMode === 'random' ? forcedRollMode(engine, fight, caster) : undefined
  const savedMode = fight.options.rollMode
  if (forced) fight.options.rollMode = forced
  applyEffects(engine, fight, caster, spell, spellId, effects, cell, casterCell, crit, false, 0)
  if (forced) fight.options.rollMode = savedMode
  delete caster.tags.critWeight
  engine.checkEnd(fight)
  return { ok: true, crit }
}

export { applyEffects } from './effects/core'
