# Roublard — analyse complète pour DofusSimu (breed 13)

> « Expert en explosifs ». Données : API DofusDB (fichiers du jeu Dofus 3, mises à jour 2026) —
> `https://api.dofusdb.fr/breeds/13`, `spell-variants?breedId=13`, `spells`, `spell-levels`, `spell-states`, `monsters`
> (bombes 3112/3113/3114/5161, Bombe Ambulante 5162, Mégabombe 5163, Roublabot 3120) et sorts cachés des types 2004
> (« Sorts initiaux Roublard »), 2320–2324 (explosions, murs, Allumage), 613 (« Déclenchés Roublard »).
> Cache brut : `.cache/classes/rzse/`. Rôles officiels (`breedRoles`) : **Dégâts 10/10** (« occasionne d'importants dégâts en
> faisant exploser ses bombes »), **Placement 7/10**, **Entrave 6/10** (« retire des PA, des PM et bloque des lignes de vue avec
> ses bombes »), Invocation 5, Amélioration 5. Complexité officielle 5/5.

## 0. Règles moteur communes déduites des données (valables pour les 4 classes Roublard/Zobal/Steamer/Eliotrope)

1. **Sélection des cibles « instantanée »** : pour UN lancer de sort, les cibles de **tous** les effets (zone + masque, y compris
   les conditions d’état `E<id>`/`e<id>`) sont calculées **avant** d’appliquer le premier effet (port C# du client :
   `DamageCalculator.ExecuteSpell → GenerateTargets`, recalcul uniquement après un effet de résurrection). Preuves dans les
   données : la chaîne d’états Combo du Roublard (20497 : « applique Combo II si Combo I », puis « retire Combo I »…) ou
   l’Évolution du Steamer (pose « Évolution bloquée » puis teste « sans Évolution bloquée ») n’ont de sens qu’avec cette règle
   (sinon une bombe passerait de Combo I à XV en un lancer). Les **sous-sorts** (effets 1160, 792, 2794…) sont des lancers
   séparés : leurs cibles sont calculées au moment où l’effet parent est atteint, donc ils voient les effets déjà appliqués.
   ⚠ La fiche `cra.md` d’un autre agent suggère une évaluation au moment de l’application : à harmoniser (cette règle-ci est
   celle du code du client porté).
2. **Effets `forClientOnly = true`** : purement descriptifs (info-bulle). Ne jamais les exécuter ; le comportement réel est dans
   un sous-sort (souvent conditionnel). Exemple : « Rend 1 PA » d’Amarrage n’est réellement appliqué que si la cible est une
   tourelle (sous-sort 29587).
3. **Effets « lance un sort »** (diceNum = id du sort, diceSide = niveau) : 1160 `CasterExecuteSpell` / 2160 (limite globale)
   = le lanceur lance le sous-sort sur chaque cible ; 792 `TargetExecuteSpell` / 2792 = chaque cible le lance sur elle-même ;
   2794 `TargetExecuteSpellOnCell` / 2795 = la cible le lance sur sa cellule ; 2960 `CasterExecuteSpellOnCell` = le lanceur le
   lance sur la cellule d’impact ; 1017/2017 = la cible le lance sur le déclencheur ; 1018 = le déclencheur le lance sur la
   cible ; 1019 = le déclencheur sur lui-même. Les effets 3792/3793 (`ExecuteSpellScriptUsage`) sont visuels. `value = 999`
   apparaît sur certains de ces effets (sens INCERTAIN, sans impact connu).
4. **Masques de cibles** (`targetMask`, liste séparée par des virgules ; port C# `SpellManager.IsSelectedByMask`) :
   lettres **inclusives** (au moins une doit correspondre) : `a` alliés (lanceur compris), `g` alliés sauf lanceur, `A` ennemis,
   `c` lanceur s’il est dans la zone, `C` lanceur partout, `h/H` joueurs alliés/ennemis (non invoqués), `i/I` invocations non
   statiques, `j/J` invocations, `s/S` invocations statiques, `m/M` monstres non invoqués, `l/L` joueurs ou compagnons,
   `d/D` compagnons ; lettres **exclusives** (toutes doivent passer) : `E<n>`/`e<n>` a / n’a pas l’état n, `F<n>`/`f<n>` est / n’est
   pas le monstre n (plusieurs `F` = OU), `B<n>`/`b<n>` est / n’est pas la classe n, `P`/`p` est / n’est pas dans le groupe du
   lanceur (lui-même, ses invocations, les invocations du même invocateur, son invocateur), `R`/`r` sort lancé via / hors
   portail, `V<n>`/`v<n>` PV < n % / ≥ n %, `T` téléfraggé ce tour, `W` téléportation ratée, `K` porté/lancé, `Q`/`q` quota
   d’invocations atteint / non atteint, `O`/`o` = la cible déclenchante, `U/u` en apparition. Préfixe `*` = la condition porte
   sur le **lanceur** (ex. `*E98` = le lanceur est en Intrépide).
5. **Conditions de lancer** (`statesCriterion`) : `HS=<n>` le lanceur doit avoir l’état n, `HS!<n>` ne doit pas l’avoir,
   `|` = OU, `&` = ET.
6. **Déclencheurs** (`triggers`, séparés par `|`) : `I` immédiat ; `TB`/`TE` début/fin du tour du porteur ; `D` dommages subis ;
   `DM`/`DR` en mêlée/à distance ; `DBA` par un allié ; `X` mort, `XD` mort par dommages, `XPD` par poussée, `XDBA` tué par un
   allié ; `P` poussé, `MA` attiré, `M` déplacé, `MS` échange de position, `PD` dommages de poussée subis, `H` soigné, `PT`
   traverse un portail, `PST` projette un sort via un portail, `PDT` dommages subis via portail, `CI` invoque, `CT` tacle
   (INCERTAIN), `CPT` une entité traverse un portail du porteur (INCERTAIN), `CMPAS` tentative de retrait PM du lanceur
   (INCERTAIN), `EON<n>`/`EOFF<n>` l’état n est appliqué/retiré. Pour un effet déclenché, `effectTriggerDuration` = nombre de
   tours pendant lesquels le déclencheur reste posé sur la cible (affiché « déclencheur actif N tour(s) ») et `duration` = durée
   de l’effet produit à chaque déclenchement (0 = instantané).
7. **Zones** (`zoneDescr.shape` + param1 = rayon, param2 = rayon minimal) : P case, C cercle, X croix, + croix diagonale,
   * étoile (8 directions), Q/# croix sans centre (orthogonale/diagonale), L ligne depuis l’impact, l ligne depuis le lanceur,
   T/- barre perpendiculaire, O anneau, G/W carré (plein/contour), D damier, U demi-cercle, V cône, F fourche, B boomerang,
   R rectangle, A/a toute la carte. `damageDecreaseStepPercent` (10 % par défaut) = dégressivité par case pour les dommages de
   zone (certaines descriptions précisent « non dégressif »).
8. **Boucliers** (1020) = X % du niveau du lanceur ; **soins** 1109 = X % des PV max de la cible ; **2822/3002** = dommages /
   soins dans le **meilleur élément** du lanceur (caractéristique la plus haute).

## 1. Vue d’ensemble

- **Profil** : DPS de zone « à retardement ». Le Roublard pose des **bombes** (invocations statiques qui ne jouent pas) qui
  accumulent des **Combos** (états I à XV) puis les fait **exploser en chaîne**. Chaque palier de Combo multiplie les dommages
  de l’explosion (Combo XV = ×4,6). Les bombes d’un même élément alignées forment des **murs** élémentaires qui blessent
  (et, pour l’Air/l’Eau, retirent PM/PA) les entités qui les traversent.
- **Quatre éléments de bombes** : Explobombe (Feu, Intelligence), Tornabombe (Air, Agilité, retrait PM selon le Combo),
  Bombe à Eau (Eau, Chance, retrait PA selon le Combo), Sismobombe (Terre, Force, alimente Oblitération). Les bombes
  héritent à 100 % des caractéristiques élémentaires et des dommages fixes de l’invocateur (`bonusCharacteristics`).
- **Sorts directs** solides : Pulsar (Feu zone), Espingole (Air barre de 5), Recel (Eau + attirance), Bombarde (Terre barre),
  Mitraille (Air -3 PM), Dagues Boomerang / Tromblon (érosion 13 %), Extraction / Grenaille (vols de vie Feu), Arquebuse
  (Terre + désenvoûtement partiel), Oblitération (Terre à rampe).
- **Placement** très riche : Botte, Aimantation, Croisement, Entourloupe, Resquille, Stratagème, Imposture, Ruse, Roublardise
  (téléportation + fin de tour), Piège Magnétique, Roublabot (porte/jette/pousse/attire les bombes).
- **Soutien** : état **Kaboom** (alliés immunisés contre les explosions et murs alliés + bonus +3 PO / +1 PM / +1 PA / +7 %
  dommages aux sorts selon la bombe qui explose à côté), boucliers sur bombes, Rémission (repousse l’attaquant au corps-à-corps).
- **Point clé pour le simulateur** : la puissance du Roublard dépend d’un **état de terrain persistant** (positions des bombes,
  Combos, murs) qui se construit sur plusieurs tours ; l’IA doit raisonner sur 2 tours (pose → explosion) et sur la géométrie
  (cercles de rayon 2, lignes de 7 cases).

## 2. Rôles en groupe PvM (niveau 200)

- **dps-zone-burst** (priorité 1, élément(s) : Feu/Air/Eau/Terre selon les bombes (souvent Feu-Air ou multi)) — Explosions en chaîne de 2–3 bombes à Combo élevé (×2 à ×4,6) en cercle de rayon 2 + murs. Idéal contre des vagues groupées ou des monstres qui avancent vers le groupe (Vortex : vagues prévisibles).
- **entrave-zone** (priorité 2, élément(s) : Air (PM) / Eau (PA)) — Tornabombe : -1/-2/-3 PM en zone selon le Combo (I–IV/V–IX/X–XV), Mur d’Air -2 PM ; Bombe à Eau : 0/-1/-2 PA en zone, Mur d’Eau -2 PA ; Mitraille -3 PM ; Resquille -2 PA en anneau ; Cadence/Shrapnel -1 PM/-1 PA autour des bombes. Les bombes bloquent aussi les lignes de vue et les chemins.
- **placement** (priorité 2, élément(s) : -) — Pousse/attire ennemis et bombes (Botte, Aimantation, Croisement, Espingole, Pulsar, Recel, Bombarde), échanges (Entourloupe, Imposture), téléportations de bombes (Stratagème, Resquille), Roublabot.
- **soutien-buff** (priorité 3, élément(s) : -) — Kaboom/Imposture : immunité des alliés aux explosions/murs alliés + bonus cumulables (+3 PO, +1 PM, +1 PA, +7 % dommages aux sorts, 3 tours, 1 fois par type de bombe, 3 max). Rémission : contre-poussée de 6 cases sur un allié frappé au contact.
- **érosion** (priorité 3, élément(s) : Air/Eau) — Dagues Boomerang / Tromblon : +13 % d’érosion (2 tours) en zone — utile contre les boss régénérants ou pour le groupe.

## 3. Mécaniques de classe à implémenter (moteur)

### 3.1 Bombes : pose, coût croissant, limite et PV

Les sorts Explobombe (13444), Tornabombe (13435), Bombe à Eau (13436), Sismobombe (13491) utilisent l’effet 1008 `SummonBomb` (diceNum = id du monstre bombe 3112/3113/3114/5161, diceSide = grade 1–3 selon le niveau du sort). Une bombe est une invocation **statique** (`canPlay=false`, 0 PA/0 PM, ne tacle pas, `useBombSlot=true` : ne consomme pas d’emplacement d’invocation mais un emplacement de bombe — caractéristique 93 `maxBomb`). À l’apparition, son sort initial « Allumage » (13468) fait lancer au Roublard le sous-sort 20509 qui ajoute **+1 PA au coût** du sort de pose de cet élément (effet 296, durée infinie, retiré à la mort de la bombe) — d’où « le coût augmente de 1 par bombe de cet élément sur le terrain » (2, 3, 4 PA…). Il lance aussi « La Ruse du Roublard » 20577 niv.2 : **+1 Combo immédiat** (la bombe naît en Combo I) et, pour les variantes Résilientes, +40 % de Vitalité. Les variantes « Résiliente » (13471/13474/13478/13486) coûtent toujours 2 PA mais 1 seul lancer/tour. Les sorts de base : 2 lancers/tour, 1/cible, PO 1–6 avec ligne de vue. Lancé **sur une entité** (case occupée), le sort applique directement l’effet d’explosion de la bombe en zone (sort « cast on fighter », p.ex. 13456 pour l’Explobombe : dommages cercle r2 centre inclus, +1 Combo et explosion si la cible est une bombe du lanceur), le lanceur n’est pas affecté.

*Notes d’implémentation* : Bombe = Fighter statique {monsterId, summonerId, element, combo, comboBonus%}. PV : `bonusCharacteristics.lifePoints` = 90 (Résiliente +40 % vitalité) — INCERTAIN : interprété comme 90 % des PV de base du Roublard (le patch 2.61 parlait de 80 % des PV de base, gamosaurus). Résistances propres : 10 % partout et 30 % dans son élément. Limite : 3 bombes (INCERTAIN pour Dofus 3, valeur historique, cf. jeuxonline) via `maxBomb`. Mapping sort de pose → sort « sur entité » : 3112→13456, 3113→13459, 3114→13463, 5161→13503 (déduit des données : seuls sorts « Explosion/Tornade/Averse/Avalanche Roublarde » qui contiennent le +1 Combo + explosion sur bombe et la zone cercle 2 avec centre).

### 3.2 Combo (états I à XV) et multiplicateur « Dommages Combo »

Chaque bombe porte un état Combo (2484 Combo I … 2533 Combo XV, puis 2751/2752/2753 = « Combo XV » de débordement). Le sous-sort « Combo » 20497 fait monter d’un cran : il applique l’état suivant, lance « Combo » 20500 du niveau correspondant (effet 1027 `BombComboBonus` = +x % « Dommages Combo », cumul max 1 donc remplacé) et retire l’état précédent. Table officielle (sort 24306) : I 0 %, II 20 %, III 40 %, IV 60 %, V 80 %, VI 100 %, VII 120 %, VIII 140 %, IX 160 %, X 190 %, XI 220 %, XII 250 %, XIII 280 %, XIV 320 %, XV 360 %. Sources de Combo : pose (+1), **début de chaque tour du Roublard +2** (20577 niv.1 lancé en TB par le passif « La Ruse du Roublard » 20488), Détonateur (+1 avant explosion), Mousquet/Aimantation/Croisement/Kaboom/Casemate/Entourloupe/Imposture/Plombage/Piège Magnétique/Roublabot (+1, souvent « 1 fois par bombe et par tour »), Poudre (+2 à la destruction), Dernier Souffle (+3 temporaires 2 tours puis -3), Oblitération sur bombe (+0 à +5), Mimésis (copie jusqu’à 7 Combos), chaque explosion qui touche une bombe (+1 via l’effet de la bombe « sur entité »).

*Notes d’implémentation* : Stocker `combo` (0–15+) et `comboBonus` sur la bombe. Formule (port C# du client, DamageSender.GetBoostableDamage) : dégâts boostables = ((base + bonus de base 293) × (1 + (carac + puissance)/100) + dommages fixes) × **(1 + comboBonus/100)**, puis résistances. Le bonus s’applique aux dégâts d’explosion **et** de mur. ⚠ La chaîne d’états fonctionne parce que les **cibles (et donc les conditions d’état des masques) de tous les effets d’un même lancer sont calculées avant d’appliquer le premier effet** (GenerateTargets dans le port C#) : sinon Combo I→XV en un seul appel. Les sous-sorts (1160/792/…) sont des lancers séparés évalués au moment où on les atteint.

### 3.3 Explosion et réaction en chaîne

L’effet 1009 `CharacterActivateBomb` déclenche une bombe : elle lance son sort d’explosion (Feu 13455, Air 13467, Eau 13462, Terre 13504) — dommages dans un **cercle de rayon 2 sans la case centrale** à tous les ennemis et aux alliés non-bombes sans état Kaboom (le Roublard compris), puis se tue (141). Grade 3 (niv. ≥ 132) : Feu 17–19, Air 17–19 + retrait PM selon Combo (I–IV -1, V–IX -2, X–XV -3), Eau 17–19 + retrait PA (I–IV 0, V–IX -1, X–XV -2), Terre 20–22 (+ alimente Oblitération). La **réaction en chaîne** (sorts 13457/13460/13464/13502) fait exploser les autres bombes du lanceur dans le cercle de rayon 2 (sans centre) et les bombes **du même élément** en croix jusqu’à 7 cases. Une explosion retire les états « Bombe Collante » dans la zone (ce qui les déclenche).

*Notes d’implémentation* : Résolution récursive avec ensemble « déjà traitées » (TargetManagement.GetBombsAboutToExplode). Ordre : explosion A (dégâts) → bombes liées. Chaque bombe utilise SON combo. Pas de dégressivité indiquée pour la zone (damageDecreaseStepPercent à vérifier dans zoneDescr ; INCERTAIN). Les explosions ne sont pas des sorts du Roublard : pas de coup critique (CC 0 %).

### 3.4 Murs de bombes

Deux bombes du **même élément** et du même Roublard, alignées en ligne droite (croix) à ≤ 7 cases, sans bombe du même élément entre elles, créent un **mur** (marque) sur les cases intermédiaires. Le mur blesse les entités qui y entrent/commencent leur tour et celles présentes à sa création. Dommages grade 3 : Mur de Feu 30–33 pendant le tour du Roublard (état « Tour Roublard » 2483) sinon 15–17 ; Mur d’Air 24–27 / 12–14 + -2 PM ; Mur d’Eau 24–27 / 12–14 + -2 PA (hors tour du Roublard) ; Mur de Terre 24–27 / 12–14. Les alliés sans Kaboom sont touchés.

*Notes d’implémentation* : Recalculer les murs après chaque déplacement/pose/mort de bombe (RedefineBombWall). Bonus Combo du mur = max(bonus des 2 bombes les plus proches) + 50 % du bonus des autres bombes liées (ExecuteWallDamage). Un mur nouvellement créé frappe immédiatement les entités sur ses cases. Les cartes du donjon doivent être prises en compte (lignes obstruées).

### 3.5 Kaboom / Imposture

État Kaboom (92, 2 tours via Kaboom en croix r2 ; 1 tour via Imposture) : l’allié n’est plus touché par les explosions et murs des bombes alliées et gagne, quand une explosion le prend dans sa zone, un bonus selon la bombe (3 tours, 1 fois par type, 3 cumuls max via les états Slot 1–3) : Explobombe +3 PO, Tornabombe +1 PM, Bombe à Eau +1 PA, Sismobombe +7 % dommages aux sorts (effet 2812).

*Notes d’implémentation* : Les explosions lancent le sous-sort « Kaboom » 20752 sur les alliés Kaboom du cercle 2, qui pose un état Slot puis 20744/20747/20748 selon le slot et l’élément. Imposture applique en plus l’état 4068 au tour suivant qui empêche une nouvelle application de Kaboom.

### 3.6 Bombe Collante, Poudre, Oblitération, Plombage (états spéciaux)

Bombe Collante (13479) : pose l’état 2515 sur une entité (non-bombe) ou un piège sur case libre ; activée par Détonateur/Étoupille/explosion, elle inflige 17–19 dans le meilleur élément du Roublard en cercle r2 et fait exploser ses bombes dans la zone. Poudre (13441) : bombe Indéplaçable 2 tours, +2 Combos et explosion si elle est détruite. Oblitération (13469) : Terre 33–37, +10 dégâts de base (effet 293) par explosion de Sismobombe/Bombe Collante (états Oblitération I–V, cumul 5), remis à zéro après usage. Plombage (13488) : sur une bombe élémentaire, Feu 30–34 aux ennemis situés entre deux bombes alignées + 1 Combo à ces bombes.

*Notes d’implémentation* : Bombe Collante : états 641 (alliée) / 665 (ennemie) + déclencheur EOFF (retrait de l’état) → sous-sort 13507. Plombage : chaîne de sous-sorts 23698 niv.1–10 avec états 3449–3454 (marquage des bombes alignées, ligne `l1` depuis le lanceur).

### 3.7 Invocations contrôlables : Roublabot, Bombe Ambulante, Mégabombe

Roublabot (3120, grade 3 : 4 PA, 9 PM, ne tacle pas, indéplaçable, meurt en fin de tour, n’utilise pas d’emplacement) : Pincettes (porte/jette une bombe, +1 Combo), Détonation (2 PA, +1 Combo + explosion, 2/tour), Poussette (pousse jusqu’à la case ciblée, +1 Combo si bombe déplacée), Aspirateur (attire jusqu’à la case, +1 Combo). Bombe Ambulante (5162 : 2 PA, 7 PM, Intaclable/Intacleur) : Mimésis copie l’élément et jusqu’à 7 Combos d’une bombe du lanceur puis devient cette bombe (Pacifiste jusqu’au début du tour suivant du Roublard) ; meurt à la fin de son 2e tour si elle n’a pas d’élément. Mégabombe (5163 : 6 PA, 6 PM, consomme un emplacement d’invocation) : Mégattaque Neutre 13–15, Absorption Explosive (dévore une bombe : soin 20 %, +50 % dommages finaux, +20 % vitalité, -1 PM, cumul 5), Mégamikaze/à la mort : Neutre 28–32 cercle r2 + explosion des bombes du cercle 2.

*Notes d’implémentation* : Effet 1011 `SummonSlave` = invocation contrôlée par le joueur (l’IA de groupe doit planifier ses actions). Roublabot : sort initial 13454 → Enraciné infini + « Tue la cible » en fin de tour.

### 3.8 Murs/boucliers sur bombes et protection

Botte (175 % du niveau), Ruse (225 %), Roublardise (150 % sur toutes les bombes), Stratagème (50 %), Casemate (Invulnérable 1 tour), Rémission (sur bombe : -20 dommages subis à distance, 3 tours), variantes Résilientes (+40 % vitalité). Les ennemis à distance qui « nettoient » les bombes sont la principale contre-mesure.

*Notes d’implémentation* : Bouclier 1020 = % du niveau du lanceur (niv. 200 → 175 % = 350 PV de bouclier).

### Invocations de la classe

| Monstre (id) | Grade utilisé | PA/PM | Rés. % | Joue ? | Emplacement | Notes |
|---|---|---|---|---|---|---|
| Explobombe (3112) | 3 (sort grade 3) | 0/0 | T10 F30 E10 A10 N10 | non | bombe | Explosion Feu 13455 ; mur de Feu 13458 ; sur entité 13456 |
| Tornabombe (3113) | 3 | 0/0 | A30, 10 ailleurs | non | bombe | Explosion Air 13467 (+ -PM par Combo) ; mur d’Air 13461 (-2 PM) ; sur entité 13459 |
| Bombe à Eau (3114) | 3 | 0/0 | E30, 10 ailleurs | non | bombe | Explosion Eau 13462 (+ -PA par Combo) ; mur d’Eau 13465 (-2 PA) ; sur entité 13463 |
| Sismobombe (5161) | 3 | 0/0 | T30, 10 ailleurs | non | bombe | Explosion Terre 13504 ; mur de Terre 13501 ; sur entité 13503 |
| Roublabot (3120) | 3 | 4/9 | 10 partout | oui (contrôlé) | aucun | Meurt en fin de tour ; Pincettes, Détonation, Poussette, Aspirateur |
| Bombe Ambulante (5162) | 1 | 2/7 | 10 partout | oui (contrôlée) | aucun | Mimésis ; Intaclable + Intacleur |
| Mégabombe (5163) | 1 | 6/6 | 10 partout | oui (contrôlée) | invocation | Mégattaque, Absorption Explosive, Mégamikaze |


## 4. Fiches détaillées des 44 sorts (22 paires)

Légende : valeurs au **grade maximal accessible au niveau 200** (fichiers du jeu via DofusDB). « CC » = coup critique.
Les effets sont listés **dans l’ordre d’exécution** ; « ↳ » = effets d’un sous-sort lancé par l’effet précédent (le lanceur du
sous-sort est indiqué : « le lanceur lance » = effet 1160/2160, « la cible lance sur elle-même » = 792/2792,
« la cible lance sur sa cellule » = 2794/2795, « le lanceur lance sur la cellule ciblée » = 2960). Les masques de cibles sont
traduits : `a` = alliés (lanceur inclus), `g` = alliés sauf lanceur, `A` = ennemis, `C` = lanceur, `E<id>`/`e<id>` = cible
avec/sans état, `*…` = condition sur le lanceur, `F<id>`/`f<id>` = est/n’est pas le monstre <id>, `P`/`p` = (hors) groupe du
lanceur (lui + ses invocations), `r`/`R` = lancé hors/via un portail, `V<n>`/`v<n>` = PV < n % / ≥ n %. Les zones : « croix r1 » =
croix de rayon 1 (5 cases), « croix diagonale » = X, « ligne perpendiculaire r2 » = barre de 5 cases perpendiculaire au lancer,
« anneau r2 » = cercle de rayon 2 sans le centre, « (rayon min n) » = cases à distance < n exclues.

### Paire 1 — Explobombe / Explobombe Résiliente

#### Explobombe (`13444`) — variante de base, débloqué niv. 1, grade 3

> Pose une Bombe qui peut occasionner des dommages Feu en zone à son explosion.  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.  Le coût en PA du sort augmente de 1 pour chaque Explobombe du lanceur présente sur le terrain.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 0 %
- Effets exécutés :
  - Pose une bombe Explobombe (3112) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - [Explosion de la bombe — sort 13455, grade 3] Dommages Feu 17 à 19 — cercle r2 sans la case centrale ; cibles : ennemis + alliés non-bombes sans Kaboom (Roublard compris) ; × (1 + Dommages Combo %) ; la bombe meurt
  - [Réaction en chaîne — 13457] fait exploser les bombes du lanceur à ≤ 2 cases et les Explobombes alignées à ≤ 7 cases
  - [Mur de Feu — 13458] 30 à 33 Feu pendant le tour du Roublard, 15 à 17 sinon (14 sur alliés), entités traversant/commençant leur tour dans le mur
  - [Sur une entité — 13456] Dommages Feu 17 à 19 en cercle r2 centre inclus (pas le lanceur) ; sur une bombe du lanceur : +1 Combo puis explosion
  - [Allumage 13468 → 20509] +1 PA au coût d’Explobombe tant que la bombe vit ; [20577 niv.2] la bombe naît en Combo I
- Grades : g1 (niv 1) vs g3: Pose une bombe Explobombe (3112) grade 1 (g1) → Pose une bombe Explobombe (3112) grade 3 (g3) | g2 (niv 66) vs g3: Pose une bombe Explobombe (3112) grade 2 (g2) → Pose une bombe Explobombe (3112) grade 3 (g3)
- Rôle : aoe, bomb, damage
- **Analyse tactique** : Bombe Feu de base. Pose 2/tour (2 puis 3 PA). Les Explobombes alignées forment le mur le plus fort (30–33 Feu pendant le tour du Roublard). Kaboom : +3 PO aux alliés.

#### Explobombe Résiliente (`13471`) — variante alternative, débloqué niv. 95, grade 2

> Pose une Bombe qui peut occasionner des dommages Feu en zone à son explosion.  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 1 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Pose une bombe Explobombe (3112) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - Explosion, chaîne, mur et effet « sur entité » identiques à l’Explobombe (13455/13457/13458/13456)
  - [20577 niv.2] +40 % de Vitalité à la bombe (état 3687 « Explobombe Résiliente » sur le lanceur) ; pas d’augmentation de coût (Allumage ne vise que le sort 13444)
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +40% Vitalité — cibles: alliés [groupe du lanceur; apparaissant]; infini
- Grades : g1 (niv 95) vs g2: Pose une bombe Explobombe (3112) grade 2 (g1) → Pose une bombe Explobombe (3112) grade 3 (g2)
- Rôle : aoe, bomb, damage
- **Analyse tactique** : Même bombe, coût fixe 2 PA mais 1/tour et +40 % de vitalité : à préférer si les ennemis frappent les bombes en zone (bombes plus durables) et si on ne joue qu’une bombe de cet élément.


### Paire 2 — Tornabombe / Tornabombe Résiliente

#### Tornabombe (`13435`) — variante de base, débloqué niv. 1, grade 3

> Pose une Bombe qui peut occasionner des dommages Air et retirer des PM selon son Combo en zone à son explosion. • Combo I à IV : -1 PM • Combo V à IX : -2 PM • Combo X à XV : -3 PM • Mur d'Air : -2 PM  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.  Le coût en PA du sort augmente de 1 pour chaque Tornabombe du lanceur présente sur le terrain.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 0 %
- Effets exécutés :
  - Pose une bombe Tornabombe (3113) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - [Explosion — 13467, grade 3] Dommages Air 17 à 19 en cercle r2 sans centre + retrait PM esquivable (1 tour) selon le Combo de la bombe : I–IV -1, V–IX -2, X–XV -3 (sous-sort 25590 → 20681 niv.1/2/3)
  - [Réaction en chaîne — 13460] bombes du lanceur à ≤ 2 cases + Tornabombes alignées à ≤ 7 cases
  - [Mur d’Air — 13461] 24 à 27 Air pendant le tour du Roublard, 12 à 14 sinon, + -2 PM (20681 niv.2)
  - [Sur une entité — 13459] Air 17 à 19 en cercle r2 + -1 PM ; +1 Combo/explosion si bombe du lanceur
  - [Allumage] +1 PA au coût de Tornabombe par Tornabombe vivante ; naît en Combo I
- Grades : g1 (niv 1) vs g3: Pose une bombe Tornabombe (3113) grade 1 (g1) → Pose une bombe Tornabombe (3113) grade 3 (g3) | g2 (niv 67) vs g3: Pose une bombe Tornabombe (3113) grade 2 (g2) → Pose une bombe Tornabombe (3113) grade 3 (g3)
- Rôle : aoe, bomb, damage, mp_removal
- **Analyse tactique** : Bombe Air, la seule source de retrait PM de zone récurrent (jusqu’à -3 PM en Combo X+). Indispensable en rôle entrave ; Kaboom : +1 PM aux alliés.

#### Tornabombe Résiliente (`13474`) — variante alternative, débloqué niv. 100, grade 2

> Pose une Bombe qui peut occasionner des dommages Air et retirer des PM selon son Combo en zone à son explosion. • Combo I à IV : -1 PM • Combo V à IX : -2 PM • Combo X à XV : -3 PM • Mur d'Air : -2 PM  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 1 lancer(s)/tour, cumul max 1, CC 0 %
- Effets exécutés :
  - Pose une bombe Tornabombe (3113) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - Explosion/chaîne/mur/« sur entité » identiques à la Tornabombe (13467/13460/13461/13459) ; +40 % vitalité, coût fixe
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +40% Vitalité — cibles: alliés [groupe du lanceur; apparaissant]; infini
- Grades : g1 (niv 100) vs g2: Pose une bombe Tornabombe (3113) grade 2 (g1) → Pose une bombe Tornabombe (3113) grade 3 (g2)
- Rôle : aoe, bomb, damage, mp_removal
- **Analyse tactique** : Version durable (1/tour). Un seul exemplaire suffit souvent pour le retrait PM.


### Paire 3 — Bombe à Eau / Bombe à Eau Résiliente

#### Bombe à Eau (`13436`) — variante de base, débloqué niv. 1, grade 3

> Pose une Bombe qui peut occasionner des dommages Eau et retirer des PA selon son Combo en zone à son explosion. • Combo I à IV : -0 PA • Combo V à IX : -1 PA • Combo X à XV : -2 PA  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.  Le mur de Bombes à Eau retire des PA uniquement aux entités qui le traversent ou commencent leur tour à l'intérieur. • Mur d'Eau : -2 PA  Le coût en PA du sort augmente de 1 pour chaque Bombe à Eau du lanceur présente sur le terrain.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 0 %
- Effets exécutés :
  - Pose une bombe Bombe à Eau (3114) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - [Explosion — 13462, grade 3] Dommages Eau 17 à 19 en cercle r2 sans centre + retrait PA esquivable (1 tour) selon le Combo : I–IV 0, V–IX -1, X–XV -2 (25589 → 20680 niv.1/2)
  - [Réaction en chaîne — 13464] bombes du lanceur à ≤ 2 cases + Bombes à Eau alignées à ≤ 7 cases
  - [Mur d’Eau — 13465] 24 à 27 Eau pendant le tour du Roublard, 12 à 14 sinon ; hors tour du Roublard : -2 PA (20680 niv.2) aux entités qui le traversent/y commencent leur tour
  - [Sur une entité — 13463] Eau 17 à 19 en cercle r2 ; +1 Combo/explosion si bombe du lanceur
  - [Allumage] +1 PA au coût de Bombe à Eau par Bombe à Eau vivante ; naît en Combo I
- Grades : g1 (niv 1) vs g3: Pose une bombe Bombe à Eau (3114) grade 1 (g1) → Pose une bombe Bombe à Eau (3114) grade 3 (g3) | g2 (niv 68) vs g3: Pose une bombe Bombe à Eau (3114) grade 2 (g2) → Pose une bombe Bombe à Eau (3114) grade 3 (g3)
- Rôle : aoe, ap_removal, bomb, damage
- **Analyse tactique** : Bombe Eau : retrait PA en zone à partir du Combo V (-1) et X (-2) ; Mur d’Eau -2 PA à ceux qui le traversent hors tour du Roublard. Kaboom : +1 PA aux alliés (très fort).

#### Bombe à Eau Résiliente (`13478`) — variante alternative, débloqué niv. 105, grade 2

> Pose une Bombe qui peut occasionner des dommages Eau et retirer des PA selon son Combo en zone à son explosion. • Combo I à IV : -0 PA • Combo V à IX : -1 PA • Combo X à XV : -2 PA  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.  Le mur de Bombes à Eau retire des PA uniquement aux entités qui le traversent ou commencent leur tour à l'intérieur. • Mur d'Eau : -2 PA

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 1 lancer(s)/tour, cumul max 1, CC 0 %
- Effets exécutés :
  - Pose une bombe Bombe à Eau (3114) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - Explosion/chaîne/mur/« sur entité » identiques à la Bombe à Eau (13462/13464/13465/13463) ; +40 % vitalité, coût fixe
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +40% Vitalité — cibles: alliés [groupe du lanceur; apparaissant]; infini
- Grades : g1 (niv 105) vs g2: Pose une bombe Bombe à Eau (3114) grade 2 (g1) → Pose une bombe Bombe à Eau (3114) grade 3 (g2)
- Rôle : aoe, ap_removal, bomb, damage
- **Analyse tactique** : Version durable.


### Paire 4 — Sismobombe / Sismobombe Résiliente

#### Sismobombe (`13491`) — variante de base, débloqué niv. 1, grade 3

> Pose une Bombe qui peut occasionner des dommages Terre en zone à son explosion.  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.  Le coût en PA du sort augmente de 1 pour chaque Sismobombe du lanceur présente sur le terrain.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 0 %
- Effets exécutés :
  - Pose une bombe Sismobombe (5161) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - [Explosion — 13504, grade 3] Dommages Terre 20 à 22 en cercle r2 sans centre ; si le Roublard a l’état Oblitération (3433) : +1 rang d’Oblitération (+10 dégâts de base au sort 13469)
  - [Réaction en chaîne — 13502] bombes du lanceur à ≤ 2 cases + Sismobombes alignées à ≤ 7 cases
  - [Mur de Terre — 13501] 24 à 27 Terre pendant le tour du Roublard, 12 à 14 sinon
  - [Sur une entité — 13503] Terre 20 à 22 en cercle r2 ; +1 Combo/explosion si bombe du lanceur ; alimente Oblitération
  - [Allumage] +1 PA au coût de Sismobombe par Sismobombe vivante ; naît en Combo I
- Grades : g1 (niv 1) vs g3: Pose une bombe Sismobombe (5161) grade 1 (g1) → Pose une bombe Sismobombe (5161) grade 3 (g3) | g2 (niv 69) vs g3: Pose une bombe Sismobombe (5161) grade 2 (g2) → Pose une bombe Sismobombe (5161) grade 3 (g3)
- Rôle : aoe, bomb, damage
- **Analyse tactique** : Bombe Terre (20–22, la plus forte de base) ; chaque explosion de Sismobombe renforce Oblitération. Kaboom : +7 % dommages aux sorts.

#### Sismobombe Résiliente (`13486`) — variante alternative, débloqué niv. 110, grade 2

> Pose une Bombe qui peut occasionner des dommages Terre en zone à son explosion.  Sur une cible : applique les effets de la Bombe en zone. N'affecte pas le lanceur. Ajoute également 1 Combo et déclenche l'explosion d'une Bombe si la cible est une de ses Bombes.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 1 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Pose une bombe Sismobombe (5161) grade 3 — cibles: alliés/ennemis
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - Explosion/chaîne/mur/« sur entité » identiques à la Sismobombe (13504/13502/13501/13503) ; +40 % vitalité, coût fixe
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +40% Vitalité — cibles: alliés [groupe du lanceur; apparaissant]; infini
- Grades : g1 (niv 110) vs g2: Pose une bombe Sismobombe (5161) grade 2 (g1) → Pose une bombe Sismobombe (5161) grade 3 (g2)
- Rôle : aoe, bomb, damage
- **Analyse tactique** : Version durable.


### Paire 5 — Détonateur / Étoupille

#### Détonateur (`13432`) — variante de base, débloqué niv. 5, grade 3

> Ajoute 1 Combo à une Bombe du lanceur et déclenche son explosion. Rend 1 PA au lanceur avant l'explosion.

- **1 PA**, PO 1–8 (modifiable), sans ligne de vue ; 2 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - le lanceur lance « Détonateur » (20559) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ Applique l'état « Détonateur » (3523) — cibles: lanceur; 1 tour
  - le lanceur lance « Détonateur » (20559) niv.1 — cibles: alliés [avec état « Bombe Collante alliée » (641)]
  - le lanceur lance « Détonateur » (20559) niv.1 — cibles: ennemis [avec état « Bombe Collante ennemie » (665)]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - le lanceur lance « Détonateur » (20559) niv.2 — cibles: lanceur
    - ↳ Rend 1 PA — cibles: lanceur [lanceur avec état « Détonateur » (3523)]
    - ↳ Retire l'état « Détonateur » (3523) — cibles: lanceur [lanceur avec état « Détonateur » (3523)]
  - Fait exploser la bombe — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +1 Combo » (23537) niv.1 — cibles: alliés/ennemis ; Rend 1 PA — cibles: lanceur
- Grades : g1 (niv 5) vs g3: PO max 6 (g1) → 8 (g3) | g2 (niv 72) vs g3: PO max 7 (g2) → 8 (g3)
- Rôle : ap_refund, bomb_trigger, combo
- **Analyse tactique** : Coût net 0 PA (1 PA rendu avant l’explosion), 2/tour, sans ligne de vue, PO 1–8 modifiable : déclencheur principal. +1 Combo avant explosion. Active aussi les Bombes Collantes.

#### Étoupille (`13470`) — variante alternative, débloqué niv. 115, grade 2

> Déclenche l'explosion d'une Bombe du lanceur. Rend 3 PA au lanceur avant l'explosion.

- **1 PA**, PO 1–8 (modifiable), ligne de vue ; 1 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Désenvoûte les effets du sort « Poudre » (13441) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - le lanceur lance « Étoupille » (13510) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ Applique l'état « Étoupille » (3522) — cibles: lanceur; 1 tour
  - le lanceur lance « Étoupille » (13510) niv.1 — cibles: alliés [avec état « Bombe Collante alliée » (641)]
  - le lanceur lance « Étoupille » (13510) niv.1 — cibles: ennemis [avec état « Bombe Collante ennemie » (665)]
  - Retire l'état « Bombe Collante alliée » (641) — cibles: alliés
  - Retire l'état « Bombe Collante ennemie » (665) — cibles: ennemis
  - le lanceur lance « Étoupille » (13510) niv.2 — cibles: lanceur
    - ↳ Rend 3 PA — cibles: lanceur [lanceur avec état « Étoupille » (3522)]
    - ↳ Retire l'état « Étoupille » (3522) — cibles: lanceur [lanceur avec état « Étoupille » (3522)]
  - Fait exploser la bombe — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Rend 3 PA — cibles: lanceur
- Grades : g1 (niv 115) vs g2: PO max 7 (g1) → 8 (g2)
- Rôle : ap_refund, bomb_trigger
- **Analyse tactique** : Rend 3 PA (net +2 PA !) mais 1/tour, avec ligne de vue et SANS +1 Combo. Idéal quand le Combo est déjà haut ou pour financer d’autres sorts.


### Paire 6 — Pulsar / Shrapnel

#### Pulsar (`13442`) — variante de base, débloqué niv. 10, grade 3

> Occasionne des dommages Feu aux ennemis et repousse les cibles vers les extrémités en zone. N'affecte pas le lanceur.

- **3 PA**, PO 0–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Feu 27 à 29 — croix diagonale r1; cibles: ennemis
  - Repousse de 2 case(s) — croix diagonale r1; cibles: alliés sauf lanceur/ennemis
- Coup critique : Dommages Feu 32 à 35
- Grades : g1 (niv 10) vs g3: Dommages Feu 17 à 19 (g1) → Dommages Feu 27 à 29 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 77) vs g3: Dommages Feu 22 à 24 (g2) → Dommages Feu 27 à 29 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : aoe, damage, push
- **Analyse tactique** : Dégâts Feu en croix diagonale + poussée 2 vers l’extérieur (n’affecte pas le lanceur) ; PO 0–6, utile pour pousser des ennemis dans un mur ou sur une bombe.

#### Shrapnel (`14414`) — variante alternative, débloqué niv. 120, grade 2

> Occasionne des dommages Eau aux ennemis en zone. Retire également des PA aux ennemis en zone autour des Bombes du lanceur dans la zone d'effet.

- **2 PA**, PO 1–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 2, CC 10 %
- Effets exécutés :
  - Dommages Eau 17 à 19 — croix r1; cibles: ennemis
  - le lanceur lance « Shrapnel » (14418) niv.1 — croix r1; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
    - ↳ -1 PA (esquivable) — croix sans centre r1; cibles: ennemis; 1 tour
- Coup critique : Dommages Eau 20 à 23
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Shrapnel » (1442) — croix r1; cibles: ennemis; 1 tour ; Retire l'état « Shrapnel » (1442) — croix r1; cibles: ennemis ; -1 PA (esquivable) — croix sans centre r1; cibles: ennemis; 1 tour ; le lanceur lance « Shrapnel » (14418) niv.3 — croix r1; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
- Grades : g1 (niv 120) vs g2: Dommages Eau 14 à 16 (g1) → Dommages Eau 17 à 19 (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : aoe, ap_removal, damage
- **Analyse tactique** : Eau 2 PA en croix + -1 PA autour de chaque bombe du lanceur dans la zone (et dégâts autour d’elles) : bon rapport PA/dégâts près des bombes.


### Paire 7 — Espingole / Oblitération

#### Espingole (`13440`) — variante de base, débloqué niv. 15, grade 3

> Occasionne des dommages Air aux ennemis et repousse les cibles vers les extrémités en zone.

- **3 PA**, PO 1–8 (non modifiable), en diagonale, ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Air 25 à 27 — ligne perpendiculaire r2; cibles: ennemis
  - Repousse de 2 case(s) — ligne perpendiculaire r2; cibles: alliés/ennemis
- Coup critique : Dommages Air 30 à 32
- Grades : g1 (niv 15) vs g3: Dommages Air 15 à 17 (g1) → Dommages Air 25 à 27 (g3) ; PO max 6 (g1) → 8 (g3) | g2 (niv 82) vs g3: Dommages Air 20 à 22 (g2) → Dommages Air 25 à 27 (g3) ; PO max 7 (g2) → 8 (g3)
- Rôle : aoe, damage, push
- **Analyse tactique** : Barre de 5 cases Air perpendiculaire (lancer en diagonale uniquement) + poussée 2 : sort de nettoyage de vague.

#### Oblitération (`13469`) — variante alternative, débloqué niv. 125, grade 2

> Occasionne des dommages Terre. Les dommages sont augmentés après chaque explosion de Sismobombe ou de Bombe Collante.  Sur une Bombe du lanceur : ajoute du Combo pour chaque explosion de Sismobombe ou de Bombe Collante.  Les effets sont retirés après utilisation du sort.

- **4 PA**, PO 1–7 (non modifiable), ligne de vue, case occupée ; 2 lancer(s)/tour, 1/cible, cumul max 5, CC 25 %
- Effets exécutés :
  - Dommages Terre 33 à 37 — cibles: ennemis
  - Dommages Terre 33 à 37 — cibles: alliés [groupe du lanceur; hors bombes élémentaires]
  - Dommages Terre 33 à 37 — cibles: alliés [hors groupe du lanceur]
  - le lanceur lance « Oblitération » (23602) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération I » (3434); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération II » (3435); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération II » (3435); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération III » (3436); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération III » (3436); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération III » (3436); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération IV » (3437); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération IV » (3437); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération IV » (3437); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération IV » (3437); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération V » (3438); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération V » (3438); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération V » (3438); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération V » (3438); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; lanceur avec état « Oblitération V » (3438); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - Désenvoûte les effets du sort « Oblitération » (13511) — cibles: lanceur
- Coup critique : Dommages Terre 40 à 44 ; Dommages Terre 40 à 44 ; Dommages Terre 40 à 44
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Sort « Oblitération » (13469) : +10 dommages de base — cibles: lanceur; infini ; la cible lance sur elle-même « +0 à 5 Combos » (23601) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Grades : g1 (niv 125) vs g2: Dommages Terre 29 à 32 (g1) → Dommages Terre 33 à 37 (g2) ; Dommages Terre 29 à 32 (g1) → Dommages Terre 33 à 37 (g2) ; Dommages Terre 29 à 32 (g1) → Dommages Terre 33 à 37 (g2) ; PO max 6 (g1) → 7 (g2)
- Rôle : damage
- **Analyse tactique** : Mono-cible Terre qui gagne +10 dégâts de base par explosion de Sismobombe/Collante (max +50) ; sur une bombe : convertit ces explosions en Combos. Le plus gros sort direct en fin de chaîne.


### Paire 8 — Botte / Ruse

#### Botte (`13434`) — variante de base, débloqué niv. 20, grade 3

> Applique un bouclier sur les Bombes du lanceur et les pousse depuis le centre en zone. Plus le sort est lancé à proximité d'une Bombe du lanceur, plus elle est poussée.  Pousse les autres entités d'une case seulement. N'affecte pas le lanceur.

- **2 PA**, PO 0–8 (modifiable), lancer en ligne, ligne de vue ; 1 lancer(s)/tour, cumul max 2, CC 0 %
- Effets exécutés :
  - Bouclier = 175% du niveau du lanceur — croix r3; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 2 tours
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r3 (rayon min 3); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r3 (rayon min 3); cibles: ennemis/alliés sauf lanceur [hors bombes]
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r3 (rayon min 3); cibles: alliés/ennemis [hors groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Repousse de 2 case(s) (sans dommages de poussée) — croix r2 (rayon min 2); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r2 (rayon min 2); cibles: ennemis/alliés sauf lanceur [hors bombes]
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r2 (rayon min 2); cibles: alliés/ennemis [hors groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Repousse de 3 case(s) (sans dommages de poussée) — croix r1 (rayon min 1); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r1 (rayon min 1); cibles: ennemis/alliés sauf lanceur [hors bombes]
  - Repousse de 1 case(s) (sans dommages de poussée) — croix r1 (rayon min 1); cibles: alliés/ennemis [hors groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
- Grades : g1 (niv 20) vs g3: PO max 6 (g1) → 8 (g3) | g2 (niv 87) vs g3: PO max 7 (g2) → 8 (g3)
- Rôle : placement, push, shield
- **Analyse tactique** : Repousse les bombes depuis le centre (3/2/1 cases selon la distance) et leur donne 175 % du niveau en bouclier ; les autres entités ne bougent que d’1 case.

#### Ruse (`13472`) — variante alternative, débloqué niv. 130, grade 2

> Rapproche le lanceur vers la cible. Applique également un bouclier si la cible est une Bombe du lanceur.

- **2 PA**, PO 1–6 (non modifiable), lancer en ligne, ligne de vue, case occupée ; 1 lancer(s)/tour, cumul max 2, CC 0 %
- Effets exécutés :
  - Le lanceur avance de 5 case(s) — cibles: alliés/ennemis
  - Bouclier = 225% du niveau du lanceur — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 2 tours
- Grades : g1 (niv 130) vs g2: Le lanceur avance de 4 case(s) (g1) → Le lanceur avance de 5 case(s) (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : self_move, shield
- **Analyse tactique** : Rapproche le lanceur de 5 cases vers la cible (mobilité) ; bouclier 225 % si la cible est une bombe.


### Paire 9 — Recel / Plombage

#### Recel (`13477`) — variante de base, débloqué niv. 25, grade 3

> Occasionne des dommages Eau aux ennemis et attire la cible.

- **3 PA**, PO 1–6 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 15 %
- Effets exécutés :
  - Dommages Eau 28 à 30 — cibles: ennemis
  - Attire de 2 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Eau 34 à 36
- Grades : g1 (niv 25) vs g3: Dommages Eau 17 à 19 (g1) → Dommages Eau 28 à 30 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 92) vs g3: Dommages Eau 23 à 25 (g2) → Dommages Eau 28 à 30 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : damage, pull
- **Analyse tactique** : Eau + attire 2 : rapproche un ennemi d’une bombe/d’un mur ; 3/tour.

#### Plombage (`13488`) — variante alternative, débloqué niv. 135, grade 1

> Occasionne des dommages Feu aux ennemis.  Sur une Bombe élémentaire du lanceur : occasionne des dommages Feu aux ennemis situés entre deux Bombes élémentaires alignées et ajoute 1 Combo à ces Bombes.  Le Combo ne s'applique qu'une seule fois par Bombe par tour.

- **3 PA**, PO 1–5 (modifiable), ligne de vue, case occupée ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Feu 30 à 34 — cibles: ennemis
  - la cible lance sur elle-même « Plombage » (23698) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ Applique l'état « Plombage Caster » (3452) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]; 1 tour
    - ↳ Applique l'état « Plombage Touché » (3453) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]; 1 tour
    - ↳ la cible lance sur elle-même « Plombage » (23698) niv.2 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
      - ↳ la cible lance sur elle-même « Plombage » (23698) niv.3 — cibles: lanceur
  - le lanceur lance « Plombage » (23698) niv.10 — cibles: lanceur
    - ↳ Dommages Feu 30 à 34 — toute la carte; cibles: ennemis [avec état « Plombage » (2498)]
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Plombage Caster » (3452); sans état « Plombage (cumul Combo) » (2524); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ Applique l'état « Plombage (cumul Combo) » (2524) — toute la carte; cibles: alliés [groupe du lanceur; avec état « Plombage Caster » (3452); sans état « Plombage (cumul Combo) » (2524); ses bombes élémentaires]; 1 tour; non désenvoûtable
  - le lanceur lance « Plombage » (23694) niv.1 — cibles: lanceur
    - ↳ Retire l'état « Plombage » (2498) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Bombe 1 (Plombage) » (3449) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Bombe 2 (Plombage) » (3450) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Bombe 3 (Plombage) » (3451) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Plombage Caster » (3452) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Plombage Touché » (3453) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Plombage Transfert Caster » (3454) — toute la carte; cibles: alliés/ennemis
- Coup critique : Dommages Feu 37 à 42
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « +1 Combo » (23537) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Rôle : aoe, combo, damage
- **Analyse tactique** : Feu 30–34 ; sur une bombe : frappe les ennemis entre deux bombes alignées (+1 Combo à ces bombes).


### Paire 10 — Bombarde / Mitraille

#### Bombarde (`14415`) — variante de base, débloqué niv. 30, grade 3

> Occasionne des dommages Terre aux ennemis et repousse les cibles en zone.

- **3 PA**, PO 1–6 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Terre 26 à 28 — ligne perpendiculaire r2; cibles: ennemis
  - le lanceur lance « Bombarde » (14416) niv.1 — ligne perpendiculaire r2; cibles: alliés/ennemis
    - ↳ Repousse de 1 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Terre 31 à 34
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Repousse de 1 case(s) — cibles: alliés/ennemis
- Grades : g1 (niv 30) vs g3: Dommages Terre 16 à 18 (g1) → Dommages Terre 26 à 28 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 97) vs g3: Dommages Terre 21 à 23 (g2) → Dommages Terre 26 à 28 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : aoe, damage, push
- **Analyse tactique** : Terre en barre de 5 (lancer en ligne) + poussée 1.

#### Mitraille (`13483`) — variante alternative, débloqué niv. 140, grade 1

> Occasionne des dommages Air et retire des PM.

- **4 PA**, PO 1–6 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 25 %
- Effets exécutés :
  - Dommages Air 34 à 38 — cibles: alliés/ennemis
  - -3 PM (esquivable) — cibles: alliés/ennemis; 1 tour
- Coup critique : Dommages Air 41 à 46
- Rôle : damage, mp_removal
- **Analyse tactique** : Air 34–38 et -3 PM (esquivable) ; touche aussi les alliés : ne pas viser un allié !


### Paire 11 — Aimantation / Croisement

#### Aimantation (`13437`) — variante de base, débloqué niv. 35, grade 3

> Attire les Bombes du lanceur vers le centre et leur ajoute 1 Combo en zone. Le Combo ne s'applique qu'une seule fois par Bombe par tour et si les Bombes sont déplacées.  Attire les autres entités d'une case seulement. N'affecte pas le lanceur.

- **2 PA**, PO 0–7 (modifiable), sans ligne de vue, case occupée ; 2 lancer(s)/tour, 1/cible, CC 0 %
- Effets exécutés :
  - le lanceur lance « Aimantation » (20676) niv.1 — croix r6 (rayon min 1); cibles: alliés sauf lanceur [groupe du lanceur; ses bombes élémentaires]; déclenché quand le porteur est attiré (déclencheur actif 1 tour(s))
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ Désenvoûte les effets du sort « Aimantation » (13437) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - Applique l'état « Aimantation » (2136) — croix r6 (rayon min 1); cibles: alliés sauf lanceur [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 1 tour; non désenvoûtable
  - la cible lance sur sa cellule « Aimantation » (18652) niv.3 — cibles: lanceur [pas classe 12]
    - ↳ Attire de 6 case(s) — croix r6 (rayon min 1); cibles: alliés/ennemis [avec état « Aimantation » (2136)]
    - ↳ Attire de 1 case(s) — croix r6 (rayon min 1); cibles: alliés sauf lanceur/ennemis [sans état « Aimantation » (2136)]
    - ↳ Retire l'état « Aimantation » (2136) — toute la carte; cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +1 Combo » (23537) niv.1 — croix r6 (rayon min 1); cibles: alliés sauf lanceur [groupe du lanceur; ses bombes élémentaires] ; Attire de 6 case(s) — croix r6 (rayon min 1); cibles: alliés sauf lanceur [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
- Grades : g1 (niv 35) vs g3: la cible lance sur sa cellule « Aimantation » (18652) niv.1 (g1) → la cible lance sur sa cellule « Aimantation » (18652) niv.3 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 102) vs g3: la cible lance sur sa cellule « Aimantation » (18652) niv.2 (g2) → la cible lance sur sa cellule « Aimantation » (18652) niv.3 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : combo, placement, pull
- **Analyse tactique** : Attire les bombes (6 cases) vers le centre et +1 Combo par bombe déplacée (1 fois/bombe/tour) ; les autres entités ne sont attirées que d’1 case. Clé pour regrouper bombes + ennemis avant explosion.

#### Croisement (`13480`) — variante alternative, débloqué niv. 145, grade 1

> Attire les Bombes du lanceur jusqu'au centre et leur ajoute 1 Combo en zone.  Le Combo ne s'applique qu'une seule fois par Bombe par tour et si les Bombes sont déplacées.

- **2 PA**, PO 0–7 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - le lanceur lance « Croisement » (20677) niv.1 — croix r3 (rayon min 1); cibles: alliés sauf lanceur [groupe du lanceur; ses bombes élémentaires]; déclenché quand le porteur est attiré (déclencheur actif 1 tour(s))
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ Désenvoûte les effets du sort « Croisement » (13480) — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
  - le lanceur lance « Croisement » (20677) niv.1 — croix diagonale r3 (rayon min 1); cibles: alliés sauf lanceur [groupe du lanceur; ses bombes élémentaires]; déclenché quand le porteur est attiré (déclencheur actif 1 tour(s))
  - Applique l'état « Croisement / Piège Magnétique » (3691) — croix r3 (rayon min 1); cibles: alliés [groupe du lanceur; sans état « Croisement » (2501); ses bombes élémentaires]; 1 tour; non désenvoûtable
  - Applique l'état « Croisement / Piège Magnétique » (3691) — croix diagonale r3 (rayon min 1); cibles: alliés [groupe du lanceur; sans état « Croisement » (2501); ses bombes élémentaires]; 1 tour; non désenvoûtable
  - Attire de 1 case(s) — croix sans centre r1 (rayon min 1); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Attire de 2 case(s) — croix sans centre r2 (rayon min 2); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Attire de 3 case(s) — croix sans centre r3 (rayon min 3); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Attire de 2 case(s) — croix diagonale sans centre r1 (rayon min 1); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Attire de 4 case(s) — croix diagonale sans centre r2 (rayon min 2); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Attire de 6 case(s) — croix diagonale sans centre r3 (rayon min 3); cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - Applique l'état « Croisement » (2501) — croix r3 (rayon min 1); cibles: alliés [groupe du lanceur; sans état « Croisement » (2501); ses bombes élémentaires]; 1 tour; non désenvoûtable
  - Applique l'état « Croisement » (2501) — croix diagonale r3 (rayon min 1); cibles: alliés [groupe du lanceur; sans état « Croisement » (2501); ses bombes élémentaires]; 1 tour; non désenvoûtable
  - Retire l'état « Croisement / Piège Magnétique » (3691) — croix r3 (rayon min 1); cibles: alliés [groupe du lanceur; sans état « Croisement » (2501); ses bombes élémentaires]; 1 tour
  - Retire l'état « Croisement / Piège Magnétique » (3691) — croix diagonale r3 (rayon min 1); cibles: alliés [groupe du lanceur; sans état « Croisement » (2501); ses bombes élémentaires]; 1 tour
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +1 Combo » (23537) niv.1 — étoile r3; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)] ; Attire de 3 case(s) — étoile r3; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
- Rôle : combo, placement, pull
- **Analyse tactique** : Attire les bombes en étoile r3 jusqu’au centre (+1 Combo) : rassemble en un point.


### Paire 12 — Entourloupe / Bombe Ambulante

#### Entourloupe (`13439`) — variante de base, débloqué niv. 40, grade 3

> Ajoute 1 Combo à une Bombe du lanceur, échange de position avec elle et lui applique l'état Pesanteur. Les effets ne s'appliquent que si l'échange de positions peut s'effectuer.  Sur un allié : échange uniquement de position avec la cible.

- **3 PA**, PO 1–6 (modifiable), sans ligne de vue ; relance 3 tour(s), CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; cible et lanceur déplaçables; ses bombes (élémentaires, Ambulante, Méga)]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - Échange de positions avec le lanceur — cibles: alliés [cible et lanceur déplaçables]
  - Applique l'état « Pesanteur » (7) — cibles: alliés [groupe du lanceur; cible et lanceur déplaçables; ses bombes (élémentaires, Ambulante, Méga)]; 1 tour
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +1 Combo » (23537) niv.1 — cibles: alliés [groupe du lanceur; cible et lanceur déplaçables; ses bombes (élémentaires, Ambulante, Méga)]
- Grades : g1 (niv 40) vs g3: PO max 4 (g1) → 6 (g3) | g2 (niv 107) vs g3: PO max 5 (g2) → 6 (g3)
- Rôle : combo, gravity, swap
- **Analyse tactique** : Échange avec une bombe (+1 Combo, Pesanteur sur la bombe) ou un allié ; relance 3. Sauvetage/repositionnement.

#### Bombe Ambulante (`13487`) — variante alternative, débloqué niv. 150, grade 1

> Invoque une Bombe contrôlable qui peut copier l'élément et une partie du Combo d'une Bombe du lanceur.  Elle est détruite à la fin de son deuxième tour de jeu si elle n'a pas obtenu d'élément.

- **2 PA**, PO 1–1 (non modifiable), sans ligne de vue, case libre ; relance 2 tour(s), relance initiale 1, CC 0 %
- Effets exécutés :
  - Invoque (contrôlable) Bombe Ambulante (5162) grade 1 — cibles: alliés/ennemis
  - le lanceur lance « Mimésis » (13493) niv.1 — cibles: alliés/ennemis [apparaissant]
    - ↳ le lanceur lance « Mimésis » (13493) niv.2 — cibles: alliés/ennemis; déclenché en fin de tour (déclencheur actif 2 tour(s))
      - ↳ le lanceur lance « Mimésis » (13493) niv.4 — cibles: alliés/ennemis [avec état « Casemate » (2499); =monstre Bombe Ambulante (5162)]
      - ↳ Tue la cible — cibles: alliés/ennemis [lanceur avec état « Mimésis - Explobombe » (637); =monstre Bombe Ambulante (5162)]
      - ↳ Tue la cible — cibles: alliés/ennemis [lanceur avec état « Mimésis - Tornabombe » (638); =monstre Bombe Ambulante (5162)]
      - ↳ Tue la cible — cibles: alliés/ennemis [lanceur avec état « Mimésis - Bombe à Eau » (639); =monstre Bombe Ambulante (5162)]
      - ↳ Tue la cible — cibles: alliés/ennemis [lanceur avec état « Mimésis - Sismobombe » (640); =monstre Bombe Ambulante (5162)]
      - ↳ Tue la cible — cibles: alliés/ennemis [lanceur avec état « Mimésis - Mégabombe » (6706); =monstre Bombe Ambulante (5162)]
      - ↳ Pose une bombe Explobombe (3112) grade 1 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Explobombe » (637); lanceur avec état « Explobombe rang 1 » (3808)]
      - ↳ Pose une bombe Explobombe (3112) grade 2 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Explobombe » (637); lanceur avec état « Explobombe rang 2 » (3809)]
      - ↳ Pose une bombe Explobombe (3112) grade 3 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Explobombe » (637); lanceur avec état « Explobombe rang 3 » (3810)]
      - ↳ Pose une bombe Tornabombe (3113) grade 1 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Tornabombe » (638); lanceur avec état « Tornabombe rang 1 » (3805)]
      - ↳ Pose une bombe Tornabombe (3113) grade 2 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Tornabombe » (638); lanceur avec état « Tornabombe rang 2 » (3806)]
      - ↳ Pose une bombe Tornabombe (3113) grade 3 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Tornabombe » (638); lanceur avec état « Tornabombe rang 3 » (3807)]
      - ↳ Pose une bombe Bombe à Eau (3114) grade 1 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Bombe à Eau » (639); lanceur avec état « Bombe à Eau rang 1 » (3799)]
      - ↳ Pose une bombe Bombe à Eau (3114) grade 2 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Bombe à Eau » (639); lanceur avec état « Bombe à Eau rang 2 » (3800)]
      - ↳ Pose une bombe Bombe à Eau (3114) grade 3 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Bombe à Eau » (639); lanceur avec état « Bombe à Eau rang 3 » (3801)]
      - ↳ Pose une bombe Sismobombe (5161) grade 1 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Sismobombe » (640); lanceur avec état « Sismobombe rang 1 » (3802)]
      - ↳ Pose une bombe Sismobombe (5161) grade 2 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Sismobombe » (640); lanceur avec état « Sismobombe rang 2 » (3803)]
      - ↳ Pose une bombe Sismobombe (5161) grade 3 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Sismobombe » (640); lanceur avec état « Sismobombe rang 3 » (3804)]
      - ↳ Invoque (contrôlable) Mégabombe (5163) grade 1 — cibles: alliés/ennemis [lanceur avec état « Mimésis - Mégabombe » (6706)]
      - ↳ Retire l'état « Casemate » (2499) — cibles: lanceur
      - ↳ Désenvoûte les effets du sort « Mimésis » (13494) — cibles: lanceur
      - ↳ Retire l'état « Tour Roublard » (2483) — cibles: lanceur
    - ↳ Tue la cible — cibles: alliés/ennemis; après 1 tour(s); déclenché en fin de tour (déclencheur actif 1 tour(s))
- Rôle : bomb, combo, summon
- **Analyse tactique** : Bombe contrôlable qui copie élément + Combos (≤7) d’une bombe : permet une 4e bombe ou de « téléporter » un Combo.


### Paire 13 — Roublabot / Mégabombe

#### Roublabot (`13429`) — variante de base, débloqué niv. 45, grade 3

> Invoque un robot contrôlable qui peut déplacer ou déclencher les Bombes du lanceur. Le robot est détruit à la fin de son tour de jeu.

- **4 PA**, PO 1–1 (non modifiable), sans ligne de vue, case libre ; relance 3 tour(s), relance initiale 1, CC 0 %
- Effets exécutés :
  - Invoque (contrôlable) Roublabot (3120) grade 3 — cibles: alliés/ennemis
- Grades : g1 (niv 45) vs g3: Invoque (contrôlable) Roublabot (3120) grade 1 (g1) → Invoque (contrôlable) Roublabot (3120) grade 3 (g3) | g2 (niv 112) vs g3: Invoque (contrôlable) Roublabot (3120) grade 2 (g2) → Invoque (contrôlable) Roublabot (3120) grade 3 (g3)
- Rôle : bomb_trigger, combo, summon
- **Analyse tactique** : Robot contrôlable (4 PA/9 PM, meurt en fin de tour) : porte/jette/pousse/attire les bombes avec +1 Combo et Détonation 2×/tour.

#### Mégabombe (`13490`) — variante alternative, débloqué niv. 155, grade 1

> Invoque une Mégabombe contrôlable qui peut occasionner des dommages Neutre et dévorer des Bombes pour augmenter ses dommages.  Lorsqu'elle est détruite, elle explose en ajoutant 1 Combo aux Bombes du lanceur et déclenche leur explosion dans un cercle de taille 2.

- **3 PA**, PO 1–1 (non modifiable), sans ligne de vue, case libre ; relance 3 tour(s), CC 0 %
- Effets exécutés :
  - Invoque (contrôlable) Mégabombe (5163) grade 1 — cibles: alliés/ennemis
- Rôle : bomb_trigger, summon
- **Analyse tactique** : Invocation offensive Neutre qui dévore des bombes ; kamikaze final en cercle 2.


### Paire 14 — Dagues Boomerang / Tromblon

#### Dagues Boomerang (`13438`) — variante de base, débloqué niv. 50, grade 3

> Érode les cibles et occasionne des dommages Air en zone.

- **4 PA**, PO 1–7 (non modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, cumul max 2, CC 15 %
- Effets exécutés :
  - +13% Érosion — demi-cercle r2; cibles: alliés/ennemis; 2 tours
  - Dommages Air 16 à 18 — demi-cercle r2; cibles: alliés/ennemis
  - Dommages Air 16 à 18 — demi-cercle r2; cibles: alliés/ennemis
- Coup critique : Dommages Air 19 à 21 ; Dommages Air 19 à 21
- Grades : g1 (niv 50) vs g3: Dommages Air 12 à 14 (g1) → Dommages Air 16 à 18 (g3) ; Dommages Air 12 à 14 (g1) → Dommages Air 16 à 18 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 117) vs g3: Dommages Air 14 à 16 (g2) → Dommages Air 16 à 18 (g3) ; Dommages Air 14 à 16 (g2) → Dommages Air 16 à 18 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : aoe, damage, erosion
- **Analyse tactique** : Air ×2 lignes en demi-cercle r2 + 13 % d’érosion ; touche les alliés.

#### Tromblon (`13449`) — variante alternative, débloqué niv. 160, grade 1

> Érode les cibles et occasionne des dommages Eau en zone.

- **4 PA**, PO 1–5 (non modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, cumul max 2, CC 25 %
- Effets exécutés :
  - +13% Érosion — cône r1; cibles: alliés/ennemis; 2 tours
  - Dommages Eau 35 à 39 — cône r1; cibles: alliés/ennemis
- Coup critique : Dommages Eau 42 à 47
- Rôle : aoe, damage, erosion
- **Analyse tactique** : Eau 35–39 en cône + 13 % d’érosion ; touche les alliés.


### Paire 15 — Roublardise / Stratagème

#### Roublardise (`13431`) — variante de base, débloqué niv. 55, grade 3

> Applique un bouclier sur toutes les Bombes du lanceur.  Crée des illusions du lanceur et le téléporte sur la case ciblée. Termine le tour en cours du lanceur.

- **3 PA**, PO 1–6 (non modifiable), lancer en ligne, sans ligne de vue, case libre ; relance 4 tour(s), CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - le lanceur lance « Roublardise » (20662) niv.1 — cibles: lanceur
    - ↳ Bouclier = 150% du niveau du lanceur — toute la carte; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 1 tour
  - Crée des illusions du lanceur (param 3) — cibles: alliés/ennemis
  - Termine le tour — cibles: lanceur
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Bouclier = 150% du niveau du lanceur — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 1 tour
- Grades : g1 (niv 55) vs g3: PO max 4 (g1) → 6 (g3) | g2 (niv 122) vs g3: PO max 5 (g2) → 6 (g3)
- Rôle : shield, teleport
- **Analyse tactique** : Bouclier sur toutes les bombes, illusions et téléportation (ligne, case libre) puis FIN DU TOUR : sort d’évasion à jouer en dernier.

#### Stratagème (`13476`) — variante alternative, débloqué niv. 165, grade 1

> Téléporte une Bombe du lanceur à sa position précédente et lui applique un bouclier. Le bouclier ne s'applique que si la téléportation peut s'effectuer.

- **1 PA**, PO 1–6 (modifiable), sans ligne de vue, case occupée ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 0 %
- Effets exécutés :
  - le lanceur lance « Stratagème » (25580) niv.1 — cibles: alliés [groupe du lanceur; cible déplaçable; ses bombes (élémentaires, Ambulante, Méga)]; déclenché quand le porteur est téléporté (INCERTAIN) (déclencheur actif 1 tour(s))
    - ↳ Désenvoûte les effets du sort « Stratagème » (13476) — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
    - ↳ Bouclier = 50% du niveau du lanceur — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 2 tours
  - Retour à la position précédente — cibles: alliés [groupe du lanceur; cible déplaçable; ses bombes (élémentaires, Ambulante, Méga)]
  - Désenvoûte les effets du sort « Stratagème » (13476) — cibles: alliés [groupe du lanceur; cible déplaçable; ses bombes (élémentaires, Ambulante, Méga)]
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Bouclier = 50% du niveau du lanceur — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 2 tours
- Rôle : shield, teleport
- **Analyse tactique** : Renvoie une bombe à sa position précédente (annule une poussée ennemie) + bouclier ; 1 PA, 3/tour.


### Paire 16 — Extraction / Cadence

#### Extraction (`13433`) — variante de base, débloqué niv. 60, grade 3

> Vole de la vie dans l'élément Feu. Le vol de vie est réduit de moitié sur les alliés.

- **3 PA**, PO 1–8 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 25 %
- Effets exécutés :
  - Vol de vie Feu 28 à 30 — cibles: ennemis
  - Vol de vie Feu 14 à 15 — cibles: alliés
- Coup critique : Vol de vie Feu 32 à 36 ; Vol de vie Feu 16 à 18
- Grades : g1 (niv 60) vs g3: Vol de vie Feu 16 à 18 (g1) → Vol de vie Feu 28 à 30 (g3) ; Vol de vie Feu 8 à 9 (g1) → Vol de vie Feu 14 à 15 (g3) ; PO max 6 (g1) → 8 (g3) | g2 (niv 127) vs g3: Vol de vie Feu 22 à 24 (g2) → Vol de vie Feu 28 à 30 (g3) ; Vol de vie Feu 11 à 12 (g2) → Vol de vie Feu 14 à 15 (g3) ; PO max 7 (g2) → 8 (g3)
- Rôle : damage, lifesteal
- **Analyse tactique** : Vol de vie Feu 28–30 (moitié sur allié) : sustain.

#### Cadence (`13475`) — variante alternative, débloqué niv. 170, grade 1

> Occasionne des dommages Air aux ennemis en zone. Retire également des PM aux ennemis en zone autour des Bombes du lanceur dans la zone d'effet.

- **3 PA**, PO 1–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 2, CC 15 %
- Effets exécutés :
  - Dommages Air 26 à 28 — croix r1; cibles: ennemis
  - le lanceur lance « Cadence » (13505) niv.1 — croix r1; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
    - ↳ -1 PM (esquivable) — croix sans centre r1; cibles: ennemis; 1 tour
- Coup critique : Dommages Air 31 à 34
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Cadence » (2504) — croix r1; cibles: ennemis; 1 tour ; le lanceur lance « Cadence » (13505) niv.2 — croix r1; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)] ; Retire l'état « Cadence » (2504) — croix r1; cibles: alliés/ennemis ; -1 PM (esquivable) — croix sans centre r1; cibles: ennemis; 1 tour
- Rôle : aoe, damage, mp_removal
- **Analyse tactique** : Air en croix + -1 PM autour des bombes de la zone.


### Paire 17 — Rémission / Casemate

#### Rémission (`13445`) — variante de base, débloqué niv. 65, grade 3

> Applique l'état Rémission sur la cible : • Repousse les attaquants si la cible subit des dommages en mêlée.  Sur une Bombe du lanceur : réduit les dommages reçus à distance.

- **2 PA**, PO 0–8 (non modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 25 %
- Effets exécutés :
  - Applique l'état « Blocage Rémission » (3795) — cibles: ennemis; 1 tour; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 1 tour(s))
  - Applique l'état « Blocage Rémission » (3795) — cibles: alliés [hors bombes]; 1 tour; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 1 tour(s))
  - le lanceur lance « Rémission » (13430) niv.3 — cibles: ennemis; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 1 tour(s))
    - ↳ Retire l'état « Blocage Rémission » (3795) — toute la carte; cibles: alliés/ennemis
    - ↳ Repousse de 6 case(s) — cibles: alliés/ennemis [= cible déclenchante; sans état « Blocage Rémission » (3795)]
  - le lanceur lance « Rémission » (13430) niv.3 — cibles: alliés [hors bombes]; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 1 tour(s))
  - Applique l'état « Rémission » (2512) — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 3 tours
  - Applique l'état « Rémission » (2512) — cibles: alliés [hors bombes]; 1 tour
  - Applique l'état « Rémission » (2512) — cibles: ennemis; 1 tour
  - Réduit les dommages subis de 20 — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 3 tours; déclenché quand le porteur subit des dommages à distance (déclencheur actif 3 tour(s))
- Coup critique : Applique l'état « Rémission » (2512) ; Applique l'état « Rémission » (2512) ; Réduit les dommages subis de 23
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Repousse de 6 case(s) — cibles: alliés/ennemis; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 1 tour(s))
- Grades : g1 (niv 65) vs g3: le lanceur lance « Rémission » (13430) niv.1 (g1) → le lanceur lance « Rémission » (13430) niv.3 (g3) ; le lanceur lance « Rémission » (13430) niv.1 (g1) → le lanceur lance « Rémission » (13430) niv.3 (g3) ; Réduit les dommages subis de 10 (g1) → Réduit les dommages subis de 20 (g3) ; PO max 6 (g1) → 8 (g3) | g2 (niv 131) vs g3: le lanceur lance « Rémission » (13430) niv.2 (g2) → le lanceur lance « Rémission » (13430) niv.3 (g3) ; le lanceur lance « Rémission » (13430) niv.2 (g2) → le lanceur lance « Rémission » (13430) niv.3 (g3) ; Réduit les dommages subis de 15 (g2) → Réduit les dommages subis de 20 (g3) ; PO max 7 (g2) → 8 (g3)
- Rôle : damage_reduction, push
- **Analyse tactique** : Allié/ennemi : repousse de 6 l’attaquant au contact ; sur bombe : -20 dommages subis à distance (3 tours).

#### Casemate (`14412`) — variante alternative, débloqué niv. 175, grade 1

> Rend une Bombe du lanceur Invulnérable et lui ajoute 1 Combo.  Les effets sont transmis à la Bombe issue d'une Ambulante.

- **2 PA**, PO 1–8 (modifiable), ligne de vue ; relance 3 tour(s), CC 0 %
- Effets exécutés :
  - Applique l'état « Invulnérable » (56) — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 1 tour
  - Applique l'état « Casemate » (2499) — cibles: alliés [groupe du lanceur; =monstre Bombe Ambulante (5162)]; 1 tour
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +1 Combo » (23537) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Rôle : combo, invulnerability
- **Analyse tactique** : Bombe Invulnérable 1 tour + 1 Combo : protège la bombe-clé avant l’explosion.


### Paire 18 — Mousquet / Grenaille

#### Mousquet (`13473`) — variante de base, débloqué niv. 70, grade 2

> Occasionne des dommages Terre aux ennemis en zone. Ajoute également 1 Combo aux Bombes du lanceur en zone.  Le Combo ne s'applique qu'une seule fois par Bombe par tour.

- **2 PA**, PO 1–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Terre 19 à 21 — croix r1; cibles: ennemis
  - le lanceur lance « Mousquet » (20643) niv.1 — croix r1; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; sans état « Mousquet (cumul Combo) » (2523); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ Applique l'état « Mousquet (cumul Combo) » (2523) — cibles: alliés [groupe du lanceur; sans état « Mousquet (cumul Combo) » (2523); ses bombes élémentaires]; 1 tour; non désenvoûtable
- Coup critique : Dommages Terre 23 à 25
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Mousquet » (20643) niv.2 — croix r1; cibles: alliés/ennemis ; la cible lance sur elle-même « +1 Combo » (23537) niv.1 — croix r1; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Grades : g1 (niv 70) vs g2: Dommages Terre 15 à 17 (g1) → Dommages Terre 19 à 21 (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : aoe, combo, damage
- **Analyse tactique** : Terre en croix 2 PA + 1 Combo aux bombes de la zone (1/bombe/tour) : rentable pour monter le Combo.

#### Grenaille (`14411`) — variante alternative, débloqué niv. 180, grade 1

> Vole de la vie dans l'élément Feu en zone. Le vol de vie est réduit de moitié sur les alliés.  N'affecte pas le lanceur.

- **4 PA**, PO 0–5 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Vol de vie Feu 30 à 34 — croix r1; cibles: ennemis
  - Vol de vie Feu 15 à 17 — croix r1; cibles: alliés sauf lanceur
- Coup critique : Vol de vie Feu 36 à 40 ; Vol de vie Feu 18 à 20
- Rôle : damage, lifesteal
- **Analyse tactique** : Vol de vie Feu en croix (sans LdV).


### Paire 19 — Poudre / Bombe Collante

#### Poudre (`13441`) — variante de base, débloqué niv. 75, grade 2

> Rend une Bombe du lanceur Indéplaçable. Ajoute 2 Combo à la Bombe : • En déclenchant son explosion si elle est détruite. • En retirant les effets du sort s'il est lancé sur une autre Bombe.  Les effets sont retirés si la Bombe est déclenchée par un effet d'explosion.

- **1 PA**, PO 1–8 (modifiable), ligne de vue ; 1 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Désenvoûte les effets du sort « Poudre » (13441) — toute la carte; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
  - la cible lance sur elle-même « Combo » (20497) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Poudre » (2511); ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - la cible lance sur elle-même « Combo » (20497) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Poudre » (2511); ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - Applique l'état « Indéplaçable » (97) — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 2 tours; non désenvoûtable
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]; déclenché à la mort du porteur (déclencheur actif 2 tour(s))
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]; déclenché à la mort du porteur (déclencheur actif 2 tour(s))
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - Fait exploser la bombe — cibles: alliés [groupe du lanceur; ses bombes élémentaires]; déclenché à la mort du porteur (déclencheur actif 2 tour(s))
  - Applique l'état « Poudre » (2511) — cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]; 2 tours; non désenvoûtable
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +2 Combos » (23538) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]; déclenché à la mort du porteur (déclencheur actif 2 tour(s))
- Grades : g1 (niv 75) vs g2: PO max 6 (g1) → 8 (g2)
- Rôle : bomb_trigger, combo, immovable
- **Analyse tactique** : Indéplaçable + 2 Combos à la destruction : protège la position d’une bombe contre les poussées.

#### Bombe Collante (`13479`) — variante alternative, débloqué niv. 185, grade 1

> Pose une Bombe Collante sur la cible. Sur une case libre : pose un piège qui pose une Bombe Collante sur l'entité qui le déclenche ou déclenche l'explosion d'une Bombe du lanceur.  La Bombe peut être activée avec les sorts d'activation ou les explosions de bombe. Lorsqu'elle est activée, elle occasionne des dommages dans le meilleur élément du lanceur et déclenche l'explosion de ses Bombes en zone.  Une Bombe Collante ne peut pas être appliquée sur une Bombe élémentaire.

- **3 PA**, PO 1–6 (modifiable), ligne de vue, case sans piège ; 1 lancer(s)/tour, cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Bombe Collante » (25584) niv.1 — cibles: lanceur
    - ↳ le lanceur lance « Bombe Collante » (25582) niv.2 — cibles: ennemis
      - ↳ Applique l'état « Bombe collé » (4069) — cibles: lanceur; 1 tour
    - ↳ le lanceur lance « Bombe Collante » (25582) niv.2 — cibles: alliés [≠monstre Explobombe (3112); ≠monstre Tornabombe (3113); ≠monstre Bombe à Eau (3114); ≠monstre Sismobombe (5161); ≠monstre Bombola (4146); ≠monstre Exploboum (3523); ≠monstre Mégabombe (5163); ≠monstre Bombe Ambulante (5162)]
    - ↳ le lanceur lance « Bombe Collante » (25582) niv.1 — cibles: ennemis
      - ↳ le lanceur lance « Bombe Collante » (13507) niv.1 — cibles: alliés [hors bombes élémentaires]; déclenché quand l'état « Bombe Collante alliée » (641) est retiré (déclencheur actif 63 tour(s))
      - ↳ le lanceur lance « Bombe Collante » (13507) niv.1 — cibles: ennemis; déclenché quand l'état « Bombe Collante ennemie » (665) est retiré (déclencheur actif 63 tour(s))
      - ↳ Applique l'état « Bombe Collante alliée » (641) — cibles: alliés [hors bombes élémentaires]; infini
      - ↳ Applique l'état « Bombe Collante ennemie » (665) — cibles: ennemis [sans état « Bombe Collante ennemie » (665)]; infini
      - ↳ Applique l'état « Bombe Collante » (2515) — cibles: ennemis [sans état « Bombe Collante » (2515)]; infini
      - ↳ Applique l'état « Bombe Collante » (2515) — cibles: alliés [hors bombes élémentaires]; infini
      - ↳ Fait exploser la bombe — cibles: alliés [groupe du lanceur; lanceur sans état « Bombe collé » (4069); ses bombes élémentaires]
    - ↳ le lanceur lance « Bombe Collante » (25582) niv.1 — cibles: alliés [≠monstre Explobombe (3112); ≠monstre Tornabombe (3113); ≠monstre Bombe à Eau (3114); ≠monstre Sismobombe (5161); ≠monstre Bombola (4146); ≠monstre Exploboum (3523); ≠monstre Mégabombe (5163); ≠monstre Bombe Ambulante (5162)]
    - ↳ le lanceur lance « Bombe Collante » (25584) niv.4 — cibles: alliés [monstre ∈ {Explobombe (3112), Tornabombe (3113), Bombe à Eau (3114), Sismobombe (5161), Bombola (4146), Exploboum (3523), Mégabombe (5163), Bombe Ambulante (5162)}]
      - ↳ Applique l'état « Bombe collé » (4069) — cibles: lanceur; 1 tour
  - la cible lance sur sa cellule « Bombe Collante » (25584) niv.2 — cibles: lanceur
    - ↳ la cible lance sur sa cellule « Bombe Collante » (25591) niv.1 — cibles: lanceur [lanceur sans état « Bombe collé » (4069)]
      - ↳ Pose un piège lançant « Bombe Collante » (25582) niv.1 — cibles: alliés/ennemis [lanceur sans état « Bombe collé » (4069)]
    - ↳ Retire l'état « Bombe collé » (4069) — cibles: lanceur [lanceur avec état « Bombe collé » (4069)]
  - Retire l'état « Bombe collé » (4069) — cibles: lanceur
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Pose un piège lançant « Bombe Collante » (25582) niv.1 — cibles: alliés/ennemis ; Applique l'état « Bombe Collante » (2515) — cibles: alliés/ennemis [sans état « Bombe Collante » (2515); hors bombes élémentaires]; infini ; Dommages meilleur élément 17 à 19 — cibles: alliés/ennemis [=monstre monstre #99999]
- Rôle : bomb_trigger, damage, state, trap
- **Analyse tactique** : Colle une bombe sur un ennemi (ou piège) : l’explosion suit la cible, utile contre des monstres mobiles.


### Paire 20 — Resquille / Arquebuse

#### Resquille (`13443`) — variante de base, débloqué niv. 80, grade 2

> Occasionne des dommages Eau et retire des PA en zone. N'affecte pas le lanceur.  Sur des Bombes du lanceur : les téléporte symétriquement par rapport au centre de la zone.

- **4 PA**, PO 0–2 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 15 %
- Effets exécutés :
  - Dommages Eau 33 à 37 — anneau r2; cibles: ennemis
  - Dommages Eau 33 à 37 — anneau r2; cibles: alliés sauf lanceur [hors groupe du lanceur]
  - Dommages Eau 33 à 37 — anneau r2; cibles: alliés sauf lanceur [groupe du lanceur; hors bombes]
  - -2 PA (esquivable) — anneau r2; cibles: ennemis; 1 tour
  - -2 PA (esquivable) — anneau r2; cibles: alliés sauf lanceur [hors groupe du lanceur]; 1 tour
  - -2 PA (esquivable) — anneau r2; cibles: alliés sauf lanceur [groupe du lanceur; hors bombes]; 1 tour
  - Téléportation symétrique par rapport au point d'impact — anneau r2; cibles: alliés [groupe du lanceur; ses bombes (élémentaires, Ambulante, Méga)]
- Coup critique : Dommages Eau 40 à 44 ; Dommages Eau 40 à 44 ; Dommages Eau 40 à 44
- Grades : g1 (niv 80) vs g2: Dommages Eau 27 à 30 (g1) → Dommages Eau 33 à 37 (g2) ; Dommages Eau 27 à 30 (g1) → Dommages Eau 33 à 37 (g2) ; Dommages Eau 27 à 30 (g1) → Dommages Eau 33 à 37 (g2)
- Rôle : aoe, ap_removal, damage, teleport
- **Analyse tactique** : Eau en anneau r2 (-2 PA) autour du lanceur/case + téléportation symétrique des bombes : réorganise le terrain.

#### Arquebuse (`13482`) — variante alternative, débloqué niv. 190, grade 1

> Réduit la durée des effets sur la cible et occasionne des dommages Terre aux ennemis.

- **4 PA**, PO 1–6 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 15 %
- Effets exécutés :
  - Réduit la durée des effets de 1 tour(s) — cibles: alliés/ennemis
  - Dommages Terre 35 à 39 — cibles: ennemis
- Coup critique : Dommages Terre 42 à 47
- Rôle : damage, shorten_effects
- **Analyse tactique** : Terre 35–39 + réduit d’1 tour la durée des effets de la cible (désenvoûtement partiel) — anti-boucliers/buffs du boss.


### Paire 21 — Dernier Souffle / Piège Magnétique

#### Dernier Souffle (`13446`) — variante de base, débloqué niv. 85, grade 2

> Réduit la Vitalité maximale du lanceur pour ajouter temporairement 3 Combo à ses Bombes.

- **2 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 3 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - -50% Vitalité — cibles: lanceur; 2 tours
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - la cible lance sur elle-même « Combo » (20497) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
  - la cible lance sur elle-même « Combo » (20502) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]; après 2 tour(s)
    - ↳ -1 Combo (redescend d’un état Combo)
  - la cible lance sur elle-même « Combo » (20502) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]; après 2 tour(s)
    - ↳ -1 Combo (redescend d’un état Combo)
  - la cible lance sur elle-même « Combo » (20502) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]; après 2 tour(s)
    - ↳ -1 Combo (redescend d’un état Combo)
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +3 Combos » (23540) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]; 2 tours ; la cible lance sur elle-même « -3 Combos » (23539) niv.1 — cercle r9; cibles: alliés [groupe du lanceur; ses bombes élémentaires]; après 2 tour(s)
- Rôle : combo
- **Analyse tactique** : -50 % vitalité max pendant 2 tours pour +3 Combos (2 tours) sur toutes les bombes dans 9 cases : pic de dégâts.

#### Piège Magnétique (`13484`) — variante alternative, débloqué niv. 195, grade 1

> Pose un piège mono-cellule qui attire les cibles, ajoute 1 Combo aux Bombes du lanceur et déclenche leur explosion en zone.

- **3 PA**, PO 1–8 (modifiable), sans ligne de vue, case libre, case sans piège ; 1 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Pose un piège lançant « Piège Magnétique » (13485) niv.1 — cibles: alliés/ennemis
    - ↳ Désenvoûte les effets du sort « Poudre » (13441) — cercle r3; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ Attire de 2 case(s) — cercle r3; cibles: alliés/ennemis
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cercle r3; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; avec état « Aimantation » (2136); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; avec état « Croisement / Piège Magnétique » (3691); ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ Fait exploser la bombe — cercle r3; cibles: alliés [groupe du lanceur; ses bombes élémentaires + Mégabombe]
- Rôle : bomb_trigger, combo, pull, trap
- **Analyse tactique** : Piège mono-case : attire en cercle 3, +1 Combo et explosion des bombes en cercle 3 quand un ennemi marche dessus.


### Paire 22 — Kaboom / Imposture

#### Kaboom (`13450`) — variante de base, débloqué niv. 90, grade 2

> Applique l'état Kaboom sur les alliés en zone.  Sur des Bombes élémentaires du lanceur : ajoute 1 Combo.

- **3 PA**, PO 0–5 (modifiable), sans ligne de vue ; relance 3 tour(s), CC 0 %
- Effets exécutés :
  - Applique l'état « Kaboom » (92) — croix r2; cibles: alliés [hors bombes élémentaires]; 2 tours
  - la cible lance sur elle-même « Combo » (20497) niv.1 — croix r2; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
    - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur elle-même « +1 Combo » (23537) niv.1 — croix r2; cibles: alliés [groupe du lanceur; ses bombes élémentaires]
- Grades : g1 (niv 90) vs g2: PO max 3 (g1) → 5 (g2)
- Rôle : ally_buff, combo, state
- **Analyse tactique** : Kaboom en croix r2 sur les alliés (2 tours) + 1 Combo aux bombes de la zone ; relance 3. À poser avant une chaîne qui touche les alliés.

#### Imposture (`13489`) — variante alternative, débloqué niv. 200, grade 1

> Échange de positions avec la cible et applique l'état Kaboom sur le lanceur. • Sur un allié : lui applique également l'état. • Sur une Bombe élémentaire du lanceur : ajoute 1 Combo à la Bombe. Applique l'état Imposture sur le lanceur et l'allié ciblé au tour suivant, empêchant l'application de l'état Kaboom.  Le Combo et l'état Kaboom ne s'appliquent que si l'échange de positions peut s'effectuer.

- **3 PA**, PO 1–3 (non modifiable), ligne de vue, case occupée ; 1 lancer(s)/tour, CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - le lanceur lance « Imposture » (20673) niv.1 — cibles: alliés [groupe du lanceur; cible et lanceur déplaçables; ses bombes élémentaires]; déclenché quand le porteur échange de position (déclencheur actif 1 tour(s))
    - ↳ Désenvoûte les effets du sort « Imposture » (13489) — cibles: alliés
    - ↳ la cible lance sur elle-même « Combo » (20497) niv.1 — cibles: alliés [groupe du lanceur; ses bombes élémentaires]
      - ↳ +1 Combo à la bombe (passe à l’état Combo suivant, cf. §3.1)
    - ↳ Applique l'état « Kaboom » (92) — cibles: lanceur/alliés [sans état « Imposture » (4068); hors bombes élémentaires]; 1 tour
    - ↳ Applique l'état « Imposture » (4068) — cibles: lanceur/alliés [sans état « Imposture » (4068); hors bombes élémentaires]; 1 tour, après 1 tour(s)
  - le lanceur lance « Imposture » (20673) niv.2 — cibles: alliés [hors groupe du lanceur; cible et lanceur déplaçables]; déclenché quand le porteur échange de position (déclencheur actif 1 tour(s))
    - ↳ Désenvoûte les effets du sort « Imposture » (13489) — cibles: alliés
    - ↳ Applique l'état « Kaboom » (92) — cibles: lanceur/alliés [sans état « Imposture » (4068); hors bombes élémentaires]; 1 tour
    - ↳ Applique l'état « Imposture » (4068) — cibles: lanceur/alliés [sans état « Imposture » (4068); hors bombes élémentaires]; 1 tour, après 1 tour(s)
  - le lanceur lance « Imposture » (20673) niv.2 — cibles: alliés [groupe du lanceur; cible et lanceur déplaçables; hors bombes élémentaires]; déclenché quand le porteur échange de position (déclencheur actif 1 tour(s))
  - le lanceur lance « Imposture » (20673) niv.2 — cibles: ennemis [cible et lanceur déplaçables]; déclenché quand le porteur échange de position (déclencheur actif 1 tour(s))
  - Échange de positions avec le lanceur — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Kaboom » (92) — cibles: lanceur/alliés [cible et lanceur déplaçables; hors bombes élémentaires]; 1 tour ; la cible lance sur elle-même « +1 Combo » (23537) niv.1 — cibles: alliés [groupe du lanceur; cible et lanceur déplaçables; ses bombes élémentaires] ; Applique l'état « Imposture » (4068) — cibles: lanceur/alliés [cible et lanceur déplaçables; hors bombes élémentaires]; 1 tour, après 1 tour(s)
- Rôle : ally_buff, combo, swap
- **Analyse tactique** : Échange avec la cible + Kaboom (1 tour) ; +1 Combo si bombe.


## 5. Choix des variantes (« sets de sorts ») par rôle

### Set « Artificier » (DPS zone, recommandé PvM)

Maximiser les explosions en chaîne et les murs : bombes de base (2 poses/tour), Détonateur (0 PA net + Combo), Aimantation/Mousquet/Kaboom pour monter les Combos, Dernier Souffle pour le pic, Oblitération en finisher Terre.

| Paire | Choix | Pourquoi |
|---|---|---|
| 1 | Explobombe | 2 poses/tour, murs de Feu |
| 2 | Tornabombe | retrait PM de zone |
| 3 | Bombe à Eau | retrait PA, Kaboom +1 PA |
| 4 | Sismobombe | meilleure base 20–22 |
| 5 | Détonateur | coût net 0, +1 Combo |
| 6 | Pulsar | zone Feu + poussée vers les murs |
| 7 | Oblitération | finisher Terre à rampe |
| 8 | Botte | replace les bombes + bouclier |
| 9 | Recel | attire un ennemi dans la zone |
| 10 | Mitraille | -3 PM mono-cible |
| 11 | Aimantation | regroupe + Combo |
| 12 | Entourloupe | sauvetage, Combo |
| 13 | Roublabot | Combos et détonations gratuites |
| 14 | Tromblon | érosion + Eau |
| 15 | Roublardise | évasion |
| 16 | Extraction | sustain |
| 17 | Casemate | bombe-clé invulnérable |
| 18 | Mousquet | 2 PA, +1 Combo de zone |
| 19 | Poudre | +2 Combos, anti-poussée |
| 20 | Arquebuse | désenvoûtement partiel |
| 21 | Dernier Souffle | +3 Combos |
| 22 | Kaboom | protège et buffe le groupe |

### Set « Contrôleur » (entrave PA/PM, groupe à 4)

Privilégier la durabilité des bombes (Résilientes Air/Eau), le retrait (Mitraille, Cadence, Shrapnel, Resquille) et la protection du groupe (Kaboom, Rémission).

| Paire | Choix | Pourquoi |
|---|---|---|
| 2 | Tornabombe Résiliente | bombe Air durable |
| 3 | Bombe à Eau Résiliente | bombe Eau durable |
| 6 | Shrapnel | -1 PA autour des bombes |
| 10 | Mitraille | -3 PM |
| 16 | Cadence | -1 PM autour des bombes |
| 17 | Rémission | protège un allié au contact |
| 20 | Resquille | -2 PA en anneau |
| 21 | Piège Magnétique | regroupe + explose |


## 6. Rotations types (11–12 PA / 6 PM)

### Tour 1 — mise en place (12 PA)

*Contexte* : Ennemis à 5–8 cases (début de vague), aucun bombe en jeu.

1. Explobombe (2 PA) entre le groupe et les ennemis (Combo I).
2. Tornabombe (2 PA) à ≤2 cases de l’Explobombe (même zone d’explosion, éléments différents → pas de mur mais chaîne).
3. Bombe à Eau (2 PA) idem (3 bombes = limite).
4. Mousquet (2 PA) sur une case qui couvre 2 bombes (+1 Combo chacune, Combo II = +20 %).
5. Kaboom (3 PA) sur les alliés exposés (immunité + bombes de la croix +1 Combo).
6. Poudre (1 PA) sur la bombe la plus exposée aux poussées.

*Résultat attendu* : Au début du tour 2 : +2 Combos → Combo IV–V (+60/+80 %).

### Tour 2 — explosion (12 PA)

*Contexte* : Ennemis entrés dans les cercles de rayon 2 des bombes (ou attirés).

1. Aimantation (2 PA) pour resserrer bombes/ennemis (+1 Combo par bombe déplacée).
2. Dernier Souffle (2 PA) : +3 Combos (→ Combo VIII–IX, ×2,4–2,6).
3. Recel (3 PA) pour attirer un ennemi dans la zone si besoin.
4. Détonateur (1 PA, rendu) sur la bombe centrale : +1 Combo puis explosion → réaction en chaîne (cercle 2 + même élément en ligne 7).
5. Oblitération (4 PA) ou Pulsar (3 PA) avec les PA restants.

*Résultat attendu* : 3 explosions à ×2,6–2,8 en cercle 2 (≈ 50 dégâts de base chacune avant caractéristiques), -2 PM/-1 PA de zone, bonus Kaboom pour les alliés.

### Tour « sans bombe » (12 PA)

*Contexte* : Boss isolé, bombes détruites.

1. Mitraille (4 PA, -3 PM)
2. Oblitération (4 PA)
3. Recel ×1 (3 PA) ou Extraction (3 PA)
4. 1 PA : Poudre/Détonateur selon le terrain.

*Résultat attendu* : ≈ 100–120 dégâts de base mono-cible + retrait PM.


## 7. Forces et faiblesses

**Forces**

- Dégâts de zone parmi les plus élevés du jeu une fois les Combos montés (×4,6 max) et cumulables sur 3 bombes + murs.
- Entrave de zone PA/PM et blocage des lignes de vue/chemins grâce aux bombes (obstacles).
- Économie de PA : Détonateur gratuit, Étoupille +2 PA nets, Roublabot.
- Placement très riche (bombes et ennemis) et buff Kaboom pour tout le groupe.

**Faiblesses**

- Mise en place lente (1–2 tours) : faible en burst immédiat et contre des ennemis qui se dispersent.
- Bombes vulnérables (PV moyens) aux dégâts de zone et aux poussées ennemies ; limite de 3 bombes.
- Explosions et murs blessent les alliés sans Kaboom : contrainte de placement du groupe.
- Dépend fortement de la géométrie de la carte (lignes de 7 cases pour les murs, obstacles).

## 8. Synergies avec les autres classes

- **Iop / Sacrieur / Zobal (tanks de contact)** — Gardent les ennemis groupés au contact dans le cercle 2 des bombes ; Kaboom les protège des explosions.
- **Pandawa / Ouginak / Steamer (attirances)** — Regroupent les ennemis sur les bombes (Gouvernail, Turbine du Steamer, attirances Pandawa).
- **Xélor / Enutrof / Sram (entrave)** — Immobiliser les ennemis dans la zone pendant la montée des Combos.
- **Eniripsa / Féca** — Le Roublard perd 50 % de vitalité avec Dernier Souffle et prend ses propres explosions : soins et boucliers bienvenus.
- **Tous les alliés (Kaboom)** — +1 PA (Bombe à Eau) / +1 PM (Tornabombe) / +3 PO (Explobombe) / +7 % dommages aux sorts (Sismobombe) pour 3 tours si une explosion les touche en état Kaboom.

## 9. Conseils pour l’IA de groupe

- Évaluer chaque bombe comme un « potentiel » = Σ dégâts attendus (ennemis dans cercle 2 au moment prévu de l’explosion) × (1 + bonus Combo).
- Planifier sur 2 tours : poser hors de portée des ennemis qui frappent en zone, exploser quand ≥2 ennemis sont dans la zone.
- Ne jamais faire exploser une bombe si un allié non-Kaboom est dans le cercle 2 sauf si le gain dépasse la perte (score pondéré).
- Utiliser Détonateur en premier (gratuit), Étoupille quand le Combo est déjà ≥ X pour financer d’autres sorts.

### 9.1 Pertinence pour l’Œil de Vortex (démo)

Analyse croisée avec `docs/research/vortex.md` (dossier d’un autre agent) :

- Timing des morts : les monstres doivent mourir à « Même heure » pour être corrompus (docs/research/vortex.md §0). Les bombes posées à l’avance et déclenchées par Détonateur (0 PA net, sans ligne de vue) permettent de tuer **au tour exact voulu** plusieurs monstres d’une vague (N monstres = N joueurs) — atout majeur.
- Le Vortex a ses résistances les plus basses en Feu (12 %) et Neutre (6 %) : Explobombe/Pulsar/Extraction (Feu) et Mégabombe (Neutre) sont pertinents en phase 2.
- Danger : *En temps et en heure* frappe tous les ennemis du Vortex en ligne avec l’Auroraire (pas de LdV requise) ; les bombes (alliées du Roublard) peuvent aussi être touchées → bombes « Résilientes »/Casemate pour les préserver (INCERTAIN : les invocations sont-elles visées ? masque à vérifier dans le sort du Vortex).
- Les vagues réapparaissent sur les cases de départ des monstres (ligne 19) : bombes pré-placées près de cette ligne = dégâts dès l’arrivée (vague invulnérable 1 tour : attendre le tour suivant pour exploser).

## 10. Points incertains

- INCERTAIN — Limite de bombes simultanées (3 historiquement) en Dofus 3 : caractéristique `maxBomb` (93) dont la valeur de base n’est pas exposée.
- INCERTAIN — Interprétation de `bonusCharacteristics` des bombes (PV = 90 % des PV de base du Roublard ? caractéristiques héritées à 100 %).
- INCERTAIN — Choix du sort « sur entité » par élément (13456/13459/13463/13503) déduit de la structure des données (le lien SpellBomb n’est pas exposé par DofusDB).
- INCERTAIN — Ordre exact des explosions en chaîne et dégressivité éventuelle de la zone d’explosion.
- INCERTAIN — Le mur touche-t-il une entité qui ne fait que traverser une case (déplacement) ? D’après les descriptions (Bombe à Eau) oui pour le retrait PA ; supposé oui pour les dommages.
- INCERTAIN — Validation croisée : les dégâts de base de 17 sorts directs du Roublard concordent exactement avec la table de DoMath (domath.fr) ; DoMath affiche Oblitération à 83–87 (= 33–37 + 50, rampe maximale de 5 explosions) et traite la Bombe Collante (meilleur élément) comme Neutre.

## 11. Sources

- https://api.dofusdb.fr/breeds/13 ; https://api.dofusdb.fr/spell-variants?breedId=13 ; spells/spell-levels (ids cités) ; spell-states
- Table des Combos : description du sort 24306 « Combo » (DofusDB)
- Port C# du calcul de dégâts du client (cache .cache/domath/haxe : DamageSender.GetBoostableDamage, DamageCalculator.ExecuteWallDamage, DamageEffectHandler.RedefineBombWall, SpellManager.IsSelectedByMask)
- https://www.gamosaurus.com/?p=94801 (refonte Roublard 2.61), https://www.gamosaurus.com/?p=106817 (2.62 : 2 Combos/tour, 15 paliers)
- https://dofus.jeuxonline.info/article/9058/ruse-roublard (limite historique de 3 bombes)
