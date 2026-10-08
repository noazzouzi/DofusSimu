/**
 * Theorycraft contre un boss — fiche déterministe d'un boss (docs/design/theorycraft.md §1.2) : statistiques du
 * grade, sort de départ appliqué analytiquement, profil offensif par phase, mécaniques détectées, avertissements et
 * hypothèses affichées.
 *
 * Étapes de `bossProfile` :
 *  1. Grade : imposé, sinon déduit du nombre de joueurs (`bossGradeFor`, défaut 4 joueurs ⇒ grade 1). Statistiques du
 *     grade et dérivées (tacle, esquive…) par `createMonsterFighter` (src/engine/factory.ts).
 *  2. SORT DE DÉPART (`grade.startingSpell`, 116 boss sur 162) : parcours de sa fermeture (sous-sorts lancés par le
 *     boss lui-même, profondeur ≤ 4). Effets INCONDITIONNELS sur soi (instantanés, sans retard, masque sans condition)
 *     appliqués aux statistiques effectives : buffs de caractéristiques (table du moteur `statBuffDef` : ±% rés
 *     1076/1077 et 210-219, % dommages finaux 1171/1172, ±% rés mêlée/distance 2803/2807…), « dommages subis ×N % »
 *     1163 (→ `spellResPct`/`weaponResPct` équivalents), PA/PM non esquivables 168/169. Effets RÉACTIFS sur soi
 *     (déclencheur `D` = tout dommage, `DM` = mêlée, `DR` = distance) : 1163 traduit en `meleeResPct`/`rangedResPct`
 *     équivalents (Merkator 3534 : ×50 sur `DR` ⇒ 50 % de résistance distance) ; les autres sont des mécaniques. Il
 *     n'existe pas de code de déclencheur « entrée en combat » (docs/research/effects.md §6) : le sort de départ est
 *     lui-même lancé à l'entrée en combat, ses effets instantanés en tiennent lieu. Un effet aléatoire (probabilité
 *     < 1) n'est pas inconditionnel. La valeur d'un 1163 est lue comme le moteur (`modifierMagnitude` : `value` quand
 *     les deux dés sont nuls). Buffs d'une « phase de départ »
 *     (sort dont un effet 406 retire les effets ailleurs, hors mort et hors remise à zéro) : non appliqués, signalés
 *     (Solar : +1000 esquive de l'Aurore ; Vortex : −100 PM de la phase invulnérable). États posés sur soi : drapeaux
 *     de spell-states (invulnérable, invulnérable mêlée / distance, indéplaçable…) ⇒ mécaniques ; une invulnérabilité
 *     à distance (Père Ver) rend les phases vulnérables « en mêlée » ; une invulnérabilité totale de départ est
 *     supposée levée (fenêtre de vulnérabilité, hypothèse affichée).
 *  3. SORTS (`monsterSpells(monsterId, grade)`) : dégâts moyens par lancer contre un joueur à 0 % de résistance
 *     (`expectedDamage`, `defenderIsPlayer: true`, critique pondéré par `critChance(critique du sort, critique du
 *     boss)`), par élément, en suivant les sous-sorts (le critique est hérité ; un sous-sort sans `criticalEffects`
 *     joue ses effets normaux). Familles de dégâts : `DAMAGE_SPECS` du moteur (src/engine/effects/damage/pipeline.ts).
 *  4. PHASES : « base » (aucun état) + une phase par clause d'états distincte des `statesCondition` des sorts, puis
 *     par état exigé du boss (`*E#`) dans les masques de ses lignes de dégâts (Croqueleur, El Piko), 6 au plus, les plus
 *     citées d'abord ; poids égaux ; une phase dont un état est invulnérable n'est pas vulnérable (Solar hors Nadir).
 *     Par phase : pic par tour (sac à dos sur les PA), soutenu (6 tours, relances tenues) et parts élémentaires ;
 *     `incomingShares` = moyenne pondérée des phases qui frappent. La fiche manuelle remplace les phases.
 *  5. Mécaniques (états posés et leurs drapeaux, invocations, érosion, retraits…), fiche manuelle, avertissements.
 *
 * Règles et hypothèses (affichées dans `assumptions` / `warnings`) :
 *  - Dégâts en % de PV (famille `hp`) : PV de référence d'un joueur `refHp` (défaut 4 000) ; boss supposé à mi-vie ;
 *    PV érodés supposés = 10 % des PV max. Ils vont dans `otherDamage` (drapeau `hp-based`, comme le demande le
 *    contrat) et, par élément, dans `hpDamageByElement` (extension de ce module) : en jeu les résistances de la cible
 *    s'y appliquent (sauf 671), comme aux dégâts fixes élémentaires (144, 1063-1066) rangés dans `damageByElement`.
 *  - TIRAGE ALÉATOIRE : comme le moteur (src/engine/effects/core.ts), un seul groupe aléatoire d'une liste d'effets
 *    est joué (groupe = `group || −order−1`, probabilité = poids du groupe / somme des poids) ; chaque ligne aléatoire
 *    compte pour sa probabilité (Fwetage : 5 éléments à 20 % ⇒ un seul élément en moyenne).
 *  - BRANCHES SELON LA CIBLE : les lignes (non aléatoires) dont le masque pose une condition sur la cible (classe
 *    `B#`, états `E#`/`e#`, paliers de PV `V#`/`v#`…) sont regroupées par condition ; les branches sont supposées
 *    exclusives (Trahison : une branche par classe ; paires `E#`/`e#`) et seule la plus forte est retenue (borne
 *    haute), les lignes sans condition s'y ajoutent.
 *  - Lignes DÉCLENCHÉES : un déclencheur périodique (`TB`/`TE` seuls : poisons, effets de début/fin de tour) compte
 *    ses dégâts × nombre de tours du buff (`triggerDuration`, sinon `duration` ; 0 ⇒ 1), sans critique, au plus
 *    `SUSTAINED_TURNS` (6) tours : une durée infinie ou « tout le combat » (63, docs/research/effects.md §2) compte 6.
 *    Tout autre déclencheur (réaction à une action du joueur : `D`, `DM`, `H`…) n'est PAS compté. Drapeau `triggered`.
 *  - Effets différés (`delay` > 0) : comptés au lancer (drapeau `delayed`). Zone qui exclut la case ciblée (anneau,
 *    croix sans centre…) : comptée (la cible voisine est touchée), drapeau `ring-excludes-target`.
 *  - Sous-sort lancé par un JOUEUR (792 & co. sur des ennemis : « la cible lance… ») : perspective inversée (ses
 *    alliés sont les joueurs), dégâts calculés avec les caractéristiques du boss — INCERTAIN.
 *  - Sous-sort lancé par un ALLIÉ du boss (invocation, arme, Auroraire du Vortex… : 792 sur `a`/`g` + `F#`) : ses
 *    dégâts ne sont PAS comptés (dégâts d'invocations hors périmètre v1, docs/design/theorycraft.md §5 ; ils sont
 *    positionnels et dépendent des caractéristiques de l'allié). Drapeau `summon`, détail dans `allyCasts`.
 *  - Conditions d'états du lanceur dans les masques (`*E#`/`*e#`) : évaluées avec les états de la phase quand le
 *    lanceur est le boss ; un autre lanceur est supposé sans état.
 *  - Famille `mp` (dommages × PM restants) : ×1 (PM non utilisés, borne haute).
 *  - Pic = borne haute (meilleure combinaison de sorts sur UNE cible, relances ignorées d'un tour à l'autre), pas l'IA.
 *  - Soutenu = sac à dos tour par tour pendant 6 tours, relances (`minCastInterval`) et relances initiales tenues.
 *
 * Module PUR : aucun import `node:`, rien de src/dungeons/vortex ni de src/dungeons/generic/dummy.
 */
import { ELEMENT_NAMES_FR, ELEMENT_RES_PCT, emptyStats, type Element, type Stats } from '../core/types'
import { critChance } from '../damage/crit'
import { expectedDamage, type DamageInput } from '../damage/damage'
import { midLifeMultiplier, type HpBasedSource } from '../damage/life'
import { statesConditionMet } from '../data/criteria'
import type { EffectData, SpellLevelData, StatesClause, ZoneSpec } from '../data/model'
import { effectSpellRef, effectStateRef, effectSummonRef } from '../data/refs'
import type { GameDataStore } from '../data/store'
import { statBuffDef, statLabel } from '../engine/effects/buffs/stats'
import { DAMAGE_SPECS, modifierMagnitude, resolveElement, type DamageSpec } from '../engine/effects/damage/pipeline'
import { createMonsterFighter } from '../engine/factory'
import { cellToPoint, pointToCell } from '../map/geometry'
import { isCellInZone } from '../map/zones'
import { bossGradeFor } from './bosses'
import type {
  BossMechanic,
  BossOverrides,
  BossPhaseProfile,
  BossProfile,
  BossSpellFlag,
  BossSpellProfile,
  MechanicKind,
  PerElement,
  UtilityTag,
} from './types'

// ---------------------------------------------------------------------------------------------------------------------
// Constantes et types publics
// ---------------------------------------------------------------------------------------------------------------------

/** PV de référence d'un joueur pour les dégâts en % de PV (hypothèse affichée). */
export const DEFAULT_REF_HP = 4000
/** Nombre de joueurs par défaut (⇒ grade 1). */
export const DEFAULT_PLAYERS = 4
/** Nombre maximal de phases d'états (en plus de la phase « base »). */
export const MAX_STATE_PHASES = 6
/** Horizon de la simulation du soutenu (tours). */
export const SUSTAINED_TURNS = 6
/** Extraction des données DofusDB utilisées (data/dofusdb/manifest.json `fetchedAt`) et version du jeu. */
export const DATA_SNAPSHOT = { date: '2026-10-04', patch: '3.6' } as const

/** Profondeur maximale de sous-sorts suivis (sort de départ et sorts du boss). */
const MAX_DEPTH = 4
/** `effectTriggerDuration` d'un effet déclenché qui écoute « tout le combat » (docs/research/effects.md §2). */
const WHOLE_FIGHT = 63
/** Part des PV du boss supposée restante (« mi-vie ») pour les dégâts en % de ses PV. */
const BOSS_HP_SHARE = 0.5
/** PV érodés supposés, en part des PV max (cible ou lanceur). */
const ERODED_SHARE = 0.1

export interface BossProfileOptions {
  /** Grade imposé (sinon déduit de `players`, qui est alors ignoré). */
  grade?: number
  /** Nombre de joueurs (défaut 4) : grade = `bossGradeFor(players, nombre de grades)`. */
  players?: number
  /** Fiche manuelle (data/bosses/<monsterId>.json). */
  overrides?: BossOverrides
  /** PV de référence d'un joueur pour les dégâts en % de PV (défaut 4 000). */
  refHp?: number
}

/** Détail d'un sort du boss (extension de `BossSpellProfile`, mêmes champs plus le détail utile à l'affichage). */
export interface BossSpellDetail extends BossSpellProfile {
  /** Portée maximale (≤ 1 : sort de mêlée). */
  range: number
  /** Relance initiale (tours) : le sort n'est lançable qu'à partir du tour `initialCooldown + 1`. */
  initialCooldown: number
  /** Condition d'états complète du lanceur (forme disjonctive), absente si le sort est toujours lançable. */
  statesCondition?: StatesClause[]
  /**
   * Part de `otherDamage` attribuable à un élément (dégâts en % de PV élémentaires), par lancer. En jeu, les
   * résistances de la cible s'y appliquent (moteur : `computeUnboosted`) : un consommateur qui applique des résistances
   * doit lire ce champ plutôt que `otherDamage` seul. Le reste de `otherDamage` ignore les résistances (671).
   */
  hpDamageByElement: PerElement
  /** Monstres invoqués par le sort (ids). */
  summons: number[]
  /** Effets de dégâts non gérés rencontrés (1124-1128, 1131-1140, 1225, 1228), ignorés dans les dégâts. */
  unhandledEffects: number[]
  /**
   * Sous-sorts à dégâts lancés par un ALLIÉ du boss (« la cible lance… » sur une invocation, une arme…) : dégâts NON
   * comptés. `monsterIds` : monstres exécutants désignés par le masque (`F#`), vide s'ils ne sont pas identifiés.
   */
  allyCasts: { spellId: number; monsterIds: number[] }[]
  /** Approximations du calcul des dégâts de ce sort (voir `DamageApproximation`). */
  approximations: DamageApproximation[]
}

/**
 * Approximations du calcul des dégâts d'un sort : `random` = lignes aléatoires pondérées par leur probabilité (un seul
 * groupe joué) ; `target-branches` = branches exclusives selon la cible (classe, états, PV), la plus forte retenue.
 */
export type DamageApproximation = 'random' | 'target-branches'

/** Fiche du boss (extension de `BossProfile`). `castsPerTurn`/`castsPerTarget` des sorts : 0 = illimité (données). */
export interface BossProfileDetail extends BossProfile {
  spells: BossSpellDetail[]
  /** PV de référence d'un joueur utilisés pour les dégâts en % de PV. */
  refHp: number
  /** Sort de départ du grade, s'il existe. */
  startingSpell?: { spellId: number; grade: number; name: string }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables d'effets
// ---------------------------------------------------------------------------------------------------------------------

/** « La cible lance le sous-sort » (792, 793, 2792-2795) ou « la cible le lance sur la source » (1017, 2017). */
const TARGET_EXEC_CASTS: ReadonlySet<number> = new Set([792, 793, 2792, 2793, 2794, 2795, 1017, 2017])
/** Le lanceur de l'effet (ou la source, = lanceur pour un effet instantané) lance le sous-sort : 1160, 2160, 2960, 1018, 1019. */
const CASTER_EXEC_CASTS: ReadonlySet<number> = new Set([1160, 2160, 2960, 1018, 1019])
const CAST_EFFECTS: ReadonlySet<number> = new Set([...TARGET_EXEC_CASTS, ...CASTER_EXEC_CASTS])
/** Pièges, glyphes, glyphes-auras, runes : le sort de la marque n'est pas suivi (dégâts positionnels). */
const MARK_EFFECTS: ReadonlySet<number> = new Set([400, 401, 402, 1091, 1165, 2022])
/** Invocations sans monstre référencé par `effectSummonRef` : double du lanceur, résurrection, illusions. */
const OTHER_SUMMON_EFFECTS: ReadonlySet<number> = new Set([180, 780, 1097])
/** Effets de dégâts présents dans les sorts de monstres mais absents de DAMAGE_SPECS (comptés à 0, signalés). */
const UNHANDLED_DAMAGE: ReadonlyMap<number, string> = new Map([
  ...[1124, 1125, 1126, 1127, 1128].map(id => [id, '% des dommages initiaux subis'] as const),
  ...[1131, 1132, 1133, 1134, 1135].map(id => [id, 'dommages par PA utilisé'] as const),
  ...[1136, 1137, 1138, 1139, 1140].map(id => [id, 'dommages par PM utilisé'] as const),
  ...[1225, 1228].map(id => [id, '% des dommages finaux subis'] as const),
])
/** Buffs de caractéristiques à montant non fixe (vitalité en % des PV, % de la valeur courante) : non appliqués. */
const NON_FLAT_STAT_EFFECTS: ReadonlySet<number> = new Set([1078, 1033, 2844, 2845, 2847, 2849, 2851, 2853, 2857])
const AP_MP_REMOVAL: ReadonlySet<number> = new Set([77, 84, 101, 127, 168, 169, 1079, 1080])
const RANGE_REMOVAL: ReadonlySet<number> = new Set([116, 320])
const HEALS: ReadonlySet<number> = new Set([90, 108, 1109, 2020, 2973, 2998, 2999, 3000, 3002])
const SHIELDS: ReadonlySet<number> = new Set([1020, 1039, 1040])
const REFLECTS: ReadonlySet<number> = new Set([107, 220, 1123, 1223])
const EROSION = 776

/** Libellés des déclencheurs pour les résumés de mécaniques (docs/research/effects.md §6). */
const TRIGGER_LABELS: Record<string, string> = {
  D: 'dommages subis',
  DM: 'coup en mêlée',
  DR: 'coup à distance',
  DS: 'dommages de sort',
  DCAC: "dommages d'arme",
  PD: 'dommages de poussée',
  PMD: 'dommages de poussée',
  PPD: 'dommages de poussée',
  TB: 'début de tour',
  TE: 'fin de tour',
  X: 'mort',
  MPA: 'perte de PM',
  APA: 'perte de PA',
  H: 'soin reçu',
  M: 'déplacement',
  P: 'poussée',
  DA: 'dommages Air',
  DE: 'dommages Terre',
  DF: 'dommages Feu',
  DW: 'dommages Eau',
  DN: 'dommages Neutre',
  DBA: "dommages d'un allié",
  DBE: "dommages d'un ennemi",
  DTB: 'dommages de poison',
  DTE: 'dommages de poison',
  DV: 'dommages de poison',
  CD: 'dommages infligés',
  CDS: 'dommages de sort infligés',
  CMPARR: 'PM utilisé',
  CCMPARR: 'PM utilisé',
  V: 'PV modifiés',
  K: 'tue une cible',
}

// ---------------------------------------------------------------------------------------------------------------------
// Masques de cibles (sous-ensemble de src/engine/targetMask.ts utile à l'analyse hors combat)
// ---------------------------------------------------------------------------------------------------------------------

interface MaskInfo {
  /** Lettres d'inclusion (a, A, c, C, g, h, H, l, L…). */
  inc: string
  /** Aucune lettre d'inclusion : toutes les entités de la zone. */
  all: boolean
  /** F# : la cible doit être l'un de ces monstres ; f# : ne doit pas l'être. */
  monsterIs: number[]
  monsterNot: number[]
  /** *E# / *e# : états exigés / interdits sur le LANCEUR. */
  casterHas: number[]
  casterNot: number[]
  /** *F# / *f# : le lanceur est / n'est pas ce monstre. */
  casterIs: number[]
  casterIsNot: number[]
  /** Autre condition (état de la cible, PV, entité qui vient d'apparaître…) : effet conditionnel. */
  otherConds: boolean
  /** Conditions portant sur la CIBLE (`B#`, `E#`, `e#`, `V#`…), triées : signature de branche ('' si aucune). */
  targetConds: string
}

const INCLUSION = /^[aAcCghHlLdDmMiIjJsSx]$/
const maskCache = new Map<string, MaskInfo>()

function maskInfo(mask: string): MaskInfo {
  let mi = maskCache.get(mask)
  if (mi) return mi
  mi = { inc: '', all: true, monsterIs: [], monsterNot: [], casterHas: [], casterNot: [], casterIs: [], casterIsNot: [], otherConds: false, targetConds: '' }
  const targetConds: string[] = []
  for (const raw of mask ? mask.split(',') : []) {
    const t = raw.trim()
    if (!t) continue
    if (INCLUSION.test(t)) {
      mi.inc += t
      mi.all = false
      continue
    }
    const m = /^(\*?)([EeFf])(\d+)$/.exec(t)
    if (m) {
      const id = Number(m[3])
      const onCaster = m[1] === '*'
      switch (m[2]) {
        case 'E':
          if (onCaster) mi.casterHas.push(id)
          else targetConds.push(t) // état exigé sur la cible
          break
        case 'e':
          if (onCaster) mi.casterNot.push(id)
          else targetConds.push(t) // état interdit sur la cible
          break
        case 'F':
          ;(onCaster ? mi.casterIs : mi.monsterIs).push(id)
          break
        default:
          ;(onCaster ? mi.casterIsNot : mi.monsterNot).push(id)
      }
      continue
    }
    // *h, *l… (type du lanceur) : supposé vrai ; Sce/Atq/Def : sans effet (comme le moteur) ; le reste conditionne.
    if (/^\*[a-zA-Z]$/.test(t) || t === 'Sce' || t === 'Atq' || t === 'Def') continue
    if (t[0] === '*') mi.otherConds = true // autre condition sur le lanceur (PV…)
    else targetConds.push(t)
  }
  if (targetConds.length) mi.otherConds = true
  mi.targetConds = targetConds.sort().join(',')
  maskCache.set(mask, mi)
  return mi
}

const has = (inc: string, letters: string): boolean => {
  for (const ch of inc) if (letters.includes(ch)) return true
  return false
}

/** L'effet touche-t-il des joueurs ? `flipped` : le lanceur du (sous-)sort est un joueur (alliés = joueurs). */
function hitsPlayers(mi: MaskInfo, flipped: boolean): boolean {
  if (mi.monsterIs.length) return false
  if (mi.all) return true
  return flipped ? has(mi.inc, 'aghlcC') : has(mi.inc, 'AHL')
}

/** L'effet vise-t-il le camp du boss (lui ou ses alliés) ? */
function hitsBossSide(mi: MaskInfo, flipped: boolean, bossId: number): boolean {
  if (mi.monsterIs.length && !mi.monsterIs.includes(bossId)) return false
  if (mi.all) return true
  return flipped ? has(mi.inc, 'AM') : has(mi.inc, 'acCgm')
}

/**
 * L'effet peut-il viser le boss LUI-MÊME ? Lanceur = boss : c, C, a ; lanceur = un joueur (perspective inversée) :
 * A, M ; lanceur = un allié du boss (ex. l'Auroraire) : a seulement (c/C désignent alors cet allié).
 */
function hitsBossItself(mi: MaskInfo, flipped: boolean, executorIsBoss: boolean, bossId: number): boolean {
  if (mi.monsterIs.length && !mi.monsterIs.includes(bossId)) return false
  if (mi.monsterNot.includes(bossId)) return false
  if (mi.all) return true
  return flipped ? has(mi.inc, 'AM') : has(mi.inc, executorIsBoss ? 'cCa' : 'a')
}

/**
 * Lanceur d'un sous-sort « lancé par la cible » : un adversaire (perspective inversée), le boss, ou un allié du boss
 * (`flipped` et `executorIsBoss` faux : invocation, arme, Auroraire… — ses dégâts ne sont pas comptés).
 */
function subExecutor(mi: MaskInfo, flipped: boolean, executorIsBoss: boolean, bossId: number): { flipped: boolean; executorIsBoss: boolean } {
  if (enemyOnly(mi)) return { flipped: !flipped, executorIsBoss: false }
  return { flipped, executorIsBoss: executorIsBoss && !flipped && selectsSelf(mi, bossId) && !has(mi.inc, 'gA') }
}

/** L'effet vise-t-il le boss lui-même (c, C, a ; identité F# compatible) ? Perspective du boss. */
function selectsSelf(mi: MaskInfo, bossId: number): boolean {
  if (mi.monsterIs.length && !mi.monsterIs.includes(bossId)) return false
  if (mi.monsterNot.includes(bossId)) return false
  return mi.all || has(mi.inc, 'cCa')
}

/** Masque qui ne sélectionne que des ennemis du lanceur (le sous-sort « lancé par la cible » l'est par un adversaire). */
function enemyOnly(mi: MaskInfo): boolean {
  if (mi.all) return false
  for (const ch of mi.inc) if (!'AHLDMIJS'.includes(ch)) return false
  return true
}

/** Conditions d'identité du lanceur (`*F#`, `*f#`) quand le lanceur est le boss. */
function casterIsBossOk(mi: MaskInfo, bossId: number): boolean {
  return !(mi.casterIs.length && !mi.casterIs.includes(bossId)) && !mi.casterIsNot.includes(bossId)
}

/** Conditions sur le lanceur (`*E#`, `*e#`, `*F#`, `*f#`) : états connus seulement si le lanceur est le boss. */
function casterCondOk(mi: MaskInfo, states: readonly number[], executorIsBoss: boolean, bossId: number): boolean {
  const s = executorIsBoss ? states : []
  for (const id of mi.casterHas) if (!s.includes(id)) return false
  for (const id of mi.casterNot) if (s.includes(id)) return false
  return !executorIsBoss || casterIsBossOk(mi, bossId)
}

const isInstant = (e: EffectData): boolean => !e.triggers || e.triggers === 'I'

/** Codes de déclencheur sans le préfixe X (« vaut aussi si l'événement tue le porteur »). */
function triggerCodes(triggers: string): string[] {
  const codes = triggers
    .split('|')
    .map(c => c.trim())
    .map(c => (c.length > 1 && c[0] === 'X' ? c.slice(1) : c))
  return [...new Set(codes.filter(Boolean))]
}

/** Déclencheur périodique : uniquement début / fin de tour du porteur (poisons). */
function isPeriodic(triggers: string): boolean {
  return triggerCodes(triggers).every(c => c === 'TB' || c === 'TE')
}

/**
 * Nombre de déclenchements comptés pour un buff périodique (moteur : `triggerDuration ?? duration`, 0 ⇒ 1 tour), borné
 * à l'horizon du soutenu (`SUSTAINED_TURNS`) : une durée infinie (< 0) ou « tout le combat » (≥ 63) compte 6 tours,
 * jamais 63 (Corruption, Guerre).
 */
function periodicTicks(e: EffectData): number {
  const turns = e.triggerDuration ?? e.duration
  if (turns < 0 || turns >= WHOLE_FIGHT) return SUSTAINED_TURNS
  return Math.min(SUSTAINED_TURNS, Math.max(1, turns))
}

/**
 * Probabilité de chaque effet aléatoire d'une liste (règle du moteur, src/engine/effects/core.ts : un seul groupe tiré,
 * groupe = `group || −order−1`, probabilité ∝ somme des poids du groupe ; même calcul que src/ai/core/spellProfile.ts).
 * Un groupe aléatoire seul est donc toujours joué (probabilité 1).
 */
function randomProbabilities(effects: readonly EffectData[]): Map<EffectData, number> {
  const out = new Map<EffectData, number>()
  const weights = new Map<number, number>()
  const groupOf = (e: EffectData) => e.group || -e.order - 1
  for (const e of effects) if (e.random > 0) weights.set(groupOf(e), (weights.get(groupOf(e)) ?? 0) + e.random)
  if (!weights.size) return out
  const total = sum([...weights.values()])
  for (const e of effects) if (e.random > 0) out.set(e, total > 0 ? weights.get(groupOf(e))! / total : 0)
  return out
}

function triggerLabel(triggers: string): string {
  const label = (c: string): string => {
    if (TRIGGER_LABELS[c]) return TRIGGER_LABELS[c]
    const m = /^(EON|EOFF|TR)(\d+)$/.exec(c)
    if (!m) return c
    return m[1] === 'EON' ? `gain de l'état ${m[2]}` : m[1] === 'EOFF' ? `perte de l'état ${m[2]}` : `lancer du sort ${m[2]}`
  }
  return [...new Set(triggerCodes(triggers).map(label))].join(' ou ')
}

// ---------------------------------------------------------------------------------------------------------------------
// Zones : la case ciblée est-elle touchée ?
// ---------------------------------------------------------------------------------------------------------------------

const ZONE_CENTER = 300
const ZONE_CASTER = (() => {
  const p = cellToPoint(ZONE_CENTER)
  return pointToCell(p.x + 3, p.y)
})()
const ringCache = new WeakMap<ZoneSpec, boolean>()

/** Zone qui exclut la case ciblée (anneau C r,m≥1, croix sans centre…), lanceur à 3 cases en ligne. */
function ringExcludesTarget(zone: ZoneSpec): boolean {
  let r = ringCache.get(zone)
  if (r === undefined) {
    r = !isCellInZone(zone, ZONE_CENTER, ZONE_CENTER, ZONE_CASTER)
    ringCache.set(zone, r)
  }
  return r
}

// ---------------------------------------------------------------------------------------------------------------------
// Dégâts d'un sort
// ---------------------------------------------------------------------------------------------------------------------

const zero5 = (): PerElement => [0, 0, 0, 0, 0]

/** Sommes de dégâts d'une branche (par lancer). */
interface DamageSums {
  el: PerElement
  hpEl: PerElement
  hpOther: number
}

interface DamageAcc extends DamageSums {
  /** Ensembles descriptifs PARTAGÉS entre l'accumulateur d'un sort et ses branches (union, quelle que soit la branche). */
  flags: Set<BossSpellFlag>
  unhandled: Set<number>
  summons: Set<number>
  /** États exigés du boss (`*E#`) par des lignes de dégâts sur les joueurs : candidats de phase. */
  casterStates: Set<number>
  /** Sous-sorts à dégâts lancés par un allié du boss (non comptés) : sort → monstres exécutants (`F#`). */
  allyCasts: Map<number, Set<number>>
  approximations: Set<DamageApproximation>
}

interface WalkState {
  crit: boolean
  flipped: boolean
  executorIsBoss: boolean
  depth: number
  /** Multiplicateur des lignes périodiques (poisons) hérité des effets parents. */
  ticks: number
  /** Probabilité cumulée des tirages aléatoires des effets parents (et de la ligne courante). */
  weight: number
  periodic: boolean
  /** Sous un déclencheur non périodique : dégâts non comptés. */
  reactive: boolean
  delayed: boolean
  path: readonly SpellLevelData[]
}

const newAcc = (): DamageAcc => ({
  el: zero5(),
  hpEl: zero5(),
  hpOther: 0,
  flags: new Set(),
  unhandled: new Set(),
  summons: new Set(),
  casterStates: new Set(),
  allyCasts: new Map(),
  approximations: new Set(),
})
/** Accumulateur d'une branche : sommes propres, ensembles descriptifs partagés avec `acc`. */
const branchOf = (acc: DamageAcc): DamageAcc => ({ ...acc, el: zero5(), hpEl: zero5(), hpOther: 0 })
const sumsTotal = (d: DamageSums): number => sum(d.el) + sum(d.hpEl) + d.hpOther

function addSums(to: DamageSums, from: DamageSums): void {
  for (let i = 0; i < 5; i++) {
    to.el[i] += from.el[i]
    to.hpEl[i] += from.hpEl[i]
  }
  to.hpOther += from.hpOther
}

/** Contexte de calcul des dégâts d'un boss (caractéristiques effectives, PV de référence). */
interface DamageContext {
  data: GameDataStore
  bossId: number
  attacker: Stats
  /** Entrée DoMath réutilisée (cible : joueur à 0 % de résistance). */
  input: DamageInput
  /** PV de référence par source (`hp` du boss ou d'un joueur selon le lanceur). */
  bossRefs: Record<HpBasedSource, number>
  playerRefs: Record<HpBasedSource, number>
}

function hpRefs(maxHp: number, targetHp: number): Record<HpBasedSource, number> {
  return {
    casterLife: maxHp * BOSS_HP_SHARE,
    casterMissingLife: maxHp * (1 - BOSS_HP_SHARE),
    casterMidLife: maxHp * midLifeMultiplier(maxHp * BOSS_HP_SHARE, maxHp),
    casterErodedLife: maxHp * ERODED_SHARE,
    targetLife: targetHp,
    targetErodedLife: targetHp * ERODED_SHARE,
    lifeLoss: targetHp,
  }
}

/** Moyenne d'un jet [diceNum, diceSide] (diceSide 0 = valeur fixe). */
const meanRoll = (e: EffectData): number => (e.diceNum + Math.max(e.diceSide, e.diceNum)) / 2

function addDamage(ctx: DamageContext, spec: DamageSpec, e: EffectData, ws: WalkState, isMelee: boolean, acc: DamageSums): void {
  const k = ws.ticks * ws.weight
  if (spec.family === 'hp') {
    // Source « cible » : un joueur (refHp) ; source « lanceur » : le boss, ou un joueur si la perspective est inversée.
    const refs = ws.flipped ? ctx.playerRefs : ctx.bossRefs
    const v = (meanRoll(e) / 100) * refs[spec.hpSource ?? 'casterLife'] * k
    if (spec.element >= 0 && spec.element <= 4 && !spec.ignoresRes) acc.hpEl[spec.element] += v
    else acc.hpOther += v
    return
  }
  const resolved = resolveElement(spec.element, ctx.attacker)
  if (resolved < 0) return
  const el = resolved as Element
  if (spec.family === 'fixed') {
    acc.el[el] += meanRoll(e) * k
    return
  }
  const input = ctx.input
  input.element = el
  input.crit = ws.crit && !ws.periodic
  input.isMelee = isMelee
  acc.el[el] += expectedDamage(input, null, { min: e.diceNum, max: Math.max(e.diceSide, e.diceNum) }, 0) * k
}

/** La fermeture d'un niveau de sort contient-elle une ligne de dégâts (gérée ou non) ? */
const damageClosureCache = new WeakMap<SpellLevelData, boolean>()
function closureHasDamage(data: GameDataStore, level: SpellLevelData, depth = 0): boolean {
  const known = damageClosureCache.get(level)
  if (known !== undefined) return known
  damageClosureCache.set(level, false) // garde contre les cycles
  let found = false
  for (const e of level.effects) {
    if (DAMAGE_SPECS.has(e.effectId) || UNHANDLED_DAMAGE.has(e.effectId)) found = true
    else if (CAST_EFFECTS.has(e.effectId) && depth < MAX_DEPTH) {
      const ref = effectSpellRef(e)
      const sub = ref && data.spellLevel(ref.spellId, { grade: ref.grade })
      if (sub && closureHasDamage(data, sub, depth + 1)) found = true
    }
    if (found) break
  }
  damageClosureCache.set(level, found)
  return found
}

/**
 * Dégâts d'une liste d'effets sur un joueur, ajoutés à `acc`. Lignes aléatoires pondérées par leur probabilité ;
 * lignes conditionnées par la cible regroupées par condition, seule la branche la plus forte est ajoutée.
 */
function walkDamage(ctx: DamageContext, effects: readonly EffectData[], ws: WalkState, states: readonly number[], isMelee: boolean, acc: DamageAcc): void {
  const probs = randomProbabilities(effects)
  let branches: Map<string, DamageAcc> | undefined
  for (const e of effects) {
    if (e.clientOnly) continue
    const mi = maskInfo(e.targetMask)
    if (ws.executorIsBoss && mi.casterHas.length && DAMAGE_SPECS.has(e.effectId) && hitsPlayers(mi, ws.flipped))
      for (const st of mi.casterHas) acc.casterStates.add(st)
    if (!casterCondOk(mi, states, ws.executorIsBoss, ctx.bossId)) continue
    const p = e.random > 0 ? (probs.get(e) ?? 0) : 1
    if (p <= 0) continue
    // Ligne (non aléatoire) conditionnée par la cible : rangée dans la branche de sa condition.
    let out = acc
    if (mi.targetConds && e.random <= 0) {
      branches ??= new Map()
      out = branches.get(mi.targetConds) ?? branchOf(acc)
      branches.set(mi.targetConds, out)
    }
    let { ticks, periodic, reactive } = ws
    if (!isInstant(e)) {
      if (isPeriodic(e.triggers)) {
        ticks *= periodicTicks(e)
        periodic = true
      } else reactive = true
    }
    const weight = ws.weight * p
    const delayed = ws.delayed || e.delay > 0
    const spec = DAMAGE_SPECS.get(e.effectId)
    if (spec) {
      if (!hitsPlayers(mi, ws.flipped)) continue
      if (periodic || reactive) acc.flags.add('triggered')
      if (reactive) continue
      if (p < 1) acc.approximations.add('random')
      if (delayed) acc.flags.add('delayed')
      if (ringExcludesTarget(e.zone)) acc.flags.add('ring-excludes-target')
      if (spec.family === 'hp') acc.flags.add('hp-based')
      addDamage(ctx, spec, e, { ...ws, ticks, periodic, weight }, isMelee, out)
      continue
    }
    if (UNHANDLED_DAMAGE.has(e.effectId)) {
      if (hitsPlayers(mi, ws.flipped)) acc.unhandled.add(e.effectId)
      continue
    }
    if (MARK_EFFECTS.has(e.effectId)) {
      acc.flags.add('mark')
      continue
    }
    const summon = effectSummonRef(e)
    if (summon || OTHER_SUMMON_EFFECTS.has(e.effectId)) {
      acc.flags.add('summon')
      if (summon) acc.summons.add(summon.monsterId)
      continue
    }
    const target = TARGET_EXEC_CASTS.has(e.effectId)
    if (!target && !CASTER_EXEC_CASTS.has(e.effectId)) continue
    if (ws.depth >= MAX_DEPTH) continue
    const ref = effectSpellRef(e)
    const sub = ref && ctx.data.spellLevel(ref.spellId, { grade: ref.grade })
    if (!sub || ws.path.includes(sub)) continue
    acc.flags.add('sub-spell')
    const { flipped, executorIsBoss } = target ? subExecutor(mi, ws.flipped, ws.executorIsBoss, ctx.bossId) : ws
    if (!flipped && !executorIsBoss) {
      // Lancé par un allié du boss (invocation, arme…) : hors périmètre, non compté (docs/design/theorycraft.md §5).
      if (closureHasDamage(ctx.data, sub)) {
        acc.flags.add('summon')
        let ids = acc.allyCasts.get(sub.spellId)
        if (!ids) acc.allyCasts.set(sub.spellId, (ids = new Set()))
        for (const id of mi.monsterIs) ids.add(id)
      }
      continue
    }
    if (p < 1 && closureHasDamage(ctx.data, sub)) acc.approximations.add('random')
    const subCrit = ws.crit && sub.criticalEffects.length > 0
    walkDamage(
      ctx,
      subCrit ? sub.criticalEffects : sub.effects,
      { crit: subCrit, flipped, executorIsBoss, depth: ws.depth + 1, ticks, weight, periodic, reactive, delayed, path: [...ws.path, sub] },
      states,
      isMelee,
      out,
    )
  }
  if (!branches) return
  // Branches exclusives selon la cible : la plus forte (borne haute), ordre des données en cas d'égalité.
  let best: DamageAcc | undefined
  let hitting = 0
  for (const b of branches.values()) {
    const t = sumsTotal(b)
    if (t > 0) hitting++
    if (!best || t > sumsTotal(best)) best = b
  }
  if (hitting > 1) acc.approximations.add('target-branches')
  if (best) addSums(acc, best)
}

interface SpellDamage extends DamageSums {
  total: number
  flags: Set<BossSpellFlag>
  unhandled: number[]
  summons: number[]
  casterStates: number[]
  allyCasts: { spellId: number; monsterIds: number[] }[]
  approximations: DamageApproximation[]
}

/** Dégâts moyens d'un lancer (critique pondéré) pour un ensemble d'états du boss. */
function spellDamage(ctx: DamageContext, level: SpellLevelData, states: readonly number[]): SpellDamage {
  const isMelee = level.range <= 1
  const root: WalkState = {
    crit: false,
    flipped: false,
    executorIsBoss: true,
    depth: 0,
    ticks: 1,
    weight: 1,
    periodic: false,
    reactive: false,
    delayed: false,
    path: [level],
  }
  const normal = newAcc()
  walkDamage(ctx, level.effects, root, states, isMelee, normal)
  const p = level.criticalEffects.length ? critChance(level.critChance, ctx.attacker.critical) / 100 : 0
  let el = normal.el
  let hpEl = normal.hpEl
  let hpOther = normal.hpOther
  if (p > 0) {
    const crit = branchOf(normal)
    walkDamage(ctx, level.criticalEffects, { ...root, crit: true }, states, isMelee, crit)
    const mix = (a: number, b: number) => a * (1 - p) + b * p
    el = el.map((v, i) => mix(v, crit.el[i])) as PerElement
    hpEl = hpEl.map((v, i) => mix(v, crit.hpEl[i])) as PerElement
    hpOther = mix(hpOther, crit.hpOther)
  }
  const total = sum(el) + sum(hpEl) + hpOther
  return {
    el,
    hpEl,
    hpOther,
    total,
    flags: normal.flags,
    unhandled: [...normal.unhandled].sort((a, b) => a - b),
    summons: [...normal.summons],
    casterStates: [...normal.casterStates].sort((a, b) => a - b),
    allyCasts: [...normal.allyCasts].map(([spellId, ids]) => ({ spellId, monsterIds: [...ids].sort((a, b) => a - b) })),
    approximations: APPROX_ORDER.filter(a => normal.approximations.has(a)),
  }
}

const APPROX_ORDER: readonly DamageApproximation[] = ['random', 'target-branches']
const sum = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0)

// ---------------------------------------------------------------------------------------------------------------------
// Sac à dos sur les PA
// ---------------------------------------------------------------------------------------------------------------------

interface KnapItem {
  value: number
  cost: number
  max: number
}

/** Sac à dos borné (chaque lancer est un objet 0/1) : nombre de lancers de chaque sort maximisant la valeur. */
function knapsack(items: readonly KnapItem[], ap: number): number[] {
  const cap = Math.max(0, Math.floor(ap))
  const n = items.length
  let dp = new Float64Array(cap + 1)
  const choice: Int16Array[] = []
  for (let i = 0; i < n; i++) {
    const it = items[i]
    const next = new Float64Array(cap + 1)
    const ch = new Int16Array(cap + 1)
    for (let a = 0; a <= cap; a++) {
      let best = dp[a]
      let bestK = 0
      for (let k = 1; k <= it.max && k * it.cost <= a; k++) {
        const v = dp[a - k * it.cost] + k * it.value
        if (v > best + 1e-9) {
          best = v
          bestK = k
        }
      }
      next[a] = best
      ch[a] = bestK
    }
    dp = next
    choice.push(ch)
  }
  const counts = new Array<number>(n).fill(0)
  let a = cap
  for (let i = n - 1; i >= 0; i--) {
    const k = choice[i][a]
    counts[i] = k
    a -= k * items[i].cost
  }
  return counts
}

/** Lancers maximum par tour sur une cible : limites du sort, une seule fois si le sort a une relance. */
function maxCasts(level: SpellLevelData, ap: number): number {
  let n = Math.min(level.maxCastPerTurn || Infinity, level.maxCastPerTarget || Infinity)
  if (level.minCastInterval > 0) n = Math.min(n, 1)
  if (level.apCost > 0) n = Math.min(n, Math.floor(ap / level.apCost))
  else if (!Number.isFinite(n)) n = 1 // sort à 0 PA sans limite : un lancer
  return Math.max(0, n)
}

// ---------------------------------------------------------------------------------------------------------------------
// Sort de départ
// ---------------------------------------------------------------------------------------------------------------------

interface StartAnalysis {
  /** Facteurs « dommages subis » (1163) : tous, mêlée, distance, sorts, armes. */
  factors: { all: number; melee: number; range: number; spell: number; weapon: number }
  /** Buffs de caractéristiques appliqués (inconditionnels). */
  applied: { stat: keyof Stats; value: number; effectId: number }[]
  apLoss: number
  mpLoss: number
  /** États posés sur soi sans condition (permanent : durée infinie). */
  selfStates: { stateId: number; permanent: boolean }[]
  mechanics: BossMechanic[]
}

interface StartWalk {
  trigger?: string
  conditional: boolean
  depth: number
  path: readonly SpellLevelData[]
}

const RES_STATS: ReadonlySet<keyof Stats> = new Set(['allResPct', 'neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct'])

function signed(v: number): string {
  const r = Math.round(v * 10) / 10
  return r >= 0 ? `+${r}` : `${r}`
}

/**
 * Portée d'un « dommages subis ×N % » (1163) selon son déclencheur : aucun ou `D` (tout dommage hors poussée, avec ou
 * sans les variantes poison `DTB`/`DTE`/`DV`) ⇒ tous les coups ; `DM` / `DR` ⇒ mêlée / distance (`DM|DR` ⇒ tous) ;
 * `DS` / `DCAC` ⇒ sorts / armes ; autre ⇒ non traduisible en caractéristique (mécanique seulement).
 */
function damageTakenScope(trigger: string | undefined): keyof StartAnalysis['factors'] | undefined {
  if (!trigger) return 'all'
  const codes = triggerCodes(trigger)
  if (codes.includes('D') && codes.every(c => c === 'D' || c === 'DTB' || c === 'DTE' || c === 'DV')) return 'all'
  if (codes.length === 2 && codes.includes('DM') && codes.includes('DR')) return 'all'
  if (codes.length !== 1) return undefined
  return ({ DM: 'melee', DR: 'range', DS: 'spell', DCAC: 'weapon' } as const)[codes[0] as 'DM' | 'DR' | 'DS' | 'DCAC']
}

/**
 * Sort de départ : effets inconditionnels appliqués, effets réactifs traduits, mécaniques. `removedSpells` : sorts dont
 * un effet 406 (« enlève les effets du sort ») retire les buffs ailleurs dans les sorts du boss — leurs buffs de
 * caractéristiques sont TRANSITOIRES (phase de départ, ex. Aurore de Solar : +1000 esquive ; phase 1 du Vortex :
 * −100 PM) et ne sont pas appliqués, seulement signalés. Les états posés restent comptés (Père Ver : « Invulnérable à
 * distance » est retiré puis reposé par le même sort).
 */
function analyzeStartingSpell(data: GameDataStore, bossId: number, level: SpellLevelData | undefined, removedSpells: ReadonlySet<number>): StartAnalysis {
  const out: StartAnalysis = { factors: { all: 1, melee: 1, range: 1, spell: 1, weapon: 1 }, applied: [], apLoss: 0, mpLoss: 0, selfStates: [], mechanics: [] }
  if (!level) return out
  const spellId = level.spellId
  const seen = new Set<string>()
  const mech = (kind: MechanicKind, summary: string, counters?: UtilityTag[], punishes?: UtilityTag[]) => {
    if (seen.has(summary)) return
    seen.add(summary)
    out.mechanics.push({ kind, summary, source: 'data', spellId, ...(counters ? { counters } : {}), ...(punishes ? { punishes } : {}) })
  }
  const variations = new Map<
    MechanicKind,
    { labels: Set<string>; min: number; max: number; triggers: Set<string>; conditional: boolean; transient: boolean; counters?: UtilityTag[] }
  >()
  const walk = (lvl: SpellLevelData, w: StartWalk) => {
    const probs = randomProbabilities(lvl.effects)
    for (const e of lvl.effects) {
      if (e.clientOnly) continue
      const mi = maskInfo(e.targetMask)
      const own = isInstant(e) ? undefined : e.triggers
      const chained = !!(own && w.trigger)
      const trigger = own ?? w.trigger
      // Tirage aléatoire perdu possible (probabilité < 1) : l'effet n'est pas acquis.
      const random = e.random > 0 && (probs.get(e) ?? 0) < 1
      const conditional =
        w.conditional || chained || random || e.delay > 0 || mi.otherConds || mi.casterHas.length > 0 || mi.casterNot.length > 0
      const self = selectsSelf(mi, bossId) && casterIsBossOk(mi, bossId)
      const transient = w.path.some(l => removedSpells.has(l.spellId))
      if (self && e.effectId === 1163) {
        const pct = modifierMagnitude(e)
        const key = damageTakenScope(trigger)
        const qual = [trigger ? `sur ${triggerLabel(trigger)}` : '', conditional ? 'sous condition' : '', transient ? 'phase de départ, retiré ensuite' : '']
          .filter(Boolean)
          .join(' ; ')
        const q = qual ? ` (${qual})` : ' (permanent)'
        if (!conditional && !transient && key) {
          out.factors[key] *= pct / 100
          const eq = `équivaut à ${100 - pct} % de résistance`
          if (key === 'range' && pct < 100) mech('reduced-range', `Dommages subis à distance ×${pct} %${q} : ${eq} distance.`, ['melee'], ['range'])
          else if (key === 'melee' && pct < 100) mech('reduced-melee', `Dommages subis en mêlée ×${pct} %${q} : ${eq} mêlée.`, ['range'], ['melee'])
          else mech('damage-taken', `Dommages subis${key === 'all' ? '' : key === 'spell' ? ' (sorts)' : key === 'weapon' ? ' (armes)' : key === 'melee' ? ' en mêlée' : ' à distance'} ×${pct} %${q}.`)
        } else mech('damage-taken', `Dommages subis ×${pct} %${q}.`)
        continue
      }
      const def = statBuffDef(e.effectId)
      if (self && def?.stat && !NON_FLAT_STAT_EFFECTS.has(e.effectId)) {
        const value = def.sign * meanRoll(e)
        const label = statLabel(def.stat, e.effectId)
        if (!conditional && !trigger && !transient) out.applied.push({ stat: def.stat, value, effectId: e.effectId })
        const kind: MechanicKind = RES_STATS.has(def.stat)
          ? 'res-change'
          : def.stat === 'finalDamagePct'
            ? 'final-damage'
            : def.stat === 'rangedResPct' && value > 0
              ? 'reduced-range'
              : def.stat === 'meleeResPct' && value > 0
                ? 'reduced-melee'
                : 'other'
        // Autres caractéristiques : résumées une fois (« Sort de départ appliqué… ») si inconditionnelles, sinon tues.
        if (kind === 'other') continue
        const counters: UtilityTag[] | undefined = kind === 'reduced-range' ? ['melee'] : kind === 'reduced-melee' ? ['range'] : undefined
        if (!conditional && !trigger && !transient) mech(kind, `${signed(value)} ${label} (dès le début du combat).`, counters)
        else {
          // Variations conditionnelles, réactives ou de phase : une mécanique par type, valeurs en fourchette.
          let agg = variations.get(kind)
          if (!agg) variations.set(kind, (agg = { labels: new Set(), min: value, max: value, triggers: new Set(), conditional: false, transient: false, counters }))
          agg.labels.add(label)
          agg.min = Math.min(agg.min, value)
          agg.max = Math.max(agg.max, value)
          if (trigger) agg.triggers.add(triggerLabel(trigger))
          agg.conditional ||= conditional
          agg.transient ||= transient
        }
        continue
      }
      if (self && (e.effectId === 168 || e.effectId === 169) && !conditional && !trigger && !transient) {
        if (e.effectId === 168) out.apLoss += e.diceNum
        else out.mpLoss += e.diceNum
        continue
      }
      if (e.effectId === 950 && self && !conditional && !trigger) {
        const s = effectStateRef(e)
        if (s) out.selfStates.push({ stateId: s, permanent: e.duration < 0 })
        continue
      }
      // Réaction à une tentative de retrait de PM / PA (Merkator, Mer Veille : vol de vie sur l'auteur).
      if (own && !w.trigger && (TARGET_EXEC_CASTS.has(e.effectId) || CASTER_EXEC_CASTS.has(e.effectId))) {
        const codes = triggerCodes(own)
        const ref = effectSpellRef(e)
        const what = ref ? ` (« ${spellName(data, ref.spellId)} »)` : ''
        if (codes.includes('MPA')) mech('punished-removal', `Tenter de lui retirer des PM déclenche une riposte${what}.`, undefined, ['mp-removal'])
        if (codes.includes('APA')) mech('punished-removal', `Tenter de lui retirer des PA déclenche une riposte${what}.`, undefined, ['ap-removal'])
      }
      // Sous-sorts lancés par le boss lui-même (ou par lui parmi ses alliés).
      const casterExec = CASTER_EXEC_CASTS.has(e.effectId) && !(own && (e.effectId === 1018 || e.effectId === 1019))
      const selfExec = TARGET_EXEC_CASTS.has(e.effectId) && self
      if ((casterExec || selfExec) && w.depth < MAX_DEPTH) {
        const ref = effectSpellRef(e)
        const sub = ref && data.spellLevel(ref.spellId, { grade: ref.grade })
        if (!sub || w.path.includes(sub)) continue
        walk(sub, { trigger, conditional, depth: w.depth + 1, path: [...w.path, sub] })
      }
    }
  }
  walk(level, { conditional: false, depth: 0, path: [level] })
  for (const [kind, v] of variations) {
    const range = v.min === v.max ? signed(v.min) : `${signed(v.min)} à ${signed(v.max)}`
    const parts = [
      v.triggers.size ? `sur ${[...v.triggers].join(', ')}` : '',
      v.conditional ? 'sous condition' : '',
      v.transient ? 'phase de départ, retiré ensuite' : '',
    ].filter(Boolean)
    mech(kind, `${[...v.labels].join(', ')} : ${range}${parts.length ? ` (${parts.join(' ; ')})` : ''}.`, v.counters)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Mécaniques (fermeture du sort de départ et des sorts)
// ---------------------------------------------------------------------------------------------------------------------

interface MechanicScan {
  /** États posés : sur le boss lui-même / sur des joueurs, sort d'origine, posé par le sort de départ. */
  bossStates: Map<number, { spellId: number; fromStart: boolean }>
  playerStates: Map<number, { spellId: number }>
  /** Déclencheurs qui retirent / désactivent un état (951 / 952). */
  removals: Map<number, Set<string>>
  /** Sorts dont les effets sont retirés par un effet 406 (fin de phase). */
  removedSpells: Set<number>
  summons: Map<number, number>
  erosion: number
  apMpRemoval: Set<number>
  rangeRemoval: Set<number>
  heals: Set<number>
  shields: Set<number>
  reflects: Set<number>
  marks: Set<number>
}

function scanMechanics(data: GameDataStore, bossId: number, roots: { level: SpellLevelData; fromStart: boolean }[]): MechanicScan {
  const scan: MechanicScan = {
    bossStates: new Map(),
    playerStates: new Map(),
    removals: new Map(),
    removedSpells: new Set(),
    summons: new Map(),
    erosion: 0,
    apMpRemoval: new Set(),
    rangeRemoval: new Set(),
    heals: new Set(),
    shields: new Set(),
    reflects: new Set(),
    marks: new Set(),
  }
  const visited = new Set<string>()
  // `onDeath` : sous un déclencheur de mort (X) — un 406 joué à la mort d'un monstre ne termine pas une phase.
  const visit = (lvl: SpellLevelData, rootId: number, fromStart: boolean, flipped: boolean, executorIsBoss: boolean, onDeath: boolean, depth: number) => {
    const key = `${lvl.spellId}:${lvl.grade}:${+flipped}${+executorIsBoss}${+fromStart}${+onDeath}`
    if (visited.has(key)) return
    visited.add(key)
    for (const e of lvl.effects) {
      if (e.clientOnly) continue
      const mi = maskInfo(e.targetMask)
      const id = e.effectId
      const death = onDeath || (!isInstant(e) && triggerCodes(e.triggers).includes('X'))
      const toPlayers = hitsPlayers(mi, flipped)
      const toBoss = hitsBossSide(mi, flipped, bossId)
      const state = effectStateRef(e)
      if (id === 950 && state) {
        if (hitsBossItself(mi, flipped, executorIsBoss, bossId) && !scan.bossStates.has(state)) scan.bossStates.set(state, { spellId: rootId, fromStart })
        if (toPlayers && !scan.playerStates.has(state)) scan.playerStates.set(state, { spellId: rootId })
      } else if ((id === 951 || id === 952) && state && !isInstant(e)) {
        let set = scan.removals.get(state)
        if (!set) scan.removals.set(state, (set = new Set()))
        set.add(e.triggers)
      }
      // 406 « enlève les effets du sort X » : fin de phase, sauf s'il est joué à une mort (déclencheur X, ou niveau de
      // sort qui tue son lanceur : minuteur des Gorgouilles) ou si le même niveau relance X aussitôt (remise à zéro puis
      // ré-application : Père Ver).
      if (
        id === 406 &&
        e.value > 0 &&
        !death &&
        !lvl.effects.some(x => x.effectId === 141 && has(maskInfo(x.targetMask).inc, 'cC')) &&
        !lvl.effects.some(x => CAST_EFFECTS.has(x.effectId) && effectSpellRef(x)?.spellId === e.value)
      )
        scan.removedSpells.add(e.value)
      const summon = effectSummonRef(e)
      if (summon && !scan.summons.has(summon.monsterId)) scan.summons.set(summon.monsterId, rootId)
      if (id === EROSION && toPlayers) scan.erosion = Math.max(scan.erosion, Math.max(e.diceSide, e.diceNum))
      if (AP_MP_REMOVAL.has(id) && toPlayers) scan.apMpRemoval.add(rootId)
      if (RANGE_REMOVAL.has(id) && toPlayers) scan.rangeRemoval.add(rootId)
      if (HEALS.has(id) && toBoss) scan.heals.add(rootId)
      if (SHIELDS.has(id) && toBoss) scan.shields.add(rootId)
      // Renvoi : caractéristique « Dommages Renvoyés » (107/220) sur le camp du boss, éclaboussure (1123/1223) sur les joueurs.
      if (REFLECTS.has(id) && (id === 107 || id === 220 ? toBoss : toPlayers)) scan.reflects.add(rootId)
      if (MARK_EFFECTS.has(id)) scan.marks.add(rootId)
      if ((TARGET_EXEC_CASTS.has(id) || CASTER_EXEC_CASTS.has(id)) && depth < MAX_DEPTH) {
        const ref = effectSpellRef(e)
        const sub = ref && data.spellLevel(ref.spellId, { grade: ref.grade })
        const next = TARGET_EXEC_CASTS.has(id) ? subExecutor(mi, flipped, executorIsBoss, bossId) : { flipped, executorIsBoss }
        if (sub) visit(sub, rootId, fromStart, next.flipped, next.executorIsBoss, death, depth + 1)
      }
    }
  }
  for (const r of roots) visit(r.level, r.level.spellId, r.fromStart, false, true, false, 0)
  return scan
}

/** Nom d'état lisible (les gabarits « {{spell,id,n::Nom}} » sont réduits à leur nom). */
function stateName(data: GameDataStore, id: number): string {
  const raw = data.state(id)?.name ?? `État ${id}`
  return raw.replace(/\{\{[^}]*::([^}]*)\}\}/g, '$1').trim() || `État ${id}`
}

function spellName(data: GameDataStore, id: number): string {
  return data.spell(id)?.name ?? `Sort ${id}`
}

// ---------------------------------------------------------------------------------------------------------------------
// Fiche du boss
// ---------------------------------------------------------------------------------------------------------------------

interface PhaseDraft {
  id: string
  name: string
  states: number[]
  weight: number
  resPct?: PerElement | null
  vulnerable?: boolean | 'melee' | 'range'
}

/**
 * Fiche déterministe d'un boss au grade demandé (ou déduit du nombre de joueurs). Lève une erreur si le monstre ou le
 * grade n'existe pas, ou si la fiche manuelle concerne un autre monstre.
 */
export function bossProfile(data: GameDataStore, monsterId: number, opts: BossProfileOptions = {}): BossProfileDetail {
  const m = data.monster(monsterId)
  if (!m || !m.grades.length) throw new Error(`Monstre inconnu : ${monsterId}`)
  const ov = opts.overrides
  if (ov && ov.monsterId !== monsterId) throw new Error(`La fiche manuelle concerne le monstre ${ov.monsterId}, pas ${monsterId}`)
  const players = opts.grade === undefined ? (opts.players ?? DEFAULT_PLAYERS) : undefined
  const grade = opts.grade ?? bossGradeFor(players!, m.grades.length)
  const g = m.grades.find(x => x.grade === grade)
  if (!g) throw new Error(`${m.name} (${monsterId}) n'a pas de grade ${grade} (grades : ${m.grades.map(x => x.grade).join(', ')})`)
  const refHp = opts.refHp ?? DEFAULT_REF_HP
  if (!(refHp > 0)) throw new RangeError(`PV de référence invalides : ${refHp}`)
  const warnings: string[] = []
  const assumptions: string[] = []
  const mechanics: BossMechanic[] = []

  // ── 1. Statistiques du grade ──
  const fighter = createMonsterFighter(data, { monsterId, grade })
  const stats: Stats = { ...fighter.baseStats }
  const rawResPct = resOf(stats)

  // ── 2. Sort de départ (après un premier parcours des fermetures : états, invocations, effets 406…) ──
  const startLevel = g.startingSpell ? data.spellLevel(g.startingSpell.spellId, { grade: g.startingSpell.grade }) : undefined
  const levels = data.monsterSpells(monsterId, grade)
  const roots: { level: SpellLevelData; fromStart: boolean }[] = levels.map(level => ({ level, fromStart: false }))
  if (startLevel) roots.unshift({ level: startLevel, fromStart: true })
  const scan = scanMechanics(data, monsterId, roots)
  const start = analyzeStartingSpell(data, monsterId, startLevel, scan.removedSpells)
  for (const a of start.applied) {
    if (a.stat === 'allResPct') for (const k of Object.values(ELEMENT_RES_PCT)) stats[k] += a.value
    else stats[a.stat] = (stats[a.stat] ?? 0) + a.value
  }
  stats.ap = Math.max(0, stats.ap - start.apLoss)
  stats.mp = Math.max(0, stats.mp - start.mpLoss)
  const f = start.factors
  const compose = (res: number, factor: number) => 100 - (100 - res) * factor
  stats.spellResPct = compose(stats.spellResPct, f.all * f.spell)
  stats.weaponResPct = compose(stats.weaponResPct, f.all * f.weapon)
  stats.meleeResPct = compose(stats.meleeResPct, f.melee)
  stats.rangedResPct = compose(stats.rangedResPct, f.range)
  mechanics.push(...start.mechanics)
  const otherApplied = start.applied.filter(a => !RES_STATS.has(a.stat) && a.stat !== 'finalDamagePct' && a.stat !== 'meleeResPct' && a.stat !== 'rangedResPct')
  if (start.apLoss || start.mpLoss || otherApplied.length) {
    const parts = otherApplied.map(a => `${signed(a.value)} ${statLabel(a.stat, a.effectId)}`)
    if (start.apLoss) parts.push(`−${start.apLoss} PA`)
    if (start.mpLoss) parts.push(`−${start.mpLoss} PM`)
    mechanics.push({ kind: 'other', summary: `Sort de départ appliqué aux caractéristiques : ${parts.join(', ')}.`, source: 'data', spellId: startLevel?.spellId })
  }

  // ── Fiche manuelle : caractéristiques puis résistances ──
  if (ov?.stats) {
    const { allResPct, ...rest } = ov.stats
    Object.assign(stats, rest)
    // « % Résistance » globale imposée : reportée sur chaque élément (les formules ne la lisent pas dans Stats).
    if (allResPct) for (const k of Object.values(ELEMENT_RES_PCT)) stats[k] += allResPct
  }
  if (ov?.resPct) ov.resPct.forEach((v, i) => (stats[ELEMENT_RES_PCT[i as Element]] = v))
  const resPct = resOf(stats)

  // ── 3. Sorts ──
  const ctx: DamageContext = {
    data,
    bossId: monsterId,
    attacker: stats,
    input: { attacker: stats, defender: emptyStats(), element: 0, crit: false, isWeapon: false, isMelee: false, defenderIsPlayer: true },
    bossRefs: hpRefs(fighter.maxHp, refHp),
    playerRefs: hpRefs(refHp, refHp),
  }
  const excluded = new Set(ov?.excludeSpells ?? [])
  const positional = new Set(ov?.positionalSpells ?? [])
  const memo = new Map<string, SpellDamage>()
  const damageOf = (i: number, states: readonly number[]): SpellDamage => {
    const key = `${i}|${states.join(',')}`
    let d = memo.get(key)
    if (!d) memo.set(key, (d = spellDamage(ctx, levels[i], states)))
    return d
  }
  const spells: BossSpellDetail[] = levels.map((l, i) => {
    const requiredStates = l.statesCondition?.[0]?.has.slice() ?? []
    const d = damageOf(i, requiredStates)
    const flags = new Set(d.flags)
    if (excluded.has(l.spellId)) flags.add('excluded')
    if (positional.has(l.spellId)) flags.add('positional')
    const detail: BossSpellDetail = {
      spellId: l.spellId,
      name: spellName(data, l.spellId),
      apCost: l.apCost,
      castsPerTurn: l.maxCastPerTurn,
      castsPerTarget: l.maxCastPerTarget,
      cooldown: l.minCastInterval,
      requiredStates,
      damageByElement: d.el,
      otherDamage: sum(d.hpEl) + d.hpOther,
      flags: FLAG_ORDER.filter(x => flags.has(x)),
      range: l.range,
      initialCooldown: l.initialCooldown,
      hpDamageByElement: d.hpEl,
      summons: d.summons,
      unhandledEffects: d.unhandled,
      allyCasts: d.allyCasts,
      approximations: d.approximations,
    }
    if (l.statesCondition) detail.statesCondition = l.statesCondition.map(c => ({ has: c.has.slice(), not: c.not.slice() }))
    return detail
  })

  // ── 4. Phases ──
  const startVuln = vulnerabilityOf(data, start.selfStates.map(s => s.stateId), true)
  const autoPhases: PhaseDraft[] = [{ id: 'base', name: 'Base (aucun état)', states: [], weight: 1 }]
  // Candidats de phase : clauses `has` des statesCondition, puis états exigés du boss dans les masques des lignes de
  // dégâts des sorts toujours lançables (`*E#` : Croqueleur, El Piko — leurs dégâts dépendent d'un état).
  const clauses = new Map<string, { states: number[]; spells: number }>()
  const addClause = (states: number[]) => {
    const key = states.join('&')
    const entry = clauses.get(key) ?? { states, spells: 0 }
    entry.spells++
    clauses.set(key, entry)
  }
  for (const l of levels)
    for (const c of l.statesCondition ?? []) if (c.has.length) addClause([...new Set(c.has)].sort((a, b) => a - b))
  levels.forEach((l, i) => {
    if (!l.statesCondition) for (const st of damageOf(i, []).casterStates) addClause([st])
  })
  const sortedClauses = [...clauses.entries()].sort((a, b) => b[1].spells - a[1].spells || (a[0] < b[0] ? -1 : 1))
  if (sortedClauses.length > MAX_STATE_PHASES)
    warnings.push(`${sortedClauses.length} combinaisons d'états citées par les sorts : seules les ${MAX_STATE_PHASES} plus fréquentes sont des phases.`)
  for (const [key, c] of sortedClauses.slice(0, MAX_STATE_PHASES))
    autoPhases.push({ id: `etats-${key.replace(/&/g, '-')}`, name: c.states.map(s => stateName(data, s)).join(' + '), states: c.states, weight: 1 })
  const drafts: PhaseDraft[] = ov?.phases?.length
    ? ov.phases.map(p => ({ id: p.id, name: p.name, states: p.states.slice(), weight: p.weight, resPct: p.resPct, vulnerable: p.vulnerable }))
    : autoPhases
  const totalWeight = sum(drafts.map(p => p.weight)) || 1
  const ap = stats.ap
  const phases: BossPhaseProfile[] = drafts.map(p => {
    const avail: number[] = []
    for (let i = 0; i < levels.length; i++) if (!excluded.has(levels[i].spellId) && statesConditionMet(levels[i].statesCondition, p.states)) avail.push(i)
    const items = avail
      .filter(i => !positional.has(levels[i].spellId))
      .map(i => ({ i, d: damageOf(i, p.states) }))
      .filter(x => x.d.total > 0)
    const peakCounts = knapsack(
      items.map(x => ({ value: x.d.total, cost: levels[x.i].apCost, max: maxCasts(levels[x.i], ap) })),
      ap,
    )
    const peakPerTurn = sum(items.map((x, k) => peakCounts[k] * x.d.total))
    const sustained = simulateSustained(items.map(x => ({ level: levels[x.i], damage: x.d })), ap)
    const shareSource = sustained.total > 0 ? sustained.byElement : items.reduce((acc, x, k) => addScaled(acc, elementalOf(x.d), peakCounts[k]), zero5())
    const elTotal = sum(shareSource)
    return {
      id: p.id,
      name: p.name,
      states: p.states,
      weight: p.weight / totalWeight,
      resPct: p.resPct ? (p.resPct.slice() as PerElement) : (resPct.slice() as PerElement),
      vulnerable: p.vulnerable ?? phaseVulnerability(data, startVuln, p.states),
      spellIds: avail.map(i => levels[i].spellId),
      peakPerTurn,
      sustainedPerTurn: sustained.total / SUSTAINED_TURNS,
      elementShares: (elTotal > 0 ? shareSource.map(v => v / elTotal) : zero5()) as PerElement,
    }
  })
  const hitting = phases.filter(p => p.peakPerTurn > 0 && sum(p.elementShares) > 0)
  const hitWeight = sum(hitting.map(p => p.weight))
  const incomingShares = zero5()
  if (hitWeight > 0) for (const p of hitting) p.elementShares.forEach((v, i) => (incomingShares[i] += (v * p.weight) / hitWeight))

  // ── 5. Mécaniques ──
  const startSelf = new Map(start.selfStates.map(s => [s.stateId, s]))
  for (const [s, info] of scan.bossStates) {
    const st = data.state(s)
    if (!st) continue
    const name = `« ${stateName(data, s)} » (${s})`
    const fromStart = startSelf.has(s) ? ' dès le début du combat' : info.fromStart ? ' (sort de départ, sous condition)' : ` (${spellName(data, info.spellId)})`
    const removal = scan.removals.get(s)
    const removedBy = removal?.size ? ` ; retiré sur : ${[...removal].map(triggerLabel).join(', ')}` : ''
    const pushRemoval = !!removal && [...removal].some(t => /P[MP]?D/.test(t))
    const base = { source: 'data' as const, stateId: s, spellId: info.spellId }
    if (st.invulnerable)
      mechanics.push({ ...base, kind: 'invulnerable', summary: `Invulnérable : état ${name}${fromStart}${removedBy}.`, counters: pushRemoval ? ['push-damage', 'placement'] : ['burst'] })
    else if (st.invulnerableRange)
      mechanics.push({ ...base, kind: 'invulnerable-range', summary: `Invulnérable à distance : état ${name}${fromStart}${removedBy}.`, counters: ['melee'], punishes: ['range'] })
    else if (st.invulnerableMelee)
      mechanics.push({ ...base, kind: 'invulnerable-melee', summary: `Invulnérable en mêlée : état ${name}${fromStart}${removedBy}.`, counters: ['range'], punishes: ['melee'] })
    if (st.cantBeMoved || st.cantBePushed)
      mechanics.push({ ...base, kind: 'cant-be-moved', summary: `Indéplaçable : état ${name}${fromStart}.`, punishes: ['placement', 'push-damage'] })
  }
  for (const [s, info] of scan.playerStates) {
    const st = data.state(s)
    if (!st) continue
    const name = `« ${stateName(data, s)} » (${s}, ${spellName(data, info.spellId)})`
    const base = { source: 'data' as const, stateId: s, spellId: info.spellId }
    if (st.cantDealDamage) mechanics.push({ ...base, kind: 'pacifist', summary: `Rend des joueurs Pacifistes (aucun dommage) : état ${name}.` })
    if (st.incurable)
      mechanics.push({ ...base, kind: 'incurable', summary: `Rend des joueurs insoignables : état ${name}.`, counters: ['shield', 'damage-reduction'], punishes: ['heal'] })
  }
  const listSpells = (ids: Iterable<number>) => [...new Set([...ids].map(id => spellName(data, id)))].slice(0, 4).join(', ')
  if (scan.summons.size) {
    const names = [...scan.summons.keys()].map(id => data.monster(id)?.name ?? `Monstre ${id}`)
    const shown = [...new Set(names)].slice(0, 5)
    mechanics.push({ kind: 'summons', summary: `Invoque : ${shown.join(', ')}${names.length > shown.length ? ` (+${names.length - shown.length})` : ''}.`, source: 'data', counters: ['zone'] })
  }
  if (scan.erosion > 0)
    mechanics.push({ kind: 'erosion', summary: `Érosion infligée jusqu'à ${scan.erosion} %.`, source: 'data', counters: ['shield', 'damage-reduction'], punishes: ['heal'] })
  if (scan.apMpRemoval.size)
    mechanics.push({ kind: 'ap-mp-removal', summary: `Retire des PA/PM aux joueurs (${listSpells(scan.apMpRemoval)}).`, source: 'data', counters: ['dodge', 'ally-ap-mp'] })
  if (scan.rangeRemoval.size)
    mechanics.push({ kind: 'range-removal', summary: `Retire de la portée aux joueurs (${listSpells(scan.rangeRemoval)}).`, source: 'data', counters: ['melee'] })
  if (scan.heals.size) mechanics.push({ kind: 'boss-heal', summary: `Se soigne ou soigne ses alliés (${listSpells(scan.heals)}).`, source: 'data', counters: ['burst', 'erosion'] })
  if (scan.shields.size) mechanics.push({ kind: 'boss-shield', summary: `Se donne ou donne des boucliers (${listSpells(scan.shields)}).`, source: 'data', counters: ['debuff', 'burst'] })
  if (scan.reflects.size)
    mechanics.push({ kind: 'reflect', summary: `Renvoie des dommages (${listSpells(scan.reflects)}).`, source: 'data', counters: ['indirect-damage'], punishes: ['burst'] })
  if (scan.marks.size) mechanics.push({ kind: 'marks', summary: `Pose des glyphes ou des pièges (${listSpells(scan.marks)}).`, source: 'data', counters: ['placement'] })
  const hpSpells = spells.filter(s => s.flags.includes('hp-based'))
  if (hpSpells.length)
    mechanics.push({ kind: 'hp-based-damage', summary: `Dégâts en % de PV : ${hpSpells.slice(0, 4).map(s => s.name).join(', ')}.`, source: 'data' })
  const extremeOf = (res: PerElement) => res.map((v, i) => (v >= 100 ? `${ELEMENT_NAMES_FR[i as Element]} ${v} %` : '')).filter(Boolean)
  const extreme = extremeOf(rawResPct.map((v, i) => Math.max(v, resPct[i])) as PerElement)
  if (extreme.length)
    mechanics.push({ kind: 'extreme-res', summary: `Résistances ≥ 100 % (${extreme.join(', ')}) : mécanique à lever en combat, pas une immunité.`, source: 'data', counters: ['multi-element'] })
  if (!ov?.phases?.length && autoPhases.length > 1)
    mechanics.push({ kind: 'phases', summary: `Sorts liés à des états du boss : phases ${autoPhases.slice(1).map(p => `« ${p.name} »`).join(', ')}.`, source: 'data' })
  for (const n of ov?.mechanics ?? []) mechanics.push({ ...n, source: 'overrides' })

  // ── Avertissements et hypothèses ──
  const extremeEffective = extremeOf(resPct)
  if (extremeEffective.length)
    warnings.push(`Résistance ≥ 100 % (${extremeEffective.join(', ')}) : c'est une mécanique (à faire tomber en combat), pas une immunité ; sans fiche manuelle (resPct), cet élément compte comme immunisé.`)
  if (!phases.some(p => p.peakPerTurn > 0)) warnings.push('Aucun dégât direct calculable sur les joueurs : profil offensif inconnu (dégâts reçus non pondérés).')
  const base = phases.find(p => p.states.length === 0)
  if (base && base.peakPerTurn === 0 && hitting.length) {
    const names = hitting.map(p => `« ${p.name} »`)
    warnings.push(`Sans état, le boss ne frappe pas (tous ses sorts offensifs dépendent d'un état) : dégâts reçus pris sur les phases ${names.join(', ')}.`)
  }
  if (hpSpells.length)
    warnings.push(`${hpSpells.length} sort(s) infligent des dégâts en % de PV (${hpSpells.slice(0, 3).map(s => s.name).join(', ')}) : valeurs dépendant des PV de référence.`)
  if (scan.summons.size) warnings.push('Le boss invoque : les dégâts de ses invocations ne sont pas comptés.')
  const allySpells = spells.filter(s => s.allyCasts.length)
  if (allySpells.length) {
    const executors = [...new Set(allySpells.flatMap(s => s.allyCasts.flatMap(c => c.monsterIds)))].map(id => data.monster(id)?.name ?? `Monstre ${id}`)
    warnings.push(
      `Sorts dont les dégâts sont portés par un allié du boss (${allySpells.slice(0, 4).map(s => `« ${s.name} »`).join(', ')}${executors.length ? ` ; lancés par : ${executors.slice(0, 4).join(', ')}` : ''}) : ces dégâts ne sont pas comptés.`,
    )
  }
  const unhandled = spells.filter(s => s.unhandledEffects.length)
  if (unhandled.length) {
    const ids = [...new Set(unhandled.flatMap(s => s.unhandledEffects))].sort((a, b) => a - b)
    warnings.push(
      `Effets de dégâts non gérés, comptés à 0 : ${ids.map(id => `${id} (${UNHANDLED_DAMAGE.get(id)})`).join(', ')} dans ${unhandled.slice(0, 4).map(s => s.name).join(', ')}.`,
    )
  }
  if (grade > 5) warnings.push(`Grade ${grade} : au-delà du rang 5, variante hors donjon (ex. « Songes infinis ») — vérifier que c'est voulu.`)
  warnings.push(`Données DofusDB extraites le ${DATA_SNAPSHOT.date} (version ${DATA_SNAPSHOT.patch}) : la 3.7 (2026-10-06) a modifié plusieurs boss.`)

  assumptions.push(
    players !== undefined
      ? `Grade ${grade} pour ${players} joueur(s) : rang = joueurs − 3, borné à 1..5 (docs/research/vortex-audit.md §1.3).`
      : `Grade ${grade} imposé.`,
  )
  assumptions.push(
    `Dégâts du boss contre un joueur à 0 % de résistance, critique pondéré, lignes aléatoires pondérées par leur probabilité (un seul groupe tiré) ; % de PV : ${refHp} PV de référence par joueur, boss à mi-vie, PV érodés = 10 % des PV max.`,
  )
  if (spells.some(s => s.approximations.includes('target-branches')))
    assumptions.push('Branches exclusives selon la cible (classe, états, paliers de PV) : la plus forte est retenue (borne haute).')
  assumptions.push(
    ov?.phases?.length
      ? 'Phases et poids de la fiche manuelle.'
      : `Phases à poids égaux${autoPhases.length > 1 ? ` (${autoPhases.length} phases dont « base »)` : ' (une seule phase : « base »)'}.`,
  )
  assumptions.push('Pic par tour = borne haute (meilleure combinaison de sorts sur une cible, sac à dos sur les PA), pas le comportement réel de l\'IA.')
  assumptions.push(
    `Soutenu = sac à dos tour par tour sur ${SUSTAINED_TURNS} tours, relances tenues ; poisons comptés une fois par tour de durée, ${SUSTAINED_TURNS} tours au plus (durée infinie ou « tout le combat » comprise).`,
  )
  if (start.selfStates.some(s => data.state(s.stateId)?.invulnerable))
    assumptions.push('Le boss commence invulnérable : DPT calculé sur une fenêtre de vulnérabilité supposée.')
  if (ov) assumptions.push(`Fiche manuelle appliquée${ov.updatedAt ? ` (mise à jour ${ov.updatedAt})` : ''}.`)
  if (ov?.adds?.length) assumptions.push(`${ov.adds.length} type(s) d'adds déclarés par la fiche : non comptés dans ce profil.`)

  const weakestElements = [0, 1, 2, 3, 4].sort((a, b) => resPct[a] - resPct[b] || a - b)
  const profile: BossProfileDetail = {
    monsterId,
    name: m.name,
    grade,
    level: g.level,
    hp: fighter.maxHp,
    ap: stats.ap,
    mp: stats.mp,
    rawResPct,
    resPct,
    stats,
    weakestElements,
    apParry: stats.apParry,
    mpParry: stats.mpParry,
    tackle: stats.tackleBlock,
    phases,
    spells,
    mechanics,
    incomingShares,
    warnings,
    assumptions,
    refHp,
  }
  if (players !== undefined) profile.players = players
  if (ov) profile.overrides = ov
  if (startLevel) profile.startingSpell = { spellId: startLevel.spellId, grade: startLevel.grade, name: spellName(data, startLevel.spellId) }
  return profile
}

const FLAG_ORDER: readonly BossSpellFlag[] = ['hp-based', 'delayed', 'triggered', 'positional', 'ring-excludes-target', 'summon', 'mark', 'sub-spell', 'excluded']

function resOf(s: Stats): PerElement {
  return [s.neutralResPct, s.earthResPct, s.fireResPct, s.waterResPct, s.airResPct]
}

function elementalOf(d: SpellDamage): PerElement {
  return d.el.map((v, i) => v + d.hpEl[i]) as PerElement
}

function addScaled(acc: PerElement, v: readonly number[], k: number): PerElement {
  for (let i = 0; i < 5; i++) acc[i] += v[i] * k
  return acc
}

/** Vulnérabilité due aux drapeaux d'états (`ignoreFull` : une invulnérabilité totale est supposée levée). */
function vulnerabilityOf(data: GameDataStore, states: readonly number[], ignoreFull: boolean): boolean | 'melee' | 'range' {
  let melee = true
  let range = true
  for (const s of states) {
    const st = data.state(s)
    if (!st) continue
    if (st.invulnerable && !ignoreFull) melee = range = false
    if (st.invulnerableMelee) melee = false
    if (st.invulnerableRange) range = false
  }
  return melee && range ? true : melee ? 'melee' : range ? 'range' : false
}

/** Vulnérabilité d'une phase : celle du sort de départ, restreinte par les drapeaux des états de la phase. */
function phaseVulnerability(data: GameDataStore, start: boolean | 'melee' | 'range', states: readonly number[]): boolean | 'melee' | 'range' {
  const own = vulnerabilityOf(data, states, false)
  if (start === false || own === false) return false
  if (start === true) return own
  if (own === true) return start
  return start === own ? start : false
}

/**
 * Simulation du soutenu : à chaque tour, sac à dos sur les sorts lançables (relance initiale écoulée, relance du
 * dernier lancer écoulée), puis relances posées (lancer au tour t, relance r ⇒ relançable au tour t + r).
 */
function simulateSustained(items: readonly { level: SpellLevelData; damage: SpellDamage }[], ap: number): { total: number; byElement: PerElement } {
  const nextTurn = new Array<number>(items.length).fill(1)
  let total = 0
  const byElement = zero5()
  for (let t = 1; t <= SUSTAINED_TURNS; t++) {
    const avail = items.map((x, i) => i).filter(i => t > items[i].level.initialCooldown && nextTurn[i] <= t)
    const counts = knapsack(
      avail.map(i => ({ value: items[i].damage.total, cost: items[i].level.apCost, max: maxCasts(items[i].level, ap) })),
      ap,
    )
    avail.forEach((i, k) => {
      const n = counts[k]
      if (!n) return
      total += n * items[i].damage.total
      addScaled(byElement, elementalOf(items[i].damage), n)
      if (items[i].level.minCastInterval > 0) nextTurn[i] = t + items[i].level.minCastInterval
    })
  }
  return { total, byElement }
}
