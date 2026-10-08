/**
 * Theorycraft contre un boss — question (1) : « quel stuff est le plus intéressant contre ce boss ? »
 * (docs/design/theorycraft.md §1.7).
 *
 * `stuffVsBoss(data, input, profile, opts)` :
 *  1. Personnage : un preset (`resolvePreset` : identifiant ou désignation « cra:terre »), un build de l'utilisateur ou
 *     un lien de partage RoxxSolver (`roxxImport`). Pour un build ou un lien, variantes de sorts, rôle et calibration
 *     viennent du preset `presetId`, sinon du preset de base de la classe dont l'élément est la caractéristique
 *     élémentaire la plus haute du build ; un lien sans parchemins reçoit 100 partout (`fillScrolls`, signalé).
 *  2. Cible : `bossProxyOptions(profile, { role, profile, melee })` (target.ts) — cibles EXPLICITES (`strictTargets`),
 *     jamais le mix du Vortex ; « au contact » selon le preset (même liste que la campagne des stuffs,
 *     `MELEE_PRESET` de src/optimizer/builds.ts) sauf option `melee`.
 *  3. Références notées dans UN contexte de proxy commun (construit comme celui de l'optimiseur : build de départ comme
 *     référence) : départ, stuff du preset (quand le départ est le stuff de l'utilisateur), stuffs génériques de
 *     data/ai/presets.json hors stuffs de scénario (`theorySeedFilter` : jamais de `vortex_*`, objets ≤ niveau).
 *  4. `optimizeStuff` (src/optimizer/stuff/search.ts) avec ces options, graines filtrées par `theorySeedFilter`
 *     (départ + génériques + glouton), recuit de `iterations` itérations, relancé `restarts` fois (graines `seed`,
 *     `seed + 1`…) ; Dofus à sort passif du départ imposés (`keepPassives`, comme la commande CLI `stuff` : le proxy
 *     les valorise à 0) ; `elements: 'all'` : une recherche par élément (points du preset reportés sur la
 *     caractéristique de l'élément, stuff générique de l'élément comme départ ; le départ réel pour son propre élément).
 *  5. Tous les candidats re-notés en EXACT dans le contexte commun (logJ comparables entre recherches et éléments) :
 *     meilleur + `top` stuffs DISTINCTS (au moins `minDifferences` objets d'écart entre eux, défaut 2 — sinon le top
 *     n'offre que des variantes d'une même coiffe ; places restantes complétées par des ensembles d'objets simplement
 *     différents). Un départ invalide (stuff de niveau 200 joué plus bas…) n'est jamais présenté comme meilleur
 *     (`startValid`) ; un départ valide que rien ne bat reste le meilleur (signalé).
 *  6. Pour chaque stuff présenté : DPT du proxy (objectif de l'optimiseur : un tour, relances ignorées, calibration du
 *     preset, sans posture) ET DPT SOUTENU en régime établi (rotation.ts, `steady`, meilleure posture de stances.ts,
 *     phases attaquables pondérées) avec le détail par sort ; PV, PV effectifs, dégâts reçus par tour (exact) et par
 *     élément (forme fermée) ; logJ ; PA/PM/PO ; objets changés par rapport au départ ; fiche (`buildStuffSheet`).
 *  7. Poids marginaux des caractéristiques au meilleur stuff (`statWeightsAt`) traduits en équivalences lisibles
 *     (`statEquivalences`).
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
 * boss par sac à dos (pas l'IA réelle), aucune position ni ligne de vue ; les CLASSEMENTS valent plus que les valeurs
 * absolues.
 *
 * Module d'ANALYSE : il tire le proxy de stuff et l'optimiseur (donc, indirectement, le mix du Vortex de proxy.ts — jamais
 * utilisé : cibles toujours explicites) ; il n'importe rien de src/dungeons et n'est PAS exporté par index.ts (API
 * pure). Déterministe (graines fixes, départages par clé).
 */
import type { RoleId } from '../ai/types'
import { Element, ELEMENT_NAMES_FR, ELEMENT_RES_PCT, type StatKey, type Stats } from '../core/types'
import type { GameDataStore } from '../data/store'
import type { Fighter } from '../engine/types'
import { hasPassive } from '../optimizer/stuff/pools'
import type { ExponentProfile } from '../optimizer/stuff/profiles'
import { createProxyContext, ELEMENT_STAT, type ProxyContext, type ProxyScore } from '../optimizer/stuff/proxy'
import { optimizeStuff, theorySeedFilter, type StuffCandidate, type StuffResult } from '../optimizer/stuff/search'
import { allocatePoints, BASE_PRESETS, presetBuild, resolvePreset, STUFFS, type Preset, type StuffTemplate } from '../optimizer/team/presets'
import { roxxImport } from '../optimizer/team/roxx'
import type { MemberSpec } from '../optimizer/types'
import { computeBuildStats, fullScrolls, type CharacterBuild } from '../stats/build'
import type { PrimaryStat } from '../stats/characteristicPoints'
import { RUNE_WEIGHT_PER_POINT } from '../stats/forgemagie'
import { buildStuffSheet, ROLE_LABELS_FR, statLabelFr, type StuffSheet } from '../stats/sheet'
import { bossFighter, playerFighterFromStats, theoryDptTable, withStates, type TheoryCharacter } from './fighters'
import { sustainedDamage } from './rotation'
import { bestStance, STANCES } from './stances'
import { bossProxyOptions } from './target'
import type {
  BossProfile,
  PerElement,
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
/** Tours simulés pour le détail par sort du DPT soutenu (fenêtre qui contient une période du régime établi). */
const ROTATION_TURNS = 24
/** Plafond de tours si la période n'est pas atteinte dans `ROTATION_TURNS` (même plafond que rotation.ts). */
const ROTATION_TURNS_MAX = 240
/** Plafond des PV effectifs du proxy (× PV, proxy.ts). */
const EHP_CAP = 20
/** Écart toléré entre le DPT soutenu « sans posture » et « meilleure posture » avant d'avertir (classes à posture). */
const STANCE_GAP = 1.2

/**
 * Presets joués au contact : PO non exigée (même liste que `MELEE_PRESET` de src/optimizer/builds.ts, campagne des
 * stuffs ; recopiée pour ne pas tirer l'optimiseur de builds).
 */
const MELEE_PRESET = /^(iop_terre|ouginak|sacrieur|zobal|feca_protecteur|pandawa_saoul)/

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
  /** Garder les Dofus à sort passif du départ (défaut vrai : passifs non valorisés par le proxy). */
  keepPassives?: boolean
  /** Lien RoxxSolver sans parchemins : 100 partout (défaut vrai) ; faux = 0 comme le lien. */
  fillScrolls?: boolean
  /** Rôle imposé (défaut : rôle du preset). */
  role?: RoleId
  /** Joué au contact (défaut : selon le preset). */
  melee?: boolean
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

/** Preset de base de la classe dont l'élément est celui du build (sinon le preset par défaut de la classe). */
function presetForBuild(data: GameDataStore, build: CharacterBuild, presetId: string | undefined): { preset: Preset; note?: string } {
  if (presetId) {
    const p = resolvePreset(presetId)
    if (p.breedId !== build.breedId) throw new Error(`Preset « ${p.id} » d'une autre classe que le build (${p.className} ≠ classe ${build.breedId})`)
    return { preset: p }
  }
  const list = BASE_PRESETS.filter(p => p.breedId === build.breedId)
  if (!list.length) throw new Error(`Aucun preset pour la classe ${build.breedId}`)
  const el = dominantElement(computeBuildStats(build, data).stats)
  const p = list.find(x => x.element === el) ?? list[0]
  return { preset: p, note: `Variantes de sorts, rôle et calibration du preset « ${p.id} » (${p.label}) : élément ${elementLabel(el)} du build (option presetId pour en choisir un autre).` }
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
  const { preset, note } = presetForBuild(data, build, input.presetId)
  if (note) assumptions.push(note)
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
  /** Lanceur (posture posée) et rotations par phase. */
  a: Fighter
  runs: SustainedDamage[]
}

/** DPT soutenu pondéré par les phases (une posture). */
function steadyOver(env: Env, a: Fighter, turns: number): SteadyRun {
  let steady = 0
  let burst = 0
  let w = 0
  const runs = env.targets.map((t, i) => {
    const r = sustainedDamage(env.table, a, t, { turns })
    steady += env.weights[i] * r.steady
    burst += env.weights[i] * r.burst
    w += env.weights[i]
    return r
  })
  return { steady: w > 0 ? steady / w : 0, burst: w > 0 ? burst / w : 0, a, runs }
}

/** Les `period` derniers tours simulés forment-ils une période du régime établi (leur moyenne redonne `steady`) ? */
function periodWindowFits(x: SustainedDamage): boolean {
  if (x.period <= 0 || x.casts.length < x.period) return false
  const window = x.perTurn.slice(-x.period)
  return Math.abs(window.reduce((s, v) => s + v, 0) / x.period - x.steady) <= 1e-6 * Math.max(1, x.steady)
}

/**
 * Détail par sort du régime établi : lancers d'une période (les `period` derniers tours simulés, vérifiés : leur
 * moyenne doit redonner `steady` ; sinon simulation plus longue, puis à défaut les derniers tours) × dégâts par lancer
 * (`perCast`, même lanceur et même phase que la rotation), pondérés par les phases.
 */
function spellBreakdown(env: Env, run: SteadyRun): { spells: StuffSpellLine[]; period: number } {
  const acc = new Map<number, { casts: number; damage: number }>()
  const a = run.a
  const indexOf = new Map<number, number>()
  a.spells.forEach((s, k) => indexOf.set(s.spellId, k))
  let w = 0
  let period = 0
  run.runs.forEach((r, i) => {
    const target = env.targets[i]
    let res = r
    if (!periodWindowFits(res)) res = sustainedDamage(env.table, a, target, { turns: ROTATION_TURNS_MAX })
    const ok = periodWindowFits(res)
    const window = ok ? res.casts.slice(-res.period) : res.casts.slice(-Math.min(res.casts.length, 120))
    const n = window.length || 1
    period = Math.max(period, ok ? res.period : 0)
    const wi = env.weights[i]
    w += wi
    for (const turn of window) {
      for (const spellId of turn) {
        const k = indexOf.get(spellId)
        if (k === undefined) continue
        const dmg = env.table.perCast(a, k, target).mean
        const e = acc.get(spellId) ?? { casts: 0, damage: 0 }
        e.casts += wi / n
        e.damage += (wi * dmg) / n
        acc.set(spellId, e)
      }
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

/** DPT soutenu (meilleure posture), rafale et détail par sort ; `noStance` : soutenu sans aucun état (avertissement). */
function damageOf(env: Env, stats: Stats, maxHp: number, proxyDpt: number): { damage: StuffDamage; noStance: number } {
  const base = playerFighterFromStats(env.data, env.who, stats, maxHp)
  const known = base.spells.map(s => s.spellId)
  const runs = new Map<string, SteadyRun>()
  const choice = bestStance(
    env.who.breedId,
    states => {
      const run = steadyOver(env, withStates(base, states), ROTATION_TURNS)
      runs.set(states.join(','), run)
      return run.steady
    },
    { knownSpells: known },
  )
  const run = runs.get(choice.stance.states.join(','))!
  const noStance = choice.stance.states.length ? steadyOver(env, withStates(base, []), ROTATION_TURNS).steady : run.steady
  const { spells, period } = spellBreakdown(env, run)
  return {
    damage: { proxy: proxyDpt, steady: run.steady, burst: run.burst, stance: { id: choice.stance.id, name: choice.stance.name }, period, spells },
    noStance,
  }
}

/** Évaluation complète d'un build dans le contexte commun. */
function evaluate(env: Env, build: CharacterBuild, meta: Meta): StuffEvaluation & { noStance: number; stats: Stats; maxHp: number } {
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
  const { damage, noStance } = damageOf(env, r.stats, r.maxHp, score.dpt)
  return {
    id: meta.id,
    origin: meta.origin,
    label: meta.label,
    valid: r.valid,
    issues: r.issues.map(i => i.message),
    element,
    logJ: r.valid ? score.logJ : null,
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
    stats: r.stats,
    maxHp: r.maxHp,
  }
}

/** Retire les champs internes d'une évaluation (sortie sérialisable). */
function publicEval(e: StuffEvaluation & { noStance?: number; stats?: Stats; maxHp?: number }): StuffEvaluation {
  const { noStance: _n, stats: _s, maxHp: _h, ...rest } = e
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
  return v.toLocaleString('fr-FR')
}

/**
 * Équivalences lisibles des poids marginaux ∂logJ/∂point (`ProxyContext.statWeightsAt`, différences finies de la forme
 * fermée) : « 1 X ≈ N points de la référence ». Référence = caractéristique principale de l'élément du stuff ; si elle
 * ne vaut rien contre ce boss, la caractéristique élémentaire la plus utile (un Sram Air niveau 40 ne frappe qu'en
 * Terre et en Eau : sorts Air pas encore débloqués), sinon la Vitalité (dégâts nuls : résistances ≥ 100 %,
 * invulnérabilité). `perRuneWeight` : valeur par unité de poids de rune (`RUNE_WEIGHT_PER_POINT`), relative à la
 * référence — aide aux choix de forgemagie. Caractéristiques sans valeur (poids ≤ 0) omises ; tri par valeur par point
 * décroissante.
 */
export function statEquivalences(weights: Partial<Record<StatKey, number>>, element: StuffElement): StuffStatWeights {
  const notes = [
    'Poids marginaux ∂logJ/∂point de la forme fermée du proxy, au meilleur stuff : valables pour CE boss, CE rôle et CE profil, et pour de petits changements (linéarisation locale).',
    'PA, PM et PO : valeur d’un point SOUS le plafond (12 PA, 6 PM, 6 PO) — au-delà du plafond un point ne vaut rien ; elle comprend la pénalité de l’objectif (×0,85 par PA manquant, ×0,9 par PM, ×0,95 par PO sous la portée voulue), seule valeur des PA quand les dégâts sont nuls.',
    '« Par poids de rune » : valeur pour une même dépense de forgemagie (poids des runes), relative à la référence.',
  ]
  const main = ELEMENT_STAT[element]
  const positive = (k: StatKey) => (weights[k] ?? 0) > 1e-12
  const elemental = STUFF_ELEMENTS.map(e => ELEMENT_STAT[e])
    .filter(positive)
    .sort((x, y) => weights[y]! - weights[x]! || (x < y ? -1 : 1))
  const reference: StatKey | undefined = positive(main) ? main : (elemental[0] ?? (positive('vitality') ? 'vitality' : undefined))
  if (reference !== main) {
    notes.push(
      reference === undefined
        ? 'Aucune caractéristique de référence n’a de valeur (ni dégâts ni survie mesurables) : pas d’équivalence.'
        : reference === 'vitality'
          ? `La caractéristique principale (${statLabelFr(main)}) ne vaut rien ici (aucun dégât) : équivalences en Vitalité.`
          : `La caractéristique principale (${statLabelFr(main)}) ne vaut rien ici (aucun sort de cet élément ne frappe ce boss) : équivalences en ${statLabelFr(reference)}, la caractéristique élémentaire la plus utile.`,
    )
  }
  const refW = reference ? weights[reference]! : 0
  const refRune = reference ? (RUNE_WEIGHT_PER_POINT[reference] ?? 1) : 1
  const items: StatEquivalence[] = (Object.keys(weights) as StatKey[])
    .filter(k => positive(k) && Number.isFinite(weights[k]!))
    .map(k => {
      const w = weights[k]!
      const inReference = reference ? w / refW : null
      const rune = RUNE_WEIGHT_PER_POINT[k]
      const perRuneWeight = reference && rune ? w / rune / (refW / refRune) : null
      const unit = PCT_STATS.has(k) ? `1 % ${statLabelFr(k)}` : `1 ${statLabelFr(k)}`
      const capped = k === 'ap' || k === 'mp' || k === 'range' ? ' (sous le plafond)' : ''
      const text = reference && inReference !== null ? `${unit}${capped} ≈ ${readable(inReference)} ${statLabelFr(reference)}` : `${unit}${capped} : ${w.toExponential(2)} logJ`
      return { stat: k, label: statLabelFr(k), perPoint: w, inReference, perRuneWeight, text }
    })
    .sort((x, y) => y.perPoint - x.perPoint || (x.stat < y.stat ? -1 : 1))
  return { reference: reference ?? main, referenceLabel: statLabelFr(reference ?? main), items, notes }
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
 * retenus (et de `taken`) ; places restantes complétées par des ensembles d'objets simplement différents.
 */
function pickDistinct<T extends { build: CharacterBuild }>(sorted: readonly T[], n: number, minDiff: number, taken: readonly CharacterBuild[]): T[] {
  const out: T[] = []
  const chosen = taken.slice()
  for (const pass of minDiff > 1 ? [minDiff, 1] : [1]) {
    for (const p of sorted) {
      if (out.length >= n) return out
      if (out.includes(p)) continue
      if (chosen.some(b => Math.max(itemDifferences(p.build, b), itemDifferences(b, p.build)) < pass)) continue
      out.push(p)
      chosen.push(p.build)
    }
  }
  return out
}

interface Pooled {
  build: CharacterBuild
  pointsId: string
  logJ: number
  key: string
  /** Élément du stuff (caractéristique élémentaire la plus haute) — pas forcément celui de la recherche qui l'a trouvé. */
  element: StuffElement
  /** Élément de la recherche. */
  run: StuffElement
}

/**
 * Stuff le plus intéressant contre un boss (voir l'en-tête) : comparaison des stuffs de référence, optimisation,
 * meilleur + `top` distincts, équivalences des caractéristiques, hypothèses et avertissements.
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

  const ch = resolveCharacter(data, input, level, opts.fillScrolls ?? true, opts.level !== undefined)
  const preset = ch.preset
  const start = ch.start
  const buildLevel = start.level
  const role: RoleId = opts.role ?? preset.role
  const melee = opts.melee ?? MELEE_PRESET.test(preset.extends ?? preset.id)
  const variants = (start.spellVariants?.length ? start.spellVariants : preset.variants).slice()
  const presetId = preset.extends ?? preset.id
  const startStats = computeBuildStats(start, data)
  const startElement: StuffElement = ch.user ? dominantElement(startStats.stats) : preset.element
  const warnings = [...ch.warnings]
  const assumptions = [...ch.assumptions]

  // ── Cible et contexte commun (comme celui de l'optimiseur : build de départ comme référence) ──
  const target = bossProxyOptions(profile, { role, profile: expProfile, melee })
  const options = target.options
  const member: MemberSpec = { name: start.name, breedId: preset.breedId, presetId, build: start, variants, role }
  const ctx = createProxyContext(
    data,
    { breedId: preset.breedId, level: buildLevel, variants, role, presetId, element: startElement, name: start.name },
    { stats: startStats.stats, maxHp: startStats.maxHp },
    options,
  )
  const table = theoryDptTable(data)
  const targets = (options.targets ?? []).map(t => bossFighter(data, t.monsterId, { grade: t.grade ?? profile.grade, stats: t.stats, states: t.states }))
  const weights = (options.targets ?? []).map(t => t.weight)
  const who: TheoryCharacter = { breedId: preset.breedId, level: buildLevel, variants, presetId, name: start.name }
  const env: Env = { data, ctx, table, who, preset, role, targets, weights, startItems: [] }
  const startEval = evaluate(env, start, { id: ch.user ? 'user' : 'start', origin: ch.user ? 'user' : 'start', label: ch.label })
  env.startItems = startEval.items
  startEval.changes = { added: [], removed: [] }
  const startValid = startStats.valid
  if (!startValid) warnings.push(`Le stuff de départ est invalide (${startStats.issues.filter(i => i.severity === 'error').map(i => i.message).slice(0, 3).join(' ; ')}) : il n'est jamais présenté comme meilleur.`)

  // ── Stuffs de référence : preset (si le départ est le stuff de l'utilisateur), génériques hors scénario ──
  const seedFilter = theorySeedFilter({ level: buildLevel })
  const genericIds = Object.keys(STUFFS)
    .sort()
    .filter(id => {
      const s: StuffTemplate = STUFFS[id]
      return seedFilter(id, s, data) && (!s.breeds || s.breeds.includes(preset.breedId))
    })
  const refs: (StuffEvaluation & { noStance: number; stats: Stats; maxHp: number })[] = []
  if (ch.user) refs.push(evaluate(env, presetBuild(preset, data, { level: buildLevel, name: start.name }), { id: 'preset', origin: 'preset', label: `Stuff du preset (${stuffLabel(preset.stuff)})` }))
  for (const id of genericIds) {
    if (id === preset.stuff) continue // déjà la ligne de départ (preset) ou la ligne « stuff du preset » (utilisateur)
    refs.push(evaluate(env, presetBuild(preset, data, { stuff: id, level: buildLevel, name: start.name }), { id: `generic:${id}`, origin: 'generic', label: `Générique ${stuffLabel(id)}` }))
  }
  const skippedGenerics = Object.keys(STUFFS).filter(id => !id.startsWith('vortex_') && !genericIds.includes(id))
  if (skippedGenerics.length) assumptions.push(`Stuffs génériques non évalués (objets au-dessus du niveau ${buildLevel}) : ${skippedGenerics.join(', ')}.`)
  opts.onProgress?.({ step: 'evaluate', label: 'stuffs de référence', done: refs.length + 1, total: refs.length + 1 })

  // ── Optimisation(s) ──
  const exclude = [...new Set(opts.exclude ?? [])]
  // Dofus à passif du départ gardés seulement s'ils sont portables à ce niveau (un preset de niveau 200 joué au niveau
  // 30 en porte de niveau 160-180) ; objets imposés au-dessus du niveau : écartés (ils rendraient tout stuff invalide).
  const wearable = (id: number) => (data.item(id)?.level ?? Infinity) <= buildLevel
  const passiveIds = keepPassives
    ? start.items.map(it => data.item(it.itemId)).filter(it => !!it && it.slot === 'dofus' && hasPassive(it) && wearable(it.id)).map(it => it!.id)
    : []
  const tooHigh = (opts.fixed ?? []).filter(id => !wearable(id))
  if (tooHigh.length) warnings.push(`Objets imposés au-dessus du niveau ${buildLevel} ignorés : ${tooHigh.map(id => data.item(id)?.name ?? id).join(', ')}.`)
  const fixed = [...new Set([...passiveIds, ...(opts.fixed ?? []).filter(wearable)])].filter(id => !exclude.includes(id))
  const seedStuffs = new Set<string>()
  const recordingFilter = (id: string, s: StuffTemplate, d: GameDataStore) => {
    const ok = seedFilter(id, s, d)
    if (ok) seedStuffs.add(id)
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
        const logJ = ctx.exact(r.stats, r.maxHp).logJ
        pooled.push({ build: c.build, pointsId: c.pointsId, logJ, key: `${itemSetKey(c.build)}|${c.key}|${JSON.stringify(c.build.characteristicPoints)}`, element: dominantElement(r.stats), run: el })
      }
      opts.onProgress?.({ step: 'optimize', label: `${elementLabel(el)}${restarts > 1 ? ` (recherche ${k + 1}/${restarts})` : ''}`, done: ++done, total })
    }
  }

  // ── Meilleur + top distincts (ensembles d'objets), notés dans le contexte commun ──
  pooled.sort((a, b) => b.logJ - a.logJ || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  // Meilleur stuff de chaque élément, classé par SA caractéristique élémentaire (une recherche « Air » peut trouver un
  // stuff Feu meilleur : il compte pour le Feu) ; à défaut, meilleur résultat de la recherche de l'élément (signalé).
  const bestByElement = new Map<StuffElement, Pooled>()
  for (const p of pooled) if (!bestByElement.has(p.element)) bestByElement.set(p.element, p)
  const bestByRun = new Map<StuffElement, Pooled>()
  for (const p of pooled) if (!bestByRun.has(p.run)) bestByRun.set(p.run, p)
  const minDifferences = Math.max(1, Math.floor(opts.minDifferences ?? DEFAULT_MIN_DIFFERENCES))
  const startBeats = startValid && startEval.logJ !== null && (!pooled.length || startEval.logJ >= pooled[0].logJ)
  const distinct = pickDistinct(pooled, topN - (startBeats ? 1 : 0), minDifferences, startBeats ? [start] : [])
  const optimized = distinct.map((p, i) => evaluate(env, p.build, { id: `top${i + 1}`, origin: 'optimized', label: `Optimisé n° ${i + 1}${elementsMode === 'all' ? ` (${elementLabel(p.element)})` : ''}`, pointsId: p.pointsId }))
  const top = startBeats ? [startEval, ...optimized] : optimized
  // Toujours au moins un candidat valide en pratique (le stuff vide est valide) : sinon, erreur plutôt qu'un départ
  // invalide présenté comme meilleur.
  if (!top.length) {
    if (!startValid) throw new Error('Aucun stuff valide trouvé (départ invalide, objets imposés ou interdits trop contraignants).')
    top.push(startEval)
  }
  const best = top[0]
  if (startBeats) warnings.push('Aucun stuff trouvé ne bat le stuff de départ contre ce boss (selon le proxy).')
  opts.onProgress?.({ step: 'evaluate', label: 'meilleurs stuffs', done: top.length, total: top.length })

  // ── Éléments comparés ──
  let elements: StuffElementOption[] | undefined
  if (elementsMode === 'all') {
    const evals = STUFF_ELEMENTS.map(el => {
      const p = bestByElement.get(el) ?? bestByRun.get(el)
      if (p && p.element !== el) warnings.push(`Élément ${elementLabel(el)} : aucun stuff de cet élément parmi les candidats, meilleur résultat de sa recherche affiché (stuff ${elementLabel(p.element)}).`)
      const inTop = p ? optimized.find(o => o.build === p.build) : undefined
      const ev = inTop ?? (p ? evaluate(env, p.build, { id: `element:${el}`, origin: 'optimized', label: `Meilleur ${elementLabel(el)}`, pointsId: p.pointsId }) : undefined)
      return { el, ev }
    })
    let chosen: StuffElement | undefined
    let bestLog = -Infinity
    for (const { el, ev } of evals) if (ev?.logJ !== null && ev?.logJ !== undefined && ev.logJ > bestLog) [chosen, bestLog] = [el, ev.logJ]
    elements = evals
      .filter(x => x.ev)
      .map(({ el, ev }) => ({ element: el, label: elementLabel(el), bossResPct: bossResIn(env, el), best: publicEval(ev!), chosen: el === chosen }))
    assumptions.push('Comparaison des éléments : une recherche par élément avec les variantes de sorts du preset (non ré-optimisées pour l’élément), points du preset reportés sur la caractéristique de l’élément.')
  }

  // ── Équivalences au meilleur stuff ──
  const statWeights = statEquivalences(ctx.statWeightsAt(best.stats, best.maxHp), best.element)

  // ── Avertissements ──
  if (best.damage.steady < 1) warnings.push('DPT soutenu nul contre ce boss (résistances ≥ 100 %, invulnérabilité ou sorts hors de portée) : le classement ne repose que sur la survie.')
  if (best.survival.capped) warnings.push(`PV effectifs plafonnés (${EHP_CAP} × PV) : aucun dégât reçu calculable ou défenses saturées — la survie ne départage plus les stuffs.`)
  if (STANCES[preset.breedId] && best.noStance * STANCE_GAP < best.damage.steady) {
    warnings.push(
      `Posture de classe : le proxy de l'optimiseur ne pose aucune posture (DPT soutenu sans posture ${Math.round(best.noStance)} contre ${Math.round(best.damage.steady)} en « ${best.damage.stance.name} ») — l'objectif de la recherche sous-estime les dégâts de cette classe ; le DPT soutenu affiché, lui, utilise la meilleure posture.`,
    )
  }
  const removedPassives = best.changes.removed.filter(i => i.passive && wearable(i.itemId))
  if (removedPassives.length) warnings.push(`Le meilleur stuff retire des objets à sort passif (${removedPassives.map(i => i.name).join(', ')}) que le proxy valorise à 0 : à garder si le passif compte (option keepPassives / fixed).`)
  if (profile.level > buildLevel + 20) warnings.push(`Boss de niveau ${profile.level} pour un personnage de niveau ${buildLevel}.`)

  // ── Hypothèses ──
  const exps = ctx.exponents
  assumptions.push(
    `Objectif de l'optimiseur : logJ = a·ln DPT + b·ln PVe + ln(1 + c·UTIL) + ln(pénalités), rôle ${ROLE_LABELS_FR[role] ?? role} (a = ${fr(exps.a)}, b = ${fr(exps.b)}, c = ${fr(exps.c)}), profil ${expProfile} ; logJ n'est comparable qu'à personnage, rôle, profil et boss égaux.`,
    `Recherche : ${restarts} × ${fr(iterations)} itérations de recuit par élément (${restarts > 1 ? `graines ${seed} à ${seed + restarts - 1}` : `graine ${seed}`}), stuffs de départ des montées = départ + stuffs génériques hors scénario + glouton ; candidats re-notés en exact.`,
    'Jets max des objets ; forgemagie supposée réalisable : un exo PA, PM et PO au plus (s’ils sont utiles), jusqu’à 6 transcendances, aucun over (profil thlOptimized de l’optimiseur).',
    keepPassives
      ? `Dofus et objets à sort passif (effet 1175) valorisés à 0 par le proxy : ceux du départ sont gardés imposés${passiveIds.length ? ` (${passiveIds.map(id => data.item(id)?.name ?? id).join(', ')})` : ''}.`
      : 'Dofus et objets à sort passif (effet 1175) valorisés à 0 par le proxy et NON imposés (keepPassives: false).',
    'DPT : sorts de classe seulement (arme non lancée) ; ni invocations, glyphes, pièges, bombes, buffs entre sorts ni buffs d’équipe entre personnages ; aucune position, ligne de vue ni PM.',
    `DPT soutenu : rotation en régime établi (relances amorties), meilleure posture de classe supposée tenue tout le combat, NON calibré ; DPT du proxy : un tour isolé × calibration du preset (mesurée au Vortex), sans posture.`,
    'PV effectifs : rotations du boss estimées par sac à dos (borne haute, pas l’IA réelle), plafonnés à 20 × PV ; ni soins, boucliers, érosion ni kit défensif de classe.',
    `Variantes de sorts du preset « ${presetId} »${melee ? ' ; joué au contact (PO non exigée)' : ' ; joué à distance (6 PO visées)'}.`,
    'Les CLASSEMENTS valent plus que les valeurs absolues.',
    ...target.assumptions,
    ...profile.assumptions.map(a => `Boss : ${a}`),
  )
  warnings.push(...profile.warnings.map(w => `Boss : ${w}`))

  const comparison = [startEval, ...refs.sort((a, b) => (b.logJ ?? -Infinity) - (a.logJ ?? -Infinity) || (a.id < b.id ? -1 : 1))]
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
      input: ch.input,
      variants,
    },
    options: { level: buildLevel, iterations, restarts, profile: expProfile, top: topN, minDifferences, elements: elementsMode, seed, keepPassives, fixed, exclude },
    start: publicEval(startEval),
    startValid,
    comparison: comparison.map(publicEval),
    best: publicEval(best),
    top: top.map(publicEval),
    ...(elements ? { elements } : {}),
    statWeights,
    assumptions,
    warnings,
    search: {
      ms: performance.now() - t0,
      runs: total,
      evaluations,
      pools: pools ?? { examined: 0, kept: 0, setBlocks: 0 },
      seedStuffs: [...seedStuffs].sort(),
    },
  }
}
