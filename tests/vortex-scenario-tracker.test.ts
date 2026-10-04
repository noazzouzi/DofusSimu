/**
 * Tracker (§12.3) et modèle abstrait (abstract.ts) sur le vrai scénario : statuts, heures de mort, étoiles, zombies,
 * corruption, arrivée de vague ; le modèle abstrait rejoue les mêmes faits que le moteur (mort → résurrection →
 * étoile → corruption).
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import {
  absFromFight,
  absHash,
  absIndex,
  applyAbs,
  beginSlot,
  exposureAt,
  killProbability,
  normalCdf,
  pushStep,
  resurrection,
  traceSteps,
} from '../src/dungeons/vortex/abstract'
import { currentHour, deathHours, forecastHours, hourBit, isWaveMonster } from '../src/dungeons/vortex/clock'
import { IKARGN, MEJAIRE, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { vortexState } from '../src/dungeons/vortex/params'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { describeTrack, snapshotDigest, trackVortex, VortexTracker } from '../src/dungeons/vortex/tracker'
import { createEngine } from '../src/engine'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'

const data = loadDataStore('data')

interface Setup {
  engine: Engine
  fight: FightState
  players: Fighter[]
}

function setup(seed = 1, params: Record<string, unknown> = {}, initiative = 4000): Setup {
  const engine = createEngine(data, vortexHooks)
  const players = createSmokeTeam(data, undefined, { hp: 1_000_000, initiative })
  const fight = createVortexFight(engine, players, { params: { ...VORTEX_DEFAULT_PARAMS, ...params }, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  return { engine, fight, players }
}

/** Joue passivement jusqu'au premier créneau de personnage où l'horloge est à `hour` (≥ `minRound`). */
function playerAtHour(s: Setup, hour: number, minRound = 1): Fighter {
  for (let i = 0; i < 3000; i++) {
    const cur = s.engine.current(s.fight)
    if (cur && cur.kind === 'player' && s.fight.round >= minRound && currentHour(s.fight) === hour) return cur
    if (cur && s.fight.round > 0 && cur.alive) s.engine.endTurn(s.fight, cur)
    if (!s.engine.nextTurn(s.fight)) break
  }
  throw new Error(`heure ${hour} jamais atteinte`)
}

function turnOf(s: Setup, f: Fighter, round = 0): void {
  for (let i = 0; i < 3000; i++) {
    const cur = s.engine.current(s.fight)
    if (cur && cur.id === f.id && s.fight.round >= round && s.fight.round > 0) return
    if (cur && s.fight.round > 0 && cur.alive) s.engine.endTurn(s.fight, cur)
    if (!s.engine.nextTurn(s.fight)) break
  }
  throw new Error('tour jamais atteint')
}

const track = (s: Setup, id: number) => trackVortex(s.fight).tracks.find(t => t.fighterId === id)!

describe('tracker', () => {
  it('début de combat : 3 monstres vivants (vague 1), 16 à venir, 19 au total', () => {
    const s = setup()
    const snap = trackVortex(s.fight)
    expect(snap.total).toBe(19)
    expect(snap.spawned).toBe(3)
    expect(snap.pending).toBe(16)
    expect(snap.tracks.filter(t => t.status === 'alive')).toHaveLength(3)
    const pending = snap.tracks.filter(t => t.status === 'pending')
    expect(new Set(pending.map(t => t.arrivesRound))).toEqual(new Set([7, 12, 17, 22]))
    expect(pending.every(t => t.fighterId < 0)).toBe(true)
    expect(snap.hour).toBe(12)
    expect(snap.unlocked).toBe(false)
    expect(snap.vortexMaxHp).toBe(22000)
  })

  it('mort → heures, résurrection → zombie, étoile, mort sous étoile → corrompu', () => {
    const s = setup(3)
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    const tracker = new VortexTracker()
    tracker.observe(s.fight)
    const v0 = tracker.version
    turnOf(s, p1, 1)
    tracker.observe(s.fight) // l'heure a changé (XII → I)
    const v1 = tracker.version
    expect(v1).toBe(v0 + 1)
    tracker.observe(s.fight)
    expect(tracker.version).toBe(v1) // rien de symbolique
    s.engine.kill(s.fight, ika, p1)
    let t = track(s, ika.id)
    expect(t.status).toBe('dead')
    expect(t.hours).toBe(hourBit(1))
    expect(t.cell).toBe(-1)
    expect(tracker.observe(s.fight) && tracker.version).toBe(v1 + 1)
    const vortex = s.fight.fighters[vortexState(s.fight)!.vortexId]
    turnOf(s, vortex, 1)
    t = track(s, ika.id)
    expect(t.status).toBe('alive')
    expect(t.zombie).toBe(true)
    expect(t.hp).toBeGreaterThan(0)
    turnOf(s, p1, 4)
    t = track(s, ika.id)
    expect(t.star).toBe(true)
    expect(describeTrack(t)).toContain('★')
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, vortex, 4)
    t = track(s, ika.id)
    expect(t.status).toBe('corrupt')
    expect(trackVortex(s.fight).corrupted).toBe(1)
    expect(trackVortex(s.fight).hoursUsedMask).toBe(hourBit(1))
  })

  it('arrivée de vague : à venir → invulnérable (tour 7) → vivant (tour 8)', () => {
    const s = setup()
    const [p1] = s.players
    turnOf(s, p1, 7)
    let snap = trackVortex(s.fight)
    const w2 = snap.tracks.filter(t => t.wave === 2)
    expect(w2).toHaveLength(4)
    expect(w2.every(t => t.status === 'invulnerable' && t.invulnerableUntil === 8)).toBe(true)
    expect(snap.pending).toBe(12)
    turnOf(s, p1, 8)
    snap = trackVortex(s.fight)
    expect(snap.tracks.filter(t => t.wave === 2).every(t => t.status === 'alive')).toBe(true)
    expect(snapshotDigest(snap)).toBe(snapshotDigest(trackVortex(s.fight)))
  })

  it('menace fournie par la perception (threatOf)', () => {
    const s = setup()
    const snap = trackVortex(s.fight, { threatOf: m => m.maxHp / 10 })
    expect(snap.tracks.filter(t => t.status === 'alive').every(t => t.threat === 660)).toBe(true)
    expect(snap.tracks.filter(t => t.status === 'pending').every(t => t.threat === 0)).toBe(true)
  })
})

describe('modèle abstrait = moteur (mort, résurrection, étoile, corruption)', () => {
  it('kill à I (P1, tour 1) puis kill sous étoile (P1, tour 4) : mêmes statuts que le moteur', () => {
    const s = setup(5)
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    const slots = forecastHours(s.fight, 6, VORTEX_DEFAULT_PARAMS)
    let a = absFromFight(s.fight, slots)
    expect(a.hour).toBe(1)
    const i = absIndex(a, ika.id)
    // Créneau 0 (P1, heure I) : kill.
    a = applyAbs(a, slots[0], { t: 'kill', m: [ika.id], glyph: 'none' })!
    expect(a.monsters[i].status).toBe('dead')
    expect(a.monsters[i].hours).toBe(hourBit(1))
    expect(a.hoursUsed & hourBit(1)).toBeTruthy()
    a = pushStep(a, slots[0], { t: 'kill', m: [ika.id], glyph: 'none' }, 100)
    s.engine.kill(s.fight, ika, p1)
    // Créneaux suivants jusqu'au tour 4, créneau de P1 (arrivée de I).
    let k = 1
    for (; k < slots.length; k++) {
      a = beginSlot(a, slots, k)
      if (slots[k].isVortex && slots[k].round === 1) expect(a.monsters[i].status).toBe('alive')
      if (slots[k].round === 4 && slots[k].fighterId === p1.id) break
    }
    expect(a.monsters[i].star).toBe(true)
    turnOf(s, p1, 4)
    expect(ika.states).toContain(234)
    // Kill sous étoile : corrompu au réveil (créneau du Vortex).
    a = applyAbs(a, slots[k], { t: 'kill', m: [ika.id], glyph: 'none' })!
    expect(a.monsters[i].corruptOnWake).toBe(true)
    s.engine.kill(s.fight, ika, p1)
    for (k++; k < slots.length && !slots[k].isVortex; k++) a = beginSlot(a, slots, k)
    a = beginSlot(a, slots, k)
    expect(a.monsters[i].status).toBe('corrupt')
    turnOf(s, s.fight.fighters[vortexState(s.fight)!.vortexId], 4)
    expect(trackVortex(s.fight).tracks.find(t => t.fighterId === ika.id)!.status).toBe('corrupt')
    expect(traceSteps(a)).toHaveLength(1)
  })

  it('glyphe : +1 heure (étoiles recalculées), pré-dégâts plafonnés, actions impossibles refusées', () => {
    const s = setup(2)
    const [p1] = s.players
    turnOf(s, p1, 1)
    const slots = forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS)
    let a = absFromFight(s.fight, slots)
    const mej = s.fight.fighters.find(f => f.monsterId === MEJAIRE)!
    const j = absIndex(a, mej.id)
    // Méjaire marquée à II (fictif) : la glyphe fait arriver II ⇒ étoile.
    a = { ...a, monsters: a.monsters.map((m, x) => (x === j ? { ...m, hours: hourBit(2) } : m)) }
    const g = applyAbs(a, slots[0], { t: 'glyph', count: 1 })!
    expect(g.hour).toBe(2)
    expect(g.glyphShift).toBe(1)
    expect(g.monsters[j].star).toBe(true)
    // Le décalage se propage aux créneaux suivants.
    expect(beginSlot(g, slots, 1).hour).toBe(((slots[1].hour - 1 + 1) % 12) + 1)
    const d = applyAbs(a, slots[0], { t: 'damage', m: mej.id, amount: 1e9, glyph: 'none' })!
    expect(d.monsters[j].hp).toBe(1)
    const pendingId = a.monsters.find(m => m.status === 'pending')!.id
    expect(applyAbs(a, slots[0], { t: 'kill', m: [pendingId], glyph: 'none' })).toBeNull()
    expect(applyAbs(a, slots[0], { t: 'kill', m: [12345], glyph: 'none' })).toBeNull()
    expect(absHash(a)).toBe(absHash({ ...a }))
    expect(absHash(g)).not.toBe(absHash(a))
    // Exposition : un monstre vivant qui joue coûte sa menace.
    const mSlot = slots.find(sl => sl.fighterId === mej.id)!
    const withThreat = { ...a, monsters: a.monsters.map(m => ({ ...m, threat: 500 })) }
    expect(exposureAt(withThreat, mSlot)).toBe(500)
    expect(exposureAt(withThreat, slots[0])).toBe(0)
  })

  it('oracle de kill : Φ déterministe, pKill(E = PV) = 0,5, monotone', () => {
    expect(normalCdf(0)).toBe(0.5)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 5)
    expect(killProbability(1000, 1000)).toBeCloseTo(0.5, 9)
    expect(killProbability(1200, 1000)).toBeGreaterThan(killProbability(1100, 1000))
    expect(killProbability(0, 1000)).toBe(0)
    expect(killProbability(500, 0)).toBe(1)
  })

  it('vagues à venir : PV max réels (grade du scénario), PV pleins à l’arrivée = arrivants du moteur', () => {
    const s = setup(7)
    const [p1] = s.players
    turnOf(s, p1, 6)
    const slots = forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS)
    const root = absFromFight(s.fight, slots)
    let a = root
    const pending = a.monsters.filter(m => m.status === 'pending' && m.wave === 2)
    expect(pending).toHaveLength(4)
    for (const m of pending) expect(m.maxHp).toBeGreaterThan(1000)
    // Passage au tour 7 (arrivée) puis au tour 8 (fin de l'invulnérabilité d'arrivée).
    const k7 = slots.findIndex(sl => sl.round === 7)
    const k8 = slots.findIndex(sl => sl.round === 8)
    a = beginSlot(a, slots, k7)
    const arrived = a.monsters.filter(m => m.wave === 2)
    expect(arrived.every(m => m.status === 'invulnerable' && m.hp === m.maxHp && m.invulnerableUntil === 8)).toBe(true)
    expect(beginSlot(a, slots, k8).monsters.filter(m => m.wave === 2).every(m => m.status === 'alive')).toBe(true)
    // Les vrais arrivants ont exactement ces PV (même composition, même ordre de monstres).
    turnOf(s, p1, 7)
    const real = s.fight.fighters.filter(f => isWaveMonster(f) && f.wave === 2)
    expect(real.map(f => [f.monsterId, f.maxHp]).sort()).toEqual(arrived.map(m => [m.monsterId, m.maxHp]).sort())
    // Paramètre : invulnérabilité de 2 tours (abstrait) ; 0 tour ⇒ vivants dès l'arrivée.
    const a2 = beginSlot(root, slots, k7, { rezHpPct: 25, vitalityXiPct: 30, arrivalInvulnerableTurns: 0 })
    expect(a2.monsters.filter(m => m.wave === 2).every(m => m.status === 'alive')).toBe(true)
  })

  it('résurrection après un kill à XI : PV et PV max du modèle abstrait = moteur (jet 50 % et jet des données)', () => {
    for (const rez of [[50, 50], [20, 30]]) {
      // k = 3 : P3 voit III/VII/XI.
      const s = setup(9, { rezHpPct: rez }, 1000)
      const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
      const killer = playerAtHour(s, 11)
      const slots = forecastHours(s.fight, 3, VORTEX_DEFAULT_PARAMS)
      let a = absFromFight(s.fight, slots)
      const i = absIndex(a, ika.id)
      a = applyAbs(a, slots[0], { t: 'kill', m: [ika.id], glyph: 'none' })!
      s.engine.kill(s.fight, ika, killer)
      expect(deathHours(ika)).toBe(hourBit(11))
      const vi = slots.findIndex((sl, k) => k > 0 && sl.isVortex)
      for (let k = 1; k <= vi; k++) a = beginSlot(a, slots, k, { rezHpPct: (rez[0] + rez[1]) / 2, vitalityXiPct: 30 })
      turnOf(s, s.fight.fighters[vortexState(s.fight)!.vortexId], s.fight.round)
      expect(ika.alive).toBe(true)
      const abs = a.monsters[i]
      const base = ika.baseMaxHp
      const bonus = Math.floor(base * 0.3)
      // PV max : base + 30 % (pas de ×1,3 sur des PV déjà bonifiés).
      expect(ika.maxHp).toBe(base + bonus)
      expect(abs.maxHp).toBe(base + bonus)
      expect(resurrection({ hours: hourBit(11), maxHp: 99999, baseMaxHp: base }, { rezHpPct: 50, vitalityXiPct: 30 })).toEqual({ maxHp: base + bonus, hp: Math.floor(base / 2) + bonus })
      if (rez[0] === 50) {
        // Variante 50 % (règle du scénario) : 50 % des PV de base + bonus de XI, comme le jet des données.
        expect(ika.hp).toBe(Math.floor(base / 2) + bonus)
        expect(abs.hp).toBe(ika.hp)
      } else {
        expect(ika.hp).toBeGreaterThanOrEqual(Math.floor(base * 0.2) + bonus)
        expect(ika.hp).toBeLessThanOrEqual(Math.floor(base * 0.3) + bonus)
        expect(abs.hp).toBe(Math.floor(base * 0.25) + bonus)
      }
    }
  })

  // Défaut du moteur (rapport de revue WP3a) : la Vitalité d'un buff retiré à la mort (1078 de 5002, `dispellable` 2)
  // n'est pas rendue — `Engine.kill` filtre les buffs puis `recomputeStats`, mais `applyPoolDelta` (seul endroit où les
  // PV max suivent la Vitalité) ne s'applique qu'aux vivants. Les PV max d'un monstre tué une fois à XI gonflent donc de
  // +30 % des PV de base à CHAQUE résurrection, alors que les bonus d'heures ne se cumulent pas (vortex.md §6). Ce test
  // échouera (et devra devenir un `it`) quand le moteur sera corrigé.
  it('diagnostic moteur : bonus de XI sans cumul après une 2e mort (PV max = base + 30 %)', () => {
    const s = setup(9, {}, 1000)
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    s.engine.kill(s.fight, ika, playerAtHour(s, 11))
    turnOf(s, s.fight.fighters[vortexState(s.fight)!.vortexId], s.fight.round)
    const base = ika.baseMaxHp
    expect(ika.maxHp).toBe(base + Math.floor(base * 0.3))
    s.engine.kill(s.fight, ika, playerAtHour(s, 3, s.fight.round + 1))
    expect(ika.maxHp).toBe(base) // mort : le bonus (retiré) ne compte plus
    turnOf(s, s.fight.fighters[vortexState(s.fight)!.vortexId], s.fight.round)
    expect(ika.maxHp).toBe(base + Math.floor(base * 0.3))
  })

  it('statuts de tous les monstres de vague cohérents avec le moteur après 30 tours (combat de fumée)', () => {
    const s = setup(4)
    turnOf(s, s.players[0], 25)
    const snap = trackVortex(s.fight)
    for (const t of snap.tracks) {
      if (t.status === 'pending') continue
      const f = s.fight.fighters[t.fighterId]
      expect(isWaveMonster(f)).toBe(true)
      expect(t.status === 'dead').toBe(!f.alive)
    }
    expect(snap.pending).toBe(0)
    expect(snap.spawned).toBe(19)
  })
})
