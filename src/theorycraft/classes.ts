/**
 * Theorycraft contre un boss — question (2) : « quelles classes sont les plus intéressantes contre ce boss ? »
 * (docs/design/theorycraft.md §1.6, §1.8).
 *
 * `rankClasses(data, profile, opts)` évalue chaque preset (défaut : les 49 presets de base, data/ai/presets.json) contre
 * la fiche du boss, puis classe les classes axe par axe — AUCUNE note globale :
 *  - Dégâts : DPT soutenu en régime établi (rotation.ts `steady`), NON calibré, contre chaque phase attaquable du boss
 *    pondérée par son poids — exactement les cibles de `bossProxyOptions` (target.ts : résistances effectives de la
 *    phase, « −50 % à distance », mêlée seule…) ; meilleure posture de classe (stances.ts) ; rafale à côté ; étalonnage
 *    moteur du preset (`calibrationOf`, data/ai/calibration.json) affiché à côté et signalé quand il s'écarte de 1 de
 *    plus de `calibrationGap` pour le podium ou la composition (docs/design/theorycraft.md §4) ;
 *  - Survie : PV effectifs du proxy de stuff (`ProxyContext.exact`, mêmes options) et dégâts reçus par tour et par
 *    élément (`incomingByElement`) — stuff seul, sans kit défensif de classe : ex æquo par stuff générique, rang partagé ;
 *  - Contrôle : PM + PA retirés en UN tour (utilities.ts `removal.combined` : un budget de PA, esquive du boss) ; un
 *    retrait que le boss punit (`punished-removal`) ou une réserve que le boss n'a pas ne comptent pas ;
 *  - Soin : PV soignés ou préservés UTILES par tour, total d'équipe : tour mixte soin + bouclier (utilities.ts `care`),
 *    plus les réductions converties en PV préservés (réduction % × dégâts reçus par tour de référence ; armure ×
 *    `REF_HITS_PER_TURN` coups), plafonnés aux dégâts de référence (un tour du boss sur un personnage) ;
 *  - Apport d'équipe : % de dégâts gagnés par un allié de référence (« dommages subis » sur le boss, Puissance,
 *    Dommages, % finaux, PA), décomposé (utilities.ts) ;
 * plus, par preset : atouts / limites contre les mécaniques du boss (`relevance`), confiance (`classConfidence`),
 * élément du preset face aux éléments faibles du boss. Par classe : meilleur preset par axe. Composition suggérée de
 * `players` personnages par des règles EXPLICITES (`COMPOSITION_RULES`), chaque membre avec sa raison.
 *
 * Stuff : 'preset' (défaut) = stuff générique du preset (6 stuffs méta de 12/2024, jets max) ; sous le niveau 200, ces
 * stuffs sont inutilisables (objets niveau 200) : personnages SANS équipement (points et parchemins du preset),
 * signalé. 'optimized' = `optimizeStuff` contre le boss (options de `bossProxyOptions`, graines `theorySeedFilter`
 * du niveau ; `iterations` 0 par défaut : montée par coordonnées seule, ≈ 1-5 s par preset) avant les mesures.
 *
 * Déterministe (aucun aléa ; l'optimiseur a une graine fixe). Ce module tire le proxy de stuff, donc le Vortex
 * (src/optimizer/stuff/proxy.ts importe son mix par défaut) : il n'est PAS exporté par l'API pure (index.ts). Toutes les
 * cibles sont explicites (`strictTargets`).
 */
import { calibrationOf } from '../ai/core/dpt'
import type { RoleId } from '../ai/types'
import { ELEMENT_NAMES_FR, ELEMENT_RES_PCT, Element, type Stats } from '../core/types'
import type { GameDataStore } from '../data/store'
import type { Fighter } from '../engine/types'
import type { ExponentProfile } from '../optimizer/stuff/profiles'
import { createProxyContext, type ProxyElement } from '../optimizer/stuff/proxy'
import { optimizeStuff, theorySeedFilter, withBuild } from '../optimizer/stuff/search'
import { BASE_PRESETS, PRESET_LEVEL, presetMember, type Preset } from '../optimizer/team/presets'
import { computeBuildStats } from '../stats/build'
import { DEFAULT_PLAYERS } from './bossProfile'
import { bossFighter, playerFighterFromStats, theoryDptTable, withStates } from './fighters'
import { sustainedDamage } from './rotation'
import { bestStance, STANCE_NOTES, stancesOf } from './stances'
import { bossProxyOptions } from './target'
import type {
  AxisRanking,
  BossProfile,
  ClassRanking,
  ClassSummary,
  CompositionMember,
  DamageShape,
  PerElement,
  PresetEvaluation,
  RankingAxis,
} from './types'
import { classConfidence, classUtilities, CLASS_CONFIDENCE, mergeUtilities, REF_HITS_PER_TURN, relevance } from './utilities'

// ---------------------------------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------------------------------

export const RANKING_AXES: readonly RankingAxis[] = ['damage', 'survival', 'control', 'heal', 'team']

/** Libellés et unités des axes (rapports). */
export const AXIS_INFO: Readonly<Record<RankingAxis, { label: string; unit: string }>> = {
  damage: { label: 'Dégâts', unit: 'DPT soutenu' },
  survival: { label: 'Survie', unit: 'PV effectifs du stuff seul' },
  control: { label: 'Contrôle', unit: 'PM + PA retirés en un tour' },
  heal: { label: 'Soin', unit: 'PV soignés ou préservés utiles / tour' },
  team: { label: 'Apport d\'équipe', unit: '% de dégâts d\'un allié' },
}

/** Éléments des presets → index `Element`. */
const PRESET_ELEMENT: Readonly<Record<string, Element>> = { earth: Element.Earth, fire: Element.Fire, water: Element.Water, air: Element.Air }

/**
 * Seuils des règles de composition (affichés avec les règles) :
 *  - `healPressure` : part des PV d'un personnage qu'un tour du boss retire (médiane des presets) au-delà de laquelle un
 *    soigneur est proposé (0,2 : un personnage focalisé meurt en 5 tours sans soin) ;
 *  - `protectionErosion` : érosion (%) au-delà de laquelle boucliers et réductions remplacent le soin ;
 *  - `mpRemoval` : PM retirés par tour (meilleur preset) pour qu'un retraitiste PM ait sa place ;
 *  - `secondElementGap` : écart de résistance (points) sous lequel un deuxième élément vaut le premier ;
 *  - `secondElementMinRatio` : part du meilleur DPT restant qu'un preset d'un autre élément faible doit atteindre pour
 *    être préféré (au-delà, la diversité d'élément coûte trop de dégâts) ;
 *  - `calibrationGap` : écart |1 − étalonnage moteur| au-delà duquel un preset du podium de l'axe Dégâts ou de la
 *    composition est signalé (avertissement et raison).
 */
export const COMPOSITION_THRESHOLDS = {
  healPressure: 0.2,
  protectionErosion: 20,
  mpRemoval: 1,
  secondElementGap: 10,
  secondElementMinRatio: 0.85,
  calibrationGap: 0.1,
} as const

export interface RankClassesOptions {
  /** Presets évalués (défaut `BASE_PRESETS`, 49). */
  presets?: readonly Preset[]
  /** Niveau des personnages (défaut 200). */
  level?: number
  /** Stuff : générique du preset (défaut) ou optimisé contre le boss. */
  stuff?: 'preset' | 'optimized'
  /** Itérations du recuit en mode 'optimized' (défaut 0 : montée par coordonnées seule). */
  iterations?: number
  /** Profil d'exposants du proxy (défaut équilibré). */
  profile?: ExponentProfile
  /** Taille du groupe pour la composition (défaut : joueurs du profil, sinon 4). */
  players?: number
  onProgress?: (done: number, total: number, label: string) => void
}

// ---------------------------------------------------------------------------------------------------------------------
// Évaluation d'un preset
// ---------------------------------------------------------------------------------------------------------------------

/** Cible du DPT (phase attaquable) : combattant et poids. */
interface PhaseTarget {
  phaseId: string
  weight: number
  fighter: Fighter
}

const avgBy = <T>(list: readonly T[], value: (x: T, i: number) => number, weight: (x: T, i: number) => number): number => {
  let s = 0
  let w = 0
  list.forEach((x, i) => {
    s += value(x, i) * weight(x, i)
    w += weight(x, i)
  })
  return w > 0 ? s / w : 0
}

const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Le boss n'est-il attaquable qu'au contact (toutes les phases attaquables « mêlée ») ? */
function meleeOnlyBoss(profile: BossProfile): boolean {
  const att = profile.phases.filter(p => p.vulnerable !== false && p.weight > 0)
  return att.length > 0 && att.every(p => p.vulnerable === 'melee')
}

/** Mécanique « retrait puni » qui vise cette réserve. */
function removalPunished(profile: BossProfile, tag: 'mp-removal' | 'ap-removal'): boolean {
  return profile.mechanics.some(m => m.kind === 'punished-removal' && (m.punishes?.length ? m.punishes : ['mp-removal', 'ap-removal']).includes(tag))
}

/** Érosion maximale infligée par le boss (résumé de la mécanique « érosion », 0 sinon ; 1 si non chiffrée). */
function bossErosion(profile: BossProfile): number {
  let best = 0
  for (const m of profile.mechanics) {
    if (m.kind !== 'erosion') continue
    const v = /(\d+(?:[.,]\d+)?)\s*%/.exec(m.summary)
    best = Math.max(best, v ? Number(v[1].replace(',', '.')) : 1)
  }
  return best
}

interface Context {
  data: GameDataStore
  profile: BossProfile
  level: number
  mode: 'preset' | 'optimized'
  iterations: number
  expProfile?: ExponentProfile
  players: number
  table: ReturnType<typeof theoryDptTable>
}

/** Mesures brutes d'un preset (l'axe Soin est complété ensuite avec les dégâts reçus de référence). */
function evaluatePreset(ctx: Context, preset: Preset): { ev: PresetEvaluation; assumptions: string[] } {
  const { data, profile, level } = ctx
  const warnings: string[] = []
  const lowLevel = level < PRESET_LEVEL
  let member = presetMember(preset, data, { level, ...(lowLevel ? { stuff: 'unstuffed' } : {}) })
  const role = preset.role as RoleId
  const target = bossProxyOptions(profile, { role, profile: ctx.expProfile, melee: meleeOnlyBoss(profile) })
  let stuffLabel = lowLevel ? 'unstuffed' : preset.stuff
  let optimization: PresetEvaluation['optimization']
  if (ctx.mode === 'optimized') {
    const res = optimizeStuff(data, member, {
      proxy: target.options,
      seedFilter: theorySeedFilter({ level }),
      iterations: ctx.iterations,
      role,
    })
    member = withBuild(member, res.best.build)
    stuffLabel = 'optimized'
    optimization = { startJ: res.start.score.j, bestJ: res.best.score.j }
  }
  const built = computeBuildStats(member.build, data)
  if (!built.valid) warnings.push(`Build invalide (${built.issues.map(i => i.message).slice(0, 2).join(' ; ') || 'conditions'}) : mesures indicatives.`)
  const variants = member.variants.length ? member.variants : (member.build.spellVariants ?? [])
  const who = { breedId: preset.breedId, level, variants, presetId: member.presetId, name: preset.className }
  const fighter = playerFighterFromStats(data, who, built.stats, built.maxHp)

  // ── Cibles du DPT : mêmes phases, dans le même ordre, que bossProxyOptions (attaquables, sinon toutes : hypothèse
  // signalée par target.ts) ──
  let attackable = profile.phases.filter(p => p.vulnerable !== false && p.weight > 0)
  if (!attackable.length) attackable = profile.phases.filter(p => p.weight > 0)
  const targets: PhaseTarget[] = (target.options.targets ?? []).map((t, i) => ({
    phaseId: attackable[i]?.id ?? `phase${i}`,
    weight: t.weight,
    fighter: bossFighter(data, t.monsterId, { grade: t.grade ?? profile.grade, stats: t.stats, states: t.states }),
  }))
  const steadyOf = (states: readonly number[], tg: PhaseTarget) => sustainedDamage(ctx.table, withStates(fighter, states), tg.fighter)
  const known = fighter.spells.map(s => s.spellId)
  const cache = new Map<string, { steady: number; burst: number }[]>()
  const perTarget = (states: readonly number[]) => {
    const key = states.join(',')
    let r = cache.get(key)
    if (!r) {
      r = targets.map(tg => {
        const sd = steadyOf(states, tg)
        return { steady: sd.steady, burst: sd.burst }
      })
      cache.set(key, r)
    }
    return r
  }
  const choice = bestStance(preset.breedId, states => avgBy(perTarget(states), x => x.steady, (_, i) => targets[i].weight), { knownSpells: known })
  const chosen = perTarget(choice.stance.states)
  const steady = avgBy(chosen, x => x.steady, (_, i) => targets[i].weight)
  const burst = avgBy(chosen, x => x.burst, (_, i) => targets[i].weight)
  // Étalonnage moteur du preset (tags.presetId : preset de base, sinon classe) : contrôle affiché, pas une correction.
  const calibration = calibrationOf(fighter)

  // ── Forme du DPT (cible neutre : résistances de la phase principale, ni réduction mêlée/distance) ──
  const main = targets.reduce((a, b) => (b.weight > a.weight ? b : a), targets[0])
  let shape: DamageShape | undefined
  if (main) {
    const t = target.options.targets![targets.indexOf(main)]
    const base: Partial<Stats> = { ...t.stats, meleeResPct: 0, rangedResPct: 0 }
    const run = (extra: Partial<Stats>) =>
      sustainedDamage(ctx.table, withStates(fighter, choice.stance.states), bossFighter(data, t.monsterId, { grade: t.grade ?? profile.grade, stats: { ...base, ...extra }, states: t.states })).steady
    const neutral = run({})
    shape = {
      meleeShare: neutral > 0 ? run({ rangedResPct: 100 }) / neutral : 0,
      rangeShare: neutral > 0 ? run({ meleeResPct: 100 }) / neutral : 0,
      burstRatio: steady > 0 ? burst / steady : 0,
    }
  }

  // ── Résistances ≥ 100 % (Kimbo, Kralamoure…) sans fiche manuelle : DPT si la mécanique les lève (ramenées à 0) ──
  let resLifted: number | undefined
  if (main && profile.mechanics.some(m => m.kind === 'extreme-res')) {
    const t = target.options.targets![targets.indexOf(main)]
    const lifted: Partial<Stats> = { ...t.stats }
    for (const k of Object.values(ELEMENT_RES_PCT)) if ((lifted[k] ?? 0) >= 100) lifted[k] = 0
    resLifted = sustainedDamage(ctx.table, withStates(fighter, choice.stance.states), bossFighter(data, t.monsterId, { grade: t.grade ?? profile.grade, stats: lifted, states: t.states })).steady
  }

  // ── Survie : proxy de stuff (mêmes options explicites) ──
  const element = preset.element as ProxyElement
  const proxy = createProxyContext(data, { breedId: preset.breedId, level, variants, role, presetId: member.presetId, element, name: preset.className }, built, target.options)
  const sc = proxy.exact(built.stats, built.maxHp)
  const inc = proxy.incomingByElement(built.stats)
  const incomingByElement = inc.byElement.slice() as PerElement
  const incoming = sc.incoming

  // ── Utilités (posture du DPT d'abord, puis les autres postures tenables : meilleure par utilité) et pertinence ──
  const utilTarget = main?.fighter ?? bossFighter(data, profile.monsterId, { grade: profile.grade, stats: profile.stats })
  const stanceList = [choice.stance, ...stancesOf(preset.breedId, known).filter(s => !s.transient && s.id !== choice.stance.id)]
  const mpPunished = removalPunished(profile, 'mp-removal')
  const apPunished = removalPunished(profile, 'ap-removal')
  // Tour de retrait mixte : seulement les réserves que le boss a et dont il ne punit pas le retrait.
  const removalPools = (['mp', 'ap'] as const).filter(p => (p === 'mp' ? !mpPunished && profile.mp > 0 : !apPunished && profile.ap > 0))
  const utilities = mergeUtilities(
    // PV de référence des soins en % des PV max : ceux de la fiche détaillée (BossProfileDetail.refHp) s'il y en a.
    stanceList.map(st =>
      classUtilities(data, withStates(fighter, st.states), utilTarget, { damage: shape, refAllyHp: (profile as { refHp?: number }).refHp, removalPools, allyTargets: ctx.players }),
    ),
    stanceList.map(st => st.name),
  )
  const rel = relevance(profile, utilities, { dealsDamage: steady > 0 || (resLifted ?? 0) > 0 })
  const mp = mpPunished || profile.mp <= 0 ? 0 : utilities.values.mpRemoved.value
  const apr = apPunished || profile.ap <= 0 ? 0 : utilities.values.apRemoved.value
  const mixed = utilities.removal.combined

  // ── Confiance ──
  const reasons: string[] = []
  let downgrade = 0
  const stance = stancesOf(preset.breedId, known).find(s => s.id === choice.stance.id)
  if (stance?.uncertain) {
    reasons.push(`Posture « ${stance.name} » : ${stance.uncertain}`)
    downgrade++
  }
  if (STANCE_NOTES[preset.breedId]) reasons.push(STANCE_NOTES[preset.breedId])
  if (preset.role === 'summoner' || preset.secondaryRole === 'summoner') {
    reasons.push('Preset d\'invocateur : la valeur des invocations n\'est pas chiffrée.')
    downgrade++
  }
  if (steady <= 0) {
    reasons.push('DPT soutenu nul contre ce boss.')
    downgrade += 2
  }
  const confidence = classConfidence(preset.breedId, { reasons, downgrade })

  // ── Élément du preset face au boss ──
  const el = PRESET_ELEMENT[preset.element] ?? Element.Neutral
  const resPct = avgBy(targets, tg => tg.fighter.stats[ELEMENT_RES_PCT[el]], tg => tg.weight)
  const rank = profile.weakestElements.indexOf(el)

  const ev: PresetEvaluation = {
    presetId: preset.id,
    breedId: preset.breedId,
    className: preset.className,
    label: preset.label,
    role: preset.role,
    element: preset.element,
    stuff: stuffLabel,
    stance: { id: choice.stance.id, name: choice.stance.name, states: choice.stance.states.slice() },
    dpt: {
      steady,
      burst,
      byPhase: targets.map((tg, i) => ({ phaseId: tg.phaseId, weight: tg.weight, steady: chosen[i].steady })),
      stances: choice.all.map(x => ({ id: x.stance.id, steady: x.value })),
      calibration,
      calibrated: steady * calibration,
      ...(resLifted !== undefined ? { resLifted } : {}),
    },
    survival: {
      hp: built.maxHp,
      ehp: sc.ehp,
      incoming,
      incomingByElement,
      incomingOther: inc.constant,
      turnsToDie: incoming > 0 ? built.maxHp / incoming : 0,
    },
    control: { mpRemoved: mp, apRemoved: apr, combined: { mp: mixed.mp, ap: mixed.ap }, value: mixed.mp + mixed.ap },
    // Axe Soin complété par rankClasses (dégâts reçus de référence : médiane des presets).
    heal: {
      heal: utilities.values.heal.value,
      shield: utilities.values.shield.value,
      reduction: utilities.values.allyReduction.value,
      armor: utilities.values.allyArmor.value,
      mixed: { heal: utilities.care.heal, shield: utilities.care.shield },
      raw: 0,
      cap: 0,
      value: 0,
      protectionRaw: 0,
      protection: 0,
    },
    team: { gainPct: utilities.offensiveGain.total, parts: utilities.offensiveGain.parts.map(p => ({ ...p })) },
    axes: { damage: steady, survival: sc.ehp, control: mixed.mp + mixed.ap, heal: 0, team: utilities.offensiveGain.total },
    utilities,
    relevance: rel,
    confidence,
    elementMatch: { element: el, resPct, rank },
    ...(optimization ? { optimization } : {}),
    warnings,
  }
  return { ev, assumptions: target.assumptions }
}

// ---------------------------------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------------------------------

/** Règles de composition (texte affiché, dans l'ordre d'application). */
export const COMPOSITION_RULES: readonly string[] = [
  `1. Dégâts : le meilleur DPT soutenu contre ce boss.`,
  `2. Soin : si un tour du boss retire au moins ${COMPOSITION_THRESHOLDS.healPressure * 100} % des PV d'un personnage (médiane des presets) et que le boss ne rend pas insoignable, le meilleur en PV soignés ou préservés UTILES par tour (plafonnés aux dégâts d'un tour du boss ; à égalité, celui qui soigne le plus).`,
  `3. Protection : si le boss rend insoignable ou érode d'au moins ${COMPOSITION_THRESHOLDS.protectionErosion} %, le meilleur en boucliers et réductions (PV préservés utiles, sans soin).`,
  `4. Retrait PM : si le boss a des PM, que le retrait PM n'est pas puni et que le meilleur preset retire au moins ${COMPOSITION_THRESHOLDS.mpRemoval} PM par tour malgré son esquive (tour consacré au retrait PM).`,
  `5. Deuxième dégât : le meilleur DPT d'une autre classe ; un preset d'un autre élément faible du boss (écart < ${COMPOSITION_THRESHOLDS.secondElementGap} points avec le plus faible ; tout autre élément si ses résistances sont extrêmes ou changeantes) est préféré s'il atteint ${COMPOSITION_THRESHOLDS.secondElementMinRatio * 100} % de ce DPT ; sinon la note dit pourquoi, et la raison signale un élément qui n'est pas faible.`,
  '6. Apport d\'équipe : le meilleur apport offensif (« dommages subis », Puissance, PA…) d\'une autre classe ; la raison donne son DPT propre et sa confiance.',
  '7. Places restantes : DPT suivants.',
  `Dégâts : DPT soutenu analytique ; si tous sont nuls (résistances ≥ 100 % sans fiche manuelle), DPT si la mécanique lève ces résistances ; un étalonnage moteur éloigné de 1 de plus de ${COMPOSITION_THRESHOLDS.calibrationGap * 100} % est cité dans la raison.`,
  'Une classe au plus par composition, sauf si les presets évalués n\'en offrent pas assez (doublon signalé).',
]

const fmt = (v: number, digits = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits })

function suggestComposition(profile: BossProfile, evs: readonly PresetEvaluation[], players: number): { members: CompositionMember[]; notes: string[] } {
  const T = COMPOSITION_THRESHOLDS
  const members: CompositionMember[] = []
  const notes: string[] = []
  const used = new Set<number>()
  // Meilleur preset (score, puis départage, puis identifiant) d'une classe pas encore prise ; sinon un doublon de classe.
  const pick = (
    score: (e: PresetEvaluation) => number,
    filter: (e: PresetEvaluation) => boolean = () => true,
    tie: (e: PresetEvaluation) => number = () => 0,
  ): PresetEvaluation | undefined => {
    const ranked = evs.filter(e => filter(e) && score(e) > 0).sort((a, b) => score(b) - score(a) || tie(b) - tie(a) || a.presetId.localeCompare(b.presetId))
    return ranked.find(e => !used.has(e.breedId)) ?? ranked.find(e => !members.some(m => m.presetId === e.presetId))
  }
  const add = (e: PresetEvaluation | undefined, slot: string, reason: (e: PresetEvaluation) => string) => {
    if (!e || members.length >= players) return
    const dup = used.has(e.breedId)
    const why = reason(e)
    members.push({ presetId: e.presetId, breedId: e.breedId, className: e.className, slot, reason: dup ? `${why} Doublon de classe : aucune autre classe disponible pour ce rôle parmi les presets évalués.` : why })
    used.add(e.breedId)
  }
  const elName = (e: PresetEvaluation) => ELEMENT_NAMES_FR[e.elementMatch.element as Element]
  // Dégâts : DPT soutenu ; repli si TOUS sont nuls (résistances ≥ 100 % sans fiche manuelle) : DPT résistances levées.
  const lifted = evs.every(e => e.axes.damage <= 0) && evs.some(e => (e.dpt.resLifted ?? 0) > 0)
  if (lifted) notes.push('DPT nul pour tous les presets (résistances ≥ 100 % sans fiche manuelle) : les places « Dégâts » sont classées sur le DPT si la mécanique lève ces résistances.')
  const dmg = (e: PresetEvaluation) => (lifted ? (e.dpt.resLifted ?? 0) : e.axes.damage)
  // Étalonnage moteur éloigné de 1 : signalé dans la raison (le classement reste sur le DPT analytique).
  const calText = (e: PresetEvaluation) =>
    Math.abs(1 - e.dpt.calibration) > T.calibrationGap
      ? ` ; étalonnage moteur ×${fmt(e.dpt.calibration, 2)} ⇒ ≈ ${fmt(dmg(e) * e.dpt.calibration)} par tour`
      : ''
  const dmgText = (e: PresetEvaluation) =>
    (lifted ? `${fmt(dmg(e))} par tour si les résistances ≥ 100 % sont levées (${elName(e)})` : `${fmt(e.axes.damage)} par tour (${elName(e)}, résistance effective ${fmt(e.elementMatch.resPct)} %)`) + calText(e)

  // 1. Dégâts
  add(pick(dmg), 'Dégâts', e => `Meilleur DPT soutenu contre ce boss : ${dmgText(e)}.`)

  // 2. Soin / 3. Protection (PV utiles : plafonnés aux dégâts d'un tour du boss sur un personnage)
  const pressure = median(evs.filter(e => e.survival.hp > 0).map(e => e.survival.incoming / e.survival.hp))
  const incurable = profile.mechanics.some(m => m.kind === 'incurable')
  const erosion = bossErosion(profile)
  if (pressure >= T.healPressure && !incurable)
    add(
      pick(e => e.heal.value, undefined, e => e.heal.mixed.heal + 1e-6 * e.heal.raw),
      'Soin',
      e =>
        `Pression offensive : un tour du boss retire ${fmt(pressure * 100)} % des PV d'un personnage (seuil ${T.healPressure * 100} %) ; ` +
        `meilleur soin : ${fmt(e.heal.value)} PV soignés ou préservés utiles par tour (tour mixte : soin ${fmt(e.heal.mixed.heal)}, bouclier ${fmt(e.heal.mixed.shield)} ; ` +
        `plafond ${fmt(e.heal.cap)} = dégâts d'un tour du boss sur un personnage).`,
    )
  else notes.push(`Pas de soigneur dédié : un tour du boss retire ${fmt(pressure * 100)} % des PV d'un personnage (seuil ${T.healPressure * 100} %)${incurable ? ', et le boss rend insoignable' : ''}.`)
  if (incurable || erosion >= T.protectionErosion) {
    const why = incurable ? 'Le boss rend insoignable' : `Érosion jusqu'à ${fmt(erosion)} %`
    add(
      pick(e => e.heal.protection, undefined, e => e.heal.protectionRaw),
      'Protection',
      e =>
        `${why} : boucliers et réductions plutôt que soin ; ${fmt(e.heal.protection)} PV préservés utiles par tour (plafond ${fmt(e.heal.cap)} = dégâts d'un tour du boss sur un personnage) — ` +
        `jusqu'à ${fmt(e.heal.shield)} PV de bouclier posés par tour (supposés consommés), réduction ${fmt(e.heal.reduction)} %, armure ${fmt(e.heal.armor)}.`,
    )
  }

  // 4. Retrait PM
  const best = pick(e => e.control.mpRemoved)
  if (profile.mp <= 0) notes.push('Pas de retrait PM : le boss n\'a pas de PM.')
  else if (removalPunished(profile, 'mp-removal')) notes.push('Pas de retrait PM : le boss punit le retrait de PM.')
  else if (!best || best.control.mpRemoved < T.mpRemoval)
    notes.push(`Pas de retrait PM : moins de ${T.mpRemoval} PM retiré par tour contre son esquive PM (${profile.mpParry}).`)
  else add(best, 'Retrait PM', e => `Le boss a ${profile.mp} PM et ${profile.mpParry} d'esquive PM : ${fmt(e.control.mpRemoved, 1)} PM retirés par tour (tour consacré au retrait PM) ; retrait non puni.`)

  // 5. Deuxième dégât (d'un autre élément faible si le boss en a plusieurs, ou des résistances à faire tomber)
  const res = profile.resPct
  const minRes = Math.min(...profile.weakestElements.map(i => res[i]))
  const weak = new Set(profile.weakestElements.filter(i => res[i] - minRes < T.secondElementGap))
  const special = profile.mechanics.some(m => m.kind === 'extreme-res' || m.kind === 'res-change')
  const firstEl = members.length ? evs.find(e => e.presetId === members[0].presetId)?.elementMatch.element : undefined
  const bestOther = pick(dmg)
  const other = firstEl === undefined ? undefined : pick(dmg, e => e.elementMatch.element !== firstEl && (special || weak.has(e.elementMatch.element)))
  const ratio = other && bestOther && dmg(bestOther) > 0 ? dmg(other) / dmg(bestOther) : 0
  // Élément le plus résistant du boss parmi Terre, Feu, Eau, Air (ceux des presets).
  const strongest = Math.max(...[Element.Earth, Element.Fire, Element.Water, Element.Air].map(i => res[i]))
  const elementNote = (e: PresetEvaluation) => {
    const r = res[e.elementMatch.element]
    if (special || weak.has(e.elementMatch.element)) return ''
    return r >= strongest - 1e-9 ? ' — élément le plus résistant du boss, retenu pour son DPT' : ' — pas un élément faible du boss, retenu pour son DPT'
  }
  if (other && bestOther && ratio >= T.secondElementMinRatio)
    add(other, 'Dégâts', e => `Deuxième DPT, autre élément (${special ? 'résistances à faire tomber : plusieurs éléments' : 'le boss a plusieurs éléments faibles'}) : ${dmgText(e)}.`)
  else {
    if (firstEl !== undefined && bestOther)
      notes.push(
        other
          ? `Deuxième DPT d'un autre élément faible écarté : le meilleur, ${other.className} ${other.presetId} (${elName(other)}), n'atteint que ${fmt(ratio * 100)} % du meilleur DPT restant (seuil ${T.secondElementMinRatio * 100} %).`
          : 'Deuxième DPT d\'un autre élément faible : aucun preset évalué d\'un autre élément faible du boss.',
      )
    add(pick(dmg), 'Dégâts', e => `Deuxième DPT : ${dmgText(e)}${elementNote(e)}.`)
  }

  // 6. Apport d'équipe (avec le DPT propre et la confiance du membre : un apport sans dégâts est dit)
  add(pick(e => e.axes.team), 'Apport d\'équipe', e => {
    const own = e.dpt.steady > 0 ? `DPT propre ${fmt(e.dpt.steady)}` : (e.dpt.resLifted ?? 0) > 0 ? `DPT propre nul tant que les résistances ne sont pas levées` : 'ne touche pas le boss (DPT propre nul) : apport seul'
    return `+${fmt(e.axes.team, 1)} % de dégâts pour un allié (${e.team.parts.map(p => `${p.label} ${fmt(p.pct, 1)} %`).join(', ')}) ; ${own} ; confiance ${e.confidence.level}.`
  })

  // 7. Places restantes
  while (members.length < players) {
    const next = pick(dmg)
    if (!next) break
    add(next, 'Dégâts', e => `DPT suivant : ${dmgText(e)}${elementNote(e)}.`)
  }
  if (members.length < players) notes.push(`Composition incomplète : ${members.length} personnage(s) sur ${players} (aucun autre preset utile parmi ceux évalués).`)
  return { members, notes }
}

// ---------------------------------------------------------------------------------------------------------------------
// Classement
// ---------------------------------------------------------------------------------------------------------------------

/** Classe les presets et les classes contre le boss (voir l'en-tête). */
export function rankClasses(data: GameDataStore, profile: BossProfile, opts: RankClassesOptions = {}): ClassRanking {
  const presets = opts.presets ?? BASE_PRESETS
  const level = opts.level ?? PRESET_LEVEL
  const mode = opts.stuff ?? 'preset'
  const players = Math.max(1, Math.floor(opts.players ?? profile.players ?? DEFAULT_PLAYERS))
  const ctx: Context = { data, profile, level, mode, iterations: opts.iterations ?? 0, expProfile: opts.profile, players, table: theoryDptTable(data) }
  const evs: PresetEvaluation[] = []
  const targetAssumptions = new Set<string>()
  presets.forEach((p, i) => {
    const { ev, assumptions } = evaluatePreset(ctx, p)
    evs.push(ev)
    for (const a of assumptions) targetAssumptions.add(a)
    opts.onProgress?.(i + 1, presets.length, p.id)
  })

  // Axe Soin : tour mixte soin + bouclier, réductions × dégâts reçus de référence (médiane des presets : un tour du boss
  // sur un personnage), armure × coups ; PV UTILES = plafonnés à ces dégâts de référence (on ne soigne ni ne protège
  // plus que ce que le boss inflige). Protection : boucliers (rotation consacrée) + réductions + armure, sans soin.
  const refIncoming = median(evs.map(e => e.survival.incoming).filter(v => v > 0))
  for (const e of evs) {
    const kept = (e.heal.reduction / 100) * refIncoming + e.heal.armor * REF_HITS_PER_TURN
    e.heal.raw = e.heal.mixed.heal + e.heal.mixed.shield + kept
    e.heal.cap = refIncoming
    e.heal.value = Math.min(e.heal.raw, refIncoming)
    e.heal.protectionRaw = e.heal.shield + kept
    e.heal.protection = Math.min(e.heal.protectionRaw, refIncoming)
    e.axes.heal = e.heal.value
  }

  // Par classe : meilleur preset par axe.
  // Départage : sur l'axe Dégâts, le DPT « résistances levées » (boss à résistances ≥ 100 % : tous les DPT sont nuls) ;
  // sur l'axe Soin, le débit brut (avant plafond).
  const tie = (axis: RankingAxis, e: PresetEvaluation) => (axis === 'damage' ? (e.dpt.resLifted ?? 0) : axis === 'heal' ? e.heal.raw : 0)
  const order = (axis: RankingAxis) => (x: PresetEvaluation, y: PresetEvaluation) =>
    y.axes[axis] - x.axes[axis] || tie(axis, y) - tie(axis, x) || x.presetId.localeCompare(y.presetId)
  // Ex æquo (rang partagé) : même valeur d'axe (et, sur l'axe Dégâts, même DPT « résistances levées »).
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
  const tied = (axis: RankingAxis, x: PresetEvaluation, y: PresetEvaluation) =>
    same(x.axes[axis], y.axes[axis]) && (axis !== 'damage' || same(x.dpt.resLifted ?? 0, y.dpt.resLifted ?? 0))
  const breeds = [...new Set(evs.map(e => e.breedId))]
  const classes: ClassSummary[] = breeds.map(b => {
    const list = evs.filter(e => e.breedId === b)
    const best = Object.fromEntries(
      RANKING_AXES.map(axis => {
        const top = [...list].sort(order(axis))[0]
        return [axis, { presetId: top.presetId, value: top.axes[axis] }]
      }),
    ) as ClassSummary['best']
    return { breedId: b, className: list[0].className, best, confidence: CLASS_CONFIDENCE[b] ?? 'moyenne' }
  })
  const evById = new Map(evs.map(e => [e.presetId, e]))
  const axes: AxisRanking[] = RANKING_AXES.map(axis => {
    const sorted = classes
      .map(c => ({ breedId: c.breedId, className: c.className, presetId: c.best[axis].presetId, value: c.best[axis].value }))
      .sort((a, b) => order(axis)(evById.get(a.presetId)!, evById.get(b.presetId)!) || a.className.localeCompare(b.className))
    const ev = (i: number) => evById.get(sorted[i].presetId)!
    const entries = sorted.map((x, i) => ({ ...x, rank: i + 1, tied: false }))
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && tied(axis, ev(i - 1), ev(i))) entries[i].rank = entries[i - 1].rank
      entries[i].tied = (i > 0 && tied(axis, ev(i - 1), ev(i))) || (i + 1 < entries.length && tied(axis, ev(i), ev(i + 1)))
    }
    return { axis, label: AXIS_INFO[axis].label, unit: AXIS_INFO[axis].unit, entries }
  })

  const comp = suggestComposition(profile, evs, players)
  const composition = { members: comp.members, rules: COMPOSITION_RULES.slice(), notes: comp.notes }

  const assumptions = [
    ...profile.assumptions,
    ...targetAssumptions,
    mode === 'optimized'
      ? `Stuffs optimisés contre ce boss (optimizeStuff, ${ctx.iterations} itération(s) de recuit, graines sans stuffs du Vortex ni objets au-dessus du niveau ${level}).`
      : level < PRESET_LEVEL
        ? `Niveau ${level} : les stuffs génériques (niveau 200) sont inutilisables, personnages SANS équipement (points et parchemins du preset) — comparaison des kits de classe, pas des stuffs.`
        : 'Stuffs génériques des presets (6 stuffs méta de 12/2024, data/ai/presets.json, jets max), partagés entre classes d\'un même élément.',
    `Presets écrits à la main : ${presets.length} preset(s), 2 à 3 voies par classe, variantes de sorts fixées (d'autres variantes peuvent mieux convenir à ce boss).`,
    'DPT soutenu NON calibré : sac à dos analytique en régime établi (relances amorties), contre chaque phase attaquable pondérée ; meilleure posture de classe, tenue tout le combat (coût de changement non compté).',
    `Étalonnage moteur affiché à côté du DPT (data/ai/calibration.json : dégâts simulés / analytique, mini-combat contre un Buboxor, niveau 200 avec le stuff du preset) : un contrôle, pas une correction — il ne dépend ni du boss, ni du niveau, ni d'un stuff optimisé ; écart de plus de ${COMPOSITION_THRESHOLDS.calibrationGap * 100} % signalé pour le podium et la composition.`,
    'Axes indépendants, sans note globale : un tour consacré au retrait ou au soin n\'est pas consacré aux dégâts.',
    'Axe Contrôle : PM + PA retirés en UN tour (tour mixte, un seul budget de PA, réserves non punies que le boss possède) ; les colonnes « PM seul » / « PA seul » supposent chacune tout le tour et ne s\'additionnent pas.',
    'Survie : PV effectifs du stuff seul (proxy de stuff) — identiques pour les presets d\'un même stuff générique (rang partagé « = ») ; le kit défensif de classe compte dans l\'axe Soin.',
    `Axe Soin : PV soignés ou préservés UTILES par tour, total d'équipe = tour mixte soin + bouclier (un budget de PA) + réduction × ${fmt(refIncoming)} + armure × ${REF_HITS_PER_TURN} coups, plafonné à ${fmt(refIncoming)} (dégâts d'un tour du boss sur un personnage, médiane des presets : le boss frappe une cible par tour, ses zones et invocations ne sont pas comptées) ; boucliers supposés consommés ; débit brut affiché à côté.`,
    `Composition pour ${players} personnage(s), règles explicites (voir « Règles »).`,
  ]
  const warnings = [
    ...profile.warnings,
    'Non modélisé : invocations, glyphes, pièges, bombes, tourelles, arme (corps-à-corps), buffs d\'équipe entre personnages (apports affichés à part, jamais ajoutés au DPT), IA réelle du boss, positions et ligne de vue.',
    'Les classements valent plus que les valeurs absolues.',
  ]
  if (removalPunished(profile, 'mp-removal')) warnings.push('Retrait PM puni par le boss : compté 0 sur l\'axe Contrôle pour tous les presets.')
  if (removalPunished(profile, 'ap-removal')) warnings.push('Retrait PA puni par le boss : compté 0 sur l\'axe Contrôle pour tous les presets.')
  // Étalonnage moteur : podium de l'axe Dégâts et dégâts de la composition dont l'analytique s'écarte du moteur.
  const damageAxis = axes.find(a => a.axis === 'damage')!
  const watched = [...new Set([...damageAxis.entries.slice(0, 3).map(x => x.presetId), ...comp.members.filter(m => m.slot === 'Dégâts').map(m => m.presetId)])]
  for (const id of watched) {
    const e = evById.get(id)!
    if (e.dpt.steady <= 0 || Math.abs(1 - e.dpt.calibration) <= COMPOSITION_THRESHOLDS.calibrationGap) continue
    const pct = Math.round(Math.abs(1 - e.dpt.calibration) * 100)
    warnings.push(
      `${id} : étalonnage moteur ×${fmt(e.dpt.calibration, 2)} (le moteur inflige ${pct} % ${e.dpt.calibration < 1 ? 'de moins' : 'de plus'} que l'analytique) — DPT étalonné ${fmt(e.dpt.calibrated)} au lieu de ${fmt(e.dpt.steady)} ; son rang sur l'axe Dégâts est à lire avec prudence.`,
    )
  }
  const topCalibrated = [...evs].sort((a, b) => b.dpt.calibrated - a.dpt.calibrated || a.presetId.localeCompare(b.presetId))[0]
  const top = damageAxis.entries[0] && evById.get(damageAxis.entries[0].presetId)
  if (top && topCalibrated && topCalibrated.dpt.calibrated > 0 && topCalibrated.presetId !== top.presetId)
    warnings.push(
      `Avec l'étalonnage moteur, le meilleur DPT serait ${topCalibrated.className} ${topCalibrated.presetId} (${fmt(topCalibrated.dpt.calibrated)} étalonné) au lieu de ${top.className} ${top.presetId} (${fmt(top.dpt.calibrated)} étalonné)${topCalibrated.breedId === top.breedId ? ' : même classe en tête, autre preset' : ' : la classe en tête change'}.`,
    )
  if (profile.mechanics.some(m => m.kind === 'incurable'))
    warnings.push('Le boss rend des personnages insoignables : la part « soin » de l\'axe Soin peut être annulée ; la composition prend alors une protection (boucliers, réductions) plutôt qu\'un soigneur.')
  for (const e of evs) for (const w of e.warnings) warnings.push(`${e.presetId} : ${w}`)

  return {
    boss: { monsterId: profile.monsterId, name: profile.name, grade: profile.grade, ...(profile.players !== undefined ? { players: profile.players } : {}), level: profile.level },
    level,
    players,
    stuff: mode,
    presets: evs,
    classes,
    axes,
    composition,
    assumptions,
    warnings,
  }
}
