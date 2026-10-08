/**
 * Theorycraft contre un boss — postures et états initiaux de classe (docs/design/theorycraft.md §1.4 bis).
 *
 * Le moteur ne lance, au début du combat, que les passifs d'ÉQUIPEMENT (effet 1175) : les sorts initiaux et passifs de
 * classe qui posent une posture sont absents des données (24387 « L'Héritage du Forgelance », 14631/24955/24956
 * Eliotrope, 18633 Zobal) ou présents mais jamais lancés au début du combat (23385 « Armé », 24037 « Sobre », 29129
 * « Marée »). Or des dizaines de sorts exigent l'état de posture du LANCEUR (`statesCriterion`, ex. « E99 » Furia du
 * Zobal, « E3360|E3589 » Forgelance) ou ont des lignes de dégâts conditionnées par lui (masque `*E498` Pandawa) : sans
 * posture, ces classes valent ≈ 0 en DPT (soutenu sur 6 tours contre le Comte Harebourg à 0 % de résistance :
 * zobal_rempart 0, zobal_psychopathe 239, pandawa_placement 366, forgelance_zone_terre 928, contre une médiane de 2 568
 * pour les presets des classes sans posture ; avec posture : 1 351, 2 890, 2 626, 3 088).
 *
 * `STANCES` liste, par classe, les postures tenables (états posés sur le lanceur) ; `bestStance` les évalue toutes avec
 * une fonction fournie (DPT soutenu de rotation.ts en général) et garde la meilleure, affichée par le theorycraft. Le
 * coût de changement de posture (1 PA et relance 2 pour un masque Zobal, lancer la Lance du Forgelance, boire pour le
 * Pandawa) n'est PAS compté : posture supposée tenue tout le combat.
 *
 * Sources : docs/research/classes/{zobal,forgelance,pandawa,eliotrope,steamer,ouginak,ecaflip,xelor}.md,
 * data/research/class-mechanics/*.json, data/dofusdb/spell-states.json (noms des états) et les `statesCriterion` / masques
 * des sorts de classe (data/dofusdb/class-spells.json) — ids vérifiés par tests/theory-stances.test.ts.
 */

/** Une posture : états posés sur le lanceur pendant tout le calcul. */
export interface ClassStance {
  /** Identifiant stable (rapports, CLI). */
  id: string
  /** Nom affiché (français). */
  name: string
  /** États du lanceur (ids spell-states). */
  states: number[]
  /** Posture de début de combat (posée par un passif ou un sort initial que le moteur ne lance pas). */
  initial?: boolean
  /**
   * Phase d'un cycle (Rage → Forme Bestiale de l'Ouginak…) plutôt qu'une posture tenue : évaluée et rapportée, mais
   * exclue du choix de `bestStance` sauf `includeTransient`.
   */
  transient?: boolean
  /** Posture offerte seulement si le lanceur connaît l'un de ces sorts (variante qui fixe la posture). */
  requiresSpell?: number[]
  /** Point INCERTAIN (texte affiché). */
  uncertain?: string
  /** Ce que la posture change et ce qui n'est pas modélisé. */
  note?: string
}

/** Classes (ids DofusDB). */
const FECA = 1
const ECAFLIP = 6
const XELOR = 5
const PANDAWA = 12
const ZOBAL = 14
const STEAMER = 15
const ELIOTROPE = 16
const OUGINAK = 18
const FORGELANCE = 20

/** Postures par classe (voir l'en-tête ; classe absente : aucune posture, le DPT ne dépend d'aucun état du lanceur). */
export const STANCES: Readonly<Record<number, readonly ClassStance[]>> = {
  [ZOBAL]: [
    {
      id: 'intrepide',
      name: 'Masque de l’Intrépide',
      states: [98],
      initial: true,
      note: 'Posé au début du combat par le passif 18633 (sans les bonus du masque). Débloque Ronda, Catalepsie, Cavalcade, Brincadeira…',
    },
    {
      id: 'psychopathe',
      name: 'Masque du Psychopathe',
      states: [99],
      note: 'Débloque Furia, Cabriole, Bocciara, Inferno… ; +10 % dommages mêlée du masque NON comptés (buff du sort de masque).',
    },
    {
      id: 'pleutre',
      name: 'Masque du Pleutre',
      states: [100],
      note: 'Débloque Apathie, Picada, Distance… ; +1 PM / +10 % dommages distance (Couard) NON comptés.',
    },
  ],
  [FORGELANCE]: [
    {
      id: 'arme',
      name: 'Armé',
      states: [3360],
      initial: true,
      note: 'Posé au début du combat par « L’Héritage du Forgelance » (24387, absent des données). Sorts « HS=3360|HS=3589 » lançables, sous-sorts de zone sur la case visée.',
    },
    {
      id: 'desarme',
      name: 'Désarmé',
      states: [3361],
      uncertain: 'Lance posée : les zones centrées sur la Lance (Effondrement, Fer Rouge, Noa…) ne sont pas modélisées (pas de position) ⇒ DPT sous-estimé.',
      note: 'Après avoir lancé la Lance Immortelle ; Muspel exige Désarmé.',
    },
  ],
  [PANDAWA]: [
    {
      id: 'sobre',
      name: 'Sobre',
      states: [3531],
      initial: true,
      note: 'Posture par défaut (sort 24037, état infini) ; lignes « *E3531 » et Stabilisation, Varappe.',
    },
    {
      id: 'saoul',
      name: 'Saoul',
      states: [498],
      uncertain: 'Saoul expire après 2 tours (retour à Sobre) : entretenu en buvant (Picole, Bombance…), coût d’entretien non compté.',
      note: 'Lignes « *E498 » et Souffle Enflammé, Souillure, Fermentation, Lien Spiritueux, Pandanlku ; ×0,85 dommages subis non compté.',
    },
  ],
  [ELIOTROPE]: [
    {
      id: 'portail',
      name: 'Portail',
      states: [3737],
      initial: true,
      requiresSpell: [14574],
      note: 'Fixé par la variante de la paire Portail/Errance (sort initial 24955, absent des données). Aucun sort de dégâts n’en dépend : bonus de portail (+2 %/case) non modélisé.',
    },
    {
      id: 'errance',
      name: 'Errance',
      states: [3738],
      initial: true,
      requiresSpell: [14604],
      note: 'Fixé par la variante Errance (sort initial 24956, absent des données). Sans effet sur le DPT analytique.',
    },
  ],
  [STEAMER]: [
    {
      id: 'maree-basse',
      name: 'Marée Basse',
      states: [5283],
      initial: true,
      note: 'Posée au début du combat par le passif « Marée » (29129). Change des effets utilitaires (Longue-vue, Écume, Courant), pas les dégâts.',
    },
    {
      id: 'maree-haute',
      name: 'Marée Haute',
      states: [5282],
      note: 'Bascule gratuite (Marée sur soi rend 3 PA) ; PA rendus non modélisés.',
    },
  ],
  [OUGINAK]: [
    { id: 'calme', name: 'Sans Rage', states: [], initial: true },
    {
      id: 'rage',
      name: 'Rage (palier I)',
      states: [513, 515],
      transient: true,
      note: 'Palier du cycle de Rage (+1 Rage par sort offensif) ; ×0,9 dommages subis non compté. Débloque Arcanin, Caninos.',
    },
    {
      id: 'raage',
      name: 'Raage (palier II)',
      states: [514, 515],
      transient: true,
      note: 'Palier II du cycle ; ×0,81 dommages subis non compté.',
    },
    {
      id: 'bestiale',
      name: 'Forme Bestiale',
      states: [517],
      transient: true,
      uncertain: 'Phase de 2 tours du cycle de Rage : +20 % dommages finaux et +2 PM NON comptés (buffs), portée max 2 non appliquée.',
      note: 'Lignes de Cerbère « *E517 » ; sorts défensifs interdits.',
    },
  ],
}

/**
 * États de classe NON modélisés comme postures (séquence, aléa, placement) : notes affichées par le theorycraft (note de
 * confiance de la classe).
 */
export const STANCE_NOTES: Readonly<Record<number, string>> = {
  [ECAFLIP]: 'Main (5601), Main Gagnante (5554) et combinaisons de cartes : états de pioche (aléatoire, dépend de la séquence) — Château de Cartes, Rekop et Bluff hors DPT.',
  [XELOR]: 'Téléfrag (251) sur la cible et « 1 Téléfrag consommé » (707) : dépendent du placement — Glas et les bonus de Téléfrag hors DPT.',
  [PANDAWA]: 'Porteur (3) et Ébriété (4077-4079) : sorts de jet d’une entité portée (Karcham, Chamrak, Cascade…) hors DPT (un boss se porte rarement).',
  [OUGINAK]: 'Cycle de Rage (0 → I → II → Forme Bestiale 2 tours) : phases évaluées séparément, aucune moyenne de cycle ; Proie (516) sur la cible non posée.',
  [FECA]: 'Glyphes (Hypoglyphe 238) : dégâts de glyphes hors DPT.',
}

/** Posture implicite d'une classe sans posture (aucun état). */
export const NO_STANCE: ClassStance = Object.freeze({ id: 'base', name: 'Sans posture', states: [], initial: true }) as ClassStance

/**
 * Postures d'une classe, filtrées par les sorts connus (`requiresSpell`) si `knownSpells` est donné ; `[NO_STANCE]` si
 * la classe n'en a pas.
 */
export function stancesOf(breedId: number, knownSpells?: readonly number[]): readonly ClassStance[] {
  const list = STANCES[breedId]
  if (!list?.length) return [NO_STANCE]
  const known = knownSpells ? new Set(knownSpells) : undefined
  const out = known ? list.filter(s => !s.requiresSpell || s.requiresSpell.some(id => known.has(id))) : list
  return out.length ? out : [NO_STANCE]
}

/** Posture de début de combat (première posture `initial` disponible, sinon la première). */
export function initialStance(breedId: number, knownSpells?: readonly number[]): ClassStance {
  const list = stancesOf(breedId, knownSpells)
  return list.find(s => s.initial) ?? list[0]
}

export interface StanceChoice {
  stance: ClassStance
  value: number
  /** Toutes les postures évaluées (ordre de `STANCES`), postures de cycle comprises. */
  all: { stance: ClassStance; value: number }[]
}

export interface BestStanceOptions {
  /** Sorts connus du lanceur (filtre `requiresSpell`). */
  knownSpells?: readonly number[]
  /** Autoriser le choix d'une phase de cycle (`transient`). Défaut faux. */
  includeTransient?: boolean
}

/**
 * Meilleure posture d'une classe pour une évaluation donnée (ex. `states => sustainedDamage(table, withStates(a,
 * states), boss).steady`, DPT soutenu en régime établi). Départage : ordre de `STANCES` (posture initiale d'abord). Déterministe.
 */
export function bestStance(breedId: number, evaluate: (states: number[]) => number, opts: BestStanceOptions = {}): StanceChoice {
  const all = stancesOf(breedId, opts.knownSpells).map(stance => ({ stance, value: evaluate(stance.states.slice()) }))
  let best: { stance: ClassStance; value: number } | undefined
  for (const x of all) {
    if (x.stance.transient && !opts.includeTransient) continue
    if (!best || x.value > best.value) best = x
  }
  // Toutes les postures sont des phases de cycle (jamais le cas dans STANCES) : la première.
  best ??= all[0]
  return { stance: best.stance, value: best.value, all }
}
