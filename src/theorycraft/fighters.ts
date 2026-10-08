/**
 * Theorycraft contre un boss — combattants HORS COMBAT (docs/design/theorycraft.md §1.4-1.5) : le personnage (depuis un
 * `CharacterBuild`, un `MemberSpec` ou des caractéristiques déjà calculées) et le boss (`createMonsterFighter` puis
 * caractéristiques et états imposés, comme `ProxyTarget.stats`/`states` du proxy de stuff), prêts pour le sac à dos de
 * DPT (`DptTableImpl.turn`, src/ai/core/dpt.ts) et la rotation soutenue (rotation.ts).
 *
 * Mêmes conventions que le proxy (src/optimizer/stuff/proxy.ts) : moteur partagé par donnée (`proxyEngine` : profils de
 * sorts et tables DPT en cache, communs avec le proxy), mêmes surcharges de cible (`applyTargetOverrides`) — tous deux
 * importés de src/optimizer/stuff/targetFighter.ts, qui ne dépend pas du mix du Vortex (défaut de proxy.ts) —,
 * personnage d'id 0 dans l'équipe 0, cible d'id 1 dans l'équipe 1. Les ids ET les équipes doivent être DISTINCTS : la
 * fabrique met `id = -1` à tout combattant, et le masque de cible verrait alors le lanceur lui-même (lignes « ennemis »
 * écartées, tests/ai-core-dpt.test.ts) — d'où une erreur explicite (`assertDistinct`).
 *
 * Hors combat, rien n'est lancé : ni les passifs d'équipement (effet 1175, `installEquipmentPassives` exige une case),
 * ni le sort de départ du boss, ni les états initiaux de classe (stances.ts) — à poser par `states`.
 *
 * Module PUR : aucun import `node:`, ni de src/dungeons, ni de proxy.ts (tests/theory-rotation.test.ts).
 */
import { createDptTable, type DptTableImpl } from '../ai/core/dpt'
import type { Stats, TeamId } from '../core/types'
import type { DataStore } from '../data/store'
import type { Engine } from '../engine'
import { createMonsterFighter, createPlayerFighter } from '../engine/factory'
import { bumpRev } from '../engine/rev'
import type { Fighter } from '../engine/types'
import { applyTargetOverrides, proxyEngine } from '../optimizer/stuff/targetFighter'
import type { MemberSpec } from '../optimizer/types'
import { computeBuildStats, type BuildDataSource, type CharacterBuild } from '../stats/build'

/** Id et équipe du personnage et de la cible (conventions du proxy). */
export const PLAYER_ID = 0
export const PLAYER_TEAM: TeamId = 0
export const TARGET_ID = 1
export const TARGET_TEAM: TeamId = 1

/** Moteur partagé du theorycraft (le même que celui du proxy de stuff : caches de profils et de DPT communs). */
export function theoryEngine(data: DataStore): Engine {
  return proxyEngine(data)
}

/** Table DPT partagée (sac à dos par tour, non calibré via `turn`). */
export function theoryDptTable(data: DataStore): DptTableImpl {
  return createDptTable(proxyEngine(data))
}

/** Personnage décrit sans build : classe, niveau, variantes (comme `ProxyMember`). */
export interface TheoryCharacter {
  breedId: number
  level: number
  variants: readonly (0 | 1)[]
  /** Preset d'origine (étiquette `presetId` : calibration éventuelle, rapports). */
  presetId?: string
  name?: string
}

export interface PlayerFighterOptions {
  /** Défaut `PLAYER_ID` (0). */
  id?: number
  /** Défaut `PLAYER_TEAM` (0). */
  team?: TeamId
  /** États posés sur le personnage (posture de classe, stances.ts). */
  states?: readonly number[]
  /** Sorts passifs d'équipement (effet 1175) — portés pour mémoire : jamais lancés hors combat. */
  passiveSpells?: readonly number[]
}

/** Personnage aux caractéristiques données (déjà calculées : `computeBuildStats`, ou candidat d'optimisation). */
export function playerFighterFromStats(data: DataStore, who: TheoryCharacter, stats: Stats, maxHp: number, opts: PlayerFighterOptions = {}): Fighter {
  const f = createPlayerFighter(data, {
    name: who.name ?? 'theorycraft',
    breedId: who.breedId,
    level: who.level,
    stats,
    maxHp,
    variants: who.variants.slice(),
    team: opts.team ?? PLAYER_TEAM,
    passiveSpells: opts.passiveSpells?.slice(),
  })
  f.id = opts.id ?? PLAYER_ID
  if (who.presetId) f.tags.presetId = who.presetId
  if (opts.states?.length) f.states = [...new Set(opts.states)]
  bumpRev(f)
  return f
}

/**
 * Personnage d'un build (caractéristiques par `computeBuildStats`, variantes du build). Un build invalide (conditions,
 * niveau des objets…) est refusé : ses caractéristiques ne correspondent à rien de jouable.
 */
export function playerFighterFromBuild(data: DataStore & BuildDataSource, build: CharacterBuild, opts: PlayerFighterOptions & { presetId?: string } = {}): Fighter {
  const r = computeBuildStats(build, data)
  if (!r.valid) throw new Error(`Build « ${build.name} » invalide : ${r.warnings.join(' ; ') || 'raison inconnue'}`)
  return playerFighterFromStats(data, { breedId: build.breedId, level: build.level, variants: build.spellVariants ?? [], presetId: opts.presetId, name: build.name }, r.stats, r.maxHp, {
    ...opts,
    passiveSpells: opts.passiveSpells ?? r.passiveSpells,
  })
}

/** Personnage d'un membre d'équipe (build + variantes du membre, comme `optimizeStuff`). */
export function playerFighterFromMember(data: DataStore & BuildDataSource, member: MemberSpec, opts: PlayerFighterOptions = {}): Fighter {
  const variants = member.variants.length ? member.variants : (member.build.spellVariants ?? [])
  return playerFighterFromBuild(data, { ...member.build, name: member.name, spellVariants: variants.slice() }, { ...opts, presetId: member.presetId })
}

export interface BossFighterOptions {
  grade: number
  /** Caractéristiques imposées (valeurs finales : résistances effectives, `rangedResPct`…), dérivées recalculées. */
  stats?: Partial<Stats>
  /** États posés (phase du boss : sorts conditionnés lançables). */
  states?: readonly number[]
  /** Défaut `TARGET_ID` (1). */
  id?: number
  /** Défaut `TARGET_TEAM` (1). */
  team?: TeamId
}

/** Boss (ou monstre) hors combat : fabrique, puis surcharges (`applyTargetOverrides`, mêmes règles que le proxy). */
export function bossFighter(data: DataStore, monsterId: number, opts: BossFighterOptions): Fighter {
  const f = createMonsterFighter(data, { monsterId, grade: opts.grade, team: opts.team ?? TARGET_TEAM })
  f.id = opts.id ?? TARGET_ID
  f.tags.referenceTarget = true
  applyTargetOverrides(f, { stats: opts.stats, states: opts.states })
  bumpRev(f)
  return f
}

/**
 * Copie superficielle d'un combattant aux états REMPLACÉS (posture, phase) et à la révision neuve ; l'original n'est
 * pas modifié (caractéristiques, sorts et buffs partagés, en lecture seule).
 */
export function withStates(f: Fighter, states: readonly number[]): Fighter {
  const g: Fighter = { ...f, states: [...new Set(states)], tags: { ...f.tags } }
  bumpRev(g)
  return g
}

/** Erreur si deux combattants partagent un id ou une équipe (masques de cible faussés, voir l'en-tête). */
export function assertDistinct(a: Fighter, d: Fighter): void {
  if (a.id === d.id) throw new Error(`Combattants hors combat : ids identiques (${a.id}) — le masque de cible verrait le lanceur lui-même`)
  if (a.team === d.team) throw new Error(`Combattants hors combat : même équipe (${a.team}) — la cible serait une alliée`)
}
