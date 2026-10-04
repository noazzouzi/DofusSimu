# Pandawa — analyse complète pour DofusSimu (breed 12)

> « Bagarreur assoiffé ». Données : API DofusDB (fichiers du jeu, mise à jour du 23/06/2026) — `https://api.dofusdb.fr/breeds/12`,
> `https://api.dofusdb.fr/spell-variants?breedId=12`, `spells` (dont les sorts d'état **Saoul** 24036 et **Sobre** 24037),
> `spell-levels`, `spell-states`, `monsters` (Tonneaux 5843/5844, Pandawasta 5845, Bambou 5846, Petit Bambou 7355).
> Cache brut : `.cache/classes/csps/`. Rôles officiels (breedRoles) : **Placement 12** (« porte et jette une cible, peut se
> déplacer avec la cible »), **Dommages 8** (« augmente ses dégâts en passant en état d'ébriété »), **Tank 7** (« réduit les
> dommages subis en état d'ébriété et maintient ses adversaires au contact grâce à ses invocations »), Boost 5, Soin 4,
> Invocation 4, Entrave 3, Protection 1 (INCERTAIN). Complexité 3/3.

## 1. Vue d'ensemble

- **Profil** : combattant de mêlée/mi-distance à **deux postures** : **Sobre** (état 3531, par défaut, portées normales, accès au
  portage Karcham/Chamrak, Stabilisation, Varappe) et **Saoul** (état 498, 2 tours : -1 PM, **dommages subis ×85 %**, dégâts
  accrus mais portée de certains sorts divisée par 2, accès à Souffle Enflammé, Souillure, Fermentation, Lien Spiritueux,
  Pandanlku). Il **porte et jette** alliés, ennemis, Tonneaux et Bambous (placement le plus puissant du jeu).
- **Dégâts** : 4 éléments + meilleur élément. Les sorts de jet infligent dégâts (ennemis) / soins (alliés) à l'impact
  (Brancard Terre, Pandikulation Feu, Propulsion Air, Eau-de-vie/Cascade Eau). Gros sorts Saoul : Pandatak (46–50 Terre),
  Vague à Lame (44–48 Eau), Souffle Alcoolisé (34–38 Air), Souffle Enflammé (38–42 Feu), Main de Pandawa (70 meilleur élément).
- **Soutien** : soins de jet (alliés jetés/touchés), Consolation (attire + 7 %), Fermentation (bouclier 240 % du niveau ×2),
  Ivresse (Tonneau soignant), Stabilisation (Enracine + 40 Esquive PM), Varappe (Intaclable), Pandanlku (+3 PM), Prohibition
  (Invulnérable en mêlée + Insoignable), Lait de Bambou (-4 tours d'effets sur soi).
- **Entrave** : Engourdissement Saoul (-3 PM en croix diagonale), Schnaps (-30 Retrait PA/PM en Sobre, -40 Rés. Poussée en Saoul),
  Souillure (-150 Puissance, -1 durée), Main de Pandawa (-500 Puissance), Ribote (-40 Fuite), Ethylo (-3 PO), Brassage (Pesanteur
  ou ×110 % dommages subis), Pandawasta (Coup de Bambou -30 Fuite/-100 Puissance).

## 2. Mécaniques spécifiques à implémenter (moteur)

1. **Postures Sobre / Saoul** :
   - Saoul (sort 24036) : retire Sobre, pose l'état 498 **2 tours**, **-1 PM non esquivable** (2 t.), **dommages subis ×85 %**
     (2 t.) ; impossible si le Pandawa est **Porté** (8) ou sous **Prohibition** (3536).
   - Sobre (sort 24037) : retire Saoul et ses effets, pose 3531 (infini). Saoul expire au bout de 2 tours → Sobre.
   - Passages : Bombance (1 PA, bascule ; +1 PA remboursé en devenant Sobre), Picole (1 PA, bascule ; +1 PM en devenant Sobre,
     cumul 3), Gueule de Bois (devient Sobre, +dégâts si on vient de quitter Saoul), Lait de Bambou/Prohibition (Sobre),
     Ribote/Alcoshu/Liqueur/Absinthe/Bistouille (deviennent Saoul), Tonneaux jetés (Saoul), Main de Pandawa (Sobre en fin de tour).
   - De nombreux sorts ont deux jeux d'effets conditionnés par `*E3531` (Sobre) / `*E498` (Saoul) ; certains exigent l'état via
     `statesCriterion` (HS=498 : Souffle Enflammé, Souillure, Fermentation, Lien Spiritueux, Pandanlku ; HS=3531 : Stabilisation,
     Varappe). **Portée divisée par deux en Saoul** pour Flasque Explosive, Pandatak, Souffle Alcoolisé, Vague à Lame, Brassage
     (annoncé dans les descriptions, non visible dans les effets → règle moteur à coder, INCERTAIN : arrondi).
2. **Porter / jeter** (effets 50 et 51) : Karcham/Chamrak (1 PA, au contact, 4×/tour, 6×/tour global) portent un allié/ennemi
   (le Pandawa doit être Sobre, non porté) ; une fois **Porteur** (état 3), le même sort **jette** l'entité (Karcham +5 PO,
   Chamrak +3 PO et sans LdV). Les sorts « Jette la cible » (Brancard, Pandikulation, Propulsion, Eau-de-vie, Cascade) exigent
   l'état Porteur (HS=3) et appliquent leurs effets à l'impact sur l'entité jetée (masque `K`, INCERTAIN = entité portée/jetée) et
   en zone autour de la case d'arrivée. Pendant le portage, l'entité portée (état Porté 8) suit le Pandawa ; l'état Porteur a le
   flag `preventsSpellCast` (INCERTAIN : seuls les sorts dont le critère accepte HS=3 restent lançables).
3. **Tonneaux** (Ébriété → Tonneau de l'Éméché 5844 ; Ivresse → Tonneau de l'Ivrogne 5843 ; ne consomment pas d'emplacement) :
   porter son Tonneau rend 1 PA et donne +50 Puissance (Éméché) ou soigne 7 % PV max (Ivrogne) ; le jeter rend le Pandawa Saoul
   et déclenche à l'impact « Potion Magique » (Éméché : 4–6 / 6–8 / 8–10 dégâts meilleur élément en cercle 2 selon le rang
   d'Ébriété 1–3) ou « Grande Rasade » (Ivrogne : soin 7 % PV max aux alliés en cercle 2). Ces sous-sorts (25507/25508) sont
   aussi déclenchés par les autres jets tant que l'état Ivresse (4029)/Ébriété (4030) est actif. Un seul Tonneau à la fois.
4. **Invocations** : Pandawasta (5845, 1 emplacement, 6 PA/5 PM, 15 % ou 35 % de résistances, maîtrisable) : Méditation Ivre
   (+325 Vitalité, +325 Agilité, +1 PM pendant 4 t.), Coup de Bambou (-30 Fuite, -100 Puissance), Révérence Alcoolisée (porte un
   Tonneau / jette) ; il réduit de 50 % les dommages immédiats des alliés (sur lui) et peut porter le Pandawa Sobre qui l'attaque en
   mêlée. Bambou (5846) : obstacle statique qui réduit de 80 % les dommages alliés, peut porter le Pandawa ; Bambouseraie : Petits
   Bambous (7355) en cercle 2, morts au prochain tour du Pandawa.
5. **Paume Explosive** : coût +1 PA après le premier lancer du tour (effet 296) ; en Sobre la zone devient cercle 2, en Saoul
   +12 dégâts de base (chaque bonus cumulable une fois). **Distillation** : poison Eau de début de tour 3 tours, +4 dégâts de
   base par poison déclenché (cumul 4), bonus retiré à l'utilisation.
6. **Main de Pandawa** (niveau 200) : -500 Puissance à la cible ; Sobre → 70 dégâts meilleur élément ; Saoul → 7 dans chacun des
   5 éléments ; en fin de tour, le Pandawa redevient Sobre et, s'il subit des dommages de mêlée, riposte (25 meilleur élément) et
   porte l'attaquant.


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB/fichiers du jeu, juin 2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Paume Explosive (12781) | base | 1 | 2 | 0–5 | /LdV | — | 3/t | 10% | 20–22 Feu | damage, aoe, ramp |
| 1 | Distillation (12815) | var. | 100 | 4 | 0–6 | /LdV | — | 1/t | 20% | 13–16 Eau | damage, aoe, poison |
| 2 | Gueule de Bois (12803) | base | 1 | 3 | 1–3 | /LdV | — | 3/t 2/c | 10% | 24–27 Terre, 34–37 Terre | damage, posture |
| 2 | Souffle Enflammé (12805) | var. | 95 | 4 | 1–3 | L/LdV | — | 1/t | 20% | 38–42 Feu | damage, aoe, debuff |
| 3 | Schnaps (12782) | base | 1 | 3 | 1–8+ | /LdV | — | 2/t | 10% | 21–24 Air | damage, aoe, debuff |
| 3 | Ribote (12786) | var. | 105 | 2 | 1–6 | /LdV | — | 3/t 2/c | 10% | 20–22 Terre | damage, posture, debuff |
| 4 | Ethylo (12791) | base | 1 | 3 | 1–6+ | /LdV | — | 3/t 2/c | 10% | 25–28 Eau | damage, range |
| 4 | Engourdissement (12807) | var. | 110 | 4 | 1–7+ | /LdV | — | 1/t | 20% | 36–40 Air | damage, aoe, mp-removal |
| 5 | Bombance (12804) | base | 5 | 1 | 0–0 | /sans LdV | — | 6/t | 0% | — | posture, ap-refund |
| 5 | Picole (12780) | var. | 115 | 1 | 0–0 | /sans LdV | — | 6/t | 0% | — | posture, mobility |
| 6 | Karcham (12787) | base | 10 | 1 | 1–1 | L/LdV | — | 4/t 1/c | 0% | — | carry, throw, placement |
| 6 | Chamrak (12810) | var. | 120 | 1 | 1–1 | /sans LdV | — | 4/t 1/c | 0% | — | carry, throw, placement |
| 7 | Épouvante (12783) | base | 15 | 2 | 1–7+ | L/LdV | — | 3/t 1/c | 0% | — | push, debuff |
| 7 | Consolation (12806) | var. | 125 | 2 | 1–6 | L/LdV | — | 1/t | 0% | — | pull, heal, placement |
| 8 | Brancard (12811) | base | 20 | 2 | 1–5 | L/sans LdV | — | 1/t | 10% | 28–32 soin Terre, 28–32 Terre | throw, damage, heal |
| 8 | Alcoshu (14307) | var. | 130 | 2 | 1–6+ | /LdV | — | 2/t | 10% | 15–17 vol Eau | damage, lifesteal, posture |
| 9 | Pandikulation (12793) | base | 25 | 2 | 1–4 | /LdV | — | 1/t | 10% | 28–31 soin Feu, 28–31 Feu | throw, damage, heal |
| 9 | Liqueur (12809) | var. | 135 | 3 | 1–7+ | /LdV | — | 3/t 2/c | 10% | 22–25 vol Air | damage, lifesteal, posture |
| 10 | Ébriété (12826) | base | 30 | 2 | 1–1 | /sans LdV | — | 1/t | 0% | 8–10 meilleur élt | summon, buff, damage |
| 10 | Ivresse (12777) | var. | 140 | 2 | 1–1 | /sans LdV | — | 1/t | 0% | — | summon, heal, ap-refund |
| 11 | Stabilisation (12789) | base | 35 | 2 | 0–6+ | /LdV | 3 | — | 0% | — | support, anti-push, dodge |
| 11 | Varappe (12813) | var. | 145 | 2 | 0–6 | /sans LdV | 3 | — | 0% | — | buff, placement |
| 12 | Propulsion (12788) | base | 40 | 2 | 1–4 | /LdV | — | 1/t | 10% | 33–37 soin Air, 33–37 Air | throw, damage, heal |
| 12 | Absinthe (12820) | var. | 150 | 2 | 1–5 | /sans LdV | — | 2/t | 5% | 17–19 vol Feu | damage, lifesteal, posture |
| 13 | Eau-de-vie (12808) | base | 45 | 2 | 1–4 | /sans LdV | — | 1/t | 15% | 26–29 soin Eau, 26–29 Eau | throw, damage, heal |
| 13 | Bistouille (12821) | var. | 155 | 4 | 0–0 | /sans LdV | — | 2/t | 15% | 34–38 vol Terre | damage, aoe, lifesteal |
| 14 | Souillure (12792) | base | 50 | 2 | 1–3 | /LdV | — | 2/t 1/c | 0% | — | debuff, dispel |
| 14 | Brassage (12816) | var. | 160 | 2 | 0–6 | /LdV | — | 2/t 1/c | 0% | — | damage-amp, anti-mobility |
| 15 | Fermentation (12819) | base | 55 | 3 | 0–3 | /LdV | 3 | — | 0% | — | shield, support |
| 15 | Bambouseraie (12785) | var. | 165 | 2 | 0–3 | /sans LdV | 2 | — | 0% | — | summon, obstacle, placement |
| 16 | Éviction (12790) | base | 60 | 2 | 1–1 | /sans LdV | — | 2/t | 5% | 15–17 Terre | damage, mobility, placement |
| 16 | Souffle Alcoolisé (12784) | var. | 170 | 3 | 1–10 | L/LdV | — | 2/t | 10% | 28–32 Air, 34–38 Air | damage, aoe, push |
| 17 | Flasque Explosive (12796) | base | 65 | 2 | 1–8 | L/LdV | — | 1/t | 10% | 18–20 Feu, 22–25 Feu | damage, aoe |
| 17 | Pandatak (12797) | var. | 175 | 4 | 1–6 | L/LdV | — | 2/t | 15% | 38–42 Terre, 46–50 Terre | damage, aoe |
| 18 | Lait de Bambou (24038) | base | 70 | 2 | 0–0 | /sans LdV | 3 | — | 0% | — | self-cleanse, posture |
| 18 | Prohibition (12817) | var. | 180 | 2 | 0–5 | L/LdV | 3 | — | 0% | — | protect, debuff, posture |
| 19 | Nausée (12814) | base | 75 | 2 | 1–8+ | L/LdV | — | 2/t | 5% | 15–17 Air | damage, escape, push |
| 19 | Cascade (12823) | var. | 185 | 2 | 1–5 | L/sans LdV | — | 1/t | 15% | 24–28 soin Eau, 24–28 Eau | throw, damage, heal |
| 20 | Vague à Lame (12794) | base | 80 | 4 | 1–10 | L/LdV | — | 2/t | 15% | 36–40 Eau, 44–48 Eau | damage, aoe, push |
| 20 | Pandjiu (14309) | var. | 190 | 3 | 1–5 | /LdV | — | 2/t | 10% | 28–32 Feu | damage, pull |
| 21 | Lien Spiritueux (12799) | base | 85 | 3 | 1–5+ | L/sans LdV | 5 | — | 0% | — | summon, tank, debuff |
| 21 | Bambou (12824) | var. | 195 | 2 | 1–4 | /LdV | — | 1/t | 0% | — | summon, obstacle, ap-refund |
| 22 | Pandanlku (12798) | base | 90 | 2 | 0–6+ | /LdV | 4 | — | 0% | — | buff, mobility |
| 22 | Main de Pandawa (24039) | var. | 200 | 5 | 1–5 | /LdV | 5 | — | 5% | 70–70 meilleur élt, 7–7 Neutre, 7–7 Terre, 7–7 Feu | damage, debuff, finisher |


### Paire 1 — Paume Explosive / Distillation

#### Paume Explosive (`12781`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Feu. N'affecte pas le lanceur.  Modifie le sort selon l'état du lanceur après un lancer : • Le coût en PA du sort est augmenté après le premier lancer. • Sobre : les dommages s'appliquent en zone. • Saoul : les dommages du sort sont augmentés.  Chaque effet est cumulable une fois.

- Caractéristiques (g3) : **2 PA** · portée 0–5 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 3×/tour · cumul max 1
- Grades : g1 (niv. 1) : 2 PA, po 0–5, 12–14 Feu ; g2 (niv. 67) : 2 PA, po 0–5, 15–17 Feu ; g3 (niv. 133) : 2 PA, po 0–5, 20–22 Feu
- Effets :
  - **20 à 22 dommages Feu (CC : 24 à 26)** → cible (hors lanceur) — si lanceur n'a PAS l'état « Paume Explosive Sobre » (3532)  `[99]`
  - **Paume Explosive : +1 PA** → lanceur ; 1 tour(s), non désenvoûtable  `[296]`
  - **Applique l'état « Paume Explosive Sobre » (3532)** → lanceur — si lanceur a l'état « Sobre » (3531) ET si lanceur n'a PAS l'état « Paume Explosive Sobre » (3532) ; 1 tour(s), non désenvoûtable  `[950]`
  - **20 à 22 dommages Feu (CC : 24 à 26)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Paume Explosive Sobre » (3532) ; zone cercle taille 2  `[99]`
  - **le lanceur lance le sous-sort « État Sobre : » (25606, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25606 niv.1 : info-bulle « État Sobre »
  - **le lanceur lance le sous-sort « Change la zone d'effet en Cercle de taille 2 » (25604, niv. 1)** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25604 niv.1 : info-bulle (zone cercle 2 en Sobre)
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **Paume Explosive : +12 dégâts de base** → lanceur — si lanceur a l'état « Saoul » (498) ET si lanceur n'a PAS l'état « Paume Explosive Saoul » (3533) ; 1 tour(s), non désenvoûtable  `[293]`
  - **Applique l'état « Paume Explosive Saoul » (3533)** → lanceur — si lanceur a l'état « Saoul » (498) ET si lanceur n'a PAS l'état « Paume Explosive Saoul » (3533) ; non désenvoûtable  `[950]`
- **Analyse / rôle tactique** : Feu 2 PA (po 0–5, 3×/tour) : 20–22 Feu (pas le lanceur) ; après le 1er lancer, coût +1 PA ; Sobre → les lancers suivants frappent en cercle 2, Saoul → +12 dégâts de base. Sort de remplissage Feu.

#### Distillation (`12815`) — variante (obtenu niv. 100)

> Occasionne des dommages et applique un poison Eau de début de tour sur les cibles en zone. N'affecte pas le lanceur.  Les dommages du sort et du poison sont augmentés pour chaque poison du sort déclenché sur une cible (cumulable 4 fois).  Les bonus sont retirés après utilisation du sort.

- Caractéristiques (g2) : **4 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 20% · 1×/tour · cumul max 1
- Grades : g1 (niv. 100) : 4 PA, po 0–5, 10–13 Eau ; g2 (niv. 167) : 4 PA, po 0–6, 13–16 Eau
- Effets :
  - **13 à 16 dommages Eau (CC : 17 à 20)** → tous sauf le lanceur dans la zone ; zone carré taille 1  `[96]`
  - **13 à 16 dommages Eau (CC : 17 à 20)** → tous sauf le lanceur dans la zone ; zone carré taille 1, actif 3 tour(s), déclencheur : début de tour du porteur  `[96]`
  - **le lanceur lance le sous-sort « Distillation » (25528, niv. 2)** → tous sauf le lanceur dans la zone ; zone carré taille 1, actif 3 tour(s), déclencheur : début de tour du porteur OU dommages subis en début de tour (variante X, INCERTAIN)  `[1160]`
    - ↳ sous-sort 25528 « Distillation » niv.2 :
      - **Distillation : +4 dégâts de base** → lanceur ; 2 tour(s)  `[293]`
  - **Distillation : +4 dégâts de base** → lanceur ; 2 tour(s), actif 3 tour(s), déclencheur : début de tour du porteur, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **Retire les effets du sort « Distillation » (25528)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Variante Eau 4 PA (po 0–6, 1×/tour, CC 20 %) : 13–16 Eau en carré 1 + poison Eau 13–16 au début des 3 prochains tours des cibles ; +4 dégâts de base par poison déclenché (cumul 4).


### Paire 2 — Gueule de Bois / Souffle Enflammé

#### Gueule de Bois (`12803`) — sort de base (obtenu niv. 1)

> Rend le lanceur Sobre et occasionne des dommages Terre. Les dommages sont plus importants si le lanceur est sorti de l'état Saoul pendant le tour en cours.

- Caractéristiques (g3) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–3, 14–16 Terre, 18–20 Terre ; g2 (niv. 66) : 3 PA, po 1–3, 19–22 Terre, 25–28 Terre ; g3 (niv. 132) : 3 PA, po 1–3, 24–27 Terre, 34–37 Terre
- Effets :
  - **le lanceur lance le sous-sort « Sobre » (24037, niv. 1)** → lanceur — si cible a l'état « Saoul » (498)  `[1160]`
    - ↳ sous-sort 24037 niv.1 : passage en état Sobre (retire Saoul)
  - **Applique l'état « Sobre » (3531)** → lanceur ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **24 à 27 dommages Terre (CC : 29 à 32)** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Gueule de Bois » (3577) ET si lanceur n'a PAS l'état « Saoul » (498)  `[97]`
  - **34 à 37 dommages Terre (CC : 39 à 42)** → cible (alliée ou ennemie) — si lanceur a l'état « Gueule de Bois » (3577) ET si lanceur n'a PAS l'état « Saoul » (498)  `[97]`
  - **34 à 37 dommages Terre (CC : 39 à 42)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[97]`
- **Analyse / rôle tactique** : Terre 3 PA (po 1–3, 3×/tour, 2×/cible) : rend Sobre et inflige 24–27 Terre (34–37 si l'on est sorti de Saoul ce tour-ci ou si l'on était Saoul). Sort pivot pour revenir Sobre en frappant.

#### Souffle Enflammé (`12805`) — variante (obtenu niv. 95)

> Occasionne des dommages Feu et réduit les chances de Critique en zone.

- Caractéristiques (g2) : **4 PA** · portée 1–3 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · 1×/tour · cumul max 1 · condition : lanceur a l’état « Saoul » (498)
- Grades : g1 (niv. 95) : 4 PA, po 1–2, 31–34 Feu ; g2 (niv. 162) : 4 PA, po 1–3, 38–42 Feu
- Effets :
  - **38 à 42 dommages Feu (CC : 46 à 50)** → tous (alliés+ennemis) dans la zone ; zone cône taille 2  `[99]`
  - **-20% Critique** → tous (alliés+ennemis) dans la zone ; zone cône taille 2, 1 tour(s)  `[171]`
- **Analyse / rôle tactique** : Variante Feu 4 PA en ligne (po 1–3, **Saoul requis**, 1×/tour, CC 20 %) : 38–42 Feu en cône 2 et -20 % Critique (1 t.).


### Paire 3 — Schnaps / Ribote

#### Schnaps (`12782`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Air et applique des effets sur les cibles selon l'état du lanceur en zone : • Sobre : retire du Retrait PA et PM. • Saoul : réduit les Résistances Poussée.  N'affecte pas le lanceur.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · cumul max 2
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 12–14 Air ; g2 (niv. 68) : 3 PA, po 1–7, 17–19 Air ; g3 (niv. 134) : 3 PA, po 1–8, 21–24 Air
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **21 à 24 dommages Air (CC : 25 à 29)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Sobre » (3531) ; zone croix taille 1  `[98]`
  - **-30 Retrait PM** → tous sauf le lanceur dans la zone — si lanceur a l'état « Sobre » (3531) ; zone croix taille 1, 2 tour(s)  `[413]`
  - **-30 Retrait PA** → tous sauf le lanceur dans la zone — si lanceur a l'état « Sobre » (3531) ; zone croix taille 1, 2 tour(s)  `[411]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **21 à 24 dommages Air (CC : 25 à 29)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Saoul » (498) ; zone croix taille 1  `[98]`
  - **-40 Résistances Poussée** → tous sauf le lanceur dans la zone — si lanceur a l'état « Saoul » (498) ; zone croix taille 1, 2 tour(s)  `[417]`
- **Analyse / rôle tactique** : Air 3 PA (po 1–8, 2×/tour) : 21–24 Air en croix 1 (pas le lanceur) ; Sobre → -30 Retrait PA et -30 Retrait PM (2 t.) ; Saoul → -40 Résistance Poussée (2 t.) (prépare les dommages de poussée des jets).

#### Ribote (`12786`) — variante (obtenu niv. 105)

> Applique des effets selon l'état du lanceur et occasionne des dommages Terre : • Sobre : rend le lanceur Saoul. • Saoul : retire de la Fuite à la cible.

- Caractéristiques (g2) : **2 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 105) : 2 PA, po 1–5, 17–19 Terre ; g2 (niv. 172) : 2 PA, po 1–6, 20–22 Terre
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si lanceur a l'état « Sobre » (3531) ET si lanceur n'a PAS l'état « Prohibition » (3536)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **Applique l'état « Saoul » (498)** → lanceur (s’il est dans la zone) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **20 à 22 dommages Terre (CC : 24 à 26)** → cible (alliée ou ennemie) — si lanceur a l'état « Sobre » (3531)  `[97]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **20 à 22 dommages Terre (CC : 24 à 26)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[97]`
  - **-40 Fuite** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498) ; 1 tour(s)  `[754]`
- **Analyse / rôle tactique** : Variante Terre 2 PA (po 1–6, 3×/tour, 2×/cible) : 20–22 Terre ; Sobre → rend Saoul ; Saoul → -40 Fuite à la cible.


### Paire 4 — Ethylo / Engourdissement

#### Ethylo (`12791`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Eau et applique des effets selon l'état du lanceur : • Sobre : augmente la Portée du lanceur. • Saoul : retire de la Portée à la cible.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–4, 15–17 Eau ; g2 (niv. 69) : 3 PA, po 1–5, 20–23 Eau ; g3 (niv. 136) : 3 PA, po 1–6, 25–28 Eau
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **25 à 28 dommages Eau (CC : 30 à 34)** → cible (alliée ou ennemie) — si lanceur a l'état « Sobre » (3531)  `[96]`
  - **3 Portée** → lanceur — si lanceur a l'état « Sobre » (3531) ; 1 tour(s)  `[117]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **25 à 28 dommages Eau (CC : 30 à 34)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[96]`
  - **-3 Portée** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498) ; 1 tour(s)  `[116]`
- **Analyse / rôle tactique** : Eau 3 PA (po 1–6, 3×/tour, 2×/cible) : 25–28 Eau ; Sobre → +3 PO au Pandawa (1 t.) ; Saoul → -3 PO à la cible.

#### Engourdissement (`12807`) — variante (obtenu niv. 110)

> Occasionne des dommages Air et applique des effets selon l'état du lanceur en zone : • Sobre : augmente les PM du lanceur pour chaque entité touché (cumulable 3 fois). • Saoul : retire des PM aux cibles.  Les dommages n'affectent pas le lanceur.

- Caractéristiques (g2) : **4 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 20% · 1×/tour · cumul max 1
- Grades : g1 (niv. 110) : 4 PA, po 1–6, 31–34 Air ; g2 (niv. 177) : 4 PA, po 1–7, 36–40 Air
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **le lanceur lance le sous-sort « Engourdissement » (24241, niv. 1)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Sobre » (3531) ; zone croix diagonale taille 1  `[1160]`
    - ↳ sous-sort 24241 « Engourdissement » niv.1 :
      - **1 PM** → lanceur ; 1 tour(s)  `[128]`
  - **1 PM** → lanceur — si lanceur a l'état « Sobre » (3531) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[128]`
  - **36 à 40 dommages Air (CC : 43 à 48)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Sobre » (3531) ; zone croix diagonale taille 1  `[98]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **36 à 40 dommages Air (CC : 43 à 48)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Saoul » (498) ; zone croix diagonale taille 1  `[98]`
  - **Retire 3 PM (esquivable)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Saoul » (498) ; zone croix diagonale taille 1, 1 tour(s), non désenvoûtable  `[1080]`
- **Analyse / rôle tactique** : Variante Air 4 PA (po 1–7, 1×/tour, CC 20 %) : 36–40 Air en croix diagonale 1 (pas le lanceur) ; Sobre → +1 PM par entité touchée (cumul 3) ; Saoul → -3 PM aux cibles.


### Paire 5 — Bombance / Picole

#### Bombance (`12804`) — sort de base (obtenu niv. 5)

> Rend le lanceur Saoul ou Sobre. Rend 1 PA s'il devient Sobre.

- Caractéristiques (g3) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 6×/tour · condition : lanceur n’a pas l’état « Porté » (8) ET lanceur n’a pas l’état « Prohibition » (3536)
- Grades : g1 (niv. 5) : 1 PA, po 0–0 ; g2 (niv. 72) : 1 PA, po 0–0 ; g3 (niv. 139) : 1 PA, po 0–0
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si cible a l'état « Sobre » (3531)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **la cible lance (sur elle-même) le sous-sort « Sobre » (24037, niv. 1)** → lanceur — si cible a l'état « Saoul » (498)  `[792]`
    - ↳ sous-sort 24037 niv.1 : passage en état Sobre (retire Saoul)
  - **Applique l'état « Saoul » (498)** → cible (alliée ou ennemie) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Sobre » (3531)** → cible (alliée ou ennemie) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Rembourse 1 PA** → lanceur — si cible a l'état « Saoul » (498) ; non désenvoûtable  `[120]`
- **Analyse / rôle tactique** : 1 PA (6×/tour, interdit si Porté ou sous Prohibition) : bascule Sobre ↔ Saoul ; rembourse 1 PA en redevenant Sobre (bascule « gratuite » Saoul→Sobre).

#### Picole (`12780`) — variante (obtenu niv. 115)

> Rend le lanceur Saoul ou Sobre. Augmente ses PM s'il devient Sobre.

- Caractéristiques (g2) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 6×/tour · cumul max 3 · condition : lanceur n’a pas l’état « Porté » (8) ET lanceur n’a pas l’état « Prohibition » (3536)
- Grades : g1 (niv. 115) : 1 PA, po 0–0 ; g2 (niv. 182) : 1 PA, po 0–0
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si cible a l'état « Sobre » (3531)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **la cible lance (sur elle-même) le sous-sort « Sobre » (24037, niv. 1)** → lanceur — si cible a l'état « Saoul » (498)  `[792]`
    - ↳ sous-sort 24037 niv.1 : passage en état Sobre (retire Saoul)
  - **Applique l'état « Saoul » (498)** → cible (alliée ou ennemie) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Sobre » (3531)** → cible (alliée ou ennemie) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **1 PM** → lanceur — si cible a l'état « Saoul » (498) ; 1 tour(s), non désenvoûtable  `[128]`
- **Analyse / rôle tactique** : Variante 1 PA : bascule Sobre ↔ Saoul ; +1 PM (1 t., cumul 3) en redevenant Sobre.


### Paire 6 — Karcham / Chamrak

#### Karcham (`12787`) — sort de base (obtenu niv. 10)

> Porte ou jette la cible.  La portée maximale du sort est augmentée lorsque le lanceur porte une cible.

- Caractéristiques (g3) : **1 PA** · portée 1–1 (non modifiable) · en ligne uniquement · ligne de vue requise · cible requise (case occupée) · CC 0% · 4×/tour · 1×/cible · 6×/tour global (tous lanceurs) · condition : lanceur a l’état « Porteur » (3) OU (lanceur a l’état « Sobre » (3531) ET lanceur n’a pas l’état « Goule Anerice » (534) ET lanceur n’a pas l’état « Porté Bambou » (661) ET lanceur n’a pas l’état « Porté » (8))
- Grades : g1 (niv. 10) : 1 PA, po 1–1 ; g2 (niv. 77) : 1 PA, po 1–1 ; g3 (niv. 144) : 1 PA, po 1–1
- Effets :
  - **Porte la cible** → cible (hors lanceur) — si lanceur n'a PAS l'état « Porteur » (3)  `[50]`
  - **Applique l'état « Porteur » (3)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Karcham : +5 Portée maximale** → lanceur ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[281]`
  - **Lance une entité** → cible (hors lanceur) — si lanceur a l'état « Porteur » (3)  `[51]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
- **Analyse / rôle tactique** : 1 PA au contact en ligne (4×/tour, 1×/cible, 6×/tour global) : porte la cible (Pandawa Sobre requis) ; si l'on porte déjà → jette l'entité (+5 PO). Base de tout le placement Pandawa (sortir un allié, déplacer un monstre).

#### Chamrak (`12810`) — variante (obtenu niv. 120)

> Porte ou jette la cible.  La portée maximale du sort est augmentée et sa ligne de vue est désactivée lorsque le lanceur porte une cible.

- Caractéristiques (g2) : **1 PA** · portée 1–1 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · 4×/tour · 1×/cible · 6×/tour global (tous lanceurs) · condition : lanceur a l’état « Porteur » (3) OU (lanceur a l’état « Sobre » (3531) ET lanceur n’a pas l’état « Goule Anerice » (534) ET lanceur n’a pas l’état « Porté Bambou » (661) ET lanceur n’a pas l’état « Porté » (8))
- Grades : g1 (niv. 120) : 1 PA, po 1–1 ; g2 (niv. 187) : 1 PA, po 1–1
- Effets :
  - **Porte la cible** → cible (hors lanceur) — si lanceur n'a PAS l'état « Porteur » (3)  `[50]`
  - **Applique l'état « Porteur » (3)** → cible (alliée ou ennemie) ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Chamrak : +3 Portée maximale** → lanceur ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[281]`
  - **Lance une entité** → cible (hors lanceur) — si lanceur a l'état « Porteur » (3)  `[51]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
- **Analyse / rôle tactique** : Variante 1 PA : comme Karcham mais +3 PO et **sans ligne de vue** pour le jet (lancer par-dessus les obstacles).


### Paire 7 — Épouvante / Consolation

#### Épouvante (`12783`) — sort de base (obtenu niv. 15)

> Repousse la cible et applique des effets sur la cible selon l'état du lanceur : • Sobre : la poussée est plus importante. • Saoul : réduit les chances de Critique.

- Caractéristiques (g3) : **2 PA** · portée 1–7 (modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · 3×/tour · 1×/cible · cumul max 2
- Grades : g1 (niv. 15) : 2 PA, po 1–5 ; g2 (niv. 82) : 2 PA, po 1–6 ; g3 (niv. 149) : 2 PA, po 1–7
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie) — si lanceur a l'état « Sobre » (3531)  `[5]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **Repousse la cible de 1 case(s)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[5]`
  - **-15% Critique** → cible ennemie — si lanceur a l'état « Saoul » (498) ; 2 tour(s)  `[171]`
- **Analyse / rôle tactique** : 2 PA en ligne (po 1–7, 3×/tour, 1×/cible) : repousse de 2 (Sobre) ou de 1 + -15 % Critique 2 t. (Saoul). Pas de dégâts (hors dommages de poussée).

#### Consolation (`12806`) — variante (obtenu niv. 125)

> Attire et soigne l'allié ciblé.

- Caractéristiques (g2) : **2 PA** · portée 1–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · 1×/tour
- Grades : g1 (niv. 125) : 2 PA, po 1–5 ; g2 (niv. 192) : 2 PA, po 1–6
- Effets :
  - **Attire la cible de 5 case(s)** → cible alliée  `[6]`
  - **Soin : 7% des PV max** → cible alliée  `[1109]`
- **Analyse / rôle tactique** : Variante 2 PA en ligne (po 1–6, 1×/tour) : attire un allié de 5 cases et le soigne de 7 % PV max. Sauvetage d'allié.


### Paire 8 — Brancard / Alcoshu

#### Brancard (`12811`) — sort de base (obtenu niv. 20)

> Jette la cible, attire les cibles et rapproche le lanceur vers la cible, soigne les alliés et occasionne des dommages Terre aux ennemis en zone.

- Caractéristiques (g3) : **2 PA** · portée 1–5 (non modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 10% · 1×/tour · condition : lanceur a l’état « Porteur » (3)
- Grades : g1 (niv. 20) : 2 PA, po 1–5, 18–20 soin Terre, 18–20 Terre ; g2 (niv. 87) : 2 PA, po 1–5, 23–26 soin Terre, 23–26 Terre ; g3 (niv. 154) : 2 PA, po 1–5, 28–32 soin Terre, 28–32 Terre
- Effets :
  - **Applique l'état « Brancard Train » (4043)** → tous sauf le lanceur dans la zone ; zone ligne depuis le lanceur taille 1 (min 63), 1 tour(s)  `[950]`
  - **Applique l'état « Brancard » (2519)** → alliés (dont lanceur si dans la zone), ennemis, K (INCERTAIN: entité portée/porteur) ; 1 tour(s)  `[950]`
  - **Lance une entité** → cible (alliée ou ennemie)  `[51]`
  - **le lanceur lance sur la case ciblée le sous-sort « Brancard » (12828, niv. 2)** → lanceur  `[2960]`
    - ↳ sous-sort 12828 « Brancard » niv.2 :
      - **Attire la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard Train » (4043) ; zone croix sans centre taille 2 (min 2)  `[6]`
      - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard Train » (4043) ; zone croix sans centre taille 3 (min 3)  `[6]`
      - **Attire la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard Train » (4043) ; zone croix sans centre taille 4 (min 4)  `[6]`
      - **Attire la cible de 4 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard Train » (4043) ; zone croix sans centre taille 5 (min 5)  `[6]`
      - **Attire la cible de 4 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard Train » (4043) ; zone croix sans centre illimitée (63) (min 6)  `[6]`
      - **Retire l'état « Brancard Train » (4043)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard Train » (4043) ; zone tout le terrain  `[951]`
  - **la cible lance (sur elle-même) le sous-sort « Brancard » (12828, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 12828 « Brancard » niv.1 :
      - **Le lanceur avance de 5 case(s) vers la cible** → tous (alliés+ennemis) dans la zone — si cible a l'état « Brancard » (2519) ; zone tout le terrain (vivants)  `[1042]`
      - **Retire l'état « Brancard » (2519)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
  - **Attire la cible de 4 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **Le lanceur avance de 5 case(s) vers la cible** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1042]`
  - **28 à 32 soins Terre (CC : 34 à 38)** → alliés hors lanceur, K (INCERTAIN: entité portée/porteur)  `[3000]`
  - **28 à 32 soins Terre (CC : 34 à 38)** → alliés (hors lanceur) dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[3000]`
  - **28 à 32 dommages Terre (CC : 34 à 38)** → ennemis, K (INCERTAIN: entité portée/porteur)  `[97]`
  - **28 à 32 dommages Terre (CC : 34 à 38)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[97]`
- **Analyse / rôle tactique** : 2 PA en ligne (po 1–5 sans LdV, **Porteur requis**, case libre, 1×/tour) : jette l'entité portée ; à l'impact 28–32 Terre aux ennemis / soin Terre 28–32 aux alliés (entité jetée + première cible de la ligne), attire de 1 à 4 cases les entités alignées derrière et le Pandawa avance de 5 vers la cible.

#### Alcoshu (`14307`) — variante (obtenu niv. 130)

> Rend le lanceur Saoul et vole de la vie dans l'élément Eau.

- Caractéristiques (g2) : **2 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 130) : 2 PA, po 1–5, 13–15 vol Eau ; g2 (niv. 197) : 2 PA, po 1–6, 15–17 vol Eau
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si lanceur a l'état « Sobre » (3531) ET si lanceur n'a PAS l'état « Prohibition » (3536)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **Applique l'état « Saoul » (498)** → lanceur (s’il est dans la zone) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **15 à 17 vol Eau (CC : 18 à 20)** → cible (alliée ou ennemie)  `[91]`
- **Analyse / rôle tactique** : Variante 2 PA (po 1–6, 2×/tour) : rend Saoul (si Sobre, hors Prohibition) et vole Eau 15–17.


### Paire 9 — Pandikulation / Liqueur

#### Pandikulation (`12793`) — sort de base (obtenu niv. 25)

> Jette la cible, attire les cibles vers le centre, soigne les alliés et occasionne des dommages Feu aux ennemis en zone.

- Caractéristiques (g3) : **2 PA** · portée 1–4 (non modifiable) · ligne de vue requise · case libre requise · CC 10% · 1×/tour · condition : lanceur a l’état « Porteur » (3)
- Grades : g1 (niv. 25) : 2 PA, po 1–4, 18–20 soin Feu, 18–20 Feu ; g2 (niv. 92) : 2 PA, po 1–4, 23–25 soin Feu, 23–25 Feu ; g3 (niv. 159) : 2 PA, po 1–4, 28–31 soin Feu, 28–31 Feu
- Effets :
  - **Lance une entité** → cible (alliée ou ennemie)  `[51]`
  - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 2  `[6]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
  - **28 à 31 soins Feu (CC : 34 à 37)** → alliés hors lanceur, K (INCERTAIN: entité portée/porteur)  `[108]`
  - **28 à 31 soins Feu (CC : 34 à 37)** → alliés (hors lanceur) dans la zone ; zone croix taille 2  `[108]`
  - **28 à 31 dommages Feu (CC : 34 à 37)** → ennemis, K (INCERTAIN: entité portée/porteur)  `[99]`
  - **28 à 31 dommages Feu (CC : 34 à 37)** → ennemis dans la zone ; zone croix taille 2  `[99]`
- **Analyse / rôle tactique** : 2 PA (po 1–4, Porteur requis, case libre) : jette l'entité ; à l'impact soin Feu 28–31 aux alliés / 28–31 Feu aux ennemis en croix 2, et attire de 2 vers le centre les entités en croix 2. Regroupement + soin/dégâts.

#### Liqueur (`12809`) — variante (obtenu niv. 135)

> Rend le lanceur Saoul et vole de la vie dans l'élément Air.

- Caractéristiques (g1) : **3 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si lanceur a l'état « Sobre » (3531) ET si lanceur n'a PAS l'état « Prohibition » (3536)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **Applique l'état « Saoul » (498)** → lanceur (s’il est dans la zone) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **22 à 25 vol Air (CC : 26 à 30)** → cible (alliée ou ennemie)  `[93]`
- **Analyse / rôle tactique** : Variante Air 3 PA (po 1–7, 3×/tour, 2×/cible) : rend Saoul et vole Air 22–25.


### Paire 10 — Ébriété / Ivresse

#### Ébriété (`12826`) — sort de base (obtenu niv. 30)

> Invoque un Tonneau qui augmente la Puissance de son invocateur lorsqu'il est porté et le rend Saoul quand il est jeté. Le lanceur occasionne également des dommages dans son meilleur élément aux ennemis en zone autour du point d'impact.  Rend 1 PA au lanceur s'il porte son Tonneau.  Si le Tonneau du lanceur est encore présent et que le sort est relancé, l'ancien est détruit pour laisser place au nouveau.

- Caractéristiques (g3) : **2 PA** · portée 1–1 (non modifiable) · sans ligne de vue · case libre requise · CC 0% · 1×/tour · cumul max 1
- Grades : g1 (niv. 30) : 2 PA, po 1–1, 4–6 meilleur élt ; g2 (niv. 97) : 2 PA, po 1–1, 6–8 meilleur élt ; g3 (niv. 164) : 2 PA, po 1–1, 8–10 meilleur élt
- Effets :
  - **Invoque « Tonneau de l'Éméché » (monstre 5844, grade 1)** → cible (alliée ou ennemie)  `[181]`
  - **+50 Puissance** → personnages joueurs alliés, invocations du lanceur ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **Applique l'état « Saoul » (498)** → personnages joueurs alliés, invocations du lanceur ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **8 à 10 dommages du meilleur élément** → ennemis dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2822]`
- **Analyse / rôle tactique** : 2 PA au contact (case libre) : Tonneau de l'Éméché ; le porter rend 1 PA et donne +50 Puissance (2 t.) ; le jeter rend Saoul et inflige 8–10 dégâts meilleur élément en cercle 2 autour de l'impact (Potion Magique, rangs 1–3). Un seul Tonneau à la fois.

#### Ivresse (`12777`) — variante (obtenu niv. 140)

> Invoque un Tonneau qui soigne son invocateur lorsqu'il est porté et le rend Saoul quand il est jeté. Le lanceur soigne également ses alliés en zone autour du point d'impact.  Rend 1 PA au lanceur s'il porte son Tonneau.  Si le Tonneau du lanceur est encore présent et que le sort est relancé, l'ancien est détruit pour laisser place au nouveau.

- Caractéristiques (g1) : **2 PA** · portée 1–1 (non modifiable) · sans ligne de vue · case libre requise · CC 0% · 1×/tour
- Effets :
  - **Invoque « Tonneau de l'Ivrogne » (monstre 5843, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Soin : 7% des PV max** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Applique l'état « Saoul » (498)** → personnages joueurs alliés, invocations du lanceur ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Variante 2 PA : Tonneau de l'Ivrogne ; le porter rend 1 PA et soigne 7 % PV max ; le jeter rend Saoul et soigne 7 % PV max les alliés en cercle 2 autour de l'impact (Grande Rasade).


### Paire 11 — Stabilisation / Varappe

#### Stabilisation (`12789`) — sort de base (obtenu niv. 35)

> Enracine la cible et augmente l'Esquive PM de l'allié ciblé.

- Caractéristiques (g3) : **2 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 0% · relance 3 t. · cumul max 1 · condition : lanceur a l’état « Sobre » (3531)
- Grades : g1 (niv. 35) : 2 PA, po 0–4 ; g2 (niv. 102) : 2 PA, po 0–5 ; g3 (niv. 169) : 2 PA, po 0–6
- Effets :
  - **Applique l'état « Enraciné » (6)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **40 Esquive PM** → cible alliée ; 1 tour(s)  `[161]`
- **Analyse / rôle tactique** : 2 PA (po 0–6, **Sobre requis**, relance 3) : Enracine la cible (insensible poussées/échanges, ne tacle pas et n'est pas taclée) 1 tour et +40 Esquive PM à un allié. Protège un allié des retraits PM/déplacements ou fixe un ennemi.

#### Varappe (`12813`) — variante (obtenu niv. 145)

> Augmente le nombre de lancers par tour et par cible des sorts Karcham ou Chamrak du lanceur. Rend également l'allié ciblé Intaclable.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t. · relance globale -1 t. · condition : lanceur a l’état « Sobre » (3531)
- Effets :
  - **Karcham : +2 lancer(s) par tour** → lanceur — si lanceur a l'état « Karcham » (3583) ; 1 tour(s)  `[290]`
  - **Karcham : +1 lancer(s) par cible** → lanceur — si lanceur a l'état « Karcham » (3583) ; 1 tour(s)  `[291]`
  - **Chamrak : +2 lancer(s) par tour** → lanceur — si lanceur a l'état « Chamrak » (3584) ; 1 tour(s)  `[290]`
  - **Chamrak : +1 lancer(s) par cible** → lanceur — si lanceur a l'état « Chamrak » (3584) ; 1 tour(s)  `[291]`
  - **Applique l'état « Intaclable » (96)** → cible alliée ; 1 tour(s)  `[950]`
- **Analyse / rôle tactique** : Variante 2 PA (Sobre requis, relance 3) : Karcham/Chamrak +2 lancers par tour et +1 par cible pour ce tour, et rend un allié Intaclable. Tour de placement massif (portages multiples).


### Paire 12 — Propulsion / Absinthe

#### Propulsion (`12788`) — sort de base (obtenu niv. 40)

> Jette la cible, soigne les alliés, occasionne des dommages Air aux ennemis et repousse les cibles depuis le centre en zone. Les soins n'affectent pas le lanceur.

- Caractéristiques (g3) : **2 PA** · portée 1–4 (non modifiable) · ligne de vue requise · case libre requise · CC 10% · 1×/tour · condition : lanceur a l’état « Porteur » (3)
- Grades : g1 (niv. 40) : 2 PA, po 1–4, 21–23 soin Air, 21–23 Air ; g2 (niv. 107) : 2 PA, po 1–4, 27–30 soin Air, 27–30 Air ; g3 (niv. 174) : 2 PA, po 1–4, 33–37 soin Air, 33–37 Air
- Effets :
  - **Lance une entité** → cible (alliée ou ennemie)  `[51]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
  - **33 à 37 soins Air (CC : 40 à 44)** → alliés hors lanceur, K (INCERTAIN: entité portée/porteur)  `[2999]`
  - **33 à 37 soins Air (CC : 40 à 44)** → alliés (hors lanceur) dans la zone ; zone croix taille 1  `[2999]`
  - **33 à 37 dommages Air (CC : 40 à 44)** → ennemis, K (INCERTAIN: entité portée/porteur)  `[98]`
  - **33 à 37 dommages Air (CC : 40 à 44)** → ennemis dans la zone ; zone croix taille 1  `[98]`
  - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1  `[5]`
- **Analyse / rôle tactique** : 2 PA (po 1–4, Porteur requis, case libre) : jette l'entité ; à l'impact soin Air 33–37 aux alliés / 33–37 Air aux ennemis en croix 1, repousse de 1 depuis le centre.

#### Absinthe (`12820`) — variante (obtenu niv. 150)

> Rend le lanceur Saoul et vole de la vie dans l'élément Feu.

- Caractéristiques (g1) : **2 PA** · portée 1–5 (non modifiable) · sans ligne de vue · CC 5% · 2×/tour
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si lanceur a l'état « Sobre » (3531) ET si lanceur n'a PAS l'état « Prohibition » (3536)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **Applique l'état « Saoul » (498)** → lanceur (s’il est dans la zone) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **17 à 19 vol Feu (CC : 20 à 23)** → cible (alliée ou ennemie)  `[94]`
- **Analyse / rôle tactique** : Variante Feu 2 PA (po 1–5 sans LdV, 2×/tour) : rend Saoul et vole Feu 17–19.


### Paire 13 — Eau-de-vie / Bistouille

#### Eau-de-vie (`12808`) — sort de base (obtenu niv. 45)

> Jette la cible, soigne les alliés et occasionne des dommages Eau aux ennemis en zone. N'affecte pas le lanceur.

- Caractéristiques (g3) : **2 PA** · portée 1–4 (non modifiable) · sans ligne de vue · case libre requise · CC 15% · 1×/tour · condition : lanceur a l’état « Porteur » (3)
- Grades : g1 (niv. 45) : 2 PA, po 1–4, 16–18 soin Eau, 16–18 Eau ; g2 (niv. 112) : 2 PA, po 1–4, 22–24 soin Eau, 22–24 Eau ; g3 (niv. 179) : 2 PA, po 1–4, 26–29 soin Eau, 26–29 Eau
- Effets :
  - **Lance une entité** → cible (alliée ou ennemie)  `[51]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
  - **26 à 29 soins Eau (CC : 31 à 35)** → alliés (dont lanceur si dans la zone), K (INCERTAIN: entité portée/porteur)  `[2998]`
  - **26 à 29 soins Eau (CC : 31 à 35)** → alliés (hors lanceur) dans la zone ; zone croix taille 1  `[2998]`
  - **26 à 29 dommages Eau (CC : 31 à 35)** → ennemis, K (INCERTAIN: entité portée/porteur)  `[96]`
  - **26 à 29 dommages Eau (CC : 31 à 35)** → ennemis dans la zone ; zone croix taille 1  `[96]`
- **Analyse / rôle tactique** : 2 PA (po 1–4 sans LdV, Porteur requis, case libre) : jette l'entité ; à l'impact soin Eau 26–29 aux alliés / 26–29 Eau aux ennemis en croix 1.

#### Bistouille (`12821`) — variante (obtenu niv. 155)

> Rend le lanceur Saoul et vole de la vie dans l'élément Terre en zone.

- Caractéristiques (g1) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 15% · 2×/tour
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Saoul » (24036, niv. 1)** → lanceur — si lanceur a l'état « Sobre » (3531) ET si lanceur n'a PAS l'état « Prohibition » (3536)  `[792]`
    - ↳ sous-sort 24036 niv.1 : passage en état Saoul (voir §2.1 : 2 tours, -1 PM, ×85 % dommages subis)
  - **Applique l'état « Saoul » (498)** → lanceur (s’il est dans la zone) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **34 à 38 vol Terre (CC : 41 à 46)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 1  `[92]`
- **Analyse / rôle tactique** : Variante Terre 4 PA (sur soi, 2×/tour, CC 15 %) : rend Saoul et vole Terre 34–38 aux entités adjacentes (pas le lanceur).


### Paire 14 — Souillure / Brassage

#### Souillure (`12792`) — sort de base (obtenu niv. 50)

> Réduit la durée des effets sur la cible et retire de la Puissance aux ennemis.

- Caractéristiques (g3) : **2 PA** · portée 1–3 (non modifiable) · ligne de vue requise · CC 0% · 2×/tour · 1×/cible · condition : lanceur a l’état « Saoul » (498)
- Grades : g1 (niv. 50) : 2 PA, po 1–3 ; g2 (niv. 117) : 2 PA, po 1–3 ; g3 (niv. 184) : 2 PA, po 1–3
- Effets :
  - **Durée des effets : -1** → cible (alliée ou ennemie)  `[1075]`
  - **-150 Puissance** → cible ennemie ; 1 tour(s)  `[186]`
- **Analyse / rôle tactique** : 2 PA (po 1–3, **Saoul requis**, 2×/tour, 1×/cible) : -1 tour aux effets de la cible et -150 Puissance (1 t.) aux ennemis.

#### Brassage (`12816`) — variante (obtenu niv. 160)

> Applique des effets sur la cible selon l'état du lanceur : • Sobre : augmente les dommages subis par la cible. • Saoul : applique l'état Pesanteur sur la cible et l'état Brassage sur le lanceur.  L'état Brassage empêche l'utilisation du sort dans l'état Saoul. La portée du sort est modifiable dans l'état Sobre, mais elle est réduite de moitié si le lanceur est Saoul.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 0% · 2×/tour · 1×/cible · cumul max 1
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[792]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **Dommages subis x110%** → cible (alliée ou ennemie) — si lanceur a l'état « Sobre » (3531) ; actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
  - **la cible lance (sur elle-même) le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[792]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **Applique l'état « Pesanteur » (7)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498) ; 1 tour(s)  `[950]`
  - **Applique l'état « Brassage » (4072)** → lanceur — si lanceur a l'état « Saoul » (498) ; 3 tour(s)  `[950]`
  - **Applique l'état « Brassage II » (6108)** → lanceur — si lanceur a l'état « Saoul » (498) ; 1 tour(s), délai 1 t.  `[950]`
  - **Applique l'état « Brassage I » (4073)** → lanceur — si lanceur a l'état « Saoul » (498) ; 1 tour(s), délai 2 t.  `[950]`
- **Analyse / rôle tactique** : Variante 2 PA (po 0–6, 2×/tour, 1×/cible) : Sobre → ×110 % dommages subis (2 t.) ; Saoul → Pesanteur (1 t.) sur la cible et état Brassage (3 t.) qui empêche de relancer en Saoul. Portée divisée par 2 en Saoul.


### Paire 15 — Fermentation / Bambouseraie

#### Fermentation (`12819`) — sort de base (obtenu niv. 55)

> Applique un bouclier sur l'allié ciblé immédiatement et au tour suivant.

- Caractéristiques (g3) : **3 PA** · portée 0–3 (non modifiable) · ligne de vue requise · CC 0% · relance 3 t. · cumul max 1 · condition : lanceur a l’état « Saoul » (498)
- Grades : g1 (niv. 55) : 3 PA, po 0–3 ; g2 (niv. 122) : 3 PA, po 0–3 ; g3 (niv. 189) : 3 PA, po 0–3
- Effets :
  - **Retire les effets du sort « Fermentation » (12819)** → cible alliée  `[406]`
  - **Bouclier : 240% du niveau** → cible alliée ; 1 tour(s)  `[1020]`
  - **Bouclier : 240% du niveau** → cible alliée ; 1 tour(s), délai 1 t.  `[1020]`
- **Analyse / rôle tactique** : 3 PA (po 0–3, **Saoul requis**, relance 3) : bouclier 240 % du niveau à un allié immédiatement, puis de nouveau au tour suivant (2 × 480 PV au niveau 200).

#### Bambouseraie (`12785`) — variante (obtenu niv. 165)

> Invoque plusieurs Petits Bambous en zone.  Les Bambous meurent au début du prochain tour du lanceur.

- Caractéristiques (g1) : **2 PA** · portée 0–3 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · relance globale 2 t.
- Effets :
  - **Invoque « Petit Bambou » (monstre 7355, grade 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Petit Bambou » (7355) ; zone cercle taille 2 (min 1)  `[181]`
- **Analyse / rôle tactique** : Variante 2 PA (po 0–3, relance 2) : invoque des Petits Bambous dans un cercle de 2 (obstacles portables) qui meurent au début du prochain tour du Pandawa. Mur temporaire / blocage de chemin.


### Paire 16 — Éviction / Souffle Alcoolisé

#### Éviction (`12790`) — sort de base (obtenu niv. 60)

> Applique des effets selon l'état du lanceur et occasionne des dommages Terre aux ennemis. • Sobre : téléporte le lanceur symétriquement par rapport à la cible. • Saoul : téléporte la cible symétriquement par rapport au lanceur et occasionne les dommages en zone.

- Caractéristiques (g3) : **2 PA** · portée 1–1 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 5% · 2×/tour
- Grades : g1 (niv. 60) : 2 PA, po 1–1, 11–13 Terre ; g2 (niv. 127) : 2 PA, po 1–1, 13–15 Terre ; g3 (niv. 194) : 2 PA, po 1–1, 15–17 Terre
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **Téléportation symétrique par rapport à la cible** → lanceur — si lanceur a l'état « Sobre » (3531)  `[1104]`
  - **15 à 17 dommages Terre (CC : 19 à 21)** → cible ennemie — si lanceur a l'état « Sobre » (3531)  `[97]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **Téléportation symétrique par rapport au lanceur** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[1105]`
  - **15 à 17 dommages Terre (CC : 19 à 21)** → ennemis dans la zone — si lanceur a l'état « Saoul » (498) ; zone cercle taille 2  `[97]`
- **Analyse / rôle tactique** : Terre 2 PA au contact (2×/tour) : Sobre → le Pandawa se téléporte symétriquement par rapport à la cible + 15–17 Terre ; Saoul → la cible est téléportée symétriquement par rapport au Pandawa et 15–17 Terre en cercle 2.

#### Souffle Alcoolisé (`12784`) — variante (obtenu niv. 170)

> Occasionne des dommages Air aux ennemis et repousse les cibles en zone.  La portée du sort est réduite de moitié mais les dommages sont plus importants si le lanceur est Saoul.

- Caractéristiques (g1) : **3 PA** · portée 1–10 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **28 à 32 dommages Air (CC : 34 à 38)** → ennemis dans la zone — si lanceur a l'état « Sobre » (3531) ; zone ligne taille 3  `[98]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Sobre » (3531) ; zone ligne taille 3  `[5]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **34 à 38 dommages Air (CC : 40 à 44)** → ennemis dans la zone — si lanceur a l'état « Saoul » (498) ; zone ligne taille 3  `[98]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Saoul » (498) ; zone ligne taille 3  `[5]`
- **Analyse / rôle tactique** : Variante Air 3 PA en ligne (po 1–10, réduite de moitié en Saoul, 2×/tour) : 28–32 Air (34–38 en Saoul) en ligne de 3 aux ennemis et repousse de 2.


### Paire 17 — Flasque Explosive / Pandatak

#### Flasque Explosive (`12796`) — sort de base (obtenu niv. 65)

> Occasionne des dommages Feu en zone. N'affecte pas le lanceur.  La portée du sort est réduite de moitié mais les dommages sont plus importants si le lanceur est Saoul.

- Caractéristiques (g3) : **2 PA** · portée 1–8 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 1×/tour
- Grades : g1 (niv. 65) : 2 PA, po 1–6, 13–15 Feu, 16–19 Feu ; g2 (niv. 131) : 2 PA, po 1–8, 16–18 Feu, 20–22 Feu ; g3 (niv. 198) : 2 PA, po 1–8, 18–20 Feu, 22–25 Feu
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **18 à 20 dommages Feu (CC : 22 à 24)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Sobre » (3531) ; zone cercle taille 2  `[99]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **22 à 25 dommages Feu (CC : 26 à 30)** → tous sauf le lanceur dans la zone — si lanceur a l'état « Saoul » (498) ; zone cercle taille 2  `[99]`
- **Analyse / rôle tactique** : Feu 2 PA en ligne (po 1–8, moitié en Saoul, 1×/tour) : 18–20 Feu (22–25 Saoul) en cercle 2 (pas le lanceur, alliés compris).

#### Pandatak (`12797`) — variante (obtenu niv. 175)

> Occasionne des dommages Terre en zone.  La portée du sort est réduite de moitié mais les dommages sont plus importants si le lanceur est Saoul.

- Caractéristiques (g1) : **4 PA** · portée 1–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **38 à 42 dommages Terre (CC : 46 à 50)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Sobre » (3531) ; zone ligne taille 2  `[97]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **46 à 50 dommages Terre (CC : 54 à 58)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Saoul » (498) ; zone ligne taille 2  `[97]`
- **Analyse / rôle tactique** : Variante Terre 4 PA en ligne (po 1–6, moitié en Saoul, 2×/tour, CC 15 %) : 38–42 Terre (46–50 Saoul) en ligne de 2 (alliés compris). Le plus gros sort Terre.


### Paire 18 — Lait de Bambou / Prohibition

#### Lait de Bambou (`24038`) — sort de base (obtenu niv. 70)

> Réduit la durée des effets sur le lanceur et le rend Sobre.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t.
- Grades : g1 (niv. 70) : 3 PA, po 0–0 ; g2 (niv. 137) : 2 PA, po 0–0
- Effets :
  - **Durée des effets : -4** → lanceur  `[1075]`
  - **la cible lance (sur elle-même) le sous-sort « Sobre » (24037, niv. 1)** → lanceur — si lanceur a l'état « Saoul » (498)  `[792]`
    - ↳ sous-sort 24037 niv.1 : passage en état Sobre (retire Saoul)
  - **Applique l'état « Sobre » (3531)** → cible (alliée ou ennemie) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : 2 PA (relance 3) : -4 tours à la durée des effets sur le Pandawa et le rend Sobre. Purge de malus.

#### Prohibition (`12817`) — variante (obtenu niv. 180)

> Rend la cible Insoignable et Invulnérable en mêlée.  Sur le lanceur : • Rend Invulnérable en mêlée et Sobre. • Applique l'état Prohibition, qui empêche l'entrée dans l'état Saoul et l'application des effets des Tonneaux sur lui. • Rend Insoignable au début du prochain tour.

- Caractéristiques (g1) : **2 PA** · portée 0–5 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · relance 3 t. · relance globale -1 t.
- Effets :
  - **Applique l'état « Insoignable » (76)** → cible (hors lanceur) ; 1 tour(s)  `[950]`
  - **Applique l'état « Invulnérable en Mêlée » (376)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Sobre » (24037, niv. 1)** → lanceur (s’il est dans la zone) — si cible a l'état « Saoul » (498)  `[792]`
    - ↳ sous-sort 24037 niv.1 : passage en état Sobre (retire Saoul)
  - **Applique l'état « Sobre » (3531)** → lanceur (s’il est dans la zone) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Prohibition » (3536)** → lanceur (s’il est dans la zone) ; 1 tour(s), non désenvoûtable  `[950]`
  - **Applique l'état « Insoignable » (76)** → lanceur (s’il est dans la zone) ; 1 tour(s), délai 1 t.  `[950]`
- **Analyse / rôle tactique** : Variante 2 PA en ligne (po 0–5, relance 3) : la cible devient Insoignable et Invulnérable en mêlée (1 t.) ; sur soi : Invulnérable en mêlée, Sobre, état Prohibition (pas de Saoul ni d'effets de Tonneau) et Insoignable au début du tour suivant. Protège un allié des mêlées ou empêche un monstre de se soigner.


### Paire 19 — Nausée / Cascade

#### Nausée (`12814`) — sort de base (obtenu niv. 75)

> Applique des effets selon l'état du lanceur et occasionne des dommages Air aux ennemis : • Sobre : éloigne le lanceur de la cible. • Saoul : repousse la cible.

- Caractéristiques (g2) : **2 PA** · portée 1–8 (modifiable) · en ligne uniquement · ligne de vue requise · CC 5% · 2×/tour
- Grades : g1 (niv. 75) : 2 PA, po 1–6, 12–14 Air ; g2 (niv. 142) : 2 PA, po 1–8, 15–17 Air
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie) — si lanceur a l'état « Sobre » (3531)  `[1041]`
  - **15 à 17 dommages Air (CC : 18 à 20)** → cible ennemie — si lanceur a l'état « Sobre » (3531)  `[98]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **Repousse la cible de 1 case(s)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[5]`
  - **15 à 17 dommages Air (CC : 18 à 20)** → cible ennemie — si lanceur a l'état « Saoul » (498)  `[98]`
- **Analyse / rôle tactique** : Air 2 PA en ligne (po 1–8, 2×/tour) : 15–17 Air ; Sobre → le Pandawa recule de 2 ; Saoul → repousse la cible de 1.

#### Cascade (`12823`) — variante (obtenu niv. 185)

> Jette la cible, soigne les alliés, occasionne des dommages Eau aux ennemis et repousse les entités en zone.

- Caractéristiques (g1) : **2 PA** · portée 1–5 (non modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 15% · 1×/tour · condition : lanceur a l’état « Porteur » (3)
- Effets :
  - **Lance une entité** → cible (alliée ou ennemie)  `[51]`
  - **Applique l'état « Cascade » (4229)** → tous (alliés+ennemis) dans la zone ; zone ligne depuis le lanceur taille 1 (min 63), 1 tour(s)  `[950]`
  - **24 à 28 soins Eau (CC : 29 à 34)** → alliés (dont lanceur si dans la zone), K (INCERTAIN: entité portée/porteur)  `[2998]`
  - **24 à 28 dommages Eau (CC : 29 à 34)** → ennemis, K (INCERTAIN: entité portée/porteur)  `[96]`
  - **24 à 28 soins Eau (CC : 29 à 34)** → alliés dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[2998]`
  - **24 à 28 dommages Eau (CC : 29 à 34)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[96]`
  - **24 à 28 soins Eau (CC : 29 à 34)** → alliés dans la zone ; zone ligne perpendiculaire (barre en T) taille 1  `[2998]`
  - **24 à 28 dommages Eau (CC : 29 à 34)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 1  `[96]`
  - **le lanceur lance le sous-sort « Cascade » (12822, niv. 1)** → lanceur  `[1160]`
    - ↳ sous-sort 12822 « Cascade » niv.1 :
      - **Repousse la cible de 4 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Cascade » (4229) ; zone tout le terrain (vivants)  `[5]`
      - **Retire l'état « Cascade » (4229)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Cascade » (4229) ; zone tout le terrain (vivants)  `[951]`
  - **Repousse la cible de 4 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **le lanceur lance sur la case ciblée le sous-sort « Grande Rasade » (25507, niv. 1)** → lanceur — si lanceur a l'état « Ivresse » (4029)  `[2960]`
    - ↳ sous-sort 25507 « Grande Rasade » niv.1 :
      - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle taille 2 (min 1)  `[1109]`
  - **le lanceur lance sur la case ciblée le sous-sort « Potion Magique » (25508, niv. 1)** → lanceur — si lanceur a l'état « Ébriété » (4030)  `[2960]`
    - ↳ sous-sort 25508 « Potion Magique » niv.1 :
      - **4 à 6 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 1 » (4077) ; zone cercle taille 2 (min 1)  `[2822]`
      - **6 à 8 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 2 » (4078) ; zone cercle taille 2 (min 1)  `[2822]`
      - **8 à 10 dommages du meilleur élément** → ennemis dans la zone — si lanceur a l'état « Ébriété rang 3 » (4079) ; zone cercle taille 2 (min 1)  `[2822]`
- **Analyse / rôle tactique** : Variante 2 PA (po 1–5 sans LdV, Porteur requis) : jette l'entité ; soin Eau 24–28 aux alliés / 24–28 Eau aux ennemis sur l'entité jetée, la 1re cible de la ligne et en barre perpendiculaire 1 à l'impact, puis repousse de 4 les entités marquées.


### Paire 20 — Vague à Lame / Pandjiu

#### Vague à Lame (`12794`) — sort de base (obtenu niv. 80)

> Occasionne des dommages Eau aux ennemis et repousse les cibles en zone. La poussée est appliquée uniquement si le lanceur est Sobre.  La portée du sort est réduite de moitié mais les dommages sont plus importants si le lanceur est Saoul.

- Caractéristiques (g2) : **4 PA** · portée 1–10 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour
- Grades : g1 (niv. 80) : 4 PA, po 1–8, 29–32 Eau, 35–38 Eau ; g2 (niv. 147) : 4 PA, po 1–10, 36–40 Eau, 44–48 Eau
- Effets :
  - **le lanceur lance le sous-sort « État Sobre : » (24024, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24024 niv.1 : info-bulle « État Sobre »
  - **36 à 40 dommages Eau (CC : 43 à 48)** → ennemis dans la zone — si lanceur a l'état « Sobre » (3531) ; zone ligne perpendiculaire (barre en T) taille 1  `[96]`
  - **le lanceur lance le sous-sort « Vague à Lame » (24246, niv. 1)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Sobre » (3531) ; zone ligne perpendiculaire (barre en T) taille 1  `[1160]`
    - ↳ sous-sort 24246 « Vague à Lame » niv.1 :
      - **Repousse la cible de 1 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone ; zone ligne perpendiculaire (barre en T) taille 1, *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **le lanceur lance le sous-sort « État Saoul : » (24025, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24025 niv.1 : info-bulle « État Saoul »
  - **44 à 48 dommages Eau (CC : 51 à 56)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Saoul » (498) ; zone ligne perpendiculaire (barre en T) taille 1  `[96]`
- **Analyse / rôle tactique** : Eau 4 PA en ligne (po 1–10, moitié en Saoul, 2×/tour, CC 15 %) : barre perpendiculaire 1 : 36–40 Eau + repousse de 1 (Sobre) ou 44–48 Eau sans poussée (Saoul, touche aussi les alliés).

#### Pandjiu (`14309`) — variante (obtenu niv. 190)

> Occasionne des dommages Feu aux ennemis et attire la cible.

- Caractéristiques (g1) : **3 PA** · portée 1–5 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour
- Effets :
  - **28 à 32 dommages Feu (CC : 34 à 38)** → cible ennemie  `[99]`
  - **Attire la cible de 2 case(s)** → cible (alliée ou ennemie)  `[6]`
- **Analyse / rôle tactique** : Variante Feu 3 PA (po 1–5, 2×/tour) : 28–32 Feu et attire de 2.


### Paire 21 — Lien Spiritueux / Bambou

#### Lien Spiritueux (`12799`) — sort de base (obtenu niv. 85)

> Invoque un Pandawasta maîtrisable qui retire de la Fuite, de la Puissance et tacle les adversaires. Il peut également augmenter ses caractéristiques pendant le combat ou porter le lanceur Sobre si ce dernier l'attaque en mêlée.  Le Pandawasta réduit de 50% les dommages immédiats alliés.

- Caractéristiques (g2) : **3 PA** · portée 1–5 (modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 0% · relance 5 t. · condition : lanceur a l’état « Saoul » (498)
- Grades : g1 (niv. 85) : 3 PA, po 1–4 ; g2 (niv. 152) : 3 PA, po 1–5
- Effets :
  - **Invoque « Pandawasta » (monstre 5845, grade 2)** → cible (alliée ou ennemie)  `[181]`
- **Analyse / rôle tactique** : 3 PA en ligne (po 1–5 sans LdV, **Saoul requis**, relance 5) : Pandawasta maîtrisable (6 PA/5 PM) qui tacle, retire Fuite/Puissance (Coup de Bambou), peut se buffer (+325 Vitalité/Agilité, +1 PM, 4 t.), porter le Pandawa Sobre qui l'attaque en mêlée ; réduit de 50 % les dommages immédiats alliés reçus.

#### Bambou (`12824`) — variante (obtenu niv. 195)

> Invoque un Bambou qui sert d'obstacle. Il peut porter le lanceur Sobre si ce dernier l'attaque en mêlée.  Le Bambou réduit de 80% les dommages immédiats alliés.  Rend 1 PA au lanceur s'il porte un Bambou.

- Caractéristiques (g1) : **2 PA** · portée 1–4 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · 1×/tour
- Effets :
  - **Invoque « Bambou » (monstre 5846, grade 1)** → cible (alliée ou ennemie)  `[181]`
- **Analyse / rôle tactique** : Variante 2 PA (po 1–4, 1×/tour) : Bambou (obstacle statique) qui réduit de 80 % les dommages immédiats alliés, peut porter le Pandawa Sobre qui l'attaque en mêlée ; porter un Bambou rend 1 PA.


### Paire 22 — Pandanlku / Main de Pandawa

#### Pandanlku (`12798`) — sort de base (obtenu niv. 90)

> Augmente les PM de la cible.

- Caractéristiques (g2) : **2 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 0% · relance 4 t. (1er lancer possible au tour 2) · cumul max 1 · condition : lanceur a l’état « Saoul » (498)
- Grades : g1 (niv. 90) : 2 PA, po 0–5 ; g2 (niv. 157) : 2 PA, po 0–6
- Effets :
  - **3 PM** → cible (alliée ou ennemie) ; 2 tour(s)  `[128]`
- **Analyse / rôle tactique** : 2 PA (po 0–6, **Saoul requis**, relance 4, 1er lancer au tour 2) : +3 PM (2 t.) à la cible (allié ou soi).

#### Main de Pandawa (`24039`) — variante (obtenu niv. 200)

> Retire de la Puissance et occasionne des dommages selon l'état du lanceur et lui applique l'état Main de Pandawa : • Sobre : occasionne des dommages dans son meilleur élément. • Saoul : occasionne des dommages Neutre, Terre, Feu, Eau et Air.

- Caractéristiques (g1) : **5 PA** · portée 1–5 (non modifiable) · ligne de vue requise · CC 5% · relance 5 t. · 1×/tour global (tous lanceurs)
- Effets :
  - **-500 Puissance** → cible (alliée ou ennemie) ; 1 tour(s)  `[186]`
  - **70 dommages du meilleur élément (CC : 100)** → cible (alliée ou ennemie) — si lanceur a l'état « Sobre » (3531)  `[2822]`
  - **7 dommages Neutre (CC : 10)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[100]`
  - **7 dommages Terre (CC : 10)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[97]`
  - **7 dommages Feu (CC : 10)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[99]`
  - **7 dommages Eau (CC : 10)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[96]`
  - **7 dommages Air (CC : 10)** → cible (alliée ou ennemie) — si lanceur a l'état « Saoul » (498)  `[98]`
  - **le lanceur lance le sous-sort « Main de Pandawa » (25505, niv. 1)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[1160]`
    - ↳ sous-sort 25505 « Main de Pandawa » niv.1 :
      - **la cible lance (sur elle-même) le sous-sort « Sobre » (24037, niv. 1)** → lanceur — si cible a l'état « Saoul » (498)  `[792]`
        - ↳ sous-sort 24037 niv.1 : passage en état Sobre (retire Saoul)
      - **la cible lance sur le lanceur (source) le sous-sort « Main de Pandawa » (25506, niv. 1)** → lanceur ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case), non désenvoûtable  `[1017]`
        - ↳ sous-sort 25506 « Main de Pandawa » niv.1 :
          - **25 dommages du meilleur élément (CC : 50)** → cible ennemie — si cible n'a PAS l'état « Main de Pandawa I » (4005) ET si lanceur n'a PAS l'état « Porteur » (3)  `[2822]`
          - **Applique l'état « Main de Pandawa Karcham » (4027)** → cible ennemie — si cible n'a PAS l'état « Main de Pandawa I » (4005) ET si lanceur n'a PAS l'état « Porteur » (3) ; 1 tour(s)  `[950]`
          - **le lanceur lance le sous-sort « Main de Pandawa » (25506, niv. 2)** → lanceur  `[1160]`
            - ↳ sous-sort 25506 « Main de Pandawa » niv.2 :
              - **le lanceur lance le sous-sort « Main de Pandawa » (25506, niv. 3)** → ennemis dans la zone — si cible n'a PAS l'état « Main de Pandawa I » (4005) ET si lanceur n'a PAS l'état « Porteur » (3) ET si cible a l'état « Main de Pandawa Karcham » (4027) ; zone croix sans centre taille 1  `[1160]`
              - **Retire l'état « Main de Pandawa Karcham » (4027)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
          - **Applique l'état « Main de Pandawa I » (4005)** → cible ennemie — si cible n'a PAS l'état « Main de Pandawa I » (4005) ET si lanceur n'a PAS l'état « Porteur » (3) ; 1 tour(s)  `[950]`
      - **Retire les effets du sort « Main de Pandawa » (25505)** → lanceur ; actif 1 tour(s), déclencheur : début de tour du porteur, non désenvoûtable  `[406]`
      - **le lanceur lance le sous-sort « Karcham » (12832, niv. 1)** → lanceur ; actif 1 tour(s), déclencheur : quand l'état « Porteur » (3) est appliqué, non désenvoûtable  `[1160]`
        - ↳ sous-sort 12832 « Karcham » niv.1 :
          - **Karcham : +3 Portée maximale** → lanceur — si lanceur a l'état « Karcham » (3583) ; durée infinie  `[281]`
          - **Karcham : case libre nécessaire activée** → lanceur — si lanceur a l'état « Karcham » (3583) ; durée infinie  `[299]`
          - **Karcham : case occupée nécessaire désactivée** → lanceur — si lanceur a l'état « Karcham » (3583) ; durée infinie  `[297]`
  - **Applique l'état « Main de Pandawa » (4026)** → lanceur ; 1 tour(s)  `[950]`
- **Analyse / rôle tactique** : Variante niveau 200, 5 PA (po 1–5, relance 5, 1×/tour global) : -500 Puissance à la cible ; Sobre → 70 dégâts meilleur élément ; Saoul → 7 dégâts dans chacun des 5 éléments ; état Main de Pandawa : redevient Sobre en fin de tour et riposte (25 meilleur élément + portage) au prochain coup de mêlée reçu.


## 4. Rôles en groupe de 4 (PvM niveau 200)

| Rôle | Pertinence | Détails |
|---|---|---|
| Placement | ★★★★★ | Porter/jeter à 1 PA (Varappe : jusqu'à 6 portages/tour), Consolation, Épouvante, Éviction, Cascade, Brancard, Bambous. |
| DPS mêlée/mi-distance | ★★★ | Pandatak, Vague à Lame, Souffle Alcoolisé/Enflammé, Engourdissement, Main de Pandawa, dégâts à l'impact des jets. |
| Tank secondaire | ★★★ | Saoul ×85 %, vols de vie, Pandawasta/Bambou, Prohibition. |
| Soutien / soin | ★★★ | Soins de jet, Fermentation (bouclier), Ivresse, Stabilisation, Pandanlku, Lait de Bambou. |
| Entrave | ★★ | Engourdissement (-3 PM), Souillure/Main de Pandawa (-Puissance), Ribote (-Fuite), Brassage (Pesanteur). |

**Placement** : au contact ou à 1–3 cases du front, au centre du groupe pour pouvoir porter n'importe quel allié ou monstre.

## 5. Choix de variantes recommandés

| Paire | Base | Variante | Placement/soutien | DPS Saoul |
|---|---|---|---|---|
| 1 | Paume Explosive | Distillation | Paume Explosive | Distillation |
| 2 | Gueule de Bois | Souffle Enflammé | Gueule de Bois | Souffle Enflammé |
| 3 | Schnaps | Ribote | Schnaps | Ribote |
| 4 | Ethylo | Engourdissement | Ethylo | Engourdissement |
| 5 | Bombance | Picole | Bombance | Picole |
| 6 | Karcham | Chamrak | Karcham | Chamrak |
| 7 | Épouvante | Consolation | Consolation | Épouvante |
| 8 | Brancard | Alcoshu | Brancard | Alcoshu |
| 9 | Pandikulation | Liqueur | Pandikulation | Liqueur |
| 10 | Ébriété | Ivresse | Ivresse | Ébriété |
| 11 | Stabilisation | Varappe | Varappe | Stabilisation |
| 12 | Propulsion | Absinthe | Propulsion | Absinthe |
| 13 | Eau-de-vie | Bistouille | Eau-de-vie | Bistouille |
| 14 | Souillure | Brassage | Souillure | Brassage |
| 15 | Fermentation | Bambouseraie | Fermentation | Fermentation |
| 16 | Éviction | Souffle Alcoolisé | Éviction | Souffle Alcoolisé |
| 17 | Flasque Explosive | Pandatak | Flasque Explosive | Pandatak |
| 18 | Lait de Bambou | Prohibition | Lait de Bambou | Lait de Bambou |
| 19 | Nausée | Cascade | Cascade | Nausée |
| 20 | Vague à Lame | Pandjiu | Vague à Lame | Vague à Lame |
| 21 | Lien Spiritueux | Bambou | Lien Spiritueux | Lien Spiritueux |
| 22 | Pandanlku | Main de Pandawa | Pandanlku | Main de Pandawa |

## 6. Rotations types (11–12 PA, 6 PM)

1. **Placement (12 PA, Sobre)** : Varappe (2) → Karcham ×3 (3) : porter/jeter un allié en danger puis porter un monstre →
   Pandikulation (2) au centre du paquet → Bombance (1) → Pandatak (4).
2. **Dégâts Saoul (12 PA)** : Alcoshu (2, devient Saoul) → Vague à Lame (4) → Pandatak (4) → Flasque Explosive (2).
3. **Soutien (12 PA)** : Bombance (1, Saoul) → Fermentation (3) → Bombance (1, Sobre, +1 PA) → Karcham (1) + Eau-de-vie (2) sur
   l'allié blessé → Consolation (2) → Stabilisation (2).

## 7. Forces / faiblesses

- Forces : placement exceptionnel à faible coût, soins/dégâts de jet, réduction de dommages en Saoul, utilitaires variés.
- Faiblesses : complexité, contraintes de posture (PM, portées), mono-cible moyen, sorts touchant les alliés.

## 8. Synergies

- **DPS de zone** (Crâ Feu, Sadida) : regroupement par jets (Pandikulation attire en croix 2).
- **DPS mêlée** (Iop, Sacrieur) : transport au contact du boss, Intaclable/Enraciné, Brassage ×110 %.
- **Soigneurs/protecteurs** : soins à l'impact, boucliers Fermentation, extraction d'alliés.
- **Pièges/poussée** (Sram, Enutrof, Roublard) : -40 Rés. Poussée (Schnaps Saoul), déplacer les monstres sur les pièges/bombes.

## 9. Questions ouvertes (INCERTAIN)

- Portée /2 en Saoul (arrondi) ; masque K ; sorts autorisés en Porteur ; Gueule de Bois ; PV des Tonneaux/Bambous.

## Sources

- DofusDB API : https://api.dofusdb.fr/breeds/12 , https://api.dofusdb.fr/spell-variants?breedId=12 , https://api.dofusdb.fr/spells/24036 (Saoul), https://api.dofusdb.fr/spells/24037 (Sobre), https://api.dofusdb.fr/monsters/5843 , /5844 , /5845 , /5846 , /7355 , https://api.dofusdb.fr/spell-states/3 , /8 , /498 , /3531
- Énumération ActionIds (client Dofus) : `.cache/classes/ref/ActionIds.ts` ; grammaire des masques/déclencheurs : `DamageUtil.as` (`.cache/domath/d2client/`).

