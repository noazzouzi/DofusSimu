/**
 * Scénario « Œil de Vortex » (docs/design/ai.md §12) — WP3.
 *
 *  - `vortexScenario` (contrat `DungeonScenario`) : mise en place et règles serveur dans setup.ts (`createVortexFight`,
 *    `vortexHooks`), paramètres et variantes dans params.ts, micro-scénarios dans micro.ts, résumé (`summarizeVortex`).
 *  - `aiModel` : modèle stratégique de BASE (`basicVortexAIModel`) — phase (§9.4), vulnérabilité (vague invulnérable,
 *    Vortex Marginal, corrompus), lignes de l'Auroraire au prochain créneau du Vortex (`extraIncoming`), besoins en
 *    rôles, décisions clés « arrivée de vague / changement de phase ». Le modèle complet (HourPlanner, pricers, burst,
 *    placement simulé ; model.ts, WP3b) s'enregistre par `setVortexAIModelFactory` sans modifier ce fichier.
 */
import type { AIMode, AIView, Blackboard, PhaseId, Perception, ReferenceTargets, StrategyParams } from '../../ai/types'
import { emptyStats, type Stats } from '../../core/types'
import type { DataStore } from '../../data/store'
import { createEngine } from '../../engine'
import type { Engine } from '../../engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../../engine/factory'
import { runFight } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import type { Replay } from '../../replay/types'
import { passTurnController, scriptedVortexController, uniformProvider } from '../generic/controllers'
import { VORTEX_TARGET_MIX } from '../generic/dummy'
import type { DungeonScenario, KeyDecisionReason, ScenarioAIModel, ScenarioParams, ScenarioSummary } from '../types'
import { arrivalInvulnerableUntil } from '../waves'
import { forecastHours, hourCount, isCorrupted, isWaveMonster, lineCells, nextVortexSlot } from './clock'
import {
  AURORAIRE,
  INVULNERABLE,
  MARGINAL,
  VORTEX,
  VORTEX_DEFAULT_PARAMS,
  VORTEX_MAP_ID,
  VORTEX_ROLE_NEEDS,
  VORTEX_SCENARIO_ID,
  VORTEX_UNCERTAIN,
  type VortexParams,
} from './constants'
import { vortexMicro } from './micro'
import { resolveVortexParams, vortexState } from './params'
import { corruptedCount, createVortexFight, vortexHooks } from './setup'
import { trackVortex } from './tracker'

export { createVortexFight, vortexHooks } from './setup'

/** Paramètres typés à partir de paramètres plats (défauts complétés, validés). */
export function vortexParams(params: ScenarioParams): VortexParams {
  return resolveVortexParams(params)
}

// ───────────────────────────── modèle stratégique de base ─────────────────────────────

/** Dégâts de base d'*En temps et en heure* (5061 : 500 Terre, Auroraire sans caractéristiques) — INCERTAIN. */
export const AURORAIRE_LINE_BASE_DAMAGE = 500

/** Phase de combat déduite de l'état (§9.4, sans plan). */
export function vortexPhase(fight: FightState): PhaseId {
  const vx = vortexState(fight)
  if (!vx) return 'fight'
  const vortex = fight.fighters[vx.vortexId]
  if (vx.actionRound > 0) return vortex && vortex.alive && !vortex.states.includes(INVULNERABLE) ? 'burst' : 'transition'
  const monsters = fight.fighters.filter(isWaveMonster)
  const allCorrupt = monsters.length > 0 && monsters.every(isCorrupted)
  if (allCorrupt && vx.wavesSpawned >= vx.arrivalRounds.length) return 'transition'
  if (allCorrupt) return 'waiting'
  if (fight.round <= 1) return 'opening'
  return 'waveCycle'
}

/**
 * `e` sera-t-il vulnérable dans `roundOffset` tours de jeu ? Faux pour : invulnérabilité d'arrivée encore active,
 * monstre corrompu, Vortex avant *Action !* (Marginal / invulnérable) ou pendant son tour invulnérable qui suit.
 */
export function vortexVulnerableAt(s: FightState, e: Fighter, roundOffset: number): boolean {
  if (!e.alive) return false
  if (isCorrupted(e)) return false
  const until = arrivalInvulnerableUntil(e)
  if (until > s.round + roundOffset) return false
  if (e.monsterId === VORTEX) {
    const vx = vortexState(s)
    if (!vx || vx.actionRound === 0) return false
    if (roundOffset === 0 && e.states.includes(INVULNERABLE)) return false
    return true
  }
  // Autres invulnérabilités (état 56 hors arrivée) : supposées durables.
  if (until === 0 && e.states.includes(INVULNERABLE)) return false
  return true
}

/**
 * Cibles de référence du Vortex (§9.2, §15.4) : mix pondéré des monstres de vague (Ikargn 3, Méjaire 4, Harpille 4,
 * Buboxor 3, Brabuzar 5) et du Vortex (0,3 × 19), aux grades du scénario. Combattants « modèles » hors combat (ids
 * négatifs −100 − rang, case −1, `tags.referenceTarget`) : caractéristiques de grade sans buff (ni heure, ni Marginal),
 * stables pendant tout le combat ⇒ capacités et rôles comparables d'un tour à l'autre.
 */
export function vortexReferenceTargets(data: DataStore, p: Pick<VortexParams, 'monsterGrade' | 'bossGrade'>): ReferenceTargets {
  return {
    targets: VORTEX_TARGET_MIX.map(({ monsterId, weight }, i) => {
      const fighter = createMonsterFighter(data, { monsterId, grade: monsterId === VORTEX ? p.bossGrade : p.monsterGrade, team: 1 })
      fighter.id = -100 - i
      fighter.tags.referenceTarget = true
      return { fighter, weight }
    }),
  }
}

type ModelFactory = (params: ScenarioParams, theta: StrategyParams) => ScenarioAIModel
let modelFactory: ModelFactory | undefined

/** Remplace le modèle stratégique du Vortex (model.ts, WP3b). `undefined` rétablit le modèle de base. */
export function setVortexAIModelFactory(f: ModelFactory | undefined): void {
  modelFactory = f
}

/**
 * Modèle de base : publie la phase et les besoins en rôles ; `extraIncoming` = dégâts attendus d'*En temps et en heure*
 * sur une case de la croix de l'Auroraire au prochain créneau du Vortex (à partir de son 2e tour), pour un allié qui
 * ne rejoue pas avant ; `vulnerableAt` (§6.6) ; décisions clés : arrivée de vague, changement de phase ; cibles de
 * référence (`vortexReferenceTargets`).
 */
export function basicVortexAIModel(params: ScenarioParams, _theta?: StrategyParams): ScenarioAIModel {
  const p = resolveVortexParams(params)
  // Cache rafraîchi par `update` (début du tour de chaque joueur, état réel).
  let line: Uint8Array | null = null
  let beforeVortex = new Set<number>()
  let lastPhase: PhaseId | undefined
  let lastWaves = 0
  let keyReason: KeyDecisionReason | null = null
  let refTargets: ReferenceTargets | undefined
  return {
    id: VORTEX_SCENARIO_ID,
    update(view: AIView, bb: Blackboard, _perception: Perception, _mode: AIMode) {
      const s = view.fight
      const phase = vortexPhase(s)
      const vx = vortexState(s)
      keyReason = null
      if (lastPhase !== undefined && phase !== lastPhase) keyReason = 'phaseChange'
      if (vx && vx.wavesSpawned > lastWaves && lastWaves > 0) keyReason = 'waveArrival'
      lastPhase = phase
      lastWaves = vx?.wavesSpawned ?? 0
      bb.phase = phase
      line = null
      beforeVortex = new Set()
      if (!vx) return
      const slots = forecastHours(s, 2, p)
      const vi = nextVortexSlot(slots, 1)
      // En temps et en heure : pas au 1er tour du Vortex (vortexTurns = tours déjà commencés).
      const willStrike = vi >= 0 && (vx.vortexTurns >= 1 || (slots[0]?.isVortex ?? false))
      if (vi >= 0 && willStrike) {
        const cells = lineCells(slots[vi].hour)
        line = new Uint8Array(s.map.cells.length || 560)
        for (const c of cells) line[c] = 1
        for (let i = 1; i < vi; i++) if (slots[i].isPlayer) beforeVortex.add(slots[i].fighterId)
      }
    },
    extraIncoming(_s: FightState, a: Fighter, cell: number): number {
      if (!line || cell < 0 || !line[cell] || beforeVortex.has(a.id)) return 0
      const res = a.stats.earthResPct ?? 0
      const fixed = a.stats.earthRes ?? 0
      const eroded = Math.max(0, a.baseMaxHp - a.maxHp)
      return Math.max(0, AURORAIRE_LINE_BASE_DAMAGE * (1 - Math.min(50, res) / 100) - fixed) + 0.5 * eroded
    },
    vulnerableAt: vortexVulnerableAt,
    isKeyDecision: () => keyReason,
    roleNeeds: () => ({ ...VORTEX_ROLE_NEEDS }),
    referenceTargets: (view: AIView) => (refTargets ??= vortexReferenceTargets(view.engine.data, p)),
  }
}

// ───────────────────────────── résumé ─────────────────────────────

/**
 * Morts de personnages dont le tueur est un monstre `monsterId` (registre `fight.deaths`, information publique ; la
 * croix d'*En temps et en heure* est frappée par l'Auroraire elle-même, 5061).
 */
export function playerDeathsBy(fight: FightState, monsterId: number): number {
  let n = 0
  for (const d of fight.deaths ?? []) {
    const victim = fight.fighters[d.fighter]
    const killer = d.killer !== undefined ? fight.fighters[d.killer] : undefined
    if (victim?.kind === 'player' && killer?.monsterId === monsterId) n++
  }
  return n
}

/** Tueur de la PREMIÈRE mort de personnage (cause « racine » d'une défaite), undefined sans mort ou sans tueur. */
export function firstPlayerDeathKiller(fight: FightState): Fighter | undefined {
  for (const d of fight.deaths ?? []) {
    if (fight.fighters[d.fighter]?.kind !== 'player') continue
    return d.killer !== undefined ? fight.fighters[d.killer] : undefined
  }
  return undefined
}

/**
 * Classement de l'échec (§15.2) depuis l'état final : limite de tours ; burst raté (après *Action !*) ; mort sur la
 * croix de l'Auroraire (première mort de personnage due à *En temps et en heure*) ; vague non corrompue au
 * déverrouillage ; submersion (plus de 2N monstres non corrompus vivants) ; défaite sinon.
 */
export function vortexFailReason(fight: FightState): string | undefined {
  if (fight.ended && fight.winner === 0) return undefined
  const vx = vortexState(fight)
  if (!fight.ended || fight.winner === null) return 'limite de tours'
  if (!vx) return 'défaite'
  if (vx.actionRound > 0) return 'burst raté'
  if (firstPlayerDeathKiller(fight)?.monsterId === AURORAIRE) return 'mort sur la croix de l’Auroraire'
  if (fight.round >= vx.unlockVortexTurn) return 'vague non corrompue au déverrouillage'
  const aliveMonsters = fight.fighters.filter(f => isWaveMonster(f) && f.alive && !isCorrupted(f)).length
  if (aliveMonsters > 2 * vx.players) return 'submersion'
  return 'défaite'
}

/**
 * Résumé (§15.2) : `progress = 0,45·corrompus/total + 0,15·[déverrouillé] + 0,30·dégâts au Vortex/PV + 0,10·vivants/N`
 * (total = monstres de vague des 5 vagues), corrompus cumulés par tour, heures distinctes (bonus du Vortex).
 */
export function summarizeVortex(fight: FightState): ScenarioSummary {
  const vx = vortexState(fight)
  const win = fight.ended && fight.winner === 0
  const snap = trackVortex(fight)
  const vortex = vx ? fight.fighters[vx.vortexId] : fight.fighters.find(f => f.monsterId === VORTEX)
  const players = fight.fighters.filter(f => f.team === 0 && f.kind === 'player')
  const alive = players.filter(f => f.alive).length
  const vortexHpPct = vortex ? (vortex.alive ? vortex.hp / Math.max(1, vortex.maxHp) : 0) : undefined
  const vortexDamage = vortexHpPct === undefined ? 0 : 1 - vortexHpPct
  const unlocked = (vx?.actionRound ?? 0) > 0
  const progress = win
    ? 1
    : 0.45 * (snap.total ? snap.corrupted / snap.total : 0) +
      0.15 * (unlocked ? 1 : 0) +
      0.3 * vortexDamage +
      0.1 * (players.length ? alive / players.length : 0)
  // Tours JOUÉS : la limite de tours fait commencer (puis finir aussitôt) le tour maxRounds + 1.
  const rounds = Math.min(fight.round, fight.options.maxRounds)
  const byRound = (vx?.corruptedByRound ?? []).slice(0, rounds)
  while (byRound.length < rounds) byRound.push(corruptedCount(fight))
  return {
    win,
    rounds,
    endReason: fight.endReason ?? '',
    failReason: win ? undefined : vortexFailReason(fight),
    progress: Math.max(0, Math.min(1, progress)),
    corruptedByRound: byRound,
    hoursUsed: hourCount(snap.hoursUsedMask),
    phase2Rounds: unlocked && vx ? Math.max(0, rounds - vx.actionRound) : undefined,
    vortexHpPct,
    extra: {
      spawned: snap.spawned,
      corrupted: snap.corrupted,
      totalMonsters: snap.total,
      wavesSpawned: vx?.wavesSpawned ?? 0,
      actionRound: vx?.actionRound ?? 0,
      vortexTurns: vx?.vortexTurns ?? 0,
      playersAlive: alive,
      playerDeathsByAuroraire: playerDeathsBy(fight, AURORAIRE),
      hoursUsedMask: snap.hoursUsedMask,
      unknownEffects: fight.unknownEffects ?? 0,
      startingSpellFailures: vx?.startingSpellFailures.length ?? 0,
      marginal: vortex?.states.includes(MARGINAL) ? 1 : 0,
    },
  }
}

// ───────────────────────────── scénario ─────────────────────────────

export const vortexScenario: DungeonScenario = {
  id: VORTEX_SCENARIO_ID,
  mapId: VORTEX_MAP_ID,
  defaultParams: { ...VORTEX_DEFAULT_PARAMS },
  uncertain: [...VORTEX_UNCERTAIN],
  hooks: vortexHooks,
  createFight: (engine, team, o) => createVortexFight(engine, team, o),
  aiModel: (params, theta) => (modelFactory ? modelFactory(params, theta) : basicVortexAIModel(params, theta)),
  micro: vortexMicro,
  summarize: summarizeVortex,
}

// ───────────────────────────── combat de fumée ─────────────────────────────

/** PV par défaut des personnages de fumée. */
export const SMOKE_HP = 60_000

/** Classes de l'équipe de fumée : Iop, Crâ, Enutrof, Eniripsa. */
export const SMOKE_BREEDS: readonly number[] = [8, 9, 3, 7]

/** Caractéristiques « simples » d'un personnage niveau 200 pour les tests (pas de stuff réel). */
export function smokeStats(initiative = 4000): Stats {
  return {
    ...emptyStats(),
    ap: 12, mp: 6, range: 2, summons: 2,
    strength: 800, intelligence: 800, chance: 800, agility: 800, wisdom: 200,
    power: 100, damage: 20, critical: 15, initiative,
    neutralResPct: 20, earthResPct: 20, fireResPct: 20, waterResPct: 20, airResPct: 20,
    tackleBlock: 20, tackleEvade: 20, apParry: 20, mpParry: 20, apReduction: 20, mpReduction: 20,
  }
}

/** Équipe de fumée (sorts de la classe au niveau 200, toutes variantes). */
export function createSmokeTeam(data: DataStore, breeds: readonly number[] = SMOKE_BREEDS, o: { initiative?: number; hp?: number } = {}): Fighter[] {
  return breeds.map((breedId, i) =>
    createPlayerFighter(data, {
      name: `${data.breed(breedId)?.name ?? 'Perso'} ${i + 1}`,
      breedId,
      level: 200,
      stats: smokeStats((o.initiative ?? 4000) - i),
      maxHp: o.hp ?? 4000,
      team: 0,
    }),
  )
}

export interface SmokeOptions {
  data: DataStore
  /** Tours de jeu joués (défaut 30). */
  rounds?: number
  record?: boolean
  params?: Partial<VortexParams>
  breeds?: readonly number[]
  /** 'nearest' (défaut) : attaque au plus près + sorts du Vortex sur l'Auroraire ; 'pass' : personne n'agit. */
  controller?: 'nearest' | 'pass'
  /** Initiative des personnages (défaut 4000 : l'équipe des joueurs commence, k = N). */
  initiative?: number
  /** PV des personnages (défaut 60 000 : l'équipe tient les 30 tours, toutes les vagues sont exercées). */
  hp?: number
}

export interface SmokeResult {
  engine: Engine
  fight: FightState
  summary: ScenarioSummary
  replay: Replay
}

/**
 * Combat de fumée sans CLI ni IA (tests) : 4 personnages simples, contrôleur trivial pour tout le monde, `rounds`
 * tours du vrai scénario (vagues, horloge, résurrections), replay enregistré.
 */
export function runVortexSmoke(seed: number, o: SmokeOptions): SmokeResult {
  const rounds = o.rounds ?? 30
  const engine = createEngine(o.data, vortexHooks)
  const team = createSmokeTeam(o.data, o.breeds ?? SMOKE_BREEDS, { initiative: o.initiative, hp: o.hp ?? SMOKE_HP })
  const fight = createVortexFight(engine, team, {
    params: { ...VORTEX_DEFAULT_PARAMS, ...o.params, maxRounds: rounds },
    seed,
    rollMode: 'random',
    record: o.record ?? true,
    rngRekey: 'perTurn',
  })
  const ctrl = o.controller === 'pass' ? passTurnController : scriptedVortexController()
  runFight(engine, fight, uniformProvider(ctrl))
  const summary = summarizeVortex(fight)
  const replay: Replay = {
    version: 1,
    events: fight.events,
    map: fight.map,
    meta: {
      title: `Œil de Vortex — combat de fumée (graine ${seed})`,
      description: 'Contrôleurs triviaux (attaque au plus près), règles serveur du scénario, sorts réels.',
      scenario: 'Œil de Vortex',
      seed,
      generator: 'runVortexSmoke',
    },
  }
  return { engine, fight, summary, replay }
}
