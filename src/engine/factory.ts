/**
 * Fabrique de combattants : personnages (classe + caractéristiques calculées) et monstres (grade).
 */
import { addStats, emptyStats, type Stats, type TeamId } from '../core/types'
import type { DataStore } from '../data/store'
import type { Fighter, KnownSpell } from './types'

export interface PlayerFighterInput {
  name: string
  breedId: number
  level: number
  /** Caractéristiques totales (stuff + base) — cf. src/stats. */
  stats: Stats
  /** PV max (base + vitalité). */
  maxHp: number
  /** Sorts équipés (ids). Par défaut : toutes les variantes débloquées au niveau. */
  spellIds?: number[]
  /** Choix de variante par paire (0 = sort A, 1 = sort B). */
  variants?: (0 | 1)[]
  ai?: string
  role?: string
  team?: TeamId
  cell?: number
}

export function breedSpellIds(data: DataStore, breedId: number, level: number, variants?: (0 | 1)[]): number[] {
  const breed = data.breed(breedId)
  if (!breed) return []
  const ids: number[] = []
  breed.spellPairs.forEach(([a, b], i) => {
    const choice = variants?.[i]
    const candidates = choice === undefined ? [a, b] : [choice === 1 ? b : a]
    for (const id of candidates) {
      if (data.spellLevel(id, { playerLevel: level })) ids.push(id)
    }
  })
  return ids
}

export function knownSpells(data: DataStore, spellIds: number[], level: { grade?: number; playerLevel?: number }): KnownSpell[] {
  const out: KnownSpell[] = []
  for (const id of spellIds) {
    const lvl = data.spellLevel(id, level)
    const sp = data.spell(id)
    if (lvl) out.push({ spellId: id, level: lvl, name: sp?.name ?? `Sort ${id}` })
  }
  return out
}

export function createPlayerFighter(data: DataStore, input: PlayerFighterInput): Fighter {
  const spellIds = input.spellIds ?? breedSpellIds(data, input.breedId, input.level, input.variants)
  const stats = addStats(emptyStats(), input.stats)
  return {
    id: -1,
    team: input.team ?? 0,
    kind: 'player',
    name: input.name,
    breedId: input.breedId,
    level: input.level,
    baseStats: stats,
    stats: { ...stats },
    hp: input.maxHp,
    maxHp: input.maxHp,
    baseMaxHp: input.maxHp,
    shield: 0,
    ap: stats.ap,
    mp: stats.mp,
    cell: input.cell ?? -1,
    alive: true,
    states: [],
    buffs: [],
    spells: knownSpells(data, spellIds, { playerLevel: input.level }),
    cooldowns: {},
    castsThisTurn: {},
    castsOnTarget: {},
    ai: input.ai ?? 'player',
    role: input.role,
    direction: 1,
    tags: {},
  }
}

export interface MonsterFighterInput {
  monsterId: number
  grade: number
  team?: TeamId
  cell?: number
  name?: string
  summonerId?: number
  /** Facteur d'échelle appliqué aux caractéristiques (invocations : niveau de l'invocateur). */
  scale?: number
  ai?: string
}

export function createMonsterFighter(data: DataStore, input: MonsterFighterInput): Fighter {
  const m = data.monster(input.monsterId)
  if (!m) throw new Error(`Monstre inconnu : ${input.monsterId}`)
  const g = m.grades.find(x => x.grade === input.grade) ?? m.grades[m.grades.length - 1]
  const stats = addStats(emptyStats(), g.stats)
  stats.ap = g.ap
  stats.mp = g.mp
  const scale = input.scale ?? 1
  if (scale !== 1) {
    for (const k of ['strength', 'intelligence', 'chance', 'agility', 'wisdom', 'vitality'] as const) stats[k] = Math.floor(stats[k] * scale)
  }
  const hp = Math.floor(g.lifePoints * scale) + stats.vitality
  const spells: KnownSpell[] = []
  m.spells.forEach((spellId, i) => {
    const grades = (m as { spellGrades?: number[][] }).spellGrades?.[i]
    const spellGrade = grades ? grades[(g.grade ?? 1) - 1] : undefined
    if (spellGrade === 0) return
    const lvl = data.spellLevel(spellId, spellGrade ? { grade: spellGrade } : { grade: undefined })
    if (lvl) spells.push({ spellId, level: lvl, name: data.spell(spellId)?.name ?? `Sort ${spellId}` })
  })
  return {
    id: -1,
    team: input.team ?? 1,
    kind: input.summonerId !== undefined ? 'summon' : 'monster',
    name: input.name ?? m.name,
    monsterId: m.id,
    grade: g.grade,
    level: g.level,
    baseStats: stats,
    stats: { ...stats },
    hp,
    maxHp: hp,
    baseMaxHp: hp,
    shield: 0,
    ap: stats.ap,
    mp: stats.mp,
    cell: input.cell ?? -1,
    alive: true,
    states: [],
    buffs: [],
    spells,
    cooldowns: {},
    castsThisTurn: {},
    castsOnTarget: {},
    summonerId: input.summonerId,
    ai: input.ai ?? (m.isBoss ? `boss:${m.id}` : `monster:${m.id}`),
    direction: 5,
    tags: { canTackle: m.canTackle, canBePushed: m.canBePushed, canSwitchPos: m.canSwitchPos, boss: m.isBoss },
  }
}
