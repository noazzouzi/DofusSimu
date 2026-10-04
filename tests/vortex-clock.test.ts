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

/** Créneau courant : on avance jusqu'au début du tour de `f` (tours intermédiaires passifs). */
function turnOf(s: Setup, f: Fighter, minRound = 0): void {
  const { engine, fight } = s
  for (let i = 0; i < 500; i++) {
    const cur = engine.current(fight)
    if (cur && cur.id === f.id && fight.round >= minRound && fight.round > 0) return
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    if (!engine.nextTurn(fight)) break
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
  for (const count of [1, 2] as const) {
    it(`${count} glyphe(s) au tour 2 de P2 : prévision avec glyphs = {0: ${count}}`, () => {
      const s = setup({ initiative: 4000, seed: 3 + count })
      const p2 = s.players[1]
      // Tour 1 : les monstres posent leur glyphe puis s'écartent.
      run(s, 1, f => stepAside(s, f))
      turnOf(s, p2, 2)
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

describe('T-clock : fenêtres d’étoile = pose réelle de « Même heure » (234)', () => {
  it('Ikargn tué à l’heure I : étoile exactement pendant les fenêtres prévues, puis corruption', () => {
    const s = setup({ initiative: 4000, seed: 5 })
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
