/**
 * Paramètres et état plat du scénario Œil de Vortex (docs/design/ai.md §12.1, §13.1) — WP3.
 *
 *  - `resolveVortexParams` : défauts (`VORTEX_DEFAULT_PARAMS`), conversion et validation (message FR) ; invariant
 *    « la dernière vague arrive avant le déverrouillage » (`max(arrivalRounds) < unlockVortexTurn`, monster-ai.md §7.2).
 *  - `sampleUncertain` / `sampleVortexVariant` : tirage d'une variante des règles INCERTAINES pour une graine de combat
 *    (`Rng(mix32(fightSeed, 0x5C))`, §13.1), chaque paramètre indépendamment selon ses poids ; clé lisible de la
 *    variante ('default' si tout est au défaut).
 *  - `VortexState` : `fight.scenarioState.vortex` = paramètres + compteurs du scénario, PLAT (§3.2) ; les tableaux y sont
 *    remplacés, jamais modifiés en place, si bien que la copie superficielle de `cloneState` (E2) suffit.
 */
import { mix32 } from '../../core/hash'
import { Rng } from '../../core/rng'
import type { FightState } from '../../engine/types'
import type { ScenarioParams, UncertainParam } from '../types'
import {
  BLUE_START_CELLS,
  VORTEX_DEFAULT_PARAMS,
  VORTEX_STATE_KEY,
  VORTEX_UNCERTAIN,
  WAVE_COUNT,
  type VortexParams,
} from './constants'

/**
 * Premier tour du Vortex où ses déclencheurs de déverrouillage (5008 / 5060) s'exécutent dans le moteur, avec les
 * données telles quelles (délai 25 décompté au début de chacun de ses tours, Marginal 25 tours retiré au même moment).
 * Mesuré sur le moteur (tests/vortex-scenario.test.ts) ; `unlockVortexTurn` décale ces deux durées de
 * `unlockVortexTurn − ENGINE_UNLOCK_TURN`.
 */
export const ENGINE_UNLOCK_TURN = 25

/** Jet de PV des ressuscités des données (780 de 5003 : 20 à 30 %). */
export const DATA_REZ_HP_PCT: readonly number[] = [20, 30]

/** Clé de variante quand tous les paramètres INCERTAINS sont à leur défaut. */
export const DEFAULT_VARIANT = 'default'

// ───────────────────────────── résolution / validation ─────────────────────────────

const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def)
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)
const nums = (v: unknown, def: readonly number[]): readonly number[] =>
  Array.isArray(v) && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v.slice() : def.slice()

/** Erreurs de validation (vide = paramètres valides). */
export function validateVortexParams(p: VortexParams): string[] {
  const errors: string[] = []
  if (!Number.isInteger(p.players) || p.players < 1 || p.players > 8) errors.push(`players doit être un entier de 1 à 8 (reçu ${p.players})`)
  for (const k of ['monsterGrade', 'bossGrade'] as const) {
    if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 5) errors.push(`${k} doit être un grade de 1 à 5 (reçu ${p[k]})`)
  }
  if (!BLUE_START_CELLS.includes(p.vortexCell)) errors.push(`vortexCell doit être une case bleue (${BLUE_START_CELLS.join(', ')}), reçu ${p.vortexCell}`)
  if (p.startingTeamRule !== 'average' && p.startingTeamRule !== 'best') errors.push(`startingTeamRule inconnue : ${String(p.startingTeamRule)}`)
  const ar = p.arrivalRounds
  if (ar.length !== WAVE_COUNT) errors.push(`arrivalRounds doit compter ${WAVE_COUNT} tours (reçu ${ar.length})`)
  else {
    if (ar[0] !== 1) errors.push('arrivalRounds[0] doit valoir 1 (vague 1 au début du combat)')
    for (let i = 1; i < ar.length; i++) if (!Number.isInteger(ar[i]) || ar[i] <= ar[i - 1]) errors.push('arrivalRounds doit être une suite strictement croissante d’entiers')
    if (Math.max(...ar) >= p.unlockVortexTurn) {
      errors.push(`invariant violé : la dernière vague (tour ${Math.max(...ar)}) doit arriver avant le déverrouillage (tour ${p.unlockVortexTurn})`)
    }
  }
  if (!Number.isInteger(p.arrivalInvulnerableTurns) || p.arrivalInvulnerableTurns < 0) errors.push('arrivalInvulnerableTurns doit être un entier ≥ 0')
  const rz = p.rezHpPct
  if (rz.length !== 2 || rz[0] < 1 || rz[1] < rz[0] || rz[1] > 100) errors.push(`rezHpPct doit être [min, max] avec 1 ≤ min ≤ max ≤ 100 (reçu ${rz.join(', ')})`)
  if (!Number.isInteger(p.unlockVortexTurn) || p.unlockVortexTurn < 2 || p.unlockVortexTurn > 60) errors.push('unlockVortexTurn doit être un entier de 2 à 60')
  if (!Number.isInteger(p.actionDelay) || p.actionDelay < 0 || p.actionDelay > 5) errors.push('actionDelay doit être un entier de 0 à 5')
  if (p.glyphTrigger !== 'enter' && p.glyphTrigger !== 'turnEnd') errors.push(`glyphTrigger inconnu : ${String(p.glyphTrigger)}`)
  if (!Number.isInteger(p.maxRounds) || p.maxRounds < 1) errors.push('maxRounds doit être un entier ≥ 1')
  return errors
}

/**
 * Paramètres typés à partir de paramètres plats (défauts complétés, types contrôlés). Lève une erreur (FR) si un
 * paramètre est invalide ou si l'invariant des vagues est violé.
 */
export function resolveVortexParams(params: ScenarioParams | Partial<VortexParams> = {}): VortexParams {
  const r = params as Record<string, unknown>
  const d = VORTEX_DEFAULT_PARAMS
  const p: VortexParams = {
    players: num(r.players, d.players),
    monsterGrade: num(r.monsterGrade, d.monsterGrade),
    bossGrade: num(r.bossGrade, d.bossGrade),
    vortexCell: num(r.vortexCell, d.vortexCell),
    startingTeamRule: r.startingTeamRule === 'best' || r.startingTeamRule === 'average' ? r.startingTeamRule : r.startingTeamRule === undefined ? d.startingTeamRule : (r.startingTeamRule as 'best'),
    arrivalRounds: nums(r.arrivalRounds, d.arrivalRounds),
    arrivalInvulnerableTurns: num(r.arrivalInvulnerableTurns, d.arrivalInvulnerableTurns),
    wave1Invulnerable: bool(r.wave1Invulnerable, d.wave1Invulnerable),
    earlySpawnIfCleared: bool(r.earlySpawnIfCleared, d.earlySpawnIfCleared),
    rezHpPct: nums(r.rezHpPct, d.rezHpPct),
    rezMinusOneMp: bool(r.rezMinusOneMp, d.rezMinusOneMp),
    rezAllPerTurn: bool(r.rezAllPerTurn, d.rezAllPerTurn),
    deadPlayerAdvancesClock: bool(r.deadPlayerAdvancesClock, d.deadPlayerAdvancesClock),
    unlockVortexTurn: num(r.unlockVortexTurn, d.unlockVortexTurn),
    actionDelay: num(r.actionDelay, d.actionDelay),
    glyphTrigger: r.glyphTrigger === 'enter' || r.glyphTrigger === 'turnEnd' ? r.glyphTrigger : r.glyphTrigger === undefined ? d.glyphTrigger : (r.glyphTrigger as 'enter'),
    maxRounds: num(r.maxRounds, d.maxRounds),
  }
  const errors = validateVortexParams(p)
  if (errors.length) throw new Error(`Paramètres du Vortex invalides : ${errors.join(' ; ')}`)
  return p
}

// ───────────────────────────── variantes INCERTAINES ─────────────────────────────

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b

const formatValue = (v: unknown): string => (Array.isArray(v) ? v.join(',') : String(v))

/** Clé lisible d'une variante : paramètres INCERTAINS différents de leur défaut (`values[0]`), dans l'ordre de la liste. */
export function variantKey(params: ScenarioParams | Record<string, unknown>, uncertain: readonly UncertainParam[] = VORTEX_UNCERTAIN): string {
  const p = params as Record<string, unknown>
  const parts: string[] = []
  for (const u of uncertain) {
    if (!(u.key in p)) continue
    if (!sameValue(p[u.key], u.values[0])) parts.push(`${u.key}=${formatValue(p[u.key])}`)
  }
  return parts.length ? parts.join('|') : DEFAULT_VARIANT
}

/**
 * Tire une variante des règles INCERTAINES (§12.1, §13.1) : `Rng(mix32(seed, 0x5C))`, un tirage par paramètre dans
 * l'ordre de la liste (même si le paramètre n'a qu'une valeur : flux stable), valeur choisie selon les poids.
 * Renvoie seulement les paramètres différents du défaut et la clé de la variante.
 */
export function sampleUncertain(uncertain: readonly UncertainParam[], seed: number): { params: Record<string, number | string | boolean | number[]>; key: string } {
  const rng = new Rng(mix32(seed, 0x5c))
  const params: Record<string, number | string | boolean | number[]> = {}
  for (const u of uncertain) {
    const r = rng.next()
    const total = u.weights.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    let pick = u.values.length - 1
    for (let i = 0; i < u.values.length; i++) {
      acc += (u.weights[i] ?? 0) / total
      if (r < acc) {
        pick = i
        break
      }
    }
    if (pick !== 0) {
      const v = u.values[pick]
      params[u.key] = Array.isArray(v) ? v.slice() : v
    }
  }
  return { params, key: variantKey(params, uncertain) }
}

/** Variante INCERTAINE du Vortex pour une graine de combat. */
export function sampleVortexVariant(seed: number): { params: Partial<VortexParams>; key: string } {
  const { params, key } = sampleUncertain(VORTEX_UNCERTAIN, seed)
  return { params: params as Partial<VortexParams>, key }
}

// ───────────────────────────── état plat du scénario ─────────────────────────────

/**
 * Compteurs du scénario rangés avec les paramètres dans `fight.scenarioState.vortex`. Tableaux remplacés (jamais
 * modifiés en place) : `cloneState` (E2) se contente d'une copie superficielle de l'objet.
 */
export interface VortexRuntime {
  /** Nombre de personnages au début du combat (N de la composition des vagues). */
  players: number
  vortexId: number
  /** −1 tant que l'Auroraire n'existe pas. */
  auroraireId: number
  /** Vagues apparues (1..5) et tour d'arrivée réel de chacune. */
  wavesSpawned: number
  waveRounds: readonly number[]
  /** Ordre canonique des racines (timeline du début de combat + arrivants) : ancre des tics d'horloge des morts. */
  slotOrder: readonly number[]
  /** Case de début de combat des personnages, dans l'ordre de l'équipe. */
  startCells: readonly number[]
  /** Dernier tour de jeu où le créneau de chaque personnage (index = id) a fait avancer l'horloge (0 = jamais). */
  clockTicks: readonly number[]
  /** Monstres morts au début du tour du Vortex en cours (résurrections à corriger après ses déclencheurs). */
  rezPending: readonly number[]
  /** Débuts de tour du Vortex (son n-ième tour). */
  vortexTurns: number
  /** Tour du Vortex (n) où tous les monstres de vague ont été vus corrompus (0 = pas encore). */
  allCorruptSince: number
  /** Tour de jeu d'*Action !* (0 = pas encore). */
  actionRound: number
  /** Monstres corrompus (cumul) à la fin de chaque tour de jeu (index 0 = tour 1). */
  corruptedByRound: readonly number[]
  /** Clé de la variante INCERTAINE (`variantKey`). */
  variant: string
  /** Sorts de départ qui n'ont pas pu être lancés (ids des combattants) — diagnostic. */
  startingSpellFailures: readonly number[]
  /**
   * PV max (sans bonus) de chaque monstre de vague au grade `monsterGrade` (clé = id du monstre) : PV des monstres des
   * vagues à venir pour le suivi et le modèle abstrait. Objet immuable partagé par les clones.
   */
  waveMonsterMaxHp: Readonly<Record<number, number>>
}

export type VortexState = VortexParams & VortexRuntime

/** État du Vortex d'un combat (undefined si le combat n'est pas un combat du Vortex). */
export function vortexState(fight: FightState): VortexState | undefined {
  const v = fight.scenarioState[VORTEX_STATE_KEY]
  return v && typeof v === 'object' ? (v as VortexState) : undefined
}

/** État du Vortex (erreur explicite si absent). */
export function requireVortexState(fight: FightState): VortexState {
  const v = vortexState(fight)
  if (!v) throw new Error('Ce combat n’est pas un combat de l’Œil de Vortex (scenarioState.vortex absent)')
  return v
}

/** Met à jour des champs de l'état (en place sur l'objet de CE combat : chaque clone a sa copie, E2). */
export function patchVortexState(fight: FightState, patch: Partial<VortexState>): void {
  const v = fight.scenarioState[VORTEX_STATE_KEY]
  if (v && typeof v === 'object') Object.assign(v, patch)
}

/** Paramètres seuls (sans compteurs) d'un état. */
export function paramsOf(v: VortexState): VortexParams {
  return {
    players: v.players,
    monsterGrade: v.monsterGrade,
    bossGrade: v.bossGrade,
    vortexCell: v.vortexCell,
    startingTeamRule: v.startingTeamRule,
    arrivalRounds: v.arrivalRounds,
    arrivalInvulnerableTurns: v.arrivalInvulnerableTurns,
    wave1Invulnerable: v.wave1Invulnerable,
    earlySpawnIfCleared: v.earlySpawnIfCleared,
    rezHpPct: v.rezHpPct,
    rezMinusOneMp: v.rezMinusOneMp,
    rezAllPerTurn: v.rezAllPerTurn,
    deadPlayerAdvancesClock: v.deadPlayerAdvancesClock,
    unlockVortexTurn: v.unlockVortexTurn,
    actionDelay: v.actionDelay,
    glyphTrigger: v.glyphTrigger,
    maxRounds: v.maxRounds,
  }
}
