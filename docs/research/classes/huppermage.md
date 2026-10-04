# Huppermage — analyse complète pour DofusSimu (breed 17)

> « Mage élémentaliste ». Données : API DofusDB (fichiers du jeu Dofus 3, version **3.6.12.16** d'après
> `https://api.dofusdb.fr/version`, enregistrements de sorts mis à jour jusqu'au 07/07/2026) —
> `https://api.dofusdb.fr/breeds/17`, `spell-variants?breedId=17`, `spells`, `spell-levels`, `spell-states`, `monsters/5129`
> (Gardien Élémentaire) et sorts cachés des types 619 (« Déclenchés Huppermage »), 2435 (« Runes Huppermage »), 2436
> (« Combinaisons élémentaires Huppermage »), 2438 (« Gardien Élémentaire »), 2000 (« Sorts initiaux Huppermage »), 2459
> (infobulles). Cache brut : `.cache/classes/hof/` (décodage intégral : `cdump_17.txt`, runes : `runes.txt`).
> Rôles officiels (`breedRoles`, /10) : **Dégâts 7** (« occasionne d'importants dommages élémentaires et augmente les dommages
> subis par ses ennemis »), **Placement 6**, **Amélioration 6**, Soins 4, Protection 4, Tank 4, Entrave 4, Invocation 2.
> Complexité officielle 4/5.

## 0. Règles moteur communes

Les règles génériques (sélection des cibles « instantanée » au début de chaque lancer, effets `forClientOnly` purement
descriptifs, familles d'effets « lance un sous-sort » 1160/792/2794/2960/1017, grammaire des masques `a,A,c,C,g,E<n>,e<n>,F<n>,*…`,
`statesCriterion` `HS=`/`HS!`, déclencheurs, zones) sont décrites dans `docs/research/classes/roublard.md` §0 et
`docs/research/effects.md`. Elles sont **confirmées** par les données de l'Huppermage : par exemple « Polarité » lance d'abord
le sous-sort qui retire les états élémentaires puis teste `E<état>` pour choisir l'effet de placement — cela ne fonctionne que
si les conditions sont évaluées sur l'instantané pris au début du lancer.

Spécificités utilisées par cette classe :

- **2022 `FightAddRuneCastingSpell`** (« Pose une rune ») : `diceNum` = sort de la rune (13665 Feu, 13688 Eau, 13689 Air,
  13690 Terre), `value` = couleur, `duration` = 2 tours. La rune est une **marque** sur la case de l'ennemi touché.
  **2023 `ForceRuneTrigger`** (« Déclenche les runes ») : déclenche les runes du lanceur sur les cases visées (zone de l'effet).
- **Déclencheurs `CDE`/`CDF`/`CDW`/`CDA`** (Supernova) : « quand le porteur **inflige** des dommages Terre/Feu/Eau/Air »
  (déduit : le buff est posé sur le lanceur et choisit l'élément de la rune posée ensuite). INCERTAIN mais cohérent.
- **2822 / 2832** : dommages dans le **meilleur** / **pire** élément du lanceur (caractéristique élémentaire la plus haute / la plus
  basse parmi Force, Intelligence, Chance, Agilité ; DofusDB `CharacterLifePointsLostFromBestElement/WorstElement`).
- **293** « +X dégâts de base » sur un sort (Torrent Arcanique) ; **1163** « Dommages subis ×N % » ; **1172**
  « −N % dommages finaux » ; **1075** « durée des effets −N » ; **1100** « retour à la position précédente » ;
  **1104/1105/1106** téléportations symétriques (par rapport à la cible / au lanceur / au centre de la zone).

## 1. Vue d'ensemble

- **Profil** : mage **multi-élémentaire** à moyenne portée (1–8 PO). Chaque sort élémentaire offensif (i) inflige des dommages,
  (ii) **pose une rune** de son élément sous l'ennemi touché (2 tours), (iii) applique l'**état élémentaire** de son élément
  (Feu 290, Eau 291, Terre 292, Air 293) à l'ennemi. Quand un ennemi qui porte déjà un état reçoit un **second élément**,
  une **Combinaison Élémentaire** se déclenche (6 combinaisons, §2.3) : +50 Puissance au lanceur (3 tours, une fois par type
  de combinaison) et un malus sur la cible (−2 PA, −3 PM, vol de 3 PO, −60 Fuite, −15 % dommages finaux ou **dommages subis
  ×115 %**), puis les états sont consommés.
- **Runes** : posées sous les ennemis touchés ; déclenchées par Runification/Manifestation (vol de vie 15 + boost de
  caractéristique +50 au lanceur et à l'allié sur la rune, soin 6 % si un allié l'occupe), Surcharge Runique (10 dommages par
  rune sur une cible), Répulsion Runique (poussée), Prisme Runique (effets de zone).
- **Paires de variantes élémentaires** : chaque sort de base mono-cible à 3 PA a une variante « double frappe » (2 lignes de
  dommages, 2 lancers/tour, 1/cible) dans un autre élément : Onde Sismique (Terre) ↔ Tison (Feu), Éther (Air) ↔ Cataracte (Eau),
  Lance-flamme (Feu) ↔ Lances Telluriques (Terre), Stalagmite (Eau) ↔ Onde Céleste (Air). Les sorts à 4 PA de zone (Trait Ardent,
  Glacier, Rafale, Orage) ont des variantes à 2 PA mono-cible avec malus (Stalactite −2 PM, Volcan ×104 %, Brèche −2 PO,
  Ouragan −1 PA).
- **Utilitaires** : Cycle Élémentaire / Courant Quadramental (1 PA remboursé : fait tourner l'état d'un ennemi), Polarité /
  Convection (consomment l'état pour un placement), Propagation (propage un état en zone), Contribution (buff allié selon les
  états des ennemis), Tribut (buff du lanceur), Bouclier Élémentaire (+25 % rés.), Gardien Élémentaire (invocation),
  Sublimation (Pesanteur + boosts aux attaquants), Supernova (combinaison garantie), Torrent Arcanique (finisher qui grossit
  avec les combinaisons).
- **Point clé pour le simulateur** : la valeur de l'Huppermage dépend de l'**état élémentaire porté par chaque ennemi**
  (mémoire persistante, durée infinie), de la position des **runes** (marques 2 tours) et de l'ordre des éléments joués dans
  le tour. L'IA doit planifier des séquences d'éléments (A puis B sur la même cible) et choisir **quelle** combinaison générer
  (ex. Éruption avant que les alliés frappent, Enlisement/Carbonisation pour l'entrave).

## 2. Mécaniques de classe (à implémenter)

### 2.1 États élémentaires (290 Feu, 291 Eau, 292 Terre, 293 Air)

- Appliqués **uniquement aux ennemis** par les sous-sorts « État X » (32391 Terre, 32392 Feu, 32393 Eau, 32394 Air) : effet 950
  avec masque `A,e<X>` (si la cible n'a pas déjà l'état), **durée infinie**, puis lancer immédiat de « Combinaison Élémentaire »
  (13671) sur la même cible.
- Un ennemi ne garde donc en pratique **qu'un seul état** : le deuxième élément différent génère une combinaison qui retire
  les quatre états (sous-sort 32415). Relancer le même élément ne fait rien (déjà présent).
- Les sorts « double frappe » (Tison, Cataracte, Lances Telluriques, Onde Céleste) lancent **deux fois** « État X » : si la
  première application génère une combinaison (consommation), la seconde **ré-applique** l'état X → la cible ressort avec un
  état prêt pour une nouvelle combinaison. Idem pour Supernova (meilleur puis pire élément).
- **Dernière rune** : l'état passif 3502 (posé au début du combat par le sort initial 23959) fait que chaque rune posée
  mémorise son élément sur le lanceur (états 701 Feu, 702 Eau, 703 Terre, 704 Air). Cycle Élémentaire, Courant Quadramental et
  Empreinte utilisent cette mémoire sur les ennemis sans état.
- Sources de changement d'état : Cycle Élémentaire (Terre→Eau→Feu→Air→Terre), Courant Quadramental (Eau→Terre→Air→Feu→Eau),
  Propagation (propage l'état de la cible aux ennemis en cercle 3), Bouclier Élémentaire (état de l'élément subi sur
  l'attaquant), Sublimation, Prisme Runique, runes déclenchées par Runification/Manifestation.

### 2.2 Runes (marques 2022, durée 2 tours)

- **Pose** : chaque sort élémentaire offensif lance, sur chaque **ennemi** touché, le sous-sort « Rune de X » (13687 Feu, 13673
  Eau, 13685 Air, 13686 Terre) qui pose la marque (sort de rune 13665/13688/13689/13690) sur la case de l'ennemi, pour
  **2 tours**, et met à jour la « Dernière rune ». Les alliés touchés ne reçoivent pas de rune. Contribution et Empreinte posent
  aussi des runes, ainsi que le Gardien (Rayon Quadramental, via le lanceur).
- **Déclenchement** : une rune ne se déclenche **pas** au passage d'une entité ; seulement via l'effet 2023 de Runification,
  Manifestation, Surcharge Runique, Répulsion Runique et Prisme Runique (source historique concordante :
  https://dofus.jeuxonline.info/article/14143/rune-huppermage). Le sort de rune est alors lancé **par l'Huppermage** sur la
  case de la rune ; ses effets dépendent des états **posés sur le lanceur** par le sort déclencheur :

| État du lanceur (posé par…) | Effets de chaque rune déclenchée |
|---|---|
| « Rune » 296 + « Rune (rang n) » 6969/6970/6971 (Runification, Manifestation ; rang 3 au niveau 200) | ennemi sur la rune : **vol de vie 9/12/15** dans l'élément ; allié sur la rune : **soin 4/5/6 % PV max** ; **lanceur + allié sur la rune** : +30/40/50 dans la caractéristique de l'élément (Feu→Intelligence, Eau→Chance, Air→Agilité, Terre→Force) **3 tours** ; ennemi sur la rune : reçoit l'état de l'élément (→ combinaisons possibles) |
| « Manifestation » 600 (Manifestation) | en plus, **si la case de la rune est libre** (ou le devient) : Terre = repousse de 3 les entités en cercle 3 autour de la rune ; Feu = **téléporte le lanceur** sur la rune ; Eau = attire de 3 vers la rune (cercle 3) ; Air = téléportation symétrique des entités en cercle 3 par rapport à la rune |
| « Surcharge Runique » 601 + cible en « Surcharge Runique (rang 2) » 6980 | **10 dommages** de l'élément de la rune à l'ennemi ciblé par Surcharge, ou **soin 4 %** de l'allié ciblé (rang 1 : 7 / 3 %) — où qu'il soit |
| « Répulsion Runique » 602 | repousse de **1** case chaque entité en état 602 (posé par Répulsion Runique sur les entités adjacentes) |
| « Prisme Élémentaire » 6957 (Prisme Runique) | lance « Prisme Runique » (13733) sur la rune : cercle 2 ; Terre : durée des effets −1 ; Feu : soins reçus ×70 % (2 t.) ; Eau : 15 % d'érosion (2 t.) ; Air : les attaquants des cibles sont soignés de 15 % des dommages (2 t.) ; + état de l'élément aux ennemis de la zone |

- Le boost de caractéristique (« Rune (boost) » 6973) est cumulable : chaque rune déclenchée donne +50 (rang 3) dans sa
  caractéristique pour 3 tours au lanceur (et à l'allié qui l'occupe). Ex. Runification sur soi avec 3 runes occupées (Feu,
  Air, Eau) = +50 Intelligence, +50 Agilité, +50 Chance.
- **Runification sur le lanceur** : déclenche toutes ses runes **occupées par une entité** (sous-sort 13691 lancé sur chaque
  entité vivante). **Sur une case** : déclenche la rune de cette case.
- INCERTAIN : (a) une rune déclenchée est-elle consommée ? (très probable : comportement des marques déclenchées ; à confirmer
  en jeu) ; (b) une nouvelle rune posée sur une case qui en porte déjà une la remplace-t-elle ? (hypothèse retenue :
  remplacement, une rune par case) ; (c) une rune sur case vide déclenchée par Runification donne-t-elle le boost au lanceur ?
  (les données : le boost vise `C` = lanceur sans condition de présence → **oui** probablement).

### 2.3 Combinaisons élémentaires (sous-sorts 13702–13707, type 2436)

Lancées par 13671 sur l'ennemi qui porte **deux** états ; chacune commence par retirer les 4 états (32415), puis :

| Combinaison | États | Lanceur | Cible (ennemi) | Gardien Élémentaire (s'il existe) |
|---|---|---|---|---|
| **Éruption** (13707) | Terre + Feu | +50 Puissance (3 t.) | **Dommages subis ×115 %** (1 tour) | +15 % dommages finaux (permanent) |
| **Enlisement** (13704) | Terre + Eau | +50 Puissance (3 t.) | **−3 PM** esquivable (1 t., non désenvoûtable) | +3 PM (permanent) |
| **Carbonisation** (13703) | Feu + Air | +50 Puissance (3 t.) | **−2 PA** esquivable (1 t., non désenvoûtable) | +3 PA (permanent) |
| **Ébullition** (13702) | Eau + Feu | +50 Puissance (3 t.) | **−60 Fuite** (1 t.) | +30 Tacle (permanent) |
| **Cristallisation** (13706) | Eau + Air | +50 Puissance (3 t.) | **−15 % dommages finaux** (1 t.) | dommages subis ×85 % (permanent) |
| **Assèchement** (13705) | Terre + Air | +50 Puissance (3 t.) | **vol de 3 PO** (1 t.) | +3 PO à ses 3 sorts (permanent) |

- `maxStack = 1` sur chaque sous-sort de combinaison : le +50 Puissance et le malus **ne se cumulent pas** pour une même
  combinaison (« cumulables une fois par combinaison », infobulle 23876) ; six combinaisons différentes en 3 tours =
  **+300 Puissance**.
- Gardien : chaque combinaison lui donne aussi +200 Puissance et 200 points de bouclier (3 t.) ; l'effet permanent propre à
  chaque combinaison n'est appliqué qu'**une fois par Gardien** (état « X inactive » 3746–3751 posé à l'invocation par 24972
  puis retiré) et au plus une combinaison-bonus par tour (état « Combinaison générée » 4456, 1 tour).
- **Torrent Arcanique** : si la variante est équipée (état passif 3503 posé par le sort initial 23960), chaque combinaison
  ajoute **+2 dégâts de base** à Torrent Arcanique (sous-sort 14359, `maxStack 6` : paliers I→VI, soit **+12** au maximum),
  remis à zéro après le lancer de Torrent.

### 2.4 Gardien Élémentaire (monstre 5129, variante de Bouclier Élémentaire)

- Invocation maîtrisable (`useSummonSlot = true`), 9 PA / 5 PM, 15 % de résistance partout, caractéristiques de base
  300 (Force/Int/Chance/Agi), 150 Sagesse ; `bonusCharacteristics.lifePoints = 110` (interprété comme 110 % des PV de
  l'invocateur, cf. convention des autres fiches — INCERTAIN ; Gamosaurus 2.70 cite « vitalité 1150 »,
  https://www.gamosaurus.com/?p=201759).
- Sorts : **Rayon Quadramental** (13734 : 3 PA, 1–5 PO en ligne, 1×/cible, 24–28 Neutre sans état, sinon dans l'élément
  de l'état de la cible ; CC 29–34 ; la rune de l'élément est posée **par l'Huppermage** via 32411, comptant comme la sienne),
  **Cycle Élémentaire du Gardien** (30788) et **Courant Quadramental du Gardien** (32670) : 3 PA, 1–5 PO, font lancer à
  l'Huppermage Cycle/Courant sur la case visée.
- Gagne les bonus de combinaison du §2.3 (cumulables sur la durée : Puissance +200 par combinaison, PA/PM permanents).

### 2.5 Points d'attention moteur

- Ordre dans un sort élémentaire typique : [2022 info] → 1160 « Rune de X » (ennemis) → dommages → 1160 « État X »
  (ennemis) → effet secondaire (retrait PA/PM/PO, poussée…). Le retrait de PM d'Onde Sismique est appliqué **après** la
  combinaison éventuelle (Enlisement −3 PM + −2 PM = −5 PM tentés).
- Plusieurs sorts infligent aussi des dommages aux **alliés** (masque `a,A` : Onde Sismique, Éther, Lance-flamme,
  Stalagmite, variantes double frappe, Volcan, Brèche, Ouragan, Stalactite) mais ne posent ni rune ni état sur eux.
- Les retraits PA/PM des combinaisons sont **esquivables** (1079/1080) et non désenvoûtables.
- Cycle/Courant : l'état « Cycle Élémentaire (cible) » (1930) / 7017 empêche le remboursement deux fois sur la même cible
  dans le tour ; 1 PA remboursé au premier changement d'état → 4 lancers/tour (3/cible).


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB = fichiers du jeu v3.6.12.16, enregistrements du 23/06/2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Onde Sismique (13668) | base | 1 | 3 | 1–8+ | /LdV | — | 3/t 2/c | 10% | 25–28 Terre | dégâts-mono, retrait-PM, génération-états |
| 1 | Tison (13712) | var. | 100 | 3 | 1–7 | /LdV | — | 2/t 1/c | 10% | 13–15 Feu | dégâts-mono, génération-états |
| 2 | Éther (13669) | base | 1 | 3 | 1–7+ | /LdV | — | 3/t 2/c | 10% | 25–28 Air | dégâts-mono, retrait-PO, génération-états |
| 2 | Cataracte (13711) | var. | 95 | 3 | 1–4 | /sans LdV | — | 2/t 1/c | 10% | 14–16 Eau | dégâts-mono, génération-états |
| 3 | Lance-flamme (13666) | base | 1 | 3 | 1–6+ | /LdV | — | 3/t 2/c | 10% | 26–29 Feu | dégâts-mono, retrait-PA, génération-états |
| 3 | Lances Telluriques (13709) | var. | 105 | 3 | 1–6+ | /LdV | — | 2/t 1/c | 10% | 11–13 Terre | dégâts-mono, génération-états |
| 4 | Stalagmite (13667) | base | 1 | 3 | 1–4 | /sans LdV | — | 3/t 2/c | 10% | 29–32 Eau | dégâts-mono, debuff, génération-états |
| 4 | Onde Céleste (13708) | var. | 110 | 3 | 1–5+ | /LdV | — | 2/t 1/c | 10% | 12–14 Air | dégâts-mono, génération-états |
| 5 | Runification (13670) | base | 5 | 2 | 0–8+ | /sans LdV | — | 2/t | 0% | 15–15 vol Terre, 15–15 vol Feu, 15–15 vol Eau, 15–15 vol Air | runes, vol-de-vie, soin |
| 5 | Manifestation (13710) | var. | 115 | 2 | 0–6+ | /sans LdV | — | 2/t | 0% | 15–15 vol Terre, 15–15 vol Feu, 15–15 vol Eau, 15–15 vol Air | runes, placement, mobilité |
| 6 | Drain Élémentaire (13672) | base | 10 | 2 | 1–4 | /sans LdV | — | 3/t 1/c | 10% | 23–26 vol Terre, 23–26 vol Feu, 23–26 vol Eau, 23–26 vol Air | vol-de-vie, buff, debuff |
| 6 | Tribut (13713) | var. | 120 | 2 | 1–6+ | /LdV | — | 2/t 1/c | 10% | 19–21 meilleur élt | dégâts-mono, buff |
| 7 | Météore (13675) | base | 15 | 3 | 2–7+ | /LdV | — | 2/t | 10% | 27–30 Terre | dégâts-mono, placement, génération-états |
| 7 | Avalanche (13677) | var. | 125 | 3 | 1–5 | /LdV | — | 2/t | 10% | 28–31 Eau | dégâts-mono, placement, génération-états |
| 8 | Lame Astrale (13679) | base | 20 | 3 | 1–4 | /LdV | — | 2/t | 10% | 29–32 Air | dégâts-mono, mobilité, génération-états |
| 8 | Déflagration (13681) | var. | 130 | 3 | 1–5 | /LdV | — | 2/t | 10% | 27–30 Feu | dégâts-mono, placement, génération-états |
| 9 | Cycle Élémentaire (13722) | base | 25 | 1 | 1–8 | /LdV | — | 4/t 3/c | 0% | — | génération-états, utilitaire |
| 9 | Courant Quadramental (14341) | var. | 135 | 1 | 1–8 | /LdV | — | 4/t 3/c | 0% | — | génération-états, utilitaire |
| 10 | Lance Solaire (13723) | base | 30 | 3 | 1–4 | /LdV | — | 2/t | 10% | 29–32 Feu | dégâts-mono, placement |
| 10 | Comète (13726) | var. | 140 | 3 | 1–6 | L/sans LdV | — | 2/t | 10% | 27–30 Air | dégâts-mono, mobilité |
| 11 | Déluge (13721) | base | 35 | 3 | 1–5 | /LdV | — | 2/t | 10% | 27–30 Eau | dégâts-mono, mobilité |
| 11 | Astéroïde (13715) | var. | 145 | 3 | 1–8+ | /LdV | — | 2/t | 10% | 25–28 Terre | dégâts-mono, mobilité |
| 12 | Traversée (13683) | base | 40 | 3 | 2–5 | L/sans LdV | 2 | — | 20% | 30–33 Terre, 30–33 Feu, 30–33 Eau, 30–33 Air | dégâts-zone, mobilité |
| 12 | Répulsion Runique (13728) | var. | 150 | 1 | 0–0 | /sans LdV | — | 1/t | 0% | — | placement, runes |
| 13 | Contribution (13701) | base | 45 | 2 | 0–7 | /LdV | 2 | — | 0% | — | buff, bouclier, runes |
| 13 | Empreinte (13697) | var. | 155 | 1 | 0–6 | /LdV | — | 2/t 1/c | 0% | — | runes, utilitaire |
| 14 | Trait Ardent (13680) | base | 50 | 4 | 1–6+ | L/LdV | — | 1/t | 20% | 33–37 Feu | dégâts-zone, génération-états |
| 14 | Stalactite (13717) | var. | 160 | 2 | 1–4 | /sans LdV | — | 3/t 1/c | 10% | 23–25 Eau | dégâts-mono, retrait-PM |
| 15 | Glacier (13676) | base | 55 | 4 | 0–0 | /sans LdV | — | 1/t | 20% | 32–36 vol Eau | dégâts-zone, vol-de-vie, placement |
| 15 | Volcan (13718) | var. | 165 | 2 | 1–6+ | L/sans LdV | — | 3/t 1/c | 10% | 17–19 vol Feu | vol-de-vie, debuff |
| 16 | Rafale (13678) | base | 60 | 4 | 0–4 | /LdV | — | 1/t | 20% | 29–33 vol Air | dégâts-zone, vol-de-vie, placement |
| 16 | Brèche (13725) | var. | 170 | 2 | 1–5+ | /sans LdV | — | 3/t 1/c | 10% | 16–18 vol Terre | vol-de-vie, retrait-PO |
| 17 | Orage (13674) | base | 65 | 4 | 0–6+ | /LdV | — | 1/t | 20% | 32–36 Terre | dégâts-zone, placement |
| 17 | Ouragan (13714) | var. | 175 | 2 | 1–6 | /sans LdV | — | 3/t 1/c | 10% | 21–23 Air | dégâts-mono, retrait-PA |
| 18 | Bouclier Élémentaire (13682) | base | 70 | 2 | 0–6 | /LdV | 3 | — | 0% | — | protection, génération-états |
| 18 | Gardien Élémentaire (13720) | var. | 180 | 3 | 1–4 | /LdV | 4 | — | 0% | — | invocation, dégâts-mono, runes |
| 19 | Polarité (13696) | base | 75 | 1 | 1–4 | /sans LdV | — | 2/t | 0% | — | placement, utilitaire |
| 19 | Convection (13716) | var. | 185 | 1 | 1–4 | /sans LdV | — | 2/t | 0% | — | placement, mobilité |
| 20 | Surcharge Runique (13724) | base | 80 | 3 | 0–6 | /LdV | — | 1/t | 0% | 10–10 Eau, 10–10 Feu, 10–10 Air, 10–10 Terre | dégâts-mono, soin, runes |
| 20 | Sublimation (13684) | var. | 190 | 2 | 1–6 | /LdV | 2 | — | 0% | — | buff, debuff, génération-états |
| 21 | Propagation (13695) | base | 85 | 1 | 1–8+ | /LdV | — | 2/t 1/c | 0% | — | debuff, génération-états, utilitaire |
| 21 | Prisme Runique (13719) | var. | 195 | 2 | 0–6+ | /LdV | — | 1/t | 0% | — | debuff, runes, génération-états |
| 22 | Supernova (32033) | base | 90 | 3 | 0–6+ | /LdV | — | 2/t 1/c | 10% | 19–21 meilleur élt | dégâts-mono, génération-états, debuff |
| 22 | Torrent Arcanique (14342) | var. | 200 | 3 | 1–8 | L/LdV | 2 | — | 10% | 2–2 Air, 2–2 Terre, 2–2 Feu, 2–2 Eau | dégâts-zone |


### Paire 1 — Onde Sismique / Tison

#### Onde Sismique (`13668`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Terre et retire des PM.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 15–17 Terre ; g2 (niv. 67) : 3 PA, po 1–7, 20–22 Terre ; g3 (niv. 133) : 3 PA, po 1–8, 25–28 Terre
- **Résumé des effets (lecture humaine)** :
  - Dommages Terre 25–28 (CC 30–34) sur la cible (alliés ou ennemis)
  - Retire 2 PM (esquivable, 1 tour, non désenvoûtable)
  - Pose une rune Terre sous l'ennemi (2 tours) et lui applique l'état Terre (→ Enlisement avec Eau, Éruption avec Feu, Assèchement avec Air)
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
  - **25 à 28 dommages Terre (CC : 30 à 34)** → cible (alliée ou ennemie)  `[97]`
  - **Applique l'état « Terre » (292)** → cible ennemie — si cible n'a PAS l'état « Terre » (292) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
- **Analyse / rôle tactique** : Sort Terre de base polyvalent à longue portée (1–8, modifiable) : 3 lancers/tour (2/cible). Pilier de l'entrave PM : sur un ennemi en état Eau il génère Enlisement (−3 PM) puis retire encore 2 PM (−5 PM tentés au total).
- *Notes moteur* : Ordre : rune → dommages → État Terre (combinaison) → retrait PM. Dommages aussi sur les alliés (masque a,A).

#### Tison (`13712`) — variante (obtenu niv. 100)

> Occasionne des dommages Feu.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 1–7 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour · 1×/cible
- Grades : g1 (niv. 100) : 3 PA, po 1–6, 10–12 Feu ; g2 (niv. 167) : 3 PA, po 1–7, 13–15 Feu
- **Résumé des effets (lecture humaine)** :
  - 2 frappes Feu 13–15 chacune (CC 16–18), 2 lancers/tour, 1 par cible
  - Pose une rune Feu sous l'ennemi
  - Applique deux fois l'état Feu : génère une combinaison si la cible avait un autre état, puis la cible ressort en état Feu
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune de Feu » (13665, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13665 niv.1 : sort de la rune Feu (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
  - **13 à 15 dommages Feu (CC : 16 à 18)** → cible (alliée ou ennemie)  `[99]`
  - **13 à 15 dommages Feu (CC : 16 à 18)** → cible (alliée ou ennemie)  `[99]`
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Variante Feu d'Onde Sismique (perd le retrait PM, gagne l'élément Feu et la double application d'état). Utile pour enchaîner deux combinaisons sur la même cible dans le tour (combinaison + état prêt pour la suivante).
- *Notes moteur* : Deux effets 99 indépendants (chaque frappe roule ses dés, CC commun au lancer). Deux lancers de 32392 : le second ré-applique Feu après consommation.


### Paire 2 — Éther / Cataracte

#### Éther (`13669`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Air et retire de la Portée.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–5, 15–17 Air ; g2 (niv. 66) : 3 PA, po 1–6, 20–22 Air ; g3 (niv. 132) : 3 PA, po 1–7, 25–28 Air
- **Résumé des effets (lecture humaine)** :
  - Dommages Air 25–28 (CC 30–34), 1–7 PO modifiable, ligne de vue
  - −2 PO à la cible (1 tour)
  - Rune Air + état Air (→ Carbonisation avec Feu, Cristallisation avec Eau, Assèchement avec Terre)
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune d'Air » (13689, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13689 niv.1 : sort de la rune Air (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
  - **25 à 28 dommages Air (CC : 30 à 34)** → cible (alliée ou ennemie)  `[98]`
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **-2 Portée** → cible (alliée ou ennemie) ; 1 tour(s)  `[116]`
- **Analyse / rôle tactique** : Sort Air de base, 3/tour (2/cible). Le −2 PO protège contre les ennemis à distance ; combiné à Assèchement (vol 3 PO) l'Huppermage peut retirer 5 PO.
- *Notes moteur* : Masque a,A pour les dommages et le −PO.

#### Cataracte (`13711`) — variante (obtenu niv. 95)

> Occasionne des dommages Eau.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 1–4 (non modifiable) · sans ligne de vue · CC 10% · 2×/tour · 1×/cible
- Grades : g1 (niv. 95) : 3 PA, po 1–3, 11–13 Eau ; g2 (niv. 162) : 3 PA, po 1–4, 14–16 Eau
- **Résumé des effets (lecture humaine)** :
  - 2 frappes Eau 14–16 chacune (CC 17–19), 1–4 PO **sans ligne de vue**
  - Rune Eau + double application de l'état Eau
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune d'Eau » (13688, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13688 niv.1 : sort de la rune Eau (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
  - **14 à 16 dommages Eau (CC : 17 à 19)** → cible (alliée ou ennemie)  `[96]`
  - **14 à 16 dommages Eau (CC : 17 à 19)** → cible (alliée ou ennemie)  `[96]`
  - **Applique l'état « Eau » (291)** → cible ennemie — si cible n'a PAS l'état « Eau » (291) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Applique l'état « Eau » (291)** → cible ennemie — si cible n'a PAS l'état « Eau » (291) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Variante Eau courte portée sans ligne de vue, 2/tour (1/cible). Bon pour finir derrière un obstacle et préparer Enlisement/Cristallisation/Ébullition.
- *Notes moteur* : Comme Tison (deux lignes de dommages, deux lancers d'« État Eau »).


### Paire 3 — Lance-flamme / Lances Telluriques

#### Lance-flamme (`13666`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Feu et retire des PA.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–4, 15–17 Feu ; g2 (niv. 68) : 3 PA, po 1–5, 20–23 Feu ; g3 (niv. 134) : 3 PA, po 1–6, 26–29 Feu
- **Résumé des effets (lecture humaine)** :
  - Dommages Feu 26–29 (CC 31–35), 1–6 PO modifiable
  - Retire 2 PA (esquivable, 1 tour, non désenvoûtable)
  - Rune Feu + état Feu (→ Carbonisation −2 PA avec Air)
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune de Feu » (13665, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13665 niv.1 : sort de la rune Feu (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
  - **26 à 29 dommages Feu (CC : 31 à 35)** → cible (alliée ou ennemie)  `[99]`
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Retire 2 PA (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1079]`
- **Analyse / rôle tactique** : Sort Feu de base et principal outil de retrait PA : sur un ennemi en état Air → Carbonisation (−2 PA) + −2 PA du sort = −4 PA tentés pour 3 PA. 3/tour (2/cible).
- *Notes moteur* : Retrait appliqué après la combinaison.

#### Lances Telluriques (`13709`) — variante (obtenu niv. 105)

> Occasionne des dommages Terre.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · 1×/cible
- Grades : g1 (niv. 105) : 3 PA, po 1–5, 9–11 Terre ; g2 (niv. 172) : 3 PA, po 1–6, 11–13 Terre
- **Résumé des effets (lecture humaine)** :
  - 2 frappes Terre 11–13 chacune (CC 14–16), 1–6 PO modifiable
  - Rune Terre + double application de l'état Terre
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
  - **11 à 13 dommages Terre (CC : 14 à 16)** → cible (alliée ou ennemie)  `[97]`
  - **11 à 13 dommages Terre (CC : 14 à 16)** → cible (alliée ou ennemie)  `[97]`
  - **Applique l'état « Terre » (292)** → cible ennemie — si cible n'a PAS l'état « Terre » (292) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Applique l'état « Terre » (292)** → cible ennemie — si cible n'a PAS l'état « Terre » (292) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Variante Terre de Lance-flamme (perd le −2 PA). Intéressante pour un Huppermage Terre qui veut deux sorts Terre mono-cible.
- *Notes moteur* : Deux effets 97 ; 2 lancers/tour, 1/cible.


### Paire 4 — Stalagmite / Onde Céleste

#### Stalagmite (`13667`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Eau et réduit les dommages finaux.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–4 (non modifiable) · sans ligne de vue · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–4, 17–19 Eau ; g2 (niv. 69) : 3 PA, po 1–4, 23–25 Eau ; g3 (niv. 136) : 3 PA, po 1–4, 29–32 Eau
- **Résumé des effets (lecture humaine)** :
  - Dommages Eau 29–32 (CC 35–38), 1–4 PO sans ligne de vue
  - −4 % dommages finaux à la cible (1 tour)
  - Rune Eau + état Eau
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune d'Eau » (13688, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13688 niv.1 : sort de la rune Eau (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
  - **29 à 32 dommages Eau (CC : 35 à 38)** → cible (alliée ou ennemie)  `[96]`
  - **Applique l'état « Eau » (291)** → cible ennemie — si cible n'a PAS l'état « Eau » (291) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **-4% Dommages finaux** → cible (alliée ou ennemie) ; 1 tour(s)  `[1172]`
- **Analyse / rôle tactique** : Plus gros sort de base mono-cible (29–32) mais courte portée ; 3/tour (2/cible). Le −4 % dommages finaux est un petit plus défensif.
- *Notes moteur* : 1172 −4 % dommages finaux (cumulable 1×, maxStack 1).

#### Onde Céleste (`13708`) — variante (obtenu niv. 110)

> Occasionne des dommages Air.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 1–5 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · 1×/cible
- Grades : g1 (niv. 110) : 3 PA, po 1–4, 9–11 Air ; g2 (niv. 177) : 3 PA, po 1–5, 12–14 Air
- **Résumé des effets (lecture humaine)** :
  - 2 frappes Air 12–14 chacune (CC 15–17), 1–5 PO modifiable, ligne de vue
  - Rune Air + double application de l'état Air
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune d'Air » (13689, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13689 niv.1 : sort de la rune Air (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
  - **12 à 14 dommages Air (CC : 15 à 17)** → cible (alliée ou ennemie)  `[98]`
  - **12 à 14 dommages Air (CC : 15 à 17)** → cible (alliée ou ennemie)  `[98]`
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Variante Air à 2 frappes ; 2/tour, 1/cible.
- *Notes moteur* : Deux effets 98.


### Paire 5 — Runification / Manifestation

#### Runification (`13670`) — sort de base (obtenu niv. 5)

> Déclenche une rune du lanceur pour voler de la vie à l'ennemi ou soigner l'allié qui l'occupe, et augmenter les caractéristiques du lanceur et de l'allié sur la rune selon l'élément de la rune.  Sur le lanceur : déclenche toutes ses runes occupées par une entité.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **2 PA** · portée 0–8 (modifiable) · sans ligne de vue · CC 0% · 2×/tour · 4×/tour global (tous lanceurs) · cumul max 6
- Grades : g1 (niv. 5) : 2 PA, po 0–6, 9–9 vol Terre, 9–9 vol Feu, 9–9 vol Eau, 9–9 vol Air ; g2 (niv. 72) : 2 PA, po 0–7, 12–12 vol Terre, 12–12 vol Feu, 12–12 vol Eau, 12–12 vol Air ; g3 (niv. 139) : 2 PA, po 0–8, 15–15 vol Terre, 15–15 vol Feu, 15–15 vol Eau, 15–15 vol Air
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–8 PO modifiable, sans ligne de vue, 2/tour
  - Sur une rune : déclenche cette rune (vol de vie 15 dans l'élément à l'ennemi qui l'occupe, ou soin 6 % PV max à l'allié qui l'occupe ; +50 de la caractéristique de l'élément au lanceur et à l'allié sur la rune, 3 tours ; état de l'élément à l'ennemi)
  - Sur le lanceur : déclenche **toutes** ses runes occupées par une entité
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Rune » (296)** → lanceur ; 1 tour(s)  `[950]`
  - **Applique l'état « Rune (rang 3) » (6971)** → lanceur ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Runes Élémentaires » (13691, niv. 1)** → lanceur (s’il est dans la zone)  `[1160]`
    - ↳ sous-sort 13691 niv.1 : Runes Élémentaires : niv. 1 = relance le niv. 2 sur toutes les entités vivantes puis pose l'état « Runification » (6968) ; niv. 2 = 2023 « déclenche les runes » sur la case visée (si le lanceur n'a pas encore 6968).
  - **la cible lance sur la case ciblée le sous-sort « Runes Élémentaires » (13691, niv. 2)** → lanceur  `[2794]`
    - ↳ sous-sort 13691 niv.2 : Runes Élémentaires : niv. 1 = relance le niv. 2 sur toutes les entités vivantes puis pose l'état « Runification » (6968) ; niv. 2 = 2023 « déclenche les runes » sur la case visée (si le lanceur n'a pas encore 6968).
  - **Déclenche les runes** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[2023]`
  - **Retire l'état « Rune » (296)** → lanceur  `[951]`
  - **Retire l'état « Runification » (6968)** → lanceur  `[951]`
  - **Retire l'état « Rune (rang 3) » (6971)** → lanceur  `[951]`
  - **15 vol Terre** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[92]`
  - **15 vol Feu** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[94]`
  - **15 vol Eau** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[91]`
  - **15 vol Air** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[93]`
  - **Soin : 6% des PV max** → cible alliée — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **50 Force** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[118]`
  - **50 Intelligence** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[126]`
  - **50 Chance** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[123]`
  - **50 Agilité** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[119]`
  - **Applique l'état « Terre » (292)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Feu » (290)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Eau » (291)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Air » (293)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Cœur du gameplay : après 2–3 sorts élémentaires sur des ennemis immobiles, Runification sur soi déclenche toutes les runes : vols de vie multiples, +50 Int/Agi/Chance/Force cumulés, et ré-application d'états (donc nouvelles combinaisons). Sur un allié posé sur une rune : soin + boost partagé.
- *Notes moteur* : Pose sur le lanceur les états 296 « Rune » + 6971 « Rang 3 » (1 tour), déclenche (2023), puis les retire. Les vols de vie viennent des sorts de rune (13665/13688/13689/13690) lancés par l'Huppermage : caractéristiques et dommages de l'Huppermage.

#### Manifestation (`13710`) — variante (obtenu niv. 115)

> Déclenche une rune du lanceur pour voler de la vie à l'ennemi ou soigner l'allié qui l'occupe, et augmenter les caractéristiques du lanceur et de l'allié sur la rune selon l'élément de la rune.  Si la case est ou devient libre : •  Terre : repousse les entités depuis la rune en zone. •  Feu : téléporte le lanceur sur la rune. •  Eau : attire les entités vers la rune en zone. •  Air : téléporte les entités symétriquement par rapport à la rune en zone.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **2 PA** · portée 0–6 (modifiable) · sans ligne de vue · CC 0% · 2×/tour · cumul max 6
- Grades : g1 (niv. 115) : 2 PA, po 0–5, 12–12 vol Terre, 12–12 vol Feu, 12–12 vol Eau, 12–12 vol Air ; g2 (niv. 182) : 2 PA, po 0–6, 15–15 vol Terre, 15–15 vol Feu, 15–15 vol Eau, 15–15 vol Air
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO modifiable, sans ligne de vue, 2/tour
  - Déclenche la rune ciblée comme Runification (vol 15 / soin 6 % / +50 caractéristique)
  - Si la case de la rune est (ou devient) libre : Terre = repousse de 3 en cercle 3 ; Feu = téléporte le lanceur sur la rune ; Eau = attire de 3 vers la rune (cercle 3) ; Air = téléportation symétrique des entités du cercle 3 autour de la rune
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Manifestation » (600)** → lanceur ; 1 tour(s)  `[950]`
  - **Applique l'état « Rune » (296)** → lanceur ; 1 tour(s)  `[950]`
  - **Applique l'état « Rune (rang 3) » (6971)** → lanceur ; 1 tour(s)  `[950]`
  - **Déclenche les runes** → cible (alliée ou ennemie)  `[2023]`
  - **Retire l'état « Manifestation » (600)** → lanceur  `[951]`
  - **Retire l'état « Rune » (296)** → lanceur  `[951]`
  - **Retire l'état « Rune (rang 3) » (6971)** → lanceur  `[951]`
  - **15 vol Terre** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[92]`
  - **15 vol Feu** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[94]`
  - **15 vol Eau** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[91]`
  - **15 vol Air** → cible ennemie — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[93]`
  - **Soin : 6% des PV max** → cible alliée — si lanceur a l'état « Rune » (296) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **50 Force** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[118]`
  - **50 Intelligence** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[126]`
  - **50 Chance** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[123]`
  - **50 Agilité** → lanceur, alliés (dont lanceur si dans la zone) — si lanceur a l'état « Rune » (296) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[119]`
  - **Applique l'état « Terre » (292)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Feu » (290)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Eau » (291)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Air » (293)** → cible ennemie — si lanceur a l'état « Rune » (296) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[4]`
  - **Attire la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **Téléportation symétrique** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1106]`
- **Analyse / rôle tactique** : Variante orientée placement : perd le déclenchement global sur soi mais transforme chaque rune en outil de déplacement (téléportation Feu, regroupement Eau, dispersion Terre/Air).
- *Notes moteur* : État 600 « Manifestation » sur le lanceur pendant le lancer ; le sous-sort 32414 niv. 5 marque « Manifestation (cible) » si une entité occupe la rune, ce qui annule l'effet de placement (niv. 1–4).


### Paire 6 — Drain Élémentaire / Tribut

#### Drain Élémentaire (`13672`) — sort de base (obtenu niv. 10)

> Vole des caractéristiques et de la vie selon l'état élémentaire sur l'ennemi ciblé.

- Caractéristiques (g3) : **2 PA** · portée 1–4 (non modifiable) · sans ligne de vue · CC 10% · 3×/tour · 1×/cible · cumul max 1
- Grades : g1 (niv. 10) : 2 PA, po 1–4, 14–16 vol Terre, 14–16 vol Feu, 14–16 vol Eau, 14–16 vol Air ; g2 (niv. 77) : 2 PA, po 1–4, 19–21 vol Terre, 19–21 vol Feu, 19–21 vol Eau, 19–21 vol Air ; g3 (niv. 144) : 2 PA, po 1–4, 23–26 vol Terre, 23–26 vol Feu, 23–26 vol Eau, 23–26 vol Air
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–4 PO sans ligne de vue, 3/tour, 1/cible
  - Selon l'état de l'ennemi : Terre → vole 200 Force + vol de vie Terre 23–26 ; Feu → vole 200 Intelligence + vol Feu ; Eau → vole 200 Chance + vol Eau ; Air → vole 200 Agilité + vol Air (vols de caractéristique 3 tours) ; CC 28–31
  - Sans état sur la cible : aucun effet
- Effets décodés (données brutes DofusDB) :
  - **Vole 200 Force** → cible ennemie — si cible a l'état « Terre » (292) ; 3 tour(s)  `[271]`
  - **23 à 26 vol Terre (CC : 28 à 31)** → cible ennemie — si cible a l'état « Terre » (292)  `[92]`
  - **Vole 200 Intelligence** → cible ennemie — si cible a l'état « Feu » (290) ; 3 tour(s)  `[269]`
  - **23 à 26 vol Feu (CC : 28 à 31)** → cible ennemie — si cible a l'état « Feu » (290)  `[94]`
  - **Vole 200 Chance** → cible ennemie — si cible a l'état « Eau » (291) ; 3 tour(s)  `[266]`
  - **23 à 26 vol Eau (CC : 28 à 31)** → cible ennemie — si cible a l'état « Eau » (291)  `[91]`
  - **Vole 200 Agilité** → cible ennemie — si cible a l'état « Air » (293) ; 3 tour(s)  `[268]`
  - **23 à 26 vol Air (CC : 28 à 31)** → cible ennemie — si cible a l'état « Air » (293)  `[93]`
- **Analyse / rôle tactique** : Exploite un état déjà posé (ne le consomme pas) : énorme gain de caractéristique (+200) dans l'élément de l'état, ce qui augmente les dommages des sorts de cet élément. À lancer en début de tour sur une cible déjà marquée.
- *Notes moteur* : Vols 266/268/269/271 (3 tours). Ne génère ni rune ni combinaison.

#### Tribut (`13713`) — variante (obtenu niv. 120)

> Applique des effets sur le lanceur selon l'état élémentaire sur l'ennemi ciblé et occasionne des dommages dans le meilleur élément du lanceur : •  Terre : augmente les PM. •  Feu : applique un bouclier. •  Eau : augmente la Puissance. •  Air : augmente les PA.

- Caractéristiques (g2) : **2 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · 1×/cible · cumul max 1
- Grades : g1 (niv. 120) : 2 PA, po 1–5, 16–18 meilleur élt ; g2 (niv. 187) : 2 PA, po 1–6, 19–21 meilleur élt
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–6 PO modifiable, LdV, 2/tour, 1/cible
  - Dommages du meilleur élément 19–21 (CC 23–25)
  - Selon l'état de l'ennemi (non consommé) : Eau → +150 Puissance ; Feu → bouclier 150 % du niveau ; Air → +1 PA ; Terre → +1 PM (lanceur, 2 tours, non cumulable)
- Effets décodés (données brutes DofusDB) :
  - **1 PM** → lanceur ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[128]`
  - **Bouclier : 150% du niveau** → lanceur ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **+150 Puissance** → lanceur ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **1 PA** → lanceur ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[111]`
  - **le lanceur lance le sous-sort « Tribut » (14354, niv. 1)** → cible ennemie — si cible a l'état « Eau » (291)  `[1160]`
    - ↳ sous-sort 14354 « Tribut » niv.1 :
      - **+150 Puissance** → lanceur ; 2 tour(s)  `[138]`
  - **le lanceur lance le sous-sort « Tribut » (14354, niv. 2)** → cible ennemie — si cible a l'état « Feu » (290)  `[1160]`
    - ↳ sous-sort 14354 « Tribut » niv.2 :
      - **Bouclier : 150% du niveau** → lanceur ; 2 tour(s)  `[1020]`
  - **le lanceur lance le sous-sort « Tribut » (14354, niv. 3)** → cible ennemie — si cible a l'état « Air » (293)  `[1160]`
    - ↳ sous-sort 14354 « Tribut » niv.3 :
      - **1 PA** → lanceur ; 2 tour(s)  `[111]`
  - **le lanceur lance le sous-sort « Tribut » (14354, niv. 4)** → cible ennemie — si cible a l'état « Terre » (292)  `[1160]`
    - ↳ sous-sort 14354 « Tribut » niv.4 :
      - **1 PM** → lanceur ; 2 tour(s)  `[128]`
  - **19 à 21 dommages du meilleur élément (CC : 23 à 25)** → cible (alliée ou ennemie)  `[2822]`
- **Analyse / rôle tactique** : Version offensive/auto-buff : +1 PA (état Air) ou +1 PM (Terre) pour 2 tours, ou bouclier (Feu ≈ 300 au niveau 200).
- *Notes moteur* : Sous-sorts 14354 niv. 1–4 (maxStack 1). Dommages 2822 sans rune ni état.


### Paire 7 — Météore / Avalanche

#### Météore (`13675`) — sort de base (obtenu niv. 15)

> Repousse la cible et occasionne des dommages Terre aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 2–7 (modifiable) · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 15) : 3 PA, po 2–5, 17–19 Terre ; g2 (niv. 82) : 3 PA, po 2–6, 22–24 Terre ; g3 (niv. 149) : 3 PA, po 2–7, 27–30 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 2–7 PO modifiable, LdV, 2/tour
  - Repousse la cible de 2 cases (allié ou ennemi)
  - Dommages Terre 27–30 (CC 32–36) aux ennemis ; rune Terre + état Terre
- Effets décodés (données brutes DofusDB) :
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
  - **27 à 30 dommages Terre (CC : 32 à 36)** → cible ennemie  `[97]`
  - **Applique l'état « Terre » (292)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Poussée + dommages ; peut repousser un allié pour le sauver (sans le blesser). La poussée a lieu avant les dommages : dommages de collision possibles.
- *Notes moteur* : Poussée 5 avant les dommages ; dommages masque A uniquement.

#### Avalanche (`13677`) — variante (obtenu niv. 125)

> Attire la cible et occasionne des dommages Eau aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 1–5 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 125) : 3 PA, po 1–5, 24–27 Eau ; g2 (niv. 192) : 3 PA, po 1–5, 28–31 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO, LdV, 2/tour
  - Attire la cible de 4 cases
  - Dommages Eau 28–31 (CC 34–37) aux ennemis ; rune Eau + état Eau
- Effets décodés (données brutes DofusDB) :
  - **Attire la cible de 4 case(s)** → cible (alliée ou ennemie)  `[6]`
  - **Pose une rune (sort déclenché) « Rune d'Eau » (13688, niv. 1)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13688 niv.1 : sort de la rune Eau (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
  - **28 à 31 dommages Eau (CC : 34 à 37)** → cible ennemie  `[96]`
  - **Applique l'état « Eau » (291)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Attirance longue (4) : ramène un ennemi au contact du tank ou dans une zone ; sur un allié, le rapatrie.
- *Notes moteur* : Attirance 6 avant les dommages.


### Paire 8 — Lame Astrale / Déflagration

#### Lame Astrale (`13679`) — sort de base (obtenu niv. 20)

> Téléporte le lanceur symétriquement par rapport à la cible et occasionne des dommages Air aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–4 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour
- Grades : g1 (niv. 20) : 3 PA, po 1–4, 18–20 Air ; g2 (niv. 87) : 3 PA, po 1–4, 23–26 Air ; g3 (niv. 154) : 3 PA, po 1–4, 29–32 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO, LdV, case occupée requise, 2/tour
  - Téléporte le lanceur symétriquement par rapport à la cible
  - Dommages Air 29–32 (CC 35–38) aux ennemis ; rune Air + état Air
- Effets décodés (données brutes DofusDB) :
  - **Téléportation symétrique par rapport à la cible** → cible (alliée ou ennemie)  `[1104]`
  - **Pose une rune (sort déclenché) « Rune d'Air » (13689, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13689 niv.1 : sort de la rune Air (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
  - **29 à 32 dommages Air (CC : 35 à 38)** → cible ennemie  `[98]`
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Mobilité : passer de l'autre côté d'un ennemi (fuite de tacle sans PM, contournement). Échoue si la case symétrique est occupée.
- *Notes moteur* : 1104 (symétrie autour de la cible).

#### Déflagration (`13681`) — variante (obtenu niv. 130)

> Téléporte la cible et le lanceur à leur position précédente et occasionne des dommages Feu aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 1–5 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour
- Grades : g1 (niv. 130) : 3 PA, po 1–4, 24–27 Feu ; g2 (niv. 197) : 3 PA, po 1–5, 27–30 Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO, LdV, case occupée requise, 2/tour
  - Téléporte la cible et le lanceur à leur position précédente (sauf Indéplaçable, Pesanteur, Enraciné)
  - Dommages Feu 27–30 (CC 32–36) aux ennemis ; rune Feu + état Feu
- Effets décodés (données brutes DofusDB) :
  - **Téléporte à la position précédente** → lanceur, alliés (dont lanceur si dans la zone), ennemis — si cible n'a PAS l'état « Indéplaçable » (97) ET si cible n'a PAS l'état « Pesanteur » (7) ET si cible n'a PAS l'état « Enraciné » (6)  `[1100]`
  - **Pose une rune (sort déclenché) « Rune de Feu » (13665, niv. 1)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13665 niv.1 : sort de la rune Feu (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
  - **27 à 30 dommages Feu (CC : 32 à 36)** → cible ennemie  `[99]`
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Annule un déplacement : renvoie un ennemi qui vient d'avancer (ou de fuir), et le lanceur aussi. Contre des boss qui foncent, très fort.
- *Notes moteur* : 1100 FightRollbackPreviousPosition : il faut mémoriser la position précédente de chaque entité (dernier déplacement subi ou effectué).


### Paire 9 — Cycle Élémentaire / Courant Quadramental

#### Cycle Élémentaire (`13722`) — sort de base (obtenu niv. 25)

> Change l'état élémentaire sur l'ennemi ciblé selon son état actuel dans le sens horaire : •  Terre →  Eau →  Feu →  Air →  Terre  Sur un ennemi sans état élémentaire : applique l'état élémentaire de la dernière rune posée par le lanceur.  Le coût en PA du sort est remboursé au premier changement d'état sur une cible.

- Caractéristiques (g3) : **1 PA** · portée 1–8 (non modifiable) · ligne de vue requise · CC 0% · 4×/tour · 3×/cible
- Grades : g1 (niv. 25) : 1 PA, po 1–6 ; g2 (niv. 92) : 1 PA, po 1–7 ; g3 (niv. 159) : 1 PA, po 1–8
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–8 PO, LdV, 4/tour, 3/cible ; **1 PA remboursé** au premier changement d'état sur une cible (1×/cible/tour)
  - Fait tourner l'état de l'ennemi dans le sens horaire : Terre → Eau → Feu → Air → Terre
  - Sur un ennemi sans état : applique l'état de la Dernière rune posée
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Cycle Élémentaire » (32397, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32397 « Cycle Élémentaire » niv.1 :
      - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → cible ennemie  `[1160]`
        - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
      - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie — si cible a l'état « Feu » (290)  `[1160]`
        - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie — si cible a l'état « Eau » (291)  `[1160]`
        - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie — si cible a l'état « Terre » (292)  `[1160]`
        - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie — si cible a l'état « Air » (293)  `[1160]`
        - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « État Élémentaire » (32669, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Feu » (290) ET si cible n'a PAS l'état « Eau » (291) ET si cible n'a PAS l'état « Terre » (292) ET si cible n'a PAS l'état « Air » (293)  `[1160]`
    - ↳ sous-sort 32669 niv.1 : si l'ennemi n'a aucun état élémentaire : lui applique l'état de l'élément de la Dernière rune posée par le lanceur (états 701–704), avec combinaison éventuelle.
  - **le lanceur lance le sous-sort « Cycle Élémentaire » (16992, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Cycle Élémentaire (cible) » (1930) ET si cible a l'état « Feu » (290)  `[1160]`
    - ↳ sous-sort 16992 « Cycle Élémentaire » niv.1 :
      - **Rembourse 1 PA** → lanceur ; non désenvoûtable  `[120]`
      - **Applique l'état « Cycle Élémentaire (cible) » (1930)** → cible ennemie ; 1 tour(s)  `[950]`
      - **la cible lance (sur elle-même) le sous-sort « Cycle Élémentaire » (16992, niv. 2)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur, non désenvoûtable  `[792]`
        - ↳ sous-sort 16992 « Cycle Élémentaire » niv.2 :
          - **Retire l'état « Cycle Élémentaire (cible) » (1930)** → ennemis dans la zone ; zone tout le terrain, non désenvoûtable  `[951]`
  - **le lanceur lance le sous-sort « Cycle Élémentaire » (16992, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Cycle Élémentaire (cible) » (1930) ET si cible a l'état « Eau » (291)  `[1160]`
    - ↳ (sous-sort 16992 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Cycle Élémentaire » (16992, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Cycle Élémentaire (cible) » (1930) ET si cible a l'état « Terre » (292)  `[1160]`
    - ↳ (sous-sort 16992 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Cycle Élémentaire » (16992, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Cycle Élémentaire (cible) » (1930) ET si cible a l'état « Air » (293)  `[1160]`
    - ↳ (sous-sort 16992 niv.1 déjà détaillé plus haut)
  - **Applique l'état « Terre » (292)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Eau » (291)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Feu » (290)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Air » (293)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Rembourse 1 PA** → lanceur ; non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[120]`
- **Analyse / rôle tactique** : Outil de réglage gratuit : choisit l'état d'une cible pour viser la combinaison voulue au prochain sort (ex. transformer Terre en Eau pour que le sort Feu suivant génère Ébullition… ou en Feu pour viser Éruption avec un sort Terre). Pas de combinaison directe (le changement retire puis applique un seul état).
- *Notes moteur* : 32397 : retire les 4 états puis applique le suivant (conditions évaluées sur l'instantané). Le sous-sort 16992 rembourse 1 PA (120) et pose 1930 sur la cible jusqu'à la fin de son tour.

#### Courant Quadramental (`14341`) — variante (obtenu niv. 135)

> Change l'état élémentaire sur l'ennemi ciblé selon son état actuel dans le sens anti-horaire : •  Eau →  Terre →  Air →  Feu →  Eau  Sur un ennemi sans état élémentaire : applique l'état élémentaire de la dernière rune posée par le lanceur.  Le coût en PA du sort est remboursé au premier changement d'état sur une cible.

- Caractéristiques (g1) : **1 PA** · portée 1–8 (non modifiable) · ligne de vue requise · CC 0% · 4×/tour · 3×/cible
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–8 PO, LdV, 4/tour, 3/cible, 1 PA remboursé au premier changement d'état par cible
  - Rotation anti-horaire : Eau → Terre → Air → Feu → Eau
  - Sur un ennemi sans état : état de la Dernière rune
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Courant Quadramental » (32398, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32398 « Courant Quadramental » niv.1 :
      - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → cible ennemie  `[1160]`
        - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
      - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie — si cible a l'état « Air » (293)  `[1160]`
        - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie — si cible a l'état « Feu » (290)  `[1160]`
        - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie — si cible a l'état « Eau » (291)  `[1160]`
        - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie — si cible a l'état « Terre » (292)  `[1160]`
        - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « État Élémentaire » (32669, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Feu » (290) ET si cible n'a PAS l'état « Eau » (291) ET si cible n'a PAS l'état « Terre » (292) ET si cible n'a PAS l'état « Air » (293)  `[1160]`
    - ↳ sous-sort 32669 niv.1 : si l'ennemi n'a aucun état élémentaire : lui applique l'état de l'élément de la Dernière rune posée par le lanceur (états 701–704), avec combinaison éventuelle.
  - **Applique l'état « Eau » (291)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Terre » (292)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Air » (293)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Feu » (290)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Courant Quadramental » (32661, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Courant Quadramental (cible) » (7017) ET si cible a l'état « Feu » (290)  `[1160]`
    - ↳ sous-sort 32661 « Courant Quadramental » niv.1 :
      - **Rembourse 1 PA** → lanceur ; non désenvoûtable  `[120]`
      - **Applique l'état « Courant Quadramental (cible) » (7017)** → cible ennemie ; 1 tour(s)  `[950]`
      - **la cible lance (sur elle-même) le sous-sort « Courant Quadramental » (32661, niv. 2)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur, non désenvoûtable  `[792]`
        - ↳ sous-sort 32661 « Courant Quadramental » niv.2 :
          - **Retire l'état « Courant Quadramental (cible) » (7017)** → ennemis dans la zone ; zone tout le terrain, non désenvoûtable  `[951]`
  - **le lanceur lance le sous-sort « Courant Quadramental » (32661, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Courant Quadramental (cible) » (7017) ET si cible a l'état « Eau » (291)  `[1160]`
    - ↳ (sous-sort 32661 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Courant Quadramental » (32661, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Courant Quadramental (cible) » (7017) ET si cible a l'état « Terre » (292)  `[1160]`
    - ↳ (sous-sort 32661 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Courant Quadramental » (32661, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Courant Quadramental (cible) » (7017) ET si cible a l'état « Air » (293)  `[1160]`
    - ↳ (sous-sort 32661 niv.1 déjà détaillé plus haut)
  - **Rembourse 1 PA** → lanceur ; non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[120]`
- **Analyse / rôle tactique** : Même rôle que Cycle Élémentaire dans l'autre sens : les deux sorts ne sont pas cumulables (même paire) ; le choix dépend des deux éléments joués (on veut 1 rotation pour atteindre l'état désiré).
- *Notes moteur* : 32398 / 32661 (état 7017).


### Paire 10 — Lance Solaire / Comète

#### Lance Solaire (`13723`) — sort de base (obtenu niv. 30)

> Échange de position avec la cible et occasionne des dommages Feu aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–4 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 30) : 3 PA, po 1–4, 18–20 Feu ; g2 (niv. 97) : 3 PA, po 1–4, 23–26 Feu ; g3 (niv. 164) : 3 PA, po 1–4, 29–32 Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO, LdV, 2/tour
  - Échange de position avec la cible (alliée ou ennemie)
  - Dommages Feu 29–32 (CC 35–38) aux ennemis ; rune Feu + état Feu
- Effets décodés (données brutes DofusDB) :
  - **Échange de positions (lanceur ↔ cible)** → cible (alliée ou ennemie)  `[8]`
  - **Pose une rune (sort déclenché) « Rune de Feu » (13665, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13665 niv.1 : sort de la rune Feu (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
  - **29 à 32 dommages Feu (CC : 35 à 38)** → cible ennemie  `[99]`
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Transposition : sauver un allié encerclé ou placer un ennemi sur une case précise (sur une rune, dans une zone).
- *Notes moteur* : Effet 8 (échange) ; impossible si l'une des entités est en Pesanteur/Indéplaçable/Enraciné.

#### Comète (`13726`) — variante (obtenu niv. 140)

> Applique des effets selon la position du lanceur par rapport à la cible et occasionne des dommages Air aux ennemis : • Éloigne le lanceur de la cible s'il est en mêlée. • Téléporte le lanceur jusqu'à la cible s'il est à distance.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **3 PA** · portée 1–6 (non modifiable) · en ligne uniquement · sans ligne de vue · cible requise (case occupée) · CC 10% · 2×/tour
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–6 PO en ligne, sans LdV, case occupée requise, 2/tour
  - Si le lanceur est au contact : il recule de 3 cases ; sinon il se téléporte au contact de la cible (ligne)
  - Dommages Air 27–30 (CC 32–36) aux ennemis ; rune Air + état Air
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Comète » (32706, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32706 « Comète » niv.1 :
      - **Applique l'état « Comète (mêlée) » (7027)** → lanceur (s’il est dans la zone) ; zone croix sans centre taille 1, 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Comète » (32706, niv. 2)** → cible (alliée ou ennemie)  `[1160]`
        - ↳ sous-sort 32706 « Comète » niv.2 :
          - **Le lanceur recule de 3 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie) — si lanceur a l'état « Comète (mêlée) » (7027)  `[1041]`
          - **Téléporte le lanceur sur la case ciblée** → tous (alliés+ennemis) dans la zone — si lanceur n'a PAS l'état « Pesanteur » (7) ET si cible n'a PAS l'état « Comète (mêlée) » (7027) ; zone ligne depuis le lanceur taille 1 (min 63)  `[4]`
          - **Retire l'état « Comète (mêlée) » (7027)** → lanceur  `[951]`
  - **Le lanceur recule de 3 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1041]`
  - **Téléporte le lanceur sur la case ciblée** → tous (alliés+ennemis) dans la zone — si lanceur n'a PAS l'état « Pesanteur » (7) ; zone ligne depuis le lanceur taille 1 (min 63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[4]`
  - **Pose une rune (sort déclenché) « Rune d'Air » (13689, niv. 1)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13689 niv.1 : sort de la rune Air (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
  - **27 à 30 dommages Air (CC : 32 à 36)** → cible ennemie  `[98]`
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Mobilité bidirectionnelle : engage (téléport au contact) ou désengage (recul 3) selon la situation.
- *Notes moteur* : Sous-sort 32706 : état 7027 si le lanceur est dans la croix Q1 autour de la cible ; 1041 recul ou 4 téléportation (zone l1,63 stopAtTarget).


### Paire 11 — Déluge / Astéroïde

#### Déluge (`13721`) — sort de base (obtenu niv. 35)

> Rapproche le lanceur vers la cible et occasionne des dommages Eau aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **3 PA** · portée 1–5 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 35) : 3 PA, po 1–5, 17–19 Eau ; g2 (niv. 102) : 3 PA, po 1–5, 22–24 Eau ; g3 (niv. 169) : 3 PA, po 1–5, 27–30 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO, LdV, 2/tour
  - Le lanceur avance de 4 cases vers la cible
  - Dommages Eau 27–30 (CC 32–36) aux ennemis ; rune Eau + état Eau
- Effets décodés (données brutes DofusDB) :
  - **Le lanceur avance de 4 case(s) vers la cible** → cible (alliée ou ennemie)  `[1042]`
  - **Pose une rune (sort déclenché) « Rune d'Eau » (13688, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13688 niv.1 : sort de la rune Eau (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
  - **27 à 30 dommages Eau (CC : 32 à 36)** → cible ennemie  `[96]`
  - **Applique l'état « Eau » (291)** → cible ennemie — si cible n'a PAS l'état « Eau » (291) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Rapprochement offensif (pour passer à portée des sorts à 1–4 PO).
- *Notes moteur* : 1042 avant les dommages.

#### Astéroïde (`13715`) — variante (obtenu niv. 145)

> Éloigne le lanceur de la cible et occasionne des dommages Terre aux ennemis.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 10% · 2×/tour
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–8 PO modifiable, LdV, 2/tour
  - Le lanceur recule de 2 cases
  - Dommages Terre 25–28 (CC 30–34) aux ennemis ; rune Terre + état Terre
- Effets décodés (données brutes DofusDB) :
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie)  `[1041]`
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
  - **25 à 28 dommages Terre (CC : 30 à 34)** → cible ennemie  `[97]`
  - **Applique l'état « Terre » (292)** → cible ennemie — si cible n'a PAS l'état « Terre » (292) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Désengagement + dommages à longue portée : idéal pour l'Huppermage Terre/Air qui joue à distance.
- *Notes moteur* : 1041 avant les dommages.


### Paire 12 — Traversée / Répulsion Runique

#### Traversée (`13683`) — sort de base (obtenu niv. 40)

> Téléporte le lanceur sur la case ciblée et occasionne des dommages selon l'état élémentaire sur les ennemis en zone.

- Caractéristiques (g3) : **3 PA** · portée 2–5 (non modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 20% · relance 2 t. · condition : lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 40) : 3 PA, po 2–5, 19–21 Terre, 19–21 Feu, 19–21 Eau, 19–21 Air ; g2 (niv. 107) : 3 PA, po 2–5, 24–27 Terre, 24–27 Feu, 24–27 Eau, 24–27 Air ; g3 (niv. 174) : 3 PA, po 2–5, 30–33 Terre, 30–33 Feu, 30–33 Eau, 30–33 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 2–5 PO en ligne, sans LdV, case libre requise, relance 2 tours, CC 20 %, interdit en Pesanteur
  - Téléporte le lanceur sur la case ciblée
  - Dommages 30–33 (CC 36–40) à chaque ennemi traversé, **dans l'élément de son état** (Terre/Feu/Eau/Air) ; ennemis sans état : rien
- Effets décodés (données brutes DofusDB) :
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie)  `[4]`
  - **30 à 33 dommages Terre (CC : 36 à 40)** → ennemis dans la zone — si cible a l'état « Terre » (292) ; zone ligne depuis le lanceur taille 1 (min 63)  `[97]`
  - **30 à 33 dommages Feu (CC : 36 à 40)** → ennemis dans la zone — si cible a l'état « Feu » (290) ; zone ligne depuis le lanceur taille 1 (min 63)  `[99]`
  - **30 à 33 dommages Eau (CC : 36 à 40)** → ennemis dans la zone — si cible a l'état « Eau » (291) ; zone ligne depuis le lanceur taille 1 (min 63)  `[96]`
  - **30 à 33 dommages Air (CC : 36 à 40)** → ennemis dans la zone — si cible a l'état « Air » (293) ; zone ligne depuis le lanceur taille 1 (min 63)  `[98]`
- **Analyse / rôle tactique** : Téléportation + frappe des ennemis alignés porteurs d'un état (ne consomme pas l'état et ne pose pas de rune).
- *Notes moteur* : Zone l1,63 + stopAtTarget = toutes les cases entre le lanceur (exclu) et la case ciblée (incluse), calculée sur la position de départ (instantané).

#### Répulsion Runique (`13728`) — variante (obtenu niv. 150)

> Repousse les cibles en zone. Déclenche également toutes les runes du lanceur pour repousser de nouveau les cibles pour chaque rune déclenchée.  La poussée pour chaque rune est plus faible.

- Caractéristiques (g1) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 1×/tour
- **Résumé des effets (lecture humaine)** :
  - 1 PA, sur soi, 1/tour
  - Repousse de 2 cases les entités adjacentes (croix)
  - Déclenche toutes les runes du lanceur : chaque rune déclenchée repousse à nouveau de 1 case ces mêmes entités
- Effets décodés (données brutes DofusDB) :
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1 (min 1)  `[5]`
  - **Applique l'état « Répulsion Runique » (602)** → lanceur, alliés (dont lanceur si dans la zone), ennemis ; zone croix sans centre taille 1 (min 1), 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Répulsion Runique » (23972, niv. 1)** → lanceur  `[1160]`
    - ↳ sous-sort 23972 « Répulsion Runique » niv.1 :
      - **Déclenche les runes** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[2023]`
      - **Retire l'état « Répulsion Runique » (602)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
  - **Déclenche les runes** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2023]`
  - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
- **Analyse / rôle tactique** : Dégagement d'urgence au corps-à-corps : poussée 2 + 1 par rune présente sur la carte (dommages de poussée importants contre un mur).
- *Notes moteur* : État 602 sur les entités poussées ; chaque rune (via 23972 niv. 2) repousse de 1 les porteurs de 602. Consomme les runes (INCERTAIN).


### Paire 13 — Contribution / Empreinte

#### Contribution (`13701`) — sort de base (obtenu niv. 45)

> Pose une rune et applique des effets sur l'allié ciblé selon les états élémentaires sur tous les ennemis : •  Terre : augmente les PM. •  Feu : applique un bouclier. •  Eau : augmente la Puissance. •  Air : augmente les PA.  Consomme tous les états élémentaires.

- Caractéristiques (g3) : **2 PA** · portée 0–7 (non modifiable) · ligne de vue requise · CC 0% · relance 2 t. · cumul max 2
- Grades : g1 (niv. 45) : 2 PA, po 0–5 ; g2 (niv. 112) : 2 PA, po 0–6 ; g3 (niv. 179) : 2 PA, po 0–7
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–7 PO, LdV, relance 2, cumul 2
  - Sur l'allié ciblé (ou soi) selon les états présents sur **tous** les ennemis : Eau → +150 Puissance ; Feu → bouclier 200 % du niveau ; Air → **+1 PA** ; Terre → **+1 PM** (2 tours)
  - Pose sous chaque ennemi en état une rune de son élément, puis **consomme tous les états élémentaires** de la carte
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Runes Élémentaires » (32402, niv. 1)** → cible alliée  `[1160]`
    - ↳ sous-sort 32402 niv.1 : Runes Élémentaires : pose sous chaque ennemi porteur d'un état élémentaire une rune de l'élément de cet état.
  - **le lanceur lance le sous-sort « Contribution » (23971, niv. 1)** → cible alliée  `[1160]`
    - ↳ sous-sort 23971 « Contribution » niv.1 :
      - **Applique l'état « Contribution » (361)** → cible alliée ; 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Contribution » (23971, niv. 2)** → ennemis dans la zone — si cible a l'état « Eau » (291) ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 23971 « Contribution » niv.2 :
          - **+150 Puissance** → alliés dans la zone — si cible a l'état « Contribution » (361) ; zone tout le terrain (vivants), 2 tour(s)  `[138]`
      - **le lanceur lance le sous-sort « Contribution » (23971, niv. 3)** → ennemis dans la zone — si cible a l'état « Feu » (290) ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 23971 « Contribution » niv.3 :
          - **Bouclier : 200% du niveau** → alliés dans la zone — si cible a l'état « Contribution » (361) ; zone tout le terrain (vivants), 2 tour(s)  `[1020]`
      - **le lanceur lance le sous-sort « Contribution » (23971, niv. 4)** → ennemis dans la zone — si cible a l'état « Air » (293) ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 23971 « Contribution » niv.4 :
          - **1 PA** → alliés dans la zone — si cible a l'état « Contribution » (361) ; zone tout le terrain (vivants), 2 tour(s)  `[111]`
      - **le lanceur lance le sous-sort « Contribution » (23971, niv. 5)** → ennemis dans la zone — si cible a l'état « Terre » (292) ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 23971 « Contribution » niv.5 :
          - **1 PM** → alliés dans la zone — si cible a l'état « Contribution » (361) ; zone tout le terrain (vivants), 2 tour(s)  `[128]`
      - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → ennemis dans la zone ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
      - **Retire l'état « Contribution » (361)** → cible alliée  `[951]`
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants), 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **1 PM** → cible alliée — si cible a l'état « Contribution » (361) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[128]`
  - **Bouclier : 200% du niveau** → cible alliée — si cible a l'état « Contribution » (361) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **+150 Puissance** → cible alliée — si cible a l'état « Contribution » (361) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **1 PA** → cible alliée — si cible a l'état « Contribution » (361) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[111]`
- **Analyse / rôle tactique** : Buff de groupe très fort : avec 4 états différents répartis sur les ennemis, l'allié reçoit +1 PA, +1 PM, +150 Puissance et 400 de bouclier (niveau 200). À lancer sur le DPS principal avant son tour ; coûte cependant tous les états (plus de combinaisons possibles).
- *Notes moteur* : L'allié reçoit l'état 361 pendant le sous-sort ; les bonus sont conditionnés à `E361` (zone a). Chaque élément compte une seule fois, quel que soit le nombre d'ennemis.

#### Empreinte (`13697`) — variante (obtenu niv. 155)

> Consomme l'état élémentaire sur l'ennemi ciblé pour poser une rune dans l'élément de l'état.  Sur le lanceur : applique les effets sur tous les ennemis.  Sinon : pose une rune dans l'élément de la dernière rune posée par le lanceur.  L'utilisation du sort sur une case libre n'est possible qu'une seule fois par tour.

- Caractéristiques (g1) : **1 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 0% · 2×/tour · 1×/cible
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 0–6 PO, LdV, 2/tour, 1/cible
  - Sur un ennemi en état : consomme l'état et pose une rune de cet élément sous lui
  - Sur le lanceur : fait de même sur **tous** les ennemis
  - Sinon (ennemi sans état ou case libre, 1×/tour sur case libre) : pose une rune de l'élément de la Dernière rune
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Empreinte » (32401, niv. 1)** → lanceur (s’il est dans la zone)  `[1160]`
    - ↳ sous-sort 32401 « Empreinte » niv.1 :
      - **Applique l'état « Empreinte » (6956)** → lanceur ; 1 tour(s)  `[950]`
      - **la cible lance (sur elle-même) le sous-sort « Runes Élémentaires » (32402, niv. 1)** → lanceur  `[792]`
        - ↳ sous-sort 32402 niv.1 : Runes Élémentaires : pose sous chaque ennemi porteur d'un état élémentaire une rune de l'élément de cet état.
      - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → ennemis dans la zone ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
  - **le lanceur lance le sous-sort « Empreinte » (32401, niv. 2)** → cible ennemie — si cible a l'état « Eau » (291)  `[1160]`
    - ↳ sous-sort 32401 « Empreinte » niv.2 :
      - **Applique l'état « Empreinte » (6956)** → lanceur ; 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Runes Élémentaires » (32402, niv. 2)** → cible ennemie  `[1160]`
        - ↳ sous-sort 32402 niv.2 : Runes Élémentaires : pose sous chaque ennemi porteur d'un état élémentaire une rune de l'élément de cet état.
      - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → cible ennemie  `[1160]`
        - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
  - **le lanceur lance le sous-sort « Empreinte » (32401, niv. 2)** → cible ennemie — si cible a l'état « Feu » (290)  `[1160]`
    - ↳ (sous-sort 32401 niv.2 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Empreinte » (32401, niv. 2)** → cible ennemie — si cible a l'état « Terre » (292)  `[1160]`
    - ↳ (sous-sort 32401 niv.2 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Empreinte » (32401, niv. 2)** → cible ennemie — si cible a l'état « Air » (293)  `[1160]`
    - ↳ (sous-sort 32401 niv.2 déjà détaillé plus haut)
  - **la cible lance sur la case ciblée le sous-sort « Empreinte » (32401, niv. 3)** → lanceur  `[2794]`
    - ↳ sous-sort 32401 « Empreinte » niv.3 :
      - **la cible lance sur la case ciblée le sous-sort « Rune de Feu » (13687, niv. 1)** → lanceur — si lanceur a l'état « Dernière rune :  Feu » (701) ET si lanceur n'a PAS l'état « Empreinte » (6956)  `[2794]`
        - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
      - **la cible lance sur la case ciblée le sous-sort « Rune d'Eau » (13673, niv. 1)** → lanceur — si lanceur a l'état « Dernière rune :  Eau » (702) ET si lanceur n'a PAS l'état « Empreinte » (6956)  `[2794]`
        - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
      - **la cible lance sur la case ciblée le sous-sort « Rune d'Air » (13685, niv. 1)** → lanceur — si lanceur a l'état « Dernière rune :  Air » (704) ET si lanceur n'a PAS l'état « Empreinte » (6956)  `[2794]`
        - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
      - **la cible lance sur la case ciblée le sous-sort « Rune de Terre » (13686, niv. 1)** → lanceur — si lanceur a l'état « Dernière rune :  Terre » (703) ET si lanceur n'a PAS l'état « Empreinte » (6956)  `[2794]`
        - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
      - **Retire l'état « Empreinte » (6956)** → lanceur  `[951]`
      - **13697 : cible visible nécessaire activée** → lanceur — si lanceur n'a PAS l'état « Empreinte » (6956) ; 1 tour(s)  `[798]`
      - **Retire les effets du sort « Empreinte » (32401)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[406]`
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants), 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
- **Analyse / rôle tactique** : Fabrique des runes à bas coût (1 PA) pour alimenter Runification/Surcharge Runique ; mais consomme les états (réduit les combinaisons).
- *Notes moteur* : 798 « cible visible nécessaire » activé 1 tour après un usage sur case libre (limite 1×/tour).


### Paire 14 — Trait Ardent / Stalactite

#### Trait Ardent (`13680`) — sort de base (obtenu niv. 50)

> Repousse les cibles et occasionne des dommages Feu aux ennemis en zone.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **4 PA** · portée 1–6 (modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · 1×/tour
- Grades : g1 (niv. 50) : 4 PA, po 1–4, 21–23 Feu ; g2 (niv. 117) : 4 PA, po 1–5, 28–31 Feu ; g3 (niv. 184) : 4 PA, po 1–6, 33–37 Feu
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–6 PO modifiable, en ligne, LdV, 1/tour, CC 20 %
  - Zone barre perpendiculaire (T2, 5 cases) : repousse de 1 case
  - Dommages Feu 33–37 (CC 40–44) aux ennemis de la zone ; rune Feu + état Feu à chacun
- Effets décodés (données brutes DofusDB) :
  - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone ; zone ligne perpendiculaire (barre en T) taille 2, *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **le lanceur lance le sous-sort « Trait Ardent » (32395, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone ligne perpendiculaire (barre en T) taille 2  `[1160]`
    - ↳ sous-sort 32395 « Trait Ardent » niv.1 :
      - **Repousse la cible de 1 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Pose une rune (sort déclenché) « Rune de Feu » (13665, niv. 1)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13665 niv.1 : sort de la rune Feu (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 2  `[1160]`
    - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
  - **33 à 37 dommages Feu (CC : 40 à 44)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 2  `[99]`
  - **Applique l'état « Feu » (290)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 2, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 2  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Principal sort de zone Feu ; pose des états/runes sur jusqu'à 5 ennemis (prépare Runification sur soi).
- *Notes moteur* : Poussée via sous-sort 32395 sur chaque cible de la zone.

#### Stalactite (`13717`) — variante (obtenu niv. 160)

> Occasionne des dommages Eau et retire des PM.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **2 PA** · portée 1–4 (non modifiable) · sans ligne de vue · CC 10% · 3×/tour · 1×/cible · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–4 PO sans LdV, 3/tour, 1/cible
  - Dommages Eau 23–25 (CC 28–30)
  - Retire 2 PM (esquivable, 1 tour) ; rune Eau + état Eau
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune d'Eau » (13688, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13688 niv.1 : sort de la rune Eau (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
  - **23 à 25 dommages Eau (CC : 28 à 30)** → cible (alliée ou ennemie)  `[96]`
  - **Applique l'état « Eau » (291)** → cible ennemie — si cible n'a PAS l'état « Eau » (291) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
- **Analyse / rôle tactique** : Retrait PM à 2 PA, 3 cibles différentes par tour : excellent pour immobiliser plusieurs monstres (ou −2 PM + Enlisement −3 PM sur une cible en Terre).
- *Notes moteur* : Masque a,A.


### Paire 15 — Glacier / Volcan

#### Glacier (`13676`) — sort de base (obtenu niv. 55)

> Attire les cibles vers le centre et vole de la vie dans l'élément Eau aux ennemis en zone.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 20% · 1×/tour
- Grades : g1 (niv. 55) : 4 PA, po 0–0, 21–24 vol Eau ; g2 (niv. 122) : 4 PA, po 0–0, 28–32 vol Eau ; g3 (niv. 189) : 4 PA, po 0–0, 32–36 vol Eau
- **Résumé des effets (lecture humaine)** :
  - 4 PA, sur soi, cercle 3 (hors lanceur), 1/tour, CC 20 %
  - Attire de 2 cases vers le lanceur les entités du cercle (alliés hors lanceur et ennemis)
  - Vol de vie Eau 32–36 (CC 38–43) aux ennemis de la zone ; runes Eau + états Eau
- Effets décodés (données brutes DofusDB) :
  - **Attire la cible de 2 case(s)** → tous sauf le lanceur dans la zone ; zone cercle taille 3 (min 1)  `[6]`
  - **Pose une rune (sort déclenché) « Rune d'Eau » (13688, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1), 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13688 niv.1 : sort de la rune Eau (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
    - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
  - **32 à 36 vol Eau (CC : 38 à 43)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[91]`
  - **Applique l'état « Eau » (291)** → ennemis dans la zone — si cible n'a PAS l'état « Eau » (291) ; zone cercle taille 3 (min 1), durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
    - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Regroupe les ennemis autour de soi (utile avant une zone d'allié) en se soignant ; dangereux pour un mage fragile.
- *Notes moteur* : Zone C3 min 1 ; attirance avant les vols.

#### Volcan (`13718`) — variante (obtenu niv. 165)

> Vole de la vie dans l'élément Feu et augmente les dommages subis par la cible.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **2 PA** · portée 1–6 (modifiable) · en ligne uniquement · sans ligne de vue · CC 10% · 3×/tour · 1×/cible · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–6 PO modifiable, en ligne, sans LdV, 3/tour, 1/cible
  - Vol de vie Feu 17–19 (CC 20–23)
  - Dommages subis ×104 % pendant 1 tour (1 cumul) ; rune Feu + état Feu
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune de Feu » (13665, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13665 niv.1 : sort de la rune Feu (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
  - **17 à 19 vol Feu (CC : 20 à 23)** → cible (alliée ou ennemie)  `[94]`
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Dommages subis x104%** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
- **Analyse / rôle tactique** : Petit vol de vie + amplification légère des dommages subis par la cible pour le reste du groupe.
- *Notes moteur* : 1163 avec déclencheur D, actif 1 tour.


### Paire 16 — Rafale / Brèche

#### Rafale (`13678`) — sort de base (obtenu niv. 60)

> Téléporte les cibles symétriquement par rapport au centre et vole de la vie dans l'élément Air aux ennemis en zone. N'affecte pas directement le lanceur.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **4 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 20% · 1×/tour
- Grades : g1 (niv. 60) : 4 PA, po 0–4, 21–24 vol Air ; g2 (niv. 127) : 4 PA, po 0–4, 26–30 vol Air ; g3 (niv. 194) : 4 PA, po 0–4, 29–33 vol Air
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 0–4 PO, LdV, 1/tour, CC 20 % ; n'affecte pas directement le lanceur
  - Téléportation symétrique des entités du cercle 2 par rapport au centre
  - Vol de vie Air 29–33 (CC 35–40) aux ennemis du cercle ; runes Air + états Air
- Effets décodés (données brutes DofusDB) :
  - **Téléportation symétrique** → tous sauf le lanceur dans la zone ; zone cercle taille 2  `[1106]`
  - **Pose une rune (sort déclenché) « Rune d'Air » (13689, niv. 1)** → ennemis dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13689 niv.1 : sort de la rune Air (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → ennemis dans la zone ; zone cercle taille 2  `[1160]`
    - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
  - **29 à 33 vol Air (CC : 35 à 40)** → ennemis dans la zone ; zone cercle taille 2  `[93]`
  - **Applique l'état « Air » (293)** → ennemis dans la zone ; zone cercle taille 2, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → ennemis dans la zone ; zone cercle taille 2  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Zone Air avec réorganisation (inverse les positions autour du centre).
- *Notes moteur* : 1106 (symétrie autour du point d'impact) sur alliés hors lanceur et ennemis.

#### Brèche (`13725`) — variante (obtenu niv. 170)

> Vole de la vie dans l'élément Terre et retire de la Portée.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **2 PA** · portée 1–5 (modifiable) · sans ligne de vue · CC 10% · 3×/tour · 1×/cible · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–5 PO modifiable, sans LdV, 3/tour, 1/cible
  - Vol de vie Terre 16–18 (CC 19–22) ; −2 PO (1 tour)
  - Rune Terre + état Terre
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
  - **16 à 18 vol Terre (CC : 19 à 22)** → cible (alliée ou ennemie)  `[92]`
  - **Applique l'état « Terre » (292)** → cible ennemie — si cible n'a PAS l'état « Terre » (292) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **-2 Portée** → cible (alliée ou ennemie) ; 1 tour(s)  `[116]`
- **Analyse / rôle tactique** : Petit sort Terre à 2 PA pour compléter les PA et poser un état.


### Paire 17 — Orage / Ouragan

#### Orage (`13674`) — sort de base (obtenu niv. 65)

> Repousse les cibles depuis le centre et occasionne des dommages Terre aux ennemis en zone. N'affecte pas le lanceur.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g3) : **4 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 20% · 1×/tour
- Grades : g1 (niv. 65) : 4 PA, po 0–4, 24–27 Terre ; g2 (niv. 132) : 4 PA, po 0–5, 29–32 Terre ; g3 (niv. 199) : 4 PA, po 0–6, 32–36 Terre
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 0–6 PO modifiable, LdV, 1/tour, CC 20 % ; n'affecte pas le lanceur
  - Zone croix 1 (5 cases) : dommages Terre 32–36 (CC 38–43) aux ennemis ; runes Terre + états Terre
  - Repousse de 1 case depuis le centre les entités des 4 cases adjacentes
- Effets décodés (données brutes DofusDB) :
  - **Repousse la cible de 1 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 1  `[5]`
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → ennemis dans la zone ; zone croix taille 1  `[1160]`
    - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
  - **32 à 36 dommages Terre (CC : 38 à 43)** → ennemis dans la zone ; zone croix taille 1  `[97]`
  - **Applique l'état « Terre » (292)** → ennemis dans la zone — si cible n'a PAS l'état « Terre » (292) ; zone croix taille 1, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → ennemis dans la zone ; zone croix taille 1  `[1160]`
    - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Zone Terre (croix) ; la poussée éloigne les entités autour du centre.
- *Notes moteur* : Poussée Q1 autour du centre, alliés hors lanceur et ennemis.

#### Ouragan (`13714`) — variante (obtenu niv. 175)

> Occasionne des dommages Air et retire des PA.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **2 PA** · portée 1–6 (non modifiable) · sans ligne de vue · CC 10% · 3×/tour · 1×/cible · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–6 PO, sans LdV, 3/tour, 1/cible
  - Dommages Air 21–23 (CC 25–28)
  - Retire 1 PA (esquivable, 1 tour) ; rune Air + état Air
- Effets décodés (données brutes DofusDB) :
  - **Pose une rune (sort déclenché) « Rune d'Air » (13689, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13689 niv.1 : sort de la rune Air (effets selon le sort déclencheur, tableau §2.2).
  - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
  - **21 à 23 dommages Air (CC : 25 à 28)** → cible (alliée ou ennemie)  `[98]`
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Retire 1 PA (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1079]`
- **Analyse / rôle tactique** : Retrait PA à 2 PA sur 3 cibles ; combiné à Lance-flamme/Carbonisation, entrave PA solide.
- *Notes moteur* : Masque a,A.


### Paire 18 — Bouclier Élémentaire / Gardien Élémentaire

#### Bouclier Élémentaire (`13682`) — sort de base (obtenu niv. 70)

> Augmente les résistances de l'allié ciblé et lui applique l'état Bouclier Élémentaire : • Applique un état élémentaire sur l'attaquant selon l'élément de l'attaque subie par la cible.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **2 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 0% · relance 3 t. · cumul max 5
- Grades : g1 (niv. 70) : 2 PA, po 0–5 ; g2 (niv. 137) : 2 PA, po 0–6
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO, LdV, relance 3, cumul 5
  - Allié : +25 % résistances (toutes) pendant 2 tours + état Bouclier Élémentaire
  - Chaque fois que l'allié subit des dommages d'un élément : −5 % de résistance dans cet élément (2 t.) et l'attaquant reçoit l'état de cet élément (→ combinaisons sur l'attaquant)
- Effets décodés (données brutes DofusDB) :
  - **25% Résistance** → cible alliée ; 2 tour(s)  `[1076]`
  - **Applique l'état « Bouclier Élémentaire » (3645)** → cible alliée ; 2 tour(s)  `[950]`
  - **-5% Résistance Neutre** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : dommages Neutre subis  `[219]`
  - **-5% Résistance Terre** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : dommages Terre subis  `[215]`
  - **-5% Résistance Feu** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : dommages Feu subis  `[218]`
  - **-5% Résistance Eau** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : dommages Eau subis  `[216]`
  - **-5% Résistance Air** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : dommages Air subis  `[217]`
  - **Retire les effets du sort « Bouclier Élémentaire » (13682)** → cible alliée ; délai 2 t.  `[406]`
  - **le lanceur lance le sous-sort « Bouclier Élémentaire » (13698, niv. 1)** → cible alliée ; actif 2 tour(s), déclencheur : dommages Feu subis  `[1160]`
    - ↳ sous-sort 13698 « Bouclier Élémentaire » niv.1 :
      - **le lanceur lance le sous-sort « Rune de Feu » (13687, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
        - ↳ sous-sort 13687 niv.1 : Rune de Feu : pose la rune Feu (marque 13665, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Feu » (701) — §2.2.
      - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63)  `[1160]`
        - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « Bouclier Élémentaire » (13698, niv. 2)** → cible alliée ; actif 2 tour(s), déclencheur : dommages Eau subis  `[1160]`
    - ↳ sous-sort 13698 « Bouclier Élémentaire » niv.2 :
      - **le lanceur lance le sous-sort « Rune d'Eau » (13673, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
        - ↳ sous-sort 13673 niv.1 : Rune d'Eau : pose la rune Eau (marque 13688, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Eau » (702) — §2.2.
      - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63)  `[1160]`
        - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « Bouclier Élémentaire » (13698, niv. 3)** → cible alliée ; actif 2 tour(s), déclencheur : dommages Terre subis  `[1160]`
    - ↳ sous-sort 13698 « Bouclier Élémentaire » niv.3 :
      - **le lanceur lance le sous-sort « Rune de Terre » (13686, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
        - ↳ sous-sort 13686 niv.1 : Rune de Terre : pose la rune Terre (marque 13690, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Terre » (703) — §2.2.
      - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63)  `[1160]`
        - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « Bouclier Élémentaire » (13698, niv. 4)** → cible alliée ; actif 2 tour(s), déclencheur : dommages Air subis  `[1160]`
    - ↳ sous-sort 13698 « Bouclier Élémentaire » niv.4 :
      - **le lanceur lance le sous-sort « Rune d'Air » (13685, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
        - ↳ sous-sort 13685 niv.1 : Rune d'Air : pose la rune Air (marque 13689, 2 tours) sur la case de l'ennemi et mémorise « Dernière rune : Air » (704) — §2.2.
      - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → ennemis, l'entité déclenchante si dans la zone ; zone cercle illimitée (63)  `[1160]`
        - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Retire les effets du sort « Bouclier Élémentaire » (25488)** → cible alliée ; actif 2 tour(s), déclencheur : quand l'état « Bouclier Élémentaire » (3645) est retiré, non désenvoûtable  `[406]`
  - **Retire les effets du sort « Bouclier Élémentaire » (13682)** → cible alliée ; actif 2 tour(s), déclencheur : quand l'état « Bouclier Élémentaire » (3645) est retiré, non désenvoûtable  `[406]`
  - **la cible lance sur la case ciblée le sous-sort « Bouclier Élémentaire » (25488, niv. 1)** → lanceur  `[2794]`
    - ↳ sous-sort 25488 niv.1 : affichage de l'état « Bouclier Élémentaire » (4003) aux adversaires joueurs ; sans effet de jeu.
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible (alliée ou ennemie) ; 2 tour(s), actif 2 tour(s)  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **Applique l'état « Terre » (292)** → cible (alliée ou ennemie) ; durée infinie, actif 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Feu » (290)** → cible (alliée ou ennemie) ; durée infinie, actif 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Eau » (291)** → cible (alliée ou ennemie) ; durée infinie, actif 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Air » (293)** → cible (alliée ou ennemie) ; durée infinie, actif 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Protection d'un allié ciblé par le boss (+25 % rés. qui s'érode à chaque coup). Les attaquants se voient poser des états : l'Huppermage n'a plus qu'à frapper dans un autre élément pour générer une combinaison.
- *Notes moteur* : Effets 215–219 déclenchés (DA/DE/DF/DW/DN), sous-sort 13698 niv. 1–4 sur l'attaquant (masque A,o). Retrait des effets au retrait de l'état 3645.

#### Gardien Élémentaire (`13720`) — variante (obtenu niv. 180)

> Invoque un Gardien Élémentaire maîtrisable qui peut occasionner des dommages, poser des runes et changer des états élémentaires.  Lorsqu'une combinaison élémentaire est générée par le lanceur, le Gardien gagne des effets selon la combinaison.

- Caractéristiques (g1) : **3 PA** · portée 1–4 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 4 t. · relance globale -1 t.
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO, LdV, case libre, relance 4
  - Invoque le Gardien Élémentaire (monstre 5129) : 9 PA, 5 PM, sorts Rayon Quadramental (24–28 Neutre ou élément de l'état de la cible + rune), Cycle/Courant du Gardien
  - Le Gardien gagne +200 Puissance et 200 bouclier (3 t.) à chaque combinaison générée par l'Huppermage, et un bonus permanent par type de combinaison (+3 PA, +3 PM, +15 % dommages finaux, ×85 % dommages subis, +30 Tacle, +3 PO)
- Effets décodés (données brutes DofusDB) :
  - **Invoque « Gardien Élémentaire » (monstre 5129, grade 1)** → cible (alliée ou ennemie)  `[181]`
  - **le lanceur lance le sous-sort « Élaboration Quadramentale » (26187, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 26187 niv.1 : infobulle (aucun effet de jeu).
- **Analyse / rôle tactique** : Invocation offensive qui grossit avec les combinaisons ; pose des runes comptées pour l'Huppermage. Remplace Bouclier Élémentaire (protection) : à prendre en PvM quand aucun allié n'a besoin de résistances.
- *Notes moteur* : Voir §2.4. Rayon Quadramental fait lancer les runes par l'invocateur (2794 vers h,P).


### Paire 19 — Polarité / Convection

#### Polarité (`13696`) — sort de base (obtenu niv. 75)

> Consomme l'état élémentaire sur l'ennemi ciblé pour appliquer des effets selon son état élémentaire : •  Terre : repousse la cible. •  Feu : échange de position avec la cible. •  Eau : attire la cible. •  Air : téléporte le lanceur symétriquement par rapport à la cible.

- Caractéristiques (g2) : **1 PA** · portée 1–4 (non modifiable) · sans ligne de vue · CC 0% · 2×/tour
- Grades : g1 (niv. 75) : 1 PA, po 1–3 ; g2 (niv. 142) : 1 PA, po 1–4
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–4 PO sans LdV, 2/tour
  - Consomme l'état de l'ennemi ciblé : Terre → le repousse de 3 ; Feu → échange de position ; Eau → l'attire de 3 ; Air → le lanceur se téléporte symétriquement par rapport à lui
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
  - **Repousse la cible de 3 case(s)** → cible ennemie — si cible a l'état « Terre » (292)  `[5]`
  - **Échange de positions (lanceur ↔ cible)** → cible ennemie — si cible a l'état « Feu » (290)  `[8]`
  - **Attire la cible de 3 case(s)** → cible ennemie — si cible a l'état « Eau » (291)  `[6]`
  - **Téléportation symétrique** → lanceur — si cible a l'état « Air » (293) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1106]`
  - **le lanceur lance le sous-sort « Polarité » (13699, niv. 1)** → cible ennemie — si cible a l'état « Air » (293)  `[1160]`
    - ↳ sous-sort 13699 « Polarité » niv.1 :
      - **Téléportation symétrique** → lanceur  `[1106]`
- **Analyse / rôle tactique** : Placement à 1 PA dont l'effet est choisi par l'état de la cible (que l'on peut régler avec Cycle Élémentaire).
- *Notes moteur* : 32415 (retrait des états) est exécuté en premier, mais les conditions E<état> des effets suivants sont évaluées sur l'instantané initial.

#### Convection (`13716`) — variante (obtenu niv. 185)

> Consomme l'état élémentaire sur l'ennemi ciblé pour appliquer des effets selon son état élémentaire : •  Terre : éloigne le lanceur de la cible. •  Feu : téléporte la cible et le lanceur à leur position précédente. •  Eau : rapproche le lanceur vers la cible. •  Air : téléporte la cible symétriquement par rapport au lanceur.

- Caractéristiques (g1) : **1 PA** · portée 1–4 (non modifiable) · sans ligne de vue · CC 0% · relance initiale 1 t. · 2×/tour
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–4 PO sans LdV, 2/tour, 1er lancer possible au tour 2
  - Consomme l'état : Terre → le lanceur recule de 3 ; Feu → la cible et le lanceur reviennent à leur position précédente ; Eau → le lanceur avance de 3 ; Air → la cible est téléportée symétriquement par rapport au lanceur
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « État Élémentaire » (32415, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32415 niv.1 : retire les 4 états élémentaires (290–293) de la cible.
  - **Le lanceur recule de 3 case(s) (s’éloigne de la cible)** → cible ennemie — si cible a l'état « Terre » (292)  `[1041]`
  - **Téléporte à la position précédente** → lanceur, ennemis — si cible a l'état « Feu » (290) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1100]`
  - **Le lanceur avance de 3 case(s) vers la cible** → cible ennemie — si cible a l'état « Eau » (291)  `[1042]`
  - **Téléportation symétrique par rapport au lanceur** → cible ennemie — si cible a l'état « Air » (293)  `[1105]`
  - **le lanceur lance le sous-sort « Convection » (32400, niv. 1)** → cible ennemie — si cible a l'état « Feu » (290)  `[1160]`
    - ↳ sous-sort 32400 « Convection » niv.1 :
      - **Téléporte à la position précédente** → lanceur, ennemis — si cible n'a PAS l'état « Pesanteur » (7) ET si cible n'a PAS l'état « Indéplaçable » (97) ET si cible n'a PAS l'état « Enraciné » (6)  `[1100]`
- **Analyse / rôle tactique** : Version « auto-placement » de Polarité.
- *Notes moteur* : initialCooldown 1.


### Paire 20 — Surcharge Runique / Sublimation

#### Surcharge Runique (`13724`) — sort de base (obtenu niv. 80)

> Déclenche toutes les runes du lanceur pour occasionner des dommages à l'ennemi ou soigner l'allié ciblé pour chaque rune déclenchée dans l'élément des runes.

- Caractéristiques (g2) : **3 PA** · portée 0–6 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 0% · 1×/tour
- Grades : g1 (niv. 80) : 3 PA, po 0–5, 7–7 Eau, 7–7 Feu, 7–7 Air, 7–7 Terre ; g2 (niv. 147) : 3 PA, po 0–6, 10–10 Eau, 10–10 Feu, 10–10 Air, 10–10 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–6 PO, LdV, cible requise, 1/tour
  - Déclenche **toutes** les runes du lanceur : chaque rune inflige 10 dommages de son élément à l'ennemi ciblé (où qu'il soit), ou soigne de 4 % PV max l'allié ciblé
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Surcharge Runique (rang 2) » (6980)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **Applique l'état « Surcharge Runique » (601)** → lanceur ; 1 tour(s)  `[950]`
  - **Déclenche les runes** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[2023]`
  - **Retire l'état « Surcharge Runique » (601)** → lanceur ; zone tout le terrain (vivants)  `[951]`
  - **Retire l'état « Surcharge Runique (rang 2) » (6980)** → cible (alliée ou ennemie)  `[951]`
  - **10 dommages Eau** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[96]`
  - **10 dommages Feu** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[99]`
  - **10 dommages Air** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[98]`
  - **10 dommages Terre** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[97]`
  - **Soin : 4% des PV max** → cible alliée ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
- **Analyse / rôle tactique** : Finisher de runes : avec 6–10 runes actives (zones Trait Ardent/Orage/Glacier…), 60–100 dommages de base multi-éléments sur une cible unique ; ou soin d'urgence (4 % × runes).
- *Notes moteur* : Pose 6980 sur la cible et 601 sur le lanceur, 2023 sur toute la carte. Chaque rune = un lancer séparé (multiplicateurs appliqués par ligne).

#### Sublimation (`13684`) — variante (obtenu niv. 190)

> Applique les états Pesanteur et Sublimation sur l'ennemi ciblé : • Augmente les caractéristiques de l'attaquant et applique un état sur la cible selon l'élément de l'attaque qu'elle subit (cumulable 4 fois).  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **2 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 0% · relance 2 t. · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–6 PO, LdV, relance 2
  - Ennemi : états Pesanteur (pas d'échange de place) et Sublimation pendant 1 tour
  - Chaque fois qu'il subit des dommages d'un élément : l'attaquant (et alliés) gagne +50 dans la caractéristique de l'élément (2 tours) et la cible reçoit l'état de l'élément (combinaisons) — cumulable 4 fois
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Sublimation » (32671, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32671 « Sublimation » niv.1 :
      - **Applique l'état « Pesanteur » (7)** → cible ennemie ; 1 tour(s)  `[950]`
      - **Applique l'état « Sublimation » (6967)** → cible ennemie ; 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Sublimation » (32671, niv. 2)** → cible ennemie ; actif 1 tour(s), déclencheur : dommages Terre subis  `[1160]`
        - ↳ sous-sort 32671 « Sublimation » niv.2 :
          - **-50 Force** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[157]`
          - **50 Force** → alliés (dont lanceur si dans la zone), l'entité qui a déclenché l'effet (attaquant) ; 2 tour(s)  `[118]`
          - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → cible ennemie  `[1160]`
            - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort « Sublimation » (32671, niv. 3)** → cible ennemie ; actif 1 tour(s), déclencheur : dommages Feu subis  `[1160]`
        - ↳ sous-sort 32671 « Sublimation » niv.3 :
          - **-50 Intelligence** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[155]`
          - **50 Intelligence** → alliés (dont lanceur si dans la zone), l'entité qui a déclenché l'effet (attaquant) ; 2 tour(s)  `[126]`
          - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → cible ennemie  `[1160]`
            - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort « Sublimation » (32671, niv. 4)** → cible ennemie ; actif 1 tour(s), déclencheur : dommages Eau subis  `[1160]`
        - ↳ sous-sort 32671 « Sublimation » niv.4 :
          - **-50 Chance** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[152]`
          - **50 Chance** → alliés (dont lanceur si dans la zone), l'entité qui a déclenché l'effet (attaquant) ; 2 tour(s)  `[123]`
          - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → cible ennemie  `[1160]`
            - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
      - **le lanceur lance le sous-sort « Sublimation » (32671, niv. 5)** → cible ennemie ; actif 1 tour(s), déclencheur : dommages Air subis  `[1160]`
        - ↳ sous-sort 32671 « Sublimation » niv.5 :
          - **-50 Agilité** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[154]`
          - **50 Agilité** → alliés (dont lanceur si dans la zone), l'entité qui a déclenché l'effet (attaquant) ; 2 tour(s)  `[119]`
          - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → cible ennemie  `[1160]`
            - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **Applique l'état « Pesanteur » (7)** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Sublimation » (6967)** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-50 Force** → cible (alliée ou ennemie) ; 1 tour(s), actif 1 tour(s), déclencheur : dommages Terre subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[157]`
  - **50 Force** → cible (alliée ou ennemie) ; 2 tour(s), actif 1 tour(s), déclencheur : dommages Terre subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[118]`
  - **Applique l'état « Terre » (292)** → cible (alliée ou ennemie) ; durée infinie, actif 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-50 Intelligence** → cible (alliée ou ennemie) ; 1 tour(s), actif 1 tour(s), déclencheur : dommages Feu subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[155]`
  - **50 Intelligence** → cible (alliée ou ennemie) ; 2 tour(s), actif 1 tour(s), déclencheur : dommages Feu subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[126]`
  - **Applique l'état « Feu » (290)** → cible (alliée ou ennemie) ; durée infinie, actif 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-50 Chance** → cible (alliée ou ennemie) ; 1 tour(s), actif 1 tour(s), déclencheur : dommages Eau subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[152]`
  - **50 Chance** → cible (alliée ou ennemie) ; 2 tour(s), actif 1 tour(s), déclencheur : dommages Eau subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[123]`
  - **Applique l'état « Eau » (291)** → cible (alliée ou ennemie) ; durée infinie, actif 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-50 Agilité** → cible (alliée ou ennemie) ; 1 tour(s), actif 1 tour(s), déclencheur : dommages Air subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[154]`
  - **50 Agilité** → cible (alliée ou ennemie) ; 2 tour(s), actif 1 tour(s), déclencheur : dommages Air subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[119]`
  - **Applique l'état « Air » (293)** → cible (alliée ou ennemie) ; durée infinie, actif 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Transforme le boss en générateur de buffs pour toute l'équipe : chaque allié qui le frappe gagne +50 dans son élément (jusqu'à 4 cumuls), et l'Huppermage obtient des combinaisons via les attaques alliées.
- *Notes moteur* : Déclencheurs DE/DF/DW/DA (1 tour) sur la cible ; 118/119/123/126 vers `a,O` (l'attaquant).


### Paire 21 — Propagation / Prisme Runique

#### Propagation (`13695`) — sort de base (obtenu niv. 85)

> Applique des effets et propage les états sur les ennemis en zone selon l'état élémentaire de l'ennemi ciblé : •  Terre : réduit les Résistances Poussée. •  Feu : retire des Critiques. •  Eau : retire de la Fuite. •  Air : retire du Tacle.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **1 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 0% · 2×/tour · 1×/cible · cumul max 2
- Grades : g1 (niv. 85) : 1 PA, po 1–6 ; g2 (niv. 152) : 1 PA, po 1–8
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–8 PO modifiable, LdV, 2/tour, 1/cible
  - Selon l'état de l'ennemi ciblé (non consommé), sur les ennemis en cercle 3 : Terre → −40 Résistances Poussée ; Feu → −15 % Critique ; Eau → −20 Fuite ; Air → −20 Tacle (1 tour)
  - Propage l'état de la cible à tous les ennemis du cercle 3 (→ combinaisons en chaîne sur ceux qui portent un autre état)
- Effets décodés (données brutes DofusDB) :
  - **-40 Résistances Poussée** → ennemis dans la zone — si cible a l'état « Terre » (292) ; zone cercle taille 3, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[417]`
  - **Applique l'état « Terre » (292)** → ennemis dans la zone — si cible n'a PAS l'état « Terre » (292) ; zone cercle taille 3, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-15% Critique** → ennemis dans la zone — si cible a l'état « Feu » (290) ; zone cercle taille 3, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[171]`
  - **Applique l'état « Feu » (290)** → ennemis dans la zone — si cible n'a PAS l'état « Feu » (290) ; zone cercle taille 3, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-20 Fuite** → ennemis dans la zone — si cible a l'état « Eau » (291) ; zone cercle taille 3, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[754]`
  - **Applique l'état « Eau » (291)** → ennemis dans la zone — si cible n'a PAS l'état « Eau » (291) ; zone cercle taille 3, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **-20 Tacle** → ennemis dans la zone — si cible a l'état « Air » (293) ; zone cercle taille 3, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[755]`
  - **Applique l'état « Air » (293)** → ennemis dans la zone — si cible n'a PAS l'état « Air » (293) ; zone cercle taille 3, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Propagation » (13694, niv. 5)** → cible ennemie — si cible a l'état « Feu » (290)  `[1160]`
    - ↳ sous-sort 13694 « Propagation » niv.5 :
      - **-15% Critique** → ennemis dans la zone ; zone cercle taille 3, 1 tour(s)  `[171]`
      - **le lanceur lance le sous-sort «  État Feu » (32392, niv. 1)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
        - ↳ sous-sort 32392 niv.1 : État Feu : applique l'état Feu (290, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « Propagation » (13694, niv. 6)** → cible ennemie — si cible a l'état « Eau » (291)  `[1160]`
    - ↳ sous-sort 13694 « Propagation » niv.6 :
      - **-20 Fuite** → ennemis dans la zone ; zone cercle taille 3, 1 tour(s)  `[754]`
      - **le lanceur lance le sous-sort «  État Eau » (32393, niv. 1)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
        - ↳ sous-sort 32393 niv.1 : État Eau : applique l'état Eau (291, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « Propagation » (13694, niv. 7)** → cible ennemie — si cible a l'état « Terre » (292)  `[1160]`
    - ↳ sous-sort 13694 « Propagation » niv.7 :
      - **-40 Résistances Poussée** → ennemis dans la zone ; zone cercle taille 3, 1 tour(s)  `[417]`
      - **le lanceur lance le sous-sort «  État Terre » (32391, niv. 1)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
        - ↳ sous-sort 32391 niv.1 : État Terre : applique l'état Terre (292, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
  - **le lanceur lance le sous-sort « Propagation » (13694, niv. 8)** → cible ennemie — si cible a l'état « Air » (293)  `[1160]`
    - ↳ sous-sort 13694 « Propagation » niv.8 :
      - **-20 Tacle** → ennemis dans la zone ; zone cercle taille 3, 1 tour(s)  `[755]`
      - **le lanceur lance le sous-sort «  État Air » (32394, niv. 1)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
        - ↳ sous-sort 32394 niv.1 : État Air : applique l'état Air (293, permanent) à l'ennemi s'il ne l'a pas, puis Combinaison Élémentaire (§2.3).
- **Analyse / rôle tactique** : Multiplicateur de combinaisons en PvM de groupe : un seul état bien placé se propage à 5–6 monstres agglutinés.
- *Notes moteur* : Sous-sorts 13694 niv. 5–8 ; propagation via « État X » (zone C3 min 1).

#### Prisme Runique (`13719`) — variante (obtenu niv. 195)

> Déclenche une rune du lanceur pour appliquer des effets et un état élémentaire sur les ennemis en zone selon son élément : •  Terre : réduit la durée des effets sur les cibles. •  Feu : réduit les soins reçus par les cibles. •  Eau : érode les cibles. •  Air : soigne les attaquants des cibles.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 0% · 1×/tour · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO modifiable, LdV, 1/tour
  - Déclenche la rune ciblée : effets en cercle 2 autour d'elle selon son élément — Terre : durée des effets −1 ; Feu : soins reçus ×70 % (2 t.) ; Eau : 15 % d'érosion (2 t.) ; Air : les attaquants des cibles sont soignés de 15 % des dommages (2 t.) ; + état de l'élément aux ennemis
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Prisme Élémentaire » (6957)** → lanceur ; 1 tour(s)  `[950]`
  - **Déclenche les runes** → cible (alliée ou ennemie)  `[2023]`
  - **Durée des effets : -1** → ennemis dans la zone ; zone cercle taille 2, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1075]`
  - **Applique l'état « Terre » (292)** → ennemis dans la zone ; zone cercle taille 2, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Soins reçus x70%** → ennemis dans la zone ; zone cercle taille 2, actif 2 tour(s), déclencheur : quand la cible est soignée, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1159]`
  - **Applique l'état « Feu » (290)** → ennemis dans la zone ; zone cercle taille 2, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **15% Érosion** → ennemis dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[776]`
  - **Applique l'état « Eau » (291)** → ennemis dans la zone ; zone cercle taille 2, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Soigne l'attaquant de 15% des dommages qu'il inflige à la cible** → ennemis dans la zone ; zone cercle taille 2, actif 2 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[786]`
  - **Applique l'état « Air » (293)** → ennemis dans la zone ; zone cercle taille 2, durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Retire l'état « Prisme Élémentaire » (6957)** → lanceur  `[951]`
- **Analyse / rôle tactique** : Debuff de zone (anti-soin, érosion, désenvoûtement partiel) à partir d'une rune.
- *Notes moteur* : État 6957 sur le lanceur ; le sort de rune lance 13733 niv. 1–4.


### Paire 22 — Supernova / Torrent Arcanique

#### Supernova (`32033`) — sort de base (obtenu niv. 90)

> Réduit la durée des effets sur la cible et occasionne des dommages dans les meilleurs et pires éléments du lanceur aux ennemis. Pose une rune du pire élément.  Peut générer des Combinaisons Élémentaires.

- Caractéristiques (g2) : **3 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · 1×/cible
- Grades : g1 (niv. 90) : 3 PA, po 0–5, 15–17 meilleur élt ; g2 (niv. 157) : 3 PA, po 0–6, 19–21 meilleur élt
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–6 PO modifiable, LdV, 2/tour, 1/cible
  - Durée des effets −1 sur la cible
  - Dommages du **meilleur** élément 19–21 (CC 23–25) puis du **pire** élément 9–11 (CC 12–14)
  - Applique l'état du meilleur élément puis celui du pire (→ **combinaison garantie** si les deux diffèrent) et pose une rune du pire élément
- Effets décodés (données brutes DofusDB) :
  - **Durée des effets : -1** → cible (alliée ou ennemie)  `[1075]`
  - **Pose une rune (sort déclenché) « Rune de Terre » (13690, niv. 1)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2022]`
    - ↳ sous-sort 13690 niv.1 : sort de la rune Terre (effets selon le sort déclencheur, tableau §2.2).
  - **la cible lance (sur elle-même) le sous-sort « Supernova » (32034, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 32034 niv.1 : Supernova (interne) : arme sur le lanceur 4 déclencheurs CDE/CDF/CDW/CDA (« inflige des dommages Terre/Feu/Eau/Air », 1 tour) qui posent l'état « Supernova (élément) » (6671–6674) selon l'élément des dommages infligés juste après.
  - **19 à 21 dommages du meilleur élément (CC : 23 à 25)** → cible ennemie  `[2822]`
  - **le lanceur lance le sous-sort « Supernova » (32034, niv. 6)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32034 niv.6 : Supernova (interne) : sur l'ennemi, applique l'état élémentaire mémorisé (6671–6674) et, si le lanceur porte « Supernova (rune) » (6675, seulement au 2e passage = pire élément), pose la rune de cet élément ; retire les déclencheurs.
  - **la cible lance (sur elle-même) le sous-sort « Supernova » (32034, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 32034 niv.1 : Supernova (interne) : arme sur le lanceur 4 déclencheurs CDE/CDF/CDW/CDA (« inflige des dommages Terre/Feu/Eau/Air », 1 tour) qui posent l'état « Supernova (élément) » (6671–6674) selon l'élément des dommages infligés juste après.
  - **9 à 11 dommages du pire élément (CC : 12 à 14)** → cible ennemie  `[2832]`
  - **Applique l'état « Supernova (rune) » (6675)** → lanceur ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Supernova » (32034, niv. 6)** → cible ennemie  `[1160]`
    - ↳ sous-sort 32034 niv.6 : Supernova (interne) : sur l'ennemi, applique l'état élémentaire mémorisé (6671–6674) et, si le lanceur porte « Supernova (rune) » (6675, seulement au 2e passage = pire élément), pose la rune de cet élément ; retire les déclencheurs.
  - **Retire l'état « Supernova (rune) » (6675)** → lanceur  `[951]`
  - **Applique l'état « Terre » (292)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Feu » (290)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Eau » (291)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Air » (293)** → cible ennemie ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Générateur de combinaison autonome (un seul sort suffit), plus un petit désenvoûtement. Excellent pour un Huppermage mono/bi-élément qui veut quand même ses combinaisons.
- *Notes moteur* : Déclencheurs CDE/CDF/CDW/CDA posés sur le lanceur pour connaître l'élément réel des dommages 2822/2832 ; voir COLLAPSE 32034.

#### Torrent Arcanique (`14342`) — variante (obtenu niv. 200)

> Occasionne des dommages Air, Terre, Feu et Eau aux ennemis en zone. Les dommages du sort sont augmentés pour chaque combinaison élémentaire générée par le lanceur.  Les effets sont réinitialisés après utilisation du sort.

- Caractéristiques (g1) : **3 PA** · portée 1–8 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · relance 2 t. · 1×/tour global (tous lanceurs) · cumul max 6
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–8 PO en ligne, LdV, relance 2, 1 lancer global/tour
  - Cercle 2 : dommages Air 2, Terre 2, Feu 2 et Eau 2 (CC 4) aux ennemis
  - +2 dégâts de base à chacune des 4 lignes par combinaison générée par le lanceur depuis le dernier Torrent (max 6 → 14 par élément, CC 16), remis à zéro après le lancer
- Effets décodés (données brutes DofusDB) :
  - **2 dommages Air (CC : 4)** → ennemis dans la zone ; zone cercle taille 2  `[98]`
  - **2 dommages Terre (CC : 4)** → ennemis dans la zone ; zone cercle taille 2  `[97]`
  - **2 dommages Feu (CC : 4)** → ennemis dans la zone ; zone cercle taille 2  `[99]`
  - **2 dommages Eau (CC : 4)** → ennemis dans la zone ; zone cercle taille 2  `[96]`
  - **Retire les effets du sort « Torrent Arcanique » (14359)** → lanceur  `[406]`
  - **Retire les effets du sort « Torrent Arcanique » (17275)** → lanceur  `[406]`
  - **Torrent Arcanique : +2 dégâts de base** → lanceur ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
- **Analyse / rôle tactique** : Finisher multi-élément : après 6 combinaisons, 4 × 14 de base en zone (chaque ligne profite de sa caractéristique). Remplace Supernova : à prendre si le groupe génère beaucoup de combinaisons (Huppermage quadra).
- *Notes moteur* : Les +2 viennent de 14359 (effet 293, maxStack 6) ; Torrent retire 14359/17275 après les dommages. Gamosaurus 2.70 annonçait une relance 3 : la donnée actuelle (DofusDB) est 2.


## 4. Rôles en groupe PvM 4 joueurs (niveau 200)

| Rôle | Pertinence | Éléments | Sorts clés |
|---|---|---|---|
| **DPS distance multi-élément** | ★★★★ | quadra / bi (Feu-Air, Eau-Air, Terre-Feu) | Lance-flamme, Éther, Onde Sismique, Stalagmite, Trait Ardent, Orage, Surcharge Runique, Torrent Arcanique |
| **Entrave PA/PM/PO** | ★★★ | Feu/Air (PA), Terre/Eau (PM) | Lance-flamme, Ouragan, Onde Sismique, Stalactite, combinaisons Carbonisation/Enlisement/Assèchement |
| **Amplificateur / débuffeur** | ★★★ | - | Éruption, Volcan, Sublimation, Propagation, Prisme Runique, Supernova |
| **Buff de groupe** | ★★ | - | Contribution, boosts de runes partagés, Bouclier Élémentaire |
| **Placement** | ★★ | - | Avalanche, Météore, Lance Solaire, Déflagration, Polarité, Manifestation |
| Soin | ★ | - | runes occupées par des alliés, Surcharge Runique sur allié |
| Tank | ✗ | - | (pas de réduction de dommages personnelle notable) |

**Placement type** : 3–6 cases derrière la ligne de front (portée 1–8, mais beaucoup de sorts à 4–6 PO) ; rester hors de la
ligne de vue des lanceurs de sorts ennemis (Cataracte, Stalagmite, Polarité, Volcan, Brèche, Ouragan ne demandent pas de ligne
de vue). Éviter d'être au contact (pas de bonus de mêlée, sauf Glacier).

## 5. Choix des variantes (« spell sets ») par rôle

Voir `variantChoices` du JSON. Résumé des arbitrages par paire :

| Paire | Choix DPS quadra | Choix entrave/soutien | Commentaire |
|---|---|---|---|
| Onde Sismique / Tison | Onde Sismique | Onde Sismique | −2 PM + longue portée > double frappe |
| Éther / Cataracte | Éther | Éther | −2 PO, 1–7 PO |
| Lance-flamme / Lances Telluriques | Lance-flamme | Lance-flamme | −2 PA |
| Stalagmite / Onde Céleste | Stalagmite | Stalagmite | plus gros dégâts mono |
| Runification / Manifestation | Runification | Runification | déclenchement global sur soi |
| Drain Élémentaire / Tribut | Drain (+200 carac.) | Tribut (+1 PA/PM) | |
| Météore / Avalanche | Météore | Avalanche | attirance 4 pour le contrôle |
| Lame Astrale / Déflagration | Lame Astrale | Déflagration | mobilité vs annulation de déplacement |
| Cycle / Courant | Cycle | Cycle | selon les éléments joués (équivalents) |
| Lance Solaire / Comète | Lance Solaire | Lance Solaire | échange (sauvetage d'allié) |
| Déluge / Astéroïde | Déluge | Déluge | Astéroïde si jeu à distance pur |
| Traversée / Répulsion Runique | Traversée | Traversée | |
| Contribution / Empreinte | Contribution | Contribution | buff allié majeur |
| Trait Ardent / Stalactite | Trait Ardent | Stalactite | zone Feu vs −2 PM sur 3 cibles |
| Glacier / Volcan | Volcan | Volcan | Glacier (4 PA, centré sur soi) n'est intéressant qu'en mêlée |
| Rafale / Brèche | Brèche | Brèche | Rafale (zone Air 0–4 PO) si l'on joue beaucoup de paquets de monstres |
| Orage / Ouragan | Orage | Ouragan | zone Terre vs −1 PA sur 3 cibles |
| Bouclier Élémentaire / Gardien | Gardien | Bouclier Élémentaire | |
| Polarité / Convection | Polarité | Polarité | |
| Surcharge Runique / Sublimation | Surcharge Runique | Sublimation | |
| Propagation / Prisme Runique | Propagation | Prisme Runique | |
| Supernova / Torrent Arcanique | Torrent Arcanique | Supernova | |

La liste exacte de chaque set est dans `variantChoices.<set>.chosen` (vérifiée automatiquement : un sort par paire).

## 6. Rotations types (11–12 PA / 6 PM)

Voir aussi `rotations` du JSON.

1. **Mono-cible (boss)** : Lance-flamme (3) → Éther (3) [Carbonisation : −2 PA, +50 Pui.] → Stalagmite (3) → Onde Sismique (3)
   [Enlisement : −3 PM, +50 Pui., puis −2 PM]. Variante 11 PA : remplacer Stalagmite par Ouragan (2).
2. **Multi-cibles** : Trait Ardent (4) → Orage (4) [Éruptions] → Runification sur soi (2) → Propagation (1) + Cycle (1, remboursé).
3. **Finisher runes** : poser 6+ runes (zones) au tour N ; au tour N+1 Surcharge Runique (3) sur la cible prioritaire
   (10 × nombre de runes, multi-éléments) + Runification.
4. **Soutien** : Sublimation (2) → Lance-flamme (3) → Stalactite (2) → Contribution (2) sur l'allié → Bouclier Élémentaire (2) →
   Cycle (1).

Heuristique IA : pour chaque ennemi, connaître son état ; choisir le prochain élément qui génère la combinaison la plus utile
(Éruption si des alliés frappent ensuite ; Enlisement/Carbonisation si la cible doit être entravée ; Cristallisation si elle
va frapper ; Assèchement contre un tireur), puis terminer le tour par un sort qui laisse un état utile pour le tour suivant.

## 7. Forces et faiblesses

Voir `strengths` / `weaknesses` du JSON.

## 8. Synergies

Voir `synergies` du JSON. Points principaux : Éruption/Volcan juste avant le DPS allié, Contribution sur le DPS, entrave
PA/PM cumulée avec Enutrof/Sram/Xélor, regroupeurs (Pandawa, Forgelance) pour les zones et Propagation.

## 9. Questions ouvertes

Voir `openQuestions` du JSON.

## 10. Sources

- DofusDB (fichiers du jeu) : https://api.dofusdb.fr/breeds/17, https://api.dofusdb.fr/spell-variants?breedId=17,
  https://api.dofusdb.fr/spells/13670, https://api.dofusdb.fr/spell-levels, https://api.dofusdb.fr/spell-states,
  https://api.dofusdb.fr/monsters/5129, https://api.dofusdb.fr/spell-types (types 619, 2000, 2435, 2436, 2438, 2459),
  https://api.dofusdb.fr/version (3.6.12.16).
- Runes (fonctionnement historique, cohérent avec les données) : https://dofus.jeuxonline.info/article/14143/rune-huppermage
- Équilibrages 2.70 (Torrent Arcanique, Gardien, refonte des variantes) : https://www.gamosaurus.com/?p=201759
- Guides généraux : https://www.breakflip.com/fr/dofus/guide/dofus-guide-des-sorts-et-variantes-de-l-huppermage-2273,
  https://guidactik.com/dofus/les-meilleurs-stuff-et-guide-huppermage-sur-dofus-unity/

