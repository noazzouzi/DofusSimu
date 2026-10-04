/**
 * Mise en place et règles « serveur » de l'Œil de Vortex (docs/design/ai.md §12.1) — WP3.
 *
 * Le moteur exécute les sorts du donjon (Vortexiphan 5006, Glyphe téléporteur 5002, Décalage horaire 4996, 780…) ;
 * ce module n'ajoute que ce que les données ne portent pas, en lisant ses paramètres dans `fight.scenarioState.vortex` :
 *
 *  | Règle | Implémentation |
 *  |---|---|
 *  | carte, cases de départ | `createVortexFight` : carte 143393281, personnages sur les cases rouges (placement fourni ou
 *  |   | `defaultVortexPlacement`), vague 1 = Vortex + (N − 1) monstres sur les cases bleues |
 *  | sorts de départ | Vortexiphan (Auroraire, Marginal, déclencheurs) puis 5002 de chaque monstre (`castStartingSpell`) |
 *  | équipe qui commence | `rebuildTimeline(startingTeamRule)` après les sorts de départ (aucun tour n'a commencé) |
 *  | vagues | `spawnVortexWave` au début du tour de jeu `arrivalRounds[w]` (ou plus tôt si `earlySpawnIfCleared`) |
 *  | invulnérabilité d'arrivée | état 56 jusqu'au début du tour `arrivée + arrivalInvulnerableTurns` (waves.ts) |
 *  | déverrouillage | délais des données (5008, Marginal 25 tours) décalés de `unlockVortexTurn − 25` ; *Action !* (5060)
 *  |   | lancé par le scénario au début du tour du Vortex : tour ≥ `unlockVortexTurn`, Vortex non Marginal, tous les
 *  |   | monstres corrompus depuis ≥ `actionDelay` tours du Vortex (le déclencheur 5060 des données est retiré) |
 *  | résurrections | après les déclencheurs du Vortex : PV `rezHpPct` (si ≠ jet des données 20-30 %), −1 PM de 5003
 *  |   | retiré si `rezMinusOneMp` est faux, `rezAllPerTurn` via `summonOptions.reviveAllInArea` le temps du tour |
 *  | horloge et joueur mort | variante `deadPlayerAdvancesClock` : l'Auroraire lance 4996 au créneau du mort (clock.ts) |
 *  | glyphes | variante `glyphTrigger = 'turnEnd'` : glyphes 5011 posés convertis en glyphes de fin de tour |
 *  | heure de mort (repli) | `markDeathHour` : si la chaîne des données 5001 → 5000 n'a pas posé l'état d'heure sur le
 *  |   | mort (défaut du moteur constaté, voir le rapport WP3a), le scénario le pose (même effet que 5000) |
 *
 * Les hooks (`ScenarioHooks`) ne reçoivent pas le moteur : `createVortexFight` enregistre le moteur du combat
 * (clé = tableau `spells` du Vortex, partagé par tous les clones du combat ; repli : la carte).
 */
import { castSubSpell } from '../../engine/effects/core'
import { castStartingSpell, summonOptions } from '../../engine/effects/summons'
import type { Engine } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import { roll } from '../../engine/random'
import type { EffectData, MapData } from '../../data/model'
import type { Buff, Fighter, FightState, ScenarioHooks } from '../../engine/types'
import type { FightSetupOptions } from '../types'
import {
  addArrivalInvulnerability,
  expireArrivalInvulnerability,
  hasStartingSpell,
  rebuildTimeline,
  spawnWave,
} from '../waves'
import {
  canonicalPos,
  currentHour,
  hourOf,
  isClockPlayer,
  isCorrupted,
  isWaveMonster,
  pendingDeadTicks,
  auroraireOf,
} from './clock'
import {
  AURORAIRE,
  BLUE_START_CELLS,
  HOUR_STATE_BASE,
  MARGINAL,
  RED_START_CELLS,
  ROMAN,
  SPELL,
  VORTEX,
  VORTEX_MAP_ID,
  VORTEX_SCENARIO_ID,
  VORTEX_STATE_KEY,
  WAVE_COUNT,
  waveComposition,
  type VortexParams,
} from './constants'
import { DATA_REZ_HP_PCT, ENGINE_UNLOCK_TURN, patchVortexState, resolveVortexParams, variantKey, vortexState, type VortexState } from './params'
import { defaultVortexPlacement } from './placement'

/**
 * Ordre de remplissage des cases bleues (vague 1 hors Vortex, vagues suivantes) : monstres répartis sur la ligne
 * plutôt que collés — INCERTAIN (positions réelles non documentées).
 */
export const BLUE_SPAWN_ORDER: readonly number[] = [270, 274, 268, 276, 272, 269, 275, 271, 273, 277]

// ───────────────────────────── moteur du combat (les hooks ne le reçoivent pas) ─────────────────────────────

const ENGINE_BY_SPELLS = new WeakMap<object, Engine>()
const ENGINE_BY_MAP = new WeakMap<MapData, Engine>()

/** Moteur qui a créé ce combat (ou un combat dont il est le clone). */
export function engineOf(fight: FightState): Engine | undefined {
  const vx = vortexState(fight)
  const v = vx ? fight.fighters[vx.vortexId] : undefined
  return (v && ENGINE_BY_SPELLS.get(v.spells)) ?? ENGINE_BY_MAP.get(fight.map)
}

function registerEngine(engine: Engine, fight: FightState, vortex: Fighter): void {
  ENGINE_BY_SPELLS.set(vortex.spells, engine)
  ENGINE_BY_MAP.set(fight.map, engine)
}

// ───────────────────────────── création du combat ─────────────────────────────

/** Variante : clé lisible ajoutée à l'état (paramètres INCERTAINS différents du défaut). */
export interface VortexFightExtras {
  /** Clé de variante imposée (sinon calculée depuis les paramètres). */
  variant?: string
}

/**
 * Crée un combat du Vortex sur `engine` (créé avec `vortexScenario.hooks`) : voir l'en-tête. `team` : personnages
 * (équipe 0) dans l'ordre de `o.placement`. N (monstres par vague) = nombre de personnages.
 */
export function createVortexFight(engine: Engine, team: Fighter[], o: FightSetupOptions, extras: VortexFightExtras = {}): FightState {
  if (engine.scenario?.id !== VORTEX_SCENARIO_ID) {
    throw new Error('Le moteur doit être créé avec les hooks du scénario Vortex : createEngine(data, vortexScenario.hooks)')
  }
  if (!team.length) throw new Error('Équipe vide')
  const map = engine.data.map(VORTEX_MAP_ID)
  if (!map) throw new Error(`Carte du Vortex ${VORTEX_MAP_ID} absente des données`)
  const p = resolveVortexParams({ ...o.params, players: team.length })
  const placement = o.placement ?? defaultVortexPlacement(team, p)
  checkPlacement(map, placement, team.length)
  team.forEach((f, i) => {
    f.team = 0
    f.cell = placement[i]
    f.tags.startCell = f.cell
  })
  // Vague 1 : Vortex (case `vortexCell`) + (N − 1) monstres sur les cases bleues.
  const wave1 = waveComposition(p.players)[0]
  const blue = BLUE_SPAWN_ORDER.filter(c => c !== p.vortexCell)
  let bi = 0
  const monsters = wave1.map(monsterId => {
    const boss = monsterId === VORTEX
    const cell = boss ? p.vortexCell : blue[bi++ % blue.length]
    const m = createMonsterFighter(engine.data, { monsterId, grade: boss ? p.bossGrade : p.monsterGrade, team: 1, cell })
    m.wave = 1
    m.tags.startCell = cell
    return m
  })
  const vortex = monsters.find(m => m.monsterId === VORTEX)
  if (!vortex) throw new Error('La vague 1 doit contenir le Vortex')
  const fight = engine.createFight({
    map,
    fighters: [...team, ...monsters],
    options: { seed: o.seed, rollMode: o.rollMode, record: o.record, maxRounds: p.maxRounds, rngRekey: o.rngRekey },
    scenarioId: VORTEX_SCENARIO_ID,
  })
  const state: VortexState = {
    ...p,
    vortexId: vortex.id,
    auroraireId: -1,
    wavesSpawned: 1,
    waveRounds: [1],
    slotOrder: [],
    startCells: team.map(f => f.cell),
    clockTicks: [],
    rezPending: [],
    vortexTurns: 0,
    allCorruptSince: 0,
    actionRound: 0,
    corruptedByRound: [],
    variant: extras.variant ?? variantKey(o.params),
    startingSpellFailures: [],
  }
  fight.scenarioState[VORTEX_STATE_KEY] = state
  registerEngine(engine, fight, vortex)
  installVortexEngineHooks(engine)
  engine.emit(fight, { t: 'wave', index: 1, total: WAVE_COUNT, fighters: [] })
  engine.log(fight, `Œil de Vortex — variante : ${state.variant} ; ${p.players} personnage(s), vagues aux tours ${p.arrivalRounds.join(', ')}.`)
  // Sorts de départ : le Vortex d'abord (l'Auroraire doit exister), puis les monstres.
  const failures: number[] = []
  for (const m of [vortex, ...monsters.filter(x => x !== vortex)]) {
    if (hasStartingSpell(engine, m) && !castStartingSpell(engine, fight, m)) failures.push(m.id)
  }
  const aur = fight.fighters.find(f => f.alive && f.monsterId === AURORAIRE && f.summonerId === vortex.id)
  if (!aur) engine.log(fight, 'Vortexiphan n’a pas invoqué l’Auroraire : horloge absente.', 'warn')
  shiftUnlock(engine, fight, vortex, p.unlockVortexTurn - ENGINE_UNLOCK_TURN)
  if (p.wave1Invulnerable && p.arrivalInvulnerableTurns > 0) {
    for (const m of monsters) if (m !== vortex) addArrivalInvulnerability(engine, fight, m, 1 + p.arrivalInvulnerableTurns)
  }
  rebuildTimeline(engine, fight, p.startingTeamRule)
  patchVortexState(fight, {
    auroraireId: aur?.id ?? -1,
    slotOrder: fight.timeline.filter(id => fight.fighters[id].summonerId === undefined),
    startingSpellFailures: failures,
  })
  if (failures.length) engine.log(fight, `Sorts de départ non lancés : ${failures.map(id => fight.fighters[id].name).join(', ')}`, 'warn')
  return fight
}

function checkPlacement(map: MapData, placement: readonly number[], n: number): void {
  if (placement.length < n) throw new Error(`Placement incomplet : ${placement.length} case(s) pour ${n} personnage(s)`)
  const seen = new Set<number>()
  for (const c of placement.slice(0, n)) {
    if (!map.cells[c]?.walkable) throw new Error(`Case de départ ${c} non marchable`)
    if (seen.has(c)) throw new Error(`Case de départ ${c} attribuée deux fois`)
    if (BLUE_START_CELLS.includes(c)) throw new Error(`Case de départ ${c} : case bleue (réservée aux monstres)`)
    seen.add(c)
  }
  void RED_START_CELLS
}

/**
 * Décale le déverrouillage des données : délai de 5008 et durée de Marginal (5006) de `delta` tours du Vortex ; retire
 * le déclencheur différé de 5060 (*Action !* est lancé par le scénario, `vortexTurnStart`).
 */
function shiftUnlock(engine: Engine, fight: FightState, vortex: Fighter, delta: number): void {
  for (const b of vortex.buffs.slice()) {
    if (b.spellId !== SPELL.VORTEXIPHAN) continue
    if (b.kind === 'delayed' && b.effect.diceNum === SPELL.ACTION) {
      engine.removeBuff(fight, vortex, b.uid)
      continue
    }
    if (!delta) continue
    if (b.kind === 'delayed' && b.effect.diceNum === SPELL.VORTEXIPHAN_UNLOCK) {
      b.delay = Math.max(1, b.delay + delta)
      b.remaining = Math.max(1, b.remaining + delta)
    } else if (b.stateId === MARGINAL && b.remaining > 0) {
      b.remaining = Math.max(1, b.remaining + delta)
    }
  }
}

// ───────────────────────────── vagues ─────────────────────────────

/** Tous les monstres de vague apparus sont-ils corrompus (au moins un apparu) ? */
export function allWaveMonstersCorrupted(fight: FightState): boolean {
  let n = 0
  for (const f of fight.fighters) {
    if (!isWaveMonster(f)) continue
    n++
    if (!isCorrupted(f)) return false
  }
  return n > 0
}

/** Monstres de vague corrompus (vivants ou morts). */
export function corruptedCount(fight: FightState): number {
  let n = 0
  for (const f of fight.fighters) if (isWaveMonster(f) && isCorrupted(f)) n++
  return n
}

/** Fait apparaître la vague `w` (2..5) au tour courant (composition N = `players`). */
export function spawnVortexWave(engine: Engine, fight: FightState, w: number): Fighter[] {
  const vx = vortexState(fight)
  if (!vx || w < 2 || w > WAVE_COUNT) return []
  const specs = waveComposition(vx.players)[w - 1].map(monsterId => ({ monsterId, grade: vx.monsterGrade }))
  const until = vx.arrivalInvulnerableTurns > 0 ? fight.round + vx.arrivalInvulnerableTurns : undefined
  const res = spawnWave(engine, fight, specs, { team: 1, wave: w, total: WAVE_COUNT, cells: BLUE_SPAWN_ORDER, invulnerableUntilRound: until })
  // Ordre canonique : chaque arrivant après la racine qui le précède dans la timeline.
  const order = vx.slotOrder.slice()
  for (const f of res.fighters) {
    const at = fight.timeline.indexOf(f.id)
    let pos = 0
    for (let i = at - 1; i >= 0; i--) {
      const k = order.indexOf(fight.timeline[i])
      if (k >= 0) {
        pos = k + 1
        break
      }
    }
    order.splice(pos, 0, f.id)
  }
  patchVortexState(fight, {
    wavesSpawned: w,
    waveRounds: [...vx.waveRounds, fight.round],
    slotOrder: order,
    startingSpellFailures: res.startingSpellFailures.length ? [...vx.startingSpellFailures, ...res.startingSpellFailures] : vx.startingSpellFailures,
  })
  engine.log(fight, `Vague ${w}/${WAVE_COUNT} : ${res.fighters.map(f => f.name).join(', ')}${until ? ' (invulnérables ce tour)' : ''}.`, 'warn')
  return res.fighters
}

// ───────────────────────────── règles des hooks ─────────────────────────────

/** Début d'un tour de jeu (`onRoundStart`) : cumul des corrompus, fin d'invulnérabilité d'arrivée, tics des morts, vagues. */
export function vortexRoundStart(fight: FightState): void {
  const vx = vortexState(fight)
  const engine = engineOf(fight)
  if (!vx || !engine) return
  if (fight.round > 1) patchVortexState(fight, { corruptedByRound: [...vx.corruptedByRound, corruptedCount(fight)] })
  expireArrivalInvulnerability(engine, fight)
  if (vx.deadPlayerAdvancesClock && fight.round > 1) tickDeadPlayers(engine, fight, fight.round - 1, Infinity)
  if (vx.wavesSpawned < WAVE_COUNT && vx.actionRound === 0) {
    const next = vx.wavesSpawned + 1
    const due = fight.round >= vx.arrivalRounds[next - 1]
    const early = vx.earlySpawnIfCleared && allWaveMonstersCorrupted(fight)
    if (due || early) spawnVortexWave(engine, fight, next)
  }
}

/** Début de tour d'un combattant (`onTurnStart`, AVANT ses déclencheurs TB) : tics des personnages morts (variante). */
export function vortexTurnStartPre(fight: FightState, f: Fighter): void {
  const vx = vortexState(fight)
  if (!vx || !vx.deadPlayerAdvancesClock) return
  const engine = engineOf(fight)
  if (!engine) return
  const pos = canonicalPos(fight, vx.slotOrder, f)
  tickDeadPlayers(engine, fight, fight.round, pos < 0 ? 0 : pos)
  if (f.alive && isClockPlayer(f)) {
    const t = vortexState(fight)!.clockTicks.slice()
    t[f.id] = fight.round
    patchVortexState(fight, { clockTicks: t })
  }
}

/** Variante : l'Auroraire avance d'une heure pour chaque personnage mort dont le créneau est passé (clock.ts). */
function tickDeadPlayers(engine: Engine, fight: FightState, round: number, beforePos: number): void {
  const vx = vortexState(fight)!
  const ids = pendingDeadTicks(fight, vx.slotOrder, vx.clockTicks, round, beforePos)
  if (!ids.length) return
  const t = vx.clockTicks.slice()
  for (const id of ids) t[id] = round
  patchVortexState(fight, { clockTicks: t })
  const aur = auroraireOf(fight)
  if (!aur) return
  for (const id of ids) {
    if (fight.ended) return
    engine.log(fight, `Créneau de ${fight.fighters[id].name} (mort) : l'horloge avance.`)
    castSubSpell(engine, fight, aur, SPELL.DECALAGE_HORAIRE, 1, aur.cell, false, 0)
  }
}

/**
 * Mort d'un monstre de vague (`onDeath`) : repli du marquage de l'heure de mort. Les données (5002 X → 5001 → 5000)
 * posent l'état de l'heure courante sur le mourant ; si le moteur ne l'a pas fait (défaut constaté), le scénario le
 * pose (état 221..232, durée infinie, « désenvoûtement fort » : conservé à la mort). Rien pour un corrompu
 * (tué par *Action !*) ni après *Action !*.
 */
export function markDeathHour(fight: FightState, f: Fighter): void {
  const vx = vortexState(fight)
  if (!vx || vx.actionRound > 0 || !isWaveMonster(f) || isCorrupted(f)) return
  const engine = engineOf(fight)
  const aur = auroraireOf(fight)
  if (!engine || !aur) return
  const h = hourOf(aur)
  if (!h || f.states.includes(HOUR_STATE_BASE + h)) return
  engine.addBuff(fight, f, {
    sourceId: aur.id,
    spellId: SPELL.GLYPHE_MARK_HOUR,
    effect: hourStateEffect(engine, h),
    value: HOUR_STATE_BASE + h,
    remaining: -1,
    delay: 0,
    dispellable: false,
    stateId: HOUR_STATE_BASE + h,
    kind: 'stat',
    label: `Heure de mort : ${ROMAN[h]}`,
  })
}

/** Effet 950 de 5000 pour l'heure `h` (données ; synthétique si absent). */
function hourStateEffect(engine: Engine, h: number): EffectData {
  const lvl = engine.data.spellLevel(SPELL.GLYPHE_MARK_HOUR, { grade: 1 })
  const e = lvl?.effects.find(x => x.effectId === 950 && x.value === HOUR_STATE_BASE + h)
  return (
    e ?? {
      effectId: 950, order: 0, diceNum: 0, diceSide: 0, value: HOUR_STATE_BASE + h, duration: -1, delay: 0, random: 0, group: 0,
      targetMask: 'a', targetId: 0, triggers: 'I', dispellable: 3, element: -1,
      zone: { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
    }
  )
}

/** Fin de combat (`checkEnd`) : victoire à la mort du Vortex, défaite quand plus aucun personnage n'est vivant. */
export function vortexCheckEnd(fight: FightState): 0 | 1 | null | undefined {
  const vx = vortexState(fight)
  if (!vx) return undefined
  const engine = engineOf(fight)
  const vortex = fight.fighters[vx.vortexId]
  if (vortex && !vortex.alive) {
    engine?.endFight(fight, 0, 'Le Vortex est vaincu')
    return 0
  }
  if (!fight.fighters.some(f => f.alive && f.team === 0 && f.kind === 'player')) {
    engine?.endFight(fight, 1, 'Tous les personnages sont morts')
    return 1
  }
  return null
}

// ───────────────────────────── crochet moteur : début de tour du Vortex ─────────────────────────────

const INSTALLED = new WeakSet<Engine>()

/**
 * Installe (une fois par moteur) l'enveloppe du début de tour : autour des déclencheurs TB du Vortex (résurrections,
 * 5008) et après ceux des monstres (glyphes). Même mécanisme que les familles d'effets (`engine.hooks`, chaînés).
 */
export function installVortexEngineHooks(engine: Engine): void {
  if (INSTALLED.has(engine)) return
  INSTALLED.add(engine)
  const prev = engine.hooks.onTurnStart
  engine.hooks.onTurnStart = (fight, f) => {
    const vx = vortexState(fight)
    if (!vx) {
      prev?.(fight, f)
      return
    }
    if (f.id === vx.vortexId) {
      vortexTurnStart(engine, fight, f, vx, prev)
      return
    }
    prev?.(fight, f)
    if (vx.glyphTrigger === 'turnEnd' && isWaveMonster(f)) convertGlyphsToTurnEnd(fight, f)
  }
}

function vortexTurnStart(
  engine: Engine,
  fight: FightState,
  vortex: Fighter,
  vx: VortexState,
  prev: ((fight: FightState, f: Fighter) => void) | undefined,
): void {
  const dead = fight.fighters.filter(m => isWaveMonster(m) && !m.alive).map(m => m.id)
  patchVortexState(fight, { rezPending: dead })
  const saved = summonOptions.reviveAllInArea
  summonOptions.reviveAllInArea = vx.rezAllPerTurn
  try {
    prev?.(fight, vortex)
  } finally {
    summonOptions.reviveAllInArea = saved
  }
  const turn = vx.vortexTurns + 1
  patchVortexState(fight, { vortexTurns: turn, rezPending: [] })
  if (fight.ended) return
  for (const id of dead) {
    const m = fight.fighters[id]
    if (m.alive) adjustResurrected(engine, fight, m, vx, vortex)
  }
  const allCorrupt = allWaveMonstersCorrupted(fight) && vx.wavesSpawned >= WAVE_COUNT
  const since = allCorrupt ? vx.allCorruptSince || turn : 0
  patchVortexState(fight, { allCorruptSince: since })
  if (vx.actionRound === 0 && vortex.alive && turn >= vx.unlockVortexTurn && !vortex.states.includes(MARGINAL) && since > 0 && turn - since >= vx.actionDelay) {
    engine.log(fight, `Tous les monstres sont corrompus : Action ! (tour ${turn} du Vortex).`, 'warn')
    patchVortexState(fight, { actionRound: fight.round })
    castSubSpell(engine, fight, vortex, SPELL.ACTION, 1, vortex.cell, false, 0)
  }
}

/** Règles INCERTAINES de la résurrection (5003) appliquées au monstre qui vient d'être ressuscité. */
function adjustResurrected(engine: Engine, fight: FightState, m: Fighter, vx: VortexParams, vortex: Fighter): void {
  const [lo, hi] = vx.rezHpPct
  if (lo !== DATA_REZ_HP_PCT[0] || hi !== DATA_REZ_HP_PCT[1]) {
    const pct = lo === hi ? lo : roll(fight, lo, hi)
    const hp = Math.max(1, Math.min(m.maxHp, Math.floor((m.maxHp * pct) / 100)))
    if (hp > m.hp) engine.emit(fight, { t: 'heal', source: vortex.id, target: m.id, amount: hp - m.hp })
    else if (hp < m.hp) engine.emit(fight, { t: 'damage', source: vortex.id, target: m.id, amount: m.hp - hp, element: -1, kind: 'indirect' })
    m.hp = hp
  }
  const mpBuffs = m.buffs.filter(b => b.spellId === SPELL.VORTEXIPHAN_REZ && b.effect.effectId === 169)
  if (!vx.rezMinusOneMp) {
    for (const b of mpBuffs) engine.removeBuff(fight, m, b.uid)
  } else if (!mpBuffs.length) {
    const e = engine.data.spellLevel(SPELL.VORTEXIPHAN_REZ, { grade: 1 })?.effects.find(x => x.effectId === 169)
    if (e) {
      const b: Omit<Buff, 'uid'> = {
        sourceId: vortex.id, spellId: SPELL.VORTEXIPHAN_REZ, effect: e, value: -1, remaining: -1, delay: 0, dispellable: true,
        statDelta: { mp: -1 }, kind: 'stat', label: '−1 PM (résurrection)',
      }
      engine.addBuff(fight, m, b)
    }
  }
}

/** Variante 'turnEnd' : les glyphes 5011 posées par `f` ce début de tour se déclenchent en fin de tour (marks.ts). */
function convertGlyphsToTurnEnd(fight: FightState, f: Fighter): void {
  for (const g of fight.glyphs) if (g.sourceId === f.id && g.castSpellId === SPELL.GLYPHE_TRIGGER && g.trigger === 'enter') g.trigger = 'turnEnd'
}

/** Heure courante (raccourci pour les journaux). */
export function clockLabel(fight: FightState): string {
  const h = currentHour(fight)
  return h ? ROMAN[h] : '—'
}

// ───────────────────────────── hooks du scénario ─────────────────────────────

/**
 * Hooks « serveur » du Vortex (`createEngine(data, vortexHooks)`). Paramètres et compteurs lus dans
 * `fight.scenarioState.vortex` : une seule instance `Engine` sert toutes les variantes.
 */
export const vortexHooks: ScenarioHooks = {
  id: VORTEX_SCENARIO_ID,
  // E2 : `scenarioState.vortex` est plat (paramètres immuables partagés, tableaux remplacés à chaque écriture).
  cloneState: s => {
    const v = s[VORTEX_STATE_KEY]
    return v && typeof v === 'object' ? { ...s, [VORTEX_STATE_KEY]: { ...(v as object) } } : { ...s }
  },
  onRoundStart: fight => vortexRoundStart(fight),
  onTurnStart: (fight, f) => vortexTurnStartPre(fight, f),
  onDeath: (fight, f) => markDeathHour(fight, f),
  checkEnd: fight => vortexCheckEnd(fight),
}
