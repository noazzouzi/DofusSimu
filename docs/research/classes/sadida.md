# Sadida — analyse complète pour DofusSimu (breed 10)

> « Sorcier sylvestre ». Données : API DofusDB (fichiers du jeu, mise à jour du 23/06/2026) — `https://api.dofusdb.fr/breeds/10`,
> `https://api.dofusdb.fr/spell-variants?breedId=10`, `spells`, `spell-levels`, `spell-states`, `monsters` (5894–5901, 7933, 7934).
> Cache brut : `.cache/classes/csps/`. Rôles officiels (breedRoles, roleId → libellé déduit) : **Invocation 10/10**
> (« invoque des poupées et des arbres »), **Entrave 8/10** (« retire des PM et bloque des lignes de vue avec ses invocations »),
> **Soin 6/10**, Dommages 5/10, Protection 2/10 (INCERTAIN), Placement 1/10. Complexité 3/3.

## 1. Vue d'ensemble

- **Profil** : invocateur/contrôleur. Le Sadida plante des **Arbres** (obstacles bloquant la LdV, 6 max par équipe) qui deviennent
  **Feuillus** (zone de ses sorts élargie autour d'eux), les remplace par des **Poupées** maîtrisables ou des **arbres contrôlables**
  (Groute/Tréant), et répand l'**Infection** : un sort lancé sur un ennemi Infecté s'applique à **tous les ennemis Infectés**.
- **Dégâts** : 4 éléments (Terre : Ronce, Ronces Agressives, Forêt Hantée, Tremblement, Force de la Nature ; Eau : Larme, Fléau,
  Sacrifice Vaudou, Mangrove ; Feu : Buisson Ardent, Herbes Folles, Feu de Brousse, Fétiches ; Air : Cigüe, Contagion, Inoculation,
  Mandragore, poisons). Dégâts moyens par sort mais **démultipliés par la propagation d'Infection** (jusqu'à 3 rebonds/ennemi/tour).
- **Entrave** : retrait PM massif (Buisson Ardent -2, Contagion -2, Herbes Folles -3 en cercle 2, Feu de Brousse -3, Mangrove -3,
  Ronce Apaisante -2, Ronces Agressives vol 1, Canopée -2 en zone), réduction d'esquive PM (Sève Paralysante -15), réduction de durée
  des effets (Ronce Insolente -1, Détoxication -2), blocage de LdV et de chemin par les arbres, Bloqueuse (tacle).
- **Soin / protection** : Larme de Sadida (soin Eau mono ou zone sur arbre), Ronce Apaisante (gros soin meilleur élément),
  Mangrove, Montée de Sève (soin = 50 % des dégâts), Arbre de Vie (soins de fin de tour), Gonflable (soin 50 en zone),
  Photosynthèse (12 % PV max), Canopée (bouclier 200 % du niveau), Don Naturel/Harmonie (partage de dommages).

## 2. Mécaniques spécifiques à implémenter (moteur)

1. **Arbres** (monstre 5894) : invocation statique (ne joue pas, `useSummonSlot=false` → ne consomme PAS d'emplacement
   d'invocation), 20 % de résistances partout, `bonusCharacteristics.lifePoints` = 60 (grades 1–3) / 30 (grades 4–6) — INCERTAIN :
   interprété comme % des PV max du Sadida. **6 Arbres max par équipe**, le 7e tue le premier (états compteurs « Arbre I…VI »
   5387–5392). Bloquent la LdV et le passage. Peuvent être portés (Pandawa) et poussés.
2. **Feuillu** (état 256, `cantBePushed`) : un Arbre devient Feuillu 1 tour après sa plantation (sort Arbre) ou immédiatement
   (Arbre Feuillu, Mangrove, Montée de Sève, Larme sur un arbre). Effet « Feuillage » (13558) : +100 % Vitalité, apparence, et
   alimente le passif de Force de la Nature (+10 dégâts de base par Arbre Feuillu). Un sort lancé **sur un Arbre Feuillu**
   s'applique en cercle de 2 (min 1) autour de lui (Ronce, Buisson Ardent, Cigüe, Ronce Apaisante, Larme…).
3. **Infection** (état 263, durée 1–3 tours selon le sort) : quand un sort Sadida touche un ennemi Infecté (cible principale), les
   mêmes effets sont rejoués (sous-sort `2960` « lanceur lance sur la case ») sur **tous les autres ennemis Infectés** de la carte
   (zone C63). Chaque ennemi propagé reçoit un compteur Infecté I → II → III (états 711/712/713, durée 1) : **au-delà de 3
   propagations dans le tour, il n'est plus touché**. La cible principale est marquée (5409/6244) pour ne pas être touchée deux fois.
   Sources d'Infection : Ronce (1 t.), Vent Empoisonné (1 t.), Sève Paralysante (3 t.), Cigüe (prolonge à 3 t.), Contagion
   (propage en cercle 2, 2 t.), Miasmes (1 t.), Poupées (Agacement, Explosion Ouatée), Groute/Tréant, Forêt Hantée (si la cible
   attaque un arbre), Mandragore (si la cible subit poison/invocation). Inoculation **consomme** toutes les Infections.
4. **Poupées** (invocations jouables, 1 emplacement chacune) : remplacent un Arbre (sort de base : `405` tue l'arbre et le remplace,
   portée 1–63 sans LdV, grade 3 sur Arbre normal / grade 6 sur Arbre Feuillu ; à la mort la Poupée redevient Arbre, Feuillu si elle
   venait d'un Feuillu) ou sont invoquées directement (variante « Transmutée » : 3 PA, po 1–3, case libre, remplacée par un Arbre
   après 3 tours). Elles sont **maîtrisables** (contrôlables par le joueur via l'état « Maîtrise des Invocations » 2131 / sort 18648
   — INCERTAIN : sinon jouées par l'IA). Stats (PV en % du Sadida, INCERTAIN) : Bloqueuse 100, Folle 80, Gonflable 70,
   Sacrifiée 60, Surpuissante 90 ; 6 PA, 4–5 PM, résistances 30/−5/15/20/30 selon l'élément.
5. **Arbres contrôlables** : Puissance Sylvestre → **Groute** (5901, 4 PA/4 PM, 2 tours : Rejet Sylvestre, Photosynthèse,
   Détoxication) ; Influence Végétale → **Tréant** (5900 : Étreinte Sylvestre, Canopée, Mur de Ronces). Ne consomment pas
   d'emplacement. Redeviennent Arbres Feuillus après 2 tours.
6. **Sacrifices** : Sacrifice Vaudou, Don Naturel, Altruisme Végétal et Explosion Ouatée tuent une Poupée/un Arbre Feuillu pour
   un effet de zone. Malédiction Vaudou inflige des dégâts à la mort d'une Poupée. Sacrifice Vaudou remet à 0 la relance du sort
   d'invocation de la Poupée sacrifiée (effet 1045).
7. **Partage de dommages (1061)** : Don Naturel (alliés en cercle 2 autour de l'arbre/poupée sacrifié, 1 tour) et Harmonie
   (le Sadida s'enracine et partage avec tous ses Arbres).
8. **Fétiches Calcinés** (état 5437) : 30 % des dommages finaux subis par les Arbres du Sadida sont renvoyés à l'ennemi marqué
   (effet 1223). **Forêt Hantée** (5407) : l'ennemi qui attaque un Arbre est Infecté. **Chardons Ardents** (5399) : poison Feu 8
   par PM utilisé (cumul 3).
9. **Effets `forClientOnly`** : très nombreux chez le Sadida (états affichés, dégâts de propagation) ; le moteur doit exécuter
   uniquement les sous-sorts réels (souvent 2960/1160 vers les sous-sorts 13545–13594, 29615–29644).


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB/fichiers du jeu, juin 2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Ronce (13516) | base | 1 | 3 | 1–8+ | /LdV | — | 3/t 2/c | 15% | 24–27 Terre | damage, infection, single-target |
| 1 | Ronce Insolente (13521) | var. | 95 | 3 | 0–7+ | /LdV | — | 2/t 1/c | 20% | 31–35 Terre | damage, debuff, dispel |
| 2 | Larme de Sadida (13528) | base | 1 | 3 | 0–8+ | L/sans LdV | — | 3/t 2/c | 15% | 25–28 soin Eau, 25–28 Eau | heal, damage, aoe-on-tree |
| 2 | Montée de Sève (13563) | var. | 100 | 4 | 0–7+ | /LdV | — | 1/t | 25% | 30–34 vol Eau | damage, lifesteal, heal |
| 3 | Buisson Ardent (13574) | base | 1 | 3 | 1–8+ | /LdV | — | 3/t 2/c | 15% | 25–28 Feu | damage, mp-removal |
| 3 | Feu de Brousse (13568) | var. | 105 | 4 | 0–7+ | /LdV | — | 2/t | 20% | 32–35 Feu, 17–19 Feu | damage, aoe, mp-removal |
| 4 | Cigüe (13577) | base | 1 | 3 | 1–8+ | /LdV | — | 3/t 2/c | 15% | 26–29 Air | damage, infection |
| 4 | Vent Empoisonné (13529) | var. | 110 | 2 | 1–8+ | /LdV | — | 1/t | 0% | 13–15 Air | poison, infection |
| 5 | Arbre (13519) | base | 5 | 2 | 1–8 | /LdV | — | 2/t | 0% | — | summon, obstacle, los-block |
| 5 | Arbre Feuillu (13560) | var. | 115 | 3 | 1–8 | /LdV | — | 1/t | 0% | — | summon, obstacle, buff |
| 6 | La Folle (13564) | base | 10 | 2 | 1–63 | /sans LdV | 3 | 1/t | 0% | — | summon, infection, poison |
| 6 | La Folle Transmutée (13515) | var. | 120 | 3 | 1–3 | /LdV | 3 | 1/t | 0% | — | summon, infection, poison |
| 7 | Sève Paralysante (13533) | base | 15 | 3 | 1–8+ | /LdV | — | 1/t | 0% | 15–18 Feu | poison, infection, dodge-reduction |
| 7 | Miasmes (13562) | var. | 125 | 2 | 0–0 | /sans LdV | — | 1/t | 0% | 12–14 Air | poison, infection, aoe |
| 8 | Contagion (13575) | base | 20 | 4 | 1–7+ | /LdV | — | 2/t 1/c | 25% | 35–39 Air | damage, mp-removal, infection-spread |
| 8 | Mangrove (14396) | var. | 130 | 4 | 0–6+ | /LdV | — | 1/t | 25% | 32–36 soin Eau, 32–36 Eau | heal, damage, aoe |
| 9 | Ronce Apaisante (13525) | base | 25 | 2 | 0–9 | L/LdV | 4 | — | 0% | 46–54 soin meilleur élt | heal, mp-removal |
| 9 | Rempotage (13565) | var. | 135 | 2 | 1–9 | L/sans LdV | 2 | — | 0% | — | heal, mobility, summon |
| 10 | La Bloqueuse (13561) | base | 30 | 2 | 1–63 | /sans LdV | 3 | 1/t | 0% | — | summon, tank, tackle |
| 10 | La Bloqueuse Transmutée (13526) | var. | 140 | 3 | 1–3 | /LdV | 3 | 1/t | 0% | — | summon, tank, tackle |
| 11 | Ronces Agressives (13527) | base | 35 | 4 | 1–6+ | /LdV | — | 2/t 1/c | 25% | 38–42 Terre | damage, mp-steal |
| 11 | Fétiches Calcinés (14393) | var. | 145 | 3 | 1–6+ | /LdV | — | 2/t | 15% | 28–31 Feu | damage, damage-return |
| 12 | Fléau (13571) | base | 40 | 3 | 1–6 | /LdV | — | 3/t 2/c | 15% | 26–29 vol Eau | damage, lifesteal |
| 12 | Forêt Hantée (13524) | var. | 150 | 3 | 0–7 | L/LdV | — | 1/t | 20% | 29–32 Terre | damage, aoe, infection |
| 13 | Puissance Sylvestre (13530) | base | 45 | 2 | 1–63 | /sans LdV | 3 | — | 0% | — | summon, heal, infection |
| 13 | Influence Végétale (13566) | var. | 155 | 2 | 1–63 | /sans LdV | 3 | — | 0% | — | summon, shield, mp-removal |
| 14 | La Sacrifiée (13567) | base | 50 | 2 | 1–63 | /sans LdV | 2 | 1/t | 0% | — | summon, damage, infection |
| 14 | La Sacrifiée Transmutée (13522) | var. | 160 | 3 | 1–3 | /LdV | 2 | 1/t | 0% | — | summon, damage, infection |
| 15 | Herbes Folles (13518) | base | 55 | 3 | 0–7+ | /LdV | — | 1/t | 25% | 31–35 Feu | damage, aoe, mp-removal |
| 15 | Malédiction Vaudou (13576) | var. | 165 | 3 | 1–7+ | /LdV | 2 | — | 0% | 25–28 Eau, 14–16 Eau | damage, delayed |
| 16 | Sacrifice Vaudou (13531) | base | 60 | 3 | 1–7+ | /LdV | — | 3/t 1/c | 20% | 30–34 Eau, 36–41 Eau, 30–34 soin Eau | damage, heal, sacrifice |
| 16 | Chardons Ardents (13517) | var. | 170 | 3 | 1–6+ | /LdV | 3 | — | 0% | 8–8 Feu | poison, anti-mobility |
| 17 | Arbre de Vie (13534) | base | 65 | 4 | 1–8 | /LdV | 3 | — | 0% | — | summon, heal |
| 17 | Altruisme Végétal (13572) | var. | 175 | 2 | 1–63 | /sans LdV | — | 1/t | 0% | — | sacrifice, buff, heal |
| 18 | La Gonflable (13573) | base | 70 | 2 | 1–63 | /sans LdV | 4 | 1/t | 0% | — | summon, heal, push |
| 18 | La Gonflable Transmutée (13523) | var. | 180 | 3 | 1–3 | /LdV | 4 | 1/t | 0% | — | summon, heal, push |
| 19 | Tremblement (13514) | base | 75 | 3 | 0–63 | /sans LdV | — | 2/t 1/c | 20% | 29–33 Terre | damage, aoe, pull |
| 19 | Mandragore (13559) | var. | 185 | 3 | 1–8+ | L/LdV | — | 2/t 1/c | 20% | 30–34 Air | damage, infection |
| 20 | Inoculation (13569) | base | 80 | 5 | 1–6+ | /LdV | — | 2/t 1/c | 25% | 39–43 Air | damage, infection-consume, finisher |
| 20 | Force de la Nature (13570) | var. | 190 | 5 | 1–6 | /LdV | — | 2/t 1/c | 25% | 40–45 Terre | damage, ramp |
| 21 | Don Naturel (13532) | base | 85 | 2 | 1–63 | /sans LdV | 3 | — | 0% | 30–35 soin meilleur élt | sacrifice, heal, damage-share |
| 21 | Harmonie (13579) | var. | 195 | 3 | 0–0 | /sans LdV | 4 | — | 0% | — | tank, damage-share |
| 22 | La Surpuissante (13578) | base | 90 | 2 | 1–63 | /sans LdV | 4 | 1/t | 0% | — | summon, damage, mp-removal |
| 22 | La Surpuissante Transmutée (13520) | var. | 200 | 3 | 1–3 | /LdV | 4 | 1/t | 0% | — | summon, damage, mp-removal |


### Paire 1 — Ronce / Ronce Insolente

#### Ronce (`13516`) — sort de base (obtenu niv. 1)

> Infecte la cible et occasionne des dommages Terre.  Sur un Arbre Feuillu : applique les effets sur les ennemis dans un cercle de taille 2.  Sur un ennemi : applique également les effets sur tous les ennemis Infectés.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 14–16 Terre ; g2 (niv. 66) : 3 PA, po 1–7, 19–21 Terre ; g3 (niv. 132) : 3 PA, po 1–8, 24–27 Terre
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29615 « Infection » niv.1 :
      - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s)  `[950]`
  - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Ronce » (13552, niv. 9)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 13552 « Ronce » niv.9 :
      - **24 à 27 dommages Terre (CC : 29 à 32)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[97]`
      - **le lanceur lance le sous-sort « Infection » (29615, niv. 1)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[1160]`
        - ↳ (sous-sort 29615 niv.1 déjà détaillé plus haut)
  - **24 à 27 dommages Terre** → cible ennemie  `[97]`
  - **24 à 27 dommages Terre** → cible alliée — si cible n'a PAS l'état « Feuillu » (256)  `[97]`
  - **le lanceur lance sur la case ciblée le sous-sort « Ronce » (13552, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13552 « Ronce » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Ronce » (13552, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13552 « Ronce » niv.6 :
          - **24 à 27 dommages Terre** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[97]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 1)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 29615 niv.1 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
  - Effets en coup critique (liste distincte) :
    - Applique l'état « Infecté » (263) → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*
    - le lanceur lance le sous-sort « Infection » (29615, niv. 1) → cible ennemie
    - le lanceur lance le sous-sort « Infection » (29615, niv. 4) → cible ennemie
    - le lanceur lance le sous-sort « Ronce » (13552, niv. 9) → cible alliée — si cible a l'état « Feuillu » (256)
    - 29 à 32 dommages Terre → cible ennemie
    - 29 à 32 dommages Terre → cible alliée — si cible n'a PAS l'état « Feuillu » (256)
    - le lanceur lance sur la case ciblée le sous-sort « Ronce » (13552, niv. 3) → cible (alliée ou ennemie)
- **Analyse / rôle tactique** : Terre 3 PA (po 1–8, 3×/tour, 2×/cible) : 24–27 Terre + Infecte 1 tour. Sur un Arbre Feuillu : touche les ennemis en cercle 2 autour de l'arbre ; sur un ennemi Infecté : rejoue les dégâts sur tous les Infectés. Sort de base pour lancer/entretenir l'Infection en Terre.

#### Ronce Insolente (`13521`) — variante (obtenu niv. 95)

> Réduit la durée des effets sur la cible et occasionne des dommages Terre aux ennemis.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g2) : **3 PA** · portée 0–7 (modifiable) · ligne de vue requise · CC 20% · 2×/tour · 1×/cible
- Grades : g1 (niv. 95) : 3 PA, po 0–6, 25–28 Terre ; g2 (niv. 162) : 3 PA, po 0–7, 31–35 Terre
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **Durée des effets : -1** → cible (alliée ou ennemie)  `[1075]`
  - **31 à 35 dommages Terre (CC : 37 à 42)** → cible ennemie  `[97]`
  - **le lanceur lance sur la case ciblée le sous-sort « Ronce Insolente » (13547, niv. 2)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13547 « Ronce Insolente » niv.2 :
      - **le lanceur lance sur la case ciblée le sous-sort « Ronce Insolente » (13547, niv. 4)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13547 « Ronce Insolente » niv.4 :
          - **Durée des effets : -1** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1075]`
          - **31 à 35 dommages Terre** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[97]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante Terre 3 PA (po 0–7, CC 20 %) : 31–35 Terre et réduit de 1 tour la durée des effets de la cible (désenvoûtement partiel, alliés compris). Propagation sur Infectés. Contre les boss qui se buffent.


### Paire 2 — Larme de Sadida / Montée de Sève

#### Larme de Sadida (`13528`) — sort de base (obtenu niv. 1)

> Soigne les alliés ou occasionne des dommages Eau aux ennemis.  Sur un Arbre : applique les effets dans un cercle de taille 2 et transforme l'Arbre en Arbre Feuillu.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g3) : **3 PA** · portée 0–8 (modifiable) · en ligne uniquement · sans ligne de vue · CC 15% · 3×/tour · 2×/cible
- Grades : g1 (niv. 1) : 3 PA, po 0–6, 15–17 soin Eau, 15–17 Eau ; g2 (niv. 67) : 3 PA, po 0–7, 20–22 soin Eau, 20–22 Eau ; g3 (niv. 133) : 3 PA, po 0–8, 25–28 soin Eau, 25–28 Eau
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Larme de Sadida » (13545, niv. 9)** → cible alliée — si cible est l’un des monstres : « Arbre » (5894) / « Tréant » (5900) / « Groute » (5901)  `[1160]`
    - ↳ sous-sort 13545 « Larme de Sadida » niv.9 :
      - **25 à 28 soins Eau (CC : 30 à 34)** → cible alliée  `[2998]`
      - **25 à 28 soins Eau (CC : 30 à 34)** → alliés dans la zone ; zone cercle taille 2 (min 1)  `[2998]`
      - **25 à 28 dommages Eau (CC : 30 à 34)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[96]`
  - **25 à 28 soins Eau (CC : 30 à 34)** → cible alliée — si cible n'est pas « Arbre » (5894) ET si cible n'est pas « Tréant » (5900) ET si cible n'est pas « Groute » (5901)  `[2998]`
  - **25 à 28 dommages Eau (CC : 30 à 34)** → cible ennemie  `[96]`
  - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 1)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256)  `[792]`
    - ↳ sous-sort 13558 « Feuillage » niv.1 :
      - **Change l'apparence** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[149]`
      - **Applique l'état « Feuillu » (256)** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[950]`
      - **100% Vitalité** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[1078]`
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 2)** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.2 : réapplique le passif Force de la Nature (+10 dégâts de base par Arbre Feuillu, sort 13584) aux alliés/invocations
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 4)** → lanceur ; actif 63 tour(s), déclencheur : à la mort (INCERTAIN), non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.4 : à la mort de l'arbre : recalcul du passif Force de la Nature
      - **Retire les effets du sort « Feuillage » (14700)** → lanceur  `[406]`
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 5)** → lanceur ; actif 63 tour(s), déclencheur : quand l'état « Feuillu » (256) est retiré, non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.5 : si l'état Feuillu est retiré : l'arbre redevient Arbre normal (retire Arbre de Vie/Feuillage) et recalcule les compteurs
  - **Applique l'état « Feuillu » (256)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance sur la case ciblée le sous-sort « Larme de Sadida » (13545, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13545 « Larme de Sadida » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Larme de Sadida » (13545, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13545 « Larme de Sadida » niv.6 :
          - **25 à 28 dommages Eau** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[96]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : 3 PA en ligne, **sans ligne de vue** (po 0–8) : soigne 25–28 (Eau) un allié OU 25–28 Eau à un ennemi ; sur un Arbre : effets en cercle 2 et l'arbre devient Feuillu. Propage sur Infectés. Soin d'appoint polyvalent.

#### Montée de Sève (`13563`) — variante (obtenu niv. 100)

> Vole de la vie dans l'élément Eau aux ennemis et soigne les alliés (hors lanceur) selon les dommages occasionnés en zone.  Sur des Arbres : les transforme également en Arbres Feuillus.

- Caractéristiques (g2) : **4 PA** · portée 0–7 (modifiable) · ligne de vue requise · CC 25% · 1×/tour
- Grades : g1 (niv. 100) : 4 PA, po 0–6, 24–27 vol Eau ; g2 (niv. 167) : 4 PA, po 0–7, 30–34 vol Eau
- Effets :
  - **Applique l'état « Montée de Sève » (3756)** → alliés (hors lanceur) dans la zone ; zone carré taille 1, 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Montée de Sève » (24997, niv. 1)** → ennemis dans la zone ; zone carré taille 1  `[1160]`
    - ↳ sous-sort 24997 « Montée de Sève » niv.1 :
      - **le lanceur lance le sous-sort « Montée de Sève » (24997, niv. 2)** → cible ennemie ; actif 1 tour(s), déclencheur : quand la cible subit des dommages OU quand la cible subit des dommages (variante X, INCERTAIN)  `[1160]`
        - ↳ sous-sort 24997 « Montée de Sève » niv.2 :
          - **Retire les effets du sort « Montée de Sève » (24997)** → cible ennemie  `[406]`
          - **Soin : 50% des dommages occasionnés** → alliés (hors lanceur) dans la zone — si cible a l'état « Montée de Sève » (3756) ; zone tout le terrain (vivants)  `[2973]`
  - **30 à 34 vol Eau (CC : 36 à 41)** → ennemis dans la zone ; zone carré taille 1  `[91]`
  - **la cible lance (sur elle-même) le sous-sort « Montée de Sève » (24997, niv. 3)** → lanceur  `[792]`
    - ↳ sous-sort 24997 « Montée de Sève » niv.3 :
      - **Retire les effets du sort « Montée de Sève » (24997)** → ennemis dans la zone ; zone tout le terrain  `[406]`
      - **Retire l'état « Montée de Sève » (3756)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
  - **Soin : 50% des dommages occasionnés** → alliés (hors lanceur) dans la zone — si cible a l'état « Montée de Sève » (3756) ; zone carré taille 1, *info-bulle uniquement (comportement réel géré côté serveur)*  `[2973]`
  - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 1)** → alliés dans la zone — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256) ; zone carré taille 1  `[792]`
    - ↳ sous-sort 13558 « Feuillage » niv.1 :
      - **Change l'apparence** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[149]`
      - **Applique l'état « Feuillu » (256)** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[950]`
      - **100% Vitalité** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[1078]`
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 2)** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.2 : réapplique le passif Force de la Nature (+10 dégâts de base par Arbre Feuillu, sort 13584) aux alliés/invocations
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 4)** → lanceur ; actif 63 tour(s), déclencheur : à la mort (INCERTAIN), non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.4 : à la mort de l'arbre : recalcul du passif Force de la Nature
      - **Retire les effets du sort « Feuillage » (14700)** → lanceur  `[406]`
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 5)** → lanceur ; actif 63 tour(s), déclencheur : quand l'état « Feuillu » (256) est retiré, non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.5 : si l'état Feuillu est retiré : l'arbre redevient Arbre normal (retire Arbre de Vie/Feuillage) et recalcule les compteurs
  - **Applique l'état « Feuillu » (256)** → invocations statiques alliées, U (INCERTAIN) ; zone carré taille 1, durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Variante 4 PA (po 0–7, 1×/tour, CC 25 %) : vol Eau 30–34 en carré 1, et pendant 1 tour les alliés touchés (hors lanceur) sont soignés de 50 % des dommages subis par les ennemis touchés ; transforme les Arbres de la zone en Feuillus.


### Paire 3 — Buisson Ardent / Feu de Brousse

#### Buisson Ardent (`13574`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Feu et retire des PM.  Sur un Arbre Feuillu : applique les effets sur les ennemis dans un cercle de taille 2.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 15–17 Feu ; g2 (niv. 68) : 3 PA, po 1–7, 20–22 Feu ; g3 (niv. 134) : 3 PA, po 1–8, 25–28 Feu
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Buisson Ardent » (29630, niv. 9)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 29630 « Buisson Ardent » niv.9 :
      - **25 à 28 dommages Feu (CC : 30 à 34)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[99]`
      - **Retire 2 PM (esquivable)** → ennemis dans la zone ; zone cercle taille 2 (min 1), 1 tour(s), non désenvoûtable  `[1080]`
  - **25 à 28 dommages Feu (CC : 30 à 34)** → cible ennemie  `[99]`
  - **25 à 28 dommages Feu (CC : 30 à 34)** → cible alliée — si cible n'a PAS l'état « Feuillu » (256)  `[99]`
  - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **le lanceur lance le sous-sort « Buisson Ardent » (29630, niv. 10)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29630 « Buisson Ardent » niv.10 :
      - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
  - **le lanceur lance le sous-sort « Buisson Ardent » (29630, niv. 10)** → cible alliée — si cible n'a PAS l'état « Feuillu » (256)  `[1160]`
    - ↳ (sous-sort 29630 niv.10 déjà détaillé plus haut)
  - **le lanceur lance sur la case ciblée le sous-sort « Buisson Ardent » (29630, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29630 « Buisson Ardent » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Buisson Ardent » (29630, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29630 « Buisson Ardent » niv.6 :
          - **25 à 28 dommages Feu** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[99]`
          - **Retire 2 PM (esquivable)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63), 1 tour(s), non désenvoûtable  `[1080]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Feu 3 PA (po 1–8, 3×/tour, 2×/cible) : 25–28 Feu + -2 PM ; sur Feuillu : cercle 2 ; sur Infecté : propagation (dégâts ET retrait PM sur tous les Infectés). Le meilleur retrait PM « de masse » du Sadida via l'Infection.

#### Feu de Brousse (`13568`) — variante (obtenu niv. 105)

> Occasionne des dommages Feu et retire des PM aux ennemis et applique l'état Feu de Brousse sur les Arbres et les ennemis en zone : • À la fin du tour de la cible, occasionne des dommages Feu aux ennemis en zone autour d'elle. • Peut occasionner des dommages aux Arbres.

- Caractéristiques (g2) : **4 PA** · portée 0–7 (modifiable) · ligne de vue requise · CC 20% · 2×/tour · cumul max 1
- Grades : g1 (niv. 105) : 4 PA, po 0–6, 26–28 Feu, 13–15 Feu ; g2 (niv. 172) : 4 PA, po 0–7, 32–35 Feu, 17–19 Feu
- Effets :
  - **32 à 35 dommages Feu** → ennemis dans la zone ; zone croix taille 1  `[99]`
  - **Retire 3 PM (esquivable)** → ennemis dans la zone ; zone croix taille 1, 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **Applique l'état « Feu de Brousse » (5614)** → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Feu de Brousse » (14394, niv. 2)** → ennemis dans la zone ; zone croix taille 1  `[1160]`
    - ↳ sous-sort 14394 « Feu de Brousse » niv.2 :
      - **Retire 3 PM (esquivable)** → cible ennemie ; 1 tour(s), non désenvoûtable  `[1080]`
      - **Applique l'état « Feu de Brousse » (5614)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Feu de Brousse » (14394, niv. 4)** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[1160]`
        - ↳ sous-sort 14394 « Feu de Brousse » niv.4 :
          - **17 à 19 dommages Feu (CC : 20 à 23)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[99]`
          - **17 à 19 dommages Feu (CC : 20 à 23)** → alliés dans la zone — si cible est l’un des monstres : « Arbre » (5894) / « Tréant » (5900) / « Groute » (5901) ; zone cercle taille 2 (min 1)  `[99]`
          - **Retire l'état « Feu de Brousse » (5614)** → cible (alliée ou ennemie)  `[951]`
  - **le lanceur lance le sous-sort « Feu de Brousse » (14394, niv. 2)** → alliés dans la zone — si cible est l’un des monstres : « Arbre » (5894) / « Tréant » (5900) / « Groute » (5901) ; zone croix taille 1  `[1160]`
    - ↳ (sous-sort 14394 niv.2 déjà détaillé plus haut)
  - **17 à 19 dommages Feu** → ennemis dans la zone ; zone cercle taille 2 (min 1), actif 1 tour(s), déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[99]`
  - Effets en coup critique (liste distincte) :
    - 38 à 42 dommages Feu → ennemis dans la zone ; zone croix taille 1
    - Retire 3 PM (esquivable) → ennemis dans la zone ; zone croix taille 1, 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*
    - Applique l'état « Feu de Brousse » (5614) → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*
    - 20 à 23 dommages Feu → ennemis dans la zone ; zone cercle taille 2 (min 1), actif 1 tour(s), déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*
    - le lanceur lance le sous-sort « Feu de Brousse » (14394, niv. 2) → ennemis dans la zone ; zone croix taille 1
    - le lanceur lance le sous-sort « Feu de Brousse » (14394, niv. 2) → alliés dans la zone — si cible est l’un des monstres : « Arbre » (5894) / « Tréant » (5900) / « Groute » (5901) ; zone croix taille 1
- **Analyse / rôle tactique** : Variante Feu 4 PA (po 0–7, 2×/tour, CC 20 %) : 32–35 Feu en croix 1 aux ennemis, -3 PM et état Feu de Brousse ; à la fin du tour de chaque cible, 17–19 Feu aux ennemis en cercle 2 autour d'elle (peut aussi toucher les Arbres).


### Paire 4 — Cigüe / Vent Empoisonné

#### Cigüe (`13577`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Air.  Sur un Arbre Feuillu : applique les effets et maintient l'Infection sur les ennemis dans un cercle de taille 2.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés et maintient l'Infection sur la cible.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 15–17 Air ; g2 (niv. 69) : 3 PA, po 1–7, 21–23 Air ; g3 (niv. 136) : 3 PA, po 1–8, 26–29 Air
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Cigüe » (29632, niv. 9)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 29632 « Cigüe » niv.9 :
      - **26 à 29 dommages Air (CC : 31 à 35)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[98]`
      - **le lanceur lance le sous-sort « Infection » (29615, niv. 3)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ; zone cercle taille 2 (min 1)  `[1160]`
        - ↳ sous-sort 29615 « Infection » niv.3 :
          - **Applique l'état « Infecté » (263)** → cible ennemie ; 3 tour(s)  `[950]`
  - **26 à 29 dommages Air (CC : 31 à 35)** → cible ennemie  `[98]`
  - **26 à 29 dommages Air (CC : 31 à 35)** → cible alliée — si cible n'a PAS l'état « Feuillu » (256)  `[98]`
  - **Applique l'état « Infecté » (263)** → cible ennemie — si cible a l'état « Infecté » (263) ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 3)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ (sous-sort 29615 niv.3 déjà détaillé plus haut)
  - **le lanceur lance sur la case ciblée le sous-sort « Cigüe » (29632, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29632 « Cigüe » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Cigüe » (29632, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29632 « Cigüe » niv.6 :
          - **26 à 29 dommages Air** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[98]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 3)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
            - ↳ (sous-sort 29615 niv.3 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Air 3 PA (po 1–8, 3×/tour, 2×/cible) : 26–29 Air ; sur Infecté : propage et **prolonge l'Infection à 3 tours** ; sur Feuillu : cercle 2 + infection. Entretien de l'Infection en Air.

#### Vent Empoisonné (`13529`) — variante (obtenu niv. 110)

> Infecte la cible et lui applique un poison Air de début de tour.

- Caractéristiques (g2) : **2 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 0% · 1×/tour · cumul max 1
- Grades : g1 (niv. 110) : 2 PA, po 1–7, 11–13 Air ; g2 (niv. 177) : 2 PA, po 1–8, 13–15 Air
- Effets :
  - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29615 « Infection » niv.1 :
      - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s)  `[950]`
  - **13 à 15 dommages Air** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : début de tour du porteur  `[98]`
- **Analyse / rôle tactique** : Variante Air 2 PA (po 1–8, 1×/tour) : Infecte (1 t.) et poison Air 13–15 au début des 2 prochains tours de la cible. Ouverture bon marché pour infecter.


### Paire 5 — Arbre / Arbre Feuillu

#### Arbre (`13519`) — sort de base (obtenu niv. 5)

> Plante un Arbre. Un Arbre devient Feuillu après 1 tour.  Il ne peut y avoir que 6 Arbres par équipe. Le septième Arbre planté entraîne la mort du premier.

- Caractéristiques (g3) : **2 PA** · portée 1–8 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · 2×/tour
- Grades : g1 (niv. 5) : 2 PA, po 1–6 ; g2 (niv. 72) : 2 PA, po 1–7 ; g3 (niv. 139) : 2 PA, po 1–8
- Effets :
  - **Invoque « Arbre » (monstre 5894, grade 1)** → cible (alliée ou ennemie)  `[181]`
  - **Applique l'état « Feuillu » (256)** → invocations statiques alliées, U (INCERTAIN) ; durée infinie, délai 1 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : 2 PA (po 1–8, case libre, 2×/tour) : plante un Arbre (obstacle, bloque la LdV), Feuillu au tour suivant. 6 Arbres max par équipe. Base de toute la mécanique (poupées, zones, Force de la Nature). Ne consomme pas d'emplacement d'invocation.

#### Arbre Feuillu (`13560`) — variante (obtenu niv. 115)

> Plante un Arbre Feuillu. Tous les Arbres invoqués par le lanceur se transforment immédiatement en Arbres Feuillus.  Il ne peut y avoir que 6 Arbres par équipe. Le septième Arbre planté entraîne la mort du premier.

- Caractéristiques (g2) : **3 PA** · portée 1–8 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · 1×/tour
- Grades : g1 (niv. 115) : 3 PA, po 1–7 ; g2 (niv. 182) : 3 PA, po 1–8
- Effets :
  - **Invoque « Arbre » (monstre 5894, grade 2)** → cible (alliée ou ennemie)  `[181]`
  - **Applique l'état « Feuillu » (256)** → invocations statiques alliées, U (INCERTAIN) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Variante 3 PA (1×/tour) : plante un Arbre directement Feuillu ET rend Feuillus tous les Arbres du Sadida. Accélère la mise en place.


### Paire 6 — La Folle / La Folle Transmutée

#### La Folle (`13564`) — sort de base (obtenu niv. 10)

> Remplace un Arbre par une Poupée maîtrisable qui peut Infecter et appliquer un poison Air de début de tour.  À sa mort, la Poupée redevient un Arbre. Si elle a été invoquée à partir d'un Arbre Feuillu, l'Arbre à sa mort redevient Feuillu.

- Caractéristiques (g3) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 3 t. · 1×/tour
- Grades : g1 (niv. 10) : 2 PA, po 1–63 ; g2 (niv. 77) : 2 PA, po 1–63 ; g3 (niv. 144) : 2 PA, po 1–63
- Effets :
  - **Tue la cible et la remplace par l'invocation « La Folle » (monstre 5896, grade 3)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256)  `[405]`
  - **Tue la cible et la remplace par l'invocation « La Folle » (monstre 5896, grade 6)** → cible alliée — si cible a l'état « Feuillu » (256)  `[405]`
- **Analyse / rôle tactique** : 2 PA (po 1–63 sans LdV, relance 3) : remplace un Arbre par La Folle (poupée 6 PA/5 PM ; sort Agacement : Infecte + poison Air 20 au début des 2 tours de la cible, 1×/cible). Infecteur mobile.

#### La Folle Transmutée (`13515`) — variante (obtenu niv. 120)

> Invoque une Poupée maîtrisable qui peut Infecter et appliquer un poison Air de début de tour.  La Poupée est remplacée par un Arbre 3 tours après son invocation.

- Caractéristiques (g2) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 3 t. · 1×/tour
- Grades : g1 (niv. 120) : 3 PA, po 1–3 ; g2 (niv. 144) : 3 PA, po 1–3
- Effets :
  - **Invoque « La Folle » (monstre 5896, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « La Folle » (5896) ; délai 3 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–3, relance 3) : invoque La Folle sans Arbre ; remplacée par un Arbre après 3 tours.


### Paire 7 — Sève Paralysante / Miasmes

#### Sève Paralysante (`13533`) — sort de base (obtenu niv. 15)

> Infecte, retire de l'Esquive PM et applique un poison Feu de fin de tour sur la cible.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · ligne de vue requise · CC 0% · 1×/tour · cumul max 1
- Grades : g1 (niv. 15) : 3 PA, po 1–6, 9–11 Feu ; g2 (niv. 82) : 3 PA, po 1–7, 12–14 Feu ; g3 (niv. 149) : 3 PA, po 1–8, 15–18 Feu
- Effets :
  - **Applique l'état « Infecté » (263)** → cible ennemie ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 3)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29615 « Infection » niv.3 :
      - **Applique l'état « Infecté » (263)** → cible ennemie ; 3 tour(s)  `[950]`
  - **-15 Esquive PM** → cible (alliée ou ennemie) ; 3 tour(s)  `[163]`
  - **15 à 18 dommages Feu** → cible (alliée ou ennemie) ; actif 3 tour(s), déclencheur : fin de tour du porteur  `[99]`
- **Analyse / rôle tactique** : 3 PA (po 1–8, 1×/tour) : Infecte 3 tours, -15 Esquive PM (3 t.) et poison Feu 15–18 à la fin des 3 prochains tours de la cible. Ouverture idéale sur le boss (Infection longue).

#### Miasmes (`13562`) — variante (obtenu niv. 125)

> Infecte et applique un poison Air de fin de tour sur les ennemis en zone. La zone s'étend autour des Arbres Feuillus et des Poupées.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 1×/tour · cumul max 1
- Grades : g1 (niv. 125) : 2 PA, po 0–0, 10–12 Air ; g2 (niv. 192) : 2 PA, po 0–0, 12–14 Air
- Effets :
  - **le lanceur lance le sous-sort « Miasmes » (13580, niv. 2)** → lanceur  `[1160]`
    - ↳ sous-sort 13580 « Miasmes » niv.2 :
      - **le lanceur lance le sous-sort « Infection » (29615, niv. 1)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[1160]`
        - ↳ sous-sort 29615 « Infection » niv.1 :
          - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s)  `[950]`
      - **12 à 14 dommages Air** → ennemis dans la zone ; zone cercle taille 2 (min 1), actif 2 tour(s), déclencheur : fin de tour du porteur  `[98]`
  - **le lanceur lance le sous-sort « Miasmes » (13580, niv. 2)** → alliés dans la zone — si cible a l'état « Feuillu » (256) ; zone tout le terrain (vivants)  `[1160]`
    - ↳ (sous-sort 13580 niv.2 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Miasmes » (13580, niv. 2)** → alliés dans la zone — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934) ; zone tout le terrain (vivants)  `[1160]`
    - ↳ (sous-sort 13580 niv.2 déjà détaillé plus haut)
  - **Applique l'état « Infecté » (263)** → ennemis dans la zone ; zone cercle taille 2 (min 1), 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **12 à 14 dommages Air** → ennemis dans la zone ; zone cercle taille 2 (min 1), actif 2 tour(s), déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[98]`
- **Analyse / rôle tactique** : Variante 2 PA (sur soi) : Infecte et pose un poison Air 12–14 (fin de tour, 2 tours) aux ennemis en cercle 2 autour du Sadida, de chaque Arbre Feuillu et de chaque Poupée. Infection de masse si les arbres sont au contact des ennemis.


### Paire 8 — Contagion / Mangrove

#### Contagion (`13575`) — sort de base (obtenu niv. 20)

> Occasionne des dommages Air et retire des PM.   Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés en propageant l'Infection en zone autour de la cible.

- Caractéristiques (g3) : **4 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 25% · 2×/tour · 1×/cible · cumul max 1
- Grades : g1 (niv. 20) : 4 PA, po 1–5, 22–25 Air ; g2 (niv. 87) : 4 PA, po 1–6, 28–31 Air ; g3 (niv. 154) : 4 PA, po 1–7, 35–39 Air
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **Applique l'état « Infecté » (263)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ; zone cercle taille 2 (min 1), 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Contagion » (29633, niv. 7)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29633 « Contagion » niv.7 :
      - **Applique l'état « Contagion (cible) » (5424)** → ennemis dans la zone — si cible n'a PAS l'état « Infecté » (263) ET si cible n'a PAS l'état « Contagion (cible) » (5424) ; zone cercle taille 2 (min 1), 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Infection » (29615, niv. 2)** → ennemis dans la zone — si cible n'a PAS l'état « Contagion (cible) » (5424) ; zone cercle taille 2 (min 1)  `[1160]`
        - ↳ sous-sort 29615 « Infection » niv.2 :
          - **Applique l'état « Infecté » (263)** → cible ennemie ; 2 tour(s)  `[950]`
  - **35 à 39 dommages Air (CC : 42 à 47)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance le sous-sort « Contagion » (29633, niv. 8)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 29633 « Contagion » niv.8 :
      - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
  - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **le lanceur lance sur la case ciblée le sous-sort « Contagion » (29633, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29633 « Contagion » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Contagion » (29633, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29633 « Contagion » niv.6 :
          - **35 à 39 dommages Air** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ET si cible n'a PAS l'état « Contagion (cible) » (5424) ; zone cercle illimitée (63)  `[98]`
          - **le lanceur lance le sous-sort « Contagion » (29633, niv. 8)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ET si cible n'a PAS l'état « Contagion (cible) » (5424) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 29633 niv.8 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ET si cible n'a PAS l'état « Contagion (cible) » (5424) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
          - **Retire l'état « Contagion (cible) » (5424)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Air 4 PA (po 1–7, 2×/tour, 1×/cible, CC 25 %) : 35–39 Air et -2 PM ; sur Infecté : propage dégâts/PM à tous les Infectés ET infecte (2 t.) les ennemis en cercle 2 autour de la cible. Sort pivot de propagation.

#### Mangrove (`14396`) — variante (obtenu niv. 130)

> Soigne les alliés, occasionne des dommages Eau et retire des PM aux ennemis en zone. La zone s'étend autour des Arbres et les effets sont appliqués qu'une seule fois par lancer.  Transforme également tous les Arbres en Arbres Feuillus.

- Caractéristiques (g2) : **4 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 25% · 1×/tour · 2×/tour global (tous lanceurs) · cumul max 1
- Grades : g1 (niv. 130) : 4 PA, po 0–5, 29–32 soin Eau, 29–32 Eau ; g2 (niv. 197) : 4 PA, po 0–6, 32–36 soin Eau, 32–36 Eau
- Effets :
  - **Applique l'état « Mangrove (cible) » (5897)** → tous (alliés+ennemis) dans la zone ; zone croix taille 2, 1 tour(s)  `[950]`
  - **32 à 36 soins Eau (CC : 38 à 43)** → alliés dans la zone ; zone croix taille 2  `[2998]`
  - **32 à 36 dommages Eau (CC : 38 à 43)** → ennemis dans la zone ; zone croix taille 2  `[96]`
  - **le lanceur lance le sous-sort « Mangrove » (29634, niv. 5)** → ennemis dans la zone ; zone croix taille 2  `[1160]`
    - ↳ sous-sort 29634 « Mangrove » niv.5 :
      - **Retire 3 PM (esquivable)** → cible ennemie ; 1 tour(s), non désenvoûtable  `[1080]`
  - **Retire 3 PM (esquivable)** → ennemis dans la zone ; zone croix taille 2, 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **Applique l'état « Feuillu » (256)** → invocations statiques alliées, U (INCERTAIN) ; zone tout le terrain (vivants), durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 13558 « Feuillage » niv.1 :
      - **Change l'apparence** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[149]`
      - **Applique l'état « Feuillu » (256)** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[950]`
      - **100% Vitalité** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; durée infinie, non désenvoûtable  `[1078]`
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 2)** → lanceur — si cible n'a PAS l'état « Feuillu » (256) ; non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.2 : réapplique le passif Force de la Nature (+10 dégâts de base par Arbre Feuillu, sort 13584) aux alliés/invocations
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 4)** → lanceur ; actif 63 tour(s), déclencheur : à la mort (INCERTAIN), non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.4 : à la mort de l'arbre : recalcul du passif Force de la Nature
      - **Retire les effets du sort « Feuillage » (14700)** → lanceur  `[406]`
      - **la cible lance (sur elle-même) le sous-sort « Feuillage » (13558, niv. 5)** → lanceur ; actif 63 tour(s), déclencheur : quand l'état « Feuillu » (256) est retiré, non désenvoûtable  `[792]`
        - ↳ sous-sort 13558 niv.5 : si l'état Feuillu est retiré : l'arbre redevient Arbre normal (retire Arbre de Vie/Feuillage) et recalcule les compteurs
  - **le lanceur lance le sous-sort « Mangrove » (29634, niv. 2)** → alliés dans la zone — si cible est l’un des monstres : « Tréant » (5900) / « Groute » (5901) / « Arbre » (5894) ; zone cercle illimitée (63) (min 1)  `[1160]`
    - ↳ sous-sort 29634 « Mangrove » niv.2 :
      - **le lanceur lance le sous-sort « Mangrove » (29634, niv. 4)** → cible alliée — si cible est l’un des monstres : « Arbre » (5894) / « Tréant » (5900) / « Groute » (5901)  `[1160]`
        - ↳ sous-sort 29634 « Mangrove » niv.4 :
          - **Applique l'état « Mangrove (cible) » (5897)** → tous (alliés+ennemis) dans la zone ; zone croix taille 2 (min 1), 1 tour(s)  `[950]`
          - **32 à 36 soins Eau (CC : 38 à 43)** → alliés dans la zone — si cible n'a PAS l'état « Mangrove (cible) » (5897) ; zone croix taille 2 (min 1)  `[2998]`
          - **32 à 36 dommages Eau (CC : 38 à 43)** → ennemis dans la zone — si cible n'a PAS l'état « Mangrove (cible) » (5897) ; zone croix taille 2 (min 1)  `[96]`
          - **le lanceur lance le sous-sort « Mangrove » (29634, niv. 5)** → ennemis dans la zone — si cible n'a PAS l'état « Mangrove (cible) » (5897) ; zone croix taille 2 (min 1)  `[1160]`
            - ↳ (sous-sort 29634 niv.5 déjà détaillé plus haut)
  - **Retire l'état « Mangrove (cible) » (5897)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante 4 PA (po 0–6, 1×/tour, 2×/tour global, CC 25 %) : soigne 32–36 les alliés et inflige 32–36 Eau + -3 PM aux ennemis en croix 2 ; la zone s'étend en croix 2 autour de chaque Arbre (une seule application par entité) ; rend tous les Arbres Feuillus.


### Paire 9 — Ronce Apaisante / Rempotage

#### Ronce Apaisante (`13525`) — sort de base (obtenu niv. 25)

> Soigne les alliés ou retire des PM aux ennemis.  Sur un Arbre Feuillu : applique les effets dans un cercle de taille 2.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g3) : **2 PA** · portée 0–9 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · relance 4 t. · relance globale -1 t.
- Grades : g1 (niv. 25) : 2 PA, po 0–5, 29–34 soin meilleur élt ; g2 (niv. 92) : 2 PA, po 0–7, 37–43 soin meilleur élt ; g3 (niv. 159) : 2 PA, po 0–9, 46–54 soin meilleur élt
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **Applique l'état « Enraciné » (6)** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **46 à 54 soins du meilleur élément** → cible alliée — si cible n'est pas « Arbre » (5894) ET si cible n'est pas « Tréant » (5900) ET si cible n'est pas « Groute » (5901)  `[3002]`
  - **le lanceur lance le sous-sort « Ronce Apaisante » (13546, niv. 9)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 13546 « Ronce Apaisante » niv.9 :
      - **46 à 54 soins du meilleur élément** → cible alliée  `[3002]`
      - **46 à 54 soins du meilleur élément** → alliés dans la zone ; zone cercle taille 2 (min 1)  `[3002]`
      - **Retire 2 PM (esquivable)** → ennemis dans la zone ; zone cercle taille 2 (min 1), 2 tour(s)  `[1080]`
  - **le lanceur lance le sous-sort « Ronce Apaisante » (13546, niv. 10)** → cible alliée — si cible n'a PAS l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 13546 « Ronce Apaisante » niv.10 :
      - **Retire 2 PM (esquivable)** → cible ennemie ; 2 tour(s)  `[1080]`
  - **le lanceur lance le sous-sort « Ronce Apaisante » (13546, niv. 10)** → cible ennemie  `[1160]`
    - ↳ (sous-sort 13546 niv.10 déjà détaillé plus haut)
  - **Retire 2 PM (esquivable)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **le lanceur lance sur la case ciblée le sous-sort « Ronce Apaisante » (13546, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13546 « Ronce Apaisante » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Ronce Apaisante » (13546, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13546 « Ronce Apaisante » niv.6 :
          - **Retire 2 PM (esquivable)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63), 2 tour(s)  `[1080]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : 2 PA en ligne (po 0–9, relance 4) : gros soin 46–54 (meilleur élément) à un allié OU -2 PM (2 tours) à un ennemi ; sur Feuillu : soin + retrait en cercle 2 ; propagation du retrait sur Infectés.

#### Rempotage (`13565`) — variante (obtenu niv. 135)

> Soigne une invocation Sadida, la téléporte sur la première case disponible entre le lanceur et elle et plante un Arbre sur la case ciblée.

- Caractéristiques (g1) : **2 PA** · portée 1–9 (non modifiable) · en ligne uniquement · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 2 t. (1er lancer possible au tour 2)
- Effets :
  - **Soin : 25% des PV max** → cible alliée — si cible est l’un des monstres : « Arbre » (5894) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Surpuissante » (5899) / « Tréant » (5900) / « Groute » (5901) / « La Fourbe » (7934) / « Ronce » (7933)  `[1109]`
  - **la cible lance sur le lanceur (source) le sous-sort « Rempotage » (13581, niv. 1)** → cible alliée — si cible est l’un des monstres : « Arbre » (5894) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Surpuissante » (5899) / « Tréant » (5900) / « Groute » (5901) / « La Fourbe » (7934)  `[1017]`
    - ↳ sous-sort 13581 « Rempotage » niv.1 :
      - **Téléporte le lanceur sur la case ciblée** → tous (alliés+ennemis) dans la zone — si lanceur n'a PAS l'état « Pesanteur » (7) ; zone ligne depuis le lanceur taille 1 (min 63)  `[4]`
  - **Téléporte le lanceur sur la case ciblée** → tous (alliés+ennemis) dans la zone ; zone ligne depuis le lanceur taille 1 (min 63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[4]`
  - **Invoque « Arbre » (monstre 5894, grade 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[181]`
  - **Invoque « Arbre » (monstre 5894, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
- **Analyse / rôle tactique** : Variante 2 PA en ligne (po 1–9 sans LdV, relance 2, 1er lancer au tour 2) : soigne 25 % PV max une invocation Sadida, la téléporte sur la première case libre entre le Sadida et elle, et plante un Arbre à sa place.


### Paire 10 — La Bloqueuse / La Bloqueuse Transmutée

#### La Bloqueuse (`13561`) — sort de base (obtenu niv. 30)

> Remplace un Arbre par une Poupée maîtrisable qui peut échanger de position si elle est maîtrisée et bloquer les ennemis. Elle peut également augmenter ses PM et se rendre Intaclable.  À sa mort, la Poupée redevient un Arbre. Si elle a été invoquée à partir d'un Arbre Feuillu, l'Arbre à sa mort redevient Feuillu.

- Caractéristiques (g3) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 3 t. · 1×/tour
- Grades : g1 (niv. 30) : 2 PA, po 1–63 ; g2 (niv. 97) : 2 PA, po 1–63 ; g3 (niv. 140) : 2 PA, po 1–63
- Effets :
  - **Tue la cible et la remplace par l'invocation « La Bloqueuse » (monstre 5895, grade 3)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256)  `[405]`
  - **Tue la cible et la remplace par l'invocation « La Bloqueuse » (monstre 5895, grade 6)** → cible alliée — si cible a l'état « Feuillu » (256)  `[405]`
- **Analyse / rôle tactique** : 2 PA (remplace un Arbre, relance 3) : La Bloqueuse (100 % PV, 30 % rés.) : Substitution (échange avec un allié, +20 Tacle si échange), Célérité (+4 PM, Intaclable). Bloqueur/garde du corps.

#### La Bloqueuse Transmutée (`13526`) — variante (obtenu niv. 140)

> Invoque une Poupée maîtrisable qui peut échanger de position si elle est maîtrisée et bloquer les ennemis. Elle peut également augmenter ses PM et se rendre Intaclable.  La Poupée est remplacée par un Arbre 3 tours après son invocation.

- Caractéristiques (g1) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 3 t. · 1×/tour
- Effets :
  - **Invoque « La Bloqueuse » (monstre 5895, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « La Bloqueuse » (5895) ; délai 3 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–3, relance 3) : invoque La Bloqueuse directement (remplacée par un Arbre après 3 tours).


### Paire 11 — Ronces Agressives / Fétiches Calcinés

#### Ronces Agressives (`13527`) — sort de base (obtenu niv. 35)

> Vole des PM et occasionne des dommages Terre.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g3) : **4 PA** · portée 1–6 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 25% · 2×/tour · 1×/cible · cumul max 3
- Grades : g1 (niv. 35) : 4 PA, po 1–4, 24–27 Terre ; g2 (niv. 102) : 4 PA, po 1–5, 31–34 Terre ; g3 (niv. 169) : 4 PA, po 1–6, 38–42 Terre
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Ronces Agressives » (13554, niv. 8)** → lanceur ; actif 1 tour(s), déclencheur : quand le porteur réussit un retrait de PM (déduit de Flèche de Rédemption)  `[1160]`
    - ↳ sous-sort 13554 « Ronces Agressives » niv.8 :
      - **1 PM** → lanceur ; 1 tour(s), non désenvoûtable  `[128]`
  - **Vole 1 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[77]`
  - **le lanceur lance le sous-sort « Ronces Agressives » (13554, niv. 7)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 13554 « Ronces Agressives » niv.7 :
      - **Retire 1 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
  - **38 à 42 dommages Terre (CC : 46 à 50)** → cible (alliée ou ennemie)  `[97]`
  - **le lanceur lance sur la case ciblée le sous-sort « Ronces Agressives » (13554, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13554 « Ronces Agressives » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Ronces Agressives » (13554, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13554 « Ronces Agressives » niv.6 :
          - **le lanceur lance le sous-sort « Ronces Agressives » (13554, niv. 7)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 13554 niv.7 déjà détaillé plus haut)
          - **38 à 42 dommages Terre** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[97]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
  - **Retire les effets du sort « Ronces Agressives » (13527)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Terre 4 PA (po 1–6, 2×/tour, 1×/cible, CC 25 %) : 38–42 Terre et vole 1 PM (cumul 3) ; propagation sur Infectés (chaque retrait réussi rend 1 PM au Sadida).

#### Fétiches Calcinés (`14393`) — variante (obtenu niv. 145)

> Occasionne des dommages Feu et applique l'état Fétiches Calcinés sur l'ennemi ciblé : • Une partie des dommages subis par les Arbres du lanceur est renvoyée à la cible.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g1) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 15% · 2×/tour · cumul max 1
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **28 à 31 dommages Feu (CC : 34 à 37)** → cible (alliée ou ennemie)  `[99]`
  - **Applique l'état « Fétiches Calcinés » (5437)** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Dommages : 30% des dommages finaux subis** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1223]`
  - **le lanceur lance le sous-sort « Fétiches Calcinés » (28792, niv. 3)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 28792 « Fétiches Calcinés » niv.3 :
      - **Applique l'état « Fétiches Calcinés » (5437)** → cible ennemie ; 1 tour(s)  `[950]`
  - **le lanceur lance sur la case ciblée le sous-sort « Fétiches Calcinés » (28792, niv. 1)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 28792 « Fétiches Calcinés » niv.1 :
      - **le lanceur lance sur la case ciblée le sous-sort « Fétiches Calcinés » (28792, niv. 2)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 28792 « Fétiches Calcinés » niv.2 :
          - **28 à 31 dommages Feu** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[99]`
          - **le lanceur lance le sous-sort « Fétiches Calcinés » (28792, niv. 3)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 28792 niv.3 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante Feu 3 PA (po 1–6, 2×/tour) : 28–31 Feu et état Fétiches Calcinés 1 tour : 30 % des dommages finaux subis par les Arbres du Sadida sont renvoyés à la cible. Propagation sur Infectés. À combiner avec des arbres au contact des monstres.


### Paire 12 — Fléau / Forêt Hantée

#### Fléau (`13571`) — sort de base (obtenu niv. 40)

> Vole de la vie dans l'élément Eau.  Sur une Poupée : applique les effets sur les ennemis dans un carré de taille 1.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible
- Grades : g1 (niv. 40) : 3 PA, po 1–4, 16–18 vol Eau ; g2 (niv. 107) : 3 PA, po 1–5, 21–23 vol Eau ; g3 (niv. 174) : 3 PA, po 1–6, 26–29 vol Eau
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Fléau » (13592, niv. 9)** → cible alliée — si cible est l’un des monstres : « La Bloqueuse » (5895) / « La Folle » (5896) / « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[1160]`
    - ↳ sous-sort 13592 « Fléau » niv.9 :
      - **26 à 29 vol Eau (CC : 31 à 35)** → ennemis dans la zone ; zone carré taille 1  `[91]`
  - **26 à 29 vol Eau (CC : 31 à 35)** → cible ennemie  `[91]`
  - **26 à 29 vol Eau (CC : 31 à 35)** → cible alliée — si cible n'est pas « La Bloqueuse » (5895) ET si cible n'est pas « La Folle » (5896) ET si cible n'est pas « La Gonflable » (5897) ET si cible n'est pas « La Sacrifiée » (5898) ET si cible n'est pas « La Surpuissante » (5899) ET si cible n'est pas « La Fourbe » (7934)  `[91]`
  - **le lanceur lance sur la case ciblée le sous-sort « Fléau » (13592, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13592 « Fléau » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Fléau » (13592, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13592 « Fléau » niv.6 :
          - **26 à 29 vol Eau** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[91]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Eau 3 PA (po 1–6, 3×/tour, 2×/cible) : vol Eau 26–29 ; sur une Poupée : vol en carré 1 autour d'elle ; propagation sur Infectés. Principal sort de survie.

#### Forêt Hantée (`13524`) — variante (obtenu niv. 150)

> Occasionne des dommages Terre aux ennemis et leur applique l'état Forêt Hantée en zone : • Infecte la cible si elle attaque un Arbre du lanceur.  La zone s'étend dans un carré de taille 1 autour des Arbres Feuillus et les effets ne sont appliqués qu'une seule fois par lancer.

- Caractéristiques (g1) : **3 PA** · portée 0–7 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · 1×/tour · 2×/tour global (tous lanceurs) · cumul max 1
- Effets :
  - **Applique l'état « Forêt Hantée (cible) » (5896)** → ennemis dans la zone ; zone cercle taille 4, 1 tour(s)  `[950]`
  - **29 à 32 dommages Terre (CC : 35 à 38)** → ennemis dans la zone ; zone cercle taille 4  `[97]`
  - **le lanceur lance le sous-sort « Forêt Hantée » (29643, niv. 3)** → ennemis dans la zone ; zone cercle taille 4  `[1160]`
    - ↳ sous-sort 29643 « Forêt Hantée » niv.3 :
      - **Applique l'état « Forêt Hantée » (5407)** → cible ennemie ; 1 tour(s)  `[950]`
  - **Applique l'état « Forêt Hantée » (5407)** → ennemis dans la zone ; zone cercle taille 4, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Infecté » (263)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Forêt Hantée » (29643, niv. 1)** → alliés dans la zone — si cible a l'état « Feuillu » (256) ; zone cercle illimitée (63) (min 1)  `[1160]`
    - ↳ sous-sort 29643 « Forêt Hantée » niv.1 :
      - **le lanceur lance le sous-sort « Forêt Hantée » (29643, niv. 2)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
        - ↳ sous-sort 29643 « Forêt Hantée » niv.2 :
          - **Applique l'état « Forêt Hantée (cible) » (5896)** → ennemis dans la zone — si cible n'a PAS l'état « Forêt Hantée (cible) » (5896) ; zone carré taille 1, 1 tour(s)  `[950]`
          - **29 à 32 dommages Terre (CC : 35 à 38)** → ennemis dans la zone — si cible n'a PAS l'état « Forêt Hantée (cible) » (5896) ; zone carré taille 1  `[97]`
          - **le lanceur lance le sous-sort « Forêt Hantée » (29643, niv. 3)** → ennemis dans la zone — si cible n'a PAS l'état « Forêt Hantée (cible) » (5896) ; zone carré taille 1  `[1160]`
            - ↳ (sous-sort 29643 niv.3 déjà détaillé plus haut)
  - **Retire l'état « Forêt Hantée (cible) » (5896)** → ennemis dans la zone ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante Terre 3 PA en ligne (po 0–7, 1×/tour, 2×/tour global, CC 20 %) : 29–32 Terre aux ennemis en **cercle 4** + état Forêt Hantée (s'ils attaquent un Arbre ils sont Infectés) ; la zone s'étend en carré 1 autour des Feuillus (une application par ennemi).


### Paire 13 — Puissance Sylvestre / Influence Végétale

#### Puissance Sylvestre (`13530`) — sort de base (obtenu niv. 45)

> Remplace un Arbre Feuillu par un Arbre Feuillu contrôlable qui peut : • Infecter et pousser une cible. • Soigner les alliés et réduire les soins reçus par les ennemis en zone. • Réduire la durée des effets sur une cible.  L'Arbre contrôlable est remplacé par un Arbre Feuillu 2 tours après son invocation.

- Caractéristiques (g3) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 3 t. · relance globale -1 t.
- Grades : g1 (niv. 45) : 2 PA, po 1–63 ; g2 (niv. 112) : 2 PA, po 1–63 ; g3 (niv. 179) : 2 PA, po 1–63
- Effets :
  - **Tue la cible et la remplace par l'invocation « Groute » (monstre 5901, grade 3)** → cible alliée — si cible a l'état « Feuillu » (256)  `[2796]`
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « Groute » (5901) ; délai 2 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
  - **Applique l'état « Feuillu » (256)** → cible alliée — si cible est le monstre « Groute » (5901) ; durée infinie, délai 2 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : 2 PA (po 1–63, relance 3) : transforme un Arbre Feuillu en Groute contrôlable 2 tours (4 PA/4 PM) : Rejet Sylvestre (Infecte + pousse jusqu'à la case), Photosynthèse (soin 12 % PV max en cercle 3, soins ennemis ×50 %), Détoxication (-2 tours d'effets).

#### Influence Végétale (`13566`) — variante (obtenu niv. 155)

> Remplace un Arbre Feuillu par un Arbre Feuillu contrôlable qui peut : • Infecter et attirer une cible. • Appliquer un bouclier sur les alliés et retirer des PM aux ennemis en zone. • Planter des Ronces Indéplaçables.  L'Arbre contrôlable est remplacé par un Arbre Feuillu 2 tours après son invocation.

- Caractéristiques (g1) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 3 t. · relance globale -1 t.
- Effets :
  - **Tue la cible et la remplace par l'invocation « Tréant » (monstre 5900, grade 1)** → cible alliée — si cible a l'état « Feuillu » (256)  `[2796]`
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « Tréant » (5900) ; délai 2 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
  - **Applique l'état « Feuillu » (256)** → cible alliée — si cible est le monstre « Tréant » (5900) ; durée infinie, délai 2 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : Variante 2 PA : transforme un Feuillu en Tréant 2 tours : Étreinte Sylvestre (Infecte + attire jusqu'à la case), Canopée (bouclier 200 % du niveau aux alliés en cercle 3 + -2 PM ennemis), Mur de Ronces (ronces en rectangle).


### Paire 14 — La Sacrifiée / La Sacrifiée Transmutée

#### La Sacrifiée (`13567`) — sort de base (obtenu niv. 50)

> Remplace un Arbre par une Poupée maîtrisable qui peut se sacrifier pour Infecter et occasionner des dommages Eau en zone. Sa Vitalité et ses dommages finaux augmentent au fil des tours.  À sa mort, la Poupée redevient un Arbre. Si elle a été invoquée à partir d'un Arbre Feuillu, l'Arbre à sa mort redevient Feuillu.

- Caractéristiques (g3) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 2 t. · 1×/tour
- Grades : g1 (niv. 50) : 2 PA, po 1–63 ; g2 (niv. 117) : 2 PA, po 1–63 ; g3 (niv. 160) : 2 PA, po 1–63
- Effets :
  - **Tue la cible et la remplace par l'invocation « La Sacrifiée » (monstre 5898, grade 3)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256)  `[405]`
  - **Tue la cible et la remplace par l'invocation « La Sacrifiée » (monstre 5898, grade 6)** → cible alliée — si cible a l'état « Feuillu » (256)  `[405]`
  - **le lanceur lance le sous-sort « Préparation Poupesque » (24281, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24281 niv.1 : aucun effet de jeu (marqueur)
- **Analyse / rôle tactique** : 2 PA (remplace un Arbre, relance 2) : La Sacrifiée (60 % PV) dont la Vitalité et les dommages finaux augmentent au fil des tours ; Explosion Ouatée : se sacrifie à la fin de son prochain tour (ou à sa mort) pour Infecter et infliger 30 Eau en cercle 2 (cercle 1 à 3 selon la préparation).

#### La Sacrifiée Transmutée (`13522`) — variante (obtenu niv. 160)

> Invoque une Poupée maîtrisable qui peut se sacrifier pour Infecter et occasionner des dommages Eau en zone. Sa Vitalité et ses dommages finaux augmentent au fil des tours.  La Poupée est remplacée par un Arbre 3 tours après son invocation.

- Caractéristiques (g1) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 2 t. · 1×/tour
- Effets :
  - **Invoque « La Sacrifiée » (monstre 5898, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **le lanceur lance le sous-sort « Préparation Poupesque » (24281, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24281 niv.1 : aucun effet de jeu (marqueur)
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « La Sacrifiée » (5898) ; délai 3 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–3) : invoque directement La Sacrifiée.


### Paire 15 — Herbes Folles / Malédiction Vaudou

#### Herbes Folles (`13518`) — sort de base (obtenu niv. 55)

> Occasionne des dommages Feu et retire des PM aux ennemis en zone.

- Caractéristiques (g3) : **3 PA** · portée 0–7 (modifiable) · ligne de vue requise · CC 25% · 1×/tour · cumul max 1
- Grades : g1 (niv. 55) : 3 PA, po 0–5, 20–23 Feu ; g2 (niv. 122) : 3 PA, po 0–6, 27–31 Feu ; g3 (niv. 189) : 3 PA, po 0–7, 31–35 Feu
- Effets :
  - **31 à 35 dommages Feu (CC : 37 à 42)** → ennemis dans la zone ; zone cercle taille 2  `[99]`
  - **Retire 3 PM (esquivable)** → ennemis dans la zone ; zone cercle taille 2, 1 tour(s), non désenvoûtable  `[1080]`
- **Analyse / rôle tactique** : Feu 3 PA (po 0–7, 1×/tour, CC 25 %) : 31–35 Feu et -3 PM aux ennemis en cercle 2. Excellent retrait PM de zone sans dépendre de l'Infection.

#### Malédiction Vaudou (`13576`) — variante (obtenu niv. 165)

> Occasionne des dommages Eau et applique l'état Vaudou sur l'ennemi ciblé : • Occasionne des dommages Eau à la cible à la mort d'une Poupée du lanceur.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g1) : **3 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 0% · relance 2 t. · cumul max 1
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **25 à 28 dommages Eau** → cible (alliée ou ennemie)  `[96]`
  - **Applique l'état « Vaudou » (5398)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **14 à 16 dommages Eau** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[96]`
  - **le lanceur lance le sous-sort « Malédiction Vaudou » (29638, niv. 3)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29638 « Malédiction Vaudou » niv.3 :
      - **Applique l'état « Vaudou » (5398)** → cible ennemie ; 2 tour(s)  `[950]`
  - **le lanceur lance sur la case ciblée le sous-sort « Malédiction Vaudou » (29638, niv. 1)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29638 « Malédiction Vaudou » niv.1 :
      - **le lanceur lance sur la case ciblée le sous-sort « Malédiction Vaudou » (29638, niv. 2)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29638 « Malédiction Vaudou » niv.2 :
          - **25 à 28 dommages Eau** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[96]`
          - **le lanceur lance le sous-sort « Malédiction Vaudou » (29638, niv. 3)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 29638 niv.3 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante Eau 3 PA (po 1–7, relance 2) : 25–28 Eau + état Vaudou (2 t.) : 14–16 Eau à la cible à chaque mort d'une Poupée du Sadida. Combo Sacrifice Vaudou/Explosion Ouatée.


### Paire 16 — Sacrifice Vaudou / Chardons Ardents

#### Sacrifice Vaudou (`13531`) — sort de base (obtenu niv. 60)

> Occasionne des dommages Eau. Les dommages sont plus importants sur les invocations.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.  Sur une Poupée : • Sacrifie la Poupée pour soigner les alliés, appliquer les effets sur les ennemis et les Infecter en zone. • Réinitialise son temps de relance.

- Caractéristiques (g3) : **3 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 20% · 3×/tour · 1×/cible
- Grades : g1 (niv. 60) : 3 PA, po 1–5, 22–25 Eau, 26–30 Eau, 22–25 soin Eau ; g2 (niv. 127) : 3 PA, po 1–6, 27–30 Eau, 32–36 Eau, 27–30 soin Eau ; g3 (niv. 194) : 3 PA, po 1–7, 30–34 Eau, 36–41 Eau, 30–34 soin Eau
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Sacrifice Vaudou » (13553, niv. 9)** → cible alliée — si cible est l’un des monstres : « La Bloqueuse » (5895) / « La Folle » (5896) / « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[1160]`
    - ↳ sous-sort 13553 « Sacrifice Vaudou » niv.9 :
      - **la cible lance sur le lanceur (source) le sous-sort « Sacrifice Vaudou » (13553, niv. 10)** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[1017]`
        - ↳ sous-sort 13553 « Sacrifice Vaudou » niv.10 :
          - **La Folle : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Folle » (5896) ET si cible n'a PAS l'état « La Folle Transmutée » (4007)  `[1045]`
          - **La Folle Transmutée : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Folle » (5896) ET si cible a l'état « La Folle Transmutée » (4007)  `[1045]`
          - **La Bloqueuse : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Bloqueuse » (5895) ET si cible n'a PAS l'état « La Bloqueuse Transmutée » (4008)  `[1045]`
          - **La Bloqueuse Transmutée : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Bloqueuse » (5895) ET si cible a l'état « La Bloqueuse Transmutée » (4008)  `[1045]`
          - **La Sacrifiée : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Sacrifiée » (5898) ET si cible n'a PAS l'état « La Sacrifiée Transmutée » (4009)  `[1045]`
          - **La Sacrifiée Transmutée : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Sacrifiée » (5898) ET si cible a l'état « La Sacrifiée Transmutée » (4009)  `[1045]`
          - **La Gonflable : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Gonflable » (5897) ET si cible n'a PAS l'état « La Gonflable Transmutée » (4010)  `[1045]`
          - **La Gonflable Transmutée : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Gonflable » (5897) ET si cible a l'état « La Gonflable Transmutée » (4010)  `[1045]`
          - **La Surpuissante : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Surpuissante » (5899) ET si cible n'a PAS l'état « La Surpuissante Transmutée » (4011)  `[1045]`
          - **La Surpuissante Transmutée : relance fixée à 0** → cible alliée — si lanceur est le monstre « La Surpuissante » (5899) ET si cible a l'état « La Surpuissante Transmutée » (4011)  `[1045]`
      - **Tue la cible** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[141]`
      - **30 à 34 soins Eau (CC : 36 à 41)** → alliés dans la zone ; zone cercle taille 2 (min 1)  `[2998]`
      - **30 à 34 dommages Eau (CC : 36 à 41)** → personnages/compagnons ennemis, monstres ennemis (non invocations jouantes) ; zone cercle taille 2 (min 1)  `[96]`
      - **36 à 41 dommages Eau (CC : 43 à 49)** → invocations ennemies ; zone cercle taille 2 (min 1)  `[96]`
      - **le lanceur lance le sous-sort « Infection » (29615, niv. 2)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[1160]`
        - ↳ sous-sort 29615 « Infection » niv.2 :
          - **Applique l'état « Infecté » (263)** → cible ennemie ; 2 tour(s)  `[950]`
  - **30 à 34 dommages Eau (CC : 36 à 41)** → personnages/compagnons alliés, monstres alliés (non invocations jouantes), personnages/compagnons ennemis, monstres ennemis (non invocations jouantes)  `[96]`
  - **36 à 41 dommages Eau (CC : 43 à 49)** → invocations ennemies  `[96]`
  - **36 à 41 dommages Eau (CC : 43 à 49)** → invocations alliées — si cible n'est pas « La Bloqueuse » (5895) ET si cible n'est pas « La Folle » (5896) ET si cible n'est pas « La Gonflable » (5897) ET si cible n'est pas « La Sacrifiée » (5898) ET si cible n'est pas « La Surpuissante » (5899) ET si cible n'est pas « La Fourbe » (7934)  `[96]`
  - **Tue la cible** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[141]`
  - **30 à 34 soins Eau (CC : 36 à 41)** → alliés dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2998]`
  - **30 à 34 dommages Eau (CC : 36 à 41)** → personnages/compagnons ennemis, monstres ennemis (non invocations jouantes) ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[96]`
  - **36 à 41 dommages Eau (CC : 43 à 49)** → invocations ennemies ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[96]`
  - **Applique l'état « Infecté » (263)** → ennemis dans la zone ; zone cercle taille 2 (min 1), 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance sur la case ciblée le sous-sort « Sacrifice Vaudou » (13553, niv. 3)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13553 « Sacrifice Vaudou » niv.3 :
      - **le lanceur lance sur la case ciblée le sous-sort « Sacrifice Vaudou » (13553, niv. 6)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13553 « Sacrifice Vaudou » niv.6 :
          - **30 à 34 dommages Eau** → personnages/compagnons ennemis, monstres ennemis (non invocations jouantes) — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[96]`
          - **36 à 41 dommages Eau** → invocations ennemies — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[96]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Eau 3 PA (po 1–7, 3×/tour, 1×/cible) : 30–34 Eau (36–41 sur les invocations) ; sur une Poupée : la sacrifie pour soigner 30–34 les alliés, frapper et Infecter les ennemis en cercle 2, et réinitialise la relance du sort d'invocation de cette Poupée.

#### Chardons Ardents (`13517`) — variante (obtenu niv. 170)

> Applique l'état Chardons Ardents sur l'ennemi ciblé : • Applique un poison Feu de fin de tour sur la cible pour chaque PM qu'elle utilise (cumulable 3 fois).  Sur un ennemi : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g1) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 0% · relance 3 t. · cumul max 1
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **Applique l'état « Chardons Ardents » (5399)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **8 dommages Feu** → cible ennemie ; actif 1 tour(s), déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[99]`
  - **le lanceur lance le sous-sort « Chardons Ardents » (29640, niv. 3)** → cible ennemie  `[1160]`
    - ↳ sous-sort 29640 « Chardons Ardents » niv.3 :
      - **Applique l'état « Chardons Ardents » (5399)** → cible ennemie ; 2 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Chardons Ardents » (29640, niv. 4)** → cible ennemie ; actif 2 tour(s), déclencheur : à chaque PM utilisé par le porteur (déduit de Sentinelle, INCERTAIN)  `[1160]`
        - ↳ sous-sort 29640 « Chardons Ardents » niv.4 :
          - **la cible lance (sur elle-même) le sous-sort « Chardons Ardents » (29640, niv. 5)** → cible ennemie ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[792]`
            - ↳ sous-sort 29640 niv.5 : aucun effet de jeu (marqueur)
          - **8 dommages Feu** → cible ennemie ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[99]`
  - **le lanceur lance sur la case ciblée le sous-sort « Chardons Ardents » (29640, niv. 1)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29640 « Chardons Ardents » niv.1 :
      - **le lanceur lance sur la case ciblée le sous-sort « Chardons Ardents » (29640, niv. 2)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29640 « Chardons Ardents » niv.2 :
          - **le lanceur lance le sous-sort « Chardons Ardents » (29640, niv. 3)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 29640 niv.3 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–6, relance 3) : état Chardons Ardents 2 tours — poison Feu 8 en fin de tour par PM utilisé (cumul 3) ; propagation sur Infectés. Punit les monstres mobiles.


### Paire 17 — Arbre de Vie / Altruisme Végétal

#### Arbre de Vie (`13534`) — sort de base (obtenu niv. 65)

> Plante un Arbre de Vie. L'Arbre de Vie redevient Feuillu 2 tours après son invocation.

- Caractéristiques (g3) : **4 PA** · portée 1–8 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 3 t. (1er lancer possible au tour 2) · relance globale -1 t.
- Grades : g1 (niv. 65) : 4 PA, po 1–6 ; g2 (niv. 131) : 4 PA, po 1–7 ; g3 (niv. 198) : 4 PA, po 1–8
- Effets :
  - **Invoque « Arbre » (monstre 5894, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Applique l'état « Feuillu » (256)** → cible (alliée ou ennemie) ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Arbre de Vie » (5179)** → cible (alliée ou ennemie) ; 2 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
- **Analyse / rôle tactique** : 4 PA (po 1–8, relance 3, 1er lancer au tour 2) : plante un Arbre de Vie (Feuillu, Vitalité ×3) : à la fin du tour du Sadida, soigne 5 % PV max les alliés autour des Arbres Feuillus et 25 % les invocations Sadida ; les alliés qui le frappent sont soignés de 100 % des dommages occasionnés.

#### Altruisme Végétal (`13572`) — variante (obtenu niv. 175)

> Sacrifie un Arbre Feuillu ou une Poupée pour augmenter la Vitalité des Poupées et soigner le lanceur.

- Caractéristiques (g1) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · 1×/tour · cumul max 4
- Effets :
  - **le lanceur lance le sous-sort « Altruisme Végétal » (13585, niv. 1)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 13585 « Altruisme Végétal » niv.1 :
      - **Tue la cible** → cible alliée — si cible a l'état « Feuillu » (256)  `[141]`
      - **Tue la cible** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[141]`
      - **25% Vitalité** → alliés dans la zone — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934) ; zone tout le terrain (vivants), durée infinie  `[1078]`
      - **Soin : 8% des PV max** → lanceur  `[1109]`
  - **le lanceur lance le sous-sort « Altruisme Végétal » (13585, niv. 1)** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[1160]`
    - ↳ (sous-sort 13585 niv.1 déjà détaillé plus haut)
  - **Tue la cible** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934) / « Arbre » (5894) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[141]`
  - **25% Vitalité** → alliés dans la zone — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934) ; zone tout le terrain (vivants), durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1078]`
  - **Soin : 8% des PV max** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
- **Analyse / rôle tactique** : Variante 2 PA (po 1–63) : sacrifie un Arbre Feuillu ou une Poupée : +25 % Vitalité à toutes les Poupées (cumul 4) et soigne le Sadida de 8 % PV max.


### Paire 18 — La Gonflable / La Gonflable Transmutée

#### La Gonflable (`13573`) — sort de base (obtenu niv. 70)

> Remplace un Arbre par une Poupée maîtrisable qui peut soigner, occasionner des dommages Feu et repousser.  À sa mort, la Poupée redevient un Arbre. Si elle a été invoquée à partir d'un Arbre Feuillu, l'Arbre à sa mort redevient Feuillu.

- Caractéristiques (g2) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 4 t. · 1×/tour
- Grades : g1 (niv. 70) : 2 PA, po 1–63 ; g2 (niv. 137) : 2 PA, po 1–63
- Effets :
  - **Tue la cible et la remplace par l'invocation « La Gonflable » (monstre 5897, grade 3)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256)  `[405]`
  - **Tue la cible et la remplace par l'invocation « La Gonflable » (monstre 5897, grade 6)** → cible alliée — si cible a l'état « Feuillu » (256)  `[405]`
- **Analyse / rôle tactique** : 2 PA (remplace un Arbre, relance 4) : La Gonflable (70 %) : Souffle Printanier (soin 50 Feu en cercle 3 + alliés au contact des Feuillus), Brise Automnale (repousse de 4 et 50 Feu en croix 1).

#### La Gonflable Transmutée (`13523`) — variante (obtenu niv. 180)

> Invoque une Poupée maîtrisable qui peut soigner, occasionner des dommages Feu et repousser.  La Poupée est remplacée par un Arbre 3 tours après son invocation.

- Caractéristiques (g1) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 4 t. · 1×/tour
- Effets :
  - **Invoque « La Gonflable » (monstre 5897, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « La Gonflable » (5897) ; délai 3 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
- **Analyse / rôle tactique** : Variante 3 PA (po 1–3, relance 4) : invoque directement La Gonflable.


### Paire 19 — Tremblement / Mandragore

#### Tremblement (`13514`) — sort de base (obtenu niv. 75)

> En zone autour du lanceur, d'un Arbre Feuillu ou d'une Poupée : • Occasionne des dommages Terre aux ennemis. • Attire les entités vers le centre de la zone. • Dévoile les invisibles.

- Caractéristiques (g2) : **3 PA** · portée 0–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 20% · 2×/tour · 1×/cible · 4×/tour global (tous lanceurs)
- Grades : g1 (niv. 75) : 3 PA, po 0–63, 23–27 Terre ; g2 (niv. 142) : 3 PA, po 0–63, 29–33 Terre
- Effets :
  - **le lanceur lance le sous-sort « Tremblement » (13537, niv. 2)** → cible alliée — si cible a l'état « Feuillu » (256) ; non désenvoûtable  `[1160]`
    - ↳ sous-sort 13537 « Tremblement » niv.2 :
      - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1)  `[6]`
      - **29 à 33 dommages Terre (CC : 35 à 40)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[97]`
      - **Dévoile les entités invisibles** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[202]`
  - **le lanceur lance le sous-sort « Tremblement » (13537, niv. 2)** → cible alliée — si cible est l’un des monstres : « La Bloqueuse » (5895) / « La Folle » (5896) / « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Surpuissante » (5899) / « La Fourbe » (7934) ; non désenvoûtable  `[1160]`
    - ↳ (sous-sort 13537 niv.2 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Tremblement » (13537, niv. 2)** → lanceur (s’il est dans la zone) ; non désenvoûtable  `[1160]`
    - ↳ (sous-sort 13537 niv.2 déjà détaillé plus haut)
  - **29 à 33 dommages Terre (CC : 35 à 40)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone cercle taille 3 (min 1)  `[97]`
  - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **Dévoile les entités invisibles** → ennemis dans la zone ; zone cercle taille 3 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[202]`
- **Analyse / rôle tactique** : Terre 3 PA (po 0–63 sans LdV sur une entité, 2×/tour, 1×/cible, 4×/tour global) : centré sur le Sadida, un Arbre Feuillu ou une Poupée : 29–33 Terre aux ennemis en cercle 3, attire de 2 vers le centre, dévoile les invisibles. Regroupe autour d'un arbre au contact.

#### Mandragore (`13559`) — variante (obtenu niv. 185)

> Occasionne des dommages Air et applique l'état Mandragore sur l'ennemi ciblé : • Infecte la cible si elle subit des dommages de poison ou d'invocation.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g1) : **3 PA** · portée 1–8 (modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · 2×/tour · 1×/cible · cumul max 1
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **30 à 34 dommages Air (CC : 36 à 41)** → cible (alliée ou ennemie)  `[98]`
  - **Applique l'état « Mandragore » (5403)** → cible ennemie ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Mandragore » (29641, niv. 3)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 29641 « Mandragore » niv.3 :
      - **Applique l'état « Mandragore » (5403)** → cible ennemie ; 2 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Mandragore » (29641, niv. 4)** → cible ennemie ; actif 2 tour(s), déclencheur : dommages subis en début de tour OU dommages subis en fin de tour OU dommages indirects subis (INCERTAIN)  `[1160]`
        - ↳ sous-sort 29641 « Mandragore » niv.4 :
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 1)** → cible ennemie  `[1160]`
            - ↳ sous-sort 29615 « Infection » niv.1 :
              - **Applique l'état « Infecté » (263)** → cible ennemie ; 1 tour(s)  `[950]`
  - **le lanceur lance sur la case ciblée le sous-sort « Mandragore » (29641, niv. 1)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29641 « Mandragore » niv.1 :
      - **le lanceur lance sur la case ciblée le sous-sort « Mandragore » (29641, niv. 2)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29641 « Mandragore » niv.2 :
          - **30 à 34 dommages Air** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[98]`
          - **le lanceur lance le sous-sort « Mandragore » (29641, niv. 3)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[1160]`
            - ↳ (sous-sort 29641 niv.3 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante Air 3 PA en ligne (po 1–8, 2×/tour, 1×/cible, CC 20 %) : 30–34 Air + état Mandragore 2 t. (Infecte la cible quand elle subit des dommages de poison/indirects) ; propagation.


### Paire 20 — Inoculation / Force de la Nature

#### Inoculation (`13569`) — sort de base (obtenu niv. 80)

> Augmente les dommages du sort pour chaque ennemi Infecté et occasionne des dommages Air.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.  Consomme toutes les Infections autour de la cible.

- Caractéristiques (g2) : **5 PA** · portée 1–6 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 25% · 2×/tour · 1×/cible · cumul max 5
- Grades : g1 (niv. 80) : 5 PA, po 1–5, 31–35 Air ; g2 (niv. 147) : 5 PA, po 1–6, 39–43 Air
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **le lanceur lance le sous-sort « Inoculation » (29635, niv. 6)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ; zone tout le terrain (vivants)  `[1160]`
    - ↳ sous-sort 29635 « Inoculation » niv.6 :
      - **Applique l'état « Inoculation (cible) » (6309)** → cible ennemie — si cible a l'état « Infecté (effets sur cible) » (5409) ; 1 tour(s)  `[950]`
      - **Inoculation : +5 dégâts de base** → lanceur ; 1 tour(s)  `[293]`
      - **Inoculation : +5 dégâts de base** → lanceur ; 1 tour(s)  `[293]`
  - **Inoculation : +5 dégâts de base** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **39 à 43 dommages Air (CC : 47 à 52)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance sur la case ciblée le sous-sort « Inoculation » (29635, niv. 2)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 29635 « Inoculation » niv.2 :
      - **le lanceur lance sur la case ciblée le sous-sort « Inoculation » (29635, niv. 4)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 29635 « Inoculation » niv.4 :
          - **39 à 43 dommages Air** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[98]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
  - **le lanceur lance le sous-sort « Inoculation » (29635, niv. 7)** → lanceur  `[1160]`
    - ↳ sous-sort 29635 « Inoculation » niv.7 :
      - **Retire l'état « Inoculation (cible) » (6309)** → ennemis dans la zone — si cible a l'état « Inoculation (cible) » (6309) ; zone tout le terrain (vivants)  `[951]`
      - **Retire l'état « Infecté » (263)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Inoculation (cible) » (6309) ; zone tout le terrain (vivants)  `[951]`
      - **Retire les effets du sort « Inoculation » (29635)** → lanceur  `[406]`
  - **Retire l'état « Infecté » (263)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ; zone tout le terrain (vivants), *info-bulle uniquement (comportement réel géré côté serveur)*  `[951]`
- **Analyse / rôle tactique** : Air 5 PA (po 1–6, 2×/tour, 1×/cible, CC 25 %) : 39–43 Air, +5 dégâts de base par ennemi Infecté (cumul 5), propagé à tous les Infectés, puis **consomme** toutes les Infections. Finisher de propagation.

#### Force de la Nature (`13570`) — variante (obtenu niv. 190)

> Occasionne des dommages Terre. Les dommages du sort sont augmentés pour chaque Arbre Feuillu du lanceur planté.  Sur un ennemi Infecté : applique les effets sur tous les ennemis Infectés.

- Caractéristiques (g1) : **5 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour · 1×/cible
- Effets :
  - **le lanceur lance le sous-sort « Infection » (29615, niv. 4)** → cible ennemie — si cible a l'état « Infecté » (263)  `[1160]`
    - ↳ sous-sort 29615 niv.4 : marquage de la cible principale Infectée (états 5409/6244) → déclenche la propagation (voir §2.3)
  - **40 à 45 dommages Terre (CC : 48 à 54)** → cible (alliée ou ennemie)  `[97]`
  - **Force de la Nature : +10 dégâts de base** → lanceur ; durée infinie, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **le lanceur lance sur la case ciblée le sous-sort « Force de la Nature » (13594, niv. 1)** → cible (alliée ou ennemie)  `[2960]`
    - ↳ sous-sort 13594 « Force de la Nature » niv.1 :
      - **le lanceur lance sur la case ciblée le sous-sort « Force de la Nature » (13594, niv. 2)** → cible (alliée ou ennemie) — si lanceur a l'état « Infecté (effets sur cible) » (5409)  `[2960]`
        - ↳ sous-sort 13594 « Force de la Nature » niv.2 :
          - **40 à 45 dommages Terre** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (effets sur cible) » (5409) ; zone cercle illimitée (63)  `[97]`
          - **le lanceur lance le sous-sort « Infection » (29615, niv. 9)** → ennemis dans la zone — si cible a l'état « Infecté » (263) ET si cible n'a PAS l'état « Infecté III » (713) ET si cible n'a PAS l'état « Infecté (compteur sur cible) » (6244) ; zone cercle illimitée (63)  `[1160]`
            - ↳ sous-sort 29615 niv.9 : compteur de propagation Infecté I → II → III (états 711–713, 1 tour) sur l'ennemi propagé
      - **Retire l'état « Infecté (effets sur cible) » (5409)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (effets sur cible) » (5409) ; zone tout le terrain  `[951]`
      - **Retire l'état « Infecté (compteur sur cible) » (6244)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Infecté (compteur sur cible) » (6244) ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Variante Terre 5 PA (po 1–6, 2×/tour, 1×/cible, CC 25 %) : 40–45 Terre +10 dégâts de base par Arbre Feuillu planté (jusqu'à +60) ; propagation sur Infectés. Gros mono-cible Terre en fin de mise en place.


### Paire 21 — Don Naturel / Harmonie

#### Don Naturel (`13532`) — sort de base (obtenu niv. 85)

> Sacrifie un Arbre Feuillu ou une Poupée pour partager les dommages entre les alliés et les soigner en zone. Le partage de dommages n'affecte pas les invocations statiques.

- Caractéristiques (g2) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 3 t. · relance globale -1 t.
- Grades : g1 (niv. 85) : 2 PA, po 1–63, 24–28 soin meilleur élt ; g2 (niv. 152) : 2 PA, po 1–63, 30–35 soin meilleur élt
- Effets :
  - **le lanceur lance le sous-sort « Don Naturel » (13544, niv. 2)** → cible alliée — si cible a l'état « Feuillu » (256)  `[1160]`
    - ↳ sous-sort 13544 « Don Naturel » niv.2 :
      - **Tue la cible** → cible alliée — si cible a l'état « Feuillu » (256)  `[141]`
      - **Tue la cible** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[141]`
      - **Partage les dommages** → lanceur (s'il est dans la zone), personnages joueurs alliés, compagnons alliés, monstres alliés (non invocations jouantes), invocations jouantes alliées ; zone cercle taille 2 (min 1), actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[1061]`
      - **30 à 35 soins du meilleur élément** → alliés dans la zone ; zone cercle taille 2 (min 1)  `[3002]`
      - **Applique l'état « Sacrifice » (583)** → lanceur (s'il est dans la zone), personnages joueurs alliés, compagnons alliés, monstres alliés (non invocations jouantes), invocations jouantes alliées ; zone cercle taille 2 (min 1), 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Don Naturel » (13544, niv. 2)** → cible alliée — si cible est l’un des monstres : « La Gonflable » (5897) / « La Sacrifiée » (5898) / « La Bloqueuse » (5895) / « La Folle » (5896) / « La Surpuissante » (5899) / « La Fourbe » (7934)  `[1160]`
    - ↳ (sous-sort 13544 niv.2 déjà détaillé plus haut)
  - **Partage les dommages** → lanceur (s'il est dans la zone), personnages joueurs alliés, compagnons alliés, monstres alliés (non invocations jouantes), invocations jouantes alliées ; zone cercle taille 2 (min 1), actif 1 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1061]`
  - **30 à 35 soins du meilleur élément** → alliés dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[3002]`
- **Analyse / rôle tactique** : 2 PA (po 1–63, relance 3) : sacrifie un Arbre Feuillu ou une Poupée : soigne 30–35 (meilleur élément) et lie les alliés en cercle 2 (hors invocations statiques) en partage de dommages pendant 1 tour.

#### Harmonie (`13579`) — variante (obtenu niv. 195)

> Enracine le lanceur et partage les dommages entre tous ses Arbres et lui.

- Caractéristiques (g1) : **3 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 4 t.
- Effets :
  - **Applique l'état « Enraciné » (6)** → lanceur ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Partage les dommages** → alliés dans la zone ; zone tout le terrain (vivants), actif 1 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1061]`
  - **Applique l'état « Harmonie » (5425)** → lanceur ; 1 tour(s)  `[950]`
  - **Applique l'état « Harmonie » (5425)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est l’un des monstres : « Tréant » (5900) / « Groute » (5901) / « Arbre » (5894) ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Harmonie » (29639, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 29639 « Harmonie » niv.1 :
      - **Applique l'état « Enraciné » (6)** → lanceur ; 1 tour(s), non désenvoûtable  `[950]`
      - **Partage les dommages** → alliés dans la zone — si cible a l'état « Harmonie » (5425) ; zone tout le terrain (vivants), actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[1061]`
      - **Applique l'état « Sacrifice » (583)** → alliés dans la zone — si cible a l'état « Harmonie » (5425) ; zone tout le terrain (vivants)  `[950]`
  - **Retire l'état « Harmonie » (5425)** → alliés dans la zone ; zone tout le terrain (vivants)  `[951]`
- **Analyse / rôle tactique** : Variante 3 PA (relance 4) : le Sadida s'Enracine (indéplaçable 1 tour) et partage les dommages qu'il subit avec tous ses Arbres (et lui). Survie du Sadida focus.


### Paire 22 — La Surpuissante / La Surpuissante Transmutée

#### La Surpuissante (`13578`) — sort de base (obtenu niv. 90)

> Remplace un Arbre par une Poupée maîtrisable qui peut occasionner des dommages Terre, retirer ou donner des PM. Elle peut également invoquer une autre Poupée maîtrisable qui peut voler ou donner de la Portée.  À sa mort, la Poupée redevient un Arbre. Si elle a été invoquée à partir d'un Arbre Feuillu, l'Arbre à sa mort redevient Feuillu.

- Caractéristiques (g2) : **2 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 4 t. · 1×/tour
- Grades : g1 (niv. 90) : 2 PA, po 1–63 ; g2 (niv. 157) : 2 PA, po 1–63
- Effets :
  - **Tue la cible et la remplace par l'invocation « La Surpuissante » (monstre 5899, grade 3)** → cible alliée — si cible est le monstre « Arbre » (5894) ET si cible n'a PAS l'état « Feuillu » (256)  `[405]`
  - **Tue la cible et la remplace par l'invocation « La Surpuissante » (monstre 5899, grade 6)** → cible alliée — si cible a l'état « Feuillu » (256)  `[405]`
- **Analyse / rôle tactique** : 2 PA (remplace un Arbre, relance 4) : La Surpuissante (90 %) : Choc Hivernal (23 Terre, -1 PM, propagation), Ardeur Estivale (+3 PM 2 t. à un allié), La Fourbe (invoque une poupée qui vole 1 PO aux ennemis / donne +2 PO aux alliés).

#### La Surpuissante Transmutée (`13520`) — variante (obtenu niv. 200)

> Invoque une Poupée maîtrisable qui peut occasionner des dommages Terre, retirer ou donner des PM. Elle peut également invoquer une autre Poupée maîtrisable qui peut voler ou donner de la Portée.  La Poupée est remplacée par un Arbre 3 tours après son invocation.

- Caractéristiques (g1) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 4 t. · 1×/tour
- Effets :
  - **Invoque « La Surpuissante » (monstre 5899, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Tue la cible et la remplace par l'invocation « Arbre » (monstre 5894, grade 1)** → cible alliée — si cible est le monstre « La Surpuissante » (5899) ; délai 3 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[405]`
- **Analyse / rôle tactique** : Variante niveau 200, 3 PA (po 1–3, relance 4) : invoque directement La Surpuissante.


## 4. Rôles en groupe de 4 (PvM niveau 200)

| Rôle | Pertinence | Détails |
|---|---|---|
| Entrave PM de masse | ★★★★★ | Infection + Buisson Ardent/Contagion/Ronce Apaisante ; Herbes Folles, Feu de Brousse, Mangrove, Canopée. |
| Contrôle de terrain / invocations | ★★★★★ | Arbres (murs de LdV/chemin, 6 max), Bloqueuse (tacle), Tremblement (attire autour d'un arbre). |
| Soin secondaire | ★★★ | Ronce Apaisante, Larme (sans LdV), Mangrove, Arbre de Vie, Gonflable, Groute, Don Naturel. |
| DPS | ★★★ (★★★★ contre des groupes Infectés) | Propagation multi-cibles, Inoculation, Force de la Nature. |
| Tank | ★★ | Harmonie (partage avec les Arbres), Bloqueuse ; le Sadida lui-même est fragile. |

**Placement** : 4–7 cases derrière le front, en gardant des cases libres devant soi pour planter les Arbres entre le paquet ennemi
et les alliés fragiles. Les Arbres au contact des ennemis maximisent Miasmes/Tremblement/Ronce sur Feuillu.

## 5. Choix de variantes recommandés

| Paire | Base | Variante | Entrave/Infection | Soin de zone | DPS Terre |
|---|---|---|---|---|---|
| 1 | Ronce | Ronce Insolente | Ronce | Ronce | Ronce Insolente |
| 2 | Larme de Sadida | Montée de Sève | Larme | Larme | Larme |
| 3 | Buisson Ardent | Feu de Brousse | Buisson Ardent | Buisson Ardent | Buisson Ardent |
| 4 | Cigüe | Vent Empoisonné | Cigüe | Cigüe | Cigüe |
| 5 | Arbre | Arbre Feuillu | Arbre (2 PA, 2×/tour) | Arbre Feuillu | Arbre Feuillu |
| 6 | La Folle | Transmutée | La Folle | La Folle | La Folle |
| 7 | Sève Paralysante | Miasmes | Sève Paralysante | Sève Paralysante | Sève Paralysante |
| 8 | Contagion | Mangrove | Contagion | Mangrove | Contagion |
| 9 | Ronce Apaisante | Rempotage | Ronce Apaisante | Ronce Apaisante | Ronce Apaisante |
| 10 | La Bloqueuse | Transmutée | La Bloqueuse | La Bloqueuse | La Bloqueuse |
| 11 | Ronces Agressives | Fétiches Calcinés | Ronces Agressives | Ronces Agressives | Ronces Agressives |
| 12 | Fléau | Forêt Hantée | Fléau | Fléau | Fléau (Forêt Hantée vs gros paquets) |
| 13 | Puissance Sylvestre | Influence Végétale | Puissance Sylvestre | Influence Végétale (bouclier) | Puissance Sylvestre |
| 14 | La Sacrifiée | Transmutée | La Sacrifiée | La Sacrifiée | La Sacrifiée |
| 15 | Herbes Folles | Malédiction Vaudou | Herbes Folles | Herbes Folles | Herbes Folles |
| 16 | Sacrifice Vaudou | Chardons Ardents | Sacrifice Vaudou | Sacrifice Vaudou | Sacrifice Vaudou |
| 17 | Arbre de Vie | Altruisme Végétal | Arbre de Vie | Arbre de Vie | Arbre de Vie |
| 18 | La Gonflable | Transmutée | La Gonflable | La Gonflable | La Gonflable |
| 19 | Tremblement | Mandragore | Tremblement | Tremblement | Tremblement |
| 20 | Inoculation | Force de la Nature | Inoculation | Inoculation | Force de la Nature |
| 21 | Don Naturel | Harmonie | Don Naturel | Don Naturel | Don Naturel |
| 22 | La Surpuissante | Transmutée | La Surpuissante | La Surpuissante | La Surpuissante |

## 6. Rotations types (11–12 PA, 6 PM)

1. **Tour 1 (mise en place)** : Arbre ×2 (4) près du paquet → Sève Paralysante (3) sur le boss → Vent Empoisonné/Ronce (2–3)
   → Miasmes (2) si des Arbres/poupées sont au contact.
2. **Tour 2 (entrave)** : Contagion (4) sur un Infecté (propage + infecte cercle 2) → Buisson Ardent ×2 (6) sur un Infecté
   → Arbre (2). Résultat : -2/-4/-6 PM tentés sur chaque Infecté (limite 3 propagations/ennemi/tour).
3. **Tour 3 (burst)** : Cigüe (3) → Contagion (4) → Inoculation (5) (+5 par Infecté, consomme les Infections).
4. **Tour soin** : Ronce Apaisante (2) sur Feuillu → Mangrove/Larme (3–4) → Arbre de Vie (4) → Larme (3).

## 7. Forces / faiblesses

- Forces : retrait PM de masse, murs d'arbres, soins secondaires, polyvalence élémentaire, très fort contre des paquets.
- Faiblesses : lenteur de mise en place, dégâts unitaires moyens, invocations fragiles, gros coût PA, complexité de l'IA.

## 8. Synergies

- **DPS distance (Crâ) / mêlée (Iop)** : arbres = protection LdV et chemin ; retraits PM = DPS en sécurité.
- **Enutrof / Sacrieur** : -15 Esquive PM (Sève Paralysante) puis retraits PM combinés.
- **Pandawa** : porte/jette Arbres et Poupées ; regroupement pour Tremblement/Miasmes.
- **Eniripsa / Féca** : le Sadida devient soigneur/entraveur secondaire ; Bloqueuse au contact du soigneur.

## 9. Questions ouvertes (INCERTAIN)

- PV des invocations en % des PV du Sadida ; différence grade 3/6 des Poupées.
- Répartition exacte du partage de dommages ; ordre de propagation de l'Infection.
- Contrôle effectif des Poupées en PvM (maîtrise des invocations).

## Sources

- DofusDB API : https://api.dofusdb.fr/breeds/10 , https://api.dofusdb.fr/spell-variants?breedId=10 , https://api.dofusdb.fr/spells/29615 (Infection), https://api.dofusdb.fr/spells/29644 (Arbre de Vie), https://api.dofusdb.fr/monsters/5894 … /5901, /7933, /7934
- Énumération ActionIds (client Dofus) : `.cache/classes/ref/ActionIds.ts` ; grammaire des masques/déclencheurs : `DamageUtil.as` (client Dofus 2 décompilé, `.cache/domath/d2client/`).

