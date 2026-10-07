# Theorycraft contre un boss — conception v1

*Conception du 2026-10-07. Demande de l'utilisateur : usage personnel, PvM uniquement ; répondre à
(1) « quel stuff est le plus intéressant contre un boss donné ? » et (2) « quelles classes sont les plus intéressantes
contre un boss donné ? ». Valeurs par défaut : 4 joueurs (boss de rang 1), niveau 200, les 19 classes, Expéditions
exclues ; tout est réglable. Types partagés : `src/theorycraft/types.ts`.*

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
(Fureur, Combo…) ; IA réelle du boss (le pic par sac à dos est une borne haute) ; positions et ligne de vue.
