/**
 * Profils des monstres de l'Œil de Vortex (docs/design/ai.md §11.7 ; docs/research/monster-ai.md §7.2-§7.3) — WP1.
 *
 *  | Monstre          | Comportement            | Profil                                                         |
 *  |------------------|-------------------------|----------------------------------------------------------------|
 *  | Auroraire 3833   | static                  | jamais appelée (0 PA / 0 PM) ; obstacle et centre de l'horloge |
 *  | Ikargn 3834      | aggressive              | ouverture Attraction ailée (≥ 1 ennemi), ordre 5015 → 5016 → 5017, override Cercle de feu |
 *  | Méjaire 3836     | kiter [1, 7]            | Pacifiste (218) = menace de la cible ; Envolupté (5024) seulement sans cible en ligne ≤ 7 |
 *  | Harpille 3837    | kiter [1, 7]            | Petit poison (5021) dès qu'il est lançable                       |
 *  | Buboxor 3838     | aggressive              | Bouclier absorbant (5026) sans cible ; PM volés (Hoxor) = mobilité |
 *  | Brabuzar 3839    | aggressive              | ordre 5032 → 5030 → 5033 ; Neutralisation + isolement ; poussées simulées (R6) |
 *  | Vortex 3835      | kiter [1, 8] (phase 2)  | hooks `vortexHooks` (Heurage, En temps et en heure, Contamination, Heuristique) |
 * Les monstres corrompus (état 6611) ne jouent plus (tour annulé appliqué par le moteur) : rien à configurer ; ils
 * taclent et bloquent toujours la ligne de vue (accessibilité, cases de lancer et menace du socle).
 */
import { AURORAIRE, BRABUZAR, BUBOXOR, HARPILLE, IKARGN, MEJAIRE, SPELL, STATE, VORTEX } from '../../../dungeons/vortex/constants'
import { brabuzarHooks, ikargnHooks, vortexHooks } from '../overrides/vortex'
import type { MonsterAIProfile } from '../types'

export const VORTEX_PROFILES: Readonly<Record<number, MonsterAIProfile>> = {
  [AURORAIRE]: { behaviour: 'static', note: 'Auroraire : horloge du donjon (0 PA / 0 PM)' },
  [IKARGN]: {
    behaviour: 'aggressive',
    openers: [{ spellId: SPELL.ATTRACTION_AILEE, minTargets: 1 }],
    castOrder: [SPELL.ATTRACTION_AILEE, SPELL.CERCLE_DE_FEU, SPELL.TERRE_MYTHE],
    hooks: ikargnHooks,
    note: 'Ikargn : brute de zone, attireur',
  },
  [MEJAIRE]: {
    behaviour: 'kiter',
    preferredRange: [1, 7],
    stateValue: { [STATE.PACIFISTE]: 'targetThreat' },
    gapCloser: { spellId: SPELL.ENVOLUPTE, lineRange: 7 },
    note: 'Méjaire : lanceuse en ligne, Pacifiste',
  },
  [HARPILLE]: {
    behaviour: 'kiter',
    preferredRange: [1, 7],
    alwaysCastWhenReady: [SPELL.PETIT_POISON],
    note: 'Harpille : tireuse diagonale/ligne, poison global',
  },
  [BUBOXOR]: {
    behaviour: 'aggressive',
    selfBuffWhenNoTarget: SPELL.BOUCLIER_ABSORBANT,
    mpStealIsMobility: true,
    note: 'Buboxor : bagarreur de contact, voleur de PM',
  },
  [BRABUZAR]: {
    behaviour: 'aggressive',
    castOrder: [SPELL.DECOLLAGE, SPELL.MISE_EN_SITUATION, SPELL.NEUTRALISATION],
    hooks: brabuzarHooks,
    note: 'Brabuzar : pousseur, téléporteur',
  },
  [VORTEX]: {
    behaviour: 'kiter',
    preferredRange: [1, 8],
    hooks: vortexHooks,
    note: 'Vortex : boss en deux phases (Marginal)',
  },
}
