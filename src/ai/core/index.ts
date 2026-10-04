/**
 * Socle de perception de l'IA (docs/design/ai.md §6) — WP1. Point d'entrée UNIQUE du socle pour WP2/WP3/WP4 :
 * les signatures exportées ici sont celles que les autres lots appellent ; WP1 les réimplémente dans les fichiers de
 * §4 (rng.ts, view.ts, sim.ts, budget.ts, timeline.ts, reach.ts, spellProfile.ts, dpt.ts, threat.ts, potential.ts,
 * kill.ts, value.ts, candidates.ts…) et ne garde ici que des réexportations.
 *
 * S0 : deux catégories de code dans ce fichier.
 *  - « Référence S0 » : comportement exact décrit par le design (graines, vue, clones, avance du temps, budget) ;
 *    utilisable tel quel, WP1 peut le déplacer/optimiser sans changer la signature.
 *  - « BOUCHON S0 » (TODO(WP1)) : valeurs neutres (DPT 0, menace 0, accessibilité sans tacle…) pour que tout compile et
 *    tourne ; à remplacer en S1.
 */
import { mix32 } from '../../core/hash'
import type { TeamId } from '../../core/types'
import type { SpellLevelData } from '../../data/model'
import { canCast, castSpell } from '../../engine/cast'
import { isInstant } from '../../engine/effects/core'
import { isSpellSupported } from '../../engine/effects/support'
import type { Engine } from '../../engine/engine'
import { move, pathTo, reachableCells } from '../../engine/move'
import type { ControllerProvider } from '../../engine/runner'
import type { Fighter, FightState, Trap } from '../../engine/types'
import { CELL_COUNT } from '../../map/geometry'
import type { ScenarioAIModel } from '../../dungeons/types'
import {
  toActions,
  type AIConfig,
  type AIView,
  type Blackboard,
  type CandidateCat,
  type DptTable,
  type EvalBreakdown,
  type KillEstimate,
  type LethalSplit,
  type MacroAction,
  type NodeBudget,
  type Perception,
  type PotentialModel,
  type ReachInfo,
  type SlotForecast,
  type SpellProfile,
  type SpellProfileIndex,
  type ThreatModel,
} from '../types'

export { mix32 } from '../../core/hash'
export { toActions }

// ═════════════════════════════ Référence S0 : aléa et graines (§13.1, rng.ts) ═════════════════════════════

/** Graine IA d'un combat (`AIConfig.seed`), dérivée de la graine de combat. */
export function fightAISeed(fightSeed: number): number {
  return mix32(fightSeed ^ 0xa1a1a1a1, 0x5eed)
}

/** Graine des décisions IA : `aiSeed(f, id, r, k) = mix32(mix32(f ^ 0xa1a1a1a1, id), (r << 8) | k)` (§13.1). */
export function aiSeed(fightSeed: number, fighterId: number, round: number, k: number): number {
  return mix32(mix32(fightSeed ^ 0xa1a1a1a1, fighterId), (round << 8) | k)
}

/**
 * Sel d'un clone de recherche : hash du nœud parent ^ profondeur (même sel pour tous les frères, §6.1). Accepte le
 * hash 64 bits de `stateHash` (replié sur 32 bits) ou un hash 32 bits.
 */
export function simSalt(parentHash: number | bigint, depth: number): number {
  const h = typeof parentHash === 'bigint' ? Number((parentHash ^ (parentHash >> 32n)) & 0xffffffffn) : parentHash
  return (h ^ depth) >>> 0
}

// ═════════════════════════════ Référence S0 : vue honnête et ordre des tours (§6.1, view.ts, timeline.ts) ═════════════════════════════

/** Même test que runner.ts (`cannotPlay`, `preventsFight`) : le combattant joue-t-il le tour qui commence ? */
export function canPlay(engine: Engine, f: Fighter): boolean {
  return f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
}

/** Piège visible pour l'équipe `team` (poseur allié ou piège visible). */
function trapKnownBy(fight: FightState, t: Trap, team: TeamId): boolean {
  return t.visible || (t.team ?? fight.fighters[t.sourceId]?.team) === team
}

/**
 * Ordre public des `n` prochains créneaux après le combattant courant (exclu), tours de jeu suivants compris
 * (les morts sont sautés ; les invocations à venir sont inconnues). Logique de `Engine.nextTurn` (skipTurns, tour annulé).
 */
export function forecastSlots(engine: Engine, fight: FightState, n: number): SlotForecast[] {
  const out: SlotForecast[] = []
  const tl = fight.timeline
  if (!tl.length || n <= 0) return out
  let round = Math.max(1, fight.round)
  let idx = fight.turnIndex
  for (let guard = 0; out.length < n && guard < tl.length * (n + 2); guard++) {
    idx++
    if (idx >= tl.length) {
      idx = 0
      round++
    }
    const f = fight.fighters[tl[idx]]
    if (!f || !f.alive) continue
    const passes = engine.passesTurn(f) || !canPlay(engine, f) || ((f.tags.skipTurns as number | undefined) ?? 0) > 0
    out.push({ round, index: idx, fighterId: f.id, team: f.team, isPlayer: f.kind === 'player', isSummon: f.summonerId !== undefined, passes })
  }
  return out
}

/**
 * Vue honnête de `me` sur `fight`. Référence S0 pour les pièges (invisibles adverses exclus) et l'ordre des tours ;
 * BOUCHON pour `visible()` — TODO(WP1, view.ts) : les invisibles adverses y sont encore à leur VRAIE case (fuite
 * d'information) au lieu de leur dernière case connue.
 */
export function createView(engine: Engine, fight: FightState, me: Fighter, seed: number): AIView {
  return {
    engine,
    fight,
    me,
    team: me.team,
    seed,
    visible: () => fight.fighters.filter(f => f.alive),
    knownTraps: () => fight.traps.filter(t => trapKnownBy(fight, t, me.team)),
    upcoming: (n: number) => forecastSlots(engine, fight, n),
  }
}

// ═════════════════════════════ Référence S0 : clones et avance du temps (§6.1, sim.ts) ═════════════════════════════

/**
 * Clone « vu par `view.team` » : record = false, rollMode 'average', pièges cachés adverses retirés,
 * `rngState = mix32(view.seed ^ 0x5bd1e995, salt)` (jamais l'état réel : l'IA ne lit pas les dés futurs).
 * `options.seed` du clone est remplacé par cette même graine IA : avec E1 (`rngRekey: 'perTurn'`), les débuts de tour
 * simulés (rollouts, `advanceUntil`) re-sèment depuis la graine IA et non depuis la graine du vrai combat, qui
 * donnerait exactement les dés réels des tours futurs.
 */
export function simClone(view: AIView, parent: FightState, salt: number): FightState {
  const c = view.engine.cloneFight(parent, false)
  c.options.rollMode = 'average'
  c.rngState = mix32(view.seed ^ 0x5bd1e995, salt) | 0
  c.options.seed = c.rngState
  c.traps = c.traps.filter(t => trapKnownBy(c, t, view.team))
  return c
}

/**
 * Applique une macro-action EN PLACE sur `s` (cloner avant) et renvoie `s`, ou null si le chemin est interrompu
 * (tacle, piège, case occupée) avant un lancer prévu, ou si un lancer échoue.
 */
export function applyMacro(engine: Engine, s: FightState, meId: number, m: MacroAction): FightState | null {
  const me = s.fighters[meId]
  if (!me || !me.alive) return null
  const actions = toActions(m)
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]
    if (s.ended) return s // combat terminé par une action précédente : macro aboutie
    if (!me.alive) return null
    if (a.type === 'move') {
      const steps = move(s, me, a.path, engine)
      if (steps !== a.path.length - 1 && actions.slice(i + 1).some(x => x.type === 'cast')) return null
    } else if (a.type === 'cast') {
      if (!castSpell(engine, s, me, a.spellId, a.cell).ok) return null
    }
  }
  return s
}

/**
 * Termine le tour courant puis joue les tours suivants (contrôleurs fournis) jusqu'à ce que `stop(next)` soit vrai au
 * début du tour de `next` (renvoyé, tour commencé mais non joué), la fin du combat ou `maxTurns` (undefined).
 * Même enchaînement que `runFight` (runner.ts) : test de parité T-parity (§16.1).
 */
export function advanceUntil(engine: Engine, s: FightState, controllers: ControllerProvider,
                             stop: (next: Fighter) => boolean, maxTurns = 64): Fighter | undefined {
  const cur = engine.current(s)
  if (cur && cur.alive && !s.ended) engine.endTurn(s, cur)
  for (let i = 0; i < maxTurns && !s.ended; i++) {
    const f = engine.nextTurn(s)
    if (!f) return undefined
    if (stop(f)) return f
    if (canPlay(engine, f)) controllers(f).playTurn(engine, s, f)
    if (!s.ended && f.alive) engine.endTurn(s, f)
    else if (!s.ended) engine.emit(s, { t: 'turnEnd', fighter: f.id })
  }
  return undefined
}

// ═════════════════════════════ Référence S0 : budget en nœuds (§6.8, budget.ts) ═════════════════════════════

class CountingBudget implements NodeBudget {
  used = 0
  constructor(readonly max: number) {}
  spend(n = 1): void {
    this.used += n
  }
  exhausted(): boolean {
    return this.used >= this.max
  }
  remaining(): number {
    return Math.max(0, this.max - this.used)
  }
}

export function createNodeBudget(max: number): NodeBudget {
  return new CountingBudget(max)
}

// ═════════════════════════════ Référence S0 : transpositions et empreintes (§6.8, hash.ts) ═════════════════════════════

/** FNV-1a d'un entier 32 bits (4 octets, petit-boutiste). */
function fnvInt(h: number, x: number): number {
  x |= 0
  h = Math.imul(h ^ (x & 0xff), 0x01000193)
  h = Math.imul(h ^ ((x >>> 8) & 0xff), 0x01000193)
  h = Math.imul(h ^ ((x >>> 16) & 0xff), 0x01000193)
  return Math.imul(h ^ (x >>> 24), 0x01000193)
}

/** Empreinte d'un enregistrement `Record<string, number>` (relances, lancers du tour), dans l'ordre des clés triées. */
function fnvRecord(h: number, r: Readonly<Record<string, number>>): number {
  for (const k of Object.keys(r).sort()) if (r[k]) h = fnvInt(fnvInt(h, Number(k)), r[k])
  return h
}

/**
 * Empreinte des buffs, INDÉPENDANTE de leur ordre et de leurs uid (somme commutative) : deux ordres de lancers
 * indépendants produisent les mêmes buffs avec des uid différents.
 */
function buffsDigest(f: Fighter, seed: number): number {
  let sum = 0
  for (const b of f.buffs) {
    let h = fnvInt(seed, b.sourceId)
    h = fnvInt(h, b.spellId)
    h = fnvInt(h, b.effect.effectId)
    h = fnvInt(h, Math.round(b.value * 100))
    h = fnvInt(h, b.remaining)
    h = fnvInt(h, b.delay)
    sum = (sum + h) | 0
  }
  return sum
}

/**
 * Empreinte d'un combattant (repli de E4 quand `rev` n'est pas disponible) : case, vie, caractéristiques, buffs/états.
 * Égalité ⇒ (sauf collision) mêmes caractéristiques, buffs et case.
 */
export function fighterDigest(f: Fighter): number {
  let h = fnvInt(0x811c9dc5, f.id)
  h = fnvInt(h, f.alive ? f.cell : -2)
  h = fnvInt(h, f.maxHp)
  h = fnvInt(h, buffsDigest(f, 0x9747b28c))
  for (const st of f.states) h = fnvInt(h, st)
  const stats = f.stats as unknown as Record<string, number>
  for (const k in stats) h = fnvInt(h, Math.round(stats[k] * 100))
  return h >>> 0
}

/**
 * Hash d'un état pour les transpositions de la recherche (§6.8) : FNV-1a 2 × 32 bits sur chaque combattant vivant
 * (case, PV par paliers de 10, bouclier, PA et PM × 100, buffs sans uid ni ordre, relances, lancers du tour) + marques
 * (sans uid ni ordre) + tour et créneau. Deux ordres de lancers indépendants donnent le même hash.
 * Les morts entrent aussi (id + buffs conservés) : au Vortex, l'heure de mort (états 221-232 lus sur le mort) distingue
 * « glyphe puis kill » de « kill puis glyphe », qu'une fusion de transpositions ne doit pas confondre.
 */
export function stateHash(s: FightState): bigint {
  let a = fnvInt(fnvInt(0x811c9dc5, s.round), s.turnIndex)
  let b = fnvInt(fnvInt(0x050c5d1f, s.round), s.turnIndex)
  for (const f of s.fighters) {
    if (!f.alive) {
      a = fnvInt(fnvInt(a, ~f.id), buffsDigest(f, 0x811c9dc5))
      b = fnvInt(fnvInt(b, ~f.id), buffsDigest(f, 0x050c5d1f))
      continue
    }
    const parts = [f.id, f.cell, Math.floor(f.hp / 10), f.shield, Math.round(f.ap * 100), Math.round(f.mp * 100)]
    for (const x of parts) {
      a = fnvInt(a, x)
      b = fnvInt(b, x)
    }
    a = fnvInt(a, buffsDigest(f, 0x811c9dc5))
    b = fnvInt(b, buffsDigest(f, 0x050c5d1f))
    a = fnvRecord(fnvRecord(a, f.cooldowns), f.castsThisTurn)
    b = fnvRecord(fnvRecord(b, f.cooldowns), f.castsThisTurn)
  }
  let marksA = 0
  let marksB = 0
  for (const m of [...s.glyphs, ...s.traps]) {
    const ha = fnvInt(fnvInt(fnvInt(fnvInt(0x811c9dc5, m.sourceId), m.spellId), m.center), 'remaining' in m ? m.remaining : -1)
    const hb = fnvInt(fnvInt(fnvInt(fnvInt(0x050c5d1f, m.sourceId), m.spellId), m.center), 'remaining' in m ? m.remaining : -1)
    marksA = (marksA + ha) | 0
    marksB = (marksB + hb) | 0
  }
  a = fnvInt(a, marksA)
  b = fnvInt(b, marksB)
  return (BigInt(a >>> 0) << 32n) | BigInt(b >>> 0)
}

// ═════════════════════════════ BOUCHONS S0 — TODO(WP1) ═════════════════════════════

/**
 * BOUCHON S0 — TODO(WP1, reach.ts) : accessibilité SANS tacle (BFS du moteur) ; à remplacer par la recherche typée
 * (case, PM restants) avec tacle déterministe, cases-événements et PM fractionnaires (§6.2).
 */
export function computeReach(view: AIView, s: FightState, f: Fighter,
                             opts?: { mp?: number; ap?: number; allowEventCells?: Set<number> }): ReachInfo {
  const mp = Math.floor(opts?.mp ?? f.mp)
  const ap = opts?.ap ?? f.ap
  const r = reachableCells(s, f, view.engine, mp)
  const cells = new Int16Array(r.cost.size)
  const mpLeft = new Float32Array(CELL_COUNT).fill(-1)
  const apLeft = new Float32Array(CELL_COUNT).fill(-1)
  const prev = new Int16Array(CELL_COUNT).fill(-1)
  let count = 0
  for (const [c, cost] of r.cost) {
    cells[count++] = c
    mpLeft[c] = mp - cost
    apLeft[c] = ap
    const p = r.prev.get(c)
    if (p !== undefined) prev[c] = p
  }
  return { cells, count, mpLeft, apLeft, prev, viaEvent: new Uint8Array(CELL_COUNT) }
}

/** Chemin (path[0] = case de départ) vers `to` dans un `ReachInfo`, ou null. */
export function reachPath(reach: ReachInfo, from: number, to: number): number[] | null {
  if (reach.mpLeft[to] < 0) return null
  const path = [to]
  let c = to
  for (let guard = 0; c !== from && guard < CELL_COUNT; guard++) {
    c = reach.prev[c]
    if (c < 0) return null
    path.unshift(c)
  }
  return path
}

/** BOUCHON S0 — TODO(WP1, spellProfile.ts) : profil minimal (géométrie, coûts, couverture E5) sans analyse des effets. */
export function createSpellProfileIndex(engine: Engine): SpellProfileIndex {
  const cache = new WeakMap<SpellLevelData, SpellProfile>()
  const of = (level: SpellLevelData): SpellProfile => {
    let p = cache.get(level)
    if (p) return p
    const all = [...level.effects, ...level.criticalEffects]
    const damaging = all.some(e => e.element >= 0 && e.element <= 4)
    p = {
      spellId: level.spellId, apCost: level.apCost, minRange: level.minRange, maxRange: level.range,
      los: level.castTestLos, line: level.castInLine, diagonal: level.castInDiagonal,
      castsPerTurn: level.maxCastPerTurn, castsPerTarget: level.maxCastPerTarget, cooldown: level.minCastInterval,
      damage: [], apRemoval: 0, mpRemoval: 0, dodgeable: false, displacement: [], heal: 0, shield: 0, appliesStates: [],
      requiresStates: level.statesCondition, summons: [], glyph: false, trap: false,
      selfBuff: false, allyBuff: false, enemyDebuff: false, dispel: false,
      cat: damaging ? 'damage' : 'utility',
      hasRandomGroups: all.some(e => e.random > 0), hasTriggers: all.some(e => !isInstant(e)),
      analyticCoverage: 0,
      unsupported: !isSpellSupported(engine, level),
    }
    cache.set(level, p)
    return p
  }
  return { of, ofFighter: f => f.spells.map(s => of(s.level)) }
}

/** BOUCHON S0 — TODO(WP1, dpt.ts) : DPT nul. */
export function createDptTable(_engine: Engine): DptTable {
  return { dpt: () => 0, dptVariance: () => 0, calibration: () => 1 }
}

/** BOUCHON S0 — TODO(WP1, threat.ts) : menace nulle (§6.5). */
export function buildThreat(_view: AIView, _s: FightState, _side: TeamId, _p: Perception, _scenario?: ScenarioAIModel): ThreatModel {
  return { sync() {}, incoming: () => 0, cellIncoming: () => 0, deathRisk: () => 0, threatOf: () => 0, predictedTarget: () => undefined }
}

/** BOUCHON S0 — TODO(WP1, potential.ts) : potentiel nul (§6.6). */
export function buildPotential(_view: AIView, _s: FightState, _p: Perception, _scenario?: ScenarioAIModel): PotentialModel {
  return { sync() {}, potential: () => 0, bestTarget: () => undefined }
}

/** BOUCHON S0 — TODO(WP1) : perception neutre (DPT 0, menace 0, potentiel 0, profils minimaux). */
export function createPerception(view: AIView, _cfg: AIConfig, scenario?: ScenarioAIModel): Perception {
  const p: Perception = {
    dpt: createDptTable(view.engine),
    profiles: createSpellProfileIndex(view.engine),
    threat: undefined as unknown as ThreatModel,
    potential: undefined as unknown as PotentialModel,
    sync(s: FightState) {
      p.threat.sync(s)
      p.potential.sync(s)
    },
  }
  p.threat = buildThreat(view, view.fight, view.team, p, scenario)
  p.potential = buildPotential(view, view.fight, p, scenario)
  return p
}

/**
 * Φ((mean − hpEff)/σ) (§6.7). BOUCHON S0 — TODO(WP1, kill.ts) : approximation rationnelle provisoire
 * (tanh de Padé, sans `Math.exp`, §13.3), à calibrer (T-kill).
 */
export function killProbability(mean: number, variance: number, hpEff: number): number {
  if (variance <= 0) return mean >= hpEff ? 1 : 0
  const x = (mean - hpEff) / Math.sqrt(variance)
  const y = 0.7978845608 * (x + 0.044715 * x * x * x)
  const t = y >= 3 ? 1 : y <= -3 ? -1 : (y * (27 + y * y)) / (27 + 9 * y * y)
  return Math.max(0, Math.min(1, 0.5 * (1 + t)))
}

/** BOUCHON S0 — TODO(WP1, kill.ts) : aucun kill analytique. */
export function canKillNow(_view: AIView, me: Fighter, _target: Fighter): KillEstimate {
  return { p: 0, apNeeded: 0, spells: [], castCell: me.cell }
}

/**
 * Split léthal (§6.7) de la macro-action `m` de `meId` sur la victime `victimId`, depuis `parent` (non modifié), clones
 * salés par `salt`. BOUCHON S0 — TODO(WP1, kill.ts) : renvoie null (« pas de split » : l'appelant garde
 * l'approximation analytique, comme en `fast`). Cible : 2 nœuds ('min', 'max'), voir `LethalSplit`.
 */
export function lethalSplit(_view: AIView, _parent: FightState, _meId: number, _m: MacroAction, _victimId: number,
                            _salt: number): LethalSplit | null {
  return null
}

/**
 * BOUCHON S0 — TODO(WP1, value.ts) : V(s) réduite aux PV (enemyLife = −Σ PV effectifs ennemis, allyLife = Σ PV +
 * 0,8·bouclier alliés), du point de vue de `view.team`. Termes de menace, potentiel, scénario… à 0.
 */
export function valueOf(view: AIView, s: FightState, _p: Perception,
                        _opts?: { root?: FightState; scenario?: ScenarioAIModel; bb?: Blackboard }): EvalBreakdown {
  let enemyLife = 0
  let allyLife = 0
  for (const f of s.fighters) {
    if (!f.alive) continue
    if (f.team === view.team) allyLife += f.hp + 0.8 * f.shield
    else enemyLife -= f.hp + 0.9 * f.shield
  }
  return {
    total: enemyLife + allyLife, enemyLife, kills: 0, allyLife, erosion: 0, allyDeath: 0, incoming: 0, pendingDot: 0,
    control: 0, potential: 0, continuation: 0, resources: 0, position: 0, scenario: 0,
  }
}

/**
 * Préfiltre `quick` (§8.1, sans clone, ≤ 1,5 µs) : estimation analytique (PVe) d'une macro-action, utilisée seulement
 * pour TRIER les candidats avant simulation (test T-prefilter). BOUCHON S0 — TODO(WP1, candidates.ts) : `m.prior`.
 */
export function quickEstimate(_view: AIView, _s: FightState, _me: Fighter, m: MacroAction, _p: Perception,
                              _opts?: { bb?: Blackboard; scenario?: ScenarioAIModel }): number {
  return m.prior
}

/**
 * BOUCHON S0 — TODO(WP1, candidates.ts) : lancers depuis la case actuelle sur les cases occupées (pas de centres de
 * zone, de cases libres ni de chemins), catégorie grossière, prior 0.
 */
export function generateCasts(view: AIView, s: FightState, me: Fighter): MacroAction[] {
  const out: MacroAction[] = []
  const profiles = createSpellProfileIndex(view.engine)
  for (const sp of me.spells) {
    const prof = profiles.of(sp.level)
    for (const f of s.fighters) {
      if (!f.alive || f.cell < 0) continue
      if (canCast(view.engine, s, me, sp, f.cell) !== null) continue
      const cat: CandidateCat = prof.cat
      out.push({ cast: { spellId: sp.spellId, cell: f.cell }, cat, prior: 0, key: `${sp.spellId}:${f.cell}:${me.cell}` })
    }
  }
  return out
}

/** Chemin vers une case atteignable (BFS du moteur) — utilitaire des bouchons. */
export function simplePath(engine: Engine, s: FightState, f: Fighter, to: number): number[] | null {
  return pathTo(reachableCells(s, f, engine), f.cell, to)
}
