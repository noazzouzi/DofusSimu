# Theorycraft contre un boss — conception v1

*Conception du 2026-10-07. Demande de l'utilisateur : usage personnel, PvM uniquement ; répondre à
(1) « quel stuff est le plus intéressant contre un boss donné ? » et (2) « quelles classes sont les plus intéressantes
contre un boss donné ? ». Valeurs par défaut : 4 joueurs (boss de rang 1), niveau 200, les 19 classes, Expéditions
exclues ; tout est réglable. Types partagés : `src/theorycraft/types.ts`. Ce qui a été livré et ce qui s'écarte de
cette conception : §6 ; guide d'utilisation : [`../theorycraft.md`](../theorycraft.md).*

## Constats de départ (cartographie du 2026-10-07)

- Le proxy de stuff (`createProxyContext`) et `optimizeStuff` marchent contre n'importe quel boss
  (`ProxyOptions.targets/incoming`), mais **sans `targets` ils retombent en silence sur le mix du Vortex**
  (proxy.ts:339).
- Le boss évalué hors combat est **« nu »** : son sort de départ (116 boss sur 162 : invulnérabilités, ±% rés,
  ×% dommages subis 1163 dont « −50 % à distance » de Merkator sur déclencheur `DR`, +% dommages finaux 1171) et ses
  états ne sont jamais appliqués. Les 4 boss dont tous les sorts dépendent d'un état (Solar, Servitude, Guerre,
  Belladone) semblent ne pas frapper (PV effectifs saturés à 20 × PV).
- Le sac à dos de DPT relance les sorts à relance à chaque tour, ignore buffs, invocations, glyphes, pièges, arme et
  débuffs « dommages subis » ; les états initiaux de classe (masques Zobal, Armé Forgelance, Sobre Pandawa) ne sont pas
  posés ⇒ DPT quasi nul pour ces classes.
- L'EHP du proxy ne dépend que du stuff (aucun kit défensif de classe).
- `optimizeStuff` sous le niveau 200 rend le build de départ invalide (search.ts:607) ; ses graines incluent 49 stuffs
  `vortex_*`.
- 162 boss distincts : 137 par `dungeons.json[].bosses`, 25 propres aux Expéditions (repli `isBoss`).
- Grade = rang = `clamp(joueurs − 3, 1, 5)` : change les PV (136 boss sur 137), rarement les caractéristiques (16) et
  presque jamais les résistances (2).
- Données extraites le 2026-10-04 (3.6) ; la 3.7 est en ligne depuis le 2026-10-06 et l'API DofusDB a renommé les
  champs de résistance (`reduction*`) : `scripts/fetch-dofusdb.mjs` perdrait les résistances en silence.
- Sources des fiches manuelles : les CGU de dofuspourlesnoobs interdisent l'accès automatisé et l'usage pour alimenter
  une IA ⇒ aucune extraction ni copie ; fiches écrites à la main par l'utilisateur (modèle fourni), DofusWiki
  (CC-BY-SA, attribution) possible.

## 0. Principes

1. **Déterministe et explicable.** Aucun combat d'IA. Chaque chiffre affiché a une décomposition (par sort, par
   élément, par caractéristique). Les classements valent plus que les valeurs absolues : on le dit à l'écran.
2. **Réutiliser ce qui marche.** Le pipeline de dégâts (src/damage), l'agrégation de stuff (src/stats), le sac à dos de
   DPT (src/ai/core/dpt.ts, utilisable hors combat), le proxy de stuff (src/optimizer/stuff/proxy.ts, déjà vérifié
   contre 137 boss) et l'optimiseur (optimizeStuff, 3,5-4,8 s par preset et par boss).
3. **Aucune dépendance au Vortex.** `src/theorycraft/` n'importe rien de `src/dungeons/vortex` ni de
   `src/dungeons/generic/dummy` (VORTEX_TARGET_MIX). Toute cible est passée EXPLICITEMENT au proxy. Un test le vérifie.
4. **Hypothèses visibles.** Nombre de joueurs (donc grade), adds, phases, mécaniques non modélisées, résistances
   aberrantes : tout est listé dans la sortie (« Hypothèses » et « Avertissements »).
5. **Pur.** `src/theorycraft/*` n'importe pas `node:` (comme src/stats et src/damage). Les accès fichiers (dungeons.json
   via `NodeDataStore.rawFile`, fiches `data/bosses/*.json`) passent par un adaptateur Node séparé
   (`src/theorycraft/node.ts`).

## 1. Modules (src/theorycraft/)

### 1.1 `bosses.ts` — index des boss
- `interface DungeonLite { id; name; optimalPlayerLevel; minLevel?; difficulty?; bossIds: number[]; monsterIds:
  number[]; isExpedition: boolean }` et `interface DungeonSource { dungeons(): readonly DungeonLite[] }`.
- `listBosses(data, src, opts?: { includeExpeditions?: boolean }): BossEntry[]` : bosses[] du donjon, repli sur
  `isBoss` (les « Expédition » sont exclues par défaut). `BossEntry { monsterId; name; dungeons: {id, name,
  level}[]; bossLevel; gradeCount; isExpedition; source: 'bosses'|'isBoss' }`. Les boss présents dans plusieurs
  donjons sont fusionnés.
- `searchBosses(entries, query)` (sans accents, insensible à la casse, sur le nom du boss ET du donjon ; un nombre =
  id de monstre) ; `resolveBoss(entries, text)` : id exact, nom exact, sinon meilleur préfixe/sous-chaîne ; ambigu ⇒
  erreur qui liste les candidats.
- `bossGradeFor(players)` = `clamp(players − 3, 1, 5)` borné aux grades existants (règle des donjons modulaires,
  docs/research/vortex-audit.md §1.3) ; défaut 4 joueurs ⇒ grade 1. `--grade` impose le grade.

### 1.2 `bossProfile.ts` — fiche du boss
`bossProfile(data, monsterId, { grade, overrides? }): BossProfile`
- Identité, niveau, PV, PA, PM, résistances % (brutes, puis effectives après surcharge), esquive PA/PM, tacle, fuite
  (dérivées de `createMonsterFighter`), éléments classés du plus faible au plus fort.
- **Profil offensif par phase** : une phase = un ensemble d'états du lanceur (les `statesCondition` des sorts du
  boss) ; phase « base » = aucun état. Pour chaque sort disponible dans la phase : éléments, dégâts moyens par lancer
  contre 0 % de résistance (pipeline DoMath, critique pondéré, sous-sorts suivis), coût PA, lancers/tour, relance,
  drapeaux (`hpBased`, `delayed`, `triggered` (poison), `positional`, `ringExcludesTarget`, `summon`, `mark`).
  Agrégats : pic par tour (sac à dos sur les PA), soutenu par tour (relances amorties), parts par élément.
- **Mécaniques détectées** : états posés (effets 950) avec les drapeaux de spell-states (invulnérable, invulnérable
  mêlée/distance, indéplaçable, Pacifiste/inactif, insoignable…), invocations, soins du boss, renvoi, retraits PA/PM
  infligés aux joueurs, érosion, dégâts en % de PV.
- **Sort de départ appliqué analytiquement** : effets inconditionnels sur soi (±% rés 1076/1077…, ×% subis 1163,
  +% finaux 1171) intégrés aux statistiques effectives ; effets réactifs `DR`/`DM` (ex. 1163 ×50 sur `DR`) traduits en
  `rangedResPct`/`meleeResPct` équivalents et signalés ; états d'invulnérabilité ⇒ mécanique + phase « vulnérable »
  supposée pour le DPT (signalé).
- **Phases** : une phase par combinaison d'états citée dans les `statesCondition` des sorts du boss (bornée), poids
  égaux par défaut (surchargeables) ; aucun boss n'a « 0 dégât » simplement parce que ses sorts exigent un état.
- **Avertissements** : résistance ≥ 100 % (mécanique, pas immunité), aucun dégât direct calculable, sorts de phase,
  invocations, dégâts en % de PV, grade incertain.
- Réutilise : `monsterSpells`, `DAMAGE_SPECS`/`resolveElement`, `expectedDamage`, `critChance`, `effectSpellRef`,
  `statesConditionMet`, `createMonsterFighter`. Prototype : scratchpad `bossdmg2.ts` (162 boss en 40 ms).

### 1.3 `overrides.ts` — fiches manuelles `data/bosses/<monsterId>.json`
Schéma v1 (toutes les clés facultatives sauf `version` et `monsterId`) :
```json
{
  "version": 1, "monsterId": 3416, "name": "Comte Harebourg",
  "sources": ["https://…"], "updatedAt": "2026-10-07",
  "resPct": [14, 17, 16, 29, 25],
  "phases": [{ "id": "base", "name": "…", "states": [], "weight": 1, "resPct": null,
               "invulnerable": false, "notes": "…" }],
  "adds": [{ "monsterId": 0, "grade": 1, "count": 2, "weight": 0.5 }],
  "excludeSpells": [], "positionalSpells": [],
  "mechanics": [{ "kind": "invulnerable-range", "summary": "…", "counters": ["melee"] }],
  "notes": "texte libre"
}
```
`parseBossOverrides(json)` valide (pur) ; l'adaptateur Node lit le dossier. Premières fiches : seulement des boss
dont les sources sont fiables (recherche externe) ; chaque fiche cite ses sources.

### 1.4 `target.ts` — cible du proxy
`bossProxyOptions(profile, { adds?, profile?: 'balanced'|'defensive'|'offensive', melee?, role })`: `ProxyOptions`
`{ targets: [{ monsterId, weight: 1, grade, resPct? }], incoming: [boss (+ adds)], grade, exponents, rangeNeed }`.
Extensions additives de `ProxyTarget` : `stats?: Partial<Stats>` (statistiques imposées après `createMonsterFighter` :
résistances effectives, `rangedResPct`/`meleeResPct`…) et `states?: number[]` (états posés sur le monstre : ses sorts
de phase deviennent lançables pour les dégâts reçus). La logique des profils (a ± 0,2 / b ∓ 0,2) est extraite de
`vortexProxyOptions` dans une fonction partagée, sans changer le comportement du Vortex.

### 1.4 bis `stances.ts` — états initiaux de classe
Postures et états de départ que le moteur ne pose pas (masques Zobal, Armé/Désarmé Forgelance, Sobre/Saoul Pandawa,
…) : pour le DPT on évalue chaque posture possible et on garde la meilleure (affichée). Sans cela ces classes valent
≈ 0 en DPT.

### 1.5 `rotation.ts` — DPT soutenu
`sustainedDamage(table, a, d, { turns = 6 })` : sac à dos tour par tour (`DptTableImpl.turn`) en faisant évoluer les
relances et les lancers entre les tours ; rend `{ perTurn[], mean, burst, casts[][] }`, **non calibré**. Le DPT
« rafale » (1 tour) surévalue les sorts à relance (Colère de Iop…) : on affiche les deux, le classement des classes
utilise le soutenu.

### 1.6 `utilities.ts` — utilités de classe et pertinence contre le boss
- Par preset : PM/PA retirés par tour contre l'esquive du boss (`ProxyContext.removedPoints`, `expectedApMpRemoved`),
  soins par tour, boucliers, placement, invocations, ×% dommages subis, buffs alliés (Puissance, Dommages, PA/PM),
  érosion — depuis `createSpellProfileIndex` **nettoyé** (portes et masques des sous-sorts respectés, armure 265/105
  reconnue, sous-sorts partagés dédoublonnés).
- Table explicite `MECHANIC_RELEVANCE` : mécanique du boss → utilités utiles/inutiles avec une phrase d'explication
  (ex. boss indéplaçable ⇒ placement sans valeur ; invulnérable à distance ⇒ mêlée ; adds/invocations ⇒ zone ;
  poison/DoT ⇒ soin ; soin du boss ⇒ érosion/anti-soin ; retraits PA/PM subis ⇒ esquive, +PA/+PM).

### 1.7 `stuff.ts` — question (1)
`stuffVsBoss(data, member, profile, opts)` : `optimizeStuff` avec `bossProxyOptions`, graines `vortex_*` exclues hors
Vortex (nouvelle option `seedFilter` d'optimizeStuff), `iterations` 3 000 par défaut. Sortie : meilleur stuff + top N
distincts (candidats re-notés en exact), comparaison avec les 6 stuffs génériques et le stuff du preset, évaluation du
stuff de l'utilisateur (lien RoxxSolver via `roxxImport`), poids marginaux des caractéristiques contre ce boss
(`statWeightsAt`, convertis en équivalences lisibles : « 1 PA ≈ X Puissance »), DPT par sort, dégâts reçus par
élément.

### 1.8 `classes.ts` — question (2)
`rankClasses(data, profile, opts)` : pour chacun des 49 presets de base, avec le stuff générique de son élément (rapide)
ou un stuff optimisé contre le boss (`--optimize`, ≈ 4 s par preset, pool de workers) :
- **Dégâts** : DPT soutenu contre les résistances effectives du boss (et rafale) ; élément du preset vs élément faible.
- **Survie** : PV effectifs contre le profil offensif du boss (dégâts reçus par élément).
- **Contrôle** : PM/PA retirés espérés par tour contre l'esquive du boss.
- **Soutien** : soins/tour, boucliers, réductions, buffs alliés.
- **Apport offensif d'équipe** : « dommages subis » posés sur l'ennemi (Crâ ×110, Iop ×115, Huppermage ×115,
  Forgelance ×107, Sacrieur ×103) et buffs de Puissance/Dommages/PA/PM aux alliés.
- **Atouts / limites contre ce boss** : utilités pertinentes selon `MECHANIC_RELEVANCE` ; mécaniques de classe non
  modélisées (rampes, invocations, glyphes, pièges… liste par classe) ⇒ note de confiance.
Agrégation par classe (meilleur preset par axe) et synthèse : top classes par axe + une composition suggérée
(un meilleur par rôle utile contre ce boss). Pas de note globale opaque : chaque axe est montré.

### 1.9 `report.ts` — sorties texte (CLI, français) et JSON (UI)

## 2. CLI (`src/cli/theory.ts`)
```
npm run sim -- bosses [recherche] [--all]                       # liste / recherche des boss
npm run sim -- boss <nom|id> [--players N | --grade G] [--json] # fiche du boss
npm run sim -- boss <nom|id> classes [--optimize] [--json]      # classement des classes
npm run sim -- boss <nom|id> stuff --class <classe|preset> [--roxx <lien>] [--profile P] [--top N] [--out f.json]
```

## 3. Interface web (`#boss`, serveur de dev)
Plugin `web/plugins/theory.ts` (même NodeDataStore que le plugin des stuffs) : `GET /api/theory/bosses`,
`GET /api/theory/boss?id&players|grade`, `POST /api/theory/classes`, `POST /api/theory/stuff`. Page : recherche de boss,
fiche (résistances par élément aux couleurs --el-*, élément faible, profil offensif, mécaniques, avertissements),
onglet « Classes » (tableau triable par axe), onglet « Stuff » (classe/preset, lien RoxxSolver, profil, résultat :
fiche du stuff, comparaisons, poids des caractéristiques). Page « dev seulement » (usage personnel).

## 4. Vérification
- Tests unitaires `tests/theory-*.test.ts` (< 2 s chacun sauf l'optimisation) : index (comptes observés), résolution
  par nom, profils dorés (Vortex, Merkator, Solar par phase), indépendance au Vortex (grep), proxy contre boss
  (l'élément faible bat l'élément fort), rotation (soutenu ≤ rafale, relance amortie), déterminisme.
- Contrôle moteur : DPT soutenu analytique contre `measureCalibration` (mini-combat réel contre le boss) ; écart
  affiché par preset.
- Protocole de vérification en jeu (docs/theorycraft.md) : taper un Poutch avec un stuff connu et comparer.

## 4 bis. Corrections annexes
- `optimizeStuff` : option `seedFilter` (graines `vortex_*` exclues hors Vortex, graines de niveau trop élevé
  exclues) ; un départ invalide n'est jamais rendu comme meilleur build (search.ts:607).
- `scripts/fetch-dofusdb.mjs` : lecture des deux schémas DofusDB (3.6 `neutralResistance`/`paDodge`, 3.7
  `reduction*`/`paLostDodge`…) et nouveaux champs (résistances fixes, critiques, poussée, tacle, initiative) ; échec
  explicite si un boss n'a pas ses 5 résistances. La ré-extraction des données 3.7 reste une décision de
  l'utilisateur (elle change des valeurs de référence du Vortex).

## 5. Hors périmètre v1 (signalé à l'écran)
Dégâts des invocations, glyphes, pièges, bombes ; buffs d'équipe entre personnages ; rampes multi-tours spécifiques
(Fureur, Combo…) ; IA réelle du boss (le pic par sac à dos est optimiste sur une cible, mais zones, sorts en réaction
et invocations ne sont pas comptés : le total peut être sous-estimé) ; positions et ligne de vue.

## 6. État de l'implémentation (2026-10-08)

*Relevé sur le code de `src/theorycraft/` et les commits `1fc0aa7..0d9a669` (e93fb34 à 0d9a669), mis à jour après
l'audit final (lots A et B, réconciliation de la CLI et de la page). Les en-têtes JSDoc des modules font foi pour le
détail ; ce paragraphe résume ce qui existe et ce qui a changé par rapport aux §0-§5.*

### 6.1 Modules livrés

| Module | Rôle | Pur ¹ |
|---|---|---|
| `src/theorycraft/types.ts` | Types partagés, sérialisables JSON (fiche, utilités, classement, stuff). | oui |
| `bosses.ts` | Index (`listBosses` : 137 boss, 162 avec les Expéditions), `searchBosses`, `resolveBoss` (erreur qui liste les candidats), `bossGradeFor` ; `MAX_PLAYERS` et `playersForGrade` (grade imposé G ⇒ composition de G + 3, 8 au plus : CLI, page et `rankClasses`). | oui |
| `overrides.ts` | `parseBossOverrides` : validation stricte du schéma v1 des fiches manuelles. | oui |
| `bossProfile.ts` | `bossProfile` → `BossProfileDetail` : grade, sort de départ appliqué, dégâts par sort, phases, mécaniques, avertissements, hypothèses ; `DATA_SNAPSHOT` (date et version des données). | oui |
| `index.ts` | API publique PURE (ce qui précède), utilisable dans un navigateur. | oui |
| `node.ts` | Seul accès disque : `nodeDungeonSource` (`dungeons.json`, règle « Expédition »), `loadBossOverrides` (`data/bosses`). | non |
| `fighters.ts` | Combattants HORS COMBAT (personnage d'un build ou de caractéristiques, boss avec caractéristiques et états imposés), moteur partagé avec le proxy, ids et équipes distincts (`assertDistinct`). | oui |
| `hits.ts` | Coups au contact ou à distance : `possibleHits` (règle du jeu, mêlée ⇔ cible adjacente ; fonction partagée avec le calculateur `degats`, filtre `keep` de ses lignes), `TheoryDptTable` (`theoryDptTableOf`) : sac à dos du theorycraft dont `perCast` retient, pour un personnage, le coup que la cible subit le mieux (style du personnage à égalité, `CONTACT_TAG`) et, pour un monstre, les conventions de la fiche ; `split` (part immédiate et poisons d'un lancer), `castLines` (forme fermée du proxy). L'IA du Vortex garde `isMeleeSpell`. | oui |
| `rotation.ts` | `sustainedDamage` : DPT soutenu tour par tour (`perTurn`, `mean`, `burst`, `casts`, `steady`, `period`, `steadyBySpell`) ; poisons suivis d'un tour à l'autre avec la table du theorycraft. | oui |
| `stances.ts` | `STANCES` (Zobal, Forgelance, Pandawa, Eliotrope, Steamer, Ouginak), `STANCE_NOTES`, `bestStance`. | oui |
| `target.ts` | `bossProxyOptions` : fiche → `ProxyOptions` explicites (`strictTargets`), une cible par phase attaquable, dégâts reçus par phase qui frappe (boss à mi-vie, sorts exclus et positionnels retirés), adds de la fiche (exposition `ADD_EXPOSURE` 0,5), table du theorycraft (`theoryTable`, `contact`), PO voulue 6 à distance ; règles communes à `classes` et `stuff` : `playsMelee` (joué au contact si le boss n'est attaquable qu'au contact ou si le preset est de mêlée), `removalVoid`, `incomingCoherence`. | oui ² |
| `utilities.ts` | `classUtilities` (utilités chiffrées depuis les profils de sorts NETTOYÉS, tours mixtes), `MECHANIC_RELEVANCE`, `relevance`, `CLASS_MODEL_LIMITS`, `CLASS_CONFIDENCE`. | oui |
| `classes.ts` | `rankClasses` → `ClassRanking` (question 2). | non ³ |
| `stuff.ts` | `stuffVsBoss` → `StuffVsBossResult` (question 1), `statEquivalences`, `dominantElement`. | non ³ |
| `formatBoss.ts`, `formatClasses.ts`, `formatStuff.ts` | Rendus texte français (CLI), purs. | oui |
| `analysis.ts` | Entrée des ANALYSES : `index.ts` + cible, classes, stuff, utilités, postures, rotation, rendus. | non ³ |

¹ Aucun import `node:` ni de `src/dungeons` à l'exécution. Tests : aucun module sauf `node.ts` n'importe directement
`node:`, `src/dungeons/vortex` ni `dummy` (`tests/theory-profile.test.ts`, qui suit aussi la fermeture d'`index.ts`) ;
fermeture transitive sans `src/dungeons` ni proxy pour `fighters`, `rotation` (donc `hits`), `stances`, `utilities`,
`formatBoss`, `formatClasses` (graphe des imports d'exécution par le compilateur, `tests/import-graph-helpers.ts`,
vérifié par mutation). ² N'importe que des types du proxy ; les exposants viennent de `profiles.ts`. ³ Tirent le
proxy et l'optimiseur, donc INDIRECTEMENT des modules du Vortex
(`src/dungeons/vortex/{clock,constants,params,placement}.ts`, `src/dungeons/generic/{dummy,skirmish}.ts`,
`src/dungeons/waves.ts` : liste figée par `tests/theory-stuff.test.ts`) ; le mix du Vortex n'est jamais utilisé
comme cible (`strictTargets`).

Hors de `src/theorycraft/` :

- `src/optimizer/stuff/proxy.ts` : `ProxyTarget.stats` / `states` (cible « en combat » : caractéristiques effectives,
  états de phase ; exact et forme fermée voient les mêmes défenses), `strictTargets` (erreur française si `targets`
  manque). Sans ces champs, nombres identiques au bit près (Vortex).
- `src/optimizer/stuff/targetFighter.ts` (nouveau) : `proxyEngine` (moteur partagé par donnée) et
  `applyTargetOverrides`, extraits de proxy.ts et ré-exportés par lui, pour que `fighters.ts` ne dépende ni de proxy.ts
  ni du mix du Vortex.
- `src/optimizer/stuff/profiles.ts` (nouveau) : `ROLE_EXPONENTS`, `ProxyExponents` et `applyProfile` (profils
  `balanced` / `defensive` a − 0,2 b + 0,2 / `offensive` a + 0,15 b − 0,15, extraits de `vortexProxyOptions`, sortie du
  Vortex inchangée) : `target.ts` en dépend sans tirer le proxy à l'exécution.
- `src/optimizer/stuff/search.ts` : option `seedFilter` et `theorySeedFilter({ level, scenarioTags })` (écarte les
  stuffs `vortex_*` et ceux dont un objet dépasse le niveau) ; un départ INVALIDE n'est plus rendu comme `best` quand
  un candidat valide existe ; `StuffResult.startValid`.
- `src/optimizer/stuff/validate.ts` et appelants (`builds.ts`, halving, CLI `stuff`, rapport) : option `startValid` —
  un départ invalide n'est ni joué ni retenu dans la validation par combats (le moteur refuse un build invalide) ;
  `StuffValidation.startIncluded`.
- `scripts/fetch-dofusdb.mjs`, `scripts/lib/dofusdb-normalize.mjs` : lecture des schémas 3.6 et 3.7 des grades,
  garde-fous (5 résistances par grade de boss, boss témoin), écriture tout ou rien ; `src/data/raw.ts` et `convert.ts`
  lisent les nouveaux champs facultatifs. Données NON ré-extraites (décision de l'utilisateur) ;
  `docs/research/dofusdb-api.md` §10.
- `data/bosses/README.md` et `_template.json` : rôle, schéma et règles de sources des fiches manuelles (aucune fiche
  rédigée).
- CLI (`src/cli/theory.ts` : `bosses`, `boss`, `boss … classes|stuff`, `degats`) et page `#boss`
  (`web/plugins/theory.ts`, `web/src/boss.ts`) : chantiers d'interface conduits à part, qui étendent §2-§3 (options
  `--details`, `--no-overrides`, `--out`, calculateur `degats`, `GET /api/theory/presets`) ; description pour
  l'utilisateur : `docs/theorycraft.md`. Options déclarées par commande (`THEORY_OPTIONS` : une option inconnue est
  une erreur) ; `degats` filtre les lignes par masque de cible comme le DPT (dpt.ts), prend ses coups possibles dans
  `hits.ts` (`possibleHits`, plus de copie locale) et calcule un tableau par jeu de résistances quand une fiche
  manuelle les donne par phase ; `boss --details` donne le coup de chaque sort du boss (mêlée ⇔ PO ≤ 1, convention
  des dégâts reçus) et ses `damageStates`. Page : onglet Boss absent de la version construite, POST acceptés
  seulement en JSON de la page elle-même, effort du classement optimisé plafonné (10 000 itérations) ; mêmes colonnes
  et titres que les rendus texte (facteur « Étal. preset », pic présenté comme une estimation) et, grade imposé, même
  composition que la CLI (`playersForGrade`).

Tests : `tests/theory-{bosses,overrides,profile,target,hits,rotation,stances,utilities,classes,stuff}.test.ts` (12, 9,
27, 9, 7, 12, 5, 17, 26 et 30 cas), `tests/opt-stuff-target.test.ts` (14), `tests/data-fetch-schema.test.ts`,
`tests/data-fetch-script.test.ts` ; CLI et page : `tests/cli-theory.test.ts`, `tests/web-theory.test.ts`,
`tests/web-boss-ui.test.ts`.

### 6.2 Écarts à la conception

- **API pure et analyses séparées (§0.5, §1).** La conception ne prévoyait qu'une API : `index.ts` ne garde que les
  modules purs (index, fiches, fiche du boss) ; `analysis.ts` regroupe ce qui tire le proxy et l'optimiseur. Le
  principe 3 (« aucune dépendance au Vortex ») vaut à la lettre pour les modules purs ; pour `classes.ts` et
  `stuff.ts`, il devient « aucune dépendance DIRECTE, liste des dépendances indirectes figée, cibles toujours
  explicites ».
- **`targetFighter.ts` et `profiles.ts` (§1.4).** Non prévus : extraits de proxy.ts et vortex.ts pour que la cible et
  les combattants hors combat ne tirent pas le proxy (donc le Vortex) à l'exécution. `ROLE_EXPONENTS` vit désormais
  dans `profiles.ts` (ré-exporté par proxy.ts, API inchangée).
- **Combattants hors combat (`fighters.ts`).** Ajouté : la fabrique met `id = -1` à tout combattant ; personnage et
  cible doivent avoir des ids ET des équipes distincts, sinon le masque de cible voit le lanceur lui-même.
- **DPT soutenu (§1.5) : `steady` / `period`.** La moyenne sur 6 tours (`mean`) part d'un début de combat sans relance
  et penche vers la rafale (jusqu'à +2,05 % mesuré : Pandawa Saoul, Sram poisons). La suite des tours ne dépend que
  des relances en cours et des poisons actifs : elle boucle dès qu'un état se répète ; `steady` = moyenne d'une
  période (1 à 5 tours pour les presets de base), indépendante de l'horizon, détaillée par sort (`steadyBySpell`).
  **Toutes les analyses classent sur `steady`.**
- **Coups au contact ou à distance (`hits.ts`, audit final).** Le sac à dos de l'IA range chaque sort d'après sa portée
  max (mêlée ⇔ portée ≤ 1) : un sort de PO 1 à 8 y est « à distance », donc était nul contre le Père Ver (invulnérable
  à distance) et pénalisé par le « −50 % à distance » de Merkator. Le theorycraft suit la règle du jeu (mêlée dès que la
  cible est adjacente) : `TheoryDptTable` évalue un sort lançable des deux façons dans les deux cas et retient le coup
  que la cible subit le mieux (à égalité, le style du personnage) ; les % dommages du lanceur suivent ce coup. Branchée
  sur `sustainedDamage`, l'utilité « mêlée » et le proxy (option `theoryTable`) ; l'IA du Vortex garde sa règle. Plus
  aucun preset de base n'a un DPT nul contre le Père Ver. Règle « au contact » unique (`playsMelee`) pour classes et
  stuff.
- **Poisons et rafale (audit final).** Le sac à dos compte un poison × min(durée, 2) × 0,8 à CHAQUE lancer, sans cumul
  ni recouvrement (Flèche Tyrannique, cumul 1, lancée deux fois par tour : 3,2 échéances par tour au lieu d'une). Le
  DPT soutenu suit désormais les instances actives sur la cible (une échéance par tour, sans critique, 6 au plus ;
  plafond de cumul `maxStack` du niveau qui porte l'effet, 1 s'il retire d'abord ses propres effets) : un lancer vaut
  sa part immédiate plus les échéances qu'il ajoute. Flèche Tyrannique seule = moteur (rejeu) ; Crâ Feu contre
  Harebourg à 15 % du moteur (+58 % avant). La **rafale** (`burst`) devient le premier tour d'un combat (relances et
  poisons actifs ignorés, échéances complètes des poisons posés). Le proxy de l'optimiseur (`perCast`) garde
  l'heuristique.
- **Fiche du boss (§1.2) : approximations ajoutées.** Un seul groupe aléatoire joué par liste d'effets (chaque ligne
  compte pour sa probabilité : Fwetage 640 au lieu de 3 201) ; branches selon la cible regroupées, la plus forte
  retenue (Trahison : ≈ 26 000 → 351 par lancer) ; poisons bornés à 6 tours ; sous-sorts lancés par un ALLIÉ du boss
  non comptés (drapeau `summon`, `allyCasts`) ; effets de dégâts non gérés comptés à 0 et signalés ; détail par sort
  (`BossSpellDetail` : portée, relance initiale, `hpDamageByElement`, `approximations`). Phases aussi déduites des
  états exigés dans les masques des lignes de dégâts (Croqueleur, El Piko), 6 au plus.
- **Fiches manuelles (§1.3).** Schéma livré plus riche que l'esquisse : `sources` en objets `{ url, date, patch }`,
  `patch`, `stats` (caractéristiques imposées, ex. `rangedResPct`), phases avec `vulnerable` (`true`, `false`,
  `"melee"`, `"range"`) au lieu d'`invulnerable`, `adds` sans poids (exposition fixée par `target.ts`), `mechanics` avec
  `counters` / `punishes` ; nom de fichier = id contrôlé. **Aucune fiche rédigée** : la recherche externe de sources
  fiables reste à faire (règles : `data/bosses/README.md`).
- **Postures (§1.4 bis).** Étendues à l'Eliotrope (Portail / Errance selon la variante), au Steamer (Marée Basse /
  Haute) et à l'Ouginak (paliers de Rage ; phases de cycle évaluées mais exclues du choix) ; notes pour les classes
  sans posture tenable (Ecaflip, Xélor, Féca…). Posture supposée tenue tout le combat, changement non compté.
- **Utilités (§1.6) : tours mixtes.** Les axes additionnaient d'abord deux rotations qui dépensaient chacune tous les
  PA (Enutrof 5,5 PM + PA contre Harebourg). `removal.combined` (PM + PA en un budget de PA, meilleure de trois
  rotations, réserves non punies) et `care` (soin + bouclier après l'entretien des réductions et armures) sont les
  valeurs des axes ; les tours consacrés restent affichés. Retraits plafonnés à la réserve résultat par résultat
  (E[min(X + sûrs, réserve)]). `ProxyContext.removedPoints` (profils bruts) n'est pas utilisé.
- **Axes du classement (§1.8).** Livrés : Dégâts (DPT soutenu, rafale, étalonnage affiché), Survie (PVe du stuff seul,
  rangs partagés « =1 »), Contrôle (tour mixte), **Soin** (PV soignés ou préservés UTILES = min(brut, dégâts d'un tour
  du boss sur un personnage), total d'équipe) et **Apport d'équipe** (heuristique décomposée : « dommages subis »,
  Puissance, Dommages, % finaux, PA ; allié de référence de 1 300 de caractéristique + Puissance). L'axe « Soutien »
  de la conception est scindé : soins, boucliers et réductions dans Soin, buffs alliés dans Apport d'équipe. Résistances
  ≥ 100 % sans fiche : DPT « résistances levées » (`resLifted`) affiché et utilisé par la composition si tous les DPT
  sont nuls. Sous le niveau 200 : personnages sans équipement en mode `preset` (signalé) ; en mode `optimized`, stuff
  optimisé depuis ce départ nu avec des graines ≤ niveau (`theorySeedFilter({ level })`).
- **Composition (§1.8).** Règles écrites et seuils exportés (`COMPOSITION_RULES`, `COMPOSITION_THRESHOLDS`) : Dégâts ;
  Soin si un tour du boss retire ≥ 20 % des PV d'un personnage (médiane) et pas d'insoignable ; Protection si
  insoignable (à la place du soin) ou érosion ≥ 20 % (en complément du soigneur) ; Retrait PM si le boss a des PM,
  retrait non puni et ≥ 1 PM retiré ; deuxième dégât (autre élément faible parmi Terre, Feu, Eau et Air, à moins de
  10 points du plus faible des quatre, préféré s'il atteint 85 % du DPT) ; Apport d'équipe ; places restantes ; une
  classe au plus. Chaque membre a sa raison chiffrée, chaque règle écartée une note ; la première règle qui trouve le
  groupe complet le signale et arrête la composition. Taille : `players` de la fiche, sinon `playersForGrade(grade)`.
- **Contrôle moteur (§4) : non implémenté.** Prévu : DPT soutenu contre `measureCalibration` en mini-combat contre
  le BOSS. Livré : seulement le facteur d'étalonnage du preset (`calibrationOf`, `data/ai/calibration.json`, dégâts du
  moteur / sac à dos JOUÉ DANS le moteur, mini-combat contre un Buboxor), affiché à titre **indicatif** (« Étal.
  preset ») : il ne s'applique pas au DPT soutenu hors combat, n'en est ni une correction ni un contrôle, et ne dépend
  pas du boss (`calibrated` reste dans le JSON pour compatibilité ; plus d'avertissement d'écart). Un vrai contrôle
  reste **recommandé** : mesures de l'audit final, ratio moteur / analytique de 0,63 à 1,73 selon le preset,
  corrélation de rang de Spearman 0,67 à 0,88 sur 3 boss, ≈ 15 ms par couple preset × boss.
- **Mode `optimized` des classes (§1.8).** Séquentiel (pas de pool de workers), montée par coordonnées seule par défaut
  (`iterations` 0) : ≈ 18 s pour les 49 presets contre le Père Ver (2026-10-08, après l'audit final). Il n'a PAS le
  classement soutenu de `stuffVsBoss` : le stuff suit l'objectif J du rôle et l'optimiseur ne voit pas les postures
  (Père Ver, DPT soutenu générique → optimisé : `iop_soutien` 2 744 → 1 431, `forgelance_zone_terre` 2 469 → 2 078,
  `zobal_psychopathe` 2 250 → 2 330).
- **Stuff (§1.7).** Réglages mesurés : 30 000 itérations × 2 recherches (et non 3 000 ; sans les graines `vortex_*`,
  le recuit compte : écart moyen au meilleur logJ observé 0,003, ≈ 2,5 s par preset) ; une recherche par élément avec
  `elements: 'all'`. Graines par `theorySeedFilter` (jamais de `vortex_*`), Dofus à sort passif du départ imposés (les
  autres objets à sort passif non : `--fixed`, avertissement s'ils sont retirés),
  candidats re-notés en exact dans un contexte commun avec les stuffs de référence, top DISTINCT (2 objets d'écart).
  **Classement soutenu des classes à posture** : quand, au départ, le DPT soutenu sans posture est sous 1/1,2 de celui
  en meilleure posture, les stuffs sont classés par le logJ soutenu (DPT du proxy remplacé par le DPT soutenu en
  posture) puis affinés (`polishSustained`, montées par coordonnées) — Zobal Psychopathe contre le Père Ver : 464 de
  DPT soutenu avant, 1 577 après (mesure d'origine) ; avec les coups de l'audit final, meilleur stuff à 2 078 pour
  un départ à 2 250 (PVe 5 173 → 9 395). Équivalences calculées dans un contexte du proxy construit AU meilleur stuff,
  part des PA/PM/PO due aux pénalités de l'objectif séparée. Avertissements chiffrés (perte de DPT > 15 %, pénalité qui
  décide seule de l'ordre, PVe plafonnés). Départ invalide jamais présenté comme meilleur (`startValid`).
- **Rendus (§1.9).** `report.ts` est devenu trois modules (`formatBoss.ts`, `formatClasses.ts`, `formatStuff.ts`) ;
  les résultats JSON (`ClassRanking`, `StuffVsBossResult`) servent la CLI (`--json`) et la page web.

### 6.3 Reste ouvert

- Fiches manuelles des boss (aucune) et vérification en jeu (protocole : `docs/theorycraft.md` §6).
- Ré-extraction des données 3.7 (décision de l'utilisateur ; `DATA_SNAPSHOT` et tests épinglés à revoir).
- Classement soutenu dans le mode `optimized` des classes ; contrôle par le moteur contre le boss lui-même
  (recommandé, non implémenté : mesures de l'audit au §6.2, « Contrôle moteur »).
- PA/PM retirés aux personnages par le boss (mécanique `ap-mp-removal`) : seulement signalés (fiche, atouts et
  limites) ; ni déduits du DPT (PA du stuff supposés intacts), ni esquive PA/PM du personnage valorisée par l'objectif.
- Dégâts du boss : pic optimiste sur une cible, mais zones, sorts en réaction, invocations et alliés non comptés ;
  dégâts reçus et règle Soin peuvent être sous-estimés contre un boss à zones ou à invocations (les PVe, un rapport,
  faussés dans un sens ou dans l'autre).
- Hors périmètre v1 inchangé (§5).
