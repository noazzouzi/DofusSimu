# IA de DofusSimu — conception finale (CP4 / CP5)

> Document de référence pour l'IA des monstres, l'IA de groupe, le scénario Œil de Vortex et la boucle d'itérations
> (`src/ai`, `src/dungeons`, `src/optimizer`, `src/cli`). Il arbitre et remplace les trois propositions
> `ai-proposal-fidelity.md`, `ai-proposal-search.md` et `ai-proposal-planning.md`, conservées pour l'historique.
> Prose en français, identifiants en anglais. Unité de valeur unique : le **PVe** (PV-équivalent, 1 = un point de vie d'un
> personnage allié). Tous les coûts sont des **cibles** que les bancs B1-B7 (§16.6) mesureront. Seules trois valeurs ont
> été mesurées (bench local de la proposition « recherche », avant les interprètes d'effets) : `cloneFight` 7-10 µs,
> `canCast` ≈ 1 µs, clone + lancer 22 µs.
> Lectures : `src/engine/*`, `src/damage`, `src/map`, `docs/research/monster-ai.md` (§0, §3-§8),
> `docs/research/vortex.md` (§0, §2-§8, §13, §14), `mechanics.md` (§2.2, §6-§8), `classes/*.md`, `equipment.md`.

---

## 0. Verdict sur les trois propositions

| Critère (note sur 10) | Fidélité | Recherche | Planification |
|---|---|---|---|
| Fidélité au jeu (IA monstres, règles, information honnête) | **9** | 7 | 8 |
| Taux de victoire attendu sur un combat dur (Vortex) | 6 | 7 | **9** |
| Créativité du jeu de groupe | 6 | 8 | **9** |
| Coût de calcul par rapport au budget (< 1 s / < 30 s) | **9** | 6 | 7 |
| Implémentabilité dans ce code | **8** | 6 | 6 |
| Testabilité | 8 | 8 | **9** |
| **Total / 60** | 46 | 42 | **48** |

* **Fidélité** : socle d'analyse le plus précis (`SpellProfile`, DPT calibré, menace ordonnée, seuils de kill), IA
  des monstres identique dans tous les modes, vue « honnête ». Mais joueur glouton myope, planificateur de corruption
  glouton et coûts d'heures écrits à la main.
* **Recherche** : bon moteur de tour (macro-actions, quotas, transpositions, diversité, split léthal, rollouts
  adverses, MCTS ciblé) et seuls coûts mesurés. Mais l'adversaire change selon le mode (`topK` 24 contre 8), le
  `standard` frôle 30 s et le MCTS alourdit l'implémentation.
* **Planification** : la seule qui traite le Vortex comme un problème d'**ordonnancement** (planificateur abstrait sur
  les créneaux de la timeline, prix fictifs en PVe, coûts d'heures mesurés, et le Vortex ne paie qu'une fois par heure
  distincte). Elle seule prévoit aussi le burst de phase 2 et un placement qui sert les deux phases. Son défaut est
  l'ampleur : 16 tactiques, deux pricers, un commandant et un allocateur.

**Base retenue : la proposition « planification »** (stratégique → prix → recherche tactique → exécution). Greffes :

| Origine | Idées reprises |
|---|---|
| Fidélité | socle d'analyse (§6) ; vue honnête et graine décorrélée ; IA monstres à budget unique + test d'équivalence `topK` ; tableau de conformité R1-R25 ; mode `scripted` ; modèle T0 et micro-scénarios `prefix12`/`phase2` ; macros tirées des données (`stateChain`) ; marquage « créatif » ; tests joueurs P1-P14 ; `statsRev` (→ E4) |
| Recherche | contrat `MacroAction` ; règles de génération C1-C12 et quotas ; transpositions ; emplacement de diversité ; split léthal ; pessimisme des rollouts ; MCTS **réservé au mode `deep`** ; distillation `fast` ← `standard` ; préfiltre vérifié (T-prefilter) ; puzzles ; rembobinage marqué « optimiste » |

Les corrections apportées à la base elle-même (8 tactiques en v1, un seul contrat de prix pour les deux pricers,
budget unique des monstres, coûts d'heures calculés avec table de repli) sont arbitrées au §2.

---

## 1. Décisions clés (TL;DR)

1. **Une monnaie, le PVe** pour monstres, joueurs, planificateur et optimiseur ; poids initiaux en annexe A, réglés
   ensuite par la boucle externe.
2. **Trois couches + une boucle externe** : `Commander` (stratégique, une fois par tour de joueur) → `TurnSearch`
   (tactique, budget en nœuds) → `Executor` (exécution, écart prévu/réel, replanification) ; `src/optimizer` au-dessus.
3. **Le plan parle à la recherche par une `PriceTable`** (prix d'un kill par monstre × heure/corruption, pente et
   paliers de PV, valeur d'un +k heures, valeur des cases de fin de tour) et des **intentions** typées ; aucune règle dure.
4. **Un seul moteur de tour** : `fast` = faisceau de largeur 1 replanifié après chaque action (le glouton de
   « fidélité »), `standard` = faisceau 6 + rollouts d'équipe, `deep` = faisceau 12 + MCTS ; `scripted` = sans IA.
5. **Menace ordonnée par la timeline** : dégâts attendus des ennemis qui jouent **avant le prochain tour** de l'allié,
   cible prédite comme le ferait l'IA des monstres ; retrait de PM, poussée, Pacifiste et blocage en tirent leur valeur.
6. **IA des monstres fidèle et fixe** (monster-ai.md §8) : réglage `play` identique quel que soit le budget des
   joueurs, jamais réglée pour gagner.
7. **Vortex = ordonnancement** : horloge exacte, `HourPlanner` (faisceau abstrait 16 × 12 créneaux), coûts d'heures
   mesurés, phases `opening → waveCycle → waiting → transition → burst` (+ `emergency`), `BurstPlanner`, placement
   initial choisi pour les **deux** phases.
8. **Créativité** = génération complète + simulation exacte + menace/potentiel + objectifs de scénario + 8 tactiques
   proposeuses (v1) ; une tactique propose, la simulation décide, l'ablation juge.
9. **Rôles inférés** (9) et affectés selon les besoins du scénario : ils modulent quotas, priors, risque et position ;
   tous les alliés maximisent la **même** valeur d'équipe.
10. **Aléa** sur flux séparés, dés re-semés à chaque tour (E1, CRN), budgets en nœuds ⇒ tout combat rejouable bit à bit ;
    chaque graine tire aussi une variante des règles INCERTAINES (taux robuste, par variante, pire variante).
11. **Budgets (1 cœur)** : `scripted` ≈ 0,35 s, `fast` ≈ 0,9 s (< 1 s), `standard` ≈ 22 s (< 30 s), `deep` ≈ 3 min ;
    4 `worker_threads` ⇒ ≈ 16 000 combats `fast` par heure.
12. **Itérations** : L0 tour → L1 Monte-Carlo → L2 θ (criblage + CEM + distillation) → L3 stuff → L4 variantes → L5
    composition (T0 analytique sur ≈ 4,9·10⁵ équipes, *successive halving*) ; L\* rembobinage (démo seulement).
13. **4 lots parallèles** (§18) après 3 jours de gel des contrats : WP1 socle + monstres, WP2 IA de groupe, WP3 Vortex
    + planificateur, WP4 optimiseur + workers + CLI.

---

## 2. Arbitrages explicites

| Sujet | Fidélité | Recherche | Planification | **Décision** |
|---|---|---|---|---|
| Budget des monstres | topK 6 partout | 24 en combat réel, 8 en Monte-Carlo | 8 partout, `predict` 4 en rollouts | **`play` = topK 8 + obligatoires dans tous les modes** ; `predict` (topK 4) seulement dans les rollouts/prévisions des joueurs ; référence topK 24 utilisée uniquement par le test d'équivalence (≥ 97 % d'accord top-1) |
| Lookahead des monstres | `openers`/`castOrder` | « smart » optionnel | `lookahead` 2-3 par profil | **`openers`/`castOrder` d'abord** ; `lookahead` existe mais reste désactivé tant que les tests T3/T5 passent sans lui (R25) |
| Joueur : glouton ou faisceau | glouton + faisceau en `search` | faisceau | faisceau | **un seul `TurnSearch`** paramétré ; `fast` = largeur 1 |
| Valeur d'un kill au Vortex | termes écrits (+4 000…) | contrefactuel du planificateur | prix fictifs | **`PriceTable` unique** ; `standard`/`deep` : prix contrefactuels (`SearchPricer`) ; `fast` : `HeuristicPricer` dont les constantes de départ sont celles de « fidélité » |
| Coût des heures | table à la main | calculé | calculé + table | **calculé** (`HourCostModel`, §12.4), séparé en coût zombie `C_mon` et coût Vortex `C_vx` payé une fois par heure distincte ; table de repli + test T-hours |
| Planificateur | glouton à directives (1 ms) | faisceau 32 (1-3 ms) | faisceau 16 × 12 (6 ms) | **faisceau 16 × 12** en `standard`, 4 × 8 en `fast` (mis en cache entre événements symboliques), 48 × 20 en `deep` |
| Double comptage kill/menace | `enemyKill` + danger | `kills` + threat | κ seul | **κ·PVmax + τ·menace (τ = 1 tour)** : la menace jusqu'au prochain tour est déjà dans `incoming`, τ couvre le tour suivant ; en phase 1 du Vortex, les kills de vague passent **uniquement** par la `PriceTable` |
| Pré-dégâts | directive `preDamage` | `prepare` | intention `preDamage` + palier de PV | **paliers dans `PriceTable.hp`** (un seul mécanisme) ; l'intention `preDamage` disparaît |
| Terme de contrôle | aucun | 0,25 (guide) | aucun | **0,15 (guide)**, conservé seulement si l'ablation le justifie |
| Glouton myope (buff puis frappe) | `thisTurnPower`, `killFeasible` | faisceau | faisceau | **terme `continuation`** (§7) : valeur analytique des PA/PM restants ; il remplace les deux termes et rend comparables des feuilles de profondeurs différentes |
| MCTS | — | standard + deep | — | **`deep` uniquement** ; en `standard`, une décision clé reçoit un budget ×2 |
| Réglage de θ | CEM | CMA-ES (22 dim.) | criblage + CEM | **criblage de sensibilité puis CEM en espace log** (8-12 paramètres) ; CMA-ES reporté |
| RNG commun | re-semis par tour | RNG à clé par lancer | re-semis par tour | **E1 (re-semis par tour)** obligatoire ; RNG à clé par lancer en option ultérieure |
| Rôles | 8 | 7 | 9 | **9 rôles** de « planification », réassignés si un rôle clé meurt (« fidélité ») |
| Tactiques | macros | aucune | 16 | **8 en v1** (dont `stateChain`, issu des macros de « fidélité »), 8 en v2, toutes soumises à ablation |
| Score d'un combat | `winRate + 0,1·marge` | `progress` | fitness façonnée | **un seul score** (§15.2) : `win ? 1 + 0,1·PV% − tours/600 : 0,8·progress` |

---

## 3. Contrat avec le moteur

### 3.1 API utilisées telles quelles

`Engine.cloneFight/nextTurn/endTurn/alive/enemiesOf/alliesOf/fighterAt/stateFlag/current/passesTurn`,
`canCast(engine, fight, f, spell, cell, { fromCell })`, `castSpell`, `performAction`, `move`, `escapeRatio`,
`runFight` (combat réel uniquement), `Controller`/`ControllerProvider` (`runner.ts`), `zoneCells`, `zoneEfficiency`,
`hasLineOfSight`, `GridSearch`/`bfsDistances`, `prepareDamage`/`meanPrepared`/`expectedDamage`, `damageDistribution`,
`critProbability`, `expectedApMpRemoved`, `tackleRatio`/`apMpAfterTackle`, `computeBuildStats`, `zeroStats`/`copyStats`,
`GameDataStore.breedSpells/monsterSpells/itemsBySlot/listBreeds`, `registeredEffects()`.

### 3.2 Propriétés du code actuel sur lesquelles l'IA s'appuie

| Fait (code lu) | Conséquence pour l'IA |
|---|---|
| `cloneFight` copie les combattants champ par champ, partage `deaths` (remplacé, jamais muté) et fait `structuredClone(scenarioState)` | `scenarioState` doit rester **petit et plat** ; les paramètres du scénario y sont stockés (objet immuable partagé) |
| `rollMode: 'average'` : espérance des dégâts et soins, critique pondéré (`tags.critWeight`) ; **retrait esquivable de PA/PM = espérance fractionnaire** (`apmp.ts`) ; `chance()` devient déterministe (p ≥ 0,5) | `ap`/`mp` peuvent être non entiers dans un clone : `reach` utilise `⌊mp⌋` pour les chemins et interpole la menace entre `⌊mp⌋` et `⌈mp⌉` |
| Les groupes d'effets aléatoires tirent `nextRandom(fight)` même en `average` | chaque clone de l'IA reçoit un `rngState` **re-semé** (sel déterministe, jamais l'état réel) |
| `move` applique le tacle pas à pas, s'arrête sur un piège et appelle `hooks.onEnterCell` sur une glyphe | « marcher dans une glyphe de monstre » (échange + bonus + horloge +1) est **simulé** sans code spécifique |
| `nextTurn` saute `skipTurns` et les porteurs de `passTurn` (monstres corrompus) ; `runFight` saute `cannotPlay`/`preventsFight` | `advanceUntil` reprend exactement cette logique (fonction `canPlay` exportée par `core/sim.ts`, test de parité avec `runner.ts`) |
| `Engine.kill` conserve les buffs `dispellable` 3/4 sur le mort | heures de mort (221-232), étoile (234) et corruption (6611) se lisent sur les morts |
| `reachableCells` utilise `Map` + `queue.shift()` (31 µs mesurés) | l'IA a son propre BFS typé (`core/reach.ts`, cible ≤ 5 µs) |
| `engine.hooks`, registre d'effets et `appearing` (core.ts) sont des états de module/instance | une instance `Engine` par worker ; l'IA ne simule **jamais** depuis l'intérieur d'un appel moteur (contrôleurs appelés entre deux tours uniquement) |
| `targetMask.ts` évalue déjà les conditions `*` sur le lanceur | vérifié par les tests Vortex (T-clock, `vortex-*.test.ts`) |
| `buildTimeline` fait commencer l'équipe du **meilleur** combattant | la règle « moyenne d'équipe » (mechanics.md §8) est un paramètre INCERTAIN que le hook `onFightStart` du scénario applique en réécrivant `fight.timeline` |

### 3.3 Extensions demandées à l'équipe moteur (rétro-compatibles, chacune avec un repli)

| # | Extension | Fichiers | Pourquoi | Repli si absente |
|---|---|---|---|---|
| E1 | `FightOptions.rngRekey?: 'none' \| 'perTurn'` ; si `perTurn`, `startTurn` pose `fight.rngState = mix32(mix32(options.seed, fight.round), f.id)` | `engine/types.ts`, `engine.ts` | CRN : une décision différente au tour 3 ne décale plus les dés des tours suivants (variance des comparaisons ÷ 3 à 10) ; rembobinage avec les mêmes dés | comparaisons moins efficaces (plus de graines) |
| E2 | `ScenarioHooks.cloneState?(s)` utilisé par `cloneFight` à la place de `structuredClone` | `engine.ts` | `structuredClone` coûte 5-20 µs par clone | `scenarioState` minimal |
| E3 | événement `{ t: 'aiNote'; fighter; kind: 'plan' \| 'intent' \| 'tactic' \| 'focus' \| 'creative'; text; cells?; targets? }` + validation replay | `engine/types.ts`, `replay/*` | flèches/zones d'intention dans le replay animé | `{ t: 'log', level: 'ai' }` |
| E4 | `Fighter.rev` incrémenté par `recomputeStats` et par tout changement de case | `engine.ts`, `move.ts`, `effects/movement/*` | clés de cache DPT/menace | empreinte calculée par `core/hash.ts` |
| E5 | compteur d'effets inconnus **par combat** (`fight.metrics` global ou `scenarioState`) + `isSpellSupported(level)` (fermeture des sous-sorts) | `effects/core.ts`, `effects/registry.ts` | résultat « faible confiance » ; l'IA n'utilise pas un sort dont un effet n'est pas simulé | `spellProfile.ts` calcule `unsupported` via `registeredEffects()` |

Non demandés (arbitrage des propositions) : `stepTurn` (« recherche » D1 : `advanceUntil` s'écrit avec `nextTurn` et
`endTurn` publics) ; états au décès (« planification » E6 : `Engine.kill` les conserve) ; PA/PM fractionnaires en
`average` (« recherche » H2 : déjà en place dans `apmp.ts`).

---

## 4. Arborescence et propriété des fichiers

Les étiquettes `[WPn]` renvoient aux lots de travail (§18). Les fichiers marqués **gelé J3** sont des contrats figés à
la fin du jour 3 ; ensuite, toute modification passe par une revue des quatre responsables de lot.

```
src/ai/
  index.ts              [WP1] createControllers(engine, cfg): ControllerProvider ; registre fighter.ai
  types.ts              [WP1, gelé J3] contrats partagés (§5.1)
  core/                 [WP1] socle commun joueurs/monstres (§6)
    rng.ts (mix32, aiSeed, simSalt)   view.ts (AIView, sanitizeForTeam)   budget.ts (NodeBudget)
    sim.ts (simClone, applyMacro, advanceUntil, canPlay)   hash.ts (fighterDigest, stateHash ; repli de E4)
    timeline.ts (forecastSlots)   reach.ts (computeReach)   castCells.ts (inverseRange, castCells, cache LdV)
    spellProfile.ts   dpt.ts (DptTable + calibration)   threat.ts   potential.ts
    kill.ts (killProbability, canKillNow, lethalSplit)   value.ts (valueOf → EvalBreakdown)
    candidates.ts (generateCasts générique, quick)
  monster/              [WP1] (§11)
    brain.ts  score.ts  position.ts  archetype.ts  profiles/index.ts  profiles/vortex.ts  overrides/vortex.ts
  tactical/             [WP2] (§8)
    turnSearch.ts  evaluate.ts  finalMove.ts  rollout.ts  executor.ts  keys.ts  mcts.ts  explain.ts
  team/                 [WP2] (§9)
    controller.ts (TeamController, TeamBrain)  blackboard.ts  roles.ts  commander.ts  allocator.ts
    genericModel.ts  summons.ts
  tactics/              [WP2] (§10)
    index.ts  stateChain.ts  mpLock.ts  carryThrow.ts  glyphClock.ts  healCleanse.ts  bodyBlock.ts
    groupForZone.ts  burstSetup.ts   (v2 : apLock, tackleTrap, pushCollision, losShield, lineDodge,
    corruptedWall, baitSummon, dispelAlly)
  policies/             [WP4] scripted.ts (rotations des presets), random.ts (référence basse)
src/dungeons/           [WP3] (§12)
  types.ts              [gelé J3] DungeonScenario, ScenarioAIModel, UncertainParam, MicroScenario
  index.ts  waves.ts  generic/{dummy.ts, skirmish.ts}
  vortex/ constants.ts [gelé J3]  params.ts  setup.ts  scenario.ts  clock.ts  tracker.ts  hourCost.ts
          abstract.ts  planner.ts  pricer.ts  burst.ts  placement.ts  model.ts  micro.ts
src/optimizer/          [WP4] (§15)
  types.ts [gelé J3]  seeds.ts  runner.ts  stats.ts  montecarlo.ts  cache.ts  tune.ts  distill.ts
  pool/{pool.ts, node.ts, web.ts, worker.ts, protocol.ts}
  stuff/{proxy.ts, pools.ts, search.ts, exos.ts, points.ts}  variants.ts
  team/{presets.ts, prior.ts, t0model.ts, halving.ts}  rewind.ts  report.ts
src/cli/simulate.ts     [WP4] fight | batch | tune | stuff | team | optimize | rewind | report | bench
data/ai/                theta-default.json (sections par lot), presets.json [WP4], calibration.json [WP1]
bench/                  core|monster [WP1], player [WP2], planner [WP3], pool|e2e [WP4]   (vitest bench)
tests/                  ai-core-* ai-monster-* [WP1] ; ai-team-* ai-puzzles-* [WP2] ; vortex-* [WP3] ; opt-* [WP4]
```

---

## 5. Contrats TypeScript partagés

### 5.1 `src/ai/types.ts` (WP1, gelé J3)

```ts
import type { Engine } from '../engine/engine'
import type { Action, Fighter, FightState } from '../engine/types'
import type { TeamId } from '../core/types'

export type AIMode = 'scripted' | 'fast' | 'standard' | 'deep'
export type CandidateCat = 'damage' | 'control' | 'placement' | 'heal' | 'buff' | 'summon' | 'mark' | 'utility'
export type RoleId = 'killer' | 'zoneDps' | 'mpLock' | 'apLock' | 'placer' | 'tank' | 'healer' | 'support' | 'summoner'
export type TacticId = 'stateChain' | 'mpLock' | 'carryThrow' | 'glyphClock' | 'healCleanse' | 'bodyBlock'
  | 'groupForZone' | 'burstSetup' | 'apLock' | 'tackleTrap' | 'pushCollision' | 'losShield' | 'lineDodge'
  | 'corruptedWall' | 'baitSummon' | 'dispelAlly'

/** Macro-action : déplacement optionnel PUIS lancer optionnel, ou séquence proposée par une tactique. */
export interface MacroAction {
  path?: number[]                         // path[0] = case actuelle
  cast?: { spellId: number; cell: number }
  seq?: MacroAction[]                     // séquence simulée d'un bloc (tactiques, macros de données)
  cat: CandidateCat
  prior: number                           // estimation analytique (PVe), tri et départage
  mandatory?: boolean                     // simulé hors quota (kill sous contrat, levier d'horloge, intention)
  tactic?: TacticId
  key: string                             // signature déterministe « spellId:cell:pathEnd » (départage, journal)
}
export function toActions(m: MacroAction): Action[]

export interface TurnBudget {
  maxNodes: number; width: number; topK: number; maxDepth: number; endCells: number
  rollouts: number; pessimism: number; keyDecisionBoost: number; maxKeyDecisions: number
  mctsIterations: number; maxReplans: number; replanFraction: number
  quotas: Record<CandidateCat, number>; mandatoryMax: number
}
export interface EvalBreakdown {
  total: number; enemyLife: number; kills: number; allyLife: number; erosion: number; allyDeath: number
  incoming: number; pendingDot: number; control: number; potential: number; continuation: number
  resources: number; position: number; scenario: number
}

/** Prix publiés par la couche stratégique pour le combattant courant (PVe). */
export interface PriceTable {
  /** kill.get(m)[0] = mort sous étoile (corruption) ; [h] (1..12) = mort pendant l'heure h ; absent = générique. */
  kill: Map<number, Float32Array>
  /** Valeur d'un PV retiré à m, et palier optionnel attendu par un allié suivant. */
  hp: Map<number, { slope: number; floor?: number; bandMin?: number; bandMax?: number; bandBonus?: number }>
  /** Valeur d'avancer l'horloge de k heures (glyphes) pendant ce tour, k = 0, 1, 2. */
  clock: [number, number, number]
  /** Valeur de finir le tour sur chaque case (sécurité de scénario) ; absent = 0. */
  cell?: Float32Array
}
export type IntentKind = 'control' | 'protect' | 'cleanse' | 'position' | 'setup' | 'reserve' | 'burst' | 'survive'
export interface Intent {
  id: string; kind: IntentKind; owner: number
  window: { fromRound: number; fromIndex: number; toRound: number; toIndex: number }
  target?: number; cells?: number[]; params?: Record<string, number>
  price: number                           // PVe si pleinement satisfaite
  source: 'planner' | 'allocator' | 'burst' | 'emergency' | 'doctrine'
  explain: string                         // texte FR pour le replay
}
export type PhaseId = 'fight' | 'opening' | 'waveCycle' | 'waiting' | 'transition' | 'burst'
export interface Blackboard {
  version: number; round: number; phase: PhaseId; emergency: boolean
  roles: Map<number, { primary: RoleId; secondary?: RoleId; scores: Record<RoleId, number> }>
  focus: number[]                                      // ennemis par priorité
  reservations: Map<number, { targetId: number; p: number; value: number; spellIds: number[] }>
  prices: PriceTable                                   // pour le combattant courant
  intents: Intent[]                                    // tous porteurs (attentes envers les alliés suivants)
  reservedCells: Map<number, number>                   // case → allié (fin de tour)
  plan?: unknown                                       // ScenarioPlan opaque (WP3), lu par explain/rewind
}

export type StrategyParams = ThetaJson    // type généré depuis data/ai/theta-default.json (annexe A)
export interface MonsterAIConfig { topK: number; predictTopK: number; noiseTau: number; referenceTopK: number }
export interface AIConfig {
  mode: AIMode; budget: TurnBudget; theta: StrategyParams; monster: MonsterAIConfig
  seed: number                            // graine IA dérivée de la graine de combat (§13)
  explain: boolean; unsupportedSpells: 'skip' | 'allow'
}
/** Ce que le socle fournit aux couches supérieures et au scénario. */
export interface Perception {
  dpt: DptTable; threat: ThreatModel; potential: PotentialModel; profiles: SpellProfileIndex
  sync(s: FightState): void               // recalcul incrémental (rev / empreinte par combattant)
}
```

### 5.2 `src/dungeons/types.ts` (WP3, gelé J3)

```ts
export type ScenarioParams = Readonly<Record<string, number | string | boolean | readonly number[]>>
export interface UncertainParam { key: string; values: (number | string | boolean | number[])[]; weights: number[] }
export interface DungeonScenario {
  id: string; mapId: number
  defaultParams: ScenarioParams; uncertain: UncertainParam[]
  /** Les hooks lisent les paramètres dans fight.scenarioState (une seule instance Engine pour toutes les variantes). */
  hooks: ScenarioHooks
  createFight(engine: Engine, team: Fighter[], o: { params: ScenarioParams; seed: number; placement?: number[];
    rollMode: RollMode; record: boolean; rngRekey: 'none' | 'perTurn' }): FightState
  aiModel(params: ScenarioParams, theta: StrategyParams): ScenarioAIModel
  micro: Record<string, MicroScenario>        // 'prefix12', 'phase2', 'poutch'
  summarize(fight: FightState): ScenarioSummary
}
/** Contrat entre le scénario (WP3) et l'IA de groupe (WP2). Toutes les valeurs sont en PVe. */
export interface ScenarioAIModel {
  id: string
  /** Début du tour de chaque joueur : phase, plan (horizon glissant), prix et intentions du combattant courant. */
  update(view: AIView, bb: Blackboard, perception: Perception, mode: AIMode): void
  damageWeight?(e: Fighter, bb: Blackboard): number | undefined           // remplace v_e
  deathValue?(root: FightState, leaf: FightState, victim: Fighter, bb: Blackboard): number | undefined
  extraIncoming?(s: FightState, a: Fighter, cell: number): number           // lignes de l'Auroraire, Heurage…
  vulnerableAt?(s: FightState, e: Fighter, roundOffset: number): boolean   // vague invulnérable, Vortex Marginal
  allyDeathExtra?(s: FightState, a: Fighter): number                       // mort qui casse le cycle d'horloge
  hints?(view: AIView, me: Fighter, bb: Blackboard): CandidateHint[]
  isKeyDecision?(view: AIView, bb: Blackboard): KeyDecisionReason | null
  choosePlacement?(team: Fighter[], perception: Perception, budget: 'analytic' | 'simulated'): number[]
}
export interface CandidateHint { kind: 'glyph' | 'kill' | 'avoidCells' | 'reachCell'; cells?: number[]; targetId?: number; weight: number }
export type KeyDecisionReason = 'corruptionKill' | 'allyDeathRisk' | 'closeCall' | 'burst' | 'waveArrival' | 'phaseChange'
```

### 5.3 `src/optimizer/types.ts` (WP4, gelé J3)

```ts
export interface MemberSpec { name: string; breedId: number; presetId: string; build: CharacterBuild; variants: (0 | 1)[]; role?: RoleId }
export interface FightSpec { scenarioId: string; team: MemberSpec[]; placement?: number[]; mode: AIMode
  theta: StrategyParams; params?: Partial<ScenarioParams>; variantPolicy: 'default' | 'sampled'; monsterNoise: number }
export interface FightSummary { seed: number; variant: string; win: boolean; rounds: number; endReason: string
  failReason?: string; deaths: number; hpLeftPct: number; damageTaken: number; progress: number; score: number
  corruptedByRound: number[]; hoursUsed: number; phase2Rounds?: number; vortexHpPct?: number; creativeActions: number
  tactics: Partial<Record<TacticId, number>>; spellUse: Record<number, number>; unknownEffects: number; nodes: number; eventsHash: number }
export interface BatchResult { n: number; wins: number; winRate: number; wilson95: [number, number]
  meanScore: number; meanRounds: number; p10HpLeft: number; byVariant: Record<string, { n: number; winRate: number }> }
```

---

## 6. Socle de perception (`src/ai/core`, WP1)

Le socle sert les monstres, les joueurs, le planificateur, le modèle T0 et le proxy de stuff. Toutes ses fonctions
sont **pures** (fonctions de l'état) ; leurs caches n'influencent que le temps de calcul, jamais une décision.

### 6.1 Vue honnête, clones et avance du temps (`view.ts`, `sim.ts`)

```ts
export interface AIView {
  readonly engine: Engine; readonly fight: FightState; readonly me: Fighter; readonly team: TeamId
  visible(): readonly Fighter[]          // invisibles adverses placés sur leur dernière case connue
  knownTraps(): readonly Trap[]          // pièges invisibles adverses exclus
  upcoming(n: number): SlotForecast[]    // ordre public des prochains tours
}
/** Clone « vu par `team` » : record=false, rollMode 'average', pièges cachés retirés, rngState re-semé. */
export function simClone(view: AIView, parent: FightState, salt: number): FightState
/** Applique une macro-action ; null si le chemin est interrompu (tacle, piège) avant un lancer prévu ou si le lancer échoue. */
export function applyMacro(engine: Engine, s: FightState, meId: number, m: MacroAction): FightState | null
/** Termine le tour courant puis joue les tours suivants jusqu'à `stop` (rollouts, prédiction, micro-scénarios). */
export function advanceUntil(engine: Engine, s: FightState, controllers: ControllerProvider,
                             stop: (next: Fighter) => boolean, maxTurns = 64): Fighter | undefined
export function canPlay(engine: Engine, f: Fighter): boolean   // même test que runner.ts (cannotPlay, preventsFight)
```

`simClone` : `engine.cloneFight(parent, false)`, `options.rollMode = 'average'`, `rngState = mix32(cfg.seed ^ 0x5bd1e995,
salt)` où `salt = hash(nœud parent) ^ profondeur` (même sel pour tous les frères : nombres aléatoires communs
**internes** à la recherche ; jamais l'état réel ⇒ l'IA ne lit pas les dés futurs). Un sort à groupes aléatoires
(`SpellProfile.hasRandomGroups`) est simulé deux fois (deux sels) en `standard`/`deep` et la moyenne est retenue.

### 6.2 Accessibilité avec tacle (`reach.ts`)

```ts
export interface ReachInfo { cells: Int16Array; count: number; mpLeft: Float32Array; apLeft: Float32Array
  prev: Int16Array; viaEvent: Uint8Array }
export function computeReach(view: AIView, s: FightState, f: Fighter,
                             opts?: { mp?: number; ap?: number; allowEventCells?: Set<number> }): ReachInfo
```

Recherche « au mieux » sur `(case, PM restants)` avec tableaux typés réutilisés (`GridSearch`). Quitter une case
adjacente à des tacleurs applique la règle **déterministe** de Dofus 3 (`apMpAfterTackle`, mechanics.md §6) aux PA/PM
restants ; on garde pour chaque case le meilleur couple (PM, PA). Respecte `cantBeTackled`, `cantTackle`,
`tags.canTackle`, Intaclable (96), les corrompus (qui taclent toujours). PM fractionnaires (clones) : chemins sur
`⌊mp⌋` ; les consommateurs qui en ont besoin (menace) interpolent entre `⌊mp⌋` et `⌈mp⌉`. Les cases de glyphe de
monstre et de piège connu sont des **cases-événements** : contournées par défaut, admises seulement si elles figurent
dans `allowEventCells` (leviers d'horloge, tactique `glyphClock`). Cible : ≤ 5 µs pour 6 PM.

### 6.3 `SpellProfile` (`spellProfile.ts`)

Calculé une fois par `SpellLevelData` (normal et critique), par fermeture des sous-sorts (792/793/1017-1019/1160/2160,
profondeur ≤ 4) et lecture de `data/research/effect-semantics.json` :

```ts
export interface DamageLine { element: number; min: number; max: number; critMin: number; critMax: number
  zone: ZoneSpec; mask: string; lifeSteal: boolean; delayed: number; dotTurns: number }
export interface SpellProfile {
  spellId: number; apCost: number; minRange: number; maxRange: number; los: boolean; line: boolean; diagonal: boolean
  castsPerTurn: number; castsPerTarget: number; cooldown: number
  damage: DamageLine[]; apRemoval: number; mpRemoval: number; dodgeable: boolean
  displacement: { kind: 'push' | 'pull' | 'teleport' | 'swap' | 'symmetric' | 'carry' | 'throw' | 'return'; cells: number }[]
  heal: number; shield: number; appliesStates: { stateId: number; on: 'self' | 'target' | 'zone'; duration: number }[]
  requiresStates?: StatesClause[]; summons: number[]; glyph: boolean; trap: boolean
  selfBuff: boolean; allyBuff: boolean; enemyDebuff: boolean; dispel: boolean
  cat: CandidateCat                       // catégorie dominante (quotas)
  hasRandomGroups: boolean; hasTriggers: boolean
  analyticCoverage: number                // part de la valeur estimable sans simulation (< 0,7 ⇒ candidat d'exploration)
  unsupported: boolean                    // un effet sans interprète (E5) ⇒ exclu des candidats si unsupportedSpells='skip'
}
```

### 6.4 `DptTable` (`dpt.ts`)

`dpt(a, d, ap?)` = espérance des dégâts que `a` inflige à `d` en un tour **sans contrainte de position**, avec `ap` PA
(défaut : PA du prochain tour de `a`) : pour chaque sort offensif, `e_s = Σ lignes expectedDamage(stats de a avec ses
buffs, résistances de d, critique) × efficacité de zone (1 au centre) + DoT × min(durée, 2) × 0,8` ; sac à dos borné
(PA ≤ 20, `castsPerTurn`, `castsPerTarget`, relances) ; résultat × `calib[presetId | monsterId]`. La calibration
(mécaniques invisibles à l'analytique : cartes Ecaflip, rampes Iop, bombes Roublard, portails) est le rapport « DPT
simulé / DPT analytique » mesuré une fois par (preset, empreinte de build) sur le micro-scénario `poutch` (3 tours,
IA `fast`, 16 graines), borné à [0,5 ; 2], stocké dans `data/ai/calibration.json` (déterminisme). Clé de cache
`(a.id, a.rev, d.id, d.rev, ap)` ; ≤ 10 µs par paire non cachée. Variante `dptVariance` pour `kill.ts`.

### 6.5 `ThreatModel` (`threat.ts`)

```ts
export interface ThreatModel {
  sync(s: FightState): void                                  // incrémental (rev / empreinte)
  incoming(id: number): number                               // dégâts attendus sur l'allié avant son prochain tour
  cellIncoming(f: Fighter, cell: number): number             // idem si f finissait sur `cell` (autres positions figées)
  deathRisk(id: number): number                              // Φ((inc − hpEff) / (0,25·inc + 1))
  threatOf(e: Fighter): number                               // menace propre d'un ennemi (PVe par tour)
  predictedTarget(e: Fighter): number | undefined
}
export function buildThreat(view: AIView, s: FightState, side: TeamId, p: Perception, scenario?: ScenarioAIModel): ThreatModel
```

```
order = forecastSlots(s) depuis le combattant courant (exclu), sur un tour de jeu
before(a) = ennemis dont le créneau précède le prochain créneau de l'allié a
pour chaque ennemi actif e (vivant, ne passe pas son tour, non statique, pas de cantDealDamage couvrant son prochain tour) :
   ap_e, mp_e = points au prochain tour de e (buffs encore actifs à ce moment, valeurs fractionnaires admises)
   R_e = computeReach(e, mp_e) ∪ profil.threatOrigins(e)        // Vortex : contact de la future Auroraire si Heurage prêt
   pour chaque allié a :
      hit(e,a) = 1 si une case de R_e permet le meilleur sort sur a (portée, ligne, LdV) ; 0,6 si seul un sort plus faible
                 est lançable ; 0,25 si a n'est atteignable qu'au tour d'après ; 0 sinon   (interpolé si mp_e fractionnaire)
      dmg(e,a) = dpt(e, a, ap_e − coût du déplacement) · hit(e,a) + 0,9·Pot_a si e pose cantDealDamage (Pacifiste) sur a
      s_a      = min(dmg, hpEff_a) + [dmg ≥ hpEff_a]·(0,5·maxHp_a + threat_a)          // imite le score du monstre (§11.4)
   π_e(a) = softmax(s_a / τ), τ = 0,25 · max_a s_a                // ≈ argmax du MonsterBrain, lissé (robustesse)
   pour a tel que e ∈ before(a) : inc[a] += ω_e · (π_e(a)·dmg(e,a) + 0,6·part de zone sur a)
                                   ω_e = 1 si aucun allié ne joue entre maintenant et e, 0,8 sinon
inc[a] += scenario.extraIncoming(s, a, a.cell)                     // lignes de l'Auroraire, Heuristique, Morfaille…
```

Les DoT ne sont **pas** dans `incoming` (terme `pendingDot` séparé, §7). `cellIncoming` réutilise `R_e` et ajoute
l'effet de la case sur le tacle (si `f` sur `cell` est adjacent à `e`, `mp_e` est réduit selon le ratio de fuite de `e`).
Cibles : construction ≤ 30 µs (8 ennemis × 4 alliés × 3 sorts), `cellIncoming` ≤ 2 µs. Validation (§16.1) :
corrélation ≥ 0,8 avec les dégâts subis en rollout, cible prédite = cible du `MonsterBrain` dans ≥ 85 % des cas.

### 6.6 `PotentialModel` (`potential.ts`)

Symétrique de la menace : `Pot_a(s)` = meilleure valeur offensive de l'allié `a` à son prochain tour (PA/PM de ce
tour, Pacifiste ⇒ 0, retraits subis déduits, reach + anneaux de portée), sur les ennemis **vulnérables à ce moment**
(`scenario.vulnerableAt`) : `max_e [min(dmg, hpEff_e)·v_e + P(kill)·killValue_e] + 0,3 × 2e cible pour les zones`.
C'est le terme qui rémunère les **mises en place** : rapprocher un monstre du Iop, le regrouper pour la zone du Crâ,
poser « dommages subis ×150 % » avant le coup d'un allié, dissiper un Pacifiste.

### 6.7 Kills (`kill.ts`)

* `killProbability(mean, variance, hpEff) = Φ((mean − hpEff)/σ)` ; variance = Σ des variances des lignes (uniforme
  discrète, critique en mélange). Φ et softmax par approximations rationnelles (pas de `Math.exp` dans les décisions,
  §13.3).
* `canKillNow(view, me, t) → { p, apNeeded, spells, castCell }` : meilleur plan analytique depuis `reach`.
* **Split léthal** (`standard`/`deep`, au plus un par chemin du faisceau) : si une cible finit à `0 < PV ≤ 8 % PVmax`
  ou meurt avec un excès < 8 %, on rejoue le lancer en `rollMode: 'min'` et `'max'` (2 nœuds) ;
  `p = 1` si `min` tue, `0` si `max` ne tue pas, sinon `clamp((Dmax − PV)/(Dmax − Dmin))` ;
  valeur = `p·V(tué) + (1 − p)·V(survivant)`. C'est ce qui fait préférer deux sorts sûrs à un sort à 55 % pour une
  corruption à l'heure exacte. En `fast`, seule l'approximation analytique est utilisée.

### 6.8 Transpositions et budget (`hash.ts`, `budget.ts`)

`stateHash` = FNV-1a 2 × 32 bits sur, pour chaque combattant vivant : case, PV (paliers de 10), bouclier, PA, PM
(× 100), empreinte des buffs (uid + restant), relances ; plus uids des glyphes/pièges et `round`. Deux ordres de lancers
indépendants donnent le même hash : on garde le meilleur. `NodeBudget` compte les nœuds simulés (rollouts et splits
compris) ; un garde-fou en millisecondes ne fait qu'**émettre un avertissement**.

---

## 7. Fonction de valeur `V(s)` (`core/value.ts` + `tactical/evaluate.ts`)

Valeur **absolue** d'un état, du point de vue de l'équipe qui décide ; une décision compare `V(feuille) − V(racine)`.
Notations : `hpEff = PV + 0,9·bouclier`, `A` alliés (personnages + invocations), `E` ennemis non statiques.

| Terme | Formule | Poids initial | Remarques |
|---|---|---|---|
| `enemyLife` | `−Σ_e v_e·hpEff_e` | `v_e` : monstre 1 ; invocation 0,5 ; invulnérable jusqu'au prochain tour allié 0 ; scénario : `damageWeight` | overkill nul par construction |
| `kills` | `Σ_{e mort depuis la racine} deathValue ?? (κ·PVmax_e + τ·threat_e)` | κ 0,3 ; τ 1,0 | `incoming` couvre la menace jusqu'au prochain tour ; τ couvre le tour suivant |
| `allyLife` | `Σ_a ω_a·(PV_a + 0,8·bouclier_a)` | ω 1 ; invocations 0,4 | |
| `erosion` | `−Σ_a w_er·(baseMaxHp_a − maxHp_a)` | 0,5 | PV max perdus, non soignables |
| `allyDeath` | `−Σ_{a mort} (baseMaxHp_a + 2·dpt_a + U_role + allyDeathExtra)` | `U_role` : healer 2 000, mpLock/apLock 1 500, placer 1 000 | ≈ 10 000 PVe pour un personnage niveau 200 |
| `incoming` | `−w_inc·Σ_a [min(inc_a, hpEff_a) + deathRisk_a·deathCost_a]` | 0,8 (tank 0,6) | §6.5 ; source unique de la valeur du contrôle |
| `pendingDot` | `−Σ_a Σ_k 0,8^k·DoT_a(k)` | 0,9 | poisons programmés (Petit poison ≈ 475/tick) : la purge par soin rapporte |
| `control` | `w_ctl·Σ_e (ΔPA_next·apWorth_e + ΔPM_next·mpWorth_e)` (Δ depuis la racine) | 0,15 | guide quand la menace ne bouge pas encore (monstre loin) ; `apWorth = threat/PA`, `mpWorth = α·threat/max(1,PM)`, α 0,6 si e doit bouger pour frapper, sinon 0,15 |
| `potential` | `Σ_a w_pot(a)·Pot_a` | 0,35 si a joue avant le prochain tour de l'ennemi le plus menaçant, sinon 0,15 | mises en place |
| `continuation` | `w_cont·restOfTurn(me, s)` sur les feuilles **non terminales** (classement interne au faisceau, §8.2) | 0,8 | sac à dos analytique des PA/PM restants depuis `s`, kills compris (`canKillNow`) ; remplace `thisTurnPower`/`killFeasible` : gaspiller les PA d'un kill réservé fait chuter ce terme |
| `resources` | `−0,08·Σ_{sorts lancés} relance·valeurMoyenne(sort)` − 2 par PA inutilisé en fin de tour | | départage, coût d'opportunité |
| `position` | termes de rôle bornés à ±50 (case finale seulement) | | §8.5 |
| `scenario` | `Σ_m bandes de PV + clock[k] + cell[case finale] + Σ_i price_i·sat_i` | 1,0 | §8.4, §12.7 ; kills et pentes passent par `deathValue`/`damageWeight` |

Règles anti-double-comptage : (1) en phase 1 du Vortex, un monstre de vague n'a **ni** `κ`/`τ` ni `v_e = 1` : sa
mort vaut `PriceTable.kill`, ses PV valent `PriceTable.hp.slope` (défaut 0,3) ; (2) aucune intention ne duplique un
prix ; (3) le terme `control` est retiré si l'ablation (§16.5) ne montre pas de gain.

Exemple (P1 des puzzles) : Buboxor à 6 PM qui atteindrait le Crâ (≈ 1 500 de dégâts) avant le prochain tour du Crâ.
L'Enutrof lui retire 3 PM (espérance 2,9 avec esquive 0) : `hit` passe de 1 à 0,25, donc `incoming` baisse de
`0,8 × 1 500 × 0,75 ≈ 900` PVe, plus `control` ≈ 60. Un sort de dégâts de 1 700 sur ce monstre de vague ne vaut que
`0,3 × 1 700 ≈ 510`. L'Enutrof choisit le retrait **sans règle spéciale**. Coût d'un `V(s)` complet : ≤ 30 µs (menace
incrémentale + DPT en cache).

---

## 8. Couche tactique (`src/ai/tactical`, WP2)

### 8.1 Génération des candidats et élagage

Trois sources, fusionnées : **génériques** (`core/candidates.ts`, partagé avec les monstres), **prix et intentions**
(sorts capables d'atteindre une cible sous contrat, chemins vers les cases `position`, chemins par une glyphe si
`clock[1] > glyphCost`), **tactiques** (§10, séquences de 1 à 4 macro-actions).

| # | Règle |
|---|---|
| C1 | Filtre statique avant toute géométrie : PA, relance, `castsPerTurn`, `statesCriterion`, `preventsSpellCast`, sort `unsupported`, sort réservé (`reserve`). |
| C2 | Sorts à cible entité : cases occupées dont l'occupant est accepté par le masque d'au moins un effet ; un ennemi invulnérable n'est retenu que si le sort retire un état ou le déplace (R9). |
| C3 | Sorts de zone : centres dont la zone touche ≥ 1 cible utile ; 6 meilleurs centres par `quick` (cibles pondérées, tir ami soustrait). |
| C4 | Sorts à case libre (invocation, téléportation, jet du Pandawa, glyphe, piège) : ≤ 8 cases classées par Δmenace de l'entité déplacée / couverture de passage (pièges). |
| C5 | Sorts sur soi : case de lancer = case actuelle ou case atteinte. |
| C6 | `inverseRange(sort, cible)` pré-calculée par (géométrie, case) ; intersection avec `reach` en O(taille de l'anneau). |
| C7 | ≤ 3 cases de lancer par (sort, cible), triées par (coût de tacle, `cell[c]`, `cellIncoming`) ; **toujours** la case actuelle si elle est valide. |
| C8 | Dominance : même sort, mêmes cibles touchées, case finale de même classe de danger ⇒ garder la moins coûteuse en PM ; centres symétriques équivalents ⇒ un seul. |
| C9 | Rejet dur : simulation qui tue le lanceur (renvoi) ; tir ami > 20 % des PV d'un allié sans gain ≥ 2× ; piège sur son propre chemin restant ; défi actif violé. |
| C10 | Rejet doux : un candidat qui tuerait un monstre de prix `kill < −1 000` n'est simulé que si aucun autre candidat de sa catégorie n'atteint 0 (la simulation reste juge). |
| C11 | Mouvement seul : uniquement en fin de tour (§8.5) ou comme levier (glyphe, case d'étranglement, sortie de ligne). |
| C12 | Profondeur : arrêt quand plus rien n'est lançable avec les PA restants ou à `maxDepth`. |

**Préfiltre `quick`** (sans clone, ≤ 1,5 µs) : dégâts analytiques plafonnés × `v_e` (ou prix de scénario) +
`P(kill)·valeur` ; retraits `expectedApMpRemoved × apWorth/mpWorth` ; Δmenace d'**un** ennemi déplacé (recalcul local
≈ 2 µs) ; soin plafonné + poisons retirés ; Δpotentiel de l'allié buffé ; prix d'intention. Il ne sert qu'à **trier** ;
le test T-prefilter exige que le meilleur enfant simulé soit dans le top-K du préfiltre ≥ 95 % du temps (sinon on
corrige `quick`, pas K).

**Sélection pour simulation** : top-K par `quick` sous **quotas** (standard, K = 12 : `damage` 5, `control` 2,
`placement` 2, `heal`/`buff` 1, `summon`/`mark` 1, `utility` 1 ; les quotas inutilisés sont redistribués par valeur),
modulés par le rôle (`mpLock`/`apLock` : `control` +2 ; `placer` : `placement` +2 ; `healer` : `heal` +1 si un allié
< 70 %), **plus** les candidats obligatoires (≤ `mandatoryMax` = 4) : kills de prix > 0, levier d'horloge si
`|clock[1]| > glyphCost`, intentions du combattant courant, un candidat d'exploration (`analyticCoverage < 0,7`, en
tourniquet).

### 8.2 Recherche en faisceau (`turnSearch.ts`)

```ts
function searchTurn(ctx: TacticalContext): TurnPlan {
  const b = ctx.isKey ? boost(ctx.budget) : ctx.budget                  // décision clé : ×2 (standard)
  const root = makeRoot(ctx)                                            // simClone, perception synchronisée, bb figé
  let beam = [root]; const leaves = [root]; const seen = new Map<bigint, number>()
  for (let depth = 0; depth < b.maxDepth && beam.length; depth++) {
    const children: Node[] = []
    for (const node of beam) {
      for (const c of selectForSim(ctx, node, generate(ctx, node), b)) {
        if (ctx.nodes.exhausted()) break
        const child = expand(ctx, node, c, /* salt */ node.hash ^ BigInt(depth))   // null si interrompu
        if (!child) continue
        child.v = evalLeaf(ctx, child)                                  // §7 + prix + intentions + split léthal
        const prev = seen.get(child.hash); if (prev !== undefined && prev >= child.v) continue
        seen.set(child.hash, child.v); children.push(child); leaves.push(child)
      }
    }
    beam = selectDiverse(children, b.width)
  }
  const finals = topN(leaves, 2 * b.width).map(l => finalize(ctx, l))   // + meilleur déplacement de fin (§8.5)
  for (const f of topN(finals, b.rollouts)) f.v = 0.5 * f.v + 0.5 * teamRollout(ctx, f)   // §8.6
  const best = argmax(finals, tieBreak)                                 // moins de PM, prior du 1er acte, key
  const pass = finalize(ctx, root)                                      // « ne rien lancer » : plan complet lui aussi
  return best.v - pass.v < ctx.theta.minGain && !best.hasMandatory ? extractPlan(pass) : extractPlan(best)
}
```

`finalize` rend une feuille **terminale** (déplacement de fin, `continuation` = 0, pénalité des PA inutilisés) : les
plans complets sont comparés entre eux, le terme `continuation` ne sert qu'à classer les plans partiels dans le faisceau.
`selectDiverse(children, W)` : tri par valeur ; **un emplacement réservé** au meilleur enfant contenant une action non
`damage` si sa valeur ≥ `best − 0,3·|best − root|` ; refus d'un 3e enfant de même signature structurelle (multiensemble
des catégories + 1er sort) ; complément par valeur. But : garder vivantes les lignes « retirer 4 PM puis frapper » qui
ne paient qu'au tour suivant.

### 8.3 Modes

| Mode | Largeur / topK / profondeur | Nœuds max par tour | Rollouts | Pricer | MCTS | Usage |
|---|---|---|---|---|---|---|
| `scripted` | — (rotations du preset) | 0 | — | heuristique (affichage) | — | itérations massives « sans IA », références |
| `fast` | 1 / 6 / 8, replanification après **chaque** action | 40 | 0 | `HeuristicPricer` | — | Monte-Carlo, réglage, optimiseur |
| `standard` | 6 / 12 / 6 | 1 500 (×2 sur décision clé, ≤ 12 par combat) | 3 (pessimisme β 0,25) | `SearchPricer` | — | évaluation fine, validation, rapport |
| `deep` | 12 / 20 / 8 | 15 000 | 6 | `SearchPricer` deep | 1 500 itérations × ≤ 30 décisions clés | démo, rembobinage |

### 8.4 Évaluation d'une feuille (`evaluate.ts`)

```
evalLeaf(s) = valueOf(s).total                                   // §7, avec damageWeight / deathValue du scénario
            + Σ_m bande(m, s)                                    // PriceTable.hp : bandBonus si PV_m ∈ [bandMin, bandMax]
            + clock[heures avancées pendant le plan]             // lues dans l'état (glyphes déclenchés)
            + Σ_i price_i · sat_i(root, s)                       // intentions du combattant courant (tableau ci-dessous)
```

| Intention | Satisfaction `sat ∈ [−1, 1]` lue sur l'état simulé |
|---|---|
| `control(target, mpMax/apMax)` | `clamp((PM_next⁰ − PM_next)/(PM_next⁰ − mpMax), 0, 1)` |
| `protect(ally)` | `1 − incoming_ally(s)/incoming_ally(racine)` |
| `cleanse(ally)` | 1 si plus aucun poison « retiré par soin » sur l'allié |
| `position(cells)` | 1 si la case finale ∈ cells, sinon `max(0, 1 − 0,2·distance)` |
| `setup(ally, target)` | `ΔPot_ally / gain attendu` (cible amenée dans la zone de l'allié suivant) |
| `reserve(spellId)` | −1 si le sort a été lancé |
| `burst(target)` | dégâts / dégâts prévus (plafonné à 1,5) |
| `survive(me)` | `1 − deathRisk(me)` |

### 8.5 Déplacement de fin de tour (`finalMove.ts`)

Pour chaque case atteignable avec les PM restants (tacle inclus) :
`pos(c) = −w_inc·cellIncoming(me, c)·(1 + deathRisk) + 0,25·opportunité(me, c) + roleTerm(me, c) + cell[c]
+ sat(intentions position/survive) − 50·[c réservée par un allié]`, puis simulation des `endCells` meilleures (pièges,
glyphes, échanges forcés de l'Auroraire) ; « rester » est toujours candidat ; un déplacement qui rapporte < 5 PVe
(30 PVe en `fast`) est refusé.

| Rôle | `roleTerm(me, c)` |
|---|---|
| `killer`, `zoneDps`, `mpLock`, `apLock` | `−15·abs(dist(c, cible focale) − portée idéale)` ; `−200` au contact d'un ennemi non taclé |
| `tank` | `+150·ennemis adjacents taclés` + `100·[c sur le plus court chemin d'un ennemi vers un allié fragile]` |
| `healer`, `support` | `+60·alliés à portée de soin/buff` ; `−200` au contact |
| `placer` | `+40·entités à portée de ses déplacements à 1-2 PA` |
| `summoner` | `+40·[une case d'invocation utile reste libre à portée]` |

### 8.6 Rollouts d'équipe (`rollout.ts`)

En Dofus les tours alternent (P1 M1 P2 M2…) : un bon tour se juge **après** la réponse des monstres et le tour de
l'allié suivant.

```
teamRollout(leaf) :
  s = clone(leaf après déplacement final)
  advanceUntil(s, monstres → MonsterBrain 'predict', nos invocations → politique fast,
               arrêt au début du tour du prochain PERSONNAGE allié)          // TB appliqués : horloge, étoiles, poisons, vagues
  vPred = evalLeaf(s) ; vAlt = evalLeaf(s avec le 2e choix du monstre le plus menaçant)
  vMon  = (1 − β)·vPred + β·min(vPred, vAlt)                              // pessimisme, β = 0,25
  return 0,5·vMon + 0,5·evalLeaf(s après un tour fast de cet allié, tableau noir figé)
```

Le rollout capte « regrouper pour la zone du Iop », « retirer des PM pour que l'allié
suivant joue en sécurité », « pré-dégâts au bon palier pour le tueur désigné ». Coût ≈ 4 ms (≈ 1 tour de monstre
`predict` + un tour allié `fast`).

### 8.7 Exécution et replanification (`executor.ts`)

L'`Executor` joue le plan action par action (`performAction`, `rollMode: 'random'`) et compare l'état réel au
`StateDigest` prévu. Il replanifie (recherche avec `replanFraction` = 50 % du budget initial, ≤ 4 fois par tour) si :
une cible prévue morte survit (ou l'inverse), l'écart de PV d'une cible dépasse 15 % des dégâts prévus, PA/PM/case
du joueur diffèrent (esquive, tacle, poussée), un combattant apparaît ou disparaît, ou l'heure a changé. En `fast`,
la recherche est relancée après chaque action (le plan ne contient qu'une action utile). Garde : ≤ 12 actions par tour.
C'est l'équivalent joueur des règles R10/R11/R18 des monstres.

### 8.8 Décisions clés (`keys.ts`, `mcts.ts`)

Déclencheurs : contrat de corruption dans le créneau courant (`corruptionKill`), `deathRisk ≥ 0,3` d'un allié sous le
meilleur plan (`allyDeathRisk`), deux meilleurs plans à moins de 150 PVe avec des premières actions différentes
(`closeCall`), premier tour vulnérable du Vortex ou potentiel d'équipe ≥ PV d'un ennemi majeur (`burst`), arrivée de
vague, *Action !* (`waveArrival`, `phaseChange`). En `standard` : budget ×2 (largeur 10, 6 rollouts), ≤ 12 par combat.
En `deep` : **MCTS** (UCT c = 0,7, élargissement progressif `k(n) = ⌈1,5·√n⌉`) dont les actions racines sont les 6
meilleurs plans d'un faisceau réduit + le plan `fast` ; chaque itération tire **ses** dés (`rollMode: 'random'`, graine
d'itération ⇒ la probabilité d'échec d'une corruption est mesurée) ; monstres en `play`, alliés en `fast` jusqu'à la
fin du tour de jeu suivant ; on retient le plan racine le plus visité.

---

## 9. Couche stratégique et coordination d'équipe (`src/ai/team`, WP2)

### 9.1 Déroulé d'un tour de joueur

`nextTurn` applique les effets de début de tour, puis `TeamController.playTurn` enchaîne : (1) `TeamBrain.observe`
(`Perception.sync`, réassignation des rôles, calibration en ligne de l'oracle de kill, §12.6) ; (2) `Commander.update`
(phase, `ScenarioAIModel.update` : plan à horizon glissant, `PriceTable` et intentions du combattant courant ;
allocation, focus, réservations ; `Blackboard.version++`) ; (3) `TurnSearch` (§8.2) puis `Executor` (§8.7) ;
(4) annotations `aiNote`. Le `TeamBrain` vit **hors** de `FightState`, est une fonction déterministe de l'historique et
expose `snapshot()/restore()` (données pures) pour le rembobinage (§15.8) ; les rollouts utilisent un tableau noir figé.

### 9.2 Rôles (`roles.ts`)

```ts
export interface CapabilityProfile { fighterId: number
  dptMono: number; dptZone3: number; burst1: number          // PVe/tour contre la cible de référence du scénario
  mpRemoval: number; apRemoval: number                        // points retirés attendus/tour (esquive de référence)
  placement: number; heal: number; shield: number; cleanse: boolean; dispel: boolean; summons: number
  tackle: number; evade: number; ehp: number; maxRange: number; mobility: number; initiative: number }
export function capabilities(view: AIView, f: Fighter, p: Perception, ref: ReferenceTargets): CapabilityProfile
export function assignRoles(team: Fighter[], caps: CapabilityProfile[], needs: Partial<Record<RoleId, number>>,
                            prior?: Map<number, RoleId>): Map<number, { primary: RoleId; secondary?: RoleId; scores: Record<RoleId, number> }>
```

Scores : `killer = dptMono/3 000`, `zoneDps = dptZone3/6 000`, `mpLock = mpRemoval/4`, `apLock = apRemoval/4`,
`placer = placement/3`, `tank = (ehp/6 000)·(tackle/100)`, `healer = heal/1 500`, `support = buffValue/1 000`,
`summoner = summons/2`, puis +10 % pour les rôles officiels de la classe (DofusDB `breedRoles`) et imposition possible
par le preset (§15.6). Le scénario publie un vecteur de besoins (Vortex : `killer 2, mpLock 1, zoneDps 1, placer 0,5,
healer 0,5, tank 0,5`) ; l'affectation maximise `Σ besoin couvert × score` par énumération (9⁴ = 6 561 combinaisons,
< 1 ms) ; le second meilleur score ≥ 0,6 × principal devient le rôle secondaire. `Fighter.role` est renseigné pour le
replay. Réassignation au début de chaque tour si un porteur de rôle clé est mort.

Un rôle ne crée **aucun objectif propre** : tous les alliés maximisent la même `V`. Il modifie seulement : quotas de
candidats (§8.1), priors de tactiques (§10), `w_inc` (tank 0,6), `U_role` (§7), `roleTerm` de fin de tour (§8.5),
l'éligibilité aux contrats de kill (pas de contrat pour un `mpLock`/`apLock` dont le `dpt` est < 60 % de la moyenne —
« un Enutrof full retrait ne doit pas faire les kills », vortex.md §13.1) et les départages.

### 9.3 Tableau noir (`blackboard.ts`)

Mis à jour au début du tour de chaque allié (< 1 ms) :
* **Focus** : `prio_e = threat_e·(fenêtre de kill d'équipe ? 1,5 : 1)/max(1, TTK_e) + bonus de contrat`, `TTK_e` =
  tours alliés nécessaires (`hpEff/Σ dpt·atteignabilité`) ; la fenêtre de kill d'équipe somme les contributions des
  alliés qui jouent **avant** le prochain tour de la cible.
* **Réservations** : si `canKillNow(me, t).p ≥ 0,6` pour une cible focale ou sous contrat, `t` est réservée par `me` ;
  le terme `continuation` protège les PA nécessaires.
* **Intentions** : celles du combattant courant entrent dans sa recherche ; celles des alliés suivants servent aux
  paliers de PV (`hp.band`) et au tour `fast` joué dans les rollouts.
* **Cases réservées** : la case finale choisie par un allié est pénalisée (−50) pour les alliés suivants.
* **Cohérence** : l'allié suivant reçoit +100 PVe s'il réalise l'intention que le rollout de l'allié précédent lui
  prêtait et qu'elle reste dans son top-3 (évite deux alliés qui s'attendent mutuellement).

### 9.4 Commandant et machine à phases (`commander.ts`)

| Phase | Entrée | Plan actif | Remarques |
|---|---|---|---|
| `fight` | combat sans scénario | `GenericModel` : focus = argmax `Δincoming` par PV effectif à retirer, prix de kill génériques | combats de contrôle, tests |
| `opening` | tour 1 (Vortex) | placement déjà fait (§12.10) ; contrôles, pré-dégâts | aucun kill à une heure chère |
| `waveCycle` | un monstre de vague non corrompu vivant | `HourPlanner` + allocation | régime principal |
| `waiting` | tout corrompu, Vortex encore Marginal | sécurité (hors lignes de l'Auroraire au créneau du Vortex), soins, pré-buffs | horloge sans enjeu |
| `transition` | dernier corrompu / *Action !* imminente | `BurstPlanner` (préparation) | délai `actionDelay` 0/1 (paramètre) |
| `burst` | Vortex vulnérable | `BurstPlanner` (exécution) | prix du kill du Vortex = victoire |
| `emergency` (transverse) | `deathRisk > 0,35` d'un allié avant son tour | intentions `protect`/`survive` prioritaires | superposée à la phase courante |

Engagement : un nouveau plan de scénario remplace l'ancien si `score_new > score_old·(1 + θ.commit)` (0,1) ou si un
contrat devient infaisable (tueur mort, `pKill < 0,5`) ; l'ancien reste l'alternative n° 2 (rembobinage).

### 9.5 Allocation des intentions (`allocator.ts`)

```
needs = []
pour chaque ennemi e trié par contribution à incoming (desc), non tué par le plan avant son prochain tour :
    needs += control(e, mpMax = PM minimal pour que hit(e,·) ≤ 0,25), prix = baisse de menace estimée
pour chaque allié a avec deathRisk > 0,15 : needs += protect(a), prix = deathRisk·coût de mort
pour chaque allié empoisonné (poison retiré par soin) : needs += cleanse(a), prix = Σ ticks restants
pour chaque contrat du plan : needs += setup/position pour les alliés jouant avant le tueur (LdV, regroupement)
affectation gloutonne par prix décroissant, aux seuls alliés qui jouent AVANT l'échéance (timeline) :
    u(i, n) = n.price · aptitude(rôle_i, n.kind) · faisabilité(i, n)     // reach + dpt + portée des sorts utiles
    ≤ 3 intentions par allié ; tout est recalculé au tour suivant (horizon glissant)
```

### 9.6 Prix fictifs (`src/dungeons/vortex/pricer.ts`, WP3 ; interface `ScenarioAIModel.update`)

* **`SearchPricer`** (`standard`, `deep`) : le planificateur tourne avec une diversité de racine (≥ 2 nœuds par action
  racine distincte). Pour chaque action racine `r` du créneau courant (tuer m maintenant, pré-dégâts sur m, glyphe +k,
  rien), `best(r)` = meilleur score de descendant. `kill[m][x] = best(kill m à x) − best(sans tuer m)` ;
  `clock[k] = best(glyphe +k) − best(0)` ; `hp[m].slope = (best(dégâts E sur m) − best(rien))/E`, bornée [0 ; 1,2].
  Racine absente du faisceau final : relance forcée (faisceau 8, horizon 8), ≤ 6 par tour. Bornes
  `kill ∈ [−3 000 ; +4 000]`.
* **`HeuristicPricer`** (`fast`) : formules fermées (§12.7) ; mis en cache tant que le tracker ne voit aucun événement
  symbolique (mort, résurrection, vague, glyphe, étoile).

### 9.7 Invocations alliées (`summons.ts`)

Contrôlées par le `TeamBrain` (Maîtrise des invocations) en politique `fast`, avec ω = 0,4 et le tableau noir. Une
invocation qui joue juste après son invocateur est simulée dans le rollout de celui-ci, ce qui valorise correctement
« invoquer puis bloquer ». Plafond de candidats par entité (Osamodas, Sadida, Roublard) : 12 nœuds par invocation.

---

## 10. D'où vient la créativité

### 10.1 Mécanismes

1. **Complétude** : tout sort lançable sur toute cible pertinente (alliés, soi, cases vides, centres de zone, glyphes)
   est candidat ; les quotas font **simuler** contrôle, placement et soin à chaque nœud.
2. **Simulation exacte** (poussée + collision, échange, symétrie, portage, états, sous-sorts, déclencheurs) : la valeur
   vient des conséquences. **Menace et potentiel** (§7) mettent retrait de PM, éloignement, Pacifiste évité, couloir
   bloqué, poison purgé et regroupement pour l'allié suivant à armes égales avec les dégâts.
3. **Séquences** : le faisceau trouve les combos intra-tour (porter → marcher → jeter ; glyphe +1 heure **puis** kill de
   corruption), les rollouts les mises en place entre alliés, le MCTS (`deep`) les combos entre tours.
4. **Objectifs de scénario** : « marcher dans la glyphe de l'Ikargn », « ne pas tuer maintenant », « deux zombies sous
   la même étoile », « mur de corrompus » n'existent que parce que le plan les paie.
5. **Tactiques proposeuses** : candidats que la génération générique ne produirait pas (cases libres bien choisies,
   séquences qui ne paient qu'au 2e ou 3e pas) ; elles ne notent jamais. **Boucle externe** : priors, poids et coûts
   réglés sur le taux de victoire ; exploration ε = 5 % sur l'ordre des candidats en `fast` pendant le réglage.

### 10.2 Interface et bibliothèque

```ts
export interface Tactic {
  id: TacticId
  requires(caps: CapabilityProfile, spells: SpellProfile[]): boolean        // une fois par combat
  relevance(ctx: TacticalContext, node: Node): number                       // O(µs) ; 0 = rien à proposer
  propose(ctx: TacticalContext, node: Node, limit: number): MacroAction[]   // séquences de 1 à 4 macro-actions
}
// quota de la tactique = round(θ.tactics.prior[id] · relevance), plafond global 4 par nœud (hors quotas génériques)
```

| v | Tactique | Classes typiques | Proposition | Valeur captée par |
|---|---|---|---|---|
| 1 | `stateChain` (données) | toutes | `A → B` si `A` pose l'état `S` exigé par `B.statesCriterion` (Porteur du Pandawa) ; mobilité puis lancer impossible depuis `reach` (Pas Chassé, Xélor) ; débuff « prochain coup » ×150/×200 puis plus gros sort ; déplacement d'ennemi puis zone du même personnage | `V` |
| 1 | `mpLock` | Enutrof, Crâ, Sram, Féca | retirer à chaque monstre juste assez de PM pour qu'il n'atteigne personne, dans l'ordre de la timeline | `incoming` |
| 1 | `carryThrow` | Pandawa | porter x → marcher (≤ 2 chemins) → jeter vers une case « but » : groupe (zone de l'allié suivant), isolement, contact du tank, sauvetage d'un allié (hors croix de l'Auroraire) | `V` + rollout |
| 1 | `glyphClock` | toutes | traverser une glyphe de monstre en tête (glyphe puis kill) ou en fin de plan (kill puis glyphe) ; si `clock[1] < 0`, tous les chemins évitent les glyphes | `clock[k]`, `kill[m][h]` |
| 1 | `healCleanse` | Eniripsa, Pandawa, Osamodas, Enutrof | couverture minimale des empoisonnés (soin de zone > soins unitaires bon marché) ; passage par la glyphe de Méjaire | `pendingDot` |
| 1 | `bodyBlock` | toutes, invocateurs | occuper (marcher, invoquer, jeter) les cases d'articulation du DAG des plus courts chemins d'un monstre vers nos alliés | `incoming` |
| 1 | `groupForZone` | Pandawa, Xélor, Iop, Steamer | rapprocher 2-3 monstres dans la zone du meilleur sort de l'allié suivant | `potential` + rollout |
| 1 | `burstSetup` | Iop, Enutrof, Eniripsa, Ecaflip | buffs/débuffs dont la durée couvre le créneau de burst ; réserver les gros sorts | intentions `setup`/`reserve` |
| 2 | `apLock`, `tackleTrap`, `pushCollision`, `losShield`, `lineDodge`, `corruptedWall`, `baitSummon`, `dispelAlly` | | voir `ai-proposal-planning.md` §8.2 | `incoming`, `potential`, `V` |

Exemples de séquences (pseudo-code) :

```
mpLock(e) : need = PM_next(e) − PMmax tel que hit(e, a) ≤ 0,25 pour tout allié a      // BFS inverse depuis ses cases de lancer
            options = sorts de retrait PM ; espérance = expectedApMpRemoved(retrait, esquive, PM)
            proposer la séquence de coût minimal en PA qui atteint need avec P ≥ 0,7, menaces les plus proches dans la timeline d'abord
carryThrow : pour chaque entité x portable adjacente/atteignable ; Y = cases de jet triées par but ;
            proposer seq(porter x, déplacement ≤ 2 chemins, jeter vers Y) pour les 3 meilleurs Y de chaque but
glyphClock : pour chaque glyphe de monstre atteignable (case libre, PM suffisants, tacle acceptable) :
            seq(move via glyphe, meilleur kill sous contrat) et seq(meilleur kill, move via glyphe)
```

### 10.3 Garde-fous et mesure

* Aucun sort `unsupported` n'est proposé ; une tactique reposant sur une mécanique INCERTAINE (jeter un monstre sur la
  case IV pour qu'il soit échangé vers III) est désactivée par défaut et testée à part.
* Une action est marquée **« créative »** si le plan choisi contient une action non offensive **et** soit bat le
  meilleur plan purement offensif de ≥ 15 %, soit tire ≥ 60 % de son `ΔV` de termes autres que `enemyLife`/`kills`.
  Elle produit un `aiNote` (`kind: 'creative'`, ex. « Enutrof retire 3 PM au Buboxor : il n'atteindra pas le Crâ
  (−900 PVe de menace) ») et est comptée dans `FightSummary`.
* Le rapport donne l'usage de chaque tactique et un replay exemple (« audit d'exploit ») ; ablation (§16.5) : interdire les sorts non offensifs doit faire chuter le taux de victoire ; chaque tactique v1 doit
  montrer un gain apparié significatif, sinon elle est retirée.

---

## 11. IA des monstres (`src/ai/monster`, WP1)

### 11.1 Principes

La conception de monster-ai.md §8 est adoptée : une IA générique **gloutonne** qui replanifie après chaque action, des
**profils** déclaratifs et des **overrides** de priorités. Les mécaniques de boss sont dans les données et exécutées
par le moteur. Trois réglages :

| Réglage | `topK` simulés | Où | Exigence |
|---|---|---|---|
| `play` | 8 + obligatoires (`openers`, `alwaysCastWhenReady`, candidats à `analyticCoverage < 1` à moins de 15 % du meilleur) | **tout** tour réel de monstre, dans **tous** les modes joueurs et dans le MCTS `deep` | référence de fidélité |
| `predict` | 4, sans obligatoires d'exploration | rollouts et prévisions des joueurs (§8.6), calibration de la menace | accord top-1 avec `play` ≥ 90 % |
| `reference` | 24 (monster-ai.md §8.2) | test d'équivalence uniquement | `play` = `reference` en top-1 dans ≥ 97 % de 1 000 situations tirées |

Les monstres ne sont **jamais** réglés pour gagner ; leurs poids ne bougent que pour passer les tests de comportement.
Bruit optionnel `noiseTau` (softmax sur le top-3, flux RNG IA) : 0 par défaut, 0,1 dans les campagnes de robustesse.

### 11.2 Boucle de tour (`brain.ts`)

```ts
playTurn(engine, fight, me) {                              // effets TB déjà appliqués par startTurn (R19)
  const ctx = MonsterContext.create(engine, fight, me, this.cfg)   // vue honnête, profil, menace des joueurs, caches
  if (ctx.behaviour === 'static') return
  for (const a of ctx.profile.hooks?.beforeTurn?.(ctx) ?? []) ctx.perform(a)
  let offensive = false
  for (let step = 0; step < 12 && me.alive && !fight.ended; step++) {
    const best = pickBestAction(ctx)                        // candidats → quickEstimate → topK simulés → score §11.4
    if (!best || best.score < ctx.w.minActionScore) break   // « passer » après un kill (§1.3 de monster-ai.md)
    if (best.path) ctx.perform({ type: 'move', path: best.path })
    if (best.cast && me.alive) offensive = (ctx.perform({ type: 'cast', ...best.cast }).ok && best.offensive) || offensive
    ctx.refresh()                                            // R10, R11, R18
  }
  updateFearfulMode(ctx, offensive)                          // R12/R13 → me.tags.aiBehaviour (cloné avec l'état)
  finalMove(ctx)                                             // §11.5
}
```

La mémoire nécessaire à la fidélité (mode peureux, croyance sur un invisible) vit dans `fighter.tags` : la prédiction
des joueurs rejoue donc **exactement** le même cerveau sur un clone.

### 11.3 Candidats

Sorts lançables × cases de lancer de `reach` (case actuelle seule si 0 PM — R24) × cibles : combattants visibles,
centres de zone touchant ≥ 1 combattant (R2), case du lanceur (portée 0), ≤ 6 cases libres (invocation, téléportation)
par heuristique. Filtres durs : `canCast(..., { fromCell })`, piège qu'il déclencherait en bougeant (R14),
`forbidSpells`, `hooks.filterCast`. `quickEstimate` analytique puis simulation. Si le meilleur `quickEstimate` est
< `minActionScore/2` sans candidat obligatoire, le pas s'arrête sans simulation. Départage : `castOrder`, priorités
Stump (invocation > buff > dégâts > soin > malus), moins de PM, RNG IA.

### 11.4 Score (PVe, différence avant/après simulation)

```
score = Σ_e wDmg·v(e)·min(ΔhpEff_e, hpEff_e)            + Σ_{e tués} wKill·(κ·PVmax_e + threat_e)
      + Σ_e wAP·min(ΔPA_e, PA_e^next)·apWorth_e         + Σ_e wMP·min(ΔPM_e, PM_e^next)·mpWorth_e
      + Σ états stateValue + Σ buffs buffValue + nextHitBonus
      + Σ_a wHeal·min(soin_a, manquants_a)·(1 + urgence_a)
      − Σ_a wFF·ΔPV_a − wAllyKill·[allié tué] − reflectAversion·renvoi − ∞·[lanceur tué]   (R7, R8)
      + positionDuringTurn·Δpos
```

| Poids | Valeur | Note |
|---|---|---|
| `wDmg`, `v(e)` | 1,0 ; invocation `summonValue` 0,5 (dégâts seulement, le bonus de kill reste entier) | INCERTAIN (monster-ai.md §4.1) |
| `wKill`, `κ` | 1,0 ; 0,5 | `threat_e` = `dpt` du joueur sur l'équipe des monstres |
| `wAP`, `wMP` | 0,8 ; 0,8 | `apWorth`, `mpWorth` comme §7 |
| `wHeal` | 0,9 | seuil 95 % (70 % pour soi, profil soigneur) |
| `wFF`, `wAllyKill` | 0,6 ; 1,0·PVmax | |
| `stateValue` Pacifiste / Insoignable | 0,9·threat de la cible si l'état couvre son prochain tour / 0,5·soins attendus | |
| `nextHitBonus` | `(mult − 1)·E[prochain coup d'un allié du monstre avant le tour de la cible]·0,5` | Plumière, Tirs optiques, Feinterception |
| `reflectAversion` | 0,2 × renvoi attendu | R8 |
| `minActionScore`, `positionDuringTurn` | 1 ; 0,25 | |

### 11.5 Fin de tour par comportement

`pos(c) = glyph(c) + behaviourTerm(c) − λ·danger(c)` (λ > 0 pour `fearful`/`kiter`), ne bouge pas si le gain < 5 PVe :
`aggressive` `−20·dist(c, focale) + 40·adjacents` (R1) ; `kiter` `−20·|dist − portée idéale| + 30·[aligné] +
15·[LdV] − 25·[CàC]` ; `fearful` `+15·distMin` après action offensive ; `devoted` `−20·dist(invocateur) + 10·distMin` ;
`blocker` `60·adjacents − 5·dist` ; `mad` comme `aggressive` sur tous ; `apathetic` `+10·distMin`. Focale = argmax de
la valeur d'attaque au prochain tour, sinon l'ennemi le plus proche ; `glyph(c)` = valeur des effets de la glyphe
pour ce monstre (R3).

### 11.6 Résolution du profil et archétypes

`fighter.tags.aiBehaviour` (effet 2188, bascule R12) → profil explicite par `monsterId` → archétype inféré des
`SpellProfile` (monster-ai.md §3 : `static`, `apathetic`, `summoner`, `healer`, `blocker`, `kiter`, sinon `aggressive`) ;
cache par `(monsterId, grade)`.

### 11.7 Profils et overrides de l'Œil de Vortex (`profiles/vortex.ts`, `overrides/vortex.ts`)

| Monstre | Comportement | Profil | Override / remarques |
|---|---|---|---|
| Auroraire 3833 | `static` | — | jamais appelée (0 PA/0 PM) ; obstacle qui bloque la LdV ; centre d'*En temps et en heure* et destination d'Heurage |
| Ikargn 3834 | `aggressive` | `openers: [{ spellId: 5015, minTargets: 1 }]`, `castOrder: [5015, 5016, 5017]` | `scoreCast` : si Attraction ailée touche ≥ 2 ennemis, bonus = valeur simulée du Cercle de feu qui suivra (seul vrai besoin de lookahead de la salle) |
| Méjaire 3836 | `kiter`, `preferredRange [1, 7]` | `stateValue: { 218: 'targetThreat' }`, `gapCloser: 5024` | Rayonirique sur le meilleur DPS aligné ≤ 3 ; Envolupté seulement si aucun ennemi n'est atteignable en ligne ≤ 7 |
| Harpille 3837 | `kiter`, `[1, 7]` | `alwaysCastWhenReady: [5021]` | Superfidie sur la cible dont les PM comptent le plus ; Tirs optiques sur la cible frappée ensuite |
| Buboxor 3838 | `aggressive` | `selfBuffWhenNoTarget: 5026`, `mpStealIsMobility: true` | Hoxor + `mpWorth(soi)` (PM volés pour rejoindre le contact ce tour) |
| Brabuzar 3839 | `aggressive` | `castOrder: [5032, 5030, 5033]` | Neutralisation : + isolement (Δ distance de la cible à ses soigneurs/protecteurs) ; poussées/collisions simulées (R6) |
| Vortex 3835 | phase 1 (état 236) : immobile (−100 PM) ; phase 2 : `kiter [1, 8]` | `hooks: vortexHooks` | ci-dessous |
| monstres corrompus (6611) | — | — | le moteur saute leur tour (`passTurn`) ; ils taclent et bloquent la LdV dans `reach`, `castCells` et `threat` |

`vortexHooks` (monster-ai.md §8.7) :
* `beforeTurn` : Heurage (5066) dès qu'il est lançable (phase 1 : buff d'heure à tous les monstres de vague ;
  phase 2 : téléportation au contact de l'Auroraire) ; *En temps et en heure* (5062, ciblé sur l'Auroraire) si au moins
  un ennemi est aligné avec elle (INCERTAIN : lancé même sans cible ?).
* `filterCast` : Contamination zombie (5064) seulement sur un Zombi (74) ayant ≥ 1 personnage à ≤ 2 cases.
* `scoreCast` : Heuristique (5068) `+ 0,9·threat(cible) + 0,5·valeur des buffs dissipés` ; Morfaille : la répétition
  différée est simulée par le moteur.
* `endPosition` (phase 2) : `+25 ×` personnages alignés à ≤ 8 + leurs PM.
* `threatOrigins` (pour la menace des joueurs) : en phase 2, cases adjacentes à la **future** case de l'Auroraire si
  Heurage sera prêt à son prochain tour.

### 11.8 Conformité aux règles officielles (monster-ai.md §1.2)

| Règles | Implémentation | Test |
|---|---|---|
| R1, R23 | `position.ts` : `+40·adjacents` (aggressive), `+60` (blocker) | M-R1 |
| R2, R24 | centres de zone sur toutes les cases de `reach` ; case actuelle seule si 0 PM | T3, T7 |
| R3 | valeur de glyphe en position ; pas d'invocation sur glyphe négative | M-R3 |
| R4, R5 | `computeReach` avec tacle exact ; ne bouge pas si le gain < coût | M-R4 |
| R6, R9, R10, R11, R18 | simulation sur clone (collisions, invulnérables + retrait d'état) ; replanification après chaque action (§11.2) | T5, M-R9, M-R10 |
| R7, R8 | −∞ si mort du lanceur ; `reflectAversion` | T9 |
| R12, R13 | `updateFearfulMode`, `tags.aiBehaviour` | T8 |
| R14 | filtre dur | M-R14 |
| R19, R20, R21 | `playTurn` après `startTurn` ; `average` + `critWeight` ; buff au plafond ⇒ Δ nul | M-R19, unitaire, M-R21 |
| R25 | budget fixe `play`, ≤ 12 actions, pas de recherche profonde | B3 + test d'équivalence |

Budget : un pas ≈ génération 150 µs + ≈ 5 simulations × 75 µs (les obligatoires sont rares) ; ≈ 3 lancers + un pas
d'arrêt (souvent sans simulation) + fin de tour ⇒ **≤ 1,8 ms par tour de monstre en moyenne** (`predict` ≈ 0,9 ms),
5 ms au pire.

---

## 12. Œil de Vortex : scénario et planificateur (`src/dungeons/vortex`, WP3)

### 12.1 Ce que fait le scénario (et ce qu'il ne fait pas)

Le moteur exécute les sorts du donjon : Vortexiphan 5006 (Auroraire, Marginal 236, résurrections 5003, 5008, *Action !*
5060), Glyphe téléporteur 5002 (glyphe 1165, heure de mort, corruption 6611), Décalage horaire 4996, 5009, Heurage
5065/5067, *En temps et en heure* 5061/5062… Le scénario (`scenario.ts`, `setup.ts`) n'ajoute que les règles
« serveur » absentes des données, en lisant ses paramètres dans `fight.scenarioState.vortex` (plat ; E2 le clone) :

| Règle serveur | Implémentation | Paramètre (défaut) | Variantes INCERTAINES échantillonnées |
|---|---|---|---|
| Carte, cases de départ | `setup.ts` : carte 143393281 ; joueurs sur les cases rouges choisies (§12.10) ; vague 1 sur les cases bleues 268-277 | `vortexCell` (case bleue de `vortex.json`) | — |
| Équipe qui commence | `onFightStart` réécrit `fight.timeline` | `startingTeamRule = 'average'` | `'best'` (règle actuelle du moteur), p 0,5 |
| Vagues | `onRoundStart` : spawn de N monstres (composition N = 4 de `vortex.json`) sur les cases bleues libres | `arrivalRounds = [1, 7, 12, 17, 22]` | `[1, 6, 11, 16, 21]`, p 0,3 |
| Invulnérabilité d'arrivée | état temporaire posé au spawn (1 tour) | `arrivalInvulnerableTurns = 1`, `wave1Invulnerable = false` | `true`, p 0,2 |
| Vague anticipée | — | `earlySpawnIfCleared = false` | `true`, p 0,1 |
| Résurrection | override des PV de 780 dans le hook | `rezHpPct = roll 20-30 %` | 50 %, p 0,25 ; `rezMinusOneMp` p 0,3 ; `rezAllPerTurn = false` p 0,1 |
| Horloge et joueur mort | défaut : rien (seuls les TB des vivants font avancer l'horloge) ; variante : le hook fait lancer 4996 à l'Auroraire au créneau du mort | `deadPlayerAdvancesClock = false` | `true`, p 0,2 |
| Déverrouillage | délai des données (5006, 25 tours) ; variante : le hook décale le déclencheur de ±1 | `unlockVortexTurn = 26` | 25 / 27, p 0,2 |
| *Action !* | délai après la dernière corruption | `actionDelay = 1` (DPLN) | 0 (lecture du client), p 0,4 |
| Déclenchement des glyphes | à l'entrée (1165) | `glyphTrigger = 'enter'` | `'turnEnd'`, p 0,1 |
| Grades, modificateurs de dimension | grades fixés ; modificateurs désactivés | `monsterGrade = bossGrade = 5`, `dimensionModifiers = []` | — |
| Fin de combat | `checkEnd` : victoire à la mort du Vortex, défaite si tous les personnages sont morts | `maxRounds = 60` | — |

Chaque graine tire une variante (défaut avec p 0,7 par paramètre indépendant, sinon la variante) par
`scenarioRng(fightSeed)` ; invariant vérifié au démarrage : la dernière vague arrive avant le déverrouillage
(`max(arrivalRounds) < unlockVortexTurn`), sinon la phase 2 pourrait partir trop tôt (monster-ai.md §7.2).

### 12.2 Modèle d'horloge (`clock.ts`, pur)

```ts
export const HOUR_STATE_BASE = 220, SAME_HOUR = 234, LATENT_DEATH = 233, MARGINAL = 236, ZOMBI = 74, CORRUPTED = 6611
export const AURORAIRE = 3833, VORTEX = 3835
export const HOUR_CELL = [0, 173, 176, 220, 292, 376, 444, 484, 481, 436, 365, 281, 212]      // index 1..12
export function currentHour(s: FightState): number                     // état 221..232 de l'Auroraire
export function deathHours(m: Fighter): number                         // masque 12 bits (lisible sur un mort)
export interface ClockSlot { round: number; index: number; fighterId: number; isPlayer: boolean; isVortex: boolean; hour: number }
/** Heures pendant chaque créneau à venir ; glyphs.get(i) = +k heures déclenchées pendant le créneau i. */
export function forecastHours(s: FightState, rounds: number, p: VortexParams, glyphs?: ReadonlyMap<number, number>): ClockSlot[]
/** Fenêtre d'étoile : du début du créneau joueur où l'horloge ARRIVE sur h au début du créneau joueur suivant. */
export function starWindows(slots: ClockSlot[], hoursMask: number): { from: number; to: number; hour: number }[]
export function lineCells(hour: number): Int16Array                    // croix (même x ou même y) de HOUR_CELL[hour]
```

Règles (vortex.md §5-§7) : +1 heure au début du tour de chaque **personnage vivant** (paramètre pour les morts), +1 par
glyphe de monstre déclenchée (immédiat, au milieu du tour) ; l'étoile est posée quand l'horloge **arrive** sur une
heure de mort d'un monstre **vivant** non corrompu et retirée au décalage suivant ; résurrection de tous les morts au
début du tour du Vortex ; vagues selon `arrivalRounds`. Une fenêtre couvre le tour du joueur, de ses invocations et
des monstres intercalés (un poison ou un piège qui tue dans la fenêtre corrompt aussi). L'heure d'une mort **simulée**
est toujours lue dans les états de la victime, jamais supposée (une glyphe a pu changer l'heure pendant le tour).
À 4 joueurs en tête (P1 M1 P2 M2 P3 M3 P4 V, k = 4), sans glyphe : P1 voit I/V/IX, P2 II/VI/X, P3 III/VII/XI, P4 et le
Vortex IV/VIII/XII ; si les monstres commencent, k = 3. Auto-contrôle : à chaque tour, heure prédite = heure lue, sinon
le plan est invalidé (log `warn`).

### 12.3 Suivi et modèle abstrait (`tracker.ts`, `abstract.ts`)

```ts
export interface MonsterTrack { fighterId: number; monsterId: number; wave: number
  status: 'pending' | 'invulnerable' | 'alive' | 'dead' | 'corrupt'; hp: number; maxHp: number
  hours: number /* masque 12 bits */; star: boolean; arrivesRound?: number; threat: number }
export interface AbsState { slotIdx: number; hour: number; glyphShift: number; round: number; vortexTurns: number
  monsters: AbsMonster[] /* ≤ 24, copie paresseuse */; hoursUsed: number /* heures distinctes posées */
  score: number; trace: PlanStep | null }
export type AbsAction = { t: 'none' } | { t: 'glyph'; count: 1 | 2 }
  | { t: 'kill'; m: number[]; glyph: 'none' | 'before' | 'after' }                 // 1 ou 2 morts
  | { t: 'damage'; m: number; amount: number; glyph: 'none' | 'before' | 'after' } // plafonné à PV − 1
```

Le tracker **observe** le moteur (états, `deaths`, `scenarioState.vortex`) ; seul le planificateur **prévoit**.
Transitions : créneau joueur `p` à l'heure `h` : `kill(m)` faisable si `E_p(m) ≥ PV_m` (oracle §12.6, zone si groupés),
`m → dead`, `hours ∪= {h}` sauf si `star` (alors « corrompu au réveil ») ; `damage` plafonné à `PV − 1` ; `glyph` :
heure +k (disponibilité 0,6 pour un créneau futur, lue par le tracker pour le créneau courant). Début de créneau joueur :
heure +1, étoiles recalculées. Créneau monstre : coût d'exposition `w_exp·threat_m` si `m` vivant (invulnérable
compris : il joue). Créneau du Vortex : résurrection (`rezHpPct·PVmax`, ×1,3 si XI), corruption si tué sous étoile.
Fin de tour de jeu : vagues `pending → invulnerable → alive`.

### 12.4 Coût des heures (`hourCost.ts`, calculé une fois par combat, ≤ 2 ms)

* `C_mon(m, h)` (vie de zombie) = `ΔThreat_m(h)·E[tours monstre avant corruption] + 0,25·ΔEHP_m(h)` ;
* `C_vx(h)` (phase 2, payé **une fois**, à la première utilisation de h) = `ΔThreat_V(h)·T2 + 0,5·ΔEHP_V(h)`, `T2` = 2
  tours du Vortex attendus en phase 2.

`ΔThreat` et `ΔEHP` sont **mesurés** : clone du monstre (ou du Vortex au grade du combat, PA/PM de phase 2), ajout du
buff d'heure par le sort de données (5002/5009), recalcul `dpt` contre l'équipe réelle et des PV effectifs contre ses
éléments. Table de repli (PVe, mode `fast` sans calcul et tests) :

| Heure | I | II | III | IV | V | VI | VII | VIII | IX | X | XI | XII |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bonus | +10 % CC, +200 do crit | Intaclable | +400 Int | +2 PM | ×70 % subis (Vortex ×75 %) | +400 Cha | +150 rés. crit | +4 PA | +400 For | Inébranlable | +30 % Vita | +400 Agi |
| `C_mon` | 400 | 100 | 500* | 400 | 600 | 500* | 0 | 1 200 | 500* | 50 (300 avec un placeur) | 300 | 500* |
| `C_vx` | 1 500 | 100 | 1 200 | 1 000 | 4 000 | 600 | 0 | 2 500 | 400 | 100 | 5 000 | 1 200 |

\* 100 si le monstre n'a pas de sort de l'élément boosté. Test T-hours : V et XI parmi les 3 heures les plus chères pour
le Vortex, VII la moins chère, II et X sous 300.

### 12.5 `HourPlanner` (`planner.ts`)

```ts
export interface PlannerConfig { beamWidth: number; horizonPlayerSlots: number; rootDiversity: number
  maxKillsPerSlot: 1 | 2; wExposure: number; corruptBonus: number; failCost: number; glyphCost: number
  unreachableHourCost: number; maxAliveFactor: number; overloadCost: number; hourCostScale: number }
// fast : 4, 8, 1, 1 ; standard : 16, 12, 2, 2 ; deep : 48, 20, 3, 2 — puis 1,0 · 1 500 · 800 · 120 · 2 000 · 2 · 400 · 1,0

function planHours(root: AbsState, slots: ClockSlot[], cfg: PlannerConfig): ScenarioPlan {
  let beam = [root]
  for (const slot of horizon(slots, root.slotIdx, cfg)) {
    const next: AbsState[] = []
    for (const node of beam) {
      if (!slot.isPlayer) { next.push(monsterSlot(node, slot, cfg)); continue }   // exposition, rez, vagues, étoiles
      for (const a of slotActions(node, slot, cfg)) {                             // ≤ 14 après élagage
        const child = applyAbs(node, slot, a); child.score = node.score + reward(node, child, a, cfg); next.push(child)
      }
    }
    beam = selectBeam(dedupe(next, absHash), cfg)                                 // top-K avec diversité de racine
  }
  for (const n of beam) n.score -= terminalCost(n, slots, cfg)
  return extractPlan(beam, cfg)                                                   // meilleur + 4 alternatives distinctes
}
```

`reward` : `+corruptBonus` par kill sous étoile ; `−C_mon(m, h) − [h ∉ hoursUsed]·C_vx(h)` par nouvelle heure posée ;
`−(1 − pKill)·failCost` par kill tenté ; `−glyphCost + bonus du poseur` par glyphe (Harpille +200 Puissance : +150 ;
Méjaire soin 10 % : +200 si blessé ; Buboxor ×50 % : +100 ; Ikargn +1 PM : +50 ; Brabuzar : +30) ;
`−unreachableHourCost` si `m` est marqué à une heure qu'aucun tueur vivant ne reverra dans les 3 tours sans glyphe ;
`−overloadCost·(vivants − maxAliveFactor·N)` par créneau en surnombre. `monsterSlot` : `−wExposure·threat_m` par
monstre vivant qui joue. `terminalCost` : pour chaque monstre non corrompu, exposition jusqu'à sa première fenêtre
d'étoile accessible + coût minimal d'heure (borne optimiste qui empêche de repousser le travail hors horizon).

Élagage de `slotActions` : ≤ 2 morts par créneau ; jamais un monstre `dead`/`corrupt` ; kill à une heure de
`C_vx > 1 000` généré seulement si aucune autre heure n'est accessible dans l'horizon ; pré-dégâts seulement sur les 3
cibles de contrat les plus précieuses ; aucun contrat de kill pour un `mpLock`/`apLock` à faible `dpt` (§9.2).
Déduplication par `hash(statuts, masques d'heures, étoiles, PV par paliers de 500, glyphShift mod 12)`. Coût
`standard` ≈ 12 créneaux × 16 nœuds × 14 actions ≈ 2 700 expansions × 2 µs ≈ 6 ms (+ relances forcées du
`SearchPricer` ≈ 4 ms) ; `fast` ≈ 0,3 ms, mis en cache entre événements symboliques ; `deep` ≈ 40 ms.

Sortie :

```ts
export interface ScenarioPlan { version: number; steps: PlanStep[]; alternatives: PlanStep[][]
  contracts: { m: number; round: number; index: number; killer: number; kind: 'mark' | 'corrupt'; hour: number; pKill: number }[]
  forbid: { m: number; untilRound: number; reason: 'badHour' | 'noFollowUp' | 'waveSync' }[]
  glyphs: { round: number; index: number; count: 1 | 2; when: 'beforeKills' | 'afterKills' }[]
  bands: { m: number; beforeKiller: number; hpMin: number; hpMax: number }[]
  rootScores: Map<string, number>; etaAllCorrupted: number }
```

### 12.6 Oracle de kill et calibration en ligne

`E_i(m)` = dégâts attendus du joueur i sur m pendant un créneau = `dpt(i, m)·ρ_i(m)·c_i` ; `ρ` = 1 si une case de
lancer est accessible maintenant, 0,85 pour un créneau futur ; `c_i` = moyenne mobile (α = 0,2) du rapport dégâts
réalisés / prévus du joueur i dans ce combat ; `pKill = Φ((E − PV)/(0,15·E))`. La calibration corrige au fil du combat
les erreurs du modèle abstrait (portée, LdV, monstres qui fuient).

### 12.7 Du plan aux prix (`pricer.ts`)

`SearchPricer` : §9.6. `HeuristicPricer` (mode `fast`, constantes de la proposition « fidélité ») :

```
kill[m][0] (sous étoile, corruption)  = max(θ.corruptKill (4 000), corruptBonus + threat_m · tours évités avant la corruption prévue)
kill[m][h] (neuf, contrat ou fenêtre de re-kill vue par un tueur vivant) = θ.plannedFirstKill (2 500) − C_mon(m,h)·E[réveils]
                                        − [h nouvelle]·C_vx(h)
kill[m][h] (neuf, sans fenêtre de re-kill)  = −(θ.unplannedKillBase (1 500) + C_mon(m,h) + [h nouvelle]·C_vx(h))
kill[m][h] (déjà marqué, heure de plus) = 0,3·exposition évitée − C_mon(m,h) − [h nouvelle]·C_vx(h)
hp[m]  = { slope: 0,3 ; 0,7 jusqu'au palier si un contrat existe et que le tueur joue plus tard ;
           floor = μ(coup max d'un allié) + 2σ + DoT en attente ; slope 0 sous floor ;
           band [1 ; 0,8·E_tueur(m)] avant le créneau du tueur, bandBonus = 0,5·prix du contrat }
clock[k] = score du plan avec forecast décalé de +k − score à 0 − k·150 (détour), borné à ±2 000
cell[c]  = −extraIncoming(c) au créneau du Vortex − 300 sur 484 si l'horloge arrive sur VII avant mon prochain tour
           − 300 sur 292 si elle arrive sur IV (échange vers III, non marchable — INCERTAIN)
```

`extraIncoming(a, c)` (Auroraire, à partir du 2e tour du Vortex) : si `c ∈ lineCells(heure au créneau du Vortex)` et
que `a` ne rejoue pas avant : `expectedDamage(500 Terre, Auroraire sans caractéristiques, résistances de a) + 0,5·PV
érodés`, plus l'érosion +20 % sur 2 tours valorisée à `0,2 ×` dégâts attendus des 2 tours suivants ; en phase 2 :
Heuristique (ligne 1-8 sans LdV depuis la case prévue du Vortex, Heurage compris), Morfaille via la menace générique.
`allyDeathExtra` : la mort change le pas de l'horloge (N − 1) ⇒ coût = écart de score du plan recalculé.

### 12.8 Tempo des vagues

Aucun objectif de vitesse : l'exposition fait préférer « marquer tôt, corrompre 3 tours plus tard » et le plancher de
déverrouillage (~26e tour) rend inutile toute précipitation. Cycle par vague à 4 joueurs : arrivée = contrôle et
placement ; +1/+2 = pré-dégâts et marquages ; +4/+5 = corruptions. Garde-fou de submersion : `maxAlive = 2N`.

### 12.9 Transition et burst de phase 2 (`burst.ts`)

À *Action !*, tout le monde retourne à sa case de départ, les monstres meurent, le Vortex reçoit un bonus par heure
distincte, reste invulnérable et passe un tour ; il joue ensuite avec 16 PA / 5 PM, Heurage (téléportation au contact
de l'Auroraire, relance 3), Heuristique (ligne 1-8 sans LdV, 3×/tour, Pacifiste désenvoûtable), Morfaille.

```ts
export interface BurstPlan { vulnerableFrom: { round: number; index: number }; prepSlots: { round: number; index: number }[]
  steps: { fighterId: number; intents: Intent[] }[]; reserve: { fighterId: number; spellId: number }[]
  safeCells(round: number, index: number): Uint8Array; pKill: number }
```

1. **Prévoir le Vortex** : caractéristiques = grade + bonus des heures distinctes (connues exactement) ; case = case
   de départ, puis contact de l'Auroraire (Heurage) ⇒ `safeCells` (hors ligne 8 PO du Vortex, hors croix de l'Auroraire).
2. **Options par joueur** : 5 meilleures rotations contre le Vortex, buffs dont la durée couvre le créneau de burst
   (Âge d'Or, Puissance, Ruée vers l'Or…), débuffs (résistances, dommages subis), retrait de PM (esquive 20).
3. **Programmation dynamique** dans l'ordre de la timeline sur (créneau, buffs actifs, sorts réservés), faisceau 32 :
   maximise `P(Σ dégâts ≥ PV_V)` (approximation normale, μ et σ² DoMath) sous contrainte de sécurité (case finale ∈
   `safeCells` si le burst échoue) ; plan B : retrait de PM, dissipation de Pacifiste, sortie de ligne, burst au tour
   suivant si `pKill < 0,6`.
4. **Prix** : pendant le burst `kill[V] = θ.vortexKill` (20 000) et `hp[V].slope = 1 + ∂pKill/∂dégâts · 20 000`
   (normalisée) ; pendant la préparation, intentions `setup`, `reserve`, `position`, `control(V)` valorisées par
   `ΔpKill · 20 000`. Le premier tour vulnérable est une décision clé (`burst`, MCTS en `deep`).

### 12.10 Placement initial (`placement.ts`)

Énumération des affectations des 4 personnages à 4 des 12 cases rouges (11 880). Score analytique (≈ 5 µs chacune) :
exposition au tour 1 (portées des monstres depuis les cases bleues, lignes de Méjaire), croix de l'Auroraire au premier
créneau du Vortex (IV si k = 4 : éviter 427 et 440 ; III si k = 3), case 484 (échange forcé à VII), **position de
phase 2** (*Action !* ramène chacun à sa case : distance et lignes vers la case de départ du Vortex, accès au burst),
préférences de rôle (tank devant, tueurs à portée). Les 200 meilleures sont re-notées avec la menace complète, les 8
meilleures jouées sur 16 graines du micro-scénario `prefix12` (`fast`) ; l'indice retenu (top-8) devient un paramètre
de θ. Combat générique : même méthode sur les cases de départ de la carte, sans les termes Vortex.

### 12.11 Micro-scénarios (`micro.ts`)

`prefix12` (tours 1-12 : vague 1, vague 2, arrivée de la vague 3 ; ≈ 0,3 s en `fast`) produit une note de progression
(corrompus/apparus, morts, PV) convertie en P(victoire) par une régression logistique calibrée sur ≈ 2 000 combats
complets (recalibrée à chaque version). `phase2` (≈ 0,05 s) : Vortex vulnérable, bonus d'heures tirés selon la
distribution observée, joueurs sur leurs cases avec les buffs de préparation ⇒ P(Vortex tué), tours, morts. `poutch`
(≈ 0,02 s) : 3 tours contre un mannequin aux résistances du mix Vortex (calibration DPT, §6.4).

### 12.12 Déroulé attendu (illustration)

P1 Enutrof (`mpLock`), P2 Iop et P3 Crâ (`killer`), P4 Pandawa (`placer`), k = 4. Seules VII (P3) et X/II (P2) sont
« gratuites » pour des tueurs (`C_vx` ≤ 100) : le plan converge vers des marquages à VII et X. Tour 1 : P1 retire les PM
de l'Ikargn et de la Harpille (kills à I au prix négatif), P2/P3 pré-dégâts, P4 éloigne la Méjaire. Tour 2 : P3
**marque** Méjaire et Harpille à VII ; P1 ne tue pas à V. Tour 3 : P2 marque l'Ikargn à X. Tours 5 et 6 : P3 puis P2
**corrompent** sous l'étoile. Si P3 meurt au tour 4, le plan est recalculé (P4 voit VII au tour 5 avec le paramètre par
défaut ; paliers de PV pour P1/P2). Le Vortex n'hérite que de VII et X : la stratégie « même tueur, heures
confortables » des guides est retrouvée par calcul.

---

## 13. Aléa, graines et déterminisme

### 13.1 Flux

| Flux | Source | Usage |
|---|---|---|
| Dés du combat réel | `fight.rngState` (mulberry32) = `fightSeed` ; re-semé à chaque début de tour si E1 : `mix32(mix32(fightSeed, round), fighterId)` | dégâts, CC, esquives PA/PM, groupes aléatoires, PV de résurrection |
| Simulations de l'IA | `rngState` du clone = `mix32(aiSeed ^ 0x5bd1e995, sel)` (§6.1) | groupes aléatoires dans les clones ; jamais l'état réel |
| Décisions IA | `Rng(aiSeed(fightSeed, fighterId, round, k))` (sfc32, `core/rng.ts`) | départages, bruit monstre, exploration ε, dés des itérations MCTS |
| Variante de scénario | `Rng(mix32(fightSeed, 0x5C))` | paramètres INCERTAINS (§12.1) |
| Campagne | `fightSeed(i) = mix32(masterSeed, i)` | toutes les configurations comparées utilisent les **mêmes** graines (CRN) |

`mix32(a, b)` = splitmix32 de `a ^ imul(b, 0x9e3779b9)` ; `aiSeed(f, id, r, k) = mix32(mix32(f ^ 0xa1a1a1a1, id), (r << 8) | k)`.

### 13.2 Propriétés exigées (tests §16.5) et règles de codage

(1) **Reproductibilité** : `(spec, fightSeed, versions moteur/données/IA)` ⇒ combat identique (hash des événements hors
`log`/`aiNote`), `record` vrai ou faux, 1 ou 4 workers, Node ou navigateur ; (2) la réflexion n'avance jamais
`fight.rngState` du vrai combat ; (3) l'IA ne lit jamais `fight.events` ni les pièges invisibles adverses ; (4) les lots
ne stockent que des résumés, un combat choisi est rejoué avec `record: true`. Règles : budgets en **nœuds** ; aucun
`Date.now()`/`Math.random()` dans une décision ; itération sur des tableaux ou des `Map` à ordre d'insertion
déterministe ; départages par clé stable (`MacroAction.key`, hash d'état) ; Φ, softmax et exponentielles des décisions
par approximations rationnelles (les arrondis de `Math.exp/log/pow` peuvent différer entre moteurs JavaScript).

---

## 14. Budgets de calcul

### 14.1 Coûts unitaires visés (1 cœur, Node 22)

| Opération | Cible | Remarque |
|---|---|---|
| `cloneFight` (≈ 12-20 combattants) | ≤ 12 µs | mesuré 7-10 µs sans interprètes ; E2 retire `structuredClone` |
| nœud tactique (clone + chemin + sort + effets réels) | ≤ 70 µs | **hypothèse à mesurer en premier** (B1) |
| `V(s)` (menace incrémentale + DPT en cache + prix) | ≤ 30 µs | B2 |
| tour de monstre `play` / `predict` | ≤ 1,8 ms / ≤ 0,9 ms (moyenne) | B3 |
| tour de joueur `fast` / `standard` | ≤ 3,5 ms / ≤ 120 ms (moyenne) | B4 |
| `HourPlanner` `fast` (caché) / `standard` / `deep` | ≤ 0,3 / ≤ 10 / ≤ 40 ms | B7 |

### 14.2 Par combat Vortex (4 joueurs, ≈ 35 tours de jeu, ≈ 140 tours de joueurs, ≈ 175 tours de monstres actifs)

| Mode | Joueurs | Planificateur | Monstres (`play`) | Moteur | **Total visé** |
|---|---|---|---|---|---|
| `scripted` | 140 × 0,05 ms | — | 175 × 1,8 ms | 0,05 s | ≈ 0,35 s |
| `fast` | 140 × 3,5 ms = 0,49 s | ≈ 0,02 s | 0,32 s | 0,05 s | **≈ 0,9 s (< 1 s)** |
| `standard` | 140 × 120 ms = 16,8 s (+ 12 décisions clés × 0,25 s) | 140 × 10 ms = 1,4 s | 0,32 s | 0,05 s | **≈ 22 s (< 30 s)** |
| `deep` | 140 × 1 s + 30 MCTS × 1,5 s | 140 × 40 ms | 0,32 s | — | ≈ 3 min |

Leviers si B1 dépasse 70 µs, dans cet ordre : `topK` 12 → 9 et rollouts 3 → 2 en `standard` (la cible de 30 s tient
jusqu'à ≈ 120 µs/nœud) ; `fast` : `topK` 6 → 4, cases de lancer 3 → 2 (variante `turbo` ≈ 0,6 s) ; cache de `V` par
hash ; en dernier recours, journal d'annulation (make/unmake) au lieu du clonage. Mémoire : un faisceau `standard` garde
≤ 600 clones (≈ 3-6 Mo), seuls les nœuds du faisceau courant restent référencés.

**Débit sur 4 cœurs** : `fast` ≈ 4,5 combats/s ≈ **16 000-17 000 combats/h** ; `scripted` ≈ 11 combats/s ; micro-scénario `phase2` ≈ 80/s ;
`standard` ≈ 0,18 combat/s ≈ 650/h. Un million de combats complets `fast` ≈ 62 h (≈ 25 h en `scripted`).

---

## 15. La boucle d'itérations (`src/optimizer`, WP4)

### 15.1 Niveaux

| Niveau | Question | Méthode | Coût |
|---|---|---|---|
| L0 | meilleur tour | `TurnSearch` (§8) | nœuds |
| L1 | cette configuration gagne-t-elle ? | Monte-Carlo sur graines × variantes, CRN, arrêt séquentiel | combats |
| L2 | meilleurs paramètres θ | criblage de sensibilité → CEM (espace log) → distillation `fast` ← `standard` | ≈ 3 000-6 000 combats `fast` |
| L3 | meilleur stuff par personnage | proxy analytique + recuit, puis validation L1 | 5·10⁴ stuffs notés, ≈ 500 combats |
| L4 | meilleures variantes de sorts | presets par rôle + bascules ciblées appariées | ≈ 200 combats/personnage |
| L5 | meilleure équipe (19 classes) | T0 analytique → *successive halving* (T1 micro, T2 `fast`) → co-optimisation L2-L4 → validation `standard` | ≈ 1 h 20 sur 4 cœurs |
| L\* | une ligne gagnante pour **cette** graine | rembobinage stratégique | démo uniquement |

« Faire le maximum d'itérations » se lit donc à trois échelles : beaucoup de **nœuds** par tour (L0), beaucoup de
**combats** par configuration (L1, `fast`/`scripted` sur 4 workers), beaucoup de **configurations** (L2-L5, filtrées
par des modèles de plus en plus chers : T0 µs → T1 0,05-0,3 s → T2 0,9 s → T3 22 s).

### 15.2 Monte-Carlo (L1, `montecarlo.ts`, `stats.ts`)

* `runBatch(spec, seeds, pool, stop)` répartit les graines par paquets de 8 ; résultats rangés **par graine**
  (indépendants de l'ordonnancement et du nombre de workers).
* Score d'un combat : `score = win ? 1 + 0,1·hpLeftPct − rounds/600 : 0,8·progress`, avec
  `progress = 0,45·corrompus/total + 0,15·[déverrouillé] + 0,30·dégâts au Vortex/PV + 0,10·vivants/N` (utile tant que le
  taux de victoire est nul). Classement : borne basse de Wilson à 95 % si au moins une victoire, sinon score moyen.
* Arrêt séquentiel : `StopRule = { minN: 32, maxN, halfWidth: 0,03 }` ; comparaison **appariée** sur les mêmes graines
  (différence de victoires + différence de score) : arrêt dès que `|moyenne| > 2,5 × erreur type` ou à `maxN`.
* `failReason` regroupé (mort sur la croix de l'Auroraire, Pacifiste de Méjaire, submersion, vague non corrompue au
  tour 26, burst raté, limite de tours) ; résultats par variante INCERTAINE et pire variante.
* Cache (`cache.ts`) : clé = (versions moteur/données/IA, scénario + paramètres, équipe, θ, mode, graine) →
  `FightSummary` en JSONL dans `runs/<campagne>.jsonl` ; une campagne interrompue reprend sans rejouer les graines
  faites ; un changement de version invalide tout.

### 15.3 Paramètres de stratégie θ (L2, `tune.ts`, `distill.ts`)

θ = poids de `V` (§7), configuration du planificateur et des prix (§12), priors des tactiques, β, seuils (`emergency`,
`burst.minCommit`), indice de placement. Procédure : (1) **criblage** ±50 % un paramètre à la fois, 64 graines CRN,
`fast` ⇒ 8-12 paramètres sensibles ; (2) **CEM** en espace log : population 12, élite 3, lissage 0,7, 8-15
générations, 16-24 graines CRN **renouvelées à chaque génération**, premières générations sur `prefix12` ; (3)
validation sur 200 graines neuves, test apparié contre θ₀, rejet sinon. Un θ global (`data/ai/theta-default.json`) est
réglé sur un panel de 12 équipes ; chaque composition finaliste part de ce θ. **Distillation** : on journalise
(racine, candidats, plan choisi) de 200 combats `standard` et on règle les poids de `fast` pour maximiser l'accord
de classement (perte logistique par paires, CEM) ; le Monte-Carlo rapide devient représentatif de l'IA lente. Les
monstres ne sont jamais réglés.

### 15.4 Stuff, exos, points (L3, `stuff/*`)

1. **Viviers** par emplacement : `itemsBySlot(slot, { minLevel: 180, maxLevel: 200 })`, conditions satisfiables,
   projection sur les caractéristiques utiles au rôle, filtre de Pareto (20-60 objets) ; objets de panoplie gardés à
   part (la dominance ne voit pas les bonus) ; Dofus/trophées/prysmaradite restreints à une liste blanche de passifs
   supportés (`isSpellSupported` sur les sorts 1175).
2. **Graines** : stuffs méta d'equipment.md §12 adaptés à la classe.
3. **Proxy** (`proxy.ts`, contexte Vortex) : `J = DPT^a · EHP^b · (1 + c·UTIL) × pénalités`, `DPT` = rotation du rôle
   (sac à dos `DptTable` sur le mix de cibles : monstres de vague pondérés par leur nombre à 4 joueurs — Ikargn 3,
   Méjaire 4, Harpille 4, Buboxor 3, Brabuzar 5 — et Vortex 0,3 × 19), `EHP = PV/(1 − rés. % pondérées par les éléments
   reçus)`, `UTIL` = retrait PM/PA espéré, soins/tour ; exposants (a, b, c) : killer/zoneDps 0,7/0,3/0 ; tank
   0,2/0,8/0,2 ; mpLock/apLock 0,3/0,4/1 ; healer 0,2/0,5/1 ; pénalités : −15 % par PA sous 12, −10 % par PM sous 6, PO
   insuffisante pour la rotation, build invalide ⇒ −∞ ; bonus d'initiative si l'équipe vise k = 4 (§12.2).
4. **Recherche** : montée par coordonnées (30 meilleurs objets par emplacement) puis recuit simulé (20 000 itérations ;
   mouvements « changer un objet », « poser/retirer un bloc de panoplie », « déplacer l'exo PA/PM/PO », « échanger un
   Dofus ») ; évaluation incrémentale `fastStats` (≈ 2 µs) puis `computeBuildStats` sur les 50 meilleurs.
5. **Forgemagie** (`exos.ts`) : profils `thlStandard`/`thlOptimized` (equipment.md §11.3) ; **un seul** exo PA, PM et
   PO par personnage, plafonds 12/6/6 respectés (pas d'exo inutile) ; transcendances « Ta Do Per So » sur ≤ 6 objets.
6. **Points** (`points.ts`) : deux répartitions (`allocateAll` tout dans l'élément ; 300 élément + reste Vitalité) +
   parchemins.
7. **Validation** : 5 builds diversifiés (front de Pareto DPT/EHP/UTIL) par membre, comparés dans l'équipe finaliste
   (T1 `prefix12` + `phase2`, CRN, 32 graines). Coût ≈ 2 s de proxy par (classe, rôle), mis en cache.

### 15.5 Variantes de sorts (L4, `variants.ts`)

Départ : table « choix de variantes par rôle » de la fiche de classe (preset). Bascules candidates : paires dont un sort
n'a jamais été lancé en 64 combats (`FightSummary.spellUse`), paires citées par la doctrine du rôle, paires qui
débloquent une tactique (`requires`) ; seules les paires dont les deux sorts sont supportés. Évaluation appariée `fast`
(16-32 graines), acceptation gloutonne si gain significatif, ≤ 6 bascules par personnage.

### 15.6 Composition (L5, `team/*`)

1. **Presets** (`data/ai/presets.json`, issus des fiches de classe) : 2-4 par classe (≈ 57), chacun avec rôle,
   élément, variantes des 22 paires, rotation `scripted`, stuff de départ (ex. `enutrof_retrait_pm_eau`,
   `pandawa_placement`, `cra_feu_zone`, `iop_multi_zone`, `eniripsa_soin_feu`, `xelor_zone_feu_air`).
2. **T0** (`t0model.ts`, ≈ 0,2 ms/équipe) sur tous les multiensembles de 4 presets (≤ 2 fois la même classe) :
   `C(60, 4) ≈ 4,9·10⁵` équipes. Modèle abstrait du Vortex : stuffs du proxy, `dpt` vs le mix, horloge prévue (k selon
   l'initiative), `HourPlanner` en simulation abstraite sur 26 tours (capacité de kill par créneau, attrition = Σ menaces
   × facteur de contrôle − soins), phase 2 abstraite (tours pour tuer le Vortex contre dégâts reçus) ⇒ P(victoire)
   estimée + contraintes de couverture (≥ 2 tueurs capables de corrompre seuls un zombie, ≥ 1 contrôle ou placeur,
   coût du poison sans soin) + matrice de synergies des fiches. ≈ 100 s sur 1 cœur, ≈ 25 s sur 4.
3. **Successive halving** (`fast`, CRN, variantes échantillonnées) : top 400 → T1 (`prefix12` + `phase2`, 16 graines,
   ≈ 9 min) → 40 → T2 (combat complet, 64 graines, ≈ 9 min) → 4. **Diversité** : au moins une équipe par archétype
   (avec/sans soigneur, avec/sans placeur) parmi les 40 de T2.
4. **Co-optimisation** des 4 finalistes : L3 → L4 → L2 puis une seconde passe L3 → L4 (≈ 14 min par équipe).
5. **Validation** `standard` : 4 équipes × 24 graines × variantes (≈ 9 min) ; rapport et replays de la gagnante.
6. Option `evolve` (mutation d'un membre, croisement de stuffs) pour explorer hors du top T0.

### 15.7 Workers (`pool/*`)

```ts
export interface WorkerPool { size: number; run(tasks: WorkerTask[]): AsyncIterable<WorkerResult>; close(): Promise<void> }
export interface WorkerTask { taskId: number; spec: FightSpec; seeds: number[]; kind: 'full' | MicroId | 't0'; record: false }
export interface WorkerResult { taskId: number; summaries: FightSummary[] }
export function createNodePool(size = Math.min(4, os.availableParallelism())): WorkerPool   // worker_threads
export function createBrowserPool(size = navigator.hardwareConcurrency - 1, bundle: DataBundle): WorkerPool
```

Chaque worker charge **une fois** les données (`loadDataStore` en Node ; `MemoryDataStore` transféré dans le
navigateur), installe les familles d'effets et garde ses caches (cartes, anneaux de portée, `SpellProfile`) entre
tâches. En développement : `new Worker(url, { execArgv: ['--import', 'tsx'] })`. Messages JSON compacts ; vol de
travail ; agrégation triée par graine. Navigateur : mêmes messages via Web Workers, modes `scripted`/`fast`/`standard`
(le `standard` joue la démo en arrière-plan ; le visualiseur lit le replay une fois prêt), annulation par `taskId`.

### 15.8 Rembobinage stratégique (L\*, `rewind.ts`)

Pour une graine fixée : point de contrôle (`cloneFight` + `TeamBrain.snapshot()`) au début de chaque tour de jeu ; si le
combat est perdu, retour 1, 2 puis 3 tours avant l'échec (mort d'un allié, retard irrattrapable, burst raté) et reprise
avec une alternative non essayée : `plannerAlt` (alternative n° k du `ScenarioPlan`), `burstAlt`, `thetaJitter` (±20 %),
`placementAlt` (tour 1) ; ≤ 40 reprises en `standard` (5-10 min). Avec E1, les dés restent identiques par (tour,
combattant). Deux sorties : « même dés » (existence d'une ligne gagnante, alimente le replay) et « robuste » (au point de
contrôle, l'alternative qui maximise le taux de victoire sur 16 graines). Toujours marqué **optimiste** ; jamais compté
dans un taux de victoire.

### 15.9 Rapport et CLI

`report.ts` : équipe, rôles, stuffs (objets, jets, exos, transcendances, points), variantes, θ, taux de victoire
(robuste, par variante, IC de Wilson), tours, morts, heures utilisées et bonus hérités par le Vortex, frise des
corruptions par heure et par tueur, usage des tactiques, coups créatifs, causes d'échec, trois replays (victoire
médiane, meilleure victoire, échec typique) rejoués avec `record: true` et annotés.

```
npm run sim -- fight vortex --team iop:killer,cra:killer,enutrof:mpLock,pandawa:placer --ai standard --seed 42 --replay out/r.json
npm run sim -- batch vortex --team ... --ai fast --runs 500 --robust
npm run sim -- optimize vortex --stages t0,halving,coopt,validate        # campagne complète ≈ 1 h 20 sur 4 cœurs
```

---

## 16. Tests et validation

### 16.1 Tests unitaires du socle (`tests/ai-core-*.test.ts`, WP1)

| Id | Objet | Critère |
|---|---|---|
| T-reach | `computeReach` vs `move` réel | PA/PM restants identiques sur 500 cas aléatoires (tacle compris) |
| T-cand | générateur | tout candidat passe `canCast` ; couverture 100 % des (sort, cible) atteignables trouvés par force brute sur 50 positions |
| T-prefilter | `quick` | meilleur enfant simulé dans le top-K du préfiltre ≥ 95 % (corpus de 500 nœuds) |
| T-dpt | `DptTable` | ≤ 5 % d'écart avec 3 tours simulés `average` (Crâ, Iop, Sacrieur, Enutrof) |
| T-threat | `ThreatModel` | corrélation ≥ 0,8 avec les dégâts subis en rollout ; cible prédite = cible du `MonsterBrain` ≥ 85 % |
| T-kill | `killProbability`, split léthal | ≤ 3 points (analytique) et ≤ 7 points (split) d'écart avec 10⁴ tirages `random` |
| T-eval | `V` | monotonie (dégâts ennemis ↑ ⇒ V ↑, dégâts alliés ↑ ⇒ V ↓) ; invariance par permutation des ids |
| T-hash | transpositions | A puis B ≡ B puis A quand indépendants ; aucune collision sur 10⁶ états du corpus |
| T-parity | `advanceUntil` | même séquence de tours que `runFight` sur 20 combats |

### 16.2 Monstres (`tests/ai-monster-*.test.ts`, WP1)

Golden tests T1-T10 de monster-ai.md §8.10 (Buboxor bouclier puis avance, Méjaire Pacifiste sur le Iop, Ikargn
Attraction → Cercle → Terre mythe, Petit poison, collision du Brabuzar, Vortex phase 1/2, peureux R12, renvoi R7,
corrompu passif qui tacle) + une ligne par règle M-R du §11.8 ; équivalence `play`/`reference` ≥ 97 % et
`predict`/`play` ≥ 90 % sur 1 000 situations tirées ; déterminisme des départages.

### 16.3 Vortex et planificateur (`tests/vortex-*.test.ts`, WP3)

* **T-clock** : `forecastHours` = heure de l'Auroraire du moteur à chaque créneau sur 30 tours du scénario réel (k = 3
  et 4 ; 0, 1 et 2 glyphes ; un joueur mort sous les deux valeurs du paramètre) ; `starWindows` = pose réelle de 234.
* **Tracker** : heures, étoiles, statuts après kill, résurrection, corruption, arrivée de vague (états construits sur la
  vraie carte). **T-hours** (§12.4). **Prix** : `kill > 0` pour un contrat à l'heure prévue, `< 0` pour la même mort à
  V/XI ; `clock[1] > 0` quand seule une glyphe rend une étoile accessible.
* **Puzzles du planificateur** (états abstraits → plan attendu) :

| # | Situation | Attendu |
|---|---|---|
| PL1 | vague 1, 4 joueurs, k = 4, rien de marqué | marquages à VII/X/II, aucun à V/VIII/XI |
| PL2 | Méjaire marquée VII, Crâ (seul à voir VII) mort, `deadPlayerAdvancesClock = true` | glyphe +1 au tour de P1 ⇒ P2 voit VII et corrompt |
| PL3 | même situation, paramètre par défaut | P4 voit VII sans glyphe ; paliers de PV posés pour P4 |
| PL4 | 8 monstres vivants, 2 vagues chevauchées | corruptions avant nouveaux marquages ; coût de submersion actif |
| PL5 | heures inoffensives indisponibles (rôles) | accepte IX/VI plutôt que V/XI |
| PL6 | zombie à 1 600 PV, étoile au créneau de P3, P1 surpuissant | prix négatif pour P1 maintenant, contrat P3 |
| PL7 | tout corrompu au tour 18 | phase `waiting`, aucun contrat, cases hors lignes |

### 16.4 Puzzles tactiques (vraie carte, vrais sorts ; `tests/ai-puzzles-*.test.ts`, WP2)

Chaque puzzle affirme que le plan choisi **contient** l'action clé ; ceux liés à une tactique vérifient aussi qu'elle
désactivée fait **perdre** de la valeur. Objectif : `standard` ≥ 90 % de réussite, `fast` ≥ 60 % (benchmark suivi).

| # | Situation | Action attendue |
|---|---|---|
| P1 | Buboxor à 8 cases du Crâ, Enutrof 12 PA | retrait de PM suffisant plutôt que des dégâts |
| P2 | Ikargn à 2 cases de l'Eniripsa, Attraction prête | recul hors du rayon 3, ou Pandawa qui évacue l'allié |
| P3 | Crâ Feu, 3 monstres groupés | Balise Tactique puis Flèche Explosive (`stateChain`/`continuation`) |
| P4 | monstre neuf tuable à V, kill à VI possible plus tard | pré-dégâts au palier, pas de kill |
| P5 | monstre étoilé tuable par le tueur prévu | il l'achève dans sa fenêtre |
| P6 | contrat de corruption à une heure près, glyphe à 2 PM | chemin par la glyphe **puis** kill |
| P7 | fin de tour avant le créneau du Vortex | aucun allié sur la croix de l'Auroraire prévue |
| P8 | 3 alliés sous Petit poison | soin minimal qui retire le poison |
| P9 | kill réservé à 8 PA, 12 PA disponibles | les 4 PA libres ne rendent pas le kill impossible |
| P10 | Pandawa, Ikargn isolé, 2 monstres groupés, Iop joue ensuite | porter l'Ikargn et le jeter dans le paquet |
| P11 | Méjaire alignée à 3 cases du Iop | le Iop quitte la ligne avant la fin de son tour |
| P12 | Vortex vulnérable, kill d'équipe possible avant son tour | séquence des 4 alliés qui le tue |
| P13 | tank au contact de 2 monstres de mêlée | reste (tacle) au lieu de fuir |
| P14 | cible `forbid` à 10 % PV, zone du Crâ | la zone l'évite ou le Crâ change de case |
| P15 | couloir unique vers le Crâ, Osamodas disponible | invocation sur la case d'étranglement |
| P16 | corruption : 2 sorts sûrs contre 1 sort à 55 % | les 2 sorts sûrs |

### 16.5 Combats de contrôle, ablations, déterminisme

* **Contrôle** : miroir 1 c 1 × 1 000 graines ⇒ 50 ± 4 % ; 4 personnages équipés contre 4 Bouftous ⇒ 100 % en ≤ 3
  tours ; 4 personnages nus contre le Vortex ⇒ ≈ 0 % ; mannequin ⇒ dégâts = calculateur ± 1 % ; équipe méta des guides
  (Crâ + Enutrof retrait PM + Iop + Eniripsa, stuffs d'equipment.md §12) ⇒ ≥ 60 % en `fast`, ≥ 75 % en `standard`,
  vague 1 corrompue avant la vague 2 dans ≥ 50 % des cas.
* **Échelle des modes** (appariée, 200 graines, 3 équipes) : `random` < `scripted` < `fast` < `standard` ≤ `deep`,
  sinon bug d'évaluation.
* **Ablations** (Δ taux de victoire apparié, attendu significatif) : planificateur off (kills gloutons), tactiques off,
  rollouts off, pessimisme off, potentiel off, terme `control` off, sorts non offensifs interdits, prix heuristiques
  contre prix par recherche.
* **Déterminisme et honnêteté** : même hash d'événements (`record` on/off ; 1 et 4 workers ; reprise depuis un point de
  contrôle) ; l'IA ne lit jamais `fight.events` (test sur un Proxy) ; `fight.rngState` réel inchangé par la réflexion ;
  un monstre ne contourne pas un piège invisible.
* **Statistique** : réduction de variance avec E1 ≥ ×3 ; calibration `prefix12` → victoire à ≤ 5 points (courbe de
  fiabilité) ; corpus d'annotations de vidéos (`tests/fidelity/*.json`, état + action observée) : accord top-1/top-3 du
  `MonsterBrain` suivi dans le temps ; comparaison des heures et compositions retenues avec vortex.md §13.

### 16.6 Bancs (`bench/*.bench.ts`, vitest bench)

| Id | Mesure | Cible | Échec CI |
|---|---|---|---|
| B1 | µs par nœud (clone + chemin + lancer, effets réels) | ≤ 70 | > 140 |
| B2 | µs par `V(s)` | ≤ 30 | > 60 |
| B3 | ms par tour de monstre `play` / `predict` | ≤ 1,8 / 0,9 | ×2 |
| B4 | ms par tour de joueur `fast` / `standard` | ≤ 3,5 / 120 | ×2 |
| B5 | combat Vortex complet `fast` / `standard` (graines fixes) | ≤ 1,0 s / 30 s | ×2 |
| B6 | débit du pool (1, 2, 4 workers) en `fast` | ≥ 4 combats/s à 4 | < 2 |
| B7 | `HourPlanner` `standard` | ≤ 10 ms | > 20 ms |

Avertissement à +20 %, échec à ×2 (les machines de CI varient).

---

## 17. Risques et parades

| Risque | Effet | Parade |
|---|---|---|
| Interprètes d'effets incomplets ou faux | l'IA optimise un jeu qui n'existe pas ou exploite un bug | `unsupported` exclus, compteur par combat (E5), résultats « faible confiance » hors rapport, golden tests et puzzles rejoués à chaque évolution du moteur |
| Nœud > 70 µs | budgets dépassés | budgets en nœuds (le temps s'allonge, le résultat reste identique) ; leviers §14.2 ; E2 |
| Myopie (mises en place différées, effets d'horizon) | combos ratés | `continuation`, rollouts, tactiques, MCTS `deep`, menace incluant buffs différés et poisons |
| Modèle abstrait du planificateur ≠ moteur | contrats infaisables, kills à la mauvaise heure | auto-contrôle heure prédite/lue, calibration de l'oracle, `failCost`, replanification à chaque tour, T-clock |
| Prix trop forts / double comptage | sacrifice de la sécurité pour un contrat | bornes de prix, coût de mort dominant, phase `emergency`, règles §7 |
| Sur-apprentissage à l'IA monstre déterministe | plans « miraculeux » | pessimisme β, `noiseTau` 0,1 en robustesse, IA monstre identique dans tous les modes |
| Sur-apprentissage aux graines / aux règles INCERTAINES | θ ou équipe fragile | graines renouvelées, validation sur graines neuves, variantes échantillonnées, pire variante publiée |
| Combinatoire (composition × stuff × variantes) | campagnes trop longues | T0, presets, successive halving, CRN, cache |
| Explosion des invocations (Osamodas, Roublard, Sadida) | budget mangé par les invocations | invocations en `fast`, plafond de nœuds par entité |
| `TeamBrain` hors état | reprises non reproductibles | `snapshot/restore` purs, test de reprise |
| Navigateur (mémoire, threads) | démo lente | Web Workers, lot de données réduit, `fast` par défaut, `deep` en CLI seulement |

---

## 18. Plan d'implémentation : 4 lots parallèles

### 18.1 Lots, propriété et dépendances

| Lot | Fichiers possédés | Livrables | Dépend de |
|---|---|---|---|
| **WP1 — Socle IA et IA des monstres** | `src/ai/types.ts` (gelé J3), `src/ai/index.ts`, `src/ai/core/**`, `src/ai/monster/**`, `data/ai/calibration.json`, sections `threat`/`monster` de `theta-default.json`, `tests/ai-core-*`, `tests/ai-monster-*`, `bench/core.bench.ts`, `bench/monster.bench.ts` | §6, §7 (`value.ts`), §11 ; T-reach…T-parity, T1-T10, M-R, équivalence `topK` ; B1-B3 | moteur existant ; E1-E5 (équipe moteur, replis prévus) ; `src/dungeons/vortex/constants.ts` (WP3, J3) |
| **WP2 — IA de groupe** (tactique, coordination, créativité) | `src/ai/tactical/**`, `src/ai/team/**`, `src/ai/tactics/**`, sections `value`/`tactical`/`tactics`/`team` de `data/ai/theta-default.json`, `tests/ai-team-*`, `tests/ai-puzzles-*`, `bench/player.bench.ts` | §8, §9 (sauf pricers), §10 ; `GenericModel` ; puzzles P1-P16 ; B4 | contrats J3 de WP1 et WP3 ; implémentations WP1 (bouchons jusqu'au jalon S1) ; `ScenarioAIModel` du Vortex (WP3) pour P4-P7, P12, P14, P16 |
| **WP3 — Scénario Œil de Vortex et planificateur** | `src/dungeons/**` (`types.ts` et `vortex/constants.ts` gelés J3), sections `planner`/`vortex`/`burst` de `theta-default.json`, `tests/vortex-*`, `bench/planner.bench.ts` | §12 complet : hooks, paramètres, setup, clock, tracker, abstract, hourCost, planner, pricers, burst, placement, model, micro ; T-clock, T-hours, PL1-PL7 ; B7 | moteur + effets du Vortex (tests `effects-*-vortex` existants) ; interfaces `Perception` (WP1, J3) — `hourCost` utilise un DPT simplifié local tant que `dpt.ts` n'est pas livré |
| **WP4 — Optimiseur, parallélisme, boucle d'itérations, CLI** | `src/optimizer/**` (`types.ts` gelé J3), `src/cli/**`, `src/ai/policies/**`, `data/ai/presets.json`, `tests/opt-*`, `bench/pool.bench.ts`, `bench/e2e.bench.ts` | §15, §13 côté campagne (graines, variantes, CRN) ; presets des 19 classes + rotations `scripted` ; pool Node/navigateur ; stuff (dépend seulement de `src/stats`) ; B5, B6 | `src/stats` (existant) ; `runOne` des modes IA après le jalon S2 (en attendant : `scripted`, `random` et combats génériques) |

Règles de collaboration : un lot ne modifie pas les fichiers d'un autre ; les contrats gelés ne changent qu'après revue
des quatre responsables ; chaque lot fournit des bouchons (`stub*`) de ses interfaces dès J3 pour débloquer les autres ;
les demandes au moteur (E1-E5) passent par l'équipe moteur, jamais par une modification directe de `src/engine`.

### 18.2 Étapes et critères de sortie

| Étape | Contenu | Critère de sortie |
|---|---|---|
| S0 (J1-J3) | gel de `src/ai/types.ts`, `src/dungeons/types.ts`, `vortex/constants.ts`, `src/optimizer/types.ts` ; bouchons ; tickets E1-E5 | `tsc` vert avec bouchons ; B1 mesuré sur les effets actuels |
| S1 (parallèle) | WP1 socle + `MonsterBrain` ; WP2 `TurnSearch` `fast`/`standard` + rôles + tableau noir sur `GenericModel` ; WP3 scénario + clock + tracker + planner (abstrait) + heuristic pricer ; WP4 pool, seeds, stats, Monte-Carlo, presets, `scripted`, stuff | tests unitaires de chaque lot ; T1-T10 ; PL1-PL7 ; combats de contrôle génériques en `fast` ; B1-B4, B6, B7 |
| S2 intégration « Vortex `fast` » | `ScenarioAIModel` branché ; combat complet jouable et **rejoué en animation** | T-clock sur combats réels ; B5 `fast` ≤ 1 s ; échelle `scripted` < `fast` ; déterminisme 1/4 workers |
| S3 « `standard` + optimiseur » | `SearchPricer`, rollouts, tactiques v1, burst, placement ; L1-L5 | puzzles `standard` ≥ 90 % ; B5 `standard` ≤ 30 s ; ablations ; première campagne complète (≈ 1 h 20) |
| S4 « `deep` et démo » | MCTS, rembobinage, distillation, tactiques v2, rapport | ligne gagnante annotée sur la graine de démo ; rapport Vortex ; θ validé sur graines neuves |

---

## Annexe A — θ par défaut (`data/ai/theta-default.json`, extrait)

```json
{
  "value": { "monsterDamage": 1.0, "summonDamage": 0.5, "killKappa": 0.3, "killTau": 1.0, "allyShield": 0.8,
    "summonLife": 0.4, "erosion": 0.5, "deathPotMult": 2.0, "incoming": 0.8, "incomingTank": 0.6, "dot": 0.9,
    "dotDecay": 0.8, "control": 0.15, "potBefore": 0.35, "potAfter": 0.15, "continuation": 0.8, "cdCost": 0.08,
    "unusedAp": 2, "positionCap": 50, "minGain": 20, "endMoveMinGain": 5,
    "roleUtility": { "healer": 2000, "mpLock": 1500, "apLock": 1500, "placer": 1000 } },
  "threat": { "tauFrac": 0.25, "zoneFactor": 0.6, "laterEnemyWeight": 0.8, "hitWeak": 0.6, "hitNextTurn": 0.25,
    "pacifistFactor": 0.9, "deathSigmaFrac": 0.25 },
  "tactical": { "fast": { "width": 1, "topK": 6, "depth": 8, "rollouts": 0, "nodes": 40 },
    "standard": { "width": 6, "topK": 12, "depth": 6, "rollouts": 3, "nodes": 1500, "keyBoost": 2, "maxKeys": 12 },
    "deep": { "width": 12, "topK": 20, "depth": 8, "rollouts": 6, "nodes": 15000, "mcts": 1500, "maxKeys": 30 },
    "beta": 0.25, "replanHpDev": 0.15, "maxReplans": 4, "diversityMargin": 0.3, "lethalBand": 0.08 },
  "tactics": { "prior": { "stateChain": 1, "mpLock": 1, "carryThrow": 1, "glyphClock": 1, "healCleanse": 1,
    "bodyBlock": 1, "groupForZone": 1, "burstSetup": 1 }, "epsilon": 0.05, "maxPerNode": 4 },
  "team": { "emergencyDeathProb": 0.35, "protectDeathProb": 0.15, "maxIntentsPerAlly": 3, "commit": 0.1,
    "reservedCellPenalty": 50, "coherenceBonus": 100, "killerMinDptFrac": 0.6 },
  "planner": { "beamWidth": 16, "horizonPlayerSlots": 12, "rootDiversity": 2, "maxKillsPerSlot": 2, "wExposure": 1.0,
    "corruptBonus": 1500, "failCost": 800, "glyphCost": 120, "unreachableHourCost": 2000, "maxAliveFactor": 2,
    "overloadCost": 400, "hourCostScale": 1.0, "lambdaEhp": 0.25, "lambdaBurst": 0.5, "glyphAvailability": 0.6,
    "oracleAlpha": 0.2 },
  "vortex": { "corruptKill": 4000, "plannedFirstKill": 2500, "unplannedKillBase": 1500, "waveHpSlope": 0.3,
    "contractHpSlope": 0.7, "floorSigma": 2, "shiftDetour": 150, "swapCell": 300, "vortexKill": 20000,
    "killMin": -3000, "killMax": 4000, "placementIndex": 0 },
  "burst": { "minCommit": 0.6, "beam": 32, "phase2VortexTurns": 2 },
  "monster": { "topK": 8, "predictTopK": 4, "referenceTopK": 24, "noiseTau": 0, "minActionScore": 1, "wDmg": 1.0,
    "wKill": 1.0, "kappa": 0.5, "wAP": 0.8, "wMP": 0.8, "wHeal": 0.9, "wFF": 0.6, "summonValue": 0.5,
    "reflectAversion": 0.2, "positionDuringTurn": 0.25 }
}
```
