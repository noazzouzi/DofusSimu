# IA de DofusSimu — proposition « recherche d'abord »

> Proposition de conception (CP4/CP5). Angle : **la recherche fait le travail**. À chaque tour, l'IA de groupe explore
> des séquences de macro-actions (déplacement + sort) par *beam search* sur des clones de l'état, en simulant la
> **réponse des monstres avec leur propre IA** ; les décisions clés passent par un **MCTS** sur plusieurs tours ; les
> poids de la fonction d'évaluation sont **réglés automatiquement** (CMA-ES sur des milliers de combats à graines
> communes). La créativité (retrait de PM, placement, glyphes, nettoyage de poison…) n'est pas codée à la main : elle
> **émerge** parce que la recherche essaie *tous* les sorts lançables et que l'évaluation mesure la **menace** future,
> le **potentiel** offensif de l'équipe et l'**objectif du scénario**.
>
> Prose en français, identifiants en anglais. Rien ici n'est codé dans `src/` ; c'est le plan d'implémentation.
> Lectures préalables : `src/engine/*` (contrats), `docs/research/monster-ai.md` (§0, §3-§8), `docs/research/vortex.md`
> (§0, §3, §5, §6, §8, §13), `docs/research/mechanics.md` (§6 tacle, §8 timeline), `docs/research/classes/*.md`,
> `docs/research/equipment.md` (§11-§12).

---

## 0. Décisions clés (TL;DR)

1. **Une seule boucle de simulation** pour tout : l'IA joue sur des clones `Engine.cloneFight` en `rollMode: 'average'`,
   avec les vrais interprètes d'effets. Aucune règle de jeu n'est dupliquée dans l'IA (sauf les modèles analytiques de
   menace/potentiel, vérifiés contre la simulation).
2. **Macro-action** = (chemin optionnel) + (sort sur une case) ; le tour est une séquence de macro-actions + un
   déplacement final. Recherche **beam** (largeur 6, top-K 12 par nœud avec quotas par catégorie d'action),
   **tables de transposition**, **diversité** forcée (un emplacement réservé aux plans « utilitaires »).
3. **Évaluation en PV-équivalents** : vie des alliés (avec érosion et coût de mort), vie des ennemis + bonus de kill,
   **menace attendue** (modèle analytique ordonné selon la timeline), **potentiel offensif** de l'équipe au prochain
   tour, contrôle, ressources (relances), termes de rôle et **termes de scénario**. Poids initiaux fixés à la main
   (§7), puis réglés par CMA-ES.
4. **Réponse adverse** : les 4 meilleurs plans sont départagés en jouant les tours des monstres qui suivent avec
   **leur IA réelle** (mode rapide), plus un **rollout de tour complet** (alliés en politique rapide) pour les 2
   meilleurs ; un coefficient de **pessimisme** β = 0,3 mélange la réponse prévue et la pire des 3 meilleures
   réponses monstres (anti-surapprentissage de l'IA déterministe).
5. **MCTS** (UCT, élargissement progressif, plans du beam comme actions) uniquement pour les **décisions clés**
   (kill de corruption, risque de mort d'un allié, égalité serrée, tour de burst du Vortex) : ≤ 8 par combat.
6. **IA des monstres** = conception de `monster-ai.md §8` (gloutonne + replanification, profils, overrides) branchée
   sur la même infrastructure (candidats, simulation) ; un mode `fast` (top-K réduit) sert aux rollouts et au
   Monte-Carlo ; elle n'est **jamais** réglée pour être forte, seulement fidèle (tests R1-R25, T1-T10).
7. **Œil de Vortex** : un **modèle d'horloge** pur (prévision des heures par créneau de la timeline, glyphes = +1
   heure) et un **planificateur de corruption** abstrait (beam sur créneaux, 1-3 ms) qui produit des **contrats de
   kill** (« P3 tue la Méjaire à VI pour la marquer, la corrompt au tour r+3 »), des **interdits** (pas de kill à V/XI)
   et la valeur d'un **+1 heure** par glyphe. Le coût d'une heure est calculé automatiquement par le modèle de menace
   (bonus appliqué à un clone du monstre).
8. **Coordination** : un **tableau noir** d'équipe (contrats, cibles focales, devoirs « neutraliser / protéger /
   nettoyer »), des rôles **inférés** des sorts et du stuff, et des intentions transmises d'un allié au suivant ; les
   devoirs sont des **bonus doux**, jamais des scripts.
9. **Graines** : graine maîtresse → graine de combat (dés du moteur) → graines IA dérivées (`mix32`), séparées des dés ;
   **budgets en nœuds, jamais en millisecondes** ⇒ un combat se rejoue à l'identique (replay à la demande, même dans
   un worker différent).
10. **Budgets** (1 cœur) : `fast` < 1 s par combat Vortex (Monte-Carlo), `standard` < 30 s (≈ 2 500 nœuds/tour),
    `deep` 2-5 min (démo). Coût mesuré aujourd'hui sur cette machine : clone 7-10 µs, `canCast` ≈ 1 µs,
    clone + lancer (sans interprètes) 22 µs ; budget de conception : **70 µs par nœud** une fois les effets codés.
11. **Boucle d'itérations** à 5 étages : recherche par tour → Monte-Carlo sur graines (CRN) → réglage CMA-ES des
    poids → optimisation de stuff/variantes → recherche de composition sur les 19 classes (prior analytique +
    *successive halving*), parallélisée par `worker_threads` (4 workers ≈ 20 000 combats rapides/heure).
12. **Stuff** : proxys analytiques (dégâts par tour sur le profil de résistances du donjon, PV effectifs, utilité de
    retrait) + recherche locale (recuit) sur emplacements/panoplies/exos, puis sélection finale par simulation.
13. **Validation** : benchmarks µs/nœud et ms/tour avec seuils, **suite de puzzles tactiques** (la bonne action
    créative doit être trouvée), combats de contrôle (aléatoire < fast < standard < deep), golden tests monstres,
    déterminisme (record on/off, 1 vs 4 workers).

---

## 1. Objectifs, contraintes et hypothèses

### 1.1 Objectifs (reformulés)

| # | Objectif utilisateur | Traduction technique |
|---|---|---|
| O1 | « le maximum possible d'itérations […] afin de réussir un combat » | politique `fast` < 1 s/combat, batch multi-cœurs, réglage automatique, recherche de compo/stuff ; mode « rembobinage » pour trouver une ligne gagnante (§17.6) |
| O2 | meilleur groupe de 4 parmi 19 classes, stuffs (exos), sorts | `src/optimizer/team`, `src/optimizer/stuff`, choix des 22 variantes |
| O3 | tours de groupe intelligents et **créatifs** | beam + rollouts adverses + menace/potentiel + objectif de scénario (§8-§12) |
| O4 | IA monstres/boss fidèle | `monster-ai.md §8` + profils Vortex, golden tests |
| O5 | replays animés | combats rejouables à l'identique (graine + config), journal `log` niveau `ai` avec explications |
| O6 | démo Œil de Vortex (vagues, horloge, corruption, phase 2) | `src/dungeons/vortex` : scénario, modèle d'horloge, planificateur |

### 1.2 Contraintes du moteur (existant)

* `Controller.playTurn(engine, fight, fighter): void` (synchrone) agit via `performAction` ; `runFight` enchaîne
  `nextTurn` → `playTurn` → `endTurn`.
* `Engine.cloneFight(fight, record=false)` : copie profonde de l'état mutable (carte, sorts partagés) ;
  `scenarioState` est cloné par `structuredClone` (à garder **petit et plat**).
* `castSpell` / `canCast(..., { fromCell })` ; en `rollMode: 'average'`, dégâts/soins en espérance (critique pondéré
  via `critWeight`) ; `move` applique le tacle pas à pas ; `reachableCells` (BFS, sans tacle).
* RNG des dés : `fight.rngState` (mulberry32, `engine/random.ts`) ; RNG utilitaire `core/rng.ts` (sfc32, `fork()`).
* Timeline : alternance des équipes par initiative ; invocations après leur invocateur (`mechanics.md §8`).

### 1.3 Hypothèses (à confirmer avec les équipes moteur, §22)

* H1 — Les interprètes d'effets sont fidèles ; `applyEffects` gère déclencheurs, différés, sous-sorts.
* H2 — En mode `average`, les retraits PA/PM esquivables appliquent l'**espérance fractionnaire**
  (`expectedApMpRemoved`) : `fighter.ap/mp` peuvent être non entiers **dans les simulations seulement** ; le modèle
  de menace interpole (`reach(⌊mp⌋)` et `reach(⌈mp⌉)`).
* H3 — En mode `average`, le tirage des groupes d'effets aléatoires (`applyEffects`) utilise le RNG du **clone**, que
  l'IA re-sème de façon déterministe (§15) ; option souhaitée : choisir le groupe le plus probable.
* H4 — Les effets non implémentés sont détectables (`registeredEffects()` / `noteUnknownEffect`) : l'IA ignore par
  défaut tout sort dont un effet n'est pas supporté (évite d'exploiter un inconvénient non simulé, ex. Avarice qui
  donne +3 PA aux ennemis).
* H5 — `targetMask.ts` conforme (`*` = lanceur, `E/e/F/f/V/v`) — prérequis du Vortex (`monster-ai.md §0.7`) ; le code
  actuel sépare déjà conditions « lanceur » et « cible » : à confirmer par les tests du Vortex (T-clock).

### 1.4 Coûts mesurés (bench local, Node 22, 1 cœur, carte du Vortex, 9 combattants, 6 buffs chacun)

| Opération | Mesure | Commentaire |
|---|---|---|
| `cloneFight` | 7-10 µs | proportionnel au nombre de combattants/buffs |
| `reachableCells` (6 PM, 62 cases) | 31 µs | `Map` + `queue.shift()` → à remplacer par `GridSearch` (tableaux typés, cible ≤ 5 µs) |
| `canCast` | ≈ 1 µs | 9 768 tests (44 sorts × 222 cases) en ≈ 10 ms |
| clone + `castSpell` (aucun interprète enregistré) | 22 µs | zone + ciblage + journalisation désactivée |
| **Hypothèse de conception** : clone + déplacement + lancer avec effets réels | **≈ 60-70 µs** | à re-mesurer en M1 (bench B1, §20) |
| évaluation rapide d'une feuille | ≈ 15-25 µs | modèles de menace/potentiel incrémentaux |

---

## 2. Vue d'ensemble

```
                    ┌───────────────────────── src/optimizer ─────────────────────────┐
  itérations ──►    │ team/ (19 classes) ─► stuff/ (items, exos, variantes) ─► tune/  │
  (heures)          │        racing / successive halving            CMA-ES (poids)    │
                    │                 └──────────► montecarlo/ ◄────────┘             │
                    │                         (graines CRN, workers)                  │
                    └───────────────────────────────┬─────────────────────────────────┘
                                                    │ BatchJob(team, aiConfig, seeds)
                    ┌───────────────────────────────▼─────────────────────────────────┐
  1 combat ──►      │ runFight(engine + scenario hooks src/dungeons/vortex)           │
  (< 1 s / < 30 s)  │   joueurs : GroupBrain ──► TurnSearch (beam) ──► MCTS (clés)    │
                    │                 │  tableau noir, rôles, ClockPlanner           │
                    │   monstres : MonsterBrain (fidèle)    ▲ rollouts (mode fast)    │
                    └─────────────────┼───────────────────────┼──────────────────────┘
                    ┌─────────────────▼───────────────────────┴──────────────────────┐
  1 décision ──►    │ core/ : sim (clones, average, re-semis), candidates, reach,      │
  (≈ 2 500 nœuds)   │ threat, potential, evaluate, hash, budget                        │
                    └──────────────────────────────────────────────────────────────────┘
```

Principe directeur : **l'IA ne connaît que trois choses** — (1) comment générer des actions légales, (2) comment
simuler (le moteur), (3) comment noter un état (évaluation). Tout le « savoir-faire » (rotations, placements, astuces
d'horloge) doit sortir de la recherche ; les seules connaissances injectées sont des **priors** (quotas de
candidats, devoirs du tableau noir, planificateur de scénario) et elles restent soumises à la simulation.

---

## 3. Arborescence des modules

```
src/ai/
  index.ts                 registre aiKey -> Controller ('group', 'monster:<id>', 'boss:<id>', 'random', 'scripted')
  types.ts                 MacroAction, TurnPlan, AIConfig, AIBudget, EvalWeights, EvalBreakdown, Role...
  config.ts                préréglages AILevel (random | scripted | fast | standard | deep)
  core/
    sim.ts                 SimContext : clone, re-semis RNG, application d'une macro-action, compteur de nœuds
    actions.ts             apply(), signature(), describe() (texte FR pour le replay)
    reach.ts               accessibilité typée (GridSearch), coût de tacle attendu, variantes de chemin (glyphes)
    candidates.ts          générateur de macro-actions + préfiltre analytique + quotas par catégorie
    semantics.ts           catégorie d'un sort (dégâts, contrôle, placement, soin, buff, invocation, marque...)
    threat.ts              ThreatModel : profils d'attaque, menace ordonnée par la timeline, cartes de danger
    potential.ts           PotentialModel : dégâts/kill attendus des alliés au prochain tour
    evaluate.ts            evaluate() -> EvalBreakdown (termes en PV-éq.), poids
    lethal.ts              « split léthal » (probabilité de kill quand l'espérance est ambiguë)
    hash.ts                hachage d'état (transpositions)
    budget.ts              budgets déterministes en nœuds, garde-fou temps (avertissement seulement)
    rng.ts                 mix32, dérivation des graines IA
  group/
    brain.ts               GroupBrain : fournit un Controller par allié ; replanification ; journal
    search.ts              TurnSearch (beam) + finalisation (déplacement de fin de tour)
    rollout.ts             réponses adverses (court, tour complet), pessimisme
    mcts.ts                KeyDecisionMCTS
    keys.ts                détection des décisions clés
    roles.ts               capacités, inférence/affectation des rôles
    blackboard.ts          TeamPlan : contrats, focus, devoirs, intentions, cases réservées
    explain.ts             explications (top plans, termes) -> événements 'log' niveau 'ai'
  policies/
    fastPlayer.ts          politique gloutonne 1 coup (Monte-Carlo, rollouts alliés)
    random.ts              politique aléatoire légale (référence basse)
    scripted.ts            rotations des fiches de classe (référence « sans IA »)
  monster/                 (conception monster-ai.md §8)
    brain.ts  candidates.ts  score.ts  position.ts  archetype.ts  profiles/  overrides/

src/dungeons/
  index.ts                 registre de scénarios (id -> Scenario)
  waves.ts                 vagues génériques des dimensions divines (timer, invulnérabilité d'arrivée)
  vortex/
    scenario.ts            ScenarioHooks (vagues, déverrouillage, Action !) — paramètres INCERTAINS exposés
    setup.ts               carte 143393281, placements, composition des vagues
    clock.ts               modèle d'horloge (lecture d'état + prévision par créneau)
    planner.ts             ClockPlanner : planification abstraite des kills/corruptions/glyphes
    objective.ts           ScenarioObjective Vortex (termes d'évaluation, menaces, décisions clés, indices)
    profiles.ts            profils IA des monstres (monster-ai.md §7.3) + overrides Vortex

src/optimizer/
  seeds.ts                 graines maîtresses / de combat / d'IA
  montecarlo.ts            runBatch, statistiques (Wilson, IC), CRN, SPRT / racing
  pool.ts  worker.ts       worker_threads (Node) ; adaptateur Web Worker (navigateur)
  cache.ts                 cache de résultats (clé = versions + équipe + config + graine)
  cmaes.ts  tune.ts        CMA-ES (n ≤ 30) et boucle de réglage des poids ; distillation fast <- standard
  stuff/  pools.ts  proxies.ts  search.ts  exos.ts  variants.ts
  team/   archetypes.ts  prior.ts  racing.ts  evolve.ts
  rewind.ts                « rembobinage » (recherche d'une ligne gagnante pour une graine donnée)
  report.ts                rapport Vortex (meilleure équipe, stuffs, sorts, déroulé, replays)

src/cli/  simulate.ts  tune.ts  optimize.ts  bench.ts
```

---

## 4. Contrats TypeScript

### 4.1 Actions, plans, configuration

```ts
// src/ai/types.ts
import type { Engine } from '../engine/engine'
import type { Fighter, FightState } from '../engine/types'
import type { TeamId } from '../core/types'

export type ActionCategory =
  | 'damage' | 'control' | 'placement' | 'heal' | 'buff' | 'debuff' | 'summon' | 'mark' | 'utility' | 'move'

/** Macro-action : déplacement optionnel PUIS lancer optionnel. Au moins l'un des deux. */
export interface MacroAction {
  /** Chemin complet, path[0] = case actuelle. */
  path?: number[]
  cast?: { spellId: number; cell: number }
  cat: ActionCategory
  /** Estimation analytique du préfiltre (PV-éq.), sert au tri et au départage. */
  prior: number
  /** uids des glyphes/pièges traversés volontairement (leviers de scénario : horloge du Vortex). */
  triggers?: number[]
  /** Signature déterministe (spellId:cell:pathEnd) : départage, transpositions, journal. */
  key: string
}

export interface EvalBreakdown {
  total: number
  allyLife: number; enemyLife: number; kills: number; threat: number; control: number
  potential: number; position: number; resources: number; duties: number; scenario: number
}

export interface TurnPlan {
  actions: MacroAction[]
  finalPath?: number[]
  value: number
  breakdown: EvalBreakdown
  alternatives: { actions: MacroAction[]; value: number; breakdown: EvalBreakdown }[]
  stats: SearchStats
  /** Intentions prévues pour les alliés suivants (rollout de tour complet). */
  intents?: Intent[]
  keyDecision?: KeyDecisionReason
}

export interface SearchStats {
  nodes: number; rollouts: number; mctsIterations: number; transpositionHits: number
  depthReached: number; wallMs: number
}

export type AILevel = 'random' | 'scripted' | 'fast' | 'standard' | 'deep'

export interface AIBudget {
  maxNodes: number            // simulations de macro-actions (rollouts inclus)
  beamWidth: number           // W
  topK: number                // K enfants simulés par nœud (après quotas)
  maxDepth: number            // macro-actions par tour
  endCells: number            // P cases candidates de fin de tour
  shortRollouts: number       // R plans départagés par la réponse des monstres
  roundRollouts: number       // plans départagés par un rollout de tour complet
  pessimismAlternatives: number // alternatives monstres évaluées (pire cas)
  mctsIterations: number      // par décision clé (0 = désactivé)
  maxKeyDecisions: number     // par combat
  replanFraction: number      // part du budget réservée aux replanifications après un lancer
  quotas: Partial<Record<ActionCategory, number>>
}

export interface AIConfig {
  level: AILevel
  budget: AIBudget
  weights: EvalWeights
  /** Graine IA (dérivée de la graine de combat, §15). */
  seed: number
  /** Bruit softmax des monstres en combat réel (0 = fidèle). */
  monsterNoise: number
  explain: boolean
  unsupportedSpells: 'skip' | 'allow'
}
```

### 4.2 Contexte de recherche, modèles

```ts
// src/ai/core/sim.ts
export interface SearchContext {
  engine: Engine
  root: FightState
  meId: number
  side: TeamId
  cfg: AIConfig
  threat: ThreatModel
  potential: PotentialModel
  scenario?: ScenarioObjective
  board: Blackboard
  counters: { nodes: number; rollouts: number }
  rng: Rng                      // sfc32 propre à l'IA (jamais fight.rngState)
  /** Ordre de jeu à venir (ids) à partir du tour courant, sur 2 tours de jeu. */
  upcoming: number[]
}

export function simulate(ctx: SearchContext, parent: FightState, a: MacroAction, salt: number): FightState | null

// src/ai/core/threat.ts
export interface AttackProfile {
  fighterId: number
  /** Par sort : coût, portée min/max (bonus inclus), ligne/diagonale, LdV, zone, lancers/tour et /cible. */
  spells: AttackSpell[]
  ap: number; mp: number        // au prochain tour de ce combattant (débuffs à durée encore active inclus)
}
export interface ThreatModel {
  /** Recalcul paresseux : seuls les combattants dont la « révision » a changé sont recalculés. */
  sync(s: FightState): void
  /** Dégâts attendus (PV-éq., plafonnés) que `m` infligerait à `a` posté sur `cell` au prochain tour de m. */
  attackValue(m: Fighter, a: Fighter, cell: number): number
  /** Menace par allié jusqu'à son prochain tour (monstres qui jouent AVANT lui), imitation du choix de cible. */
  incoming(s: FightState, side: TeamId): Float64Array        // indexé par fighter.id
  /** Probabilité de mort avant son prochain tour (approximation normale). */
  deathProbability(a: Fighter, incoming: number): number
  /** Menace propre d'un ennemi (meilleur tour de dégâts sur sa meilleure cible), PV-éq. par tour. */
  threatOf(m: Fighter): number
  /** Carte de danger pour une case donnée (positionnement, fin de tour). */
  dangerAt(s: FightState, a: Fighter, cell: number): number
}

// src/ai/core/potential.ts
export interface PotentialModel {
  sync(s: FightState): void
  /** Meilleure valeur offensive (dégâts plafonnés + P(kill)·valeurKill) de l'allié a à son prochain tour. */
  allyPotential(s: FightState, a: Fighter): number
  /** Tables : espérance de dégâts du sort `spellId` de a sur e (stats et buffs courants, critique inclus). */
  expected(a: Fighter, spellId: number, e: Fighter): number
}
```

### 4.3 Scénario (objectif injecté dans l'évaluation)

```ts
// src/dungeons/index.ts
export interface Scenario {
  id: string
  hooks: ScenarioHooks                       // contrat moteur existant
  makeFight(engine: Engine, team: TeamSpec, opts: { seed: number; rollMode: RollMode; record: boolean }): FightState
  objective?: ScenarioObjective
  /** Paramètres INCERTAINS exposés (ex. tour de la vague 2, délai d'Action !) pour le Monte-Carlo de robustesse. */
  params: Record<string, number | string | boolean>
}

export interface ScenarioObjective {
  id: string
  /** À la racine de chaque décision : tables (valeur des kills, valeur d'un +1 heure, menaces propres). */
  prepare(ctx: SearchContext): void
  /** Termes rapides (chaque nœud du beam). */
  quickTerms(ctx: SearchContext, s: FightState): number
  /** Termes complets (feuilles retenues : planificateur relancé sur l'état abstrait). */
  fullTerms(ctx: SearchContext, s: FightState): number
  /** Menace spécifique (lignes de l'Auroraire au tour du Vortex...). */
  extraThreat?(ctx: SearchContext, s: FightState, a: Fighter, cell: number): number
  /** Remplace la valeur générique d'un kill (corruption, marquage, kill à une mauvaise heure). */
  killValue?(ctx: SearchContext, root: FightState, leaf: FightState, victim: Fighter): number | undefined
  /** Indices de candidats (glyphes utiles, cibles contractuelles) ajoutés hors quotas. */
  hints?(ctx: SearchContext, s: FightState, me: Fighter): CandidateHint[]
  isKeyDecision?(ctx: SearchContext): KeyDecisionReason | null
  /** Coût additionnel d'une mort d'allié (ex. casse le cycle de l'horloge). */
  allyDeathExtra?(ctx: SearchContext, s: FightState, a: Fighter): number
  /** Le combattant sera-t-il attaquable à ce moment (invulnérabilité de vague, Vortex Marginal) ? */
  vulnerableAt?(s: FightState, e: Fighter, roundOffset: number): boolean
}
export interface CandidateHint { kind: 'glyph' | 'kill' | 'avoidCells' | 'reachCell'; cells?: number[]; targetId?: number; weight: number }
export type KeyDecisionReason = 'corruptionKill' | 'allyDeathRisk' | 'closeCall' | 'burst' | 'waveArrival' | 'phaseChange'
```

### 4.4 Tableau noir et rôles

```ts
// src/ai/group/blackboard.ts
export type Role = 'dps' | 'retrait' | 'soin' | 'placeur' | 'tank' | 'invocateur' | 'soutien'

export interface Duty {
  kind: 'kill' | 'neutralize' | 'protect' | 'cleanse' | 'block' | 'avoidLines' | 'prepare'
  actorId: number
  targetId?: number
  cells?: number[]
  /** PV-éq. accordés si le devoir est satisfait dans l'état évalué (bonus doux). */
  weight: number
  untilRound: number
}
export interface Intent { actorId: number; round: number; plan: string[]; expectedKills: number[] }
export interface Blackboard {
  round: number
  focus: number[]                    // ennemis par priorité (menace × facilité de kill × contrats)
  duties: Duty[]
  intents: Intent[]
  reservedCells: Map<number, number> // case -> allié (évite que deux alliés visent la même case)
  schedule?: KillSchedule            // Vortex (planner.ts)
}

// src/ai/group/roles.ts
export interface Capabilities {
  dptSingle: number; dptAoe: number      // PV/tour sur la cible de référence du scénario
  mpRemoval: number; apRemoval: number   // points retirés attendus / tour contre l'esquive de référence
  heal: number; shield: number           // PV/tour
  placement: number                      // nb de sorts de déplacement d'entités × fiabilité
  tankiness: number                      // PV effectifs
  summons: number; buff: number; range: number; mobility: number
}
export function capabilities(engine: Engine, f: Fighter, ref: ReferenceTargets): Capabilities
export function assignRoles(team: Fighter[], caps: Capabilities[], needs: ScenarioNeeds): Map<number, Role[]>
```

### 4.5 Graines, batch, optimiseurs

```ts
// src/optimizer/seeds.ts
export function mix32(a: number, b: number): number            // finaliseur murmur3 sur (a ^ rotl(b))
export const fightSeed = (master: number, index: number) => mix32(master, index)
export const aiSeed = (fight: number, fighterId: number, round: number, decision: number) =>
  mix32(mix32(fight ^ 0xa1a1a1a1, fighterId), (round << 8) | decision)

// src/optimizer/montecarlo.ts
export interface TeamSpec { members: { name: string; breedId: number; build: CharacterBuild; roles?: Role[] }[] }
export interface BatchJob {
  scenarioId: string; scenarioParams?: Record<string, number | string | boolean>
  team: TeamSpec; ai: AIConfig; seeds: number[]; record: 'none' | 'summary' | 'events'
}
export interface FightSummary {
  seed: number; winner: TeamId | null; rounds: number; endReason: string
  allyDeaths: number; allyHpLostPct: number; corruptions: number; bossDamagePct: number
  progress: number            // [0,1] : corruptions, déverrouillage, dégâts au boss (§17.1)
  nodes: number; wallMs: number; keyDecisions: number
}
export interface BatchResult { job: BatchJob; summaries: FightSummary[]; winRate: number; winCI95: [number, number]; meanProgress: number }
export function runBatch(jobs: BatchJob[], pool: WorkerPool, onProgress?: (done: number) => void): Promise<BatchResult[]>
```

---

## 5. Simulation pour l'IA

### 5.1 Application d'une macro-action sur un clone

```
simulate(ctx, parent, a, salt):
  s = engine.cloneFight(parent, false)              // record=false : aucun événement
  s.options.rollMode = 'average'
  s.rngState = mix32(ctx.cfg.seed, salt)           // même salt pour tous les frères (CRN interne, §15)
  me = s.fighters[ctx.meId]
  if a.path:  steps = move(s, me, a.path, engine); if steps < a.path.length-1 and a.cast: return null   // tacle/piège
  if a.cast:  r = castSpell(engine, s, me, a.cast.spellId, a.cast.cell); if !r.ok: return null
  ctx.counters.nodes++
  return s
```

* Le déplacement réel applique le tacle (`move`), les pièges et glyphes (`onEnterCell`) : la simulation **voit** les
  effets d'horloge (glyphe de monstre ⇒ Décalage horaire) sans code spécifique.
* Fin de tour simulée : `engine.endTurn(s, me)` puis la boucle `nextTurn` du rollout (§9) — les déclencheurs `TE`/`TB`,
  poisons, résurrections et vagues passent par le moteur et les hooks de scénario.

### 5.2 Révisions et caches

Les modèles analytiques (menace, potentiel) sont recalculés **par combattant modifié** : `hash.ts` fournit une
empreinte par combattant (case, PV, bouclier, PA/PM, `buffs.length`, somme des uids de buffs, états) ; un combattant
dont l'empreinte n'a pas changé réutilise ses tables (`ThreatModel.sync`). Les caches sont **purs** (fonctions de
l'état) : ils n'influencent jamais une décision, seulement le temps de calcul.

### 5.3 Transpositions

`stateHash(s)` = FNV-1a 32 bits × 2 (64 bits effectifs) sur, pour chaque combattant vivant : case, PV, bouclier, PA, PM
(× 100 si fractionnaires), empreinte de buffs/états, relances ; + uids des glyphes/pièges + `round`. Dans un tour, deux
ordres de lancers indépendants (A puis B, B puis A) produisent le même hash : on garde le nœud de meilleure valeur
(table `Map<string, number>` par décision, ≤ 10 000 entrées).

### 5.4 Split léthal (aléa des kills)

En espérance, un kill est binaire alors que la réalité est probabiliste. Quand, après simulation, une cible vérifie
`0 < pv ≤ 0,08·pvMax` ou a été tuée avec un excès < 8 % de ses PV :

```
p = probabilité de kill : on rejoue le même lancer en rollMode 'min' et 'max' (2 simulations)
    si 'min' tue  -> p = 1 ;  si 'max' ne tue pas -> p = 0
    sinon p ≈ clamp((Dmax − pv) / (Dmax − Dmin), 0, 1)        (jets ≈ uniformes ; affinable via damageDistribution)
valeur = p · V(état tué) + (1 − p) · V(état survivant)          // les deux états viennent des rejeux min/max
```

Au plus **un** split par chemin du beam (le premier lancer ambigu), pour borner le coût (≤ +2 nœuds). C'est ce qui fait
préférer « 2 sorts sûrs » à « 1 gros sort à 55 % » quand le kill compte (corruption à l'heure exacte).

---

## 6. Génération des candidats et élagage

### 6.1 Accessibilité (`reach.ts`)

* BFS typé (`GridSearch`) sur `mp` du lanceur, cases libres ; coût de chaque case = PM + **perte attendue** PA/PM par
  tacle (formule `tackleRatio`, appliquée sur le premier pas qui quitte un contact).
* Deux familles de chemins : **défaut** (évite toute glyphe/piège : coût +∞ sur ces cases) et **levier** (chemin le
  plus court qui traverse/termine sur une glyphe donnée, si le scénario ou la valeur d'effet le justifie).
* Si `ap` restants < coût minimal des sorts, seules les actions de déplacement de fin de tour sont générées.

### 6.2 Énumération (`candidates.ts`)

```
generate(ctx, s, me):
  out = []
  R = reach(s, me)
  for sp of me.spells:
    if !staticCastable(sp, me) continue              // PA, relance, max/tour, statesCriterion, état empêchant
    if !supported(sp) and cfg.unsupportedSpells == 'skip' continue
    cat = category(sp)                               // semantics.ts (effect-semantics.json, sous-sorts inclus)
    for t of targetCells(sp, s, me, cat):            // voir règles C2-C5
      castCells = inverseRange(sp, t) ∩ R             // cases d'où la géométrie (portée/ligne/diag) est valide
      keep ≤ 3 cases par (sp, t) : coût PM croissant, puis danger croissant, puis perte de tacle
      for p of castCells:
        if canCast(engine, s, me, sp, t, { fromCell: p }) == null:   // LdV, cellule libre/occupée, max/cible
          out.push({ path: path(R, p), cast: { spellId: sp.spellId, cell: t }, cat, prior: quick(ctx, s, me, sp, t, p) })
  out.push(...scenarioHints(ctx, s, me))             // ex. traverser la glyphe de l'Ikargn avant de frapper
  return out
```

Règles de génération / élagage :

| # | Règle |
|---|---|
| C1 | `staticCastable` filtre avant toute géométrie (coût ≈ 0). |
| C2 | Sorts ciblant des entités : cases occupées dont l'occupant est accepté par le masque d'au moins un effet (ennemi / allié / soi), en excluant les ennemis invulnérables **sauf** si le sort retire un état ou déplace (R9 de `monster-ai.md`). |
| C3 | Sorts de zone : centres dont la zone touche ≥ 1 cible utile ; on retient les 6 meilleurs centres par `quick` (nb de cibles pondéré, tir ami soustrait). |
| C4 | Sorts à case libre (invocation, téléportation, lancer de Pandawa, glyphe, piège) : 8 cases au plus, classées par une heuristique de **destination** : Δ(danger) pour un allié déplacé, Δ(menace) pour un ennemi déplacé (distance à nos alliés, sortie d'une ligne de l'Auroraire, entrée dans une zone d'alliés), couverture de passage pour un piège. |
| C5 | Sorts sur soi (`range = 0`) : case de lancer = position courante ou case atteinte. |
| C6 | `inverseRange(sp, t)` pré-calculée par (géométrie, t) : anneau [min, max] avec contrainte ligne/diagonale ; intersection avec `R` en O(taille de l'anneau). |
| C7 | Au plus 3 cases de lancer par (sort, cible) ; **toujours** la case actuelle si elle est valide (pas de déplacement inutile). |
| C8 | Préfiltre `quick` sans clone (§6.3) puis **quotas** : `damage 6, control 3, placement 3, heal 2, buff 2, debuff 2, summon 1, mark 1, utility 1` (standard) ; les candidats des indices de scénario passent hors quota. |
| C9 | Doublons : même (sort, cible, case de lancer) ⇒ un seul ; mêmes effets attendus à ±1 % ⇒ garder le moins cher en PM. |
| C10 | Interdits durs : lancer qui tue le lanceur en simulation (renvoi) ; piège posé sur son propre chemin restant ; dégâts sur un allié > 20 % de ses PV sans gain ≥ 2× ; sort non supporté. |
| C11 | Profondeur : arrêt quand plus aucun sort n'est lançable avec les PA restants, ou `maxDepth`. |
| C12 | Mouvements seuls : uniquement en finalisation (§8.3) ou comme levier (glyphe/piège) — jamais « bouger puis réfléchir » sans lancer. |

### 6.3 Préfiltre analytique `quick` (sans clone)

| Catégorie | Estimation (PV-éq.) |
|---|---|
| damage | Σ cibles `PotentialModel.expected(me, spell, e) × efficacitéZone` plafonné à PV+bouclier, + `κ·pvMax` si l'espérance tue ; − tir ami × 1,5 |
| control | Σ cibles `E[points retirés] × worth` avec `apWorth = threat/PA`, `mpWorth = threat × fraction de reach perdue` (lu dans le modèle de menace), + `0,9·threat` pour un état `cantDealDamage` |
| placement | Δ(danger) de l'allié déplacé ou Δ(menace) de l'ennemi déplacé à la case d'arrivée (heuristique C4) |
| heal / shield | `min(soin, pv manquants)` + valeur des poisons programmés retirés (buffs `TB` à dégâts sur la cible) |
| buff | Δ potentiel de l'allié buffé (table potentiel recalculée pour lui seul) |
| summon | `summonValue × pv de l'invocation` + potentiel estimé de l'invocation |
| mark (glyphe/piège) | valeur d'un tour d'effet sur les entités présentes/attendues |

Le préfiltre ne sert qu'au **tri** ; la simulation décide. Le test T-prefilter (§20) vérifie que le meilleur enfant
simulé figure dans le top-K du préfiltre ≥ 95 % du temps (sinon on corrige `quick`, pas K).

---

## 7. Fonction d'évaluation

### 7.1 Forme

`V(s)` est une valeur d'**état** du point de vue de l'équipe qui décide, en **PV-équivalents** (1 = un point de vie
d'un personnage allié). Les feuilles d'une même décision sont comparées entre elles ; les termes de kill utilisent la
racine (`ctx.root`) pour savoir qui est mort pendant le plan.

```
V(s) = allyLife + enemyLife + kills + threat + control + potential + position + resources + duties + scenario
```

### 7.2 Termes, unités et poids initiaux

| Terme | Formule | Poids initial | Justification |
|---|---|---|---|
| `allyLife` | Σ_a ω_a·(pv_a + `wShield`·bouclier_a + `wMaxHp`·pvMax_a) − Σ_{a mort} (`deathBase` + `deathFrac`·pvMaxBase_a + `allyDeathExtra`) | ω=1 ; `wShield` 0,8 ; `wMaxHp` 0,35 ; `deathBase` 2 500 ; `deathFrac` 0,5 | le bouclier s'use ; l'érosion réduit le soignable ; une mort coûte un 4e de la puissance d'équipe |
| `enemyLife` | − Σ_e v_e·(pv_e + bouclier_e) | v=1 (personnages/monstres), `summonValue` 0,4 (invocations) | dégâts effectifs, overkill nul (le PV ne descend pas sous 0) |
| `kills` | Σ_{e tués pendant le plan} `killValue` = `κ`·pvMax_e + `τ`·threatOf(e) ; remplacé par `scenario.killValue` s'il est défini | `κ` 0,3 ; `τ` 1,5 tour | retirer une menace vaut plus que ses PV (cohérent avec `monster-ai.md §8.4`) |
| `threat` | − `wThreat` · Σ_a [ min(inc_a, pv_a + bouclier_a) + P(mort_a)·coûtMort_a ] où `inc_a` = Σ des monstres qui jouent **avant** le prochain tour de a | `wThreat` 0,8 ; σ = 0,25·inc | menace « ordonnée par la timeline » : seul ce qui arrive avant que l'allié puisse bouger compte |
| `control` | `wCtrl` · Σ_e (ΔPA_e·apWorth_e + ΔPM_e·mpWorth_e) (Δ par rapport à la racine) | 0,25 | guide la recherche quand le monstre est trop loin pour que la menace change ; l'essentiel du contrôle passe par `threat` |
| `potential` | Σ_a w(a)·allyPotential(s, a), w = `wPotBefore` si a joue avant le prochain tour de l'ennemi principal, sinon `wPotAfter` | 0,4 / 0,2 | valorise les préparations : ennemi poussé dans la portée, débuff ×150 %, buff Puissance, ennemi regroupé pour une zone |
| `position` | `wFormation`·(soigneur à portée de soin des alliés) + bonus de case de glyphe positive − malus de case réservée par un autre allié | 0,1 | petits termes non couverts par menace/potentiel |
| `resources` | − Σ_{sorts lancés} `cdCost`·relance·valeurMoyenne(sort) + `summonValue`·pv(invocations vivantes) | `cdCost` 0,08 | coût d'opportunité d'une relance longue |
| `duties` | Σ_{devoirs de l'acteur} weight·satisfaction(s) ∈ [0,1] | poids du devoir (§11) | coordination douce |
| `scenario` | `wScenario` · (`quickTerms` ou `fullTerms`) | 1,0 | objectif du donjon (§14) |

Rôles : ω_a = 1,2 pour un soigneur unique ou le meilleur retireur, 1,0 sinon ; ω des invocations alliées = 0,4.

### 7.3 Modèle de menace (`threat.ts`)

Pour chaque ennemi actif `m` (vivant, ni corrompu ni statique, pouvant jouer) :

```
profil(m) = sorts offensifs avec (coût, portée, ligne/diag, LdV, zone, lancers/tour, /cible) ; ap, mp au PROCHAIN tour de m
reach_m   = BFS (GridSearch) depuis m.cell sur ⌊mp⌋ et ⌈mp⌉ (interpolation si mp fractionnaire, H2),
            coût de tacle attendu pour quitter un contact
pour chaque allié a (case c) :
   hit(sp, a) = ∃ p ∈ reach_m ∩ inverseRange(sp, c) avec LdV (si castTestLos) en considérant les occupants actuels
   dmg(m, a)  = sac à dos sur les sorts touchables (PA de m, limites /tour et /cible), dégâts = expectedDamage
                (stats de m incluant ses buffs, résistances de a, critique) ; + états à valeur (Pacifiste sur nous :
                0,9 × potentiel de a perdu) ; + poussée/collision approximée
choix de cible(m) = imitation de l'IA monstre : argmax_a (min(dmg, pv) + kill) ; part « déversée » `threatSpill` 0,25
                    sur la 2e meilleure cible (robustesse)
inc_a = Σ_{m jouant avant le prochain tour de a} part(m→a) · dmg(m, a)
      + dégâts programmés sur a avant son tour (poisons `TB`, effets différés, glyphes)        (déjà dans les buffs)
      + scenario.extraThreat(a, c)                                                            (lignes de l'Auroraire)
```

Coût : ≤ 8 ennemis × 4 alliés × 4 sorts × ~30 cases d'anneau ≈ 4 000 tests ⇒ 10-20 µs grâce aux révisions
(seuls les ennemis/alliés modifiés sont recalculés). Le modèle est **vérifié** contre les rollouts (test T-threat :
corrélation ≥ 0,8 entre `inc_a` prévu et dégâts réellement subis dans le rollout du monstre suivant).

### 7.4 Modèle de potentiel (`potential.ts`)

Symétrique de la menace : pour chaque allié `a` jouant avant la prochaine riposte, meilleur tour de dégâts sur les
ennemis **vulnérables à ce moment** (`scenario.vulnerableAt` : vague invulnérable 1 tour, Vortex Marginal, Vortex
invulnérable pendant Action !) avec ses PA/PM du prochain tour, son reach et l'anneau de portée de ses sorts ;
`allyPotential = max_e [min(dmg, pv_e) + P(kill)·killValue_e]` (+ 0,3 × 2e meilleure cible pour les sorts de zone).
C'est le terme qui récompense les **mises en place** : rapprocher un monstre de notre Iop, le regrouper pour un
Crâ de zone, appliquer « Dommages subis ×150 % » avant le coup d'un allié.

---

## 8. Recherche par tour : beam search

### 8.1 Pseudo-code

```
planTurn(engine, fight, me, cfg) -> TurnPlan
  ctx = rootContext(engine, fight, me, cfg)             // modèles synchronisés, scenario.prepare, tableau noir
  if quietTurn(ctx): cfg' = quietBudget(cfg)            // aucun ennemi actif ne peut atteindre/être atteint sous 2 tours
  if key = keyDecision(ctx) and ctx.keysUsed < maxKeyDecisions: return mcts(ctx, key)   // §10
  root = Node(state=fight, actions=[], v=evalQuick(ctx, fight))
  beam = [root]; leaves = [root]; seen = Map<hash, value>
  for depth in 1..maxDepth:
    children = []
    for n in beam:
      cands = selectWithQuotas(generate(ctx, n.state, me), topK)         // §6
      for (i, a) in enumerate(cands):
        if ctx.counters.nodes >= maxNodes·(1 − replanFraction): break outer
        s = simulate(ctx, n.state, a, salt = hash(n) ^ depth)          // même salt pour les frères
        if s == null: continue
        v = evalQuick(ctx, s)  (+ split léthal §5.4 si ambigu et pas encore splitté sur ce chemin)
        h = stateHash(s); if seen[h] >= v: continue; seen[h] = v
        children.push(Node(s, n.actions + [a], v))
    if children empty: break
    beam = selectDiverse(children, W)                                   // §8.2
    leaves.push(...beam)
  finals = []
  for L in topByValue(leaves, 2W):                                      // §8.3 finalisation
    finals.push(bestEndMove(ctx, L))                                    // P cases, chemin défaut, simulé
  top = topByValue(finals, shortRollouts)
  for F in top: F.v = combine(F, rolloutShort(ctx, F), pessimism)       // §9
  for F in top[0 .. roundRollouts): F.v = mix(F.v, rolloutRound(ctx, F), rolloutMix)
  for F in top: F.v += scenario.fullTerms(F.state) − scenario.quickTerms(F.state)   // planificateur complet
  best = argmax(top, v) avec départage (moins de PM, puis prior du 1er acte, puis key lexicographique)
  return TurnPlan(best, alternatives = top[1..3], intents = rollout de tour complet de best)
```

### 8.2 Sélection diverse du faisceau

`selectDiverse(children, W)` :

1. trier par valeur décroissante ;
2. **réserver un emplacement** au meilleur enfant contenant une action non-`damage` (contrôle, placement, buff,
   soin, marque, levier de scénario) si sa valeur ≥ `best − 0,3·|best − root|` ;
3. remplir le reste en refusant un 3e enfant ayant la même **signature structurelle** (multiensemble des catégories +
   identité du 1er sort) ;
4. compléter par valeur si le faisceau n'est pas plein.

But : empêcher que le faisceau ne contienne que des variantes de « frapper plus fort », ce qui tuerait les lignes du
type « retirer 4 PM au Buboxor puis frapper » qui ne paient qu'au tour suivant.

### 8.3 Finalisation (déplacement de fin de tour)

Pour chaque feuille : cases atteignables avec les PM restants (chemin défaut), notées sans clone par
`−wThreat·dangerAt(c) + potentiel(c) + scénario(c)` ; les `endCells` (P = 6) meilleures sont simulées (le
déplacement peut déclencher tacle/glyphe), puis évaluées. « Rester » est toujours candidat ; un déplacement qui
rapporte < 5 PV-éq. est refusé (pas de mouvements nerveux).

### 8.4 Exécution et replanification

Le `GroupBrain` exécute la **première** macro-action du meilleur plan dans le vrai combat (`rollMode: 'random'`),
puis compare le résultat à l'espérance (`|ΔV| > 5 %`, mort, coup critique, retrait raté) :

* conforme : on exécute l'action suivante du plan sans recalcul ;
* divergent : **replanification** à chaud (le faisceau est réensemencé avec le suffixe du plan) avec le budget
  `replanFraction` (35 %) restant. C'est l'équivalent joueur de la règle R10 (« utilise tous ses PA s'il rate un kill »).

---

## 9. Réponses adverses : rollouts

### 9.1 Rollout court (réponse des monstres)

```
rolloutShort(ctx, F):
  s = clone(F.state); engine.endTurn(s, me)
  loop:
    f = engine.nextTurn(s); if !f or s.ended: break
    if f.team == ctx.side and f.kind == 'player': break          // début du tour de l'allié suivant (TB appliqués)
    policy = f.team == ctx.side ? fastPlayer : monsterBrain(f, mode='fast')
    policy.playTurn(engine, s, f); if !s.ended and f.alive: engine.endTurn(s, f)
  return V(s)          // la menace restante (monstres jouant plus tard) reste estimée par le modèle analytique
```

Avec la timeline alternée (P1 M1 P2 M2 …), le rollout court rejoue en général **un** monstre (et nos invocations) :
≈ 1-3 ms. L'état d'arrivée est le **début** du tour de l'allié suivant : avance de l'horloge, étoiles « Même heure »,
poisons et vagues y sont déjà appliqués par le moteur.

### 9.2 Pessimisme (anti-surapprentissage)

L'IA monstre est déterministe en espérance ; un plan qui ne marche que parce que le monstre fera exactement *ce*
choix est fragile (et irréaliste si notre IA monstre n'est pas parfaitement fidèle). Pour le 1er monstre du rollout,
on évalue aussi ses `pessimismAlternatives` (2) meilleures décisions suivantes (fournies par `MonsterBrain.alternatives`)
:

```
v = (1 − β)·V(réponse prévue) + β·min(V(alternative_i))       β = 0,3 (réglé par CMA-ES)
```

### 9.3 Rollout de tour complet (coordination)

Pour les `roundRollouts` (2) meilleurs plans : on continue jusqu'au **prochain tour du décideur**, alliés joués par
`fastPlayer` (avec le tableau noir courant), monstres par leur IA `fast`. Valeur finale :
`v = λ·v_court + (1 − λ)·v_tour`, λ = 0,5. Le rollout produit aussi les **intentions** (`Intent`) des alliés
suivants (« P2 tuera la Harpille ») écrites au tableau noir si le plan est choisi.

---

## 10. MCTS pour les décisions clés

### 10.1 Déclencheurs (`keys.ts`)

| Code | Condition |
|---|---|
| `corruptionKill` | le planificateur a un contrat de corruption pour cet allié dans ce créneau, ou un monstre étoilé est atteignable |
| `allyDeathRisk` | sous le meilleur plan du beam, P(mort d'un allié avant son tour) ≥ 30 % |
| `closeCall` | les 2 meilleurs plans diffèrent par leur 1re action et `|v1 − v2| < 150` PV-éq. |
| `burst` | potentiel combiné de l'équipe sur ce tour de jeu ≥ PV d'un boss/ennemi majeur vulnérable (phase 2 du Vortex) |
| `waveArrival` / `phaseChange` | tour d'arrivée d'une vague, Action !, premier tour vulnérable du Vortex |

Plafond : `maxKeyDecisions` par combat (standard 8, deep 30) ; au-delà, beam standard.

### 10.2 Algorithme

```
mcts(ctx, reason):
  rootActions = top-N plans d'un beam réduit (W=4, K=8, sans rollouts) + plan fastPlayer          // N = 6
  for it in 1..mctsIterations:
    diceSeed = ctx.rng.next()                                     // dés tirés : branches de hasard en boucle ouverte
    node = root; s = clone(root.state, rollMode='random', rngState=diceSeed)
    // sélection / expansion sur les décisions ALLIÉES ; les tours de monstres sont simulés (IA fidèle, dés réels)
    while node is expanded and not terminal and depth < H:
      a = UCT(node, c = 0,7)  avec élargissement progressif : k(n) = ⌈1,5·√n⌉ enfants
      apply plan a sur s ; jouer les tours suivants jusqu'à la prochaine décision alliée (monstres fast)
      node = child(node, a)
    if node not expanded: node.actions = beamRéduit(s, allié courant) (cache par nœud) ; expand 1
    v = simulation jusqu'à l'horizon (fin du tour de jeu suivant) : alliés fastPlayer, monstres fast ; V(s)
    backup(v normalisée par min/max courants)
  return plan racine le plus visité (égalité : meilleure moyenne)
```

* Horizon H : fin du **tour de jeu suivant** (≤ 8 tours de combattants). Les valeurs sont celles de §7.
* Hasard : chaque itération tire ses dés (`rollMode: 'random'`, graine d'itération) : la probabilité qu'un kill de
  corruption échoue, ou qu'un allié meure sur un coup critique, est donc **mesurée**, pas supposée.
* Budget standard : 300 itérations ≈ 1-1,5 s ; deep : 1 500 itérations.

---

## 11. Coordination d'équipe et rôles

### 11.1 Rôles inférés

1. `capabilities()` calcule, pour chaque personnage (stuff + variantes de sorts réelles), un vecteur de capacités
   contre une **cible de référence du scénario** (Vortex : moyenne pondérée des monstres de vague, esquive PM 0 + sagesse,
   résistances de chaque monstre) : dégâts/tour mono et zone, retraits attendus, soins, boucliers, placement,
   PV effectifs, invocations, portée, mobilité.
2. `ScenarioNeeds` (Vortex) : `{ mpRemoval: haut, heal: moyen (poison des Harpilles), dps: haut,
   placement: moyen, avoidLines: obligatoire }`.
3. `assignRoles` : affectation gloutonne (besoin le plus rare d'abord) au meilleur ratio capacité/coût
   d'opportunité ; un personnage peut porter 2 rôles. Les rôles **modulent des poids** (ω, `wCtrl`, devoirs) ; ils ne
   restreignent jamais les sorts.

### 11.2 Tableau noir

Mis à jour au **début du tour de chaque allié** (coût < 1 ms) :

* `focus` : ennemis triés par `threatOf × facilité de kill (pv / dpt de l'équipe)` + contrats du planificateur ;
* `duties` — générés par règles simples, chacun avec un poids en PV-éq. :

| Devoir | Génération | Satisfaction |
|---|---|---|
| `neutralize(m)` | les 2 ennemis les plus menaçants qui atteindront un allié ; acteur = meilleur `mpRemoval/apRemoval` disponible avant leur tour | `1 − inc(m→alliés) après / avant` |
| `protect(a)` | allié avec P(mort) ≥ 20 % ; acteurs = soin/tank/placeur | baisse de P(mort_a) |
| `cleanse(a)` | poison programmé (Harpille : retiré par n'importe quel soin) ; acteur = tout allié ayant un soin | buff de poison absent |
| `kill(m)` / `prepare(m, pv)` | contrats du planificateur Vortex | m tué par l'acteur à la bonne heure / pv_m ≤ cible |
| `block(m)` | ennemi de CàC qui menace le soigneur ; acteur = tank (tacle) | m au contact du tank, chemin coupé |
| `avoidLines` | lignes de l'Auroraire au prochain tour du Vortex ; tous les alliés jouant après le dernier allié avant le Vortex | case hors lignes |

* `intents` : prédictions issues du rollout de tour complet du plan choisi (« P2 tue la Harpille »). L'allié suivant
  reçoit un petit bonus de **cohérence** (100 PV-éq.) s'il réalise l'intention et qu'elle reste dans son top-3 :
  évite les oscillations (deux alliés qui s'attendent mutuellement).
* `reservedCells` : la case de fin de tour choisie par un allié est réservée pour les alliés suivants (malus 50).

### 11.3 Invocations alliées

Contrôlées par le `GroupBrain` (Maîtrise des invocations) avec un budget réduit (`fast`), les mêmes termes
d'évaluation (ω = 0,4) et le tableau noir ; une invocation qui joue juste après son invocateur est simulée dans le
rollout court de celui-ci, ce qui valorise correctement « invoquer puis faire bloquer ».

---

## 12. Comment la créativité émerge

Aucun « truc » n'est écrit en dur. Cinq mécanismes le produisent :

1. **Complétude** : tous les sorts lançables sont candidats (C1-C12) ; les quotas garantissent qu'au moins 3 actions de
   contrôle, 3 de placement, 2 de soin/buff sont **simulées** à chaque nœud.
2. **Menace ordonnée** : retirer 3 PM au Buboxor qui jouera avant notre Eniripsa fait chuter `inc_Eniripsa` → valeur
   directe ; aucun poids « retrait PM » n'est nécessaire (le `wCtrl` est un simple guide).
3. **Potentiel** : pousser/attirer un monstre dans l'anneau de portée de l'Iop, appliquer ×150 %, regrouper pour une
   zone, porter (Pandawa) un allié hors de la ligne de l'Auroraire : valeur par `potential` et `threat`.
4. **Séquences** : le beam trouve les combos intra-tour (porter puis jeter ; retirer la LdV puis se déplacer ;
   glyphe +1 heure **puis** kill de corruption dans le même tour) ; le MCTS trouve les combos inter-tours.
5. **Objectif de scénario** : l'horloge transforme « marcher dans la glyphe de l'Ikargn » en action de grande valeur
   quand elle aligne une étoile sur notre meilleur tueur.

Comportements attendus **sans règle dédiée** (ils forment la suite de puzzles de §20.3) : Enutrof qui immobilise le
Buboxor ; Pandawa qui stabilise/porte avant le tour du Brabuzar ; soin juste pour retirer le poison des Harpilles ;
sortir de la ligne 1-3 d'une Méjaire avant son tour (Pacifiste) ; finir un monstre étoilé avec un poison ou une
invocation qui jouent dans la fenêtre de l'étoile ; ne pas tuer un monstre « neuf » à V/XI ; coller un corrompu
(invulnérable, passe ses tours) devant l'équipe comme mur.

Mesure : `explain.ts` tague un tour « créatif » quand le plan choisi bat le meilleur plan **purement offensif** de plus
de 15 % et contient une action non offensive ; le rapport compte ces tours et le replay les annonce
(`{ t: 'log', level: 'ai', text: 'Enutrof retire 4 PM au Buboxor : il n'atteindra pas l'Eniripsa (−1 850 PV évités)' }`).
Ablation (§20.4) : interdire les sorts non offensifs doit faire chuter le taux de victoire, sinon la créativité est
décorative.

---

## 13. IA des monstres

### 13.1 Reprise de `monster-ai.md §8`

La conception de référence (cerveau générique glouton avec replanification, candidats « (déplacement) + sort + cible »,
score delta en PV-équivalents §8.4, score de position par comportement §8.6, profils déclaratifs et overrides
`beforeTurn/filterCast/scoreCast/endPosition`, archétypes inférés §3, effet 2188 → `fighter.tags.aiBehaviour`,
règles R1-R25) est **adoptée telle quelle**. Ce document précise seulement l'intégration :

| Point | Décision |
|---|---|
| Infrastructure | `monster/candidates.ts` réutilise `core/reach.ts`, `core/candidates.ts` (énumération) et `core/sim.ts` ; seul le score diffère (score delta monstre, pas `V(s)` joueur). |
| Modes | `faithful` (combat réel : topK 24, replanification après chaque lancer) ; `fast` (rollouts et Monte-Carlo : topK 8, mêmes règles). Test d'accord `fast` vs `faithful` ≥ 95 % des décisions identiques (T-agree). |
| Aléa | décisions en espérance ; départages par un `Rng` IA dérivé `aiSeed(fightSeed, id, round, k)` — jamais `fight.rngState` (le flux de dés reste indépendant de la réflexion). |
| Bruit | `monsterNoise` τ (softmax sur le top-3) : 0 en démo ; {0 ; 0,1} en Monte-Carlo de robustesse. |
| Alternatives | `MonsterBrain.alternatives(state, k)` renvoie les k meilleurs plans pour le pessimisme (§9.2). |
| Smart/beam | non utilisé par défaut (R25) ; activable par profil (Brabuzar, Ikargn) si les golden tests T3/T5 l'exigent. |
| Réglage | **jamais** optimisé pour gagner ; les poids monstres ne bougent que pour passer les golden tests T1-T10. |

### 13.2 Profils Vortex (`src/dungeons/vortex/profiles.ts`)

Repris de `monster-ai.md §7.3` (Ikargn agressif + ordre Attraction → Cercle → Terre mythe ; Méjaire kiter avec valeur
de Pacifiste = menace ; Harpille kiter + Petit poison dès que prêt ; Buboxor agressif + bouclier si aucune cible + PM
volés = mobilité ; Brabuzar agressif combos de poussée ; Vortex override en 2 phases ; Auroraire statique). Les
monstres **corrompus** (état 6611, tour annulé) ne jouent pas : le moteur saute leur tour, l'IA n'est pas appelée.

### 13.3 Le modèle de menace imite le choix de cible monstre

`threat.ts` utilise la même préférence que le score monstre (dégâts effectifs plafonnés + bonus de kill, Pacifiste =
menace évitée). Un test croisé (T-threat-target) vérifie que la cible prédite par le modèle est celle choisie par
`MonsterBrain` dans ≥ 85 % des situations du corpus de test.

---

## 14. Œil de Vortex : horloge, corruption, phase 2

### 14.1 Modèle d'horloge (`clock.ts`, pur, sans simulation)

Lecture de l'état (aucune règle dupliquée : ce sont les états posés par les données) :

```ts
export type Hour = 1|2|3|4|5|6|7|8|9|10|11|12
export const HOUR_STATE_BASE = 220                  // états 221..232 = heures I..XII
export const SAME_HOUR = 234, CORRUPTED = 6611, MARGINAL = 236, ZOMBI = 74
export function currentHour(f: FightState): Hour                  // état d'heure de l'Auroraire (3833)
export function deathHours(m: Fighter): number                    // masque 12 bits des états 221..232
export function isCorrupted(m: Fighter): boolean
export function hasStar(m: Fighter): boolean
export interface ClockSlot { index: number; round: number; fighterId: number; isPlayer: boolean; isVortex: boolean; hour: Hour }
/** Heures pendant chaque tour à venir ; extraGlyphs[slot] = +k heures déclenchées pendant ce créneau. */
export function forecast(f: FightState, rounds: number, extraGlyphs?: ReadonlyMap<number, number>): ClockSlot[]
export function auroraireCell(h: Hour): number                    // table vortex.json (map.auroraire.hours[])
export function lineCells(h: Hour): number[]                      // cases en croix (même x ou même y), cache
```

Règles encodées dans `forecast` (et **vérifiées** contre le moteur, test T-clock) : +1 heure au début du tour de chaque
**personnage vivant** ; +1 par glyphe de monstre déclenchée (immédiat, au milieu du tour) ; un monstre vivant non
corrompu reçoit l'étoile quand l'horloge **arrive** sur une de ses heures ; l'étoile disparaît au Décalage suivant ;
résurrection de tous les morts au début du tour du Vortex (20-30 % PV, 25 % retenu en moyenne) ; vagues aux tours
`params.waveRounds` (défaut 1, 7, 12, 17, 22) invulnérables 1 tour ; Action ! selon `params.actionDelay`.

Fenêtre de corruption d'un monstre `m` pour le créneau du personnage `p` : `[début du tour de p, début du tour du
personnage suivant)` — elle couvre le tour de `p`, de ses invocations et des monstres intercalés (poisons/pièges qui
tuent pendant la fenêtre comptent).

### 14.2 Planificateur de corruption (`planner.ts`)

**État abstrait** (copie légère de l'état réel) :

```ts
interface AbstractMonster {
  id: number; alive: boolean; corrupted: boolean; invulnerableUntil: number
  hp: number; maxHp: number; hours: number /* masque */; threat: number /* PV-éq. par tour joué */
  hourBonus: number /* masque des bonus actifs */
}
interface AbstractState {
  slot: number; hour: Hour; monsters: AbstractMonster[]; pendingWaves: { round: number; ids: number[] }[]
  alivePlayers: number[]; costSoFar: number; contracts: KillContract[]
}
interface KillCapacity {               // fourni par PotentialModel (dpt réels) et la distance actuelle
  dpt(playerId: number, monsterId: number): number          // dégâts attendus par tour (résistances, critique)
  reachProb(playerId: number, monsterId: number, roundsAhead: number): number   // 1 si à portée maintenant, décroît
  glyphProb(playerId: number, slot: number): number         // une glyphe de monstre atteignable dans ce créneau
}
export interface KillContract { slot: number; playerId: number; hour: Hour; monsterId: number; purpose: 'corrupt' | 'mark' | 'defensive'; confidence: number }
export interface KillSchedule {
  contracts: KillContract[]
  forbid: { slot: number; monsterId: number; reason: 'badHour' | 'noFollowUp' | 'waveSync' }[]
  glyphAdvances: { slot: number; when: 'beforeKills' | 'afterKills'; count: 1 | 2 }[]
  prepare: { slot: number; monsterId: number; targetHp: number }[]
  cost: number; etaAllCorrupted: number
}
```

**Actions par créneau de personnage `p`** (≤ 12 options après élagage) : sous-ensemble de kills faisables
(`Σ pv ≤ 0,9·dpt_p × reachProb`), avec une avance de glyphe optionnelle **avant** ou **entre** les kills (l'astuce
« glyphe puis kill » : l'étoile est posée par le Décalage déclenché par la glyphe), et des « préparations » (descendre un
monstre à X PV sans le tuer pour un kill ultérieur). Kills retenus en priorité : (a) monstres qui seront étoilés dans
ce créneau ⇒ `corrupt` ; (b) monstres sans heure dont l'heure courante est acceptable **et** qui ont une fenêtre de
re-kill dans l'horizon ⇒ `mark` ; (c) monstres très menaçants ⇒ `defensive`.

**Transitions** des créneaux non joueurs : résurrection au créneau du Vortex (hp = 25 % pvMax, ×1,3 si heure XI), vagues,
fin d'invulnérabilité, étoiles au début de chaque créneau joueur.

**Coût** (PV-éq.) :

```
cost = Σ_{créneaux monstres} Σ_{m actif qui joue} threat_m                              // dégâts subis attendus
     + Σ_{premiers kills} hourCost(m, h) · E[nb de résurrections avant corruption]        // bonus d'heure
     + Σ_{contrats} (1 − confidence) · 3 tours · threat_m                                   // risque d'échec
     + terminal : Σ_{m non corrompu à l'horizon} threat_m · roundsToCorrupt(m)             // 3 si heure connue, 4,5 sinon
     + μ · max(0, etaAllCorrupted − déverrouillagePossible)                               // retard (μ = 200 / tour)
```

**`hourCost(m, h)` calculé, pas tabulé** : on applique le bonus de l'heure h (données des sorts 5002) à un clone du
monstre et on mesure `Δ threatOf(m)` avec le modèle de menace (pour +400 Int, ×1,42 sur ses sorts Feu ; pour V, ×1/0,7
sur les dégâts nécessaires = PV effectifs ; pour VIII, un 4e sort par tour…) :
`hourCost = Δthreat × tours vivants attendus + Δ(pv effectifs) × 0,5`. Les « heures confortables » des guides (III, VI,
VIII, IX, XII pour les heures de mort ; éviter V, XI, I) **ressortent** de ce calcul — c'est un test (T-hours).

**Recherche** : beam sur les créneaux (largeur 32, horizon 3 tours de jeu = 12 créneaux joueurs à 4 personnages,
≈ 9 000 transitions, 1-3 ms). Replanifié au début du tour de chaque allié ; sortie = `KillSchedule` posé au tableau noir.

### 14.3 Branchement dans l'évaluation (`objective.ts`)

* `prepare(ctx)` (racine) : `schedule = planner.plan(...)` ; table `killValue[m]` pour chaque monstre tuable ce tour
  = `cost(plan sans ce kill) − cost(plan avec ce kill à l'heure courante)` (≤ 8 appels × 2 ms en standard ; en `fast`,
  version statique : `corruption 4 000`, `mark` = `κ·pvMax − hourCost`, `badHour` = −1 500) ; `glyphValue` = gain de
  coût d'un +1 heure maintenant ; lignes de l'Auroraire prévues au prochain tour du Vortex.
* `quickTerms(s)` : Σ des `killValue` des monstres morts dans `s` (l'heure réellement tamponnée est lue sur la victime :
  l'heure a pu bouger pendant le tour via une glyphe) + `glyphValue × heures avancées` + corruption `+4 000` par monstre
  corrompu (valeur de base, réglée par CMA-ES) + respect des `forbid` (−1 500).
* `fullTerms(s)` : relance du planificateur sur l'abstraction de `s` (feuilles retenues uniquement) : `−cost`.
* `extraThreat(a, c)` : *En temps et en heure* si `c ∈ lineCells(heure au prochain tour du Vortex)` et que `a` ne
  rejoue pas avant : 500 Terre de base (Auroraire sans caractéristiques, résistances de a) + 50 % des PV érodés + coût
  d'érosion (+20 % pendant 2 tours ⇒ `wMaxHp`) ; Morfaille/Heuristique en phase 2 via le modèle générique.
* `allyDeathExtra` : une mort change N (cycle de l'horloge) ⇒ + coût du planificateur recalculé avec N − 1.
* `hints` : glyphes de monstres atteignables si `glyphValue > 200` ; cases hors lignes de l'Auroraire pour la fin de tour.
* `isKeyDecision` : contrat `corrupt` dans le créneau courant, arrivée de vague, Action !, premier tour vulnérable.

### 14.4 Phase 2 (Vortex vulnérable)

* Les 2 tours « à vide » (Vortex invulnérable/tour annulé) : `vulnerableAt(Vortex, +k)` indique au potentiel que les
  dégâts comptent **au tour où il redevient vulnérable** ⇒ les plans qui buffent (Âge d'Or, Puissance), se placent hors
  de sa future ligne (8 PO **sans LdV**) et préparent le burst gagnent naturellement.
* Le premier tour vulnérable est une décision `burst` : MCTS deep sur l'enchaînement des 4 alliés (horizon = tour du
  Vortex). Objectif dominant : `P(Vortex mort avant de jouer)` ; sinon minimiser sa menace (sortir de ses lignes,
  retrait de PM malgré 20 d'esquive, Pacifiste évité).
* Heurage (tous les 3 tours, téléportation au contact de l'Auroraire) est prévu par `forecast` : le danger autour de
  la future case de l'Auroraire est ajouté par `extraThreat`.

### 14.5 Paramètres incertains

`vortex.md §14` liste les désaccords (tour de la vague 2, k = 3 ou 4, délai d'Action !, PV de résurrection, −1 PM…).
Tous sont des `Scenario.params` ; le Monte-Carlo de robustesse (§17.2) tire ces variantes et le rapport indique la
sensibilité du taux de victoire à chacune.

---

## 15. Aléa et graines

| Niveau | Graine | Usage |
|---|---|---|
| maîtresse | `master` (CLI `--seed`) | une campagne d'optimisation |
| combat | `fightSeed = mix32(master, i)` | `FightOptions.seed` → `fight.rngState` : **seuls** dés du combat réel (dégâts, CC, esquives, groupes aléatoires) |
| IA | `aiSeed(fightSeed, fighterId, round, k)` | `Rng` sfc32 de l'IA : départages, bruit monstre, dés des itérations MCTS |
| nœud de recherche | `mix32(aiSeed, hash(parent) ^ depth)` | `rngState` des clones : **le même pour tous les frères** (nombres aléatoires communs internes) |

Propriétés exigées (tests §20.5) :

1. **Reproductibilité** : (équipe, config IA, version moteur/données/IA, `fightSeed`) ⇒ combat identique, que
   `record` soit vrai ou faux, quel que soit le worker. Conséquence : les budgets sont exprimés en **nœuds**, jamais en
   millisecondes (un garde-fou temps existe mais ne fait que journaliser un avertissement) ; l'IA ne lit jamais
   `fight.events`.
2. **Indépendance réflexion/dés** : la réflexion n'avance jamais `fight.rngState` du vrai combat (les clones ont leur
   propre copie).
3. **Replay à la demande** : les batchs ne stockent que des résumés ; un combat intéressant est **rejoué** avec
   `record: true` pour produire les événements animés.
4. **CRN** : deux configurations comparées utilisent les mêmes `fightSeed`. Amélioration proposée au moteur (option,
   §22) : RNG **à clé** `rngMode: 'keyed'` — le tirage n° j du lancer n° i du combattant f au tour r vaut
   `mix32(seed, f, r, i, j)` — pour que deux stratégies qui jouent la même action au même moment obtiennent les mêmes
   dés malgré des historiques différents (réduction de variance attendue : ×2-4 sur les comparaisons).

---

## 16. Budgets de calcul

### 16.1 Préréglages (1 cœur ; nœud ≈ 70 µs, feuille ≈ 20 µs)

| Niveau | Beam W/K/D | Nœuds/tour | Rollouts (court/tour) | MCTS | ms par tour joueur | Combat Vortex (~36 tours de jeu) |
|---|---|---|---|---|---|---|
| `random` | — | 0 | — | — | < 0,1 | < 0,2 s |
| `scripted` | — | 0 | — | — | < 0,2 | < 0,3 s |
| `fast` | glouton, K=8 (+2 utilitaires) | ≈ 30 | 0 / 0 | — | 2-3 | **< 1 s** |
| `standard` | 6 / 12 / 8 | ≤ 2 500 | 4 / 2 (+ pessimisme 2) | 300 it. × ≤ 8 | 120-180 | **< 30 s** |
| `deep` | 10 / 16 / 10 | ≤ 12 000 | 8 / 4 | 1 500 it. × ≤ 30 | 0,5-3 s | 2-5 min |

Décompte du **standard** pour un tour normal : préparation racine (menace, potentiel, planificateur + table de kills)
≈ 20 ms ; beam ≈ 300 nœuds ≈ 21 ms + génération ≈ 7 ms ; finalisation ≈ 3 ms ; 4 rollouts courts + alternatives
≈ 35 ms ; 2 rollouts de tour complet ≈ 50 ms ; replanifications ≈ 40 ms ⇒ ≈ 175 ms. Sur un combat : ~90 tours
normaux (16 s) + ~45 tours calmes à budget réduit (1 s) + ≤ 8 décisions clés MCTS (≈ 8-10 s) + tours monstres réels
(~150 actifs × 4 ms ≈ 0,6 s) ⇒ **≈ 26-28 s**.

Décompte du **fast** : ~140 tours joueurs × 2,5 ms + ~150 tours monstres en mode `fast` × 1,5 ms + moteur ≈ 0,1 s ⇒
**≈ 0,7 s**. Les monstres corrompus ne coûtent rien (tour sauté).

### 16.2 Ingénierie de performance (prérequis M1)

* `reach` en tableaux typés (`GridSearch`, ≤ 5 µs au lieu de 31 µs) ; anneaux de portée pré-calculés par carte.
* LdV : cache par (case de départ, case d'arrivée, révision d'occupation).
* `scenarioState` du Vortex **petit et plat** (le clone fait un `structuredClone`) ; l'état d'horloge vit dans les
  états/buffs des combattants (données) plutôt que dans `scenarioState`.
* Aucune allocation dans les boucles chaudes du préfiltre (tableaux réutilisés, `expectedDamage` sans copie).
* Mémoire : un faisceau standard garde ≤ 6 × 12 × 8 ≈ 600 clones (≈ 3-6 Mo) ; seuls les nœuds du faisceau courant
  restent référencés.
* `bench.ts` (CLI) mesure µs/nœud, nœuds/s, ms/tour par niveau ; un test de non-régression échoue si
  `fast` > 1,2 s ou `standard` > 36 s sur le combat de référence (seuils + 20 %).

---

## 17. La boucle d'itérations

### 17.1 Étages

| Étage | Itère sur | Évaluation | Ordre de grandeur |
|---|---|---|---|
| E0 | actions d'un tour | simulation + `V(s)` | 30 (fast) à 12 000 (deep) nœuds |
| E1 | graines (Monte-Carlo) | taux de victoire + `progress` | 16-200 combats |
| E2 | paramètres de stratégie θ | CMA-ES sur E1 (CRN) | ~10 000 combats `fast` |
| E3 | stuff + variantes d'un personnage | proxys analytiques puis E1 | 50 000 stuffs notés, ~2 000 combats |
| E4 | composition (19 classes) | prior analytique puis racing E1 | ~5 000 combats `fast` + 128 `standard` |
| E5 | une graine donnée (rembobinage) | recherche d'une ligne gagnante | démonstration uniquement |

`progress` (pour départager les défaites, tout en [0,1]) = 0,45 × corrompus/19 + 0,15 × [déverrouillé]
+ 0,30 × dégâts au Vortex/PV + 0,10 × alliés vivants/4. Score d'un combat : `win ? 1 + 0,1·(1 − tours/60) : 0,8·progress`.

### 17.2 E1 — Monte-Carlo

* `runBatch` répartit les graines par paquets de 8 sur le pool de workers ; résultats rangés par graine
  (indépendants de l'ordonnancement).
* Statistiques : taux de victoire avec **intervalle de Wilson** à 95 %, moyenne/quantiles des tours, morts, PV perdus,
  corruptions, dégâts au boss ; variantes de `Scenario.params` tirées si `robust: true` (k, vague 2 au tour 6/7,
  délai d'Action !, PV de résurrection 20/25/30 %, `monsterNoise` 0/0,1).
* Comparaisons : graines communes (CRN) + **SPRT** (H0 : p_A = p_B, H1 : |p_A − p_B| ≥ 5 points) pour arrêter tôt.
* Cache (`cache.ts`) : clé = (version moteur, version données, version IA, scénario + paramètres, équipe, θ, niveau,
  graine) ⇒ `FightSummary` en JSONL dans `.cache/sim/`. Une modification du moteur invalide tout automatiquement.

### 17.3 E2 — Réglage des poids (CMA-ES)

* θ (≈ 22 dimensions, espace **logarithmique** pour les poids positifs, σ₀ = 0,3) : `wThreat, wPotBefore, wPotAfter,
  κ, τ, deathBase, deathFrac, wShield, wMaxHp, wCtrl, summonValue, cdCost, β (logit), λ (logit), threatSpill,
  deathSigma, ω_soin, corruptionValue, hourCostScale, glyphScale, forbidPenalty, wFormation`.
* Fitness : moyenne du score de combat (§17.1) sur **24 graines CRN par génération**, renouvelées à chaque
  génération (anti-surapprentissage), en mode `fast`, sur 2-3 équipes représentatives (pour que θ ne soit pas
  spécifique à une compo). λ = 12, μ = 6, 40 générations ⇒ 12 × 40 × 24 × 3 ≈ 34 500 combats ≈ 1,7 h sur 4 workers
  (≈ 0,7 s/combat). Gestion du bruit : ré-évaluation du meilleur de chaque génération sur 48 graines.
* Validation : θ* évalué en `standard` sur 64 graines réservées (jamais vues) ; on retient θ* seulement s'il bat θ₀ avec
  SPRT. Sorties versionnées : `data/ai/weights/vortex.json` (+ `generic.json`).
* **Distillation** (« self-play » au sens expert-iteration) : on journalise (état racine, candidats, plan choisi en
  `standard`/`deep`) sur ~200 combats ; on règle ensuite θ_fast pour **maximiser l'accord** de la politique `fast`
  avec ces choix (perte de rang logistique, CMA-ES ou descente par coordonnées). Le Monte-Carlo rapide devient ainsi
  plus représentatif de l'IA lente.
* Les monstres ne sont **pas** réglés (fidélité) ; la robustesse vient du bruit monstre et du pessimisme.

### 17.4 E3 — Stuff, exos et sorts

1. **Viviers par emplacement** : objets niveau ≤ 200, conditions satisfiables ; projection sur un vecteur de
   caractéristiques utiles au rôle (élément(s), Vitalité, % do, Puissance, CC, PA, PM, PO, résistances, retrait, tacle) ;
   filtre de **Pareto** par emplacement (≈ 20-60 objets) ; les objets de panoplie sont conservés si la panoplie peut
   atteindre ≥ 2 objets.
2. **Proxys analytiques** (`proxies.ts`, ≈ 20 µs par stuff via `computeBuildStats`) :
   * `DPT` = meilleure **rotation** de 12 PA (sac à dos sur les sorts de la classe avec les variantes du rôle, limites
     par tour/cible, `expectedDamage` contre les résistances de la cible de référence, CC inclus) ;
   * `EHP` = PV / (1 − rés. % moyenne pondérée par les éléments reçus dans le donjon) + rés. fixes ;
   * `UTIL` = retrait PM/PA attendu par tour contre l'esquive de référence (rôle retrait), soins/tour (rôle soin) ;
   * objectif `J = DPT^a · EHP^b · (1 + c·UTIL)` × pénalités (PA < 11, PM < 5, PO insuffisante pour la rotation), avec
     (a, b, c) par rôle (dps 0,7/0,3/0 ; tank 0,2/0,8/0,2 ; retrait 0,3/0,4/1 ; soin 0,2/0,5/1).
3. **Recherche** : recuit simulé / recherche locale à grand voisinage sur les emplacements (remplacement d'objet,
   échange de panoplie, déplacement d'un exo PA/PM/PO — **un seul de chaque type**, plafonds 12/6, `equipment.md
   §11`), profil d'exos (`thlStandard` / `thlOptimized`), Dofus/trophées dans une **liste blanche** de passifs
   supportés par le moteur ; points de caractéristiques en forme close (`allocateAll` : tout dans l'élément principal,
   ou répartition bi-élément comparée) ; ≈ 50 000 stuffs notés en quelques secondes ; sortie = front de Pareto
   (DPT, EHP, UTIL) de 5 stuffs diversifiés par archétype.
4. **Variantes de sorts** (22 paires) : départ = tables « choix de variantes par rôle » des fiches de classe ;
   recherche locale par bascule de paire, chaque bascule évaluée par E1 (16 graines CRN, `fast`) dans le contexte de
   l'équipe ; seules les paires dont les deux variantes sont supportées par le moteur sont explorées.
5. **Sélection finale** par E1 dans l'équipe (racing entre les 5 stuffs du front).

### 17.5 E4 — Composition (19 classes)

1. **Archétypes** : (classe × rôle × élément) issus des fiches de classe ≈ 57 archétypes, chacun avec son stuff E3
   (proxys seuls à ce stade) et ses variantes de départ.
2. **Prior analytique** (`prior.ts`, ≈ 20 µs par équipe) sur tous les multiensembles de 4 archétypes
   (C(60, 4) ≈ 490 000, doublons de classe autorisés) : couverture des besoins du scénario (retrait PM, soin, dégâts
   dans les faiblesses des monstres — Feu/Terre/Neutre/Air/Eau −10 % —, placement), Σ DPT, min EHP, synergies tirées
   des sections « Synergies » des fiches (matrice de bonus), pénalités (aucun soin ⇒ coût du poison). Garde le top 400.
3. **Successive halving** en `fast` : 400 × 8 graines (≈ 9 min) → top 60 × 24 graines (≈ 4 min) → top 12 × 64 graines
   (≈ 4 min). Sélection par borne inférieure de Wilson + `progress` moyen.
4. **Co-optimisation** des 4 meilleures : E3 (variantes + stuff) dans l'équipe, alternée 2 fois (coordonnées).
5. **Validation** `standard` : 4 équipes × 32 graines (≈ 13 min sur 4 workers) ; meilleure équipe ⇒ rapport.
6. Option `evolve.ts` : algorithme génétique (mutation = remplacer un membre, croisement de stuffs) pour explorer
   hors du top du prior.

Durée totale d'une campagne Vortex complète : ≈ 1,5-2 h sur 4 cœurs (hors E2, mutualisé entre campagnes).

### 17.6 E5 — Rembobinage (« réussir CE combat »)

Pour une graine fixée : on enregistre un **instantané** (`cloneFight`) au début de chaque tour allié ; si le combat
est perdu, on remonte au tour où `V` a le plus chuté (ou à la décision clé la plus serrée), on rejoue depuis cet
instantané en `deep` avec une autre graine IA, et on itère (≤ 50 rembobinages). Le résultat prouve qu'une ligne
gagnante **existe** pour ces dés ; il est marqué « optimiste » dans le rapport (les dés réels ne sont pas connus à
l'avance) et n'entre jamais dans un taux de victoire.

### 17.7 Orchestration (CLI)

```
npm run sim -- vortex --team iop,cra,enutrof,eniripsa --ai standard --seed 42 --replay out/replay.json
npm run sim -- batch vortex --team ... --ai fast --runs 500 --robust
npm run sim -- tune vortex --generations 40 --pop 12 --seeds 24
npm run sim -- optimize vortex --stages prior,race,coopt,validate --hours 2
npm run sim -- rewind vortex --team ... --seed 42
```

---

## 18. Batch : `worker_threads` (Node) et navigateur

```ts
// src/optimizer/pool.ts
export interface WorkerPool { size: number; run(jobs: WorkerTask[]): AsyncIterable<WorkerResult>; close(): Promise<void> }
export interface WorkerTask { taskId: number; job: BatchJob; seeds: number[] }        // paquet de 8 graines
export interface WorkerResult { taskId: number; summaries: FightSummary[]; events?: Uint8Array /* replay compressé */ }
export function createNodePool(size = os.availableParallelism()): WorkerPool
export function createBrowserPool(size = navigator.hardwareConcurrency, bundle: DataBundle): WorkerPool
```

* Node : `new Worker(new URL('./worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] })` en dev, JS compilé
  en production ; chaque worker charge `loadDataStore('data', { eager: true })` **une fois**, installe le moteur
  (`installEffectCore` + familles d'effets) et garde les caches de cartes/anneaux entre tâches.
* Messages : tâches et résumés en JSON (petits) ; replays seulement sur demande (`record: 'events'`), transférés en
  `Uint8Array`.
* 4 CPU : 4 workers + thread principal d'orchestration (léger). Débit attendu en `fast` ≈ 5-6 combats/s
  (≈ 20 000/h) ; en `standard` ≈ 0,15 combat/s (≈ 500/h).
* Navigateur : même protocole avec des Web Workers et le lot `MemoryDataStore` ; niveaux `fast` et `standard`
  disponibles (le `standard` joue un combat de démo en arrière-plan, le visualiseur lit le replay une fois prêt).

---

## 19. Replays et explications

* Un combat retenu (meilleur, pire, médian, plus « créatif ») est **rejoué** avec `record: true` : mêmes graines et
  config ⇒ mêmes événements que dans le batch (§15).
* `explain.ts` émet, quand `cfg.explain` est vrai, des `{ t: 'log', level: 'ai' }` concis : plan choisi, 2
  alternatives avec leur écart, termes dominants (« menace −1 850, potentiel +620 »), contrat d'horloge
  (« P3 marque la Méjaire à VI ; corruption prévue tour 9 »). Ces textes sont produits **après** la décision et ne
  l'influencent pas (déterminisme).
* Le rapport Vortex (`report.ts`) : meilleure équipe, stuffs (objets, exos, caractéristiques), variantes de sorts,
  taux de victoire (IC), sensibilité aux paramètres incertains, frise des corruptions par heure et par tueur,
  liens vers les replays.

---

## 20. Plan de tests et de validation

### 20.1 Tests unitaires (vitest)

| Id | Objet | Critère |
|---|---|---|
| T-cand | générateur | tout candidat passe `canCast` ; sur 50 positions aléatoires, couverture = 100 % des (sort, cible) atteignables trouvés par force brute (toutes cases × toutes cibles) |
| T-prefilter | préfiltre | le meilleur enfant simulé est dans le top-K du préfiltre ≥ 95 % (corpus de 500 nœuds) |
| T-eval | monotonie | + dégâts ennemis ⇒ V ↑ ; + dégâts alliés ⇒ V ↓ ; kill ⇒ saut ≥ κ·pvMax ; invariance par permutation des ids |
| T-hash | transpositions | A puis B ≡ B puis A quand indépendants ; aucune collision sur 10⁶ états du corpus |
| T-threat | modèle de menace | corrélation ≥ 0,8 entre `inc_a` prévu et dégâts subis dans le rollout ; cible prédite = cible de `MonsterBrain` ≥ 85 % |
| T-lethal | split léthal | p estimé vs fréquence empirique (1 000 tirages `random`) à ±7 points |
| T-clock | horloge | `forecast` = heure de l'Auroraire du moteur à chaque créneau sur 30 tours (4, 3, 6, 8 joueurs ; glyphes ; mort d'un allié) |
| T-hours | coût des heures | `hourCost` classe V, XI, I parmi les 4 heures les plus coûteuses pour au moins 4 des 5 monstres |
| T-planner | planificateur | sur des états abstraits jouets : trouve « même tueur 3 tours plus tard » à 4 joueurs, « glyphe puis kill » quand le tueur est décalé d'une heure, refuse un kill à V s'il existe une alternative |
| T-agree | IA monstre fast | décisions identiques à `faithful` ≥ 95 % |
| T-det | déterminisme | même graine ⇒ même hash d'état final pour record on/off, 1 vs 4 workers, 2 exécutions |

### 20.2 Golden tests monstres

T1-T10 de `monster-ai.md §8.10` (Buboxor bouclier puis avance, Méjaire Pacifiste sur le Iop, Ikargn Attraction → Cercle
→ Terre mythe, Petit poison, collision du Brabuzar, Vortex phase 1/2, peureux R12, renvoi R7, corrompu qui ne joue
pas) + une ligne par règle R1-R25 testable.

### 20.3 Puzzles tactiques (la créativité attendue)

Positions construites à la main sur la carte du Vortex ; chaque puzzle affirme que le plan choisi **contient**
l'action clé (ou que sa valeur dépasse l'alternative naïve). Le taux de résolution par niveau est un benchmark
suivi (objectif : `standard` ≥ 90 %, `fast` ≥ 60 %).

| Puzzle | Action clé attendue |
|---|---|
| P1 Étoile | le tueur prévu achève le monstre étoilé (pas un autre allié hors fenêtre, pas de dégâts gaspillés ailleurs) |
| P2 Glyphe | traverser la glyphe d'un monstre (+1 heure) **puis** corrompre dans le même tour |
| P3 Mauvaise heure | ne pas achever à V un monstre neuf si un kill à VI est possible au tour d'un autre allié |
| P4 Immobiliser | Enutrof retire les PM du Buboxor qui atteindrait l'Eniripsa (au lieu de frapper) |
| P5 Porter | Pandawa porte/jette l'allié hors de l'Attraction ailée / de la ligne de l'Auroraire |
| P6 Poison | soin léger sur chaque allié empoisonné par la Harpille quand le soin vaut plus que les dégâts |
| P7 Pacifiste | le DPS sort de la ligne 1-3 de la Méjaire avant son tour, même au prix de dégâts |
| P8 Lignes | aucun allié ne finit dans une ligne de l'Auroraire au prochain tour du Vortex quand c'est évitable |
| P9 Préparation | ×150 % / poussée dans la zone de l'allié suivant plutôt qu'un coup direct plus fort |
| P10 Burst | phase 2 : séquence des 4 alliés qui tue le Vortex avant son tour quand c'est possible |
| P11 Mur | placer un monstre corrompu (invulnérable, passif) entre l'équipe et un Buboxor |
| P12 Kill sûr | préférer 2 sorts à kill certain à 1 sort à 55 % pour une corruption |

### 20.4 Combats de contrôle et ablations

* **Échelle de niveaux** : `random` < `scripted` < `fast` < `standard` ≤ `deep` (taux de victoire et `progress`, SPRT)
  sur 3 équipes de référence (dont Crâ + Enutrof + Iop + Eniripsa, citée par les guides).
* **Sanity** : 4 personnages contre un Ikargn seul sur carte vide ⇒ victoire 100 % en < 5 tours ; contrôleur passif
  ⇒ défaite ; combat miroir 4 v 4 joueurs ⇒ ≈ 50 % (pas de biais de camp).
* **Ablations** (Δ du taux de victoire, attendu significatif) : sans rollouts adverses, sans potentiel, sans
  pessimisme, sans planificateur d'horloge (kills gloutons), sans sorts non offensifs, sans MCTS.
* **Robustesse** : variantes `Scenario.params` (§14.5), `monsterNoise` 0,1.
* **Comparaison aux guides** : la compo et les heures choisies sont confrontées à `vortex.md §13` (rapport).

### 20.5 Benchmarks (CLI `bench`, hors vitest)

| Id | Mesure | Seuil |
|---|---|---|
| B1 | µs par nœud (clone + déplacement + lancer, effets réels) | ≤ 90 µs |
| B2 | µs par évaluation rapide | ≤ 30 µs |
| B3 | ms par tour joueur `fast` / `standard` | ≤ 4 / ≤ 220 |
| B4 | combat Vortex `fast` / `standard` | ≤ 1,2 s / ≤ 36 s |
| B5 | débit batch 4 workers `fast` | ≥ 4 combats/s |
| B6 | planificateur Vortex | ≤ 5 ms par appel |

---

## 21. Risques et parades

| Risque | Effet | Parade |
|---|---|---|
| Effets mal ou non implémentés | l'IA exploite un bug (inconvénient non simulé) ou ignore un bon sort | `unsupportedSpells: 'skip'` ; rapport de couverture par équipe ; puzzles et golden tests rejoués à chaque évolution du moteur |
| Coût du nœud > 70 µs | budgets standard dépassés | budgets en nœuds (le temps s'allonge mais le résultat reste identique) ; profils B1-B4 ; réduire K/W avant de toucher l'évaluation |
| Surapprentissage de l'IA monstre déterministe | plans « miraculeux » irréalistes | pessimisme β, bruit monstre en Monte-Carlo, golden tests de fidélité |
| Surapprentissage des poids aux graines | θ fragile | graines renouvelées par génération, validation sur graines réservées, plusieurs équipes |
| Effets d'horizon (différés, poisons, explosion d'Attraction au tour suivant) | sous-estimation de la menace | les buffs différés/programmés sur nos alliés sont lus par le modèle de menace ; rollouts ; MCTS sur décisions clés |
| Règles du Vortex incertaines (k, vagues, Action !, résurrection) | stratégie optimale pour la mauvaise règle | `Scenario.params` + Monte-Carlo de robustesse + sensibilité dans le rapport |
| Fractions PA/PM en `average` absentes (H2) | retraits valorisés en tout-ou-rien | à défaut, le préfiltre et le terme `control` utilisent `expectedApMpRemoved` analytiquement |
| Explosion combinatoire (Osamodas, Roublard, Sadida : invocations/bombes) | budget consommé par les invocations | invocations en `fast`, quotas, plafond de candidats par entité |
| `structuredClone(scenarioState)` coûteux | clones lents | état de scénario petit ; horloge lue dans les états des combattants |
| Invisibilité (Sram) | modèle de croyance absent | V2 : les monstres « voient » ; l'IA joueur valorise l'invisibilité via la menace (monstre sans cible) |
| Variance des combats longs (~36 tours) | IC larges | CRN, RNG à clé (option §22), SPRT, `progress` pour départager |
| Navigateur : mémoire / temps | démo lente | `fast` par défaut dans le navigateur, `standard` en worker, `deep` CLI seulement |

---

## 22. Dépendances demandées aux autres modules

| # | Module | Demande | Priorité |
|---|---|---|---|
| D1 | `engine/runner.ts` | extraire `stepTurn(engine, fight, provider): Fighter \| undefined` (un tour complet) et `runUntil(engine, fight, provider, stop)` | haute |
| D2 | `engine/effects` | en `average` : retraits esquivables à espérance fractionnaire (H2) ; groupes aléatoires déterministes (H3) | haute |
| D3 | `engine/effects/registry.ts` | `isSpellSupported(spellLevel)` (fermeture transitive des sous-sorts) | haute |
| D4 | `engine/move.ts` | accessibilité typée (`GridSearch`) et chemin évitant glyphes/pièges | moyenne |
| D5 | `engine/types.ts` | révision par combattant (`rev`, incrémentée à chaque mutation) pour les caches — sinon `hash.ts` la recalcule | basse |
| D6 | `engine/random.ts` | option `rngMode: 'keyed'` (CRN, §15) | moyenne |
| D7 | `engine/targetMask.ts` | sémantique `*`, `E/e/F/f/V/v` (`monster-ai.md §0.7`) — apparemment déjà en place, à couvrir par des tests sur les sorts du Vortex | haute (vérification) |
| D8 | `dungeons/vortex/scenario.ts` | paramètres INCERTAINS exposés, `scenarioState` minimal | haute |
| D9 | `data` | `effect-semantics.json` exposé au runtime (catégories des sorts) | moyenne |

---

## 23. Jalons d'implémentation

| Jalon | Contenu | Sortie vérifiable |
|---|---|---|
| M1 | `core/sim`, `reach` typé, `hash`, `rng`, `budget`, bench B1 | B1 mesuré avec les effets réels ; T-hash, T-det partiels |
| M2 | `candidates`, `semantics`, `threat`, `potential`, `evaluate`, `policies/fastPlayer`, `random`, `scripted` | T-cand, T-prefilter, T-eval, T-threat ; combats sanity |
| M3 | IA monstre (`faithful` / `fast`), profils Vortex | golden tests T1-T10, T-agree |
| M4 | `group/search` (beam), rollouts, replanification, tableau noir, rôles | puzzles P4-P9 ; B3 standard |
| M5 | `dungeons/vortex` : horloge, planificateur, objectif | T-clock, T-hours, T-planner ; puzzles P1-P3, P8, P11, P12 ; combat Vortex complet jouable et animé |
| M6 | `optimizer/montecarlo`, `pool`, `cache`, `seeds` | B4, B5 ; échelle des niveaux ; IC |
| M7 | MCTS décisions clés, `explain`, split léthal | P10, P12 ; ablations |
| M8 | CMA-ES + distillation | θ* validé par SPRT sur graines réservées |
| M9 | optimiseur de stuff + variantes | fronts de Pareto par archétype ; comparaison aux stuffs méta (`equipment.md §12`) |
| M10 | composition (prior + racing + co-optimisation), rembobinage, rapport | rapport Vortex : meilleure équipe, stuffs, sorts, replays |
