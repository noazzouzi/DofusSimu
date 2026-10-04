/**
 * Dégâts directs des sorts et armes — pipeline DoMath (`Rg`, docs/research/formulas.md §3.1-3.2), à l'identique.
 *
 * Ordre (mode `domath`, par jet entier `base`) :
 *   (1) trunc(base + base × max(0, puissance + carac) / 100)
 *   (2) + dommages fixes de l'élément + dommages + (dommages critiques si CC) ; < 0 ⇒ 0
 *  (2b) × (100 + maîtrise d'arme) / 100 (armes, client Dofus 3 ; identité à 0, absente de DoMath)
 *   (3) × efficacité de zone × bonus portail, une seule trunc
 *   (4) − résistances fixes (+ résistances critiques si CC, + armure) ; < 0 ⇒ 0
 *   (5) × (1 − %rés élémentaire / 100), trunc (plafond 50 % joueur / 100 % monstre appliqué en amont)
 *   (6) × dommages subis / 100 ; (7) × (100 + %finaux) / 100 ; (8) × (100 + %sorts|%armes) / 100 ;
 *   (9) × (100 + %distance|%mêlée) / 100 — trunc à chaque étape
 *  (10) × (1 − %rés sorts|armes / 100) × (1 − %rés distance|mêlée / 100), une seule trunc
 * Le résultat final est borné à 0 (le client D3 fait `MinimizeBy(0)` ; DoMath pourrait rendre un négatif).
 *
 * L'option `order: 'dofus3'` applique les multiplicateurs (6)-(10) dans l'ordre du module Haxe de Dofus 3
 * (§3.5 : sorts|armes, distance|mêlée, reçus sorts|armes, reçus distance|mêlée, finaux, subis — un arrondi
 * par facteur). Elle n'est pas la référence : écarts de 0 à 2 points.
 *
 * Performances : `prepareDamage` résout une fois les caractéristiques (objet réutilisable), puis
 * `rollPrepared` calcule un jet sans aucune allocation. `damageRoll` réutilise un objet interne.
 */
import {
  Element,
  ELEMENT_FIXED_DAMAGE,
  ELEMENT_MAIN_STAT,
  ELEMENT_NAMES_FR,
  ELEMENT_RES_FIXED,
  ELEMENT_RES_PCT,
  type Stats,
} from '../core/types'
import type { DamageMode } from './math'

export type DamageOrder = 'domath' | 'dofus3'

/** Plafond des % de résistance élémentaire d'un personnage joueur (AS3 / port D3 `MaxResistHuman`). */
export const PLAYER_RES_CAP = 50
/** Plafond des % de résistance d'un monstre (port D3 `MaxResistMonster` ; aucun plafond dans le client D2). */
export const MONSTER_RES_CAP = 100
/** Dégressivité par palier de zone par défaut (DoMath : 10 % pour un sort, 25 % pour une arme). */
export const SPELL_AREA_STEP_PCT = 10
export const WEAPON_AREA_STEP_PCT = 25
/** Paliers de dégressivité maximum par défaut des zones DofusDB (`maxDamageDecreaseApplyCount`). */
export const DEFAULT_AREA_MAX_STEPS = 4

export interface DamageInput {
  attacker: Stats
  defender: Stats
  /** Élément du dégât (résoudre « meilleur » / « pire » élément avec `bestElement` / `worstElement`). */
  element: Element
  /** Coup critique : + dommages critiques du lanceur, − résistances critiques de la cible. */
  crit: boolean
  /** Arme (sinon sort) : choisit % dommages d'armes / sorts, puissance d'arme / de sort, maîtrise d'arme. */
  isWeapon: boolean
  /** Mêlée (sinon distance) : choisit % dommages mêlée / distance et % résistances mêlée / distance. */
  isMelee: boolean
  /** La cible est un personnage joueur : % résistances élémentaires plafonnés à 50. */
  defenderIsPlayer: boolean
  /** Paliers de dégressivité (distance au centre de la zone, déjà corrigée du rayon minimal). Défaut 0. */
  areaSteps?: number
  /** Dégressivité par palier en % (zone DofusDB `damageDecreaseStepPercent`). Défaut : 10 (sort) / 25 (arme). */
  areaStepPct?: number
  /** Nombre maximal de paliers (zone DofusDB `maxDamageDecreaseApplyCount`). Défaut : illimité (DoMath). */
  areaMaxSteps?: number
  /**
   * Efficacité de zone directe (0..1), à la place de `areaSteps`. En mode `integer` elle est arrondie au %
   * près. Préférer `areaSteps` pour reproduire exactement les flottants de DoMath.
   */
  efficiency?: number
  /** Distance parcourue entre portails, en cases (champ « Redirection » de DoMath, +2 % par case). */
  portalCells?: number
  /** Bonus de base du portail en % (client D2 `getPortalsSpellEfficiencyBonus`) — INCERTAIN pour Dofus 3. */
  portalBonusPct?: number
  /** Dommages subis ×N % de la cible (buffs 1163, produit déjà calculé). Défaut 100. */
  sustainedPct?: number
  /** Puissance Sorts (carac 98), ajoutée à la puissance pour un sort uniquement. */
  spellPower?: number
  /** Puissance Armes (carac 103), ajoutée à la puissance pour une arme uniquement. */
  weaponPower?: number
  /** Autre puissance additive (glyphes 106, runes 110, bonus déclenchés...). */
  extraPower?: number
  /** Autres dommages fixes additifs (bonus de dommages d'un sort, ...). */
  extraFixedDamage?: number
  /** Bonus ajouté au jet de base (« augmente les dommages de base du sort », effet 293 / BOOST_SPELL). */
  baseDamageBonus?: number
  /** Dommage de piège : + Puissance Pièges (69) et + Dommages Pièges (70) du lanceur. */
  isTrap?: boolean
  /** Maîtrise d'arme (%) ; défaut `attacker.weaponSkillPct`. Armes uniquement. */
  weaponSkillPct?: number
  /** Bonus critique de l'arme, ajouté au jet si CC (client D2 `spellWeaponCriticalBonus`). */
  weaponCritBonus?: number
  /** Réduction fixe d'armure déjà mise à l'échelle (`armorReduction`), soustraite avec les résistances fixes. */
  armorReduction?: number
  /** Plafond de % résistance d'un monstre (défaut 100 ; `Infinity` = client D2). */
  monsterResCap?: number
  /** Arithmétique : `domath` (défaut, flottants DoMath) ou `integer` (entiers exacts). */
  mode?: DamageMode
  /** Ordre des multiplicateurs finaux : `domath` (défaut) ou `dofus3` (module Haxe du client). */
  order?: DamageOrder
}

/** Paramètres résolus d'un dégât (une fois par couple lanceur/cible/effet), réutilisables pour tous les jets. */
export interface PreparedDamage {
  domath: boolean
  dofus3Order: boolean
  crit: boolean
  isWeapon: boolean
  isMelee: boolean
  element: Element
  /** Bonus ajouté au jet (bonus de base du sort + bonus critique d'arme). */
  baseBonus: number
  /** max(0, puissance + carac + puissances additionnelles). */
  power: number
  fixedDamage: number
  weaponSkillPct: number
  /** Facteur flottant de zone (mode `domath`) et son équivalent entier en % (mode `integer`). */
  areaFactor: number
  areaPct: number
  portalFactor: number
  portalPct: number
  /** Résistances fixes + critiques (si CC) + armure. */
  fixedRes: number
  /** % résistance élémentaire après plafond. */
  resPct: number
  /** % résistance élémentaire avant plafond (pour l'explication). */
  rawResPct: number
  sustainedPct: number
  finalPct: number
  /** % dommages aux sorts ou d'armes. */
  categoryPct: number
  /** % dommages distance ou mêlée. */
  distancePct: number
  /** % résistances sorts ou armes de la cible. */
  receivedCategoryPct: number
  /** % résistances distance ou mêlée de la cible. */
  receivedDistancePct: number
}

export function createPreparedDamage(): PreparedDamage {
  return {
    domath: true,
    dofus3Order: false,
    crit: false,
    isWeapon: false,
    isMelee: false,
    element: Element.Neutral,
    baseBonus: 0,
    power: 0,
    fixedDamage: 0,
    weaponSkillPct: 0,
    areaFactor: 1,
    areaPct: 100,
    portalFactor: 1,
    portalPct: 100,
    fixedRes: 0,
    resPct: 0,
    rawResPct: 0,
    sustainedPct: 100,
    finalPct: 0,
    categoryPct: 0,
    distancePct: 0,
    receivedCategoryPct: 0,
    receivedDistancePct: 0,
  }
}

/** % de résistance élémentaire effectif : plafond 50 (joueur) ou `monsterCap` (monstre, 100 par défaut) ; pas de plancher. */
export function effectiveResistPercent(resist: number, isPlayer: boolean, monsterCap = MONSTER_RES_CAP): number {
  const cap = isPlayer ? PLAYER_RES_CAP : monsterCap
  return resist > cap ? cap : resist
}

/**
 * Paliers de dégressivité effectifs d'une cible : `min(max(distance − rayonMin, 0), paliersMax)`
 * (port D3 `SpellZone.GetAoeMalus`, client D2 `getSimpleEfficiency`). La distance dépend de la forme de zone.
 */
export function areaSteps(distance: number, minRadius = 0, maxSteps = DEFAULT_AREA_MAX_STEPS): number {
  const d = distance - minRadius > 0 ? distance - minRadius : 0
  return d < maxSteps ? d : maxSteps
}

/** Efficacité de zone (0..1) : `(100 − min(paliers × pas, 100)) / 100`. Défauts DofusDB : 10 %/case, 4 paliers. */
export function areaEfficiency(
  distance: number,
  minRadius = 0,
  stepPct = SPELL_AREA_STEP_PCT,
  maxSteps = DEFAULT_AREA_MAX_STEPS,
): number {
  const malus = areaSteps(distance, minRadius, maxSteps) * stepPct
  return (100 - (malus < 100 ? malus : 100)) / 100
}

/**
 * Résout les caractéristiques d'un dégât dans `out` (réutilisé si fourni) : aucune allocation.
 * L'élément doit être 0..4 (les éléments « meilleur » / « pire » sont résolus par l'appelant).
 */
export function prepareDamage(input: DamageInput, out: PreparedDamage = createPreparedDamage()): PreparedDamage {
  const a = input.attacker
  const d = input.defender
  const el = input.element
  const crit = input.crit
  const weapon = input.isWeapon
  const melee = input.isMelee
  out.domath = input.mode !== 'integer'
  out.dofus3Order = input.order === 'dofus3'
  out.crit = crit
  out.isWeapon = weapon
  out.isMelee = melee
  out.element = el

  // ── Lanceur ──
  const power =
    a.power +
    a[ELEMENT_MAIN_STAT[el]] +
    (weapon ? (input.weaponPower ?? 0) : (input.spellPower ?? 0)) +
    (input.extraPower ?? 0) +
    (input.isTrap ? a.trapPower : 0)
  out.power = power > 0 ? power : 0
  out.baseBonus = (input.baseDamageBonus ?? 0) + (crit && weapon ? (input.weaponCritBonus ?? 0) : 0)
  out.fixedDamage =
    a[ELEMENT_FIXED_DAMAGE[el]] +
    a.damage +
    (crit ? a.criticalDamage : 0) +
    (input.extraFixedDamage ?? 0) +
    (input.isTrap ? a.trapDamage : 0)
  out.weaponSkillPct = weapon ? (input.weaponSkillPct ?? a.weaponSkillPct) : 0

  // ── Zone et portails ──
  if (input.efficiency !== undefined) {
    const e = input.efficiency > 0 ? input.efficiency : 0
    out.areaFactor = e
    out.areaPct = Math.round(e * 100)
  } else {
    const stepPct = input.areaStepPct ?? (weapon ? WEAPON_AREA_STEP_PCT : SPELL_AREA_STEP_PCT)
    let steps = input.areaSteps ?? 0
    if (steps < 0) steps = 0
    if (input.areaMaxSteps !== undefined && steps > input.areaMaxSteps) steps = input.areaMaxSteps
    // Même expression flottante que DoMath : `1 - areaDistance * .1` (10/100 et .1 sont le même double).
    const f = 1 - steps * (stepPct / 100)
    out.areaFactor = f > 0 ? f : 0
    const pct = 100 - steps * stepPct
    out.areaPct = pct > 0 ? pct : 0
  }
  const cells = input.portalCells ?? 0
  const portalBonus = input.portalBonusPct ?? 0
  // DoMath : `1 + (redirection > 0 ? 0 + .02 * redirection : 0)` ; le bonus de base (0 par défaut) s'ajoute à part.
  out.portalFactor = 1 + (cells > 0 ? 0.02 * cells : 0) + (portalBonus !== 0 ? portalBonus / 100 : 0)
  out.portalPct = 100 + (cells > 0 ? 2 * cells : 0) + portalBonus

  // ── Cible ──
  out.fixedRes = d[ELEMENT_RES_FIXED[el]] + (crit ? d.criticalRes : 0) + (input.armorReduction ?? 0)
  const rawRes = d[ELEMENT_RES_PCT[el]]
  out.rawResPct = rawRes
  out.resPct = effectiveResistPercent(rawRes, input.defenderIsPlayer, input.monsterResCap ?? MONSTER_RES_CAP)
  out.sustainedPct = input.sustainedPct ?? 100
  out.finalPct = a.finalDamagePct
  out.categoryPct = weapon ? a.weaponDamagePct : a.spellDamagePct
  out.distancePct = melee ? a.meleeDamagePct : a.rangedDamagePct
  out.receivedCategoryPct = weapon ? d.weaponResPct : d.spellResPct
  out.receivedDistancePct = melee ? d.meleeResPct : d.rangedResPct
  return out
}

// ───────────────────────────── pipeline ─────────────────────────────

export type DamageStepId =
  | 'base'
  | 'stats'
  | 'fixed'
  | 'weaponSkill'
  | 'area'
  | 'fixedRes'
  | 'percentRes'
  | 'sustained'
  | 'final'
  | 'category'
  | 'distance'
  | 'received'
  | 'receivedCategory'
  | 'receivedDistance'
  | 'result'

/** Une étape du calcul : valeur après l'étape et formule appliquée (affichage du calculateur). */
export interface DamageStep {
  id: DamageStepId
  label: string
  value: number
  detail: string
}

export interface DamageExplanation {
  roll: number
  mode: DamageMode
  order: DamageOrder
  /** Paramètres résolus (puissance totale, fixes, résistances plafonnées...). */
  params: PreparedDamage
  steps: DamageStep[]
  damage: number
}

/** Multiplicateur « × m / 100 » de l'ordre Dofus 3 : `floor(r × (m/100))` en flottant (port C#), exact en entier. */
function mulD3(r: number, m: number, domath: boolean): number {
  return domath ? Math.floor(r * (m / 100)) : Math.trunc((r * m) / 100)
}

function categoryLabel(p: PreparedDamage): string {
  return p.isWeapon ? "% Dommages d'armes" : '% Dommages aux sorts'
}
function distanceLabel(p: PreparedDamage): string {
  return p.isMelee ? '% Dommages mêlée' : '% Dommages distance'
}
function receivedCategoryLabel(p: PreparedDamage): string {
  return p.isWeapon ? '% Résistances armes' : '% Résistances sorts'
}
function receivedDistanceLabel(p: PreparedDamage): string {
  return p.isMelee ? '% Résistances mêlée' : '% Résistances distance'
}

/**
 * Cœur du calcul. `trace` (facultatif) reçoit les étapes ; `null` dans le chemin chaud (aucune allocation).
 */
function computeDamage(p: PreparedDamage, roll: number, trace: DamageStep[] | null): number {
  const domath = p.domath
  const base = roll + p.baseBonus
  if (trace !== null) {
    trace.push({
      id: 'base',
      label: 'Jet de base',
      value: base,
      detail: p.baseBonus !== 0 ? `${roll} + ${p.baseBonus} (bonus de jet) = ${base}` : `${base}`,
    })
  }
  if (base <= 0) return finish(0, trace, 'jet nul')

  // (1) caractéristique + puissance
  let r = domath ? Math.trunc(base + (base * p.power) / 100) : Math.trunc((base * (100 + p.power)) / 100)
  if (trace !== null) {
    trace.push({
      id: 'stats',
      label: `Caractéristique + Puissance (${ELEMENT_NAMES_FR[p.element]})`,
      value: r,
      detail: `trunc(${base} × (100 + ${p.power}) / 100) = ${r}`,
    })
  }

  // (2) dommages fixes
  const beforeFixed = r
  r += p.fixedDamage
  if (trace !== null) {
    trace.push({
      id: 'fixed',
      label: p.crit ? 'Dommages fixes (+ critiques)' : 'Dommages fixes',
      value: r < 0 ? 0 : r,
      detail: `${beforeFixed} + ${p.fixedDamage} = ${r}${r < 0 ? ' → 0' : ''}`,
    })
  }
  if (r < 0) return finish(0, trace, 'dommages fixes négatifs')

  // (2b) maîtrise d'arme (Dofus 3, armes uniquement)
  if (p.weaponSkillPct !== 0) {
    const prev = r
    r = Math.trunc((r * (100 + p.weaponSkillPct)) / 100)
    if (trace !== null) {
      trace.push({
        id: 'weaponSkill',
        label: "Maîtrise d'arme",
        value: r,
        detail: `trunc(${prev} × (100 + ${p.weaponSkillPct}) / 100) = ${r}`,
      })
    }
  }

  // (3) dégressivité de zone × portails (deux multiplications flottantes puis UNE troncature)
  {
    const prev = r
    if (domath) {
      r *= p.areaFactor
      r *= p.portalFactor
      r = Math.trunc(r)
    } else {
      r = Math.trunc((r * p.areaPct * p.portalPct) / 10000)
    }
    if (trace !== null) {
      trace.push({
        id: 'area',
        label: 'Efficacité de zone × portails',
        value: r,
        detail: domath
          ? `trunc(${prev} × ${p.areaFactor} × ${p.portalFactor}) = ${r}`
          : `trunc(${prev} × ${p.areaPct} × ${p.portalPct} / 10000) = ${r}`,
      })
    }
  }

  // (4) résistances fixes (+ critiques, + armure)
  {
    const prev = r
    r -= p.fixedRes
    if (trace !== null) {
      trace.push({
        id: 'fixedRes',
        label: p.crit ? 'Résistances fixes (+ critiques)' : 'Résistances fixes',
        value: r < 0 ? 0 : r,
        detail: `${prev} − ${p.fixedRes} = ${r}${r < 0 ? ' → 0' : ''}`,
      })
    }
    if (r < 0) return finish(0, trace, 'absorbé par les résistances fixes')
  }

  // (5) % résistance élémentaire
  {
    const prev = r
    r = domath ? Math.trunc(r * (1 - p.resPct / 100)) : Math.trunc((r * (100 - p.resPct)) / 100)
    if (trace !== null) {
      const capped = p.resPct !== p.rawResPct ? ` (plafonné, brut ${p.rawResPct} %)` : ''
      trace.push({
        id: 'percentRes',
        label: `% Résistance ${ELEMENT_NAMES_FR[p.element]}${capped}`,
        value: r,
        detail: domath ? `trunc(${prev} × (1 − ${p.resPct} / 100)) = ${r}` : `trunc(${prev} × (100 − ${p.resPct}) / 100) = ${r}`,
      })
    }
  }

  if (!p.dofus3Order) {
    // (6)-(9) : r × k entier ⇒ exact dans les deux modes
    let prev = r
    r = Math.trunc((r * p.sustainedPct) / 100)
    if (trace !== null) {
      trace.push({ id: 'sustained', label: 'Dommages subis', value: r, detail: `trunc(${prev} × ${p.sustainedPct} / 100) = ${r}` })
    }
    prev = r
    r = Math.trunc((r * (100 + p.finalPct)) / 100)
    if (trace !== null) {
      trace.push({ id: 'final', label: '% Dommages finaux', value: r, detail: `trunc(${prev} × (100 + ${p.finalPct}) / 100) = ${r}` })
    }
    prev = r
    r = Math.trunc((r * (100 + p.categoryPct)) / 100)
    if (trace !== null) {
      trace.push({ id: 'category', label: categoryLabel(p), value: r, detail: `trunc(${prev} × (100 + ${p.categoryPct}) / 100) = ${r}` })
    }
    prev = r
    r = Math.trunc((r * (100 + p.distancePct)) / 100)
    if (trace !== null) {
      trace.push({ id: 'distance', label: distanceLabel(p), value: r, detail: `trunc(${prev} × (100 + ${p.distancePct}) / 100) = ${r}` })
    }
    // (10) % résistances sorts|armes × distance|mêlée : une seule troncature
    prev = r
    if (domath) {
      r *= 1 - p.receivedCategoryPct / 100
      r *= 1 - p.receivedDistancePct / 100
      r = Math.trunc(r)
    } else {
      r = Math.trunc((r * (100 - p.receivedCategoryPct) * (100 - p.receivedDistancePct)) / 10000)
    }
    if (trace !== null) {
      trace.push({
        id: 'received',
        label: `${receivedCategoryLabel(p)} × ${receivedDistanceLabel(p)}`,
        value: r,
        detail: domath
          ? `trunc(${prev} × (1 − ${p.receivedCategoryPct} / 100) × (1 − ${p.receivedDistancePct} / 100)) = ${r}`
          : `trunc(${prev} × (100 − ${p.receivedCategoryPct}) × (100 − ${p.receivedDistancePct}) / 10000) = ${r}`,
      })
    }
  } else {
    // Ordre du module Haxe de Dofus 3 : un arrondi par facteur, « dommages subis » en dernier.
    if (r < 0) r = 0
    r = d3Step(r, 100 + p.categoryPct, domath, trace, 'category', categoryLabel(p))
    r = d3Step(r, 100 + p.distancePct, domath, trace, 'distance', distanceLabel(p))
    r = d3Step(r, 100 - p.receivedCategoryPct, domath, trace, 'receivedCategory', receivedCategoryLabel(p))
    r = d3Step(r, 100 - p.receivedDistancePct, domath, trace, 'receivedDistance', receivedDistanceLabel(p))
    r = d3Step(r, 100 + p.finalPct, domath, trace, 'final', '% Dommages finaux')
    r = d3Step(r, p.sustainedPct, domath, trace, 'sustained', 'Dommages subis')
  }
  return finish(r, trace, '')
}

function d3Step(r: number, m: number, domath: boolean, trace: DamageStep[] | null, id: DamageStepId, label: string): number {
  const v = mulD3(r, m, domath)
  if (trace !== null) trace.push({ id, label, value: v, detail: `floor(${r} × ${m} / 100) = ${v}` })
  return v
}

/** Borne finale à 0 (normalise aussi -0). */
function finish(r: number, trace: DamageStep[] | null, reason: string): number {
  const v = r > 0 ? r : 0
  if (trace !== null) trace.push({ id: 'result', label: 'Dégâts', value: v, detail: reason ? `${v} (${reason})` : `${v}` })
  return v
}

// ───────────────────────────── API publique ─────────────────────────────

const SCRATCH_A = createPreparedDamage()
const SCRATCH_B = createPreparedDamage()

/** Un jet de dégâts déjà préparé (chemin chaud du moteur : aucune allocation). */
export function rollPrepared(p: PreparedDamage, baseRoll: number): number {
  return computeDamage(p, baseRoll, null)
}

/** Dégâts d'un jet `baseRoll` (entier, ou réel pour le mode « dégâts moyens » de DoMath). */
export function damageRoll(input: DamageInput, baseRoll: number): number {
  return computeDamage(prepareDamage(input, SCRATCH_A), baseRoll, null)
}

/** Dégâts du jet minimum et du jet maximum (DoMath `Mg`). */
export function damageRange(input: DamageInput, min: number, max: number): { min: number; max: number } {
  const p = prepareDamage(input, SCRATCH_A)
  return { min: computeDamage(p, min, null), max: computeDamage(p, max, null) }
}

/** Moyenne exacte des dégâts sur les jets entiers uniformes de [min, max] (et non `dégâts(jet moyen)`). */
export function meanPrepared(p: PreparedDamage, min: number, max: number): number {
  const hi = max >= min ? max : min
  let sum = 0
  for (let r = min; r <= hi; r++) sum += computeDamage(p, r, null)
  return sum / (hi - min + 1)
}

export interface DamageRolls {
  min: number
  max: number
  /** Jets critiques (`criticalEffect`) ; défaut : jets normaux. */
  critMin?: number
  critMax?: number
}

/**
 * Espérance d'une ligne de dégâts (worker DoMath) : `(1 − c)·E[normal] + c·E[critique]`, espérances prises sur
 * les jets entiers. `critChancePct` en % (0..100, cf. `critChance`). `critInput` null ⇒ `normalInput` en CC.
 */
export function expectedDamage(
  normalInput: DamageInput,
  critInput: DamageInput | null,
  rolls: DamageRolls,
  critChancePct: number,
): number {
  const o = critChancePct < 0 ? 0 : critChancePct > 100 ? 100 : critChancePct
  let mean = 0
  if (o < 100) mean += meanPrepared(prepareDamage(normalInput, SCRATCH_A), rolls.min, rolls.max) * (1 - o / 100)
  if (o > 0) {
    const p = prepareDamage(critInput ?? { ...normalInput, crit: true }, SCRATCH_B)
    mean += meanPrepared(p, rolls.critMin ?? rolls.min, rolls.critMax ?? rolls.max) * (o / 100)
  }
  return mean
}

/** Détail étape par étape d'un jet (page « calculateur »). */
export function explainDamage(input: DamageInput, baseRoll: number): DamageExplanation {
  const params = prepareDamage(input)
  const steps: DamageStep[] = []
  const damage = computeDamage(params, baseRoll, steps)
  return { roll: baseRoll, mode: input.mode ?? 'domath', order: input.order ?? 'domath', params, steps, damage }
}

// ───────────────────────────── éléments « meilleur » / « pire » ─────────────────────────────

const OTHER_ELEMENTS: readonly Element[] = [Element.Neutral, Element.Fire, Element.Water, Element.Air]

/**
 * Élément de la caractéristique la plus haute (effets « meilleur élément », 2822/2828) ; égalité départagée par
 * les dommages fixes de l'élément ; Terre par défaut (port D3 `HaxeFighter.GetBestElement`).
 */
export function bestElement(s: Stats): Element {
  let best: Element = Element.Earth
  for (const e of OTHER_ELEMENTS) {
    const v = s[ELEMENT_MAIN_STAT[e]]
    const bv = s[ELEMENT_MAIN_STAT[best]]
    if (v > bv || (v === bv && s[ELEMENT_FIXED_DAMAGE[e]] > s[ELEMENT_FIXED_DAMAGE[best]])) best = e
  }
  return best
}

/** Élément de la caractéristique la plus basse (effet « pire élément », 2832) — symétrique de `bestElement`. */
export function worstElement(s: Stats): Element {
  let worst: Element = Element.Earth
  for (const e of OTHER_ELEMENTS) {
    const v = s[ELEMENT_MAIN_STAT[e]]
    const wv = s[ELEMENT_MAIN_STAT[worst]]
    if (v < wv || (v === wv && s[ELEMENT_FIXED_DAMAGE[e]] < s[ELEMENT_FIXED_DAMAGE[worst]])) worst = e
  }
  return worst
}
