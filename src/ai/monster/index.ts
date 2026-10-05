/**
 * IA des monstres (docs/design/ai.md §11) — WP1 : point d'entrée.
 *
 *  brain.ts        `MonsterBrain` (play / predict / reference), boucle gloutonne replanifiée, bascule peureux R12/R13
 *  context.ts      `MonsterContext` (vue honnête, profil, menace des ennemis, focale, caches par pas)
 *  score.ts        score PVe avant/après simulation (§11.4) et préfiltre analytique `quickMonster`
 *  position.ts     score de position par comportement et déplacement de fin de tour (§11.5)
 *  archetype.ts    archétypes inférés des sorts et des drapeaux DofusDB (§11.6), comportement de l'effet 2188
 *  profiles/       registre des profils explicites (`registerMonsterProfile`) ; profils de l'Œil de Vortex
 *  overrides/      hooks de boss (Vortex, Ikargn, Brabuzar)
 *
 * Registre des contrôleurs (src/ai/index.ts) : `registerMonsterControllers(registerAIController)` branche le cerveau
 * `play` sur les clés `fighter.ai` EXACTES des monstres à profil explicite (`monster:<id>`, `boss:<id>`). Les autres
 * monstres reçoivent déjà le `MonsterBrain` 'play' par l'aiguillage par défaut de `createControllers` ; on n'enregistre
 * pas les préfixes « monster » / « boss » : une invocation de personnage (clé `monster:<id>`) doit rester pilotée par
 * l'IA de son équipe (§9.7).
 */
import type { Engine } from '../../engine/engine'
import type { Controller } from '../../engine/runner'
import type { AIConfig } from '../types'
import { createMonsterBrain } from './brain'
import { explicitProfile, VORTEX_PROFILES } from './profiles'

export { createMonsterBrain, MAX_STEPS, MonsterBrain, updateFearfulMode } from './brain'
export { MonsterContext, type RootSnapshot } from './context'
export { emptyParts, followUpScore, quickMonster, scoreTransition, statGainValue, totalOf } from './score'
export { buildFrame, endBehaviour, finalMove, posScore, type PosFrame } from './position'
export { behaviourFromTag, inferArchetype, type ArchetypeInfo } from './archetype'
export {
  defaultWeights, explicitProfile, registerMonsterProfile, resolveProfile, unregisterMonsterProfile, VORTEX_PROFILES, type ResolvedProfile,
} from './profiles'
export { auroraireOf, brabuzarHooks, ikargnHooks, vortexHooks, vortexPhase1, vortexThreatOrigins } from './overrides/vortex'
export type * from './types'

/** Fabrique de contrôleur au format du registre de src/ai/index.ts. */
export type MonsterControllerFactory = (engine: Engine, cfg: AIConfig) => Controller

/** Clés `fighter.ai` des monstres à profil explicite (src/engine/factory.ts : `boss:<id>` si boss, sinon `monster:<id>`). */
export function monsterAIKeys(engine?: Engine): string[] {
  const keys: string[] = []
  for (const id of Object.keys(VORTEX_PROFILES).map(Number)) {
    if (!explicitProfile(id)) continue
    const boss = engine?.data.monster(id)?.isBoss ?? id === 3835
    keys.push(`${boss ? 'boss' : 'monster'}:${id}`)
  }
  return keys
}

/**
 * Enregistre le cerveau `play` (un par clé, comme le registre le met en cache) pour les monstres à profil explicite.
 * `register` = `registerAIController` de src/ai/index.ts (passé en paramètre : pas de dépendance circulaire).
 */
export function registerMonsterControllers(register: (key: string, factory: MonsterControllerFactory) => void): void {
  const factory: MonsterControllerFactory = (_engine, cfg) => createMonsterBrain(cfg, 'play')
  for (const key of monsterAIKeys()) register(key, factory)
}
