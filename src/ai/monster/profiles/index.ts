/**
 * Profils déclaratifs des monstres et résolution du comportement (docs/design/ai.md §11.6, §11.7 ;
 * docs/research/monster-ai.md §7.3, §8.1) — WP1.
 *
 * Résolution (cache par monstre) : `fighter.tags.aiBehaviour` (effet 2188, ou chaîne posée par une IA) surcharge le
 * COMPORTEMENT → profil explicite par `monsterId` (registre : profils du Vortex enregistrés au chargement) → archétype
 * inféré des sorts (archetype.ts). Un profil explicite sans `preferredRange` reçoit celui de l'archétype.
 * Les poids du score viennent de θ.monster (data/ai/theta-default.json, JAMAIS réglés pour gagner, §11.1) complétés
 * des constantes du design (§11.4) puis des `weights` du profil.
 */
import type { Engine } from '../../../engine/engine'
import type { Fighter } from '../../../engine/types'
import type { ThetaJson } from '../../theta'
import { behaviourFromTag, inferArchetype, type ArchetypeInfo } from '../archetype'
import type { Behaviour, MonsterAIProfile, ScoreWeights } from '../types'
import { VORTEX_PROFILES } from './vortex'

export { VORTEX_PROFILES } from './vortex'

const PROFILES = new Map<number, MonsterAIProfile>()

/** Enregistre (ou remplace) le profil explicite d'un monstre. */
export function registerMonsterProfile(monsterId: number, profile: MonsterAIProfile): void {
  PROFILES.set(monsterId, profile)
}

/** Retire un profil explicite (tests). */
export function unregisterMonsterProfile(monsterId: number): void {
  PROFILES.delete(monsterId)
}

/** Profil explicite d'un monstre (undefined : comportement inféré). */
export function explicitProfile(monsterId: number | undefined): MonsterAIProfile | undefined {
  return monsterId === undefined ? undefined : PROFILES.get(monsterId)
}

for (const [id, p] of Object.entries(VORTEX_PROFILES)) registerMonsterProfile(Number(id), p)

/** Poids par défaut (θ.monster + constantes du design §11.4). */
export function defaultWeights(theta: ThetaJson): ScoreWeights {
  const m = theta.monster
  return {
    wDmg: m.wDmg,
    wKill: m.wKill,
    kappa: m.kappa,
    wAP: m.wAP,
    wMP: m.wMP,
    wHeal: m.wHeal,
    wFF: m.wFF,
    wAllyKill: 1,
    summonValue: m.summonValue,
    reflectAversion: m.reflectAversion,
    minActionScore: m.minActionScore,
    positionDuringTurn: m.positionDuringTurn,
    pacifist: theta.threat.pacifistFactor,
    healThreshold: 0.95,
    selfHealThreshold: 0.7,
    endMoveMinGain: theta.value.endMoveMinGain,
  }
}

export interface ResolvedProfile {
  profile: MonsterAIProfile
  /** Comportement de base (avant la bascule « peureux → agressif » R12). */
  behaviour: Behaviour
  archetype: ArchetypeInfo
  /** Origine du comportement. */
  source: 'tag' | 'profile' | 'archetype'
}

const INFERRED = new WeakMap<ArchetypeInfo, MonsterAIProfile>()

/** Profil effectif d'un combattant (voir l'en-tête). */
export function resolveProfile(engine: Engine, f: Fighter): ResolvedProfile {
  const archetype = inferArchetype(engine, f)
  const explicit = explicitProfile(f.monsterId)
  let profile: MonsterAIProfile
  if (explicit) {
    profile = explicit.preferredRange || !archetype.preferredRange ? explicit : { ...explicit, preferredRange: archetype.preferredRange }
  } else {
    let p = INFERRED.get(archetype)
    if (!p) {
      p = { behaviour: archetype.behaviour, capabilities: { ...archetype.capabilities }, preferredRange: archetype.preferredRange, note: `inféré (${archetype.archetype})` }
      INFERRED.set(archetype, p)
    }
    profile = p
  }
  const tagged = behaviourFromTag(f.tags.aiBehaviour)
  // Un combattant qui ne peut pas jouer reste statique quel que soit le tag.
  if (tagged && profile.behaviour !== 'static') return { profile, behaviour: tagged, archetype, source: 'tag' }
  return { profile, behaviour: profile.behaviour, archetype, source: explicit ? 'profile' : 'archetype' }
}
