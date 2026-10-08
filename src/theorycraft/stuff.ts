/**
 * Theorycraft contre un boss — question (1) : « quel stuff est le plus intéressant contre ce boss ? »
 * (docs/design/theorycraft.md §1.7).
 *
 * `stuffVsBoss(data, input, profile, opts)` :
 *  1. Personnage : un preset (`resolvePreset` : identifiant ou désignation « cra:terre »), un build de l'utilisateur ou
 *     un lien de partage RoxxSolver (`roxxImport`). Pour un build ou un lien, variantes de sorts, rôle et calibration
 *     viennent du preset `presetId`, sinon du preset de base de la classe dont l'élément est la caractéristique
 *     élémentaire la plus haute du build ; un lien sans parchemins reçoit 100 partout (`fillScrolls`, signalé).
 *  2. Style de jeu, puis cible. Style (au contact ou à distance, `character.style`) par la règle commune à la
 *     comparaison des classes (`resolveStyle`, target.ts) : option `melee` d'abord ; sinon au contact si le boss n'est
 *     attaquable qu'au contact, si le preset est un preset de mêlée ou si au moins 50 % du DPT soutenu du stuff de
 *     départ contre ce boss passe par des coups au contact (`contactShare`, rotation.ts, mesurée avec le style de la
 *     règle sans mesure `playsMelee`) ; sinon à distance — avec une explication quand il diffère du style du preset.
 *     Cible : `bossProxyOptions(profile, { role, profile, melee })` (target.ts) — cibles EXPLICITES (`strictTargets`),
 *     jamais le mix du Vortex ; PO visée 6 à distance, 0 au contact, sauf option `rangeNeed` (bonus de PO temporaires
 *     de la classe listés, non déduits) ; au contact, étiquette `contact` (à égalité de la cible, % mêlée valorisés).
 *     Objets à la fois imposés et exclus : erreur.
 *  3. Références notées dans UN contexte de proxy commun (construit comme celui de l'optimiseur : build de départ comme
 *     référence) : départ, stuff du preset (quand le départ est le stuff de l'utilisateur), stuffs génériques de
 *     data/ai/presets.json hors stuffs de scénario (`theorySeedFilter` : jamais de `vortex_*`, objets ≤ niveau).
 *  4. `optimizeStuff` (src/optimizer/stuff/search.ts) avec ces options, graines filtrées par `theorySeedFilter`
 *     (départ + génériques + glouton), recuit de `iterations` itérations, relancé `restarts` fois (graines `seed`,
 *     `seed + 1`…) ; Dofus à sort passif du départ imposés (`keepPassives`, comme la commande CLI `stuff` : le proxy
 *     les valorise à 0 ; les autres objets à sort passif ne sont pas imposés) ; `elements: 'all'` : une recherche par
 *     élément (points du preset reportés sur la caractéristique de l'élément, stuff générique de l'élément comme
 *     départ ; le départ réel pour son propre élément).
 *  5. Classement commun : candidats de la recherche re-notés en EXACT dans le contexte commun (logJ comparables entre
 *     recherches et éléments) ET stuffs de référence valides qui portent les objets imposés et aucun objet exclu
 *     (départ, preset, génériques ; une référence qui porte un objet exclu reste dans la comparaison, signalée). Score :
 *     logJ du proxy ; mais le proxy ne pose aucune posture de classe — quand, au départ, le DPT soutenu sans posture est
 *     sous 1/1,2 du DPT en meilleure posture (Zobal, Forgelance, Pandawa… : DPT du proxy souvent faible), le score est le
 *     logJ SOUTENU (`logJSustained` : DPT du proxy remplacé par le DPT soutenu en posture × calibration) et un AFFINAGE
 *     en DPT soutenu suit (`polishSustained` : montées par coordonnées depuis les 3 stuffs distincts les mieux classés,
 *     objets de tous les candidats, forgemagie re-planifiée ; ≈ 0,1-0,3 s). Sans cela, contre le Père Ver, le
 *     « meilleur » stuff d'un Zobal Psychopathe perdait 75 % de DPT soutenu (1 852 → 464). L'affinage ne part que de
 *     stuffs sans objet exclu et n'en ajoute jamais.
 *     Meilleur + `top` stuffs DISTINCTS (au moins `minDifferences` objets d'écart entre eux, défaut 2 — sinon le top
 *     n'offre que des variantes d'une même coiffe ; places restantes complétées par des ensembles d'objets simplement
 *     différents), triés par le score. Un départ invalide (stuff de niveau 200 joué plus bas…) n'est jamais présenté
 *     comme meilleur (`startValid`) ; un stuff de référence que rien ne bat reste le meilleur (signalé).
 *  6. Pour chaque stuff présenté : DPT du proxy (objectif de l'optimiseur : un tour, relances ignorées, calibration du
 *     preset, sans posture) ET DPT SOUTENU en régime établi (rotation.ts, `steady`, meilleure posture de stances.ts,
 *     phases attaquables pondérées) avec le détail par sort (`steadyBySpell` : part immédiate et poisons suivis) ; PV,
 *     PV effectifs, dégâts reçus par tour (exact) et par élément (forme fermée) ; logJ ; PA/PM/PO ; objets changés par
 *     rapport au départ ; fiche (`buildStuffSheet`).
 *  7. Poids marginaux des caractéristiques au meilleur stuff (`statWeightsAt` d'un contexte du proxy construit À ce
 *     stuff : le contexte commun fige rotation et éléments sur le départ ; classement soutenu : part des dégâts tirée du
 *     DPT soutenu en posture ; classement par le proxy : part des dégâts d'un PA tirée du DPT soutenu, le DPT du proxy
 *     — un tour isolé — évoluant par paliers) traduits en équivalences lisibles (`statEquivalences`), la part des
 *     PA/PM/PO due aux pénalités de l'objectif séparée de la part modélisée.
 *  8. Avertissements chiffrés : perte de DPT soutenu du meilleur stuff par rapport au départ (> 15 %), pénalités
 *     d'objectif qui décident seules de l'ordre entre le départ et le meilleur, posture, PV effectifs plafonnés, retrait
 *     sans valeur contre ce boss (utilité du rôle ignorée), écart entre les dégâts reçus du proxy et le profil
 *     offensif de la fiche (`incomingCoherence`), meilleur stuff dont la rotation n'a aucun sort de l'élément cherché…
 *
 * Réglages par défaut MESURÉS (scratchpad du 2026-10-08, 8 presets × 5 boss : Merkator, Père Ver, Vortex, Solar,
 * Comte Harebourg). Sans les 49 graines `vortex_*`, la recherche ne part que de 8 graines et le recuit compte
 * (contrairement à la carte de l'optimiseur, mesurée AVEC ces graines). Écart moyen (maximal) au meilleur logJ observé,
 * Dofus à passif du départ imposés (défaut) : sans recuit 0,056 (0,18), 0,4 s par preset ; 10 000 itérations 0,022
 * (0,11), 0,6 s ; 30 000 itérations 0,009 (0,05), 1,2 s ; 3 relances de 10 000 0,012 (0,10), 1,8 s ; 2 relances de
 * 30 000 0,003 (0,024), 2,4 s. Dofus libres : 3 × 10 000 0,007 et 2 × 30 000 0,007. Défaut : 30 000 itérations × 2
 * relances ; une seule relance par élément avec `elements: 'all'` (4 recherches, ≈ 5 s).
 *
 * Hypothèses affichées (`assumptions`) : jets max, forgemagie supposée (exos PA/PM/PO, ≤ 6 transcendances, pas
 * d'over), sorts passifs à 0, arme non lancée, ni invocations, glyphes, pièges, buffs ni buffs d'équipe, rotation du
 * boss par sac à dos (pas l'IA réelle : une estimation, qui peut être sous-estimée), aucune position ni ligne de vue ;
 * les CLASSEMENTS valent plus que les valeurs absolues.
 *
 * Module d'ANALYSE : il tire le proxy de stuff et l'optimiseur, donc INDIRECTEMENT (par proxy.ts et search.ts, jamais
 * directement) src/dungeons/vortex/{clock,constants,params,placement}.ts, src/dungeons/generic/{dummy,skirmish}.ts et
 * src/dungeons/waves.ts — liste figée par tests/theory-stuff.test.ts ; le mix du Vortex de proxy.ts n'est jamais
 * utilisé (cibles toujours explicites). Il n'est PAS exporté par index.ts (API pure). Déterministe (graines fixes,
 * logarithme déterministe, départages par clé).
 */
import type { RoleId } from '../ai/types'
import { Element, ELEMENT_NAMES_FR, ELEMENT_RES_PCT, type StatKey, type Stats } from '../core/types'
import type { GameDataStore } from '../data/store'
import type { Fighter } from '../engine/types'
import { detLog } from '../optimizer/stuff/detmath'
import { planForgemagie } from '../optimizer/stuff/exos'
import { hasPassive, STUFF_POSITIONS } from '../optimizer/stuff/pools'
import type { ExponentProfile } from '../optimizer/stuff/profiles'
import { createProxyContext, ELEMENT_STAT, type ProxyContext, type ProxyMember, type ProxyOptions, type ProxyScore } from '../optimizer/stuff/proxy'
import { optimizeStuff, theorySeedFilter, type StuffCandidate, type StuffResult } from '../optimizer/stuff/search'
import { allocatePoints, BASE_PRESETS, presetBuild, resolvePreset, STUFFS, type Preset, type StuffTemplate } from '../optimizer/team/presets'
import { roxxImport } from '../optimizer/team/roxx'
import type { MemberSpec } from '../optimizer/types'
import { computeBuildStats, fullScrolls, type CharacterBuild, type EquippedItem } from '../stats/build'
import type { PrimaryStat } from '../stats/characteristicPoints'
import { RUNE_WEIGHT_PER_POINT } from '../stats/forgemagie'
import { buildStuffSheet, ROLE_LABELS_FR, statLabelFr, type StuffSheet } from '../stats/sheet'
import { bossFighter, playerFighterFromStats, theoryDptTable, withStates, type TheoryCharacter } from './fighters'
import { contactShare, sustainedDamage } from './rotation'
import { bestStance, STANCES, type ClassStance } from './stances'
import { bossProxyOptions, CONTACT_SHARE, incomingCoherence, playsMelee, refHpOf, resolveStyle } from './target'
import type {
  BossProfile,
  PerElement,
  PlayStyle,
  StatEquivalence,
  StuffDamage,
  StuffElement,
  StuffElementOption,
  StuffEvaluation,
  StuffItemLine,
  StuffOrigin,
  StuffSpellLine,
  StuffStatWeights,
  StuffVsBossResult,
  SustainedDamage,
} from './types'

// ---------------------------------------------------------------------------------------------------------------------
// Constantes et types publics
// ---------------------------------------------------------------------------------------------------------------------

/** Itérations du recuit par recherche (mesure : voir l'en-tête). */
export const DEFAULT_ITERATIONS = 30_000
/** Recherches relancées par élément (graines `seed`, `seed + 1`…) avec `elements: 'preset'`. */
export const DEFAULT_RESTARTS = 2
/** Recherches relancées par élément avec `elements: 'all'` (4 éléments ⇒ 4 recherches). */
export const DEFAULT_RESTARTS_ALL = 1
/** Stuffs distincts rendus. */
export const DEFAULT_TOP = 5
/** Objets différents exigés entre deux stuffs du top (au moins). */
export const DEFAULT_MIN_DIFFERENCES = 2
/** Niveau par défaut (presets). */
export const DEFAULT_LEVEL = 200
/** Affinage soutenu : balayages maximaux de chaque montée par coordonnées. */
const POLISH_SWEEPS = 6
/** Affinage soutenu : montées lancées depuis les stuffs distincts les mieux classés. */
const POLISH_STARTS = 3
/** Plafond des PV effectifs du proxy (× PV, proxy.ts). */
const EHP_CAP = 20
/**
 * Écart toléré entre le DPT soutenu « sans posture » et « meilleure posture » (classes à posture) : au-delà, au stuff
 * de départ, le proxy (qui ne pose aucune posture) ne voit pas les dégâts de la classe et les stuffs sont classés par
 * le logJ soutenu ; au meilleur stuff, avertissement.
 */
const STANCE_GAP = 1.2
/** Perte de DPT soutenu du meilleur stuff par rapport au départ (part du départ) au-delà de laquelle on avertit. */
const DPT_LOSS_WARN = 0.15
/** Pénalités de l'objectif du proxy (proxy.ts, `score`) — rappelées dans les textes seulement. */
const PENALTY_TEXT = '×0,85 par PA, ×0,9 par PM et ×0,95 par PO sous les valeurs visées'

/** Stuff générique de chaque élément (data/ai/presets.json, equipment.md §12). */
const GENERIC_BY_ELEMENT: Readonly<Record<StuffElement, string>> = { earth: 'terre', fire: 'feu', water: 'eau', air: 'air' }
const STUFF_ELEMENTS: readonly StuffElement[] = ['earth', 'fire', 'water', 'air']
const ELEMENT_OF: Readonly<Record<StuffElement, Element>> = { earth: Element.Earth, fire: Element.Fire, water: Element.Water, air: Element.Air }
const FORGE_KIND_FR: Readonly<Record<string, string>> = { exo: 'exo', over: 'over', transcendence: 'transcendance' }

/** Stuff à évaluer contre le boss : un preset, un build de l'utilisateur ou un lien RoxxSolver. */
export type StuffInput =
  | { preset: string }
  | { build: CharacterBuild; presetId?: string }
  | { roxx: string; presetId?: string }

/** Avancement (interface, CLI) : `optimize` = une recherche terminée, `evaluate` = stuffs notés. */
export interface StuffProgress {
  step: 'optimize' | 'evaluate'
  label: string
  done: number
  total: number
}

export interface StuffVsBossOptions {
  /** Niveau du personnage d'un preset (défaut 200) ; un build ou un lien garde son propre niveau. */
  level?: number
  /** Itérations du recuit par recherche (défaut `DEFAULT_ITERATIONS` ; 0 = montée par coordonnées seule). */
  iterations?: number
  /** Recherches par élément (défaut 2, ou 1 avec `elements: 'all'`). */
  restarts?: number
  /** Profil d'exposants (défaut équilibré). */
  profile?: ExponentProfile
  /** Stuffs distincts rendus (défaut 5). */
  top?: number
  /**
   * Objets différents exigés entre deux stuffs du top (défaut 2 : pas cinq variantes d'une même coiffe) ; places
   * restantes complétées par des stuffs qui diffèrent d'un seul objet.
   */
  minDifferences?: number
  /** `preset` : élément du preset (ou du build) ; `all` : une recherche par élément, comparées. */
  elements?: 'preset' | 'all'
  /** Objets imposés (ids) — ajoutés aux Dofus à passif gardés (`keepPassives`). */
  fixed?: readonly number[]
  /** Objets interdits (ids). */
  exclude?: readonly number[]
  /** Graine de la première recherche (défaut 1). */
  seed?: number
  /** Garder imposés les Dofus à sort passif du départ (défaut vrai : passifs non valorisés par le proxy). */
  keepPassives?: boolean
  /** Lien RoxxSolver sans parchemins : 100 partout (défaut vrai) ; faux = 0 comme le lien. */
  fillScrolls?: boolean
  /** Rôle imposé (défaut : rôle du preset). */
  role?: RoleId
  /**
   * Joué au contact (choix explicite ; défaut : règle commune `resolveStyle` — boss attaquable seulement au contact,
   * preset de mêlée, ou au moins 50 % du DPT soutenu du départ contre ce boss porté par des coups au contact).
   */
  melee?: boolean
  /**
   * PO visée par l'objectif (pénalité ×0,95 par PO manquante) ; défaut : 6 à distance, 0 au contact (target.ts). Les
   * bonus de PO temporaires de la classe (Crâ : Tirs Éloignés, Sentinelle…) ne sont pas déduits : à abaisser ici.
   */
  rangeNeed?: number
  onProgress?: (p: StuffProgress) => void
}

// ---------------------------------------------------------------------------------------------------------------------
// Personnage
// ---------------------------------------------------------------------------------------------------------------------

/** Élément d'un stuff : caractéristique élémentaire la plus haute (départage : Terre, Feu, Eau, Air). */
export function dominantElement(stats: Stats): StuffElement {
  let best: StuffElement = 'earth'
  for (const e of STUFF_ELEMENTS) if (stats[ELEMENT_STAT[e]] > stats[ELEMENT_STAT[best]]) best = e
  return best
}

const elementLabel = (e: StuffElement) => ELEMENT_NAMES_FR[ELEMENT_OF[e]]

/** Libellé court d'un stuff de data/ai/presets.json (sans la source entre parenthèses). */
function stuffLabel(id: string): string {
  return (STUFFS[id]?.label ?? id).replace(/\s*\([^)]*\)\s*$/, '')
}

/** Nombre décimal à la française (textes des hypothèses). */
const fr = (x: number, digits = 2) => x.toLocaleString('fr-FR', { maximumFractionDigits: digits })

interface Character {
  preset: Preset
  start: CharacterBuild
  input: 'preset' | 'build' | 'roxx'
  /** Le stuff de l'utilisateur est le départ. */
  user: boolean
  label: string
  warnings: string[]
  assumptions: string[]
}

/**
 * Preset de base de la classe dont l'élément est celui du build ; à défaut (aucun preset de cet élément), le premier
 * preset de la classe — repli signalé en avertissement (`fallback` : autre rôle, autres exposants possibles).
 */
function presetForBuild(data: GameDataStore, build: CharacterBuild, presetId: string | undefined): { preset: Preset; note?: string; fallback?: string } {
  if (presetId) {
    const p = resolvePreset(presetId)
    if (p.breedId !== build.breedId) throw new Error(`Preset « ${p.id} » d'une autre classe que le build (${p.className} ≠ classe ${build.breedId})`)
    return { preset: p }
  }
  const list = BASE_PRESETS.filter(p => p.breedId === build.breedId)
  if (!list.length) throw new Error(`Aucun preset pour la classe ${build.breedId}`)
  const el = dominantElement(computeBuildStats(build, data).stats)
  const own = list.find(x => x.element === el)
  if (own) return { preset: own, note: `Variantes de sorts, rôle et calibration du preset « ${own.id} » (${own.label}) : élément ${elementLabel(el)} du build (--class <preset> en ligne de commande, option presetId de l'API, pour en choisir un autre).` }
  const p = list[0]
  return {
    preset: p,
    fallback: `Aucun preset ${elementLabel(el)} pour la classe ${p.className} (élément du build) : preset « ${p.id} » (${p.label}, rôle ${ROLE_LABELS_FR[p.role] ?? p.role}) pris par défaut pour les variantes de sorts, le rôle et la calibration — --class <preset> en ligne de commande (option presetId de l'API) pour en choisir un autre.`,
  }
}

function resolveCharacter(data: GameDataStore, input: StuffInput, level: number, fillScrolls: boolean, levelGiven: boolean): Character {
  const warnings: string[] = []
  const assumptions: string[] = []
  if ('preset' in input) {
    const preset = resolvePreset(input.preset)
    const start = presetBuild(preset, data, { level })
    return { preset, start, input: 'preset', user: false, label: `Stuff du preset (${stuffLabel(preset.stuff)})`, warnings, assumptions }
  }
  let build: CharacterBuild
  let kind: 'build' | 'roxx'
  if ('roxx' in input) {
    kind = 'roxx'
    const imp = roxxImport(input.roxx, data)
    const noScrolls = Object.values(imp.build.scrolls ?? {}).every(v => !v)
    for (const w of imp.warnings) if (!/parchemins/.test(w)) warnings.push(`RoxxSolver : ${w}`)
    if (noScrolls) {
      if (fillScrolls) warnings.push('RoxxSolver : le lien ne contient pas de parchemins — 100 partout supposés (option fillScrolls: false pour garder 0).')
      else warnings.push('RoxxSolver : le lien ne contient pas de parchemins — 0 partout, comme le lien (à vérifier).')
    }
    build = {
      name: imp.name || 'Stuff RoxxSolver',
      breedId: imp.breedId,
      level: imp.level,
      characteristicPoints: { ...(imp.build.characteristicPoints ?? {}) },
      scrolls: noScrolls && fillScrolls ? fullScrolls() : { ...(imp.build.scrolls ?? {}) },
      items: imp.build.items.map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })) })),
    }
  } else {
    kind = 'build'
    build = { ...input.build, items: input.build.items.map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })) })) }
  }
  const { preset, note, fallback } = presetForBuild(data, build, input.presetId)
  if (note) assumptions.push(note)
  if (fallback) warnings.push(fallback)
  if (!build.spellVariants?.length) build.spellVariants = preset.variants.slice()
  if (levelGiven && level !== build.level) warnings.push(`Niveau demandé ${level} ignoré : le stuff fourni est de niveau ${build.level}.`)
  return { preset, start: build, input: kind, user: true, label: kind === 'roxx' ? 'Votre stuff (lien RoxxSolver)' : 'Votre stuff', warnings, assumptions }
}

// ---------------------------------------------------------------------------------------------------------------------
// Évaluation d'un stuff
// ---------------------------------------------------------------------------------------------------------------------

/** Contexte commun des évaluations (un personnage, une cible). */
interface Env {
  data: GameDataStore
  ctx: ProxyContext
  table: ReturnType<typeof theoryDptTable>
  who: TheoryCharacter
  preset: Preset
  role: RoleId
  /** Phases attaquables du boss (combattants hors combat) et leurs poids (ceux des cibles du proxy). */
  targets: Fighter[]
  weights: number[]
  /** Objets du départ (différences). */
  startItems: StuffItemLine[]
}

interface Meta {
  id: string
  origin: StuffOrigin
  label: string
  pointsId?: string
}

/** Lignes d'objets d'une fiche. */
function itemLines(data: GameDataStore, sheet: StuffSheet): StuffItemLine[] {
  return sheet.items.map(it => {
    const item = data.item(it.itemId)
    const line: StuffItemLine = {
      itemId: it.itemId,
      name: it.name,
      slot: it.slot,
      slotLabel: it.slotLabel,
      level: it.level,
      forge: it.forgemagie.map(f => `${f.label} (${FORGE_KIND_FR[f.kind] ?? f.kind})`),
    }
    if (item && hasPassive(item)) line.passive = true
    return line
  })
}

/** Différence d'objets (multiensembles d'ids) entre un stuff et le départ. */
function itemChanges(items: readonly StuffItemLine[], start: readonly StuffItemLine[]): { added: StuffItemLine[]; removed: StuffItemLine[] } {
  const diff = (a: readonly StuffItemLine[], b: readonly StuffItemLine[]) => {
    const left = new Map<number, number>()
    for (const x of b) left.set(x.itemId, (left.get(x.itemId) ?? 0) + 1)
    return a.filter(x => {
      const n = left.get(x.itemId) ?? 0
      if (n > 0) {
        left.set(x.itemId, n - 1)
        return false
      }
      return true
    })
  }
  return { added: diff(items, start), removed: diff(start, items) }
}

/** Clé d'un ensemble d'objets (ordre indifférent) : deux stuffs « distincts » ont des clés différentes. */
export function itemSetKey(build: CharacterBuild): string {
  return build.items
    .map(i => i.itemId)
    .sort((a, b) => a - b)
    .join(',')
}

interface SteadyRun {
  steady: number
  burst: number
  /** Rotations par phase. */
  runs: SustainedDamage[]
}

/** Ce que demande le DPT soutenu (posture, phases) : sans le contexte du proxy, pour mesurer avant de le construire. */
type DptEnv = Pick<Env, 'data' | 'table' | 'who' | 'targets' | 'weights'>

/** DPT soutenu pondéré par les phases (une posture). */
function steadyOver(env: DptEnv, a: Fighter): SteadyRun {
  let steady = 0
  let burst = 0
  let w = 0
  const runs = env.targets.map((t, i) => {
    const r = sustainedDamage(env.table, a, t)
    steady += env.weights[i] * r.steady
    burst += env.weights[i] * r.burst
    w += env.weights[i]
    return r
  })
  return { steady: w > 0 ? steady / w : 0, burst: w > 0 ? burst / w : 0, runs }
}

/**
 * Détail par sort du régime établi : `steadyBySpell` de chaque phase (lancers par tour, dégâts crédités : part
 * immédiate et poisons suivis, rotation.ts), pondéré par les phases. La somme des dégâts redonne le DPT soutenu.
 */
function spellBreakdown(env: Env, run: SteadyRun): { spells: StuffSpellLine[]; period: number } {
  const acc = new Map<number, { casts: number; damage: number }>()
  let w = 0
  let period = 0
  run.runs.forEach((r, i) => {
    const wi = env.weights[i]
    w += wi
    period = Math.max(period, r.period)
    for (const x of r.steadyBySpell) {
      const e = acc.get(x.spellId) ?? { casts: 0, damage: 0 }
      e.casts += wi * x.casts
      e.damage += wi * x.damage
      acc.set(x.spellId, e)
    }
  })
  const total = [...acc.values()].reduce((s, x) => s + x.damage, 0)
  const spells: StuffSpellLine[] = [...acc.entries()]
    .map(([spellId, x]) => {
      const lvl = env.data.spellLevel(spellId, { playerLevel: env.who.level })
      const castsPerTurn = w > 0 ? x.casts / w : 0
      const damagePerTurn = w > 0 ? x.damage / w : 0
      return {
        spellId,
        name: env.data.spell(spellId)?.name ?? `Sort ${spellId}`,
        apCost: lvl?.apCost ?? 0,
        castsPerTurn,
        damagePerCast: castsPerTurn > 0 ? damagePerTurn / castsPerTurn : 0,
        damagePerTurn,
        share: total > 0 ? x.damage / total : 0,
      }
    })
    .sort((x, y) => y.damagePerTurn - x.damagePerTurn || x.spellId - y.spellId)
  return { spells, period }
}

/** DPT soutenu pondéré par les phases, à la meilleure posture de la classe (stances.ts). */
function bestSteady(env: DptEnv, stats: Stats, maxHp: number): { run: SteadyRun; stance: ClassStance; base: Fighter } {
  const base = playerFighterFromStats(env.data, env.who, stats, maxHp)
  const runs = new Map<string, SteadyRun>()
  const choice = bestStance(
    env.who.breedId,
    states => {
      const run = steadyOver(env, withStates(base, states))
      runs.set(states.join(','), run)
      return run.steady
    },
    { knownSpells: base.spells.map(s => s.spellId) },
  )
  return { run: runs.get(choice.stance.states.join(','))!, stance: choice.stance, base }
}

/** DPT soutenu (meilleure posture), rafale et détail par sort ; `noStance` : soutenu sans aucun état (avertissement). */
function damageOf(env: Env, stats: Stats, maxHp: number, proxyDpt: number): { damage: StuffDamage; noStance: number; states: number[] } {
  const { run, stance, base } = bestSteady(env, stats, maxHp)
  const noStance = stance.states.length ? steadyOver(env, withStates(base, [])).steady : run.steady
  const { spells, period } = spellBreakdown(env, run)
  return {
    damage: { proxy: proxyDpt, steady: run.steady, burst: run.burst, stance: { id: stance.id, name: stance.name }, period, spells },
    noStance,
    states: stance.states.slice(),
  }
}

/**
 * logJ soutenu : logJ du proxy dont le terme a·ln(DPT du proxy) est remplacé par a·ln(DPT soutenu × calibration du
 * preset) — même échelle que le proxy ; PVe, UTIL et pénalités inchangés ; logarithme déterministe, comme le proxy.
 */
function sustainedLogJ(ctx: ProxyContext, logJ: number, proxyDpt: number, steady: number): number {
  const cal = ctx.calibration > 0 ? ctx.calibration : 1
  return logJ + ctx.exponents.a * (detLog(Math.max(1, steady * cal)) - detLog(Math.max(1, proxyDpt)))
}

/** Champs internes d'une évaluation (retirés de la sortie par `publicEval`). */
interface Internal {
  noStance: number
  /** États de la posture retenue (poids marginaux du DPT soutenu). */
  states: number[]
  stats: Stats
  maxHp: number
}
type Evaluated = StuffEvaluation & Internal

/** Évaluation complète d'un build dans le contexte commun. */
function evaluate(env: Env, build: CharacterBuild, meta: Meta): Evaluated {
  const r = computeBuildStats(build, env.data)
  const score: ProxyScore = env.ctx.exact(r.stats, r.maxHp)
  const element = dominantElement(r.stats)
  const sheet = buildStuffSheet(build, env.data, {
    name: build.name,
    className: env.preset.className,
    presetId: env.preset.extends ?? env.preset.id,
    presetLabel: env.preset.label,
    origin: meta.label,
    role: env.role,
    element,
    presetVariants: env.preset.variants,
  })
  const items = itemLines(env.data, sheet)
  const inc = env.ctx.incomingByElement(r.stats)
  const { damage, noStance, states } = damageOf(env, r.stats, r.maxHp, score.dpt)
  return {
    id: meta.id,
    origin: meta.origin,
    label: meta.label,
    valid: r.valid,
    issues: r.issues.map(i => i.message),
    element,
    logJ: r.valid ? score.logJ : null,
    logJSustained: r.valid ? sustainedLogJ(env.ctx, score.logJ, score.dpt, damage.steady) : null,
    damage,
    survival: {
      hp: r.maxHp,
      ehp: score.ehp,
      capped: score.ehp >= EHP_CAP * r.maxHp * (1 - 1e-9),
      incoming: score.incoming,
      incomingByElement: inc.byElement.slice(0, 5) as PerElement,
      incomingOther: inc.constant,
    },
    util: score.util,
    penalty: score.penalty,
    ap: r.stats.ap,
    mp: r.stats.mp,
    range: r.stats.range,
    items,
    changes: itemChanges(items, env.startItems),
    points: { ...build.characteristicPoints },
    scrolls: { ...build.scrolls },
    ...(meta.pointsId ? { pointsId: meta.pointsId } : {}),
    build,
    sheet,
    noStance,
    states,
    stats: r.stats,
    maxHp: r.maxHp,
  }
}

/** Retire les champs internes d'une évaluation (sortie sérialisable). */
function publicEval(e: StuffEvaluation & Partial<Internal>): StuffEvaluation {
  const { noStance: _n, states: _t, stats: _s, maxHp: _h, ...rest } = e
  return rest
}

// ---------------------------------------------------------------------------------------------------------------------
// Équivalences des caractéristiques
// ---------------------------------------------------------------------------------------------------------------------

/** Caractéristiques en pourcentage (affichage « 1 % … »). */
const PCT_STATS: ReadonlySet<StatKey> = new Set<StatKey>([
  'critical', 'spellDamagePct', 'weaponDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'finalDamagePct', 'neutralResPct', 'earthResPct',
  'fireResPct', 'waterResPct', 'airResPct', 'meleeResPct', 'rangedResPct', 'spellResPct', 'weaponResPct',
])

/** Nombre lisible (2 chiffres significatifs sous 10, entier au-delà). */
function readable(x: number): string {
  const a = Math.abs(x)
  const v = a >= 100 ? Math.round(x) : a >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100
  return (v === 0 ? 0 : v).toLocaleString('fr-FR') // jamais « -0 »
}

/** Contexte des équivalences (`statEquivalences`). */
export interface StatEquivalenceOptions {
  /**
   * PA, PM, PO : part du poids due aux seules pénalités de l'objectif (∂ln pénalités pour un point sous le plafond) —
   * affichée à part de la valeur modélisée.
   */
  penalties?: Partial<Record<'ap' | 'mp' | 'range', number>>
  /** DPT soutenu du stuff : sous 1, la référence en Vitalité s'explique par l'absence de dégâts. */
  steady?: number
  /** PO visée par l'objectif (défaut 6) : 0 au contact, la PO ne vaut alors rien (note). */
  rangeNeed?: number
  /** Classement soutenu : nom de la posture dont le DPT soutenu donne la part des dégâts (note). */
  sustainedStance?: string
  /**
   * Classement par le proxy : nom de la posture dont le DPT soutenu donne la part des dégâts d'un PA (note ; le DPT du
   * proxy, un tour isolé, évolue par paliers).
   */
  apSustainedStance?: string
}

/**
 * Équivalences lisibles des poids marginaux ∂(score)/∂point (`weightsAtBest`) : « 1 X ≈ N points de la référence ».
 * Référence = caractéristique principale de l'élément du stuff ; si elle ne vaut rien contre ce boss, la
 * caractéristique élémentaire la plus utile (un Sram Air niveau 40 ne frappe qu'en Terre et en Eau : sorts Air pas
 * encore débloqués), sinon la Vitalité (dégâts nuls : résistances ≥ 100 %, invulnérabilité). PA/PM/PO : la part due aux
 * pénalités de l'objectif (`penalties`) est séparée de la part modélisée (dégâts, survie, utilité). `perRuneWeight` :
 * valeur par unité de poids de rune (`RUNE_WEIGHT_PER_POINT`), relative à la référence — aide aux choix de
 * forgemagie. Caractéristiques sans valeur (poids ≤ 0) omises ; tri par valeur par point décroissante.
 */
export function statEquivalences(weights: Partial<Record<StatKey, number>>, element: StuffElement, opts: StatEquivalenceOptions = {}): StuffStatWeights {
  const notes = [
    'Poids marginaux ∂logJ/∂point de la forme fermée d’un proxy construit AU meilleur stuff (son élément, sa rotation) : valables pour CE boss, CE rôle et CE profil, et pour de petits changements (linéarisation locale).',
    opts.rangeNeed === 0
      ? `PA et PM : valeur d’un point SOUS le plafond (12 PA, 6 PM) — au-delà du plafond un point ne vaut rien ; PO non exigée (joué au contact) : une PO ne vaut rien. Elle comprend les pénalités de l’objectif (${PENALTY_TEXT}) : un réglage de l’objectif, pas un effet du boss, affiché à part (« dont … de pénalité d’objectif »).`
      : `PA, PM et PO : valeur d’un point SOUS le plafond (12 PA, 6 PM, 6 PO) — au-delà du plafond un point ne vaut rien. Elle comprend les pénalités de l’objectif (${PENALTY_TEXT}) : un réglage de l’objectif, pas un effet du boss, affiché à part (« dont … de pénalité d’objectif »).`,
    '« Par poids de rune » : valeur pour une même dépense de forgemagie (poids des runes), relative à la référence.',
  ]
  if (opts.sustainedStance) notes.push(`Classement soutenu : la part des dégâts vient du DPT soutenu en posture « ${opts.sustainedStance} » (différences finies de la rotation établie), pas du DPT du proxy.`)
  if (opts.apSustainedStance)
    notes.push(`PA : la part des dégâts vient du DPT soutenu en posture « ${opts.apSustainedStance} » (rotation établie à PA − 1 et PA), pas du DPT du proxy : un tour isolé évolue par paliers (un PA de plus peut ne rien changer à la rafale et allonger la rotation établie).`)
  const main = ELEMENT_STAT[element]
  const positive = (k: StatKey) => (weights[k] ?? 0) > 1e-12
  const elemental = STUFF_ELEMENTS.map(e => ELEMENT_STAT[e])
    .filter(positive)
    .sort((x, y) => weights[y]! - weights[x]! || (x < y ? -1 : 1))
  const reference: StatKey | undefined = positive(main) ? main : (elemental[0] ?? (positive('vitality') ? 'vitality' : undefined))
  if (reference !== main) {
    const noDamage = opts.steady === undefined || opts.steady < 1
    notes.push(
      reference === undefined
        ? 'Aucune caractéristique de référence n’a de valeur (ni dégâts ni survie mesurables) : pas d’équivalence.'
        : reference === 'vitality'
          ? `La caractéristique principale (${statLabelFr(main)}) ne vaut rien ici (${noDamage ? 'aucun dégât' : 'aucune caractéristique élémentaire n’augmente les dégâts dans l’objectif'}) : équivalences en Vitalité.`
          : `La caractéristique principale (${statLabelFr(main)}) ne vaut rien ici (aucun sort de cet élément dans la rotation contre ce boss) : équivalences en ${statLabelFr(reference)}, la caractéristique élémentaire la plus utile.`,
    )
  }
  const refW = reference ? weights[reference]! : 0
  const refRune = reference ? (RUNE_WEIGHT_PER_POINT[reference] ?? 1) : 1
  const refLabel = reference ? statLabelFr(reference) : ''
  const items: StatEquivalence[] = (Object.keys(weights) as StatKey[])
    .filter(k => positive(k) && Number.isFinite(weights[k]!))
    .map(k => {
      const w = weights[k]!
      const inReference = reference ? w / refW : null
      const rune = RUNE_WEIGHT_PER_POINT[k]
      const perRuneWeight = reference && rune ? w / rune / (refW / refRune) : null
      const unit = PCT_STATS.has(k) ? `1 % ${statLabelFr(k)}` : `1 ${statLabelFr(k)}`
      const capped = k === 'ap' || k === 'mp' || k === 'range' ? ' (sous le plafond)' : ''
      const pen = k === 'ap' || k === 'mp' || k === 'range' ? opts.penalties?.[k] : undefined
      const eq: StatEquivalence = { stat: k, label: statLabelFr(k), perPoint: w, inReference, perRuneWeight, text: '' }
      if (pen !== undefined && pen > 1e-12) {
        eq.objectivePenalty = pen
        eq.modeledInReference = reference ? (w - pen) / refW : null
      }
      if (reference && inReference !== null) {
        eq.text = `${unit}${capped} ≈ ${readable(inReference)} ${refLabel}`
        if (eq.modeledInReference != null) eq.text += `, dont ${readable(pen! / refW)} de pénalité d’objectif (${readable(eq.modeledInReference)} pour les effets modélisés)`
      } else eq.text = `${unit}${capped} : ${w.toExponential(2)} logJ`
      return eq
    })
    .sort((x, y) => y.perPoint - x.perPoint || (x.stat < y.stat ? -1 : 1))
  return { reference: reference ?? main, referenceLabel: statLabelFr(reference ?? main), items, notes }
}

/** Pas des différences finies de `ProxyContext.statWeightsAt` (proxy.ts) : 10 unités de poids de rune, 1 PA/PM/PO. */
function weightStep(k: StatKey): number {
  return k === 'ap' || k === 'mp' || k === 'range' || k === 'summons' ? 1 : Math.max(1, Math.round(10 / RUNE_WEIGHT_PER_POINT[k]!))
}

/**
 * Poids marginaux au meilleur stuff dans un contexte du proxy construit À ce stuff : la forme fermée fige sa rotation
 * et ses éléments aux caractéristiques de référence — le contexte commun (départ) ignorerait les sorts d'un autre
 * élément (meilleur stuff Feu d'un preset Terre, option `elements: 'all'`). Classement soutenu : terme de DPT du proxy
 * retiré (a = 0) et remplacé par a·∂ln(DPT soutenu)/∂point (posture du meilleur stuff, mêmes pas que
 * `statWeightsAt`). Classement par le proxy : pour le PA seulement, a·Δln(DPT du proxy) remplacé par a·Δln(DPT
 * soutenu) — le DPT du proxy (un tour isolé, sac à dos) évolue par paliers : un 12e PA peut laisser la rafale
 * inchangée et ajouter plusieurs % au DPT soutenu (Iop Terre contre Merkator). Rend aussi, pour PA/PM/PO, la part due
 * aux pénalités de l'objectif (∂ln pénalités).
 */
function weightsAtBest(
  env: Env,
  member: ProxyMember,
  options: ProxyOptions,
  best: Pick<Evaluated, 'stats' | 'maxHp' | 'states' | 'element'>,
  rankBy: RankBy,
): { weights: Partial<Record<StatKey, number>>; penalties: Partial<Record<'ap' | 'mp' | 'range', number>> } {
  const a = env.ctx.exponents.a
  const ctx = createProxyContext(
    env.data,
    { ...member, element: best.element },
    { stats: best.stats, maxHp: best.maxHp },
    rankBy === 'sustained' ? { ...options, exponents: { ...env.ctx.exponents, a: 0 } } : options,
  )
  const weights = ctx.statWeightsAt(best.stats, best.maxHp)
  const cap = (k: 'ap' | 'mp' | 'range') => (k === 'ap' ? ctx.apTarget : k === 'mp' ? ctx.mpTarget : 6)
  const cal = ctx.calibration > 0 ? ctx.calibration : 1
  const lnSteady = (s: Stats, hp: number) => detLog(Math.max(1, steadyOver(env, withStates(playerFighterFromStats(env.data, env.who, s, hp), best.states)).steady * cal))
  if (rankBy === 'proxy' && a > 0) {
    // PA : part des dégâts tirée du DPT soutenu (voir l'en-tête), calibration commune (elle s'annule dans l'écart).
    const s: Stats = { ...best.stats }
    s.ap = Math.min(s.ap, cap('ap') - 1)
    const lo = ctx.surrogate(s, best.maxHp).dpt
    const loSteady = lnSteady(s, best.maxHp)
    s.ap += 1
    const hi = ctx.surrogate(s, best.maxHp).dpt
    weights.ap = (weights.ap ?? 0) - a * (detLog(Math.max(1, hi)) - detLog(Math.max(1, lo))) + a * (lnSteady(s, best.maxHp) - loSteady)
  }
  if (rankBy === 'sustained' && a > 0) {
    const base = lnSteady(best.stats, best.maxHp)
    for (const k of Object.keys(RUNE_WEIGHT_PER_POINT) as StatKey[]) {
      const s: Stats = { ...best.stats }
      let hp = best.maxHp
      let d: number
      if (k === 'ap' || k === 'mp' || k === 'range') {
        s[k] = Math.min(s[k], cap(k) - 1)
        const lo = lnSteady(s, hp)
        s[k] += 1
        d = lnSteady(s, hp) - lo
      } else {
        const step = weightStep(k)
        s[k] += step
        if (k === 'vitality' || k === 'lifePoints') hp += step
        d = (lnSteady(s, hp) - base) / step
      }
      weights[k] = (weights[k] ?? 0) + a * d
    }
  }
  const penalties: Partial<Record<'ap' | 'mp' | 'range', number>> = {}
  for (const k of ['ap', 'mp', 'range'] as const) {
    const s: Stats = { ...best.stats }
    s[k] = Math.min(s[k], cap(k) - 1)
    const lo = ctx.surrogate(s, best.maxHp).penalty
    s[k] += 1
    const part = detLog(ctx.surrogate(s, best.maxHp).penalty) - detLog(lo)
    if (part > 1e-12) penalties[k] = part
  }
  return { weights, penalties }
}

// ---------------------------------------------------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------------------------------------------------

/** Build de départ d'une recherche pour un autre élément : points du preset reportés, stuff générique de l'élément. */
function elementStart(data: GameDataStore, preset: Preset, element: StuffElement, level: number, name: string): CharacterBuild {
  const stuff = GENERIC_BY_ELEMENT[element]
  const build = presetBuild(preset, data, { stuff, level, name })
  build.characteristicPoints = allocatePoints({ ...preset.points, primary: ELEMENT_STAT[element] as PrimaryStat }, preset.breedId, data, level)
  return build
}

/** Résistance effective moyenne du boss dans un élément (phases attaquables, poids des cibles du proxy). */
function bossResIn(env: Env, element: StuffElement): number {
  const key = ELEMENT_RES_PCT[ELEMENT_OF[element]]
  let s = 0
  let w = 0
  env.targets.forEach((t, i) => {
    s += env.weights[i] * t.stats[key]
    w += env.weights[i]
  })
  return w > 0 ? s / w : 0
}

/** Objets de `a` absents de `b` (multiensembles d'ids). */
function itemDifferences(a: CharacterBuild, b: CharacterBuild): number {
  const left = new Map<number, number>()
  for (const it of b.items) left.set(it.itemId, (left.get(it.itemId) ?? 0) + 1)
  let n = 0
  for (const it of a.items) {
    const k = left.get(it.itemId) ?? 0
    if (k > 0) left.set(it.itemId, k - 1)
    else n++
  }
  return n
}

/**
 * Les `n` meilleurs stuffs DISTINCTS (liste déjà triée) : chacun diffère d'au moins `minDiff` objets de ceux déjà
 * retenus ; places restantes complétées par des ensembles d'objets simplement différents. Rendus dans l'ordre de
 * `sorted` (le second passage peut retenir un stuff mieux classé que ceux du premier : pas de numérotation trompeuse).
 */
function pickDistinct<T extends { build: CharacterBuild }>(sorted: readonly T[], n: number, minDiff: number): T[] {
  const out = new Set<T>()
  const chosen: CharacterBuild[] = []
  for (const pass of minDiff > 1 ? [minDiff, 1] : [1]) {
    for (const p of sorted) {
      if (out.size >= n) break
      if (out.has(p)) continue
      if (chosen.some(b => Math.max(itemDifferences(p.build, b), itemDifferences(b, p.build)) < pass)) continue
      out.add(p)
      chosen.push(p.build)
    }
  }
  return sorted.filter(p => out.has(p))
}

/** Score qui classe les stuffs (`StuffVsBossResult.ranking`). */
type RankBy = 'proxy' | 'sustained'

/** Candidat au classement : stuff de la recherche, ou stuff de référence déjà évalué (`ev`). */
interface Pooled {
  build: CharacterBuild
  pointsId?: string
  /** Score de classement (logJ, ou logJ soutenu). */
  rank: number
  key: string
  /** Élément du stuff (caractéristique élémentaire la plus haute) — pas forcément celui de la recherche qui l'a trouvé. */
  element: StuffElement
  /** Élément de la recherche (absent : stuff de référence). */
  run?: StuffElement
  /** Stuff de référence (départ, preset, générique), déjà évalué. */
  ev?: Evaluated
  /** Produit par l'affinage soutenu (`polishSustained`). */
  polished?: boolean
}

/** Ordre de classement : score décroissant ; à égalité, stuff de référence d'abord (un candidat identique au départ reste « le départ »), puis clé. */
function byRank(a: Pooled, b: Pooled): number {
  return b.rank - a.rank || (a.ev ? 0 : 1) - (b.ev ? 0 : 1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

/** Le build porte-t-il tous ces objets (multiensemble) ? */
function hasAll(build: CharacterBuild, ids: readonly number[]): boolean {
  const left = build.items.map(i => i.itemId)
  return ids.every(id => {
    const k = left.indexOf(id)
    if (k < 0) return false
    left.splice(k, 1)
    return true
  })
}

/** Objets d'un build rangés par position (`STUFF_POSITIONS`, 0 = vide ; première position libre de leur emplacement). */
function positionIds(data: GameDataStore, build: CharacterBuild): number[] {
  const ids = STUFF_POSITIONS.map(() => 0)
  for (const eq of build.items) {
    const it = data.item(eq.itemId)
    if (!it) continue
    const p = STUFF_POSITIONS.findIndex((slot, i) => slot === it.slot && ids[i] === 0)
    if (p >= 0) ids[p] = it.id
  }
  return ids
}

/**
 * Build forgé d'un ensemble d'objets par position (points, parchemins et variantes de `base`) : forgemagie
 * re-planifiée (`planForgemagie`, profil thlOptimized : exos PA/PM/PO utiles, ≤ 6 transcendances) aux poids `weights`,
 * sur les caractéristiques SANS forgemagie ; si la forgemagie casse une condition d'objet, stuff sans forgemagie (même
 * règle que la recherche). undefined : build invalide.
 */
function forgedBuild(data: GameDataStore, base: CharacterBuild, ids: readonly number[], weights: Partial<Record<StatKey, number>>): { build: CharacterBuild; stats: Stats; maxHp: number } | undefined {
  const bare: CharacterBuild = { ...base, items: ids.filter(id => id > 0).map(itemId => ({ itemId })) }
  const r0 = computeBuildStats(bare, data)
  if (!r0.valid) return undefined
  const plan = planForgemagie(
    ids.map(id => (id > 0 ? (data.item(id) ?? null) : null)),
    r0.stats,
    { profile: 'thlOptimized', weights, rangeCap: 6 },
  )
  if (!plan.lines.some(l => l.length)) return { build: bare, stats: r0.stats, maxHp: r0.maxHp }
  const items: EquippedItem[] = []
  ids.forEach((id, i) => {
    if (id > 0) items.push(plan.lines[i].length ? { itemId: id, exos: plan.lines[i].map(l => ({ ...l })) } : { itemId: id })
  })
  const build: CharacterBuild = { ...base, items }
  const r = computeBuildStats(build, data)
  return r.valid ? { build, stats: r.stats, maxHp: r.maxHp } : { build: bare, stats: r0.stats, maxHp: r0.maxHp }
}

interface PolishPoint {
  build: CharacterBuild
  stats: Stats
  maxHp: number
  rank: number
}

/**
 * Affinage en DPT soutenu (classement soutenu seulement) : la recherche ne voit pas les dégâts en posture, ses stuffs
 * privilégient la survie. Montée par coordonnées sur le logJ soutenu depuis `from` (stuff le mieux classé) : à chaque
 * position, les objets du même emplacement portés par les `donors` (candidats de la recherche et stuffs de
 * référence), forgemagie re-planifiée aux poids soutenus du point de départ (`weightsAtBest`), points de
 * caractéristiques de `from` ; la meilleure amélioration valide (`computeBuildStats`) est gardée. Objets `locked`
 * jamais retirés, objets non `allowed` jamais ajoutés ; au plus `POLISH_SWEEPS` balayages, positions et objets dans un
 * ordre fixe (déterministe). undefined : rien n'améliore `from`.
 */
function polishSustained(
  env: Env,
  member: ProxyMember,
  options: ProxyOptions,
  from: CharacterBuild,
  donors: readonly CharacterBuild[],
  locked: (id: number) => boolean,
  allowed: (id: number) => boolean,
): PolishPoint | undefined {
  const data = env.data
  const rankAt = (stats: Stats, maxHp: number) => {
    const score = env.ctx.exact(stats, maxHp)
    return sustainedLogJ(env.ctx, score.logJ, score.dpt, bestSteady(env, stats, maxHp).run.steady)
  }
  const r0 = computeBuildStats(from, data)
  if (!r0.valid) return undefined
  const { stance } = bestSteady(env, r0.stats, r0.maxHp)
  const { weights } = weightsAtBest(env, member, options, { stats: r0.stats, maxHp: r0.maxHp, states: stance.states.slice(), element: dominantElement(r0.stats) }, 'sustained')
  // Objets essayés par emplacement (ids croissants).
  const bySlot = new Map<string, number[]>()
  for (const b of donors) {
    for (const eq of b.items) {
      const it = data.item(eq.itemId)
      if (!it || !allowed(it.id)) continue
      const list = bySlot.get(it.slot) ?? []
      if (!list.includes(it.id)) list.push(it.id)
      bySlot.set(it.slot, list)
    }
  }
  for (const list of bySlot.values()) list.sort((a, b) => a - b)
  const ids = positionIds(data, from)
  const startRank = rankAt(r0.stats, r0.maxHp)
  let cur: PolishPoint = { build: from, stats: r0.stats, maxHp: r0.maxHp, rank: startRank }
  // Départ re-forgé aux poids soutenus (la forgemagie de la recherche visait le DPT sans posture).
  const reforged = forgedBuild(data, from, ids, weights)
  if (reforged) {
    const rank = rankAt(reforged.stats, reforged.maxHp)
    if (rank > cur.rank + 1e-9) cur = { ...reforged, rank }
  }
  for (let sweep = 0; sweep < POLISH_SWEEPS; sweep++) {
    let improved = false
    for (let p = 0; p < ids.length; p++) {
      if (ids[p] > 0 && locked(ids[p])) continue
      let move: { id: number; point: PolishPoint } | undefined
      for (const id of bySlot.get(STUFF_POSITIONS[p]) ?? []) {
        if (id === ids[p]) continue
        const next = ids.slice()
        next[p] = id
        const f = forgedBuild(data, from, next, weights)
        if (!f) continue
        const rank = rankAt(f.stats, f.maxHp)
        if (rank > (move?.point.rank ?? cur.rank) + 1e-9) move = { id, point: { ...f, rank } }
      }
      if (move) {
        ids[p] = move.id
        cur = move.point
        improved = true
      }
    }
    if (!improved) break
  }
  return cur.rank > startRank + 1e-9 ? cur : undefined
}

/** Règle qui a fixé le style de jeu (hypothèses), quand `PlayStyle.reason` ne l'explique pas. */
function styleRule(st: PlayStyle): string {
  const seuil = `seuil ${fr(CONTACT_SHARE * 100, 0)} %`
  switch (st.source) {
    case 'explicit':
      return 'choix explicite (option melee de l’API)'
    case 'boss':
      return 'boss attaquable seulement au contact'
    case 'dpt':
      return `au moins ${fr((st.contactShare ?? 0) * 100, 0)} % du DPT soutenu contre ce boss au contact (${seuil})`
    case 'preset':
      return st.contact
        ? 'preset de mêlée'
        : `preset à distance${st.contactShare !== undefined ? `, ${fr(st.contactShare * 100, 0)} % du DPT soutenu contre ce boss au contact (${seuil})` : ''}`
  }
}

/** Sorts de la classe qui donnent de la PO (effet 117) : bonus temporaires, non déduits de la PO visée. */
function rangeBuffs(f: Fighter): string[] {
  const out: string[] = []
  for (const s of f.spells) {
    const po = s.level.effects.filter(e => e.effectId === 117 && e.diceNum > 0)
    if (po.length) out.push(`${s.name} +${Math.max(...po.map(e => e.diceNum))} PO`)
  }
  return out
}

/**
 * Stuff le plus intéressant contre un boss (voir l'en-tête) : comparaison des stuffs de référence, optimisation,
 * classement commun (logJ du proxy, ou logJ soutenu pour une classe à posture), meilleur + `top` distincts,
 * équivalences des caractéristiques, hypothèses et avertissements.
 */
export function stuffVsBoss(data: GameDataStore, input: StuffInput, profile: BossProfile, opts: StuffVsBossOptions = {}): StuffVsBossResult {
  const t0 = performance.now()
  const level = opts.level ?? DEFAULT_LEVEL
  const iterations = Math.max(0, Math.floor(opts.iterations ?? DEFAULT_ITERATIONS))
  const elementsMode = opts.elements ?? 'preset'
  const restarts = Math.max(1, Math.floor(opts.restarts ?? (elementsMode === 'all' ? DEFAULT_RESTARTS_ALL : DEFAULT_RESTARTS)))
  const topN = Math.max(1, Math.floor(opts.top ?? DEFAULT_TOP))
  const seed = opts.seed ?? 1
  const keepPassives = opts.keepPassives ?? true
  const expProfile = opts.profile ?? 'balanced'
  const exclude = [...new Set(opts.exclude ?? [])]
  const both = [...new Set(opts.fixed ?? [])].filter(id => exclude.includes(id))
  if (both.length) throw new Error(`Objets à la fois imposés et exclus : ${both.map(id => `${data.item(id)?.name ?? 'objet'} (${id})`).join(', ')}.`)

  const ch = resolveCharacter(data, input, level, opts.fillScrolls ?? true, opts.level !== undefined)
  const preset = ch.preset
  const start = ch.start
  const buildLevel = start.level
  const role: RoleId = opts.role ?? preset.role
  const variants = (start.spellVariants?.length ? start.spellVariants : preset.variants).slice()
  const presetId = preset.extends ?? preset.id
  const startStats = computeBuildStats(start, data)
  const startElement: StuffElement = ch.user ? dominantElement(startStats.stats) : preset.element
  const warnings = [...ch.warnings]
  const assumptions = [...ch.assumptions]

  // ── Style de jeu (`resolveStyle`, règle commune à `rankClasses`) : part du DPT soutenu portée par des coups au contact,
  // mesurée au stuff de départ avec le style de la règle sans mesure (`playsMelee`) ; choix explicite `melee` prioritaire.
  // Les phases attaquables (cibles du DPT) ne dépendent pas du style. ──
  const ruleContact = playsMelee(profile, presetId)
  const ruleTarget = bossProxyOptions(profile, { role, profile: expProfile, melee: opts.melee ?? ruleContact })
  const table = theoryDptTable(data)
  const targets = (ruleTarget.options.targets ?? []).map(t => bossFighter(data, t.monsterId, { grade: t.grade ?? profile.grade, stats: t.stats, states: t.states }))
  const weights = (ruleTarget.options.targets ?? []).map(t => t.weight)
  const base: TheoryCharacter = { breedId: preset.breedId, level: buildLevel, variants, presetId, name: start.name }
  const measured = bestSteady({ data, table, who: { ...base, contact: ruleContact }, targets, weights }, startStats.stats, startStats.maxHp)
  const share = contactShare(table, withStates(measured.base, measured.stance.states), targets, weights, measured.run.runs)
  const style = resolveStyle(profile, presetId, { contactShare: share }, opts.melee)
  const melee = style.contact

  // ── Cible et contexte commun (comme celui de l'optimiseur : build de départ comme référence) ──
  const target = melee === (opts.melee ?? ruleContact) ? ruleTarget : bossProxyOptions(profile, { role, profile: expProfile, melee })
  const options: ProxyOptions = opts.rangeNeed !== undefined ? { ...target.options, rangeNeed: Math.max(0, Math.floor(opts.rangeNeed)) } : target.options
  const member: MemberSpec = { name: start.name, breedId: preset.breedId, presetId, build: start, variants, role }
  const proxyMember: ProxyMember = { breedId: preset.breedId, level: buildLevel, variants, role, presetId, element: startElement, name: start.name }
  const ctx = createProxyContext(data, proxyMember, { stats: startStats.stats, maxHp: startStats.maxHp }, options)
  warnings.push(...target.warnings)
  // Dégâts reçus du proxy (PVe, objectif) face au profil offensif de la fiche (mêmes phases, joueur à 0 % de résistance).
  const coherence = incomingCoherence(profile, target, ctx.incomingUndefended(refHpOf(profile)))
  if (coherence?.warning) warnings.push(coherence.warning)
  const who: TheoryCharacter = { ...base, contact: melee }
  const env: Env = { data, ctx, table, who, preset, role, targets, weights, startItems: [] }
  const startEval = evaluate(env, start, { id: ch.user ? 'user' : 'start', origin: ch.user ? 'user' : 'start', label: ch.label })
  env.startItems = startEval.items
  startEval.changes = { added: [], removed: [] }
  const startValid = startStats.valid
  if (!startValid) warnings.push(`Le stuff de départ est invalide (${startStats.issues.filter(i => i.severity === 'error').map(i => i.message).slice(0, 3).join(' ; ')}) : il n'est jamais présenté comme meilleur.`)

  // ── Score de classement. Le proxy ne pose aucune posture de classe : s'il ne voit au départ qu'une petite part des
  // dégâts de la classe (Zobal, Forgelance, Pandawa…), les stuffs sont classés par le logJ soutenu. ──
  const rankBy: RankBy = STANCES[preset.breedId] && startEval.noStance * STANCE_GAP < startEval.damage.steady ? 'sustained' : 'proxy'
  const rankOf = (e: { logJ: number | null; logJSustained: number | null }) => (rankBy === 'sustained' ? e.logJSustained : e.logJ)
  const rankLabel = rankBy === 'sustained' ? 'logJ soutenu' : 'logJ du proxy'
  const rankingReason =
    rankBy === 'sustained'
      ? `Classement par le logJ SOUTENU : le proxy de l'optimiseur ne pose aucune posture de classe et ne voit au départ que ${Math.round(startEval.noStance)} de DPT soutenu sans posture, contre ${Math.round(startEval.damage.steady)} en « ${startEval.damage.stance.name} ». Le DPT du proxy est remplacé par le DPT soutenu en posture (× calibration du preset) pour classer ensemble stuffs de référence et candidats ; la recherche, elle, reste aveugle à ces dégâts (ses stuffs privilégient la survie).`
      : 'Classement par le logJ du proxy (objectif de l’optimiseur) ; stuffs de référence et candidats de la recherche classés ensemble.'

  // ── Stuffs de référence : preset (si le départ est le stuff de l'utilisateur), génériques hors scénario ──
  const seedFilter = theorySeedFilter({ level: buildLevel })
  const genericIds = Object.keys(STUFFS)
    .sort()
    .filter(id => {
      const s: StuffTemplate = STUFFS[id]
      return seedFilter(id, s, data) && (!s.breeds || s.breeds.includes(preset.breedId))
    })
  const refs: Evaluated[] = []
  if (ch.user) refs.push(evaluate(env, presetBuild(preset, data, { level: buildLevel, name: start.name }), { id: 'preset', origin: 'preset', label: `Stuff du preset (${stuffLabel(preset.stuff)})` }))
  for (const id of genericIds) {
    if (id === preset.stuff) continue // déjà la ligne de départ (preset) ou la ligne « stuff du preset » (utilisateur)
    refs.push(evaluate(env, presetBuild(preset, data, { stuff: id, level: buildLevel, name: start.name }), { id: `generic:${id}`, origin: 'generic', label: `Générique ${stuffLabel(id)}` }))
  }
  const skippedGenerics = Object.keys(STUFFS).filter(id => !id.startsWith('vortex_') && !genericIds.includes(id))
  if (skippedGenerics.length) assumptions.push(`Stuffs génériques non évalués (objets au-dessus du niveau ${buildLevel}) : ${skippedGenerics.join(', ')}.`)
  opts.onProgress?.({ step: 'evaluate', label: 'stuffs de référence', done: refs.length + 1, total: refs.length + 1 })

  // ── Optimisation(s) ──
  // Dofus à passif du départ gardés seulement s'ils sont portables à ce niveau (un preset de niveau 200 joué au niveau
  // 30 en porte de niveau 160-180) ; objets imposés au-dessus du niveau : écartés (ils rendraient tout stuff invalide).
  const wearable = (id: number) => (data.item(id)?.level ?? Infinity) <= buildLevel
  const passiveIds = keepPassives
    ? start.items.map(it => data.item(it.itemId)).filter(it => !!it && it.slot === 'dofus' && hasPassive(it) && wearable(it.id)).map(it => it!.id)
    : []
  const tooHigh = (opts.fixed ?? []).filter(id => !wearable(id))
  if (tooHigh.length) warnings.push(`Objets imposés au-dessus du niveau ${buildLevel} ignorés : ${tooHigh.map(id => data.item(id)?.name ?? id).join(', ')}.`)
  const fixed = [...new Set([...passiveIds, ...(opts.fixed ?? []).filter(wearable)])].filter(id => !exclude.includes(id))
  // Graines proposées par l'optimiseur : gardées (`seedStuffs`) ou écartées par `theorySeedFilter` (`excludedSeeds`).
  const seedStuffs = new Set<string>()
  const excludedSeeds = new Set<string>()
  const recordingFilter = (id: string, s: StuffTemplate, d: GameDataStore) => {
    const ok = seedFilter(id, s, d)
    ;(ok ? seedStuffs : excludedSeeds).add(id)
    return ok
  }
  const runElements: StuffElement[] = elementsMode === 'all' ? STUFF_ELEMENTS.slice() : [startElement]
  const total = runElements.length * restarts
  let done = 0
  const evaluations = { surrogate: 0, exact: 0 }
  let pools: StuffResult['pools'] | undefined
  const pooled: Pooled[] = []
  for (const el of runElements) {
    const own = el === startElement
    const m: MemberSpec = own ? member : { ...member, build: { ...elementStart(data, preset, el, buildLevel, start.name), spellVariants: variants.slice() } }
    for (let k = 0; k < restarts; k++) {
      const res = optimizeStuff(data, m, {
        iterations,
        seed: seed + k,
        proxy: options,
        role,
        element: el,
        seedFilter: recordingFilter,
        fixed,
        exclude,
        diversity: 1000,
      })
      evaluations.surrogate += res.evaluations.surrogate
      evaluations.exact += res.evaluations.exact
      pools ??= res.pools
      const cands: StuffCandidate[] = [res.best, ...res.front]
      for (const c of cands) {
        if (c.key === 'start') continue
        const r = computeBuildStats(c.build, data)
        if (!r.valid) continue
        // Candidats re-notés dans le contexte commun (logJ comparables entre recherches et éléments).
        const score = ctx.exact(r.stats, r.maxHp)
        const rank = rankBy === 'sustained' ? sustainedLogJ(ctx, score.logJ, score.dpt, bestSteady(env, r.stats, r.maxHp).run.steady) : score.logJ
        pooled.push({ build: c.build, pointsId: c.pointsId, rank, key: `${itemSetKey(c.build)}|${c.key}|${JSON.stringify(c.build.characteristicPoints)}`, element: dominantElement(r.stats), run: el })
      }
      opts.onProgress?.({ step: 'optimize', label: `${elementLabel(el)}${restarts > 1 ? ` (recherche ${k + 1}/${restarts})` : ''}`, done: ++done, total })
    }
  }

  // ── Classement commun : candidats de la recherche ET stuffs de référence valides (départ, preset, génériques) qui
  // portent les objets imposés (un générique sans les Dofus gardés ne respecte pas `fixed`) et aucun objet exclu ──
  const hasExcluded = (b: CharacterBuild) => b.items.some(i => exclude.includes(i.itemId))
  const candidates: Pooled[] = [...pooled]
  const skippedRefs: string[] = []
  for (const ev of [startEval, ...refs]) {
    const r = rankOf(ev)
    if (!ev.valid || r === null || !hasAll(ev.build, fixed)) continue
    if (hasExcluded(ev.build)) skippedRefs.push(ev.label)
    else candidates.push({ build: ev.build, rank: r, key: `ref:${ev.id}`, element: ev.element, ev })
  }
  if (skippedRefs.length) assumptions.push(`Stuffs de référence écartés du classement (objet exclu) : ${skippedRefs.join(', ')} — affichés dans la comparaison seulement.`)
  candidates.sort(byRank)
  const minDifferences = Math.max(1, Math.floor(opts.minDifferences ?? DEFAULT_MIN_DIFFERENCES))
  // ── Affinage soutenu (classement soutenu) : la recherche est aveugle aux dégâts en posture ──
  let polish: { ms: number; starts: number; gain: number } | undefined
  if (rankBy === 'sustained' && candidates.length) {
    const tp = performance.now()
    const before = candidates[0].rank
    // Objets essayés : ceux de tous les candidats et de tous les stuffs de référence.
    const donors = [...candidates.map(p => p.build), ...refs.filter(e => !candidates.some(p => p.ev === e)).map(e => e.build)]
    // Points de départ sans objet exclu (les candidats de la recherche n'en portent pas ; les références exclues sont
    // déjà écartées) : l'affinage ne réintroduit jamais un objet interdit.
    const starts = pickDistinct(candidates.filter(p => !hasExcluded(p.build)), POLISH_STARTS, minDifferences)
    for (const from of starts) {
      const point = polishSustained(env, proxyMember, options, from.build, donors, id => fixed.includes(id), id => !exclude.includes(id) && wearable(id))
      if (!point) continue
      const element = dominantElement(point.stats)
      candidates.push({ build: point.build, rank: point.rank, key: `polish|${itemSetKey(point.build)}|${JSON.stringify(point.build.characteristicPoints)}`, element, run: from.run ?? element, polished: true })
    }
    candidates.sort(byRank)
    polish = { ms: performance.now() - tp, starts: starts.length, gain: Math.max(0, candidates[0].rank - before) }
    opts.onProgress?.({ step: 'evaluate', label: 'affinage en DPT soutenu', done: 1, total: 1 })
  }
  const evaluated = new Map<Pooled, Evaluated>()
  let optimizedCount = 0
  const evaluateCandidate = (p: Pooled, meta?: Meta): Evaluated => {
    if (p.ev) return p.ev
    let ev = evaluated.get(p)
    if (!ev) {
      if (!meta) {
        optimizedCount++
        const notes = [elementsMode === 'all' ? elementLabel(p.element) : '', p.polished ? 'affiné en DPT soutenu' : ''].filter(Boolean)
        meta = { id: `top${optimizedCount}`, origin: 'optimized', label: `Optimisé n° ${optimizedCount}${notes.length ? ` (${notes.join(', ')})` : ''}`, ...(p.pointsId ? { pointsId: p.pointsId } : {}) }
      }
      ev = evaluate(env, p.build, meta)
      evaluated.set(p, ev)
    }
    return ev
  }
  // Toujours au moins un candidat valide en pratique (départ valide, stuff vide valide) : sinon, erreur plutôt qu'un
  // départ invalide présenté comme meilleur.
  const top = pickDistinct(candidates, topN, minDifferences).map(p => evaluateCandidate(p))
  if (!top.length) throw new Error('Aucun stuff valide trouvé (départ invalide, objets imposés ou interdits trop contraignants).')
  const best = top[0]
  opts.onProgress?.({ step: 'evaluate', label: 'meilleurs stuffs', done: top.length, total: top.length })

  // ── Éléments comparés (candidats de la recherche seulement) ──
  let elements: StuffElementOption[] | undefined
  if (elementsMode === 'all') {
    // Meilleur stuff de chaque élément, classé par SA caractéristique élémentaire (une recherche « Air » peut trouver un
    // stuff Feu meilleur : il compte pour le Feu) ; à défaut, meilleur résultat de la recherche de l'élément (signalé).
    const searched = candidates.filter(p => p.run !== undefined)
    const evals = STUFF_ELEMENTS.map(el => {
      const p = searched.find(x => x.element === el) ?? searched.find(x => x.run === el)
      if (p && p.element !== el) warnings.push(`Élément ${elementLabel(el)} : aucun stuff de cet élément parmi les candidats, meilleur résultat de sa recherche affiché (stuff ${elementLabel(p.element)}).`)
      const ev = p ? evaluateCandidate(p, evaluated.has(p) ? undefined : { id: `element:${el}`, origin: 'optimized', label: `Meilleur ${elementLabel(el)}`, pointsId: p.pointsId }) : undefined
      return { el, ev }
    })
    let chosen: StuffElement | undefined
    let bestRank = -Infinity
    for (const { el, ev } of evals) {
      const r = ev ? rankOf(ev) : null
      if (r !== null && r > bestRank) [chosen, bestRank] = [el, r]
    }
    elements = evals
      .filter(x => x.ev)
      .map(({ el, ev }) => ({ element: el, label: elementLabel(el), bossResPct: bossResIn(env, el), best: publicEval(ev!), chosen: el === chosen }))
    assumptions.push('Comparaison des éléments : une recherche par élément avec les variantes de sorts du preset (non ré-optimisées pour l’élément), points du preset reportés sur la caractéristique de l’élément.')
  }

  // ── Équivalences au meilleur stuff (contexte du proxy construit à ce stuff) ──
  const atBest = weightsAtBest(env, proxyMember, options, best, rankBy)
  const statWeights = statEquivalences(atBest.weights, best.element, {
    penalties: atBest.penalties,
    steady: best.damage.steady,
    rangeNeed: ctx.rangeNeed,
    ...(rankBy === 'sustained' ? { sustainedStance: best.damage.stance.name } : ctx.exponents.a > 0 ? { apSustainedStance: best.damage.stance.name } : {}),
  })

  // ── Avertissements ──
  // Recherche limitée à l'élément du preset alors que la rotation du meilleur stuff n'a aucun sort de cet élément
  // (Sram Air niveau 40 : sorts Air pas encore débloqués) : la référence des équivalences le trahit.
  const mainStat = ELEMENT_STAT[best.element]
  if (elementsMode === 'preset' && best.damage.steady >= 1 && statWeights.reference !== mainStat && statWeights.reference !== 'vitality') {
    const rotation = best.damage.spells
      .slice(0, 3)
      .map(x => `${x.name} ${Math.round(x.share * 100)} %`)
      .join(', ')
    warnings.push(
      `Aucun sort ${elementLabel(best.element)} dans la rotation du meilleur stuff contre ce boss (${rotation}) : la recherche n'a exploré que l'élément ${elementLabel(startElement)} (caractéristique principale ${statLabelFr(mainStat)}, sans valeur ici) alors que ${statLabelFr(statWeights.reference)} est la caractéristique élémentaire la plus utile — essayer --elements all (option elements: 'all' de l'API).`,
    )
  }
  if (best === startEval) warnings.push(`Aucun stuff trouvé ne bat le stuff de départ contre ce boss (${rankLabel}).`)
  else if (best.origin === 'generic' || best.origin === 'preset') warnings.push(`Le meilleur stuff est un stuff de référence (${best.label}) : la recherche n'a rien trouvé de mieux (${rankLabel}).`)
  if (best.damage.steady < 1) warnings.push('DPT soutenu nul contre ce boss (résistances ≥ 100 %, invulnérabilité ou sorts hors de portée) : le classement ne repose que sur la survie.')
  if (best.survival.capped) warnings.push(`PV effectifs du meilleur stuff plafonnés (${EHP_CAP} × PV) : aucun dégât reçu calculable ou défenses saturées — les résistances ne départagent plus les stuffs, la survie ne compte plus que par les PV bruts (Vitalité).`)
  if (rankBy === 'sustained') {
    warnings.push(`Posture de classe : le proxy de l'optimiseur ne pose aucune posture (DPT soutenu sans posture ${Math.round(startEval.noStance)} contre ${Math.round(startEval.damage.steady)} en « ${startEval.damage.stance.name} » au départ) — la recherche ne voit pas ces dégâts ; stuffs CLASSÉS par le logJ soutenu (DPT soutenu en posture), stuffs de référence compris.`)
  } else if (STANCES[preset.breedId] && best.noStance * STANCE_GAP < best.damage.steady) {
    warnings.push(
      `Posture de classe : le proxy de l'optimiseur ne pose aucune posture (DPT soutenu sans posture ${Math.round(best.noStance)} contre ${Math.round(best.damage.steady)} en « ${best.damage.stance.name} ») — l'objectif de la recherche sous-estime les dégâts de cette classe ; le DPT soutenu affiché, lui, utilise la meilleure posture.`,
    )
  }
  const exps = ctx.exponents
  const [s0, s1] = [startEval.damage.steady, best.damage.steady]
  if (startValid && best !== startEval && s0 >= 1 && s1 < (1 - DPT_LOSS_WARN) * s0) {
    warnings.push(
      `Le meilleur stuff perd ${Math.round(100 * (1 - s1 / s0))} % de DPT soutenu par rapport au départ (${Math.round(s0)} → ${Math.round(s1)}) pour des PV effectifs ${Math.round(startEval.survival.ehp)} → ${Math.round(best.survival.ehp)} : arbitrage des exposants du rôle (a = ${fr(exps.a)}, b = ${fr(exps.b)})${rankBy === 'proxy' ? ' et du DPT du proxy (un tour isolé × calibration), qui n’est pas le DPT soutenu' : ''} — profil « offensive » pour privilégier les dégâts.`,
    )
  }
  // Pénalités d'objectif décisives (PA/PM/PO sous les valeurs visées) : un réglage, pas un effet du boss.
  const noPenalty = (e: Evaluated) => rankOf(e)! - detLog(e.penalty)
  const buffs = ctx.rangeNeed <= 0 ? [] : rangeBuffs(playerFighterFromStats(data, who, startStats.stats, startStats.maxHp))
  if (startValid && best !== startEval && startEval.penalty < best.penalty && noPenalty(startEval) > noPenalty(best)) {
    const po = startEval.range < ctx.rangeNeed
    warnings.push(
      `Pénalités d'objectif décisives : sans elles (${ctx.apTarget} PA, ${ctx.mpTarget} PM, ${ctx.rangeNeed} PO visés), « ${startEval.label} » (${startEval.ap}/${startEval.mp}/${startEval.range}, pénalité ×${fr(startEval.penalty, 3)}) passerait devant le meilleur stuff (${fr(noPenalty(startEval), 3)} contre ${fr(noPenalty(best), 3)}).${po && buffs.length ? ` Bonus de PO de la classe non déduits de la PO visée : ${buffs.join(', ')}.` : ''}${po ? ' --range N en ligne de commande (option rangeNeed de l’API) pour ajuster la PO visée.' : ''}`,
    )
  }
  const removedPassives = best.changes.removed.filter(i => i.passive && wearable(i.itemId))
  if (removedPassives.length)
    warnings.push(`Le meilleur stuff retire des objets à sort passif (${removedPassives.map(i => i.name).join(', ')}) que le proxy valorise à 0 : à garder si le passif compte (--fixed <ids> en ligne de commande, option fixed de l'API).`)
  if (profile.level > buildLevel + 20) warnings.push(`Boss de niveau ${profile.level} pour un personnage de niveau ${buildLevel}.`)

  // ── Hypothèses ──
  assumptions.push(
    `Objectif de l'optimiseur : logJ = a·ln DPT + b·ln PVe + ln(1 + c·UTIL) + ln(pénalités : ${PENALTY_TEXT}), rôle ${ROLE_LABELS_FR[role] ?? role} (a = ${fr(exps.a)}, b = ${fr(exps.b)}, c = ${fr(exps.c)}), profil ${expProfile} ; logJ n'est comparable qu'à personnage, rôle, profil et boss égaux.`,
    rankingReason,
    ...(polish
      ? [
          `Affinage en DPT soutenu (classement soutenu) : ${polish.starts} montée(s) par coordonnées sur le logJ soutenu depuis les stuffs distincts les mieux classés, avec les objets de tous les candidats et stuffs de référence, forgemagie re-planifiée aux poids soutenus, points de caractéristiques inchangés (gain sur le meilleur : ${fr(polish.gain, 3)}).`,
        ]
      : []),
    `Recherche : ${restarts} × ${fr(iterations)} itérations de recuit par élément (${restarts > 1 ? `graines ${seed} à ${seed + restarts - 1}` : `graine ${seed}`}), stuffs de départ des montées = départ + stuffs génériques hors scénario + glouton ; candidats re-notés en exact.`,
    'Jets max des objets ; forgemagie supposée réalisable : un exo PA, PM et PO au plus (s’ils sont utiles), jusqu’à 6 transcendances, aucun over (profil thlOptimized de l’optimiseur).',
    keepPassives
      ? `Objets à sort passif (effet 1175) valorisés à 0 par le proxy : les Dofus à sort passif du départ sont gardés imposés${passiveIds.length ? ` (${passiveIds.map(id => data.item(id)?.name ?? id).join(', ')})` : ''} ; les autres objets à sort passif ne le sont pas (--fixed <ids> pour les garder).`
      : 'Objets à sort passif (effet 1175) valorisés à 0 par le proxy ; Dofus du départ NON imposés (keepPassives: false).',
    'DPT : sorts de classe seulement (arme non lancée) ; ni invocations, glyphes, pièges, bombes, buffs entre sorts ni buffs d’équipe entre personnages ; aucune position, ligne de vue ni PM.',
    `DPT soutenu : rotation en régime établi (relances amorties), meilleure posture de classe supposée tenue tout le combat, NON calibré ; DPT du proxy : un tour isolé × calibration du preset (mesurée au Vortex), sans posture.`,
    'PV effectifs : rotations du boss estimées par sac à dos sur une cible (optimiste pour le boss sur une cible ; zones, sorts en réaction et invocations non comptés : le total peut être sous-estimé ; pas l’IA réelle), plafonnés à 20 × PV ; ni soins, boucliers, érosion ni kit défensif de classe.',
    `Variantes de sorts du preset « ${presetId} » ; joué ${style.label} (${
      ctx.rangeNeed <= 0
        ? 'PO non exigée'
        : `${ctx.rangeNeed} PO visées${opts.rangeNeed !== undefined ? ', --range (option rangeNeed de l’API)' : ''}${buffs.length ? ` ; bonus de PO temporaires de la classe NON déduits : ${buffs.join(', ')}` : ''}`
    })${style.reason ? ` : ${style.reason}` : ` — ${styleRule(style)}`}.`,
    'Les CLASSEMENTS valent plus que les valeurs absolues.',
    ...target.assumptions,
    ...profile.assumptions.map(a => `Boss : ${a}`),
  )
  warnings.push(...profile.warnings.map(w => `Boss : ${w}`))

  const comparison = [startEval, ...refs.sort((a, b) => (rankOf(b) ?? -Infinity) - (rankOf(a) ?? -Infinity) || (a.id < b.id ? -1 : 1))]
  return {
    version: 1,
    boss: {
      monsterId: profile.monsterId,
      name: profile.name,
      grade: profile.grade,
      ...(profile.players !== undefined ? { players: profile.players } : {}),
      level: profile.level,
      hp: profile.hp,
      resPct: profile.resPct.slice(0, 5) as PerElement,
      weakestElements: profile.weakestElements.slice(),
      rangedResPct: profile.stats.rangedResPct ?? 0,
      meleeResPct: profile.stats.meleeResPct ?? 0,
      mechanics: profile.mechanics.map(m => m.summary.replace(/\.\s*$/, '')),
    },
    character: {
      breedId: preset.breedId,
      className: preset.className,
      presetId,
      presetLabel: preset.label,
      role,
      roleLabel: ROLE_LABELS_FR[role] ?? role,
      element: startElement,
      elementLabel: elementLabel(startElement),
      level: buildLevel,
      melee,
      style,
      input: ch.input,
      variants,
    },
    options: { level: buildLevel, iterations, restarts, profile: expProfile, top: topN, minDifferences, elements: elementsMode, seed, keepPassives, fixed, exclude, rangeNeed: ctx.rangeNeed },
    start: publicEval(startEval),
    startValid,
    comparison: comparison.map(publicEval),
    best: publicEval(best),
    top: top.map(publicEval),
    ...(elements ? { elements } : {}),
    ranking: { by: rankBy, reason: rankingReason },
    statWeights,
    assumptions,
    warnings,
    search: {
      ms: performance.now() - t0,
      runs: total,
      evaluations,
      pools: pools ?? { examined: 0, kept: 0, setBlocks: 0 },
      seedStuffs: [...seedStuffs].sort(),
      excludedSeeds: [...excludedSeeds].sort(),
      ...(polish ? { polish } : {}),
    },
  }
}
