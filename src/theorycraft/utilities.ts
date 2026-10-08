/**
 * Theorycraft contre un boss — UTILITÉS CHIFFRÉES d'un personnage et pertinence contre un boss (docs/design/theorycraft.md
 * §1.6).
 *
 * `classUtilities(data, fighter, boss)` chiffre, pour un personnage (build + variantes actives + posture posée sur
 * `fighter.states`), ce qu'il apporte au groupe hors dégâts : PA/PM retirés au boss, soins, boucliers, réductions de
 * dégâts alliées, « dommages subis » posés sur le boss, buffs alliés, placement, invocations, érosion, désenvoûtement
 * (unités : `UtilityKey`, types.ts).
 *
 * Source : les profils de sorts de l'IA (`createSpellProfileIndex(theoryEngine(data))`, src/ai/core/spellProfile.ts)
 * NETTOYÉS. Pièges connus de ces profils (carte « DPT analytique et profils de sorts ») et réponse ici :
 *  - les lignes utilitaires (soins, retraits, buffs…) ignorent les « portes » des sous-sorts (masque de l'effet parent
 *    « lance un sort ») et le drapeau `dispel` ignore les masques : faux désenvoûtement de l'Eniripsa (ses Mots lancent
 *    un sous-sort qui fait un 406 sur sa propre Fée, masque « a,P,F7370,F7371 »). Ici la fermeture des sous-sorts est
 *    reparcourue (mêmes règles que `scanEffects` : 1160/2160/2960 ou masque « soi », instantané, sans retard, profondeur
 *    ≤ 4, groupes aléatoires) en gardant la CHAÎNE des portes, sur tous les chemins ; chaque nœud (sort ou
 *    sous-sort) est profilé SEUL (`ownProfile` : profil spellProfile d'une copie dont les effets « lance un sort » sont
 *    neutralisés), puis chaque ligne est attribuée aux cibles qu'elle peut atteindre (le boss, un allié, soi) par le
 *    moteur (`matchesTargetMask`) : masque de la ligne ET portes. Les désenvoûtements retenus sont 132 (« enlève les
 *    envoûtements ») et 1075 (« durée des effets −X ») sur le boss ; 406/1406 (« enlève les effets du sort #2 », presque
 *    toujours le sort du lanceur) ne sont pas des désenvoûtements ;
 *  - Huppermage gonflé : chaque sort élémentaire atteint les sous-sorts de COMBINAISON (Éruption ×115 %, Carbonisation
 *    −2 PA…). Un sous-sort atteint par au moins deux sorts du personnage est DÉDOUBLONNÉ : il devient une source à part
 *    (« Éruption (via Éther, Cataracte…) »), lançable au plus une fois par tour, au coût en PA du moins cher des sorts
 *    qui y mènent ;
 *  - armure 265/105 (Rempart, Fortification du Féca ; Étreinte de Valkyr du Forgelance) absente des profils : lue sur les
 *    effets du nœud (`armorReduction` : valeur × (1 + niveau/20)). De même 1163 (« dommages subis ×% », durée réelle d'un
 *    buff déclenché = `triggerDuration`), érosion 776 et désenvoûtements.
 *
 * Règles de ciblage (`affects`, `reachOf`) :
 *  - une ligne touche X (boss, allié, soi) si son masque accepte X et si chaque porte est satisfaite : par X lui-même
 *    quand la ligne est en zone « case » sans « C » (le sous-sort est lancé sur la case de la cible de la porte), sinon
 *    par l'une des entités plausibles (boss, allié, soi : la zone ou « C » atteint X depuis la case d'une autre) ;
 *  - deux évaluations : « certaine » (posture seule sur le lanceur, états de la phase sur le boss) et « élargie » (états
 *    que la classe pose elle-même, sur soi, ses alliés ou ses ennemis : états de combinaison de l'Huppermage, cartes de
 *    l'Ecaflip, marques…). Une ligne atteinte seulement en élargi, ou portant une condition de branche sur la cible
 *    (`E#`/`e#` état, `V#`/`v#` palier de PV), est une BRANCHE : les branches d'une même catégorie d'un nœud se partagent
 *    le poids (1/n, moyenne des alternatives : Tromperie de l'Ecaflip, 16 soins selon l'état tiré) ;
 *  - lancers de sous-sorts (`walkNodes`) : conditions sur le lanceur évaluées (posture : Fer Rouge du Forgelance en Armé ;
 *    lancer « sur soi » évalué sur le lanceur à PV pleins : Souffrance du Sacrieur) ; condition sur la cible « choisissable »
 *    (états que la classe pose : combinaisons de l'Huppermage) à poids plein, autres conditions de cible à 1/n ;
 *  - conditions sur un monstre précis (`F#` : Fée de l'Eniripsa, Gardien de l'Huppermage) : jamais remplies (aucune
 *    invocation n'est modélisée), lignes écartées et comptées dans les notes ;
 *  - un buff allié dont le masque vise AUSSI les ennemis (« a,A » : l'effet suit la cible du sort) n'est compté que pour
 *    un sort qui ne frappe pas le boss (soutien pur : Puissance de l'Iop ; sinon il tomberait sur le boss visé) ; un sort dont la condition d'états du lanceur n'est pas remplie (masque du Zobal
 *    absent…) n'est pas lançable ; une réduction retirée au premier coup subi (406 sur son propre sort, déclencheur
 *    « D » : Ataraxie) vaut 1 / `REF_HITS_PER_TURN` d'une réduction tenue ;
 *  - classes à posture (classes.ts) : utilités calculées dans chaque posture tenable et fusionnées (`mergeUtilities` :
 *    meilleure posture par utilité, changement non compté).
 *
 * Chiffrage par tour (relances amorties, comme le soutenu de rotation.ts) : glouton par valeur / PA sur les PA du
 * personnage ; un sort de relance k compte 1/k lancer par tour et consomme 1/k de son coût ; lancers par tour, par cible
 * pour le boss, par cible × personnages visables (`DEFAULT_ALLY_TARGETS`) pour un soin ou un bouclier.
 *  - rotations CONSACRÉES (`values.mpRemoved`, `apRemoved`, `heal`, `shield`) : chacune suppose TOUT le tour ; elles ne
 *    s'additionnent pas entre elles ;
 *  - tours MIXTES, un seul budget de PA : `removal.combined` (PM et PA retirés ensemble, réserves qui comptent : la
 *    meilleure de trois rotations — glouton sur les points pondérés par la chance du premier point, rotation PM seule,
 *    rotation PA seule) et `care` (soin + bouclier, après l'entretien des meilleures réduction et armure alliées). Ce
 *    sont les valeurs des axes Contrôle et Soin de classes.ts ;
 *  - retraits : tentatives esquivables d'abord, sur la réserve pleine (l'ordre qui retire le plus), puis points non
 *    esquivables, plafonnés à la réserve résultat par résultat (E[min(X + sûrs, réserve)], distribution exacte de
 *    `apMpRemovalDistribution`) ; un retrait qui touche aussi les alliés (Retraite Anticipée) est compté et signalé ;
 *  - temps d'effet d'un buff : min(1, durée / relance) (durée infinie : 1) ; érosion pondérée comme les autres effets
 *    (chemin, branche, tirage), une érosion de zone qui touche aussi les alliés (Roulette, Tarot) est écartée.
 * `ProxyContext.removedPoints` (proxy de stuff) mesure le retrait sur les profils BRUTS (portes ignorées, Huppermage
 * gonflé) et sans limite de lancers par cible : il n'est pas utilisé ici.
 *
 * Apport offensif (`offensiveGain`, heuristique affichée décomposée) : % de dégâts gagnés par un allié de référence
 * (caractéristique + Puissance `REF_ALLY_POWER`, jet de base `REF_BASE_HIT`, `REF_ALLY_AP` PA) = « dommages subis »
 * + % dommages finaux + Puissance × 100 / (100 + REF_ALLY_POWER) + Dommages × 100 / (REF_BASE_HIT × (1 +
 * REF_ALLY_POWER / 100)) + PA × 100 / REF_ALLY_AP (les PM ne comptent pas : effet de position).
 *
 * Pertinence (`relevance`) : table `MECHANIC_RELEVANCE` (mécanique du boss → utilités utiles / punies, avec une phrase)
 * combinée aux `counters`/`punishes` propres à chaque mécanique du profil ; pas d'atout lié aux dégâts pour un personnage
 * qui ne frappe pas le boss, mécanique « % dommages finaux » anecdotique (< `FINAL_DAMAGE_MIN_PCT`) ignorée.
 * Confiance (`CLASS_MODEL_LIMITS`, `classConfidence`) : mécaniques de classe que le DPT ne modélise pas (section « [À
 * modéliser] » de la carte des sorts de classe ; docs/research/classes/*.md).
 *
 * Module PUR : aucun import `node:`, ni de src/dungeons, ni du proxy de stuff.
 */
import { createSpellProfileIndex, maskSides, zoneRadius, type SpellProfileIndexX, type SpellProfileX } from '../ai/core/spellProfile'
import { ELEMENT_MAIN_STAT, Element, type Stats } from '../core/types'
import { apMpRemovalDistribution, apMpRemovalProbability } from '../damage/apmp'
import { critChance } from '../damage/crit'
import { heal, shieldFromLevel, shieldFromMaxHp } from '../damage/heal'
import { armorReduction } from '../damage/misc'
import type { EffectData, SpellLevelData, ZoneSpec } from '../data/model'
import type { DataStore } from '../data/store'
import { checkStatesCriterion } from '../engine/criteria'
import { CAST_SPELL_EFFECTS, isInstant } from '../engine/effects/core'
import { registeredEffects } from '../engine/effects/registry'
import { createPlayerFighter } from '../engine/factory'
import { casterPassesMask, compileTargetMask, matchesTargetMask } from '../engine/targetMask'
import type { Fighter } from '../engine/types'
import { theoryEngine } from './fighters'
import type { BossProfile, ClassUtilities, Confidence, DamageShape, MechanicKind, Relevance, UtilityKey, UtilityTag, UtilityValue } from './types'

// ---------------------------------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------------------------------

/** PV d'un allié de référence (soins en % des PV max, 1109) — même valeur que les PV de référence de bossProfile. */
export const REF_ALLY_HP = 4000
/** Allié de référence de l'apport offensif : caractéristique + Puissance (Crâ Terre du preset : 1 258 + 60). */
export const REF_ALLY_POWER = 1300
/**
 * Coups reçus par tour par un allié (hypothèse) : une réduction consommée au premier coup (Ataraxie du Féca : ×25 % puis
 * retirée) vaut 1 / REF_HITS_PER_TURN d'une réduction tenue tout le tour ; une armure (265/105) retire sa valeur à
 * chacun de ces coups (classes.ts).
 */
export const REF_HITS_PER_TURN = 2
/** Jet de base moyen d'un coup de l'allié de référence (sorts niveau 200 : 30-40). */
export const REF_BASE_HIT = 30
/** PA de l'allié de référence. */
export const REF_ALLY_AP = 12
/**
 * Personnages qu'un soin ou un bouclier peut viser dans un tour (lanceur compris) : groupe de 4 par défaut
 * (`DEFAULT_PLAYERS` de bossProfile.ts). La limite de lancers PAR CIBLE d'un sort de soin vaut donc × 4 par tour.
 */
export const DEFAULT_ALLY_TARGETS = 4

/** Seuils des étiquettes de capacité (`tags`) : en dessous, l'utilité est jugée anecdotique. */
export const TAG_THRESHOLDS = {
  /** Points tentés par tour (retrait PA/PM). */
  removal: 1,
  /** PV par tour (soin, bouclier). */
  heal: 300,
  shield: 300,
  /** % de réduction × temps d'effet ; dommages retirés par coup. */
  reduction: 10,
  armor: 50,
  /** % de dommages subis × temps d'effet. */
  damageTaken: 3,
  /** % d'érosion. */
  erosion: 10,
  /** Part du soutenu conservée au contact seul / à distance seule. */
  melee: 0.5,
  range: 0.5,
  /** Rafale / soutenu. */
  burst: 1.2,
  /** Deuxième caractéristique élémentaire / première (stuff multi-élément). */
  multiElement: 0.6,
  /** Esquive PA et PM moyenne du personnage. */
  dodge: 60,
} as const

const CASTER_SUBSPELL: ReadonlySet<number> = new Set([1160, 2160, 2960])
/**
 * Rayon (cases) à partir duquel une zone couvre toute l'aire de combat (« a »/« A » : 63, Retraite Anticipée : cercle 63) :
 * une ligne de ce type qui accepte les alliés les touche à coup sûr (sinon cela dépend des positions, non modélisées).
 */
const GLOBAL_RADIUS = 20
const MAX_SUB_DEPTH = 4
const ARMOR: ReadonlySet<number> = new Set([265, 105])
const EROSION = 776
/** Pertes de PA/PM en % de la valeur courante (mode « % de la caractéristique ») : pas des points retirés. */
const PCT_AP_MP_LOSS: ReadonlySet<number> = new Set([2847, 2849])
/** Désenvoûtements au sens joueur : 132 (enlève les envoûtements), 1075 (durée des effets −X). */
const DISPEL: ReadonlySet<number> = new Set([132, 1075])
const RECEIVED = 1163
const NOOP_FAMILIES = new Set(['visual', 'noop'])
/** Déplacements d'une entité ennemie (placement). */
const PLACEMENT_KINDS = new Set(['push', 'pull', 'teleport', 'swap', 'symmetric', 'carry', 'throw'])
/** Caractéristiques dont la baisse sur le boss compte comme débuff offensif ou défensif. */
const DEBUFF_STATS: ReadonlySet<keyof Stats> = new Set<keyof Stats>([
  'power', 'damage', 'finalDamagePct', 'spellDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'critical', 'criticalDamage',
  'strength', 'intelligence', 'chance', 'agility', 'neutralDamage', 'earthDamage', 'fireDamage', 'waterDamage', 'airDamage',
  'neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct', 'meleeResPct', 'rangedResPct', 'spellResPct',
  'neutralRes', 'earthRes', 'fireRes', 'waterRes', 'airRes', 'allResPct', 'apParry', 'mpParry', 'tackleBlock', 'tackleEvade',
  'heals', 'finalHealPct',
])

export const UTILITY_KEYS: readonly UtilityKey[] = [
  'mpRemoved', 'apRemoved', 'rangeRemoval', 'heal', 'shield', 'allyReduction', 'allyArmor', 'selfReduction', 'damageTaken',
  'allyPower', 'allyDamage', 'allyFinalDamage', 'allyAp', 'allyMp', 'erosion', 'placement', 'summons', 'dispel', 'debuff',
]

/** Libellés français des étiquettes (rapports, pertinence). */
export const UTILITY_TAG_LABELS: Readonly<Record<UtilityTag, string>> = {
  melee: 'mêlée',
  range: 'distance',
  zone: 'dégâts de zone',
  burst: 'rafale',
  'indirect-damage': 'dégâts indirects (poisons, glyphes, pièges)',
  'mp-removal': 'retrait PM',
  'ap-removal': 'retrait PA',
  'range-removal': 'retrait PO',
  heal: 'soin',
  shield: 'boucliers',
  'damage-reduction': 'réduction de dégâts alliée',
  placement: 'placement',
  'push-damage': 'dommages de poussée',
  summons: 'invocations',
  debuff: 'débuff / désenvoûtement',
  erosion: 'érosion',
  'ally-ap-mp': '+PA/+PM alliés',
  'ally-damage': 'buffs offensifs alliés',
  'damage-taken-debuff': '« dommages subis » sur le boss',
  dodge: 'esquive PA/PM',
  'multi-element': 'multi-élément',
}

// ---------------------------------------------------------------------------------------------------------------------
// Parcours de la fermeture des sous-sorts, avec les portes
// ---------------------------------------------------------------------------------------------------------------------

/** Un nœud de la fermeture : sort racine (profondeur 0) ou sous-sort, atteint par une chaîne de portes. */
interface WalkNode {
  level: SpellLevelData
  /** Masques des effets « lance un sort » parents (hors parents « soi »), dans l'ordre. */
  gates: readonly string[]
  /** Probabilité d'atteindre le nœud (groupes aléatoires, branches). */
  weight: number
  depth: number
}

/** Probabilité de chaque effet aléatoire (un seul groupe tiré, comme src/engine/effects/core.ts et spellProfile.ts). */
function randomProbabilities(effects: readonly EffectData[]): Map<EffectData, number> {
  const weights = new Map<number, number>()
  for (const e of effects) if (e.random > 0) weights.set(e.group || -e.order - 1, (weights.get(e.group || -e.order - 1) ?? 0) + e.random)
  const total = [...weights.values()].reduce((a, b) => a + b, 0)
  const out = new Map<EffectData, number>()
  for (const e of effects) if (e.random > 0) out.set(e, total > 0 ? (weights.get(e.group || -e.order - 1) ?? 0) / total : 0)
  return out
}

/** Conditions de BRANCHE sur la cible d'un masque : états (E/e) et paliers de PV (V/v) ; les autres jetons filtrent. */
const BRANCH_CODES: ReadonlySet<string> = new Set(['E', 'e', 'V', 'v'])

function branchConditions(mask: string): { code: string; value: number }[] {
  return mask ? compileTargetMask(mask).targetConditions.filter(c => BRANCH_CODES.has(c.code)) : []
}

/** Lanceurs de référence du parcours : posture seule (`base`), et posture + états que la classe se pose (`relaxed`). */
interface Casters {
  base: Fighter
  relaxed: Fighter
  /** États que la classe pose sur les ennemis ou les alliés (conditions de cible « choisissables »). */
  applied: ReadonlySet<number>
}

/** L'effet « lance un sort » est-il suivi par l'analyse (règles de `scanEffects`, spellProfile.ts) ? */
function followedCast(e: EffectData): boolean {
  if (e.clientOnly || !CAST_SPELL_EFFECTS.has(e.effectId)) return false
  const family = registeredEffects().get(e.effectId)?.family
  if (family && NOOP_FAMILIES.has(family)) return false
  const byCaster = CASTER_SUBSPELL.has(e.effectId) || maskSides(e.targetMask).selfOnly
  return byCaster && isInstant(e) && e.delay <= 0 && e.diceNum > 0
}

/**
 * Nœuds de la fermeture d'un sort, TOUS les chemins (cycles évités par chemin : un sous-sort atteint par deux chemins
 * apparaît deux fois, avec ses deux chaînes de portes). Mêmes règles de suivi que `scanEffects` (1160/2160/2960 ou masque
 * « soi », instantané, sans retard, profondeur ≤ 4, groupes aléatoires), avec le lanceur connu (`casters` absent :
 * aucune condition évaluée, premier passage qui relève les états posés). Poids d'un lancer conditionnel :
 *  - conditions sur le LANCEUR (ou lancer « sur soi », évalué sur le lanceur : paliers de PV de la Souffrance du
 *    Sacrieur à PV pleins) remplies dans la posture : poids plein ; remplies seulement avec un état que la classe se
 *    pose en combat (cartes de l'Ecaflip…) : branches alternatives, 1/n entre elles ; jamais remplies : non suivi ;
 *  - conditions de branche sur la cible (`E#`, `V#`…) : « choisissables » si ce sont des états que la classe pose
 *    elle-même (combinaisons de l'Huppermage : poids plein, le joueur provoque celle qu'il veut), sinon 1/n entre les
 *    lancers de ce type (paliers de PV de la cible, comme spellProfile.ts).
 */
function walkNodes(data: DataStore, root: SpellLevelData, casters?: Casters): WalkNode[] {
  const out: WalkNode[] = []
  const visit = (level: SpellLevelData, gates: readonly string[], weight: number, depth: number, path: Set<SpellLevelData>) => {
    out.push({ level, gates, weight, depth })
    if (depth >= MAX_SUB_DEPTH) return
    const probs = randomProbabilities(level.effects)
    const casts: { e: EffectData; alt: boolean; split: boolean }[] = []
    for (const e of level.effects) {
      if (!followedCast(e)) continue
      if (!casters) {
        casts.push({ e, alt: false, split: false })
        continue
      }
      const selfParent = maskSides(e.targetMask).selfOnly
      const pass = (c: Fighter) => (selfParent ? matchesTargetMask(e.targetMask, c, c) : casterPassesMask(e.targetMask, c))
      if (!pass(casters.relaxed)) continue
      const cond = selfParent ? [] : branchConditions(e.targetMask)
      const choosable = cond.every(c => c.code === 'E' && casters.applied.has(c.value))
      casts.push({ e, alt: !pass(casters.base), split: cond.length > 0 && !choosable })
    }
    const nAlt = casts.filter(c => c.alt).length
    const nSplit = casts.filter(c => !c.alt && c.split).length
    for (const { e, alt, split } of casts) {
      const sub = data.spellLevel(e.diceNum, { grade: e.diceSide || undefined })
      if (!sub || path.has(sub)) continue
      const prob = weight * (e.random > 0 ? (probs.get(e) ?? 0) : 1)
      const w = alt ? prob / nAlt : split && nSplit > 1 ? prob / nSplit : prob
      path.add(sub)
      visit(sub, maskSides(e.targetMask).selfOnly ? gates : [...gates, e.targetMask], w, depth + 1, path)
      path.delete(sub)
    }
  }
  visit(root, [], 1, 0, new Set([root]))
  return out
}

/** Profils « propres » (effets du nœud seul : sous-sorts non suivis), en cache par niveau de sort. */
const OWN_PROFILES = new WeakMap<SpellLevelData, SpellProfileX>()

/**
 * Profil spellProfile des effets PROPRES d'un nœud : copie du niveau dont les effets « lance un sort » sont neutralisés
 * (`diceNum` 0 : non suivis, groupes aléatoires intacts), pour attribuer chaque ligne à son nœud et à ses portes.
 */
function ownProfile(idx: SpellProfileIndexX, level: SpellLevelData): SpellProfileX {
  let p = OWN_PROFILES.get(level)
  if (p) return p
  const strip = (list: readonly EffectData[]) => list.map(e => (CAST_SPELL_EFFECTS.has(e.effectId) ? { ...e, diceNum: 0 } : e))
  p = idx.of({ ...level, effects: strip(level.effects), criticalEffects: strip(level.criticalEffects) })
  OWN_PROFILES.set(level, p)
  return p
}

// ---------------------------------------------------------------------------------------------------------------------
// Ciblage (boss, allié, soi)
// ---------------------------------------------------------------------------------------------------------------------

/** Entités de référence du ciblage (ids et équipes distincts). */
interface Gating {
  caster: Fighter
  ally: Fighter
  boss: Fighter
  anchors: Fighter[]
}

type Who = 'boss' | 'ally' | 'self'

/** Zone « case » (une seule cellule) : la ligne ne touche que l'entité de la case visée. */
function pointZone(zone: { shape: string }, radius: number): boolean {
  return zone.shape === 'P' || radius <= 0
}

/** La ligne (masque, zone, portes) peut-elle toucher `x` (voir l'en-tête) ? */
function affects(g: Gating, mask: string, point: boolean, gates: readonly string[], x: Fighter): boolean {
  if (!matchesTargetMask(mask, g.caster, x)) return false
  const exact = point && !compileTargetMask(mask).addsCaster
  for (const gate of gates) {
    if (exact) {
      if (!matchesTargetMask(gate, g.caster, x)) return false
    } else if (!g.anchors.some(y => matchesTargetMask(gate, g.caster, y))) return false
  }
  return true
}

function whoOf(g: Gating, who: Who): Fighter {
  return who === 'boss' ? g.boss : who === 'ally' ? g.ally : g.caster
}

/**
 * Atteinte d'une ligne : 0 (jamais), 1 (certaine : posture et états de phase actuels, sans condition de branche), 2
 * (BRANCHE : seulement avec des états que la classe pose en combat, ou condition d'état / de PV sur la cible).
 */
type Reach = 0 | 1 | 2

/** Poids des lignes d'une catégorie d'un nœud : certaines 1, branches 1/n (moyenne des alternatives). */
function lineWeights<T>(lines: readonly T[], reach: (x: T) => Reach): Map<T, number> {
  const out = new Map<T, number>()
  const alts = lines.filter(x => reach(x) === 2)
  for (const x of lines) {
    const r = reach(x)
    if (r === 1) out.set(x, 1)
    else if (r === 2) out.set(x, 1 / alts.length)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------------------------------------------------

/** Source d'utilité : un sort racine, ou un sous-sort partagé (dédoublonné). */
interface Source {
  key: string
  name: string
  apCost: number
  /** Lancers par tour au plus (∞ : 99) et par cible (boss). */
  perTurn: number
  perTarget: number
  cooldown: number
  shared: boolean
  /** Par lancer : points tentés (esquivables) et sûrs, par réserve. */
  mpTry: number
  mpSure: number
  apTry: number
  apSure: number
  /** Par lancer : soin d'un allié (PV, critique pondéré) et bouclier. */
  heal: number
  shield: number
}

/** Buff / débuff d'une source (valeur × temps d'effet × poids). */
interface Effect {
  key: UtilityKey
  value: number
  source: string
  src: Source
  /** Lancers par tour qui entretiennent l'effet : 1 / max(1, relance, durée) ; 0 pour une durée infinie. */
  casts: number
}

function emptySource(key: string, name: string, level: SpellLevelData, shared: boolean): Source {
  return {
    key,
    name,
    apCost: level.apCost,
    perTurn: shared ? 1 : level.maxCastPerTurn > 0 ? level.maxCastPerTurn : 99,
    perTarget: shared ? 1 : level.maxCastPerTarget > 0 ? level.maxCastPerTarget : 99,
    cooldown: shared ? 0 : Math.max(level.minCastInterval, level.globalCooldown),
    shared,
    mpTry: 0,
    mpSure: 0,
    apTry: 0,
    apSure: 0,
    heal: 0,
    shield: 0,
  }
}

/** Temps d'effet d'un buff de durée `duration` (tours, < 0 : infini) relancé toutes les `cooldown` tours. */
export function uptime(duration: number, cooldown: number): number {
  if (duration < 0) return 1
  return Math.min(1, Math.max(1, duration) / Math.max(1, cooldown))
}

/** Durée réelle d'un effet : `triggerDuration` pour un buff déclenché (0 ⇒ 1 tour, moteur), sinon `duration`. */
function effectDuration(e: EffectData): number {
  if (isInstant(e)) return e.duration
  const t = e.triggerDuration ?? e.duration
  return t === 0 ? 1 : t
}

/** Valeur d'un 1163 comme le moteur (`modifierMagnitude` : `value` quand les deux dés sont nuls). */
function receivedPct(e: EffectData): number {
  return e.diceNum === 0 && e.diceSide === 0 ? e.value : e.diceNum
}

const meanOf = (lo: number, hi: number): number => (lo + Math.max(lo, hi)) / 2

/** Codes d'un déclencheur (« D|DTE|DTB » → ['D', 'DTE', 'DTB']). */
function triggerCodes(triggers: string): string[] {
  return (triggers || '').split('|').filter(Boolean)
}

/** Nom affiché d'un sort : balises du client (`<sprite name="feu">`) remplacées par « (feu + air) ». */
function cleanName(name: string): string {
  const sprites = [...name.matchAll(/<sprite name="([^"]+)">/g)].map(m => m[1])
  const base = name.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return sprites.length ? `${base} (${sprites.join(' + ')})` : base
}

/**
 * Points retirés espérés sur une réserve `pool` (PM ou PA du boss) : `tries` tentatives esquivables (nombre fractionnaire :
 * interpolation entre les entiers voisins) faites d'abord, sur la réserve pleine — l'ordre que choisit le joueur, chaque
 * tentative ayant plus de chances quand il reste plus de points —, puis `sure` points non esquivables, le tout plafonné
 * à la réserve RÉSULTAT PAR RÉSULTAT : E[min(X + sûrs, réserve)] sur la distribution exacte de X
 * (`apMpRemovalDistribution`), et non min(E[X] + sûrs, réserve) qui surestime quand la réserve est atteinte.
 */
function expectedRemoved(removal: number, dodge: number, pool: number, tries: number, sure: number): number {
  if (pool <= 0) return 0
  const ra = Math.max(0, Math.round(removal))
  const es = Math.max(0, Math.round(dodge))
  const at = (n: number) => {
    const dist = n <= 0 ? [1] : apMpRemovalDistribution(ra, es, pool, pool, Math.min(24, n))
    return dist.reduce((a, p, k) => a + p * Math.min(pool, k + sure), 0)
  }
  const t = Math.max(0, tries)
  const lo = Math.floor(t)
  const hi = Math.ceil(t)
  if (lo === hi) return at(lo)
  return at(lo) + (t - lo) * (at(hi) - at(lo))
}

/** Rotation : lancers par tour amortis (k) par source, et PA consommés par tour. */
interface Rotation {
  casts: { source: Source; k: number }[]
  apSpent: number
}

/**
 * Rotation glouton par valeur / PA (voir l'en-tête) : lancers amortis par source, sur `ap` PA. Cible ennemie : limite de
 * lancers par cible (le boss) ; cible alliée : limite par cible × `allyTargets` (un soin peut viser chaque allié).
 */
function dedicatedRotation(sources: readonly Source[], ap: number, value: (s: Source) => number, enemyTarget: boolean, allyTargets = DEFAULT_ALLY_TARGETS): Rotation {
  const list = sources
    .map((s, i) => ({ s, i, v: value(s) }))
    .filter(x => x.v > 0 && x.s.apCost > 0)
    .sort((x, y) => y.v / y.s.apCost - x.v / x.s.apCost || x.i - y.i)
  const casts: { source: Source; k: number }[] = []
  let budget = ap
  for (const { s } of list) {
    const max = s.cooldown > 0 ? 1 : Math.min(s.perTurn, enemyTarget ? s.perTarget : s.perTarget * Math.max(1, allyTargets))
    const n = Math.min(max, Math.floor(budget / s.apCost + 1e-9))
    if (n <= 0) continue
    const k = n / Math.max(1, s.cooldown)
    budget -= k * s.apCost
    casts.push({ source: s, k })
  }
  return { casts, apSpent: ap - budget }
}

/** Noms des sources d'une rotation, plus forte contribution d'abord. */
function rotationSpells(rot: Rotation, per: (x: Source) => number): string[] {
  return rot.casts
    .map(r => ({ n: r.source.name, v: r.k * per(r.source) }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v || a.n.localeCompare(b.n))
    .map(x => x.n)
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilités d'un personnage
// ---------------------------------------------------------------------------------------------------------------------

export interface ClassUtilitiesOptions {
  /** PV d'un allié de référence (soins en % des PV max). Défaut `REF_ALLY_HP`. */
  refAllyHp?: number
  /** Forme du DPT mesurée (classes.ts) : étiquettes mêlée / distance / rafale. */
  damage?: DamageShape
  /**
   * Réserves du boss qui comptent pour le tour de retrait MIXTE (`removal.combined`) : défaut, celles que le boss a
   * (PM > 0, PA > 0). classes.ts retire une réserve dont le retrait est puni par le boss.
   */
  removalPools?: readonly ('mp' | 'ap')[]
  /** Personnages visables par un soin ou un bouclier dans un tour (défaut `DEFAULT_ALLY_TARGETS`). */
  allyTargets?: number
}

/**
 * Utilités chiffrées de `fighter` (build, variantes, posture dans `fighter.states`) contre le boss `boss` (combattant
 * de bossFighter : PA/PM, esquives et états de la phase). Déterministe ; ne modifie pas les combattants.
 */
export function classUtilities(data: DataStore, fighter: Fighter, boss: Fighter, opts: ClassUtilitiesOptions = {}): ClassUtilities {
  const idx = createSpellProfileIndex(theoryEngine(data))
  const refHp = opts.refAllyHp ?? REF_ALLY_HP
  const s = fighter.stats
  const notes: string[] = []
  const spellName = (id: number) => cleanName(data.spell(id)?.name ?? `Sort ${id}`)

  // ── Sorts lançables (condition d'états du lanceur : posture) ──
  const rootProfiles = idx.ofFighter(fighter)
  const roots = fighter.spells
    .map((ks, i) => ({ ks, p: rootProfiles[i], name: cleanName(fighter.spells[i].name || spellName(fighter.spells[i].spellId)) }))
    .filter(r => !r.ks.isWeapon && checkStatesCriterion(r.p.level.statesCriterion, fighter))
  const blocked = fighter.spells.length - roots.length
  if (blocked > 0) notes.push(`${blocked} sort(s) non lançable(s) dans la posture supposée (condition d'états du lanceur).`)

  // ── États que la classe pose (premier parcours, sans condition) : conditions de branche élargies ──
  const enemyStates = new Set<number>()
  const allyStates = new Set<number>()
  const selfStates = new Set<number>(fighter.states)
  for (const r of roots) {
    for (const n of walkNodes(data, r.p.level)) {
      for (const st of ownProfile(idx, n.level).states) {
        if (st.remove) continue
        if (st.sides.enemy) enemyStates.add(st.stateId)
        if (st.sides.ally) allyStates.add(st.stateId)
        if (st.sides.self || st.sides.selfOnly) selfStates.add(st.stateId)
      }
    }
  }
  const allyBreed = fighter.breedId === 8 ? 9 : 8
  const mkAlly = (states: readonly number[]) => {
    const a = createPlayerFighter(data, { name: 'allié', breedId: allyBreed, level: fighter.level, stats: fighter.baseStats, maxHp: fighter.maxHp, variants: [], spellIds: [], team: 0 })
    a.id = 2
    a.states = [...states]
    return a
  }
  const casterBase: Fighter = { ...fighter, id: 0, team: 0, states: fighter.states.slice(), tags: { ...fighter.tags } }
  const casterRelaxed: Fighter = { ...casterBase, states: [...selfStates] }
  const bossBase: Fighter = { ...boss, id: 1, team: 1, states: boss.states.slice(), tags: { ...boss.tags } }
  const bossRelaxed: Fighter = { ...bossBase, states: [...new Set([...boss.states, ...enemyStates])] }
  const allyBase = mkAlly([])
  const allyRelaxed = mkAlly([...allyStates])
  const gBase: Gating = { caster: casterBase, ally: allyBase, boss: bossBase, anchors: [bossBase, allyBase, casterBase] }
  const gRelaxed: Gating = { caster: casterRelaxed, ally: allyRelaxed, boss: bossRelaxed, anchors: [bossRelaxed, allyRelaxed, casterRelaxed] }
  const reachOf = (mask: string, zone: ZoneSpec, gates: readonly string[], who: Who): Reach => {
    const point = pointZone(zone, zoneRadius(zone))
    if (affects(gBase, mask, point, gates, whoOf(gBase, who))) return branchConditions(mask).length ? 2 : 1
    return affects(gRelaxed, mask, point, gates, whoOf(gRelaxed, who)) ? 2 : 0
  }
  const casters: Casters = { base: casterBase, relaxed: casterRelaxed, applied: new Set([...enemyStates, ...allyStates]) }
  const walks = roots.map(r => walkNodes(data, r.p.level, casters))

  // ── Sous-sorts partagés : atteints par au moins deux sorts racines ──
  const reachedBy = new Map<SpellLevelData, Set<number>>()
  walks.forEach((nodes, ri) => {
    for (const n of nodes) {
      if (n.depth === 0) continue
      let set = reachedBy.get(n.level)
      if (!set) reachedBy.set(n.level, (set = new Set()))
      set.add(ri)
    }
  })
  const sharedLevels = new Set([...reachedBy].filter(([, set]) => set.size >= 2).map(([lvl]) => lvl))

  // ── Sources et effets ──
  const sources = new Map<string, Source>()
  const effects: Effect[] = []
  const counts = { placement: new Set<string>(), summons: new Set<string>(), dispel: new Set<string>(), debuff: new Set<string>() }
  let excludedLines = 0
  let pushOnEnemy = false
  let zoneDamage = false
  let indirect = false
  let glyphOrTrap = false
  let meleeBest = 0
  let rangeBest = 0
  const alsoAllies = new Set<string>()
  const erosionOnAllies = new Set<string>()
  // Une ligne d'un nœud n'est comptée qu'une fois par source (meilleur chemin) : par sort racine, ou une seule fois en
  // tout pour un sous-sort partagé.
  const seen = new Map<string, number>()

  roots.forEach((r, ri) => {
    if (r.p.glyph || r.p.trap) glyphOrTrap = true
    // Dégâts directs du sort racine (étiquettes zone / dégâts indirects / mêlée et distance par défaut).
    const dmgLines = r.p.damage.filter(l => reachOf(l.mask, l.zone, l.gates ?? [], 'boss') > 0)
    const attack = dmgLines.length > 0
    if (dmgLines.length && r.p.apCost > 0) {
      if (dmgLines.some(l => l.dotTurns > 0)) indirect = true
      if (dmgLines.some(l => zoneRadius(l.zone) > 0 && !l.aroundCaster)) zoneDamage = true
      const perAp = r.p.baseDamage / r.p.apCost
      if (r.p.maxRange <= 1) meleeBest = Math.max(meleeBest, perAp)
      else rangeBest = Math.max(rangeBest, perAp)
    }
    for (const node of walks[ri]) {
      const shared = node.depth > 0 && sharedLevels.has(node.level)
      const key = shared ? `shared:${node.level.spellId}:${node.level.grade}` : `root:${r.ks.spellId}`
      let src = sources.get(key)
      if (!src) {
        let name = r.name
        if (shared) {
          const via = [...reachedBy.get(node.level)!].map(i => roots[i].name)
          name = `${spellName(node.level.spellId)} (via ${via.slice(0, 3).join(', ')}${via.length > 3 ? '…' : ''})`
        }
        src = emptySource(key, name, r.p.level, shared)
        sources.set(key, src)
      } else if (shared) src.apCost = Math.min(src.apCost, r.p.apCost)
      const source = src
      const p = ownProfile(idx, node.level)
      const once = (id: string, weight: number): number => {
        // Poids supplémentaire à compter pour cette ligne (le meilleur chemin seulement).
        const k = `${key}|${node.level.spellId}:${node.level.grade}|${id}`
        const prev = seen.get(k) ?? 0
        if (weight <= prev) return 0
        seen.set(k, weight)
        return weight - prev
      }
      const gates = node.gates
      const capOf = (pool: 'ap' | 'mp') => Math.max(0, pool === 'mp' ? boss.stats.mp : boss.stats.ap)
      // Lancers par tour qui entretiennent un effet de durée `duration` (infinie : 0, lancé une fois).
      const castsFor = (duration: number) => (duration < 0 ? 0 : 1 / Math.max(1, source.cooldown, duration))

      // Retraits PA/PM (sur le boss ; plafonnés à sa réserve par lancer ; retraits différés exclus, comme le proxy).
      const removals = p.removals.filter(x => x.delay <= 0)
      for (const [x, lw] of lineWeights(removals, x => reachOf(x.mask, x.zone, gates, 'boss'))) {
        const k = once(`rm${p.removals.indexOf(x)}`, node.weight * lw)
        const v = k * Math.min(capOf(x.pool) || x.value, x.value)
        if (x.pool === 'mp') x.dodgeable ? (source.mpTry += v) : (source.mpSure += v)
        else x.dodgeable ? (source.apTry += v) : (source.apSure += v)
        // Retrait qui frappe aussi les alliés à coup sûr (Retraite Anticipée : « A,g » sur toute la carte) : coût d'équipe
        // signalé (une petite zone ne les touche que s'ils y sont : positions non modélisées).
        if (v > 0 && zoneRadius(x.zone) >= GLOBAL_RADIUS && reachOf(x.mask, x.zone, gates, 'ally')) alsoAllies.add(source.name)
      }
      // Pertes de PA/PM imposées à un allié par un buff (Précipitation de l'Iop : +5 PA puis −3 PA) : retranchées du
      // buff de la même source.
      const allyLoss = p.removals.filter(x => !x.dodgeable && !reachOf(x.mask, x.zone, gates, 'boss'))
      for (const [x, lw] of lineWeights(allyLoss, x => reachOf(x.mask, x.zone, gates, 'ally'))) {
        const k = once(`al${p.removals.indexOf(x)}`, node.weight * lw)
        if (k) effects.push({ key: x.pool === 'ap' ? 'allyAp' : 'allyMp', value: -k * x.value * uptime(x.duration, source.cooldown), source: source.name, src: source, casts: castsFor(x.duration) })
      }
      // Soins (sur un allié), critique pondéré.
      const crit = p.level.criticalEffects.length ? critChance(p.level.critChance, s.critical) / 100 : 0
      for (const [h, lw] of lineWeights(p.heals, h => reachOf(h.mask, h.zone, gates, 'ally'))) {
        const one = (base: number) =>
          h.kind === 'boosted' ? heal(base, s, { element: Math.max(0, h.element) as Element }) : h.kind === 'pctMax' ? (base / 100) * refHp : base
        const v = (1 - crit) * one(meanOf(h.min, h.max)) + crit * one(meanOf(h.critMin, h.critMax))
        source.heal += once(`he${p.heals.indexOf(h)}`, node.weight * lw) * h.p * v
      }
      // Boucliers (sur un allié).
      for (const [x, lw] of lineWeights(p.shields, x => reachOf(x.mask, x.zone, gates, 'ally'))) {
        const v = x.kind === 'flat' ? x.value : x.kind === 'pctLevel' ? shieldFromLevel(fighter.level, x.value) : shieldFromMaxHp(fighter.maxHp, x.value)
        source.shield += once(`sh${p.shields.indexOf(x)}`, node.weight * lw) * v
      }
      // Caractéristiques : buffs alliés (un masque « a,A » suit la cible du sort : buff allié seulement si le sort ne frappe
      // pas — Puissance de l'Iop —, sinon il tombe sur le boss visé).
      const allyStatKey = (stat: keyof Stats): UtilityKey | undefined =>
        stat === 'power' ? 'allyPower' : stat === 'damage' ? 'allyDamage' : stat === 'finalDamagePct' ? 'allyFinalDamage' : stat === 'ap' ? 'allyAp' : stat === 'mp' ? 'allyMp' : undefined
      const buffs = p.stats.filter(x => x.sign > 0 && (!x.sides.enemy || !attack) && allyStatKey(x.stat))
      for (const [x, lw] of lineWeights(buffs, x => reachOf(x.mask, x.zone, gates, 'ally'))) {
        const k = once(`st${p.stats.indexOf(x)}`, node.weight * lw)
        if (k) effects.push({ key: allyStatKey(x.stat)!, value: k * x.value * uptime(x.duration, source.cooldown), source: source.name, src: source, casts: castsFor(x.duration) })
      }
      // Débuffs du boss, retrait de PO, pertes de PA/PM non esquivables portées par une caractéristique.
      const debuffs = p.stats.filter(x => x.sign < 0)
      for (const [x, lw] of lineWeights(debuffs, x => reachOf(x.mask, x.zone, gates, 'boss'))) {
        const k = once(`st${p.stats.indexOf(x)}`, node.weight * lw)
        if (!k) continue
        if (x.stat === 'range') effects.push({ key: 'rangeRemoval', value: k * x.value, source: source.name, src: source, casts: castsFor(x.duration) })
        else if ((x.stat === 'ap' || x.stat === 'mp') && !PCT_AP_MP_LOSS.has(x.effectId)) {
          const v = k * Math.min(capOf(x.stat) || x.value, x.value)
          if (x.stat === 'mp') source.mpSure += v
          else source.apSure += v
        } else if (DEBUFF_STATS.has(x.stat)) counts.debuff.add(source.name)
      }
      // Déplacements du boss.
      for (const m of p.moves) {
        if (m.onCaster || !PLACEMENT_KINDS.has(m.kind) || !reachOf(m.mask, m.zone, gates, 'boss')) continue
        counts.placement.add(source.name)
        if (m.kind === 'push') pushOnEnemy = true
      }
      // Invocations (hors résurrections).
      if (p.summonLines.some(x => !x.revive)) counts.summons.add(source.name)
      // Effets lus directement (absents des listes des profils) : 1163, armure, érosion, désenvoûtement.
      const probs = randomProbabilities(node.level.effects)
      const raw = node.level.effects.filter(e => !e.clientOnly && (e.effectId === RECEIVED || ARMOR.has(e.effectId) || e.effectId === EROSION || DISPEL.has(e.effectId)))
      // Réduction consommée au premier coup : le nœud retire ses propres effets (406 sur lui-même) quand le porteur subit
      // des dommages (Ataraxie).
      const consumed = node.level.effects.some(e => e.effectId === 406 && e.value === node.level.spellId && !isInstant(e) && triggerCodes(e.triggers).includes('D'))
      const perHit = consumed ? 1 / REF_HITS_PER_TURN : 1
      const rawFor = (keep: (e: EffectData) => boolean, who: Who) => lineWeights(raw.filter(keep), e => reachOf(e.targetMask, e.zone, gates, who))
      const push = (key: UtilityKey, e: EffectData, lw: number, v: number) => {
        const k = once(`ef${node.level.effects.indexOf(e)}`, node.weight * lw)
        const prob = e.random > 0 ? (probs.get(e) ?? 0) : 1
        if (k) effects.push({ key, value: k * prob * uptime(effectDuration(e), source.cooldown) * v, source: source.name, src: source, casts: castsFor(effectDuration(e)) })
      }
      for (const [e, lw] of rawFor(e => e.effectId === RECEIVED && receivedPct(e) > 100, 'boss')) push('damageTaken', e, lw, receivedPct(e) - 100)
      const reductions = (e: EffectData) => e.effectId === RECEIVED && receivedPct(e) < 100
      const allyRed = rawFor(reductions, 'ally')
      for (const [e, lw] of allyRed) push('allyReduction', e, lw, (100 - receivedPct(e)) * perHit)
      for (const [e, lw] of rawFor(e => reductions(e) && !allyRed.has(e), 'self')) push('selfReduction', e, lw, (100 - receivedPct(e)) * perHit)
      for (const [e, lw] of rawFor(e => ARMOR.has(e.effectId), 'ally')) push('allyArmor', e, lw, armorReduction(e.diceNum + e.value, fighter.level))
      // Érosion posée sur le boss (toute attaque qu'il subit l'érode davantage : Engine.erosionPercent de la cible), pondérée
      // comme les autres effets (chemin, branche, tirage aléatoire, temps d'effet). Une ligne sur toute l'aire de combat qui
      // touche aussi les alliés (Roulette, carte « La Mort » du Tarot : « a,A » en zone « a ») érode l'équipe : écartée.
      for (const [e, lw] of rawFor(e => e.effectId === EROSION, 'boss')) {
        if (zoneRadius(e.zone) >= GLOBAL_RADIUS && reachOf(e.targetMask, e.zone, gates, 'ally')) erosionOnAllies.add(source.name)
        else push('erosion', e, lw, meanOf(e.diceNum, e.diceSide))
      }
      if (rawFor(e => DISPEL.has(e.effectId), 'boss').size) counts.dispel.add(source.name)
      // Lignes réservées à un monstre précis (invocation de la classe : Fée, Gardien…), écartées : comptées pour les notes.
      for (const list of [p.heals, p.shields, p.stats, p.removals] as { mask: string }[][]) {
        for (const x of list) if ([x.mask, ...gates].some(m => compileTargetMask(m).targetConditions.some(c => c.code === 'F'))) excludedLines++
      }
    }
  })

  // ── Chiffrage par tour ──
  const all = [...sources.values()]
  const ap = Math.max(0, s.ap)
  const allyTargets = opts.allyTargets ?? DEFAULT_ALLY_TARGETS
  const values = Object.fromEntries(UTILITY_KEYS.map(k => [k, { value: 0, spells: [] as string[] }])) as Record<UtilityKey, UtilityValue>
  // Buffs et débuffs : meilleure source (somme des lignes d'une même source ; érosion et PO : meilleure ligne).
  const maxKeys = new Set<UtilityKey>(['erosion', 'rangeRemoval'])
  for (const key of ['damageTaken', 'allyReduction', 'selfReduction', 'allyArmor', 'allyPower', 'allyDamage', 'allyFinalDamage', 'allyAp', 'allyMp', 'erosion', 'rangeRemoval'] as UtilityKey[]) {
    const bySource = new Map<string, number>()
    for (const e of effects) {
      if (e.key !== key) continue
      const prev = bySource.get(e.source) ?? 0
      bySource.set(e.source, maxKeys.has(key) ? Math.max(prev, e.value) : prev + e.value)
    }
    const ranked = [...bySource].filter(x => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    values[key] = { value: ranked[0]?.[1] ?? 0, spells: ranked.map(x => x[0]) }
  }
  for (const key of ['placement', 'summons', 'dispel', 'debuff'] as const) {
    const names = [...counts[key]].sort((a, b) => a.localeCompare(b))
    values[key] = { value: names.length, spells: names }
  }

  // Retraits : par réserve, rotation CONSACRÉE à cette réserve (`values.mpRemoved` / `apRemoved`, étiquettes, règle
  // « Retrait PM » de la composition : meilleure de deux gloutons, points bruts ou points pondérés par la chance du
  // premier point — sûrs : 1 —) ; et tour MIXTE (`removal.combined`, axe Contrôle) : UN budget de PA pour les réserves
  // qui comptent, meilleure de trois rotations (glouton pondéré sur ces réserves, rotation PM seule, rotation PA seule),
  // chacune évaluée sur les deux réserves.
  const reserveOf = (pool: 'mp' | 'ap') => Math.max(0, pool === 'mp' ? boss.stats.mp : boss.stats.ap)
  const tryOf = (pool: 'mp' | 'ap', x: Source) => (pool === 'mp' ? x.mpTry : x.apTry)
  const sureOf = (pool: 'mp' | 'ap', x: Source) => (pool === 'mp' ? x.mpSure : x.apSure)
  const removalOf = (pool: 'mp' | 'ap') => (pool === 'mp' ? s.mpReduction : s.apReduction)
  const dodgeOf = (pool: 'mp' | 'ap') => (pool === 'mp' ? boss.stats.mpParry : boss.stats.apParry)
  const sumRot = (rot: Rotation, per: (x: Source) => number) => rot.casts.reduce((a, r) => a + r.k * per(r.source), 0)
  const removedIn = (pool: 'mp' | 'ap', rot: Rotation) =>
    expectedRemoved(removalOf(pool), dodgeOf(pool), reserveOf(pool), sumRot(rot, x => tryOf(pool, x)), sumRot(rot, x => sureOf(pool, x)))
  const removal: ClassUtilities['removal'] = { mp: { attempted: 0, sure: 0 }, ap: { attempted: 0, sure: 0 }, combined: { mp: 0, ap: 0, apSpent: 0, spells: [] } }
  const first = (pool: 'mp' | 'ap') => apMpRemovalProbability(Math.max(0, Math.round(removalOf(pool))), Math.max(0, Math.round(dodgeOf(pool))), reserveOf(pool), reserveOf(pool))
  const dedicated: Record<'mp' | 'ap', Rotation> = { mp: { casts: [], apSpent: 0 }, ap: { casts: [], apSpent: 0 } }
  for (const pool of ['mp', 'ap'] as const) {
    const per = (x: Source) => tryOf(pool, x) + sureOf(pool, x)
    const raw = dedicatedRotation(all, ap, per, true)
    const weighted = dedicatedRotation(all, ap, x => first(pool) * tryOf(pool, x) + sureOf(pool, x), true)
    const rot = (dedicated[pool] = removedIn(pool, weighted) > removedIn(pool, raw) + 1e-12 ? weighted : raw)
    removal[pool] = { attempted: sumRot(rot, x => tryOf(pool, x)), sure: sumRot(rot, x => sureOf(pool, x)) }
    values[pool === 'mp' ? 'mpRemoved' : 'apRemoved'] = { value: removedIn(pool, rot), spells: rotationSpells(rot, per) }
  }
  const pools = (opts.removalPools ?? (['mp', 'ap'] as const)).filter(p => reserveOf(p) > 0)
  if (pools.length) {
    const weighted = (x: Source) => pools.reduce((a, p) => a + first(p) * tryOf(p, x) + sureOf(p, x), 0)
    const candidates = [dedicatedRotation(all, ap, weighted, true), dedicated.mp, dedicated.ap]
    const total = (rot: Rotation) => pools.reduce((a, p) => a + removedIn(p, rot), 0)
    const best = candidates.reduce((a, b) => (total(b) > total(a) + 1e-12 ? b : a))
    removal.combined = {
      mp: pools.includes('mp') ? removedIn('mp', best) : 0,
      ap: pools.includes('ap') ? removedIn('ap', best) : 0,
      apSpent: best.apSpent,
      spells: rotationSpells(best, x => pools.reduce((a, p) => a + tryOf(p, x) + sureOf(p, x), 0)),
    }
  }

  // Soins et boucliers : rotation consacrée à chacun (`values.heal` / `shield`), et tour MIXTE (`care`, axe Soin) : un
  // budget de PA ; les sources des meilleures réduction et armure alliées sont entretenues d'abord (1 / max(relance,
  // durée) lancer par tour, leurs propres soins et boucliers compris), le reste des PA va au glouton soin + bouclier.
  const healRot = dedicatedRotation(all, ap, x => x.heal, false, allyTargets)
  values.heal = { value: sumRot(healRot, x => x.heal), spells: rotationSpells(healRot, x => x.heal) }
  const shieldRot = dedicatedRotation(all, ap, x => x.shield, false, allyTargets)
  values.shield = { value: sumRot(shieldRot, x => x.shield), spells: rotationSpells(shieldRot, x => x.shield) }
  const reserved = new Map<Source, number>()
  for (const key of ['allyReduction', 'allyArmor'] as const) {
    const lines = effects.filter(e => e.key === key && e.source === values[key].spells[0])
    if (!lines.length) continue
    reserved.set(lines[0].src, Math.max(reserved.get(lines[0].src) ?? 0, ...lines.map(e => e.casts)))
  }
  const reservedAp = [...reserved].reduce((a, [x, k]) => a + k * x.apCost, 0)
  const careRot = dedicatedRotation(all.filter(x => !reserved.has(x)), Math.max(0, ap - reservedAp), x => x.heal + x.shield, false, allyTargets)
  const careAll: Rotation = { casts: [...[...reserved].map(([source, k]) => ({ source, k })), ...careRot.casts], apSpent: reservedAp + careRot.apSpent }
  const care: ClassUtilities['care'] = {
    heal: sumRot(careAll, x => x.heal),
    shield: sumRot(careAll, x => x.shield),
    apSpent: careAll.apSpent,
    // Contributions soin + bouclier d'abord, puis les sources de réduction / armure entretenues.
    spells: [...new Set([...rotationSpells(careAll, x => x.heal + x.shield), ...[...reserved.keys()].map(x => x.name)])],
  }

  const offensiveGain = offensiveGainOf(values)

  // ── Étiquettes ──
  const tags = new Set<UtilityTag>()
  const T = TAG_THRESHOLDS
  if (removal.mp.attempted + removal.mp.sure >= T.removal) tags.add('mp-removal')
  if (removal.ap.attempted + removal.ap.sure >= T.removal) tags.add('ap-removal')
  if (values.rangeRemoval.value > 0) tags.add('range-removal')
  if (values.heal.value >= T.heal) tags.add('heal')
  if (values.shield.value >= T.shield) tags.add('shield')
  if (values.allyReduction.value >= T.reduction || values.allyArmor.value >= T.armor) tags.add('damage-reduction')
  if (values.placement.value > 0) tags.add('placement')
  if (pushOnEnemy) tags.add('push-damage')
  if (values.summons.value > 0) tags.add('summons')
  if (values.debuff.value > 0 || values.dispel.value > 0) tags.add('debuff')
  if (values.erosion.value >= T.erosion) tags.add('erosion')
  if (values.allyAp.value > 0 || values.allyMp.value > 0) tags.add('ally-ap-mp')
  if (values.allyPower.value > 0 || values.allyDamage.value > 0 || values.allyFinalDamage.value > 0) tags.add('ally-damage')
  if (values.damageTaken.value >= T.damageTaken) tags.add('damage-taken-debuff')
  if (zoneDamage) tags.add('zone')
  if (indirect || glyphOrTrap) tags.add('indirect-damage')
  const shape = opts.damage
  if (shape) {
    if (shape.meleeShare >= T.melee) tags.add('melee')
    if (shape.rangeShare >= T.range) tags.add('range')
    if (shape.burstRatio >= T.burst) tags.add('burst')
  } else {
    const best = Math.max(meleeBest, rangeBest)
    if (best > 0 && meleeBest >= 0.75 * best) tags.add('melee')
    if (best > 0 && rangeBest >= 0.75 * best) tags.add('range')
  }
  const elemental = [Element.Earth, Element.Fire, Element.Water, Element.Air].map(el => s[ELEMENT_MAIN_STAT[el]]).sort((a, b) => b - a)
  if (elemental[0] > 0 && elemental[1] >= T.multiElement * elemental[0]) tags.add('multi-element')
  if ((s.apParry + s.mpParry) / 2 >= T.dodge) tags.add('dodge')

  // ── Notes ──
  const sharedUsed = all.filter(x => x.shared && (x.mpTry + x.mpSure + x.apTry + x.apSure + x.heal + x.shield > 0 || effects.some(e => e.source === x.name)))
  if (sharedUsed.length) notes.push(`Sous-sorts partagés dédoublonnés (au plus une fois par tour) : ${sharedUsed.map(x => x.name).slice(0, 4).join(' ; ')}${sharedUsed.length > 4 ? '…' : ''}.`)
  if (excludedLines) notes.push(`${excludedLines} ligne(s) réservée(s) à un monstre précis (invocation de la classe…) écartée(s) : invocations non modélisées.`)
  if (glyphOrTrap) notes.push('Glyphes et pièges : effets posés au sol non chiffrés (dégâts et utilités hors calcul).')
  if (values.summons.value) notes.push('Invocations : comptées en nombre de sorts, leurs dégâts et utilités ne sont pas chiffrés.')
  if (boss.stats.mp <= 0) notes.push('Le boss n\'a pas de PM : retrait PM sans valeur.')
  if (alsoAllies.size) notes.push(`Retrait qui touche aussi les alliés (coût d'équipe non compté) : ${[...alsoAllies].sort((a, b) => a.localeCompare(b)).join(', ')}.`)
  if (erosionOnAllies.size) notes.push(`Érosion de zone qui touche aussi les alliés, écartée : ${[...erosionOnAllies].sort((a, b) => a.localeCompare(b)).join(', ')}.`)

  return {
    breedId: fighter.breedId ?? 0,
    states: fighter.states.slice(),
    values,
    removal,
    care,
    offensiveGain,
    ...(shape ? { damage: { ...shape } } : {}),
    tags: [...tags].sort(),
    notes,
  }
}

/**
 * Apport offensif à un allié de référence (voir l'en-tête) : % de dégâts gagnés, décomposé par source (« dommages
 * subis », % finaux, Puissance, Dommages, PA ; les PM ne comptent pas).
 */
export function offensiveGainOf(values: Readonly<Record<UtilityKey, UtilityValue>>): ClassUtilities['offensiveGain'] {
  const parts = [
    { label: '« dommages subis » sur le boss', pct: values.damageTaken.value },
    { label: '% dommages finaux', pct: values.allyFinalDamage.value },
    { label: 'Puissance', pct: (values.allyPower.value * 100) / (100 + REF_ALLY_POWER) },
    { label: 'Dommages', pct: (values.allyDamage.value * 100) / (REF_BASE_HIT * (1 + REF_ALLY_POWER / 100)) },
    { label: 'PA', pct: (values.allyAp.value * 100) / REF_ALLY_AP },
  ].filter(x => x.pct > 0)
  return { total: parts.reduce((a, x) => a + x.pct, 0), parts }
}

/**
 * Fusion des utilités d'un même personnage dans plusieurs postures (masques du Zobal, Armé / Désarmé…) : pour chaque
 * utilité, la meilleure posture (le joueur change de posture pour l'utiliser ; coût du changement non compté) ; étiquettes
 * réunies ; `states` et forme du DPT de la première (posture retenue pour le DPT). `labels` : noms des postures (notes).
 */
export function mergeUtilities(list: readonly ClassUtilities[], labels: readonly string[]): ClassUtilities {
  if (list.length <= 1) return list[0]
  const best = (score: (u: ClassUtilities) => number) => list.reduce((a, b, i) => (score(b) > score(list[a]) ? i : a), 0)
  const from = new Set<number>()
  const values = Object.fromEntries(
    UTILITY_KEYS.map(k => {
      const i = best(u => u.values[k].value)
      if (list[i].values[k].value > list[0].values[k].value) from.add(i)
      return [k, { value: list[i].values[k].value, spells: list[i].values[k].spells.slice() }]
    }),
  ) as Record<UtilityKey, UtilityValue>
  const iMp = best(u => u.values.mpRemoved.value)
  const iAp = best(u => u.values.apRemoved.value)
  const iMix = best(u => u.removal.combined.mp + u.removal.combined.ap)
  const iCare = best(u => u.care.heal + u.care.shield)
  for (const i of [iMix, iCare]) if (i !== 0) from.add(i)
  const notes = [...new Set(list.flatMap(u => u.notes))]
  if (from.size) notes.unshift(`Utilités prises dans la meilleure posture : ${[...from].map(i => `« ${labels[i]} »`).join(', ')} (changement de posture non compté).`)
  const mix = list[iMix].removal.combined
  const care = list[iCare].care
  return {
    breedId: list[0].breedId,
    states: list[0].states.slice(),
    values,
    removal: { mp: { ...list[iMp].removal.mp }, ap: { ...list[iAp].removal.ap }, combined: { ...mix, spells: mix.spells.slice() } },
    care: { ...care, spells: care.spells.slice() },
    offensiveGain: offensiveGainOf(values),
    ...(list[0].damage ? { damage: { ...list[0].damage } } : {}),
    tags: [...new Set(list.flatMap(u => u.tags))].sort(),
    notes,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pertinence contre le boss
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Mécanique du boss → utilités qui y répondent (`counters`) ou qu'elle neutralise / punit (`punishes`), avec une phrase
 * d'explication. Combinée aux `counters`/`punishes` propres à chaque mécanique du profil (bossProfile.ts, fiche manuelle).
 */
export const MECHANIC_RELEVANCE: Readonly<Record<MechanicKind, { counters: UtilityTag[]; punishes: UtilityTag[]; note: string }>> = {
  invulnerable: { counters: ['burst'], punishes: [], note: 'invulnérable par moments : la fenêtre de vulnérabilité récompense la rafale' },
  'invulnerable-melee': { counters: ['range'], punishes: ['melee'], note: 'invulnérable au contact : seuls les coups à distance comptent' },
  'invulnerable-range': { counters: ['melee'], punishes: ['range'], note: 'invulnérable à distance : seuls les coups de mêlée comptent' },
  'reduced-range': { counters: ['melee'], punishes: ['range'], note: 'dommages à distance réduits : la mêlée est favorisée' },
  'reduced-melee': { counters: ['range'], punishes: ['melee'], note: 'dommages en mêlée réduits : la distance est favorisée' },
  'damage-taken': { counters: [], punishes: [], note: 'multiplicateur de dommages subis du boss : même effet pour toutes les classes' },
  'final-damage': { counters: ['shield', 'damage-reduction', 'heal'], punishes: [], note: 'le boss frappe plus fort : protections et soins valent plus' },
  'res-change': { counters: ['multi-element'], punishes: [], note: 'résistances changeantes : plusieurs éléments dans l\'équipe' },
  'extreme-res': { counters: ['multi-element'], punishes: [], note: 'résistances extrêmes à faire tomber : il faut plusieurs éléments' },
  reflect: { counters: ['indirect-damage'], punishes: ['burst'], note: 'renvoi : les gros coups directs se retournent, poisons et pièges non' },
  erosion: { counters: ['shield', 'damage-reduction'], punishes: ['heal'], note: 'érosion subie : boucliers et réductions plutôt que soin' },
  'hp-based-damage': { counters: ['shield', 'damage-reduction'], punishes: [], note: 'dégâts en % de PV : boucliers et réductions comptent plus que les résistances' },
  'ap-mp-removal': { counters: ['dodge', 'ally-ap-mp'], punishes: [], note: 'retraits PA/PM subis : esquive et +PA/+PM alliés' },
  'range-removal': { counters: ['melee'], punishes: ['range'], note: 'retrait de PO subi : la mêlée en souffre moins' },
  'punished-removal': { counters: [], punishes: ['mp-removal', 'ap-removal'], note: 'retrait PA/PM puni par le boss : retrait pénalisé' },
  pacifist: { counters: ['summons', 'indirect-damage'], punishes: [], note: 'états Pacifiste : invocations et dégâts indirects frappent encore' },
  incurable: { counters: ['shield', 'damage-reduction'], punishes: ['heal'], note: 'insoignable : boucliers et réductions remplacent le soin' },
  'cant-be-moved': { counters: [], punishes: ['placement', 'push-damage'], note: 'indéplaçable : placement et dommages de poussée sans valeur' },
  'push-resource': { counters: ['placement', 'push-damage'], punishes: [], note: 'la poussée sert la mécanique : placeurs utiles' },
  summons: { counters: ['zone'], punishes: [], note: 'le boss invoque : la zone touche aussi ses invocations' },
  'boss-heal': { counters: ['erosion', 'burst'], punishes: [], note: 'le boss se soigne : érosion et rafale' },
  'boss-shield': { counters: ['debuff', 'burst'], punishes: [], note: 'bouclier du boss : désenvoûtement et rafale' },
  marks: { counters: [], punishes: [], note: 'glyphes ou pièges du boss : se placer hors de leurs zones (positions non modélisées, aucune réponse de classe chiffrée)' },
  phases: { counters: ['burst'], punishes: [], note: 'phases : la rafale au bon tour compte plus que le soutenu' },
  'mp-cost': { counters: ['range'], punishes: [], note: 'chaque PM utilisé coûte : jouer statique, à distance' },
  other: { counters: [], punishes: [], note: 'mécanique non classée : voir son résumé' },
}

/**
 * Étiquettes qui ne valent que si le personnage frappe le boss (style, rafale, zone, dégâts indirects, poussée,
 * multi-élément). L'érosion, les « dommages subis », les débuffs et les retraits restent : ce sont des effets posés sur le
 * boss qui servent toute l'équipe (l'érosion vaut pour tous les dégâts qu'il subit, Engine.erosionPercent de la cible),
 * même quand l'invulnérabilité annule les dégâts du lanceur (le moteur n'annule que les dégâts).
 */
export const DAMAGE_TAGS: ReadonlySet<UtilityTag> = new Set<UtilityTag>(['melee', 'range', 'zone', 'burst', 'indirect-damage', 'push-damage', 'multi-element'])

/**
 * Réponses portées par les mécaniques des DONNÉES (bossProfile.ts) que la pertinence n'accepte pas : déplacer le boss
 * (« placement ») ne l'empêche pas de poser ses glyphes et pièges, ni n'aide l'équipe à les éviter.
 */
const REJECTED_DATA_COUNTERS: Readonly<Partial<Record<MechanicKind, readonly UtilityTag[]>>> = { marks: ['placement'] }

/** Seuil (en %) sous lequel une mécanique « % dommages finaux » du boss est jugée anecdotique pour la pertinence. */
export const FINAL_DAMAGE_MIN_PCT = 10

/** Plus grande valeur absolue citée dans le résumé d'une mécanique (« % Dommages finaux : +2 à +10 » → 10), sinon ∞. */
function summaryMagnitude(summary: string): number {
  const nums = [...summary.matchAll(/[+−-]?\d+(?:[.,]\d+)?/g)].map(m => Math.abs(Number(m[0].replace('−', '-').replace(',', '.'))))
  return nums.length ? Math.max(...nums) : Infinity
}

export interface RelevanceOptions {
  /**
   * Le personnage frappe-t-il ce boss (DPT soutenu, ou DPT « résistances levées », > 0) ? Faux : pas d'atout lié aux
   * dégâts (`DAMAGE_TAGS`) et une limite « ne touche pas le boss ». Défaut vrai.
   */
  dealsDamage?: boolean
}

/**
 * Atouts et limites d'un personnage contre un boss : pour chaque mécanique du profil, les utilités présentes (`tags`)
 * qui y répondent (atouts) ou qu'elle punit (limites), avec la phrase de `MECHANIC_RELEVANCE` ; plus deux règles de
 * caractéristiques du boss (aucun PM ⇒ retrait PM inutile ; esquive PM/PA qui ramène le retrait à moins d'un point).
 * Une mécanique « % dommages finaux » sous `FINAL_DAMAGE_MIN_PCT` est ignorée (bruit) ; un personnage qui ne frappe
 * pas le boss (`dealsDamage` faux) n'a pas d'atout lié aux dégâts.
 */
export function relevance(profile: BossProfile, utilities: ClassUtilities, opts: RelevanceOptions = {}): Relevance {
  const tags = new Set(utilities.tags)
  const hits = opts.dealsDamage !== false
  const atouts: string[] = []
  const limites: string[] = []
  const add = (list: string[], text: string) => {
    if (!list.includes(text)) list.push(text)
  }
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  if (!hits) add(limites, 'Ne touche pas le boss — DPT soutenu nul contre lui : seuls ses apports hors dégâts comptent.')
  for (const m of profile.mechanics) {
    if (m.kind === 'final-damage' && summaryMagnitude(m.summary) < FINAL_DAMAGE_MIN_PCT) continue
    const rel = MECHANIC_RELEVANCE[m.kind] ?? MECHANIC_RELEVANCE.other
    const rejected = m.source === 'data' ? (REJECTED_DATA_COUNTERS[m.kind] ?? []) : []
    const counters = [...new Set([...rel.counters, ...(m.counters ?? []).filter(t => !rejected.includes(t))])]
    // Retrait puni : la mécanique dit quelle réserve est punie (déclencheur MPA ou APA) ; sinon PA et PM.
    const punishes = m.kind === 'punished-removal' && m.punishes?.length ? [...m.punishes] : [...new Set([...rel.punishes, ...(m.punishes ?? [])])]
    for (const t of counters) if (tags.has(t) && !punishes.includes(t) && (hits || !DAMAGE_TAGS.has(t))) add(atouts, `${cap(UTILITY_TAG_LABELS[t])} — ${rel.note}.`)
    // Mêlée / distance : pas une limite si le personnage a aussi le style qui répond à la mécanique (il s'adapte).
    const adapts = counters.some(c => tags.has(c))
    for (const t of punishes) if (tags.has(t) && !(adapts && (t === 'melee' || t === 'range'))) add(limites, `${cap(UTILITY_TAG_LABELS[t])} — ${rel.note}.`)
  }
  const punished = (tag: UtilityTag) => profile.mechanics.some(m => m.kind === 'punished-removal' && (m.punishes?.length ? m.punishes : MECHANIC_RELEVANCE['punished-removal'].punishes).includes(tag))
  if (tags.has('mp-removal') && profile.mp <= 0) add(limites, 'Retrait PM — le boss n\'a pas de PM.')
  else if (tags.has('mp-removal') && !punished('mp-removal') && utilities.values.mpRemoved.value < 1)
    add(limites, `Retrait PM — moins d'un PM retiré par tour contre l'esquive PM du boss (${profile.mpParry}).`)
  if (tags.has('ap-removal') && profile.ap > 0 && !punished('ap-removal') && utilities.values.apRemoved.value < 1)
    add(limites, `Retrait PA — moins d'un PA retiré par tour contre l'esquive PA du boss (${profile.apParry}).`)
  return { atouts, limites }
}

// ---------------------------------------------------------------------------------------------------------------------
// Limites du modèle par classe et confiance
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Mécaniques de classe que le DPT et les utilités NE modélisent PAS (section « [À modéliser] » de la carte des sorts de
 * classe ; docs/research/classes/*.md), par classe (ids DofusDB). La première entrée donne le niveau de confiance de la
 * classe (`CLASS_CONFIDENCE`) : 'haute' quand l'essentiel des dégâts passe par des sorts directs, 'basse' quand une
 * source de dégâts centrale (invocations, glyphes, pièges, bombes, tourelles, portails, infection) est hors calcul.
 */
export const CLASS_MODEL_LIMITS: Readonly<Record<number, string[]>> = {
  1: [
    'Glyphes élémentaires (dégâts de zone sur 2 tours au début du tour des ennemis) : DPT principal du Féca, hors calcul.',
    'Déclenchement manuel des glyphes (Transhumance, Mise en Garde), glyphes-auras, armures élémentaires selon le glyphe.',
    'Invulnérabilités (Barricade, Bastion) et interception (Égide) non chiffrées.',
  ],
  2: [
    'Invocations qui frappent (héritage de caractéristiques, 6 PI) : dégâts principaux de l\'Osamodas, hors calcul.',
    'Martinet, Pacte Bestial (sacrifices : +3/6/9 % finaux), Cortège Sauvage.',
  ],
  3: [
    'États convertisseurs (Monnaie Sonnante, Orpaillage, Éboulement, Coup de Grisou) : dégâts déclenchés par les retraits et soins de tout le groupe.',
    'Tourbière, Tunnel de Fortune, Avarice (bonus selon PM utilisés ou entités), objets animés qui frappent.',
  ],
  4: [
    'Pièges (dégâts indirects sans critique, le boss doit entrer dans la zone) et leurs compteurs (Chausse-trappe, Perfidie, Marque Mortuaire).',
    'Poisons sur plusieurs tours (heuristique ×0,8 sur 2 tours), Double et Comploteur (explosions), invisibilité.',
  ],
  5: [
    'Téléfrag (bonus de dégâts de base et +2 PA) : dépend du placement et d\'un partenaire, hors calcul.',
    'Synchro, Sablier et Gousset (explosions différées), Complice (renvoi), économie de PA variable.',
  ],
  6: [
    'Cartes et Mains Gagnantes (Bluff, Rekop) : dépendent de la séquence des sorts.',
    'Tarot et Roulette (effets globaux aléatoires, ennemis compris) ; 18 sorts aléatoires pris en espérance.',
  ],
  7: [
    'Dégâts et soins miroirs (même jet) et paliers (Chœur Strident, Mot Secret) ; Fées et Feux Follets (invocations).',
    'La valeur de la classe est surtout en soin et boost : son DPT n\'est pas son axe principal.',
  ],
  8: [
    'Rampes : Fureur (+20/+40 si relancée), Colère de Iop (+110 au retour de relance), Pugilat, Accumulation, Tumulte.',
    'Tempête de Puissance (2 cibles), Zénith (selon les PM restants), Sentence, Épée du Jugement (différés).',
  ],
  9: [
    'Rampes auto-cumulatives (Glacée, Immobilisation, Punitive, Expiation, Rédemption…) et paliers de Flèche Dévorante.',
    'États de position (Évasive, Assaillante, Sentinelle), Boomerang, Fulminante (rebonds selon le nombre d\'ennemis).',
  ],
  10: [
    'Infection et propagation (nulle contre un boss seul, forte avec des adds), Poupées (Sacrifiée qui explose).',
    'Sacrifices d\'invocation (Sacrifice Vaudou), Chardons Ardents, Fétiches Calcinés, arbres.',
  ],
  11: [
    'Souffrance : paliers selon les PV restants (dommages finaux +1 à +30 %, subis ×0,99 à ×0,70) — PV supposés pleins pour le DPT.',
    'Sacrifices de PV (Mutilation, Libation, Berserk), dégâts en % des PV, renvoi selon les dégâts du boss.',
  ],
  12: [
    'Porter / jeter (dégâts à l\'impact, un boss se porte rarement), Paume Explosive (coût croissant), Distillation.',
    'Saoul expire après 2 tours (entretien non compté) ; Tonneaux, Main de Pandawa (riposte).',
  ],
  13: [
    'Bombes et Combo (×1 à ×4,6), explosions en chaîne, murs : DPT principal du Roublard, hors calcul.',
    'Bombe Collante, Oblitération (bonus par explosion).',
  ],
  14: [
    'Changement de masque (1 PA, relance 2) non compté ; Mascarade (% des PV), Transfiguration selon le masque.',
    'Bonus des masques (+10 % mêlée / distance, +1 PM) non comptés.',
  ],
  15: [
    'Tourelles (6 types, évolution I→III, vols 30-34 ×3/tour) : DPT principal du Steamer, hors calcul.',
    'Marée Basse / Haute (+3 PA et +1 lancer), PA remboursés près d\'une tourelle.',
  ],
  16: [
    'Portails : bonus +2 % par case de réseau (souvent +20 à +40 %) et passif +2 % finaux par projection, hors calcul.',
    'Tirs hors ligne de vue, téléportation du groupe.',
  ],
  17: [
    'États élémentaires et combinaisons : rotation qui alterne les éléments non modélisée (combinaisons comptées au plus une fois par tour dans les utilités).',
    'Runes (Runification, Manifestation, Surcharge Runique), Torrent Arcanique, Gardien Élémentaire.',
  ],
  18: [
    'Cycle de Rage → Forme Bestiale (+20 % finaux, +2 PM) : phases évaluées séparément, sans moyenne de cycle.',
    'Proie (une seule : Os à Moelle, Muselière, Dépouille), Roquet (invocation), Vertèbre (poison).',
  ],
  20: [
    'Lance Immortelle posée (zones centrées sur la Lance, Reprise de Volée, rappel +30 Puissance) : position non modélisée.',
    'Javelot-foudre et Muspel (selon le nombre d\'ennemis), Noa (dommages de poussée), Éclipse (différé), Holmgang.',
  ],
}

/** Confiance de base par classe (voir `CLASS_MODEL_LIMITS`). */
export const CLASS_CONFIDENCE: Readonly<Record<number, Confidence>> = {
  1: 'basse', 2: 'basse', 3: 'haute', 4: 'basse', 5: 'moyenne', 6: 'moyenne', 7: 'haute', 8: 'moyenne', 9: 'moyenne',
  10: 'basse', 11: 'moyenne', 12: 'moyenne', 13: 'basse', 14: 'moyenne', 15: 'basse', 16: 'basse', 17: 'moyenne',
  18: 'moyenne', 20: 'moyenne',
}

const CONF_ORDER: readonly Confidence[] = ['basse', 'moyenne', 'haute']

/**
 * Confiance d'une évaluation : celle de la classe, abaissée d'un cran par chaque raison propre au personnage (posture
 * incertaine, rôle d'invocateur, DPT nul). Raisons : limites de la classe, puis raisons propres.
 */
export function classConfidence(breedId: number, extra: { reasons?: string[]; downgrade?: number } = {}): { level: Confidence; reasons: string[] } {
  const base = CLASS_CONFIDENCE[breedId] ?? 'moyenne'
  const level = CONF_ORDER[Math.max(0, CONF_ORDER.indexOf(base) - (extra.downgrade ?? 0))]
  return { level, reasons: [...(CLASS_MODEL_LIMITS[breedId] ?? []), ...(extra.reasons ?? [])] }
}
