# Iop (classe 8) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/8`, `/spell-variants?breedId=8`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 (enregistrements mis à jour jusqu'au 2026-06-23), extraits le 2026-10-04 ; les données
> `data/dofusdb/class-spells.json` du dépôt ont été vérifiées identiques à l'API live (91 niveaux de sorts, 0 écart).
> Toutes les valeurs sont celles du **grade le plus élevé utilisable au niveau 200**. Les guides web ne servent qu'à
> l'interprétation ; en cas de désaccord, les données du jeu priment. Fichier machine associé :
> [`data/research/class-mechanics/iop.json`](../../../data/research/class-mechanics/iop.json). Dump brut décodé (tous
> sous-sorts développés) : `.cache/classes/b5_8/dump/breed_8.txt` (non versionné).

**Identité** : « Guerrier téméraire » (complexité 1). Rôles officiels DofusDB (`breeds/8.roles`, /12) : **Dégâts 12**
(« importants dommages sur une cible ou en zone »), **Amélioration 8** (« augmente les dommages, PA, PM et PV »),
**Placement 6** (« bondit vers une cible, la repousse ou l'attire »), Tank 3, Protection 3, Entrave 2, Invocation 1, Soin 0.

**Résumé tactique** : l'Iop est le DPS de mêlée/moyenne portée de référence. Il frappe dans les **4 éléments**
(Terre : Pression, Accumulation, Concentration, Pugilat, Épée de Iop, Fureur, Colère de Iop ; Feu : Couperet, Sentence,
Rassemblement, Épée Destructrice, Tempête de Puissance, Épée du Destin, Tumulte ; Air : Fracture, Épée Divine, Anneau
Destructeur, Souffle, Tannée, Épée Céleste, Zénith ; Eau : Ferveur, Menace, Épée du Jugement, Déferlement, Fustigation,
Endurance, Fendoir) et possède les **meilleurs buffs offensifs du jeu** pour le groupe : *Puissance* (+300 Puissance,
+120 Dommages Poussée, 3 tours, sur n'importe quelle cible), *Épée Divine* (+30 Dommages en croix de 3), *Précipitation*
(+5 PA à un allié), *Agitation* (+3 PM, Intaclable, +20 Puissance par PM utilisé), *Vitalité* (+10 % PV à un allié),
*Vertu* (bouclier 500 % du niveau en croix). Ses sorts « à rampe » (Fureur, Colère de Iop, Épée du Destin, Tempête de
Puissance, Pugilat, Accumulation, Tumulte) demandent une **planification sur plusieurs tours** — c'est le cœur de l'IA Iop.
Il apporte aussi de l'**érosion** (Pression, Fracture, Épée Destructrice, Fustigation, Vindicte 20 %), un **amplificateur de
dégâts subis** (Bond ×115 % autour du point d'atterrissage, Massacre ×115 % + renvoi 30 %), du **retrait PM de zone**
(Couperet / Tannée −3 PM esquivables) et du **contrôle** (Emprise : ennemi invulnérable et immobilisé ; Duel ; Friction ;
Coup pour Coup ; Rassemblement qui regroupe un paquet).

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · États importants · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Pression (13106, niv. 1) | 3 | Fracture (13139, niv. 95) | 4 | Pression (Terre, érosion, 4/tour) pour un Iop Terre ; Fracture (Air, ligne sans LdV) pour l'Air. |
| 2 | Ferveur (14676, niv. 1) | 2 | Menace (13130, niv. 100) | 3 | Ferveur (bouclier + Eau en croix, 2 PA) ou Menace (attire 2 + Eau). |
| 3 | Couperet (13115, niv. 1) | 3 | Accumulation (13138, niv. 105) | 3 | Couperet (Feu, ligne 4, −3 PM) ou Accumulation (Terre, rampe 3 tours). |
| 4 | Épée Divine (13110, niv. 1) | 3 | Épée du Jugement (13117, niv. 110) | 4 | Épée Divine (Air, croix 3, +30 Dommages au groupe) quasi systématique ; Épée du Jugement (Eau, bouclier, différé). |
| 5 | Intimidation (13108, niv. 5) | 2 | Conquête (13148, niv. 115) | 3 | Intimidation (poussée 3, meilleur élément) ; Conquête (Stratège Iop renvoyant les dégâts). |
| 6 | Bond (13107, niv. 10) | 4 | Agitation (13143, niv. 120) | 2 | Bond (téléportation + ×115 % dégâts subis autour) ; Agitation (+3 PM, Intaclable à un allié). |
| 7 | Concentration (13123, niv. 15) | 2 | Sentence (13147, niv. 125) | 2 | Concentration (Terre mêlée, +50 % sur invocations) ; Sentence (Feu, explosion de fin de tour). |
| 8 | Déferlement (13126, niv. 20) | 4 | Anneau Destructeur (13135, niv. 130) | 3 | Déferlement (rapprochement + Eau) ; Anneau Destructeur (anneau 3 Air + attire 1). |
| 9 | Vitalité (13120, niv. 25) | 3 | Violence (13137, niv. 135) | 3 | Vitalité (+20 %/+10 % Vitalité) ; Violence (repousse 4 autour de soi). |
| 10 | Souffle (13116, niv. 30) | 2 | Rassemblement (13136, niv. 140) | 3 | Souffle (Air, repousse en croix) ; Rassemblement (Feu, regroupe une croix de 3). |
| 11 | Épée Destructrice (13119, niv. 35) | 4 | Fustigation (14818, niv. 145) | 3 | Épée Destructrice (Feu, barre 3, érosion) ; Fustigation (Eau, demi-cercle, érosion). |
| 12 | Puissance (13118, niv. 40) | 3 | Vindicte (14677, niv. 150) | 2 | Puissance (+300 Puissance, +120 Dommages Poussée, 3 tours) indispensable ; Vindicte (+20 % érosion). |
| 13 | Tempête de Puissance (13121, niv. 45) | 3 | Tannée (13131, niv. 155) | 3 | Tempête de Puissance (Feu, marquage I/II) ; Tannée (Air, barre 5, −3 PM). |
| 14 | Endurance (13133, niv. 50) | 3 | Pugilat (13146, niv. 160) | 2 | Endurance (Eau + bouclier 150) ; Pugilat (Terre, cercle 2, +18 par lancer). |
| 15 | Vertu (13142, niv. 55) | 3 | Massacre (13112, niv. 165) | 2 | Vertu (bouclier 1000 aux alliés au contact) ; Massacre (×115 % + renvoi 30 % en anneau). |
| 16 | Épée de Iop (13125, niv. 60) | 4 | Fendoir (13134, niv. 170) | 5 | Épée de Iop (Terre, croix 3, 8 PO) ; Fendoir (Eau, croix 1, bouclier par ennemi). |
| 17 | Friction (13113, niv. 65) | 2 | Coup pour Coup (13140, niv. 175) | 2 | Friction (attraction réactive) ; Coup pour Coup (poussée réactive). |
| 18 | Épée Céleste (13122, niv. 70) | 4 | Zénith (13145, niv. 180) | 5 | Épée Céleste (Air, cercle 2) ; Zénith (Air, ligne 4, bonus selon PM restants). |
| 19 | Précipitation (13114, niv. 75) | 2 | Détermination (13132, niv. 185) | 2 | Précipitation (+5 PA puis −3 PA) ; Détermination (Indéplaçable + bouclier 600). |
| 20 | Épée du Destin (13111, niv. 80) | 4 | Tumulte (13144, niv. 190) | 4 | Épée du Destin (Feu, +40 au retour de relance) ; Tumulte (Feu, +20 par ennemi en croix). |
| 21 | Emprise (13141, niv. 85) | 3 | Duel (13109, niv. 195) | 4 | Emprise (ennemi invulnérable et immobilisé 1 tour) ; Duel. |
| 22 | Fureur (13156, niv. 90) | 3 | Colère de Iop (13124, niv. 200) | 7 | Fureur (Terre, rampe 20/40) ou Colère de Iop (Terre, 81–100 puis 191–210 au retour). |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne du jet de base (hors critique) ; « /PA » = moyenne ÷ coût. Les bonus conditionnels (rampes, Téléfrag, cartes…) sont indiqués en remarque. Un sort de zone touche potentiellement plusieurs cibles.

| Sort | Paire | PA | Élément | Base | CC | Moy. | Moy./PA | Zone | Lancers/tour | Remarque |
|---|---|---|---|---|---|---|---|---|---|---|
| Colère de Iop | 22B | 7 | Terre | 81–100 | 107–130 | 90.5 | 12.9 | cible | 1 (relance 3) | +110 au retour de relance |
| Concentration | 7A | 2 | Terre | 20–24 | 25–30 | 22.0 | 11.0 | cible | 4 | 30–34 sur invocations |
| Endurance | 14A | 3 | Eau | 30–34 | 36–41 | 32.0 | 10.7 | cible | 3 | bouclier 150 au lanceur |
| Couperet | 3A | 3 | Feu | 28–32 | 34–38 | 30.0 | 10.0 | ligne de 4 cases (impact + 3 derrière) | 2 | −3 PM |
| Déferlement | 8A | 4 | Eau | 38–42 | 46–50 | 40.0 | 10.0 | cible | 3 | avance 5 cases |
| Fendoir | 16B | 5 | Eau | 47–53 | 56–64 | 50.0 | 10.0 | croix de 1 | 2 | bouclier 150 par ennemi |
| Épée du Destin | 20A | 4 | Feu | 38–42 | 46–50 | 40.0 | 10.0 | cible | 1 (relance 2) | +40 au retour de relance |
| Fureur | 22A | 3 | Terre | 28–32 | 34–38 | 30.0 | 10.0 | cible | 1 | rampe +20/+40 |
| Fustigation | 11B | 3 | Eau | 28–31 | 34–37 | 29.5 | 9.8 | demi-cercle de 1 | 2 | +10 % érosion |
| Épée de Iop | 16A | 4 | Terre | 37–41 | 44–49 | 39.0 | 9.8 | croix de 3 | 2 |  |
| Tempête de Puissance | 13A | 3 | Feu | 27–30 | 32–35 | 28.5 | 9.5 | cible | 3 | + dégâts sur l'ancien marqué |
| Tannée | 13B | 3 | Air | 27–30 | 32–36 | 28.5 | 9.5 | barre perpendiculaire de 5 cases | 2 | −3 PM |
| Épée Céleste | 18A | 4 | Air | 36–40 | 43–48 | 38.0 | 9.5 | cercle de rayon 2 | 2 |  |
| Pression | 1A | 3 | Terre | 26–30 | 31–36 | 28.0 | 9.3 | cible | 4 | +10 % érosion |
| Menace | 2B | 3 | Eau | 26–28 | 31–34 | 27.0 | 9.0 | cible | 3 | attire 2 |
| Ferveur | 2A | 2 | Eau | 16–19 | 20–23 | 17.5 | 8.8 | croix de 1 | 2 | bouclier 100 alliés |
| Épée Divine | 4A | 3 | Air | 24–28 | 29–34 | 26.0 | 8.7 | croix de 3 | 2 | +30 Dommages aux alliés |
| Anneau Destructeur | 8B | 3 | Air | 24–28 | 29–34 | 26.0 | 8.7 | anneau de rayon exactement 3 | 2 |  |
| Fracture | 1B | 4 | Air | 32–36 | 38–43 | 34.0 | 8.5 | ligne depuis le lanceur jusqu'à la case ciblée (incluse), non dégressive | 2 | +13 % érosion |
| Épée Destructrice | 11A | 4 | Feu | 32–36 | 38–43 | 34.0 | 8.5 | barre perpendiculaire de 3 cases | 2 | +13 % érosion |
| Épée du Jugement | 4B | 4 | Eau | 31–35 | 37–42 | 33.0 | 8.2 | cible | 1 | + 48–52 différé |
| Accumulation | 3B | 3 | Terre | 22–26 | 26–31 | 24.0 | 8.0 | cible | 3 | +24 si lancé sur soi |
| Rassemblement | 10B | 3 | Feu | 22–25 | 26–30 | 23.5 | 7.8 | croix de 3 | 1 |  |
| Sentence | 7B | 2 | Feu | 13–16 | 17–20 | 14.5 | 7.2 | cible | 3 | + 26–30 en fin de tour (anneau 2) |
| Souffle | 10A | 2 | Air | 13–15 | 16–18 | 14.0 | 7.0 | croix de 1 sans le centre | 1 |  |
| Zénith | 18B | 5 | Air | 27–29 | 31–35 | 28.0 | 5.6 | ligne de 4 cases (impact + 3 derrière) | 1 | + 52–58 × PM restants/PM max |
| Pugilat | 14B | 2 | Terre | 9–11 | 12–14 | 10.0 | 5.0 | cercle de rayon 2 | 4 | +18 par lancer dans le tour |
| Tumulte | 20B | 4 | Feu | 19–21 | 23–25 | 20.0 | 5.0 | croix de 1 | 1 | +20 par ennemi en croix |
| Intimidation | 5A | 2 | meilleur élt. | 8–10 | 11–13 | 9.0 | 4.5 | cible | 3 |  |

## Mécaniques spécifiques à implémenter

### 1. Modificateurs de dégâts de base (effet 293) et sorts à rampe

Une grande partie du kit Iop augmente ses propres dégâts de base : Fureur (+20 puis +40 si relancé chaque tour, décrémente sinon), Colère de Iop (+110 au retour de relance, soit 3 tours plus tard, pendant 1 tour), Épée du Destin (+40 au retour de relance, 2 tours plus tard), Pugilat (+18 par lancer pour le tour), Accumulation (+24 pendant 3 tours, lancée SUR SOI), Tumulte (+20 par ennemi dans la croix, effet consommé au lancer).

*Implémentation :* Buff `spellBaseDamageBonus[spellId]` porté par le lanceur, ajouté aux jets min ET max avant Puissance/caractéristiques (cf. formulas.md). Respecter `maxStack` du sort, `duration`, `delay` (les bonus « à la récupération » sont des 293 avec delay=relance et duration=1) et `dispellable=3` (non retirés par un désenvoûtement normal). Pugilat/Tumulte : bonus retirés par un 406 (fin de tour / après lancer).

### 2. Fureur : machine à états Fureur I / Fureur II

Chaque lancer de Fureur (1/tour, 3 PA, mêlée) exécute le sous-sort 28604 sur le lanceur : sans état → pose « Fureur I » (#609) + bonus +20 (2 tours) ; avec Fureur I → « Fureur II » (#5192) + bonus +40 ; avec Fureur II → reste en Fureur II (+40). Un déclencheur différé (fin du tour suivant) fait redescendre d'un cran si le sort n'est pas relancé (II→I→rien).

*Implémentation :* Implémenter via les sous-sorts (g3 = pose I, g4 = pose II, g2 = décrément au TE avec delay 1). Effet net : dégâts de base 28–32 au 1er tour, 48–52 au 2e, 68–72 dès le 3e tour consécutif (CC 34–38 / 54–58 / 74–78). L'IA doit relancer Fureur CHAQUE tour (contact requis : PO 1, case occupée, LdV).

### 3. Tempête de Puissance : marquage I/II et dommages sur l'« ennemi initial »

Tempête de Puissance (3 PA, 3/tour, 2/cible) marque la cible (état « Tempête de Puissance I » #590 puis « II » #591 si relancée sur la même cible). Lancée sur une AUTRE cible, elle inflige aussi ses dégâts à l'ennemi marqué ailleurs sur la carte : 27–30 Feu s'il est en I, 38–42 Feu s'il est en II, puis retire les marques des autres ennemis.

*Implémentation :* Les cibles de tous les effets sont calculées AVANT exécution (règle commune du moteur) : les dégâts sur `A,E590`/`A,E591` en zone C63 (toute la carte sauf l'impact) touchent l'ancien marqué avant que le 406 ne le nettoie. Rotation optimale/tour : A, A, B (= 3 lancers) → A prend 2×27–30 puis 38–42 au 3e lancer, B 27–30 et devient marqué I. États infinis (dispellable 2).

### 4. Bonus « à la récupération » (Colère de Iop, Épée du Destin)

Colère de Iop (7 PA, mêlée, relance 3) : 81–100 Terre (CC 107–130) puis +110 dégâts de base pendant 1 tour, 3 tours plus tard (= dès qu'elle est relançable) → 191–210 Terre. Épée du Destin (4 PA, relance 2) : 38–42 Feu puis +40 au retour (78–82).

*Implémentation :* Buff 293 avec delay = relance et duration 1 (dispellable 3). L'IA doit planifier la réutilisation exactement au tour où le bonus est actif (sinon il est perdu) ; garder 7 PA et le contact au tour T+3.

### 5. Érosion (effet 776)

Pression +10 %, Fracture +13 %, Épée Destructrice +13 %, Fustigation +10 % (cumul 2 chacun, 2 tours), Vindicte +20 % (cumul 1). Augmente la part des dégâts reçus convertie en PV max perdus (non soignables).

*Implémentation :* Stat temporaire `erosionPercent` additionnée à l'érosion de base 10 % ; PV max érodés = floor(dégâts × min(érosion, 50 %) ). Utile contre les boss qui se soignent et dans les combats longs.

### 6. Amplificateurs de dégâts subis (1163) et renvoi (1223)

Bond : ennemis adjacents (croix 1 sans centre) à la case d'atterrissage → dommages subis ×115 % jusqu'au prochain tour de l'Iop. Massacre : ennemi ciblé ×115 % pendant 2 tours + à chaque dommage subi, 30 % des dommages finaux sont infligés aux ennemis de la cible (ses alliés) dans un anneau 1–2 autour d'elle. Conquête (Stratège Iop) : invocation-paratonnerre (voir invocations).

*Implémentation :* 1163 = buff déclenché sur la cible (trigger D) multipliant chaque dommage reçu pendant `effectTriggerDuration` tours. 1223 = éclaboussure non boostable de X % des dommages finaux, dans l'élément du coup, sans dégressivité, ne déclenchant pas d'autres renvois.

### 7. Contrôle : Emprise, Duel, Friction, Coup pour Coup, Rassemblement

Emprise (3 PA, mêlée, relance 4, globalCooldown −1) : l'ennemi devient Invulnérable (#269) et perd 100 PM (non esquivables) pendant 1 tour → neutralise une menace sans la tuer. Duel : l'Iop et l'ennemi au contact deviennent Invulnérables à distance (#375), Pesanteur (#7), −100 PM. Friction/Coup pour Coup : états réactifs qui attirent/repoussent sur attaque. Rassemblement : attire tout ce qui est dans une croix de 3 vers le centre (1, 2 ou 3 cases selon la distance) = regroupement parfait pour les zones alliées.

*Implémentation :* Invulnérable = dommages annulés (y compris des alliés). `globalCooldown = -1` (Emprise, Massacre, Duel) : selon docs/research/mechanics.md §4.4, −1 ou 0 = aucune relance globale (INCERTAIN : le document Féca l'interprète comme une relance partagée entre lanceurs de l'équipe).

### 8. Déplacements du lanceur

Bond (téléportation 1–5 PO sans LdV, case libre, interdit en Pesanteur), Déferlement (avance de 5 cases vers la cible en ligne), Menace/Anneau/Rassemblement/Friction (attirances), Intimidation/Souffle/Violence/Coup pour Coup (poussées).

*Implémentation :* 1042 « Avance de N cases » = le lanceur glisse vers la cible jusqu'au contact (stoppé par obstacle/entité, sans tacle). Bond déclenche pièges/glyphes de la case d'arrivée.

### 9. Buffs de groupe

Puissance (+300 Puissance, +120 Dommages Poussée, 3 tours, relance 4, sur n'importe quelle entité), Épée Divine (+30 Dommages 4 tours aux alliés en croix 3), Précipitation (+5 PA 1 tour puis −3 PA non esquivables le tour suivant, relance 2), Agitation (+3 PM, Intaclable, +20 Puissance par PM utilisé, relance 2), Vitalité (+20 % Vitalité sur soi / +10 % sur un allié, 4 tours), Détermination (Indéplaçable + bouclier 600, 1 tour), Vertu (bouclier 1000 aux alliés en croix 1 autour de l'Iop, mais −50 Puissance par allié au contact).

*Implémentation :* Précipitation : l'état « Affaibli » (#42, flag preventsFight dans les données, sens exact INCERTAIN) n'est pas posé sur le lanceur ; le malus −3 PA est un 168 (non esquivable) avec delay 1. Le gain net sur 2 tours est +2 PA mais le timing compte (burst immédiat).

### Rampes de dégâts de base (effet 293) — valeurs de base par lancer

| Sort | Lancer 1 | Lancer 2 | Lancer 3+ | Condition |
|---|---|---|---|---|
| Fureur (22A) | 28–32 | 48–52 (tour suivant) | 68–72 (tours suivants) | relancer chaque tour (1/tour), sinon −1 palier |
| Colère de Iop (22B) | 81–100 | — | 191–210 au tour T+3 | relancer exactement au retour de relance |
| Épée du Destin (20A) | 38–42 | 78–82 au tour T+2 | — | relancer au retour de relance |
| Accumulation (3B) | 22–26 | 46–50 après lancer sur soi (3 tours) | — | lancer d'abord sur soi |
| Pugilat (14B) | 9–11 | 27–29 | 45–47 puis 63–65 | même tour, cibles différentes (1/cible, 4/tour) |
| Tumulte (20B) | 19–21 + 20 × ennemis en croix 1 | — | — | ennemis dans la croix au lancer |
| Tempête de Puissance (13A) | 27–30 | ancien marqué : 27–30 (I) / 38–42 (II) | — | marquage I/II |

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende des cibles : « alliés compris » = le sort affecte aussi un allié ciblé/dans la zone (masque `a`) ; « hors lanceur » = masque `g`. Les lignes « Infobulle décodée » sont générées automatiquement à partir des effets VISIBLES de l'infobulle (CC entre parenthèses) : elles incluent des effets d'affichage (`forClientOnly`) dont les cibles/zones peuvent être plus larges que les effets réellement exécutés. Pour le moteur, la référence est la liste « Effets » ci-dessus et le champ `effects` du JSON (effets réellement exécutés, sous-sorts compris dans le dump).

### Paire 1 : Pression / Fracture

*Pression (Terre, érosion, 4/tour) pour un Iop Terre ; Fracture (Air, ligne sans LdV) pour l'Air.*

#### 1A. Pression (id 13106, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–4 (fixe), LdV · 4/tour · 2/cible · cumul 2 · CC 10 %
- **Description officielle** : Érode la cible et occasionne des dommages Terre.
- **Effets** :
  - 10 % d'Érosion sur la cible pendant 2 tours (cumulable 2 fois → 20 %).
  - 26 à 30 dommages Terre (CC 31 à 36) à la cible — touche aussi un allié ciblé (masque a,A).
- **Rôle tactique** : Sort Terre de base très rentable (3 PA, 4/tour, 2/cible, 1–4 PO non modifiable) ; l'érosion cumulée prépare les combats longs.
- **Tags** : `damage`, `earth`, `erosion`, `filler`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–4, 4/tour, 16–18 Terre ; g2 (niv. 66) : 3 PA, PO 1–4, 4/tour, 20–23 Terre ; g3 (niv. 132) : 3 PA, PO 1–4, 4/tour, 26–30 Terre
- *Infobulle décodée (auto)* :
  - 10% Érosion — cibles : alliés (lanceur compris), ennemis ; 2 tour(s)
  - 26 à 30 dommages Terre (CC : 31 à 36 dommages Terre) — cibles : alliés (lanceur compris), ennemis

#### 1B. Fracture (id 13139, niveau de déblocage 95)

- **Caractéristiques** : **4 PA** · PO 1–4 (fixe), en ligne, sans LdV · 2/tour · cumul 2 · CC 15 %
- **Description officielle** : Érode les cibles et occasionne des dommages Air en zone.
- **Effets** :
  - Zone : toutes les cases de la ligne entre le lanceur et la case ciblée (1–4 PO, en ligne, sans LdV), non dégressive.
  - 13 % d'Érosion (2 tours, cumul 2) et 32 à 36 dommages Air (CC 38 à 43) à TOUTES les entités de la ligne, alliés compris.
- **Rôle tactique** : Transperce une file d'ennemis en couloir ; attention aux alliés dans la ligne.
- **Tags** : `damage`, `air`, `aoe_line`, `erosion`
- **Grades** : g1 (niv. 95) : 4 PA, PO 1–4, 2/tour, 26–29 Air ; g2 (niv. 162) : 4 PA, PO 1–4, 2/tour, 32–36 Air
- *Infobulle décodée (auto)* :
  - 13% Érosion — cibles : alliés (lanceur compris), ennemis ; zone : ligne depuis le lanceur jusqu'à la case ciblée (incluse), non dégressive ; 2 tour(s)
  - 32 à 36 dommages Air (CC : 38 à 43 dommages Air) — cibles : alliés (lanceur compris), ennemis ; zone : ligne depuis le lanceur jusqu'à la case ciblée (incluse), non dégressive

### Paire 2 : Ferveur / Menace

*Ferveur (bouclier + Eau en croix, 2 PA) ou Menace (attire 2 + Eau).*

#### 2A. Ferveur (id 14676, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 0–5 (fixe), LdV · 2/tour · CC 5 %
- **Description officielle** : Applique un bouclier sur le lanceur et ses alliés et occasionne des dommages Eau aux ennemis en zone.
- **Effets** :
  - Bouclier de 50 % du niveau (100 pts au niv. 200) sur le lanceur (même hors zone) et les alliés dans la croix de 1 autour de l'impact, 2 tours.
  - 16 à 19 dommages Eau (CC 20 à 23) aux ennemis dans la croix de 1.
- **Rôle tactique** : 2 PA, 0–5 PO, 2/tour : petit sort de zone qui protège l'Iop et les alliés au contact.
- **Tags** : `damage`, `water`, `shield`, `aoe_small`
- **Grades** : g1 (niv. 1) : 2 PA, PO 0–3, 2/tour, 9–11 Eau ; g2 (niv. 67) : 2 PA, PO 0–4, 2/tour, 13–15 Eau ; g3 (niv. 133) : 2 PA, PO 0–5, 2/tour, 16–19 Eau
- *Infobulle décodée (auto)* :
  - Bouclier : 50% du niveau (= 100 pts au niveau 200) — cibles : lanceur, alliés (lanceur compris) ; zone : croix de 1 ; 2 tour(s)
  - 16 à 19 dommages Eau (CC : 20 à 23 dommages Eau) — cibles : ennemis ; zone : croix de 1

#### 2B. Menace (id 13130, niveau de déblocage 100)

- **Caractéristiques** : **3 PA** · PO 1–3 (fixe), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Attire la cible et occasionne des dommages Eau aux ennemis.
- **Effets** :
  - Attire la cible de 2 cases (allié ou ennemi).
  - 26 à 28 dommages Eau (CC 31 à 34) si c'est un ennemi.
- **Rôle tactique** : Ramène un ennemi au contact pour Fureur/Colère (1–3 PO).
- **Tags** : `damage`, `water`, `pull`, `placement`
- **Grades** : g1 (niv. 100) : 3 PA, PO 1–3, 3/tour, 21–23 Eau ; g2 (niv. 167) : 3 PA, PO 1–3, 3/tour, 26–28 Eau
- *Infobulle décodée (auto)* :
  - Attire de 2 cases — cibles : alliés (lanceur compris), ennemis
  - 26 à 28 dommages Eau (CC : 31 à 34 dommages Eau) — cibles : ennemis

### Paire 3 : Couperet / Accumulation

*Couperet (Feu, ligne 4, −3 PM) ou Accumulation (Terre, rampe 3 tours).*

#### 3A. Couperet (id 13115, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–6 (modifiable), en ligne, LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Feu et retire des PM en zone.
- **Effets** :
  - Zone : ligne de 4 cases depuis l'impact (s'éloignant du lanceur), dégressive 10 %/case.
  - 28 à 32 dommages Feu (CC 34 à 38) et −3 PM esquivables (1 tour) à toutes les entités de la ligne, alliés compris.
- **Rôle tactique** : Retrait PM de zone en couloir (1–6 PO modifiable, en ligne) ; excellent sur une file de monstres de vague.
- **Tags** : `damage`, `fire`, `aoe_line`, `mp_removal`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–4, 2/tour, 17–19 Feu ; g2 (niv. 68) : 3 PA, PO 1–5, 2/tour, 22–25 Feu ; g3 (niv. 134) : 3 PA, PO 1–6, 2/tour, 28–32 Feu
- *Infobulle décodée (auto)* :
  - 28 à 32 dommages Feu (CC : 34 à 38 dommages Feu) — cibles : alliés (lanceur compris), ennemis ; zone : ligne de 4 cases (impact + 3 derrière)
  - -3 PM — cibles : alliés (lanceur compris), ennemis ; zone : ligne de 4 cases (impact + 3 derrière) ; 1 tour(s) ; désenvoûtable seulement par effet fort

#### 3B. Accumulation (id 13138, niveau de déblocage 105)

- **Caractéristiques** : **3 PA** · PO 0–4 (fixe), en ligne, LdV · 3/tour · 2/cible · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Terre.  Sur le lanceur : augmente les dommages du sort.
- **Effets** :
  - 22 à 26 dommages Terre (CC 26 à 31) à la cible (hors lanceur).
  - Si le sort est lancé SUR LE LANCEUR (PO 0) : +24 dégâts de base à Accumulation pendant 3 tours (non cumulable, masque c).
- **Rôle tactique** : Lancer d'abord sur soi (3 PA) puis 2× sur l'ennemi (46–50 de base) : rentable sur 3 tours de contact.
- **Tags** : `damage`, `earth`, `self_buff`
- **Grades** : g1 (niv. 105) : 3 PA, PO 0–4, 3/tour, 19–22 Terre ; g2 (niv. 172) : 3 PA, PO 0–4, 3/tour, 22–26 Terre
- *Infobulle décodée (auto)* :
  - 22 à 26 dommages Terre (CC : 26 à 31 dommages Terre) — cibles : alliés (hors lanceur), ennemis
  - Accumulation : +24 dégâts de base — cibles : lanceur (s'il est dans la zone) ; 3 tour(s) ; désenvoûtable seulement par effet fort

### Paire 4 : Épée Divine / Épée du Jugement

*Épée Divine (Air, croix 3, +30 Dommages au groupe) quasi systématique ; Épée du Jugement (Eau, bouclier, différé).*

#### 4A. Épée Divine (id 13110, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 0–3 (fixe), LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Air aux ennemis et augmente les Dommages du lanceur et des alliés en zone.
- **Effets** :
  - 24 à 28 dommages Air (CC 29 à 34) aux ennemis dans une croix de 3 autour de l'impact (0–3 PO), dégressive.
  - +30 Dommages pendant 4 tours au lanceur (même hors zone) et aux alliés dans la croix de 3 (non cumulable).
- **Rôle tactique** : Excellent ratio : zone + buff de groupe +30 Do (4 tours) — à lancer quand les alliés sont alignés.
- **Tags** : `damage`, `air`, `aoe`, `buff_ally`, `buff_damage`
- **Grades** : g1 (niv. 1) : 3 PA, PO 0–3, 2/tour, 14–17 Air ; g2 (niv. 69) : 3 PA, PO 0–3, 2/tour, 19–22 Air ; g3 (niv. 136) : 3 PA, PO 0–3, 2/tour, 24–28 Air
- *Infobulle décodée (auto)* :
  - 24 à 28 dommages Air (CC : 29 à 34 dommages Air) — cibles : ennemis ; zone : croix de 3
  - 30 Dommages — cibles : lanceur, alliés (lanceur compris) ; zone : croix de 3 ; 4 tour(s)

#### 4B. Épée du Jugement (id 13117, niveau de déblocage 110)

- **Caractéristiques** : **4 PA** · PO 0–4 (fixe), sans LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Applique un bouclier sur le lanceur, occasionne des dommages Eau et applique l'état Condamné sur la cible : • Occasionne des dommages Eau plus importants à retardement sur la cible.  Le bouclier est plus important et le retardement est réinitialisé sur une cible Condamnée.  Sur le lanceur : applique un bouclier.
- **Effets** :
  - 31 à 35 dommages Eau (CC 37 à 42) à la cible (hors lanceur) et état « Condamné » 2 tours.
  - Bouclier sur le lanceur : 100 % du niveau (200) ou 200 % (400) si la cible était déjà Condamnée, 2 tours (via sous-sort 28590).
  - Dégâts différés : 48 à 52 Eau (CC 58 à 62) sur la cible 2 tours plus tard ; relancer sur une cible Condamnée réinitialise le délai.
- **Rôle tactique** : 4 PA, 1/tour, sans LdV : DPS Eau + bouclier personnel ; enchaîner sur la même cible pour 400 de bouclier.
- **Tags** : `damage`, `water`, `shield`, `delayed`
- **Grades** : g1 (niv. 110) : 4 PA, PO 0–4, 1/tour, 26–30 Eau / 41–44 Eau ; g2 (niv. 177) : 4 PA, PO 0–4, 1/tour, 31–35 Eau / 48–52 Eau
- *Infobulle décodée (auto)* :
  - Bouclier : 100% du niveau (= 200 pts au niveau 200) — cibles : lanceur [si la cible n'a pas l'état « Condamné »] ; 2 tour(s)
  - Bouclier : 200% du niveau (= 400 pts au niveau 200) — cibles : lanceur [si la cible a l'état « Condamné »] ; 2 tour(s)
  - 31 à 35 dommages Eau (CC : 37 à 42 dommages Eau) — cibles : alliés (hors lanceur), ennemis
  - État « Condamné » — cibles : alliés (hors lanceur), ennemis ; 2 tour(s) ; non désenvoûtable (sauf mort)
  - 48 à 52 dommages Eau (CC : 58 à 62 dommages Eau) — cibles : alliés (hors lanceur), ennemis ; DIFFÉRÉ de 2 tour(s) ; non désenvoûtable (sauf mort)

### Paire 5 : Intimidation / Conquête

*Intimidation (poussée 3, meilleur élément) ; Conquête (Stratège Iop renvoyant les dégâts).*

#### 5A. Intimidation (id 13108, niveau de déblocage 5)

- **Caractéristiques** : **2 PA** · PO 1–2 (fixe), en ligne, LdV · 3/tour · 2/cible · CC 5 %
- **Description officielle** : Occasionne des dommages dans le meilleur élément du lanceur aux ennemis et repousse la cible.
- **Effets** :
  - 8 à 10 dommages dans le meilleur élément du lanceur (CC 11 à 13) à l'ennemi.
  - Repousse la cible de 3 cases.
- **Rôle tactique** : 2 PA, 1–2 PO en ligne : poussée de dégagement ou poussée dans un mur (dommages de poussée boostés par Puissance +120 Do Poussée).
- **Tags** : `damage`, `push`, `placement`
- **Grades** : g1 (niv. 5) : 2 PA, PO 1–2, 3/tour, 4–6 meilleur élément ; g2 (niv. 72) : 2 PA, PO 1–2, 3/tour, 6–8 meilleur élément ; g3 (niv. 139) : 2 PA, PO 1–2, 3/tour, 8–10 meilleur élément
- *Infobulle décodée (auto)* :
  - 8 à 10 dommages du meilleur élément (CC : 11 à 13 dommages du meilleur élément) — cibles : ennemis
  - Repousse de 3 cases — cibles : alliés (lanceur compris), ennemis

#### 5B. Conquête (id 13148, niveau de déblocage 115)

- **Caractéristiques** : **3 PA** · PO 1–6 (fixe), sans LdV · case libre · relance 3 · relance initiale 1 · CC 0 %
- **Description officielle** : Invoque un Stratège Iop qui peut renvoyer 50% des dommages qu'il subit en zone autour de lui. Le renvoi de dommages n'affecte pas le lanceur.  Le Stratège Iop réduit de 50% les dommages immédiats alliés.  Il ne peut y avoir qu'un seul Stratège Iop par équipe. Si le Stratège Iop est encore présent et que celui-ci est ré-invoqué, l'ancien est détruit pour laisser place au nouveau.
- **Effets** :
  - Invoque un Stratège Iop (#5130) statique (0 PA, 0 PM, 200 % des PV de l'Iop INCERTAIN) — 1 seul par équipe, relance 3, relance initiale 1.
  - Le Stratège ne subit que 50 % des dommages venant d'alliés.
  - Chaque fois qu'il subit des dommages : renvoie 100 % (si l'attaquant est un allié) ou 50 % (si ennemi) des dommages finaux subis à toutes les entités dans un anneau 1–2 autour de lui, sauf l'Iop (état « Stratégie Iop »).
- **Rôle tactique** : À poser au milieu d'un paquet d'ennemis puis à frapper soi-même : chaque coup devient une zone. Attention, les autres alliés autour sont touchés.
- **Tags** : `summon`, `aoe`, `damage_amplifier`
- **Grades** : g1 (niv. 115) : 3 PA, PO 1–5, relance 3 ; g2 (niv. 182) : 3 PA, PO 1–6, relance 3
- *Infobulle décodée (auto)* :
  - Invoque : Stratège Iop (#5130, grade 1) — cibles : alliés (lanceur compris), ennemis

### Paire 6 : Bond / Agitation

*Bond (téléportation + ×115 % dégâts subis autour) ; Agitation (+3 PM, Intaclable à un allié).*

#### 6A. Bond (id 13107, niveau de déblocage 10)

- **Caractéristiques** : **4 PA** · PO 1–5 (fixe), sans LdV · case libre · 1/tour · cumul 1 · CC 0 % · condition : le lanceur n'a pas « Pesanteur » (`HS!7`)
- **Description officielle** : Téléporte le lanceur sur la case ciblée et augmente les dommages subis par les ennemis en zone.
- **Effets** :
  - Téléporte le lanceur sur la case ciblée (1–5 PO, sans LdV, case libre ; impossible en Pesanteur).
  - Les ennemis dans la croix de 1 (sans centre) autour de la case d'arrivée subissent ×115 % de dommages jusqu'au prochain tour de l'Iop.
- **Rôle tactique** : Engage au contact + amplifie les dégâts de tout le groupe sur les ennemis adjacents (1/tour).
- **Tags** : `mobility`, `damage_amplifier`
- **Grades** : g1 (niv. 10) : 4 PA, PO 1–4, relance 2 ; g2 (niv. 77) : 4 PA, PO 1–4, 1/tour ; g3 (niv. 144) : 4 PA, PO 1–5, 1/tour
- *Infobulle décodée (auto)* :
  - Téléporte sur la case ciblée — cibles : alliés (lanceur compris), ennemis
  - Dommages subis x115% — cibles : ennemis ; zone : croix de 1 sans le centre ; DÉCLENCHÉ quand : Le porteur subit des dommages (écoute 1 t)

#### 6B. Agitation (id 13143, niveau de déblocage 120)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), LdV · relance 2 · CC 0 %
- **Description officielle** : Augmente les PM de l'allié ciblé et le rend Intaclable. Augmente également sa Puissance pour chaque PM utilisé.
- **Effets** :
  - Sur un allié (ou soi) : retire les effets d'une Agitation précédente, +3 PM et état Intaclable pendant 1 tour.
  - +20 Puissance (1 tour) pour CHAQUE PM utilisé par la cible pendant ce tour (déclencheur CCMPARR, cumulable).
- **Rôle tactique** : 2 PA, relance 2 : un DPS mêlée qui fait 6–9 PM gagne +120 à +180 Puissance et ne peut pas être taclé.
- **Tags** : `buff_ally`, `mp_gain`, `mobility`
- **Grades** : g1 (niv. 120) : 2 PA, PO 0–5, relance 2 ; g2 (niv. 187) : 2 PA, PO 0–6, relance 2
- *Infobulle décodée (auto)* :
  - 3 PM — cibles : alliés (lanceur compris) ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - État « Intaclable » — cibles : alliés (lanceur compris) ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - 20 Puissance — cibles : alliés (lanceur compris) ; 1 tour(s) ; DÉCLENCHÉ quand : Pour CHAQUE PM utilise (écoute 1 t)

### Paire 7 : Concentration / Sentence

*Concentration (Terre mêlée, +50 % sur invocations) ; Sentence (Feu, explosion de fin de tour).*

#### 7A. Concentration (id 13123, niveau de déblocage 15)

- **Caractéristiques** : **2 PA** · PO 1–1 (fixe), en ligne, LdV · 4/tour · 3/cible · CC 5 %
- **Description officielle** : Occasionne des dommages Terre. Les dommages sont plus importants sur les invocations.
- **Effets** :
  - 20 à 24 dommages Terre (CC 25 à 30) sur personnages/monstres non invoqués.
  - 30 à 34 dommages Terre (CC 37 à 42) sur les invocations.
- **Rôle tactique** : 2 PA, mêlée en ligne, 4/tour, 3/cible : filler Terre ; +50 % contre les invocations.
- **Tags** : `damage`, `earth`, `melee`, `filler`, `anti_summon`
- **Grades** : g1 (niv. 15) : 2 PA, PO 1–1, 3/tour, 13–15 Terre / 19–21 Terre ; g2 (niv. 82) : 2 PA, PO 1–1, 3/tour, 16–19 Terre / 25–28 Terre ; g3 (niv. 149) : 2 PA, PO 1–1, 4/tour, 20–24 Terre / 30–34 Terre
- *Infobulle décodée (auto)* :
  - 20 à 24 dommages Terre (CC : 25 à 30 dommages Terre) — cibles : personnages/compagnons ennemis, monstres ennemis, personnages/compagnons alliés, monstres alliés, lanceur (s'il est dans la zone)
  - 30 à 34 dommages Terre (CC : 37 à 42 dommages Terre) — cibles : invocations ennemies, invocations alliées

#### 7B. Sentence (id 13147, niveau de déblocage 125)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · 3/tour · 1/cible · cumul 1 · CC 5 %
- **Description officielle** : Occasionne des dommages Feu et applique l'état Sentence sur la cible : • À la fin du tour de la cible, occasionne des dommages Feu aux ennemis en zone autour d'elle.  Les dommages n'affectent pas le lanceur.
- **Effets** :
  - 13 à 16 dommages Feu (CC 17 à 20) à la cible (hors lanceur) et état « Sentence » 1 tour (alliés ou ennemis).
  - À la fin du tour de la cible : 26 à 30 dommages Feu (CC 32 à 36) aux ENNEMIS dans un anneau 1–2 autour d'elle (sous-sort 13155), puis retrait de l'état.
- **Rôle tactique** : Peut se lancer sur un allié tank entouré d'ennemis : la détonation de fin de tour ne frappe que les ennemis. 1/cible, 3/tour.
- **Tags** : `damage`, `fire`, `aoe`, `delayed`
- **Grades** : g1 (niv. 125) : 2 PA, PO 0–5, 3/tour, 11–14 Feu / 23–26 Feu ; g2 (niv. 192) : 2 PA, PO 0–6, 3/tour, 13–16 Feu / 26–30 Feu
- *Infobulle décodée (auto)* :
  - 13 à 16 dommages Feu (CC : 17 à 20 dommages Feu) — cibles : alliés (hors lanceur), ennemis
  - État « Sentence » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)
  - 26 à 30 dommages Feu (CC : 32 à 36 dommages Feu) — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu) ; DÉCLENCHÉ quand : Fin du tour du PORTEUR (écoute 1 t)

### Paire 8 : Déferlement / Anneau Destructeur

*Déferlement (rapprochement + Eau) ; Anneau Destructeur (anneau 3 Air + attire 1).*

#### 8A. Déferlement (id 13126, niveau de déblocage 20)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), en ligne, LdV · 3/tour · 2/cible · CC 15 %
- **Description officielle** : Rapproche le lanceur vers la cible et occasionne des dommages Eau aux ennemis.
- **Effets** :
  - Le lanceur avance de 5 cases vers la cible (en ligne, 1–6 PO).
  - 38 à 42 dommages Eau (CC 46 à 50) à l'ennemi.
- **Rôle tactique** : Rapprochement + gros coup Eau (4 PA, 3/tour) ; met l'Iop au contact pour Fureur/Colère.
- **Tags** : `damage`, `water`, `mobility`, `gap_closer`
- **Grades** : g1 (niv. 20) : 4 PA, PO 1–4, 3/tour, 24–27 Eau ; g2 (niv. 87) : 4 PA, PO 1–5, 3/tour, 31–34 Eau ; g3 (niv. 154) : 4 PA, PO 1–6, 3/tour, 38–42 Eau
- *Infobulle décodée (auto)* :
  - Avance de 5 cases — cibles : alliés (hors lanceur), ennemis
  - 38 à 42 dommages Eau (CC : 46 à 50 dommages Eau) — cibles : ennemis

#### 8B. Anneau Destructeur (id 13135, niveau de déblocage 130)

- **Caractéristiques** : **3 PA** · PO 0–3 (fixe), LdV · 2/tour · CC 10 %
- **Description officielle** : Occasionne des dommages Air aux ennemis et attire les cibles vers le centre en zone. N'affecte pas le lanceur.
- **Effets** :
  - Zone : anneau de rayon exactement 3 autour de l'impact (0–3 PO), non dégressif.
  - 24 à 28 dommages Air (CC 29 à 34) aux ennemis de l'anneau puis attire d'1 case vers le centre toutes les entités de l'anneau (hors lanceur).
- **Rôle tactique** : Lancé sur soi : frappe et rapproche les ennemis à distance 3.
- **Tags** : `damage`, `air`, `aoe_ring`, `pull`
- **Grades** : g1 (niv. 130) : 3 PA, PO 0–3, 2/tour, 22–25 Air ; g2 (niv. 197) : 3 PA, PO 0–3, 2/tour, 24–28 Air
- *Infobulle décodée (auto)* :
  - 24 à 28 dommages Air (CC : 29 à 34 dommages Air) — cibles : ennemis ; zone : anneau de rayon exactement 3
  - Attire de 1 case — cibles : alliés (hors lanceur), ennemis ; zone : anneau de rayon exactement 3

### Paire 9 : Vitalité / Violence

*Vitalité (+20 %/+10 % Vitalité) ; Violence (repousse 4 autour de soi).*

#### 9A. Vitalité (id 13120, niveau de déblocage 25)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · relance 2 · cumul 2 · CC 25 %
- **Description officielle** : Augmente la Vitalité de la cible. La Vitalité est plus importante sur le lanceur.
- **Effets** :
  - Sur le lanceur (PO 0) : +20 % Vitalité (CC 22 %) pendant 4 tours.
  - Sur une autre cible (alliée ou ennemie) : +10 % Vitalité (CC 11 %) pendant 4 tours.
  - Cumulable 2 fois, relance 2.
- **Rôle tactique** : Augmente PV max et actuels (pourcentage des PV hors buff) : à placer avant un gros coup de boss.
- **Tags** : `buff_ally`, `survival`, `vitality`
- **Grades** : g1 (niv. 25) : 3 PA, PO 0–4, relance 2 ; g2 (niv. 92) : 3 PA, PO 0–5, relance 2 ; g3 (niv. 159) : 3 PA, PO 0–6, relance 2
- *Infobulle décodée (auto)* :
  - 20% Vitalité (CC : 22% Vitalité) — cibles : lanceur (s'il est dans la zone) ; 4 tour(s)
  - 10% Vitalité (CC : 11% Vitalité) — cibles : alliés (hors lanceur), ennemis ; 4 tour(s)

#### 9B. Violence (id 13137, niveau de déblocage 135)

- **Caractéristiques** : **3 PA** · PO 0–0 (fixe), sans LdV · 1/tour · CC 0 %
- **Description officielle** : Repousse les cibles en zone.
- **Effets** :
  - Repousse de 4 cases toutes les entités (alliés compris) dans un anneau 1–2 autour du lanceur (lancé sur soi, 1/tour).
- **Rôle tactique** : Dégagement d'urgence en mêlée ; dommages de poussée importants avec Puissance (+120 Do Poussée).
- **Tags** : `push`, `placement`, `escape`
- *Infobulle décodée (auto)* :
  - Repousse de 4 cases — cibles : alliés (lanceur compris), ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)

### Paire 10 : Souffle / Rassemblement

*Souffle (Air, repousse en croix) ; Rassemblement (Feu, regroupe une croix de 3).*

#### 10A. Souffle (id 13116, niveau de déblocage 30)

- **Caractéristiques** : **2 PA** · PO 2–8 (fixe), sans LdV · 1/tour · CC 10 %
- **Description officielle** : Repousse les cibles depuis le centre et occasionne des dommages Air aux ennemis en zone.
- **Effets** :
  - Zone : croix de 1 sans centre autour de l'impact (2–8 PO, sans LdV).
  - Repousse d'1 case depuis le centre les entités de la zone (alliés compris), puis 13 à 15 dommages Air (CC 16 à 18) aux ennemis.
- **Rôle tactique** : Écarte un paquet à distance (1/tour) : utile pour décoller des ennemis d'un allié.
- **Tags** : `damage`, `air`, `push`, `placement`
- **Grades** : g1 (niv. 30) : 2 PA, PO 2–6, 1/tour, 8–10 Air ; g2 (niv. 97) : 2 PA, PO 2–7, 1/tour, 10–12 Air ; g3 (niv. 164) : 2 PA, PO 2–8, 1/tour, 13–15 Air
- *Infobulle décodée (auto)* :
  - Repousse de 1 case — cibles : alliés (lanceur compris), ennemis ; zone : croix de 1 sans le centre
  - 13 à 15 dommages Air (CC : 16 à 18 dommages Air) — cibles : ennemis ; zone : croix de 1 sans le centre

#### 10B. Rassemblement (id 13136, niveau de déblocage 140)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · 1/tour · CC 15 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis et attire les cibles jusqu'au centre en zone. N'affecte pas le lanceur.
- **Effets** :
  - 22 à 25 dommages Feu (CC 26 à 30) aux ennemis dans une croix de 3 (0–6 PO), dégressive.
  - Puis attire vers le centre (hors lanceur) : de 1 case à distance 1, de 2 cases à distance 2, de 3 cases à distance 3 → tout le monde est regroupé au contact du centre.
- **Rôle tactique** : Sort de regroupement : préparer une zone alliée (Épée Céleste, Explosive, etc.). 1/tour.
- **Tags** : `damage`, `fire`, `aoe`, `pull`, `packing`
- *Infobulle décodée (auto)* :
  - 22 à 25 dommages Feu (CC : 26 à 30 dommages Feu) — cibles : ennemis ; zone : croix de 3
  - Attire de 3 cases — cibles : alliés (hors lanceur), ennemis ; zone : croix de 3 sans le centre (à distance exactement 3–3)

### Paire 11 : Épée Destructrice / Fustigation

*Épée Destructrice (Feu, barre 3, érosion) ; Fustigation (Eau, demi-cercle, érosion).*

#### 11A. Épée Destructrice (id 13119, niveau de déblocage 35)

- **Caractéristiques** : **4 PA** · PO 1–4 (fixe), en ligne, LdV · 2/tour · cumul 2 · CC 15 %
- **Description officielle** : Érode les cibles et occasionne des dommages Feu en zone.
- **Effets** :
  - Zone : barre perpendiculaire de 3 cases (1–4 PO, en ligne).
  - 13 % d'Érosion (2 tours, cumul 2) et 32 à 36 dommages Feu (CC 38 à 43) à toutes les entités de la barre, alliés compris.
- **Rôle tactique** : Bonne zone Feu à 4 PA, 2/tour.
- **Tags** : `damage`, `fire`, `aoe`, `erosion`
- **Grades** : g1 (niv. 35) : 4 PA, PO 1–4, 2/tour, 20–23 Feu ; g2 (niv. 102) : 4 PA, PO 1–4, 2/tour, 26–29 Feu ; g3 (niv. 169) : 4 PA, PO 1–4, 2/tour, 32–36 Feu
- *Infobulle décodée (auto)* :
  - 13% Érosion — cibles : alliés (lanceur compris), ennemis ; zone : barre perpendiculaire de 3 cases ; 2 tour(s)
  - 32 à 36 dommages Feu (CC : 38 à 43 dommages Feu) — cibles : alliés (lanceur compris), ennemis ; zone : barre perpendiculaire de 3 cases

#### 11B. Fustigation (id 14818, niveau de déblocage 145)

- **Caractéristiques** : **3 PA** · PO 1–2 (fixe), en ligne, LdV · 2/tour · cumul 2 · CC 10 %
- **Description officielle** : Érode les cibles et occasionne des dommages Eau en zone.
- **Effets** :
  - Zone : demi-cercle de 1 (impact + 2 cases latérales revenant vers le lanceur), 1–2 PO en ligne.
  - 10 % d'Érosion (2 tours, cumul 2) et 28 à 31 dommages Eau (CC 34 à 37) à toutes les entités de la zone, alliés compris.
- **Rôle tactique** : Coup de mêlée Eau qui touche 2–3 ennemis autour de la cible.
- **Tags** : `damage`, `water`, `aoe_small`, `erosion`
- *Infobulle décodée (auto)* :
  - 10% Érosion — cibles : alliés (lanceur compris), ennemis ; zone : demi-cercle de 1 ; 2 tour(s)
  - 28 à 31 dommages Eau (CC : 34 à 37 dommages Eau) — cibles : alliés (lanceur compris), ennemis ; zone : demi-cercle de 1

### Paire 12 : Puissance / Vindicte

*Puissance (+300 Puissance, +120 Dommages Poussée, 3 tours) indispensable ; Vindicte (+20 % érosion).*

#### 12A. Puissance (id 13118, niveau de déblocage 40)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · relance 4 · cumul 1 · CC 25 %
- **Description officielle** : Augmente la Puissance et les Dommages Poussée de la cible.
- **Effets** :
  - +300 Puissance (CC 350) et +120 Dommages Poussée (CC 140) à la cible pendant 3 tours (n'importe quelle entité, 0–6 PO).
  - Relance 4, non cumulable.
- **Rôle tactique** : Le plus gros buff de Puissance du jeu : sur l'Iop lui-même ou sur le DPS principal du groupe (+300 Puissance s'ajoute à la caractéristique de chaque élément : dégâts × (100 + carac + 300)/(100 + carac), soit ≈ +27 % pour 1000 de caractéristique, +75 % pour 300).
- **Tags** : `buff_ally`, `buff_power`, `key_buff`
- **Grades** : g1 (niv. 40) : 3 PA, PO 0–4, relance 4 ; g2 (niv. 107) : 3 PA, PO 0–5, relance 4 ; g3 (niv. 174) : 3 PA, PO 0–6, relance 4
- *Infobulle décodée (auto)* :
  - 300 Puissance (CC : 350 Puissance) — cibles : alliés (lanceur compris), ennemis ; 3 tour(s)
  - 120 Dommages Poussée (CC : 140 Dommages Poussée) — cibles : alliés (lanceur compris), ennemis ; 3 tour(s)

#### 12B. Vindicte (id 14677, niveau de déblocage 150)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), LdV · 2/tour · 1/cible · cumul 1 · CC 0 %
- **Description officielle** : Érode la cible.
- **Effets** :
  - +20 % d'Érosion sur la cible pendant 2 tours (non cumulable), 1–5 PO, 2 PA.
- **Rôle tactique** : Érosion pure : sur un boss qui se soigne, ou avant un burst de groupe.
- **Tags** : `erosion`, `debuff`
- *Infobulle décodée (auto)* :
  - 20% Érosion — cibles : alliés (lanceur compris), ennemis ; 2 tour(s)

### Paire 13 : Tempête de Puissance / Tannée

*Tempête de Puissance (Feu, marquage I/II) ; Tannée (Air, barre 5, −3 PM).*

#### 13A. Tempête de Puissance (id 13121, niveau de déblocage 45)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · case occupée · 3/tour · 2/cible · cumul 2 · CC 10 %
- **Description officielle** : Occasionne des dommages Feu. N'affecte pas le lanceur.  Occasionne également des dommages Feu sur l'ennemi initial si le sort est lancé sur une autre cible. Ces dommages sont plus importants après 2 lancers consécutifs sur un même ennemi.
- **Effets** :
  - 27 à 30 dommages Feu (CC 32 à 35) à la cible (case occupée, hors lanceur).
  - Si la cible n'est pas marquée : état « Tempête de Puissance I » ; si elle est en I : passe en « II » (états infinis).
  - Les autres ennemis marqués ailleurs sur la carte subissent 27–30 Feu (marqués I) ou 38–42 Feu (CC 46–50, marqués II), puis perdent leur marque.
- **Rôle tactique** : Rotation A, A, B (9 PA) : A prend 3 coups dont un amplifié ; à intégrer dans un Iop Feu.
- **Tags** : `damage`, `fire`, `ramp`, `multi_target`
- **Grades** : g1 (niv. 45) : 3 PA, PO 0–6, 3/tour, 17–19 Feu / 17–19 Feu / 24–27 Feu ; g2 (niv. 112) : 3 PA, PO 0–6, 3/tour, 22–25 Feu / 22–25 Feu / 32–35 Feu ; g3 (niv. 179) : 3 PA, PO 0–6, 3/tour, 27–30 Feu / 27–30 Feu / 38–42 Feu
- *Infobulle décodée (auto)* :
  - 27 à 30 dommages Feu (CC : 32 à 35 dommages Feu) — cibles : alliés (hors lanceur), ennemis
  - 27 à 30 dommages Feu (CC : 32 à 35 dommages Feu) — cibles : ennemis [si la cible a l'état « Tempête de Puissance I »] ; zone : toute la carte sauf l'impact
  - 38 à 42 dommages Feu (CC : 46 à 50 dommages Feu) — cibles : ennemis [si la cible a l'état « Tempête de Puissance II »] ; zone : toute la carte sauf l'impact

#### 13B. Tannée (id 13131, niveau de déblocage 155)

- **Caractéristiques** : **3 PA** · PO 1–6 (modifiable), en ligne, LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Air et retire des PM en zone.
- **Effets** :
  - Zone : barre perpendiculaire de 5 cases (1–6 PO modifiable, en ligne).
  - 27 à 30 dommages Air (CC 32 à 36) et −3 PM esquivables (1 tour) à toutes les entités de la barre, alliés compris.
- **Rôle tactique** : Meilleur retrait PM de zone de l'Iop (barre de 5).
- **Tags** : `damage`, `air`, `aoe`, `mp_removal`
- *Infobulle décodée (auto)* :
  - 27 à 30 dommages Air (CC : 32 à 36 dommages Air) — cibles : alliés (lanceur compris), ennemis ; zone : barre perpendiculaire de 5 cases
  - -3 PM — cibles : alliés (lanceur compris), ennemis ; zone : barre perpendiculaire de 5 cases ; 1 tour(s) ; désenvoûtable seulement par effet fort

### Paire 14 : Endurance / Pugilat

*Endurance (Eau + bouclier 150) ; Pugilat (Terre, cercle 2, +18 par lancer).*

#### 14A. Endurance (id 13133, niveau de déblocage 50)

- **Caractéristiques** : **3 PA** · PO 0–2 (fixe), LdV · case occupée · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Applique un bouclier sur le lanceur et occasionne des dommages Eau. Les dommages n'affectent pas le lanceur.
- **Effets** :
  - Bouclier de 75 % du niveau (150 pts) sur le lanceur, 2 tours.
  - 30 à 34 dommages Eau (CC 36 à 41) à la cible (0–2 PO, case occupée, hors lanceur).
- **Rôle tactique** : 3 PA, 3/tour : filler Eau qui empile 450 de bouclier sur 3 lancers.
- **Tags** : `damage`, `water`, `shield`, `filler`
- **Grades** : g1 (niv. 50) : 3 PA, PO 0–2, 3/tour, 22–25 Eau ; g2 (niv. 117) : 3 PA, PO 0–2, 3/tour, 27–30 Eau ; g3 (niv. 184) : 3 PA, PO 0–2, 3/tour, 30–34 Eau
- *Infobulle décodée (auto)* :
  - Bouclier : 75% du niveau (= 150 pts au niveau 200) — cibles : lanceur ; 2 tour(s)
  - 30 à 34 dommages Eau (CC : 36 à 41 dommages Eau) — cibles : alliés (hors lanceur), ennemis

#### 14B. Pugilat (id 13146, niveau de déblocage 160)

- **Caractéristiques** : **2 PA** · PO 1–6 (fixe), LdV · case occupée · 4/tour · 1/cible · CC 5 %
- **Description officielle** : Occasionne des dommages Terre en zone. Les dommages du sort sont augmentés après chaque lancer pour le tour en cours.  Les dommages n'affectent pas le lanceur.
- **Effets** :
  - 9 à 11 dommages Terre (CC 12 à 14) aux entités (hors lanceur) dans un cercle de 2 autour de la cible (1–6 PO, case occupée), dégressif.
  - +18 dégâts de base au sort après chaque lancer pour le tour en cours (retiré en fin de tour) ; 4/tour, 1/cible.
- **Rôle tactique** : 4 lancers sur 4 cibles différentes : 9–11, 27–29, 45–47, 63–65 de base (8 PA). Très fort en vague dense.
- **Tags** : `damage`, `earth`, `aoe`, `ramp_turn`
- *Infobulle décodée (auto)* :
  - 9 à 11 dommages Terre (CC : 12 à 14 dommages Terre) — cibles : alliés (hors lanceur), ennemis ; zone : cercle de rayon 2
  - Pugilat : +18 dégâts de base — cibles : lanceur ; 1 tour(s) ; désenvoûtable seulement par effet fort

### Paire 15 : Vertu / Massacre

*Vertu (bouclier 1000 aux alliés au contact) ; Massacre (×115 % + renvoi 30 % en anneau).*

#### 15A. Vertu (id 13142, niveau de déblocage 55)

- **Caractéristiques** : **3 PA** · PO 0–0 (fixe), sans LdV · relance 3 · cumul 1 · CC 25 %
- **Description officielle** : Applique un bouclier sur les alliés en zone. Retire également de la Puissance au lanceur pour chaque allié à son contact (cumulable 4 fois).
- **Effets** :
  - Bouclier de 500 % du niveau (1000 pts, CC 550 %) aux alliés dans la croix de 1 autour du lanceur (lui compris), 2 tours.
  - −50 Puissance au lanceur (2 tours) pour CHAQUE allié à son contact (cumul 4).
  - Relance 3.
- **Rôle tactique** : Protection de groupe massive si 2–4 alliés sont collés à l'Iop (avant une attaque de zone de boss).
- **Tags** : `shield`, `group_protection`
- **Grades** : g1 (niv. 55) : 3 PA, PO 0–0, relance 3 ; g2 (niv. 122) : 3 PA, PO 0–0, relance 3 ; g3 (niv. 189) : 3 PA, PO 0–0, relance 3
- *Infobulle décodée (auto)* :
  - Bouclier : 500% du niveau (= 1000 pts au niveau 200) (CC : Bouclier : 550% du niveau (= 1100 pts au niveau 200)) — cibles : alliés (lanceur compris) ; zone : croix de 1 ; 2 tour(s)
  - -50 Puissance — cibles : lanceur ; 2 tour(s)

#### 15B. Massacre (id 13112, niveau de déblocage 165)

- **Caractéristiques** : **2 PA** · PO 1–7 (fixe), LdV · relance 4 · relance globale -1 · cumul 1 · CC 0 %
- **Description officielle** : Augmente et renvoie une partie des dommages subis par l'ennemi ciblé aux ennemis en zone autour de lui.
- **Effets** :
  - Sur l'ennemi ciblé (1–7 PO), pendant 2 tours : dommages subis ×115 %.
  - Chaque fois qu'il subit des dommages, 30 % des dommages finaux sont infligés à SES alliés (nos ennemis) dans un anneau 1–2 autour de lui (sous-sort 13127).
- **Rôle tactique** : Relance 4 : à poser sur la cible prioritaire au centre d'un paquet avant le burst du groupe.
- **Tags** : `damage_amplifier`, `aoe_splash`
- *Infobulle décodée (auto)* :
  - Dommages subis x115% — cibles : ennemis ; DÉCLENCHÉ quand : Le porteur subit des dommages (écoute 2 t)
  - Dommages : 30% des dommages finaux subis — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu), non dégressive ; DÉCLENCHÉ quand : Le porteur subit des dommages / (ou mort) Le porteur subit des dommages (écoute 2 t)

### Paire 16 : Épée de Iop / Fendoir

*Épée de Iop (Terre, croix 3, 8 PO) ; Fendoir (Eau, croix 1, bouclier par ennemi).*

#### 16A. Épée de Iop (id 13125, niveau de déblocage 60)

- **Caractéristiques** : **4 PA** · PO 0–8 (fixe), en ligne, LdV · 2/tour · CC 15 %
- **Description officielle** : Occasionne des dommages Terre en zone. N'affecte pas le lanceur.
- **Effets** :
  - 37 à 41 dommages Terre (CC 44 à 49) aux entités (hors lanceur) dans une croix de 3 autour de l'impact (0–8 PO en ligne), dégressive 10 %/case.
- **Rôle tactique** : Meilleure zone Terre à distance de l'Iop (4 PA, 2/tour) ; touche aussi les alliés dans la croix.
- **Tags** : `damage`, `earth`, `aoe`
- **Grades** : g1 (niv. 60) : 4 PA, PO 0–6, 2/tour, 27–30 Terre ; g2 (niv. 127) : 4 PA, PO 0–7, 2/tour, 33–37 Terre ; g3 (niv. 194) : 4 PA, PO 0–8, 2/tour, 37–41 Terre
- *Infobulle décodée (auto)* :
  - 37 à 41 dommages Terre (CC : 44 à 49 dommages Terre) — cibles : ennemis, alliés (hors lanceur) ; zone : croix de 3

#### 16B. Fendoir (id 13134, niveau de déblocage 170)

- **Caractéristiques** : **5 PA** · PO 0–4 (fixe), LdV · 2/tour · CC 20 %
- **Description officielle** : Applique un bouclier sur le lanceur pour chaque ennemi dans la zone d'effet et occasionne des dommages Eau en zone. Les dommages n'affectent pas le lanceur.
- **Effets** :
  - Bouclier de 75 % du niveau (150) sur le lanceur pour CHAQUE ennemi dans la croix de 1 (sous-sort 13149), 2 tours.
  - 47 à 53 dommages Eau (CC 56 à 64) aux entités (hors lanceur) dans la croix de 1.
- **Rôle tactique** : 5 PA : gros coup Eau + bouclier jusqu'à 750 si 5 ennemis en croix.
- **Tags** : `damage`, `water`, `aoe_small`, `shield`
- *Infobulle décodée (auto)* :
  - Bouclier : 75% du niveau (= 150 pts au niveau 200) — cibles : lanceur ; 2 tour(s)
  - 47 à 53 dommages Eau (CC : 56 à 64 dommages Eau) — cibles : alliés (hors lanceur), ennemis ; zone : croix de 1

### Paire 17 : Friction / Coup pour Coup

*Friction (attraction réactive) ; Coup pour Coup (poussée réactive).*

#### 17A. Friction (id 13113, niveau de déblocage 65)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), sans LdV · relance 3 · cumul 1 · CC 0 %
- **Description officielle** : Attire la cible et lui applique l'état Friction : • Sur un ennemi : attire la cible vers son attaquant ennemi. • Sur un allié : attire ses attaquants ennemis vers elle.
- **Effets** :
  - Attire la cible de 2 cases (0–6 PO, sans LdV) et lui applique « Friction » 2 tours.
  - Sur un ennemi : à chaque fois qu'il subit des dommages d'un de nos alliés, il est attiré de 2 cases vers son attaquant.
  - Sur un allié : à chaque fois qu'il subit des dommages d'un ennemi, l'attaquant est attiré de 2 cases vers lui.
- **Rôle tactique** : Garde un ennemi collé aux attaquants (ou ramène les ennemis vers le tank). Relance 3.
- **Tags** : `placement`, `pull`, `control`
- **Grades** : g1 (niv. 65) : 2 PA, PO 0–4, relance 3 ; g2 (niv. 131) : 2 PA, PO 0–5, relance 3 ; g3 (niv. 198) : 2 PA, PO 0–6, relance 3
- *Infobulle décodée (auto)* :
  - Attire de 2 cases — cibles : alliés (lanceur compris), ennemis
  - État « Friction » — cibles : alliés (lanceur compris), ennemis ; 2 tour(s)
  - Attire de 2 cases — cibles : alliés (lanceur compris), ennemis ; DÉCLENCHÉ quand : Dommages subis d'un ENNEMI (écoute 2 t)

#### 17B. Coup pour Coup (id 13140, niveau de déblocage 175)

- **Caractéristiques** : **2 PA** · PO 1–3 (fixe), LdV · case occupée · relance 3 · cumul 1 · CC 0 %
- **Description officielle** : Repousse la cible et lui applique l'état Coup pour Coup : • Sur un ennemi : repousse la cible si elle attaque le lanceur. • Sur un allié : repousse les attaquants ennemis.
- **Effets** :
  - Repousse la cible de 2 cases (1–3 PO, case occupée) et applique « Coup pour Coup » 1 tour.
  - Ennemi : s'il attaque l'Iop, il est repoussé de 2 cases.
  - Allié : ses attaquants ennemis sont repoussés de 2 cases.
- **Rôle tactique** : Protection anti-mêlée ponctuelle. Relance 3.
- **Tags** : `placement`, `push`, `control`
- *Infobulle décodée (auto)* :
  - Repousse de 2 cases — cibles : alliés (lanceur compris), ennemis
  - État « Coup pour Coup » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)

### Paire 18 : Épée Céleste / Zénith

*Épée Céleste (Air, cercle 2) ; Zénith (Air, ligne 4, bonus selon PM restants).*

#### 18A. Épée Céleste (id 13122, niveau de déblocage 70)

- **Caractéristiques** : **4 PA** · PO 0–6 (fixe), LdV · 2/tour · CC 15 %
- **Description officielle** : Occasionne des dommages Air en zone. N'affecte pas le lanceur.
- **Effets** :
  - 36 à 40 dommages Air (CC 43 à 48) aux entités (hors lanceur) dans un cercle de 2 autour de l'impact (0–6 PO), dégressif.
- **Rôle tactique** : Meilleure zone Air (13 cases) : sort principal en combat de vagues.
- **Tags** : `damage`, `air`, `aoe`
- **Grades** : g1 (niv. 70) : 4 PA, PO 0–5, 2/tour, 28–31 Air ; g2 (niv. 137) : 4 PA, PO 0–6, 2/tour, 36–40 Air
- *Infobulle décodée (auto)* :
  - 36 à 40 dommages Air (CC : 43 à 48 dommages Air) — cibles : alliés (hors lanceur), ennemis ; zone : cercle de rayon 2

#### 18B. Zénith (id 13145, niveau de déblocage 180)

- **Caractéristiques** : **5 PA** · PO 1–3 (fixe), en ligne, LdV · 1/tour · CC 25 %
- **Description officielle** : Occasionne des dommages Air en zone.  Occasionne des dommages Air supplémentaires en zone selon les PM restants du lanceur.
- **Effets** :
  - Zone : ligne de 4 cases (1–3 PO, en ligne), alliés compris.
  - 27 à 29 dommages Air (CC 31 à 35) + 52 à 58 dommages Air (CC 64 à 70) proportionnels aux PM restants du lanceur (INCERTAIN : × PM restants / PM max).
- **Rôle tactique** : 5 PA, 1/tour : à lancer AVANT de se déplacer pour garder tous ses PM.
- **Tags** : `damage`, `air`, `aoe_line`, `finisher`
- *Infobulle décodée (auto)* :
  - 27 à 29 dommages Air (CC : 31 à 35 dommages Air) — cibles : alliés (lanceur compris), ennemis ; zone : ligne de 4 cases (impact + 3 derrière)
  - 52 à 58 dommages Air (% PM PM restants) (CC : 64 à 70 dommages Air (% PM PM restants)) — cibles : alliés (lanceur compris), ennemis ; zone : ligne de 4 cases (impact + 3 derrière)

### Paire 19 : Précipitation / Détermination

*Précipitation (+5 PA puis −3 PA) ; Détermination (Indéplaçable + bouclier 600).*

#### 19A. Précipitation (id 13114, niveau de déblocage 75)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), LdV · relance 2 · relance initiale 1 · cumul 1 · CC 0 %
- **Description officielle** : Augmente les PA de l'allié ciblé et lui applique l'état Affaibli. Retire des PA non esquivables à cet allié au tour suivant.  L'état n'est pas appliqué sur le lanceur.
- **Effets** :
  - +5 PA (1 tour) à l'allié ciblé (ou soi) et état « Affaibli » (pas sur le lanceur).
  - Au tour suivant : −3 PA non esquivables (1 tour).
- **Rôle tactique** : 2 PA, relance 2, relance initiale 1 : burst immédiat de +5 PA (net +2 sur 2 tours).
- **Tags** : `buff_ally`, `ap_gain`, `burst`
- **Grades** : g1 (niv. 75) : 2 PA, PO 0–5, relance 3 ; g2 (niv. 142) : 2 PA, PO 0–6, relance 2
- *Infobulle décodée (auto)* :
  - 5 PA — cibles : alliés (lanceur compris) ; 1 tour(s)
  - État « Affaibli » — cibles : alliés (hors lanceur) ; 1 tour(s)
  - -3 PA — cibles : alliés (lanceur compris) ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s)

#### 19B. Détermination (id 13132, niveau de déblocage 185)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), LdV · relance 3 · cumul 1 · CC 0 %
- **Description officielle** : Rend l'allié ciblé Indéplaçable et lui applique un bouclier.
- **Effets** :
  - Rend l'allié ciblé Indéplaçable (1 tour) et lui applique un bouclier de 300 % du niveau (600 pts), 1 tour.
- **Rôle tactique** : Protège un allié contre poussées/téléportations ennemies (Vortex téléporte !) et absorbe 600 dégâts.
- **Tags** : `shield`, `anti_push`
- *Infobulle décodée (auto)* :
  - État « Indéplaçable » — cibles : alliés (lanceur compris) ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Bouclier : 300% du niveau (= 600 pts au niveau 200) — cibles : alliés (lanceur compris) ; 1 tour(s) ; non désenvoûtable (sauf mort)

### Paire 20 : Épée du Destin / Tumulte

*Épée du Destin (Feu, +40 au retour de relance) ; Tumulte (Feu, +20 par ennemi en croix).*

#### 20A. Épée du Destin (id 13111, niveau de déblocage 80)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), en ligne, LdV · relance 2 · CC 25 %
- **Description officielle** : Occasionne des dommages Feu. Les dommages du sort sont augmentés à la récupération du sort.
- **Effets** :
  - 38 à 42 dommages Feu (CC 46 à 50) à la cible (1–6 PO en ligne, alliés compris).
  - Relance 2 ; +40 dégâts de base au sort pendant 1 tour, 2 tours plus tard (= au retour de relance → 78–82).
- **Rôle tactique** : À relancer exactement tous les 2 tours.
- **Tags** : `damage`, `fire`, `ramp`
- **Grades** : g1 (niv. 80) : 4 PA, PO 1–5, relance 2, 31–34 Feu ; g2 (niv. 147) : 4 PA, PO 1–6, relance 2, 38–42 Feu
- *Infobulle décodée (auto)* :
  - 38 à 42 dommages Feu (CC : 46 à 50 dommages Feu) — cibles : alliés (lanceur compris), ennemis
  - Épée du Destin : +40 dégâts de base — cibles : lanceur ; 1 tour(s) ; DIFFÉRÉ de 2 tour(s) ; désenvoûtable seulement par effet fort

#### 20B. Tumulte (id 13144, niveau de déblocage 190)

- **Caractéristiques** : **4 PA** · PO 0–6 (fixe), LdV · 1/tour · CC 20 %
- **Description officielle** : Augmente les dommages du sort pour chaque ennemi dans la zone d'effet et occasionne des dommages Feu en zone. N'affecte pas le lanceur.
- **Effets** :
  - +20 dégâts de base au sort pour CHAQUE ennemi dans la croix de 1 autour de l'impact (sous-sort 13154), puis 19 à 21 dommages Feu (CC 23 à 25) aux entités (hors lanceur) de la croix ; le bonus est retiré après le lancer.
- **Rôle tactique** : 4 PA, 1/tour : 39–41 sur 1 ennemi, jusqu'à 119–121 sur chacun si 5 ennemis en croix.
- **Tags** : `damage`, `fire`, `aoe_small`
- *Infobulle décodée (auto)* :
  - Tumulte : +20 dégâts de base — cibles : lanceur ; zone : croix de 1 ; désenvoûtable seulement par effet fort
  - 19 à 21 dommages Feu (CC : 23 à 25 dommages Feu) — cibles : alliés (hors lanceur), ennemis ; zone : croix de 1

### Paire 21 : Emprise / Duel

*Emprise (ennemi invulnérable et immobilisé 1 tour) ; Duel.*

#### 21A. Emprise (id 13141, niveau de déblocage 85)

- **Caractéristiques** : **3 PA** · PO 1–1 (fixe), sans LdV · relance 4 · relance globale -1 · CC 0 %
- **Description officielle** : Rend l'ennemi ciblé Invulnérable et l'immobilise.
- **Effets** :
  - Ennemi au contact : Invulnérable (#269) et −100 PM (non esquivables) pendant 1 tour.
  - Relance 4 (globalCooldown −1 : pas de relance globale, INCERTAIN).
- **Rôle tactique** : Neutralise la menace la plus dangereuse 1 tour (ex. un monstre de vague qui allait tuer un allié) ; il ne peut plus être frappé non plus.
- **Tags** : `control`, `neutralize`
- **Grades** : g1 (niv. 85) : 3 PA, PO 1–1, relance 5 ; g2 (niv. 152) : 3 PA, PO 1–1, relance 4
- *Infobulle décodée (auto)* :
  - État « Invulnérable » — cibles : ennemis ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - -100 PM — cibles : ennemis ; 1 tour(s) ; non désenvoûtable (sauf mort)

#### 21B. Duel (id 13109, niveau de déblocage 195)

- **Caractéristiques** : **4 PA** · PO 1–1 (fixe), sans LdV · case occupée · relance 4 · relance globale -1 · CC 0 %
- **Description officielle** : Rend le lanceur et l'ennemi ciblé Invulnérables à distance, leur applique l'état Pesanteur et les immobilise. La durée de l'état Pesanteur est plus importante sur le lanceur.
- **Effets** :
  - L'Iop et l'ennemi au contact deviennent Invulnérables à distance (1 tour), Pesanteur (Iop 2 tours, ennemi 1 tour) et −100 PM (1 tour).
- **Rôle tactique** : Isoler un ennemi de distance (il ne peut plus être touché/toucher à distance). Usage PvM limité.
- **Tags** : `control`, `duel`
- *Infobulle décodée (auto)* :
  - État « Invulnérable à Distance » — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - État « Pesanteur » — cibles : lanceur ; 2 tour(s) ; non désenvoûtable (sauf mort)
  - État « Pesanteur » — cibles : ennemis ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - -100 PM — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)

### Paire 22 : Fureur / Colère de Iop

*Fureur (Terre, rampe 20/40) ou Colère de Iop (Terre, 81–100 puis 191–210 au retour).*

#### 22A. Fureur (id 13156, niveau de déblocage 90)

- **Caractéristiques** : **3 PA** · PO 1–1 (fixe), LdV · case occupée · 1/tour · cumul 2 · CC 15 %
- **Description officielle** : Occasionne des dommages Terre. Les dommages du sort sont augmentés après chaque lancer.   Les bonus se décrémentent si le sort n'est pas relancé.
- **Effets** :
  - 28 à 32 dommages Terre (CC 34 à 38) à la cible au contact (case occupée, alliés compris).
  - Rampe (sous-sort 28604) : +20 dégâts de base au 2e tour consécutif (Fureur I), +40 dès le 3e (Fureur II), 2 tours ; décrémente d'un palier si non relancé.
- **Rôle tactique** : 1/tour, 3 PA : à lancer chaque tour au contact (68–72 de base en rythme de croisière).
- **Tags** : `damage`, `earth`, `melee`, `ramp`
- **Grades** : g1 (niv. 90) : 3 PA, PO 1–1, 1/tour, 23–26 Terre ; g2 (niv. 157) : 3 PA, PO 1–1, 1/tour, 28–32 Terre
- *Infobulle décodée (auto)* :
  - 28 à 32 dommages Terre (CC : 34 à 38 dommages Terre) — cibles : alliés (lanceur compris), ennemis
  - Fureur : +20 dégâts de base — cibles : lanceur ; 2 tour(s) ; désenvoûtable seulement par effet fort

#### 22B. Colère de Iop (id 13124, niveau de déblocage 200)

- **Caractéristiques** : **7 PA** · PO 1–1 (fixe), LdV · relance 3 · cumul 1 · CC 25 %
- **Description officielle** : Occasionne des dommages Terre. Les dommages du sort sont augmentés à la récupération du sort.
- **Effets** :
  - 81 à 100 dommages Terre (CC 107 à 130) à la cible au contact (alliés compris), 7 PA, relance 3.
  - +110 dégâts de base au sort pendant 1 tour, 3 tours plus tard (= au retour de relance → 191–210).
- **Rôle tactique** : Le plus gros coup Iop : planifier T (81–100) puis T+3 (191–210).
- **Tags** : `damage`, `earth`, `melee`, `burst`, `ramp`
- *Infobulle décodée (auto)* :
  - 81 à 100 dommages Terre (CC : 107 à 130 dommages Terre) — cibles : alliés (lanceur compris), ennemis
  - Colère de Iop : +110 dégâts de base — cibles : lanceur ; 1 tour(s) ; DIFFÉRÉ de 3 tour(s) ; désenvoûtable seulement par effet fort

## Invocations

### Stratège Iop (monstre 5130, grade 1) — Stratège Iop (Conquête, P5B)

- PA 0, PM 0 (−1 = statique), PV = 200 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 200}
- Joue : True ; tacle : True ; poussable : True ; échangeable : True ; place d'invocation : False
- Sort de départ (niveau de sort 52854) : voir la mécanique correspondante ci-dessus.
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 700], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

## Rôle en groupe PvM (niveau 200)

### Rôles officiels (DofusDB, valeur /12)

Dégâts 12, Amélioration 8, Placement 6, Tank 3, Protection 3, Entrave 2, Invocation 1, Soins 0

### Rôles retenus pour l'IA de composition

- **dps-melee-terre** (priorité 1, élément : Terre (Force)) — Fureur (rampe +40) + Colère de Iop (191–210 au retour) + Pression/Concentration/Pugilat ; meilleur burst mono-cible du jeu sur un boss au contact. Épée de Iop (croix 3, 8 PO) pour la zone.
- **dps-zone-feu-air** (priorité 2, élément : Feu/Air (Intelligence/Agilité) ou multi) — Épée Céleste (cercle 2), Épée Divine (croix 3), Couperet/Tannée (ligne/barre + −3 PM), Tumulte, Rassemblement (regroupe puis frappe), Tempête de Puissance : nettoyage de vagues (Vortex).
- **soutien-offensif** (priorité 3, élément : indifférent) — Puissance (+300) sur le meilleur DPS, Précipitation (+5 PA), Agitation (+3 PM, Intaclable), Épée Divine (+30 Do), Vitalité, Détermination : l'Iop peut jouer « booster » d'un autre DPS.
- **contrôle/placement** (priorité 4, élément : indifférent) — Emprise (neutralise 1 ennemi 1 tour), Rassemblement (packing), Menace/Anneau/Friction (attirance), Intimidation/Souffle/Violence (poussée), Massacre (amplifie et renvoie).

### Choix des variantes par rôle

| Paire | `iop_terre_burst_pvm` | `iop_multi_zone_vortex` | `iop_soutien` |
|---|---|---|---|
| 1 | A — Pression | B — Fracture | A — Pression |
| 2 | B — Menace | A — Ferveur | A — Ferveur |
| 3 | B — Accumulation | A — Couperet | A — Couperet |
| 4 | A — Épée Divine | A — Épée Divine | A — Épée Divine |
| 5 | A — Intimidation | A — Intimidation | B — Conquête |
| 6 | A — Bond | A — Bond | B — Agitation |
| 7 | A — Concentration | B — Sentence | A — Concentration |
| 8 | A — Déferlement | B — Anneau Destructeur | A — Déferlement |
| 9 | A — Vitalité | A — Vitalité | A — Vitalité |
| 10 | B — Rassemblement | B — Rassemblement | B — Rassemblement |
| 11 | A — Épée Destructrice | A — Épée Destructrice | A — Épée Destructrice |
| 12 | A — Puissance | A — Puissance | A — Puissance |
| 13 | B — Tannée | A — Tempête de Puissance | A — Tempête de Puissance |
| 14 | B — Pugilat | A — Endurance | A — Endurance |
| 15 | B — Massacre | A — Vertu | A — Vertu |
| 16 | A — Épée de Iop | A — Épée de Iop | A — Épée de Iop |
| 17 | A — Friction | A — Friction | A — Friction |
| 18 | A — Épée Céleste | A — Épée Céleste | A — Épée Céleste |
| 19 | A — Précipitation | A — Précipitation | A — Précipitation |
| 20 | A — Épée du Destin | B — Tumulte | A — Épée du Destin |
| 21 | A — Emprise | A — Emprise | A — Emprise |
| 22 | B — Colère de Iop | A — Fureur | A — Fureur |

- `iop_terre_burst_pvm` : Iop Terre mono-cible/boss (stuff Force) : rampe Fureur + Colère, Pression érosion, Puissance, Précipitation, Bond.
- `iop_multi_zone_vortex` : Iop zone (Feu/Air, ou multi-élément) pour les combats de vagues : Épée Céleste, Épée Divine, Tannée/Couperet, Tumulte, Rassemblement, Tempête de Puissance, Fureur conservée.
- `iop_soutien` : Iop « booster » : maximise Puissance/Précipitation/Agitation/Détermination/Vertu, garde Emprise pour la sécurité.

### Rotations types (PA indiqués entre parenthèses, 11–12 PA / 6 PM)

**Iop Terre — ouverture boss (12 PA / 6 PM)** — objectif : Installer la rampe Fureur et le buff Puissance ; Colère de Iop gardée pour le tour 2.

1. Puissance (3) sur soi → +300 Puissance 3 tours
2. Bond (4) au contact du boss → ennemis adjacents ×115 % dégâts subis
3. Fureur (3) → Fureur I (+20 au prochain lancer)
4. Concentration (2) ou Pression (3 si 13 PA)

**Iop Terre — tour 2 (12 PA)** — objectif : Pic de dégâts mono-cible ; au tour 5 Colère vaut 191–210 de base.

1. Fureur (3) → 48–52 de base (Fureur II)
2. Colère de Iop (7) → 81–100 (+110 au retour, tour 5)
3. Concentration (2)

**Iop Terre — burst avec Précipitation (12+5 PA)** — objectif : Burst d'exécution (fin de combat / boss bas en PV). Ne pas utiliser si le tour suivant est critique.

1. Précipitation (2) sur soi → +5 PA (−3 PA au tour suivant)
2. Fureur (3)
3. Colère de Iop (7)
4. Pression (3)
5. Concentration (2)

**Iop zone — vague de monstres (12 PA)** — objectif : Regrouper puis frapper 3–5 ennemis par sort ; Tannée/Couperet en ligne pour −3 PM de zone.

1. Rassemblement (3) au centre du paquet → ennemis regroupés en croix
2. Épée Céleste (4) au centre (cercle 2)
3. Épée Divine (3) au contact (croix 3, +30 Dommages aux alliés)
4. Intimidation (2) pour dégager un ennemi

**Iop soutien — tour de buff (12 PA)** — objectif : Transformer un allié en canon de verre pour un tour décisif (ex. vague finale).

1. Puissance (3) sur le DPS principal
2. Précipitation (2) sur le DPS principal (+5 PA)
3. Agitation (2) sur le tank/DPS mêlée (+3 PM, Intaclable)
4. Épée Divine (3) en croix sur le groupe (+30 Dommages)
5. Détermination (2) ou Vitalité (3)

### Synergies

- **Eniripsa** : Mot Stimulant (+2 PA) / Mot Galvanisant (+150 Puissance, bouclier) cumulés à Puissance → tours Fureur+Colère complets ; soins pour un Iop mêlée exposé.
- **Xélor** : Retrait PA (Ralentissement, Horloge, Pétrification) protège l'Iop au contact ; téléportations (Frappe de Xélor, Engrenage, Rouage) amènent les ennemis au contact / en croix pour Épée de Iop ; Flou Temporel donne +2 PA au tour suivant.
- **Enutrof / Sacrieur / Ouginak** : Retrait PM : l'ennemi reste au contact de l'Iop (Fureur et Colère sont à 1 PO).
- **Pandawa / Osamodas** : Placement (porter/jeter, Laisse) pour amener la cible dans la croix d'Épée de Iop ou d'Épée Divine ; Rassemblement Iop + zones alliées.
- **Féca** : Boucliers/glyphes pour un Iop sans soin propre ; le Féca profite des +30 Dommages d'Épée Divine et de Puissance.
- **Ecaflip** : Roue de la Fortune : 999 % de critique aux alliés au contact de la zone pendant leur tour (Colère de Iop CC 107–130, Fureur CC 34–38 + rampe) ; Arcane XV (jets maximisés) ; soins Ecaflip (Langue Râpeuse, Topkaj) pour un Iop au contact.

### Notes pour la démo « Œil de Vortex »

- Vagues de N monstres : Épée Céleste, Épée Divine (+30 Dommages au groupe), Tumulte, Pugilat, Rassemblement (regroupe la vague), Tannée/Couperet (−3 PM en zone).
- Phase 2 (Vortex vulnérable 1 tour après « Action ! ») : préparer la rampe (Fureur I/II, Colère de Iop au retour de relance) et Puissance pour le premier tour de vulnérabilité ; Vortex : résistances les plus basses Neutre 6 % et Feu 12 % (docs/research/vortex.md §0).
- Emprise rend un monstre Invulnérable 1 tour : utile pour survivre, mais un monstre invulnérable ne peut pas être tué à sa « Même heure » (corruption) — l'IA doit en tenir compte.
- « En temps et en heure » (500 Terre + 50 % des PV érodés) : Vitalité, Vertu (1000 de bouclier) et Détermination (600) avant le tour du Vortex ; Bond pour sortir de la ligne de l'Auroraire.

### Forces

- Meilleur burst mono-cible au contact (Fureur 68–72 de base en rythme, Colère de Iop 191–210 au retour de relance).
- Quatre éléments disponibles, plusieurs sorts de zone (croix 3, cercle 2, ligne 4, barre 5).
- Buffs offensifs majeurs pour l'équipe : +300 Puissance, +5 PA, +3 PM, +30 Dommages, boucliers 600–1000.
- Mobilité (Bond 5 PO sans LdV, Déferlement 5 cases) et contrôle ponctuel (Emprise, Rassemblement).
- Érosion intégrée (jusqu'à +46 % cumulée) : bon contre les boss régénérants.

### Faiblesses

- Aucun soin, peu de défense intrinsèque (boucliers Endurance/Fendoir/Ferveur ou Vertu uniquement).
- Très dépendant du contact (Fureur, Colère, Concentration à 1 PO) : vulnérable au retrait PM et aux ennemis qui fuient.
- Plusieurs sorts touchent les alliés (Couperet, Tannée, Fracture, Épée Destructrice, Fustigation, Zénith : masque a,A) — placement allié à gérer.
- Rampes à planifier sur 3 tours : un tour sauté coûte beaucoup (Fureur décrémente, bonus Colère perdu).

## États importants

| État | Nom (données) | Rôle |
|---|---|---|
| #609 | Fureur I | Fureur I (+20 dégâts de base à Fureur) |
| #5192 | Fureur II | Fureur II (+40) |
| #590 | Tempête de Puissance I | Tempête de Puissance I (marque, infini) |
| #591 | Tempête de Puissance II | Tempête de Puissance II |
| #657 | Sentence | Sentence (explosion Feu en fin de tour de la cible) |
| #5184 | Condamné | Condamné (Épée du Jugement) |
| #3643 | Friction | Friction |
| #3642 | Coup pour Coup | Coup pour Coup |
| #589 | Coup pour Coup | Coup pour Coup (ennemi) |
| #269 | Invulnérable | Invulnérable (Emprise) |
| #375 | Invulnérable à Distance | Invulnérable à Distance (Duel) |
| #7 | Pesanteur | Pesanteur (Duel ; bloque Bond : HS!7) |
| #97 | Indéplaçable | Indéplaçable (Détermination) |
| #96 | Intaclable | Intaclable (Agitation) |
| #42 | Affaibli | Affaibli (Précipitation, flag preventsFight — sens INCERTAIN) |
| #2794 | Stratégie Iop | Stratégie Iop (l'Iop est exclu des renvois du Stratège) |

## Points incertains

- INCERTAIN — Zénith (1013) : formule exacte des dommages proportionnels aux PM restants (supposée base × PM_restants / PM_max).
- INCERTAIN — `globalCooldown = -1` (Emprise, Massacre, Duel) : −1 = aucune relance globale (mechanics.md §4.4) ; certains documents du projet l'interprètent comme relance partagée entre lanceurs de l'équipe.
- INCERTAIN — État « Affaibli » (#42) de Précipitation : flag preventsFight dans les données, effet réel non documenté (probablement purement visuel / anti-cumul).
- INCERTAIN — PV du Stratège Iop : `bonusCharacteristics.lifePoints = 200` interprété comme 200 % des PV de l'Iop (règle d'échelle des invocations Dofus 3 non confirmée).
- INCERTAIN — Épée du Jugement : « le retardement est réinitialisé sur une cible Condamnée » — mécanisme de réinitialisation non visible dans les effets (pas de 406 explicite) ; supposé : un nouveau dégât différé remplace l'ancien.

## Sources

- https://api.dofusdb.fr/breeds/8
- https://api.dofusdb.fr/spell-variants?breedId=8
- https://api.dofusdb.fr/spells?id[$in][]=13106 (… 44 sorts)
- https://api.dofusdb.fr/spell-levels?spellId[$in][]=13106 (… 91 niveaux)
- https://api.dofusdb.fr/monsters/5130 (Stratège Iop)
- docs/research/effects.md, data/research/effect-semantics.json, data/research/zone-and-mask-grammar.json (catalogue des effets du projet)
- https://www.millenium.org/guide/337386.html (guide Iop, historique variantes 2.45 / 2.52)
