# Proposition IA & optimiseurs — angle « fidélité & robustesse »

> Proposition de conception pour CP4 (IA des monstres, IA de groupe, scénario Œil de Vortex) et CP5 (Monte-Carlo,
> réglage de stratégie, stuff, composition). Prose en français, identifiants en anglais.
> Lectures préalables : `docs/research/monster-ai.md` (§0, §3-§8), `docs/research/vortex.md` (§0, §3, §5, §6, §8, §13),
> `docs/research/mechanics.md` (§6 tacle, §7 retrait, §8 timeline, §9 durées), `docs/research/classes/*.md`,
> `docs/research/equipment.md` (§0, §11.3, §12).
> Hypothèse de travail : `castSpell`/`applyEffects` exécutent fidèlement les données, `Engine.cloneFight` est complet,
> `rollMode: 'average'` donne l'espérance des jets.
>
> **Angle** : les monstres jouent comme l'IA générique officielle (gloutonne + comportements), toujours de la même
> façon quel que soit le budget de calcul ; les joueurs jouent avec une IA gloutonne « une action à la fois +
> replanification », guidée par des heuristiques bien conçues (carte des menaces, focus, seuils de kill) et des rôles
> attribués par règles ; le coût par combat est assez bas pour des **millions** de combats Monte-Carlo ; les objectifs
> de scénario (heures du Vortex, corruption, phase 2) sont des **termes d'évaluation écrits à la main**, alimentés par
> un planificateur dédié.

---

## 0. Décisions clés (TL;DR)

1. **Une seule monnaie : le PV-équivalent (PVe)**. Tout terme de score (dégâts, kill, retrait PA/PM, danger, buffs,
   objectifs de scénario) est exprimé en points de vie, avec des poids initiaux explicites (§6.3, §9.5) réglés ensuite
   par Monte-Carlo (§11.3).
2. **IA des monstres = IA générique fidèle** (monster-ai.md §8) : gloutonne, replanification après chaque action,
   simulation sur clone des `topK` candidats, termes de position par comportement, profils et overrides déclaratifs.
   Elle est **identique dans tous les modes** (rapide, recherche, optimiseur) : on ne change jamais l'adversaire en
   changeant le budget des joueurs.
3. **IA des joueurs = gloutonne à replanification** : estimation analytique de tous les candidats → simulation sur
   clone des `topK` (+ candidats « obligatoires ») → meilleure action si gain ≥ seuil → exécution → nouvelle analyse.
   Le mode **recherche** ajoute une recherche en faisceau sur le tour et une prédiction à 1 coup des tours ennemis
   jusqu'au prochain allié (en réutilisant le cerveau des monstres).
4. **Valeur d'état partagée par l'équipe** `V(s)` + termes de **position propres au rôle** : tous les alliés optimisent
   la même fonction, ce qui évite les conflits d'objectifs entre personnages.
5. **Carte des menaces ordonnée par la timeline** : le danger d'un allié = dégâts attendus des ennemis qui jouent
   **avant son prochain tour** (alternance Dofus). Le contrôle (retrait PM, poussée, Pacifiste, blocage) est valorisé
   par la baisse de cette menace : c'est la source principale de jeu « non brut ».
6. **Focus, seuils de kill, réservation de PA** : tableau noir d'équipe (focus, fenêtres de kill), terme de
   faisabilité « je peux encore tuer ma cible ce tour » qui empêche de gaspiller les PA nécessaires au kill.
7. **Rôles par règles** (`dps_mono`, `dps_zone`, `control_mp`, `control_ap`, `placer`, `tank`, `healer`, `support`)
   déduits des capacités des sorts (`SpellProfile`) et du preset de build ; ils ne changent que les quotas de
   candidats, la tolérance au risque et le terme de position.
8. **Créativité émergente et contrôlée** : génération large (tout sort lançable, toute cible, cases vides, alliés,
   glyphes, portage), évaluation par simulation exacte, macros détectées dans les données (`statesCriterion`),
   terme « opportunité du prochain allié » (mise en place), valeur des décalages d'horloge calculée par le
   planificateur (marcher dans un glyphe pour régler l'heure).
9. **Vortex** : prévision exacte de l'horloge à partir de la timeline (`forecastClock`), **planificateur de
   corruption** à horizon glissant relancé à chaque tour de joueur, sorties = directives par monstre (`corrupt`,
   `first`, `preDamage`, `doNotKill`, `control`) converties en termes d'évaluation écrits à la main.
10. **Aléa** : trois flux séparés (jets du combat, bruit IA, échantillonnage de scénario) ; option moteur
    `rngRekeyPerTurn` pour des nombres aléatoires communs (CRN) entre variantes ; simulations de l'IA en
    `rollMode: 'average'` avec graine **décorrélée** (pas de lecture du futur).
11. **Budgets en nombre de simulations, jamais en millisecondes** : un combat est reproductible bit à bit ; un combat
    Monte-Carlo intéressant est rejoué avec `record: true` pour obtenir son replay animé.
12. **Boucle d'itérations en pyramide** : T0 analytique (µs) → T1 micro-scénarios (≤ 0,3 s) → T2 combat complet rapide
    (≤ 1 s) → T3 combat complet recherche (≤ 30 s) ; élimination successive (successive halving) pour la composition
    (19 classes × presets), le stuff, les variantes de sorts et les paramètres de stratégie (CEM avec CRN).
13. **Parallélisme** : pool `worker_threads` (Node 22, 4 cœurs) / Web Workers (navigateur), tâches indexées par graine,
    agrégation indépendante de l'ordre ; résultats identiques quel que soit le nombre de workers.
14. **Robustesse aux incertitudes** : chaque graine tire aussi une variante des paramètres **INCERTAINS** du scénario
    (tour d'arrivée des vagues, PV de résurrection, délai d'*Action !*, règle de l'équipe qui commence) ; on publie un
    taux de victoire **robuste** et par variante.
15. **Validation** : tests de comportement « dorés » (monstres T1-T10 de monster-ai.md, joueurs P1-P14), combats de
    contrôle (sanity fights), bancs de performance avec seuils en CI, tests de déterminisme et de calibration.

---

## 1. Principes directeurs

| # | Principe | Conséquence concrète |
|---|---|---|
| F1 | **Le moteur exécute les données, l'IA choisit** (monster-ai.md §1.4) | Aucune mécanique de boss n'est codée dans l'IA ; les overrides ne fixent que des **priorités**. |
| F2 | **L'adversaire ne dépend pas de notre budget** | `MonsterBrain` a un budget fixe (`topK = 6`), le même en mode rapide, recherche et dans l'optimiseur. |
| F3 | **Information honnête** | Les simulations d'une IA se font sur une copie « vue par son équipe » (`sanitizeForTeam`) : pièges invisibles adverses retirés, invisibles placés sur leur case crue ; graine décorrélée (pas de lecture des jets futurs). |
| F4 | **Replanification systématique** | Après chaque action (jets aléatoires, morts, poussées), on recalcule tout (règles officielles R10, R11, R18). Les plans longs (planificateur Vortex) sont recalculés à chaque tour de joueur (horizon glissant). |
| F5 | **Espérance + variance** | Les décisions utilisent l'espérance (`average`) ; les seuils de kill et le risque d'achever un monstre « trop tôt » utilisent une approximation normale de la variance des jets. |
| F6 | **Déterminisme** | Budgets comptés en simulations ; égalités départagées par un RNG IA dédié ; pas de `Date.now()` ni d'itération sur des `Map` dont l'ordre dépend d'un hasard. |
| F7 | **Explicabilité** | Chaque décision peut produire sa décomposition par terme (`EvalBreakdown`) ; le replay affiche les intentions (focus, kill planifié, « coup créatif »). |
| F8 | **Coût maîtrisé** | Analytique d'abord (O(1) par candidat), simulation ensuite (`topK`), caches indexés par révision des caractéristiques. |

---

## 2. Contrat avec le moteur

### 2.1 API utilisées telles quelles

`Engine.cloneFight`, `Engine.alive/enemiesOf/alliesOf/fighterAt/stateFlag/current`, `canCast(engine, fight, f, spell,
cell, { fromCell })`, `castSpell`, `performAction`, `runFight(engine, fight, provider)`, `move`, `reachableCells`,
`escapeRatio`, `zoneCells`, `zoneEfficiency`, `hasLineOfSight`, `GridSearch`, `prepareDamage`/`meanPrepared`/
`expectedDamage`, `critChance`, `apMpRemovalProbability`/`expectedApMpRemoved`, `tackleRatio`, `computeBuildStats`,
`DataStore`/`GameDataStore.breedSpells/monsterSpells/itemsBySlot`. Le contrôleur respecte l'interface existante :

```ts
export interface Controller { playTurn(engine: Engine, fight: FightState, fighter: Fighter): void }
```

### 2.2 Petites extensions demandées (rétro-compatibles)

| Extension | Où | Pourquoi |
|---|---|---|
| `Fighter.statsRev: number`, incrémenté dans `recomputeStats` | `engine/types.ts`, `engine.ts` | clé de cache des tables DPT / menace (sinon il faut hacher 55 caractéristiques). |
| `FightOptions.rngRekeyPerTurn?: boolean` : dans `startTurn`, `fight.rngState = mix32(options.seed, fight.round, f.id)` | `engine.ts` | nombres aléatoires communs : une décision différente au tour 3 ne décale plus tous les jets des tours suivants (réduction de variance ×3-10 pour comparer deux stratégies). |
| `ScenarioHooks.cloneState?(s)` utilisé par `cloneFight` à la place de `structuredClone` | `engine.ts` | `structuredClone` coûte 5-20 µs ; un clone écrit à la main < 1 µs. |
| Événement `{ t: 'aiNote'; fighter: number; kind: 'focus' \| 'plan' \| 'creative' \| 'intent'; text: string; cells?: number[]; targets?: number[] }` | `engine/types.ts`, `replay/validate.ts` | annotations animées (flèches de focus, heure planifiée). En v1 : `log` de niveau `'ai'`. |
| Compteur d'effets inconnus **par combat** (`fight.metrics` ou `scenarioState.unknownEffects`) | `effects/core.ts` | marquer un résultat Monte-Carlo « faible confiance » si des effets non interprétés ont été rencontrés. |

### 2.3 Vue IA (`AIView`) et copie « honnête »

```ts
// src/ai/view.ts
export interface AIView {
  readonly engine: Engine
  readonly fight: FightState          // état réel, en lecture seule par convention
  readonly me: Fighter
  readonly team: TeamId
  /** Combattants visibles par `team` (invisibles adverses remplacés par leur position crue). */
  visible(): readonly Fighter[]
  /** Pièges connus de `team` (les pièges invisibles adverses sont exclus). */
  knownTraps(): readonly Trap[]
  /** Index de timeline et ordre des prochains tours (public). */
  upcoming(n: number): { fighterId: number; round: number }[]
}
/** Clone + retrait de l'information cachée pour `team` ; rollMode 'average' ; rngState décorrélé. */
export function simClone(view: AIView, salt: number): FightState
```

`simClone` : `engine.cloneFight(fight, false)`, `options.rollMode = 'average'`, `rngState = mix32(fight.rngState ^
0x5bd1e995, salt)` (les groupes d'effets aléatoires restent tirés, mais avec un flux indépendant du vrai combat),
`traps = traps.filter(visibleTo(team))`. Pour un sort à effets aléatoires (`SpellProfile.hasRandomGroups`), le mode
recherche moyenne 2 tirages (sels différents).

---

## 3. Arborescence des modules

```
src/ai/
  index.ts                 createAI(config): { provider: ControllerProvider, fightAI: FightAI } ; registre des clés fighter.ai
  types.ts                 AIConfig, AIMode, SearchBudget, Candidate, EvalWeights, RoleId…
  view.ts                  AIView, simClone, sanitizeForTeam
  rng.ts                   mix32, aiRng(fightSeed, fighterId, round, step)
  fightAI.ts               FightAI : mémoire par combat (tableau noir, plans, caches), hors FightState
  analysis/
    spellProfile.ts        SpellProfile (capacités d'un sort, sous-sorts compris), cache par niveau de sort
    dpt.ts                 DptTable : dégâts attendus par tour (analytique + calibration par preset)
    reach.ts               ReachInfo : BFS avec coût de tacle (PA/PM restants par case)
    castCells.ts           cases de lancer valides vers une cible (portée, ligne, diagonale, LdV)
    threat.ts              ThreatMap : menace ordonnée par la timeline, menace par case
    kill.ts                probabilité de kill, fenêtres de kill, faisabilité
  monster/
    brain.ts               MonsterBrain implements Controller (monster-ai.md §8.2)
    candidates.ts, score.ts, position.ts, archetype.ts
    profiles/index.ts      résolution de profil ; profiles/vortex.ts
    overrides/vortex.ts    MonsterHooks du Vortex
  player/
    brain.ts               PlayerBrain implements Controller (mode fast / full)
    search.ts              TurnBeamSearch (mode search)
    candidates.ts          génération + élagage (casts, déplacements, macros, glyphes, portage)
    macros.ts              détection des enchaînements dans les données
    evaluate.ts            TeamEvaluator : V(s) et décomposition
    endMove.ts             déplacement de fin de tour
    roles.ts               inférence des rôles, poids et quotas par rôle
    team.ts                TeamBlackboard (focus, fenêtres de kill, demandes de mise en place, directives)
    placement.ts           choix des cases de départ
    scripted.ts            contrôleur « sans IA » (rotations des fiches de classe)
  objectives/
    types.ts               ObjectiveTerm
    generic.ts             termes génériques (victoire, survie, défis optionnels)
src/dungeons/
  types.ts                 DungeonScenario, ScenarioParams, UncertainParamSpace, MicroScenario
  index.ts                 registre
  waves.ts                 générateur de vagues générique (dimensions divines)
  vortex/
    scenario.ts            hooks serveur (vagues, invulnérabilité d'arrivée, paramètres INCERTAINS)
    params.ts              valeurs par défaut + espace d'incertitude
    clock.ts               lecture de l'heure, forecastClock, cases de l'Auroraire
    planner.ts             CorruptionPlanner (horizon glissant)
    objectives.ts          termes d'évaluation Vortex
    micro.ts               micro-scénarios prefix12 et phase2
src/optimizer/
  seeds.ts                 fightSeed, variantes de scénario par graine
  runner.ts                runOne(spec, seed, mode) → FightSummary (record optionnel)
  montecarlo.ts            runBatch, arrêt séquentiel, comparaison appariée
  pool/                    WorkerPool (node: worker_threads, web: Worker), fightWorker.ts, protocol.ts
  tiers.ts                 pyramide T0..T3, successive halving générique
  tuning.ts                CEM sur θ (paramètres de stratégie) avec CRN
  stuff/                   surrogate.ts, search.ts, exos.ts, points.ts
  team/                    presets.ts (données issues des fiches de classe), t0model.ts, composition.ts
  spells.ts                recherche locale sur les variantes
  report.ts                rapport Vortex (JSON + HTML) et sélection des replays
src/cli/simulate.ts        fight | batch | tune | stuff | team | report
bench/                     *.bench.ts (vitest bench) : clone, monsterTurn, playerTurn, vortexFast, vortexSearch
```

---

## 4. Socle d'analyse commun (`src/ai/analysis`)

Ces modules servent aux monstres, aux joueurs, au planificateur et au modèle analytique T0.

### 4.1 `SpellProfile` — ce qu'un sort sait faire

Calculé une fois par `SpellLevelData` (et sa variante critique), par parcours récursif des sous-sorts
(792/793/1017-1019/1160/2160…, profondeur ≤ 4) :

```ts
export interface DamageLine { element: number; min: number; max: number; critMin: number; critMax: number;
  zone: ZoneSpec; mask: string; lifeSteal: boolean; delayed: number /* tours */; perTurnDot?: number }
export interface SpellProfile {
  spellId: number; apCost: number
  damage: DamageLine[]
  apRemoval: number; mpRemoval: number; rangeRemoval: number; dodgeable: boolean   // points tentés
  displacement: { kind: 'push' | 'pull' | 'teleport' | 'swap' | 'symmetric' | 'carry' | 'throw' | 'return'; cells: number }[]
  heal: number; shield: number                          // ordres de grandeur (base), pour quickEstimate
  appliesStates: { stateId: number; on: 'self' | 'target' | 'zone'; duration: number }[]
  requiresStates: StatesClause[] | undefined            // statesCriterion compilé
  summons: number[]; glyph: boolean; trap: boolean
  selfBuff: boolean; allyBuff: boolean; enemyDebuff: boolean
  hasRandomGroups: boolean; hasTriggers: boolean
  /** Part de la valeur estimable analytiquement (0..1) ; < 0,7 ⇒ candidat « à simuler » (exploration). */
  analyticCoverage: number
  aoe: boolean; needsFreeCell: boolean; targetsAllies: boolean
}
```

### 4.2 `DptTable` — dégâts attendus par tour

`dpt(a, d, ap?)` = espérance des dégâts que `a` inflige à `d` en un tour **sans contrainte de position**, avec `ap`
PA (défaut : PA du prochain tour de `a`). Algorithme :

```
pour chaque sort s de a lançable sur une cible ennemie (hors relance au prochain tour) :
    e_s = Σ_lignes expectedDamage(input(a.stats, d.stats, line), crit, rolls, critChance(s, a))   // DoMath exact
          × efficacité de zone (1 au centre) ; + DoT × min(durée, 2) × 0,8
    n_s = min(maxCastPerTurn || ∞, maxCastPerTarget || ∞)
DP sac à dos borné sur les PA (≤ 16) : maximise Σ e_s sous Σ apCost ≤ ap
résultat × calib[presetId ou monsterId]       // calibration empirique (ci-dessous)
```

Clé de cache : `(a.id, a.statsRev, d.id, d.statsRev, ap)`. Coût ≈ 10 µs par paire, recalculée seulement quand une
caractéristique change. **Calibration** : pour les mécaniques que l'analytique ne voit pas (cartes Ecaflip, rampes Iop,
bombes Roublard, portails Eliotrope…), on mesure une fois par `(preset, stuff)` le rapport `DPT simulé / DPT
analytique` sur le micro-scénario « Poutch » (3 tours, IA rapide, 16 graines) ; borné à [0,5 ; 2] et figé dans un
fichier versionné (`data/ai/calibration.json`) pour garder le déterminisme.

### 4.3 `ReachInfo` — déplacements avec tacle

```ts
export interface ReachInfo { cells: Int16Array; count: number; mpLeft: Int8Array; apLeft: Int8Array; prev: Int16Array }
export function computeReach(view: AIView, f: Fighter, mp = f.mp, ap = f.ap): ReachInfo
```

Recherche « au mieux » (label-correcting) sur `(case, PM restants)` : quitter une case adjacente à des tacleurs
applique `apMpAfterTackle` (règle §6 de mechanics.md, ratio multiplicatif par tacleur) ; on garde pour chaque case
le meilleur couple (PM, PA) restant. Respecte `cantBeTackled`, `canTackle=false`, Intaclable (96). Les pièges
**connus** (vue honnête) sont des cases terminales. Coût ≈ 5-15 µs.

### 4.4 Cases de lancer et ligne de vue

`castCells(view, f, spell, target, reach)` : cases `c` de `reach` telles que portée/ligne/diagonale passent et
`hasLineOfSight(c, target, blocks)` (bloqueurs = cases sans LdV + combattants sauf le lanceur et la cible). Cache par
pas de décision : `Map<number /* c*560+t */, boolean>`. Préfiltre : on ne teste la LdV que pour les cases à portée.

### 4.5 `ThreatMap` — menace ordonnée par la timeline

```ts
export interface ThreatMap {
  /** Dégâts attendus sur l'allié `id` avant son prochain tour (DoT et pseudo-menaces de scénario inclus). */
  incoming(id: number): number
  /** Idem si `f` terminait son tour sur `cell` (les autres positions étant figées). */
  cellIncoming(f: Fighter, cell: number): number
  /** Probabilité de mort avant son prochain tour (approximation normale). */
  deathRisk(id: number): number
}
export function buildThreatMap(view: AIView, side: TeamId, extra?: PseudoThreat[]): ThreatMap
export interface PseudoThreat { id: string; actsAt: number /* index timeline */; cells(): Iterable<number>; damage(f: Fighter): number }
```

Algorithme (pour le camp `side`, appelé « alliés ») :

```
order = timeline à partir du combattant courant (exclu), sur un tour complet
pour chaque allié a : before(a) = ennemis jouant entre maintenant et le prochain tour de a
pour chaque ennemi e capable de jouer (vivant, pas de passe-tour, pas Pacifiste/apathique pour les dégâts) :
    R_e = computeReach(e) avec PM du prochain tour (buffs/débuffs encore actifs à ce moment)
    origins_e = R_e ∪ hookOrigins(e)                 // ex. Vortex : cases au contact de la future Auroraire si Heurage prêt
    pour chaque allié a :
        hit(e,a) = max sur sorts offensifs s : ∃ c ∈ origins_e, a.cell ∈ portée(s, c) (+ LdV si castTestLos)
        dmg(e,a) = hit ? dptWithAp(e, a, PA_e − coût_déplacement) : 0
        + valeur de contrôle : sort posant cantDealDamage (Pacifiste) sur a ⇒ + 0,9 × dpt(a, meilleure cible)
    score monstre s_a = min(dmg(e,a), hpEff_a) + [dmg ≥ hpEff_a] · (0,5·maxHp_a + menace_a)   // copie du score monstre §5.4
    p_a = softmax(s_a / τ), τ = 0,15 · max_a s_a     // ≈ argmax du cerveau monstre, lissé pour la robustesse
    pour chaque a tel que e ∈ before(a) : incoming[a] += p_a · dmg(e,a)
DoT : incoming[a] += poisons portés par a qui se déclenchent avant son prochain tour
extra (scénario) : pseudo-menaces déterministes (ex. « En temps et en heure », §9.5)
deathRisk(a) = Φ((incoming_a − hpEff_a) / (0,25·incoming_a + 1))
```

`cellIncoming(f, cell)` réutilise les `R_e` et `origins_e` (on ne recalcule pas les déplacements ennemis), en
ajoutant l'effet de la case sur le tacle (si `f` sur `cell` tacle `e`, `R_e` est réduit par le ratio de fuite de `e`).
Coût cible : construction ≤ 30 µs (8 ennemis × 60 cases × 4 alliés × 3 sorts), `cellIncoming` ≤ 2 µs.

### 4.6 `kill.ts` — seuils de kill

```ts
export function killProbability(mean: number, variance: number, hpEff: number): number   // Φ((mean − hpEff)/σ)
export function canKillNow(view: AIView, me: Fighter, target: Fighter): { p: number; plan: number[] /* sorts */; apNeeded: number }
export function teamKillWindow(view: AIView, target: Fighter, bb: TeamBlackboard): { p: number; contributors: number[] }
```

`canKillNow` : meilleur plan analytique depuis `reach` (case de lancer + sac à dos de sorts) ; variance = Σ variances des
jets (uniforme discrète par ligne, critique en mélange). `teamKillWindow` : somme des contributions des alliés qui
jouent **avant le prochain tour de la cible**, avec facteur d'atteignabilité (1 si `castCells` non vide depuis leur
`reach`, sinon 0).

---

## 5. IA des monstres (fidèle)

Reprend monster-ai.md §8 ; cette section fixe ce qui reste à décider pour l'implémentation.

### 5.1 Résolution du profil

```ts
export type Behaviour = 'aggressive' | 'fearful' | 'kiter' | 'devoted' | 'blocker' | 'mad' | 'apathetic' | 'static'
export interface MonsterAIProfile {
  behaviour: Behaviour
  capabilities?: Partial<Record<'summon' | 'heal' | 'buff' | 'kamikaze' | 'invisible', boolean>>
  weights?: Partial<MonsterWeights>
  preferredRange?: [number, number]
  castOrder?: number[]
  openers?: { spellId: number; minTargets?: number }[]
  alwaysCastWhenReady?: number[]
  forbidSpells?: number[]
  stateValue?: Record<number, 'targetThreat' | number>
  /** Origines de menace supplémentaires pour la ThreatMap des joueurs (ex. téléportation du Vortex). */
  threatOrigins?(view: AIView, me: Fighter): number[]
  hooks?: MonsterHooks
}
export function resolveProfile(data: GameDataStore, f: Fighter): MonsterAIProfile
```

Ordre : (1) `fighter.tags.aiBehaviour` (posé par l'effet 2188 ou par la bascule R12) ; (2) table explicite
`profiles/*.ts` par `monsterId` ; (3) inférence d'archétype (monster-ai.md §3) depuis les `SpellProfile` : `static`
si `canPlay=false` ou PA=PM=0, `apathetic`, `summoner`, `healer`, `blocker`, `kiter` (sort de dégâts `maxRange > 3`,
`minRange < maxRange`, pas de CàC), sinon `aggressive`. Le profil est mis en cache par `(monsterId, grade)`.

### 5.2 Boucle de tour

```ts
playTurn(engine, fight, me) {
  const ctx = MonsterContext.create(engine, fight, me)       // vue honnête, profil, menaces des joueurs, caches
  if (ctx.behaviour === 'static') return
  for (const a of ctx.profile.hooks?.beforeTurn?.(ctx) ?? []) ctx.perform(a)
  let offensive = false
  for (let step = 0; step < 12 && me.alive && !fight.ended; step++) {
    const best = pickBestAction(ctx)                          // §5.3-5.4 ; budget fixe topK = 6
    if (!best || best.score < ctx.w.minActionScore) break
    if (best.path) ctx.perform({ type: 'move', path: best.path })
    if (best.cast && me.alive) offensive = ctx.perform({ type: 'cast', ...best.cast }).ok && best.offensive || offensive
    ctx.refresh()                                             // R10, R11, R18
  }
  updateFearfulMode(ctx, offensive)                           // R12 / R13 → me.tags.aiBehaviour
  finalMove(ctx)                                              // §5.5
}
```

La mémoire de monstre nécessaire à la fidélité (mode peureux R12, croyance sur un invisible R17) est stockée dans
`fighter.tags` (clonée avec l'état) pour que la prédiction à 1 coup (§6.6) rejoue exactement le même cerveau.

### 5.3 Candidats et élagage

Pour chaque sort lançable (PA, relance, `statesCriterion`, limites par tour), chaque case de lancer de `reach` (case
actuelle seule si 0 PM — R24), chaque cible : cases occupées visibles, centres de zone touchant ≥ 1 combattant (R2),
case du lanceur (portée 0), cases libres (invocation/téléportation) limitées aux **6** meilleures par heuristique
(distance à la cible focale). Filtres durs : `canCast(..., { fromCell })`, piège qu'il déclencherait en bougeant (R14),
`forbidSpells`, `hooks.filterCast`. Préfiltre `quickEstimate` (analytique, sans clone) puis simulation des `topK = 6`
meilleurs + des `openers`/`alwaysCastWhenReady` lançables + des candidats à `analyticCoverage < 1` dont l'estimation
est à moins de 15 % de la meilleure. monster-ai.md §8.2 proposait `topK = 24` : on le garde comme **référence** et un
test d'équivalence de budget exige la même décision top-1 avec 6 et 24 dans ≥ 98 % de 1 000 situations tirées.
Si le meilleur `quickEstimate` est < `minActionScore / 2` et qu'aucun candidat n'est obligatoire, le pas s'arrête
sans simulation. Départage : `castOrder`, priorités Stump (invocation > buff >
dégâts > soin > malus), moins de PM, RNG IA.

### 5.4 Score (PVe) — poids retenus

Formule de monster-ai.md §8.4 (différence avant/après simulation), avec les poids :

| Poids | Valeur | Note |
|---|---|---|
| `wDmg` | 1,0 | dégâts effectifs plafonnés aux PV+bouclier (overkill nul) |
| `wKill`, `κ` | 1,0 ; 0,5 | bonus = `κ·PVmax_e + threat_e` (threat = `dpt` du joueur sur l'équipe des monstres) |
| `wAP`, `wMP` | 0,8 ; 0,8 | via `apWorth = threat/PA`, `mpWorth = α·threat/max(1,PM)`, `α` = 0,6 si la cible doit bouger pour frapper, sinon 0,15 |
| `wHeal` | 0,9 | plafonné aux PV manquants ; seuil 95 % (70 % pour soi, profil `healer`) |
| `wFF`, `wAllyKill` | 0,6 ; 1,0·PVmax | tir ami |
| `summonValue` | 0,5 | sur le terme de dégâts seulement ; le bonus de kill reste entier (monster-ai.md §4.1) |
| `reflectAversion` | 0,2 × renvoi attendu | R8 ; mort du lanceur simulée ⇒ −∞ (R7) |
| `minActionScore` | 1 | permet de « passer » après un kill |
| `positionDuringTurn` | 0,25 | |

Seule entorse assumée à la pure gloutonnerie : les `openers`/`castOrder` des profils (Ikargn : Attraction ailée avant
Cercle de feu), qui reproduisent les ordres décrits par les guides sans recherche.

### 5.5 Position de fin de tour

Termes par comportement de monster-ai.md §8.6 (`aggressive` : `−20·dist(focale) + 40·adjacents` ; `kiter` : anneau
`preferredRange` + alignement + LdV − CàC ; `fearful` ; `devoted` ; `blocker` ; `mad` ; `apathetic`), plus le terme de
glyphe R3 (valeur des effets de la glyphe pour ce monstre), coût de tacle R4 et seuil anti-nervosité (gain < 5 PVe ⇒
ne bouge pas). La cible focale est l'argmax de la valeur d'attaque au prochain tour, à défaut l'ennemi le plus proche.

### 5.6 Vortex : profils et overrides

Profils de monster-ai.md §7.3 et hooks §8.7 (Heurage dès que prêt, *En temps et en heure* si ≥ 1 personnage aligné
avec l'Auroraire, Contamination zombie seulement près d'un zombie entouré, Heuristique valorisée par la menace de la
cible, position de phase 2 alignée à ≤ 8). Ajout : `threatOrigins` du Vortex en phase 2 = cases adjacentes à la
**future** case de l'Auroraire si Heurage est prêt à son prochain tour (pour que la ThreatMap des joueurs voie la
téléportation). Les monstres corrompus (6611, *Tour annulé*) sont sautés par le moteur ; ils restent tacleurs et
bloquent la LdV dans `computeReach`/`castCells`.

### 5.7 Conformité aux règles officielles

| Règles | Implémentation | Test |
|---|---|---|
| R1, R23 (tacler plusieurs ennemis) | `position.ts` : `+40·adjacents` (aggressive), `+60` (blocker) | M-R1 |
| R2, R24 (reculer pour une zone ; 0 PM) | `candidates.ts` : centres de zone sur toutes les cases de `reach` ; case actuelle si 0 PM | T3, T7 |
| R3 (glyphes positives/négatives) | `position.ts` : valeur de glyphe ; filtre d'invocation sur glyphe négative | M-R3 |
| R4, R5 (tacle) | `computeReach` avec coût de tacle ; ne bouge pas si gain < coût | M-R4 |
| R6 (collisions) | simulation sur clone | T5 |
| R7, R8 (renvoi) | score −∞ si mort du lanceur ; `reflectAversion` | T9 |
| R9 (invulnérables + retrait d'état) | pas de filtre sur invulnérables, la simulation décide | M-R9 |
| R10, R11, R18 (replanifier) | boucle §5.2 | M-R10 |
| R12, R13 (peureux) | `updateFearfulMode`, `tags.aiBehaviour` | T8 |
| R14 (pièges) | filtre dur | M-R14 |
| R19 (effets TB avant décision) | `playTurn` appelé après `startTurn` | M-R19 |
| R20 (critiques) | `average` + `critWeight` du moteur | unitaire |
| R21 (maxStack) | buff au plafond ⇒ Δ nul en simulation | M-R21 |
| R25 (coût borné) | budget fixe `topK = 6`, ≤ 12 actions | bench, test d'équivalence 6/24 |

### 5.8 Budget

Un pas ≈ génération 150 µs + ≈ 4 simulations × 75 µs (clone 25 + lancer 40 + score 10) ≈ 0,45 ms ; ≈ 3 lancers + 1 pas
d'arrêt (souvent sans simulation) + déplacement final ⇒ **≤ 1,7 ms par tour de monstre en moyenne**, 5 ms au pire.
Bruit optionnel `noise.tau` (softmax sur le top-3) : 0 par
défaut, 0,1 dans certaines campagnes de robustesse de l'optimiseur (§11.2).

---

## 6. IA des joueurs

### 6.1 Modes et budgets

```ts
export type AIMode = 'scripted' | 'fast' | 'full' | 'search'
export interface SearchBudget {
  maxStepsPerTurn: number    // actions max (hors fin de tour)
  topK: number               // simulations par pas (candidats triés par quickEstimate)
  mustSimMax: number         // candidats obligatoires (kills, directives, glyphes, macros, exploration)
  endMoveSims: number        // vérification par simulation des meilleures cases de fin de tour
  beamWidth: number; beamDepth: number; expandPerNode: number   // search uniquement
  responsePly: 0 | 1         // prédiction des tours ennemis jusqu'au prochain allié
  maxSimsPerTurn: number     // plafond dur (déterminisme)
}
export const BUDGETS: Record<Exclude<AIMode, 'scripted'>, SearchBudget> = {
  fast:   { maxStepsPerTurn: 8,  topK: 4,  mustSimMax: 2, endMoveSims: 2, beamWidth: 1, beamDepth: 0, expandPerNode: 0,  responsePly: 0, maxSimsPerTurn: 40 },
  full:   { maxStepsPerTurn: 12, topK: 10, mustSimMax: 4, endMoveSims: 4, beamWidth: 1, beamDepth: 0, expandPerNode: 0,  responsePly: 0, maxSimsPerTurn: 160 },
  search: { maxStepsPerTurn: 12, topK: 10, mustSimMax: 4, endMoveSims: 6, beamWidth: 6, beamDepth: 5, expandPerNode: 10, responsePly: 1, maxSimsPerTurn: 700 },
}
```

### 6.2 Boucle gloutonne (modes `fast` / `full`)

```ts
playTurn(engine, fight, me) {
  const ctx = TurnContext.create(engine, fight, me, this.fightAI, this.budget)
  ctx.bb.refreshIfNeeded(ctx)               // focus, fenêtres de kill, directives du planificateur (§7.3, §9.4)
  let base = ctx.evaluator.value(ctx.view)  // V(s) courant (cache)
  for (let step = 0; step < ctx.budget.maxStepsPerTurn && me.alive && !fight.ended; step++) {
    const cands = generateCandidates(ctx)                  // §6.4
    for (const c of cands) c.h = quickEstimate(ctx, c)     // O(cibles), sans clone
    const pool = selectForSim(cands, ctx)                  // topK par h + obligatoires (≤ mustSimMax) + quotas de rôle
    let best: Scored | null = null
    for (const c of pool) {
      if (ctx.simsLeft() <= 0) break
      const sim = ctx.simulate(c)                          // simClone + application ; morts, poussées, déclencheurs
      const dv = ctx.evaluator.value(sim) - base - c.penalty
      if (!best || dv > best.dv || (dv === best.dv && tieBreak(ctx, c, best))) best = { c, dv }
    }
    if (!best || best.dv < ctx.w.minGain) break           // minGain = 20 PVe (arrêt sans simulation si max h < 10 et rien d'obligatoire)
    ctx.execute(best.c)                                     // performAction(move) puis performAction(cast)
    ctx.annotate(best)                                      // aiNote si créatif / kill planifié
    ctx.refresh(); base = ctx.evaluator.value(ctx.view)     // replanification
  }
  endMove(ctx)                                              // §6.7
}
```

`tieBreak` : (1) gain de faisabilité de kill, (2) moins de PM dépensés, (3) moins de PA, (4) RNG IA. Le bruit
`noise` (si activé) remplace l'argmax par un softmax de température `τ·|best.dv|` sur le top-3.

### 6.3 Fonction d'évaluation `V(s)` (PVe, point de vue de l'équipe des joueurs)

`V(s)` est une valeur **absolue** d'état (les comparaisons de faisceau restent cohérentes) ; les décisions gloutonnes
utilisent `ΔV`. Notations : `A` alliés (personnages + invocations), `E` ennemis non statiques, `hpEff = PV + 0,9·bouclier`.

| Terme | Formule (contribution à V) | Poids initial | Commentaire |
|---|---|---|---|
| `enemyHp` | `−Σ_e w_e · hpEff_e` | `w_e` = 1,0 (monstre), 0,5 (invocation), 0 (invulnérable — sauf scénario) | dégâts plafonnés naturellement par la différence |
| `focus` | `−0,3 · hpEff_focus` | 0,3 | renforce le tir concentré (§7.3) |
| `enemyKill` | `+Σ_{e mort} (0,3·PVmax_e + 2·threat_e)` | 1,0 | remplacé par les termes de scénario pour les monstres du Vortex |
| `allyHp` | `+Σ_a w_a · hpEff_a` | `w_a` = 1,0 ; tank 0,8 ; invocation 0,4 | |
| `allyErosion` | `−0,5 · Σ_a (baseMaxHp_a − maxHp_a)` | 0,5 | PV max perdus (non soignables) |
| `allyDeath` | `−Σ_{a mort} (baseMaxHp_a + 3·dpt_a + U_role)` | 1,0 | `U_role` : healer 2 000, control 1 500, placer 1 000, autres 0 |
| `danger` | `−0,8 · Σ_a [min(incoming_a, hpEff_a) + deathRisk_a · deathCost_a]` | 0,8 | §4.5 ; tank : 0,6 |
| `allyPower` | `+0,6 · Σ_a Σ_buffs ΔDPT_a · min(tours_restants, 2)` | 0,6 | buffs alliés et débuffs ennemis subis (rés.) via la `DptTable` |
| `thisTurnPower` | `+1,0 · (dptWithAp(me, focus, PA restants ; état s) − idem sans le buff)` | 1,0 | rend « buff puis frappe » rentable dès ce tour |
| `killFeasible` | `+0,8 · P(kill de ma cible réservée ; PA, PM, position de s) · killValue` | 0,8 | réservation de PA (§7.3) |
| `opportunity` | `+0,25 · Σ_a max_e dpt(a,e) · reach(a,e)` | 0,25 | rester à portée pour le prochain tour |
| `nextAlly` | `+0,5 · bestTurnAnalytic(nextAlly, s)` | 0,5 | **uniquement** pour candidats de déplacement d'entités (poussée, attirance, téléportation, portage) — mise en place |
| `objectives` | `Σ_o w_o · o.value(s)` | voir §9.5 | termes de scénario écrits à la main |

Remarques :
* Le **contrôle** (retraits PA/PM, Pacifiste, poussée hors de portée, blocage de chemin par un tank) n'a pas de poids
  propre : il est valorisé par la baisse de `danger` (menace recalculée avec les PA/PM du prochain tour ennemi) et par
  `allyPower`. Exemple chiffré : Buboxor (6 PM, ~1 500 de dégâts sur le Crâ s'il l'atteint) ; −3 PM le rendent
  incapable d'atteindre quiconque ⇒ `danger` baisse de `0,8 × 1 500 = 1 200` PVe, contre ~500 PVe pour un sort de
  dégâts. L'Enutrof choisit le retrait **sans règle ad hoc**.
* `threat_e` (menace d'un ennemi) = `Σ_a p_a·dmg(e,a)` de la ThreatMap ; `dpt_a` = moyenne de `dpt(a, e)` sur les
  ennemis vivants.
* Coût d'un `V(s)` complet ≈ 40-60 µs (ThreatMap + DPT en cache + objectifs).

### 6.4 Génération des candidats et règles d'élagage

```ts
export interface Candidate {
  kind: 'cast' | 'move' | 'macro' | 'glyphStep' | 'end'
  path?: number[]            // déplacement préalable (path[0] = case actuelle)
  spellId?: number; cell?: number
  actions?: Action[]         // macro : séquence simulée d'un bloc
  tags: number               // bits : KILL, DIRECTIVE, CONTROL, DISPLACE, HEAL, BUFF, SUMMON, GLYPH, EXPLORE, CREATIVE
  apCost: number; mpCost: number
  h: number                  // estimation analytique (PVe)
  penalty: number            // coût non simulé (ex. tacle attendu)
}
```

Générateurs :
1. **Lancers** : sorts lançables (PA, relance, états, limites) × **cases de lancer** = case actuelle + ≤ `P` cases de
   `reach` choisies par score de position rapide (`P` = 6 en `fast`, 12 en `full/search`), plus la case la plus proche
   permettant le lancer si aucune des `P` ne le permet × **cibles** = ennemis, alliés (buffs, soins, portage,
   téléportation), soi, centres de zone touchant ≥ 1 ennemi, cases libres (invocation, glyphe, piège, téléportation :
   ≤ 6 par heuristique).
2. **Macros** (§8.2) : enchaînements détectés dans les données, simulés comme un bloc (coût = 2 simulations).
3. **Pas de glyphe** (`glyphStep`) : chemin vers une case de glyphe de monstre (Vortex : échange + bonus + horloge +1).
4. **Fin de tour** : géré par `endMove` (§6.7), pas comme candidat.

Élagage (ordre) :
* rejet dur : `canCast` ; tir ami tuant un allié ; plan qui tue le lanceur (renvoi) ; chemin dont le tacle attendu
  consomme > 50 % des PA sans gain simulé ; défi actif violé (ex. Hardi) ;
* dominance : à sort et cible égaux, garder la case de lancer de meilleur score de position (et la moins coûteuse) ;
* `quickEstimate` : dégâts analytiques plafonnés × `w_e` + kill (`P(kill)·killValue`) + retraits (`expectedApMpRemoved`
  × `apWorth/mpWorth`) + soin plafonné + déplacement d'entité (Δ menace d'**un** ennemi recalculée seul, ≈ 2 µs) +
  valeur de directive (§9.4) ;
* sélection pour simulation : `topK` par `h` **+** obligatoires (`KILL` faisables, `DIRECTIVE`, `GLYPH` si le
  planificateur valorise un décalage d'horloge, macros, 1 candidat `EXPLORE` = sort à `analyticCoverage < 0,7` choisi
  en tourniquet) **+** quotas de rôle (`control_*` : ≥ 2 retraits ; `placer` : ≥ 2 déplacements d'entité ;
  `healer` : ≥ 1 soin si un allié < 70 %).

### 6.5 Focus, seuils de kill, réservation

* **Kill immédiat** : un candidat dont la simulation tue reçoit `enemyKill` ou le terme de scénario ; l'estimation
  analytique utilise `P(kill)` (§4.6) pour qu'un kill à 55 % soit simulé.
* **Réservation** : au début du tour, si `canKillNow(me, t).p ≥ 0,6` pour une cible planifiée ou focale, `t` devient
  la cible réservée de `me` ; le terme `killFeasible` pénalise toute action qui fait chuter cette probabilité (buff
  inutile, déplacement qui sort de portée) — fidèle à la règle observée « n'utiliser que les PA nécessaires au kill »
  (§1.3 de monster-ai.md), ici dans l'autre sens.
* **Seuil anti-overkill** : les dégâts au-delà de `hpEff` ne valent rien (différence d'états) ; un second sort sur une
  cible déjà morte en simulation n'est jamais choisi.
* **Plancher « ne pas tuer »** (Vortex) : pour une cible `doNotKill`/`preDamage`, la valeur des dégâts est coupée sous
  `hpFloor` et un risque d'achèvement accidentel est facturé (§9.5).

### 6.6 Mode recherche (`search`)

Faisceau sur **mon** tour, puis prédiction des tours ennemis jusqu'au prochain allié :

```
beam = [ (s0, []) ]
pour d = 1 .. beamDepth :
    next = []
    pour (s, seq) ∈ beam :
        cands = top expandPerNode candidats de s (quickEstimate puis simulation)
        pour c ∈ cands : next.push((sim(s, c), seq + c))
        next.push((s, seq) marqué terminal)                     // s'arrêter est toujours une option
    beam = top beamWidth de next selon V(·) + endMoveValue(·)   // dédoublonnage par hash d'état (positions, PV, PA/PM)
pour chaque feuille f du faisceau (top 3 si budget serré) :
    f' = f après endMove ; puis jouer sur un clone tous les combattants jusqu'au prochain allié :
         monstres : MonsterBrain (même code, average, vue honnête) ; invocations alliées : PlayerBrain fast
    score(f) = V(f') (et non V(f))                              // réponse adverse à 1 coup
exécuter la première action de la meilleure séquence, puis REPLANIFIER (on ne rejoue pas la séquence en aveugle)
```

La replanification après chaque action conserve la robustesse aux jets ; le coût est maîtrisé par `maxSimsPerTurn`.

### 6.7 Déplacement de fin de tour

Pour chaque case `c` atteignable avec les PM restants (tacle inclus) :
`pos(c) = −0,8·cellIncoming(me, c)·(1 + deathRisk) + 0,25·opportunity(me, c) + roleTerm(me, c) + scenarioCellTerm(c)`,
puis vérification par simulation des `endMoveSims` meilleures (pièges, glyphes, échanges forcés). Ne bouge pas si le
gain < 30 PVe.

| Rôle | `roleTerm(me, c)` |
|---|---|
| `dps_*`, `control_*` | `−15·abs(dist(c, cible focale) − portée idéale)` ; `−200` si au CàC d'un ennemi non taclé |
| `tank` | `+150·ennemis adjacents taclés` + `100·[c sur le plus court chemin d'un ennemi vers un allié fragile]` |
| `healer`, `support` | `+60·alliés dans la portée de soin/buff` ; `−200` au CàC |
| `placer` | `+40·entités (alliées ou ennemies) dans la portée de ses sorts de déplacement à 1-2 PA` |

### 6.8 Mode `scripted` (« sans IA »)

Interpréteur de rotations déclaratives tirées des fiches de classe (rotations types §6 des fiches) :

```ts
export interface ScriptedRotation {
  presetId: string
  steps: { spellId: number; target: 'focus' | 'self' | 'nearestEnemy' | 'lowestAlly' | 'clusterCenter'; when?: 'turn1' | 'hasState:<id>' | 'apAtLeast:<n>' }[]
  move: 'approach' | 'keepRange' | 'stay'
}
```

Coût ≈ 0,05 ms/tour. Usages : référence (l'IA doit battre le script), tri ultra-rapide à grande échelle, tests de
non-régression du moteur.

---

## 7. Rôles et coordination d'équipe

### 7.1 Inférence des rôles (par règles)

```ts
export type RoleId = 'dps_mono' | 'dps_zone' | 'control_mp' | 'control_ap' | 'placer' | 'tank' | 'healer' | 'support'
export interface RoleAssignment { primary: RoleId; secondary?: RoleId; scores: Record<RoleId, number> }
export function inferRoles(team: Fighter[], data: GameDataStore, presets: PresetIndex): Map<number, RoleAssignment>
```

Scores (normalisés par la moyenne de l'équipe), calculés depuis les `SpellProfile` et les caractéristiques :

| Rôle | Score |
|---|---|
| `dps_mono` / `dps_zone` | `dpt` vs cible de référence ; part des dégâts en zone > 40 % ⇒ `dps_zone` |
| `control_mp` / `control_ap` | PM (PA) retirés attendus par tour (sac à dos de PA, `expectedApMpRemoved` vs esquive de référence) |
| `placer` | Σ des sorts de déplacement d'entité de coût ≤ 3 PA, pondérés par la distance déplacée |
| `healer` | soins attendus par tour / PV de l'équipe |
| `tank` | rang de PV effectifs + boucliers + tacle |
| `support` | valeur des buffs alliés (Δ `dpt` des alliés) |

`primary` = argmax ; `secondary` si ≥ 0,6 × primary. Le preset de build (§11.6) peut imposer le rôle ; la note
DofusDB `BreedData.roleScores` sert d'a priori (+10 %). Réassignation dynamique : si le `healer` meurt, l'allié au plus
haut score `healer` le devient.

### 7.2 Effet des rôles

Les rôles **ne créent pas d'objectif propre à un personnage** : dans `V(s)`, ils ne fixent que des poids **par allié**,
identiques pour tous les évaluateurs (`w_a` et `danger` du tank, `U_role`). Ils modifient en outre : les quotas de
candidats (§6.4), `roleTerm` (§6.7), l'éligibilité aux kills planifiés (le planificateur n'attribue pas de
kill à un `control_*` dont le `dpt` est < 60 % de la moyenne — guides : « un Enutrof full retrait ne doit pas faire les
kills ») et l'ordre de départage.

### 7.3 Tableau noir d'équipe

```ts
export interface TeamBlackboard {
  round: number; turnIndex: number
  roles: Map<number, RoleAssignment>
  focus: number[]                                  // ennemis par priorité décroissante
  killWindows: Map<number, { p: number; contributors: number[] }>
  reservations: Map<number /* allyId */, { targetId: number; p: number; value: number }>
  directives: Map<number /* enemyId */, MonsterDirective>   // planificateur de scénario (§9.4)
  clockShiftValue: number[]                         // valeur d'un décalage d'horloge de +0, +1, +2 (§9.4)
  setupRequests: SetupRequest[]
  version: number
}
export interface SetupRequest { by: number; kind: 'group' | 'bringInRange' | 'isolate' | 'stabilize'; targets: number[]; value: number }
```

Mise à jour au début du tour de chaque allié (`refreshIfNeeded`, ≈ 0,3-1 ms) :
* **Priorité de focus** : `prio_e = threat_e · (killWindow_e ? 1,5 : 1) / max(1, TTK_e) + directiveBonus_e`, `TTK_e` =
  nombre de tours alliés nécessaires (`hpEff / Σ dpt·reach`). Focus = top-1, secondaire = top-2.
* **Demandes de mise en place** : pour le prochain allié `X` (timeline), si son meilleur tour analytique augmente de
  > 20 % quand une cible est déplacée (regroupée dans sa zone, ramenée à portée, isolée de ses alliés), une demande est
  publiée ; le terme `nextAlly` (§6.3) la satisfait implicitement chez les placeurs.
* **Directives de scénario** : copiées du planificateur (§9.4).

---

## 8. D'où vient la créativité

### 8.1 Mécanismes

1. **Génération large** : tout sort lançable sur toute cible pertinente (alliés, soi, cases vides, centres de zone),
   y compris les sorts sans dégâts. Rien n'est exclu pour cause de « type ».
2. **Valeur par simulation exacte** : l'effet réel (poussée + collision, échange, téléportation symétrique, états,
   sous-sorts, déclencheurs) est joué ; la valeur vient de la différence d'états, donc des conséquences.
3. **Menace ordonnée** : retirer des PM, éloigner, Pacifier, bloquer un couloir ou encercler avec un tank fait baisser
   `danger` ; ces actions gagnent souvent contre les dégâts bruts.
4. **Macros tirées des données** (`macros.ts`) :
   * `A → B` si `A` pose l'état `S` sur le lanceur et `B.statesCriterion` exige `S` (portage/jet du Pandawa : état
     Porteur 3) ;
   * mobilité : sort de téléportation/recul du lanceur suivi d'un lancer impossible depuis `reach` mais possible depuis
     la case d'arrivée (Crâ Pas Chassé, Xélor) ;
   * déplacement d'ennemi puis zone du **même** personnage si la zone touche ensuite ≥ 2 ennemis ;
   * pose d'un débuff « prochain coup » (×150/×200 % dommages subis) puis plus gros sort sur la même cible.
   Plafond : 8 macros par pas.
5. **Mise en place pour le prochain allié** : terme `nextAlly` (placeurs, poussées, Balise Tactique) — le Pandawa
   regroupe pour le Crâ Feu qui joue après lui.
6. **Heures valorisées par le planificateur** : marcher dans le glyphe d'un monstre (échange de place + bonus +
   horloge +1) prend la valeur `clockShiftValue[1]` quand décaler l'horloge rend le plan de corruption meilleur.
7. **Exploration contrôlée** : un candidat par pas parmi les sorts mal couverts par l'analytique ; et l'optimiseur
   (§11.3) peut découvrir des styles (poids de contrôle élevés, placement agressif) que personne n'a écrits.
8. **Mise en évidence** : une action est « créative » si son `ΔV` vient pour plus de 60 % de termes autres que
   `enemyHp/enemyKill` ; elle produit un `aiNote` (`kind: 'creative'`) affiché dans le replay et compté dans le rapport.

### 8.2 Exemples attendus dans l'Œil de Vortex

| Situation | Action attendue | Terme qui la porte |
|---|---|---|
| Buboxor (6 PM) à 8 cases du Crâ | Enutrof : Pelle Aurifère ×2 sur Buboxor plutôt que des dégâts | `danger` |
| Ikargn au CàC de 2 alliés, Attraction prête | Pandawa porte l'allié fragile hors du rayon 3 et le jette derrière le tank | `danger`, macro portage |
| Deux Méjaires alignées sur le Iop | Iop sort de la ligne ; Xélor/Crâ pousse une Méjaire hors ligne | `danger` (Pacifiste = 0,9 × dpt du Iop) |
| Monstre « étoilé » à corrompre, tueur prévu trop loin | tueur prévu se rapproche ; autre allié le **pré-damage** sans le tuer | directives `corrupt`/`preDamage` |
| Le plan est meilleur décalé d'une heure | un allié entre dans le glyphe d'une Harpille (horloge +1, +200 Puissance) | `clockShiftValue` |
| Fin de tour avant celui du Vortex | personne ne finit aligné avec la future case de l'Auroraire | pseudo-menace §9.5 |
| Poison global des Harpilles | le soigneur soigne de 1 PV les empoisonnés (retire le poison) | `danger` (DoT) |
| Corrompus invulnérables | Pandawa jette un corrompu dans la ligne d'une Méjaire (mur de LdV) | `danger` |

---

## 9. Scénarios et objectifs (`src/dungeons`)

### 9.1 Contrat de scénario

```ts
export interface DungeonScenario {
  id: string                                   // 'vortex'
  mapId: number
  defaultParams: ScenarioParams
  uncertain: UncertainParamSpace               // §10.4
  createFight(engine: Engine, team: Fighter[], params: ScenarioParams, seed: number, placement?: number[]): FightState
  hooks(params: ScenarioParams): ScenarioHooks // règles « serveur » : vagues, invulnérabilité d'arrivée, fin
  objectives(params: ScenarioParams): ObjectiveTerm[]
  planner?: ScenarioPlanner                    // appelé par TeamBlackboard.refreshIfNeeded
  micro: MicroScenario[]                       // T1 (§11.1)
  summarize(fight: FightState): ScenarioSummary // champs propres au scénario pour FightSummary
}
export interface ObjectiveTerm {
  id: string
  weight: number
  prepare?(ctx: TurnContext): void             // lit le tableau noir une fois par pas
  value(s: FightState, side: TeamId, ctx: TurnContext): number   // contribution absolue en PVe
  cellTerm?(me: Fighter, cell: number, ctx: TurnContext): number // fin de tour (§6.7)
}
export interface ScenarioPlanner { plan(view: AIView, bb: TeamBlackboard, dpt: DptTable): void }
```

### 9.2 Œil de Vortex : ce que fait le scénario (et ce qu'il ne fait pas)

Le moteur exécute les sorts du donjon (Vortexiphan 5006, Glyphe téléporteur 5002, Décalage horaire 4996, 5003
résurrection, 5008 Marginal, 5060 *Action !*, 5009, Heurage 5065/5067…). Le scénario (`vortex/scenario.ts`) ajoute
uniquement les règles serveur :

| Paramètre (`params.ts`) | Défaut | Variante INCERTAINE (§10.4) |
|---|---|---|
| `arrivalRounds` | `[1, 7, 12, 17, 22]` (DPLN 2024) | `[1, 6, 11, 16, 21]` (JOL), p = 0,3 |
| `composition` | table N = 4 de `vortex.json` | — |
| `arrivalInvulnerableTurns` | 1 | — |
| `earlySpawnIfCleared` | `false` (les corrompus restent sur la carte) | `true`, p = 0,1 |
| `rezHpPct` | tirage 20-30 % (données) | 50 % (JOL/Tofus), p = 0,25 |
| `rezMinusOneMp` | `false` | `true`, p = 0,3 |
| `actionDelayAfterLastCorruption` | 1 (DPLN) | 0 (lecture client), p = 0,4 |
| `startingTeamRule` | `'average'` (initiative moyenne) | `'best'`, p = 0,5 |
| `monsterGrade` / `bossGrade` | 5 / 5 | — |
| `dimensionModifiers` | aucun | — |

Fin de combat : victoire à la mort du Vortex ; défaite si tous les personnages sont morts ; `maxRounds = 60`.

### 9.3 Horloge : lecture et prévision

```ts
export function currentHour(fight: FightState): number            // état 221..232 de l'Auroraire
export function hourCell(hour: number): number                     // vortex.json map.auroraire.hours[].auroraireCell
export interface HourWindow { id: number; round: number; ownerId: number; hour: number; turns: number[] /* fighterIds */ }
export interface ClockForecast {
  windows: HourWindow[]                                            // fenêtres futures sur `rounds` tours
  vortexTurns: { round: number; hour: number; auroraireCell: number; heurageReady: boolean }[]
}
export function forecastClock(view: AIView, rounds: number, shift = 0): ClockForecast
```

Une **fenêtre** commence au début du tour d'un personnage vivant (l'horloge avance de +1) et couvre tous les tours
suivants (monstres, invocations) jusqu'au début de tour du personnage suivant. Prévision : parcourir la timeline réelle
(`fight.timeline`, morts sautés, vagues futures insérées selon `arrivalRounds`), `hour ← hour % 12 + 1` à chaque début
de tour d'un personnage vivant, `+shift` appliqué à la fenêtre courante. Exemple à 4 joueurs, équipe des joueurs en
premier (P1 M1 P2 M2 P3 M3 P4 V), sans glyphe : P1 possède {I, V, IX}, P2 {II, VI, X}, P3 {III, VII, XI}, P4 {IV, VIII,
XII} et le Vortex joue en IV, VIII, XII. Un décalage de +1 donne P1 {II, VI, X}, …, P4 {V, IX, I}, Vortex en V/IX/I.
Auto-contrôle : à chaque tour, l'heure prédite est comparée à l'heure lue ; un écart invalide le plan (log `warn`).

### 9.4 Planificateur de corruption (`vortex/planner.ts`)

Modèle (lu dans l'état) : pour chaque monstre de vague `m` : `hours(m)` (masque 12 bits des états 221-232), statut
(`alive | dead | corrupt | incoming`), PV, étoile 234, bonus d'heures, menace `threat_m` ; vagues futures (round
d'arrivée, composition, invulnérables 1 tour) ; capacité de dégâts par fenêtre.

Règles du jeu modélisées : une mort pendant la fenêtre d'heure `h` ajoute `h` à `hours(m)` ; `m` ressuscite au début du
tour du Vortex suivant (PV = `rezHpPct × PVmax × bonus vitalité`) ; l'étoile est posée **au début** d'une fenêtre `h`
sur les monstres vivants non corrompus tels que `h ∈ hours(m)` ; tuer un monstre étoilé ⇒ corrompu à la résurrection.

```ts
export interface MonsterDirective {
  mode: 'corrupt' | 'first' | 'preDamage' | 'doNotKill' | 'control' | 'ignore'
  windowId?: number; killerIds?: number[]; hpFloor?: number; value: number; reason: string
}
export interface PlannerParams {
  horizonRounds: number          // 7
  safety: number                 // 1,15 : marge de dégâts demandée pour planifier un kill
  floorSigma: number             // 2 : plancher = μ_coup_max + 2σ + DoT en attente
  badHourCost: number[]          // §9.5, index 1..12
  aliveTurnCost: number          // 0,3 × threat par tour vivant non corrompu
  heurageCostPerMonster: number  // 0,5 × coût de l'heure du Vortex
}
```

Algorithme (≤ 1 ms, relancé au début de chaque tour de personnage — horizon glissant) :

```
plan(view, bb, dpt):
  pour shift ∈ {0, +1, +2} : P[shift] = planWith(forecastClock(view, H, shift))
  bb.clockShiftValue[k] = clamp(P[k].score − P[0].score − k·150, −2000, 2000)      // 150 = coût d'un détour
  bb.directives = P[0].directives                                                 // on exécute le plan sans décalage ;
                                                                                  // si un glyphe est pris, le plan est recalculé au pas suivant
planWith(fc):
  cap[w] = Σ_{a ∈ w} dpt(a, cible typique) × 0,8   (+ DoT des tours de monstres de w)    // capacité par fenêtre
  pre[w] = capacité des fenêtres antérieures utilisable en pré-dégâts (sans tuer)
  // 1. corruptions (peu chères : PV de résurrection)
  pour m (hours(m) ≠ ∅, non corrompu), par menace décroissante :
     w* = première fenêtre w telle que hour(w) ∈ hours(m), m vivant au début de w,
          need = PVrez_eff(m) × safety ≤ cap[w] + pre[w]
     réserver (m, corrupt, w*) ; cap[w*] −= need ; directives antérieures à w* : 'preDamage' (plancher) ou 'doNotKill'
  // 2. premiers kills (chers : PV pleins)
  pour m (hours(m) = ∅ ou corruption hors horizon), par (vague, menace) :
     pour chaque fenêtre candidate w (m vulnérable), h = hour(w) :
        w' = prochaine fenêtre d'heure h après la résurrection (≈ +3 tours à 4 joueurs)
        coût(w) = badHourCost[h] + aliveTurnCost·tours_vivants(m, maintenant → w') + heurageCost(h, m)
                  − qualité(tueur de w)        // dpt du possesseur de w ; rôle control_* exclu si dpt < 60 % moyenne
        faisable si PVeff(m) × safety ≤ cap[w] + pre[w] et capacité de corruption en w'
     choisir w de coût minimal ; réserver ; directives 'first' (fenêtre w) et 'preDamage' avant w
  // 3. le reste : 'control' (monstre vivant non planifié dans l'horizon) ou 'doNotKill' (étoile hors fenêtre utile)
  score = Σ valeurs des kills planifiés − Σ coûts − pénalités d'infaisabilité
```

Cas particuliers : avant ~26 tours du Vortex, rien ne presse au-delà de « corrompre dès que possible » (moins de
monstres actifs) ; une fois tout corrompu, le planificateur passe en mode `idle` (sécurité, pré-buffs) puis
`phase2Prep` au tour d'*Action !* ; la mort d'un personnage change le pas de l'horloge (N vivants) et la prévision
le reflète automatiquement.

### 9.5 Termes d'évaluation Vortex (écrits à la main)

Pour les monstres de vague, `enemyKill` générique est **désactivé** et remplacé par :

| Terme (`vortex/objectives.ts`) | Valeur (PVe) | Déclenchement |
|---|---|---|
| `corruptKill` | +4 000 | mort d'un monstre étoilé (234) dans sa fenêtre |
| `plannedFirstKill` | +2 500 − `badHourCost[h]` | mort d'un monstre « neuf » dans la fenêtre planifiée |
| `unplannedKill` | −(`badHourCost[h]` + 1 500) | toute autre mort de monstre de vague |
| `floorRisk` | −`P(achèvement accidentel)` × 1 500 | monstre `doNotKill`/`preDamage` sous son plancher ; `P` = proba qu'un ennemi/DoT/collision l'achève avant la fenêtre prévue |
| `preDamage` | +0,7 × dégâts jusqu'au plancher, 0 au-delà | monstre `preDamage` |
| `controlValue` | via `danger` (aucun terme dédié) | monstre `control` |
| `clockShift` | `bb.clockShiftValue[Δheure]` | `Δheure` = heure de `s` − heure au début du pas |
| `auroraireStrike` | pseudo-menace de la ThreatMap | allié dont le prochain tour suit le tour du Vortex et aligné (même x ou même y) avec `hourCell(heure du Vortex)` : `expectedDamage(500 Terre, Auroraire sans carac.)` + 50 % des PV érodés, + 20 % d'érosion (valorisée 0,2 × dégâts attendus des 2 tours suivants) ; seulement à partir du 2e tour du Vortex |
| `swapCells` | −300 en `cellTerm` | finir sur la case de l'heure qui sera atteinte avant mon prochain tour (ex. 484 = VII) ou sur 292 (IV → III) |
| `heurageStack` | −0,5 × `badHourCost[h_V]` × monstres non corrompus vivants | si Heurage du Vortex prêt à son prochain tour (phase 1) |
| `phase2Vortex` | `w_e = 1,0` pour le Vortex dès qu'il est vulnérable ; mort = +50 000 | phase 2 |
| `phase2Prep` | `allyPower` avec horizon 3 tours au lieu de 2 | tours « à vide » avant la phase 2 |

`badHourCost` initial (guides : éviter V, XI, I ; confortables III, VI, VIII, IX, XII) : I 1 200, II 500, III 400,
IV 600, V 1 500, VI 400, VII 300, VIII 400, IX 400, X 500 (× 2 si l'équipe a un `placer`), XI 1 500, XII 400.

### 9.6 Phase 2

Après *Action !*, joueurs et Vortex sont téléportés sur leurs cases de départ : le **placement initial** (§7.4)
compte donc aussi pour la phase 2. La ThreatMap du Vortex inclut Heuristique (ligne 1-8 sans LdV, 3 cibles), Morfaille
et l'origine « contact de la future Auroraire » si Heurage est prêt. Les deux tours sans action du Vortex donnent aux
termes `phase2Prep`/`thisTurnPower` le temps de valoriser buffs et positionnement ; `teamKillWindow` sur le Vortex
déclenche le focus total (« One-Turn »).

### 9.7 Placement de départ (`player/placement.ts`)

Énumération des affectations de 4 personnages aux 12 cases rouges (11 880), élaguée : exclure 484 (VII) et les cases
alignées avec IV et VIII si k = 4 (lues dans `vortex.json`), garder les 200 meilleures selon un score analytique
(`danger` initial + opportunité + distance de phase 2 au Vortex + rôle), puis 16 graines de micro-scénario `prefix12`
pour les 8 meilleures. Le placement retenu devient un paramètre de stratégie de l'équipe (§11.3).

---

## 10. Aléa, graines, déterminisme

### 10.1 Flux aléatoires

| Flux | Source | Usage |
|---|---|---|
| Combat | `fight.rngState` (mulberry32) ; option `rngRekeyPerTurn` | jets de dégâts, critiques, esquives PA/PM, groupes aléatoires, PV de résurrection |
| IA | `aiRng(fightSeed, fighterId, round, step)` (sfc32, `src/core/rng.ts`) | départages, bruit `noise` |
| Scénario | `scenarioRng(fightSeed)` | variante des paramètres INCERTAINS (§10.4), choix de cases de vague |
| Simulations IA | `mix32(fight.rngState ^ 0x5bd1e995, salt)` | groupes aléatoires dans les clones (jamais le flux réel) |

### 10.2 Graines

```ts
export const mix32 = (a: number, b: number): number => { /* splitmix32 de (a ^ imul(b, 0x9e3779b9)) */ }
export function fightSeed(campaignSeed: number, index: number): number { return mix32(campaignSeed, index) }
```

Toutes les variantes comparées dans une même étape utilisent **les mêmes** graines `fightSeed(c, 0..n−1)` (CRN). Un
résultat est entièrement déterminé par `(spec, seed, mode, versionDonnées, versionCode)` ; la version des données
(`data/dofusdb/manifest.json`) et un hash du code IA sont inscrits dans chaque `FightSummary`.

### 10.3 Reproductibilité des replays

`runOne(spec, seed, mode, { record: false })` en masse ; pour un combat intéressant (meilleur, médian, défaite la plus
proche de la victoire), `runOne(..., { record: true })` rejoue **exactement** le même combat (même hash
d'événements `fnv1a(events sans 'log'/'aiNote')`). L'IA ne lit jamais `fight.events` (règle vérifiée par un test).
Navigateur et Node exécutent le même code V8 ; on évite `Math.exp/log/pow` dans les décisions (approximations
rationnelles pour Φ et softmax) pour ne pas dépendre de différences d'arrondi entre moteurs JS.

### 10.4 Échantillonnage des paramètres incertains

`UncertainParamSpace` = liste de `(clé, valeurs, probabilités)` (§9.2). La variante d'une graine est tirée par
`scenarioRng(seed)` ; le rapport publie le taux de victoire **robuste** (sur le mélange) et le pire taux par
variante. Une stratégie qui ne gagne que sous une hypothèse est signalée.

---

## 11. La boucle d'itérations (`src/optimizer`)

### 11.1 Pyramide d'évaluation

| Niveau | Évaluation | Coût (1 cœur) | Rôle |
|---|---|---|---|
| T0 | analytique : `t0model` (combat abstrait : capacité de kill par fenêtre via le planificateur, attrition par menace) | 50-300 µs | trier 10⁵-10⁶ candidats |
| T1 | micro-scénarios simulés (IA `fast`) : `prefix12` (tours 1-12 : vague 1 + début vague 2), `phase2` (Vortex vulnérable, bonus d'heures tirés), `poutch` (calibration DPT) | 0,05-0,3 s | trier 10²-10³ candidats |
| T2 | combat complet, IA `fast` | ≤ 1 s (cible 0,6 s) | 10-50 candidats × 64-256 graines |
| T3 | combat complet, IA `search` + réglage θ | ≤ 30 s (cible 12 s) ; `fast` pour le réglage | finalistes, replays |

`prefix12` produit une **note de progression** (`corrompus/apparus`, morts, PV) convertie en probabilité de victoire
par une régression logistique calibrée sur ≈ 2 000 combats complets (recalibrée à chaque changement de version).

### 11.2 Monte-Carlo sur les graines

```ts
export interface FightSpec { scenarioId: string; team: TeamSpec; ai: AIConfigRef; params?: Partial<ScenarioParams>; mode: AIMode }
export interface TeamSpec { members: MemberSpec[]; placement?: number[]; theta?: StrategyParams }
export interface MemberSpec { breedId: number; presetId: string; build: CharacterBuild; spellVariants: (0 | 1)[] }
export interface FightSummary {
  seed: number; variant: number; winner: TeamId | null; rounds: number; endReason: string
  deaths: number; hpLeftPct: number; damageTaken: number; corruptedByRound: number[]; unlockRound?: number
  phase2Rounds?: number; creativeActions: number; unknownEffects: number; eventsHash: number; simCount: number
}
export interface BatchResult { n: number; wins: number; winRate: number; ci95: [number, number]
  meanRounds: number; p10HpLeft: number; byVariant: Record<number, { n: number; winRate: number }> }
export async function runBatch(spec: FightSpec, seeds: number[], pool: WorkerPool, stop?: StopRule): Promise<BatchResult>
```

* Intervalle de Wilson à 95 %.
* **Arrêt séquentiel** : `StopRule = { minN: 32, maxN, halfWidth: 0,03 }` ou, pour une comparaison, test apparié sur les
  mêmes graines (différence de victoires + différence de marge de PV) : arrêt dès que `|moyenne| > 2,5 × erreur
  type` ou `n = maxN`.
* Score scalaire d'un candidat : `winRate + 0,1 × marge` (marge = PV restants moyens normalisés, puis `−rounds/200`)
  pour départager les égalités à 100 %.

### 11.3 Réglage des paramètres de stratégie

`StrategyParams θ` (≈ 30 réels bornés + 2 discrets) : poids de §6.3 (`danger`, `focus`, `allyPower`, `opportunity`,
`nextAlly`, `killFeasible`), poids de §9.5 (`badHourCost` ×12 regroupés en 3 classes, `corruptKill`,
`plannedFirstKill`, `floorRisk`), `PlannerParams` (`safety`, `floorSigma`, `aliveTurnCost`), multiplicateurs de rôle,
indice de placement (top-8 de §9.7), règle d'utilisation des glyphes (on/off).

Méthode : **CEM** (cross-entropy) en espace normalisé — population 16, élite 4, 15-20 générations, 24-48 graines
communes par génération (renouvelées à chaque génération pour éviter le sur-apprentissage), IA `fast`, combats complets
(T2) ou `prefix12` (T1) pour les premières générations. Validation finale sur 500 graines **neuves**. Un θ global par
défaut (`data/ai/theta-default.json`) est réglé sur un panel de 12 équipes variées.

### 11.4 Optimisation du stuff (avec exos)

Objectif analytique par rôle (`stuff/surrogate.ts`), en PVe par tour, contexte Vortex :

```
S_dps(stats)     = dptPreset(stats, mixVortex) × 4  + 0,5 × EHP(stats, mixÉlémentsVortex)
S_control(stats) = mpRemoved(stats, esquiveVortex) × mpWorthRef + 0,5 × EHP + 0,2 × dpt
S_tank(stats)    = EHP + 10 × tacle + 0,2 × dpt
S_healer(stats)  = healPerTurn × 2 + 0,6 × EHP
pénalités : −15 % par PA manquant sous 12, −10 % par PM sous 6, PO < 5 pour les sorts à PO modifiable ;
            +initiative (petit bonus si l'équipe veut commencer : k = 4 au Vortex) ; build invalide ⇒ −∞
mixVortex = monstres de vague pondérés par leur nombre à 4 joueurs (Ikargn 3, Méjaire 4, Harpille 4, Buboxor 3,
            Brabuzar 5) + Vortex phase 2 (poids 0,3 × 19)
```

Recherche (`stuff/search.ts`) :
1. **Bassin d'objets** par emplacement : `itemsBySlot(slot, {minLevel: 180, maxLevel: 200})`, élagage par dominance sur
   les caractéristiques utiles au rôle (les objets de panoplie sont gardés à part, la dominance ne voit pas les bonus).
2. **Graines** : stuffs méta d'equipment.md §12 (Terre, Feu, Eau, Air, Tank, Sagesse) adaptés à la classe.
3. **Montée par coordonnées** : pour chaque emplacement, essayer les 30 meilleurs objets (score marginal) ; mouvements
   « panoplie » (remplacer 2-4 objets par les pièces d'une même panoplie) ; `computeBuildStats` évalue (≈ 50-100 µs).
4. **Recuit simulé** (2 000 itérations) pour sortir des optimums locaux de panoplie.
5. **Forgemagie** (`stuff/exos.ts`) : profils d'equipment.md §11.3 ; exo PA et exo PM placés sur les objets qui
   maximisent `S` (≤ 10 × 9 essais, un seul exo de chaque type par personnage), transcendances « Ta Do Per So » sur ≤ 6
   objets éligibles ; plafonds 12/6 respectés (pas d'exo inutile).
6. **Points de caractéristiques** (`stuff/points.ts`) : deux allocations testées via `allocateAll` (tout dans l'élément
   principal ; 300 élément + reste en vitalité) + parchemins 100 partout.
7. **Validation par simulation** : les 5 meilleurs stuffs par membre sont rejoués en T1 (`phase2` + `prefix12`) dans
   l'équipe finaliste, CRN, 32 graines.

Budget : ≈ 20 000 appels `computeBuildStats` par (classe, preset) ≈ 2 s ; résultats mis en cache par
`(presetId, contexte, profilForgemagie)`.

### 11.5 Variantes de sorts

Point de départ : la table « choix de variantes par rôle » de la fiche de classe (preset). Recherche locale : pour les
22 paires, évaluer le basculement des paires dont un des sorts est jamais/souvent utilisé (statistiques d'usage
collectées dans les `FightSummary`) ; T1 avec CRN (32 graines), accepter si le gain apparié est significatif ;
au plus 6 bascules testées par membre en T3.

### 11.6 Composition d'équipe (19 classes)

* **Presets** (`team/presets.ts`, données relues à partir des fiches de classe) : 2-4 par classe (ex.
  `iop_multi_zone_vortex`, `xelor_zone_feu_air_vagues`, `enutrof_retrait_pm_eau`, `pandawa_placement`,
  `cra_feu_zone`, `eniripsa_soin_feu_groupe`, `ecaflip_feu_hybride`…), chacun avec : rôle, élément, variantes des
  22 paires, rotation scriptée, graine de stuff. ≈ 55 presets ⇒ C(58, 4) = 424 270 équipes de 4 (multi-ensembles).
* **T0** (`team/t0model.ts`) : modèle abstrait du Vortex — pour chaque équipe : stuffs en cache (surrogate), `dpt` par
  membre vs `mixVortex`, horloge prévue (k selon l'initiative), planificateur exécuté en « simulation abstraite »
  sur 26 tours (capacité de kill par fenêtre, attrition = Σ menaces × facteur de contrôle de l'équipe − soins),
  phase 2 abstraite (tours pour tuer le Vortex vs dégâts reçus) ⇒ probabilité de victoire estimée + contraintes de
  couverture (≥ 2 tueurs capables de corrompre, ≥ 1 rôle de contrôle ou de placement). ≈ 0,2 ms par équipe ⇒ 85 s sur
  1 cœur, ≈ 20 s sur 4.
* **Successive halving** : T0 → 400 équipes → T1 (`prefix12` + `phase2`, 16 graines, IA `fast`) → 40 équipes → T2
  (combat complet, 64 graines) → 5 équipes → T3 : réoptimisation des stuffs (§11.4) et des variantes (§11.5),
  validation 500 graines en `fast` ; réglage θ allégé (16 × 24 × 12 ≈ 4 600 combats, premières générations en
  `prefix12`) pour les 3 meilleures ; 20 graines en `search` et replays pour la gagnante.
* **Diversité** : au moins 1 équipe par « archétype » parmi les 40 de T2 (ex. avec/sans soigneur, avec/sans placeur)
  pour ne pas éliminer tôt des stratégies atypiques mal notées par T0.

### 11.7 Workers et lots

```ts
export interface WorkerPool { size: number; run<T>(job: Job): Promise<T>; close(): Promise<void> }
export type Job =
  | { kind: 'register'; specId: string; spec: FightSpec }              // envoyé une fois par worker
  | { kind: 'fights'; specId: string; seeds: number[]; mode: AIMode; record: false }
  | { kind: 't0'; teams: TeamSpecLite[] }
```

* Node : `worker_threads`, taille `os.availableParallelism()` (4) ; chaque worker charge une fois un lot de données
  réduit (`createBundle` : sorts, monstres, objets utiles), ≈ 30-60 Mo.
* Navigateur : même protocole avec `new Worker(new URL('./fightWorker.ts', import.meta.url), { type: 'module' })`,
  taille `navigator.hardwareConcurrency − 1`.
* Lots de 16-32 combats par message ; résultats compacts (`FightSummary` sans événements) ; agrégation indexée par
  graine, donc identique quels que soient l'ordre d'arrivée et le nombre de workers.
* Reprise : les résultats sont ajoutés à `runs/<campagne>.jsonl` ; une campagne interrompue reprend sans refaire
  les graines déjà jouées.

### 11.8 Rapport et replays

`report.ts` produit : meilleure équipe (classes, presets, rôles), stuffs (objets, jets, exos, points), variantes de
sorts, θ, taux de victoire (robuste + par variante, IC 95 %), tours médians, morts, heure de chaque corruption,
actions créatives fréquentes ; replays animés du combat médian, du meilleur et de la défaite la plus serrée (rejoués
avec `record: true`, IA `search` pour la démo).

---

## 12. Budget de calcul

### 12.1 Coûts unitaires visés (à mesurer par `bench/`)

| Opération | Cible | Remarque |
|---|---|---|
| `cloneFight` (≈ 20 combattants) | ≤ 25 µs | avec `cloneState` du scénario |
| simulation d'un lancer sur clone (`average`) | ≤ 40 µs | dépend des sous-sorts |
| `buildThreatMap` | ≤ 30 µs | |
| `V(s)` complet | ≤ 60 µs | |
| `quickEstimate` | ≤ 1,5 µs | |
| `canCast` + LdV | ≤ 1 µs | cache LdV par pas |
| `dpt` (paire, non cachée) | ≤ 10 µs | |
| planificateur Vortex (3 décalages) | ≤ 1 ms | une fois par tour de joueur |
| tour de monstre | ≤ 1,7 ms (moy.) | identique dans tous les modes |
| tour de joueur `fast` | ≤ 3,5 ms (moy.) | ≤ 40 simulations ; pas ≈ 0,3 ms de génération + ≈ 5 × 125 µs |
| tour de joueur `search` | ≤ 120 ms (moy.), 400 ms max | ≤ 700 simulations |

### 12.2 Par combat (Œil de Vortex, 4 joueurs)

≈ 32-38 tours de jeu (déverrouillage ≥ ~26 tours du Vortex + transition + 2-5 tours de phase 2) ⇒ ≈ 140 tours de
joueurs, ≈ 150-220 tours de monstres actifs (≈ 5 par tour de jeu ; les corrompus sont sautés), plus les invocations.

| Mode | Joueurs | Monstres | Moteur + planificateur | Total visé |
|---|---|---|---|---|
| `scripted` | 140 × 0,05 ms | 175 × 1,7 ms | 0,05 s | ≈ 0,35 s |
| `fast` | 140 × 3,5 ms | 175 × 1,7 ms | 0,05 s | **≈ 0,85 s (< 1 s)** |
| `search` | 140 × 120 ms | 175 × 1,7 ms | 0,05 s | **≈ 17 s (< 30 s)** |

Leviers si les mesures dépassent : variante `turbo` (`topK` 2, `P` 4 : ≈ 0,5 s), `topK` 4 → 3 en `fast`, cases de lancer `P` 6 → 4, cache de `V` par hash d'état,
puis (plus invasif) un journal d'annulation (make/unmake) à la place du clonage.

### 12.3 Par campagne (4 cœurs)

| Campagne | Volume | Durée |
|---|---|---|
| Composition complète (§11.6) | T0 4,2·10⁵ (≈ 20 s) ; T1 400 × 2 × 16 (≈ 11 min) ; T2 40 × 64 (≈ 9 min) ; T3 5 × 500 + 3 réglages × 4 600 (≈ 55 min) ; stuffs ≈ 2 min | ≈ 1 h 20 |
| Réglage θ complet d'une équipe | 16 × 32 × 18 ≈ 9 200 combats `fast` | ≈ 33 min |
| Nuit (8 h) | ≈ 1,4·10⁵ combats complets `fast` ou ≈ 10⁶ micro-scénarios `phase2` | |
| « Millions » de combats complets | 10⁶ × 0,85 s / 4 | ≈ 59 h (≈ 35 h en `turbo`, ≈ 24 h en `scripted`) |

---

## 13. Plan de tests et de validation

### 13.1 Tests unitaires (`tests/ai-*.test.ts`)

* `ThreatMap` vs force brute (jouer chaque ennemi avec `MonsterBrain` sur clone) : corrélation ≥ 0,8 et même cible
  principale dans ≥ 80 % de 200 positions tirées.
* `DptTable` vs simulation `average` de 3 tours sur Poutch : écart ≤ 5 % sur les classes « simples » (Crâ, Iop,
  Sacrieur, Enutrof), calibration requise ailleurs.
* `computeReach` vs `move` réel (PA/PM restants après tacle) : identiques sur 500 cas aléatoires.
* `killProbability` vs fréquence empirique (`random`, 10⁴ tirages) : écart ≤ 3 points.
* `forecastClock` vs combat réel : l'heure prédite au début de chaque tour = heure lue, sur 50 combats complets
  (avec glyphes et morts de personnages).
* Planificateur sur états synthétiques : (a) monstre tué en I au tour 1 ⇒ corruption planifiée en I au tour 4 par
  P1 ; (b) tueur unique trop faible ⇒ `preDamage` chez les autres ; (c) décalage +1 préféré quand P1 n'a que des
  heures pénalisantes.
* Déterminisme : même `(spec, seed)` ⇒ même hash d'événements, avec `record` vrai/faux, 1 ou 4 workers.
* Honnêteté : un monstre ne contourne pas un piège invisible ; une IA n'utilise jamais `fight.events` ; deux
  simulations successives du même candidat donnent le même score.

### 13.2 Tests de comportement « dorés »

Monstres : T1-T10 de monster-ai.md §8.10, plus M-R1…M-R21 du tableau §5.7. Joueurs :

| # | Situation | Attendu |
|---|---|---|
| P1 | Enutrof, Buboxor à 8 cases du Crâ, retrait possible | retrait PM sur Buboxor (pas de dégâts) |
| P2 | Ikargn à 2 cases de l'Eniripsa, Attraction prête | l'Eniripsa recule hors du rayon 3, ou le Pandawa l'évacue |
| P3 | Crâ Feu, 3 monstres groupés à portée | Balise Tactique puis Flèche Explosive (macro/`thisTurnPower`) |
| P4 | Monstre neuf tuable en heure V | ne le tue pas (`unplannedKill`), le pré-damage |
| P5 | Monstre étoilé tuable par l'allié courant | le tue (`corruptKill`) même s'il n'est pas le plus menaçant |
| P6 | Plan meilleur avec +1 heure, glyphe à 2 PM | marche dans le glyphe |
| P7 | Fin de tour avant le Vortex | aucun allié aligné avec la future Auroraire |
| P8 | Allié empoisonné (Petit poison) | soin minimal qui retire le poison |
| P9 | Kill réservé à 8 PA, 12 PA disponibles | n'utilise pas les 4 PA libres d'une façon qui rend le kill impossible |
| P10 | Pandawa, monstre au CàC du Crâ | porte puis jette le monstre loin (macro portage) |
| P11 | Deux Méjaires alignées avec le Iop | le Iop quitte la ligne avant de finir son tour |
| P12 | Vortex vulnérable, kill d'équipe possible avant son tour | focus total sur le Vortex |
| P13 | Tank au contact de 2 monstres CàC | reste (tacle) au lieu de fuir |
| P14 | Monstre `doNotKill` à 10 % PV, Crâ avec zone | la zone évite ce monstre ou le Crâ choisit une autre case |

### 13.3 Combats de contrôle

| Combat | Attendu |
|---|---|
| Miroir 1 c 1 (même classe, même stuff) × 1 000 graines | victoire 50 % ± 4 % (absence de biais d'équipe/initiative) |
| 4 personnages équipés vs 4 Bouftous | 100 % de victoires, ≤ 3 tours |
| 4 personnages nus vs Œil de Vortex | ≈ 0 % (les monstres ne sont pas trop faibles) |
| Équipe méta des guides (Crâ + Enutrof retrait PM + Iop + Eniripsa, stuffs d'equipment.md §12) vs Vortex | taux élevé (cible ≥ 60 % en `fast`, ≥ 75 % en `search`) ; corruption de la vague 1 avant la vague 2 dans ≥ 50 % des cas |
| Même équipe, IA `scripted` | taux nettement inférieur à `fast` (l'IA apporte quelque chose) |
| `search` vs `fast` (CRN, 200 graines) | `search` ≥ `fast` (sinon bug d'évaluation ou de faisceau) |

### 13.4 Bancs de performance (CI)

`bench/*.bench.ts` (vitest bench) avec seuils = 2 × les cibles de §12.1-12.2 ; un dépassement fait échouer la CI.
Banc de bout en bout : 20 combats `fast` (graines fixes), 2 combats `search`.

### 13.5 Validation statistique et de fidélité

* Réduction de variance CRN mesurée (variance de la différence appariée vs indépendante) : attendu × 3 au moins avec
  `rngRekeyPerTurn`.
* Calibration de `prefix12` → victoire : courbe de fiabilité (déciles), erreur ≤ 5 points.
* Fidélité des monstres : format d'annotation de vidéos (`tests/fidelity/*.json` : état + action observée) ; métrique
  d'accord top-1 / top-3 du `MonsterBrain`, suivie dans le temps.

---

## 14. Risques et parades

| Risque | Effet | Parade |
|---|---|---|
| Interprètes d'effets incomplets ou faux | l'IA optimise un jeu qui n'existe pas | compteur d'effets inconnus par combat ; résultats « faible confiance » exclus du rapport ; tests dorés sur les sorts du Vortex |
| Coût du clonage | budgets dépassés | `cloneState`, estimation analytique d'abord, `topK` bas ; plan B : journal d'annulation |
| Poids mal réglés | jeu absurde (fuite permanente, buffs inutiles) | tests dorés P1-P14, combats de contrôle, CEM, décomposition `EvalBreakdown` dans les replays |
| Myopie gloutonne (mises en place en 2 temps) | combos ratés | macros, `nextAlly`, mode `search` pour la démo |
| Lecture du futur (RNG cloné) | IA « voyante », taux de victoire surestimés | graine décorrélée dans `simClone` ; test |
| Fuite d'information cachée | monstres trop forts / joueurs trop forts | `sanitizeForTeam` ; tests d'honnêteté |
| Sur-apprentissage aux incertitudes du donjon | stratégie fragile en jeu réel | échantillonnage des paramètres INCERTAINS, taux robuste, pire variante publiée |
| Sur-apprentissage aux graines | θ chanceux | graines renouvelées par génération, validation sur graines neuves |
| Modèle du planificateur ≠ moteur | kills au mauvais moment | auto-contrôle heure prédite/lue, replanification chaque tour, tests `forecastClock` sur combats réels |
| Mécaniques de classe mal vues par l'analytique | sorts jamais simulés, classes sous-estimées | `analyticCoverage`, exploration, calibration `poutch`, T1/T2 simulés avant toute élimination définitive |
| Monstres trop « intelligents » (hors IA officielle) | difficulté irréaliste | budget fixe, pas de faisceau ni d'anticipation chez les monstres hors `openers` documentés |
| Combinatoire de composition | campagne trop longue | T0 abstrait, successive halving, cache des stuffs, diversité imposée |
| Non-déterminisme (Map, flottants, workers) | replays impossibles à reproduire | règles F6, hash d'événements testé en CI |
| Navigateur lent / mémoire | UI figée | Web Workers, lot de données réduit, mode `fast` par défaut |

---

## 15. Plan de livraison

1. **Socle** : `view`, `rng`, `analysis/*` (SpellProfile, DPT, reach, castCells, ThreatMap, kill) + tests unitaires +
   extensions moteur (§2.2).
2. **MonsterBrain** générique + profils/overrides Vortex + T1-T10, M-R*.
3. **PlayerBrain `fast`** (V(s), candidats, fin de tour, rôles, tableau noir) + P1-P3, P8-P13 + combats de contrôle.
4. **Scénario Vortex** (vagues, paramètres), `forecastClock`, planificateur, objectifs + P4-P7, P14 ; démo animée.
5. **Optimiseur** : `runOne`, pool de workers, `runBatch`, arrêt séquentiel, micro-scénarios, calibration.
6. **Stuff** (surrogate, recherche, exos, points) puis **composition** (presets, T0, successive halving), variantes.
7. **Mode `search`**, réglage CEM, rapport Vortex et replays de démonstration.

---

## Annexe A — Poids par défaut (`data/ai/theta-default.json`, extrait)

```json
{
  "player": { "minGain": 20, "enemyHp": 1.0, "summonHp": 0.5, "focus": 0.3, "killKappa": 0.3, "killThreatTurns": 2,
              "allyHp": 1.0, "tankHp": 0.8, "allyErosion": 0.5, "danger": 0.8, "dangerTank": 0.6, "allyPower": 0.6,
              "thisTurnPower": 1.0, "killFeasible": 0.8, "opportunity": 0.25, "nextAlly": 0.5, "endMoveMinGain": 30 },
  "roleUtility": { "healer": 2000, "control_mp": 1500, "control_ap": 1500, "placer": 1000 },
  "monster": { "wDmg": 1.0, "wKill": 1.0, "kappa": 0.5, "wAP": 0.8, "wMP": 0.8, "wHeal": 0.9, "wFF": 0.6,
               "summonValue": 0.5, "reflectAversion": 0.2, "minActionScore": 1, "positionDuringTurn": 0.25, "topK": 6 },
  "vortex": { "corruptKill": 4000, "plannedFirstKill": 2500, "unplannedKillBase": 1500, "floorRisk": 1500,
              "preDamage": 0.7, "shiftDetour": 150, "swapCell": 300, "vortexKill": 50000,
              "badHourCost": [0, 1200, 500, 400, 600, 1500, 400, 300, 400, 400, 500, 1500, 400] },
  "planner": { "horizonRounds": 7, "safety": 1.15, "floorSigma": 2, "aliveTurnCost": 0.3, "heurageCostPerMonster": 0.5 }
}
```

## Annexe B — Glossaire

* **PVe** : PV-équivalent, unité commune des scores.
* **Fenêtre d'heure** : intervalle de la timeline pendant lequel l'Auroraire reste sur une heure (du début du tour d'un
  personnage au début du tour du personnage suivant).
* **CRN** : *common random numbers*, mêmes graines (et mêmes jets par tour avec `rngRekeyPerTurn`) pour comparer des
  variantes.
* **Successive halving** : évaluer beaucoup de candidats avec peu de graines, garder la meilleure fraction, augmenter
  le nombre de graines, recommencer.
* **CEM** : méthode de l'entropie croisée (échantillonner une gaussienne de paramètres, garder l'élite, réajuster).
