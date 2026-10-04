# Sacrieur — analyse complète pour DofusSimu (breed 11)

> « Berserker ». Données : API DofusDB (fichiers du jeu, mise à jour du 23/06/2026) — `https://api.dofusdb.fr/breeds/11`,
> `https://api.dofusdb.fr/spell-variants?breedId=11`, `spells` (dont le passif **Souffrance** 24150 et ses sous-sorts 14087,
> 13981–13990), `spell-levels`, `spell-states`, `monsters` (Épée Vorace 434, Épée Dansante 5192). Cache brut : `.cache/classes/csps/`.
> Rôles officiels (breedRoles) : **Tank 12** (« maintient ses cibles au contact, vole de la vie et exploite sa Souffrance »),
> **Dommages 8** (« courte portée »), **Placement 7** (« attire, repousse, échange de position, se téléporte »), Protection 6
> (INCERTAIN), Soin 3, Invocation 2, Entrave 2, Boost 2. Complexité 1/3.

## 1. Vue d'ensemble

- **Profil** : combattant de mêlée qui devient **plus fort et plus résistant à mesure qu'il perd des PV** (passif Souffrance),
  se soigne par **vols de vie** (Absorption, Supplice, Stase, Hémorragie, Dissolution, Désolation, Bain de Sang, Hécatombe,
  Folie Sanguinaire) et **sacrifie sa vie** (Mutilation, Carnage, Déchaînement, Immolation, Entaille, Libation, Berserk, Châtiment)
  pour des dégâts massifs. 4 éléments + Neutre (dégâts selon PV / PV érodés).
- **Placement** : Attirance (attire de 9, ou 13 en Souffrance ≥ 6, po 2–10 en ligne), Transposition (échange po 1–9, +4 en S6+),
  Assaut (échange + Air), Pénitence (échanges déclenchés), Liens du Sang (se rapproche), Ravage (avance de 5), Fulgurance
  (téléport en ligne), Projection (téléport symétrique), Condensation/Afflux (attirent en zone), Hostilité/Aversion (repoussent).
- **Tank** : réduction de dommages subis jusqu'à ×70 % (Souffrance 10), Sacrifice (intercepte les dommages des alliés en cercle 2),
  Couronne d'Épines (renvoie 100 % des dommages de mêlée, bouclier 10 % + 5 %/ennemi en S6+), Pilori (bouclier allié + Indéplaçable),
  Bain de Sang (+15 Tacle par entité adjacente), Fluctuation (Intaclable + PM).
- **Invocations** : Épée Vorace (vol de vie Neutre + soins) / Épée Dansante (attire, échange, Fuite) — 4 PA / 4–5 PM,
  `bonusCharacteristics.lifePoints` = 120 (INCERTAIN : % des PV du Sacrieur), elles bénéficient aussi des paliers de Souffrance.

## 2. Mécaniques spécifiques à implémenter (moteur)

### 2.1 Souffrance (passif de classe, sort 24150)

Le palier dépend du **pourcentage de PV actuels / PV max** du Sacrieur ; il est recalculé (sous-sort 14087) à chaque variation de PV,
début/fin de tour, soin, etc. Chaque palier pose un état (616–625) et deux effets permanents (non désenvoûtables) :

| Palier | PV restants | Dommages subis (1163) | Dommages finaux (1171) | Bonus supplémentaire |
|---|---|---|---|---|
| (aucun) | > 100 % (PV au-dessus du max) | ×100 % | +0 % | — |
| Souffrance 1 | 90 – 100 % | ×99 % | +1 % | — |
| Souffrance 2 | 80 – 90 % | ×97 % | +3 % | — |
| Souffrance 3 | 70 – 80 % | ×95 % | +5 % | — |
| Souffrance 4 | 60 – 70 % | ×91 % | +9 % | — |
| Souffrance 5 | 50 – 60 % | ×86 % | +14 % | — |
| Souffrance 6 | 40 – 50 % | ×81 % | +19 % | état « Souffrance 6+ » (5380) : Attirance/Transposition/Liens du Sang +4 PO max, bonus des sorts « en Souffrance 6 ou plus » |
| Souffrance 7 | 30 – 40 % | ×77 % | +23 % | idem |
| Souffrance 8 | 20 – 30 % | ×74 % | +26 % | idem |
| Souffrance 9 | 10 – 20 % | ×72 % | +28 % | idem |
| Souffrance 10 | ≤ 10 % | ×70 % | +30 % | idem |

Bornes : palier N si `PV% ≤ 100 − 10(N−1)` et `> 100 − 10N` (masques `V`/`v` de 14087). Les **Épées** du Sacrieur reçoivent le même
palier (mêmes multiplicateurs). Le palier 0 % → +30 % se combine multiplicativement avec les autres « dommages finaux ».

### 2.2 Sacrifices de PV (effet 1048 « -X % PV »)

Mutilation (-10 % au lancer puis à chaque début de tour, +150 Puissance, paliers Mutilation I→III), Carnage/Déchaînement/Immolation/
Entaille (-10 %), Châtiment (-15 %), Libation (-30 %), Berserk (-70 %). **INCERTAIN** : base du pourcentage (PV actuels ou PV max ?).
Les données ne précisent pas ; l'interprétation « % des PV actuels » évite la mort et colle à « sacrifie une partie de la vie »
(Berserk depuis 100 % → 30 % = Souffrance 8). Ces pertes **ne sont pas des dommages** (pas de résistances, pas d'érosion supposée).

### 2.3 Dégâts selon la vie

- Effet 89 (Transfusion 10 %, Châtiment 15 %) : dommages Neutre = X % des **PV actuels** du Sacrieur (avant le sacrifice de Châtiment ?
  ordre des effets : dommages puis -15 %).
- Effet 1118 (Punition) : dommages Neutre = 35 % des **PV érodés du lanceur** (vie max perdue par érosion).
- Effet 90 (transfert de vie, Absorption 10 %, Transfusion 10 %, Perfusion 10 %, Sacrifice d'Épée 50 %) : le lanceur perd X % de ses PV
  et la cible est soignée d'autant.

### 2.4 États et comportements particuliers

- **Berserk** (1803) : Intaclable, +10 % dommages aux sorts (2812), soins reçus ×30 % ; retiré dès que les PV repassent > 50 %
  (Souffrance ≤ 5) ou si l'on relance le sort.
- **Mutilation** (1302 + I/II/III 1229–1231) : relancer = Coagulation (retire Mutilation, bouclier 5/15/25 % PV max selon le palier).
- **Sacrifice** (583) : le Sacrieur **intercepte** (765) les dommages subis par les alliés en cercle 2 pendant 2 tours ; ses Épées dans la
  zone sont détruites et lui transfèrent 50 % de leur vie restante.
- **Pénitence** (5188/6037) : échanges de position déclenchés quand la cible (allié ou ennemi) subit des dommages.
- **Rituel de Jashin** (1241/5241/5242) : glyphe-aura sous le Sacrieur (Intaclable) ; tant que le Sacrieur et la cible sont dans
  l'état, **100 % des dommages finaux subis par l'un sont renvoyés à l'autre** (effet 1223).
- **Couronne d'Épines** (4197) : renvoi de 100 % des dommages de mêlée subis aux ennemis adjacents ; Pesanteur en croix 1.
- **Pilori** (4199) : bouclier 10 % PV max à l'allié + Indéplaçable ; si la cible subit des dommages en mêlée, l'effet est retiré
  et le Sacrieur est soigné de 10 % PV max (sauf en S6+ : non retirable).
- **Liens du Sang** (676) : à chaque dommage ennemi subi, le Sacrieur avance de 2 cases vers la cible liée.


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB/fichiers du jeu, juin 2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Absorption (12734) | base | 1 | 3 | 1–6 | /LdV | — | 3/t 2/c | 15% | 20–24 vol Feu | damage, lifesteal, debuff |
| 1 | Furie (12723) | var. | 95 | 3 | 0–2 | /LdV | — | 2/t | 15% | 31–34 Air | damage, aoe, self-buff |
| 2 | Supplice (12725) | base | 1 | 3 | 1–1 | /LdV | — | 3/t 2/c | 15% | 22–26 vol Terre | damage, lifesteal, support |
| 2 | Nervosité (12727) | var. | 105 | 3 | 0–4 | /LdV | — | 2/t | 15% | 28–31 Eau | damage, aoe, self-buff |
| 3 | Stase (12728) | base | 1 | 3 | 1–5 | /sans LdV | — | 3/t 2/c | 15% | 20–24 vol Eau | damage, lifesteal, debuff |
| 3 | Douleur Cuisante (12730) | var. | 110 | 3 | 0–5 | /LdV | — | 2/t | 15% | 27–30 Feu | damage, aoe, self-buff |
| 4 | Hémorragie (12748) | base | 1 | 3 | 1–1 | /LdV | — | 3/t 2/c | 15% | 22–26 vol Air | damage, lifesteal, heal-reduction |
| 4 | Décimation (12731) | var. | 100 | 3 | 0–1 | L/LdV | — | 2/t | 15% | 29–32 Terre | damage, aoe, damage-amp |
| 5 | Attirance (12735) | base | 5 | 2 | 2–10 | L/LdV | — | 3/t 2/c | 0% | — | pull, placement |
| 5 | Perfusion (12758) | var. | 115 | 2 | 0–5 | /LdV | 2 | — | 0% | — | heal, support |
| 6 | Mutilation (12737) | base | 10 | 2 | 0–0 | /sans LdV | — | 1/t | 0% | — | self-buff, sacrifice, shield |
| 6 | Pacte de Sang (12762) | var. | 120 | 2 | 0–0 | /sans LdV | 2 | — | 0% | — | self-buff |
| 7 | Épée Vorace (12744) | base | 15 | 3 | 1–3 | L/LdV | 4 | — | 0% | — | summon, lifesteal, heal |
| 7 | Épée Dansante (12765) | var. | 125 | 3 | 1–3 | L/LdV | 4 | — | 0% | — | summon, placement, damage |
| 8 | Ravage (12746) | base | 20 | 3 | 1–6 | L/LdV | — | 2/t | 15% | 28–32 Terre | damage, mobility, gap-closer |
| 8 | Fulgurance (12724) | var. | 130 | 3 | 1–5 | L/sans LdV | — | 1/t | 15% | 22–26 Air | damage, mobility, aoe |
| 9 | Assaut (12733) | base | 25 | 2 | 1–2 | /LdV | — | 3/t 2/c | 5% | 14–17 Air | damage, swap, placement |
| 9 | Aversion (12749) | var. | 135 | 2 | 1–5 | /sans LdV | — | 2/t | 5% | 12–15 Feu | damage, aoe, push |
| 10 | Transposition (12736) | base | 30 | 3 | 1–9 | /sans LdV | 3 | — | 0% | — | swap, placement, mobility |
| 10 | Fluctuation (12763) | var. | 140 | 2 | 0–0 | /sans LdV | 3 | — | 0% | — | mobility, self-buff |
| 11 | Condensation (12745) | base | 35 | 3 | 0–5 | /LdV | — | 2/t | 15% | 21–25 Eau | damage, aoe, pull |
| 11 | Afflux (12729) | var. | 145 | 2 | 0–0 | /sans LdV | — | 2/t | 5% | 12–15 Terre | damage, aoe, pull |
| 12 | Hostilité (12756) | base | 40 | 2 | 1–6 | /LdV | — | 3/t 2/c | 5% | 15–18 Feu | damage, push |
| 12 | Projection (12726) | var. | 150 | 2 | 1–2 | /LdV | — | 2/t 1/c | 5% | 14–17 Eau | damage, mobility |
| 13 | Couronne d'Épines (12761) | base | 45 | 2 | 0–0 | /sans LdV | 3 | — | 0% | — | tank, damage-return, shield |
| 13 | Pilori (14011) | var. | 155 | 2 | 0–4 | /LdV | 3 | — | 0% | — | shield, support, anti-push |
| 14 | Transfusion (12738) | base | 50 | 2 | 0–0 | /LdV | — | 1/t | 0% | — | damage, aoe, heal |
| 14 | Liens du Sang (12754) | var. | 160 | 2 | 1–5 | L/LdV | 2 | — | 0% | — | mobility, gap-closer, tank |
| 15 | Dissolution (12757) | base | 55 | 4 | 0–5 | /LdV | — | 2/t | 25% | 25–29 vol Eau | damage, aoe, lifesteal |
| 15 | Carnage (12752) | var. | 165 | 4 | 1–1 | /LdV | — | 2/t | 25% | 44–48 Air | damage, aoe, sacrifice |
| 16 | Désolation (12753) | base | 60 | 4 | 1–4 | L/LdV | — | 2/t | 25% | 26–30 vol Air | damage, aoe, lifesteal |
| 16 | Déchaînement (12755) | var. | 170 | 4 | 0–6 | L/LdV | — | 2/t | 25% | 39–43 Eau | damage, aoe, sacrifice |
| 17 | Sacrifice (12739) | base | 65 | 2 | 0–5 | /LdV | 4 | — | 0% | — | tank, protect |
| 17 | Pénitence (12764) | var. | 175 | 2 | 0–6 | /sans LdV | 2 | — | 0% | — | swap, placement, tank |
| 18 | Bain de Sang (12732) | base | 70 | 4 | 0–0 | /sans LdV | — | 2/t | 25% | 27–31 vol Terre | damage, aoe, lifesteal |
| 18 | Immolation (12747) | var. | 180 | 4 | 0–4 | /LdV | — | 2/t | 25% | 40–44 Feu | damage, aoe, sacrifice |
| 19 | Hécatombe (12750) | base | 75 | 4 | 0–5 | /LdV | — | 2/t | 25% | 26–30 vol Feu | damage, aoe, lifesteal |
| 19 | Entaille (12751) | var. | 185 | 4 | 1–1 | /LdV | — | 2/t | 25% | 47–51 Terre | damage, single-target, sacrifice |
| 20 | Libation (12759) | base | 80 | 2 | 0–0 | /sans LdV | 3 | — | 0% | — | heal, self-heal, dispel-self |
| 20 | Châtiment (12760) | var. | 190 | 3 | 0–0 | /sans LdV | 3 | — | 0% | — | damage, aoe, sacrifice |
| 21 | Berserk (12743) | base | 85 | 2 | 0–0 | /sans LdV | 2 | — | 0% | — | self-buff, sacrifice, mobility |
| 21 | Rituel de Jashin (14000) | var. | 195 | 3 | 1–10 | /LdV | 4 | — | 0% | — | damage-return, tank, glyph |
| 22 | Punition (12741) | base | 90 | 4 | 1–1 | /sans LdV | 3 | — | 25% | 31–35 meilleur élt | damage, single-target, finisher |
| 22 | Folie Sanguinaire (12740) | var. | 200 | 3 | 0–0 | /sans LdV | 3 | — | 15% | 24–28 vol meilleur élt | damage, aoe, lifesteal |


### Paire 1 — Absorption / Furie

#### Absorption (`12734`) — sort de base (obtenu niv. 1)

> Vole de la vie dans l'élément Feu et retire de la Puissance aux ennemis ou transfère une partie de la vie du lanceur à l'allié ciblé.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 12–14 vol Feu ; g2 (niv. 66) : 3 PA, po 1–6, 16–19 vol Feu ; g3 (niv. 132) : 3 PA, po 1–6, 20–24 vol Feu
- Effets :
  - **20 à 24 vol Feu (CC : 25 à 29)** → cible ennemie  `[94]`
  - **-150 Puissance** → cible ennemie ; 1 tour(s)  `[186]`
  - **Transfère 10% de ses PV (sacrifice de vie vers la cible) (CC : 12)** → cible alliée ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[90]`
  - **le lanceur lance le sous-sort « Absorption » (29318, niv. 3)** → cible alliée  `[1160]`
    - ↳ sous-sort 29318 « Absorption » niv.3 :
      - **Transfère 10% de ses PV (sacrifice de vie vers la cible) (CC : 12)** → cible alliée  `[90]`
- **Analyse / rôle tactique** : Feu 3 PA (po 1–6, 3×/tour, 2×/cible) : vol Feu 20–24 et -150 Puissance (1 t.) à un ennemi, OU transfère 10 % des PV du Sacrieur à un allié. Sort de base polyvalent (soin d'urgence d'un allié en sacrifiant sa vie → monte la Souffrance).

#### Furie (`12723`) — variante (obtenu niv. 95)

> Occasionne des dommages Air en zone et augmente les dommages finaux du lanceur. Les dommages n'affectent pas le lanceur.

- Caractéristiques (g2) : **3 PA** · portée 0–2 (non modifiable) · ligne de vue requise · CC 15% · 2×/tour · cumul max 2
- Grades : g1 (niv. 95) : 3 PA, po 0–2, 25–27 Air ; g2 (niv. 162) : 3 PA, po 0–2, 31–34 Air
- Effets :
  - **31 à 34 dommages Air (CC : 37 à 41)** → tous sauf le lanceur dans la zone ; zone croix taille 1  `[98]`
  - **3% Dommages finaux** → lanceur ; 3 tour(s)  `[1171]`
- **Analyse / rôle tactique** : Variante Air 3 PA (po 0–2, 2×/tour) : 31–34 Air en croix 1 (touche les alliés, pas le lanceur) et +3 % dommages finaux 3 tours (cumul 2 → +6 %). Lancé sur soi (po 0) = zone autour du Sacrieur.


### Paire 2 — Supplice / Nervosité

#### Supplice (`12725`) — sort de base (obtenu niv. 1)

> Vole de la vie dans l'élément Terre. Les entités qui attaquent la cible sont soignées d'une partie des dommages occasionnés.

- Caractéristiques (g3) : **3 PA** · portée 1–1 (non modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–1, 13–16 vol Terre ; g2 (niv. 68) : 3 PA, po 1–1, 17–20 vol Terre ; g3 (niv. 134) : 3 PA, po 1–1, 22–26 vol Terre
- Effets :
  - **22 à 26 vol Terre (CC : 27 à 31)** → cible (alliée ou ennemie)  `[92]`
  - **Soigne l'attaquant de 20% des dommages qu'il inflige à la cible** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[786]`
- **Analyse / rôle tactique** : Terre 3 PA au contact (3×/tour, 2×/cible) : vol Terre 22–26 ; pendant 1 tour, tout allié qui attaque la cible est soigné de 20 % des dommages qu'il lui inflige. Bon pour les groupes mêlée.

#### Nervosité (`12727`) — variante (obtenu niv. 105)

> Occasionne des dommages Eau en zone et augmente les chances de Critique du lanceur. Les dommages n'affectent pas le lanceur.

- Caractéristiques (g2) : **3 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 15% · 2×/tour · cumul max 2
- Grades : g1 (niv. 105) : 3 PA, po 0–4, 24–26 Eau ; g2 (niv. 172) : 3 PA, po 0–4, 28–31 Eau
- Effets :
  - **28 à 31 dommages Eau (CC : 34 à 37)** → tous sauf le lanceur dans la zone ; zone anneau taille 2  `[96]`
  - **7% Critique** → lanceur ; 3 tour(s)  `[115]`
- **Analyse / rôle tactique** : Variante Eau 3 PA (po 0–4, 2×/tour) : 28–31 Eau en anneau de 2 (pas le centre ni le lanceur) et +7 % Critique 3 tours (cumul 2).


### Paire 3 — Stase / Douleur Cuisante

#### Stase (`12728`) — sort de base (obtenu niv. 1)

> Vole de la vie dans l'élément Eau et réduit les chances de Critique.

- Caractéristiques (g3) : **3 PA** · portée 1–5 (non modifiable) · sans ligne de vue · CC 15% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–5, 12–14 vol Eau ; g2 (niv. 69) : 3 PA, po 1–5, 16–19 vol Eau ; g3 (niv. 136) : 3 PA, po 1–5, 20–24 vol Eau
- Effets :
  - **20 à 24 vol Eau (CC : 25 à 29)** → cible (alliée ou ennemie)  `[91]`
  - **-20% Critique** → cible (alliée ou ennemie) ; 1 tour(s)  `[171]`
- **Analyse / rôle tactique** : Eau 3 PA (po 1–5 **sans LdV**, 3×/tour, 2×/cible) : vol Eau 20–24 et -20 % Critique à la cible (1 t.).

#### Douleur Cuisante (`12730`) — variante (obtenu niv. 110)

> Occasionne des dommages Feu en zone et augmente la Puissance du lanceur. Les dommages n'affectent pas le lanceur.

- Caractéristiques (g2) : **3 PA** · portée 0–5 (non modifiable) · ligne de vue requise · CC 15% · 2×/tour · cumul max 2
- Grades : g1 (niv. 110) : 3 PA, po 0–5, 21–24 Feu ; g2 (niv. 177) : 3 PA, po 0–5, 27–30 Feu
- Effets :
  - **27 à 30 dommages Feu (CC : 32 à 36)** → tous sauf le lanceur dans la zone ; zone croix taille 2  `[99]`
  - **+60 Puissance** → lanceur ; 3 tour(s)  `[138]`
- **Analyse / rôle tactique** : Variante Feu 3 PA (po 0–5, 2×/tour) : 27–30 Feu en croix 2 (pas le lanceur) et +60 Puissance 3 tours (cumul 2 → +120).


### Paire 4 — Hémorragie / Décimation

#### Hémorragie (`12748`) — sort de base (obtenu niv. 1)

> Réduit les soins reçus par la cible et vole de la vie dans l'élément Air.

- Caractéristiques (g3) : **3 PA** · portée 1–1 (non modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–1, 13–16 vol Air ; g2 (niv. 67) : 3 PA, po 1–1, 17–20 vol Air ; g3 (niv. 133) : 3 PA, po 1–1, 22–26 vol Air
- Effets :
  - **Soins reçus x70%** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : quand la cible est soignée  `[1159]`
  - **22 à 26 vol Air (CC : 27 à 31)** → cible (alliée ou ennemie)  `[93]`
- **Analyse / rôle tactique** : Air 3 PA au contact (3×/tour, 2×/cible) : vol Air 22–26 et soins reçus ×70 % (1 t.) sur la cible. Anti-soin en mêlée.

#### Décimation (`12731`) — variante (obtenu niv. 100)

> Occasionne des dommages Terre et augmente les dommages subis par les cibles en zone. N'affecte pas le lanceur.

- Caractéristiques (g2) : **3 PA** · portée 0–1 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour · cumul max 2
- Grades : g1 (niv. 100) : 3 PA, po 0–1, 23–26 Terre ; g2 (niv. 167) : 3 PA, po 0–1, 29–32 Terre
- Effets :
  - **29 à 32 dommages Terre (CC : 35 à 38)** → tous sauf le lanceur dans la zone ; zone croix diagonale taille 1  `[97]`
  - **Dommages subis x103%** → tous sauf le lanceur dans la zone ; zone croix diagonale taille 1, actif 3 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
- **Analyse / rôle tactique** : Variante Terre 3 PA (po 0–1 en ligne, 2×/tour) : 29–32 Terre en croix diagonale 1 (pas le lanceur) et ×103 % dommages subis (3 tours, cumul 2) sur les cibles.


### Paire 5 — Attirance / Perfusion

#### Attirance (`12735`) — sort de base (obtenu niv. 5)

> Attire la cible.  L'attirance est plus importante et la portée maximale du sort est augmentée de 4 si le lanceur est en Souffrance 6 ou plus.

- Caractéristiques (g3) : **2 PA** · portée 2–10 (non modifiable) · en ligne uniquement · ligne de vue requise · cible requise (case occupée) · CC 0% · 3×/tour · 2×/cible
- Grades : g1 (niv. 5) : 2 PA, po 2–8 ; g2 (niv. 72) : 2 PA, po 2–9 ; g3 (niv. 139) : 2 PA, po 2–10
- Effets :
  - **Attire la cible de 9 case(s)** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Souffrance 6+ » (5380)  `[6]`
  - **Attire la cible de 13 case(s)** → cible (alliée ou ennemie) — si lanceur a l'état « Souffrance 6+ » (5380)  `[6]`
- **Analyse / rôle tactique** : 2 PA en ligne (po 2–10, 3×/tour, 2×/cible) : attire la cible de 9 cases (13 et +4 PO en Souffrance ≥ 6). LE sort pour ramener une cible (ou un allié) au contact.

#### Perfusion (`12758`) — variante (obtenu niv. 115)

> Transfère une partie de la vie du lanceur à ses alliés en zone et leur applique l'état Perfusion : • Les alliés dans l'état Perfusion sont soignés d'une partie des dommages occasionnés au lanceur.  Le transfert n'est pas appliqué si le lanceur est en Souffrance 6 ou plus.

- Caractéristiques (g2) : **2 PA** · portée 0–5 (non modifiable) · ligne de vue requise · CC 0% · relance 2 t. · relance globale -1 t.
- Grades : g1 (niv. 115) : 2 PA, po 0–4 ; g2 (niv. 182) : 2 PA, po 0–5
- Effets :
  - **Transfère 10% de ses PV (sacrifice de vie vers la cible)** → alliés (hors lanceur) dans la zone — si lanceur n'a PAS l'état « Souffrance 6 » (621) ET si lanceur n'a PAS l'état « Souffrance 7 » (622) ET si lanceur n'a PAS l'état « Souffrance 8 » (623) ET si lanceur n'a PAS l'état « Souffrance 9 » (624) ET si lanceur n'a PAS l'état « Souffrance 10 » (625) ; zone cercle taille 2  `[90]`
  - **Applique l'état « Perfusion » (636)** → alliés (hors lanceur) dans la zone ; zone cercle taille 2, 2 tour(s)  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Perfusion » (12767, niv. 2)** → lanceur ; actif 2 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[792]`
    - ↳ sous-sort 12767 « Perfusion » niv.2 :
      - **Soin : 30% des dommages subis** → alliés dans la zone — si cible a l'état « Perfusion » (636) ; zone tout le terrain (vivants)  `[2020]`
  - **Soin : 30% des dommages subis** → alliés dans la zone ; zone tout le terrain (vivants), actif 2 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2020]`
- **Analyse / rôle tactique** : Variante 2 PA (po 0–5, relance 2) : transfère 10 % des PV du Sacrieur aux alliés en cercle 2 (sauf en S6+) et leur pose Perfusion 2 tours : ils sont soignés de 30 % des dommages subis par le Sacrieur.


### Paire 6 — Mutilation / Pacte de Sang

#### Mutilation (`12737`) — sort de base (obtenu niv. 10)

> Sacrifie une partie de la vie du lanceur pour augmenter sa Puissance. À chaque début de tour, sacrifie de nouveau une partie de sa vie pour incrémenter son état de Mutilation tant que le sort est actif.  Relancer le sort retire les effets appliqués et lance le sort Coagulation : • Applique un bouclier sur le lanceur. • Le bouclier est plus important selon l'état de Mutilation.

- Caractéristiques (g3) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 1×/tour
- Grades : g1 (niv. 10) : 2 PA, po 0–0 ; g2 (niv. 77) : 2 PA, po 0–0 ; g3 (niv. 144) : 2 PA, po 0–0
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Coagulation » (12775, niv. 1)** → lanceur — si lanceur a l'état « Mutilation » (1302)  `[792]`
    - ↳ sous-sort 12775 « Coagulation » niv.1 :
      - **Retire les effets du sort « Mutilation » (13996)** → lanceur  `[406]`
      - **Bouclier : 5% des PV max** → lanceur — si lanceur a l'état « Mutilation I » (1229) ; 1 tour(s)  `[1039]`
      - **Bouclier : 15% des PV max** → lanceur — si lanceur a l'état « Mutilation II » (1230) ; 1 tour(s)  `[1039]`
      - **Bouclier : 25% des PV max** → lanceur — si lanceur a l'état « Mutilation III » (1231) ; 1 tour(s)  `[1039]`
  - **la cible lance (sur elle-même) le sous-sort « Mutilation » (13996, niv. 3)** → lanceur — si lanceur n'a PAS l'état « Mutilation » (1302)  `[792]`
    - ↳ sous-sort 13996 « Mutilation » niv.3 :
      - **la cible lance (sur elle-même) le sous-sort « Mutilation » (16479, niv. 1)** → lanceur ; actif 63 tour(s), déclencheur : immédiat OU début de tour du porteur  `[792]`
        - ↳ sous-sort 16479 « Mutilation » niv.1 :
          - **-10% PV** → lanceur ; durée infinie  `[1048]`
          - **la cible lance (sur elle-même) le sous-sort « Souffrance » (14087, niv. 1)** → lanceur  `[792]`
            - ↳ sous-sort 14087 niv.1 : recalcul du palier de Souffrance selon les PV (voir §2.1)
      - **Applique l'état « Mutilation » (1302)** → lanceur ; durée infinie  `[950]`
      - **la cible lance (sur elle-même) le sous-sort « Mutilation » (13996, niv. 4)** → lanceur ; actif 63 tour(s), déclencheur : immédiat OU début de tour du porteur  `[792]`
        - ↳ sous-sort 13996 niv.4 : progression Mutilation I → II → III à chaque début de tour
      - **+150 Puissance** → lanceur ; durée infinie  `[138]`
  - **-10% PV** → lanceur — si lanceur n'a PAS l'état « Mutilation » (1302) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1048]`
  - **+150 Puissance** → lanceur — si lanceur n'a PAS l'état « Mutilation » (1302) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **Applique l'état « Mutilation I » (1229)** → lanceur — si lanceur n'a PAS l'état « Mutilation » (1302) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Mutilation II » (1230)** → lanceur — si lanceur n'a PAS l'état « Mutilation » (1302) ; 1 tour(s), délai 1 t., *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Mutilation III » (1231)** → lanceur — si lanceur n'a PAS l'état « Mutilation » (1302) ; durée infinie, délai 2 t., *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Coagulation » (12775, niv. 1)** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[792]`
    - ↳ (sous-sort 12775 niv.1 déjà détaillé plus haut)
  - **Bouclier : 15% des PV max** → lanceur — si lanceur a l'état « Mutilation II » (1230) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1039]`
  - **Bouclier : 25% des PV max** → lanceur — si lanceur a l'état « Mutilation III » (1231) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1039]`
- **Analyse / rôle tactique** : 2 PA (sur soi, 1×/tour) : -10 % PV maintenant et à chaque début de tour, +150 Puissance tant que le sort est actif (paliers Mutilation I→III). Relancer = Coagulation : retire les effets et donne un bouclier de 5/15/25 % PV max selon le palier. Moteur de Souffrance.

#### Pacte de Sang (`12762`) — variante (obtenu niv. 120)

> Augmente la Vitalité et la Puissance du lanceur.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · cumul max 1
- Grades : g1 (niv. 120) : 2 PA, po 0–0 ; g2 (niv. 187) : 2 PA, po 0–0
- Effets :
  - **25% Vitalité** → lanceur ; 3 tour(s)  `[1078]`
  - **la cible lance (sur elle-même) le sous-sort « Souffrance » (14087, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 14087 niv.1 : recalcul du palier de Souffrance selon les PV (voir §2.1)
  - **+100 Puissance** → lanceur ; 3 tour(s)  `[138]`
- **Analyse / rôle tactique** : Variante 2 PA (relance 2) : +25 % Vitalité et +100 Puissance pendant 3 tours. Plus de PV max = plus de marge (mais la hausse des PV max fait baisser le % de PV → palier de Souffrance recalculé).


### Paire 7 — Épée Vorace / Épée Dansante

#### Épée Vorace (`12744`) — sort de base (obtenu niv. 15)

> Invoque une Épée Vorace maîtrisable qui peut voler de la vie dans l'élément Neutre.

- Caractéristiques (g3) : **3 PA** · portée 1–3 (non modifiable) · en ligne uniquement · ligne de vue requise · case libre requise · CC 0% · relance 4 t.
- Grades : g1 (niv. 15) : 3 PA, po 1–3 ; g2 (niv. 82) : 3 PA, po 1–3 ; g3 (niv. 149) : 3 PA, po 1–3
- Effets :
  - **Invoque « Épée Vorace » (monstre 434, grade 3)** → cible (alliée ou ennemie)  `[181]`
- **Analyse / rôle tactique** : 3 PA en ligne (po 1–3, relance 4) : Épée Vorace maîtrisable (4 PA/4 PM) : Tourbillon Sanglant (vol Neutre 14–16 en cercle 2, alliés soignés de 50 % des dégâts), Soif de Sang (vol Neutre 14–16, soigne le Sacrieur — ou tous les alliés en S6+ — de 50 %).

#### Épée Dansante (`12765`) — variante (obtenu niv. 125)

> Invoque une Épée Dansante maîtrisable qui peut attirer, échanger de positions et occasionner des dommages Neutre.

- Caractéristiques (g2) : **3 PA** · portée 1–3 (non modifiable) · en ligne uniquement · ligne de vue requise · case libre requise · CC 0% · relance 4 t.
- Grades : g1 (niv. 125) : 3 PA, po 1–3 ; g2 (niv. 192) : 3 PA, po 1–3
- Effets :
  - **Invoque « Épée Dansante » (monstre 5192, grade 2)** → cible (alliée ou ennemie)  `[181]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–3, relance 4) : Épée Dansante (4 PA/5 PM) : Danse-lames (14–16 Neutre, attire de 2, +15 Fuite), Danse Mortelle (échange + 9–11 Neutre).


### Paire 8 — Ravage / Fulgurance

#### Ravage (`12746`) — sort de base (obtenu niv. 20)

> Rapproche le lanceur vers la cible et occasionne des dommages Terre aux ennemis.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour
- Grades : g1 (niv. 20) : 3 PA, po 1–6, 17–20 Terre ; g2 (niv. 87) : 3 PA, po 1–6, 22–26 Terre ; g3 (niv. 154) : 3 PA, po 1–6, 28–32 Terre
- Effets :
  - **Le lanceur avance de 5 case(s) vers la cible** → cible (alliée ou ennemie)  `[1042]`
  - **28 à 32 dommages Terre (CC : 34 à 38)** → cible ennemie  `[97]`
- **Analyse / rôle tactique** : Terre 3 PA en ligne (po 1–6, 2×/tour) : le Sacrieur avance de 5 cases vers la cible puis 28–32 Terre. Engagement.

#### Fulgurance (`12724`) — variante (obtenu niv. 130)

> Téléporte le lanceur sur la première case disponible entre la cible et lui et occasionne des dommages Air aux ennemis en zone.

- Caractéristiques (g2) : **3 PA** · portée 1–5 (non modifiable) · en ligne uniquement · sans ligne de vue · cible requise (case occupée) · CC 15% · 1×/tour · condition : lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 130) : 3 PA, po 1–5, 20–23 Air ; g2 (niv. 197) : 3 PA, po 1–5, 22–26 Air
- Effets :
  - **Téléporte le lanceur sur la case ciblée** → lanceur ; zone ligne depuis le lanceur taille 1 (min 63)  `[4]`
  - **22 à 26 dommages Air (CC : 27 à 32)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[98]`
- **Analyse / rôle tactique** : Variante Air 3 PA en ligne (po 1–5 sans LdV, 1×/tour) : téléporte le Sacrieur sur la première case libre vers la cible et inflige 22–26 Air aux ennemis traversés/au bout de la ligne (zone ligne depuis le lanceur, arrêt à la 1re cible). Interdit sous Pesanteur.


### Paire 9 — Assaut / Aversion

#### Assaut (`12733`) — sort de base (obtenu niv. 25)

> Échange de position avec la cible et occasionne des dommages Air aux ennemis.

- Caractéristiques (g3) : **2 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 5% · 3×/tour · 2×/cible
- Grades : g1 (niv. 25) : 2 PA, po 1–2, 9–11 Air ; g2 (niv. 92) : 2 PA, po 1–2, 11–13 Air ; g3 (niv. 159) : 2 PA, po 1–2, 14–17 Air
- Effets :
  - **Échange de positions (lanceur ↔ cible)** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Pesanteur » (7)  `[8]`
  - **14 à 17 dommages Air (CC : 18 à 21)** → cible ennemie  `[98]`
- **Analyse / rôle tactique** : Air 2 PA (po 1–2, 3×/tour, 2×/cible) : échange de position avec la cible (pas sous Pesanteur) + 14–17 Air aux ennemis. Repositionnement très bon marché (sortir un allié du contact, retourner un ennemi).

#### Aversion (`12749`) — variante (obtenu niv. 135)

> Occasionne des dommages Feu aux ennemis et repousse les cibles depuis le centre en zone. N'affecte pas le lanceur.

- Caractéristiques (g1) : **2 PA** · portée 1–5 (non modifiable) · sans ligne de vue · CC 5% · 2×/tour
- Effets :
  - **12 à 15 dommages Feu (CC : 16 à 19)** → ennemis dans la zone ; zone croix taille 1  `[99]`
  - **Repousse la cible de 1 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 1  `[5]`
- **Analyse / rôle tactique** : Variante Feu 2 PA (po 1–5 sans LdV, 2×/tour) : 12–15 Feu en croix 1 aux ennemis et repousse d'1 case depuis le centre (pas le lanceur).


### Paire 10 — Transposition / Fluctuation

#### Transposition (`12736`) — sort de base (obtenu niv. 30)

> Échange de position avec la cible.  La portée maximale du sort est augmentée de 4 si le lanceur est en Souffrance 6 ou plus.

- Caractéristiques (g3) : **3 PA** · portée 1–9 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t. (1er lancer possible au tour 2) · relance globale -1 t. · condition : lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 30) : 3 PA, po 1–7 ; g2 (niv. 97) : 3 PA, po 1–8 ; g3 (niv. 164) : 3 PA, po 1–9
- Effets :
  - **Échange de positions (lanceur ↔ cible)** → cible (alliée ou ennemie)  `[8]`
- **Analyse / rôle tactique** : 3 PA (po 1–9 sans LdV, +4 en S6+, relance 3, 1er lancer au tour 2) : échange de position avec n'importe quelle entité. Interdit sous Pesanteur. Secours d'un allié encerclé / engagement à distance.

#### Fluctuation (`12763`) — variante (obtenu niv. 140)

> Rend le lanceur et ses Épées Intaclables et augmente leurs PM.  Les effets sont plus importants si le lanceur est en Souffrance 6 ou plus.

- Caractéristiques (g1) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t.
- Effets :
  - **Applique l'état « Intaclable » (96)** → lanceur ; 1 tour(s)  `[950]`
  - **Applique l'état « Intaclable » (96)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est l’un des monstres : « Épée Vorace » (434) / « Épée Dansante » (5192) ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
  - **2 PM** → lanceur — si lanceur n'a PAS l'état « Souffrance 6+ » (5380) ; 1 tour(s)  `[128]`
  - **2 PM** → alliés (dont lanceur si dans la zone), invocations du lanceur — si lanceur n'a PAS l'état « Souffrance 6+ » (5380) ET si cible est l’un des monstres : « Épée Vorace » (434) / « Épée Dansante » (5192) ; zone tout le terrain (vivants), 1 tour(s)  `[128]`
  - **4 PM** → lanceur — si lanceur a l'état « Souffrance 6+ » (5380) ; 1 tour(s)  `[128]`
  - **4 PM** → alliés (dont lanceur si dans la zone), invocations du lanceur — si lanceur a l'état « Souffrance 6+ » (5380) ET si cible est l’un des monstres : « Épée Vorace » (434) / « Épée Dansante » (5192) ; zone tout le terrain (vivants), 1 tour(s)  `[128]`
- **Analyse / rôle tactique** : Variante 2 PA (relance 3) : le Sacrieur et ses Épées deviennent Intaclables et gagnent +2 PM (+4 en S6+) pour 1 tour.


### Paire 11 — Condensation / Afflux

#### Condensation (`12745`) — sort de base (obtenu niv. 35)

> Occasionne des dommages Eau aux ennemis et attire les cibles en zone.

- Caractéristiques (g3) : **3 PA** · portée 0–5 (non modifiable) · ligne de vue requise · CC 15% · 2×/tour
- Grades : g1 (niv. 35) : 3 PA, po 0–5, 13–16 Eau ; g2 (niv. 102) : 3 PA, po 0–5, 17–20 Eau ; g3 (niv. 169) : 3 PA, po 0–5, 21–25 Eau
- Effets :
  - **21 à 25 dommages Eau (CC : 26 à 31)** → ennemis dans la zone ; zone cercle taille 2  `[96]`
  - **le lanceur lance le sous-sort « Condensation » (12771, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 2  `[1160]`
    - ↳ sous-sort 12771 « Condensation » niv.1 :
      - **Attire la cible de 2 case(s)** → cible (alliée ou ennemie)  `[6]`
  - **Attire la cible de 2 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
- **Analyse / rôle tactique** : Eau 3 PA (po 0–5, 2×/tour) : 21–25 Eau aux ennemis en cercle 2 puis attire de 2 chaque entité vers le centre. Regroupement + dégâts.

#### Afflux (`12729`) — variante (obtenu niv. 145)

> Attire les cibles vers le centre et occasionne des dommages Terre aux ennemis en zone.

- Caractéristiques (g1) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 5% · 2×/tour
- Effets :
  - **Attire la cible de 2 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 3 (min 1)  `[6]`
  - **12 à 15 dommages Terre (CC : 16 à 19)** → ennemis dans la zone ; zone croix sans centre taille 3 (min 1)  `[97]`
- **Analyse / rôle tactique** : Variante Terre 2 PA (sur soi, 2×/tour) : attire de 2 vers le Sacrieur toutes les entités en croix (sans centre) jusqu'à 3 cases et 12–15 Terre aux ennemis. Aspire les ennemis au contact du tank.


### Paire 12 — Hostilité / Projection

#### Hostilité (`12756`) — sort de base (obtenu niv. 40)

> Occasionne des dommages Feu aux ennemis et repousse la cible.

- Caractéristiques (g3) : **2 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 5% · 3×/tour · 2×/cible
- Grades : g1 (niv. 40) : 2 PA, po 1–6, 9–11 Feu ; g2 (niv. 107) : 2 PA, po 1–6, 12–14 Feu ; g3 (niv. 174) : 2 PA, po 1–6, 15–18 Feu
- Effets :
  - **15 à 18 dommages Feu (CC : 19 à 23)** → cible ennemie  `[99]`
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie)  `[5]`
- **Analyse / rôle tactique** : Feu 2 PA (po 1–6, 3×/tour, 2×/cible) : 15–18 Feu + repousse de 2. Dommages de poussée, dégagement.

#### Projection (`12726`) — variante (obtenu niv. 150)

> Téléporte le lanceur symétriquement par rapport à la cible et occasionne des dommages Eau aux ennemis.

- Caractéristiques (g1) : **2 PA** · portée 1–2 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 5% · 2×/tour · 1×/cible
- Effets :
  - **Téléportation symétrique par rapport à la cible** → cible (alliée ou ennemie)  `[1104]`
  - **14 à 17 dommages Eau (CC : 18 à 21)** → cible ennemie  `[96]`
- **Analyse / rôle tactique** : Variante Eau 2 PA (po 1–2, 2×/tour, 1×/cible) : téléportation symétrique par rapport à la cible + 14–17 Eau. Passer derrière un ennemi (changer le côté du tacle).


### Paire 13 — Couronne d'Épines / Pilori

#### Couronne d'Épines (`12761`) — sort de base (obtenu niv. 45)

> Applique l'état Pesanteur sur les cibles en zone, un bouclier et l'état Couronne d'Épines sur le lanceur : • Renvoie 100% des dommages subis en mêlée aux ennemis à son contact.  Applique un bouclier supplémentaire sur le lanceur pour chaque ennemi dans la zone d'effet s'il est en Souffrance 6 ou plus.

- Caractéristiques (g3) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t.
- Grades : g1 (niv. 45) : 2 PA, po 0–0 ; g2 (niv. 112) : 2 PA, po 0–0 ; g3 (niv. 179) : 2 PA, po 0–0
- Effets :
  - **Applique l'état « Pesanteur » (7)** → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Bouclier : 10% des PV max** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1039]`
  - **Applique l'état « Couronne d'Épines » (4197)** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Dommages : 100% des dommages finaux subis** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1, actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case) OU dommages de mêlée subis (≤1 case) (variante X, INCERTAIN), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1223]`
  - **Bouclier : 5% des PV max** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1039]`
  - **la cible lance (sur elle-même) le sous-sort « Couronne d'Épines » (25851, niv. 3)** → lanceur  `[792]`
    - ↳ sous-sort 25851 « Couronne d'Épines » niv.3 :
      - **Applique l'état « Pesanteur » (7)** → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 1 tour(s)  `[950]`
      - **Bouclier : 10% des PV max** → lanceur ; 1 tour(s)  `[1039]`
      - **Applique l'état « Couronne d'Épines » (4197)** → lanceur ; 1 tour(s)  `[950]`
      - **la cible lance (sur elle-même) le sous-sort « Couronne d'Épines » (25851, niv. 7)** → lanceur ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case) OU dommages de mêlée subis (≤1 case) (variante X, INCERTAIN)  `[792]`
        - ↳ sous-sort 25851 « Couronne d'Épines » niv.7 :
          - **Dommages : 100% des dommages finaux subis** → ennemis dans la zone ; zone croix sans centre taille 1 (min 1)  `[1223]`
      - **le lanceur lance le sous-sort « Couronne d'Épines » (25851, niv. 6)** → ennemis dans la zone — si lanceur a l'état « Souffrance 6+ » (5380) ; zone croix sans centre taille 1  `[1160]`
        - ↳ sous-sort 25851 « Couronne d'Épines » niv.6 :
          - **Bouclier : 5% des PV max** → lanceur ; 1 tour(s)  `[1039]`
- **Analyse / rôle tactique** : 2 PA (sur soi, relance 3) : Pesanteur aux entités en croix 1, bouclier 10 % PV max (+5 %/ennemi adjacent en S6+), état Couronne d'Épines 1 tour : renvoie 100 % des dommages subis en mêlée aux ennemis adjacents.

#### Pilori (`14011`) — variante (obtenu niv. 155)

> Applique un bouclier sur l'allié ciblé et applique les états Indéplaçable et Pilori sur la cible : • Retire les effets du sort si la cible subit des dommages en mêlée et soigne le lanceur.  Les effets ne peuvent pas être retirés si le lanceur est en Souffrance 6 ou plus.

- Caractéristiques (g1) : **2 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 0% · relance 3 t.
- Effets :
  - **Bouclier : 10% des PV max** → cible alliée ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1039]`
  - **Applique l'état « Indéplaçable » (97)** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Pilori » (4199)** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Soin : 10% des PV max** → lanceur ; 1 tour(s), actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **le lanceur lance le sous-sort « Pilori » (25855, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 25855 « Pilori » niv.1 :
      - **Bouclier : 10% des PV max** → cible alliée ; 1 tour(s)  `[1039]`
      - **Applique l'état « Indéplaçable » (97)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
      - **Applique l'état « Pilori » (4199)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Pilori » (25855, niv. 2)** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Souffrance 6+ » (5380) ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case)  `[1160]`
        - ↳ sous-sort 25855 « Pilori » niv.2 :
          - **Retire les effets du sort « Pilori » (25855)** → cible (alliée ou ennemie)  `[406]`
          - **Soin : 10% des PV max** → lanceur  `[1109]`
- **Analyse / rôle tactique** : Variante 2 PA (po 0–4, relance 3) : bouclier 10 % PV max et Indéplaçable à un allié (ou soi) ; si la cible subit des dommages de mêlée, l'effet saute et le Sacrieur est soigné de 10 % PV max (non retirable en S6+).


### Paire 14 — Transfusion / Liens du Sang

#### Transfusion (`12738`) — sort de base (obtenu niv. 50)

> Occasionne des dommages Neutre selon la vie restante du lanceur aux ennemis et transfère une partie de sa vie aux alliés en zone.

- Caractéristiques (g3) : **2 PA** · portée 0–0 (non modifiable) · ligne de vue requise · CC 0% · 1×/tour
- Grades : g1 (niv. 50) : 2 PA, po 0–0 ; g2 (niv. 117) : 2 PA, po 0–0 ; g3 (niv. 184) : 2 PA, po 0–0
- Effets :
  - **Dommages Neutre : 10%  PV du lanceur** → ennemis dans la zone ; zone cercle taille 3  `[89]`
  - **Transfère 10% de ses PV (sacrifice de vie vers la cible)** → alliés (hors lanceur) dans la zone ; zone cercle taille 3  `[90]`
  - **la cible lance (sur elle-même) le sous-sort « Souffrance » (14087, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 14087 niv.1 : recalcul du palier de Souffrance selon les PV (voir §2.1)
- **Analyse / rôle tactique** : 2 PA (sur soi, 1×/tour) : dommages Neutre = 10 % des PV actuels du Sacrieur aux ennemis en cercle 3 et transfère 10 % de ses PV aux alliés en cercle 3. Utile à PV élevés (avant de descendre en Souffrance).

#### Liens du Sang (`12754`) — variante (obtenu niv. 160)

> Rapproche le lanceur vers la cible et applique l'état Liens du Sang sur l'ennemi ciblé : • Rapproche le lanceur vers l'ennemi ciblé si le lanceur subit des dommages ennemis.  Le rapprochement immédiat est plus important et la portée maximale du sort est augmentée de 4 si le lanceur est en Souffrance 6 ou plus.

- Caractéristiques (g1) : **2 PA** · portée 1–5 (non modifiable) · en ligne uniquement · ligne de vue requise · cible requise (case occupée) · CC 0% · relance 2 t. · relance globale 1 t.
- Effets :
  - **Le lanceur avance de 4 case(s) vers la cible** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Souffrance 6+ » (5380)  `[1042]`
  - **Le lanceur avance de 8 case(s) vers la cible** → cible (alliée ou ennemie) — si lanceur a l'état « Souffrance 6+ » (5380)  `[1042]`
  - **Applique l'état « Liens du Sang » (676)** → cible ennemie ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Liens du Sang » (12770, niv. 1)** → lanceur ; actif 1 tour(s), déclencheur : dommages subis d'un ennemi  `[1160]`
    - ↳ sous-sort 12770 « Liens du Sang » niv.1 :
      - **Le lanceur avance de 2 case(s) vers la cible** → ennemis dans la zone — si cible a l'état « Liens du Sang » (676) ; zone tout le terrain, non désenvoûtable  `[1042]`
  - **Le lanceur avance de 2 case(s) vers la cible** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : dommages subis d'un ennemi, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1042]`
- **Analyse / rôle tactique** : Variante 2 PA en ligne (po 1–5, +4 en S6+, relance 2) : avance de 4 cases (8 en S6+) vers la cible et la lie : chaque dommage ennemi subi par le Sacrieur le rapproche de 2 cases d'elle (1 tour). Colle une cible.


### Paire 15 — Dissolution / Carnage

#### Dissolution (`12757`) — sort de base (obtenu niv. 55)

> Vole de la vie dans l'élément Eau et retire de la Fuite en zone. N'affecte pas le lanceur.

- Caractéristiques (g3) : **4 PA** · portée 0–5 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour · cumul max 1
- Grades : g1 (niv. 55) : 4 PA, po 0–5, 16–19 vol Eau ; g2 (niv. 122) : 4 PA, po 0–5, 21–25 vol Eau ; g3 (niv. 189) : 4 PA, po 0–5, 25–29 vol Eau
- Effets :
  - **25 à 29 vol Eau (CC : 30 à 35)** → tous sauf le lanceur dans la zone ; zone croix taille 1  `[91]`
  - **-30 Fuite** → tous sauf le lanceur dans la zone ; zone croix taille 1, 1 tour(s)  `[754]`
- **Analyse / rôle tactique** : Eau 4 PA (po 0–5, 2×/tour, CC 25 %) : vol Eau 25–29 en croix 1 (pas le lanceur) et -30 Fuite (1 t.) → les ennemis restent collés au tank.

#### Carnage (`12752`) — variante (obtenu niv. 165)

> Sacrifie une partie de la vie du lanceur pour occasionner des dommages Air en zone.

- Caractéristiques (g1) : **4 PA** · portée 1–1 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour
- Effets :
  - **-10% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
  - **44 à 48 dommages Air (CC : 53 à 58)** → tous (alliés+ennemis) dans la zone ; zone ligne taille 2  `[98]`
- **Analyse / rôle tactique** : Variante Air 4 PA au contact (2×/tour, CC 25 %) : -10 % PV puis 44–48 Air en ligne de 2 (alliés compris). Gros burst Air.


### Paire 16 — Désolation / Déchaînement

#### Désolation (`12753`) — sort de base (obtenu niv. 60)

> Vole de la vie dans l'élément Air et retire des PM en zone.

- Caractéristiques (g3) : **4 PA** · portée 1–4 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 25% · 2×/tour · cumul max 1
- Grades : g1 (niv. 60) : 4 PA, po 1–4, 19–22 vol Air ; g2 (niv. 127) : 4 PA, po 1–4, 23–27 vol Air ; g3 (niv. 194) : 4 PA, po 1–4, 26–30 vol Air
- Effets :
  - **26 à 30 vol Air (CC : 31 à 36)** → tous (alliés+ennemis) dans la zone ; zone demi-cercle taille 1  `[93]`
  - **Retire 3 PM (esquivable)** → tous (alliés+ennemis) dans la zone ; zone demi-cercle taille 1, 1 tour(s), non désenvoûtable  `[1080]`
- **Analyse / rôle tactique** : Air 4 PA en ligne (po 1–4, 2×/tour, CC 25 %) : vol Air 26–30 et -3 PM (esquivables) en demi-cercle 1 (alliés compris). Meilleure entrave PM du Sacrieur.

#### Déchaînement (`12755`) — variante (obtenu niv. 170)

> Sacrifie une partie de la vie du lanceur pour occasionner des dommages Eau en zone. Les dommages n'affectent pas le lanceur.

- Caractéristiques (g1) : **4 PA** · portée 0–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 25% · 2×/tour
- Effets :
  - **-10% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
  - **39 à 43 dommages Eau (CC : 47 à 52)** → tous sauf le lanceur dans la zone ; zone carré taille 1  `[96]`
- **Analyse / rôle tactique** : Variante Eau 4 PA en ligne (po 0–6, 2×/tour, CC 25 %) : -10 % PV puis 39–43 Eau en carré 1 (pas le lanceur, alliés compris).


### Paire 17 — Sacrifice / Pénitence

#### Sacrifice (`12739`) — sort de base (obtenu niv. 65)

> Intercepte les dommages subis par les alliés en zone. Détruit également les Épées du lanceur dans la zone pour lui transférer une partie de leur vie restante.

- Caractéristiques (g3) : **2 PA** · portée 0–5 (non modifiable) · ligne de vue requise · CC 0% · relance 4 t.
- Grades : g1 (niv. 65) : 2 PA, po 0–3 ; g2 (niv. 131) : 2 PA, po 0–4 ; g3 (niv. 198) : 2 PA, po 0–5
- Effets :
  - **Intercepte les dommages** → alliés (hors lanceur) dans la zone ; zone cercle taille 2, actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[765]`
  - **la cible lance (sur elle-même) le sous-sort « Sacrifice » (16577, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est l’un des monstres : « Épée Vorace » (434) / « Épée Dansante » (5192) ; zone cercle taille 2  `[792]`
    - ↳ sous-sort 16577 « Sacrifice » niv.1 :
      - **Transfère 50% de ses PV (sacrifice de vie vers la cible)** → personnages joueurs alliés, invocations du lanceur ; zone tout le terrain  `[90]`
      - **Tue la cible** → lanceur  `[141]`
  - **Transfère 50% de ses PV (sacrifice de vie vers la cible)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est l’un des monstres : « Épée Vorace » (434) / « Épée Dansante » (5192) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[90]`
  - **Applique l'état « Sacrifice » (583)** → alliés (hors lanceur) dans la zone ; zone cercle taille 2, 2 tour(s)  `[950]`
- **Analyse / rôle tactique** : 2 PA (po 0–5, relance 4) : pendant 2 tours, intercepte les dommages subis par les alliés en cercle 2 (pas le lanceur) ; détruit ses Épées dans la zone pour récupérer 50 % de leur vie. Protège les DPS fragiles — le Sacrieur encaisse à leur place avec sa réduction de Souffrance.

#### Pénitence (`12764`) — variante (obtenu niv. 175)

> Échange de position avec la cible et lui applique l'état Pénitence : • Sur un allié : échange les positions de la cible et du lanceur si elle subit des dommages. • Sur un ennemi : échange les positions de la cible et du lanceur s'il subit des dommages. • Sur le lanceur : échange de position ses attaquants.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 2 t. · relance globale 1 t. · condition : lanceur n’a pas l’état « Pesanteur » (7)
- Effets :
  - **Échange de positions (lanceur ↔ cible)** → cible (hors lanceur)  `[8]`
  - **Applique l'état « Pénitence » (5188)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **Applique l'état « Pénitence (ennemi) » (6037)** → cible ennemie ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Pénitence » (12769, niv. 1)** → allié ciblé (hors lanceur) ; actif 1 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[1160]`
    - ↳ sous-sort 12769 « Pénitence » niv.1 :
      - **Échange de positions (lanceur ↔ cible)** → cible alliée  `[8]`
  - **le lanceur lance le sous-sort « Pénitence » (12769, niv. 2)** → cible ennemie  `[1160]`
    - ↳ sous-sort 12769 « Pénitence » niv.2 :
      - **le lanceur lance le sous-sort « Pénitence » (12769, niv. 3)** → lanceur ; actif 1 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[1160]`
        - ↳ sous-sort 12769 « Pénitence » niv.3 :
          - **Échange de positions (lanceur ↔ cible)** → ennemis dans la zone — si cible a l'état « Pénitence (ennemi) » (6037) ; zone tout le terrain (vivants)  `[8]`
  - **le lanceur lance le sous-sort « Pénitence » (12769, niv. 4)** → lanceur (s’il est dans la zone) ; actif 1 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[1160]`
    - ↳ sous-sort 12769 « Pénitence » niv.4 :
      - **Échange de positions (lanceur ↔ cible)** → alliés hors lanceur, ennemis, l'entité qui a déclenché l'effet (attaquant)  `[8]`
  - **Échange de positions (lanceur ↔ cible)** → cible (hors lanceur) ; actif 1 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN), *info-bulle uniquement (comportement réel géré côté serveur)*  `[8]`
- **Analyse / rôle tactique** : Variante 2 PA (po 0–6 sans LdV, relance 2) : échange avec la cible et la marque 1 tour : allié → échange de nouveau s'il subit des dommages ; ennemi → échange s'il subit des dommages ; sur soi → échange avec ses attaquants. Interdit sous Pesanteur.


### Paire 18 — Bain de Sang / Immolation

#### Bain de Sang (`12732`) — sort de base (obtenu niv. 70)

> Augmente le Tacle du lanceur pour chaque entité dans la zone d'effet et vole de la vie dans l'élément Terre en zone.

- Caractéristiques (g2) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 25% · 2×/tour · cumul max 4
- Grades : g1 (niv. 70) : 4 PA, po 0–0, 21–24 vol Terre ; g2 (niv. 137) : 4 PA, po 0–0, 27–31 vol Terre
- Effets :
  - **le lanceur lance le sous-sort « Bain de Sang » (13993, niv. 2)** → tous sauf le lanceur dans la zone ; zone carré taille 1  `[1160]`
    - ↳ sous-sort 13993 « Bain de Sang » niv.2 :
      - **15 Tacle** → lanceur ; 1 tour(s)  `[753]`
  - **15 Tacle** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[753]`
  - **27 à 31 vol Terre (CC : 32 à 37)** → tous sauf le lanceur dans la zone ; zone carré taille 1  `[92]`
- **Analyse / rôle tactique** : Terre 4 PA (sur soi, 2×/tour, CC 25 %) : vol Terre 27–31 en carré 1 (pas le lanceur) et +15 Tacle (1 t., cumul 4) par entité dans la zone. Tank de contact.

#### Immolation (`12747`) — variante (obtenu niv. 180)

> Sacrifie une partie de la vie du lanceur pour occasionner des dommages Feu en zone. Les dommages n'affectent pas le lanceur.

- Caractéristiques (g1) : **4 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour
- Effets :
  - **-10% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
  - **40 à 44 dommages Feu (CC : 48 à 53)** → tous sauf le lanceur dans la zone ; zone cercle taille 2  `[99]`
- **Analyse / rôle tactique** : Variante Feu 4 PA (po 0–4, 2×/tour, CC 25 %) : -10 % PV puis 40–44 Feu en cercle 2 (pas le lanceur).


### Paire 19 — Hécatombe / Entaille

#### Hécatombe (`12750`) — sort de base (obtenu niv. 75)

> Réduit les soins reçus par les cibles et vole de la vie dans l'élément Feu en zone. N'affecte pas le lanceur.

- Caractéristiques (g2) : **4 PA** · portée 0–5 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour · cumul max 1
- Grades : g1 (niv. 75) : 4 PA, po 0–5, 21–24 vol Feu ; g2 (niv. 142) : 4 PA, po 0–5, 26–30 vol Feu
- Effets :
  - **Soins reçus x70%** → tous sauf le lanceur dans la zone ; zone croix diagonale taille 1, actif 1 tour(s), déclencheur : quand la cible est soignée  `[1159]`
  - **26 à 30 vol Feu (CC : 31 à 36)** → tous sauf le lanceur dans la zone ; zone croix diagonale taille 1  `[94]`
- **Analyse / rôle tactique** : Feu 4 PA (po 0–5, 2×/tour, CC 25 %) : vol Feu 26–30 en croix diagonale 1 (pas le lanceur) et soins reçus ×70 % (1 t.).

#### Entaille (`12751`) — variante (obtenu niv. 185)

> Sacrifie une partie de la vie du lanceur pour occasionner des dommages Terre.

- Caractéristiques (g1) : **4 PA** · portée 1–1 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour
- Effets :
  - **-10% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
  - **47 à 51 dommages Terre (CC : 56 à 61)** → cible (alliée ou ennemie)  `[97]`
- **Analyse / rôle tactique** : Variante Terre 4 PA au contact (2×/tour, CC 25 %) : -10 % PV puis 47–51 Terre. Meilleur mono-cible brut du Sacrieur.


### Paire 20 — Libation / Châtiment

#### Libation (`12759`) — sort de base (obtenu niv. 80)

> Sacrifie une partie de la vie du lanceur pour réduire la durée de ses effets et le soigner à la fin de son prochain tour. Les soins sont plus importants selon la Souffrance.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t.
- Grades : g1 (niv. 80) : 3 PA, po 0–0 ; g2 (niv. 147) : 2 PA, po 0–0
- Effets :
  - **-30% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
  - **la cible lance (sur elle-même) le sous-sort « Souffrance » (14087, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 14087 niv.1 : recalcul du palier de Souffrance selon les PV (voir §2.1)
  - **Durée des effets : -1** → lanceur  `[1075]`
  - **la cible lance (sur elle-même) le sous-sort « Libation » (16478, niv. 1)** → lanceur ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur  `[792]`
    - ↳ sous-sort 16478 « Libation » niv.1 :
      - **Soin : 0% des PV max** → lanceur — si lanceur n'a PAS l'état « Souffrance 1 » (616) ET si lanceur n'a PAS l'état « Souffrance 2 » (617) ET si lanceur n'a PAS l'état « Souffrance 3 » (618) ET si lanceur n'a PAS l'état « Souffrance 4 » (619) ET si lanceur n'a PAS l'état « Souffrance 5 » (620) ET si lanceur n'a PAS l'état « Souffrance 6 » (621) ET si lanceur n'a PAS l'état « Souffrance 7 » (622) ET si lanceur n'a PAS l'état « Souffrance 8 » (623) ET si lanceur n'a PAS l'état « Souffrance 9 » (624) ET si lanceur n'a PAS l'état « Souffrance 10 » (625)  `[1109]`
      - **Soin : 1% des PV max** → lanceur — si lanceur a l'état « Souffrance 1 » (616)  `[1109]`
      - **Soin : 3% des PV max** → lanceur — si lanceur a l'état « Souffrance 2 » (617)  `[1109]`
      - **Soin : 5% des PV max** → lanceur — si lanceur a l'état « Souffrance 3 » (618)  `[1109]`
      - **Soin : 9% des PV max** → lanceur — si lanceur a l'état « Souffrance 4 » (619)  `[1109]`
      - **Soin : 14% des PV max** → lanceur — si lanceur a l'état « Souffrance 5 » (620)  `[1109]`
      - **Soin : 19% des PV max** → lanceur — si lanceur a l'état « Souffrance 6 » (621)  `[1109]`
      - **Soin : 23% des PV max** → lanceur — si lanceur a l'état « Souffrance 7 » (622)  `[1109]`
      - **Soin : 26% des PV max** → lanceur — si lanceur a l'état « Souffrance 8 » (623)  `[1109]`
      - **Soin : 28% des PV max** → lanceur — si lanceur a l'état « Souffrance 9 » (624)  `[1109]`
      - **Soin : 30% des PV max** → lanceur — si lanceur a l'état « Souffrance 10 » (625)  `[1109]`
      - **la cible lance (sur elle-même) le sous-sort « Souffrance » (14087, niv. 1)** → lanceur  `[792]`
        - ↳ sous-sort 14087 niv.1 : recalcul du palier de Souffrance selon les PV (voir §2.1)
  - **Soin : 0% des PV max** → lanceur — si lanceur n'a PAS l'état « Souffrance 1 » (616) ET si lanceur n'a PAS l'état « Souffrance 2 » (617) ET si lanceur n'a PAS l'état « Souffrance 3 » (618) ET si lanceur n'a PAS l'état « Souffrance 4 » (619) ET si lanceur n'a PAS l'état « Souffrance 5 » (620) ET si lanceur n'a PAS l'état « Souffrance 6 » (621) ET si lanceur n'a PAS l'état « Souffrance 7 » (622) ET si lanceur n'a PAS l'état « Souffrance 8 » (623) ET si lanceur n'a PAS l'état « Souffrance 9 » (624) ET si lanceur n'a PAS l'état « Souffrance 10 » (625) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 1% des PV max** → lanceur — si lanceur a l'état « Souffrance 1 » (616) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 3% des PV max** → lanceur — si lanceur a l'état « Souffrance 2 » (617) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 5% des PV max** → lanceur — si lanceur a l'état « Souffrance 3 » (618) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 9% des PV max** → lanceur — si lanceur a l'état « Souffrance 4 » (619) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 14% des PV max** → lanceur — si lanceur a l'état « Souffrance 5 » (620) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 19% des PV max** → lanceur — si lanceur a l'état « Souffrance 6 » (621) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 23% des PV max** → lanceur — si lanceur a l'état « Souffrance 7 » (622) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 26% des PV max** → lanceur — si lanceur a l'état « Souffrance 8 » (623) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 28% des PV max** → lanceur — si lanceur a l'état « Souffrance 9 » (624) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 30% des PV max** → lanceur — si lanceur a l'état « Souffrance 10 » (625) ; actif 1 tour(s), délai 1 t., déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
- **Analyse / rôle tactique** : 2 PA (relance 3) : -30 % PV, réduit d'1 tour la durée de ses effets (se libère de malus), et à la fin de son prochain tour se soigne de 0/1/3/5/9/14/19/23/26/28/30 % PV max selon le palier de Souffrance (0 → 10). Descente contrôlée en Souffrance + soin différé.

#### Châtiment (`12760`) — variante (obtenu niv. 190)

> Occasionne des dommages Neutre aux ennemis en zone selon la vie restante du lanceur et en sacrifiant une partie de sa vie.

- Caractéristiques (g1) : **3 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t.
- Effets :
  - **Dommages Neutre : 15%  PV du lanceur** → ennemis dans la zone ; zone croix sans centre taille 1 (min 1)  `[89]`
  - **-15% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
- **Analyse / rôle tactique** : Variante 3 PA (sur soi, relance 3) : dommages Neutre = 15 % des PV actuels aux ennemis adjacents (croix sans centre), puis -15 % PV.


### Paire 21 — Berserk / Rituel de Jashin

#### Berserk (`12743`) — sort de base (obtenu niv. 85)

> Sacrifie une partie de la vie du lanceur pour lui appliquer l'état Berserk : • Rend le lanceur Intaclable. • Augmente ses dommages aux sorts. • Réduit les soins reçus par le lanceur.  L'état Berserk est retiré si le lanceur retourne en Souffrance 5 ou moins ou relance le sort.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · 1×/tour global (tous lanceurs)
- Grades : g1 (niv. 85) : 2 PA, po 0–0 ; g2 (niv. 152) : 2 PA, po 0–0
- Effets :
  - **-70% PV** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1048]`
  - **la cible lance (sur elle-même) le sous-sort « Berserk » (12772, niv. 1)** → lanceur — si cible n'a PAS l'état « Berserk » (1803)  `[792]`
    - ↳ sous-sort 12772 « Berserk » niv.1 :
      - **-70% PV** → lanceur ; durée infinie, non désenvoûtable  `[1048]`
  - **Applique l'état « Berserk » (1803)** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; durée infinie  `[950]`
  - **Applique l'état « Intaclable » (96)** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; durée infinie  `[950]`
  - **10% Dommages aux sorts** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; durée infinie  `[2812]`
  - **Change l'apparence** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; durée infinie  `[335]`
  - **Change une couleur** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; durée infinie  `[333]`
  - **Soins reçus x30%** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; actif 63 tour(s), déclencheur : quand la cible est soignée  `[1159]`
  - **la cible lance (sur elle-même) le sous-sort « Berserk » (12772, niv. 2)** → lanceur — si cible n'a PAS l'état « Berserk » (1803) ; actif 63 tour(s), déclencheur : variation de PV (INCERTAIN) OU INCERTAIN (VA) OU INCERTAIN (VM) OU INCERTAIN (VE) OU début de tour du porteur OU fin de tour du porteur OU quand la cible subit des dommages OU quand la cible est soignée OU dommages de poussée subis OU dommages subis en début de tour OU dommages subis en fin de tour OU dommages subis (variante V, INCERTAIN) OU INCERTAIN (LPU)  `[792]`
    - ↳ sous-sort 12772 « Berserk » niv.2 :
      - **Retire les effets du sort « Berserk » (12743)** → lanceur — si PV lanceur > 50%  `[406]`
  - **Retire les effets du sort « Berserk » (12743)** → lanceur — si lanceur a l'état « Berserk » (1803)  `[406]`
- **Analyse / rôle tactique** : 2 PA (relance 2, 1×/tour global) : -70 % PV → état Berserk : Intaclable, +10 % dommages aux sorts, soins reçus ×30 % ; retiré si les PV repassent > 50 %. Place immédiatement le Sacrieur en Souffrance 8 (+26 % dommages finaux, ×74 % dommages subis).

#### Rituel de Jashin (`14000`) — variante (obtenu niv. 195)

> Applique l'état Rituel de Jashin sur l'ennemi ciblé et pose un glyphe-aura sous le lanceur qui lui applique l'état et le rend Intaclable. Tant que le lanceur et la cible sont dans cet état, renvoie la totalité des dommages subis par le lanceur à la cible, et inversement.

- Caractéristiques (g1) : **3 PA** · portée 1–10 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 0% · relance 4 t. · relance globale 4 t.
- Effets :
  - **Applique l'état « Rituel de Jashin » (1241)** → cible ennemie ; 2 tour(s)  `[950]`
  - **Applique l'état « Rituel de Jashin ennemi » (5242)** → cible ennemie ; 2 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Rituel de Jashin » (14001, niv. 1)** → lanceur  `[1160]`
    - ↳ sous-sort 14001 « Rituel de Jashin » niv.1 :
      - **Pose un glyphe-aura « Rituel de Jashin » (14002, niv. 1)** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s)  `[1091]`
        - ↳ sous-sort 14002 « Rituel de Jashin » niv.1 :
          - **Applique l'état « Rituel de Jashin » (1241)** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s), non désenvoûtable  `[950]`
          - **Applique l'état « Rituel de Jashin caster » (5241)** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s), non désenvoûtable  `[950]`
          - **Change une couleur** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s), non désenvoûtable  `[333]`
          - **Change l'apparence** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s), non désenvoûtable  `[335]`
          - **Applique l'état « Intaclable » (96)** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s), non désenvoûtable  `[950]`
          - **Dommages : 100% des dommages finaux subis** → lanceur, ennemis ; zone tout le terrain (vivants), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1223]`
  - **la cible lance (sur elle-même) le sous-sort « Rituel de Jashin » (13999, niv. 2)** → cible ennemie ; actif 2 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[792]`
    - ↳ sous-sort 13999 « Rituel de Jashin » niv.2 :
      - **Dommages : 100% des dommages finaux subis** → ennemis dans la zone — si cible a l'état « Rituel de Jashin caster » (5241) ET si lanceur a l'état « Rituel de Jashin ennemi » (5242) ; zone tout le terrain (vivants)  `[1223]`
  - **la cible lance (sur elle-même) le sous-sort « Rituel de Jashin » (13999, niv. 1)** → lanceur ; actif 2 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[792]`
    - ↳ sous-sort 13999 « Rituel de Jashin » niv.1 :
      - **Dommages : 100% des dommages finaux subis** → ennemis dans la zone — si cible a l'état « Rituel de Jashin ennemi » (5242) ET si lanceur a l'état « Rituel de Jashin caster » (5241) ; zone tout le terrain (vivants)  `[1223]`
  - **Pose un glyphe-aura « Rituel de Jashin » (14002, niv. 1)** → lanceur (s’il est dans la zone) ; zone cercle taille 3, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1091]`
    - ↳ (sous-sort 14002 niv.1 déjà détaillé plus haut)
  - **la cible lance (sur elle-même) le sous-sort « Rituel de Jashin » (14002, niv. 2)** → lanceur ; actif 2 tour(s), déclencheur : quand l'état « Rituel de Jashin caster » (5241) est retiré  `[792]`
    - ↳ sous-sort 14002 « Rituel de Jashin » niv.2 :
      - **Retire les effets du sort « Rituel de Jashin » (14002)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–10, relance 4) : lie un ennemi au Sacrieur 2 tours (glyphe-aura cercle 3 sous lui, Intaclable) : les dommages finaux subis par l'un sont **intégralement renvoyés** à l'autre. Contre un boss : chaque coup du boss sur le Sacrieur blesse aussi le boss (et inversement).


### Paire 22 — Punition / Folie Sanguinaire

#### Punition (`12741`) — sort de base (obtenu niv. 90)

> Occasionne des dommages dans le meilleur élément du lanceur et des dommages Neutre selon sa vie érodée.

- Caractéristiques (g2) : **4 PA** · portée 1–1 (non modifiable) · sans ligne de vue · CC 25% · relance 3 t.
- Grades : g1 (niv. 90) : 4 PA, po 1–1, 25–28 meilleur élt ; g2 (niv. 157) : 4 PA, po 1–1, 31–35 meilleur élt
- Effets :
  - **31 à 35 dommages du meilleur élément (CC : 37 à 42)** → cible (alliée ou ennemie)  `[2822]`
  - **Dommages Neutre : 35%  PV érodés du lanceur** → cible (alliée ou ennemie)  `[1118]`
- **Analyse / rôle tactique** : 4 PA au contact (relance 3, CC 25 %) : 31–35 dégâts dans le meilleur élément + dommages Neutre = 35 % des PV érodés du Sacrieur.

#### Folie Sanguinaire (`12740`) — variante (obtenu niv. 200)

> Vole de la vie dans le meilleur élément du lanceur en zone. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g1) : **3 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 15% · relance 3 t.
- Effets :
  - **24 à 28 vol du meilleur élément (CC : 29 à 34)** → tous sauf le lanceur dans la zone ; zone cercle taille 3 (min 1)  `[2828]`
- **Analyse / rôle tactique** : Variante niveau 200, 3 PA (sur soi, relance 3, CC 15 %) : vol de vie meilleur élément 24–28 non dégressif en cercle 3 (sans centre) autour du Sacrieur.


## 4. Rôles en groupe de 4 (PvM niveau 200)

| Rôle | Pertinence | Détails |
|---|---|---|
| Tank | ★★★★★ | Souffrance (×70 % à bas PV), vols de vie, Sacrifice, Couronne d'Épines, Rituel de Jashin, Bain de Sang. |
| Placement | ★★★★★ | Attirance (9/13), Transposition, Assaut, Pénitence, Afflux/Condensation, Hostilité/Aversion, Fulgurance. |
| DPS mêlée/zone | ★★★★ | Sacrifices (Carnage, Immolation, Déchaînement, Entaille) + Souffrance +30 % finaux + Mutilation/Berserk. |
| Entrave | ★★ | Désolation (-3 PM), Dissolution (-30 Fuite), Pesanteur. |
| Soin | ★★ | Transferts de vie, Perfusion, Épée Vorace, Supplice (soin des attaquants). |

**Placement** : au contact du paquet ennemi, devant les alliés, idéalement à 2 cases d'eux pour couvrir les alliés avec Sacrifice
(cercle 2). Garder les PV entre 20 et 50 % (Souffrance 6–8).

## 5. Choix de variantes recommandés

| Paire | Base | Variante | Tank/placement | DPS sacrifice | Boss (renvoi) |
|---|---|---|---|---|---|
| 1 | Absorption | Furie | Absorption | Furie | Absorption |
| 2 | Supplice | Nervosité | Supplice | Nervosité | Supplice |
| 3 | Stase | Douleur Cuisante | Stase | Douleur Cuisante | Stase |
| 4 | Hémorragie | Décimation | Hémorragie | Décimation | Hémorragie |
| 5 | Attirance | Perfusion | Attirance | Attirance | Attirance |
| 6 | Mutilation | Pacte de Sang | Mutilation | Mutilation | Mutilation |
| 7 | Épée Vorace | Épée Dansante | Épée Vorace | Épée Vorace | Épée Dansante |
| 8 | Ravage | Fulgurance | Ravage | Fulgurance | Ravage |
| 9 | Assaut | Aversion | Assaut | Assaut | Assaut |
| 10 | Transposition | Fluctuation | Transposition | Transposition | Transposition |
| 11 | Condensation | Afflux | Condensation | Afflux | Condensation |
| 12 | Hostilité | Projection | Hostilité | Hostilité | Projection |
| 13 | Couronne d'Épines | Pilori | Couronne d'Épines | Couronne d'Épines | Couronne d'Épines |
| 14 | Transfusion | Liens du Sang | Transfusion | Liens du Sang | Liens du Sang |
| 15 | Dissolution | Carnage | Dissolution | Carnage | Dissolution |
| 16 | Désolation | Déchaînement | Désolation | Déchaînement | Désolation |
| 17 | Sacrifice | Pénitence | Sacrifice | Sacrifice | Pénitence |
| 18 | Bain de Sang | Immolation | Bain de Sang | Immolation | Bain de Sang |
| 19 | Hécatombe | Entaille | Hécatombe | Entaille | Entaille |
| 20 | Libation | Châtiment | Libation | Châtiment | Libation |
| 21 | Berserk | Rituel de Jashin | Berserk | Berserk | Rituel de Jashin |
| 22 | Punition | Folie Sanguinaire | Punition | Folie Sanguinaire | Punition |

## 6. Rotations types (11–12 PA, 6 PM)

1. **Engagement (11 PA)** : Berserk (2) → Attirance (2) sur la menace principale → Sacrifice (2) → Désolation (4) (+1 PA).
2. **Burst zone (12 PA)** : Afflux (2) → Immolation (4) → Déchaînement (4) → Assaut (2).
3. **Boss (12 PA)** : Rituel de Jashin (3) → Couronne d'Épines (2) → Entaille (4) → Supplice (3).
4. **Stabilisation** : Libation (2) → vols de vie (3+3) → Bain de Sang (4).

## 7. Forces / faiblesses

- Forces : tankiness à bas PV, placement, autonomie (vol de vie), protection des alliés, gros dégâts de zone.
- Faiblesses : burst à bas PV, soins alliés contre-productifs, zones qui touchent les alliés, courte portée.

## 8. Synergies

- **Féca** (boucliers plutôt que soins), **Eniripsa** (soigner les autres, pas le Sacrieur).
- **DPS distance** (Crâ, Sadida, Enutrof) : Sacrifice + Attirance éloignent la menace.
- **DPS mêlée** (Iop, Ouginak, Pandawa) : regroupement (Afflux/Condensation), Décimation, Supplice.

## 9. Questions ouvertes (INCERTAIN)

- Base des % de PV sacrifiés ; résistances utilisées lors de l'interception ; PV des Épées ; ordre dommages/sacrifice (Châtiment).

## Sources

- DofusDB API : https://api.dofusdb.fr/breeds/11 , https://api.dofusdb.fr/spell-variants?breedId=11 , https://api.dofusdb.fr/spells/24150 (passif Souffrance), https://api.dofusdb.fr/spells/14087 , https://api.dofusdb.fr/monsters/434 , https://api.dofusdb.fr/monsters/5192 , https://api.dofusdb.fr/spell-types/2608 (« Tooltips Sacrieur »)
- Énumération ActionIds (client Dofus) : `.cache/classes/ref/ActionIds.ts` ; grammaire des masques/déclencheurs : `DamageUtil.as` (`.cache/domath/d2client/`).

