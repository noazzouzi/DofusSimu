# Féca (classe 1) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/1`, `/spell-variants?breedId=1`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 mis à jour le 2026-06-23, extraits le 2026-10-04. Toutes les valeurs ci-dessous sont celles du
> **grade le plus élevé utilisable au niveau 200**. Les sources web ne servent qu'à l'interprétation ; en cas de
> désaccord, les données du jeu priment (désaccords signalés). Fichier machine associé :
> [`data/research/class-mechanics/feca.json`](../../../data/research/class-mechanics/feca.json).

**Identité** : « Protecteur » (complexité 2/4 selon Ankama). Rôles officiels (données `breedRoles`, valeur /12) :
Protection 8 (« réduit les dommages subis par ses alliés et occasionnés par ses adversaires, pose des boucliers »),
Tank 8 (« maintient ses adversaires au contact avec ses sorts et ses glyphes »), Entrave 7 (« vole des caractéristiques
et retire PA, PM, PO avec ses sorts et ses glyphes »), puis dommages 7, placement 4, soutien 3, invocation 2, soin 0.

**Résumé tactique** : le Féca est la meilleure classe de *réduction de dommages* du jeu (boucliers multiplicatifs,
armures fixes, invulnérabilités ciblées, pacifisme) doublée d'un *entraveur de zone* grâce à ses glyphes-auras
(−3 PA, −3 PM, −6 PO, −20 % dommages finaux aux ennemis qui s'y trouvent). Il joue les quatre éléments ; ses glyphes
coûtent 3 PA, durent 2 tours et un seul glyphe élémentaire peut être posé par tour (état « Hypoglyphe »).

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : à un instant donné, un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage du grade 1.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Retour du Bâton (12983, niv. 1) | 3 | Tétanie (13017, niv. 95) | 4 | Tétanie (−3 PA, mêlée 1–2) pour un Féca tank/entraveur ; Retour du Bâton (−100 Force, −25 Fuite, PO 4) contre un frappeur Terre. |
| 2 | Langueur (12978, niv. 1) | 3 | Atonie (13014, niv. 100) | 4 | Atonie (−3 PM en croix) est un excellent sort d'entrave de zone ; Langueur (−100 Intelligence, −10 % CC) seulement contre un boss Feu à critiques. |
| 3 | Nimbus (12984, niv. 1) | 3 | Stratus (13015, niv. 105) | 4 | Stratus (−3 PO en carré) contre des lanceurs à distance ; Nimbus (−100 Chance, −20 Tacle, 3 PA) sinon. |
| 4 | Typhon (12976, niv. 1) | 3 | Bourrasque (13010, niv. 110) | 3 | Typhon (−20 Dommages en ligne) défensif ; Bourrasque pour écarter/placer. |
| 5 | Rempart (12981, niv. 5) | 2 | Fortification (13009, niv. 115) | 2 | Rempart (zone, relance 3) quasi systématique en groupe ; Fortification pour un seul allié très ciblé. |
| 6 | Barricade (12979, niv. 10) | 2 | Pavois (13016, niv. 120) | 2 | Barricade (invulnérable mêlée) en général ; Pavois pour enfermer un monstre ou couper les lignes de vue. |
| 7 | Somnolence (12977, niv. 15) | 3 | Manœuvre (13012, niv. 125) | 4 | Somnolence (−2 PA en croix diagonale, PO 6) est le retrait PA de base ; Manœuvre pour la mobilité Air. |
| 8 | Léthargie (12993, niv. 20) | 3 | Regroupement (13008, niv. 130) | 4 | Regroupement (attire en cercle 3) pour remplir les glyphes ; Léthargie (−2 PM) en mono-cible. |
| 9 | Bastion (12995, niv. 25) | 2 | Trêve (12980, niv. 135) | 3 | Bastion (invulnérable distance) en général ; Trêve contre un tour de burst du boss au corps à corps. |
| 10 | Frisson (12989, niv. 30) | 3 | Giboulée (13022, niv. 140) | 4 | Frisson (attire vers une case) pour placer ; Giboulée (repousse 4) pour éloigner. |
| 11 | Bulle (12994, niv. 35) | 2 | Sonnailles (14436, niv. 145) | 4 | Bulle (2 PA, −3 PO, 3/tour) remplit les PA restants ; Sonnailles regroupe en ligne. |
| 12 | Transhumance (12986, niv. 40) | 3 | Égide (13018, niv. 150) | 3 | Égide (interception en cercle 3, 2 tours) en protection pure ; Transhumance pour le jeu glyphes. |
| 13 | Prairie (12992, niv. 45) | 3 | Pâturage (13013, niv. 155) | 3 | Prairie (−20 % dommages finaux aux ennemis) est l'un des meilleurs sorts défensifs du jeu. |
| 14 | Vallée (12990, niv. 50) | 3 | Verglas (13023, niv. 160) | 3 | Vallée (−6 PO aux ennemis) neutralise les lanceurs à distance. |
| 15 | Terre Battue (12987, niv. 55) | 3 | Refuge (13021, niv. 165) | 3 | Terre Battue (−3 PA aux ennemis) ; Refuge (dommages subis ×85 % aux alliés) si le groupe est statique. |
| 16 | Terre Brûlée (12985, niv. 60) | 3 | Vigie (13025, niv. 170) | 3 | Terre Brûlée (−3 PM aux ennemis) ; Vigie (+5 PO alliés) pour un groupe de DPS distance. |
| 17 | Renfort (13020, niv. 65) | 2 | Ataraxie (13027, niv. 175) | 2 | Ataraxie (−75 % sur la prochaine attaque) est très forte contre les gros coups ; Renfort pour rejoindre un allié. |
| 18 | Silbo (13011, niv. 70) | 2 | Houlette (13007, niv. 180) | 2 | Houlette (attire 3) pour ramener une cible ; Silbo pour repousser en croix. |
| 19 | Torpeur (14434, niv. 75) | 3 | Escapade (29045, niv. 185) | 3 | Torpeur (attire 2 + Terre) ou Escapade (recule de 2 + Eau) selon le besoin de distance. |
| 20 | Bergerie (12991, niv. 80) | 3 | Excursion (13024, niv. 190) | 2 | Bergerie (Inébranlable + Pesanteur en carré 2) fixe les ennemis dans un glyphe ; Excursion pour échanger un allié en danger. |
| 21 | Défiance (12988, niv. 85) | 2 | Barrière (13019, niv. 195) | 3 | Défiance (tacle + glyphe 4 éléments + 30 % rés. mêlée) pour tanker ; Barrière pour enfermer un ennemi. |
| 22 | Bouclier Féca (12982, niv. 90) | 2 | Mise en Garde (12997, niv. 200) | 3 | Bouclier Féca est indispensable ; Mise en Garde seulement pour un Féca orienté dégâts glyphes. |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne des dommages de base de la première ligne de dommages directs divisée par le coût en PA (indicatif ; ne tient compte ni des zones, ni des effets secondaires, ni des sous-sorts). `+` = portée modifiable. Lancers/tour `∞` = pas de limite autre que les PA/relance.

| Sort | Paire | Élément | PA | Base | Base CC | Moy./PA | PO | Lancers/tour | Relance | Zone |
|---|---|---|---|---|---|---|---|---|---|---|
| Refuge | 15B | Terre | 3 | 32–36 | 38–43 | 11.3 | 0–5+ | 1 | 0 | cercle de taille 2 |
| Prairie | 13A | Air | 3 | 31–35 | 31–35 | 11.0 | 0–5 | 1 | 3 | étoile (8 directions) de taille 2 (glyphe début de tour) |
| Pâturage | 13B | Air | 3 | 31–35 | 37–42 | 11.0 | 0–6+ | 1 | 0 | croix de taille 1 |
| Verglas | 14B | Eau | 3 | 31–35 | 37–42 | 11.0 | 0–8+ | 1 | 0 | carré de taille 1 |
| Défiance | 21A | Terre | 2 | 21–22 | 21–22 | 10.8 | 0–7+ | 1 | 2 | croix de taille 1 (glyphe fin de tour) |
| Terre Brûlée | 16A | Feu | 3 | 30–34 | 30–34 | 10.7 | 0–5 | 1 | 3 | carré de taille 2 (glyphe début de tour) |
| Vigie | 16B | Feu | 3 | 30–34 | 36–41 | 10.7 | 0–7+ | 1 | 0 | cercle de taille 2 |
| Retour du Bâton | 1A | Terre | 3 | 29–33 | 35–40 | 10.3 | 1–4+ | 3 | 0 | case ciblée |
| Terre Battue | 15A | Terre | 3 | 29–33 | 29–33 | 10.3 | 0–5 | 1 | 3 | cercle de taille 3 (glyphe début de tour) |
| Manœuvre | 7B | Air | 4 | 38–42 | 46–50 | 10.0 | 1–3 | 2 | 0 | case ciblée |
| Regroupement | 8B | Terre | 4 | 38–42 | 46–50 | 10.0 | 0–0 | 1 | 0 | cercle de taille 3 (à partir de 1) |
| Vallée | 14A | Eau | 3 | 28–32 | 28–32 | 10.0 | 0–7+ | 1 | 3 | cercle de taille 3 (glyphe début de tour) |
| Léthargie | 8A | Feu | 3 | 28–31 | 34–37 | 9.8 | 1–5+ | 3 | 0 | case ciblée |
| Tétanie | 1B | Terre | 4 | 36–40 | 43–48 | 9.5 | 1–2 | 3 | 0 | case ciblée |
| Somnolence | 7A | Terre | 3 | 27–30 | 32–36 | 9.5 | 0–6+ | 1 | 0 | croix diagonale de taille 1 |
| Giboulée | 10B | Eau | 4 | 36–40 | 43–48 | 9.5 | 1–7+ | 2 | 0 | case ciblée |
| Houlette | 18B | Feu | 2 | 18–20 | 22–24 | 9.5 | 1–7+ | 3 | 0 | case ciblée |
| Torpeur | 19A | Terre | 3 | 27–30 | 32–36 | 9.5 | 1–6 | 3 | 0 | case ciblée |
| Langueur | 2A | Feu | 3 | 27–29 | 32–35 | 9.3 | 1–7+ | 3 | 0 | case ciblée |
| Escapade | 19B | Eau | 3 | 27–29 | 32–35 | 9.3 | 1–6+ | 3 | 0 | case ciblée |
| Frisson | 10A | Air | 3 | 26–29 | 31–35 | 9.2 | 1–4 | 2 | 0 | cône de taille 2 |
| Bulle | 11A | Eau | 2 | 17–19 | 20–23 | 9.0 | 1–8+ | 3 | 0 | case ciblée |
| Silbo | 18A | Air | 2 | 17–19 | 20–23 | 9.0 | 1–6 | 2 | 0 | croix de taille 1 |
| Typhon | 4A | Air | 3 | 25–27 | 30–32 | 8.7 | 1–4+ | 2 | 0 | ligne de 2 case(s) |
| Sonnailles | 11B | Feu | 4 | 32–36 | 38–43 | 8.5 | 1–7+ | 2 | 0 | ligne perpendiculaire (T) de 2 case(s) |
| Bourrasque | 4B | Air | 3 | 24–26 | 29–32 | 8.3 | 1–5+ | 2 | 0 | ligne perpendiculaire (T) de 1 case(s) |
| Atonie | 2B | Feu | 4 | 31–35 | 38–43 | 8.2 | 0–7 | 1 | 0 | croix de taille 1 |
| Stratus | 3B | Eau | 4 | 31–34 | 37–40 | 8.1 | 0–6+ | 1 | 0 | carré de taille 1 |
| Nimbus | 3A | Eau | 3 | 23–25 | 28–30 | 8.0 | 0–6+ | 2 | 0 | croix de taille 1 |

Vérification croisée avec les gabarits de dégâts de DoMath (`.cache/domath/spell-templates.json`) : **24 sorts identiques**, 0 écart(s), 0 absent(s) de DoMath.

## Mécaniques spécifiques à implémenter

### 1. Glyphes élémentaires (paires 13 à 16)
Quatre glyphes « de base » (variante A) et quatre « variantes » (B) partagent la même logique de pose :

| Glyphe | Élément | Zone | Dommages (déb. de tour) | Aura ennemis | Armure donnée |
|---|---|---|---|---|---|
| Prairie (12992) | Air | étoile 2 (8 directions) | 31–35 | −20 % dommages finaux | Armure Venteuse (5265) |
| Vallée (12990) | Eau | cercle 3 | 28–32 | −6 PO | Armure Aqueuse (5264) |
| Terre Battue (12987) | Terre | cercle 3 | 29–33 | −3 PA | Armure Terrestre (5262) |
| Terre Brûlée (12985) | Feu | carré 2 | 30–34 | −3 PM | Armure Incandescente (5263) |
| Pâturage (13013) | Air | croix 1 | 31–35 (immédiat) | — (aura alliés : +10 % dommages finaux) | Armure Venteuse |
| Verglas (13023) | Eau | carré 1 | 31–35 (immédiat) | — (aura alliés : +50 Fuite) | Armure Aqueuse |
| Refuge (13021) | Terre | cercle 2 | 32–36 (immédiat) | — (aura alliés : dommages subis ×85 %) | Armure Terrestre |
| Vigie (13025) | Feu | cercle 2 | 30–34 (immédiat) | — (aura alliés : +5 PO) | Armure Incandescente |

Règles (déduites des effets 401 « glyphe de début de tour », 1091 « glyphe-aura », 950/951 états) :
- **Pose** : l'effet 401 crée une marque (glyphe) de durée 2 tours centrée sur la case ciblée ; l'effet 1091 crée en même
  temps un **glyphe-aura** de même zone et même durée. Les glyphes de base n'ont **aucun dommage à la pose**.
- **Glyphe de début de tour** : au début du tour de chaque ennemi situé dans la zone, le sous-sort du glyphe
  (ex. Prairie 12999 g3) est lancé par le Féca sur cet ennemi → dommages (sans coup critique : sous-sort à 0 % CC).
  Il bénéficie de la caractéristique *Puissance glyphes* (stat 106) et de *Dommages* ; c'est un dommage « de glyphe »
  (déclencheur `DG` pour les buffs qui réagissent aux glyphes).
- **Glyphe-aura** : tant qu'une entité est dans la zone, l'aura lui applique ses effets (malus ennemis, bonus alliés) ;
  ils sont retirés dès qu'elle en sort (implémentation : recalcul à chaque déplacement / début de tour, buffs de durée 2
  liés à la marque). Les retraits d'aura −3 PA (Terre Battue) et −3 PM (Terre Brûlée) sont **esquivables** (effets
  1079/1080, jet d'esquive à chaque application — moment exact du jet INCERTAIN) ; −6 PO (effet 116) et −20 % dommages
  finaux (1172) ne s'esquivent pas. Tous ne sont désenvoûtables que par un désenvoûtement fort (dispellable = 3).
- **Hypoglyphe (état 238)** : chaque glyphe élémentaire applique 1 tour l'état 238 au lanceur ; tous les glyphes
  élémentaires ont le critère `HS!238` (« le lanceur ne doit pas avoir l'état 238 ») ⇒ **un seul glyphe élémentaire par tour**.
- **Variantes (B)** : dommages immédiats en zone + glyphe-aura de buff allié posé sous la cible + glyphe « de début de
  tour » qui ne fait des dommages **que si le lanceur a l'état 5260 « Glyphes déclenchés »**, c.-à-d. uniquement lors d'un
  déclenchement manuel (Transhumance / Mise en Garde). Relancer la même variante dissipe d'abord l'ancien glyphe (effet
  2018 « dissipe les glyphes » du même sort) : une seule instance par variante.
- **Lanterne du Berger** : chaque glyphe élémentaire (et Défiance/Barrière) invoque une Lanterne (monstre 7841) si la
  case ciblée est libre. Invocation statique sans emplacement ; elle porte l'état Intacleur (95, ne tacle pas) que
  Défiance lui retire pour la faire tacler. Au début de chaque tour du Féca (buff posé sur le Féca, sous-sorts Repérage
  29070 g4→g5→g6), elle révèle les invisibles en cercle 2 et applique l'Étoile du Berger (état 5261, 1 tour) aux alliés
  proches. Elle peut servir de cible alliée (Renfort) et meurt si une nouvelle Lanterne est invoquée (une seule à la fois,
  sort 29070 g2).

### 2. Armures élémentaires et Étoile du Berger
- Un **Féca** (n'importe quel joueur de classe 1, masque `B1`) présent dans un glyphe-aura élémentaire reçoit l'armure de
  l'élément du glyphe : état 5262–5265 + **+15 % de résistance** dans l'élément pendant 2 tours (sous-sorts 29057–29060).
  Le guide de refonte 2.71 annonçait 25 % : les données 2026 donnent **15 %** (désaccord signalé, prendre 15 %).
- Les **autres alliés** ne reçoivent l'armure que s'ils portent l'état **Étoile du Berger (5261)**. Sources de l'Étoile :
  Bouclier Féca (cible + alliés déjà sous une armure), Égide/Sanctuaire, Transhumance et Mise en Garde (alliés dans les
  glyphes déclenchés), Bergerie, Excursion, la Lanterne (début de tour des alliés autour), les boucliers invoqués.
  L'Étoile dure 1 à 2 tours selon la source ; quand elle disparaît, les armures liées sont retirées (déclencheur `EOFF5261`).
- Les armures sont aussi lues par **Mise en Garde** : +200 Force/Intelligence/Chance/Agilité (2 tours) au Féca pour
  chaque armure active ⇒ un Féca multi-élément qui a enchaîné plusieurs glyphes peut cumuler jusqu'à +200 dans 4 stats.

### 3. Déclenchement manuel des glyphes
- **Transhumance** (3 PA, PO 1–6, case libre, relance 3, interdit sous Pesanteur `HS!7`) : téléporte le Féca sur la case
  puis exécute l'effet 1026 pour chacun des 8 sorts de glyphe → déclenche immédiatement chaque glyphe **du lanceur dont la
  zone contient la case ciblée** (implémentation DoMath `HandleForceGlyphTrigger`, forme `P`). Les glyphes-auras ne sont
  pas « déclenchés ». Chaque glyphe ne peut être déclenché manuellement **qu'une fois par tour** (états 5364–5371
  « X déclenchée » posés pendant le déclenchement). Les alliés présents dans les glyphes déclenchés reçoivent l'Étoile.
- **Mise en Garde** (niv. 200, 3 PA, PO 0, relance 3, relance initiale 1) : même déclenchement sur la case du Féca, plus
  les +200 stats selon armures. Combo type : glyphe de base sur un paquet d'ennemis → au tour suivant les ennemis prennent
  les dommages en début de tour, et le Féca peut **re-déclencher** le glyphe pendant son tour (dégâts ×2 par cycle).

### 4. Boucliers invoqués (Barricade, Bastion, Pavois, Égide)
- Sur un **allié** (ou soi), Barricade donne Invulnérable en mêlée (état 376), Bastion Invulnérable à distance (375),
  pendant 1 tour ; si l'allié est attaqué de l'autre façon ou désenvoûté il gagne +2 PM (Barricade) ou +200 Puissance (Bastion).
- Sur une **case libre**, ils invoquent un bouclier statique (monstres 7864/7865, pas d'emplacement d'invocation, ne
  joue pas) qui porte un glyphe-aura croix 1 rendant les alliés adjacents invulnérables (mêlée / distance). Le bouclier
  meurt au tour suivant (`Tue la cible`, délai 1). Le glyphe suit le bouclier s'il est déplacé.
- **Pavois** : invoque 2 à 4 boucliers (ligne perpendiculaire + croix autour de la cible) qui bloquent les lignes de vue
  et les cases ; sur un allié ils sont détruits au début de son tour, sur un ennemi au tour suivant. L'état « Invulnérable
  à distance » de leur sort passif est marqué *affichage seul* dans les données (INCERTAIN : invulnérabilité réelle ou non).
  Excellent pour **enfermer** un monstre de mêlée ou couper les lignes de vue d'un boss à distance.
- **Égide** : bouclier statique (PV élevés : bonus 140 % des PV du Féca — INCERTAIN, voir invocations) qui **intercepte**
  les dommages subis par les alliés dans son aura cercle 3 pendant 2 tours ; sur une cible, pose l'aura d'interception
  directement. Ne protège pas Barricade/Bastion.
- PV des boucliers : `bonusCharacteristics.lifePoints` = pourcentage des PV de l'invocateur (30 % Barricade/Bastion/Lanterne,
  90 % Pavois, 140 % Égide) — interprétation cohérente avec la refonte Osamodas 3.1 (50/75/100 %) ; **INCERTAIN**.

### 5. Réductions de dommages (ordre d'application à confier au module de calcul)
- **Armure fixe** (effet 265 `CharacterLifeLostCasterModerator`) : Rempart (valeur 12, cercle 3 autour du Féca, alliés,
  2 tours) et Fortification (valeur 16, un allié, 3 tours). Réduction par coup = `valeur × (niveau_de_la_cible / 20 + 1)`
  (client Dofus `DamageUtil` et DoMath `GetDamageReductor`) ⇒ au niveau 200 : **132** (Rempart) et **176** (Fortification)
  points retirés par ligne de dommages (le client ne réduit qu'une fois par couple sort/élément).
- **Multiplicateurs de dommages subis** (effet 1163) : Bouclier Féca ×70 % (2 tours), Refuge ×85 % (aura), Ataraxie ×25 %
  sur la première attaque (puis retiré) ; d'autres classes en apportent (Pacage du Bouflourd ×90 %, Dérobade du Sram ×90 %). Ils se multiplient entre eux (INCERTAIN : vérifier avec DoMath).
- **Dommages finaux** : Prairie −20 % aux ennemis dans l'aura (effet 1172), Pâturage +10 % aux alliés (1171).
- **Résistances %** : armures élémentaires +15 %, Défiance +30 % résistance mêlée (aura), Barrière +30 % résistance
  distance (aura). Le plafond de résistance de 50 % pour les joueurs s'applique (INCERTAIN pour les résistances mêlée/distance).
- **Invulnérabilités** : Barricade/Bastion (mêlée / distance), Trêve (état « Pacifiste » 218, aussi posé par Corruption/Boîte à Outils de l'Enutrof : ne peut pas
  infliger de dommages).
- Les effets d'**interception/partage** (Égide, Sac Animé…) sont incompatibles avec Ataraxie (masque `e583` Sacrifice).

### 6. États de contrôle utilisés par le Féca
- **Pesanteur (7)** : `cantSwitchPosition` + nombreux sorts de mobilité ont le critère `HS!7` (téléportations,
  échanges). Appliquée par Ataraxie, Bergerie, Barrière. Attention : Pesanteur bloque aussi **les téléportations du Féca**
  (Transhumance, Renfort) s'il est lui-même dans Bergerie.
- **Inébranlable (157)** : `cantBePushed` (Bergerie).
- **Pacifiste (218)** : `cantDealDamage` (Trêve, et Corruption/Boîte à Outils de l'Enutrof).
- **Invulnérable mêlée/distance (376/375)**.

### 7. Placement
Bourrasque (pousse vers les extrémités d'une ligne perpendiculaire), Frisson (attire vers la case ciblée, cône),
Sonnailles (attire jusqu'au centre), Regroupement (attire en cercle 3 vers le Féca), Silbo (repousse en croix),
Houlette/Torpeur (attirent la cible), Giboulée (repousse 4), Escapade (recule), Manœuvre (échange), Renfort et Excursion
(échanges/téléportation alliés). L'IA doit utiliser ces sorts pour **regrouper les ennemis dans un glyphe** avant la fin
du tour (ils prennent alors les dégâts au début de leur tour) ou pour les ramener au contact du Féca-tank.

### 8. Notes d'implémentation (moteur)
- N'exécuter que les effets `forClientOnly = false` ; plusieurs sorts (Barricade, Bastion, Pavois, Égide, Ruée…) ont des
  effets d'infobulle dupliqués exécutés en réalité par un sous-sort caché (effets 1160/792/2960).
- Masques de cible : `a` alliés (lanceur compris), `g` alliés hors lanceur, `A` ennemis, `C`/`c` lanceur, `B1` « joueur
  Féca », `F7841` « monstre Lanterne », `*E5260` condition sur le lanceur, `U` « invocation créée par ce sort ».
- `globalCooldown = -1` sur Barricade/Bastion/Pavois/glyphes : relance **partagée entre tous les Fécas de l'équipe**
  (INCERTAIN — interprétation habituelle de la valeur −1 ; à vérifier).
- `effectTriggerDuration` = durée réelle (en tours) des buffs à déclenchement (ex. Bouclier Féca 2 tours, Fortification 3).

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende : « Effets (infobulle) » = ce que le joueur lit en jeu (valeurs de base, `CC` = coup critique). « Mécanique réelle » = effets réellement exécutés (`forClientOnly = false`), avec les sous-sorts cachés développés une seule fois par document. Les effets d'infobulle marqués côté données `forClientOnly = true` **ne doivent pas être exécutés** par le moteur : ils ne servent qu'à l'affichage, la logique passe par les sous-sorts.

### Paire 1 : Retour du Bâton / Tétanie

> Choix : Tétanie (−3 PA, mêlée 1–2) pour un Féca tank/entraveur ; Retour du Bâton (−100 Force, −25 Fuite, PO 4) contre un frappeur Terre.

#### 1A. Retour du Bâton (id 12983)

- **3 PA** · PO 1–4 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Terre
- Grades : g1 niv.1 dmg 17–20 ; g2 niv.66 dmg 23–26 ; g3 niv.132 dmg 29–33 (grade utilisé : 3).
- Description du jeu : « Retire de la Force et de la Fuite et occasionne des dommages Terre. »
- Effets (infobulle, valeurs de base) :
  - -100 Force — 3 tour(s)
  - -25 Fuite — 3 tour(s)
  - 29 à 33 dommages Terre (CC : 35 à 40 dommages Terre)
- **Rôle tactique** : Sort de base Terre : −100 Force et −25 Fuite (3 tours, cumulable 2 fois) sur l'adversaire, utile contre un frappeur Terre ou pour qu'il ne puisse pas fuir le tacle du Féca.
- Tags : `damage`, `debuff`, `earth`

#### 1B. Tétanie (id 13017)

- **4 PA** · PO 1–2 (non modifiable) · LdV requise · 3/tour, 2/cible · CC 20 % · élément(s) : Terre
- Grades : g1 niv.95 dmg 29–32 ; g2 niv.162 dmg 36–40 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Terre et retire des PA. »
- Effets (infobulle, valeurs de base) :
  - 36 à 40 dommages Terre (CC : 43 à 48 dommages Terre)
  - -3 PA (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Meilleur sort Terre au contact : 36–40 + −3 PA esquivables (2 fois par cible). Combiné à Terre Battue (−3 PA d'aura) il peut vider un monstre de ses PA.
- Tags : `damage`, `ap_removal`, `earth`, `melee`

### Paire 2 : Langueur / Atonie

> Choix : Atonie (−3 PM en croix) est un excellent sort d'entrave de zone ; Langueur (−100 Intelligence, −10 % CC) seulement contre un boss Feu à critiques.

#### 2A. Langueur (id 12978)

- **3 PA** · PO 1–7 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Feu
- Grades : g1 niv.1 dmg 16–18 PO1-5 ; g2 niv.67 dmg 21–23 PO1-6 ; g3 niv.133 dmg 27–29 (grade utilisé : 3).
- Description du jeu : « Retire de l'Intelligence et des Critiques et occasionne des dommages Feu. »
- Effets (infobulle, valeurs de base) :
  - -100 Intelligence — 3 tour(s)
  - -10% Critique — 3 tour(s)
  - 27 à 29 dommages Feu (CC : 32 à 35 dommages Feu)
- **Rôle tactique** : Feu à 7 PO, −100 Intelligence et −10 % Critique : anti-boss Feu/critique, sinon simple remplissage.
- Tags : `damage`, `debuff`, `fire`

#### 2B. Atonie (id 13014)

- **4 PA** · PO 0–7 (non modifiable) · LdV requise · 1/tour · CC 25 % · élément(s) : Feu
- Grades : g1 niv.100 dmg 24–28 PO0-6 ; g2 niv.167 dmg 31–35 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu et retire des PM aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - 31 à 35 dommages Feu (CC : 38 à 43 dommages Feu) — cibles : ennemis ; zone : croix de taille 1
  - -3 PM (esquivable) — cibles : ennemis ; zone : croix de taille 1 ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : −3 PM esquivables en croix + 31–35 Feu : entrave de zone 1/tour, PO 0 permet de se cibler pour toucher les ennemis au contact.
- Tags : `damage`, `mp_removal`, `aoe`, `fire`

### Paire 3 : Nimbus / Stratus

> Choix : Stratus (−3 PO en carré) contre des lanceurs à distance ; Nimbus (−100 Chance, −20 Tacle, 3 PA) sinon.

#### 3A. Nimbus (id 12984)

- **3 PA** · PO 0–6 (modifiable) · LdV requise · 2/tour · CC 15 % · élément(s) : Eau
- Grades : g1 niv.1 dmg 13–15 PO0-4 ; g2 niv.68 dmg 18–20 PO0-5 ; g3 niv.134 dmg 23–25 (grade utilisé : 3).
- Description du jeu : « Retire de la Chance et du Tacle et occasionne des dommages Eau aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - -100 Chance — cibles : ennemis ; zone : croix de taille 1 ; 3 tour(s)
  - -20 Tacle — cibles : ennemis ; zone : croix de taille 1 ; 3 tour(s)
  - 23 à 25 dommages Eau (CC : 28 à 30 dommages Eau) — cibles : ennemis ; zone : croix de taille 1
- **Rôle tactique** : Eau en croix (ennemis seulement) avec −100 Chance et −20 Tacle : remplissage 3 PA, 2/tour.
- Tags : `damage`, `debuff`, `aoe`, `water`

#### 3B. Stratus (id 13015)

- **4 PA** · PO 0–6 (modifiable) · LdV requise · 1/tour · CC 25 % · élément(s) : Eau
- Grades : g1 niv.105 dmg 25–27 PO0-5 ; g2 niv.172 dmg 31–34 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Eau et retire de la Portée aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - 31 à 34 dommages Eau (CC : 37 à 40 dommages Eau) — cibles : ennemis ; zone : carré de taille 1
  - -3 Portée — cibles : ennemis ; zone : carré de taille 1 ; 1 tour(s)
- **Rôle tactique** : −3 PO en carré 1 + 31–35 Eau : neutralise un groupe de lanceurs à distance (1/tour).
- Tags : `damage`, `range_removal`, `aoe`, `water`

### Paire 4 : Typhon / Bourrasque

> Choix : Typhon (−20 Dommages en ligne) défensif ; Bourrasque pour écarter/placer.

#### 4A. Typhon (id 12976)

- **3 PA** · PO 1–4 (modifiable) · en ligne, LdV requise · 2/tour · CC 15 % · élément(s) : Air
- Grades : g1 niv.1 dmg 15–17 ; g2 niv.69 dmg 20–22 ; g3 niv.136 dmg 25–27 (grade utilisé : 3).
- Description du jeu : « Retire de l'Agilité et des Dommages et occasionne des dommages Air aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - -100 Agilité — cibles : ennemis ; zone : ligne de 2 case(s) ; 3 tour(s)
  - -20 Dommages — cibles : ennemis ; zone : ligne de 2 case(s) ; 3 tour(s)
  - 25 à 27 dommages Air (CC : 30 à 32 dommages Air) — cibles : ennemis ; zone : ligne de 2 case(s)
- **Rôle tactique** : Ligne de 2 (en ligne uniquement) : −100 Agilité et −20 Dommages aux ennemis (3 tours) ; réduction de dégâts sur un paquet.
- Tags : `damage`, `debuff`, `aoe`, `air`

#### 4B. Bourrasque (id 13010)

- **3 PA** · PO 1–5 (modifiable) · en ligne, LdV requise · 2/tour · CC 15 % · élément(s) : Air
- Grades : g1 niv.110 dmg 20–22 ; g2 niv.177 dmg 24–26 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Air aux ennemis et repousse les cibles vers les extrémités en zone. »
- Effets (infobulle, valeurs de base) :
  - 24 à 26 dommages Air (CC : 29 à 32 dommages Air) — cibles : ennemis ; zone : ligne perpendiculaire (T) de 1 case(s)
  - Repousse de 1 case — zone : ligne perpendiculaire (T) de 1 case(s)
- **Rôle tactique** : Ligne perpendiculaire : repousse de 1 les deux voisins vers l'extérieur ; sert à écarter deux ennemis d'un allié ou à les sortir d'un glyphe ennemi.
- Tags : `damage`, `placement`, `aoe`, `air`

### Paire 5 : Rempart / Fortification

> Choix : Rempart (zone, relance 3) quasi systématique en groupe ; Fortification pour un seul allié très ciblé.

#### 5A. Rempart (id 12981)

- **2 PA** · PO 0–0 (non modifiable) · sans LdV · relance 3 t. · CC 0 %
- Grades : g1 niv.5 ; g2 niv.72 ; g3 niv.139 (grade utilisé : 3).
- Description du jeu : « Réduit les dommages reçus par le lanceur et ses alliés en zone. »
- Effets (infobulle, valeurs de base) :
  - armure: réduit les dommages subis (effet 265, d1=0 d2=0 valeur=12) — cibles : lanceur, alliés (lanceur inclus) ; zone : cercle de taille 3 ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
- **Rôle tactique** : Armure fixe de groupe : 132 dommages réduits par coup au niv. 200 pour tous les alliés en cercle 3 autour du Féca, 2 tours, relance 3. À lancer au premier tour quand le groupe est regroupé.
- Tags : `protection`, `shield_armor`

#### 5B. Fortification (id 13009)

- **2 PA** · PO 0–5 (non modifiable) · LdV requise · relance 4 t. · CC 0 %
- Grades : g1 niv.115 PO0-4 ; g2 niv.182 (grade utilisé : 2).
- Description du jeu : « Réduit les dommages reçus par l'allié ciblé. »
- Effets (infobulle, valeurs de base) :
  - armure: réduit les dommages subis (effet 265, d1=0 d2=0 valeur=16) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages (buff 3 t.)
- **Rôle tactique** : Armure fixe mono-cible plus forte (176/coup au niv. 200) et plus longue (3 tours), PO 5, relance 4 : pour le personnage focalisé par un boss.
- Tags : `protection`, `shield_armor`

### Paire 6 : Barricade / Pavois

> Choix : Barricade (invulnérable mêlée) en général ; Pavois pour enfermer un monstre ou couper les lignes de vue.

#### 6A. Barricade (id 12979)

- **2 PA** · PO 0–7 (non modifiable) · sans LdV · relance 4 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.10 PO0-5 ; g2 niv.77 PO0-6 ; g3 niv.144 (grade utilisé : 3).
- Description du jeu : « Rend l'allié ciblé Invulnérable en mêlée. Augmente ses PM s'il est attaqué à distance ou désenvoûté. Sur une case libre : invoque un bouclier statique qui pose un glyphe-aura rendant les alliés Invulnérables en mêlée. Le glyphe suit le bouclier et il est détruit au tour suivant. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Invulnérable en Mêlée» (376) — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - 2 PM — cibles : alliés (lanceur inclus) ; 1 tour(s) ; déclenchement : quand le buff est désenvoûté / quand le porteur subit des dommages à distance (buff 1 t.)
  - invoque «Barricade» (7864, grade 1)
  - pose un glyphe-aura «Barricade» (29301, grade 2) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Barricade» (29050, grade 1) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Barricade» (id 29050, grade 1)*
      - applique l'état «Barricade» (5266) — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - applique l'état «Invulnérable en Mêlée» (376) — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - le lanceur lance le sort «Barricade» (29050, grade 2) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages à distance (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Barricade» (id 29050, grade 2)*
          - 2 PM — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - le lanceur lance le sort «Barricade» (29050, grade 3) — cibles : alliés (lanceur inclus) ; déclenchement : quand le buff est désenvoûté (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Barricade» (id 29050, grade 3)*
          - retire les effets du sort «Barricade» (29050) — cibles : alliés (lanceur inclus)
          - 2 PM — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - invoque «Barricade» (7864, grade 1)
- **Rôle tactique** : Invulnérabilité en mêlée d'un allié pour 1 tour (+2 PM s'il est attaqué à distance) ou bouclier statique dont l'aura croix 1 protège les alliés adjacents. Contre des monstres de corps-à-corps, rend le tank intouchable un tour.
- Tags : `protection`, `invulnerability`, `summon`

#### 6B. Pavois (id 13016)

- **2 PA** · PO 0–6 (non modifiable) · en ligne, LdV requise · relance 2 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.120 PO0-5 ; g2 niv.187 (grade utilisé : 2).
- Description du jeu : « Invoque plusieurs boucliers statiques en zone. Les boucliers sont détruits au tour suivant. Sur une cible : invoque ces boucliers à son contact. • Sur un allié : les Pavois sont détruits au début de son tour ou à sa mort. • Sur un ennemi : ils sont détruits au tour suivant. »
- Effets (infobulle, valeurs de base) :
  - invoque «Pavois» (5910, grade 1) — zone : ligne perpendiculaire (T) de 1 case(s)
  - invoque «Pavois» (5910, grade 1) — zone : croix sans centre de taille 1
  - Tue la cible — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort) ; si la cible est le monstre «Pavois» (5910) ; effet différé de 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Pavois» (29054, grade 1)
    - *Sous-sort «Pavois» (id 29054, grade 1)*
      - applique l'état «Pavois allié» (5269) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
      - applique l'état «Pavois invoqués» (5270) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - invoque «Pavois» (5910, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Pavois» (5910) ; zone : croix sans centre de taille 1
      - retire l'état «Pavois allié» (5269)
  - le lanceur lance sur la case le sort «Pavois» (29054, grade 2)
    - *Sous-sort «Pavois» (id 29054, grade 2)*
      - invoque «Pavois» (5910, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Pavois» (5910) ; si le lanceur n'a pas l'état «Pavois invoqués» (5270) ; zone : ligne perpendiculaire (T) de 1 case(s)
      - retire l'état «Pavois invoqués» (5270) — cibles : lanceur ; si le lanceur a l'état «Pavois invoqués» (5270)
- **Rôle tactique** : Pose 2 à 4 boucliers statiques (PV ≈ 90 % des PV du Féca, INCERTAIN) : bloque les lignes de vue et les cases autour d'une cible (enfermer un monstre de mêlée, protéger un allié des tirs). Relance 2.
- Tags : `placement`, `los_block`, `summon`, `control`

### Paire 7 : Somnolence / Manœuvre

> Choix : Somnolence (−2 PA en croix diagonale, PO 6) est le retrait PA de base ; Manœuvre pour la mobilité Air.

#### 7A. Somnolence (id 12977)

- **3 PA** · PO 0–6 (modifiable) · LdV requise · 1/tour · CC 15 % · élément(s) : Terre
- Grades : g1 niv.15 dmg 17–19 PO0-4 ; g2 niv.82 dmg 22–24 PO0-5 ; g3 niv.149 dmg 27–30 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Terre et retire des PA aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - 27 à 30 dommages Terre (CC : 32 à 36 dommages Terre) — cibles : ennemis ; zone : croix diagonale de taille 1
  - -2 PA (esquivable) — cibles : ennemis ; zone : croix diagonale de taille 1 ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Retrait PA de zone standard (−2 PA esquivables en croix diagonale, PO 6, 1/tour) ; à combiner avec Terre Battue.
- Tags : `damage`, `ap_removal`, `aoe`, `earth`

#### 7B. Manœuvre (id 13012)

- **4 PA** · PO 1–3 (non modifiable) · LdV requise, cible requise (case occupée) · 2/tour · CC 25 % · élément(s) : Air
- Grades : g1 niv.125 dmg 33–37 ; g2 niv.192 dmg 38–42 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Air aux ennemis et échange de position avec la cible. »
- Effets (infobulle, valeurs de base) :
  - 38 à 42 dommages Air (CC : 46 à 50 dommages Air) — cibles : ennemis
  - Échange de positions
- **Rôle tactique** : Meilleur dégât Air brut (38–42) + échange de place avec la cible (aussi un allié) : mobilité et sauvetage.
- Tags : `damage`, `mobility`, `air`

### Paire 8 : Léthargie / Regroupement

> Choix : Regroupement (attire en cercle 3) pour remplir les glyphes ; Léthargie (−2 PM) en mono-cible.

#### 8A. Léthargie (id 12993)

- **3 PA** · PO 1–5 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Feu
- Grades : g1 niv.20 dmg 18–20 PO1-3 ; g2 niv.87 dmg 23–25 PO1-4 ; g3 niv.154 dmg 28–31 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Feu et retire des PM. »
- Effets (infobulle, valeurs de base) :
  - 28 à 31 dommages Feu (CC : 34 à 37 dommages Feu)
  - -2 PM (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : −2 PM esquivables + 28–31 Feu, 3/tour 2/cible : retrait PM mono-cible.
- Tags : `damage`, `mp_removal`, `fire`

#### 8B. Regroupement (id 13008)

- **4 PA** · PO 0–0 (non modifiable) · sans LdV · 1/tour · CC 25 % · élément(s) : Terre
- Grades : g1 niv.130 dmg 33–37 ; g2 niv.197 dmg 38–42 (grade utilisé : 2).
- Description du jeu : « Attire les cibles vers le centre et occasionne des dommages Terre aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - Attire de 2 cases — zone : cercle de taille 3 (à partir de 1)
  - 38 à 42 dommages Terre (CC : 46 à 50 dommages Terre) — cibles : ennemis ; zone : cercle de taille 3 (à partir de 1)
- **Rôle tactique** : Attire de 2 tout ce qui est en cercle 3 (de 1 à 3) vers le Féca + 38–42 Terre aux ennemis : regroupe les monstres dans le glyphe du Féca et au contact (tank).
- Tags : `damage`, `placement`, `aoe`, `earth`

### Paire 9 : Bastion / Trêve

> Choix : Bastion (invulnérable distance) en général ; Trêve contre un tour de burst du boss au corps à corps.

#### 9A. Bastion (id 12995)

- **2 PA** · PO 0–7 (non modifiable) · sans LdV · relance 4 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.25 PO0-5 ; g2 niv.92 PO0-6 ; g3 niv.159 (grade utilisé : 3).
- Description du jeu : « Rend l'allié ciblé Invulnérable à distance. Augmente sa Puissance s'il est attaqué en mêlée ou désenvoûté. Sur une case libre : invoque un bouclier statique qui pose un glyphe-aura rendant les alliés Invulnérables à distance. Le glyphe suit le bouclier et il est détruit au tour suivant. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Invulnérable à Distance» (375) — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - 200 Puissance — cibles : alliés (lanceur inclus) ; 1 tour(s) ; déclenchement : quand le buff est désenvoûté / quand le porteur subit des dommages en mêlée (buff 1 t.)
  - invoque «Bastion» (7865, grade 1)
  - pose un glyphe-aura «Bastion» (29303, grade 2) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Bastion» (29051, grade 5) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Bastion» (id 29051, grade 5)*
      - applique l'état «Bastion» (5267) — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - applique l'état «Invulnérable à Distance» (375) — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - le lanceur lance le sort «Bastion» (29051, grade 6) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages en mêlée (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Bastion» (id 29051, grade 6)*
          - 200 Puissance — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - le lanceur lance le sort «Bastion» (29051, grade 9) — cibles : alliés (lanceur inclus) ; déclenchement : quand le buff est désenvoûté (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Bastion» (id 29051, grade 9)*
          - retire les effets du sort «Bastion» (29051) — cibles : alliés (lanceur inclus)
          - 200 Puissance — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - invoque «Bastion» (7865, grade 1)
- **Rôle tactique** : Invulnérabilité à distance d'un allié (+200 Puissance s'il est frappé au contact) ou bouclier statique avec aura d'invulnérabilité distance en croix 1. Indispensable contre des boss lanceurs.
- Tags : `protection`, `invulnerability`, `summon`

#### 9B. Trêve (id 12980)

- **3 PA** · PO 0–0 (non modifiable) · sans LdV · relance 5 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.135 (grade utilisé : 1).
- Description du jeu : « Pose un glyphe-aura qui rend les entités Pacifistes. »
- Effets (infobulle, valeurs de base) :
  - pose un glyphe-aura «Trêve» (29048, grade 1) — zone : cercle de taille 2 ; 1 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un glyphe-aura «Trêve» (29048, grade 1) — zone : cercle de taille 2 ; 1 tour(s) ; indésenvoûtable
    - *Sous-sort «Trêve» (id 29048, grade 1)*
      - applique l'état «Pacifiste» (218) — zone : cercle de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Glyphe-aura cercle 2 autour du Féca : toutes les entités (alliés ET ennemis) deviennent Pacifistes (ne peuvent plus infliger de dommages) pendant 1 tour. À utiliser quand le Féca est entouré d'ennemis et que les alliés sont hors de la zone.
- Tags : `protection`, `pacify`, `control`

### Paire 10 : Frisson / Giboulée

> Choix : Frisson (attire vers une case) pour placer ; Giboulée (repousse 4) pour éloigner.

#### 10A. Frisson (id 12989)

- **3 PA** · PO 1–4 (non modifiable) · en ligne, sans LdV · 2/tour · CC 15 % · élément(s) : Air
- Grades : g1 niv.30 dmg 16–18 ; g2 niv.97 dmg 21–23 ; g3 niv.164 dmg 26–29 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Air aux ennemis et attire les cibles vers la case ciblée en zone. »
- Effets (infobulle, valeurs de base) :
  - 26 à 29 dommages Air (CC : 31 à 35 dommages Air) — cibles : ennemis ; zone : cône de taille 2
  - Attire de 2 cases — zone : cône de taille 2
- **Rôle tactique** : Cône 2 en ligne, sans ligne de vue : attire les entités vers la case ciblée (2) + 26–29 Air ; place les ennemis dans un glyphe.
- Tags : `damage`, `placement`, `aoe`, `air`

#### 10B. Giboulée (id 13022)

- **4 PA** · PO 1–7 (modifiable) · LdV requise · 2/tour, 1/cible · CC 20 % · élément(s) : Eau
- Grades : g1 niv.140 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Eau aux ennemis et repousse la cible. »
- Effets (infobulle, valeurs de base) :
  - 36 à 40 dommages Eau (CC : 43 à 48 dommages Eau) — cibles : ennemis
  - Repousse de 4 cases
- **Rôle tactique** : 36–40 Eau + repousse 4 (dommages de poussée si obstacle) : éloigne un monstre de mêlée d'un allié fragile.
- Tags : `damage`, `placement`, `water`

### Paire 11 : Bulle / Sonnailles

> Choix : Bulle (2 PA, −3 PO, 3/tour) remplit les PA restants ; Sonnailles regroupe en ligne.

#### 11A. Bulle (id 12994)

- **2 PA** · PO 1–8 (modifiable) · LdV requise · 3/tour, 2/cible · CC 10 % · élément(s) : Eau
- Grades : g1 niv.35 dmg 10–12 PO1-6 ; g2 niv.102 dmg 13–15 PO1-7 ; g3 niv.169 dmg 17–19 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Eau et retire de la Portée. »
- Effets (infobulle, valeurs de base) :
  - 17 à 19 dommages Eau (CC : 20 à 23 dommages Eau)
  - -3 Portée — 1 tour(s)
- **Rôle tactique** : 2 PA, 1–8 PO, −3 PO non esquivable (effet 116) 3/tour 2/cible : retrait de PO très rentable et remplissage de PA.
- Tags : `damage`, `range_removal`, `water`

#### 11B. Sonnailles (id 14436)

- **4 PA** · PO 1–7 (modifiable) · en ligne, LdV requise · 2/tour · CC 20 % · élément(s) : Feu
- Grades : g1 niv.145 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Feu aux ennemis et attire les cibles jusqu'au centre en zone. »
- Effets (infobulle, valeurs de base) :
  - 32 à 36 dommages Feu (CC : 38 à 43 dommages Feu) — cibles : ennemis ; zone : ligne perpendiculaire (T) de 2 case(s)
  - Attire de 2 cases — zone : ligne perpendiculaire (T) de 2 case(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Sonnailles cibles» (1461) — zone : ligne perpendiculaire (T) de 2 case(s) ; durée infinie
  - 32 à 36 dommages Feu (CC : 38 à 43 dommages Feu) — cibles : ennemis ; zone : ligne perpendiculaire (T) de 2 case(s)
  - le lanceur lance sur la case le sort «Sonnailles» (14675, grade 1) — cibles : lanceur
    - *Sous-sort «Sonnailles» (id 14675, grade 1)*
      - applique l'état «Sonnailles bloquées» (1460) — 1 tour(s) ; désenvoûtement fort uniquement
  - le lanceur lance sur la case le sort «Sonnailles» (14675, grade 2) — cibles : lanceur
    - *Sous-sort «Sonnailles» (id 14675, grade 2)*
      - Attire de 1 case — cibles : tous ; si la cible n'a pas l'état «Sonnailles bloquées» (1460) ; si la cible a l'état «Sonnailles cibles» (1461) ; zone : croix sans centre de taille 1
      - Attire de 2 cases — cibles : tous ; si la cible n'a pas l'état «Sonnailles bloquées» (1460) ; si la cible a l'état «Sonnailles cibles» (1461) ; zone : croix sans centre de taille 2 (à partir de 2)
      - retire l'état «Sonnailles bloquées» (1460) — cibles : tous ; si la cible a l'état «Sonnailles bloquées» (1460) ; zone : toute la carte
      - retire l'état «Sonnailles cibles» (1461) — cibles : tous ; si la cible a l'état «Sonnailles cibles» (1461) ; zone : toute la carte
- **Rôle tactique** : Ligne perpendiculaire de 2 : 32–36 Feu puis attire les cibles vers le centre (case ciblée). Regroupe 4–5 ennemis en un point.
- Tags : `damage`, `placement`, `aoe`, `fire`

### Paire 12 : Transhumance / Égide

> Choix : Égide (interception en cercle 3, 2 tours) en protection pure ; Transhumance pour le jeu glyphes.

#### 12A. Transhumance (id 12986)

- **3 PA** · PO 1–6 (non modifiable) · sans LdV, case libre requise · relance 3 t. · CC 0 % · critère d'état `HS!7`
- Grades : g1 niv.40 PO1-4 ; g2 niv.107 PO1-5 ; g3 niv.174 (grade utilisé : 3).
- Description du jeu : « Téléporte le lanceur et déclenche ses glyphes élémentaires sur la case ciblée. Applique également l'Étoile du Berger sur les alliés présents dans les glyphes déclenchés. Les glyphes ne peuvent être déclenchés manuellement qu'une seule fois par tour. »
- Effets (infobulle, valeurs de base) :
  - Téléporte sur la case ciblée
  - déclenche les glyphes «Prairie» (12992) — cibles : tous ; si le lanceur n'a pas l'état «Prairie déclenchée» (5364)
  - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; 2 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Glyphes déclenchés» (5260) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Transhumance» (5372) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
  - Téléporte sur la case ciblée
  - déclenche les glyphes «Terre Battue» (12987) — cibles : tous ; si le lanceur n'a pas l'état «Terre Battue déclenchée» (5366)
  - déclenche les glyphes «Refuge» (13021) — cibles : tous ; si le lanceur n'a pas l'état «Refuge déclenché» (5370)
  - déclenche les glyphes «Terre Brûlée» (12985) — cibles : tous ; si le lanceur n'a pas l'état «Terre Brûlée déclenchée» (5367)
  - déclenche les glyphes «Vigie» (13039) — cibles : tous ; si le lanceur n'a pas l'état «Vigie déclenchée» (5371)
  - déclenche les glyphes «Vallée» (12990) — cibles : tous ; si le lanceur n'a pas l'état «Vallée déclenchée» (5365)
  - déclenche les glyphes «Verglas» (13023) — cibles : tous ; si le lanceur n'a pas l'état «Verglas déclenché» (5369)
  - déclenche les glyphes «Prairie» (12992) — cibles : tous ; si le lanceur n'a pas l'état «Prairie déclenchée» (5364)
  - déclenche les glyphes «Pâturage» (13013) — cibles : tous ; si le lanceur n'a pas l'état «Pâturage déclenché» (5368)
  - retire l'état «Glyphes déclenchés» (5260) — cibles : lanceur
  - retire l'état «Transhumance» (5372) — cibles : lanceur
- **Rôle tactique** : Téléportation (case libre, 1–6) + déclenchement immédiat de tous les glyphes du Féca contenant la case d'arrivée ; donne l'Étoile du Berger aux alliés dans ces glyphes. Bloqué par Pesanteur.
- Tags : `mobility`, `glyph_trigger`, `damage`

#### 12B. Égide (id 13018)

- **3 PA** · PO 0–4 (non modifiable) · LdV requise · relance 4 t. · CC 0 %
- Grades : g1 niv.150 (grade utilisé : 1).
- Description du jeu : « Invoque un bouclier statique qui intercepte les dommages subis par les alliés présents dans son glyphe-aura et leur applique l'état Étoile du Berger. Le glyphe suit le bouclier et il est détruit 2 tours après son invocation. Sur une cible : pose un glyphe-aura qui intercepte les dommages subis par les alliés et leur applique l'état Étoile du Berger. N'affecte pas la Barricade et le Bastion. »
- Effets (infobulle, valeurs de base) :
  - invoque «Égide» (5903, grade 1)
  - pose un glyphe-aura «Sanctuaire» (29086, grade 2) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 3 (à partir de 1) ; 2 tour(s)
  - Tue la cible — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort) ; si la cible est le monstre «Égide» (5903) ; effet différé de 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Sanctuaire» (29086, grade 1)
    - *Sous-sort «Sanctuaire» (id 29086, grade 1)*
      - pose un glyphe-aura «Sanctuaire» (29086, grade 2) — cibles : alliés (hors lanceur) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865) ; zone : cercle de taille 3 ; 2 tour(s)
        - *Sous-sort «Sanctuaire» (id 29086, grade 2)*
          - Intercepte les dommages — cibles : alliés (hors lanceur) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865) ; zone : cercle de taille 3 ; déclenchement : quand le porteur subit des dommages (buff 2 t.) ; désenvoûtement fort uniquement
          - applique l'état «Sacrifice» (583) — cibles : alliés (hors lanceur) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865) ; zone : cercle de taille 3 (à partir de 1) ; 2 tour(s) ; désenvoûtement fort uniquement
          - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
          - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3
            - *Sous-sort «Étoile du Berger» (id 29056, grade 1)*
              - le lanceur lance le sort «Armure Terrestre» (29057, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Terrestre» (5262)
              - le lanceur lance le sort «Armure Incandescente» (29058, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Incandescente» (5263)
              - le lanceur lance le sort «Armure Aqueuse» (29059, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Aqueuse» (5264)
              - le lanceur lance le sort «Armure Venteuse» (29060, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Venteuse» (5265)
  - invoque «Égide» (5903, grade 1)
- **Rôle tactique** : Bouclier statique à gros PV qui intercepte pendant 2 tours les dommages des alliés en cercle 3 (et leur donne l'Étoile) ; sur une cible, l'aura d'interception est posée directement. Excellente protection de groupe contre les dégâts de zone.
- Tags : `protection`, `interception`, `summon`

### Paire 13 : Prairie / Pâturage

> Choix : Prairie (−20 % dommages finaux aux ennemis) est l'un des meilleurs sorts défensifs du jeu.

#### 13A. Prairie (id 12992)

- **3 PA** · PO 0–5 (non modifiable) · sans LdV · relance 3 t., relance partagée entre lanceurs (global = -1) · CC 0 % · élément(s) : Air · critère d'état `HS!238`
- Grades : g1 niv.45 PO0-3 ; g2 niv.112 PO0-4 ; g3 niv.179 (grade utilisé : 3).
- Description du jeu : « Pose un glyphe de début de tour qui occasionne des dommages Air aux ennemis. Réduit les dommages finaux des ennemis présents ou entrant dans le glyphe. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - pose un glyphe de début de tour «Prairie» (12999, grade 3) — cibles : ennemis ; zone : étoile (8 directions) de taille 2 ; 2 tour(s)
  - pose un glyphe-aura «Prairie» (29064, grade 3) — zone : étoile (8 directions) de taille 2 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Lanterne du Berger» (7841, grade 1)
  - pose un glyphe de début de tour «Prairie» (12999, grade 3) — cibles : ennemis ; zone : étoile (8 directions) de taille 2 ; 2 tour(s)
    - *Sous-sort «Prairie» (id 12999, grade 3)*
      - 31 à 35 dommages Air — cibles : ennemis ; zone : étoile (8 directions) de taille 2
      - applique l'état «Prairie déclenchée» (5364) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : étoile (8 directions) de taille 2
        - *Sous-sort «Transhumance» (id 29556, grade 1)*
          - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; 2 tour(s) ; indésenvoûtable
          - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841)
            - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : étoile (8 directions) de taille 2
        - *Sous-sort «Mise en Garde» (id 29557, grade 1)*
          - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; 2 tour(s) ; indésenvoûtable
          - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841)
            - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
  - pose un glyphe-aura «Prairie» (29064, grade 3) — zone : étoile (8 directions) de taille 2 ; 2 tour(s)
    - *Sous-sort «Prairie» (id 29064, grade 3)*
      - applique l'état «Armure Venteuse» (5265) — cibles : alliés (lanceur inclus) ; zone : étoile (8 directions) de taille 2 ; 2 tour(s) ; indésenvoûtable
      - -20% Dommages finaux — cibles : ennemis ; zone : étoile (8 directions) de taille 2 ; 2 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Venteuse» (29060, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : étoile (8 directions) de taille 2
        - (sous-sort «Armure Venteuse» 29060 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Venteuse» (29060, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : étoile (8 directions) de taille 2
        - (sous-sort «Armure Venteuse» 29060 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Glyphe étoile 2 : 31–35 Air au début du tour des ennemis + aura −20 % dommages finaux aux ennemis présents (2 tours). Priorité contre un boss qui frappe fort.
- Tags : `glyph`, `damage`, `debuff`, `aoe`, `air`

#### 13B. Pâturage (id 13013)

- **3 PA** · PO 0–6 (modifiable) · LdV requise · 1/tour · CC 10 % · élément(s) : Air · critère d'état `HS!238`
- Grades : g1 niv.155 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Air aux ennemis en zone et pose un glyphe-aura sous la cible qui augmente les dommages finaux des alliés. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. Dissipe le glyphe-aura du sort précédemment posé. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - 31 à 35 dommages Air (CC : 37 à 42 dommages Air) — cibles : ennemis ; zone : croix de taille 1
  - pose un glyphe-aura «Pâturage» (13028, grade 1) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - dissipe les glyphes «Pâturage» (13013) — cibles : lanceur
  - invoque «Lanterne du Berger» (7841, grade 1)
  - 31 à 35 dommages Air (CC : 37 à 42 dommages Air) — cibles : ennemis ; zone : croix de taille 1
  - pose un glyphe-aura «Pâturage» (13028, grade 1) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 2 tour(s)
    - *Sous-sort «Pâturage» (id 13028, grade 1)*
      - applique l'état «Armure Venteuse» (5265) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 2 tour(s) ; indésenvoûtable
      - 10% Dommages finaux — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 2 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Venteuse» (29060, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : croix de taille 1
        - (sous-sort «Armure Venteuse» 29060 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Venteuse» (29060, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : croix de taille 1
        - (sous-sort «Armure Venteuse» 29060 g1 déjà détaillé plus haut)
  - pose un glyphe de début de tour «Pâturage» (29068, grade 1) — cibles : ennemis ; si la cible a l'état «Glyphes déclenchés» (5260) ; zone : croix de taille 1 ; 2 tour(s)
    - *Sous-sort «Pâturage» (id 29068, grade 1)*
      - 31 à 35 dommages Air (CC : 37 à 42 dommages Air) — cibles : ennemis ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; zone : croix de taille 1
      - applique l'état «Pâturage déclenché» (5368) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : croix de taille 1
        - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : croix de taille 1
        - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Dégâts Air immédiats en croix + aura +10 % dommages finaux aux alliés sous la cible (2 tours). Glyphe offensif pour un groupe de mêlée.
- Tags : `damage`, `buff`, `aoe`, `air`

### Paire 14 : Vallée / Verglas

> Choix : Vallée (−6 PO aux ennemis) neutralise les lanceurs à distance.

#### 14A. Vallée (id 12990)

- **3 PA** · PO 0–7 (modifiable) · LdV requise · relance 3 t., relance partagée entre lanceurs (global = -1) · CC 0 % · élément(s) : Eau · critère d'état `HS!238`
- Grades : g1 niv.50 PO0-5 ; g2 niv.117 PO0-6 ; g3 niv.184 (grade utilisé : 3).
- Description du jeu : « Pose un glyphe de début de tour qui occasionne des dommages Eau aux ennemis. Retire de la Portée aux ennemis présents ou entrant dans le glyphe. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - pose un glyphe de début de tour «Vallée» (12998, grade 3) — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s)
  - pose un glyphe-aura «Vallée» (29061, grade 3) — zone : cercle de taille 3 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Lanterne du Berger» (7841, grade 1)
  - pose un glyphe de début de tour «Vallée» (12998, grade 3) — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s)
    - *Sous-sort «Vallée» (id 12998, grade 3)*
      - 28 à 32 dommages Eau — cibles : ennemis ; zone : cercle de taille 3
      - applique l'état «Vallée déclenchée» (5365) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3
        - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3
        - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
  - pose un glyphe-aura «Vallée» (29061, grade 3) — zone : cercle de taille 3 ; 2 tour(s)
    - *Sous-sort «Vallée» (id 29061, grade 3)*
      - applique l'état «Armure Aqueuse» (5264) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 3 ; 2 tour(s) ; indésenvoûtable
      - -6 Portée — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Aqueuse» (29059, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : cercle de taille 3
        - (sous-sort «Armure Aqueuse» 29059 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Aqueuse» (29059, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : cercle de taille 3
        - (sous-sort «Armure Aqueuse» 29059 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Glyphe cercle 3 : 28–32 Eau au début du tour des ennemis + aura −6 PO (non esquivable) : les lanceurs à distance sont neutralisés tant qu'ils restent dedans.
- Tags : `glyph`, `damage`, `range_removal`, `aoe`, `water`

#### 14B. Verglas (id 13023)

- **3 PA** · PO 0–8 (modifiable) · LdV requise · 1/tour · CC 10 % · élément(s) : Eau · critère d'état `HS!238`
- Grades : g1 niv.160 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Eau aux ennemis en zone et pose un glyphe-aura sous la cible qui augmente la Fuite des alliés. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. Dissipe le glyphe-aura du sort précédemment posé. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - 31 à 35 dommages Eau (CC : 37 à 42 dommages Eau) — cibles : ennemis ; zone : carré de taille 1
  - pose un glyphe-aura «Verglas» (13034, grade 1) — cibles : alliés (lanceur inclus) ; zone : carré de taille 1 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - dissipe les glyphes «Verglas» (13023) — cibles : lanceur
  - invoque «Lanterne du Berger» (7841, grade 1)
  - 31 à 35 dommages Eau (CC : 37 à 42 dommages Eau) — cibles : ennemis ; zone : carré de taille 1
  - pose un glyphe-aura «Verglas» (13034, grade 1) — cibles : alliés (lanceur inclus) ; zone : carré de taille 1 ; 2 tour(s)
    - *Sous-sort «Verglas» (id 13034, grade 1)*
      - applique l'état «Armure Aqueuse» (5264) — cibles : alliés (lanceur inclus) ; zone : carré de taille 1 ; 2 tour(s) ; indésenvoûtable
      - 50 Fuite — cibles : alliés (lanceur inclus) ; zone : carré de taille 1 ; 2 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Aqueuse» (29059, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : carré de taille 1
        - (sous-sort «Armure Aqueuse» 29059 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Aqueuse» (29059, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : carré de taille 1
        - (sous-sort «Armure Aqueuse» 29059 g1 déjà détaillé plus haut)
  - pose un glyphe de début de tour «Verglas» (29066, grade 1) — cibles : ennemis ; si la cible a l'état «Glyphes déclenchés» (5260) ; zone : carré de taille 1 ; 2 tour(s)
    - *Sous-sort «Verglas» (id 29066, grade 1)*
      - 31 à 35 dommages Eau (CC : 37 à 42 dommages Eau) — cibles : ennemis ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; zone : carré de taille 1
      - applique l'état «Verglas déclenché» (5369) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : carré de taille 1
        - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : carré de taille 1
        - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Dégâts Eau immédiats en carré 1 + aura +50 Fuite aux alliés : libère un allié tacle.
- Tags : `damage`, `buff`, `aoe`, `water`

### Paire 15 : Terre Battue / Refuge

> Choix : Terre Battue (−3 PA aux ennemis) ; Refuge (dommages subis ×85 % aux alliés) si le groupe est statique.

#### 15A. Terre Battue (id 12987)

- **3 PA** · PO 0–5 (non modifiable) · sans LdV · relance 3 t., relance partagée entre lanceurs (global = -1) · CC 0 % · élément(s) : Terre · critère d'état `HS!238`
- Grades : g1 niv.55 PO0-3 ; g2 niv.122 PO0-4 ; g3 niv.189 (grade utilisé : 3).
- Description du jeu : « Pose un glyphe de début de tour qui occasionne des dommages Terre aux ennemis. Retire des PA aux ennemis présents ou entrant dans le glyphe. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - pose un glyphe de début de tour «Terre Battue» (13000, grade 3) — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s)
  - pose un glyphe-aura «Terre Battue» (29063, grade 3) — zone : cercle de taille 3 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Lanterne du Berger» (7841, grade 1)
  - pose un glyphe de début de tour «Terre Battue» (13000, grade 3) — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s)
    - *Sous-sort «Terre Battue» (id 13000, grade 3)*
      - 29 à 33 dommages Terre — cibles : ennemis ; zone : cercle de taille 3
      - applique l'état «Terre Battue déclenchée» (5366) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3
        - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3
        - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
  - pose un glyphe-aura «Terre Battue» (29063, grade 3) — zone : cercle de taille 3 ; 2 tour(s)
    - *Sous-sort «Terre Battue» (id 29063, grade 3)*
      - applique l'état «Armure Terrestre» (5262) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 3 ; 2 tour(s) ; indésenvoûtable
      - -3 PA (esquivable) — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Terrestre» (29057, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : cercle de taille 3
        - (sous-sort «Armure Terrestre» 29057 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Terrestre» (29057, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : cercle de taille 3
        - (sous-sort «Armure Terrestre» 29057 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Glyphe cercle 3 : 29–33 Terre au début du tour des ennemis + aura −3 PA (esquivable) tant qu'ils restent dedans. Le meilleur sort d'entrave de zone de la classe.
- Tags : `glyph`, `damage`, `ap_removal`, `aoe`, `earth`

#### 15B. Refuge (id 13021)

- **3 PA** · PO 0–5 (modifiable) · LdV requise · 1/tour · CC 10 % · élément(s) : Terre · critère d'état `HS!238`
- Grades : g1 niv.165 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Terre aux ennemis en zone et pose un glyphe-aura sous la cible qui réduit les dommages subis par les alliés. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. Dissipe le glyphe-aura du sort précédemment posé. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - 32 à 36 dommages Terre (CC : 38 à 43 dommages Terre) — cibles : ennemis ; zone : cercle de taille 2
  - pose un glyphe-aura «Refuge» (13032, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - dissipe les glyphes «Refuge» (13021) — cibles : lanceur
  - invoque «Lanterne du Berger» (7841, grade 1)
  - 32 à 36 dommages Terre (CC : 38 à 43 dommages Terre) — cibles : ennemis ; zone : cercle de taille 2
  - pose un glyphe-aura «Refuge» (13032, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s)
    - *Sous-sort «Refuge» (id 13032, grade 1)*
      - applique l'état «Armure Terrestre» (5262) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s) ; indésenvoûtable
      - Dommages subis x85% — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; déclenchement : quand le porteur subit des dommages (buff 2 t.) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Terrestre» (29057, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : cercle de taille 2
        - (sous-sort «Armure Terrestre» 29057 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Terrestre» (29057, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : cercle de taille 2
        - (sous-sort «Armure Terrestre» 29057 g1 déjà détaillé plus haut)
  - pose un glyphe de début de tour «Refuge» (29067, grade 1) — cibles : ennemis ; si la cible a l'état «Glyphes déclenchés» (5260) ; zone : cercle de taille 2 ; 2 tour(s)
    - *Sous-sort «Refuge» (id 29067, grade 1)*
      - 32 à 36 dommages Terre (CC : 38 à 43 dommages Terre) — cibles : ennemis ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; zone : cercle de taille 2
      - applique l'état «Refuge déclenché» (5370) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 2
        - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 2
        - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Dégâts Terre immédiats en cercle 2 + aura « dommages subis ×85 % » pour les alliés dedans (2 tours).
- Tags : `damage`, `protection`, `aoe`, `earth`

### Paire 16 : Terre Brûlée / Vigie

> Choix : Terre Brûlée (−3 PM aux ennemis) ; Vigie (+5 PO alliés) pour un groupe de DPS distance.

#### 16A. Terre Brûlée (id 12985)

- **3 PA** · PO 0–5 (non modifiable) · sans LdV · relance 3 t., relance partagée entre lanceurs (global = -1) · CC 0 % · élément(s) : Feu · critère d'état `HS!238`
- Grades : g1 niv.60 PO0-3 ; g2 niv.127 PO0-4 ; g3 niv.194 (grade utilisé : 3).
- Description du jeu : « Pose un glyphe de début de tour qui occasionne des dommages Feu aux ennemis. Retire des PM aux ennemis présents ou entrant dans le glyphe. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - pose un glyphe de début de tour «Terre Brûlée» (12996, grade 3) — cibles : ennemis ; zone : carré de taille 2 ; 2 tour(s)
  - pose un glyphe-aura «Terre Brûlée» (29062, grade 3) — zone : carré de taille 2 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Lanterne du Berger» (7841, grade 1)
  - pose un glyphe de début de tour «Terre Brûlée» (12996, grade 3) — cibles : ennemis ; zone : carré de taille 2 ; 2 tour(s)
    - *Sous-sort «Terre Brûlée» (id 12996, grade 3)*
      - 30 à 34 dommages Feu — cibles : ennemis ; zone : carré de taille 2
      - applique l'état «Terre Brûlée déclenchée» (5367) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : carré de taille 2
        - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : carré de taille 2
        - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
  - pose un glyphe-aura «Terre Brûlée» (29062, grade 3) — zone : carré de taille 2 ; 2 tour(s)
    - *Sous-sort «Terre Brûlée» (id 29062, grade 3)*
      - applique l'état «Armure Incandescente» (5263) — cibles : alliés (lanceur inclus) ; zone : carré de taille 2 ; 2 tour(s) ; indésenvoûtable
      - -3 PM (esquivable) — cibles : ennemis ; zone : carré de taille 2 ; 2 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Armure Incandescente» (29058, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : carré de taille 2
        - (sous-sort «Armure Incandescente» 29058 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Armure Incandescente» (29058, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : carré de taille 2
        - (sous-sort «Armure Incandescente» 29058 g1 déjà détaillé plus haut)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Glyphe carré 2 : 30–34 Feu au début du tour des ennemis + aura −3 PM (esquivable) : immobilise un paquet de monstres.
- Tags : `glyph`, `damage`, `mp_removal`, `aoe`, `fire`

#### 16B. Vigie (id 13025)

- **3 PA** · PO 0–7 (modifiable) · LdV requise · 1/tour · CC 10 % · élément(s) : Feu · critère d'état `HS!238`
- Grades : g1 niv.170 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Feu aux ennemis en zone et pose un glyphe-aura sous le lanceur qui augmente la Portée des alliés. Le glyphe-aura se pose sur la case ciblée si elle est libre ou si la cible est un allié. Invoque également la Lanterne du Berger si la case est libre. Empêche l'utilisation d'autres glyphes élémentaires dans le même tour. Dissipe le glyphe-aura du sort précédemment posé. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - 30 à 34 dommages Feu (CC : 36 à 41 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
  - pose un glyphe-aura «Vigie» (13037, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - dissipe les glyphes «Vigie» (13039) — cibles : lanceur
  - invoque «Lanterne du Berger» (7841, grade 1)
  - le lanceur lance le sort «Vigie» (13039, grade 1)
    - *Sous-sort «Vigie» (id 13039, grade 1)*
      - le lanceur lance le sort «Vigie» (13039, grade 2) — cibles : alliés (lanceur inclus)
        - *Sous-sort «Vigie» (id 13039, grade 2)*
          - applique l'état «Vigie allié» (5272) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Vigie» (13039, grade 3) — cibles : ennemis
        - *Sous-sort «Vigie» (id 13039, grade 3)*
          - applique l'état «Vigie ennemi» (5273) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
  - 30 à 34 dommages Feu (CC : 36 à 41 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
  - le lanceur lance sur la case le sort «Vigie» (13039, grade 4)
    - *Sous-sort «Vigie» (id 13039, grade 4)*
      - le lanceur lance le sort «Vigie» (13039, grade 5) — cibles : alliés (lanceur inclus) ; si le lanceur a l'état «Vigie allié» (5272)
        - *Sous-sort «Vigie» (id 13039, grade 5)*
          - pose un glyphe-aura «Vigie» (13037, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s)
            - *Sous-sort «Vigie» (id 13037, grade 1)*
              - applique l'état «Armure Incandescente» (5263) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s) ; indésenvoûtable
              - 5 Portée — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 2 tour(s) ; désenvoûtement fort uniquement
              - le lanceur lance le sort «Armure Incandescente» (29058, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est un joueur de classe 1 ; zone : cercle de taille 2
                - (sous-sort «Armure Incandescente» 29058 g1 déjà détaillé plus haut)
              - le lanceur lance le sort «Armure Incandescente» (29058, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Étoile du Berger» (5261) ; zone : cercle de taille 2
                - (sous-sort «Armure Incandescente» 29058 g1 déjà détaillé plus haut)
          - pose un glyphe de début de tour «Vigie» (29065, grade 1) — cibles : ennemis ; si la cible a l'état «Glyphes déclenchés» (5260) ; zone : cercle de taille 2 ; 2 tour(s)
            - *Sous-sort «Vigie» (id 29065, grade 1)*
              - 30 à 34 dommages Feu (CC : 36 à 41 dommages Feu) — cibles : ennemis ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; zone : cercle de taille 2
              - applique l'état «Vigie déclenchée» (5371) — cibles : lanceur ; si le lanceur a l'état «Glyphes déclenchés» (5260) ; 1 tour(s) ; indésenvoûtable
              - le lanceur lance le sort «Transhumance» (29556, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Transhumance» (5372) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 2
                - (sous-sort «Transhumance» 29556 g1 déjà détaillé plus haut)
              - le lanceur lance le sort «Mise en Garde» (29557, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur a l'état «Mise en Garde» (5373) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 2
                - (sous-sort «Mise en Garde» 29557 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Vigie» (13039, grade 5) — cibles : lanceur ; si le lanceur a l'état «Vigie ennemi» (5273)
        - (sous-sort «Vigie» 13039 g5 déjà détaillé plus haut)
      - le lanceur lance sur la case le sort «Vigie» (13039, grade 5) — cibles : tous ; si le lanceur n'a pas l'état «Vigie allié» (5272) ; si le lanceur n'a pas l'état «Vigie ennemi» (5273)
        - (sous-sort «Vigie» 13039 g5 déjà détaillé plus haut)
      - retire l'état «Vigie allié» (5272) — cibles : lanceur ; si le lanceur a l'état «Vigie allié» (5272)
      - retire l'état «Vigie ennemi» (5273) — cibles : lanceur ; si le lanceur a l'état «Vigie ennemi» (5273)
  - applique l'état «Hypoglyphe» (238) — cibles : lanceur ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : Dégâts Feu immédiats en cercle 2 + aura +5 PO aux alliés (sous le lanceur, ou sur la case ciblée si libre/allié).
- Tags : `damage`, `buff`, `aoe`, `fire`

### Paire 17 : Renfort / Ataraxie

> Choix : Ataraxie (−75 % sur la prochaine attaque) est très forte contre les gros coups ; Renfort pour rejoindre un allié.

#### 17A. Renfort (id 13020)

- **2 PA** · PO 2–6 (non modifiable) · en ligne, sans LdV, cible requise (case occupée) · 1/tour · CC 0 % · critère d'état `HS!7`
- Grades : g1 niv.65 PO2-4 ; g2 niv.131 PO2-5 ; g3 niv.198 (grade utilisé : 3).
- Description du jeu : « Téléporte le lanceur jusqu'à l'allié ciblé. »
- Effets (infobulle, valeurs de base) :
  - Téléporte sur la case ciblée — cibles : lanceur
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Renfort» (13043, grade 1) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Renfort» (id 13043, grade 1)*
      - Téléporte sur la case ciblée — zone : ligne depuis le lanceur de 0 case(s) (p2=63), s'arrête à la 1re cible
- **Rôle tactique** : Téléporte le Féca au contact d'un allié en ligne (2–6 PO, cible requise) ; pour aller protéger/tacler. Bloqué par Pesanteur.
- Tags : `mobility`

#### 17B. Ataraxie (id 13027)

- **2 PA** · PO 0–5 (non modifiable) · sans LdV · 3/tour, 1/cible · CC 0 %
- Grades : g1 niv.175 (grade utilisé : 1).
- Description du jeu : « Applique l'état Pesanteur sur l'allié ciblé et réduit tout type de dommages subis sur la première attaque. Les effets du sort sont retirés à la moindre attaque subie. Les effets d'interception et de partage de dommages sont incompatibles avec le sort. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Pesanteur» (7) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Sacrifice» (583) ; 1 tour(s) ; indésenvoûtable
  - Dommages subis x25% — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Sacrifice» (583) ; déclenchement : quand le porteur subit des dommages / dommages subis pendant sa fin de tour (DTE) / dommages subis pendant son début de tour (DTB) / perte de PV (DV) / quand le porteur subit des dommages de poussée (buff 1 t.) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Pesanteur» (7) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Sacrifice» (583) ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Ataraxie» (2742) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Sacrifice» (583) ; 1 tour(s) ; indésenvoûtable
  - Dommages subis x25% — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Sacrifice» (583) ; déclenchement : quand le porteur subit des dommages / dommages subis pendant sa fin de tour (DTE) / dommages subis pendant son début de tour (DTB) / perte de PV (DV) / quand le porteur subit des dommages de poussée (buff 1 t.) ; indésenvoûtable
  - retire les effets du sort «Ataraxie» (13027) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Sacrifice» (583) ; déclenchement : quand le porteur subit des dommages / dommages subis pendant sa fin de tour (DTE) / dommages subis pendant son début de tour (DTB) / perte de PV (DV) / quand le porteur subit des dommages de poussée / quand le porteur gagne l'état «Sacrifice» (583) (buff 1 t.) ; indésenvoûtable
- **Rôle tactique** : 2 PA, 3/tour : l'allié prend Pesanteur et ne subit que 25 % de la prochaine attaque (dommages directs, poison, poussée), puis l'effet disparaît. Incompatible avec l'interception (état Sacrifice). Parfait contre un coup de boss prévisible.
- Tags : `protection`, `anti_burst`

### Paire 18 : Silbo / Houlette

> Choix : Houlette (attire 3) pour ramener une cible ; Silbo pour repousser en croix.

#### 18A. Silbo (id 13011)

- **2 PA** · PO 1–6 (non modifiable) · sans LdV · 2/tour · CC 10 % · élément(s) : Air
- Grades : g1 niv.70 dmg 13–15 PO1-5 ; g2 niv.137 dmg 17–19 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Air aux ennemis et repousse les cibles depuis le centre en zone. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 17 à 19 dommages Air (CC : 20 à 23 dommages Air) — cibles : ennemis ; zone : croix de taille 1
  - Repousse de 1 case — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 1
- **Rôle tactique** : 2 PA sans ligne de vue : 17–19 Air en croix + repousse de 1 tout ce qui entoure la case ciblée (sauf le lanceur).
- Tags : `damage`, `placement`, `aoe`, `air`

#### 18B. Houlette (id 13007)

- **2 PA** · PO 1–7 (modifiable) · en ligne, LdV requise · 3/tour, 2/cible · CC 10 % · élément(s) : Feu
- Grades : g1 niv.180 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Feu aux ennemis et attire la cible. »
- Effets (infobulle, valeurs de base) :
  - 18 à 20 dommages Feu (CC : 22 à 24 dommages Feu) — cibles : ennemis
  - Attire de 3 cases
- **Rôle tactique** : 2 PA en ligne 1–7 : 18–20 Feu + attire la cible de 3 (aussi un allié) ; rapatrie un ennemi au contact ou dans un glyphe.
- Tags : `damage`, `placement`, `fire`

### Paire 19 : Torpeur / Escapade

> Choix : Torpeur (attire 2 + Terre) ou Escapade (recule de 2 + Eau) selon le besoin de distance.

#### 19A. Torpeur (id 14434)

- **3 PA** · PO 1–6 (non modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Terre
- Grades : g1 niv.75 dmg 22–24 PO1-5 ; g2 niv.142 dmg 27–30 (grade utilisé : 2).
- Description du jeu : « Attire la cible et occasionne des dommages Terre aux ennemis. »
- Effets (infobulle, valeurs de base) :
  - Attire de 2 cases
  - 27 à 30 dommages Terre (CC : 32 à 36 dommages Terre) — cibles : ennemis
- **Rôle tactique** : Attire de 2 puis 27–30 Terre ; rapproche un ennemi.
- Tags : `damage`, `placement`, `earth`

#### 19B. Escapade (id 29045)

- **3 PA** · PO 1–6 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Eau
- Grades : g1 niv.185 (grade utilisé : 1).
- Description du jeu : « Éloigne le lanceur de la cible et occasionne des dommages Eau aux ennemis. »
- Effets (infobulle, valeurs de base) :
  - Recule de 2 cases
  - 27 à 29 dommages Eau (CC : 32 à 35 dommages Eau) — cibles : ennemis
- **Rôle tactique** : Le Féca recule de 2 puis 27–29 Eau ; sortie de tacle partielle.
- Tags : `damage`, `mobility`, `water`

### Paire 20 : Bergerie / Excursion

> Choix : Bergerie (Inébranlable + Pesanteur en carré 2) fixe les ennemis dans un glyphe ; Excursion pour échanger un allié en danger.

#### 20A. Bergerie (id 12991)

- **3 PA** · PO 0–3 (non modifiable) · sans LdV · relance 3 t., relance initiale 1 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.80 PO0-2 ; g2 niv.147 (grade utilisé : 2).
- Description du jeu : « Pose un glyphe-aura qui applique les états Inébranlable et Pesanteur sur les entités. Applique également l'Étoile du Berger sur les alliés présents ou entrant dans le glyphe. »
- Effets (infobulle, valeurs de base) :
  - pose un glyphe-aura «Bergerie» (13005, grade 2) — zone : carré de taille 2 ; 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un glyphe-aura «Bergerie» (13005, grade 2) — zone : carré de taille 2 ; 1 tour(s)
    - *Sous-sort «Bergerie» (id 13005, grade 2)*
      - applique l'état «Inébranlable» (157) — zone : carré de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
      - applique l'état «Pesanteur» (7) — zone : carré de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
      - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : carré de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
      - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : carré de taille 2
        - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
- **Rôle tactique** : Glyphe-aura carré 2 (1 tour) : Inébranlable + Pesanteur sur toutes les entités (empêche poussées, téléportations, échanges) + Étoile du Berger aux alliés. Fixe les ennemis dans les glyphes et protège contre les placements adverses.
- Tags : `control`, `anti_push`, `protection`

#### 20B. Excursion (id 13024)

- **2 PA** · PO 0–6 (non modifiable) · LdV requise · 1/tour · CC 0 %
- Grades : g1 niv.190 (grade utilisé : 1).
- Description du jeu : « Pose un glyphe qui échange la position des alliés avec celle du lanceur. Applique également l'Étoile du Berger sur les alliés qui déclenchent le glyphe. »
- Effets (infobulle, valeurs de base) :
  - pose un glyphe (effet immédiat à la pose) «Excursion» (13036, grade 2) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Pesanteur» (7) ; 1 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un glyphe-aura «Excursion» (13036, grade 1) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Pesanteur» (7) ; 1 tour(s) ; indésenvoûtable
    - *Sous-sort «Excursion» (id 13036, grade 1)*
      - le lanceur lance le sort «Excursion» (13036, grade 3) — cibles : alliés (hors lanceur) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; si la cible n'a pas l'état «Pesanteur» (7) ; si le lanceur n'a pas l'état «Excursion (blocage)» (7175)
        - *Sous-sort «Excursion» (id 13036, grade 3)*
          - applique l'état «Excursion (blocage)» (7175) — cibles : lanceur ; si le lanceur n'a pas l'état «Excursion (blocage)» (7175) ; 1 tour(s) ; indésenvoûtable
          - Échange de positions — cibles : alliés (hors lanceur) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; si la cible n'a pas l'état «Pesanteur» (7) ; si le lanceur n'a pas l'état «Excursion (blocage)» (7175)
          - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur n'a pas l'état «Excursion (blocage)» (7175) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; 1 tour(s) ; indésenvoûtable
          - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si le lanceur n'a pas l'état «Excursion (blocage)» (7175) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841)
            - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
          - retire l'état «Excursion (blocage)» (7175) — cibles : lanceur
  - pose un glyphe (effet immédiat à la pose) «Excursion» (13036, grade 2) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Pesanteur» (7) ; 1 tour(s) ; indésenvoûtable
    - *Sous-sort «Excursion» (id 13036, grade 2)*
- **Rôle tactique** : Glyphe : le premier allié qui y passe échange sa place avec le Féca (et reçoit l'Étoile). Sauvetage d'un allié encerclé.
- Tags : `mobility`, `rescue`

### Paire 21 : Défiance / Barrière

> Choix : Défiance (tacle + glyphe 4 éléments + 30 % rés. mêlée) pour tanker ; Barrière pour enfermer un ennemi.

#### 21A. Défiance (id 12988)

- **2 PA** · PO 0–7 (modifiable) · LdV requise · relance 2 t., relance partagée entre lanceurs (global = -1) · CC 0 % · élément(s) : Air, Eau, Feu, Terre
- Grades : g1 niv.85 PO0-6 ; g2 niv.152 (grade utilisé : 2).
- Description du jeu : « Augmente le Tacle de l'allié ciblé pour chaque ennemi à son contact et pose un glyphe de fin de tour qui occasionne des dommages Terre, Feu, Eau et Air aux ennemis. Augmente les résistances en mêlée des alliés présents ou entrant dans le glyphe. Invoque également la Lanterne du Berger, lui applique les effets du sort et lui permet de tacler si la case est libre. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - 15 Tacle — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
  - pose un glyphe de fin de tour «Défiance» (13001, grade 2) — cibles : ennemis ; zone : croix de taille 1 ; 1 tour(s)
  - pose un glyphe-aura «Défiance» (31537, grade 2) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Lanterne du Berger» (7841, grade 1)
  - le lanceur lance le sort «Défiance» (29052, grade 5) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Défiance» (id 29052, grade 5)*
      - applique l'état «Défiance» (5268) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Défiance» (29052, grade 6) — cibles : ennemis ; zone : croix sans centre de taille 1
        - *Sous-sort «Défiance» (id 29052, grade 6)*
          - 15 Tacle — cibles : alliés (lanceur inclus) ; si la cible a l'état «Défiance» (5268) ; zone : toute la carte ; 1 tour(s) ; indésenvoûtable
      - retire l'état «Intacleur» (95) — cibles : alliés (lanceur inclus) ; si la cible est le monstre «Lanterne du Berger» (7841) ; 1 tour(s) ; indésenvoûtable
  - pose un glyphe de fin de tour «Défiance» (13001, grade 2) — cibles : ennemis ; zone : croix de taille 1 ; 1 tour(s)
    - *Sous-sort «Défiance» (id 13001, grade 2)*
      - 21 à 22 dommages Terre — cibles : ennemis ; zone : croix de taille 1
      - 21 à 22 dommages Feu — cibles : ennemis ; zone : croix de taille 1
      - 21 à 22 dommages Eau — cibles : ennemis ; zone : croix de taille 1
      - 21 à 22 dommages Air — cibles : ennemis ; zone : croix de taille 1
  - pose un glyphe-aura «Défiance» (31537, grade 2) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 1 tour(s)
    - *Sous-sort «Défiance» (id 31537, grade 2)*
      - 30% Résistance mêlée — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; 1 tour(s) ; désenvoûtement fort uniquement
  - le lanceur lance le sort «Défiance» (29052, grade 5) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Lanterne du Berger» (7841) ; si la cible vient d'apparaître (invocation posée par ce sort)
    - (sous-sort «Défiance» 29052 g5 déjà détaillé plus haut)
- **Rôle tactique** : +15 Tacle à l'allié par ennemi au contact, glyphe de fin de tour croix 1 (21–22 dans les 4 éléments aux ennemis) et aura +30 % résistance mêlée alliés. Le sort de tank au contact par excellence (relance 2).
- Tags : `tank`, `glyph`, `damage`, `protection`

#### 21B. Barrière (id 13019)

- **3 PA** · PO 0–6 (non modifiable) · LdV requise · relance 3 t., relance partagée entre lanceurs (global = -1) · CC 0 % · élément(s) : Air, Eau, Feu, Terre
- Grades : g1 niv.195 (grade utilisé : 1).
- Description du jeu : « Applique les états Pesanteur et Barrière sur la cible. Sur un ennemi : • Pose un glyphe autour de lui au début de son tour qui occasionne des dommages Terre, Feu, Eau et Air. • Augmente les résistances à distance des alliés présents ou entrant à l'intérieur de la zone. • Le glyphe n'occasionne des dommages qu'à cet ennemi s'il le traverse. • Les états et le glyphe sont retirés si l'ennemi traverse la Barrière ou s'il est achevé. Sur un allié : • Le glyphe est posé à la fin du tour du lanceur et n'occasionne des dommages qu'au premier ennemi qui le traverse. • Les états et le glyphe sont retirés si la cible ou un ennemi traverse la Barrière. Sur une case libre : invoque la Lanterne du Berger et lui applique les effets du sort. »
- Effets (infobulle, valeurs de base) :
  - le lanceur lance le sort «Invoque la Lanterne du Berger» (29072, grade 1)
  - applique l'état «Pesanteur» (7) — 1 tour(s) ; indésenvoûtable
  - applique l'état «Barrière» (717) — 1 tour(s) ; indésenvoûtable
  - pose un glyphe (effet immédiat à la pose) «Barrière» (29579, grade 1) — zone : anneau de taille 3 ; 1 tour(s) ; indésenvoûtable
  - pose un glyphe-aura «Barrière» (31538, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 1 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Lanterne du Berger» (7841, grade 1)
  - applique l'état «Pesanteur» (7) — 1 tour(s) ; indésenvoûtable
  - applique l'état «Barrière» (717) — 1 tour(s) ; indésenvoûtable
  - applique l'état «Barrière allié» (4028) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Barrière ennemi» (5375) — cibles : ennemis ; 1 tour(s) ; indésenvoûtable
  - le lanceur lance le sort «Barrière» (29575, grade 1) — cibles : ennemis
    - *Sous-sort «Barrière» (id 29575, grade 1)*
      - le lanceur lance le sort «Barrière» (29575, grade 3) — cibles : ennemis ; si la cible a l'état «Barrière ennemi» (5375) ; déclenchement : début de tour du porteur (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Barrière» (id 29575, grade 3)*
          - la cible lance le sort «Barrière» (29575, grade 5)
            - *Sous-sort «Barrière» (id 29575, grade 5)*
          - pose un glyphe (effet immédiat à la pose) «Barrière» (29579, grade 1) — zone : anneau de taille 3 ; 1 tour(s)
            - *Sous-sort «Barrière» (id 29579, grade 1)*
              - le lanceur lance le sort «Barrière» (29579, grade 2) — cibles : ennemis ; si la cible a l'état «Barrière ennemi» (5375)
              - 21 à 22 dommages Terre — cibles : ennemis ; si la cible a l'état «Barrière ennemi» (5375)
              - 21 à 22 dommages Feu — cibles : ennemis ; si la cible a l'état «Barrière ennemi» (5375)
              - 21 à 22 dommages Eau — cibles : ennemis ; si la cible a l'état «Barrière ennemi» (5375)
              - 21 à 22 dommages Air — cibles : ennemis ; si la cible a l'état «Barrière ennemi» (5375)
          - pose un glyphe-aura «Barrière» (31538, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 1 tour(s)
            - *Sous-sort «Barrière» (id 31538, grade 1)*
              - 30% Résistance distance — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
          - le lanceur lance le sort «Barrière» (29579, grade 6) — cibles : lanceur ; déclenchement : début de tour du porteur (buff 1 t.) ; indésenvoûtable
            - *Sous-sort «Barrière» (id 29579, grade 6)*
              - dissipe les glyphes «Barrière» (29575) — cibles : lanceur ; zone : toute la carte
          - le lanceur lance le sort «Barrière» (29579, grade 6) — cibles : ennemis ; déclenchement : à la mort du porteur (buff 1 t.) ; indésenvoûtable
            - (sous-sort «Barrière» 29579 g6 déjà détaillé plus haut)
  - le lanceur lance le sort «Barrière» (29575, grade 2) — cibles : lanceur ; déclenchement : fin de tour du porteur (buff 1 t.) ; indésenvoûtable
    - *Sous-sort «Barrière» (id 29575, grade 2)*
      - le lanceur lance le sort «Barrière» (29575, grade 4) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Barrière allié» (4028) ; zone : toute la carte
        - *Sous-sort «Barrière» (id 29575, grade 4)*
          - la cible lance le sort «Barrière» (29575, grade 5)
            - (sous-sort «Barrière» 29575 g5 déjà détaillé plus haut)
          - pose un glyphe (effet immédiat à la pose) «Barrière» (29579, grade 3) — zone : anneau de taille 3 ; 1 tour(s)
            - *Sous-sort «Barrière» (id 29579, grade 3)*
              - le lanceur lance le sort «Barrière» (29579, grade 4) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Barrière allié» (4028)
              - le lanceur lance le sort «Barrière» (29579, grade 4) — cibles : ennemis
                - (sous-sort «Barrière» 29579 g4 déjà détaillé plus haut)
              - 21 à 22 dommages Terre — cibles : ennemis
              - 21 à 22 dommages Feu — cibles : ennemis
              - 21 à 22 dommages Eau — cibles : ennemis
              - 21 à 22 dommages Air — cibles : ennemis
          - pose un glyphe-aura «Barrière» (31538, grade 1) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 1 tour(s)
            - (sous-sort «Barrière» 31538 g1 déjà détaillé plus haut)
          - le lanceur lance le sort «Barrière» (29579, grade 6) — cibles : lanceur ; déclenchement : début de tour du porteur (buff 1 t.) ; indésenvoûtable
            - (sous-sort «Barrière» 29579 g6 déjà détaillé plus haut)
  - applique l'état «Pesanteur» (7) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Lanterne du Berger» (7841) ; si la cible vient d'apparaître (invocation posée par ce sort) ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Barrière» (717) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Lanterne du Berger» (7841) ; si la cible vient d'apparaître (invocation posée par ce sort) ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Barrière allié» (4028) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Lanterne du Berger» (7841) ; si la cible vient d'apparaître (invocation posée par ce sort) ; 1 tour(s) ; indésenvoûtable
- **Rôle tactique** : Anneau de glyphe (rayon 3) autour de la cible : un ennemi qui le traverse prend 21–22 dans 4 éléments et l'effet s'arrête ; aura +30 % résistance distance alliés. Sur un ennemi : le maintient enfermé (il doit traverser pour sortir).
- Tags : `control`, `glyph`, `damage`, `protection`

### Paire 22 : Bouclier Féca / Mise en Garde

> Choix : Bouclier Féca est indispensable ; Mise en Garde seulement pour un Féca orienté dégâts glyphes.

#### 22A. Bouclier Féca (id 12982)

- **2 PA** · PO 0–5 (non modifiable) · LdV requise, cible requise (case occupée) · relance 3 t. · CC 0 %
- Grades : g1 niv.90 PO0-4 ; g2 niv.157 (grade utilisé : 2).
- Description du jeu : « Réduit les dommages subis par l'allié ciblé. Applique également l'Étoile du Berger sur l'allié ciblé et tous les alliés dans un glyphe élémentaire allié. »
- Effets (infobulle, valeurs de base) :
  - Dommages subis x70% — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; 2 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Dommages subis x70% — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; 2 tour(s) ; indésenvoûtable
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841)
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
  - le lanceur lance le sort «Bouclier Féca» (29580, grade 1) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Bouclier Féca» (id 29580, grade 1)*
      - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Terrestre» (5262) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1) ; 2 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Terrestre» (5262) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1)
        - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
      - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Incandescente» (5263) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1) ; 2 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Incandescente» (5263) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1)
        - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
      - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Aqueuse» (5264) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1) ; 2 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Aqueuse» (5264) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1)
        - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
      - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Venteuse» (5265) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1) ; 2 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible a l'état «Armure Venteuse» (5265) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 63 (à partir de 1)
        - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
- **Rôle tactique** : Dommages subis ×70 % pendant 2 tours sur un allié (2 PA, PO 5, relance 3) + Étoile du Berger : le cœur de la protection Féca.
- Tags : `protection`, `shield`

#### 22B. Mise en Garde (id 12997)

- **3 PA** · PO 0–0 (non modifiable) · sans LdV · relance 3 t., relance initiale 1 t. · CC 0 %
- Grades : g1 niv.200 (grade utilisé : 1).
- Description du jeu : « Augmente les caractéristiques du lanceur selon ses armures élémentaires actives, déclenche ses glyphes élémentaires sur la case ciblée et applique l'Étoile du Berger sur les alliés dans ces glyphes. Les glyphes ne peuvent être déclenchés manuellement qu'une seule fois par tour. »
- Effets (infobulle, valeurs de base) :
  - 200 Force — cibles : lanceur ; si la cible a l'état «Armure Terrestre» (5262) ; 2 tour(s) ; indésenvoûtable
  - 200 Intelligence — cibles : lanceur ; si la cible a l'état «Armure Incandescente» (5263) ; 2 tour(s) ; indésenvoûtable
  - 200 Chance — cibles : lanceur ; si la cible a l'état «Armure Aqueuse» (5264) ; 2 tour(s) ; indésenvoûtable
  - 200 Agilité — cibles : lanceur ; si la cible a l'état «Armure Venteuse» (5265) ; 2 tour(s) ; indésenvoûtable
  - déclenche les glyphes «Prairie» (12992) — cibles : tous ; si le lanceur n'a pas l'état «Prairie déclenchée» (5364)
  - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; 2 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Glyphes déclenchés» (5260) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Mise en Garde» (5373) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
  - 200 Force — cibles : lanceur ; si la cible a l'état «Armure Terrestre» (5262) ; 2 tour(s) ; indésenvoûtable
  - 200 Intelligence — cibles : lanceur ; si la cible a l'état «Armure Incandescente» (5263) ; 2 tour(s) ; indésenvoûtable
  - 200 Chance — cibles : lanceur ; si la cible a l'état «Armure Aqueuse» (5264) ; 2 tour(s) ; indésenvoûtable
  - 200 Agilité — cibles : lanceur ; si la cible a l'état «Armure Venteuse» (5265) ; 2 tour(s) ; indésenvoûtable
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
  - déclenche les glyphes «Terre Battue» (12987) — cibles : tous ; si le lanceur n'a pas l'état «Terre Battue déclenchée» (5366)
  - déclenche les glyphes «Refuge» (13021) — cibles : tous ; si le lanceur n'a pas l'état «Refuge déclenché» (5370)
  - déclenche les glyphes «Terre Brûlée» (12985) — cibles : tous ; si le lanceur n'a pas l'état «Terre Brûlée déclenchée» (5367)
  - déclenche les glyphes «Vigie» (13039) — cibles : tous ; si le lanceur n'a pas l'état «Vigie déclenchée» (5371)
  - déclenche les glyphes «Vallée» (12990) — cibles : tous ; si le lanceur n'a pas l'état «Vallée déclenchée» (5365)
  - déclenche les glyphes «Verglas» (13023) — cibles : tous ; si le lanceur n'a pas l'état «Verglas déclenché» (5369)
  - déclenche les glyphes «Prairie» (12992) — cibles : tous ; si le lanceur n'a pas l'état «Prairie déclenchée» (5364)
  - déclenche les glyphes «Pâturage» (13013) — cibles : tous ; si le lanceur n'a pas l'état «Pâturage déclenché» (5368)
  - retire l'état «Glyphes déclenchés» (5260) — cibles : lanceur
  - retire l'état «Mise en Garde» (5373) — cibles : lanceur
- **Rôle tactique** : Sort niv. 200 : +200 dans chaque caractéristique correspondant à une armure active (2 tours) et déclenche les glyphes sous le Féca. Pour un Féca multi-élément orienté dégâts.
- Tags : `buff`, `glyph_trigger`, `damage`

## Invocations de la classe

Les « invocations » Féca sont des **objets statiques** : ils ne jouent pas, n'utilisent pas d'emplacement d'invocation
et meurent automatiquement (délai indiqué). Leurs PV sont un pourcentage des PV du Féca (champ `bonusCharacteristics`,
interprétation INCERTAINE) ; ils ont 25 % de résistances aux grades 1–3.

#### Égide (monstre 5903)

- Utilise un emplacement d'invocation : non · joue son tour : non · tacle : non · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 0, PM 0, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 140}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 600], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41155, sort 13042 «Sanctuaire») :
  - la cible lance le sort «Sanctuaire» (29075, grade 1) — cibles : lanceur
    - *Sous-sort «Sanctuaire» (id 29075, grade 1)*
      - pose un glyphe-aura «Sanctuaire» (29075, grade 3) — cibles : alliés (lanceur inclus) ; durée infinie
        - *Sous-sort «Sanctuaire» (id 29075, grade 3)*
          - applique l'état «Sanctuaire» (5271) — cibles : lanceur ; 2 tour(s) ; indésenvoûtable
      - pose un glyphe-aura «Sanctuaire» (29075, grade 2) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 3 ; durée infinie
        - *Sous-sort «Sanctuaire» (id 29075, grade 2)*
          - Intercepte les dommages — cibles : alliés (hors lanceur) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865) ; zone : cercle de taille 3 ; déclenchement : quand le porteur subit des dommages (buff 2 t.) ; désenvoûtement fort uniquement
          - applique l'état «Sacrifice» (583) — cibles : alliés (hors lanceur) ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865) ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
          - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
          - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 3
            - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
  - Tue la cible — cibles : lanceur ; effet différé de 2 tour(s)
  - la cible lance le sort «Sanctuaire» (29055, grade 1) — cibles : lanceur ; déclenchement : quand le porteur perd l'état «Sanctuaire» (5271) (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Sanctuaire» (id 29055, grade 1)*
      - dissipe les glyphes «Sanctuaire» (29075) — cibles : lanceur ; zone : toute la carte
      - la cible lance le sort «Sanctuaire» (29075, grade 1) — cibles : lanceur
        - (sous-sort «Sanctuaire» 29075 g1 déjà détaillé plus haut)
  - la cible lance le sort «Sanctuaire» (13042, grade 2) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Sanctuaire» (id 13042, grade 2)*
      - retire les effets du sort «Sanctuaire» (13042) — cibles : lanceur
  - applique l'état «Étoile du Berger» (5261) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : lanceur
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)

#### Pavois (monstre 5910)

- Utilise un emplacement d'invocation : non · joue son tour : non · tacle : non · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 0, PM 0, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 90}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 1], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41163, sort 13046 «Pavois») :
  - Tue la cible — cibles : lanceur ; effet différé de 1 tour(s)
  - le lanceur lance le sort «Pavois» (13046, grade 2) — cibles : tous ; si la cible a l'état «Pavois allié» (5269) ; zone : toute la carte
    - *Sous-sort «Pavois» (id 13046, grade 2)*
      - le lanceur lance le sort «Pavois» (13046, grade 3) — déclenchement : début de tour du porteur / à la mort du porteur (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Pavois» (id 13046, grade 3)*
          - Tue la cible — cibles : lanceur
  - applique l'état «Étoile du Berger» (5261) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : lanceur
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)

#### Lanterne du Berger (monstre 7841)

- Utilise un emplacement d'invocation : non · joue son tour : non · tacle : oui · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 0, PM 0, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 30}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort passif lancé à l'apparition (spell-level 77519, sort 29070 «Repérage») :
  - la cible lance le sort «Repérage» (29070, grade 2) — cibles : alliés (hors lanceur) ; si la cible est le monstre «Lanterne du Berger» (7841) ; zone : toute la carte
    - *Sous-sort «Repérage» (id 29070, grade 2)*
      - retire les effets du sort «Repérage» (29070) — cibles : lanceur
      - Tue la cible — cibles : lanceur
  - le lanceur lance le sort «Repérage» (29076, grade 1) — cibles : lanceur
    - *Sous-sort «Repérage» (id 29076, grade 1)*
      - pose un glyphe-aura «Repérage» (29076, grade 2) — cibles : alliés (lanceur inclus) ; durée infinie
        - *Sous-sort «Repérage» (id 29076, grade 2)*
          - applique l'état «Repérage» (5274) — cibles : lanceur ; durée infinie ; indésenvoûtable
      - la cible lance le sort «Repérage» (29070, grade 5) — cibles : lanceur
        - *Sous-sort «Repérage» (id 29070, grade 5)*
          - la cible lance sur la case le sort «Repérage» (29070, grade 6) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
            - *Sous-sort «Repérage» (id 29070, grade 6)*
              - applique l'état «Étoile du Berger» (5261) — cibles : alliés (hors lanceur) ; si la cible n'est pas un joueur de classe 1 ; si la cible n'est aucun de: «Barricade» (7864), «Bastion» (7865), «Égide» (5903), «Pavois» (5910), «Lanterne du Berger» (7841) ; zone : cercle de taille 2 (à partir de 1) ; 1 tour(s) ; indésenvoûtable
          - Dévoile les entités invisibles — cibles : ennemis ; zone : cercle de taille 2
  - le lanceur lance le sort «Repérage» (29071, grade 1) — cibles : lanceur ; déclenchement : quand le porteur perd l'état «Repérage» (5274) (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Repérage» (id 29071, grade 1)*
      - dissipe les glyphes «Repérage» (29076) — cibles : lanceur ; zone : toute la carte
      - la cible lance le sort «Repérage» (29076, grade 1) — cibles : lanceur
        - (sous-sort «Repérage» 29076 g1 déjà détaillé plus haut)
  - la cible lance le sort «Repérage» (29070, grade 3) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Repérage» (id 29070, grade 3)*
      - retire les effets du sort «Repérage» (29070) — cibles : lanceur
  - le lanceur lance le sort «Repérage» (29070, grade 4) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
    - *Sous-sort «Repérage» (id 29070, grade 4)*
      - la cible lance sur le lanceur le sort «Repérage» (29070, grade 5) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; déclenchement : début de tour du porteur (buff 63 t.) ; indésenvoûtable
        - (sous-sort «Repérage» 29070 g5 déjà détaillé plus haut)
  - applique l'état «Étoile du Berger» (5261) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : lanceur
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)
  - applique l'état «Intacleur» (95) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement

#### Barricade (monstre 7864)

- Utilise un emplacement d'invocation : non · joue son tour : non · tacle : non · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 0, PM 0, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 30}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 1], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 78075, sort 29300 «Barricade») :
  - applique l'état «Invulnérable en Mêlée» (376) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - la cible lance le sort «Barricade» (29301, grade 1) — cibles : lanceur
    - *Sous-sort «Barricade» (id 29301, grade 1)*
      - pose un glyphe-aura «Barricade» (29301, grade 3) — cibles : alliés (lanceur inclus) ; durée infinie
        - *Sous-sort «Barricade» (id 29301, grade 3)*
          - applique l'état «Barricade» (5266) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - pose un glyphe-aura «Barricade» (29301, grade 2) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; durée infinie
        - *Sous-sort «Barricade» (id 29301, grade 2)*
          - applique l'état «Invulnérable en Mêlée» (376) — cibles : alliés (hors lanceur) ; zone : croix de taille 1 ; 1 tour(s) ; désenvoûtement fort uniquement
  - Tue la cible — cibles : lanceur ; effet différé de 1 tour(s)
  - la cible lance le sort «Barricade» (29304, grade 1) — cibles : lanceur ; déclenchement : quand le porteur perd l'état «Barricade» (5266) (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Barricade» (id 29304, grade 1)*
      - dissipe les glyphes «Barricade» (29301) — cibles : lanceur ; zone : toute la carte
      - la cible lance le sort «Barricade» (29301, grade 1) — cibles : lanceur
        - (sous-sort «Barricade» 29301 g1 déjà détaillé plus haut)
  - la cible lance le sort «Barricade» (29300, grade 2) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Barricade» (id 29300, grade 2)*
      - retire les effets du sort «Barricade» (29300) — cibles : lanceur
  - applique l'état «Étoile du Berger» (5261) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : lanceur
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)

#### Bastion (monstre 7865)

- Utilise un emplacement d'invocation : non · joue son tour : non · tacle : non · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 0, PM 0, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 30}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 1], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 78080, sort 29302 «Bastion») :
  - applique l'état «Invulnérable à Distance» (375) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - la cible lance le sort «Bastion» (29303, grade 1) — cibles : lanceur
    - *Sous-sort «Bastion» (id 29303, grade 1)*
      - pose un glyphe-aura «Bastion» (29303, grade 3) — cibles : alliés (lanceur inclus) ; durée infinie
        - *Sous-sort «Bastion» (id 29303, grade 3)*
          - applique l'état «Bastion» (5267) — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - pose un glyphe-aura «Bastion» (29303, grade 2) — cibles : alliés (lanceur inclus) ; zone : croix de taille 1 ; durée infinie
        - *Sous-sort «Bastion» (id 29303, grade 2)*
          - applique l'état «Invulnérable à Distance» (375) — cibles : alliés (hors lanceur) ; zone : croix de taille 1 ; 1 tour(s) ; désenvoûtement fort uniquement
  - Tue la cible — cibles : lanceur ; effet différé de 1 tour(s)
  - la cible lance le sort «Bastion» (29305, grade 1) — cibles : lanceur ; déclenchement : quand le porteur perd l'état «Bastion» (5267) (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Bastion» (id 29305, grade 1)*
      - dissipe les glyphes «Bastion» (29303) — cibles : lanceur ; zone : toute la carte
      - la cible lance le sort «Bastion» (29303, grade 1) — cibles : lanceur
        - (sous-sort «Bastion» 29303 g1 déjà détaillé plus haut)
  - la cible lance le sort «Bastion» (29302, grade 2) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 63 t.) ; indésenvoûtable
    - *Sous-sort «Bastion» (id 29302, grade 2)*
      - retire les effets du sort «Bastion» (29302) — cibles : lanceur
  - applique l'état «Étoile du Berger» (5261) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - le lanceur lance le sort «Étoile du Berger» (29056, grade 1) — cibles : lanceur
    - (sous-sort «Étoile du Berger» 29056 g1 déjà détaillé plus haut)

## Le Féca en groupe PvM (niveau 200, 4 personnages)

### Rôles possibles
1. **Protecteur / tank principal** (rôle naturel) : Bouclier Féca + Rempart/Fortification + Barricade/Bastion/Égide,
   se place au contact et garde les monstres grâce à Défiance (tacle) et Bergerie (Pesanteur + Inébranlable).
2. **Entraveur de zone** : glyphes de base Terre Battue (−3 PA esquivables), Terre Brûlée (−3 PM esquivables), Vallée (−6 PO), Prairie (−20 %
   dommages finaux) posés sur le paquet d'ennemis + Somnolence/Tétanie (−PA), Atonie/Léthargie (−PM), Bulle/Stratus (−PO).
3. **Dégâts multi-éléments modérés** : jeu en glyphes (dégâts en début de tour des ennemis + déclenchement manuel) avec
   Mise en Garde (+200 stats) ; dégâts inférieurs à un vrai DPS mais réguliers et en zone.

### Voie / élément conseillé
- **Terre/Eau ou Terre/Feu (Force + Chance/Intelligence)** pour cumuler Terre Battue (−3 PA) et Vallée/Terre Brûlée.
- **Multi (4 éléments, « Féca glyphes »)** pour Mise en Garde et Défiance/Barrière (dommages dans les 4 éléments).
- Stats prioritaires : PV/Vitalité, résistances %, Puissance + Dommages, Puissance glyphes si disponible, Retrait PA/PM
  (Somnolence/Atonie sont esquivables), Tacle, PA 11–12 / PM 5–6, Sagesse inutile.

### Choix de variantes par rôle (A = 1re variante, B = 2e)
| Paire | Protecteur/tank | Entraveur de zone | Dégâts glyphes |
|---|---|---|---|
| 1 Retour du Bâton / Tétanie | B (−3 PA mêlée) | B | A |
| 2 Langueur / Atonie | B (−3 PM zone) | B | B |
| 3 Nimbus / Stratus | A | B (−3 PO zone) | A |
| 4 Typhon / Bourrasque | A (−20 dommages) | B (placement) | B |
| 5 Rempart / Fortification | A (zone) | A | A |
| 6 Barricade / Pavois | A | B (enfermement) | A |
| 7 Somnolence / Manœuvre | A (−2 PA zone) | A | B |
| 8 Léthargie / Regroupement | B (regroupe) | B | B |
| 9 Bastion / Trêve | A (ou B contre un burst) | A | A |
| 10 Frisson / Giboulée | A | A | A |
| 11 Bulle / Sonnailles | A (−3 PO 2 PA) | B (regroupe) | B |
| 12 Transhumance / Égide | B (interception) | A | A |
| 13 Prairie / Pâturage | A (−20 % DF ennemis) | A | A |
| 14 Vallée / Verglas | A (−6 PO) | A | A |
| 15 Terre Battue / Refuge | A (−3 PA) ou B (×85 %) | A | A |
| 16 Terre Brûlée / Vigie | A (−3 PM) | A | A |
| 17 Renfort / Ataraxie | B (anti-burst) | A | A |
| 18 Silbo / Houlette | B (attire) | A | B |
| 19 Torpeur / Escapade | A | A | A |
| 20 Bergerie / Excursion | A | A | B |
| 21 Défiance / Barrière | A (tacle) | B | A |
| 22 Bouclier Féca / Mise en Garde | A (indispensable) | A | B |

### Rotations types (12 PA / 6 PM)
- **Tour 1 (ouverture protecteur)** : Bouclier Féca sur l'allié le plus exposé (2) → Rempart (2, groupe dans le cercle 3)
  → Terre Battue sur le paquet d'ennemis (3, −3 PA aura, Lanterne) → Somnolence (3) → Bulle (2). Total 12.
- **Tour 2 (contrôle)** : Prairie ou Terre Brûlée (3) sur les ennemis restants → Regroupement/Sonnailles (4) pour ramener
  les ennemis dans le glyphe → Barricade ou Bastion sur l'allié visé (2) → Bulle ×1 (2) + 1 PA libre.
- **Tour 3 (dégâts glyphes)** : Mise en Garde (3, déclenche les glyphes sous le Féca, +200 stats selon armures) →
  Transhumance indisponible si Pesanteur ; sinon Transhumance (3) sur un autre glyphe → Somnolence (3) + Bulle (2) + 1.
- **Anti-burst boss** : Ataraxie (2) sur la cible du boss (−75 % sur le prochain coup) + Bouclier Féca (2) + Fortification (2)
  + Barricade/Bastion selon le type d'attaque (2) + Trêve si le boss frappe en zone autour du Féca (3).

### Forces / faiblesses
Forces : réduction de dommages inégalée (×0,7 × armures × −20 % DF ennemis), entrave de zone persistante par auras,
invulnérabilités ciblées, boucliers bloquant les lignes de vue, placement riche, aucune dépendance aux invocations.
Faiblesses : dégâts plus faibles qu'un DPS dédié, un seul glyphe élémentaire par tour, glyphes inutiles si les ennemis
sortent de la zone (immunité au déplacement, forte mobilité), beaucoup de relances (3–5 tours), Pesanteur bloque ses
propres téléportations.

### Synergies
- **Sram / Crâ / Iop / Ouginak (DPS)** : protégés par Bouclier Féca + armure ; les ennemis −3 PA / −3 PM dans les glyphes
  ne peuvent plus atteindre les DPS à distance.
- **Enutrof** : retrait PM cumulé (Terre Brûlée −3 PM aura + Maladresse/Pelle Aurifère) ⇒ ennemis bloqués ; Orpaillage /
  Monnaie Sonnante de l'Enutrof se déclenchent sur les **tentatives** de retrait PM/PA (déclencheurs `MPA`/`APA`) : les
  retraits esquivables du Féca (Somnolence, Atonie, auras Terre Battue/Terre Brûlée) devraient donc les déclencher aussi
  (INCERTAIN : à vérifier en jeu).
- **Pandawa / Sacrieur / Osamodas (placement)** : regroupent les ennemis dans les glyphes ; Transhumance profite des
  alliés placés dans les glyphes (Étoile du Berger).
- **Eniripsa / Osamodas (soin)** : le soin est plus efficace quand les dégâts subis sont réduits de 30–50 %.
- **Sacrieur** : attention, les réductions de dommages du Féca réduisent aussi la « douleur » utile au Sacrieur (choix de
  ne pas buffer le Sacrieur).

## Points incertains (INCERTAIN)

- PV des boucliers/Lanterne : bonusCharacteristics.lifePoints interprété comme % des PV du Féca (30/90/140 %).
- Sémantique de characRatios des invocations (ratios par caractéristique) non documentée.
- globalCooldown = -1 interprété comme relance partagée entre lanceurs de la même équipe.
- Armure élémentaire : 15 % dans les données 2026 contre 25 % annoncés à la refonte 2.71 (on retient 15 %).
- Ordre exact d'application armure fixe / résistances / multiplicateurs : à valider avec le module DoMath.
- Retraits d'aura esquivables (1079/1080) : moment du jet d'esquive (entrée dans l'aura / chaque début de tour) et déclenchement des états Enutrof APA/MPA.

## Sources
- Données de jeu : https://api.dofusdb.fr/breeds/1, https://api.dofusdb.fr/spell-variants?breedId=1, `/spells`,
  `/spell-levels`, `/spell-states`, `/monsters` (consultées le 2026-10-04 ; données datées du 2026-06-23).
- Noms des actions (ActionId) Dofus 3 : https://github.com/PyDofus/pydofus3 (`ActionId.py`) ; Dofus 2 :
  https://github.com/Souchy/DofusDB (`code/ActionIds.ts`).
- Formule de l'armure fixe (effet 265) et masques/déclencheurs : client Dofus 2 décompilé (`DamageUtil.as`, dépôt
  https://github.com/Romain-P/d2gen) et code DoMath/Bubble (`HaxeFighter.GetDamageReductor`, `SpellManager`, `HaxeBuff`)
  mis en cache dans `.cache/domath/` ; https://domath.fr.
- Refonte Féca 2.71 (contexte, armure annoncée à 25 %) : https://guidactik.com/dofus/refonte-du-feca-avec-dofus-2-71-le-resume/
- Guide Féca : https://www.next-stage.fr/?p=224295 , https://www.breakflip.com/guide/dofus/dofus-feca-guide-et-stuff-nos-builds-du-niveau-1-au-niveau-200-822

