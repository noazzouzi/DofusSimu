# Enutrof (classe 3) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/3`, `/spell-variants?breedId=3`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 mis à jour le 2026-06-23, extraits le 2026-10-04. Valeurs = grade le plus élevé utilisable au
> niveau 200. Fichier machine : [`data/research/class-mechanics/enutrof.json`](../../../data/research/class-mechanics/enutrof.json).

**Identité** : « Chasseur de trésors » (complexité 2/4). Rôles officiels (`breedRoles`, /12) : Entrave 8 (« retire des
points de mouvement, d'action et de la portée à distance »), Invocation 6 (« objets animés qui protègent les alliés,
poussent, détectent les invisibles et occasionnent des dommages »), Boost 6 (« augmente PM, PA et Puissance ; augmente
ses propres caractéristiques grâce à ses invocations »), puis soin 5, dommages 5, protection 4, placement 3, tank 0.

**Résumé tactique** : l'Enutrof est **le** spécialiste du retrait de PM à distance (Maladresse 1 PA ×4, Pelle Aurifère,
Tamisage, Pelle des Anciens, Clef de Bras non esquivable, Avarice, Retraite Anticipée −100 PM à tout le monde) et un bon
retireur de PA (Abattement, Bêche des Anciens, Décadence) et de PO (Clef du Trésor, Lancer de Pelle, Remblai). Il
dispose aussi de puissants sorts de soutien (Ruée vers l'Or +4 PM, Boîte à Outils +3 PA/+3 PM, Âge d'Or +200 Puissance,
Boîte de Pandore soin de groupe 10 %, Corruption qui neutralise un ennemi un tour) et d'objets animés (interception,
partage de dommages, soin, tacle, révélation des invisibles). Ses sorts « à état » (Monnaie Sonnante, Orpaillage,
Éboulement, Coup de Grisou) transforment les retraits PA/PM/PO et les soins du groupe en dégâts supplémentaires.

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : à un instant donné, un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage du grade 1.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Lancer de Pièces (13338, niv. 1) | 2 | Monnaie Sonnante (13353, niv. 95) | 4 | Lancer de Pièces (2 PA, 12 PO, 6/tour) remplit les PA ; Monnaie Sonnante si l'équipe retire beaucoup de PA. |
| 2 | Force de l'Âge (13340, niv. 1) | 3 | Orpaillage (13363, niv. 100) | 4 | Orpaillage pour un Enutrof retrait PM (chaque tentative de retrait PM = dégâts Eau) ; Force de l'Âge (+1 PM) en voie Terre. |
| 3 | Roulage de Pelle (13331, niv. 1) | 3 | Éboulement (13352, niv. 105) | 4 | Éboulement (retraits de PO → dégâts Terre) ; Roulage de Pelle (sans ligne de vue). |
| 4 | Opportunité (13366, niv. 1) | 2 | Coup de Grisou (13368, niv. 110) | 4 | Opportunité (+80 Puissance au lanceur, 2 PA) ; Coup de Grisou avec un soigneur dans l'équipe. |
| 5 | Sac Animé (13328, niv. 5) | 2 | Musette Animée (13354, niv. 115) | 2 | Sac Animé (interception 3 tours) en général ; Musette (partage) si le groupe est serré. |
| 6 | Ruée vers l'Or (13342, niv. 10) | 2 | Déambulation (13356, niv. 120) | 3 | Ruée vers l'Or (+4 PM à un allié) quasi indispensable. |
| 7 | Boîte de Pandore (13334, niv. 15) | 2 | Boîte à Outils (13357, niv. 125) | 2 | Boîte à Outils (+3 PA/+3 PM, pacifiste) sur un soutien ; Boîte de Pandore (soin 10 % groupe, +1 PM ennemis). |
| 8 | Remblai (13335, niv. 20) | 3 | Feu de Mine (13355, niv. 130) | 4 | Remblai (croix 3, −2 PO) ; Feu de Mine (soin des attaquants). |
| 9 | Clef du Trésor (13332, niv. 25) | 2 | Clef de Bras (13359, niv. 135) | 2 | Clef de Bras (−1 PM non esquivable + soin 12 % allié) pour l'entraveur PM ; Clef du Trésor (±4 PO) sinon. |
| 10 | Abattement (13365, niv. 30) | 3 | Obsolescence (13360, niv. 140) | 3 | Abattement (−2 PA) ; Obsolescence (−20 Esquive PM) pour fiabiliser les retraits PM. |
| 11 | Pelle Animée (13344, niv. 35) | 2 | Bêche Animée (13361, niv. 145) | 2 | Pelle Animée (repousse 3) ; Bêche Animée (vol Terre + Fuite). |
| 12 | Avarice (13362, niv. 40) | 3 | Décadence (13369, niv. 150) | 2 | Avarice (−3 PM non esquivables en cercle 3, +3 PA aux mêmes cibles) ; Décadence (−2 PA ou ±10 % DF allié). |
| 13 | Pelle Aurifère (13343, niv. 45) | 4 | Tourbière (13358, niv. 155) | 4 | Pelle Aurifère (−3 PM, 4 PA) : sort clé du retrait PM. |
| 14 | Maladresse (13337, niv. 50) | 1 | Âge d'Or (13329, niv. 160) | 2 | Maladresse (1 PA, −2 PM, 4/tour) : sort clé ; Âge d'Or (+200 Puissance au tour suivant) en soutien. |
| 15 | Pelle Fantomatique (13336, niv. 55) | 3 | Dernier Recours (13372, niv. 165) | 3 | Pelle Fantomatique (réduit la durée des effets = désenvoûtement partiel) ; Dernier Recours (Pesanteur de zone). |
| 16 | Banqueroute (14278, niv. 60) | 4 | Lancer de Pelle (13330, niv. 170) | 4 | Banqueroute (−20 Esquive PA, gros dégâts Air) ; Lancer de Pelle (−4 PO). |
| 17 | Souterrain (13364, niv. 65) | 3 | Bêche des Anciens (13367, niv. 175) | 4 | Bêche des Anciens (−2 PA en croix 2 + repousse) ; Souterrain (échange) pour la mobilité. |
| 18 | Pelle des Anciens (13345, niv. 70) | 4 | Gisement (14273, niv. 180) | 3 | Pelle des Anciens (−1 PM + repousse 2) ; Gisement (soin de début de tour en zone). |
| 19 | Péremption (13333, niv. 75) | 4 | Tamisage (13370, niv. 185) | 3 | Tamisage (−2 PM en carré) pour l'entrave ; Péremption pour le burst Feu. |
| 20 | Corruption (13346, niv. 80) | 5 | Tunnel de Fortune (14274, niv. 190) | 3 | Corruption (ennemi pacifiste + invulnérable 1 tour) ; Tunnel de Fortune (invisibilité + Puissance). |
| 21 | Retraite Anticipée (13349, niv. 85) | 4 | Pelle de Fortune (29755, niv. 195) | 2 | Retraite Anticipée (−100 PM à tout le terrain sauf l'Enutrof) ; Pelle de Fortune (boost Puissance/Retrait). |
| 22 | Coffre Animé (13347, niv. 90) | 3 | Malle Animée (13371, niv. 200) | 3 | Coffre Animé (tacle, révèle les invisibles) ; Malle Animée (soin de zone). |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne des dommages de base de la première ligne de dommages directs divisée par le coût en PA (indicatif ; ne tient compte ni des zones, ni des effets secondaires, ni des sous-sorts). `+` = portée modifiable. Lancers/tour `∞` = pas de limite autre que les PA/relance.

| Sort | Paire | Élément | PA | Base | Base CC | Moy./PA | PO | Lancers/tour | Relance | Zone |
|---|---|---|---|---|---|---|---|---|---|---|
| Dernier Recours | 15B | Air | 3 | 30–34 | 36–41 | 10.7 | 0–7 | 1 | 2 | cercle de taille 2 |
| Péremption | 19A | Feu | 4 | 41–44 | 49–53 | 10.6 | 1–5+ | 2 | 0 | case ciblée |
| Pelle des Anciens | 18A | Eau | 4 | 40–44 | 48–53 | 10.5 | 1–7+ | 3 | 0 | case ciblée |
| Gisement | 18B | Feu | 3 | 29–32 | 35–38 | 10.2 | 0–8 | 1 | 0 | cercle de taille 2 |
| Force de l'Âge | 2A | Terre | 3 | 28–32 | 34–38 | 10.0 | 1–6+ | 3 | 0 | case ciblée |
| Banqueroute | 16A | Air | 4 | 36–40 | 43–48 | 9.5 | 1–8+ | 3 | 0 | case ciblée |
| Obsolescence | 10B | Eau | 3 | 26–30 | 31–36 | 9.3 | 1–7+ | 3 | 0 | case ciblée |
| Souterrain | 17A | Terre | 3 | 26–29 | 31–35 | 9.2 | 1–4 | 2 | 0 | case ciblée |
| Pelle Fantomatique | 15A | Feu | 3 | 26–28 | 31–34 | 9.0 | 0–8+ | 2 | 0 | case ciblée |
| Tamisage | 19B | Eau | 3 | 25–29 | 30–35 | 9.0 | 0–5+ | 1 | 0 | carré de taille 1 |
| Lancer de Pelle | 16B | Terre | 4 | 34–37 | 41–44 | 8.9 | 1–8+ | 3 | 0 | case ciblée |
| Pelle Aurifère | 13A | Eau | 4 | 33–37 | 40–44 | 8.8 | 1–7+ | 3 | 0 | case ciblée |
| Feu de Mine | 8B | Feu | 4 | 32–36 | 38–43 | 8.5 | 1–6+ | 3 | 0 | case ciblée |
| Bêche des Anciens | 17B | Air | 4 | 32–36 | 38–43 | 8.5 | 1–7 | 2 | 0 | croix de taille 2 |
| Éboulement | 3B | Terre | 4 | 31–35 | 37–42 | 8.2 | 1–6+ | 1 | 3 | case ciblée |
| Tourbière | 13B | Terre | 4 | 31–35 | 37–42 | 8.2 | 1–8+ | 1 | 0 | ligne de 2 case(s) |
| Coup de Grisou | 4B | Feu | 4 | 30–34 | 36–41 | 8.0 | 0–8 | 1 | 3 | cercle de taille 2 |
| Abattement | 10A | Air | 3 | 23–25 | 25–28 | 8.0 | 1–7+ | 3 | 0 | case ciblée |
| Monnaie Sonnante | 1B | Air | 4 | 29–33 | 35–39 | 7.8 | 1–4+ | 1 | 3 | case ciblée |
| Orpaillage | 2B | Eau | 4 | 28–32 | 34–38 | 7.5 | 1–5+ | 1 | 3 | case ciblée |
| Opportunité | 4A | Air | 2 | 14–16 | 17–19 | 7.5 | 1–8+ | 3 | 0 | case ciblée |
| Lancer de Pièces | 1A | Eau | 2 | 13–15 | 16–18 | 7.0 | 0–12+ | 6 | 0 | case ciblée |
| Roulage de Pelle | 3A | Feu | 3 | 19–23 | 24–29 | 7.0 | 1–6+ | 3 | 0 | case ciblée |
| Remblai | 8A | Terre | 3 | 20–22 | 24–26 | 7.0 | 0–8+ | 2 | 0 | croix de taille 3 |

Vérification croisée avec les gabarits de dégâts de DoMath (`.cache/domath/spell-templates.json`) : **24 sorts identiques**, 0 écart(s), 0 absent(s) de DoMath.

## Mécaniques spécifiques à implémenter

### 1. Retraits de PA / PM / PO (le cœur de la classe)
- **Esquivables** (effets 1079 −PA / 1080 −PM) : Maladresse (−2 PM), Pelle Aurifère (−3 PM), Tamisage (−2 PM zone),
  Pelle des Anciens (−1 PM), Abattement (−2 PA), Bêche des Anciens (−2 PA zone), Décadence (−2 PA).
  Formule de jet par point (émulateurs Dofus 2 ; à valider Dofus 3, **INCERTAIN**) :
  `P(retirer le i-ème point) = clamp( (PA_actuels − i) / PA_max × (RetraitPA_lanceur / EsquivePA_cible) / 2 ; 0,10 ; 0,90 )`
  (idem PM avec Retrait PM / Esquive PM). Les points esquivés sont « esquivés » (message GameActionFightDodgePointLoss).
- **Non esquivables** (effets 168/169) : Clef de Bras (−1 PM), Avarice (−3 PM en cercle 3), Retraite Anticipée (−100 PM).
- **Portée** (effet 116, jamais esquivable) : Clef du Trésor −4, Lancer de Pelle −4, Remblai −2 (croix 3).
- **Esquive PA/PM** : Banqueroute −20 Esquive PA, Obsolescence −20 Esquive PM (2 tours) pour fiabiliser les retraits.
- Bonus de retrait : la Pelle de Fortune donne +10 Retrait PA et +10 Retrait PM (et +40 Puissance, +10 Fuite) au début de
  chaque tour de l'Enutrof tant qu'elle vit (2 tours).

### 2. Sorts « à état » qui convertissent les retraits en dégâts (paires 1–4, variantes B)
| Sort | Dégât direct | État posé (3 tours) | Déclencheur (`buff 3 t.`) | Dégât déclenché |
|---|---|---|---|---|
| Monnaie Sonnante (13353) | 29–33 Air | Monnaie Sonnante (5495) | tentative de retrait de **PA** subie (`APA`) | 11–13 Air |
| Orpaillage (13363) | 28–32 Eau | Orpaillage (5494) | tentative de retrait de **PM** subie (`MPA`) | 10–12 Eau |
| Éboulement (13352) | 31–35 Terre | Éboulement (5493) | perte de **Portée** (`R`) | 12–14 Terre |
| Coup de Grisou (13368) | 30–34 Feu (cercle 2) | Coup de Grisou (5496) | la cible est **soignée** (`H`) | 11–13 Feu en cercle 2 autour d'elle |
- Chaque état se déclenche **4 fois au maximum** : compteur via les états I→II→III→IV→V ; à l'état IV, le buff s'auto-retire
  (sous-sort grade 8). Le dégât déclenché est lancé par l'Enutrof (il profite de ses caractéristiques, CC possible).
- L'infobulle affiche aussi le dégât déclenché lors du lancer, mais cet effet est *affichage seul* : au lancer, seul le
  dégât direct est infligé (NE PAS l'appliquer deux fois).
- Coup de Grisou peut cibler un **allié** : quand cet allié est soigné, les ennemis autour de lui prennent les dégâts Feu
  (une fois par tour, état « Coup de Grisou (blocage) » 6299). Combo avec un soigneur (Eniripsa, Osamodas).
- Le déclencheur `APA`/`MPA` réagit aux effets de retrait, y compris ceux des alliés (Féca, Xélor, Sram…) : ces sorts
  récompensent une équipe d'entrave. Nombre de déclenchements par effet (un par effet ou un par point) : **INCERTAIN**
  (DoMath déclenche sur `ApStolen > 0` / `AmStolen > 0`, donc a priori un par effet de retrait).

### 3. Objets animés (invocations Enutrof)
| Objet (monstre) | Sort (relance) | Rôle | PV hérités* | Spécial |
|---|---|---|---|---|
| Sac Animé (5830) | 2 PA, relance 4 | **intercepte** les dommages des alliés en cercle 2 autour de sa case d'invocation (3 tours), meurt après 3 tours | 60 % | 25 % rés. |
| Musette Animée (5838) | 2 PA, relance 4 | **partage** les dommages entre les alliés en croix autour d'elle (2 tours) | 60 % | meurt après 2 tours |
| Pelle Animée (5834) | 2 PA, relance 3 | Déblayage : repousse de 3 sans dommages | 90 % | 4 PA / 6 PM |
| Bêche Animée (5841) | 2 PA, relance 3 | Bêchattaque : vol Terre 31–35, +40 Fuite à l'Enutrof et ses invocations | 90 % | 250 Force, 100 Agilité |
| Coffre Animé (5840) | 3 PA, relance 4 | Prospection : 8–10 Eau + dégâts Eau = 100 % de ses PV manquants (croix), révèle les invisibles (cercle 3), tacle | 120 % | 250 Chance, 30 % rés. |
| Malle Animée (5839) | 3 PA, relance 4 | Malle aux Trésors : soin 8 % PV max des alliés en cercle 2 | 120 % | — |
| Pelle de Fortune (5829) | 2 PA, 1/tour, statique | +40 Puissance, +10 Fuite, +10 Retrait PA/PM à l'Enutrof (2 t.) à l'apparition et à chaque début de tour ; détruite après 2 tours en soignant 8 % PV max à l'Enutrof | 30 % | pas d'emplacement |

\* `bonusCharacteristics.lifePoints` interprété comme % des PV de l'Enutrof (INCERTAIN, cf. refonte Osamodas).
- **Trésor d'Enutrof** (sort passif 13376 donné à tous les objets) : quand un **allié** attaque l'objet, l'attaquant est soigné de
  50 % des dommages infligés (déclencheur `DBA`). Exploitable : un allié qui frappe un objet animé se soigne.
- Déambulation peut échanger un allié avec le Sac/la Musette ; Ruée vers l'Or soigne 10 % un allié au contact d'un objet.

### 4. Boosts alliés
- **Ruée vers l'Or** : +4 PM (1 tour) à un allié à 12 PO ; à la fin de son tour, +150 Puissance au tour suivant s'il est au
  contact d'un ennemi, soin de 10 % de ses PV max s'il est au contact d'un objet animé (sous-sort 29757).
- **Boîte à Outils** : +3 PA et +3 PM (1 tour) mais l'allié et ses invocations deviennent **Pacifistes** (ne peuvent pas
  infliger de dommages) ; idéal sur un soigneur/placeur/entraveur ou un invocateur (les créatures invoquées pendant ce tour
  sont aussi pacifistes, déclencheur `CI`).
- **Âge d'Or** : Intaclable 1 tour puis **+200 Puissance au tour suivant**. **Décadence** sur un allié : +10 % dommages
  finaux immédiatement, −10 % au tour suivant.
- **Corruption** (5 PA, PO 4–8, relance 5) : un ennemi devient Pacifiste **et** Invulnérable 1 tour (le retirer du combat
  un tour) ; sur un allié : Pacifiste + soin 40 % PV max.

### 5. Contrôle global
- **Retraite Anticipée** (4 PA, relance 7, relance initiale 1) : −100 PM non esquivables et Pesanteur à **toutes** les
  entités sauf l'Enutrof pendant 1 tour ; l'Enutrof subit −100 PM au tour suivant. Équivalent d'un « tour gratuit » pour
  l'équipe contre des monstres de mêlée (ils ne peuvent plus bouger ni être déplacés).
- **Avarice** (3 PA, relance 4) : entités en cercle 3 autour de l'Enutrof (alliés et ennemis, pas lui) : −3 PM non
  esquivables et **+3 PA** (1 tour) — attention, les ennemis proches gagnent aussi 3 PA ; entités à 4 cases ou plus :
  −50 Puissance (1 tour) et +50 Puissance à l'Enutrof par entité touchée (2 tours, cumul 10).
- **Dernier Recours** : Pesanteur sur toutes les entités en cercle 2 + dégâts Air.
- **Boîte de Pandore** : soigne 10 % (CC 12 %) des PV max de **tous** les alliés mais donne +1 PM à **tous** les ennemis.

### 6. Autres points moteur
- **Tourbière** : +5 dommages de base par PM dépensé dans le tour (déclencheur `CCMPARR`). L'effet visible est *affichage
  seul* et aucun sous-sort n'apparaît : le mécanisme est probablement natif au client/serveur (**INCERTAIN**). Implémenter
  comme `baseDamage += 5 × PM_utilisés_ce_tour`.
- **Tunnel de Fortune** : invisibilité 1 tour + état ; pour chaque PM utilisé pendant le tour, +20 Puissance au tour suivant
  (déclencheur `CCMPARR` sur sous-sort 29756 g2, délai 1).
- **Remblai, Obsolescence, Banqueroute, Péremption** infligent davantage aux **invocations** (lignes de dommages séparées
  avec masques `j,J`/`i,I`) : utiles contre les monstres invocateurs.
- Prospection (stat 48) = bonus de butin uniquement, sans effet en combat.

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende : « Effets (infobulle) » = ce que le joueur lit en jeu (valeurs de base, `CC` = coup critique). « Mécanique réelle » = effets réellement exécutés (`forClientOnly = false`), avec les sous-sorts cachés développés une seule fois par document. Les effets d'infobulle marqués côté données `forClientOnly = true` **ne doivent pas être exécutés** par le moteur : ils ne servent qu'à l'affichage, la logique passe par les sous-sorts.

### Paire 1 : Lancer de Pièces / Monnaie Sonnante

> Choix : Lancer de Pièces (2 PA, 12 PO, 6/tour) remplit les PA ; Monnaie Sonnante si l'équipe retire beaucoup de PA.

#### 1A. Lancer de Pièces (id 13338)

- **2 PA** · PO 0–12 (modifiable) · LdV requise · 6/tour, 3/cible · CC 5 % · élément(s) : Eau
- Grades : g1 niv.1 dmg 7–9 PO0-8 ; g2 niv.66 dmg 10–12 PO0-10 ; g3 niv.132 dmg 13–15 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Eau. »
- Effets (infobulle, valeurs de base) :
  - 13 à 15 dommages Eau (CC : 16 à 18 dommages Eau)
- **Rôle tactique** : 2 PA, 0–12 PO modifiable, 6/tour (3/cible) : dégât Eau modeste mais très souple pour finir les PA à longue portée.
- Tags : `damage`, `water`, `filler`

#### 1B. Monnaie Sonnante (id 13353)

- **4 PA** · PO 1–4 (modifiable) · LdV requise · relance 3 t. · CC 25 % · élément(s) : Air
- Grades : g1 niv.95 dmg 24–27 PO1-3 ; g2 niv.162 dmg 29–33 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Air et applique l'état Monnaie Sonnante sur l'ennemi ciblé : • Occasionne des dommages Air si la cible subit une tentative de retrait de PA. Les dommages peuvent être déclenchés 4 fois tant que l'état est actif. L'état est retiré dès la limite atteinte. »
- Effets (infobulle, valeurs de base) :
  - 29 à 33 dommages Air (CC : 35 à 39 dommages Air)
  - applique l'état «Monnaie Sonnante» (5495) — cibles : ennemis ; 3 tour(s)
  - 11 à 13 dommages Air (CC : 14 à 16 dommages Air) — cibles : ennemis
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 29 à 33 dommages Air (CC : 35 à 39 dommages Air)
  - le lanceur lance le sort «Monnaie Sonnante» (29770, grade 2) — cibles : ennemis
    - *Sous-sort «Monnaie Sonnante» (id 29770, grade 2)*
      - le lanceur lance le sort «Monnaie Sonnante» (29770, grade 9) — cibles : ennemis
        - *Sous-sort «Monnaie Sonnante» (id 29770, grade 9)*
          - applique l'état «Monnaie Sonnante (compteur)» (5489) — cibles : ennemis ; 3 tour(s)
      - applique l'état «Monnaie Sonnante» (5495) — cibles : ennemis ; 3 tour(s)
      - le lanceur lance le sort «Monnaie Sonnante» (29770, grade 4) — cibles : ennemis ; déclenchement : quand le porteur subit un retrait de PA (buff 3 t.)
        - *Sous-sort «Monnaie Sonnante» (id 29770, grade 4)*
          - le lanceur lance le sort «Monnaie Sonnante» (29770, grade 6) — cibles : ennemis ; si la cible n'a pas l'état «Monnaie Sonnante IV» (5499)
            - *Sous-sort «Monnaie Sonnante» (id 29770, grade 6)*
              - le lanceur lance le sort «Monnaie Sonnante» (29770, grade 7) — cibles : ennemis ; si la cible n'a pas l'état «Monnaie Sonnante IV» (5499)
              - 11 à 13 dommages Air (CC : 14 à 16 dommages Air) — cibles : ennemis ; si la cible n'a pas l'état «Monnaie Sonnante IV» (5499)
      - le lanceur lance le sort «Monnaie Sonnante» (29770, grade 8) — cibles : ennemis ; déclenchement : quand le porteur gagne l'état «Monnaie Sonnante IV» (5499) / quand le porteur perd l'état «Monnaie Sonnante (compteur)» (5489) (buff 4 t.) ; indésenvoûtable
        - *Sous-sort «Monnaie Sonnante» (id 29770, grade 8)*
          - retire les effets du sort «Monnaie Sonnante» (29770) — cibles : ennemis
- **Rôle tactique** : 4 PA, relance 3 : 29–33 Air + état 3 tours : chaque tentative de retrait de PA sur la cible (de n'importe quel allié) inflige 11–13 Air, 4 fois max.
- Tags : `damage`, `air`, `combo_ap_removal`

### Paire 2 : Force de l'Âge / Orpaillage

> Choix : Orpaillage pour un Enutrof retrait PM (chaque tentative de retrait PM = dégâts Eau) ; Force de l'Âge (+1 PM) en voie Terre.

#### 2A. Force de l'Âge (id 13340)

- **3 PA** · PO 1–6 (modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 10 % · élément(s) : Terre
- Grades : g1 niv.1 dmg 17–19 PO1-4 ; g2 niv.67 dmg 22–25 PO1-5 ; g3 niv.133 dmg 28–32 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Terre et augmente les PM au lanceur. »
- Effets (infobulle, valeurs de base) :
  - 28 à 32 dommages Terre (CC : 34 à 38 dommages Terre)
  - 1 PM — cibles : lanceur ; 1 tour(s)
- **Rôle tactique** : 3 PA, cible requise : 28–32 Terre et +1 PM au lanceur (1 tour), 3/tour.
- Tags : `damage`, `earth`, `self_mp`

#### 2B. Orpaillage (id 13363)

- **4 PA** · PO 1–5 (modifiable) · LdV requise · relance 3 t. · CC 25 % · élément(s) : Eau
- Grades : g1 niv.100 dmg 23–26 PO1-4 ; g2 niv.167 dmg 28–32 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Eau et applique l'état Orpaillage sur l'ennemi ciblé : • Occasionne des dommages Eau si la cible subit une tentative de retrait de PM. Les dommages peuvent être déclenchés 4 fois tant que l'état est actif. L'état est retiré dès la limite atteinte. »
- Effets (infobulle, valeurs de base) :
  - 28 à 32 dommages Eau (CC : 34 à 38 dommages Eau)
  - applique l'état «Orpaillage» (5494) — cibles : ennemis ; 3 tour(s)
  - 10 à 12 dommages Eau (CC : 13 à 15 dommages Eau) — cibles : ennemis
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 28 à 32 dommages Eau (CC : 34 à 38 dommages Eau)
  - le lanceur lance le sort «Orpaillage» (29769, grade 2) — cibles : ennemis
    - *Sous-sort «Orpaillage» (id 29769, grade 2)*
      - le lanceur lance le sort «Orpaillage» (29769, grade 9) — cibles : ennemis
        - *Sous-sort «Orpaillage» (id 29769, grade 9)*
          - applique l'état «Orpaillage (compteur)» (5491) — cibles : ennemis ; 3 tour(s)
      - applique l'état «Orpaillage» (5494) — cibles : ennemis ; 3 tour(s)
      - le lanceur lance le sort «Orpaillage» (29769, grade 4) — cibles : ennemis ; déclenchement : quand le porteur subit un retrait de PM (buff 3 t.)
        - *Sous-sort «Orpaillage» (id 29769, grade 4)*
          - le lanceur lance le sort «Orpaillage» (29769, grade 6) — cibles : ennemis ; si la cible n'a pas l'état «Orpaillage IV» (5498)
            - *Sous-sort «Orpaillage» (id 29769, grade 6)*
              - le lanceur lance le sort «Orpaillage» (29769, grade 7) — cibles : ennemis ; si la cible n'a pas l'état «Orpaillage IV» (5498)
              - 10 à 12 dommages Eau (CC : 13 à 15 dommages Eau) — cibles : ennemis ; si la cible n'a pas l'état «Orpaillage IV» (5498)
      - le lanceur lance le sort «Orpaillage» (29769, grade 8) — cibles : ennemis ; déclenchement : quand le porteur gagne l'état «Orpaillage IV» (5498) / quand le porteur perd l'état «Orpaillage (compteur)» (5491) (buff 4 t.) ; indésenvoûtable
        - *Sous-sort «Orpaillage» (id 29769, grade 8)*
          - retire les effets du sort «Orpaillage» (29769) — cibles : ennemis
- **Rôle tactique** : 4 PA, relance 3 : 28–32 Eau + état : chaque tentative de retrait de PM inflige 10–12 Eau (4 fois). À poser avant Maladresse/Pelle Aurifère.
- Tags : `damage`, `water`, `combo_mp_removal`

### Paire 3 : Roulage de Pelle / Éboulement

> Choix : Éboulement (retraits de PO → dégâts Terre) ; Roulage de Pelle (sans ligne de vue).

#### 3A. Roulage de Pelle (id 13331)

- **3 PA** · PO 1–6 (modifiable) · sans LdV · 3/tour, 2/cible · CC 10 % · élément(s) : Feu
- Grades : g1 niv.1 dmg 11–13 PO1-4 ; g2 niv.68 dmg 15–18 PO1-5 ; g3 niv.134 dmg 19–23 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Feu. »
- Effets (infobulle, valeurs de base) :
  - 19 à 23 dommages Feu (CC : 24 à 29 dommages Feu)
- **Rôle tactique** : 3 PA sans ligne de vue : 19–23 Feu, 3/tour.
- Tags : `damage`, `fire`, `no_los`

#### 3B. Éboulement (id 13352)

- **4 PA** · PO 1–6 (modifiable) · LdV requise · relance 3 t. · CC 25 % · élément(s) : Terre
- Grades : g1 niv.105 dmg 25–28 PO1-5 ; g2 niv.172 dmg 31–35 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Terre et applique l'état Éboulement sur l'ennemi ciblé : • Occasionne des dommages Terre si la cible subit un retrait de Portée. Les dommages peuvent être déclenchés 4 fois tant que l'état est actif. L'état est retiré dès la limite atteinte. »
- Effets (infobulle, valeurs de base) :
  - 31 à 35 dommages Terre (CC : 37 à 42 dommages Terre)
  - applique l'état «Éboulement» (5493) — cibles : ennemis ; 3 tour(s)
  - 12 à 14 dommages Terre (CC : 15 à 17 dommages Terre) — cibles : ennemis
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 31 à 35 dommages Terre (CC : 37 à 42 dommages Terre)
  - le lanceur lance le sort «Éboulement» (29764, grade 2) — cibles : ennemis
    - *Sous-sort «Éboulement» (id 29764, grade 2)*
      - le lanceur lance le sort «Éboulement» (29764, grade 9) — cibles : ennemis
        - *Sous-sort «Éboulement» (id 29764, grade 9)*
          - applique l'état «Éboulement (compteur)» (5490) — cibles : ennemis ; 3 tour(s)
      - applique l'état «Éboulement» (5493) — cibles : ennemis ; 3 tour(s)
      - le lanceur lance le sort «Éboulement» (29764, grade 4) — cibles : ennemis ; déclenchement : quand le porteur perd de la portée (buff 3 t.)
        - *Sous-sort «Éboulement» (id 29764, grade 4)*
          - le lanceur lance le sort «Éboulement» (29764, grade 6) — cibles : ennemis ; si la cible n'a pas l'état «Éboulement IV» (5497)
            - *Sous-sort «Éboulement» (id 29764, grade 6)*
              - le lanceur lance le sort «Éboulement» (29764, grade 7) — cibles : ennemis ; si la cible n'a pas l'état «Éboulement IV» (5497)
              - 12 à 14 dommages Terre (CC : 15 à 17 dommages Terre) — cibles : ennemis ; si la cible n'a pas l'état «Éboulement IV» (5497)
      - le lanceur lance le sort «Éboulement» (29764, grade 8) — cibles : ennemis ; déclenchement : quand le porteur gagne l'état «Éboulement IV» (5497) / quand le porteur perd l'état «Éboulement (compteur)» (5490) (buff 4 t.) ; indésenvoûtable
        - *Sous-sort «Éboulement» (id 29764, grade 8)*
          - retire les effets du sort «Éboulement» (29764) — cibles : ennemis
- **Rôle tactique** : 4 PA, relance 3 : 31–35 Terre + état : chaque perte de PO inflige 12–14 Terre (4 fois) — combo avec Clef du Trésor/Lancer de Pelle/Remblai.
- Tags : `damage`, `earth`, `combo_range_removal`

### Paire 4 : Opportunité / Coup de Grisou

> Choix : Opportunité (+80 Puissance au lanceur, 2 PA) ; Coup de Grisou avec un soigneur dans l'équipe.

#### 4A. Opportunité (id 13366)

- **2 PA** · PO 1–8 (modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 5 % · élément(s) : Air
- Grades : g1 niv.1 dmg 8–10 PO1-6 ; g2 niv.69 dmg 11–13 PO1-7 ; g3 niv.136 dmg 14–16 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Air et augmente la Puissance du lanceur. »
- Effets (infobulle, valeurs de base) :
  - 14 à 16 dommages Air (CC : 17 à 19 dommages Air)
  - 80 Puissance — cibles : lanceur ; 2 tour(s)
- **Rôle tactique** : 2 PA, 8 PO : 14–16 Air et +80 Puissance au lanceur (2 tours, cumulable 2 fois).
- Tags : `damage`, `air`, `self_buff`

#### 4B. Coup de Grisou (id 13368)

- **4 PA** · PO 0–8 (non modifiable) · LdV requise, cible requise (case occupée) · relance 3 t. · CC 25 % · élément(s) : Feu
- Grades : g1 niv.110 dmg 26–29 PO0-7 ; g2 niv.177 dmg 30–34 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu aux ennemis en zone et applique l'état Coup de Grisou sur la cible : • Occasionne des dommages Feu aux ennemis en zone autour de la cible si elle est soignée. Les dommages peuvent être déclenchés 4 fois tant que l'état est actif. L'état est retiré dès la limite atteinte. »
- Effets (infobulle, valeurs de base) :
  - 30 à 34 dommages Feu (CC : 36 à 41 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
  - applique l'état «Coup de Grisou» (5496) — cibles : ennemis ; 3 tour(s)
  - 11 à 13 dommages Feu (CC : 14 à 16 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 30 à 34 dommages Feu (CC : 36 à 41 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
  - le lanceur lance le sort «Coup de Grisou» (29771, grade 2) — cibles : ennemis
    - *Sous-sort «Coup de Grisou» (id 29771, grade 2)*
      - le lanceur lance le sort «Coup de Grisou» (29771, grade 9) — cibles : alliés (hors lanceur)
        - *Sous-sort «Coup de Grisou» (id 29771, grade 9)*
          - applique l'état «Coup de Grisou (compteur)» (5492) — cibles : ennemis ; 3 tour(s)
      - applique l'état «Coup de Grisou» (5496) — cibles : ennemis ; 3 tour(s)
      - le lanceur lance le sort «Coup de Grisou» (29771, grade 4) — cibles : ennemis ; déclenchement : quand le porteur est soigné (buff 3 t.)
        - *Sous-sort «Coup de Grisou» (id 29771, grade 4)*
          - le lanceur lance le sort «Coup de Grisou» (29771, grade 7) — cibles : ennemis ; si la cible n'a pas l'état «Coup de Grisou IV» (5500)
            - *Sous-sort «Coup de Grisou» (id 29771, grade 7)*
              - applique l'état «Coup de Grisou I» (3416) — cibles : ennemis ; si la cible n'a pas l'état «Coup de Grisou I» (3416) ; si la cible n'a pas l'état «Coup de Grisou II» (3417) ; si la cible n'a pas l'état «Coup de Grisou III» (3418) ; si la cible n'a pas l'état «Coup de Grisou IV» (5500) ; si la cible n'a pas l'état «Coup de Grisou V» (5693) ; si la cible a l'état «Coup de Grisou» (5496) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou I» (3416) — cibles : ennemis ; si la cible a l'état «Coup de Grisou I» (3416)
              - applique l'état «Coup de Grisou II» (3417) — cibles : ennemis ; si la cible a l'état «Coup de Grisou I» (3416) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou II» (3417) — cibles : ennemis ; si la cible a l'état «Coup de Grisou II» (3417)
              - applique l'état «Coup de Grisou III» (3418) — cibles : ennemis ; si la cible a l'état «Coup de Grisou II» (3417) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou III» (3418) — cibles : ennemis ; si la cible a l'état «Coup de Grisou III» (3418)
              - applique l'état «Coup de Grisou IV» (5500) — cibles : ennemis ; si la cible a l'état «Coup de Grisou III» (3418) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou IV» (5500) — cibles : ennemis ; si la cible a l'état «Coup de Grisou III» (3418)
              - applique l'état «Coup de Grisou V» (5693) — cibles : ennemis ; si la cible a l'état «Coup de Grisou IV» (5500) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou V» (5693) — cibles : ennemis ; si la cible a l'état «Coup de Grisou IV» (5500)
          - le lanceur lance le sort «Coup de Grisou» (29771, grade 6) — cibles : ennemis ; si la cible n'a pas l'état «Coup de Grisou IV» (5500)
            - *Sous-sort «Coup de Grisou» (id 29771, grade 6)*
              - 11 à 13 dommages Feu (CC : 14 à 16 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1)
      - le lanceur lance le sort «Coup de Grisou» (29771, grade 8) — cibles : ennemis ; déclenchement : quand le porteur gagne l'état «Coup de Grisou IV» (5500) / quand le porteur perd l'état «Coup de Grisou (compteur)» (5492) (buff 4 t.) ; indésenvoûtable
        - *Sous-sort «Coup de Grisou» (id 29771, grade 8)*
          - retire les effets du sort «Coup de Grisou» (29771) — cibles : ennemis ; si la cible a l'état «Coup de Grisou» (5496)
  - le lanceur lance le sort «Coup de Grisou» (29772, grade 2) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Coup de Grisou» (id 29772, grade 2)*
      - le lanceur lance le sort «Coup de Grisou» (29772, grade 9) — cibles : alliés (lanceur inclus)
        - *Sous-sort «Coup de Grisou» (id 29772, grade 9)*
          - applique l'état «Coup de Grisou (compteur)» (5505) — cibles : alliés (lanceur inclus) ; 3 tour(s)
      - applique l'état «Coup de Grisou» (5496) — cibles : alliés (lanceur inclus) ; 3 tour(s)
      - le lanceur lance le sort «Coup de Grisou» (29772, grade 4) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur est soigné (buff 3 t.)
        - *Sous-sort «Coup de Grisou» (id 29772, grade 4)*
          - le lanceur lance le sort «Coup de Grisou» (29772, grade 7) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Coup de Grisou IV» (5504) ; si le lanceur n'a pas l'état «Coup de Grisou (blocage)» (6299)
            - *Sous-sort «Coup de Grisou» (id 29772, grade 7)*
              - applique l'état «Coup de Grisou I» (5501) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Coup de Grisou I» (5501) ; si la cible n'a pas l'état «Coup de Grisou II» (5502) ; si la cible n'a pas l'état «Coup de Grisou III» (5503) ; si la cible n'a pas l'état «Coup de Grisou IV» (5504) ; si la cible n'a pas l'état «Coup de Grisou V» (5693) ; si la cible a l'état «Coup de Grisou» (5496) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou I» (5501) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou I» (5501)
              - applique l'état «Coup de Grisou II» (5502) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou I» (5501) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou II» (5502) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou II» (5502)
              - applique l'état «Coup de Grisou III» (5503) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou II» (5502) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou III» (5503) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou III» (5503)
              - applique l'état «Coup de Grisou IV» (5504) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou III» (5503) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou IV» (5504) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou III» (5503)
              - applique l'état «Coup de Grisou V» (5692) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou IV» (5504) ; durée infinie ; indésenvoûtable
              - retire l'état «Coup de Grisou V» (5692) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou IV» (5504)
          - le lanceur lance le sort «Coup de Grisou» (29772, grade 6) — cibles : alliés (lanceur inclus) ; si la cible n'a pas l'état «Coup de Grisou IV» (5504) ; si le lanceur n'a pas l'état «Coup de Grisou (blocage)» (6299)
            - *Sous-sort «Coup de Grisou» (id 29772, grade 6)*
              - applique l'état «Coup de Grisou (blocage)» (6299) — cibles : lanceur ; si le lanceur n'a pas l'état «Coup de Grisou (blocage)» (6299) ; 1 tour(s) ; indésenvoûtable
              - 11 à 13 dommages Feu (CC : 14 à 16 dommages Feu) — cibles : ennemis ; si le lanceur n'a pas l'état «Coup de Grisou (blocage)» (6299) ; zone : cercle de taille 2 (à partir de 1)
              - retire l'état «Coup de Grisou (blocage)» (6299) — cibles : lanceur
      - le lanceur lance le sort «Coup de Grisou» (29772, grade 8) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur gagne l'état «Coup de Grisou IV» (5504) / quand le porteur perd l'état «Coup de Grisou (compteur)» (5505) (buff 4 t.) ; indésenvoûtable
        - *Sous-sort «Coup de Grisou» (id 29772, grade 8)*
          - retire les effets du sort «Coup de Grisou» (29772) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Coup de Grisou» (5496)
- **Rôle tactique** : 4 PA : 30–34 Feu en cercle 2 + état 3 tours sur la cible (ennemi ou allié) : à chaque soin reçu par la cible, 11–13 Feu aux ennemis en cercle 2 autour d'elle (4 fois).
- Tags : `damage`, `fire`, `aoe`, `combo_heal`

### Paire 5 : Sac Animé / Musette Animée

> Choix : Sac Animé (interception 3 tours) en général ; Musette (partage) si le groupe est serré.

#### 5A. Sac Animé (id 13328)

- **2 PA** · PO 1–5 (non modifiable) · sans LdV, case libre requise · relance 4 t. · CC 0 %
- Grades : g1 niv.5 PO1-3 ; g2 niv.72 PO1-4 ; g3 niv.139 (grade utilisé : 3).
- Description du jeu : « Invoque un Sac Animé maîtrisable qui intercepte les dommages des alliés situés dans sa zone d'invocation. Le Sac Animé est détruit 3 tours après son invocation. Lorsqu'il est attaqué par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Sac Animé» (5830, grade 3)
  - Intercepte les dommages — cibles : alliés (hors lanceur) ; zone : cercle de taille 2 ; 3 tour(s) ; déclenchement : quand le porteur subit des dommages (buff 3 t.)
  - Tue la cible — cibles : lanceur ; effet différé de 3 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Sac Animé» (5830, grade 3)
- **Rôle tactique** : 2 PA, relance 4 : Sac Animé qui intercepte pendant 3 tours les dommages des alliés en cercle 2 autour de sa case d'apparition, puis meurt.
- Tags : `summon`, `protection`, `interception`

#### 5B. Musette Animée (id 13354)

- **2 PA** · PO 1–5 (non modifiable) · sans LdV, case libre requise · relance 4 t. · CC 0 %
- Grades : g1 niv.115 PO1-4 ; g2 niv.182 (grade utilisé : 2).
- Description du jeu : « Invoque une Musette Animée maîtrisable qui partage les dommages entre tous les alliés situés dans sa zone d'invocation. La Musette Animée est détruite 2 tours après son invocation. Lorsqu'elle est attaquée par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Musette Animée» (5838, grade 2)
  - Partage les dommages — cibles : alliés (lanceur inclus) ; zone : croix sans centre de taille 1 ; 2 tour(s) ; déclenchement : quand le porteur subit des dommages
  - Tue la cible — effet différé de 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Musette Animée» (5838, grade 2)
- **Rôle tactique** : 2 PA, relance 4 : Musette Animée qui partage les dommages entre les alliés en croix autour d'elle (2 tours).
- Tags : `summon`, `protection`, `damage_share`

### Paire 6 : Ruée vers l'Or / Déambulation

> Choix : Ruée vers l'Or (+4 PM à un allié) quasi indispensable.

#### 6A. Ruée vers l'Or (id 13342)

- **2 PA** · PO 0–12 (modifiable) · sans LdV · relance 3 t. · CC 0 %
- Grades : g1 niv.10 PO0-8 ; g2 niv.77 PO0-10 ; g3 niv.144 (grade utilisé : 3).
- Description du jeu : « Augmente les PM de l'allié ciblé et lui applique l'état Ruée vers l'Or : • À la fin du tour de la cible, augmente sa Puissance au tour suivant si elle est au contact d'un ennemi et la soigne si elle est au contact d'une invocation Enutrof. »
- Effets (infobulle, valeurs de base) :
  - 4 PM — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - applique l'état «Ruée vers l'Or» (5472) — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - 150 Puissance — cibles : alliés (lanceur inclus) ; 1 tour(s) ; effet différé de 1 tour(s)
  - Soin : 10% des PV max — cibles : alliés (lanceur inclus)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Ruée vers l'Or» (29757, grade 3) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Ruée vers l'Or» (id 29757, grade 3)*
      - 4 PM — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - applique l'état «Ruée vers l'Or» (5472) — cibles : alliés (lanceur inclus) ; 1 tour(s)
      - le lanceur lance le sort «Ruée vers l'Or» (29757, grade 6) — cibles : alliés (lanceur inclus) ; déclenchement : fin de tour du porteur (buff 1 t.)
        - *Sous-sort «Ruée vers l'Or» (id 29757, grade 6)*
          - applique l'état «Ruée vers l'Or (cible)» (5474) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
          - le lanceur lance (limite globale) le sort «Ruée vers l'Or» (29757, grade 9) — cibles : ennemis ; zone : croix sans centre de taille 1
            - *Sous-sort «Ruée vers l'Or» (id 29757, grade 9)*
              - 150 Puissance — cibles : alliés (lanceur inclus) ; si la cible a l'état «Ruée vers l'Or (cible)» (5474) ; zone : toute la carte ; 1 tour(s) ; effet différé de 1 tour(s)
          - le lanceur lance (limite globale) le sort «Ruée vers l'Or» (29757, grade 10) — cibles : alliés (lanceur inclus) ; si la cible est l'un de: «Bêche Animée» (5841), «Coffre Animé» (5840), «Malle Animée» (5839), «Musette Animée» (5838), «Pelle Animée» (5834), «Sac Animé» (5830), «Pelle de Fortune» (5829) ; zone : croix sans centre de taille 1
            - *Sous-sort «Ruée vers l'Or» (id 29757, grade 10)*
              - Soin : 10% des PV max — cibles : alliés (lanceur inclus) ; si la cible a l'état «Ruée vers l'Or (cible)» (5474) ; zone : toute la carte
          - retire l'état «Ruée vers l'Or (cible)» (5474) — cibles : alliés (lanceur inclus)
          - retire l'état «Ruée vers l'Or» (5472) — cibles : alliés (lanceur inclus)
- **Rôle tactique** : 2 PA, 12 PO, relance 3 : +4 PM à un allié ; à sa fin de tour, +150 Puissance au tour suivant s'il est au contact d'un ennemi, +10 % PV s'il est au contact d'un objet animé.
- Tags : `buff_mp`, `buff_power`, `heal`

#### 6B. Déambulation (id 13356)

- **3 PA** · PO 0–6 (modifiable) · en ligne, LdV requise, cible requise (case occupée) · relance 2 t., relance initiale 1 t. · CC 0 %
- Grades : g1 niv.120 PO0-5 ; g2 niv.187 (grade utilisé : 2).
- Description du jeu : « Réduit la durée des effets sur la cible et échange sa position avec le Sac Animé ou la Musette Animée du lanceur. »
- Effets (infobulle, valeurs de base) :
  - Durée des effets : -1
  - Échange de positions
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Durée des effets : -1
  - applique l'état «Déambulation» (2229) — cibles : tous ; si la cible n'a pas l'état «Pesanteur» (7) ; 1 tour(s) ; indésenvoûtable
  - la cible lance le sort «Déambulation» (13375, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Musette Animée» (5838), «Sac Animé» (5830) ; zone : toute la carte
    - *Sous-sort «Déambulation» (id 13375, grade 1)* — critère `HS!7`, relance 0, 0/tour
      - Échange de positions — cibles : tous ; si la cible a l'état «Déambulation» (2229) ; zone : toute la carte
  - retire l'état «Déambulation» (2229) — zone : toute la carte
- **Rôle tactique** : 3 PA en ligne : réduit de 1 tour les effets de la cible et l'échange avec le Sac/Musette de l'Enutrof.
- Tags : `dispel`, `mobility`

### Paire 7 : Boîte de Pandore / Boîte à Outils

> Choix : Boîte à Outils (+3 PA/+3 PM, pacifiste) sur un soutien ; Boîte de Pandore (soin 10 % groupe, +1 PM ennemis).

#### 7A. Boîte de Pandore (id 13334)

- **2 PA** · PO 0–0 (non modifiable) · sans LdV · relance 2 t. · CC 25 %
- Grades : g1 niv.15 ; g2 niv.82 ; g3 niv.149 (grade utilisé : 3).
- Description du jeu : « Soigne tous les alliés mais augmente les PM de tous les ennemis. »
- Effets (infobulle, valeurs de base) :
  - Soin : 10% des PV max (CC : Soin : 12% des PV max) — cibles : alliés (lanceur inclus) ; zone : toute la carte
  - 1 PM — cibles : ennemis ; zone : toute la carte ; 1 tour(s)
- **Rôle tactique** : 2 PA, relance 2 : soigne 10 % PV max (12 % en CC) de tous les alliés, mais +1 PM à tous les ennemis (1 tour).
- Tags : `heal`, `group_heal`

#### 7B. Boîte à Outils (id 13357)

- **2 PA** · PO 1–6 (modifiable) · sans LdV · relance 2 t. · CC 0 %
- Grades : g1 niv.125 PO1-5 ; g2 niv.192 (grade utilisé : 2).
- Description du jeu : « Augmente les PA et les PM de l'allié ciblé mais le rend Pacifiste. Rend également toutes les invocations de l'allié ciblé Pacifistes. »
- Effets (infobulle, valeurs de base) :
  - 3 PA — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - 3 PM — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - applique l'état «Pacifiste» (218) — cibles : alliés (lanceur inclus) ; 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 3 PA — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - 3 PM — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - applique l'état «Pacifiste» (218) — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - la cible lance le sort «Boîte à Outils» (13384, grade 1) — cibles : joueurs/compagnons alliés
    - *Sous-sort «Boîte à Outils» (id 13384, grade 1)*
      - applique l'état «Pacifiste» (218) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; 1 tour(s) ; désenvoûtement fort uniquement
  - la cible lance le sort «Boîte à Outils» (13384, grade 2) — cibles : lanceur ; effet différé de 1 tour(s)
    - *Sous-sort «Boîte à Outils» (id 13384, grade 2)*
      - retire les effets du sort «Boîte à Outils» (13384) — cibles : alliés (lanceur inclus) ; zone : toute la carte
  - la cible lance le sort «Boîte à Outils» (13384, grade 3) — cibles : joueurs/compagnons alliés
    - *Sous-sort «Boîte à Outils» (id 13384, grade 3)*
      - la cible lance le sort «Boîte à Outils» (13384, grade 4) — cibles : lanceur ; déclenchement : quand le porteur invoque une créature (CI, sens déduit) (buff 1 t.) ; désenvoûtement fort uniquement
        - *Sous-sort «Boîte à Outils» (id 13384, grade 4)*
          - applique l'état «Pacifiste» (218) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible vient d'apparaître (invocation posée par ce sort) ; zone : toute la carte ; 1 tour(s) ; désenvoûtement fort uniquement
  - la cible lance le sort «Boîte à Outils» (13384, grade 2) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 1 t.) ; désenvoûtement fort uniquement
    - (sous-sort «Boîte à Outils» 13384 g2 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA : +3 PA et +3 PM (1 tour) à un allié qui devient Pacifiste (ainsi que ses invocations) : pour un soigneur/placeur/entraveur, jamais sur le DPS.
- Tags : `buff_ap`, `buff_mp`

### Paire 8 : Remblai / Feu de Mine

> Choix : Remblai (croix 3, −2 PO) ; Feu de Mine (soin des attaquants).

#### 8A. Remblai (id 13335)

- **3 PA** · PO 0–8 (modifiable) · LdV requise · 2/tour · CC 10 % · élément(s) : Terre
- Grades : g1 niv.20 dmg 12–14 PO0-6 ; g2 niv.87 dmg 16–18 PO0-7 ; g3 niv.154 dmg 20–22 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Terre et retire de la Portée en zone. Les dommages sont plus importants sur les invocations. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 20 à 22 dommages Terre (CC : 24 à 26 dommages Terre) — cibles : personnages alliés, monstres alliés, compagnons alliés, personnages ennemis, monstres ennemis, compagnons ennemis ; zone : croix de taille 3
  - 25 à 27 dommages Terre (CC : 30 à 32 dommages Terre) — cibles : invocations alliées, invocations ennemies ; zone : croix de taille 3
  - -2 Portée — cibles : alliés (hors lanceur), ennemis ; zone : croix de taille 3 ; 1 tour(s)
- **Rôle tactique** : 3 PA, croix 3 : 20–22 Terre (25–27 sur les invocations) et −2 PO, n'affecte pas le lanceur.
- Tags : `damage`, `range_removal`, `aoe`, `earth`

#### 8B. Feu de Mine (id 13355)

- **4 PA** · PO 1–6 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Feu
- Grades : g1 niv.130 dmg 29–32 PO1-5 ; g2 niv.197 dmg 32–36 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu. Les entités qui attaquent la cible sont soignées d'une partie des dommages occasionnés. »
- Effets (infobulle, valeurs de base) :
  - 32 à 36 dommages Feu (CC : 38 à 43 dommages Feu)
  - soigne l'attaquant de 15% des dommages subis — déclenchement : quand le porteur subit des dommages (buff 2 t.)
- **Rôle tactique** : 4 PA : 32–36 Feu et, pendant 2 tours, quiconque attaque la cible est soigné de 15 % des dommages.
- Tags : `damage`, `fire`, `heal_on_attack`

### Paire 9 : Clef du Trésor / Clef de Bras

> Choix : Clef de Bras (−1 PM non esquivable + soin 12 % allié) pour l'entraveur PM ; Clef du Trésor (±4 PO) sinon.

#### 9A. Clef du Trésor (id 13332)

- **2 PA** · PO 0–9 (modifiable) · LdV requise · relance 3 t. · CC 0 %
- Grades : g1 niv.25 PO0-5 ; g2 niv.92 PO0-7 ; g3 niv.159 (grade utilisé : 3).
- Description du jeu : « Retire de la Portée aux ennemis ou augmente celle de l'allié ciblé. »
- Effets (infobulle, valeurs de base) :
  - -4 Portée — cibles : ennemis ; 2 tour(s)
  - 4 Portée — cibles : alliés (lanceur inclus) ; 2 tour(s)
- **Rôle tactique** : 2 PA, relance 3 : −4 PO à un ennemi ou +4 PO à un allié (2 tours).
- Tags : `range_removal`, `buff_range`

#### 9B. Clef de Bras (id 13359)

- **2 PA** · PO 1–6 (modifiable) · LdV requise · 2/tour, 1/cible · CC 0 %
- Grades : g1 niv.135 (grade utilisé : 1).
- Description du jeu : « Soigne l'allié ciblé et retire des PM non esquivables. »
- Effets (infobulle, valeurs de base) :
  - Soin : 12% des PV max — cibles : alliés (lanceur inclus)
  - -1 PM (non esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 2 PA : −1 PM **non esquivable** (aussi sur un allié !) et soin 12 % PV max sur un allié. 2/tour, 1/cible.
- Tags : `mp_removal`, `heal`

### Paire 10 : Abattement / Obsolescence

> Choix : Abattement (−2 PA) ; Obsolescence (−20 Esquive PM) pour fiabiliser les retraits PM.

#### 10A. Abattement (id 13365)

- **3 PA** · PO 1–7 (modifiable) · LdV requise · 3/tour, 2/cible · CC 10 % · élément(s) : Air
- Grades : g1 niv.30 dmg 14–16 PO1-5 ; g2 niv.97 dmg 18–20 PO1-6 ; g3 niv.164 dmg 23–25 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Air et retire des PA. »
- Effets (infobulle, valeurs de base) :
  - 23 à 25 dommages Air (CC : 25 à 28 dommages Air)
  - -2 PA (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 3 PA, 7 PO : 23–25 Air et −2 PA esquivables, 3/tour 2/cible.
- Tags : `damage`, `ap_removal`, `air`

#### 10B. Obsolescence (id 13360)

- **3 PA** · PO 1–7 (modifiable) · LdV requise · 3/tour, 2/cible · CC 10 % · élément(s) : Eau
- Grades : g1 niv.140 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Eau et retire de l'Esquive PM. Les dommages sont plus importants sur les invocations. »
- Effets (infobulle, valeurs de base) :
  - 26 à 30 dommages Eau (CC : 31 à 36 dommages Eau) — cibles : joueurs/compagnons alliés, monstres alliés, joueurs/compagnons ennemis, monstres ennemis
  - 34 à 38 dommages Eau (CC : 40 à 45 dommages Eau) — cibles : invocations alliées, invocations ennemies
  - -20 Esquive PM — 2 tour(s)
- **Rôle tactique** : 3 PA : 26–30 Eau (34–38 sur invocation) et −20 Esquive PM 2 tours : prépare les retraits PM sur un boss.
- Tags : `damage`, `debuff`, `water`

### Paire 11 : Pelle Animée / Bêche Animée

> Choix : Pelle Animée (repousse 3) ; Bêche Animée (vol Terre + Fuite).

#### 11A. Pelle Animée (id 13344)

- **2 PA** · PO 1–6 (non modifiable) · sans LdV, case libre requise · relance 3 t. · CC 0 %
- Grades : g1 niv.35 PO1-4 ; g2 niv.102 PO1-5 ; g3 niv.169 (grade utilisé : 3).
- Description du jeu : « Invoque une Pelle Animée maîtrisable qui peut pousser. Lorsqu'elle est attaquée par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Pelle Animée» (5834, grade 3)
- **Rôle tactique** : 2 PA, relance 3 : Pelle Animée (4 PA 6 PM) qui repousse de 3 sans dommages — repositionner un ennemi ou un allié.
- Tags : `summon`, `placement`

#### 11B. Bêche Animée (id 13361)

- **2 PA** · PO 1–6 (non modifiable) · sans LdV, case libre requise · relance 3 t. · CC 0 %
- Grades : g1 niv.145 (grade utilisé : 1).
- Description du jeu : « Invoque une Bêche Animée maîtrisable qui peut voler de la vie dans l'élément Terre et donner de la Fuite. Lorsqu'elle est attaquée par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Bêche Animée» (5841, grade 1)
- **Rôle tactique** : 2 PA, relance 3 : Bêche Animée (250 Force) qui vole 31–35 Terre et donne +40 Fuite à l'Enutrof et ses invocations.
- Tags : `summon`, `damage`, `earth`

### Paire 12 : Avarice / Décadence

> Choix : Avarice (−3 PM non esquivables en cercle 3, +3 PA aux mêmes cibles) ; Décadence (−2 PA ou ±10 % DF allié).

#### 12A. Avarice (id 13362)

- **3 PA** · PO 0–0 (non modifiable) · sans LdV · relance 4 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.40 ; g2 niv.107 ; g3 niv.174 (grade utilisé : 3).
- Description du jeu : « Retire des PM non esquivables pour augmenter les PA des cibles en zone autour du lanceur. Retire également de la Puissance à toutes les entités hors de la zone d'effet pour augmenter la Puissance du lanceur pour chaque entité touchée (cumulable 10 fois). »
- Effets (infobulle, valeurs de base) :
  - -3 PM (non esquivable) — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 3 (à partir de 1) ; 1 tour(s)
  - 3 PA — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 3 (à partir de 1) ; 1 tour(s)
  - -50 Puissance — cibles : alliés (hors lanceur), ennemis ; 1 tour(s)
  - 50 Puissance — cibles : lanceur ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - la cible lance le sort «Avarice» (21911, grade 5) — cibles : lanceur
    - *Sous-sort «Avarice» (id 21911, grade 5)*
      - -3 PM (non esquivable) — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 3 ; 1 tour(s)
      - 3 PA — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 3 ; 1 tour(s)
      - -50 Puissance — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 63 (à partir de 4) ; 1 tour(s)
  - le lanceur lance le sort «Avarice» (21911, grade 6) — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 63 (à partir de 4)
    - *Sous-sort «Avarice» (id 21911, grade 6)*
      - 50 Puissance — cibles : lanceur ; 2 tour(s)
- **Rôle tactique** : 3 PA, relance 4 : −3 PM non esquivables et +3 PA aux entités (alliés et ennemis) en cercle 3 ; −50 Puissance aux entités plus loin et +50 Puissance à l'Enutrof par entité touchée. À utiliser quand les alliés sont proches et les ennemis loin, ou contre des ennemis à court de PM.
- Tags : `mp_removal`, `aoe`, `self_buff`, `debuff`

#### 12B. Décadence (id 13369)

- **2 PA** · PO 0–10 (modifiable) · LdV requise · 2/tour, 1/cible · CC 0 %
- Grades : g1 niv.150 (grade utilisé : 1).
- Description du jeu : « Retire des PA aux ennemis. Sur un allié : augmente ses dommages finaux occasionnés immédiatement mais les réduit au tour suivant. »
- Effets (infobulle, valeurs de base) :
  - -2 PA (esquivable) — cibles : ennemis ; 1 tour(s) ; désenvoûtement fort uniquement
  - 10% Dommages finaux — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - -10% Dommages finaux — cibles : alliés (lanceur inclus) ; 1 tour(s) ; effet différé de 1 tour(s)
- **Rôle tactique** : 2 PA, 10 PO : −2 PA esquivables à un ennemi, ou +10 % dommages finaux immédiats (puis −10 % au tour suivant) à un allié qui va frapper.
- Tags : `ap_removal`, `buff`

### Paire 13 : Pelle Aurifère / Tourbière

> Choix : Pelle Aurifère (−3 PM, 4 PA) : sort clé du retrait PM.

#### 13A. Pelle Aurifère (id 13343)

- **4 PA** · PO 1–7 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Eau
- Grades : g1 niv.45 dmg 21–23 PO1-5 ; g2 niv.112 dmg 27–31 PO1-6 ; g3 niv.179 dmg 33–37 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Eau et retire des PM. »
- Effets (infobulle, valeurs de base) :
  - 33 à 37 dommages Eau (CC : 40 à 44 dommages Eau)
  - -3 PM (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 4 PA : 33–37 Eau et −3 PM esquivables, 3/tour 2/cible : sort principal de retrait PM.
- Tags : `damage`, `mp_removal`, `water`

#### 13B. Tourbière (id 13358)

- **4 PA** · PO 1–8 (modifiable) · en ligne, LdV requise · 1/tour · CC 20 % · élément(s) : Terre
- Grades : g1 niv.155 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Terre en zone. Les dommages du sort sont augmentés pour chaque PM utilisé pour le tour en cours. »
- Effets (infobulle, valeurs de base) :
  - 31 à 35 dommages Terre (CC : 37 à 42 dommages Terre) — zone : ligne de 2 case(s)
  - «Tourbière» : +5 dommages de base — cibles : lanceur ; 1 tour(s) ; déclenchement : pour chaque PM dépensé par le porteur ce tour (CCMPARR, sens déduit) ; désenvoûtement fort uniquement
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 31 à 35 dommages Terre (CC : 37 à 42 dommages Terre) — zone : ligne de 2 case(s)
- **Rôle tactique** : 4 PA en ligne : 31–35 Terre en ligne de 2, +5 dommages de base par PM utilisé ce tour (mécanisme INCERTAIN).
- Tags : `damage`, `aoe`, `earth`

### Paire 14 : Maladresse / Âge d'Or

> Choix : Maladresse (1 PA, −2 PM, 4/tour) : sort clé ; Âge d'Or (+200 Puissance au tour suivant) en soutien.

#### 14A. Maladresse (id 13337)

- **1 PA** · PO 1–12 (modifiable) · LdV requise · 4/tour, 1/cible · CC 0 %
- Grades : g1 niv.50 PO1-8 ; g2 niv.117 PO1-10 ; g3 niv.184 (grade utilisé : 3).
- Description du jeu : « Retire des PM. »
- Effets (infobulle, valeurs de base) :
  - -2 PM (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 1 PA, 1–12 PO : −2 PM esquivables, 4/tour, 1/cible : le meilleur ratio retrait/PA du jeu, idéal multi-cibles.
- Tags : `mp_removal`

#### 14B. Âge d'Or (id 13329)

- **2 PA** · PO 0–6 (modifiable) · sans LdV · relance 3 t. · CC 0 %
- Grades : g1 niv.160 (grade utilisé : 1).
- Description du jeu : « Rend l'allié ciblé Intaclable. Augmente sa Puissance au tour suivant. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Intaclable» (96) — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - 200 Puissance — cibles : alliés (lanceur inclus) ; 1 tour(s) ; effet différé de 1 tour(s)
- **Rôle tactique** : 2 PA, relance 3 : allié Intaclable 1 tour (fuite du tacle) puis +200 Puissance au tour suivant.
- Tags : `buff_power`, `unblock`

### Paire 15 : Pelle Fantomatique / Dernier Recours

> Choix : Pelle Fantomatique (réduit la durée des effets = désenvoûtement partiel) ; Dernier Recours (Pesanteur de zone).

#### 15A. Pelle Fantomatique (id 13336)

- **3 PA** · PO 0–8 (modifiable) · LdV requise · 2/tour, 1/cible · CC 10 % · élément(s) : Feu
- Grades : g1 niv.55 dmg 17–19 PO0-6 ; g2 niv.122 dmg 23–25 PO0-7 ; g3 niv.189 dmg 26–28 (grade utilisé : 3).
- Description du jeu : « Réduit la durée des effets sur la cible et occasionne des dommages Feu aux ennemis. »
- Effets (infobulle, valeurs de base) :
  - Durée des effets : -1
  - 26 à 28 dommages Feu (CC : 31 à 34 dommages Feu) — cibles : ennemis
- **Rôle tactique** : 3 PA : réduit de 1 la durée des effets de la cible (allié ou ennemi : retirer des buffs ennemis/débuffs alliés) + 26–28 Feu aux ennemis.
- Tags : `damage`, `dispel`, `fire`

#### 15B. Dernier Recours (id 13372)

- **3 PA** · PO 0–7 (non modifiable) · LdV requise, cible requise (case occupée) · relance 2 t. · CC 20 % · élément(s) : Air
- Grades : g1 niv.165 (grade utilisé : 1).
- Description du jeu : « Applique l'état Pesanteur sur les cibles et occasionne des dommages Air aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Pesanteur» (7) — zone : cercle de taille 2 ; 1 tour(s) ; indésenvoûtable
  - 30 à 34 dommages Air (CC : 36 à 41 dommages Air) — cibles : ennemis ; zone : cercle de taille 2
- **Rôle tactique** : 3 PA, relance 2 : Pesanteur en cercle 2 (empêche téléportations/échanges, y compris des alliés) + 30–34 Air aux ennemis.
- Tags : `control`, `damage`, `aoe`, `air`

### Paire 16 : Banqueroute / Lancer de Pelle

> Choix : Banqueroute (−20 Esquive PA, gros dégâts Air) ; Lancer de Pelle (−4 PO).

#### 16A. Banqueroute (id 14278)

- **4 PA** · PO 1–8 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Air
- Grades : g1 niv.60 dmg 26–29 PO1-6 ; g2 niv.127 dmg 32–36 PO1-7 ; g3 niv.194 dmg 36–40 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Air et retire de l'Esquive PA. Les dommages sont plus importants sur les invocations. »
- Effets (infobulle, valeurs de base) :
  - 36 à 40 dommages Air (CC : 43 à 48 dommages Air) — cibles : joueurs/compagnons alliés, monstres alliés, joueurs/compagnons ennemis, monstres ennemis
  - 47 à 51 dommages Air (CC : 55 à 60 dommages Air) — cibles : invocations alliées, invocations ennemies
  - -20 Esquive PA — 2 tour(s)
- **Rôle tactique** : 4 PA : 36–40 Air (47–51 sur invocation) et −20 Esquive PA 2 tours.
- Tags : `damage`, `debuff`, `air`

#### 16B. Lancer de Pelle (id 13330)

- **4 PA** · PO 1–8 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Terre
- Grades : g1 niv.170 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Terre et retire de la Portée. »
- Effets (infobulle, valeurs de base) :
  - 34 à 37 dommages Terre (CC : 41 à 44 dommages Terre)
  - -4 Portée — 1 tour(s)
- **Rôle tactique** : 4 PA : 34–37 Terre et −4 PO (1 tour).
- Tags : `damage`, `range_removal`, `earth`

### Paire 17 : Souterrain / Bêche des Anciens

> Choix : Bêche des Anciens (−2 PA en croix 2 + repousse) ; Souterrain (échange) pour la mobilité.

#### 17A. Souterrain (id 13364)

- **3 PA** · PO 1–4 (non modifiable) · en ligne, sans LdV · 2/tour, 1/cible · CC 10 % · élément(s) : Terre
- Grades : g1 niv.65 dmg 19–22 PO1-3 ; g2 niv.131 dmg 23–26 ; g3 niv.198 dmg 26–29 (grade utilisé : 3).
- Description du jeu : « Échange de position avec la cible et occasionne des dommages Terre aux ennemis. »
- Effets (infobulle, valeurs de base) :
  - Échange de positions
  - 26 à 29 dommages Terre (CC : 31 à 35 dommages Terre) — cibles : ennemis
- **Rôle tactique** : 3 PA en ligne sans LdV : échange de place avec la cible + 26–29 Terre aux ennemis.
- Tags : `mobility`, `damage`, `earth`

#### 17B. Bêche des Anciens (id 13367)

- **4 PA** · PO 1–7 (non modifiable) · LdV requise · 2/tour · CC 15 % · élément(s) : Air
- Grades : g1 niv.175 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Air et retire des PA aux ennemis et repousse les cibles depuis le centre en zone. »
- Effets (infobulle, valeurs de base) :
  - 32 à 36 dommages Air (CC : 38 à 43 dommages Air) — cibles : ennemis ; zone : croix de taille 2
  - -2 PA (esquivable) — cibles : ennemis ; zone : croix de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
  - Repousse de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 2
- **Rôle tactique** : 4 PA : 32–36 Air en croix 2, −2 PA esquivables et repousse de 2 depuis le centre.
- Tags : `damage`, `ap_removal`, `placement`, `aoe`, `air`

### Paire 18 : Pelle des Anciens / Gisement

> Choix : Pelle des Anciens (−1 PM + repousse 2) ; Gisement (soin de début de tour en zone).

#### 18A. Pelle des Anciens (id 13345)

- **4 PA** · PO 1–7 (modifiable) · LdV requise · 3/tour, 1/cible · CC 15 % · élément(s) : Eau
- Grades : g1 niv.70 dmg 31–34 PO1-6 ; g2 niv.137 dmg 40–44 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Eau et retire des PM aux ennemis et repousse la cible. »
- Effets (infobulle, valeurs de base) :
  - 40 à 44 dommages Eau (CC : 48 à 53 dommages Eau) — cibles : ennemis
  - -1 PM (esquivable) — cibles : ennemis ; 1 tour(s) ; désenvoûtement fort uniquement
  - Repousse de 2 cases
- **Rôle tactique** : 4 PA : 40–44 Eau, −1 PM esquivable et repousse de 2 (1/cible) : gros dégât Eau + éloignement.
- Tags : `damage`, `mp_removal`, `placement`, `water`

#### 18B. Gisement (id 14273)

- **3 PA** · PO 0–8 (non modifiable) · LdV requise · 1/tour · CC 15 % · élément(s) : Feu
- Grades : g1 niv.180 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Feu aux ennemis et soigne les alliés au début de leur tour en zone. »
- Effets (infobulle, valeurs de base) :
  - 29 à 32 dommages Feu (CC : 35 à 38 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
  - 29 à 32 soins Feu (CC : 35 à 38 soins Feu) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; déclenchement : début de tour du porteur (buff 1 t.)
- **Rôle tactique** : 3 PA : 29–32 Feu aux ennemis en cercle 2 et soin 29–32 Feu aux alliés de la zone au début de leur prochain tour.
- Tags : `damage`, `heal`, `aoe`, `fire`

### Paire 19 : Péremption / Tamisage

> Choix : Tamisage (−2 PM en carré) pour l'entrave ; Péremption pour le burst Feu.

#### 19A. Péremption (id 13333)

- **4 PA** · PO 1–5 (modifiable) · LdV requise · 2/tour, 1/cible · CC 15 % · élément(s) : Feu
- Grades : g1 niv.75 dmg 33–35 PO1-4 ; g2 niv.142 dmg 41–44 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu. Occasionne des dommages Feu supplémentaires aux invocations. »
- Effets (infobulle, valeurs de base) :
  - 41 à 44 dommages Feu (CC : 49 à 53 dommages Feu)
  - 41 à 44 dommages Feu (CC : 49 à 53 dommages Feu) — cibles : invocations ennemies, invocations alliées
- **Rôle tactique** : 4 PA : 41–44 Feu, et autant en plus sur une invocation (≈ ×2) : tueur d'invocations.
- Tags : `damage`, `fire`, `anti_summon`

#### 19B. Tamisage (id 13370)

- **3 PA** · PO 0–5 (modifiable) · LdV requise · 1/tour · CC 15 % · élément(s) : Eau
- Grades : g1 niv.185 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Eau et retire des PM en zone. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 25 à 29 dommages Eau (CC : 30 à 35 dommages Eau) — cibles : alliés (hors lanceur), ennemis ; zone : carré de taille 1
  - -2 PM (esquivable) — cibles : alliés (hors lanceur), ennemis ; zone : carré de taille 1 ; 1 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 3 PA, carré 1 (pas le lanceur) : 25–29 Eau et −2 PM esquivables à tout le monde dans la zone (attention aux alliés).
- Tags : `damage`, `mp_removal`, `aoe`, `water`

### Paire 20 : Corruption / Tunnel de Fortune

> Choix : Corruption (ennemi pacifiste + invulnérable 1 tour) ; Tunnel de Fortune (invisibilité + Puissance).

#### 20A. Corruption (id 13346)

- **5 PA** · PO 4–8 (modifiable) · LdV requise · relance 5 t., relance initiale 1 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.80 PO4-6 relance6 ; g2 niv.147 (grade utilisé : 2).
- Description du jeu : « Rend l'ennemi ciblé Pacifiste et Invulnérable. Sur un allié : le rend Pacifiste et le soigne. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Pacifiste» (218) — 1 tour(s) ; indésenvoûtable
  - applique l'état «Invulnérable» (269) — cibles : ennemis ; 1 tour(s) ; indésenvoûtable
  - Soin : 40% des PV max — cibles : alliés (lanceur inclus)
- **Rôle tactique** : 5 PA, PO 4–8, relance 5 : l'ennemi ciblé devient Pacifiste ET Invulnérable 1 tour (sortir le boss du combat un tour) ; sur un allié : Pacifiste + soin 40 %.
- Tags : `control`, `neutralize`, `heal`

#### 20B. Tunnel de Fortune (id 14274)

- **3 PA** · PO 0–0 (non modifiable) · sans LdV · relance 4 t. · CC 0 %
- Grades : g1 niv.190 (grade utilisé : 1).
- Description du jeu : « Rend le lanceur invisible et lui applique l'état Tunnel de Fortune : • Augmente sa Puissance au tour suivant pour chaque PM qu'il a utilisé. »
- Effets (infobulle, valeurs de base) :
  - Rend la cible invisible — cibles : lanceur ; 1 tour(s)
  - applique l'état «Tunnel de Fortune» (5473) — cibles : lanceur ; 1 tour(s)
  - 20 Puissance — cibles : lanceur ; 1 tour(s) ; effet différé de 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Tunnel de Fortune» (29756, grade 1) — cibles : lanceur
    - *Sous-sort «Tunnel de Fortune» (id 29756, grade 1)*
      - Rend la cible invisible — cibles : lanceur ; 1 tour(s)
      - applique l'état «Tunnel de Fortune» (5473) — cibles : lanceur ; 1 tour(s)
      - le lanceur lance le sort «Tunnel de Fortune» (29756, grade 2) — cibles : lanceur ; déclenchement : pour chaque PM dépensé par le porteur ce tour (CCMPARR, sens déduit) (buff 1 t.)
        - *Sous-sort «Tunnel de Fortune» (id 29756, grade 2)*
          - la cible lance le sort «Tunnel de Fortune» (29756, grade 3) — cibles : lanceur ; effet différé de 1 tour(s)
            - *Sous-sort «Tunnel de Fortune» (id 29756, grade 3)*
          - 20 Puissance — cibles : lanceur ; 1 tour(s) ; effet différé de 1 tour(s)
- **Rôle tactique** : 3 PA, relance 4 : l'Enutrof devient invisible 1 tour et gagne +20 Puissance au tour suivant par PM dépensé.
- Tags : `stealth`, `self_buff`

### Paire 21 : Retraite Anticipée / Pelle de Fortune

> Choix : Retraite Anticipée (−100 PM à tout le terrain sauf l'Enutrof) ; Pelle de Fortune (boost Puissance/Retrait).

#### 21A. Retraite Anticipée (id 13349)

- **4 PA** · PO 0–0 (non modifiable) · sans LdV · relance 7 t., relance initiale 1 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.85 relance8 ; g2 niv.152 (grade utilisé : 2).
- Description du jeu : « Immobilise les cibles et applique l'état Pesanteur sur tout le monde sauf le lanceur. Immobilise le lanceur au tour suivant. »
- Effets (infobulle, valeurs de base) :
  - -100 PM (non esquivable) — cibles : ennemis, alliés (hors lanceur) ; zone : cercle de taille 63 ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Pesanteur» (7) — cibles : ennemis, alliés (hors lanceur) ; zone : toute la carte ; 1 tour(s) ; indésenvoûtable
  - -100 PM (non esquivable) — cibles : lanceur ; 1 tour(s) ; effet différé de 1 tour(s) ; indésenvoûtable
- **Rôle tactique** : 4 PA, relance 7 : −100 PM non esquivables + Pesanteur à toutes les entités sauf l'Enutrof (1 tour), qui subit −100 PM au tour suivant. Tour de sécurité absolue contre la mêlée.
- Tags : `control`, `mp_removal`, `global`

#### 21B. Pelle de Fortune (id 29755)

- **2 PA** · PO 1–7 (modifiable) · LdV requise, case libre requise · 1/tour · CC 0 %
- Grades : g1 niv.195 (grade utilisé : 1).
- Description du jeu : « Invoque une Pelle de Fortune statique. Lorsqu'elle est invoquée, puis à chaque début de tour, elle augmente la Puissance, la Fuite, le Retrait PA et le Retrait PM du lanceur. La Pelle de Fortune est détruite 2 tours après son invocation en soignant le lanceur. Lorsqu'elle est attaquée par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Pelle de Fortune» (5829, grade 1)
  - le lanceur lance le sort «Pelle de Fortune» (28586, grade 1)
  - Soin : 8% des PV max — cibles : lanceur ; effet différé de 2 tour(s)
  - Tue la cible — cibles : lanceur ; effet différé de 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Pelle de Fortune» (5829, grade 1)
- **Rôle tactique** : 2 PA : Pelle de Fortune statique qui donne +40 Puissance, +10 Fuite, +10 Retrait PA/PM à l'Enutrof à chaque début de tour (2 tours), puis le soigne de 8 % en mourant.
- Tags : `summon`, `self_buff`, `heal`

### Paire 22 : Coffre Animé / Malle Animée

> Choix : Coffre Animé (tacle, révèle les invisibles) ; Malle Animée (soin de zone).

#### 22A. Coffre Animé (id 13347)

- **3 PA** · PO 1–3 (non modifiable) · LdV requise, case libre requise · relance 4 t. · CC 0 %
- Grades : g1 niv.90 PO1-2 ; g2 niv.157 (grade utilisé : 2).
- Description du jeu : « Invoque un Coffre Animé maîtrisable qui peut tacler, occasionner des dommages Eau et dévoiler les invisibles. Lorsqu'il est attaqué par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Coffre Animé» (5840, grade 2)
- **Rôle tactique** : 3 PA, relance 4 : Coffre Animé (250 Chance, 30 % rés.) qui tacle, frappe en Eau selon ses PV manquants et révèle les invisibles.
- Tags : `summon`, `tank`, `damage`, `reveal`

#### 22B. Malle Animée (id 13371)

- **3 PA** · PO 1–3 (non modifiable) · LdV requise, case libre requise · relance 4 t. · CC 0 %
- Grades : g1 niv.200 (grade utilisé : 1).
- Description du jeu : « Invoque une Malle Animée maîtrisable qui peut soigner. Lorsqu'elle est attaquée par un allié, ce dernier est soigné. »
- Effets (infobulle, valeurs de base) :
  - invoque «Malle Animée» (5839, grade 1)
- **Rôle tactique** : 3 PA, relance 4 : Malle Animée qui soigne 8 % PV max des alliés en cercle 2 (2/tour).
- Tags : `summon`, `heal`

## Invocations de la classe

Objets animés : tous utilisent un emplacement d'invocation (coût 1) sauf la Pelle de Fortune (statique). Leurs PV
viennent en pourcentage des PV de l'Enutrof (`bonusCharacteristics`, INCERTAIN) et tous portent le passif « Trésor
d'Enutrof » (un allié qui les frappe est soigné de 50 % des dommages).

#### Pelle de Fortune (monstre 5829)

- Utilise un emplacement d'invocation : non · joue son tour : non · tacle : non · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 0, PM -1, PV de base 0, rés. % Terre 0 / Feu 0 / Eau 0 / Air 0 / Neutre 0, bonus hérités de l'invocateur (en %) {'lifePoints': 30}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 25], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 81285, sort 30775 «Pelle de Fortune») :
  - la cible lance le sort «Pelle de Fortune» (23516, grade 1) — cibles : lanceur
    - *Sous-sort «Pelle de Fortune» (id 23516, grade 1)*
      - le lanceur lance le sort «Pelle de Fortune» (23516, grade 2) — cibles : lanceur
        - *Sous-sort «Pelle de Fortune» (id 23516, grade 2)*
          - la cible lance le sort «Pelle de Fortune» (28584, grade 2) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
            - *Sous-sort «Pelle de Fortune» (id 28584, grade 2)*
          - le lanceur lance le sort «Pelle de Fortune» (28584, grade 1) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
            - *Sous-sort «Pelle de Fortune» (id 28584, grade 1)*
              - 40 Puissance — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; 2 tour(s) ; indésenvoûtable
              - 10 Fuite — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; 2 tour(s) ; indésenvoûtable
              - 10 Retrait PA — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; 2 tour(s) ; indésenvoûtable
              - 10 Retrait PM — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; 2 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Pelle de Fortune» (23516, grade 1) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; déclenchement : début de tour du porteur (buff 63 t.) ; indésenvoûtable
        - (sous-sort «Pelle de Fortune» 23516 g1 déjà détaillé plus haut)
  - la cible lance le sort «Trésor d'Enutrof» (13376, grade 1) — cibles : lanceur
    - *Sous-sort «Trésor d'Enutrof» (id 13376, grade 1)*
      - soigne l'attaquant de 50% des dommages subis — cibles : lanceur ; déclenchement : quand le porteur subit des dommages d'un allié (buff 63 t.) ; désenvoûtement fort uniquement
  - Soin : 8% des PV max — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; effet différé de 2 tour(s)
  - Tue la cible — cibles : lanceur ; effet différé de 2 tour(s)

#### Sac Animé (monstre 5830)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 3 (invoqué par les sorts de la classe) : PA 5, PM 6, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 60}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 80], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41757, sort 13351 «Sac Rifice») :
  - Intercepte les dommages — cibles : alliés (hors lanceur) ; zone : cercle de taille 2 ; 3 tour(s) ; déclenchement : quand le porteur subit des dommages (buff 3 t.)
  - Tue la cible — cibles : lanceur ; effet différé de 3 tour(s)
  - applique l'état «Sacrifice» (583) — cibles : alliés (hors lanceur) ; zone : cercle de taille 2 ; 3 tour(s)
  - le lanceur lance le sort «Trésor d'Enutrof» (13376, grade 1) — cibles : lanceur
    - (sous-sort «Trésor d'Enutrof» 13376 g1 déjà détaillé plus haut)

#### Pelle Animée (monstre 5834)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 3 (invoqué par les sorts de la classe) : PA 4, PM 6, PV de base 0, rés. % Terre 15 / Feu 15 / Eau 15 / Air 15 / Neutre 15, stats fixes {'wisdom': 90}, bonus hérités de l'invocateur (en %) {'lifePoints': 90}
- Variation par grade : g1 PA4/PM4, g2 PA4/PM5, g3 PA4/PM6, g4 PA4/PM6, g5 PA4/PM6, g6 PA4/PM6
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 180], [10, 0.125], [11, 0], [12, 7.5], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41782, sort 13376 «Trésor d'Enutrof») :
  - soigne l'attaquant de 50% des dommages subis — cibles : lanceur ; déclenchement : quand le porteur subit des dommages d'un allié (buff 63 t.) ; désenvoûtement fort uniquement
- Sort «Déblayage» (id 13348) : 3 PA, PO 1–1, sans LdV, 3/tour, CC 0 %
  - Repousse de 3 cases (sans dommages)

#### Musette Animée (monstre 5838)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 5, PM 6, PV de base 0, rés. % Terre 25 / Feu 25 / Eau 25 / Air 25 / Neutre 25, bonus hérités de l'invocateur (en %) {'lifePoints': 60}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 200], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41779, sort 13373 «Butin Partagé») :
  - Partage les dommages — cibles : alliés (lanceur inclus) ; zone : croix sans centre de taille 1 ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - Tue la cible — cibles : lanceur ; effet différé de 2 tour(s)
  - le lanceur lance le sort «Trésor d'Enutrof» (13376, grade 1) — cibles : lanceur
    - (sous-sort «Trésor d'Enutrof» 13376 g1 déjà détaillé plus haut)
  - applique l'état «Sacrifice» (583) — cibles : alliés (lanceur inclus) ; zone : croix sans centre de taille 1 ; 2 tour(s)

#### Malle Animée (monstre 5839)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 5, PV de base 0, rés. % Terre 15 / Feu 15 / Eau 15 / Air 15 / Neutre 15, stats fixes {'wisdom': 90}, bonus hérités de l'invocateur (en %) {'lifePoints': 120}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 149.99600219726562], [10, 0.125], [11, 0], [12, 7.5], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41782, sort 13376 «Trésor d'Enutrof») :
  - soigne l'attaquant de 50% des dommages subis — cibles : lanceur ; déclenchement : quand le porteur subit des dommages d'un allié (buff 63 t.) ; désenvoûtement fort uniquement
- Sort «Malle aux Trésors» (id 13381) : 3 PA, PO 0–0, sans LdV, 2/tour, CC 0 %
  - Soin : 8% des PV max — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 (à partir de 1)

#### Coffre Animé (monstre 5840)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 5, PM 5, PV de base 0, rés. % Terre 30 / Feu 30 / Eau 30 / Air 30 / Neutre 30, stats fixes {'chance': 250}, bonus hérités de l'invocateur (en %) {'lifePoints': 120}
- Variation par grade : g1 PA5/PM5, g2 PA5/PM5, g3 PA5/PM5, g4 PA5/PM5, g5 PA5/PM5, g6 PA5/PM7
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 200], [10, 0.125], [11, 0], [12, 0.125], [13, 18.75], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41782, sort 13376 «Trésor d'Enutrof») :
  - soigne l'attaquant de 50% des dommages subis — cibles : lanceur ; déclenchement : quand le porteur subit des dommages d'un allié (buff 63 t.) ; désenvoûtement fort uniquement
- Sort «Prospection» (id 13350) : 4 PA, PO 0–0, sans LdV, CC 0 %
  - 8 à 10 dommages Eau — cibles : ennemis ; zone : croix sans centre de taille 1
  - Dommages Eau : 100% PV manquants du lanceur — cibles : ennemis ; zone : croix sans centre de taille 1
  - Dévoile les entités invisibles — cibles : ennemis ; zone : cercle de taille 3

#### Bêche Animée (monstre 5841)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 6, PV de base 0, rés. % Terre 15 / Feu 15 / Eau 15 / Air 15 / Neutre 15, stats fixes {'strength': 250, 'agility': 100, 'wisdom': 90}, bonus hérités de l'invocateur (en %) {'lifePoints': 90}
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 320], [10, 31.25], [11, 0], [12, 11.25], [13, 31.25], [14, 31.25], [15, 31.25], [19, 1], [23, 1], [25, 0.125]]`
- Sort passif lancé à l'apparition (spell-level 41782, sort 13376 «Trésor d'Enutrof») :
  - soigne l'attaquant de 50% des dommages subis — cibles : lanceur ; déclenchement : quand le porteur subit des dommages d'un allié (buff 63 t.) ; désenvoûtement fort uniquement
- Sort «Bêchattaque» (id 13377) : 2 PA, PO 1–5, en ligne, LdV, CC 20 %
  - 31 à 35 vol Terre (CC : 36 à 40 vol Terre)
  - 40 Fuite — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; 2 tour(s)

## L'Enutrof en groupe PvM (niveau 200, 4 personnages)

### Rôles possibles
1. **Entraveur PM (rôle phare)** : immobiliser les monstres de mêlée/le boss (Maladresse ×4, Pelle Aurifère ×2,
   Tamisage, Clef de Bras, Retraite Anticipée pour un tour critique). Exemple demandé par l'utilisateur : « un Enutrof qui
   s'occupe principalement d'enlever les PM des monstres ».
2. **Entraveur PA/PO** : Abattement, Bêche des Anciens, Décadence (−2 PA) ; Clef du Trésor (−4 PO), Lancer de Pelle (−4 PO).
3. **Soutien** : Ruée vers l'Or (+4 PM), Boîte à Outils (+3 PA/+3 PM sur un soutien), Âge d'Or (+200 Puissance au DPS),
   Boîte de Pandore (soin de groupe), Corruption (neutralise le boss un tour), objets animés (interception, partage, soin).
4. **DPS d'entrave** : Monnaie Sonnante / Orpaillage / Éboulement / Coup de Grisou + retraits = dégâts réguliers.

### Voie conseillée
- **Eau** (Chance) : Pelle Aurifère (−3 PM, 33–37), Tamisage, Pelle des Anciens, Lancer de Pièces 6/tour, Orpaillage :
  la voie de retrait PM par excellence. **Eau/Air** (Chance + Agilité) ajoute Abattement, Bêche des Anciens, Monnaie
  Sonnante, Banqueroute. **Eau/Terre** ajoute Lancer de Pelle (−4 PO) et Éboulement.
- Stats prioritaires : **Retrait PM / Retrait PA** (et Sagesse si elle contribue au retrait — INCERTAIN), PA 11–12, PO
  (Maladresse et Lancer de Pièces ont PO modifiable jusqu'à 12), PM 5–6, Vitalité, élément principal.

### Choix de variantes par rôle
| Paire | Entraveur PM | Entraveur PA/PO + DPS | Soutien |
|---|---|---|---|
| 1 Lancer de Pièces / Monnaie Sonnante | A | B | A |
| 2 Force de l'Âge / Orpaillage | B | B | A |
| 3 Roulage de Pelle / Éboulement | A | B | A |
| 4 Opportunité / Coup de Grisou | A | A | B |
| 5 Sac Animé / Musette Animée | A | A | A |
| 6 Ruée vers l'Or / Déambulation | A | A | A |
| 7 Boîte de Pandore / Boîte à Outils | B | A | B |
| 8 Remblai / Feu de Mine | A | A | A |
| 9 Clef du Trésor / Clef de Bras | B | A | A |
| 10 Abattement / Obsolescence | B | A | A |
| 11 Pelle Animée / Bêche Animée | A | B | A |
| 12 Avarice / Décadence | A | B | B |
| 13 Pelle Aurifère / Tourbière | A | A | A |
| 14 Maladresse / Âge d'Or | A | A | B |
| 15 Pelle Fantomatique / Dernier Recours | A | B | A |
| 16 Banqueroute / Lancer de Pelle | A | B | A |
| 17 Souterrain / Bêche des Anciens | B | B | A |
| 18 Pelle des Anciens / Gisement | A | A | B |
| 19 Péremption / Tamisage | B | A | B |
| 20 Corruption / Tunnel de Fortune | A | A | A |
| 21 Retraite Anticipée / Pelle de Fortune | A | B | A |
| 22 Coffre Animé / Malle Animée | A | A | B |

### Rotations types (12 PA / 6 PM)
- **Entrave PM mono-cible (boss)** : Obsolescence (3, −20 Esquive PM) → Pelle Aurifère ×2 (8, −3 PM ×2) → Maladresse (1).
  Avec Orpaillage préalable (4) : chaque tentative déclenche 10–12 Eau.
- **Entrave PM multi-cibles** : Maladresse ×4 (4 PA, −2 PM sur 4 cibles différentes) → Pelle Aurifère (4) → Tamisage (3,
  carré 1) ou Clef de Bras (2, −1 PM non esquivable).
- **Tour critique** : Retraite Anticipée (4) → tous les ennemis à −100 PM et sous Pesanteur ; puis Ruée vers l'Or (2) sur le
  DPS (+4 PM) et Âge d'Or (2) sur lui (+200 Puissance au tour suivant) + Maladresse ×4.
- **Soutien** : Boîte à Outils (2) sur l'Osamodas/soigneur (+3 PA/+3 PM) → Ruée vers l'Or (2) sur le DPS → Pelle de Fortune
  (2) → Pelle Aurifère (4) → Maladresse ×2.

### Forces / faiblesses
Forces : meilleur retrait de PM à distance du jeu (jusqu'à −8 PM tentés par tour sur 4 cibles + −3 PM non esquivables en
zone), retraits de PA et PO, boosts PM/PA/Puissance, neutralisation d'un ennemi (Corruption) ou de tout le terrain (Retraite
Anticipée), objets animés protecteurs, très longue portée (Maladresse/Lancer de Pièces jusqu'à 12 PO).
Faiblesses : retraits esquivables dépendants du Retrait PM vs Esquive PM des monstres (boss à forte esquive), dégâts
moyens, peu de mobilité (Souterrain, Déambulation), Avarice et Boîte de Pandore ont des contreparties qui profitent aux ennemis.

### Synergies
- **Féca** : auras Terre Brûlée (−3 PM) / Terre Battue (−3 PA) qui s'ajoutent ; armures et boucliers pour l'Enutrof fragile.
- **Xélor / Sram / Féca** (retraits PA/PM) : alimentent Monnaie Sonnante et Orpaillage (déclenchés par toutes les tentatives).
- **Eniripsa / Osamodas** : soins qui déclenchent Coup de Grisou posé sur un allié.
- **Iop / Crâ / DPS** : Ruée vers l'Or (+4 PM), Âge d'Or (+200 Puissance), Décadence (+10 % DF) ; ennemis immobilisés à
  distance (kiting).
- **Osamodas** : Boîte à Outils sur une créature 3 PI (pacifiste mais +3 PA/+3 PM pour se placer/bloquer).

## Points incertains (INCERTAIN)

- Formule de retrait PA/PM (jet par point, 10–90 %) issue d'émulateurs Dofus 2.
- Nombre de déclenchements de Monnaie Sonnante/Orpaillage par effet de retrait (1 par effet supposé).
- Mécanisme réel de Tourbière (+5 dommages de base par PM utilisé) : effet uniquement d'affichage dans les données.
- PV des objets animés (bonusCharacteristics.lifePoints = % des PV de l'Enutrof).
- Sens de « durée 1 tour » pour les malus d'Avarice/Retraite Anticipée (jusqu'au prochain tour de l'Enutrof).

## Sources
- Données de jeu : https://api.dofusdb.fr/breeds/3, https://api.dofusdb.fr/spell-variants?breedId=3, `/spells`,
  `/spell-levels`, `/spell-states`, `/monsters` (5829, 5830, 5834, 5838–5841), consultées le 2026-10-04.
- Formule de retrait PA/PM (jet par point, bornes 10–90 %) : émulateurs Dofus 2 mis en cache (`.cache/domath/other/otomai.FightActor.cs`,
  `giny.Fighter.cs`) — INCERTAIN pour Dofus 3.
- Déclencheurs APA/MPA/R/H : code DoMath/Bubble `HaxeBuff.ShouldBeTriggeredOnTarget` (cache `.cache/domath/haxe`), https://domath.fr
- Contexte PvM : https://www.gamosaurus.com/jeux/dofus/dofus-unity-guide-du-stuff-enutrof , https://www.gamosaurus.com/?p=118412 (refonte 2.63)
- Noms des actions : https://github.com/PyDofus/pydofus3 (`ActionId.py`).

