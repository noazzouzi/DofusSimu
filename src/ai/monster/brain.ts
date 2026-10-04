/**
 * IA des monstres (docs/design/ai.md §11) — WP1.
 *
 * BOUCHON S0 — TODO(WP1) : `MonsterBrain` délègue au contrôleur glouton de repli (src/ai/fallback.ts). À remplacer par
 * la boucle de §11.2 (candidats → quickEstimate → topK simulés → score §11.4, replanification après chaque action,
 * profils/overrides, fin de tour par comportement) avec les réglages `play` / `predict` / `reference` (§11.1).
 * La signature (`createMonsterBrain`, `MonsterBrain.playTurn`) est le contrat utilisé par `createControllers` et par
 * les rollouts de WP2.
 */
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState } from '../../engine/types'
import { playGreedyTurn } from '../fallback'
import type { AIConfig, MonsterController, MonsterSetting } from '../types'

export class MonsterBrain implements MonsterController {
  constructor(
    readonly cfg: AIConfig,
    readonly setting: MonsterSetting = 'play',
  ) {}

  /** topK simulés selon le réglage (§11.1). */
  get topK(): number {
    const m = this.cfg.monster
    return this.setting === 'predict' ? m.predictTopK : this.setting === 'reference' ? m.referenceTopK : m.topK
  }

  playTurn(engine: Engine, fight: FightState, me: Fighter): void {
    // TODO(WP1) : MonsterContext, profils (profiles/index.ts, profiles/vortex.ts), overrides, score §11.4.
    if (me.stats.ap <= 0 && me.stats.mp <= 0) return // statique (Auroraire)
    playGreedyTurn(engine, fight, me)
  }
}

/** Cerveau de monstre pour un réglage (`play` en combat réel, `predict` dans les prévisions des joueurs). */
export function createMonsterBrain(cfg: AIConfig, setting: MonsterSetting = 'play'): MonsterBrain {
  return new MonsterBrain(cfg, setting)
}
