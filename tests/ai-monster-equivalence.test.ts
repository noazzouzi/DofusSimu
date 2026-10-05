/**
 * Équivalence des réglages du `MonsterBrain` (docs/design/ai.md §11.1, §16.2) : sur 1 000 situations tirées (scènes
 * aléatoires sur de vraies cartes + débuts de tours de monstres de vrais combats de l'Œil de Vortex), le premier choix
 * en `play` (topK 8 + obligatoires) doit être celui de `reference` (topK 24) dans ≥ 97 % des cas, et `predict`
 * (topK 4, sans exploration) celui de `play` dans ≥ 90 % des cas.
 */
import { describe, expect, it } from 'vitest'
import type { MonsterBrain, MonsterDecision } from '../src/ai/monster'
import { Rng } from '../src/core/rng'
import { nearestAttackController } from '../src/dungeons/generic/controllers'
import { VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine, type Engine } from '../src/engine'
import { runFight, type Controller } from '../src/engine/runner'
import type { Fighter, FightState } from '../src/engine/types'
import { BREEDS, engineFor, manhattan, MAP_IDS, makeFight, mapOf, monster, player, THL, VORTEX_MONSTERS, walkableCells, yieldToEventLoop } from './ai-core-helpers'
import { brain, data } from './ai-monster-helpers'

interface Tally { n: number; playRef: number; predictPlay: number; mismatches: string[] }

const keyOf = (d: MonsterDecision | null): string => (d ? d.cand.key : 'pass')

function compare(t: Tally, play: MonsterBrain, ref: MonsterBrain, pred: MonsterBrain, engine: Engine, fight: FightState, me: Fighter): void {
  const p = play.decide(engine, fight, me)
  const r = ref.decide(engine, fight, me)
  const q = pred.decide(engine, fight, me)
  t.n++
  if (keyOf(p) === keyOf(r)) t.playRef++
  else if (t.mismatches.length < 12) t.mismatches.push(`${me.name}: play ${keyOf(p)} (${p?.score.toFixed(0)}) ≠ ref ${keyOf(r)} (${r?.score.toFixed(0)})`)
  if (keyOf(q) === keyOf(p)) t.predictPlay++
}

/** Scène aléatoire déterministe : 2-4 personnages THL contre 1-4 monstres du Vortex, avancée jusqu'au tour d'un monstre. */
function randomMonsterScene(seed: number, engine: Engine): { fight: FightState; me: Fighter } | null {
  const rng = new Rng(seed)
  const mapId = MAP_IDS[seed % MAP_IDS.length]
  const map = mapOf(mapId)
  const all = walkableCells(map)
  const center = all[Math.floor(rng.next() * all.length)]
  const near = all.filter(c => manhattan(c, center) <= 8)
  const pool = near.length >= 12 ? near : all
  const nP = 2 + Math.floor(rng.next() * 3)
  const nM = 1 + Math.floor(rng.next() * 4)
  const cells: number[] = []
  while (cells.length < nP + nM) {
    const c = pool[Math.floor(rng.next() * pool.length)]
    if (!cells.includes(c)) cells.push(c)
  }
  const breeds = [BREEDS.iop, BREEDS.cra, BREEDS.enutrof, BREEDS.sacrieur, BREEDS.eniripsa, BREEDS.pandawa, BREEDS.feca]
  const fighters: Fighter[] = []
  for (let i = 0; i < nP; i++) fighters.push(player(breeds[(seed + i) % breeds.length], { cell: cells[i], extra: THL }))
  for (let i = 0; i < nM; i++) fighters.push(monster(VORTEX_MONSTERS[(seed * 3 + i) % VORTEX_MONSTERS.length], cells[nP + i]))
  const fight = makeFight(engine, mapId, fighters, { seed })
  // Blessures aléatoires (kills et soins possibles).
  for (const f of fight.fighters) if (rng.next() < 0.4) f.hp = Math.max(1, Math.round(f.maxHp * (0.05 + 0.6 * rng.next())))
  let me = engine.nextTurn(fight)
  for (let guard = 0; guard < 30 && me && me.kind === 'player'; guard++) {
    engine.endTurn(fight, me)
    me = engine.nextTurn(fight)
  }
  return me && me.kind !== 'player' ? { fight, me } : null
}

describe('équivalence play / reference / predict (§11.1)', () => {
  const tally: Tally = { n: 0, playRef: 0, predictPlay: 0, mismatches: [] }
  const play = brain('play', 7)
  const ref = brain('reference', 7)
  const pred = brain('predict', 7)

  it('600 scènes aléatoires sur 5 vraies cartes', async () => {
    const engine = engineFor()
    let made = 0
    for (let seed = 1; made < 600 && seed < 2000; seed++) {
      const sc = randomMonsterScene(seed, engine)
      if (!sc) continue
      made++
      compare(tally, play, ref, pred, engine, sc.fight, sc.me)
      if (made % 50 === 0) await yieldToEventLoop()
    }
    expect(made).toBe(600)
  }, 300_000)

  it('400 débuts de tours de monstres de vrais combats du Vortex', async () => {
    let compared = 0
    for (let seed = 1; compared < 400 && seed <= 12; seed++) {
      const engine = createEngine(data, vortexHooks)
      const team = createSmokeTeam(data, [8, 9, 3, 7], { hp: 30000 })
      const fight = createVortexFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, maxRounds: 12 }, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
      const players = nearestAttackController()
      const monsters: Controller = {
        playTurn(e, f, me) {
          if (compared < 400 && MonsterBrainPlays(e, f, me)) {
            compare(tally, play, ref, pred, e, f, me)
            compared++
          }
          play.playTurn(e, f, me)
        },
      }
      runFight(engine, fight, f => (f.team === 0 ? players : monsters))
      await yieldToEventLoop()
    }
    expect(compared).toBeGreaterThanOrEqual(300)
  }, 300_000)

  it('accord top-1 : play = reference ≥ 97 %, predict = play ≥ 90 %', () => {
    const playRef = tally.playRef / tally.n
    const predPlay = tally.predictPlay / tally.n
    console.log(`équivalence sur ${tally.n} situations : play/reference ${(100 * playRef).toFixed(1)} %, predict/play ${(100 * predPlay).toFixed(1)} %`)
    if (tally.mismatches.length) console.log(tally.mismatches.join('\n'))
    expect(tally.n).toBeGreaterThanOrEqual(900)
    expect(playRef).toBeGreaterThanOrEqual(0.97)
    expect(predPlay).toBeGreaterThanOrEqual(0.9)
  })
})

/** Le monstre joue-t-il vraiment ce tour (sinon `decide` renvoie null pour tous les réglages) ? */
function MonsterBrainPlays(engine: Engine, fight: FightState, me: Fighter): boolean {
  return me.alive && !fight.ended && !engine.passesTurn(me) && me.ap > 0
}
