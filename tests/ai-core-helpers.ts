/**
 * Aides des tests du socle IA (tests/ai-core-*.test.ts, docs/design/ai.md §16.1) : vraies données (`loadDataStore`),
 * vraies cartes, vrais sorts de classes et vrais monstres de l'Œil de Vortex. Aucun scénario : moteur nu
 * (`createEngine(data)`), placements tirés par un générateur déterministe.
 */
import { createSpellProfileIndex } from '../src/ai/core'
import { Rng } from '../src/core/rng'
import { addStats, emptyStats, type Stats, type TeamId } from '../src/core/types'
import { loadDataStore } from '../src/data/node'
import type { MapData } from '../src/data/model'
import { createEngine, type Engine } from '../src/engine'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightState } from '../src/engine/types'
import { distance as distanceOf } from '../src/map/geometry'
import { computeBuildStats, fullScrolls, nakedBuild } from '../src/stats/build'

export const data = loadDataStore()

/** Carte de l'Œil de Vortex (obstacles : centre de l'horloge) et cartes de donjon variées. */
export const VORTEX_MAP = 143393281
export const MAP_IDS = [143393281, 101188608, 101190656, 102760961, 102761985]

export function engineFor(): Engine {
  return createEngine(data)
}

export function mapOf(id: number): MapData {
  const m = data.map(id)
  if (!m) throw new Error(`carte ${id} introuvable`)
  return m
}

/** Classes de référence : Iop 8, Crâ 9, Enutrof 3, Sacrieur 11, Pandawa 12, Eniripsa 7, Féca 1, Sram 4. */
export const BREEDS = { iop: 8, cra: 9, enutrof: 3, sacrieur: 11, pandawa: 12, eniripsa: 7, feca: 1, sram: 4 } as const

export interface PlayerOpts {
  team?: TeamId
  cell?: number
  /** Caractéristiques ajoutées au build nu parchoté (stuff simulé). */
  extra?: Partial<Stats>
  variants?: (0 | 1)[]
  name?: string
}

/** Stuff « THL » simulé : 12 PA, 6 PM, 900 dans chaque élément, puissance, dommages, résistances. */
export const THL: Partial<Stats> = {
  ap: 5, mp: 3, range: 4, strength: 800, intelligence: 800, chance: 800, agility: 800, power: 150, damage: 30,
  critical: 20, criticalDamage: 30, tackleBlock: 40, tackleEvade: 40, neutralResPct: 30, earthResPct: 30,
  fireResPct: 30, waterResPct: 30, airResPct: 30, apReduction: 40, mpReduction: 40, apParry: 30, mpParry: 30,
}

/** Personnage niveau 200 (build nu + parchemins + `extra`). */
export function player(breedId: number, opts: PlayerOpts = {}): Fighter {
  const r = computeBuildStats({ ...nakedBuild(breedId, 200, opts.name ?? 'P'), scrolls: fullScrolls() }, data)
  const stats = addStats(addStats(emptyStats(), r.stats), opts.extra ?? {})
  return createPlayerFighter(data, {
    name: opts.name ?? data.breed(breedId)?.name ?? `B${breedId}`,
    breedId,
    level: 200,
    stats,
    maxHp: r.maxHp + 3000,
    variants: opts.variants ?? new Array(22).fill(0),
    team: opts.team ?? 0,
    cell: opts.cell ?? -1,
  })
}

/** Monstre réel (grade 5 par défaut). */
export function monster(monsterId: number, cell: number, grade = 5, team: TeamId = 1): Fighter {
  return createMonsterFighter(data, { monsterId, grade, cell, team })
}

export const VORTEX_MONSTERS = [3834, 3836, 3837, 3838, 3839]

/** Combat sur une carte réelle, tours commencés jusqu'au combattant `firstId` (ou le premier de la timeline). */
export function makeFight(engine: Engine, mapId: number, fighters: Fighter[], opts: { seed?: number; rollMode?: 'random' | 'average'; record?: boolean } = {}): FightState {
  return engine.createFight({
    map: mapOf(mapId),
    fighters,
    options: { seed: opts.seed ?? 1, rollMode: opts.rollMode ?? 'average', record: opts.record ?? false, maxRounds: 60 },
  })
}

/** Cases marchables d'une carte. */
export function walkableCells(map: MapData): number[] {
  const out: number[] = []
  for (const c of map.cells) if (c.walkable) out.push(c.id)
  return out
}

/** Tire `n` cases marchables distinctes. */
export function pickCells(rng: Rng, map: MapData, n: number, exclude: Set<number> = new Set()): number[] {
  const cells = walkableCells(map).filter(c => !exclude.has(c))
  const out: number[] = []
  while (out.length < n && cells.length) {
    const i = Math.floor(rng.next() * cells.length)
    out.push(cells[i])
    cells.splice(i, 1)
  }
  return out
}

/**
 * Scène aléatoire déterministe : `nPlayers` personnages (classes tournantes) contre `nMonsters` monstres du Vortex,
 * placés dans une fenêtre réduite pour que les contacts et portées soient fréquents. Le combat est démarré et avancé
 * jusqu'au tour d'un personnage (renvoyé).
 */
export function randomScene(seed: number, o: { nPlayers?: number; nMonsters?: number; mapId?: number; breeds?: number[]; spread?: number } = {}):
  { engine: Engine; fight: FightState; me: Fighter } {
  const rng = new Rng(seed)
  const engine = engineFor()
  const mapId = o.mapId ?? MAP_IDS[seed % MAP_IDS.length]
  const map = mapOf(mapId)
  const nP = o.nPlayers ?? 3
  const nM = o.nMonsters ?? 4
  const breeds = o.breeds ?? [BREEDS.cra, BREEDS.iop, BREEDS.enutrof, BREEDS.sacrieur, BREEDS.pandawa, BREEDS.eniripsa]
  // Fenêtre : cases à distance ≤ spread d'un centre tiré au hasard.
  const all = walkableCells(map)
  const center = all[Math.floor(rng.next() * all.length)]
  const spread = o.spread ?? 7
  const near = all.filter(c => manhattan(c, center) <= spread)
  const pool = near.length >= nP + nM + 2 ? near : all
  const cells: number[] = []
  while (cells.length < nP + nM) {
    const c = pool[Math.floor(rng.next() * pool.length)]
    if (!cells.includes(c)) cells.push(c)
  }
  const fighters: Fighter[] = []
  for (let i = 0; i < nP; i++) {
    const b = breeds[(seed + i) % breeds.length]
    fighters.push(player(b, { cell: cells[i], extra: THL, name: `${data.breed(b)?.name}${i}` }))
  }
  for (let i = 0; i < nM; i++) fighters.push(monster(VORTEX_MONSTERS[(seed + i) % VORTEX_MONSTERS.length], cells[nP + i]))
  const fight = makeFight(engine, mapId, fighters, { seed })
  // Le combat commence par le combattant le plus rapide : on avance jusqu'au premier personnage.
  let me = engine.nextTurn(fight)!
  for (let guard = 0; guard < 20 && me && me.kind !== 'player'; guard++) {
    engine.endTurn(fight, me)
    me = engine.nextTurn(fight)!
  }
  void createSpellProfileIndex(engine)
  return { engine, fight, me }
}

/** Distance de Manhattan logique (réexport commode). */
export function manhattan(a: number, b: number): number {
  return distanceOf(a, b)
}

/** Corrélation de Pearson. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
}
