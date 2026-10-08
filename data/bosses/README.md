# Fiches manuelles des boss (`data/bosses/<monsterId>.json`)

Les données DofusDB (`data/dofusdb`) donnent les statistiques, les sorts et les états d'un boss, mais pas **comment**
se joue le combat : conditions pour lever une invulnérabilité, résistances réellement subies après une mécanique
(Kimbo à 400 %), part du combat passée dans chaque phase, sorts que l'IA ne lance pas en pratique, monstres de la
salle du boss… Une fiche manuelle complète la fiche calculée par `bossProfile` (src/theorycraft/bossProfile.ts) pour
le theorycraft « meilleur stuff / meilleures classes contre un boss » (docs/design/theorycraft.md §1.3).

Une fiche est **facultative** : sans elle, le profil est calculé à partir des données seules, avec ses hypothèses et
avertissements affichés.

## Fichiers

- Un fichier par boss, nommé **`<monsterId>.json`** (id DofusDB du monstre, ex. `3534.json` pour Merkator). Un nom
  différent n'est jamais appliqué : `loadBossOverrides` (page web, scripts) le refuse, avec tout le dossier (erreur
  qui cite le fichier) ; la ligne de commande, qui ne lit que `<monsterId>.json`, le signale dans les avertissements
  de la fiche du boss.
- Les fichiers dont le nom commence par `_` (ex. `_template.json`, brouillons) et ce README sont ignorés.
- Lecture : `loadBossOverrides()` (src/theorycraft/node.ts) ; validation stricte : `parseBossOverrides()`
  (src/theorycraft/overrides.ts). Une clé inconnue, un type inattendu ou une valeur hors domaine bloque le
  chargement, avec le nom du fichier et le chemin de la clé en cause.
- Point de départ : copier `_template.json` vers `<monsterId>.json`, puis supprimer les clés inutiles.

## Schéma (version 1)

Toutes les clés sont facultatives sauf `version` et `monsterId`. Éléments dans l'ordre **[Neutre, Terre, Feu, Eau,
Air]**, pourcentages en points (25 = 25 %).

| Clé | Type | Effet sur le profil |
|---|---|---|
| `version` | `1` | Version du schéma. |
| `monsterId` | entier | Id du monstre (= nom du fichier). |
| `name` | texte | Nom lisible (information). |
| `sources` | `[{ url, date?, patch? }]` | Sources consultées : URL http(s), date `AAAA-MM-JJ`, version du jeu. |
| `updatedAt` | `AAAA-MM-JJ` | Date de dernière mise à jour de la fiche. |
| `patch` | texte | Version du jeu décrite (ex. `"3.7"`). |
| `resPct` | 5 nombres | Résistances **effectives** imposées pour toutes les phases (après mécanique). |
| `stats` | objet | Caractéristiques imposées au boss cible (clés de `Stats`, src/core/types.ts), ex. `{ "rangedResPct": 50 }`. `allResPct` est reporté sur les 5 éléments. |
| `phases` | liste | **Remplace** les phases calculées. Chaque phase : `id` (unique), `name`, `states` (états du boss qui rendent ses sorts lançables), `weight` (part du combat, ≥ 0, normalisée), `resPct` (5 nombres ou `null`), `vulnerable` (`true`, `false`, `"melee"`, `"range"`), `notes`. Au moins une phase de poids > 0. |
| `adds` | `[{ monsterId, grade?, count }]` | Monstres de la salle du boss : comptés dans les dégâts reçus de la cible du proxy de stuff (exposition 0,5 par monstre par rapport au boss) ; ni cibles des dégâts (pas de valeur des zones), ni comptés par le profil du boss, qui les cite dans ses hypothèses. |
| `excludeSpells` | ids de sorts | Sorts que le boss ne lance pas en pratique : hors phases et hors dégâts. |
| `positionalSpells` | ids de sorts | Sorts qui ne touchent qu'en position particulière : listés, mais hors pic et soutenu. Disjoint de `excludeSpells`. |
| `mechanics` | `[{ kind, summary, counters?, punishes? }]` | Mécaniques ajoutées à la fiche (source « overrides »). `kind` : type de `MechanicKind` ; `counters` / `punishes` : utilités (`UtilityTag`) que la mécanique rend utiles / inutiles. |
| `notes` | texte | Commentaire libre. |

Types de mécanique (`kind`) : `invulnerable`, `invulnerable-melee`, `invulnerable-range`, `reduced-range`,
`reduced-melee`, `damage-taken`, `final-damage`, `res-change`, `extreme-res`, `reflect`, `erosion`,
`hp-based-damage`, `ap-mp-removal`, `range-removal`, `punished-removal`, `pacifist`, `incurable`, `cant-be-moved`,
`push-resource`, `summons`, `boss-heal`, `boss-shield`, `marks`, `phases`, `mp-cost`, `other`.

Utilités (`counters`, `punishes`) : `melee`, `range`, `zone`, `burst`, `indirect-damage`, `mp-removal`,
`ap-removal`, `range-removal`, `heal`, `shield`, `damage-reduction`, `placement`, `push-damage`, `summons`, `debuff`,
`erosion`, `ally-ap-mp`, `ally-damage`, `damage-taken-debuff`, `dodge`, `multi-element`.

## Règles de rédaction et de sources

1. **Écrire avec ses propres mots.** Une fiche résume une mécanique (« −50 % de dommages subis à distance »,
   « vulnérable 1 tour après une poussée contre un mur ») ; elle ne recopie jamais le texte d'un guide.
2. **Citer chaque source** dans `sources` : URL, date de consultation (`date`) et version du jeu (`patch`). Mettre à
   jour `updatedAt` et `patch` à chaque modification. Une fiche sans source n'est qu'une hypothèse : le dire dans
   `notes`.
3. **Aucune extraction automatique** (script, robot, agent) ni copie depuis un site dont les conditions d'utilisation
   l'interdisent. C'est le cas de **dofuspourlesnoobs** : ses CGU interdisent l'accès automatisé, la reproduction et
   l'usage de son contenu pour alimenter une IA ou une base de connaissances. On peut le **lire soi-même** et en tirer
   des faits de jeu reformulés, en citant l'URL ; rien de plus.
4. **DofusWiki** (dofuswiki.fandom.com) est sous licence **CC-BY-SA** : réutilisable avec attribution (URL de la page
   et licence dans `sources`/`notes`) et partage dans les mêmes conditions.
5. Les chiffres du jeu (statistiques, sorts, états) viennent de DofusDB : ne pas les recopier dans la fiche, sauf
   pour les **corriger** (résistances effectives, statistiques après mécanique) — en expliquant pourquoi dans
   `notes`.
6. Préférer les données récentes : la mise à jour 3.7 (2026-10-06) a modifié de nombreux boss ; une fiche décrivant
   une version antérieure doit le dire (`patch`).
