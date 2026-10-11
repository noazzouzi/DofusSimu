// Meilleur round de l'équipe : les tours des 4 Crâs cherchés ensemble, dans l'ordre d'initiative.
//  - pour chaque Crâ, les meilleurs tours candidats (recherche.ts, sûrs d'abord) depuis l'état laissé par les tours
//    précédents — les déplacements des monstres entre deux Crâs (monstres.ts), les bombes posées, poussées, explosées ;
//  - faisceau sur les suites de tours : chaque suite est jouée jusqu'au début du tour du premier Crâ de la manche
//    suivante (tour de la Reine compris), puis notée sur l'état atteint :
//    PV ôtés aux monstres (+ bonus de mort) − Crâs morts − PV perdus par les Crâs − Crâs marqués par Mort en Sursis.
// Commande : npx tsx tools/reine-des-voleurs/planificateur/meilleur-round.ts [--manche N | --nouveau]
import type { FightState } from '../../../src/engine/types'
import type { Replay } from '../../../src/replay/types'
import { BOMB, type Snapshot } from './etat'
import { planTurn, type PlannedTurn } from './recherche'
import { RoundSim, type TurnSummary } from './round'

/** État de Mort en Sursis : un second lancer de la Reine tue la cible (effet 141 sous condition e197). */
export const DEATH_MARK = 197

export interface TeamOptions {
  /** Suites de tours gardées à chaque Crâ. */
  width?: number
  /** Tours candidats essayés par Crâ et par suite. */
  perCra?: number
  /** Largeur et profondeur de la recherche d'un tour (recherche.ts). */
  planBeam?: number
  planCasts?: number
  /**
   * Placement à choisir (manche 1) : avant son tour, chaque Crâ essaie aussi les cases des Crâs intacts qui jouent après
   * lui (échange de cases, `RoundSim.swapCells`) ; les cases de l'instantané ne sont alors qu'un ensemble à répartir.
   */
  assign?: boolean
}

export interface TeamTurn {
  gameId: number
  name: string
  round: number
  plan: PlannedTurn | null
  /** Rang du tour choisi parmi les candidats du Crâ (0 : son meilleur tour pris seul). */
  rank: number
  /** État au début du tour du Crâ, sur lequel le tour a été cherché. */
  snapshot: Snapshot
}

export interface Placed {
  gameId: number
  name: string
  cell: number
}

export interface TeamScore {
  total: number
  monsterDamage: number
  kills: string[]
  craDeaths: string[]
  craHpLost: number
  marked: string[]
}

export interface TeamPlan {
  score: TeamScore
  turns: TeamTurn[]
  /** Tous les tours joués (monstres compris), jusqu'au début de la manche suivante pour le premier Crâ. */
  summaries: TurnSummary[]
  replay: Replay
  /** Autres suites gardées par le faisceau (score, tours). */
  alternatives: { score: TeamScore; turns: TeamTurn[] }[]
  /** Cases de départ des Crâs dans la suite retenue (celles de l'instantané, ou le placement choisi avec `assign`). */
  placement: Placed[]
  evaluated: number
  ms: number
}

interface Node {
  sim: RoundSim
  turns: TeamTurn[]
  score: TeamScore
  sig: string
}

const KILL_BONUS = 0.5
const CRA_DEATH = 20000
const CRA_HP = 2
const MARK = 4000

function evaluate(sim: RoundSim, start: FightState): TeamScore {
  const fight = sim.fight
  const copies = new Set(sim.groups.map(g => g[1]))
  let monsterDamage = 0
  let total = 0
  let craHpLost = 0
  const kills: string[] = []
  const craDeaths: string[] = []
  const marked: string[] = []
  for (const f of fight.fighters) {
    const f0 = start.fighters[f.id]
    if (!f0 || f.monsterId === BOMB || sim.bombs.has(f.id)) continue
    const lost = Math.max(0, f0.hp - Math.max(0, f.alive ? f.hp : 0))
    if (f.kind === 'player') {
      craHpLost += lost
      if (f0.alive && !f.alive) craDeaths.push(sim.nameOf(f))
      else if (f.alive && sim.engine.hasState(f, DEATH_MARK)) marked.push(sim.nameOf(f))
    } else if (f.team !== fight.fighters.find(x => x.kind === 'player')?.team && !copies.has(f.id)) {
      monsterDamage += lost
      if (f0.alive && !f.alive) {
        kills.push(sim.nameOf(f))
        total += KILL_BONUS * f.maxHp
      }
    }
  }
  total += monsterDamage - CRA_DEATH * craDeaths.length - CRA_HP * craHpLost - MARK * marked.length
  return { total: Math.round(total), monsterDamage, kills, craDeaths, craHpLost, marked }
}

function signature(sim: RoundSim): string {
  return sim.fight.fighters.filter(f => f.alive).map(f => `${f.id}:${f.cell}:${f.hp}`).join(',')
}

/** Meilleure suite de tours des Crâs pour une manche, à partir de l'instantané (tour de `snap.active`). */
export function planRound(snap: Snapshot, opts: TeamOptions = {}): TeamPlan {
  const t0 = Date.now()
  const width = opts.width ?? 4
  const perCra = opts.perCra ?? 4
  const root = RoundSim.fromSnapshot(snap)
  const start = root.engine.cloneFight(root.fight)
  root.advanceToCra(root.order.length, false)
  const cras = root.order.filter(id => root.fight.fighters[id]?.kind === 'player' && root.fight.fighters[id].alive).length
  let beam: Node[] = [{ sim: root, turns: [], score: evaluate(root, start), sig: '' }]
  let evaluated = 0

  for (let level = 0; level < cras; level++) {
    const next: Node[] = []
    const seen = new Set<string>()
    for (const node of beam) {
      const cur = node.sim.current()
      if (!cur || !cur.alive || cur.kind !== 'player' || node.sim.fight.ended) {
        next.push(node)
        continue
      }
      // Variantes du début de tour : la case de placement du Crâ, ou celle d'un Crâ qui joue après lui (`assign`).
      const variants: RoundSim[] = []
      if (node.sim.started) variants.push(node.sim)
      else {
        for (const other of opts.assign ? node.sim.swappable(cur) : []) {
          const v = node.sim.clone()
          v.swapCells(v.fight.fighters[cur.id], v.fight.fighters[other.id])
          v.beginTurn()
          variants.push(v)
        }
        node.sim.beginTurn()
        variants.unshift(node.sim)
      }
      for (const sim of variants) {
        const cra = sim.current()!
        // Un tour = de ce Crâ jusqu'au tour du Crâ suivant (ou de la manche suivante après le dernier).
        const snapshot = sim.snapshot()
        let res
        try {
          res = planTurn(snapshot, { beam: opts.planBeam ?? 6, maxCasts: opts.planCasts ?? 4, top: perCra })
        } catch {
          res = { plans: [], unsafe: [] }
        }
        const cands: (PlannedTurn | null)[] = res.plans.length ? res.plans.slice(0, perCra) : res.unsafe.slice(0, 2)
        if (!cands.length) cands.push(null)
        cands.forEach((plan, rank) => {
          const child = sim.clone()
          child.act(plan?.steps)
          child.finishTurn()
          child.advanceToCra(child.order.length, false)
          evaluated++
          const sig = signature(child)
          if (seen.has(sig)) return
          seen.add(sig)
          const turn: TeamTurn = { gameId: child.gid.get(cra.id)!, name: child.nameOf(cra), round: sim.round, plan, rank, snapshot }
          next.push({ sim: child, turns: [...node.turns, turn], score: evaluate(child, start), sig })
        })
      }
    }
    next.sort((a, b) => b.score.total - a.score.total)
    beam = next.slice(0, width)
  }
  const best = beam[0]
  const cells = best.sim.startCells()
  const placement = best.sim.order
    .map(id => best.sim.fight.fighters[id])
    .filter(f => f.kind === 'player')
    .map(f => ({ gameId: best.sim.gid.get(f.id)!, name: best.sim.nameOf(f), cell: cells.get(f.id) ?? f.cell }))
  return {
    score: best.score,
    turns: best.turns,
    summaries: best.sim.turns,
    replay: best.sim.replay(`Reine des Voleurs — meilleur round (manche ${snap.round})`),
    alternatives: beam.slice(1).map(n => ({ score: n.score, turns: n.turns })),
    placement,
    evaluated,
    ms: Date.now() - t0,
  }
}
