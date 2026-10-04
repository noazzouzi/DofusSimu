/**
 * Placement initial des personnages (docs/design/ai.md §12.10, « bases ») — WP3.
 *
 * Score ANALYTIQUE (sans simulation ni perception) d'une affectation des personnages aux cases rouges, énumérée
 * exhaustivement (12 × 11 × 10 × 9 = 11 880 affectations à 4 ; au-delà de 50 000 : glouton puis échanges 2 à 2) :
 *  - exposition au tour 1 : proximité des cases bleues (portée des monstres de vague ≈ PM + portée, `EXPOSURE_REACH`) ;
 *  - croix de l'Auroraire aux créneaux du Vortex (k selon l'équipe qui commence et l'initiative, cycle de 12/pgcd(N,12)
 *    tours) : *En temps et en heure* frappe dès son 2e tour ;
 *  - case 484 (échange forcé quand l'horloge arrive sur VII) ;
 *  - phase 2 (*Action !* ramène chacun à sa case) : ligne ≤ 8 avec la case de départ du Vortex (Heuristique sans LdV)
 *    pénalisée, accès au burst récompensé pour les tueurs ;
 *  - préférences de rôle (`Fighter.role` : tank devant, soigneur/soutien derrière, tueurs à mi-distance) ;
 *  - dispersion : alliés à ≤ 2 cases (zones r2 de l'Ikargn, de Morfaille) pénalisés.
 * Les poids sont des constantes de départ (PVe approximatifs) ; la re-notation par la menace complète et le tri par
 * micro-scénario `prefix12` (§12.10) relèvent du modèle stratégique (WP3b, `ScenarioAIModel.choosePlacement`).
 */
import { initiativeOf } from '../../engine/engine'
import type { Fighter } from '../../engine/types'
import { distance, inLine } from '../../map/geometry'
import { onHourLine } from './clock'
import { BLUE_START_CELLS, HOUR_CELL, RED_START_CELLS, VORTEX, VORTEX_PHASE2_MP, waveComposition, type VortexParams } from './constants'

/** Portée d'engagement des monstres de vague au tour 1 (PM 4-6 + portée 1-7), en cases. */
export const EXPOSURE_REACH = 10
/** Ligne d'Heuristique (phase 2) : 1-8 en ligne sans LdV. */
export const HEURISTIQUE_RANGE = 8

export interface PlacementWeights {
  exposure: number
  clockLine: number
  swapCell: number
  phase2Line: number
  burstAccess: number
  role: number
  clump: number
}

export const DEFAULT_PLACEMENT_WEIGHTS: Readonly<PlacementWeights> = {
  exposure: 60,
  clockLine: 900,
  swapCell: 300,
  phase2Line: 250,
  burstAccess: 120,
  role: 40,
  clump: 150,
}

export interface PlacementScore {
  cells: number[]
  score: number
  /** Détail par terme (somme sur les personnages). */
  terms: Record<keyof PlacementWeights, number>
}

const ROLE_FRONT = new Set(['tank'])
const ROLE_BACK = new Set(['healer', 'support', 'soin', 'soutien'])
const ROLE_KILLER = new Set(['killer', 'zoneDps', 'dps'])

/** Distance minimale d'une case aux cases bleues. */
function blueDistance(c: number): number {
  let d = Infinity
  for (const b of BLUE_START_CELLS) d = Math.min(d, distance(c, b))
  return d
}

/**
 * Nombre de personnages qui jouent avant le Vortex au tour 1 (« k », §12.2), estimé sur l'initiative : le Vortex
 * (4 × 800) est le dernier de son équipe face aux monstres de vague (4 × 850 au grade 5).
 */
export function estimateK(team: readonly Fighter[], p: Pick<VortexParams, 'startingTeamRule' | 'players'>, monsterInit = 3400, vortexInit = 3200): number {
  const n = team.length
  const inits = team.map(initiativeOf)
  const monsters = [vortexInit, ...waveComposition(p.players)[0].filter(m => m !== VORTEX).map(() => monsterInit)]
  const playersStart =
    p.startingTeamRule === 'average'
      ? inits.reduce((a, b) => a + b, 0) / Math.max(1, n) >= monsters.reduce((a, b) => a + b, 0) / monsters.length
      : Math.max(...inits) >= Math.max(...monsters)
  // Position du Vortex dans son équipe (dernier si son initiative est la plus basse).
  const vortexRank = monsters.filter(x => x > vortexInit).length
  return Math.min(n, playersStart ? vortexRank + 1 : vortexRank)
}

/** Heures de l'Auroraire aux créneaux du Vortex (tours 1..cycle) sans glyphe : `((k + N(t−1) − 1) mod 12) + 1`. */
export function vortexSlotHours(k: number, n: number, turns = 12): number[] {
  const out: number[] = []
  for (let t = 1; t <= turns; t++) {
    const h = ((((k + n * (t - 1) - 1) % 12) + 12) % 12) + 1
    if (!out.includes(h)) out.push(h)
  }
  return out
}

/** Score d'une case pour un personnage (sans les termes de paire). */
function cellTerms(c: number, f: Fighter, hours: readonly number[], vortexCell: number): Record<keyof PlacementWeights, number> {
  const bd = blueDistance(c)
  const exposure = Math.max(0, EXPOSURE_REACH - bd)
  let clockLine = 0
  for (const h of hours) if (onHourLine(h, c)) clockLine++
  const swapCell = c === HOUR_CELL[7] ? 1 : 0
  const vd = distance(c, vortexCell)
  const phase2Line = inLine(c, vortexCell) && vd <= HEURISTIQUE_RANGE ? 1 : inLine(c, vortexCell) && vd <= HEURISTIQUE_RANGE + VORTEX_PHASE2_MP ? 0.5 : 0
  const role = f.role ?? ''
  const killer = ROLE_KILLER.has(role)
  const burstAccess = killer ? Math.max(0, 1 - Math.abs(vd - 7) / 7) : 0
  let roleTerm = 0
  if (ROLE_FRONT.has(role)) roleTerm = Math.max(0, 12 - bd) / 12
  else if (ROLE_BACK.has(role)) roleTerm = Math.min(1, bd / 14)
  else if (killer) roleTerm = 1 - Math.abs(bd - 9) / 9
  return { exposure, clockLine, swapCell, phase2Line, burstAccess, role: roleTerm, clump: 0 }
}

function total(t: Record<keyof PlacementWeights, number>, w: PlacementWeights): number {
  return (
    -w.exposure * t.exposure -
    w.clockLine * t.clockLine -
    w.swapCell * t.swapCell -
    w.phase2Line * t.phase2Line +
    w.burstAccess * t.burstAccess +
    w.role * t.role -
    w.clump * t.clump
  )
}

export interface RankPlacementOptions {
  /** Cases autorisées (défaut : les 12 rouges). */
  cells?: readonly number[]
  weights?: Partial<PlacementWeights>
  /** Nombre d'affectations renvoyées (défaut 8). */
  top?: number
  /** k imposé (sinon estimé, `estimateK`). */
  k?: number
}

/**
 * Affectations classées (meilleure d'abord). Départage déterministe : score, puis ordre lexicographique des cases.
 */
export function rankVortexPlacements(team: readonly Fighter[], p: Pick<VortexParams, 'startingTeamRule' | 'players' | 'vortexCell'>, o: RankPlacementOptions = {}): PlacementScore[] {
  const cells = (o.cells ?? RED_START_CELLS).slice()
  const n = team.length
  if (n === 0) return [{ cells: [], score: 0, terms: emptyTerms() }]
  if (cells.length < n) throw new Error(`Pas assez de cases de départ (${cells.length}) pour ${n} personnage(s)`)
  const w = { ...DEFAULT_PLACEMENT_WEIGHTS, ...o.weights }
  const k = o.k ?? estimateK(team, p)
  // Toutes les heures du cycle du Vortex (le 1er tour aussi, par prudence : le 2e tour retombe sur le même cycle).
  const hours = vortexSlotHours(k, n)
  // Table case × personnage.
  const table = team.map(f => cells.map(c => cellTerms(c, f, hours, p.vortexCell)))
  const value = table.map(row => row.map(t => total(t, w)))
  const pairPen = (a: number, b: number) => (distance(cells[a], cells[b]) <= 2 ? w.clump : 0)
  const top = Math.max(1, o.top ?? 8)
  const best: { idx: number[]; score: number }[] = []
  const consider = (idx: number[], score: number) => {
    if (best.length >= top && score <= best[best.length - 1].score) return
    best.push({ idx: idx.slice(), score })
    best.sort((x, y) => y.score - x.score || lexCompare(x.idx.map(i => cells[i]), y.idx.map(i => cells[i])))
    if (best.length > top) best.pop()
  }
  let count = 1
  for (let i = 0; i < n; i++) count *= cells.length - i
  if (count <= 50000) {
    const idx: number[] = []
    const used = new Uint8Array(cells.length)
    const rec = (depth: number, acc: number) => {
      if (depth === n) {
        consider(idx, acc)
        return
      }
      for (let c = 0; c < cells.length; c++) {
        if (used[c]) continue
        let s = acc + value[depth][c]
        for (let j = 0; j < depth; j++) s -= pairPen(idx[j], c)
        used[c] = 1
        idx.push(c)
        rec(depth + 1, s)
        idx.pop()
        used[c] = 0
      }
    }
    rec(0, 0)
  } else {
    // Glouton (personnage par personnage) puis échanges 2 à 2 jusqu'à stabilité.
    const idx: number[] = []
    const used = new Uint8Array(cells.length)
    for (let i = 0; i < n; i++) {
      let bc = -1
      let bs = -Infinity
      for (let c = 0; c < cells.length; c++) {
        if (used[c]) continue
        let s = value[i][c]
        for (let j = 0; j < i; j++) s -= pairPen(idx[j], c)
        if (s > bs) {
          bs = s
          bc = c
        }
      }
      used[bc] = 1
      idx.push(bc)
    }
    const scoreOf = (x: number[]) => {
      let s = 0
      for (let i = 0; i < n; i++) {
        s += value[i][x[i]]
        for (let j = 0; j < i; j++) s -= pairPen(x[j], x[i])
      }
      return s
    }
    let cur = scoreOf(idx)
    for (let improved = true, guard = 0; improved && guard < 50; guard++) {
      improved = false
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < cells.length; c++) {
          const j = idx.indexOf(c)
          const trial = idx.slice()
          if (j >= 0) [trial[i], trial[j]] = [trial[j], trial[i]]
          else trial[i] = c
          const s = scoreOf(trial)
          if (s > cur + 1e-9) {
            cur = s
            idx.splice(0, n, ...trial)
            improved = true
          }
        }
      }
    }
    consider(idx, cur)
  }
  return best.map(b => {
    const terms = emptyTerms()
    b.idx.forEach((c, i) => {
      const t = table[i][c]
      for (const key of Object.keys(terms) as (keyof PlacementWeights)[]) terms[key] += t[key]
    })
    for (let i = 0; i < b.idx.length; i++) for (let j = 0; j < i; j++) if (distance(cells[b.idx[i]], cells[b.idx[j]]) <= 2) terms.clump++
    return { cells: b.idx.map(i => cells[i]), score: b.score, terms }
  })
}

function emptyTerms(): Record<keyof PlacementWeights, number> {
  return { exposure: 0, clockLine: 0, swapCell: 0, phase2Line: 0, burstAccess: 0, role: 0, clump: 0 }
}

function lexCompare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/** Meilleure affectation analytique (cases dans l'ordre de `team`). */
export function defaultVortexPlacement(team: readonly Fighter[], p: Pick<VortexParams, 'startingTeamRule' | 'players' | 'vortexCell'>): number[] {
  return rankVortexPlacements(team, p, { top: 1 })[0].cells
}

/**
 * Placement générique (combats de contrôle, §12.10 « combat générique ») : cases de départ de l'équipe 0 de la carte,
 * les plus éloignées des cases ennemies d'abord, puis dispersées (pas deux alliés à ≤ 1 case si possible).
 */
export function genericPlacement(redCells: readonly number[], enemyCells: readonly number[], n: number): number[] {
  const far = (c: number) => (enemyCells.length ? Math.min(...enemyCells.map(e => distance(c, e))) : 0)
  const sorted = redCells.slice().sort((a, b) => far(b) - far(a) || a - b)
  const out: number[] = []
  for (const c of sorted) {
    if (out.length >= n) break
    if (out.some(o => distance(o, c) <= 1)) continue
    out.push(c)
  }
  for (const c of sorted) {
    if (out.length >= n) break
    if (!out.includes(c)) out.push(c)
  }
  return out
}

