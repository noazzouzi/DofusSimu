// Placement des Crâs au Ventre de la Baleine, d'après la position des monstres à la phase de placement. Toutes les
// répartitions des Crâs sur les cases de placement sont notées (4 Crâs sur 10 cases : 5 040) :
//  − dommages attendus des monstres qui jouent AVANT le premier tour de chaque Crâ et peuvent toucher sa case (le
//    combat du 2026-10-14 : Kemist et Lowkey, derniers à jouer, sur les cases les plus exposées, 4 900 dommages en manche 1) ;
//  − contact d'un monstre (tacle) ; Crâ à 5 cases ou moins d'une Bacterrib (son compte à rebours repart) ;
//  − Crâs groupés (Brûlure d'estomac du Pataugerme en cercle de 2).
import type { MapData } from '../../src/data/model'
import { distance } from '../../src/map/geometry'
import { BACTERRIB, PATAUGERME, baseKrobe, isKrobe } from './donjon'
import { threats, type Placed } from './menaces'
import { DANGER } from './planificateur'

export interface PlacementInput {
  map: MapData
  monsters: { monsterId: number; cell: number }[]
  /** Cases de placement de notre équipe. */
  cells: number[]
  /** Ordre de jeu : « cra:<nom> » ou « monstre », du premier au dernier (liste des tours du serveur). */
  timeline: string[]
  /** Cases déjà données (Crâs déjà placés) : gardées, les autres Crâs se répartissent les cases restantes. */
  fixed?: Record<string, number>
  /**
   * À exposition égale, la case la plus loin des monstres (serveur du Féca : 2026-10-17 à 23:43, aucun monstre ne
   * touchait les cases de placement, le Féca a pris la première venue, plus près d'eux que les mules).
   */
  eloigner?: boolean
}

export interface PlacementResult {
  cells: Record<string, number>
  score: number
  notes: string[]
}

export function placementBaleine(input: PlacementInput): PlacementResult {
  const cras = input.timeline.filter(x => x.startsWith('cra:')).map(x => x.slice(4))
  const nMon = Math.max(1, input.timeline.filter(x => x === 'monstre').length)
  // Part des monstres qui jouent avant le premier tour de chaque Crâ.
  const before = new Map<string, number>()
  let seenMon = 0
  for (const x of input.timeline) {
    if (x === 'monstre') seenMon++
    else before.set(x.slice(4), seenMon / nMon)
  }
  const placed: Placed[] = input.monsters.filter(m => isKrobe(m.monsterId)).map(m => ({ monsterId: m.monsterId, cell: m.cell }))
  const t = threats(input.map, placed, [])
  const kinds = input.monsters.map(m => ({ ...m, base: isKrobe(m.monsterId) ? baseKrobe(m.monsterId) : 0 }))
  const exposure = (cell: number) => {
    let s = 0
    for (const src of t.sources.get(cell) ?? []) {
      const m = kinds.find(k => k.cell === src)
      if (m) s += DANGER[m.base] ?? 800
    }
    return s
  }
  const cellCost = (cra: string, cell: number) => {
    let c = (before.get(cra) ?? 1) * exposure(cell)
    if (input.eloigner && kinds.length) c -= 30 * Math.min(...kinds.map(m => distance(m.cell, cell)))
    for (const m of kinds) {
      if (distance(m.cell, cell) === 1) c += 4000
      if (m.base === BACTERRIB && distance(m.cell, cell) <= 5) c += 1500
    }
    return c
  }
  const pataugerme = kinds.some(m => m.base === PATAUGERME)
  let best: { cells: Record<string, number>; score: number } | null = null
  const cells = input.cells
  const fixed = input.fixed ?? {}
  const pick = (k: number, used: number[], cost: number) => {
    if (best && cost >= best.score) return
    if (k === cras.length) {
      let c = cost
      if (pataugerme) for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) if (distance(used[i], used[j]) <= 2) c += 500
      if (!best || c < best.score) best = { cells: Object.fromEntries(cras.map((n, i) => [n, used[i]])), score: c }
      return
    }
    const own = fixed[cras[k]]
    for (const cell of own !== undefined ? [own] : cells) {
      if (used.includes(cell) || (own === undefined && Object.values(fixed).includes(cell))) continue
      pick(k + 1, [...used, cell], cost + cellCost(cras[k], cell))
    }
  }
  pick(0, [], 0)
  const found = best as { cells: Record<string, number>; score: number } | null
  if (!found) return { cells: {}, score: 0, notes: ['aucune case'] }
  const notes = Object.entries(found.cells).map(([n, c]) => `${n} ${c} (exposition ${Math.round(exposure(c))}, ${Math.round(100 * (before.get(n) ?? 1))} % des monstres avant lui)`)
  return { cells: found.cells, score: Math.round(found.score), notes }
}
