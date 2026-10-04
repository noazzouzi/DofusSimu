# IA de DofusSimu — proposition « objectifs & planification d'abord » (architecture hiérarchique)

> Statut : proposition de conception pour CP4/CP5, à confronter aux propositions « fidélité »
> (`ai-proposal-fidelity.md`) et « recherche » (`ai-proposal-search.md`). Elle ne remplace pas leur socle commun
> (simulation sur clone, score en PV-équivalents, IA des monstres de `monster-ai.md` §8) : elle propose de le
> **piloter par des objectifs**.
>
> Angle : un combat difficile (l'Œil de Vortex en est l'archétype) ne se gagne pas tour par tour mais par un **plan** :
> qui tue quoi, à quelle heure, dans quel ordre, avec quel tempo de vagues et quel burst final. On sépare donc
> (1) une couche **stratégique** qui planifie l'équipe sur plusieurs tours et publie des **prix** et des
> **intentions**, (2) une couche **tactique** qui cherche, pour chaque personnage, le tour qui maximise la valeur
> générique de l'état **plus** ces prix, (3) une couche **opérationnelle** qui exécute et replanifie, et (4) une
> **boucle externe** (composition × stuff × variantes de sorts × paramètres de stratégie) pilotée par la simulation.
>
> Conventions : prose en français, identifiants en anglais. Unité de valeur : le **PVe** (PV-équivalent). Tout ce qui
> repose sur une mécanique non confirmée est marqué **INCERTAIN** et devient un paramètre échantillonnable (§10.4).
> Documents sources : `src/engine/*`, `src/damage`, `src/map`, `docs/research/monster-ai.md` (§0, §3-§8),
> `docs/research/vortex.md` (§0, §3, §5, §6, §8, §13), `mechanics.md` (§6, §8), `classes/*.md`, `equipment.md`.

---

## 0. Décisions clés (TL;DR)

1. **Trois couches + une boucle externe.** *Stratégique* (`Commander`, une fois par tour de joueur, ≤ 15 ms) →
   *tactique* (`TurnSearch`, recherche en faisceau sur le tour d'un personnage, budget en nœuds) → *opérationnelle*
   (`Executor` : exécution, détection d'écart, replanification) ; *boucle externe* `src/optimizer` (Monte-Carlo,
   réglage des paramètres, stuff, variantes, composition, rembobinage stratégique).
2. **Le lien stratégique → tactique est une table de prix en PVe** (« prix fictifs », *shadow prices*) calculée par
   contrefactuels du planificateur : `kill[m][heure|corruption]`, `hp[m]` (pente + palier), `clock[k]` (avancer
   l'horloge de k heures), `cell[c]` (sécurité de fin de tour), plus des **intentions** typées (contrôler, protéger,
   purger, réserver, se placer). Aucune règle dure : un contrat pèse exactement ce qu'il rapporte au plan.
3. **Œil de Vortex = problème d'ordonnancement**, résolu par un planificateur abstrait (`HourPlanner`) sur les créneaux
   de la timeline : heures prévues × capacités de kill × état des monstres (neuf, mort, marqué, étoilé, corrompu).
   Actions abstraites : marquer (kill à l'heure h), corrompre (kill sous étoile), pré-dégâts, +1 heure par glyphe.
   Faisceau 16 × horizon 12 créneaux de joueurs ; coûts : exposition (menace des monstres vivants), coût des heures,
   retard de tempo, risque d'échec.
4. **Le coût d'une heure est calculé, pas codé** : on applique le bonus d'heure à un clone du monstre (vie de zombie)
   et au Vortex (phase 2, **un bonus par heure distincte** utilisée pendant tout le combat) puis on mesure Δmenace et
   ΔPV effectifs. Conséquence attendue : le plan converge vers peu d'heures « inoffensives » (VII, X, II).
5. **Machine à phases** du `Commander` : Ouverture → Cycle de vagues → Attente (tout corrompu avant le ~26e tour) →
   Transition (*Action !*) → Burst (phase 2) ; état transverse Urgence (allié en danger de mort).
6. **Couche tactique** : faisceau (largeur 1/6/12 selon le mode) sur des macro-actions, candidats issus de trois
   sources avec quotas (génériques, intentions, **bibliothèque de tactiques**), simulation sur clone en
   `rollMode: 'average'`, évaluation de feuille = V générique + prix + intentions + position, puis **rollout d'équipe**
   des 3 meilleurs plans (tours monstres prédits jusqu'à l'allié suivant + tour rapide de cet allié).
7. **V générique en PVe** (13 termes, §4.6) dont un terme unique de **menace entrante** ordonnée par la timeline : c'est
   lui qui donne leur valeur au retrait de PM/PA, à Pacifiste, à la poussée et au blocage de corps. Le terme de
   **potentiel allié** valorise les mises en place (regrouper pour la zone de l'allié suivant, dissiper Pacifiste).
8. **Bibliothèque de tactiques créatives explicite** (16 tactiques : verrou PM, verrou PA, blocage de corps, piège à
   tacle, porter-jeter, poussée-collision, regroupement, horloge par glyphe, bonus de glyphe, purge du poison par soin,
   bouclier de ligne de vue, mur de corrompus, appât, dissipation alliée, préparation de burst, esquive de ligne).
   Une tactique **propose** des séquences ; la simulation **décide**. Priors par tactique réglés par la boucle externe.
9. **Monstres** : IA fidèle de `monster-ai.md` §8 (gloutonne + replanification, profils, overrides Vortex) avec un
   **réglage unique dans tous les modes** (topK 8) ; un mode `predict` (topK 4) sert aux rollouts des joueurs.
10. **Rôles inférés** (`CapabilityProfile` → 9 rôles), assignés par affectation hongroise sur les besoins du scénario ;
    un rôle change des quotas, des priors et la tolérance au risque, jamais les règles.
11. **Aléa** : graine maîtresse → graines de combat communes à toutes les configurations (CRN) ; re-semis du RNG moteur
    à chaque tour (extension E1) ; l'IA est déterministe (espérances) ; les paramètres INCERTAINS sont des variantes.
12. **Modes** : `scripted` (sans IA, rotations), `fast` (< 1 s par combat Vortex complet), `standard` (< 30 s),
    `deep` (démo, minutes). Budgets exprimés en nœuds, jamais en millisecondes (reproductibilité).
13. **Boucle d'itérations** : L0 tour → L1 Monte-Carlo (CRN, arrêt séquentiel) → L2 paramètres θ (CEM) → L3 stuff
    (proxy + recuit + simulation) → L4 variantes de sorts → L5 composition (prior analytique + *successive halving*),
    plus **L\* rembobinage stratégique** : rejouer depuis un point de contrôle avec une autre branche du plan pour
    trouver une ligne gagnante (démo).
14. **Parallélisme** : pool `worker_threads` (Node) / Web Workers (navigateur), même API, résultats indépendants du
    nombre de workers ; ≈ 16 000 combats `fast`/h sur 4 cœurs ; campagne Vortex complète ≈ 50 min.
15. **Validation** : modèle d'horloge comparé au moteur, puzzles du planificateur, micro-scénarios par tactique,
    golden tests des monstres, ablations (planificateur/tactiques/rollouts on/off), bancs de performance, déterminisme.

---

## 1. Le problème vu « objectifs d'abord »

### 1.1 Pourquoi une hiérarchie

Une recherche de tour, même profonde, voit au mieux un tour de jeu (~8 tours de combattants). Or, dans l'Œil de
Vortex :

* un monstre marqué à l'heure h ne peut être corrompu qu'au prochain passage de l'horloge sur h, soit **3 tours de jeu
  plus tard** à 4 joueurs (période `12 / pgcd(N, 12)`, `vortex.md` §5) ;
* le bonus de chaque heure utilisée est **transféré au Vortex** à *Action !* (une fois par heure distincte), donc une
  décision du tour 3 change la difficulté de la phase 2 au tour ~28 ;
* les vagues arrivent à date fixe (tours 1, 7, 12, 17, 22 — paramètre) et se chevauchent avec les corruptions en cours ;
* le tueur compte (chaque joueur ne voit qu'une classe d'heures modulo 4 sans glyphe), donc « qui tape en dernier » est
  une décision d'équipe, pas individuelle.

Ces contraintes sont **combinatoires et lointaines** mais **abstraites** (statuts, heures, PV approximatifs) : un
planificateur symbolique les résout en millisecondes, là où une recherche sur l'état complet coûterait des millions de
nœuds. Inversement, le choix des cases, des sorts et des combos est **local et concret** : il revient à la recherche
simulée. La hiérarchie donne à chaque problème l'outil adapté.

### 1.2 Principes

| # | Principe | Conséquence |
|---|---|---|
| P1 | Une seule monnaie : le PVe | plan, tactique, monstres et optimiseur parlent la même langue ; poids réglables |
| P2 | Le plan propose, la simulation dispose | les prix biaisent la recherche ; aucun script ne court-circuite le moteur |
| P3 | Horizon glissant + engagement | replanification à chaque tour de joueur, prime de stabilité pour le plan en cours |
| P4 | Socle partagé monstres / joueurs | mêmes candidats, même simulation, même modèle de menace |
| P5 | Déterminisme | budgets en nœuds, flux aléatoires séparés, combat rejouable à l'identique (replay) |
| P6 | Paramètres réglés par la boucle externe | les valeurs initiales de ce document sont des points de départ |
| P7 | Explicabilité | toute décision se rattache à un prix ou une intention ; annotations dans le replay |

### 1.3 Que veut dire « réussir un combat » ?

Deux mesures distinctes, toutes deux produites par `src/optimizer` :

* **taux de victoire robuste** d'une configuration (équipe, stuffs, variantes, θ, mode d'IA) sur un échantillon de
  graines **et** de variantes des paramètres INCERTAINS, avec intervalle de confiance (Wilson) ;
* **existence d'une ligne gagnante** pour une graine donnée, trouvée par rembobinage stratégique (§11.7) : c'est elle
  qui alimente le replay animé de démonstration quand le taux de victoire est encore faible.

---

## 2. Architecture

### 2.1 Vue d'ensemble

```
 ┌──────────────────────────── src/optimizer (boucle externe) ────────────────────────────┐
 │ L5 composition (19 classes) → L4 variantes → L3 stuff (exos) → L2 θ (CEM) → L1 Monte-Carlo │
 │ L* rembobinage stratégique (ligne gagnante)          pool worker_threads / Web Workers    │
 └───────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │ SimConfig + graines
 ┌───────────────────────────────────────────▼────────────────────────────────────────────┐
 │ runFight(engine + ScenarioHooks src/dungeons/vortex)                                     │
 │                                                                                          │
 │  joueurs : TeamController ──► TeamBrain (1 par équipe, hors FightState)                  │
 │     ┌─ STRATÉGIQUE  Commander : phase, doctrine/rôles, allocation, pricers               │
 │     │                 └─ ScenarioAIModel (Vortex) : ClockModel, Tracker, HourPlanner,    │
 │     │                                               BurstPlanner, Placement              │
 │     │      ⇩ Blackboard { plan, PriceTable, Intent[] }                                   │
 │     ├─ TACTIQUE     TurnSearch : candidats (génériques + intentions + Tactic[]),          │
 │     │                 simulation sur clone, V + prix, rollouts d'équipe                   │
 │     └─ OPÉRATIONNEL Executor : performAction, écart prévu/réel → replanification          │
 │                                                                                          │
 │  monstres : MonsterBrain (fidèle, monster-ai.md §8) ◄── même socle ── mode predict       │
 └───────────────────────────────────────────┬────────────────────────────────────────────┘
 ┌───────────────────────────────────────────▼────────────────────────────────────────────┐
 │ src/ai/core : sim, reach (tacle), candidates, quick, dpt, threat, potential, value, hash │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Déroulé d'un tour de joueur

1. `engine.nextTurn` applique les effets de début de tour (`TB` : avance de l'Auroraire, poisons, glyphes), puis
   `runFight` appelle `TeamController.playTurn(engine, fight, me)`.
2. `TeamBrain.observe(fight)` : le `Tracker` met à jour l'état symbolique (morts, heures des monstres, étoiles,
   vagues, glyphes actifs, calibrations).
3. `Commander.update(slot)` : phase courante ; plan de scénario (horizon glissant) ; `PriceTable` et `Intent[]` du
   combattant courant ; attentes envers les alliés suivants (paliers de PV, mises en place) ; publication dans le
   `Blackboard` ; annotation `ai` pour le replay.
4. `TurnSearch.search(ctx)` : plan de tour (séquence de macro-actions + déplacement final), budget selon le mode.
5. `Executor` : exécute action par action via `performAction` ; compare l'état obtenu à l'état prévu ; replanifie
   (étape 4 avec 50 % du budget initial) si l'écart dépasse les seuils (§7.6).
6. Fin du tour : `runFight` appelle `engine.endTurn`.

Le `TeamBrain` vit **hors** de `FightState` (l'état du moteur reste clonable) ; il expose `snapshot()/restore()`
(données pures) pour le rembobinage (§11.7). Les rollouts internes utilisent une copie figée du blackboard.

### 2.3 Contrat avec le moteur

API utilisées telles quelles : `Engine.cloneFight`, `alive/enemiesOf/alliesOf/fighterAt/stateFlag/current`,
`canCast(..., { fromCell })`, `castSpell`, `performAction`, `runFight`, `move`, `escapeRatio`, `zoneCells`,
`zoneEfficiency`, `hasLineOfSight`, `GridSearch`/`bfsDistances`, `prepareDamage`/`meanPrepared`/`expectedDamage`,
`damageDistribution`, `critProbability`, `expectedApMpRemoved`, `tackleRatio`, `computeBuildStats`,
`GameDataStore.breedSpells/monsterSpells/itemsBySlot`, `registeredEffects()`/`unknownEffects()`.

Petites extensions demandées (rétro-compatibles) :

| # | Extension | Où | Pourquoi |
|---|---|---|---|
| E1 | `FightOptions.rngRekey?: 'none' \| 'perTurn'` ; si `perTurn`, `startTurn` pose `fight.rngState = mix32(seed, round, f.id)` | `engine.ts` | nombres aléatoires communs (CRN) entre variantes ; rembobinage avec « les mêmes dés » |
| E2 | `ScenarioHooks.cloneState?(s)` utilisé par `cloneFight` à la place de `structuredClone` | `engine.ts` | `structuredClone` coûte 5-20 µs par clone ; l'état Vortex est plat |
| E3 | Événement `{ t: 'aiNote'; fighter; kind: 'plan' \| 'intent' \| 'tactic' \| 'focus'; text; cells?; targets? }` | `types.ts`, `replay/*` | flèches/zones d'intention dans le replay ; à défaut `log` niveau `'ai'` |
| E4 | `Fighter.rev` incrémenté par `recomputeStats` et par tout changement de case | `engine.ts`, `move.ts` | clés de cache des tables DPT et du modèle de menace |
| E5 | Compteur d'effets inconnus **par combat** dans `fight.metrics` | `effects/core.ts` | marquer un résultat « faible confiance » ; interdire l'exploitation d'effets non simulés |
| E6 | `DeathRecord.states?: number[]` (états au moment de la mort) | `engine.kill` | le tracker lit l'heure et l'étoile au décès sans ambiguïté (les états d'heure persistent déjà, `dispellable` 3) |

---

## 3. Arborescence des modules

```
src/ai/
  index.ts              createControllers(engine, fight, cfg): ControllerProvider (joueurs → TeamController,
                        monstres → MonsterBrain selon fighter.ai)
  types.ts              AIMode, AIConfig, TurnBudget, StrategyParams (θ), SlotRef, SlotForecast
  core/
    sim.ts              simClone (average, RNG décorrélé), applyMacro, applyPlan, rollout helpers
    reach.ts            accessibilité typée (Int16Array) avec perte PA/PM de tacle attendue (R4/R5)
    candidates.ts       énumération (sort × case de lancer × case cible), dominances, quotas
    quick.ts            estimation analytique d'un candidat (dégâts, retraits, tir ami) sans clone
    capabilities.ts     SpellProfile (sémantique des effets, fermeture des sous-sorts), CapabilityProfile
    dpt.ts              tables de dégâts par tour (attaquant × cible), cache par rev
    threat.ts           ThreatModel : menace entrante ordonnée par la timeline (§4.4)
    potential.ts        potentiel offensif allié au prochain tour (§4.5)
    value.ts            V générique (§4.6), ValueWeights
    timeline.ts         forecastSlots : créneaux à venir (vivants, invocations, vagues annoncées)
    hash.ts             hachage d'état (transpositions), mix32
    budget.ts           compteur de nœuds, coupe déterministe
  monster/              (monster-ai.md §8) brain.ts, archetype.ts, profiles.ts, position.ts, predict.ts,
    overrides/          vortex.ts (+ ikargn, buboxor, brabuzar), index.ts
  team/
    controller.ts       TeamController implements Controller ; TeamBrain (observe → command → search → execute)
    blackboard.ts       Blackboard, Intent, PriceTable, snapshot/restore
    doctrine.ts         rôles (inférence + affectation hongroise), préférences de risque
    commander.ts        machine à phases, orchestration des pricers et de l'allocation
    allocator.ts        allocation des intentions contrôle/protection/purge/mise en place
    pricers.ts          HeuristicPricer (fast) / SearchPricer (standard, deep)
    oracle.ts           KillOracle (capacité de kill par joueur × monstre) + calibration en ligne
    scripted.ts         politiques sans IA (rotations scriptées, DSL)
  tactical/
    turnSearch.ts       faisceau, sélection diverse, transpositions
    evaluate.ts         évaluation de feuille (V + prix + intentions + position)
    intents.ts          fonctions de satisfaction des intentions
    rollout.ts          rollouts d'équipe (monstres predict + allié suivant fast)
    finalMove.ts        déplacement de fin de tour (analytique, cases de sécurité)
    executor.ts         exécution, écart prévu/réel, replanification
    explain.ts          annotations aiNote / log 'ai'
  tactics/
    index.ts            registre, priors, Tactic interface
    mpLock.ts apLock.ts bodyBlock.ts tackleTrap.ts carryThrow.ts pushCollision.ts groupForZone.ts
    glyphClock.ts glyphBuff.ts healCleanse.ts losShield.ts corruptedWall.ts baitSummon.ts
    dispelAlly.ts burstSetup.ts lineDodge.ts
src/dungeons/
  types.ts              DungeonScenario = ScenarioHooks (moteur) + ScenarioAIModel (IA) + UncertainParam[]
  generic/              combats d'essai (mannequin, 1 contre 1, vague seule) pour les tests de cohérence
  vortex/
    scenario.ts         ScenarioHooks : vagues (composition par N, arrivée, invulnérabilité), Action ! (délai)
    params.ts           paramètres INCERTAINS + variantes (§6.10)
    clock.ts            ClockModel pur : heure par créneau, glyphes, joueurs morts, fenêtres d'étoile
    tracker.ts          MonsterTrack[] lus dans FightState
    planner.ts          HourPlanner (beam abstrait, §6.5) + extraction des prix
    hourCost.ts         HourCostModel (coûts calculés par clone, §6.4)
    tempo.ts            calendrier des vagues, budget de monstres vivants
    burst.ts            BurstPlanner (transition + phase 2, §6.8)
    placement.ts        placement initial (12 cases rouges, §6.9)
    model.ts            ScenarioAIModel du Vortex (phase, forecast, plan, extraIncoming, valeur des morts)
src/optimizer/
  types.ts              SimConfig, BatchJob, FightSummary, CampaignConfig
  seeds.ts              graines maîtresses, CRN, variantes
  runner.ts             runOne(config, seed, mode) → FightSummary (+ replay sur demande)
  pool.ts worker.ts     pool worker_threads (Node) ; web/worker.ts même protocole (navigateur)
  stats.ts              Wilson, tests appariés, arrêt séquentiel, agrégation déterministe
  montecarlo.ts         L1
  tune.ts               L2 (CEM sur θ, espace log)
  stuff/                proxy.ts (objectif analytique), search.ts (recuit), presets.ts (rôles × classes)
  variants.ts           L4
  team.ts               L5 (prior de composition + successive halving)
  rewind.ts             L* rembobinage stratégique
  report.ts             rapport Vortex (équipe, stuffs, variantes, θ, IC, replays choisis)
```

---

## 4. Socle commun (couche « perception »)

### 4.1 `SpellProfile` et `CapabilityProfile`

Calculés une fois par combat (et par build dans l'optimiseur) à partir des effets des sorts (`effect-semantics.json`,
fermeture transitive des sous-sorts 792/793/1160/2160/1017-1019) :

```ts
export interface SpellProfile {
  spellId: number
  apCost: number; minRange: number; maxRange: number; los: boolean; line: boolean; diagonal: boolean
  castsPerTurn: number; castsPerTarget: number; cooldown: number
  kinds: Set<'damage' | 'heal' | 'shield' | 'apRemove' | 'mpRemove' | 'push' | 'pull' | 'teleport' | 'swap'
    | 'carry' | 'throw' | 'summon' | 'glyph' | 'trap' | 'buffAlly' | 'debuffEnemy' | 'dispel' | 'state'>
  zoneRadius: number            // 0 = monocible
  needsFreeCell: boolean; needsTakenCell: boolean
  unsupported: boolean          // un effet sans interprète (E5) → exclu par défaut des candidats
  hasRandomGroups: boolean
}

export interface CapabilityProfile {
  fighterId: number
  dptMono: number      // PVe/tour contre la cible de référence du scénario (profil de résistances)
  dptZone3: number     // PVe/tour sur 3 cibles groupées
  burst1: number       // meilleur tour unique (relances comprises)
  mpRemoval: number    // PM retirés attendus/tour (esquive de référence, formule mechanics.md §7)
  apRemoval: number
  placement: number    // déplacements d'entités possibles par tour (poussée, attirance, tp, porter-jeter)
  heal: number; shield: number
  cleanse: boolean     // soin bon marché multi-cibles (retire « Petit poison »)
  dispel: boolean; summons: number
  tackle: number; evade: number
  ehp: number          // PV effectifs vs profil d'éléments entrants du scénario
  maxRange: number; mobility: number; initiative: number
}
```

### 4.2 Tables DPT (`dpt.ts`)

`dpt(a, b)` = meilleure combinaison de sorts de `a` contre `b` pour ses PA (sac à dos sur `castsPerTurn`,
`castsPerTarget`, relances), chaque sort valant `expectedDamage` (DoMath, critique pondéré) avec les résistances de
`b`. Cache indexé par `(a.id, a.rev, b.id, b.rev)` (E4). Coût : ≤ 30 µs par paire au premier calcul, O(1) ensuite.
Sert au modèle de menace, au potentiel, au `KillOracle` et au préfiltre `quick`.

### 4.3 Accessibilité avec tacle (`reach.ts`)

BFS sur tableaux typés (le `reachableCells` actuel utilise `Map` et `queue.shift()`), coût d'un chemin = PM + perte
**attendue** de PA/PM au tacle (`escapeRatio` à chaque sortie de case adjacente à un ennemi). Sorties :
`cost: Int16Array`, `apLoss: Float32Array`, `prev: Int16Array`. Règles : ne pas tenter un chemin dont la probabilité
de sortie de tacle est < 0,3 (R4) ; les cases de glyphe de monstre et de piège sont des **cases-événements** : le BFS
les contourne sauf pour les candidats qui les visent explicitement (tactique `glyphClock`, §8.3).

### 4.4 Modèle de menace entrante (`threat.ts`)

Menace entrante d'un état, sur l'horizon « jusqu'à mon prochain tour » :

```
Incoming(s) = Σ_{e ∈ ennemis jouant avant mon prochain tour} ω_e · Σ_{a ∈ alliés} π_e(a) · D_e(a) · f_e(a) + Zone_e
  D_e(a)  = dpt(e, a)                                  // 0 si e Pacifiste / tour annulé / corrompu
  f_e(a)  = 1    si e atteint une case de lancer de son meilleur sort sur a avec ses PM du prochain tour
               (malus de PM persistants, tacle attendu, LdV/ligne)
            0,6  si seul un sort plus faible est lançable ; 0,25 si a n'est atteignable qu'au tour d'après ; 0 sinon
  π_e(a)  = softmax_a( D_e(a)·f_e(a)·(1 + 0,5·[D_e(a) ≥ PV_a]) / τ ),  τ = 0,25 · max_a(...)   // ciblage façon IA monstre
  Zone_e  = 0,6 · Σ_{a' à portée de zone de la cible principale} D_e(a')
  ω_e     = 1 si e joue avant le prochain allié, 0,8 sinon (un allié peut encore atténuer)
  + extraIncoming(s, a) fourni par le scénario (lignes de l'Auroraire au créneau du Vortex, §6.1)
```

Mise à jour incrémentale : seuls les ennemis dont la case, les PM/PA, les états ou les cibles accessibles ont changé
sont recalculés (drapeaux `rev`). Coût visé : ≤ 15 µs par évaluation de feuille.

### 4.5 Potentiel allié (`potential.ts`)

`Pot(s) = Σ_{a ∈ alliés} max_e dpt(a, e) · f_a(e)` avec les PA/PM du prochain tour de `a` (Pacifiste ⇒ 0, retraits
de PA/PM subis déduits). Ce terme rend rentables : regrouper des monstres dans la zone d'un allié qui joue après,
donner des PM/PA/Puissance, dissiper un Pacifiste (Heuristique du Vortex est désenvoûtable), libérer un allié taclé.

### 4.6 Fonction de valeur générique `V` (`value.ts`)

Évaluée en **différence** entre l'état de début de plan (`s0`) et la feuille (`s`), point de vue de l'équipe :

| Terme | Définition | Poids initial | Unité / remarque |
|---|---|---|---|
| `enemyDamage` | Σ_e v_e · min(ΔPV_e + Δbouclier_e, PV_e⁰ + bouclier_e⁰) | 1,0 | PV ; v_e = 1 monstre, 0,5 invocation, 0 invulnérable/corrompu ; surchargé par le scénario (§4.7) |
| `kill` | Σ_{e tués} κ · PVmax_e | κ = 0,3 | la menace supprimée est déjà dans `incomingΔ` |
| `allyDamage` | −Σ_a ΔPV_a (renvoi, tir ami, sacrifices) | 1,0 | PV |
| `allyDeath` | −Σ_{a morts} (1,5 · PVmax_a + 2 · Pot_a) | 1,0 | ≈ 8 000 PVe au niveau 200 |
| `heal` | Σ_a min(soin, manquants) · (1 + 0,5 · (1 − PV%_a)) | 0,6 | PV |
| `shield` | Σ_a min(bouclier gagné, Incoming_a) | 0,8 | PV |
| `incomingΔ` | Incoming(s0) − Incoming(s) | 0,8 | PV attendus ; valorise contrôle, blocage, fuite, kills |
| `potentialΔ` | Pot(s) − Pot(s0) | 0,3 | PV attendus au prochain tour allié |
| `erosion` | −Σ_a ΔPVmax_a | 0,5 | PV max perdus définitivement |
| `pendingDoT` | −Σ_a Σ_k 0,8^k · DoT_a(k) | 0,9 | poisons à venir (Petit poison : 475/tour) ; la purge rapporte |
| `reserve` | −prix des sorts réservés consommés | 1,0 | via intention `reserve` (burst) |
| `position` | termes de rôle bornés (tank au contact, tueur à distance max, placeur central) | ≤ 50 PVe | départage |
| `scenario` | prix (`PriceTable`) + satisfaction des intentions | 1,0 | PVe, §5.2 |

Garde-fous : un plan dont la simulation tue le lanceur par renvoi vaut −∞ (comme R7 côté monstres) ; un PA non
utilisé coûte 2 PVe seulement pour départager (on n'oblige pas à vider les PA).

### 4.7 Ajustements de scénario

`ScenarioAIModel` peut surcharger, par combattant : `v_e` (valeur des dégâts), la valeur d'une mort, et ajouter une
menace (`extraIncoming`). Vortex en phase 1 : pour un **monstre de vague**, `v_e = 0,3` et `kill` est remplacé par
`PriceTable.kill` (un kill non planifié n'est qu'un sursis : résurrection à 20-30 % au tour du Vortex) ; le modèle de
menace sait qu'un monstre mort revient au créneau du Vortex (`resurrectionForecast`).

---

## 5. Couche stratégique (`src/ai/team`)

### 5.1 Doctrine : rôles

```ts
export type RoleId = 'killer' | 'zoneDps' | 'mpLock' | 'apLock' | 'placer' | 'tank' | 'healer' | 'support' | 'summoner'
export interface Doctrine {
  roles: Map<number, { primary: RoleId; secondary?: RoleId; scores: Record<RoleId, number> }>
  riskTolerance: Map<number, number>   // 0..1 : tueurs prudents (0,3), tank (0,8)
  tacticPriors: Map<number, Partial<Record<TacticId, number>>>
}
```

Scores normalisés à partir du `CapabilityProfile` : `killer = dptMono/3000`, `zoneDps = dptZone3/6000`,
`mpLock = mpRemoval/4`, `apLock = apRemoval/4`, `placer = placement/3`, `tank = (ehp/6000)·(tackle/100)`,
`healer = heal/1500`, `support = buffValue/1000`, `summoner = summons/2`. Le scénario publie un vecteur de besoins
(Vortex : `killer 2, mpLock 1, zoneDps 1, placer 0,5, healer 0,5 (purge), tank 0,5`) ; l'affectation hongroise sur
(personnages × rôles répétés selon le besoin) donne le rôle principal, le second meilleur score donne le secondaire.
L'optimiseur peut imposer les rôles (préréglage de build). Un rôle agit sur : quotas de candidats, priors de
tactiques, tolérance au risque (poids du terme `allyDamage` propre), terme de position, préférence d'allocation.

### 5.2 Blackboard, intentions et prix

```ts
export interface SlotRef { round: number; index: number }          // index dans fight.timeline
export interface SlotForecast { ref: SlotRef; fighterId: number; team: TeamId; isPlayer: boolean
  isVortex?: boolean; hourAtStart?: number }                          // heure de l'Auroraire pendant ce créneau

export interface PriceTable {
  /** Prix (PVe) d'une mort de m pendant ce tour : index 0 = corruption, 1..12 = marquage à l'heure h. */
  kill: Map<number, Float32Array>
  /** Valeur marginale d'un PV retiré à m, et palier optionnel (attente d'un allié suivant). */
  hp: Map<number, { slope: number; bandMin?: number; bandMax?: number; bandBonus?: number }>
  /** Valeur d'avancer l'horloge de k heures (glyphes) pendant ce tour, k = 0, 1, 2. */
  clock: [number, number, number]
  /** Valeur de finir le tour sur chaque case (sécurité scénario), PVe ; absent = 0. */
  cell?: Float32Array
}

export type IntentKind = 'control' | 'protect' | 'cleanse' | 'position' | 'setup' | 'reserve'
  | 'preDamage' | 'burst' | 'survive'
export interface Intent {
  id: string; kind: IntentKind
  owner: number                        // combattant porteur
  window: { from: SlotRef; to: SlotRef }
  target?: number; cells?: number[]
  params?: Record<string, number>      // ex. { mpMax: 1 }, { hpMax: 1800, hpMin: 1 }, { spellId: 13329 }
  price: number                        // PVe si pleinement satisfaite
  source: 'planner' | 'allocator' | 'burst' | 'emergency' | 'doctrine'
  explain: string                      // texte FR (replay)
}

export interface Blackboard {
  phase: PhaseId
  plan?: ScenarioPlan                  // dernier plan retenu (contrats, alternatives, version)
  prices: PriceTable                   // pour le combattant courant
  intents: Intent[]                    // tous porteurs confondus (attentes envers les alliés suivants)
  focus: number[]                      // ordre de focus générique (hors scénario)
  reservations: { fighterId: number; spellId: number; untilRound: number }[]
  calibration: OracleCalibration
}
```

Les **meurtres planifiés et les interdits** passent exclusivement par `PriceTable.kill` (prix positif = contrat,
négatif = « ne pas tuer maintenant ») ; les autres objectifs passent par des intentions dont la satisfaction est
évaluée sur l'état simulé (`tactical/intents.ts`) :

| Intention | Satisfaction `sat ∈ [−1, 1]` (lue sur l'état simulé) |
|---|---|
| `control(target, mpMax / apMax)` | `clamp((PM_next⁰ − PM_next) / (PM_next⁰ − mpMax), 0, 1)` ; PM_next = PM au prochain tour de la cible (malus persistants) |
| `protect(ally)` | `1 − Incoming_ally(s) / Incoming_ally(s0)` |
| `cleanse(ally)` | 1 si plus aucun poison « retiré par soin » sur l'allié |
| `position(cells)` | 1 si la case finale ∈ cells, sinon `max(0, 1 − 0,2 · distance)` |
| `setup(ally, target)` | `ΔPot_ally / attendu` (ex. cible amenée dans la zone de l'allié suivant) |
| `reserve(spellId)` | −1 si le sort a été lancé |
| `preDamage(target, hpMin, hpMax)` | 1 si PV ∈ [hpMin, hpMax] ; linéaire au-dessus ; −1 si mort hors contrat |
| `burst(target)` | dégâts / dégâts prévus (plafonné 1,5) ; voir §6.8 |
| `survive(me)` | 1 − P(mort avant mon prochain tour) (modèle de menace) |

Score scénario d'une feuille : `Σ_m kill[m][x_m]` (x_m = corruption ou heure de mort lue dans les états) `+ Σ_m
hp[m].slope · ΔPV_m + bonus de palier + clock[k] + cell[case finale] + Σ_i price_i · sat_i`.

### 5.3 Machine à phases du `Commander`

| Phase | Entrée | Plan actif | Remarques |
|---|---|---|---|
| `opening` | tour 1 | placement initial (§6.9), premiers contrôles, pré-dégâts | aucun kill planifié à une heure chère |
| `waveCycle` | dès qu'un monstre de vague est vivant | `HourPlanner` + allocation | régime principal |
| `waiting` | tous corrompus, Vortex encore Marginal (< ~26e tour) | sécurité : hors lignes de l'Auroraire au créneau du Vortex, soins | horloge sans enjeu |
| `transition` | dernier corrompu / *Action !* imminente | `BurstPlanner` (préparation : buffs, réserves, PM du Vortex) | délai paramétré (0/1 tour Vortex) |
| `burst` | Vortex vulnérable | `BurstPlanner` (exécution) | prix du kill du Vortex = victoire |
| `emergency` | P(mort d'un allié avant son tour) > 0,35 | intentions `protect/survive` prioritaires | transverse, superposé à la phase courante |

Combat sans scénario : `GenericModel` (phases `fight`/`emergency`, focus = argmax `incomingΔ` par PV effectif à
retirer, prix de kill = valeur générique).

### 5.4 Allocation des intentions (`allocator.ts`)

À chaque tour de joueur, après le plan de scénario :

```
needs = []
pour chaque ennemi e trié par contribution à Incoming (desc) :
   si e n'est pas tué par le plan avant son prochain tour :
       needs += control(e, mpMax = PM minimal pour que f_e(·) = 0,25)       // valeur = baisse de menace estimée
pour chaque allié a avec P(mort) > 0,15 : needs += protect(a)              // valeur = P · coût de mort
pour chaque allié empoisonné : needs += cleanse(a)                         // valeur = Σ ticks restants
pour chaque contrat du plan : needs += setup/preDamage pour les alliés jouant avant le tueur
affectation gloutonne par prix décroissant :
   candidats = alliés jouant AVANT l'échéance de l'intention (ordre de la timeline)
   utilité u(i, n) = n.price · aptitude(rôle_i, n.kind) · faisabilité(i, n)   // faisabilité : portée/accès via reach + dpt
   affecter à argmax u ; un allié reçoit ≤ 3 intentions ; réaffectation à chaque tour (horizon glissant)
```

Seules les intentions du combattant courant entrent dans sa recherche ; celles des alliés suivants servent aux paliers
de PV (`hp.band`) et aux rollouts (le partenaire rapide les reçoit aussi).

### 5.5 Prix fictifs (`pricers.ts`)

* **`SearchPricer`** (modes `standard`, `deep`) : le planificateur de scénario est lancé avec une **diversité de
  racine** (au moins 2 nœuds par action racine distincte conservés dans le faisceau). Pour chaque action racine
  `r` du créneau courant (tuer m maintenant, pré-dégâts sur m, glyphe +1, rien), `best(r)` = meilleur score de
  descendant. Prix : `kill[m][x] = best(kill m à x) − best(sans tuer m)`, `clock[k] = best(glyphe k) − best(0)`,
  `hp[m].slope = (best(dégâts E sur m) − best(rien)) / E` (bornée [0 ; 1,2]). Racines absentes du faisceau final :
  un relancement forcé (faisceau 8, horizon 8), ≤ 6 par tour. Bornes : `kill ∈ [−3 000 ; +4 000]`.
* **`HeuristicPricer`** (mode `fast`) : formules fermées sans recherche (§6.6), mises en cache tant que le tracker ne
  change pas d'état symbolique (mort, résurrection, vague, glyphe).

### 5.6 Engagement, hystérésis, calibration

* Un nouveau plan remplace l'ancien si `score_new > score_old · (1 + θ.commit)` (θ.commit = 0,1) ou si un contrat de
  l'ancien devient infaisable (tueur mort, p_kill < 0,5) ; l'ancien plan reste l'alternative n° 2 (rembobinage).
* `KillOracle` : dégâts attendus de i sur m ce tour = `dpt(i, m) · ρ_i(m) · c_i` ; ρ = 1 si une case de lancer est
  accessible maintenant, 0,85 pour un créneau futur ; `c_i` = moyenne mobile (α = 0,2) du ratio dégâts réalisés /
  prévus du joueur i ; `p_kill = Φ((E − PV) / (0,15·E))`. La calibration corrige au fil du combat les erreurs du
  modèle abstrait (portée, LdV, monstres qui fuient).

---

## 6. Œil de Vortex : modèle de scénario et planificateur

### 6.1 Modèle d'horloge (`vortex/clock.ts`)

Faits (`vortex.md` §5, §6) : l'Auroraire avance d'une heure au **début du tour de chaque personnage joueur** (vivant,
INCERTAIN pour un mort) et d'une heure à **chaque glyphe de monstre déclenché par un personnage** ; elle part de XII et
vaut I au premier tour joueur. Notation `wrap(x) = ((x − 1) mod 12) + 1`.

```ts
export interface ClockState { hour: number; glyphs: number }      // lu sur l'état 221..232 de l'Auroraire
/** Heure pendant chaque créneau joueur à venir, compte tenu des glyphes planifiés (créneau → nb de glyphes). */
export function forecastHours(slots: SlotForecast[], now: ClockState,
                              glyphPlan: Map<number, number>, p: VortexParams): SlotForecast[]
/** Fenêtre d'étoile : du début du créneau joueur où l'horloge ARRIVE sur h au début du créneau joueur suivant
 *  (les créneaux monstres intermédiaires en font partie : un kill indirect y corrompt aussi). */
export function starWindows(slots: SlotForecast[], hours: Set<number>): { from: number; to: number; hour: number }[]
```

`hourAt(slot) = wrap(h_now + #débuts de tour joueur (vivants) jusqu'au créneau inclus + glyphes planifiés avant)`.
Un glyphe déclenché **pendant** un tour change l'heure au milieu du tour : l'ordre « glyphe puis kill » ou « kill puis
glyphe » est une décision tactique, et l'heure réelle d'une mort est **lue dans l'état simulé** (état d'heure posé par
le moteur), jamais supposée. À 4 joueurs avec l'équipe des joueurs en tête (k = 4, `vortex.md` §5), sans glyphe :
P1 voit I/V/IX, P2 II/VI/X, P3 III/VII/XI, P4 IV/VIII/XII, le Vortex IV/VIII/XII.

Le modèle fournit aussi `extraIncoming` : au créneau du Vortex (à partir de son 2e tour), un allié dont la case finale
est sur la croix de la case d'heure prévue reçoit `500 Terre (après résistances) + 0,5 · PV érodés`, plus le coût
d'érosion (+20 %, 2 tours) ; c'est ce terme qui fait fuir les lignes de l'Auroraire sans règle spéciale.

### 6.2 Suivi des monstres (`vortex/tracker.ts`)

```ts
export type TrackStatus = 'pending' | 'invulnerable' | 'alive' | 'dead' | 'corrupt'
export interface MonsterTrack {
  fighterId: number; monsterId: number; wave: number
  status: TrackStatus
  hp: number; maxHp: number
  hours: number            // masque 12 bits des états d'heure (221..232), persistants à la mort
  star: boolean            // état 234 « Même heure »
  arrivesRound?: number    // vagues annoncées (scénario)
  threat: number           // contribution à Incoming (ThreatModel), par tour monstre
}
```

Lecture directe de `FightState` : `states` des combattants (y compris morts, E6), `scenarioState.vortex = { wave,
nextWaveRound, vortexTurns, actionPending }` (plat, cloné par E2), timeline. Aucune règle n'est dupliquée : le tracker
**observe** le moteur ; seul le planificateur **prévoit**.

### 6.3 Modèle abstrait

```ts
export interface AbsMonster { id: number; status: TrackStatus; hp: number; maxHp: number
  hours: number; star: boolean; threat: number; arrivesRound?: number }
export interface AbsState {
  slotIdx: number           // position dans la prévision de créneaux
  hour: number; glyphShift: number; round: number; vortexTurns: number
  monsters: AbsMonster[]    // ≤ 24 (5 vagues × N + zombies)
  hoursUsed: number         // masque des heures distinctes déjà posées (coût Vortex phase 2)
  score: number
  trace: PlanStep | null    // liste chaînée partagée (actions choisies)
}
export type PlanStep = { slot: SlotRef; fighterId: number; action: AbsAction; prev: PlanStep | null }
export type AbsAction =
  | { t: 'none' }
  | { t: 'kill'; m: number[]; glyph: 'none' | 'before' | 'after' }   // 1 ou 2 morts
  | { t: 'damage'; m: number; amount: number; glyph: 'none' | 'before' | 'after' }
  | { t: 'glyph'; count: 1 | 2 }
```

Transitions :

| Créneau | Effet abstrait |
|---|---|
| joueur p, heure h | `kill(m)` faisable si `E_p(m) ≥ PV_m` (oracle, AoE si groupés) ; m → `dead`, `hours ← hours ∪ {h}` sauf si `star` (alors marqué « corrompu au réveil ») ; `damage` : PV −= E, plafonné à PV − 1 (pas de mort) ; `glyph` : heure + 1 (disponibilité q = 0,6 par défaut pour un créneau futur, lue dans le tracker pour le créneau courant) |
| début de créneau joueur | heure + 1 ; `star` ← (status `alive` ∧ h ∈ hours) pour chaque monstre ; étoiles précédentes retirées |
| monstre m | coût d'exposition `w_exp · threat_m` si m vivant (invulnérable compris : il joue) ; 0 si corrompu |
| Vortex | résurrection de tous les morts (`rezHpPct` · PVmax, paramètre) ; corrompus si tués sous étoile ; `vortexTurns++` |
| fin de tour de jeu | vagues : `pending → invulnerable` (tour d'arrivée) `→ alive` (tour suivant) |

### 6.4 Coût des heures (`vortex/hourCost.ts`)

Deux coûts par heure h (bonus de `vortex.md` §5) :

* `C_mon(m, h)` — vie de zombie : `ΔThreat_m(h) · E[tours monstre avant corruption] + λ_ehp · ΔEHP_m(h)` ;
* `C_vx(h)` — phase 2, payé **une fois** à la première utilisation de h : `ΔThreat_V(h) · T2 + λ_burst · ΔEHP_V(h)`
  avec `T2` = tours du Vortex attendus en phase 2 (2 par défaut), `λ_ehp = 0,25`, `λ_burst = 0,5`.

`ΔThreat` et `ΔEHP` sont **mesurés** : clone du monstre (ou du Vortex au grade du combat, PA/PM de phase 2), ajout du
buff d'heure via le sort de données (5002/5009), recalcul `dpt` contre l'équipe réelle et PV effectifs contre ses
éléments. Calcul une fois par combat (≤ 2 ms). Valeurs par défaut (PVe, utilisées en `fast` et comme repli) :

| Heure | Bonus | `C_mon` | `C_vx` |
|---|---|---|---|
| I | +10 % CC, +200 do crit | 400 | 1 500 |
| II | Intaclable | 100 (casse les verrous de tacle) | 100 |
| III | +400 Intelligence | 500 si sorts Feu, sinon 100 | 1 200 (Heuristique Feu) |
| IV | +2 PM | 400 | 1 000 |
| V | dommages subis ×70 % (×75 % Vortex) | 600 | 4 000 |
| VI | +400 Chance | 500 si sorts Eau, sinon 100 | 600 (Morfaille Eau) |
| VII | +150 rés. critiques | 0 | 0 |
| VIII | +4 PA | 1 200 | 2 500 |
| IX | +400 Force | 500 si sorts Terre/Neutre, sinon 100 | 400 (Morfaille Neutre) |
| X | Inébranlable | 50 (300 si l'équipe compte sur la poussée) | 100 |
| XI | +30 % Vitalité | 300 | 5 000 |
| XII | +400 Agilité | 500 si sorts Air, sinon 100 | 1 200 (Heuristique Air) |

### 6.5 Recherche (`vortex/planner.ts`)

```ts
export interface PlannerConfig { beamWidth: number; horizonPlayerSlots: number; rootDiversity: number
  maxKillsPerSlot: 1 | 2; glyphOptions: boolean; wExposure: number; corruptBonus: number
  failCost: number; glyphCost: number; commit: number; hourCostScale: number }
// défauts standard : 16, 12, 2, 2, true, 1,0, 1 500, 800, 120, 0,1, 1,0

function planHours(root: AbsState, slots: SlotForecast[], cfg: PlannerConfig): ScenarioPlan {
  let beam = [root]
  for (let i = root.slotIdx; i < root.slotIdx + horizonSlots(slots, cfg); i++) {
    const slot = slots[i], next: AbsState[] = []
    for (const node of beam) {
      if (!slot.isPlayer) { next.push(monsterSlot(node, slot, cfg)); continue }   // exposition, rez, vagues
      for (const a of slotActions(node, slot, cfg)) {           // ≤ 14 actions (élagage ci-dessous)
        const child = applyAbs(node, slot, a)                     // copie paresseuse (monstres touchés seulement)
        child.score = node.score + reward(node, child, a, cfg)
        next.push(child)
      }
    }
    beam = selectBeam(dedupe(next, absHash), cfg)                 // top-K avec diversité de racine
  }
  for (const n of beam) n.score -= terminalCost(n, slots, cfg)
  return extractPlan(beam, cfg)                                    // meilleur + 4 alternatives distinctes
}
```

`reward(node, child, a)` :

```
+ cfg.corruptBonus                               par kill sous étoile (corruption au réveil)
− C_mon(m, h) − [h ∉ hoursUsed] · C_vx(h)         par marquage à l'heure h (nouvelle heure sur m)
− (1 − p_kill) · cfg.failCost                     par kill tenté (p_kill de l'oracle)
− cfg.glyphCost + glyphBonus(monstre poseur)      par glyphe (Harpille +200 Puissance : +150 ; Méjaire soin 10 % : +200
                                                  si blessé ; Buboxor ×50 % : +100 ; Ikargn +1 PM : +50 ; Brabuzar : +30)
− wExposure · threat_m                            à chaque créneau où m vivant joue (dans monsterSlot)
− 2 000 · [m marqué sur une heure qu'aucun joueur vivant ne reverra dans les 3 tours sans glyphe]
```

`slotActions` (élagage) : au plus 2 morts par créneau ; un monstre `dead` ou `corrupt` n'est jamais candidat ; un kill
à une heure de `C_vx > 1 000` n'est généré que si aucune autre heure n'est accessible dans l'horizon (`forced`) ;
pré-dégâts seulement sur les 3 cibles de plus forte valeur (contrats futurs) ; glyphes seulement si le tracker voit un
glyphe accessible (créneau courant) ou avec la probabilité q (créneaux futurs). Déduplication par
`hash(statuts, masques d'heures, étoiles, PV par paliers de 500, glyphShift mod 12)`.

`terminalCost` : pour chaque monstre non corrompu, `exposition jusqu'à la première fenêtre d'étoile accessible
(heures déjà posées ou heure de moindre coût d'un tueur) + coût minimal d'heure` — borne optimiste qui empêche de
« repousser » le travail au-delà de l'horizon.

Coût : 12 créneaux joueurs × 16 nœuds × 14 actions ≈ 2 700 expansions × ~2 µs ≈ 6 ms (standard) ; `deep` : faisceau
48, horizon 20 (≈ 40 ms).

### 6.6 Du plan aux prix et intentions

`extractPlan` produit :

```ts
export interface ScenarioPlan {
  version: number
  steps: PlanStep[]                         // créneaux de l'horizon, meilleur plan
  alternatives: PlanStep[][]                // ≤ 4 plans racines distincts (rembobinage)
  contracts: { m: number; slot: SlotRef; killer: number; kind: 'tag' | 'corrupt'; hour: number; pKill: number }[]
  glyphs: { slot: SlotRef; count: number }[]
  rootScores: Map<string, number>           // best(r) par action racine (SearchPricer)
}
```

`SearchPricer` dérive la `PriceTable` des `rootScores` (§5.5). `HeuristicPricer` (mode `fast`) :

```
kill[m][0]  (corruption)     = corruptBonus + threat_m · toursRestantsAvantCorruptionPrévue
kill[m][h]  (m neuf)         = expo_m − C_mon(m,h) − [h nouvelle] · C_vx(h) − 2 000 · [h non revue par un tueur vivant]
kill[m][h]  (m déjà marqué)  = 0,3 · expo_m − C_mon(m,h) − [h nouvelle] · C_vx(h)       // sursis + heure de plus
hp[m].slope = 0,3 si un contrat sur m existe dans l'horizon, sinon 0,15
hp[m].band  = [1 ; E_tueur(m) · 0,8] avant le créneau du tueur, bandBonus = 0,5 · prix du contrat
clock[k]    = gain de prix des contrats rendus possibles par +k heures (sinon −glyphCost)
cell[c]     = −extraIncoming(c) au créneau du Vortex + −300 sur 484 si l'horloge arrive sur VII avant mon prochain tour
```

Intentions issues du plan : `preDamage` pour les alliés qui jouent avant un tueur, `control` sur les zombies en attente
d'étoile (ils ne doivent ni mourir ni frapper), `position` pour libérer la ligne de vue du tueur.

### 6.7 Tempo des vagues (`vortex/tempo.ts`)

Les vagues arrivent à `arrivalRounds` (défaut `[1, 7, 12, 17, 22]`, variante `[1, 6, 11, 16, 21]`), invulnérables le
tour d'arrivée (la vague 1 : INCERTAIN, paramètre). Il n'y a **pas** d'objectif explicite de vitesse : l'exposition
(`wExposure · threat`) suffit à faire préférer « marquer tôt, corrompre 3 tours plus tard », et le plancher de
déverrouillage (~26e tour du Vortex) rend inutile toute précipitation au-delà. Un garde-fou de capacité limite le
nombre de monstres vivants simultanés (`maxAlive = 2N`) : au-delà, le planificateur ajoute un coût de submersion
`400 · (vivants − maxAlive)` par créneau. Le cycle attendu par vague (4 joueurs) : tour d'arrivée = contrôle et
placement (invulnérables) ; tours +1/+2 = pré-dégâts et marquages ; tours +4/+5 = corruptions, qui chevauchent l'arrivée
de la vague suivante.

### 6.8 Transition et burst de phase 2 (`vortex/burst.ts`)

Faits : à *Action !*, tout le monde retourne à sa case de départ, les monstres meurent, le Vortex reçoit un bonus par
heure distincte, reste invulnérable et passe un tour ; il joue ensuite avec 16 PA / 5 PM, *Heurage* (téléportation au
contact de l'Auroraire, relance 3), *Heuristique* (ligne 1-8 sans LdV, 3×/tour, Pacifiste désenvoûtable), *Morfaille*.

```ts
export interface BurstPlan {
  vulnerableFrom: SlotRef                 // premier créneau joueur avec Vortex vulnérable
  prepSlots: SlotRef[]                    // créneaux « à vide » (paramètre actionDelay 0/1 + tour passé)
  steps: { fighterId: number; slot: SlotRef; intents: Intent[] }[]
  reserve: { fighterId: number; spellId: number; untilSlot: SlotRef }[]
  safeCells: (slot: SlotRef) => Uint8Array   // hors lignes du Vortex (8 PO) et de la croix de l'Auroraire prévue
  pKill: number                           // P(Vortex mort avant d'agir) estimée
}
```

Algorithme :

1. **Prévoir le Vortex** : caractéristiques = grade + bonus des heures distinctes (connues exactement par le tracker) ;
   position = case de départ ; après son premier tour vulnérable, case adjacente à la case d'heure de l'Auroraire
   (Heurage) — d'où `safeCells`.
2. **Options par joueur** : top 5 rotations de burst contre le Vortex (dpt avec les buffs actifs à ce créneau), options
   de buff allié avec durée couvrant le créneau de burst (ex. Âge d'Or +200 Puissance « au tour suivant », Puissance du
   Iop +300, Ruée vers l'Or +4 PM, Boîte à Outils), débuffs (résistances, dommages subis), retrait de PM du Vortex
   (esquive PM 20).
3. **Programmation dynamique** dans l'ordre de la timeline (l'ordre P1..P4 est fixe) sur (créneau, buffs actifs,
   sorts réservés) avec faisceau 32 : objectif `P(Σ dégâts ≥ PV_V)` avec approximation normale (μ, σ² des
   distributions DoMath), contrainte de sécurité (case finale ∈ `safeCells` si le burst échoue), puis plan B pour le
   tour suivant (retirer des PM, dissiper Pacifiste, se remettre hors ligne).
4. **Prix** : pendant le burst, `kill[Vortex] = 20 000` (victoire) et `hp.slope = 1 + 2 · ∂pKill/∂dégâts · 20 000`
   (normalisé) ; pendant la préparation, intentions `setup`, `reserve`, `position`, `control(Vortex, mpMax)` valorisées
   par `ΔpKill · 20 000`.

Si `pKill < θ.burst.minCommit` (0,6), le plan vise deux tours : premier tour de dégâts sûrs hors lignes, retrait de
PM/PA, puis burst au tour suivant (le Vortex aura joué une fois : `protect`/`survive` prioritaires).

### 6.9 Placement initial (`vortex/placement.ts`)

Affectation des 4 joueurs à 4 des 12 cases rouges : 12 × 11 × 10 × 9 = 11 880 affectations évaluées analytiquement
(≈ 5 µs chacune, ≈ 60 ms). Objectif : exposition au tour 1 (portées des monstres depuis les cases bleues, lignes de la
Méjaire), croix de l'Auroraire au premier créneau du Vortex (IV si k = 4 : éviter 427 et 440 ; III si k = 3), case 484
(échange forcé à VII), **position de phase 2** (*Action !* ramène chacun à sa case de départ : distance et lignes vers
la case de départ du Vortex, accès au burst), préférences de rôle (tank devant, tueurs à portée). Le placement est donc
une décision stratégique de début **et** de fin de combat.

### 6.10 Paramètres INCERTAINS (`vortex/params.ts`)

| Paramètre | Défaut | Variantes échantillonnées |
|---|---|---|
| `arrivalRounds` | [1, 7, 12, 17, 22] | [1, 6, 11, 16, 21] |
| `wave1Invulnerable` | false | true |
| `rezHpPct` | 0,25 (20-30 %) | 0,5 (guides) |
| `rezAllPerTurn` | true | false (dernier mort seulement) |
| `deadPlayerAdvancesClock` | false | true |
| `actionDelay` | 1 (DPLN) | 0 (lecture du client) |
| `unlockVortexTurn` | 26 | 25, 27 |
| `glyphTrigger` | entrée | fin de tour |
| `playersStartFirst` | selon initiative (moteur) | forcé false (k = 3) |
| `rezMpMalus` | 0 | −1 PM |

Chaque graine de Monte-Carlo tire une variante (poids 0,7 au défaut, 0,3 réparti) : une stratégie retenue doit être
robuste aux incertitudes, et le rapport détaille le taux de victoire par variante.

---

## 7. Couche tactique (`src/ai/tactical`)

### 7.1 Macro-actions et plan de tour

```ts
export type MacroAction =
  | { kind: 'cast'; path?: number[]; spellId: number; cell: number }
  | { kind: 'move'; path: number[]; tag?: 'glyph' | 'block' | 'tackle' | 'safety' }
  | { kind: 'seq'; steps: MacroAction[]; tactic: TacticId }        // séquence proposée par une tactique
export interface TurnPlan { actions: MacroAction[]; finalMove?: number[]; value: number
  predicted: StateDigest[]; explain: string[] }
```

### 7.2 Génération des candidats et règles d'élagage

Trois sources, fusionnées avec quotas (fractions du `topK` par catégorie : dégâts 0,45 · contrôle 0,2 ·
placement 0,15 · utilitaire 0,1 · tactiques 0,1 ; modulées par le rôle et la pertinence des tactiques) :

1. **Génériques** : pour chaque sort statiquement lançable (PA, relance, `statesCriterion`, `maxCastPerTurn`, sort
   non `unsupported`, non réservé), pour chaque case de lancer de l'accessibilité (case actuelle incluse), pour chaque
   case cible : cases occupées, centres de zone touchant ≥ 1 ennemi (ou ≥ 2 entités), cases libres proposées par les
   tactiques/intentions (≤ 8) ; filtre final `canCast(..., { fromCell })`.
2. **Intentions et prix** : sorts capables d'atteindre la cible d'un contrat (`kill` positif), chemins vers les cases
   `position`, chemins traversant un glyphe si `clock[1] > 0` ou si le bonus de glyphe vaut le coût.
3. **Tactiques** (§8) : séquences de 1 à 4 macro-actions.

Règles d'élagage :

* au plus **3 cases de lancer** par (sort, cible), choisies par (coût de tacle, `cell[c]` scénario, danger de la case) ;
* **dominance** : même sort, même ensemble de cibles touchées, case finale de même classe de danger → garder la moins
  coûteuse en PM ; centres de zone symétriques touchant les mêmes entités → un seul ;
* **tir ami** : rejet si `quick` prévoit plus de dégâts alliés qu'ennemis sans intention qui le justifie ;
* **interdits doux** : un candidat qui tuerait un monstre de prix `kill < −1 000` n'est simulé que si aucun autre
  candidat de la catégorie ne dépasse 0 (il reste possible, la simulation tranche) ;
* **transpositions** : hachage (cases, PV par paliers de 50, PA/PM, relances, uid des buffs) → on garde la meilleure ;
* préfiltre `quick` (≤ 1 µs, sans clone) pour trier, puis simulation des `topK` seulement.

### 7.3 Recherche en faisceau

```ts
function searchTurn(ctx: TacticalContext): TurnPlan {
  const root = makeRoot(ctx)                                   // simClone : average, RNG décorrélé, record=false
  let beam = [root]; const leaves: Node[] = [root]
  for (let depth = 0; depth < ctx.budget.maxDepth && beam.length; depth++) {
    const children: Node[] = []
    for (const node of beam) {
      const cands = generate(ctx, node)                        // §7.2 (3 sources, quotas)
      for (const c of rankQuick(ctx, node, cands).slice(0, ctx.budget.topK)) {
        if (ctx.nodes.exhausted()) break
        const child = expand(node, c)                          // clone + chemin + sort(s) + déclencheurs
        if (!child.ok) continue
        child.value = evalLeaf(ctx, child)                     // §7.4 (sans déplacement final)
        children.push(child); leaves.push(child)
      }
    }
    beam = selectDiverse(dedupe(children), ctx.budget.width)   // ≥ 1 nœud par famille : dégâts/contrôle/placement/utilitaire
  }
  for (const l of leaves) l.final = l.value + bestFinalMove(ctx, l)
  const top = topN(leaves, ctx.budget.rollouts)
  for (const l of top) l.final = 0.5 * l.final + 0.5 * teamRollout(ctx, l)   // §7.5
  return extractPlan(argmax(leaves, l => l.final))
}
```

`bestFinalMove` : cases accessibles avec les PM restants (coût de tacle attendu), score =
`0,8 · ΔIncoming_moi + cell[c] + position(rôle) + intentions position/survive` ; ne pas bouger si le gain < 5 PVe.

### 7.4 Évaluation de feuille

```
evalLeaf(s) = V(s0, s)                         // §4.6, avec ajustements de scénario §4.7
            + Σ_m kill[m][xDeath(m, s)]         // xDeath lu dans les états (heure posée, étoile au décès)
            + Σ_m hp[m].slope · ΔPV_m + bandes  // paliers attendus par l'allié suivant
            + clock[glyphesDéclenchés(s)]
            + Σ_i price_i · sat_i(s0, s)        // intentions du combattant courant
            + tacticSetupValue(s)               // petit (≤ 100 PVe), seulement pour les tactiques à effet différé
```

### 7.5 Rollouts d'équipe (coordination séquentielle)

En Dofus les tours alternent (P1 M1 P2 M2 …) : la meilleure coordination consiste à jouer **sachant ce que fera
l'allié suivant après la réponse des monstres**.

```ts
function teamRollout(ctx: TacticalContext, leaf: Node): number {
  const s = cloneForRollout(leaf.state, leaf.finalMove)
  for (const slot of ctx.forecast.after(ctx.slot)) {
    if (slot.team !== ctx.team) playMonsterPredict(s, slot)          // MonsterBrain topK 4, mêmes profils
    else { playAllyFast(s, slot, ctx.blackboardFrozen); break }      // allié suivant : mode fast + ses intentions
  }
  return evalLeaf(ctx, nodeOf(s))                                    // même échelle que la feuille
}
```

Pessimisme optionnel (θ.β = 0,25) : pour le monstre le plus menaçant, on évalue aussi sa deuxième meilleure réponse et
on mélange `(1 − β)·meilleure + β·pire`. Ce rollout capte les combos « mise en place » : regrouper pour la zone du Iop,
porter un monstre au contact du tank, retirer des PM pour que l'allié suivant joue en sécurité, pré-dégâts au bon
palier pour le tueur désigné.

### 7.6 Exécution, écart et replanification (`executor.ts`)

Après chaque action réelle (`rollMode: 'random'`), comparaison au `StateDigest` prévu : replanification si une cible
prévue morte a survécu (ou l'inverse), si l'écart de PV d'une cible dépasse 15 % des dégâts prévus, si PA/PM/case du
joueur diffèrent (esquive, tacle, poussée), si un combattant apparaît/disparaît, ou si l'heure a changé. Sinon on
poursuit le plan (économie de calcul). Garde : ≤ 12 actions par tour ; replanifications ≤ 4 par tour.

### 7.7 Modes et budgets

| Mode | Joueurs | Faisceau / topK / profondeur | Rollouts | Pricer | Nœuds max / tour | Usage |
|---|---|---|---|---|---|---|
| `scripted` | rotations (DSL `scripted.ts`) | — | — | heuristique (affichage) | ~0 | « sans IA », comparer des stratégies écrites à la main |
| `fast` | glouton + replan | 1 / 6 / 4 | 0 | `HeuristicPricer` | 30 | Monte-Carlo massif |
| `standard` | faisceau | 6 / 12 / 5 | 3 | `SearchPricer` | 1 500 | évaluation fine, rapports |
| `deep` | faisceau + alternatives | 12 / 20 / 6 | 6 | `SearchPricer` deep | 15 000 | démo, rembobinage |

DSL scripté (exemple) : `{ phase: 'waveCycle', role: 'mpLock', do: ['Maladresse x4 @ meleeThreats',
'Pelle Aurifère @ focus', 'move safe'] }` — exécuté par le même `Executor`, les prix servant seulement à choisir parmi
les cibles admises par le script.

---

## 8. Bibliothèque de tactiques créatives (`src/ai/tactics`)

### 8.1 Interface

```ts
export type TacticId = 'mpLock' | 'apLock' | 'bodyBlock' | 'tackleTrap' | 'carryThrow' | 'pushCollision'
  | 'groupForZone' | 'glyphClock' | 'glyphBuff' | 'healCleanse' | 'losShield' | 'corruptedWall'
  | 'baitSummon' | 'dispelAlly' | 'burstSetup' | 'lineDodge'

export interface Tactic {
  id: TacticId
  /** Filtre par capacités, évalué une fois par combat (ex. porter-jeter ⇒ sorts carry + throw). */
  requires(cap: CapabilityProfile, spells: SpellProfile[]): boolean
  /** Pertinence dans l'état courant, O(µs) : 0 = ne rien proposer ; sert aussi au quota. */
  relevance(ctx: TacticalContext, node: Node): number
  /** Séquences candidates (1 à 4 macro-actions), simulées et évaluées comme les autres. */
  propose(ctx: TacticalContext, node: Node, limit: number): MacroAction[]
  /** Valeur différée non captée par V (rare, bornée à 100 PVe). */
  setupValue?(ctx: TacticalContext, s0: FightState, s: FightState): number
}
```

Une tactique ne **décide** jamais : elle injecte des candidats que la génération générique n'aurait pas produits
(cases libres choisies, séquences dont la valeur n'apparaît qu'au 2e ou 3e pas). Quota par tactique =
`θ.tactics.prior[id] · relevance`, prior initial 1,0, réglé par la boucle externe (L2).

### 8.2 Catalogue

| Tactique | Classes typiques | Proposition | Valeur captée par |
|---|---|---|---|
| `mpLock` | Enutrof, Crâ, Sram, Féca, Iop (Couperet) | retirer à chaque monstre de CàC juste assez de PM pour qu'il n'atteigne personne (ordre : cibles dont `f_e` bascule) | `incomingΔ` (f_e → 0,25) |
| `apLock` | Xélor, Enutrof, Féca | descendre une cible sous un multiple de 4 PA (sorts des monstres du Vortex à 4 PA) | `incomingΔ` |
| `bodyBlock` | toutes ; invocations (Osamodas, Sadida, Enutrof, Roublard) | occuper les cases d'étranglement du chemin d'un monstre vers nos alliés | `incomingΔ` (reach) |
| `tackleTrap` | tank, Pandawa, Féca | se coller à un monstre faible en fuite (Buboxor 6 PM) | `incomingΔ`, position |
| `carryThrow` | Pandawa | porter un monstre → marcher → le jeter (groupe, isolement, glyphe, contact du tank) ; ou extraire un allié | V + rollout allié |
| `pushCollision` | Iop, Crâ, Enutrof (Pelle Animée), Steamer | pousser une cible contre une autre (dommages de collision ×2^k) | `enemyDamage` |
| `groupForZone` | Pandawa, Xélor, Iop (Rassemblement), Steamer | rapprocher 2-3 monstres dans la zone de l'allié suivant | `potentialΔ` + rollout |
| `glyphClock` | toutes | traverser un glyphe de monstre pour avancer l'horloge (avant/après un kill) | `clock[k]`, `kill[m][h]` |
| `glyphBuff` | toutes | prendre un glyphe pour son bonus (Harpille +200 Puissance avant le burst, Méjaire soin 10 %) | V, `clock[k]` |
| `healCleanse` | Eniripsa, Enutrof (Pandore), Pandawa, Osamodas | soin minimal sur chaque empoisonné (« Petit poison » retiré par un soin) ; ou entrer dans le glyphe de Méjaire | `pendingDoT` |
| `losShield` | toutes, Roublard (murs), invocations | finir derrière un obstacle / un corrompu hors des lignes de Méjaire et des diagonales de Harpille | `incomingΔ` |
| `corruptedWall` | Pandawa, Xélor (échanges) | déplacer des monstres **corrompus** (invulnérables, déplaçables, bloquent la LdV) pour murer les lignes de la vague suivante | `incomingΔ` des tours suivants (setupValue ≤ 100) |
| `baitSummon` | Osamodas, Sadida, Enutrof, Roublard | invoquer sur le chemin des monstres une cible « tuable » qui détourne leurs coups (`monster-ai.md` §4.1) | rollout (réponse monstre) |
| `dispelAlly` | Eniripsa, Féca, Pandawa | dissiper Pacifiste (Heuristique) sur le DPS clé | `potentialΔ` |
| `burstSetup` | Iop, Enutrof, Eniripsa, Ecaflip | buffs/débuffs dont la durée couvre le créneau de burst ; réserver les gros sorts | intentions `setup`/`reserve` |
| `lineDodge` | toutes | case finale hors de la croix de l'Auroraire au créneau du Vortex et hors de la ligne 8 PO du Vortex (phase 2) | `cell[c]`, `extraIncoming` |

### 8.3 Détail de cinq tactiques

**`mpLock` (Enutrof « qui enlève les PM »)**

```
pour chaque ennemi e de CàC/ligne courte trié par menace :
   need_e = PM_next(e) − PMmax tel que f_e(a) ≤ 0,25 pour tout allié a   // BFS inverse depuis les cases de lancer de e
   si need_e ≤ 0 : continuer
   options = sorts de retrait PM (Maladresse 1 PA ×4 sur 4 cibles distinctes, Pelle Aurifère, Tamisage, Clef de Bras
             non esquivable) ; espérance = expectedApMpRemoved(retrait, esquive, PM)
   proposer la séquence de coût minimal en PA atteignant need_e avec P ≥ 0,7, en servant d'abord les menaces dont
   le tour vient en premier dans la timeline
```

Les monstres de vague ont 0 esquive de base (`monster-ai.md` §7.1) : la tactique rapporte beaucoup contre Ikargn,
Buboxor, Brabuzar (`f_e` 1 → 0,25 ≈ −1 000 à −2 000 PVe de menace chacun).

**`bodyBlock`**

```
pour chaque ennemi menaçant e : couche BFS des distances de e vers les cases de lancer sur nos alliés
   cases d'étranglement = cases présentes dans TOUS les plus courts chemins (articulation du DAG des plus courts chemins)
proposer : se déplacer sur la case (allié), invoquer dessus, jeter un allié/monstre corrompu dessus, y pousser un monstre
```

**`carryThrow` (Pandawa « qui place »)**

```
pour chaque entité x adjacente atteignable (Karcham/Chamrak, 1 PA, Porteur requis pour jeter) :
   cases de jet Y = { cases à portée du jet } triées par but :
      - groupe : Y maximisant le nb d'ennemis dans la zone du meilleur sort de l'allié suivant (dpt zone)
      - isolement : Y loin des soigneurs/alliés de x ; sur un glyphe/piège allié ; au contact du tank
      - sauvetage (x allié) : Y ∈ cases sûres (Incoming minimal) ou hors croix de l'Auroraire
   proposer seq(carry x, move ≤ 2 chemins, throw Y) pour les 3 meilleurs Y par but
```

**`glyphClock`**

```
si |clock[1]| > glyphCost ou un glyphe offre un bonus utile :
   pour chaque glyphe de monstre actif atteignable (case libre, PM suffisants, tacle acceptable) :
      proposer move(chemin traversant le glyphe) en tête de plan (glyphe puis kill)
      et en fin de plan (kill puis glyphe) — l'échange de place avec le poseur est simulé par le moteur
```

Inversement, quand `clock[1] < 0` (avancer l'heure ruinerait une étoile), les chemins de tous les candidats évitent les
cases de glyphe (cases-événements du BFS, §4.3).

**`healCleanse`**

```
si pendingDoT(alliés) > 0 et poison « retiré par soin » (déclencheur H) :
   couverture minimale des empoisonnés par les soins disponibles (soin de zone > soins unitaires bon marché),
   ou chemin passant par un glyphe de Méjaire (soin 10 % : purge + PV) si clock[1] ≥ −glyphCost
```

### 8.4 Comment la créativité émerge (et reste saine)

1. **Prix non-dégâts** : retrait de PM, Pacifiste, blocage, dissipation, purge, sécurité de ligne ont une valeur en PVe
   (menace évitée, potentiel gagné) : ils concurrencent les dégâts à armes égales.
2. **Séquences proposées** par les tactiques : la recherche voit des combos à 3 pas (porter → marcher → jeter) qu'un
   glouton n'atteindrait jamais.
3. **Rollouts d'équipe** : un tour qui ne rapporte rien seul mais prépare l'allié suivant est mesuré.
4. **Objectifs de scénario** : glyphe pour régler l'heure, ne pas tuer maintenant, tuer deux monstres sous la même
   étoile, mur de corrompus : comportements qui n'apparaissent que parce que le plan les paie.
5. **Boucle externe** : priors des tactiques, poids de V et coûts du planificateur réglés sur le taux de victoire ;
   exploration ε (5 %) sur l'ordre des candidats en mode `fast` pendant le réglage pour découvrir d'autres lignes.
6. **Garde-fous** : aucun sort `unsupported` (E5) n'est proposé ; le rapport liste l'usage de chaque tactique et un
   replay exemple par tactique (« audit d'exploit ») ; une tactique qui repose sur une mécanique INCERTAINE (ex. jeter
   un monstre sur la case IV pour qu'il soit échangé vers III, non marchable) est désactivée par défaut et testée à
   part.

---

## 9. IA des monstres (fidèle) — `src/ai/monster`

Implémentation de `monster-ai.md` §8, branchée sur le socle commun :

```ts
export type Behaviour = 'aggressive' | 'fearful' | 'kiter' | 'devoted' | 'blocker' | 'mad' | 'apathetic' | 'static'
export interface MonsterAIProfile {
  behaviour: Behaviour
  capabilities?: Partial<Record<'summon' | 'heal' | 'buff' | 'kamikaze' | 'invisible', boolean>>
  weights?: Partial<MonsterScoreWeights>
  preferredRange?: [number, number]; castOrder?: number[]
  openers?: { spellId: number; minTargets?: number }[]
  alwaysCastWhenReady?: number[]; forbidSpells?: number[]
  stateValue?: Record<number, 'targetThreat' | number>
  lookahead?: 0 | 2 | 3          // beam local sur 2-3 actions (Ikargn, Brabuzar) — sinon glouton
  hooks?: MonsterHooks           // beforeTurn, filterCast, scoreCast, endPosition
}
export class MonsterBrain implements Controller {
  constructor(private cfg: { topK: number; noiseTau: number; mode: 'play' | 'predict' }) {}
  playTurn(engine: Engine, fight: FightState, me: Fighter): void   // boucle §8.2 de monster-ai.md
}
```

* **Résolution du profil** : `overrides[monsterId]` → profil déclaratif (`VORTEX_PROFILES`, `monster-ai.md` §7.3) →
  archétype inféré des sorts (§3) ; `fighter.tags.aiBehaviour` (effet 2188, règle R12 du peureux) surcharge le
  comportement courant.
* **Boucle** : effets `TB` déjà appliqués (R19) → `beforeTurn` (Vortex : Heurage dès que lançable, En temps et en
  heure si un ennemi est aligné avec l'Auroraire) → tant que le meilleur candidat ≥ `minActionScore` : candidats →
  préfiltre analytique → simulation des topK sur clone `average` → score §8.4 (PVe, dégâts plafonnés, bonus de kill,
  retraits pondérés par la menace, états, `nextHitBonus`) → exécution → rafraîchissement (R10, R11, R18) →
  déplacement de fin de tour par comportement (§8.6).
* **Réglage unique** : `topK = 8` + candidats obligatoires (`openers`, `alwaysCastWhenReady`) dans **tous** les modes
  joueurs, pour que les résultats `fast`/`standard`/`deep` restent comparables ; `lookahead` local (faisceau 3,
  profondeur 3) seulement pour les monstres qui en ont besoin (Attraction ailée → Cercle de feu ; Décollage → Mise en
  situation → Neutralisation).
* **Mode `predict`** (rollouts des joueurs) : mêmes profils, `topK = 4`, pas de lookahead ; écart mesuré par un test
  (taux d'accord des actions avec le mode `play` ≥ 85 % sur les golden tests).
* **Bruit** : `noiseTau` (0 par défaut ; 0,1/0,3 en variantes Monte-Carlo) = tirage softmax sur le top-3, flux RNG
  dédié (§10).
* **Overrides Vortex** : `vortex.ts` reprend `monster-ai.md` §8.7 (phase lue sur l'état 236, Contamination zombie
  filtrée, Heuristique valorisée par la menace de la cible + valeur des buffs dissipés, fin de tour en ligne d'un
  maximum de personnages en phase 2).
* **Budget** : ≤ 1,5 ms par tour de monstre (≈ 24 nœuds × 60 µs) ; tests R1-R25 et T1-T10 (§13).

L'IA des monstres sert aussi à la **prévision** côté joueurs : le modèle de menace (§4.4) est sa version analytique,
calibrée sur elle (test : corrélation des dégâts prévus/réalisés ≥ 0,8 sur 500 tours).

---

## 10. Aléa, graines, déterminisme

### 10.1 Flux

| Flux | Source | Usage |
|---|---|---|
| dés du combat | `fight.rngState` (mulberry32), re-semé par tour si E1 : `mix32(fightSeed, round, fighterId)` | jets de dégâts, CC, esquive PA/PM, groupes aléatoires |
| simulations de l'IA | clones en `average`, `rngState = mix32(fight.rngState ^ 0x5bd1e995, sel)` | pas de lecture du futur ; groupes aléatoires tirés sur un flux indépendant |
| bruit IA | `Rng(mix32(fightSeed, 0xA1))` (sfc32, `core/rng.ts`) | `noiseTau` des monstres, exploration ε |
| variante de scénario | `Rng(mix32(masterSeed, 0x5C, i))` | §6.10 |

### 10.2 Graines et CRN

`fightSeed(i) = mix32(masterSeed, i)` est **le même pour toutes les configurations comparées** (nombres aléatoires
communs) ; avec E1, deux stratégies qui divergent au tour 3 retrouvent les mêmes dés aux tours suivants pour chaque
(tour, combattant). La variance des comparaisons appariées baisse d'un facteur 3 à 10 (à mesurer, bench B6).

### 10.3 Déterminisme et replays

* Aucune décision ne dépend du temps machine : budgets en nœuds, départage par ordre stable (index de candidat,
  hachage d'état), jamais par `Math.random`.
* Un combat Monte-Carlo est rejoué à l'identique avec `record: true` (mêmes graines, même config) pour produire son
  replay animé ; test de déterminisme : hachage du journal identique avec `record` on/off, en 1 ou 4 workers.
* Le `TeamBrain` est une fonction déterministe de l'historique ; `snapshot()` le rend rembobinable.

### 10.4 Paramètres INCERTAINS

Chaque graine porte une variante (§6.10, et équivalents génériques : ordre de l'équipe qui commence, dénominateur du
retrait PA/PM). Les résultats sont agrégés globalement **et** par variante ; une configuration dont le taux de victoire
s'effondre sur une variante est signalée (« fragile à `actionDelay = 0` »).

---

## 11. La boucle d'itérations (`src/optimizer`)

### 11.1 Niveaux

| Niveau | Question | Méthode | Unité de coût |
|---|---|---|---|
| L0 | meilleur tour | §7 (dans le combat) | nœuds |
| L1 | cette configuration gagne-t-elle ? | Monte-Carlo sur graines × variantes, CRN, arrêt séquentiel | combats |
| L2 | meilleurs paramètres de stratégie θ | CEM (espace log) sur 8-12 paramètres sensibles | campagnes L1 |
| L3 | meilleur stuff par personnage | proxy analytique + recuit, puis validation L1 | évaluations de stats, puis combats |
| L4 | meilleures variantes de sorts | préréglages par rôle + inversions ciblées, comparaisons appariées | combats |
| L5 | meilleure composition (19 classes) | prior analytique → *successive halving* en `fast` → affinage L2-L4 → validation `standard` | combats |
| L\* | une ligne gagnante (démo) | rembobinage stratégique | combats partiels |

### 11.2 Monte-Carlo (L1)

```ts
export interface SimConfig { team: MemberConfig[]; scenario: 'vortex' | string; mode: AIMode; theta: StrategyParams
  monsterNoise: number; variantPolicy: 'default' | 'sampled' }
export interface MemberConfig { breedId: number; build: CharacterBuild; role?: RoleId; variants: (0 | 1)[] }
export interface FightSummary { seed: number; variant: string; win: boolean; rounds: number
  phaseReached: PhaseId; corrupted: number; totalWaveMonsters: number; deaths: number; vortexHpPct: number
  hoursUsed: number; fitness: number; failReason?: string; tactics: Partial<Record<TacticId, number>>
  nodes: number; unknownEffects: number }
```

Fitness façonnée (utile tant que le taux de victoire est nul) :
`F = 1 000·win + 300·corrompus/total + 200·[phase 2 atteinte] + 200·(1 − PV%Vortex) − 150·morts − 2·tours`.
Classement : borne basse de Wilson à 95 % du taux de victoire si au moins une victoire, sinon moyenne de F.
Arrêt séquentiel des comparaisons appariées (même graine) : on arrête dès que l'IC à 95 % de la différence exclut 0,
ou au plafond de graines. `failReason` est regroupé (mort sur la croix de l'Auroraire, Pacifiste de Méjaire,
submersion, vague non corrompue au tour 26, burst raté, limite de tours) pour le rapport.

### 11.3 Paramètres de stratégie θ (L2)

θ regroupe : poids de V (§4.6), configuration du planificateur (coûts d'heures `hourCostScale`, `wExposure`,
`glyphCost`, `failCost`, `commit`), priors de tactiques, `β` du rollout, seuils (`emergency`, `burst.minCommit`).
Procédure : analyse de sensibilité (±50 % un par un, 64 graines CRN) → 8-12 paramètres retenus → **CEM** en
log-espace : 8 itérations × 12 candidats × 16 graines CRN (≈ 1 500 combats `fast`), élites 25 %, lissage 0,7.
θ est réglé **par composition** (les priors d'un Pandawa ne valent rien sans Pandawa) avec un θ global comme départ.

### 11.4 Stuff (L3)

```ts
export interface StuffObjective { role: RoleId; elements: Element[]
  targetMix: { res: Stats; weight: number }[]          // monstres des vagues (faiblesses −10 %) + Vortex phase 2
  incomingMix: Record<Element, number>                  // éléments subis (Ikargn, Méjaire, Harpille, Buboxor, Vortex...)
  constraints: { apMin: 12; mpMin: 6; rangeMin: number; initiativeMin?: number; exoProfile: 'thlStandard' | 'thlOptimized' }
  weights: { dpt: number; ehp: number; utility: number } }
```

1. **Proxy** `J(build) = w_dpt·DPT_rôle + w_ehp·EHP + w_util·Utilité − pénalités(contraintes)` ; DPT_rôle = rotation du
   rôle (préréglage de variantes) évaluée par les tables DPT sur `targetMix` ; EHP = PV / (1 − rés.% moyennes
   pondérées par `incomingMix`) (+ tacle/fuite pour tank/tueur) ; Utilité = retrait PM/PA espéré (rôle `mpLock`),
   soins, invocations ; contrainte d'initiative optionnelle (faire commencer l'équipe → k = 4 au Vortex, §6.1).
2. **Recherche** : pool par emplacement (niv. ≥ 180, ≥ 1 caractéristique utile au rôle, 40 meilleurs par gain
   marginal), recuit simulé 20 000 itérations, mouvements « changer un objet », « poser/retirer un bloc de panoplie
   (2-4 objets) », « déplacer l'exo PA/PM », « échanger un Dofus/trophée » ; évaluation incrémentale par vecteurs de
   stats (`fastStats`, ≈ 2 µs) puis `computeBuildStats` (conditions, plafonds) sur les 50 meilleurs.
3. **Validation** : 5 builds diversifiés par (classe, rôle) comparés en L1 appariée ; les poids `w` par rôle sont
   eux-mêmes réglés une fois (L2 sur 3 compositions de référence).

### 11.5 Variantes de sorts (L4)

Départ : préréglage par rôle (`classes/*.md`, ex. Enutrof « entraveur PM »). Candidats d'inversion : paires dont le
sort n'a jamais été lancé dans 64 combats, paires citées par la doctrine du rôle, paires dont la variante débloque une
tactique (`requires`). Évaluation appariée en `fast` (16-32 graines), acceptation gloutonne si gain significatif ;
≤ 6 inversions testées par personnage.

### 11.6 Composition (L5)

```
espace = multisets de 4 (classe, préréglage de rôle) — ≤ 2 personnages de la même classe (paramètre)
prior(team) = Σ_besoins min(1, couverture) · poids_besoin          // besoins du scénario (§5.1)
            + Σ_paires synergie(c1, c2)                              // table issue des classes/*.md (Pandawa×Iop zone...)
            + diversité élémentaire vs faiblesses des 5 monstres + burst estimé sur le Vortex (dpt, buffs)
            + aptitude au planning d'heures : nb de joueurs « tueurs » capables de corrompre un zombie seuls
shortlist = top 120 par prior
successive halving (fast, CRN, variantes échantillonnées) :
   120 × 8 graines → 40 × +16 → 13 × +32 → 4 × +64            (≈ 2 300 combats ≈ 9 min sur 4 cœurs)
pour les 4 meilleures : L3 (stuff) → L4 (variantes) → L2 (θ) (≈ 8 min chacune)
validation finale : mode standard, 24 graines × variantes          (≈ 8 min sur 4 cœurs)
```

### 11.7 Rembobinage stratégique (L\*)

Pour « réussir **ce** combat » (démo, ou aider l'utilisateur sur sa propre équipe), on cherche une ligne gagnante en
branchant sur les décisions **stratégiques** (facteur de branchement faible) et non sur les actions :

```ts
function findWinningLine(cfg: SimConfig, seed: number, maxRewinds = 40): { replay?: Replay; best: FightSummary } {
  const cps = new Map<number, Checkpoint>()                 // début de chaque tour de jeu : clone + brain.snapshot()
  let run = startFight(cfg, seed, { onRoundStart: (f, b) => cps.set(f.round, checkpoint(f, b)) })
  for (let k = 0; k < maxRewinds && !run.win; k++) {
    const r = run.failRound                                 // mort d'un allié, défaite, retard irrattrapable
    const back = cps.get(r - (1 + (k % 3)))!                // reculer de 1, 2 puis 3 tours
    const alt = nextUntried(back, ['plannerAlt', 'burstAlt', 'thetaJitter', 'placementAlt'])
    run = resumeFrom(back, alt)                              // mêmes dés par (tour, combattant) grâce à E1
  }
  return { replay: run.win ? rerecord(run) : undefined, best: bestOf(run) }
}
```

`plannerAlt` force l'alternative n° k du `ScenarioPlan` au point de contrôle ; `thetaJitter` perturbe θ de ±20 % ;
`placementAlt` (tour 1 seulement) prend le 2e meilleur placement. Deux variantes : « mêmes dés » (existence d'une
ligne, pour le replay) et « robuste » (au point de contrôle, choisir l'alternative qui maximise le taux de victoire
sur 16 graines). Le rapport distingue clairement les deux.

### 11.8 Workers et lots

```ts
export interface BatchJob { jobId: string; config: SimConfig; seeds: number[]; variantSeed: number
  record: 'none' | 'wins' | 'all' }
export interface BatchResult { jobId: string; summaries: FightSummary[]; replays?: Replay[] }
```

* `pool.ts` : `min(4, os.availableParallelism())` workers `worker_threads` ; chaque worker charge une seule fois le lot
  de données (`MemoryDataStore`, JSON transféré au démarrage) et l'enregistrement des effets ; lots de 8 graines ;
  vol de travail ; agrégation **triée par graine** ⇒ résultats identiques quel que soit le nombre de workers.
* Navigateur : `web/worker.ts`, même protocole (`postMessage`), budgets réduits par défaut, annulation par `jobId`.
* Les replays ne sont produits qu'à la demande (re-simulation `record: true` des graines choisies).

### 11.9 Rapport

`report.ts` produit : meilleure équipe, rôles, stuffs (objets, exos, transcendances), variantes, θ ; taux de victoire
(IC Wilson) global et par variante ; tours moyens ; heures utilisées (et bonus du Vortex qui en résultent) ; usage des
tactiques ; causes d'échec regroupées ; trois replays (victoire médiane, meilleure victoire, échec typique) avec
annotations `aiNote` (plan d'heures, contrats, intentions).

---

## 12. Budget de calcul

### 12.1 Coûts unitaires visés (à mesurer par les bancs B1-B6, §13.5)

| Opération | Cible | Remarque |
|---|---|---|
| `cloneFight` (≈ 12 combattants) | ≤ 12 µs | mesuré 7-10 µs (proposition « recherche ») ; E2 retire `structuredClone` |
| nœud tactique (clone + chemin + sort + effets) | ≤ 70 µs | hypothèse de conception, B1 |
| `quick` (préfiltre) | ≤ 1 µs | |
| `reach` avec tacle (tableaux typés) | ≤ 5 µs | |
| évaluation de feuille (V incrémental + prix) | ≤ 20 µs | |
| expansion du planificateur abstrait | ≤ 2 µs | |
| `HourPlanner` standard (16 × 12) | ≤ 6 ms | + ≤ 6 relances forcées (faisceau 8) ≈ 10 ms |
| `HeuristicPricer` | ≤ 0,1 ms | cache entre événements symboliques |
| tour de monstre (`play`) | ≤ 1,5 ms | 24 nœuds |

### 12.2 Par combat Vortex (4 joueurs, ≈ 35 tours de jeu, ≈ 140 tours de joueurs, ≈ 220 tours de monstres)

| Mode | Joueurs | Planificateur | Monstres | Moteur | Total visé (1 cœur) |
|---|---|---|---|---|---|
| `fast` | 140 × (30 nœuds ≈ 2 ms) = 0,3 s | 140 × 0,1 ms ≈ 0 | 220 × 1,5 ms = 0,33 s | ≈ 0,1 s | **≈ 0,75 s (< 1 s)** |
| `standard` | 140 × (1 500 nœuds ≈ 105 ms) ≈ 15 s | 140 × 10 ms = 1,4 s | 0,33 s | 0,1 s | **≈ 17 s (< 30 s)** |
| `deep` | 140 × 15 000 nœuds ≈ 150 s | 140 × 40 ms = 6 s | 0,33 s | — | ≈ 2,5 min (démo) |

Si B1 mesure plus de 70 µs par nœud, on réduit d'abord `topK` (12 → 9) puis les rollouts (3 → 2) en `standard` ; la
cible des 30 s reste tenue jusqu'à ≈ 120 µs/nœud.

### 12.3 Débit et campagnes (4 cœurs)

* `fast` : ≈ 5 combats/s ⇒ ≈ 16 000-18 000 combats/h ; `standard` : ≈ 0,22 combat/s ⇒ ≈ 800/h.
* Campagne Vortex complète (§11.6) : composition 9 min + affinage 4 × 8 min + validation 8 min ≈ **50 min**.
* Rembobinage (L\*) : ≤ 40 reprises partielles en `standard` ≈ 5-10 min pour une ligne gagnante.

---

## 13. Plan de tests et de validation

### 13.1 Tests unitaires (`tests/ai-*.test.ts`, `tests/vortex-*.test.ts`)

* **Horloge** : `forecastHours` égale l'heure réelle de l'Auroraire (état 221..232) à chaque tour de joueur sur 30 tours
  du scénario réel, sans glyphe, avec 1 et 2 glyphes, avec un joueur mort (selon `deadPlayerAdvancesClock`), avec
  k = 3 et k = 4 ; `starWindows` cohérentes avec la pose réelle de l'état 234.
* **Tracker** : heures, étoiles, statuts lus après kill, résurrection, corruption, arrivée de vague (scénarios
  construits à la main sur la vraie carte).
* **Coût des heures** : `HourCostModel` classe VIII et XI parmi les plus chères pour le Vortex, VII la moins chère.
* **Socle** : `reach` = `reachableCells` hors tacle ; perte de tacle attendue = formule `mechanics.md` §6 ; `dpt`
  = somme d'`expectedDamage` ; menace : retirer tous les PM d'un monstre de CàC isolé fait tomber `f_e` à 0,25.
* **Prix** : `SearchPricer` donne `kill > 0` pour un contrat à l'heure prévue, `< 0` pour la même mort à V/XI ;
  `clock[1] > 0` quand seul un glyphe rend une étoile accessible.

### 13.2 Puzzles du planificateur (état abstrait → plan attendu)

| # | Situation | Attendu |
|---|---|---|
| PL1 | Vague 1 (3 monstres), 4 joueurs k = 4, aucun marquage | marquages à VII/X/II, aucun à V/VIII/XI |
| PL2 | Méjaire marquée VII, Crâ (seul à voir VII) mort, `deadPlayerAdvancesClock = true` | glyphe +1 pendant le tour de P1 (V → VI) ⇒ P2 voit VII et corrompt |
| PL2b | même situation, paramètre par défaut (un mort ne fait plus avancer l'horloge) | P4 voit VII sans glyphe ; palier de pré-dégâts posé pour P4 par P1/P2 |
| PL3 | 8 monstres vivants, 2 vagues chevauchées | corruptions avant nouveaux marquages ; coût de submersion actif |
| PL4 | toutes les heures inoffensives indisponibles (rôles) | accepte IX/VI plutôt que V/XI |
| PL5 | zombie à 1 600 PV, étoile au créneau de P3, P1 surpuissant | prix négatif du kill pour P1 maintenant, contrat P3 |
| PL6 | tout corrompu au tour 18 | phase `waiting`, aucun contrat, intentions `lineDodge` |

### 13.3 Micro-scénarios tactiques (la bonne action « créative » doit être trouvée)

| # | Situation (vraie carte, vrais sorts) | Attendu (mode `standard`) |
|---|---|---|
| TA1 | Buboxor à 8 cases du Iop, Enutrof 12 PA | retrait de PM suffisant plutôt que dégâts |
| TA2 | couloir unique vers le Crâ, Osamodas disponible | invocation sur la case d'étranglement |
| TA3 | Ikargn isolé, 2 monstres groupés, Iop joue ensuite | Pandawa porte et jette l'Ikargn dans le paquet |
| TA4 | contrat de corruption au glyphe près | chemin par le glyphe puis kill (ordre correct) |
| TA5 | 3 alliés sous Petit poison | soin de zone minimal plutôt qu'attaque |
| TA6 | Méjaire alignée à 3 cases | case finale hors ligne/LdV (obstacle ou corrompu) |
| TA7 | Pacifiste (désenvoûtable) sur le Iop avant le burst | dissipation par l'allié qui joue avant lui |
| TA8 | fin de tour avant le créneau du Vortex | aucun allié sur la croix de l'Auroraire prévue |

Chaque test vérifie aussi que la tactique désactivée fait **perdre** de la valeur (preuve que la valeur vient bien de
la tactique, pas d'un hasard).

### 13.4 Monstres

Golden tests T1-T10 de `monster-ai.md` §8.10 et règles R1-R25 testables ; accord `play`/`predict` ≥ 85 % ;
déterminisme des départages.

### 13.5 Bancs (`bench/`, hors `npm test`, seuils en CI optionnelle)

B1 µs/nœud tactique ; B2 ms/tour de joueur par mode ; B3 ms/tour de monstre ; B4 durée d'un combat Vortex
`fast`/`standard` ; B5 débit du pool (1, 2, 4 workers) ; B6 réduction de variance CRN (avec/sans E1).

### 13.6 Combats de contrôle et ablations

* **Cohérence** : 4 personnages contre un mannequin (dégâts totaux = calculateur ± 1 %), Iop contre Ikargn en 1 contre
  1, vague 1 seule, Vortex complet.
* **Échelle de modes** : taux de victoire `scripted` ≤ `fast` ≤ `standard` ≤ `deep` (sinon bug d'évaluation).
* **Ablations** (Monte-Carlo apparié, 200 graines) : planificateur off (kills gloutons) / on ; tactiques off / on ;
  rollouts off / on ; prix heuristiques vs prix par recherche. Attendus : le planificateur augmente fortement le
  nombre de monstres corrompus et réduit les heures utilisées ; les tactiques réduisent les dégâts subis.
* **Déterminisme** : hachage du journal identique (record on/off ; 1 vs 4 workers ; reprise depuis un point de
  contrôle sans changement de décision).
* **Fidélité statistique** : distribution des tours de victoire, heures utilisées et causes d'échec comparées aux
  guides (`vortex.md` §13 : combats de 30-40 tours, heures V/XI évitées).

---

## 14. Risques et parades

| Risque | Effet | Parade |
|---|---|---|
| Modèle abstrait trop optimiste (portée, LdV, fuite des monstres) | contrats infaisables, plans instables | calibration en ligne (`c_i`, `ρ`) ; `failCost` ; replanification chaque tour ; tests PL |
| Prix fictifs trop forts | la tactique sacrifie la sécurité pour un contrat | bornes de prix ; coût de mort dominant ; phase `emergency` ; pessimisme β |
| Double comptage V / prix | sur-valorisation des kills | règle §4.7 : en phase 1 les kills de vague ne passent que par `PriceTable` |
| Mécaniques INCERTAINES (délai d'*Action !*, glyphe à l'entrée, k, PV de rez) | stratégie fragile | variantes échantillonnées (§6.10), rapport par variante |
| Effets non interprétés / bugs du moteur exploités | « créativité » fausse | sorts `unsupported` exclus (E5), audit des tactiques, replays d'exemple |
| Budget de 70 µs/nœud dépassé | > 30 s par combat | budgets en nœuds ajustables, préfiltre analytique, cache DPT/menace, E2 |
| Surapprentissage à l'IA monstre déterministe | stratégie qui casse en jeu réel | bruit `noiseTau`, pessimisme, variantes ; IA monstre identique dans tous les modes |
| Explosion combinatoire (composition × stuff × variantes) | campagnes trop longues | prior analytique, préréglages par rôle, successive halving, CRN |
| Trop de paramètres | réglage illisible | une seule unité (PVe), sensibilité avant CEM, θ par défaut documenté (annexe A) |
| `TeamBrain` hors état ⇒ incohérences au rembobinage | reprises non reproductibles | `snapshot/restore` purs, tests de reprise |
| Navigateur (mémoire, threads) | lenteur côté web | même code, budgets réduits, Web Workers, annulation |

---

## 15. Plan de livraison (CP4 → CP5)

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| M1 | socle `src/ai/core` (reach, dpt, threat, potential, value, sim, timeline) + E1/E2/E4/E5 | tests §13.1 socle, B1/B3 mesurés |
| M2 | `MonsterBrain` + profils/overrides Vortex | T1-T10, R testables, B3 ≤ 1,5 ms |
| M3 | `vortex/` : scénario (vagues, Action !), clock, tracker, hourCost, planner, pricers | tests horloge/tracker, puzzles PL1-PL6 |
| M4 | tactique : `TurnSearch`, intentions, rollouts, executor, modes fast/standard | combats de cohérence, B2/B4 |
| M5 | bibliothèque de tactiques v1 (mpLock, bodyBlock, carryThrow, glyphClock, healCleanse, lineDodge, losShield, dispelAlly) | micro-scénarios TA1-TA8 |
| M6 | optimiseur : pool, L1, L2, rapport | déterminisme 1/4 workers, B5/B6 |
| M7 | L3 stuff, L4 variantes, L5 composition, L\* rembobinage, burst planner, démo | campagne Vortex < 1 h, replay gagnant annoté |

---

## Annexe A — θ par défaut (`data/ai/theta-default.json`, extrait)

```json
{
  "value": { "enemyDamage": 1.0, "killKappa": 0.3, "allyDamage": 1.0, "deathHpMult": 1.5, "deathPotMult": 2.0,
             "heal": 0.6, "shield": 0.8, "incoming": 0.8, "potential": 0.3, "erosion": 0.5, "dot": 0.9,
             "dotDecay": 0.8, "positionCap": 50, "unusedAp": 2, "waveMonsterDamageValue": 0.3 },
  "threat": { "tauFrac": 0.25, "zoneFactor": 0.6, "laterEnemyWeight": 0.8, "fWeak": 0.6, "fNextTurn": 0.25 },
  "planner": { "beamWidth": 16, "horizonPlayerSlots": 12, "rootDiversity": 2, "maxKillsPerSlot": 2,
               "wExposure": 1.0, "corruptBonus": 1500, "failCost": 800, "glyphCost": 120, "commit": 0.1,
               "hourCostScale": 1.0, "lambdaEhp": 0.25, "lambdaBurst": 0.5, "unreachableHourCost": 2000,
               "maxAliveFactor": 2, "overloadCost": 400, "glyphAvailability": 0.6 },
  "prices": { "killMin": -3000, "killMax": 4000, "hpSlopeMax": 1.2, "bandBonusFrac": 0.5 },
  "tactical": { "fast": { "width": 1, "topK": 6, "depth": 4, "rollouts": 0, "nodes": 30 },
                "standard": { "width": 6, "topK": 12, "depth": 5, "rollouts": 3, "nodes": 1500 },
                "deep": { "width": 12, "topK": 20, "depth": 6, "rollouts": 6, "nodes": 15000 },
                "beta": 0.25, "replanHpDev": 0.15, "maxReplans": 4, "minMoveGain": 5,
                "quotas": { "damage": 0.45, "control": 0.2, "placement": 0.15, "utility": 0.1, "tactics": 0.1 } },
  "tactics": { "prior": { "mpLock": 1, "apLock": 1, "bodyBlock": 1, "tackleTrap": 1, "carryThrow": 1,
               "pushCollision": 1, "groupForZone": 1, "glyphClock": 1, "glyphBuff": 1, "healCleanse": 1,
               "losShield": 1, "corruptedWall": 0.5, "baitSummon": 0.7, "dispelAlly": 1, "burstSetup": 1,
               "lineDodge": 1 }, "epsilon": 0.05 },
  "commander": { "emergencyDeathProb": 0.35, "protectDeathProb": 0.15, "maxIntentsPerAlly": 3 },
  "burst": { "victoryValue": 20000, "minCommit": 0.6, "beam": 32, "phase2VortexTurns": 2 },
  "monster": { "topK": 8, "predictTopK": 4, "noiseTau": 0, "minActionScore": 1 }
}
```

---

## Annexe B — Déroulé illustratif d'un plan (Œil de Vortex, 4 joueurs)

Équipe hypothétique, ordre de timeline P1 Enutrof (retrait PM), M1, P2 Iop (tueur), M2, P3 Crâ (tueur), M3,
P4 Pandawa (placeur), Vortex (k = 4). Heures vues sans glyphe : P1 I/V/IX, P2 II/VI/X, P3 III/VII/XI, P4 IV/VIII/XII.
Vague 1 : Vortex + Ikargn, Méjaire, Harpille. Coûts (§6.4) : les seules heures « gratuites » vues par des tueurs sont
**VII (P3)** et **X / II (P2)** ; le planificateur converge donc vers des marquages à VII et X.

| Tour | P1 Enutrof | P2 Iop | P3 Crâ | P4 Pandawa | Vortex (résurrections) |
|---|---|---|---|---|---|
| 1 (I/II/III/IV) | `mpLock` Ikargn + Harpille ; prix kill < 0 partout (heure I) | pré-dégâts Méjaire (palier ≤ 2 500 pour P3 au tour 2) | pré-dégâts Harpille | `carryThrow` : éloigne la Méjaire des lignes ; hors croix de IV | — |
| 2 (V/VI/VII/VIII) | contrôle ; **ne pas tuer** à V (prix −2 500) | pré-dégâts Harpille (VI : prix négatif, VII arrive juste après) | **marque** Méjaire + Harpille à **VII** | contrôle Ikargn ; VIII interdit | Méjaire, Harpille reviennent (≈ 25 % PV, bonus VII inoffensif) |
| 3 (IX/X/XI/XII) | pré-dégâts Ikargn ; `healCleanse` si Petit poison | **marque** Ikargn à **X** | `losShield` (XI interdit) | `bodyBlock` des zombies | Ikargn revient (bonus X) |
| 4 (I/II/III/IV) | contrôle des zombies (ni mort ni frappe) | — | — | `lineDodge` | — |
| 5 (V/VI/VII/VIII) | — | — | étoile VII ⇒ **corrompt** Méjaire + Harpille | — | 2 corrompus |
| 6 (IX/X/XI/XII) | — | étoile X ⇒ **corrompt** Ikargn | — | `corruptedWall` face aux cases bleues | vague 1 terminée |
| 7 | vague 2 invulnérable : `mpLock` sur l'arrivée | placement | placement | `carryThrow` | — |

Si le Crâ meurt au tour 4, le planificateur recalcule les créneaux. Avec le paramètre par défaut (un mort ne fait
plus avancer l'horloge), le tour 5 donne P1 V, P2 VI, P4 **VII** : c'est le Pandawa qui doit corrompre, donc P1 et P2
reçoivent des paliers de pré-dégâts (`hp.band`) pour que deux zombies tiennent dans ses dégâts. Avec la variante
inverse (l'horloge avance encore au créneau du mort), VII tomberait sur le créneau vide du Crâ : le planificateur fait
alors traverser un glyphe par P1 au tour 5 (prix `clock[1]` positif, V → VI) pour que P2 voie VII. En fin de
combat, le Vortex n'hérite que de VII (+150 rés. critiques) et X (Inébranlable) : le burst de phase 2 se joue contre un
Vortex quasi nu, ce qui est exactement la stratégie « même tueur, heures confortables » des guides (`vortex.md` §13),
retrouvée ici par calcul plutôt que codée.
