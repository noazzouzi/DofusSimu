# Formules de combat Dofus — extraction DoMath + recoupements client

> Document de référence pour le moteur `src/damage` de DofusSimu.
> Rédigé le 2026-10-04. Source principale : **DoMath v1.3.3** (<https://domath.fr>), dont le code a été
> téléchargé, beautifié et **ré-exécuté tel quel** sous node. Recoupements : code client Dofus 2 (AS3
> décompilé), port C# du module de calcul Haxe du client Dofus 3, émulateurs, notes de patch officielles.
> Vecteurs de test : [`data/research/damage-test-vectors.json`](../../data/research/damage-test-vectors.json) (99 cas stricts).
>
> Conventions : `trunc` = troncature vers 0 (`Math.trunc`), `floor` = partie entière inférieure,
> `roundHalfDown(x)` = `-Math.round(-x)` (x.5 arrondi vers le bas). Tout ce qui n'est pas vérifié dans du
> code ou une source officielle est marqué **INCERTAIN** avec une estimation.

---

## 0. TL;DR pour les ingénieurs

1. **Dégâts directs (DoMath `Rg`)** — par jet entier `base` :
   `trunc(base·(1+max(0,puissance+carac)/100))` → `+ do fixes (+ do crit si CC)` (si < 0 → 0) →
   `× efficacité de zone × bonus portail`, `trunc` → `− rés. fixes (+ rés. crit si CC)` (si < 0 → 0) →
   `× (1 − %rés élém/100)`, `trunc` → `× %subis/100`, trunc → `× (100+%finaux)/100`, trunc →
   `× (100+%sorts|%armes)/100`, trunc → `× (100+%distance|%mêlée)/100`, trunc →
   `× (1−%rés sorts|armes/100) × (1−%rés distance|mêlée/100)`, **une seule** trunc.
2. **Neutre et Terre = Force**, Feu = Intelligence, Eau = Chance, Air = Agilité. Puissance s'additionne à la carac.
3. **Critique** : chance = `min(100, max(0, critSort ? critSort + %crit : 0))` (DoMath) ; le jeu impose un plancher de 1 % (patch 2.29) pour les sorts pouvant critiquer, sauf sous **Poisse** (aucun CC) ; l'Agilité n'influe plus (depuis 2.29). Le CC utilise les jets *critiques* du sort + `do crit`, et la cible soustrait `rés. crit`.
4. **% résistances** : plafond **50 % pour un joueur**, pas de plafond monstre côté client D2 (100 côté port D3) ; valeurs négatives illimitées.
5. **Poussée** : `trunc((niv/2 + doPou − rePou + 32) × casesRestantes / (4 × 2^index))`, min 0, index = rang dans la chaîne de collision (0 = cible poussée). Non affecté par stats / % / résistances élémentaires.
6. **Tacle** : `restant = Π min(1, (fuite+2)/(2·(tacle_i+2)))` ; PA/PM restants = `roundHalfDown(PA × restant)`, appliqué case par case (le PM du déplacement est décompté entre deux cases). Fuite/Tacle négatifs → 0. Tacle = agilité/10 + bonus.
7. **Retrait PA/PM** : par point, `P = clamp(10 %, 90 %, (Retrait/Esquive) × (pts restants/pts max) / 2)`, tirages séquentiels (Retrait, Esquive ≥ 1).
8. **Soins (D2)** : `floor(base × (100 + Int)/100) + Soins` (Int ≤ 0 → 1), plafonné aux PV manquants.
9. **Érosion** : 10 % de base, plafond 50 % ; PV max perdus = `floor(dégâts × érosion/100)` calculé sur les dégâts **avant** bouclier.
10. **Vol de vie** = `floor(PV réellement perdus / 2)`.
11. DoMath contient des **artefacts flottants** (ex. `10 × (1 − 0.8) = 1.999… → 1`). Les vecteurs reproduisent DoMath à l'identique et donnent `integerSafeDamage` quand l'arithmétique entière diverge (~0,4 % des couples (r, %rés) ; **~6 % des couples (r, distance de zone)** — cf. §3.4). **Recommandation : implémenter DoMath à l'identique (mode par défaut) et exposer un mode « entiers exacts ».**
12. **Pesanteur** (état 7) : bloque échanges de place/téléportations subis **et** interdit au porteur de lancer ~285 sorts de mobilité (critère `HS!7`, ex. Bond, Transposition) ; ne bloque pas la poussée (§16).

---

## 1. Sources et méthode

| Source | Contenu | Fiabilité |
|---|---|---|
| **DoMath v1.3.3** — `https://domath.fr/static/js/main.e2dd4684.js` (1,4 Mo), worker `806.6ff2731e.chunk.js`, helpers `186.e615cf85.chunk.js` | Calculateur de dégâts, tacle/fuite, simulateur de pièges Sram (mini-moteur : poussée, bouclier, érosion, états, ordres de déclenchement) | Référence demandée par l'utilisateur ; code exécuté tel quel |
| Client **Dofus 2** décompilé (AS3) — [Romain-P/d2gen](https://github.com/Romain-P/d2gen) (`DamageUtil.as`, `TackleUtil.as`, `FightTurnFrame.as`, `StatBuff.as`, `SpellDamageInfo.as`, `EffectDamage.as`), copies Emudofus/scalexm/HadesFR/Alleos13 | Prévisualisation officielle des dégâts/soins/poussée/tacle en 2.x | Code officiel (client), versions 2.5x–2.6x |
| Port C# du module **Haxe** de calcul de dégâts de **Dofus 3** — [OtomAICLIP/otomai](https://github.com/OtomAICLIP/otomai) `libs/Bubble.DamageCalculation/*` (`DamageSender.cs`, `DamageReceiver.cs`, `PushUtils.cs`, `HaxeFighter.cs`, `SpellZone.cs`, `Interval.cs`) | Pipeline Dofus 3 (Unity) | Port tiers d'un code officiel : ordre fiable, quelques bugs de portage repérés (§3.6) |
| Émulateurs : Giny ([Skinz3/Giny.NETCore](https://github.com/Skinz3/Giny.NETCore) `Fighter.cs`), Stump (forks `FightActor.cs`), OtomAI `FightActor.cs` | Retrait PA/PM, armure, tacle côté serveur | Rétro-ingénierie (INCERTAIN par nature) |
| Notes de patch / devblogs | 1.25 (retrait PA/PM), 2.17 (poussée), 2.29 (critiques), devblog « Tacle déterministe » | Officiel |
| DofusDB API (`/characteristics`, `/effects`, `/spell-states`, `/spell-levels`) | Identifiants de caractéristiques/effets, états | Données du jeu |

Tout est en cache sous `.cache/domath/` :
- `main.pretty.js`, `806.pretty.js` (bundles beautifiés), `spell-templates.json` (669 préréglages DoMath pour **503 identifiants de sorts distincts** — variantes « - N boosts » / états ; `{id, name, crit, damageLines}` ; 12 sorts tirés au hasard recoupés avec DofusDB `/spell-levels` dernier grade : jets normaux/critiques et `criticalHitProbability` identiques), `maps-index.json` (437 cartes du simulateur de pièges) + `maps/143393281.json` (**salle du Vortex**), `img/dodge_formula_*.png` (formules affichées par DoMath).
- `extract/build-literal.cjs` : extrait **verbatim** (par tranches de lignes) les fonctions de calcul → `extract/domath-literal.cjs`.
- `extract/worker-runner.cjs` : exécute le Web Worker DoMath dans `node:vm` (distribution exacte des dégâts).
- `extract/gen-vectors.cjs` : génère `data/research/damage-test-vectors.json` (`node .cache/domath/extract/build-literal.cjs && node .cache/domath/extract/gen-vectors.cjs`).
- `d2client/*.as`, `haxe/**/*.cs`, `other/*` : sources de recoupement.

DoMath expose 3 outils (`/calcul-degats`, `/tacle-fuite`, `/pieges`). Les pages « Retrait PA/PM », « Songes infinis » et « Simulateur de bombes » sont annoncées mais **non publiées** (lien vide) : DoMath **ne fournit pas** de formule de retrait, de soin, ni de vraie formule de poussée (cf. §10).

---

## 2. Modèle de données DoMath

### 2.1 Objet `stats` (calculateur) — défauts `Po` (main l.17181), bornes UI `ss` (l.17401)

```
power, strength, intelligence, luck, agility : 0         (UI : -99999..999999)
crit                                         : 0         (% critique, UI -100..100)
damages.fixed     : damages, neutral, earth, fire, water, air, critical : 0   (UI -999..999)
damages.percentage: sustained = 100 (UI 0..9999), final (-100..9999), spell, weapon, range, melee (-100..999)
resistances.fixed : neutral, earth, fire, water, air, critical : 0          (UI -999..999)
resistances.percentage : neutral, earth, fire, water, air (-9999..100), spell, weapon, range, melee
hit.type      : "spell" | "weapon"   (défaut spell)
hit.distance  : "range" | "melee"    (défaut range)
areaDistance  : 0..9  (distance au centre de la zone)
portal.type   : "none" | "normal" ; portal.redirection : 0..999
```
Un sort DoMath = `{name, counter (UI 0..61, défaut 1), crit (crit de base du sort, 0..100), stats, damageLines:[{element, baseDamage:{normal:{min,max}, crit:{min,max}}}]}`.

**Quirk** : la normalisation `Dg` (l.20962) fait `x || défaut` : une valeur **0** saisie pour `damages.percentage.sustained` est remplacée par **100** (vecteur `domath-damage-040`).

### 2.2 Correspondance avec les caractéristiques du jeu (DofusDB `/characteristics`, `/effects`)

| Champ DoMath | Caractéristique Dofus (id) | Effets d'objet (id) | Nature |
|---|---|---|---|
| `power` | Puissance `damagePercent` (25) | 138 / 186 | additive à la carac |
| — | Puissance Sorts `damagePercentSpell` (98) | 1054 | additive (sorts seulement, D3) |
| — | Puissance armes `weaponPower` (103) | — | additive (armes seulement, D3) |
| `strength/intelligence/luck/agility` | 10 / 15 / 13 / 14 | — | additive |
| `damages.fixed.damages` | Dommages `allDamageBonus` (16) | 112 / 145 | fixe |
| `damages.fixed.<élément>` | 88 Terre, 89 Feu, 90 Eau, 91 Air, 92 Neutre | 422/423, 424…, 430/431 | fixe |
| `damages.fixed.critical` | Dommages Critiques (86) | 418 / 419 | fixe, si CC |
| `damages.percentage.final` | % Dommages finaux `dealtDamageMultiplier` (107) | 1171 / 1172 | multiplicatif |
| `damages.percentage.spell` | % Dommages aux sorts `dealtDamageMultiplierSpells` (123) | 2812 / 2813 | multiplicatif |
| `damages.percentage.weapon` | % Dommages d'armes `dealtDamageMultiplierWeapon` (122) | 2808 / 2809 | multiplicatif |
| `damages.percentage.range` / `melee` | 120 / 125 | 2804/2805, 2800/2801 | multiplicatif |
| `damages.percentage.sustained` | Dommages subis ×N % (buff, effet 1163 ; carac 104 `incomingPercentDamageMultiplicator`) | — | multiplicatif (cible) |
| `resistances.fixed.<élément>` | 54 Terre, 55 Feu, 56 Eau, 57 Air, 58 Neutre | 240/245, … 244/249 | fixe |
| `resistances.fixed.critical` | Résistances Critiques (87) | 420 / 421 | fixe, si CC |
| `resistances.percentage.<élément>` | 33 Terre, 34 Feu, 35 Eau, 36 Air, 37 Neutre (+ 101 `resistPercent` « % Résistance » à tout) | 210/215 … 214/219, 1076/1077 | % |
| `resistances.percentage.spell/weapon/range/melee` | 141 / 142 / 121 / 124 (`received…`) | 2814/2815, 2810/2811, 2806/2807, 2802/2803 | % |
| `crit` | % Critique (18) | 115 / 171 | additif à la chance de CC |
| (poussée) | Dommages Poussée (84), Résistances Poussée (85), **% Dommages Poussée (158, nouveau)** | 414/415, 416/417, 2414/2415 | voir §10 |
| (pièges/glyphes/runes) | Puissance Pièges (69), Dommages Pièges (70), Puissance Glyphes (106), Puissance Runes (110) | 226, 225, 1166, 1167 | voir §13 |
| (soins) | Soins (49), % Soins finaux | 178/179, 2971/2972 (DofusDB rattache 2971/2972 à la carac 49, vraisemblablement à tort : plutôt 143 `dealtHealMultiplier` — INCERTAIN) | voir §7 |
| (érosion) | Érosion `permanentDamagePercent` (75), PV érodés courants `curPermanentDamage` (102) | 776 (+% Érosion), 3804 (−% Érosion) ; 3805-3808 (± PV érodés fixes / %) — DofusDB rattache 3804-3808 à la carac 75 | voir §9 |
| (renvoi) | Renvoi (50) | 220 | voir §11 |
| (tacle) | Fuite (78), Tacle (79) | 752/754, 753/755 | voir §14 |
| (retrait) | Retrait PA/PM (82/83), Esquive PA/PM (27/28) | 410-413, 160-163 | voir §15 |

> Côté client Dofus 3, les caractéristiques multiplicatives 107/120-125/141/142 valent « 100 + % » (ex. +18 % dommages aux sorts → 118) et sont appliquées par `× valeur/100` (cf. §3.5). Pour les résistances « reçues » (121/124/141/142), **INCERTAIN** : vraisemblablement `100 − %rés`.
>
> Sens bonus/malus des effets 28xx (DofusDB `bonusType`) : dommages 2800/2804/2808/2812 = bonus, 2801/2805/2809/2813 = malus ; résistances **inversées** : 2803/2807/2811/2815 = bonus, 2802/2806/2810/2814 = malus.
>
> DofusDB expose aussi des caractéristiques « % de carac » (126-139 : Agilité %, Force %, Chance %, Intelligence %, Vitalité %, Sagesse %, Tacle %, Fuite %, PA %, PM %, Retrait PA/PM %, Esquive PA/PM %) : leur formule d'application n'est couverte ni par DoMath ni par les sources ci-dessus — **INCERTAIN** (probablement `base × (100 + x)/100`), à traiter dans l'agrégateur de stats.

### 2.3 Effets de dégâts (actions, DofusDB `/effects`)

96 Eau, 97 Terre, 98 Air, 99 Feu, 100 Neutre (dégâts boostables) ; 91-95 vol de vie (Eau/Terre/Air/Feu/Neutre), 2828 vol meilleur élément ; 144 (Neutre) & 1063-1066 (Terre/Air/Eau/Feu) « dommages (fixe) » **non boostés** ; 80 dommages de poussée (description vide dans DofusDB ; `ACTION_CHARACTER_LIFE_POINTS_LOST_FROM_PUSH`) ; 81 soins (sans élément), 108 soins Feu ; **85-89** dégâts en % des PV **du lanceur** (Eau/Terre/Air/Feu/Neutre) — **90 n'est pas un dégât** (« Transfère X % des PV », `DISPATCH_LIFE_POINTS_PERCENT`) ; **1067-1071** dégâts en % des PV **de la cible** ; **1092-1096** dégâts en % des PV érodés **de la cible** (Neutre/Air/Feu/Eau/Terre ; AS3 `EROSION_DAMAGE_EFFECTS_IDS`) ; **1118-1122** dégâts en % des PV érodés **du lanceur** ; 1123 % des dommages initiaux subis (splash) ; 105/265 réduction de dommages (armure) ; 107 renvoi ; 1039 bouclier % PV max, 1040 bouclier fixe ; 1163 « Dommages subis ×N % » ; 5 repousse, 6 attire ; 101/168 −PA, 127/169 −PM.

Jet d'un effet (DofusDB `spell-levels[].effects[]`) : `min = diceNum` (si `diceNum = diceSide = 0` → `value`), `max = diceSide ≠ 0 ? diceSide : min` (port D3 `HaxeSpellEffect.GetEffectMinRoll/MaxRoll`). Les jets critiques sont dans `criticalEffect[]`. La chance de CC de base est `spell-levels[].criticalHitProbability`. La zone est dans `zoneDescr {shape (code ASCII, 80='P'), param1, param2, damageDecreaseStepPercent (défaut 10), maxDamageDecreaseApplyCount (défaut 4)}`.

---

## 3. Dégâts directs (sorts et armes)

### 3.1 Code DoMath verbatim — `Rg` (main.e2dd4684.js beautifié l.21058-21076)

```js
Rg = function(e, t, n, a) {          // e = stats normalisées (Dg), t = jet de base, n = élément, a = critique ?
  var r = 0,
    i = 1 - e.areaDistance * (e.hit.type === Lo.SPELL ? .1 : .25),
    o = 1 + (e.portal.type === wo.NORMAL && e.portal.redirection > 0 ? 0 + .02 * e.portal.redirection : 0);
  return 0 === t ? 0 : (r += t + t * Math.max(0, e.power + e[function(e) {
    switch (e) {
      case Do.NEUTRAL, Do.EARTH: return jo.STRENGTH;   // (opérateur virgule : seul EARTH est testé ; NEUTRAL tombe dans default = STRENGTH)
      case Do.FIRE:  return jo.INTELLIGENCE;
      case Do.WATER: return jo.LUCK;
      case Do.AIR:   return jo.AGILITY;
      default:       return jo.STRENGTH
    }
  }(n)]) / 100, r = Math.trunc(r), (r += e.damages.fixed[n] + e.damages.fixed.damages + (a ? e.damages.fixed.critical : 0)) < 0 ? 0 :
  (r *= i, r *= o, r = Math.trunc(r), (r -= e.resistances.fixed[n] + (a ? e.resistances.fixed.critical : 0)) < 0 ? 0 :
  (r *= 1 - e.resistances.percentage[n] / 100, r = Math.trunc(r),
   r *= e.damages.percentage.sustained, r = Math.trunc(r / 100),
   r *= 100 + e.damages.percentage.final, r = Math.trunc(r / 100),
   r *= 100 + e.damages.percentage[e.hit.type], r = Math.trunc(r / 100),
   r *= 100 + e.damages.percentage[e.hit.distance], r = Math.trunc(r / 100),
   r *= 1 - e.resistances.percentage[e.hit.type] / 100,
   r *= 1 - e.resistances.percentage[e.hit.distance] / 100, r = Math.trunc(r))))
}
```
Copie identique dans le worker (`806.pretty.js` l.3068 `fe`).

### 3.2 Pseudo-code (ordre exact, arrondis exacts)

```
fonction degatsJet(stats, base, element, estCritique):           # base = jet entier (ou réel en mode « moyen » du simu pièges)
  si base == 0 : retourner 0
  carac = {neutral:force, earth:force, fire:intelligence, water:chance, air:agilite}[element]
  r = trunc(base + base * max(0, puissance + carac) / 100)                     # (1) stats
  r = r + doFixe[element] + doFixe.dommages + (estCritique ? doFixe.critiques : 0)   # (2) fixes
  si r < 0 : retourner 0
  facteurZone   = 1 - distanceAuCentre * (type == sort ? 0.10 : 0.25)          # (3) zone (DoMath : pas de plafond de paliers)
  facteurPortail= 1 + (portail == normal et redirection > 0 ? 0.02 * redirection : 0)
  r = trunc(r * facteurZone * facteurPortail)        # NB : deux multiplications flottantes successives puis UNE trunc
  r = r - resFixe[element] - (estCritique ? resFixe.critiques : 0)             # (4) résistances fixes
  si r < 0 : retourner 0
  r = trunc(r * (1 - resPct[element]/100))                                      # (5) % résistance élémentaire
  r = trunc(r * subis / 100)                                                   # (6) % dommages subis (défaut 100)
  r = trunc(r * (100 + finaux) / 100)                                          # (7) % dommages finaux
  r = trunc(r * (100 + pctDo[type]) / 100)                                     # (8) % dommages sorts | armes
  r = trunc(r * (100 + pctDo[distance]) / 100)                                 # (9) % dommages distance | mêlée
  r = trunc(r * (1 - resPct[type]/100) * (1 - resPct[distance]/100))           # (10) % rés. sorts|armes × distance|mêlée
  retourner r
```
Remarques :
- Seule la somme `puissance + carac` est bornée à 0 ; une puissance négative ne peut pas faire descendre le multiplicateur sous ×1 (même règle dans le client D2 : `if (stat + statBonus <= 0) stat = statBonus = 0`).
- Les « clamp à 0 » n'existent qu'après (2) et (4). Après, il n'y a **plus de clamp** : une %rés > 100 (hors bornes UI, max 100) donnerait des dégâts **négatifs** (ex. r = 10, rés 120 % → `trunc(10 × −0.2)` = −2 ; seuls les petits résultats tombent à `-0`) ; un `% dommages finaux/sorts/…` = −100 (borne UI) donne 0. Le moteur doit borner le résultat final à `max(0, r)` (le client D3 fait `MinimizeBy(0)` juste après la %rés).
- Étapes (6)-(9) : `trunc(r × k / 100)` avec `r × k` entier → **exact**. Étapes (3), (5), (10) : multiplication par un facteur décimal → **artefacts flottants** possibles (§3.4).
- Le jet est tronqué une seule fois pour les stats (`base + base×X/100` ; test exhaustif base ≤ 300, X ≤ 3000 : aucun écart avec `floor(base×(100+X)/100)`).

### 3.3 Min / max / cumul / distribution / critique

- `Mg` (l.21046) : pour une ligne, `normal.min = Rg(stats, jet.normal.min, élément, false)`, idem `max`, et `crit.min/max = Rg(stats, jet.crit.min/max, élément, true)`. `jg` (l.21021) somme les lignes d'un sort. Le composant résultat (`nx`, l.32540) multiplie min/max par `counter` (nombre de lancers) puis somme les sorts.
- **Distribution exacte** (worker `806`, l.3138-3216) : pour chaque lancer, chaque ligne a des jets **uniformes** sur les entiers `[min, max]` (proba `1/(max−min+1)`), les lignes sont convoluées (`ve`), puis mélange `P(normal) = 1 − c`, `P(crit) = c` avec
  ```
  c = min(100, max(0, sort.crit ? sort.crit + stats.crit : 0)) / 100
  ```
  Les lancers (`counter`) sont des variables indépendantes convoluées. Sorties : courbe « ~x dégâts » (fenêtre ±2,5 % de l'étendue) et courbe décroissante `P(X ≥ x)`.
- ⇒ **Dégât moyen** d'un sort = `(1−c)·E[normal] + c·E[crit]`, l'espérance étant prise **sur les jets entiers** (moyenne des `Rg(jet)`), pas `Rg(jet moyen)`. Vecteurs `domath-distribution-*`.
- Patch 2.29 (28 avril 2015, [JOL](https://dofus.jeuxonline.info/actualite/47963/evolution-systeme-coups-critiques)) : la chance de CC est **additive** (`critSort % + bonus %`), l'Agilité n'a plus d'effet, plus de plafond à 50 %, **plancher de 1 %** « si le sort ou l'arme utilisé peut occasionner un coup critique » (non implémenté par DoMath). Un sort dont `criticalHitProbability = 0` ne peut pas critiquer (DoMath : `t.crit ? … : 0`). **Exception au plancher** : l'effet « minimise les effets aléatoires » (**Poisse**, carac 76 `unlucky`) empêche **tout** coup critique (même article JOL).
- Dofus 2/3 : les dommages critiques (86) ne s'appliquent qu'aux **effets critiques** (effets de `criticalEffect[]`), et pas aux sorts déclenchés (AS3 : `casterCriticalDamageBonus = !triggeredSpell ? bonus : 0`). Arme : jet critique = jet normal + `criticalHitBonus` de l'arme (AS3 `spellWeaponCriticalBonus`, port D3 `spell.CriticalHitBonus` ajouté aux fixes).
- Effets spéciaux (port D3) : **Poisse** (76) → jets toujours au minimum **et aucun coup critique** (patch 2.29) ; **« Maximise les effets aléatoires »** (77, sur la cible) → jets au maximum ; élément « meilleur » (6) / « pire » (7) = élément de carac la plus haute/basse, départage par les dommages fixes élémentaires.

### 3.4 Artefacts flottants de DoMath (à connaître)

| Étape | Exemple | DoMath | Entiers exacts |
|---|---|---|---|
| (5) % rés | `r=10`, rés 80 % → `10 × 0.19999999999999996` | 1 | 2 |
| (3) zone | `r=90`, distance 3 → `1 − 3×0.1` = double `0.7` (≈ 0.69999999999999996), `90 × 0.7 = 62.99999999999999` | 62 | 63 |
| (3) portail | `r=25`, redirection 8 → `25 × 1.16 = 28.999999999999996` | 28 | 29 |
| érosion (simu pièges) | `floor(v × (e/100))` | ex. 47 écarts / 153 000 | `floor(v×e/100)` |

Balayages (reproduits par `gen-vectors.cjs`, `meta.globalChecks`) :
- %rés élémentaire, `r ∈ [1,2000]`, `rés ∈ [−100,100]` : **1653 / 402 000** écarts (0,41 %) ;
- **zone (sort)**, `r ∈ [1,2000]`, distance 0..9 : **1234 / 20 000** écarts (**6,2 %**) — l'étape la plus touchée ;
- portail, redirection 1..50 : 216 / 100 000 ;
- érosion du simulateur de pièges (érosion 0..50 %) : 47 / 153 000.

Le port C# du client Dofus 3 calcule aussi `floor(r × (1 − rés/100d))` en double → **mêmes artefacts** à cette étape, et **davantage** ailleurs : ses multiplicateurs `× valeur/100d` (sorts, distance, finaux…) sont flottants (`Interval.Multiply` = `floor(x × double)`, ex. `floor(100 × 1.15) = 114`), et le multiplicateur de stats est calculé en **simple précision** (`(100 + X) × 0.01f`, `DamageSender.ApplyDamageBonus`) : 23 559 / 900 300 écarts (2,6 %) vs `floor(jet×(100+X)/100)` (ex. jet 100, X = 1 → 100 au lieu de 101). Ce `0.01f` est probablement un choix du portage (le `Float` Haxe est un double) — **INCERTAIN**, ne pas reproduire. Le client D2 (AS3) calcule en entiers (`dmg × (100−rés) / 100`) → pas d'artefact sur la %rés. Le comportement serveur est **INCERTAIN**. Les vecteurs donnent la valeur DoMath (`expected.damage`) et, si différente, `expected.integerSafeDamage`.

### 3.5 Ordre d'application côté client (pour comparaison)

**Client Dofus 2 (AS3 `DamageUtil.getDamage`, l.2604-2617 ; multiplicateurs l.1394-1402 et 1655-1727)** :
```
stat = carac + puissance + bonusDéclenché + (arme ? maîtriseArme(31) : bonusSorts) ; si stat+bonusStat <= 0 → 0
base = base + bonusBaseSort
dmg  = base > 0 ? floor(base*(100+stat+bonusStat)/100) + doÉlément + doFixes : 0
dmg  = int((dmg + bonusDoSort) * efficacité%/100)                 # zone × portails
dmg  = max(0, dmg - (résFixeÉlém [+ résCrit si CC]))
dmg  = int(dmg * (100 - min(rés%, 50 si joueur)) / 100)
... puis multiplicateurs de buffs (×int(m*100)/100), boost/déboost de dommages %, multiplicateur d'arme,
puis finalDamageMultiplier = (mêlée|distance : (1+do%lanceur/100)×(reçu%cible/100)) × (sort|arme : idem), troncature int
```
Distance pour mêlée/distance : `distance < 2` ⇒ mêlée (distance lanceur→cible corrigée des effets « se repousse/s'attire »).

**Client Dofus 3 (port C# du module Haxe — `DamageSender.GetBoostableDamage` puis `DamageReceiver.ReceiveDamage/ApplyDealtMultiplier`)** :
```
r = base + bonusBaseSort                                               (BoostSpellBaseDmg)
r = floor(r * (100 + max(0, Puissance(25) + caracÉlément + [arme ? PuissanceArme(103) : PuissanceSorts(98) + modSort]
                       + [piège ? PuissancePièges(69)] + [glyphe ? PuissanceGlyphes(106)] + [rune ? PuissanceRunes(110)])) / 100)
       # soin : Puissance(25) n'est PAS ajoutée
       # NB port C# : le facteur est calculé (100+X)*0.01f en float32 (artefacts, §3.4)
r = r + Dommages(16) [soin : Soins(49)] + [piège ? DommagesPièges(70)] + doÉlément + [effet critique ? doCrit(86) + bonusCritArme] + modSort
si arme : r = floor(r * (100 + MaîtriseArme(31)) / 100)
r = floor(r * (1 + bonusComboBombe(94)/100))
r = floor(r * efficacitéZone * bonusPortail)          (HandleAoeMalus)
--- cible ---
r = r - (résFixeÉlém + [effet critique ? résCrit(87)])
r = r - réductionArmure                                (buffs « dommages reçus » 105/265, × (1 + niveau/20))
renvoi éventuel (§11)
r = max(0, floor(r * (1 - min(rés%Élém + rés%Tout(101), 50 joueur | 100 monstre)/100)))
partage de dégâts éventuel
r = floor(r * DoSorts|DoArmes(123|122)/100) ; r = floor(r * DoMêlée|DoDistance(125|120)/100)
r = floor(r * RésReçueSorts|Armes(141|142)/100) ; r = floor(r * RésReçueMêlée|Distance(124|121)/100)
r = floor(r * DommagesFinaux(107)/100)
r = floor(r * multiplicateurDégâtsSubis/100)           (buffs 1163 « Dommages subis ×N % », produit tronqué entier)
```
(mêlée = lanceur ≠ cible et cases adjacentes au moment de l'effet — `DamageCalculator.cs` l.488.)
Les multiplicateurs lanceur/cible 120-125/141/142/107 ne sont appliqués que si l'effet est « boostable » (`ActionIdHelper.IsBoostable`) : **ni** la poussée (80), **ni** les dégâts fixes non boostés (82, 144, 1063-1066), **ni** les dégâts basés sur les PV (lanceur/cible) ou splash. Pour ceux-là, seul le multiplicateur « dommages subis » (1163) s'applique (si le buff est instantané ou déclenché par ce type de dégât).

### 3.6 Différences DoMath ↔ clients et recommandation

| Point | DoMath | Client D2 | Client D3 (port) |
|---|---|---|---|
| Position de « dommages subis » | juste après %rés élém., avant finaux | multiplicateurs de buffs avant les % sorts/distance | **en dernier** |
| Position de « dommages finaux » | avant % sorts/distance | (boost % lanceur) | après sorts/distance |
| % rés sorts/armes × distance/mêlée | une seule troncature pour les deux | produit unique | une troncature par facteur |
| Plafond 50 % rés joueur | **non** (saisie libre) | oui | oui (100 monstre) |
| Plafond de paliers de zone | non (0..9 cases saisis) | 4 paliers, 10 %/case par défaut (donnée de zone) | idem |
| Dégressivité arme | 25 %/case codé en dur | selon zone | selon zone |
| Plancher CC 1 % | non | ? | ? |
| Artefacts flottants | oui (%rés, zone, portail) | non (%rés entière) | oui, plus nombreux (multiplicateurs en double, stats en float32 dans le port) |
| Lanceur qui se frappe lui-même | distance 0 ⇒ **mêlée** (simu pièges `y <= 1`) | `damageDistance < 2` ⇒ mêlée (cas lanceur = cible non vérifié) | lanceur = cible ⇒ **distance** |
| Distance de dégressivité | Manhattan (Chebyshev pour carré/diagonale/étoile) | selon la forme | selon la forme (voir ci-dessous) |

Écarts numériques constatés : en général 0 à 1 point (ex. build complet niveau 200 : DoMath 614 vs ordre D3 613 — section `informative` des vecteurs). Le port D3 contient des bugs de portage (`GetCurrentReceivedDamageMultiplierMelee` lit `DealtDamageMultiplierSpells` pour la distance ; `GetDynamicalDamageReflect` n'accumule pas le renvoi boosté) : ne pas le suivre aveuglément.
**Recommandation** : implémenter `Rg` à l'identique (référence utilisateur), appliquer en amont les plafonds de résistances du jeu (50 % joueur) et la dégressivité de zone issue des données (`damageDecreaseStepPercent`, `maxDamageDecreaseApplyCount`) en calculant `areaDistance` effective = `min(max(dist − rayonMin, 0), paliers)` et le pas réel ; garder un drapeau `orderMode: "domath" | "dofus3"`.

**Distance utilisée pour la dégressivité (port D3 `SpellZone.GetAoeMalus`, l.1439-1511 ; D2 `getSimpleEfficiency`)** — elle dépend de la forme `zoneDescr.shape` (code ASCII) :
- `G`, `R`, `W` (carrés / anneaux carrés) : Chebyshev `max(|dx|, |dy|)` ;
- `#`, `+`, `-`, `/`, `U` (formes diagonales / demi-cercle) : `distanceManhattan >> 1` (division entière par 2) ;
- `;`, `A`, `a`, `I` (toute la carte, etc.) : distance 0 ⇒ **pas de dégressivité** ;
- `F`, `V` (fourche, cône) : distance projetée selon la direction lanceur→cellule ciblée ;
- autres (dont `C` cercle, `X` croix, `L` ligne, `T`, `P`) : Manhattan.
Puis `d = max(d − rayonMin, 0)` (sauf `R` : rayonMin ignoré), `malus% = min(min(d, paliers) × pas, 100)`, efficacité `= (100 − malus)/100` ; aucune dégressivité si `rayon > 50` (D3) ou taille ≥ 50 / distance > taille (D2). Défauts : pas 10 %, 4 paliers.

**Portails (Éliotrope)** : client D2 `getPortalsSpellEfficiencyBonus` → `coeff = 1 + (bonusPortail + 2 × Σ distances entre portails successifs) / 100`, `bonusPortail` = max des `parameter2` des sorts de portail. Le champ DoMath « Redirection » (× 2 %) correspond donc à la **distance parcourue entre portails** (en cases), sans le bonus de base du portail. **INCERTAIN** pour Dofus 3 (le port appelle `GetPortalBonus`, non inclus dans le cache).

---

## 4. Résistances

- `% rés` élémentaire : joueur plafonné à **50 %** (AS3 `if(!targetIsMonster) resistPercent = min(resistPercent, 50)` ; port D3 `MaxResistHuman = 50`). Monstre : pas de plafond (AS3) / 100 (D3). Aucun plancher (une rés. négative augmente les dégâts). D3 ajoute `resistPercent` (101, « % Résistance » à tous les éléments) **avant** plafonnement.
- Résistances fixes élémentaires soustraites **avant** les % (DoMath, D2, D3). Résistances critiques (87) soustraites en même temps que les fixes, uniquement sur coup critique.
- `% rés sorts/armes/mêlée/distance` (141/142/124/121) : multiplicatifs, après tout le reste (DoMath) ; ils ne sont pas plafonnés.
- **Dégâts de poussée** (80) : ni rés. fixes, ni % rés., ni armure (§10 ; port D3 : le bloc rés./armure de `ReceiveDamage` est sauté si `IsCollision`).
- **Dégâts « fixes » non boostés** (144, 1063-1066, vol fixe 82) : ni carac, ni puissance, ni dommages fixes du lanceur, mais **rés. élémentaires fixes et % appliquées** (AS3 : `getDamage` avec `pIgnoreCasterStats`). Port D3 : `IsBoostable = false` ⇒ ni les % sorts/mêlée/distance/finaux du lanceur, ni les % rés. sorts/mêlée/distance de la cible ; seul « dommages subis » (1163) s'applique. Client D2 : la boucle des multiplicateurs finaux (l.1690-1727) ne les exclut pas (seuls la poussée et les dégâts basés sur les PV le sont) — divergence D2/D3, **INCERTAIN** côté serveur.

---

## 5. Multiplicateurs « finaux » (lanceur / cible)

- `% Dommages finaux` (107, effets 1171/1172) : multiplicateur du lanceur appliqué à tous ses dégâts boostables (DoMath : étape 7).
- `% Dommages aux sorts / d'armes / mêlée / distance` (123/122/125/120) : multiplicatifs du lanceur. DoMath : `(100 + x)`.
- `% Dommages subis` (1163) : multiplicateur de la cible (DoMath `sustained`, défaut 100 ; ex. Vulnérabilité). Port D3 : produit des buffs `CharacterMultiplyReceivedDamage` tronqué à chaque buff : `m = (int)(m × param1 × 0.01)`.
- Nouveau D3 : `allDamageMultiplier` (150, « Multiplicateur sur tous les dégâts ») — aucun effet d'objet associé dans DofusDB ; **INCERTAIN** (probablement identique à 107).
- Client D2 : les dégâts basés sur les PV — listes AS3 `HP_BASED_DAMAGE_EFFECTS_IDS` = [672, 85-90], `TARGET_HP_BASED_DAMAGE_EFFECTS_IDS` = [1067-1071, 1048], `ERODED_HP_BASED_DAMAGE_EFFETS_IDS` = [1118-1122] — ne reçoivent **que** les multiplicateurs « reçus » de la cible (l.1690-1698), pas ceux du lanceur ; les dégâts en % des PV érodés **de la cible** (1092-1096, `EROSION_DAMAGE_EFFECTS_IDS`) ne sont pas dans ces listes et reçoivent tous les multiplicateurs. Port D3 : tous ces effets (PV lanceur, PV cible, PV érodés lanceur/cible, splash) sont non « boostables » ⇒ seul « dommages subis » (1163) s'applique — divergence D2/D3, **INCERTAIN**.

---

## 6. Coups critiques — récapitulatif

```
chanceCC% = critBaseSort == 0 ou Poisse ? 0 : clamp(1, 100, critBaseSort + %Critique)   # jeu (patch 2.29)
                                                           # DoMath : clamp(0, 100), 0 si critBaseSort = 0, pas de Poisse
si CC : jets = jets critiques du sort (criticalEffect) ; + Dommages Critiques ; cible − Résistances Critiques
arme  : jet CC = jet + bonusCritiqueArme (si > 0) ; maîtrise d'arme (31) multiplie (D3 : × (100+31)/100 après les fixes)
```
Il n'y a plus d'échec critique en Dofus 2.x/3 (carac 39 « Echec critique » héritée, sans effet observé — INCERTAIN).

---

## 7. Soins

- **Client D2** (`DamageUtil.getHeal`, l.2619) :
  ```
  int = (Intelligence <= 0) ? 1 : Intelligence (+ maîtrise si arme)
  soin = floor(base * (100 + int) / 100) + (base > 0 ? Soins : 0)
  soin critique : jets critiques du sort (arme : base + bonus critique arme)
  soin final = min(soin × efficacitéZone, PV max − PV actuels de la cible)
  ```
  La Puissance (25) **n'augmente pas** les soins (D2 et D3).
- **Client D3 (port Haxe)** : `soin = floor((base + bonusBase) × (100 + Int (ou carac de l'élément du soin) + PuissanceSorts(98) + modSort)/100) + Soins(49) [+ DommagesPièges si piège]`, puis `× multiplicateurDeSoinsInfligés(143)/100` (floor), plafonné aux PV manquants ; état « Insoignable » (`HasStateEffect(5)`) annule. D3 introduit des **soins élémentaires** (`CharacterLifePointsWinFrom{Water,Earth,Air,Neutral,BestElement}`) boostés par la carac de l'élément. **INCERTAIN** : effet des « % Soins finaux » (2971/2972) — vraisemblablement le multiplicateur 143. **Attention (port)** : pour le soin sans élément (81), `ElementsHelper` renvoie l'élément 5 (« aucun »), que `HaxeFighter.GetElementMainStat(5)` interprète comme « meilleur élément » (ids 5/6 = meilleur/pire dans cette fonction, mais 6/7 dans `ElementsHelper`) : incohérence de portage ; retenir l'**Intelligence** (D2 `getHeal`) pour 81/108 sauf preuve contraire. La cible applique aussi `incomingPercentHealMultiplicator` (carac 105) — non couvert ici, **INCERTAIN**.
- Vol de vie : `soin = floor(PV réellement perdus / 2)` (DoMath piège `Math.floor(E/2)` ; D3 `LifeStealMultiplicator = 0.5` + floor ; D2 `int(min(PV cible, dégâts)/2)`), plafonné aux PV manquants du lanceur.
- Soin « X % des derniers dégâts subis » (DoMath `HEAL_LAST_DAMAGE`) : `floor(X/100 × dernierDégât)`.
- Soins en % des PV max de la cible (`CharacterBoostVitalityPercent` & co., port D3 `GetTotalHealBonus`) : `floor(PVmax × X/100)`.

---

## 8. Bouclier

- Le bouclier (96) absorbe les dégâts **avant** les PV : `perte = max(0, dmg − bouclier)`, `bouclier = max(0, bouclier − dmg)` (DoMath HT l.41108 ; D3 `ApplyDamage` utilise `PV + bouclier` pour la mort).
- **L'érosion est calculée sur les dégâts totaux, bouclier compris** (DoMath : `maxHealth -= floor(realValue × érosion/100)` avec la valeur avant bouclier ; D2 : érosion sur les dégâts après résistances). Vecteurs `domath-trap-apply-002/003`.
- Gains de bouclier (port D3 `GetTotalShield`) : fixe (1040) = jet ; `% PV max du lanceur` (1039) = `floor(PVmax × X/100)` ; `% niveau du lanceur` = `round_half_away(niveau × X / 100)`.
- Les dégâts de poussée frappent aussi le bouclier (INCERTAIN : comportement standard des dégâts non élémentaires).

---

## 9. Érosion

```
érosion% = min(50, 10 + bonusÉrosion)                     # AS3 l.2407 ; D3 GetPermanentDamage : floor(max(0, min(carac75, 50)))/100
PVmaxPerdus = floor(dégâts × érosion% / 100)              # DoMath ; D3 plafonne à (PV actuels − 1)
PV = min(PV, PVmax)
```
Les PV érodés sont soignables uniquement par des effets dédiés (« PV érodés », 3805-3808). Les sorts « % PV érodés » utilisent `PVmaxBase − PVmax` **de la cible** (1092-1096 ; AS3 : `(PV érodés de la cible + érosion du sort en cours) × % / 100`) ou **du lanceur** (1118-1122).
Note : la formule DoMath `floor(v × (e/100))` a de rares artefacts flottants (47 / 153 000, §3.4) ; le client D2 calcule `floor(e × v / 100)` en entiers.

---

## 10. Dommages de poussée (collision)

### 10.1 Formule officielle (patch 2.17, [Millenium](https://www.millenium.org/news/141219.html)) et code client

```
dégâts(index) = trunc( (niveauLanceur/2 + (DoPou_lanceur − RePou_cible) + 32) × casesRestantes / (4 × 2^index) )   ; min 0
```
- `casesRestantes` = force de poussée non consommée quand la cible est bloquée (obstacle, entité, bord). Pour une poussée en direction « cardinale » de la grille (déplacement d'une case = 2 de distance), le jeu divise la distance par 2 (`ceil(d/2)` cases) puis **remultiplie par 2** les cases restantes pour le calcul des dégâts (D3 `PushUtils.Drag` / `ApplyCollisionDamage` ; D2 `finalForce = (direction & 1) == 0 ? force × 2 : force`).
- `index` : 0 pour l'entité poussée ; 1, 2, … pour chaque entité **percutée en chaîne** derrière elle (chacune reçoit la moitié de la précédente, recalculée avec **ses** résistances poussée). La chaîne s'arrête quand `force` collatérale est épuisée (D3 `GetCollateralTargets` : une entité de plus par case de force restante).
- Niveau : si le lanceur est une invocation, niveau de l'invocateur (D3 `GetCollisionDamage`) ; le bonus DoPou est celui du lanceur lui-même. **INCERTAIN** pour les bombes Roublard / tourelles Steamer (le port D3 substitue l'invocateur comme lanceur dans `ApplyCollisionDamage`, mais la variable n'est pas réutilisée).
- Arrondi : client D2 `int((niv/2 + …) × f / (4·2^i))` (niv/2 réel) ; port D3 `floor(niv/2)` puis division entière. Divergence possible pour les niveaux impairs (vecteur `client-push-damage-007` : 263 vs 262).
- Les dommages de poussée **ne sont pas boostables** : ni carac, ni puissance, ni % dommages, ni dommages finaux, ni rés. élémentaires, ni armure (`IsBoostable(80) = false` ; `ReceiveDamage` saute le bloc rés. fixes/armure/renvoi/%rés si `IsCollision`). Seuls les multiplicateurs « dommages subis » (1163) de la cible s'appliquent, **et seulement** si le buff est instantané ou porte un déclencheur de poussée (`PD`, `PMD`… — `HaxeBuff.ShouldBeTriggeredOnTargetDamage`), ainsi que l'invulnérabilité à la poussée (`IsInvulnerablePush`). Client D2 : la poussée est exclue des multiplicateurs de buffs et finaux (`BUMP_DAMAGE`).
- Critique : le client D2 calcule un dégât de poussée « critique » avec `casterCriticalPushDamageBonus`, qui vaut **la même somme** que `casterPushDamageBonus` hors buffs spécifiques (`SpellDamageInfo.as` l.594-595) ⇒ en pratique identique.
- Interruption : une poussée s'arrête sur la case d'un piège déclenché (DoMath `KT` : `c = u + 1; break` dès qu'un piège se déclenche) ; il n'y a alors pas de dégâts de collision pour le reste de la force.
- Nouveau D3 : `% Dommages Poussée` (158, effets 2414/2415) — **INCERTAIN** : probablement `× (100 + x)/100` sur le résultat.
- Une entité « Indéplaçable » (état `cantBePushed`), « Enraciné », « Inébranlable » ne bouge pas et ne subit pas de dégâts de poussée (DoMath KT l.41228 : pas de mouvement ⇒ pas de PUSH_DAMAGE). **Pesanteur ne bloque pas la poussée** (§16).

### 10.2 DoMath

Le simulateur de pièges calcule les déplacements (`KT`, l.41215) : directions diagonales du losange = 1 case/point, directions cardinales = `ceil(n/2)` ; à la collision il crée une action `PUSH_DAMAGE` dont `value = realValue = casesRestantes` (`l ? 2·(c−u) : c−u`) — **ce n'est pas une valeur de dégâts** (placeholder ; les dégâts de poussée ne sont pas modélisés par DoMath v1.3.3). **Mais** la barre de vie du simulateur (`uj`, l.42511-42522) traite bien `DAMAGE_PUSH` comme des dégâts : elle retire ce nombre de cases aux PV (après bouclier) et applique l'érosion dessus — l'affichage des PV DoMath est donc faux dès qu'il y a collision. Il ne faut pas reprendre DoMath pour la poussée. Seules les poussées (`direction.value > 0`) génèrent `PUSH_DAMAGE`, pas les attirances.

---

## 11. Renvoi de dommages

- Valeur de renvoi = renvoi fixe (carac 50 / grade de monstre `damageReflect`) + buffs non boostés (107 « unboosted ») + buffs boostés × `(niveau/20 + 1)` (AS3 `int(value × (casterLevel/20 + 1))`).
- Dégâts renvoyés = `min(dégâts subis par le renvoyeur après rés. fixes et AVANT % rés, valeurRenvoi)` (AS3 l.1434-1439 ; D3 `ReflectDamage` : `min(dmg, renvoi)` puis `min(ce résultat, dmg × (1 − %rés renvoyeur))`).
- Ils sont ensuite infligés au lanceur sans ses stats offensives, en tenant compte de **ses % résistances** mais pas de ses rés. fixes (AS3 `computeDamageWithoutResistsBoosts(..., ignoreCasterStats, ignoreFixedReduction)`). Un dégât renvoyé ne se renvoie pas. **INCERTAIN** sur le détail exact côté serveur.

---

## 12. Réduction de dégâts (« armure », effets 105/265)

```
réduction = valeurBuff × (1 + niveau/20)        # = valeur × (100 + 5·niveau)/100 (Giny CalculateArmorValue)
dégâts = dégâts − réduction   (après rés. fixes, avant % rés)       # D3 GetDamageReductor
```
Niveau utilisé : celui du **porteur du buff** (client D2 `DamageUtil.as` l.2923 `(targetLevel/20 + 1) × valeur` ; port D3 `Level/20d + 1` du combattant qui porte le buff) — Giny utilise le niveau du combattant qui calcule (même chose en pratique). Port D3 : seul l'effet 265 (`CharacterLifeLostCasterModerator`) est cumulé dans `GetDamageReductor`, `floor` après le × ; uniquement si le buff est instantané ou se déclenche sur ce dégât (mêlée/distance/éléments). Ne s'applique pas aux dégâts de poussée : `ReceiveDamage` ne calcule pas l'armure si `IsCollision` (et non à cause de `CanTriggerDamageMultiplier`, qui n'exclut que l'effet 90).

---

## 13. Dommages indirects : pièges, glyphes, runes, poisons, bombes

- **Pièges/glyphes/runes** sont des sorts (catégorie *sort*) : ils profitent de la carac, de la Puissance, des **% dommages aux sorts**, des dommages finaux et des fixes, + bonus spécifiques : Puissance Pièges (69) et Dommages Pièges (70), Puissance Glyphes (106), Puissance Runes (110) (D3 `GetDamageBonus`/`FlatDamageBonus`). Pas de critique (DoMath simu pièges : `Rg(..., false)` ; confirmé par les données : « Piège Sournois » sort 12906 et son sort déclenché 12929 ont `criticalHitProbability = 0` dans DofusDB).
- **Mêlée/distance** d'un dommage indirect : déterminé **au moment de l'application** par l'adjacence entre le lanceur (le Sram, le Féca…) et la cible (DoMath simu pièges : `yS(cible, lanceur) <= 1` ⇒ mêlée ; D3 `isMelee = lanceur ≠ cible && cases adjacentes`). Deux sources concordantes, **sauf** quand la cible est le lanceur lui-même (distance 0) : mêlée pour DoMath, distance pour D3 (retenir D3).
- Dégressivité des pièges en zone (DoMath) : `areaDistance = distance(cible, centre) − tailleMin` si l'effet est dégressif ; distance = Manhattan, ou Chebyshev pour les zones carré/diagonale/étoile (`yS`, l.38755).
- Bonus de sort (« augmente les dommages du sort X de N », `BOOST_SPELL`) : ajouté au **jet de base** (DoMath `g.realValue + x`, D3 `BoostSpellBaseDmg`).
- Mode « dégâts moyens » du simulateur DoMath : jet = `(min + max) / 2` **non arrondi** puis `Rg` (vecteur `domath-damage-043`).
- **Poisons** (effets déclenchés en début de tour) : calculés avec les stats **courantes** du lanceur au déclenchement (D3 `FromBuff`), pas de critique (D2 : pas de do crit pour un sort déclenché). **INCERTAIN** : application des % mêlée/distance aux poisons (règle d'adjacence ci-dessus probable).
- Bombes Roublard : `bonus combo` (94) multiplie les dégâts de la bombe (`× (1 + combo/100)`).
- Ordre de déclenchement dans DoMath (simu pièges, `UT` l.40447) : cibles triées par distance Manhattan croissante puis par index angulaire ; pour une poussée de zone, de la plus lointaine à la plus proche ; les actions sont insérées en file juste après l'action déclenchante (TTL 10 de profondeur).

---

## 14. Tacle et fuite

### 14.1 DoMath (`/tacle-fuite`) — code verbatim `Ek` (l.35263)

```js
Ek = function(e, t, n) {          // e = {dodge, ap, mp}, t = tacles des tacleurs, n = composition (liste de cases, chaque case = indices des tacleurs adjacents)
  ... pour chaque case s : l = Π_{m ∈ s} Math.min(1, (Math.max(0, e.dodge) + 2) / (2 * (Math.max(0, t[m] ?? 0) + 2)))
  for (var g = e.ap, d = e.mp, p = 0; p < r.length; p++)
     g *= r[p], d > 0 && (d *= r[p]), g = -Math.round(-g), d = -Math.round(-d), p < r.length && d--;
  return { ap: g, mp: d }
}
```
Pseudo-code :
```
pourcentage(case) = Π_tacleurs adjacents min(1, (max(0,Fuite)+2) / (2·(max(0,Tacle)+2)))
PA, PM = PA_départ, PM_départ
pour chaque case quittée du chemin :
    PA = roundHalfDown(PA × pourcentage(case))
    PM = roundHalfDown(PM × pourcentage(case))     (si PM > 0)
    PM = PM − 1                                    (coût de la case parcourue)
```
- `roundHalfDown` = `-Math.round(-x)` : 1,5 → 1 (le joueur garde l'arrondi inférieur à .5 près).
- Nuance : le tableau `bk` multiplie les PM même s'ils sont ≤ 0 (pas de garde `d > 0` comme dans `Ek`) ; sans effet sur les valeurs affichées tant que le chemin est faisable.
- Le tableau DoMath « PA/PM restants » (composant `bk`) affiche les valeurs **après le tacle de la case et avant le coût du pas** (PM décrémenté seulement entre deux cases) ; `Ek` renvoie l'état après le dernier pas (peut être négatif ⇒ chemin impossible).
- Plusieurs tacleurs autour de la même case : **produit** des pourcentages. Un tacleur avec `Fuite ≥ 2·Tacle + 2` ne retire rien.
- Formules inverses affichées par DoMath (`img/dodge_formula_*.png`) :
  - `Reste = ⌈ PM·(Fuite+2) / (2·(Tacle+2)) ⌋` (arrondi .5 vers le bas)
  - `Tacle ≥ ⌈ (Fuite+2)·PM / (2·Reste+1) − 2 ⌉` (tacle minimum pour laisser au plus `Reste` points)
  - `Fuite ≥ ⌊ 2·(Reste−0.5)·(Tacle+2)/PM − 1 ⌋` (fuite minimum pour garder au moins `Reste` points)
  - Plusieurs tacleurs sur une case : `Fuite = ⌊ (2^(k+1)·Π(Tacle_i+2)·(Reste−0.5)/PM)^(1/(k+1)) − 1 ⌋` itéré sur les tacleurs triés ; chemins multi-cases : recherche dichotomique (`xk`) sur `Ek`.

### 14.2 Client officiel et devblog

- Devblog « Tacle déterministe » (mise à jour du 29 mars 2011, [JOL](https://dofus.jeuxonline.info/actualite/30452/devblog-tacle-deterministe)) : `Pourcentage = (Fuite + 2) / (2 × (Tacle + 2))`, produit sur les tacleurs.
- Client D2 `TackleUtil.getTackle` : `mod = (fuite+2)/(tacle+2)/2`, multiplié seulement si `mod < 1` ; `FightTurnFrame` : `PMperdus += int((PM − PMdéjàUtilisés) × (1 − tacle) + 0.5)`, idem PA. Équivalent à DoMath sauf égalités exactes en .5 (8 cas / 122 412 testés, ex. Fuite 24, Tacle 12, 7 PM : DoMath 6, client 7 à cause de `1 − p` flottant ; vecteur `client-misc-004`).
- Ne peuvent pas tacler : porté, enraciné, invisible/détecté, état « ne peut pas tacler », monstre `canTackle = false`, mort, allié. Ne peut pas être taclé : état « intaclable », enraciné, invisible, porté (`TackleUtil.canBeTackled/canBeTackler`).
- Caracs dérivées : **Tacle = Agilité/10 + bonus, Fuite = Agilité/10 + bonus** (client `StatBuff` : un buff d'Agilité de Δ modifie tacle et fuite de Δ/10).

---

## 15. Retrait et esquive de PA/PM

DoMath ne l'implémente pas (« bientôt »). Formule officielle (note de version **1.25.0**, 23/09/2008, [JOL](https://dofus.jeuxonline.info/article/6152/version-1250-23-09-08)) :
```
P(retirer 1 point) = Retrait_attaquant / Esquive_cible × (Points restants / Points max) / 2,  bornée à [10 %, 90 %]
```
Implémentation (OtomAI `FightActor.RollApLose/RollMpLose` et Giny `Fighter.RollAPLose` en cache dans `.cache/domath/other/` ; Stump : seul le gestionnaire `APDebuff` est en cache — boucle point par point arrêtée quand `retirés = PA courants`) :
```
ra = max(1, Retrait lanceur) ; es = max(1, Esquive cible)
retirés = 0
pour chaque point tenté :
    p = clamp(0.10, 0.90, (PA_actuels − retirés) / PA_max × ra/es / 2)
    si aléa < p : retirés += 1
```
- À valeurs égales, le premier point a 50 % de chances ; les suivants diminuent avec les points restants.
- Caracs dérivées : Retrait PA/PM = Sagesse/10 + bonus ; Esquive PA/PM = Sagesse/10 + bonus (**INCERTAIN** sur la base exacte côté serveur ; règle communautaire stable depuis 2.x).
- Effets : 101/127 (« -X PA/PM », catégorie action) et 77/84 (vols) sont les retraits classiques soumis à l'esquive ; 1079/1080 sont les malus esquivables sur durée (`CharacterDeboost…Dodgeable`, port D3 `IsDodgeable`) ; 168/169 (`CharacterDeboostActionPoints/MovementPoints`, catégorie caractéristique) sont des malus **non esquivables**. **INCERTAIN** pour 101/127 côté Dofus 3 (le module Haxe ne marque esquivables que 1079/1080) — à valider avec les libellés de sorts.
- **INCERTAIN** : `PA_max` = PA max du tour (OtomAI/Stump `TotalMax`) vs total courant (Giny). Les vecteurs utilisent `currentPoints/maxPoints` explicites.

---

## 16. États particuliers

| État | Effet mécanique (DofusDB `/spell-states` + code) |
|---|---|
| **Pesanteur** (id 7) | Drapeaux DofusDB : seul `cantSwitchPosition = true` (`cantBePushed`/`cantBeMoved` = false) : bloque les téléportations, échanges de place, transpositions **subis** (DoMath `pS` empêche SWAP_PLACE et SYMMETRICAL_TELEPORT). **En plus**, côté lanceur : **285 sorts** (503 niveaux de sort, dont Bond 13107, Transposition 12736, Fulgurance 12724, Catapultage 12030, Mot d'Envol 13184…) ont `statesCriterion = "HS!7"` dans DofusDB `/spell-levels` ⇒ **non lançables sous Pesanteur** (requête `statesCriterion=HS!7`, total 503 ; d'autres sorts peuvent combiner `!7` avec d'autres conditions). **N'empêche pas la poussée** et **ne modifie aucun dégât**. |
| Indéplaçable / Enraciné / Inébranlable | bloquent poussée/attirance (DoMath `KT`) ; Enraciné empêche aussi tacler/être taclé. |
| Invulnérable / Invulnérable mêlée / à distance | dégâts annulés (mêlée = distance ≤ 1). |
| Pacifiste (sur le lanceur) | ses dégâts valent 0 (DoMath, D3). |
| Insoignable | soins annulés. |
| Porté (Pandawa) | ne tacle pas, n'est pas taclé. |

## 17. Masques de cibles (DoMath `fS`/`AS`, l.38593-38672)

Les `targetMask` des effets (`a`,`A`,`c`,`C`,`e<id>`,`E<id>`,`F`,`f`,`g`,`h`,`H`,`i`,`I`,`j`,`J`,`o`,`O`,`p`,`P`,`s`,`S`,`T`,`v<n>`,`V<n>`,`W`) sont regroupés : les masques « de type » (a, A, c, C, g, h, H, i, I, j, J, s, S) forment un groupe OU ; chaque masque « condition » (e, E, F, o, O, P, p, T, v, V, W) forme son propre groupe, `f` (non-monstre) forme un groupe à part ; le masque est validé si **chaque groupe** non vide a au moins un élément vrai (ET de OU). `v<n>` : `floor(PV/PVmax × 100) > n` ; `V<n>` : `≤ n`. (DoMath n'évalue qu'une partie des masques, les autres sont considérés vrais.)

## 18. Géométrie (DoMath)

- Carte 14 × 40 = 560 cellules. `cellId → (x, y)` : `ligne = floor(id/14)`, `n = floor((ligne+1)/2)`, `col = id − 14·ligne`, `x = n + col`, `y = col − (ligne − n)` (`ES`, l.38761). Inverse `id = (x−y)·14 + y + floor((x−y)/2)` (`kS`).
- Distance : Manhattan `|dx|+|dy|` (Chebyshev pour carré/diagonale/étoile). Mêlée ⇔ distance ≤ 1.
- Fichiers de carte DoMath : `{id, cells:[560 × (0 = trou, 1 = marchable, 2 = mur/obstacle)]}`. **La salle du boss Vortex** (`143393281`, « Œil de Vortex - Salle des heures perdues ») est en cache : `.cache/domath/maps/143393281.json` ; version Songes infinis : `205787162`.

## 19. Initiative et invocations (hors DoMath)

- **Initiative** = `(Force + Intelligence + Chance + Agilité + Initiative bonus) × PV actuels / PV max` — consensus communautaire ([Millenium](https://www.millenium.org/guide/339432.html) : « 1 de Force, Intelligence, Chance ou Agilité = 1 d'Initiative »). **INCERTAIN** : facteur PV et arrondi. Ordre de jeu : alternance des équipes, chaque équipe triée par initiative décroissante, l'équipe du combattant le plus rapide commence ; les invocations jouent après leur invocateur.
- **Invocations** : PV et caracs du grade du monstre invoqué × `(1 + niveauInvocateur/100)` (règle historique 2.x, [Dofus Wiki « Summon »](https://dofuswiki.fandom.com/wiki/Summon)). **INCERTAIN** pour Dofus 3 (refontes Osamodas 2.70 / Dopeuls). Les dégâts de poussée d'une invocation utilisent le niveau de l'invocateur.

## 20. Divergences et points INCERTAINS

1. Ordre des multiplicateurs : DoMath ≠ client D3 (écarts ≤ 1-2 points). Choix par défaut : DoMath.
2. Artefacts flottants DoMath/D3 vs entiers D2 ; serveur inconnu.
3. Plancher de 1 % de CC (officiel) absent de DoMath.
4. Plafond de résistance monstre : aucun (D2) vs 100 (D3).
5. `% Dommages Poussée` (158), `allDamageMultiplier` (150), `% Soins finaux` (2971) : nouveaux, formule non vérifiée.
6. Retrait PA/PM : base du ratio de points (max du tour vs courant) ; plafond 90 % (Giny utilise une variante `0.9 − 0.1·retirés` pour les PM — non retenue).
7. Niveau utilisé pour l'armure (105/265) et le renvoi boosté.
8. Le bot OtomAI tire les jets par `floor(min + U·(max−min) + 0.5)` (extrémités deux fois moins probables) ; DoMath et l'intuition officielle : **uniforme** sur les entiers — retenir l'uniforme.
9. Initiative (facteur PV), invocations D3.
10. Poisons : application des % mêlée/distance.
11. Multiplicateurs appliqués aux dégâts fixes non boostés (144, 1063-1066, 82) et aux dégâts basés sur les PV : D2 ≠ port D3 (§4, §5).
12. Caractéristiques « % de carac » 126-139 (Agilité %, Tacle %, PA %…) : formule d'application inconnue.
13. Port D3 : facteur de stats en float32 (`0.01f`) et carac de soin pour l'effet 81 (meilleur élément vs Intelligence) — artefacts de portage probables, non retenus.
14. Portails : bonus de base du sort de portail + 2 %/case entre portails (D2) ; formule D3 non vérifiée.

## 21. Index des vecteurs de test

`data/research/damage-test-vectors.json` — `cases[]` (99, stricts) + `informative[]` (2, comparaisons d'ordre) :

| Catégorie | n | Fonction attendue | Source |
|---|---|---|---|
| `domath-damage` | 43 | `domathDamageRoll(stats, base, element, isCritical)` | `Rg` exécuté |
| `domath-spell` | 3 | min/max normal/crit par lancer et × compteur | `jg`, `nx` |
| `domath-crit-chance` | 4 | `critChancePercent` | worker |
| `domath-distribution` | 2 | distribution exacte, espérance | worker exécuté (vm) |
| `domath-tackle` | 9 | PA/PM restants par case et après chemin | `bk`, `Ek` |
| `domath-tackle-min` | 2 | tacle/fuite minimum | `wk`, `xk` |
| `domath-trap-apply` | 8 | bouclier, érosion, vol de vie, soin dernier dégât | `HT`, `uj` |
| `client-push-damage` | 9 | dégâts de poussée (D2 et D3) | AS3 / C# / patch 2.17 |
| `client-ap-mp-removal` | 6 | distribution du nombre de points retirés | patch 1.25 + émulateurs |
| `client-heal` | 4 | soin D2 | AS3 `getHeal` |
| `client-area-efficiency` | 5 | efficacité de zone | `SpellZone.GetAoeMalus` / AS3 |
| `client-misc` | 4 | plafond rés. (`values` = D3, `dofus2ClientValues` = AS3), érosion, arrondi tacle | AS3 / D3 |

`meta.globalChecks` : balayages d'artefacts flottants (%rés, zone, portail, érosion DoMath, float32 du port D3) et écarts tacle DoMath/client. `meta.conventions.tackleFields` : `remainingPercent` est une **fraction** 0..1.

---

## 22. Vérification (relecture adversariale, 2026-10-04)

**Ce qui a été revérifié (sources primaires)**
- **Bundles DoMath** : SHA-256 des fichiers en cache `main.e2dd4684.js` et `806.6ff2731e.chunk.js` identiques aux fichiers servis en ligne ce jour (`asset-manifest.json` pointe toujours vers ces bundles, version `"1.3.3"` présente dans le bundle). `Rg` et `Ek` relus dans le **bundle minifié** (pas seulement la version beautifiée) : identiques à §3.1 / §14.1. `Po`, `ss` (bornes UI), `Dg` (quirk `||`), `Mg`/`jg`/`nx`, worker `fe` + distribution + chance de CC relus.
- **Reproductibilité** : `build-literal.cjs` regénère `domath-literal.cjs` à l'identique (diff vide) ; `gen-vectors.cjs` regénère les 99 + 2 vecteurs (seul `generatedAt` changeait avant corrections).
- **Recalcul indépendant** (implémentation écrite à partir de §3.2, sans réutiliser le code de l'extraction) : 43/43 `domath-damage`, 3/3 `domath-spell` (par lancer et × compteur), 2/2 `domath-distribution` (espérances 25 et 327,8 ; écart max de probabilité 3·10⁻¹³), 9/9 `domath-tackle`, `domath-tackle-min-001` validé par la sémantique (pour chaque ligne, la valeur est bien le minimum qui donne le reste annoncé), 9/9 poussée (AS3 et port D3, rationnels exacts), 6/6 retrait PA/PM (distribution exacte en fractions), 4/4 soins, 5/5 efficacité de zone.
- **DofusDB (API en direct)** : 138 effets (`/effects`, ids cités dans §2) et 123/123 caractéristiques (`/characteristics`) relus — table §2.2 conforme ; état 7 (`/spell-states`) ; dongeon 87 (`mapIds = [143393281]`) ; 12 préréglages DoMath tirés au hasard comparés aux `/spell-levels` (identiques) ; sort de piège Sram (crit 0).
- **Carte** `maps/143393281.json` : identique à `https://domath.fr/maps/143393281.json` ; 560 cellules (260 trous, 224 marchables, 76 murs) ; enum DoMath `HOLE=0, WALKABLE=1, WALL=2` confirmé ; formules `ES`/`kS` vérifiées algébriquement contre la grille Ankama (lignes paires/impaires).
- **Patch notes** : 2.29 (CC additifs, plancher 1 %, exception Poisse), 2.17 (formule de poussée, Millenium), 1.25.0 (retrait PA/PM, JOL) relues.
- **Clients** : AS3 D2 (`getDamage`, `getHeal`, érosion, poussée, `PushUtil.getPushForce` `ceil(force/2)`, `TackleUtil`, `FightTurnFrame`, portails, armure, renvoi) et port C# D3 (`GetCollisionDamage`, `ApplyCollisionDamage`, `ReceiveDamage`, `ApplyDealtMultiplier`, `IsBoostable`, `GetDamageReductor`, `GetPermanentDamage`, `GetAoeMalus`, `Interval.Multiply`).

**Erreurs corrigées**
1. §2.3 : 85-**90** présentés comme dégâts en % des PV — l'effet 90 est « Transfère X % des PV » ; 1118-1122 sont les dégâts en % des PV érodés **du lanceur** ; ceux de la **cible** (1092-1096) manquaient (§2.3, §5, §9).
2. §3.4 / vecteur `domath-damage-033` : `1 − 3×0.1` vaut le double 0.7 (et non « 0.6999999999999999 ») ; ajout des taux d'artefacts par étape — la zone est l'étape la plus touchée (**6,2 %**, contre 0,41 % pour la %rés), + portail, érosion DoMath.
3. §3.4/§3.5 : le port D3 n'a pas « les mêmes » artefacts mais **davantage** (multiplicateurs en double, facteur de stats en `float32` : 2,6 % d'écarts).
4. §3.2 : une %rés > 100 ne donne pas « 0 » mais des dégâts **négatifs** dans `Rg` (pas de clamp après l'étape 4).
5. §3.3/§6 : la **Poisse** supprime tout coup critique (exception explicite au plancher de 1 %).
6. §4/§5 : multiplicateurs des dégâts fixes non boostés et basés sur les PV — comportement D2 ≠ port D3 précisé (le texte initial était contradictoire).
7. §10 : la non-application de l'armure à la poussée vient de `ReceiveDamage` (bloc sauté si `IsCollision`), pas de `CanTriggerDamageMultiplier` ; « dommages subis » ne s'applique à la poussée que via des buffs instantanés ou à déclencheur de poussée ; la barre de vie DoMath (`uj`) **retire** bien le placeholder de poussée des PV (affichage faux) ; arrêt de la poussée sur piège.
8. §12 : niveau de l'armure = niveau du porteur (confirmé AS3 l.2923) ; le port D3 ne cumule que l'effet 265.
9. §16 : **Pesanteur** n'est pas « `cantSwitchPosition` uniquement » : 285 sorts (503 niveaux) portent `statesCriterion = "HS!7"` et ne sont pas lançables sous Pesanteur.
10. §2.2 : sens bonus/malus des effets 28xx, rattachements DofusDB douteux (2971/2972 → carac 49 ; 3804-3808 → carac 75), caractéristiques « % » 126-139 signalées.
11. Divers : borne UI du compteur (0..61), 669 préréglages = 503 sorts distincts, mêlée sur soi-même (DoMath ≠ D3), distance de dégressivité selon la forme de zone (§3.6), sémantique des portails (bonus de base + 2 %/case), incohérence du port D3 sur la carac de soin (effet 81).
12. Vecteurs : `client-misc-001` donne aussi les valeurs AS3 (`dofus2ClientValues`, pas de plafond monstre) ; `meta.conventions` précise que `remainingPercent` est une fraction ; `meta.globalChecks` étendu.

**Non vérifiable / laissé INCERTAIN** : comportement serveur (arrondis, ordre), formule exacte Retrait/Esquive = Sagesse/10 en Dofus 3, initiative, invocations D3, nouvelles caracs 150/158/2971, `Stump.RollAPLose` (non présent dans le cache), formule portail D3.
