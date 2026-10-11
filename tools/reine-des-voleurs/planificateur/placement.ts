// Meilleur placement des 4 Crâs sur les cases rouges, pour un placement de monstres donné (début du combat, manche 1,
// tour de la Reine qui joue la première).
//  1. potentiel de chaque case rouge : un Crâ seul sur la case, la Reine joue, puis son meilleur tour (recherche.ts,
//     recherche réduite) — dégâts du meilleur tour sûr, à défaut une fraction du meilleur tour non sûr ;
//  2. ensembles de 4 cases classés par potentiel cumulé (Crâs collés pénalisés : lignes de vue, bombes) ;
//  3. pour les meilleurs ensembles, meilleur round de l'équipe (equipe.ts) avec répartition des cases entre les Crâs
//     (`assign` : chaque Crâ essaie aussi les cases de ceux qui jouent après lui).
import { distance } from '../../../src/map/geometry'
import { data, MAP_ID, type EntitySnap, type Snapshot } from './etat'
import { planRound, type TeamOptions, type TeamPlan } from './equipe'
import { planTurn } from './recherche'
import { RoundSim } from './round'

export interface CellPotential {
  cell: number
  /** Dégâts du meilleur tour (sûr si `safe`). */
  total: number
  safe: boolean
  value: number
}

export interface PlacementOptions extends TeamOptions {
  /** Nombre d'ensembles de 4 cases évalués par un round complet. */
  sets?: number
}

export interface PlacementResult {
  potentials: CellPotential[]
  /** Ensembles évalués (cases, potentiel cumulé, note du meilleur round). */
  sets: { cells: number[]; proxy: number; score: number; damage: number }[]
  best: TeamPlan
  /** Instantané du placement retenu au début du combat (tour de la Reine). */
  snapshot: Snapshot
  ms: number
}

/** Part des dégâts d'un tour non sûr comptée dans le potentiel d'une case. */
const UNSAFE_SHARE = 0.25
/** Pénalité par paire de Crâs sur des cases voisines. */
const ADJACENT = 400

export function redCells(mapId = MAP_ID): number[] {
  return data.map(mapId)?.redCells ?? []
}

/**
 * Début du combat à partir d'un instantané quelconque (positions des monstres, ordre de jeu) : manche 1, premier de
 * l'ordre actif, PV pleins, aucune bombe ni relance des Crâs ; Crâs posés sur `cells` dans l'ordre d'initiative.
 */
export function startSnapshot(snap: Snapshot, cells?: number[]): Snapshot {
  const crasInOrder = snap.order.map(g => snap.entities.find(e => e.gameId === g && e.kind === 'cra')).filter((e): e is EntitySnap => !!e)
  const others = snap.entities.filter(e => e.kind === 'cra' && !crasInOrder.includes(e))
  const cras = [...crasInOrder, ...others]
  const entities: EntitySnap[] = []
  cras.forEach((e, i) => entities.push({ ...e, cell: cells?.[i] ?? e.cell, hp: e.maxHp ?? e.hp, ap: undefined, mp: undefined, cooldowns: {} }))
  for (const e of snap.entities) if (e.kind === 'monster') entities.push({ ...e, hp: e.maxHp ?? e.hp, cooldowns: undefined })
  const order = snap.order.filter(g => entities.some(e => e.gameId === g))
  return { ...snap, round: 1, active: order[0], order, entities, source: `placement ${cras.map((e, i) => `${e.name} ${cells?.[i] ?? e.cell}`).join(', ')}` }
}

/** Potentiel de chaque case rouge : le premier Crâ seul sur la case, après le tour des monstres qui jouent avant lui. */
export function cellPotentials(snap: Snapshot, cells = redCells(snap.mapId)): CellPotential[] {
  const base = startSnapshot(snap)
  const first = base.order.map(g => base.entities.find(e => e.gameId === g)).find(e => e?.kind === 'cra')!
  const out: CellPotential[] = []
  for (const cell of cells) {
    if (base.entities.some(e => e.kind === 'monster' && e.cell === cell)) continue
    const s: Snapshot = { ...base, entities: base.entities.filter(e => e.kind !== 'cra' || e === first).map(e => (e === first ? { ...e, cell } : e)) }
    s.order = s.order.filter(g => s.entities.some(e => e.gameId === g))
    const sim = RoundSim.fromSnapshot(s)
    sim.advanceToCra()
    let total = 0
    let safe = false
    try {
      const res = planTurn(sim.snapshot(), { beam: 4, maxCasts: 4, top: 1 })
      const p = res.plans[0] ?? res.unsafe[0]
      total = p ? Math.round(p.total) : 0
      safe = !!res.plans[0]
    } catch {
      // Case sans tour possible : potentiel nul.
    }
    out.push({ cell, total, safe, value: safe ? total : total * UNSAFE_SHARE })
  }
  return out
}

function* combinations(n: number, k: number, from = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield acc.slice()
    return
  }
  for (let i = from; i <= n - (k - acc.length); i++) {
    acc.push(i)
    yield* combinations(n, k, i + 1, acc)
    acc.pop()
  }
}

/** Meilleur placement des Crâs de l'instantané pour ses positions de monstres. */
export function optimizePlacement(snap: Snapshot, opts: PlacementOptions = {}): PlacementResult {
  const t0 = Date.now()
  const potentials = cellPotentials(snap)
  const nCras = snap.entities.filter(e => e.kind === 'cra').length
  const ranked: { cells: number[]; proxy: number }[] = []
  for (const idx of combinations(potentials.length, Math.min(nCras, potentials.length))) {
    const ps = idx.map(i => potentials[i])
    let proxy = ps.reduce((a, p) => a + p.value, 0)
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (distance(ps[i].cell, ps[j].cell) <= 1) proxy -= ADJACENT
    ranked.push({ cells: ps.map(p => p.cell), proxy: Math.round(proxy) })
  }
  ranked.sort((a, b) => b.proxy - a.proxy)
  const sets: PlacementResult['sets'] = []
  let best: { plan: TeamPlan; snapshot: Snapshot } | null = null
  for (const r of ranked.slice(0, opts.sets ?? 3)) {
    const start = startSnapshot(snap, r.cells)
    const plan = planRound(start, { width: opts.width ?? 3, perCra: opts.perCra ?? 3, planBeam: opts.planBeam, planCasts: opts.planCasts, assign: true })
    sets.push({ cells: r.cells, proxy: r.proxy, score: plan.score.total, damage: plan.score.monsterDamage })
    if (!best || plan.score.total > best.plan.score.total) best = { plan, snapshot: start }
  }
  if (!best) throw new Error('Aucune case rouge libre sur la carte')
  // Instantané du placement retenu (cases réparties entre les Crâs par la recherche).
  const cellOf = new Map(best.plan.placement.map(p => [p.gameId, p.cell]))
  const snapshot: Snapshot = {
    ...best.snapshot,
    entities: best.snapshot.entities.map(e => (cellOf.has(e.gameId) ? { ...e, cell: cellOf.get(e.gameId)! } : e)),
    source: `placement optimisé : ${best.plan.placement.map(p => `${p.name} ${p.cell}`).join(', ')}`,
  }
  return { potentials, sets, best: best.plan, snapshot, ms: Date.now() - t0 }
}
