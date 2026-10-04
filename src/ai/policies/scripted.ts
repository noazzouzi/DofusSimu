/**
 * Politique `scripted` (docs/design/ai.md §8.3, §15.6) — WP4 : rotations des presets (data/ai/presets.json), sans
 * recherche (0 nœud). Utilisée par `createControllers` (src/ai/index.ts) pour les personnages et leurs invocations
 * quand `cfg.mode === 'scripted'` ; les monstres gardent le `MonsterBrain` 'play' dans tous les modes.
 *
 * BOUCHON S0 — TODO(WP4) : joue le contrôleur glouton de repli (src/ai/fallback.ts). À remplacer par la rotation du
 * preset du combattant (ordre des sorts, cibles, déplacement), en gardant cette signature.
 */
import type { Controller } from '../../engine/runner'
import { greedyController } from '../fallback'
import type { AIConfig } from '../types'

/** Contrôleur `scripted` partagé par les personnages d'un combat (et leurs invocations). */
export function createScriptedPolicy(_cfg: AIConfig): Controller {
  return greedyController()
}
