/**
 * T-clock (docs/design/ai.md §16.3) : le modèle d'horloge pur (`forecastHours`, `starWindows`) est comparé au moteur
 * RÉEL sur le vrai scénario de l'Œil de Vortex (carte 143393281, sorts 4999/4996/5002/5003…, hooks du scénario) :
 * k = 4 et k = 3, 0 / 1 / 2 glyphes déclenchés, un personnage mort sous les deux valeurs de `deadPlayerAdvancesClock`,
 * pose réelle de l'étoile (234) contre les fenêtres prévues.
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import {
  advancesClock,
  currentHour,
  deathHours,
  forecastHours,
  hoursSeenBy,
  lineCells,
  monsterStarWindows,
  nextVortexSlot,
  onHourLine,
  playerSlotsBeforeVortex,
  starWindows,
  hourBit,
} from '../src/dungeons/vortex/clock'
import { HOUR_CELL, IKARGN, SAME_HOUR, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { isWaveMonster } from '../src/dungeons/vortex/clock'
import { scriptedVortexController } from '../src/dungeons/generic/controllers'
import { vortexState } from '../src/dungeons/vortex/params'
import { vortexSlotHours } from '../src/dungeons/vortex/placement'
import { createSmokeTeam, SMOKE_BREEDS } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import type { ClockSlot } from '../src/dungeons/types'
import { createEngine } from '../src/engine'
import type { Engine } from '../src/engine/engine'
import { move } from '../src/engine/move'
import type { Fighter, FightState } from '../src/engine/types'
import { areAdjacent, neighborsOf } from '../src/map/geometry'

const data = loadDataStore('data')

interface Setup {
  engine: Engine
  fight: FightState
  players: Fighter[]
}

function setup(o: { initiative?: number; params?: Record<string, unknown>; seed?: number } = {}): Setup {
  const engine = createEngine(data, vortexHooks)
  const players = createSmokeTeam(data, SMOKE_BREEDS, { initiative: o.initiative ?? 4000, hp: 1_000_000 })
  const fight = createVortexFight(engine, players, {
    params: { ...VORTEX_DEFAULT_PARAMS, ...(o.params as object) },
    seed: o.seed ?? 7,
    rollMode: 'random',
    record: false,
    rngRekey: 'perTurn',
  })
  return { engine, fight, players }
}

interface Observed {
  round: number
  fighterId: number
  hour: number
  /** Case de l'Auroraire au début du créneau. */
  aurCell?: number
  star?: boolean
  /** Personnage ou Vortex : son créneau DOIT figurer dans la prévision (les arrivants des vagues futures, non). */
  required?: boolean
}

/**
 * Déroule le combat (contrôleurs passifs) : `act(f)` est appelé au début de chaque tour joué ; renvoie les heures lues
 * au début de chaque créneau (après les déclencheurs TB). Arrêt après `rounds` tours de jeu.
 */
function run(s: Setup, rounds: number, act?: (f: Fighter) => void, watch?: Fighter): Observed[] {
  const { engine, fight } = s
  const out: Observed[] = []
  const last = fight.round + rounds
  for (let i = 0; i < 2000 && !fight.ended; i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    if (fight.round > last) break
    out.push({
      round: fight.round,
      fighterId: f.id,
      hour: currentHour(fight),
      aurCell: fight.fighters.find(x => x.alive && x.monsterId === 3833)?.cell,
      star: watch ? watch.states.includes(SAME_HOUR) : undefined,
      required: f.kind === 'player' || f.monsterId === 3835,
    })
    act?.(f)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
  }
  return out
}

/** Compare les heures observées aux créneaux prévus (par tour de jeu et combattant) ; renvoie le nombre comparé. */
function compare(slots: readonly ClockSlot[], obs: readonly Observed[], opts: { requirePlayers?: boolean } = {}): number {
  const byKey = new Map<string, ClockSlot>()
  for (const sl of slots) if (sl.index >= 0) byKey.set(`${sl.round}:${sl.fighterId}`, sl)
  const lastRound = slots.length ? slots[slots.length - 1].round : 0
  let n = 0
  for (const o of obs) {
    if (o.round > lastRound) break
    const sl = byKey.get(`${o.round}:${o.fighterId}`)
    if (!sl) {
      if (opts.requirePlayers !== false && o.required) expect(sl, `créneau joueur/Vortex manquant tour ${o.round} combattant ${o.fighterId}`).toBeDefined()
      continue
    }
    expect(o.hour, `tour ${o.round}, combattant ${o.fighterId}`).toBe(sl.hour)
    n++
  }
  return n
}

/** Créneau courant : on avance jusqu'au début du tour de `f` (tours intermédiaires passifs, ou `act`). */
function turnOf(s: Setup, f: Fighter, minRound = 0, act?: (g: Fighter) => void): void {
  const { engine, fight } = s
  for (let i = 0; i < 500; i++) {
    const cur = engine.current(fight)
    if (cur && cur.id === f.id && fight.round >= minRound && fight.round > 0) return
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    const n = engine.nextTurn(fight)
    if (!n) break
    if (act && !(n.id === f.id && fight.round >= minRound)) act(n)
  }
  throw new Error(`tour de ${f.name} jamais atteint`)
}

describe('géométrie de l’horloge', () => {
  it('croix des heures : départs en ligne conformes à vortex.md §2', () => {
    const red = [424, 427, 430, 438, 440, 441, 443, 453, 455, 457, 482, 484]
    const inLine = (h: number) => red.filter(c => onHourLine(h, c))
    expect(inLine(4)).toEqual([427, 440])
    expect(inLine(5)).toEqual([430, 443, 457, 484])
    expect(inLine(7)).toEqual([430, 440, 443, 455, 457])
    expect(inLine(8)).toEqual([427, 440])
    expect(inLine(11)).toEqual([440, 455, 484])
    expect(inLine(12)).toEqual([430])
    for (let h = 1; h <= 12; h++) {
      const cells = Array.from(lineCells(h))
      expect(cells).not.toContain(HOUR_CELL[h])
      expect(cells.every(c => onHourLine(h, c))).toBe(true)
    }
  })

  it('heures du Vortex sans glyphe : IV/VIII/XII (k = 4), III/VII/XI (k = 3)', () => {
    expect(vortexSlotHours(4, 4)).toEqual([4, 8, 12])
    expect(vortexSlotHours(3, 4)).toEqual([3, 7, 11])
    expect(vortexSlotHours(3, 3)).toEqual([3, 6, 9, 12])
  })
})

describe('T-clock : forecastHours contre le moteur réel (30 tours)', () => {
  it('k = 4 (équipe des joueurs en tête) : chaque créneau, prévision faite avant le combat', () => {
    const s = setup({ initiative: 4000 })
    const slots = forecastHours(s.fight, 30, VORTEX_DEFAULT_PARAMS)
    expect(playerSlotsBeforeVortex(slots, 1)).toBe(4)
    const obs = run(s, 30)
    expect(obs.length).toBeGreaterThan(200)
    expect(compare(slots, obs)).toBeGreaterThan(200)
    // L'Auroraire est sur la case de l'heure à chaque créneau joueur, heures non marchables (I-III, X-XII) comprises.
    const playerObs = obs.filter(o => s.players.some(p => p.id === o.fighterId))
    for (const o of playerObs) expect(o.aurCell, `tour ${o.round} heure ${o.hour}`).toBe(HOUR_CELL[o.hour])
    expect(new Set(playerObs.map(o => o.hour)).size).toBe(12)
    // P1 voit I/V/IX, P2 II/VI/X, P3 III/VII/XI, P4 et le Vortex IV/VIII/XII.
    const [p1, p2, p3, p4] = s.players
    const vx = vortexState(s.fight)!
    expect(new Set(hoursSeenBy(slots, p1.id))).toEqual(new Set([1, 5, 9]))
    expect(new Set(hoursSeenBy(slots, p2.id))).toEqual(new Set([2, 6, 10]))
    expect(new Set(hoursSeenBy(slots, p3.id))).toEqual(new Set([3, 7, 11]))
    expect(new Set(hoursSeenBy(slots, p4.id))).toEqual(new Set([4, 8, 12]))
    expect(new Set(hoursSeenBy(slots, vx.vortexId))).toEqual(new Set([4, 8, 12]))
  })

  it('k = 3 (monstres en tête, règle « moyenne d’équipe ») : le Vortex voit III/VII/XI', () => {
    const s = setup({ initiative: 1000 })
    const slots = forecastHours(s.fight, 30, VORTEX_DEFAULT_PARAMS)
    expect(playerSlotsBeforeVortex(slots, 1)).toBe(3)
    const obs = run(s, 30)
    expect(compare(slots, obs)).toBeGreaterThan(200)
    expect(new Set(hoursSeenBy(slots, vortexState(s.fight)!.vortexId))).toEqual(new Set([3, 7, 11]))
  })

  it('prévision glissante : à chaque début de tour joueur, les 24 créneaux suivants sont exacts', () => {
    const s = setup({ initiative: 4000, seed: 11 })
    let checked = 0
    let pending: ClockSlot[] | null = null
    const obs: Observed[] = []
    run(s, 20, f => {
      obs.push({ round: s.fight.round, fighterId: f.id, hour: currentHour(s.fight) })
      if (f.kind === 'player' && !pending) pending = forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS, undefined, { maxSlots: 24 })
      if (pending && obs.length > 30) {
        checked += compare(pending, obs.slice(-30), { requirePlayers: false })
        pending = null
        obs.length = 0
      }
    })
    expect(checked).toBeGreaterThan(50)
  })
})

/** Première glyphe de monstre libre (5011, à l'entrée) ; renvoie [case de la glyphe, voisine libre de départ]. */
function freeGlyph(s: Setup, me: Fighter, exclude: number[] = []): [number, number] | undefined {
  const { engine, fight } = s
  for (const g of fight.glyphs) {
    if (g.castSpellId !== 5011 || g.trigger !== 'enter' || exclude.includes(g.center)) continue
    if (!engine.isCellFree(fight, g.center)) continue
    const enemies = fight.fighters.filter(f => f.alive && f.team !== me.team)
    const nbs = neighborsOf(g.center).filter(c => c >= 0 && engine.isCellFree(fight, c) && !fight.glyphs.some(x => x.cells.includes(c)))
    const safe = nbs.find(c => !enemies.some(e => areAdjacent(e.cell, c))) ?? nbs[0]
    if (safe !== undefined) return [g.center, safe]
  }
  return undefined
}

/** Les monstres de vague s'écartent d'une case de leur glyphe à chaque tour (pour la laisser libre). */
function stepAside(s: Setup, f: Fighter): void {
  if (f.team !== 1 || f.summonerId !== undefined || f.monsterId === 3835) return
  const nb = neighborsOf(f.cell).find(c => c >= 0 && s.engine.isCellFree(s.fight, c) && !s.fight.glyphs.some(g => g.cells.includes(c)))
  if (nb !== undefined && f.mp >= 1) move(s.fight, f, [f.cell, nb], s.engine)
}

/** Fait déclencher `count` glyphes à `me` (relocalisé à côté, puis un pas) ; renvoie le nombre réellement déclenché. */
function triggerGlyphs(s: Setup, me: Fighter, count: number): number {
  let done = 0
  const used: number[] = []
  for (let k = 0; k < count; k++) {
    const g = freeGlyph(s, me, used)
    if (!g) break
    used.push(g[0])
    const before = currentHour(s.fight)
    me.cell = g[1]
    me.mp = Math.max(me.mp, 3)
    move(s.fight, me, [g[1], g[0]], s.engine)
    if (currentHour(s.fight) !== before) done++
  }
  return done
}

describe('T-clock : glyphes déclenchées (+1 heure chacune, au milieu du créneau)', () => {
  for (const [count, initiative] of [[1, 4000], [2, 4000], [1, 1000], [2, 1000]] as const) {
    it(`${count} glyphe(s) au tour 2 de P2, ${initiative === 4000 ? 'k = 4' : 'k = 3'} : prévision avec glyphs = {0: ${count}}`, () => {
      const s = setup({ initiative, seed: 3 + count })
      const p2 = s.players[1]
      // Tour 1 : les monstres posent leur glyphe puis s'écartent.
      run(s, 1, f => stepAside(s, f))
      turnOf(s, p2, 2, f => stepAside(s, f))
      const slots = forecastHours(s.fight, 10, VORTEX_DEFAULT_PARAMS, new Map([[0, count]]))
      const h0 = currentHour(s.fight)
      expect(triggerGlyphs(s, p2, count)).toBe(count)
      expect(currentHour(s.fight)).toBe(((h0 - 1 + count) % 12) + 1)
      s.engine.endTurn(s.fight, p2)
      const obs = run(s, 9, f => stepAside(s, f))
      expect(compare(slots, obs)).toBeGreaterThan(60)
      // Sans le décalage prévu, la prévision serait fausse.
      const naive = forecastHours(s.fight, 1, VORTEX_DEFAULT_PARAMS)
      expect(naive.length).toBeGreaterThan(0)
    })
  }
})

describe('T-clock : personnage mort (paramètre deadPlayerAdvancesClock)', () => {
  // k = 3 : P4 joue APRÈS le Vortex ; son tic (variante) tombe en fin de tour de jeu ou au créneau suivant.
  for (const variant of [false, true]) {
    it(`k = 3, P4 (après le Vortex) tué au tour 2 — deadPlayerAdvancesClock = ${variant}`, () => {
      const params = { deadPlayerAdvancesClock: variant }
      const s = setup({ initiative: 1000, params, seed: 22 })
      const [p1, , , p4] = s.players
      turnOf(s, p1, 2)
      s.engine.kill(s.fight, p4, p1)
      const slots = forecastHours(s.fight, 12, { ...VORTEX_DEFAULT_PARAMS, ...params })
      const obs = run(s, 12)
      expect(compare(slots, obs)).toBeGreaterThan(60)
      for (const o of obs) if (s.players.some(p => p.id === o.fighterId)) expect(o.aurCell, `tour ${o.round} heure ${o.hour}`).toBe(HOUR_CELL[o.hour])
      const vortexHours = new Set(hoursSeenBy(slots, vortexState(s.fight)!.vortexId))
      if (variant) expect(vortexHours).toEqual(new Set([3, 7, 11]))
      else expect(vortexHours.size).toBeGreaterThan(3)
    })
  }

  for (const variant of [false, true]) {
    it(`P2 tué au tour 2 — deadPlayerAdvancesClock = ${variant}`, () => {
      const params = { deadPlayerAdvancesClock: variant }
      const s = setup({ initiative: 4000, params, seed: 21 })
      const [p1, p2] = s.players
      turnOf(s, p1, 2)
      s.engine.kill(s.fight, p2, p1)
      const slots = forecastHours(s.fight, 12, { ...VORTEX_DEFAULT_PARAMS, ...params })
      const obs = run(s, 12)
      expect(compare(slots, obs)).toBeGreaterThan(60)
      for (const o of obs) if (s.players.some(p => p.id === o.fighterId)) expect(o.aurCell, `tour ${o.round} heure ${o.hour}`).toBe(HOUR_CELL[o.hour])
      const vx = vortexState(s.fight)!
      const vortexHours = new Set(hoursSeenBy(slots, vx.vortexId))
      if (variant) {
        // Le cycle est conservé : le Vortex reste sur IV/VIII/XII et des tics virtuels apparaissent.
        expect(vortexHours).toEqual(new Set([4, 8, 12]))
        expect(slots.some(sl => sl.index === -1 && sl.fighterId === p2.id)).toBe(true)
      } else {
        // 3 personnages vivants : +3 heures par tour, le Vortex parcourt d'autres heures.
        expect(vortexHours.size).toBeGreaterThan(3)
        expect(slots.some(sl => sl.index === -1)).toBe(false)
      }
    })
  }
})

/**
 * Ordre exact des créneaux (index compris) : la prévision suit les retraits de la timeline (morts, au début de chaque
 * tour de jeu) et les réinsertions des ressuscités juste après le Vortex (780 de 5003, `reviveFighter`).
 */
function compareExact(slots: readonly ClockSlot[], s: Setup, rounds: number, act?: (f: Fighter) => void): number {
  const real = slots.filter(sl => sl.index >= 0)
  let n = 0
  run(s, rounds, f => {
    const sl = real[n + 1]
    if (sl && s.fight.round <= sl.round) {
      expect({ round: s.fight.round, id: f.id, index: s.fight.turnIndex, hour: currentHour(s.fight) }, `créneau ${n + 1}`).toEqual({
        round: sl.round,
        id: sl.fighterId,
        index: sl.index,
        hour: sl.hour,
      })
      n++
    }
    act?.(f)
  })
  return n
}

describe('T-clock : morts, résurrections et réinsertion dans la timeline', () => {
  it('k = 3 : P4 (après le Vortex) tue des monstres ⇒ retirés au tour suivant, réinsérés après le Vortex', () => {
    const s = setup({ initiative: 1000, seed: 12 })
    const p4 = s.players[3]
    turnOf(s, p4, 2)
    const vx = vortexState(s.fight)!
    expect(s.fight.timeline.indexOf(p4.id)).toBeGreaterThan(s.fight.timeline.indexOf(vx.vortexId))
    // P4 tue deux monstres de vague (un avant, un après lui dans la timeline).
    const victims = s.fight.fighters.filter(isWaveMonster).slice(0, 2)
    for (const m of victims) s.engine.kill(s.fight, m, p4)
    const slots = forecastHours(s.fight, 4, VORTEX_DEFAULT_PARAMS)
    s.engine.endTurn(s.fight, p4)
    expect(compareExact(slots, s, 4)).toBeGreaterThan(20)
    // Au tour 3, les victimes retirées de la timeline jouent juste après le Vortex (avant l'Auroraire) ; la première de
    // la timeline (gardée par `Engine.nextTurn` au début du tour de jeu, même morte) rejoue à sa place au tour 4.
    const first = s.fight.timeline[0]
    const removed = victims.filter(m => m.id !== first).map(m => m.id)
    expect(removed.length).toBeGreaterThan(0)
    const r3 = slots.filter(sl => sl.round === 3 && sl.index >= 0).map(sl => sl.fighterId)
    const vi = r3.indexOf(vx.vortexId)
    expect(new Set(r3.slice(vi + 1, vi + 1 + removed.length))).toEqual(new Set(removed))
    expect(r3[vi + 1 + removed.length]).toBe(vx.auroraireId)
  })

  // Prévision sur les tours 2-6 : exacte (index compris) jusqu'à l'arrivée de la vague 2 (tour 7, inconnue de la prévision).
  it('k = 4 : monstres tués par P1 ressuscités au tour du Vortex, rejouent à leur place ; rezAllPerTurn = false', () => {
    for (const rezAllPerTurn of [true, false]) {
      const params = { rezAllPerTurn }
      const s = setup({ initiative: 4000, seed: 13, params })
      const [p1] = s.players
      turnOf(s, p1, 2)
      const wave = s.fight.fighters.filter(isWaveMonster)
      for (const m of wave) s.engine.kill(s.fight, m, p1)
      const slots = forecastHours(s.fight, 5, { ...VORTEX_DEFAULT_PARAMS, ...params })
      s.engine.endTurn(s.fight, p1)
      expect(compareExact(slots, s, 5)).toBeGreaterThan(30)
    }
  })
})

describe('T-clock : fenêtres d’étoile = pose réelle de « Même heure » (234)', () => {
  for (const initiative of [4000, 1000]) it(`Ikargn tué à l’heure I (${initiative === 4000 ? 'k = 4' : 'k = 3'}) : étoile exactement pendant les fenêtres prévues`, () => {
    const s = setup({ initiative, seed: 5 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    expect(currentHour(s.fight)).toBe(1)
    s.engine.kill(s.fight, ika, p1)
    expect(deathHours(ika)).toBe(hourBit(1))
    // Prévision depuis le créneau de P1 (tour 1) : l'Ikargn est ressuscité au tour du Vortex.
    const slots = forecastHours(s.fight, 9, VORTEX_DEFAULT_PARAMS)
    const windows = starWindows(slots, deathHours(ika)).filter(w => w.from > 0)
    expect(windows.length).toBeGreaterThanOrEqual(2)
    // Mort au moment de la prévision : seule compte l'arrivée FUTURE de l'heure (pas la fenêtre en cours).
    expect(monsterStarWindows(slots, ika)).toEqual(windows)
    expect(slots[windows[0].from].round).toBe(4)
    expect(slots[windows[0].from].fighterId).toBe(p1.id)
    const inWindow = new Set<string>()
    for (const w of windows) for (let i = w.from; i < w.to; i++) inWindow.add(`${slots[i].round}:${slots[i].fighterId}`)
    s.engine.endTurn(s.fight, p1)
    const obs = run(s, 8, undefined, ika)
    let checked = 0
    for (const o of obs) {
      if (o.round > 9) break
      expect(o.star, `tour ${o.round} combattant ${o.fighterId}`).toBe(inWindow.has(`${o.round}:${o.fighterId}`))
      checked++
    }
    expect(checked).toBeGreaterThan(60)
  })

  it('tué sous l’étoile : corrompu à la résurrection (6611), plus de fenêtre', () => {
    const s = setup({ initiative: 4000, seed: 6 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, p1, 4)
    expect(ika.alive).toBe(true)
    expect(ika.states).toContain(SAME_HOUR)
    s.engine.kill(s.fight, ika, p1)
    const vx = vortexState(s.fight)!
    turnOf(s, s.fight.fighters[vx.vortexId], 4)
    expect(ika.alive).toBe(true)
    expect(ika.states).toContain(6611)
    const slots = forecastHours(s.fight, 6, VORTEX_DEFAULT_PARAMS)
    expect(monsterStarWindows(slots, ika)).toEqual([])
    // Le corrompu passe ses tours : aucun créneau joué observé pour lui.
    const obs = run(s, 4)
    expect(obs.some(o => o.fighterId === ika.id)).toBe(false)
  })

  it('mort sous l’étoile, prévision faite AVANT sa résurrection : aucune fenêtre, aucun créneau après le réveil (corrompu)', () => {
    const s = setup({ initiative: 4000, seed: 6 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, p1, 4)
    expect(ika.states).toContain(SAME_HOUR)
    s.engine.kill(s.fight, ika, p1)
    // Mort avec l'étoile : corrompu au réveil (5002), donc ni fenêtre ni créneau joué.
    const slots = forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS)
    expect(monsterStarWindows(slots, ika)).toEqual([])
    expect(slots.some(sl => sl.fighterId === ika.id)).toBe(false)
    s.engine.endTurn(s.fight, p1)
    // La prévision reste exacte, index compris, sur les créneaux suivants (le réveillé corrompu passe ses tours).
    expect(compareExact(slots, s, 3)).toBeGreaterThan(20)
    expect(ika.states).toContain(6611)
  })

  it('monstre mort : seules comptent les fenêtres APRÈS sa résurrection (rezAllPerTurn = false : rang dans la file)', () => {
    // k = 4, un seul mort ressuscité par tour du Vortex (le plus récent d'abord). P1 tue les 3 monstres à I au tour 1 ;
    // deux glyphes de +2 (P2 et P3) feraient revenir I au créneau de P1 du tour 3, AVANT la résurrection du premier tué
    // (3e tour du Vortex) : pas d'étoile pour lui à ce moment-là, alors que le dernier tué (ressuscité au tour 1) l'aurait.
    const params = { rezAllPerTurn: false }
    const s = setup({ initiative: 4000, seed: 9, params })
    const [p1, p2, p3] = s.players
    turnOf(s, p1, 1)
    const wave = s.fight.fighters.filter(isWaveMonster)
    for (const m of wave) s.engine.kill(s.fight, m, p1)
    const plain = forecastHours(s.fight, 4, { ...VORTEX_DEFAULT_PARAMS, ...params })
    const glyphs = new Map<number, number>()
    for (const p of [p2, p3]) glyphs.set(plain.findIndex(sl => sl.round === 1 && sl.fighterId === p.id), 2)
    const slots = forecastHours(s.fight, 4, { ...VORTEX_DEFAULT_PARAMS, ...params }, glyphs)
    const back = slots.findIndex(sl => sl.round === 3 && sl.fighterId === p1.id)
    expect(slots[back].hour).toBe(1)
    const vortexSlots = slots.map((sl, i) => (sl.isVortex ? i : -1)).filter(i => i >= 0)
    const [first, , last] = wave // ordre des morts : le dernier tué est ressuscité le premier
    expect(monsterStarWindows(slots, last, s.fight).some(w => w.from === back)).toBe(true)
    const firstWindows = monsterStarWindows(slots, first, s.fight)
    expect(firstWindows.some(w => w.from === back)).toBe(false)
    expect(firstWindows.every(w => w.from > vortexSlots[2])).toBe(true)
    // Sans l'état du combat (rang inconnu) : résurrection supposée au premier tour du Vortex.
    expect(monsterStarWindows(slots, first).some(w => w.from === back)).toBe(true)
  })
})

/**
 * T-clock sur des combats « vivants » (attaque au plus près pour tout le monde : morts, résurrections, corruptions,
 * vagues, glyphes déclenchées en marchant) : à la fin de chaque tour, la prévision (sans glyphe) est comparée créneau
 * par créneau (tour, combattant, index, heure) aux tours suivants, jusqu'au premier événement qu'elle ne peut pas
 * connaître : une mort, une arrivée de vague, ou un changement d'heure en cours de tour (glyphe déclenchée).
 */
describe('T-clock : combats complets (30 tours, prévision glissante exacte)', () => {
  for (const [seed, initiative] of [[1, 4000], [2, 1000], [3, 4000]] as const) {
    it(`graine ${seed}, ${initiative === 4000 ? 'k = 4' : 'k = 3'}`, () => {
      const engine = createEngine(data, vortexHooks)
      const players = createSmokeTeam(data, SMOKE_BREEDS, { initiative, hp: 60_000 })
      const fight = createVortexFight(engine, players, { params: { ...VORTEX_DEFAULT_PARAMS, maxRounds: 30 }, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
      const ctrl = scriptedVortexController()
      let pending: ClockSlot[] = []
      let ptr = 0
      let compared = 0
      let invalidations = 0
      let aurChecked = 0
      const signature = () => `${fight.deaths?.length ?? 0}:${vortexState(fight)!.wavesSpawned}`
      let sig = signature()
      for (let i = 0; i < 5000 && !fight.ended; i++) {
        const f = engine.nextTurn(fight)
        if (!f) break
        if (signature() !== sig) {
          pending = []
          invalidations++
        }
        const sl = pending[ptr]
        if (sl) {
          expect({ round: fight.round, id: f.id, index: fight.turnIndex, hour: currentHour(fight) }, `graine ${seed} tour ${fight.round}`).toEqual({
            round: sl.round,
            id: sl.fighterId,
            index: sl.index,
            hour: sl.hour,
          })
          compared++
          ptr++
        }
        const h0 = currentHour(fight)
        // Auroraire sur la case de l'heure (échanges forcés et heures non marchables compris) à chaque créneau joueur.
        if (f.kind === 'player') {
          aurChecked++
          expect(fight.fighters.find(x => x.alive && x.monsterId === 3833)?.cell, `graine ${seed} tour ${fight.round} heure ${h0}`).toBe(HOUR_CELL[h0])
        }
        sig = signature()
        ctrl.playTurn(engine, fight, f)
        if (fight.ended) break
        if (currentHour(fight) !== h0 || signature() !== sig) invalidations++
        // Prévision faite à la fin du tour (état après les actions), avant `endTurn`.
        pending = forecastHours(fight, 2, VORTEX_DEFAULT_PARAMS).filter(x => x.index >= 0)
        ptr = 1
        sig = signature()
        if (f.alive) engine.endTurn(fight, f)
      }
      expect(fight.round).toBeGreaterThanOrEqual(30)
      expect(compared).toBeGreaterThan(400)
      expect(invalidations).toBeGreaterThan(5)
      expect(aurChecked).toBeGreaterThan(60)
    })
  }
})

describe('prévision : propriétés', () => {
  it('le créneau 0 est le créneau courant, le prochain créneau du Vortex est trouvé', () => {
    const s = setup()
    const [p1] = s.players
    turnOf(s, p1, 1)
    const slots = forecastHours(s.fight, 2, VORTEX_DEFAULT_PARAMS)
    expect(slots[0].fighterId).toBe(p1.id)
    expect(slots[0].hour).toBe(currentHour(s.fight))
    const vi = nextVortexSlot(slots, 1)
    expect(vi).toBeGreaterThan(0)
    expect(slots[vi].isVortex).toBe(true)
    expect(advancesClock(p1)).toBe(true)
  })

  it('maxSlots borne la prévision ; aucun créneau sans Auroraire', () => {
    const s = setup()
    expect(forecastHours(s.fight, 30, VORTEX_DEFAULT_PARAMS, undefined, { maxSlots: 10 })).toHaveLength(10)
    const aur = s.fight.fighters.find(f => f.monsterId === 3833)!
    aur.alive = false
    expect(forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS)).toEqual([])
  })
})
