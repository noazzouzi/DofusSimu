/**
 * WP4a — honnêteté et aléa des politiques `scripted` / `random` (docs/design/ai.md §6.1, §13.2, §16.5) sur données
 * réelles : (1) la réflexion n'avance jamais les dés du vrai combat — rejouer les SEULES actions jouées (événements
 * `cast`/`move`) par une marionnette, sans re-semis par tour (E1 désactivé : un tirage parasite se propagerait jusqu'à
 * la fin), redonne exactement le même combat ; (2) la vue honnête : un invisible adverse est cru sur sa dernière case
 * connue — la politique ne contourne pas sa case réelle (elle bute dessus, comme en jeu).
 */
import { describe, expect, it } from 'vitest'
import { createControllers, defaultAIConfig, loadTheta } from '../src/ai'
import { LAST_SEEN_TAG, observeVisibility, STATE_INVISIBLE } from '../src/ai/core'
import { playScriptedTurn } from '../src/ai/policies/scripted'
import { loadDataStore } from '../src/data/node'
import { createEngine } from '../src/engine'
import { performAction, runFight, type Controller } from '../src/engine/runner'
import type { Action, FightState } from '../src/engine/types'
import { distance } from '../src/map/geometry'
import { buildTeam, fightDigest, fightParams, resolveScenario, runOne } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const CONTROL = 'control:143393281:3834,3836,3837,3838'
const TEAM = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)

function spec(over: Partial<FightSpec> = {}): FightSpec {
  return { scenarioId: CONTROL, team: TEAM, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0, ...over }
}

/** Actions des tours de l'équipe 0 lues dans un combat enregistré, par « tour:combattant » (dans l'ordre). */
function actionsByTurn(fight: FightState): Map<string, Action[][]> {
  const out = new Map<string, Action[][]>()
  let round = 0
  let cur: Action[] | undefined
  let who = -1
  for (const e of fight.events) {
    if (e.t === 'roundStart') round = e.round
    else if (e.t === 'turnStart') {
      who = e.fighter
      cur = undefined
      if (fight.fighters[who].team === 0) {
        cur = []
        const k = `${round}:${who}`
        out.set(k, [...(out.get(k) ?? []), cur])
      }
    } else if (e.t === 'turnEnd') cur = undefined
    else if (cur && e.t === 'cast' && e.fighter === who) cur.push({ type: 'cast', spellId: e.spellId, cell: e.cell })
    else if (cur && e.t === 'move' && e.fighter === who) cur.push({ type: 'move', path: e.path.slice() })
  }
  return out
}

describe('aléa : la réflexion ne touche jamais les dés du vrai combat (§13.2 (2), §16.5)', () => {
  it('rejouer les seules actions de scripted / random redonne le même combat, sans re-semis par tour', () => {
    const cases: [string, 'scripted' | 'random', number][] = [
      [CONTROL, 'scripted', 3], [CONTROL, 'random', 4], ['vortex', 'scripted', 5], ['vortex', 'random', 6],
    ]
    for (const [scenarioId, policy, seed] of cases) {
      const s = spec({ scenarioId, playerPolicy: policy === 'random' ? 'random' : undefined, variantPolicy: 'sampled' })
      const real = runOne(DATA, s, seed, { record: true, rngRekey: 'none' })
      const turns = actionsByTurn(real.fight)
      const played = [...turns.values()].flat()
      expect(played.flat().length, `${scenarioId} ${policy}`).toBeGreaterThan(5)
      // Même combat, joueurs remplacés par une marionnette qui rejoue leurs actions (monstres : mêmes contrôleurs).
      const sc = resolveScenario(scenarioId)
      const engine = createEngine(DATA, sc.hooks)
      const { params } = fightParams(sc, s, seed)
      const fight = sc.createFight(engine, buildTeam(DATA, s.team), { params, seed, rollMode: 'random', record: true, rngRekey: 'none' })
      const controllers = createControllers(engine, defaultAIConfig(s.mode, seed, s.theta), { scenario: sc.aiModel(params, s.theta) })
      let replayed = 0
      const puppet: Controller = {
        playTurn(eng, f, me) {
          observeVisibility(f)
          const queue = turns.get(`${f.round}:${me.id}`)
          for (const a of queue?.shift() ?? []) {
            expect(performAction(eng, f, me, a).ok, `${scenarioId} ${policy} : action rejouée refusée`).toBe(true)
            replayed++
          }
        },
      }
      runFight(engine, fight, f => (f.team === 0 ? puppet : controllers(f)))
      expect(replayed, `${scenarioId} ${policy}`).toBe(played.flat().length)
      expect(fight.rngState, `${scenarioId} ${policy}`).toBe(real.fight.rngState)
      expect(fightDigest(fight), `${scenarioId} ${policy}`).toBe(real.summary.eventsHash)
    }
  })
})

describe('vue honnête (§6.1) : invisible adverse', () => {
  it('scripted planifie sur la dernière case connue d\'un invisible : il bute sur sa case réelle au lieu de la contourner', () => {
    const sc = resolveScenario('control:143393281:3838')
    const prepare = () => {
      const engine = createEngine(DATA, sc.hooks)
      const fight = sc.createFight(engine, buildTeam(DATA, parseTeam('iop:killer', DATA)), { params: sc.defaultParams, seed: 7, rollMode: 'random', record: true, rngRekey: 'perTurn' })
      const iop = fight.fighters.find(f => f.team === 0)!
      let me = engine.nextTurn(fight)!
      while (me.id !== iop.id) {
        engine.endTurn(fight, me)
        me = engine.nextTurn(fight)!
      }
      const monster = fight.fighters.find(f => f.team === 1)!
      // Invisible, vu pour la dernière fois sur sa case de départ, réellement placé loin de tout chemin.
      monster.states.push(STATE_INVISIBLE)
      monster.tags[LAST_SEEN_TAG] = monster.cell
      // Sans tacle : un déplacement = un seul événement `move` (le tacle le découperait en segments).
      monster.tags.cantTackle = true
      const far = fight.map.cells
        .filter(c => c.walkable && !engine.fighterAt(fight, c.id))
        .sort((a, b) => distance(b.id, iop.cell) + distance(b.id, monster.cell) - distance(a.id, iop.cell) - distance(a.id, monster.cell) || a.id - b.id)[0]
      monster.cell = far.id
      return { engine, fight, iop, monster }
    }
    const firstMove = (fight: FightState, id: number) => fight.events.find(e => e.t === 'move' && e.fighter === id) as { path: number[] } | undefined
    // Référence : l'invisible est loin ; le Iop s'approche de la case où il le croit.
    const a = prepare()
    playScriptedTurn(a.engine, a.fight, a.iop, 1)
    const ref = firstMove(a.fight, a.iop.id)
    expect(ref, 'le Iop doit s\'approcher').toBeDefined()
    expect(ref!.path.length).toBeGreaterThanOrEqual(3)
    // Même situation, mais l'invisible se tient réellement sur la 3e case de ce chemin : la politique ne le sait pas,
    // suit le même chemin et s'arrête devant lui (une politique qui lirait sa case réelle le contournerait).
    const b = prepare()
    b.monster.cell = ref!.path[2]
    playScriptedTurn(b.engine, b.fight, b.iop, 1)
    const blocked = firstMove(b.fight, b.iop.id)
    expect(blocked?.path).toEqual(ref!.path.slice(0, 2))
  })
})
