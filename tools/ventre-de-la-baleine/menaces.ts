// Cases que les monstres peuvent toucher à leur prochain tour (Ventre de la Baleine, ou tout autre combat) : pour chaque
// monstre, toutes les cases qu'il atteint avec ses PM (sans compter le tacle), puis tous ses sorts lançables de là
// (portée, ligne, diagonale, ligne de vue : les combattants la bloquent), zones d'effet comprises. Sert à choisir les
// cases de placement et les replis des Crâs.
//
//   npx tsx tools/ventre-de-la-baleine/menaces.ts [--carte 140771332]
//       --monstres Pataugerme:297,Virustine:341,Tabacille:286,Tabacille:242   (nom ou identifiant de monstre : case)
//       [--cras 385,372,356,329] [--pm Virustine:6,Pataugerme:2] [--pesanteur 286]
// --pm : PM d'un monstre (malus de poussée de la Virustine, retraits) ; --pesanteur : monstres (cases) sous Pesanteur
// (Échange subtil du Tabacille impossible, condition « HS!7 »).
// Carte : lettre(s) des monstres qui peuvent toucher la case (T Tabacille, M Verminocule, B Bacterrib, V Virustine,
// P Pataugerme, Z Protozorreur), « · » case sûre, [X] monstre, C1..C4 Crâs, ## obstacle.
import { CELL_COUNT, distance, isInCastRange } from '../../src/map/geometry'
import { hasLineOfSightOnMap, opaqueCells } from '../../src/map/los'
import { GridSearch } from '../../src/map/path'
import { zoneCells } from '../../src/map/zones'
import type { MapData, SpellLevelData } from '../../src/data/model'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { KROBES } from './donjon'

export interface Placed {
  monsterId: number
  cell: number
  /** PM disponibles (défaut : ceux du grade 5 dans les données). */
  mp?: number
  /** Sous Pesanteur (état 7) : sorts « HS!7 » impossibles. */
  pesanteur?: boolean
}

export interface Threat {
  /** Case → menaces (« Tabacille 286 : Échange subtil »…). */
  byCell: Map<number, Set<string>>
  /** Case → lettres des monstres qui la touchent. */
  letters: Map<number, Set<string>>
  /** Case → cases de départ des monstres qui la touchent. */
  sources: Map<number, Set<number>>
}

const LETTER: Record<number, string> = { 3823: 'T', 3824: 'M', 3825: 'B', 3826: 'V', 3827: 'P', 3828: 'Z', 5212: 'B', 5213: 'T', 5214: 'M', 5215: 'V' }
export const letterOf = (monsterId: number) => LETTER[monsterId] ?? '?'

/** Un effet du sort touche-t-il les ennemis du lanceur (jeton « A » du masque, hors conditions sur le lanceur) ? */
const hitsEnemies = (mask: string) => mask.split(',').some(t => t.trim() === 'A')

/** Sorts offensifs d'un monstre (grade 1 du sort, comme les Krobes à tous leurs grades). */
function offensiveLevels(monsterId: number): SpellLevelData[] {
  const m = data.monster(monsterId)
  if (!m) throw new Error(`Monstre ${monsterId} absent des données`)
  const out: SpellLevelData[] = []
  m.spells.forEach((id, k) => {
    const s = data.spell(id)
    const grade = m.spellGrades?.[k]?.[4] || 1
    const lvl = s?.levels.find(l => l.grade === grade) ?? s?.levels[0]
    if (lvl && lvl.effects.some(e => hitsEnemies(e.targetMask))) out.push(lvl)
  })
  return out
}

export function threats(map: MapData, monsters: Placed[], cras: number[] = []): Threat {
  const opaque = opaqueCells(map.cells)
  const walk = (c: number) => !!map.cells[c]?.walkable
  const byCell = new Map<number, Set<string>>()
  const letters = new Map<number, Set<string>>()
  const sources = new Map<number, Set<number>>()
  const mark = (c: number, label: string, letter: string, from: number) => {
    if (c < 0 || c >= CELL_COUNT || !walk(c)) return
    let s = byCell.get(c)
    if (!s) byCell.set(c, (s = new Set()))
    s.add(label)
    let l = letters.get(c)
    if (!l) letters.set(c, (l = new Set()))
    l.add(letter)
    let o = sources.get(c)
    if (!o) sources.set(c, (o = new Set()))
    o.add(from)
  }
  const search = new GridSearch()
  for (const mo of monsters) {
    const others = new Set([...cras, ...monsters.filter(x => x !== mo).map(x => x.cell)])
    const mp = mo.mp ?? data.monster(mo.monsterId)?.grades.find(g => g.grade === 5)?.mp ?? data.monster(mo.monsterId)?.grades[0]?.mp ?? 0
    search.run(mo.cell, c => walk(c) && !others.has(c), mp)
    const reach = search.reached()
    const name = `${KROBES[mo.monsterId]?.nom ?? data.monster(mo.monsterId)?.name ?? mo.monsterId} ${mo.cell}`
    for (const lvl of offensiveLevels(mo.monsterId)) {
      if (mo.pesanteur && /!7\b/.test(lvl.statesCriterion)) continue
      const spell = data.spell(lvl.spellId)?.name ?? String(lvl.spellId)
      const zones = lvl.effects.filter(e => hitsEnemies(e.targetMask)).map(e => e.zone)
      for (const from of reach) {
        // Ligne de vue : les autres combattants la bloquent (pas le monstre, qui a quitté sa case de départ).
        const blocked = (c: number) => others.has(c)
        for (let t = 0; t < CELL_COUNT; t++) {
          if (!walk(t) || !isInCastRange(from, t, lvl.minRange, lvl.range, lvl.castInLine, lvl.castInDiagonal)) continue
          if (lvl.castTestLos && !hasLineOfSightOnMap(opaque, from, t, blocked)) continue
          for (const z of zones) for (const c of zoneCells(z, t, from)) mark(c, `${name} : ${spell}`, letterOf(mo.monsterId), mo.cell)
        }
      }
    }
  }
  return { byCell, letters, sources }
}

export interface ShootingCell {
  cell: number
  /** PM pour y aller (sans tacle). */
  steps: number
  /** Monstres qui peuvent toucher cette case à leur prochain tour (lettres). */
  threatened: string[]
  /** Monstres visibles et à portée de tir depuis cette case. */
  targets: string[]
  nearest: number
}

/**
 * Cases de tir d'un Crâ : atteignables avec `mp` PM depuis `from` (combattants infranchissables, sans tacle), d'où au
 * moins un monstre est à portée (`minRange`..`range`, sans ligne ni diagonale imposée) et en ligne de vue ; triées par
 * nombre de monstres qui menacent la case, puis distance au monstre le plus proche décroissante.
 */
export function shootingCells(map: MapData, monsters: Placed[], cras: number[], from: number, t: Threat, opts: { mp?: number; minRange?: number; range?: number } = {}): ShootingCell[] {
  const opaque = opaqueCells(map.cells)
  const occupied = new Set([...cras.filter(c => c !== from), ...monsters.map(m => m.cell)])
  const search = new GridSearch()
  search.run(from, c => !!map.cells[c]?.walkable && !occupied.has(c), opts.mp ?? 6)
  const out: ShootingCell[] = []
  for (const r of search.reached()) {
    const targets = monsters.filter(m =>
      isInCastRange(r, m.cell, opts.minRange ?? 1, opts.range ?? 13, false, false) &&
      hasLineOfSightOnMap(opaque, r, m.cell, c => occupied.has(c) && c !== m.cell))
    if (!targets.length) continue
    out.push({
      cell: r, steps: search.dist[r], threatened: [...(t.letters.get(r) ?? [])].sort(),
      targets: targets.map(m => `${letterOf(m.monsterId)}${m.cell}`), nearest: Math.min(...monsters.map(m => distance(r, m.cell))),
    })
  }
  return out.sort((a, b) => a.threatened.length - b.threatened.length || b.nearest - a.nearest || a.steps - b.steps)
}

/** Carte texte : lettres des menaces par case (voir l'en-tête). */
export function drawThreats(map: MapData, monsters: Placed[], cras: number[], t: Threat): string {
  const lines: string[] = []
  let first = -1
  let last = -1
  for (let row = 0; row < 40; row++) {
    const slots = new Array<string>(29).fill('    ')
    let any = false
    for (let col = 0; col < 14; col++) {
      const id = row * 14 + col
      const c = map.cells[id]
      const s = 2 * col + (row % 2)
      const mo = monsters.find(x => x.cell === id)
      const k = cras.indexOf(id)
      let tok: string
      if (mo) tok = `[${letterOf(mo.monsterId)}]`
      else if (k >= 0) tok = `C${k + 1}`
      else if (c?.walkable) tok = [...(t.letters.get(id) ?? [])].sort().join('') || '·'
      else tok = c && !c.los ? '##' : ''
      if (tok) any = true
      slots[s] = tok.padStart(3).padEnd(4)
    }
    if (any) {
      if (first < 0) first = row
      last = row
    }
    lines.push(slots.join('').trimEnd())
  }
  return lines.slice(first, last + 1).join('\n')
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ventre-de-la-baleine/menaces.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const mapId = Number(arg('--carte') ?? 140771332)
  const map = data.map(mapId)
  if (!map) throw new Error(`Carte ${mapId} absente de data/maps`)
  const idOf = (s: string) => {
    if (/^\d+$/.test(s)) return Number(s)
    const k = Object.entries(KROBES).find(([, v]) => v.nom.toLowerCase() === s.toLowerCase())
    if (!k) throw new Error(`Monstre inconnu : ${s} (noms : ${Object.values(KROBES).map(v => v.nom).join(', ')})`)
    return Number(k[0])
  }
  const pm = new Map((arg('--pm') ?? '').split(',').filter(Boolean).map(x => x.split(':')).map(([n, v]) => [idOf(n), Number(v)]))
  const pesanteur = new Set((arg('--pesanteur') ?? '').split(',').filter(Boolean).map(Number))
  const monsters: Placed[] = (arg('--monstres') ?? '').split(',').filter(Boolean).map(x => {
    const [n, c] = x.split(':')
    const monsterId = idOf(n)
    return { monsterId, cell: Number(c), mp: pm.get(monsterId), pesanteur: pesanteur.has(Number(c)) }
  })
  if (!monsters.length) throw new Error('--monstres Nom:case,… attendu (ex. Pataugerme:297,Virustine:341,Tabacille:286,Tabacille:242)')
  const cras = (arg('--cras') ?? '').split(',').filter(Boolean).map(Number)
  const t = threats(map, monsters, cras)
  console.log(`Carte ${mapId} — menaces au prochain tour des monstres (PM sans tacle, toutes leurs portées et zones)\n`)
  console.log(drawThreats(map, monsters, cras, t))
  const walkable = map.cells.filter(c => c.walkable).length
  const safe = map.cells.filter(c => c.walkable && !t.byCell.has(c.id) && !monsters.some(m => m.cell === c.id))
  console.log(`\nCases sûres : ${safe.length} sur ${walkable}`)
  const craMp = Number(arg('--pm-cras') ?? 6)
  const craRange = Number(arg('--po') ?? 13)
  // --cible <case> : seulement les cases d'où ce monstre est visible et à portée (ouverture « 4 éléments » sur le Pataugerme).
  const focus = arg('--cible') !== undefined ? Number(arg('--cible')) : undefined
  cras.forEach((c, k) => {
    const list = [...(t.byCell.get(c) ?? [])]
    const near = Math.min(...monsters.map(m => distance(c, m.cell)))
    console.log(`C${k + 1} (${c}) : ${list.length ? list.join(' ; ') : 'sûre'} — monstre le plus proche à ${near}`)
    const best = shootingCells(map, monsters, cras, c, t, { mp: craMp, range: craRange })
      .filter(s => focus === undefined || s.targets.some(x => x.endsWith(String(focus))))
      .slice(0, 6)
    console.log(`   cases de tir (${craMp} PM, PO ${craRange}) : ${best.map(s => `${s.cell} [${s.steps} PM, ${s.threatened.join('') || 'sûre'}, vise ${s.targets.join(' ')}]`).join(' · ') || 'aucune'}`)
  })
}
